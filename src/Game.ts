import { PerspectiveCamera, Vector3 } from 'three';
import { Engine } from './core/Engine';
import { Loop, type LoopTick } from './core/Loop';
import { IsoCamera } from './core/IsoCamera';
import { InputSystem, PointerControls } from './core/input';
import { isTouchDevice } from './core/device';
import {
  CAMERA_ZOOM_STEP,
  PLAYER_LONGEST_STEP,
  PLAYER_RADIUS,
  VIEWMODEL_LAYER,
} from './core/constants';
import type { FrameContext, GameSystem } from './core/types';
import { FoliageFade, Sky, TreeClimbing, World, skyViewFor, type WorldOptions } from './world';
import {
  ENTRANCE_ANGLE,
  ENTRANCE_GATE_X,
  ENTRANCE_GATE_Z,
  ENTRANCE_PLAYER_X,
  ENTRANCE_PLAYER_Z,
} from './world/entrance/layout';
import { arrivalOwnsTheSpawn } from './world/entrance/arrivalSpawn';
import { arrivalShot } from './world/entrance/ArrivalSequence';
import { Highlights } from './world/Highlights';
import { Selection } from './world/Selection';
import { pickInteractZone, PRIMARY_ACTION, type InteractZone } from './world/interact';
import { InteractRouter, type InteractClaim } from './world/InteractRouter';
import type { InteriorControls } from './world/building';
import { GARDEN_FLOOR, LOBBY, OCEAN_FLOOR } from './world/hotel/layout';
import {
  HeldBalloons,
  Parade,
  Player,
  TapNavigator,
  WornFlower,
  WornHat,
  WornJetpack,
  WornKeychain,
} from './entities';
import { JUMP_APEX_HEIGHT } from './entities/Player';
import { NavGrid } from './world/NavGrid';
import { CharacterCreation, CuteODex, Hud, LiftPanel, ScreenControls, TapBurst, WhatsNew } from './ui';
import { ActionChips } from './ui/ActionChips';
import { ParkMap } from './ui/ParkMap';
import { RaceHud } from './ui/RaceHud';
import { Transitions } from './ui/Transitions';
import { MiniGameHost } from './minigames';
import { createRideHud, type RideHud } from './minigames/ferrisWheel/hud';
import { Shopping } from './Shopping';
import { SaveSystem } from './SaveSystem';
import { gameStore, type CharacterCreationChoice } from './state';
import { shopItem } from './world/building/shops/catalogue';
import type { SavedPlace } from './state/save';
import { localToWorld, SPACE_GARDEN } from './world/spaces';
import { OverlayPause } from './core/overlayPause';
import { attractionOwnsTheScreen } from './core/attraction';

/**
 * Where a brand-new player starts: **the park edge, at the gate, where the cat
 * bus drops her off.**
 *
 * This used to be `(0, 0, 7)` — the plaza, by the fountain — and that was wrong
 * in a way nothing noticed, because two places disagreed about where "the
 * entrance" is and only one of them was ever measured. `ENTRANCE_PLAYER_X/Z`
 * was imported by `scripts/check-park.mts`, `scripts/check-npc-jitter.mts` and
 * `test/procgen/parkFacts.ts` and **by nothing in `src/` at all**, so
 * `check:park`'s "every attraction routes from the entrance" was proving a
 * property of a point the game never once put the player on.
 *
 * Moving the spawn here is what makes that check honest, and it is also what
 * the family asked for: *"gameplay starts at the edge of the park, where you
 * walked in"* (issue #245). One place, measured by the checks and used by the
 * game.
 */
const DEFAULT_SPAWN = new Vector3(ENTRANCE_PLAYER_X, 0, ENTRANCE_PLAYER_Z);

/**
 * Facing at {@link DEFAULT_SPAWN}: into the park, with her back to the gate.
 *
 * Derived from the entrance's own bearing rather than typed as a number, so it
 * still points inward if the gate ever moves. A Three.js `rotation.y` of `t`
 * sends local +Z to world `(sin t, cos t)`; inward is the negative radial.
 */
const DEFAULT_SPAWN_FACING = Math.atan2(
  -Math.cos(ENTRANCE_ANGLE),
  -Math.sin(ENTRANCE_ANGLE),
);

export interface GameOptions {
  /**
   * Where a continued game left off, from the save file.
   *
   * Omitted for a fresh start, and omitted rather than `null` — the tsconfig
   * has `exactOptionalPropertyTypes`.
   */
  readonly startPlace?: SavedPlace;
  /**
   * Whether the cat bus brings her in — see `world/entrance/Entrance.ts`.
   *
   * Omitted means "decide from the save flag", which is the arrival happening
   * for anyone who has not had it. Only a caller that positively knows better
   * passes `false`: a ride deep link, or `/view`.
   */
  readonly arriveByBus?: boolean;
}

/**
 * Wires everything together and owns the frame.
 *
 * Frame order matters and is deliberate:
 *  1. input.update()  — snapshot the devices once, so every system sees the
 *     same state and edge queries (`justPressed`) behave.
 *  2. player.update() — the player moves first; the camera and the sun both
 *     follow where they end up.
 *  3. camera.update() — follows the player, handles rotate/zoom.
 *  4. world.update()  — clock, sky, water, lights, signs.
 *  5. render          — sky backdrop pass, then the world on top.
 *
 * Anything with its own per-frame behaviour can be registered with
 * {@link addSystem} and it will be updated after the world.
 */
export class Game {
  readonly engine: Engine;
  readonly camera: IsoCamera;
  readonly input: InputSystem;
  readonly sky: Sky;
  readonly world: World;
  readonly player: Player;
  readonly hud: Hud;
  readonly navGrid: NavGrid;
  readonly tapNavigator: TapNavigator;
  readonly pointer: PointerControls;
  readonly screenControls: ScreenControls;
  readonly miniGames: MiniGameHost;
  readonly shopping: Shopping;
  readonly treeClimbing: TreeClimbing;
  readonly foliageFade: FoliageFade;
  readonly selection: Selection;
  readonly actionChips: ActionChips;
  readonly highlights: Highlights;
  readonly tapBurst: TapBurst;
  /** The Rail Race's countdown, lap and result card — and its hold pad. */
  readonly raceHud: RaceHud;
  readonly transitions: Transitions;
  readonly liftPanel: LiftPanel;
  readonly hotelLiftPanel: LiftPanel;
  readonly parade: Parade;
  readonly wornFlower: WornFlower;
  readonly wornHat: WornHat;
  readonly wornJetpack: WornJetpack;
  readonly wornKeychain: WornKeychain;
  readonly heldBalloons: HeldBalloons;
  readonly cuteODex: CuteODex;
  readonly whatsNew: WhatsNew;
  readonly parkMap: ParkMap;
  readonly saveSystem: SaveSystem;

  private readonly loop: Loop;
  private readonly systems: GameSystem[] = [];
  private readonly frameContext: MutableFrameContext;
  private started = false;

  /**
   * How fast the world runs. 1 normally; the stair ride winds it up so a child
   * arrives on the next floor before they wonder what is happening.
   */
  private timeScale = 1;
  /** Game time, accumulated at `timeScale`, for every animation phase. */
  private elapsed = 0;
  /** Per-frame memo for {@link currentZones}. -1 so the first call always builds. */
  private zoneCacheFrame = -1;
  private zoneCache: readonly InteractZone[] = [];
  /** The ferris wheel's caption/shout/card layer. Only alive during a ride. */
  private ferrisHud: RideHud | null = null;
  private readonly ferrisHudHost: HTMLElement;
  /**
   * True while the "Look" pill's `CharacterCreation` is mounted over the park.
   *
   * The dialog has no close button — finishing the form is the only way out —
   * so this is the whole of "is the creator up?", and both the pause
   * ({@link syncLookPaused}) and Escape's ownership ({@link tick}) are derived
   * from it rather than tracked separately.
   */
  private lookOpen = false;
  /** Freezes the park while {@link lookOpen} — see `core/overlayPause.ts`. */
  private readonly lookPause = new OverlayPause();

  /**
   * {@link IsoCamera.zoom} from just before the keychain rack's zoomed view
   * opened, so closing it can hand back exactly what she had — a manual
   * pinch/scroll zoom, not necessarily the default — rather than silently
   * resetting her own choice. Tracked here, not on `KeychainShop`, because
   * only `Game` may read the camera at all (see `tick`'s own wiring, right
   * beside the cat-bus arrival's identical re-derive-every-frame zoom).
   */
  private keychainShopWasOpen = false;
  private zoomBeforeKeychainShop = 1;

  /** Every sign in the park, as a selectable zone. Built once: signs do not move. */

  private readonly uiRoot: HTMLElement;

  constructor(
    /**
     * The renderer, the scene and the canvas sizing — built by the **caller**,
     * not here.
     *
     * It used to be `new Engine(canvas)` on the next line. It was hoisted out
     * on 8 August 2026 because the cat bus's journey (`BusJourney`) has to draw
     * a scene of its own *before this constructor has ever run*: the ride is
     * the park's loading screen, so the park is being built while it plays, and
     * a second `WebGLRenderer` on the same canvas is not a thing WebGL will
     * give you — `getContext` hands back the context that already exists.
     *
     * One renderer, made once, handed to whoever is drawing.
     */
    engine: Engine,
    // Kept as a field (not just a constructor-local) for `applyLiveLook`,
    // which needs somewhere to mount the "Look" pill's `CharacterCreation`
    // overlay long after the constructor has returned.
    uiRoot: HTMLElement,
    options: GameOptions = {},
  ) {
    this.uiRoot = uiRoot;
    this.engine = engine;
    const canvas = engine.canvas;
    this.camera = new IsoCamera();
    this.input = new InputSystem();
    this.sky = new Sky();

    // The building needs a way to move the camera, the clock and the screen
    // wipe when a child walks through its front door into its own space. It is
    // handed one rather than reaching up in here; the closures are only ever
    // called from a frame, long after everything below is built. The camera
    // goes in too: NPC name labels are screen-space, so the crowd needs it.
    // `arriveByBus` is threaded in rather than read from the flag in here, so
    // there is one owner of "is the bus coming?" and `Entrance` is it. Built
    // conditionally rather than spread, because `exactOptionalPropertyTypes`
    // forbids handing an optional property an explicit `undefined`.
    const worldOptions: WorldOptions =
      options.arriveByBus === undefined ? {} : { entrance: { arriveByBus: options.arriveByBus } };
    this.world = new World(
      this.engine.scene,
      this.sky,
      this.interiorControls(),
      this.camera,
      worldOptions,
    );

    // Spawn at the park edge by the gate, looking into the park — or wherever a
    // continued game left off (see `resolveSpawn`).
    const spawn = resolveSpawn(options.startPlace);
    this.player = new Player(this.world.collision, this.camera, spawn);
    this.engine.scene.add(this.player.group);
    // The building owns "how high is the ground?" from here on, so that its
    // decks, stairs and lift are all walkable.
    this.world.attachPlayer(this.player);
    // A save written inside the hotel restores into its room, not the plaza:
    // rooms are true spaces, so being there is a position plus this adoption.
    this.world.hotel.adoptRestoredPlayer();
    // `Player`'s constructor samples the terrain for its own height, which is
    // right for a fresh spawn and wrong for a restored one — she may have been
    // standing on a bridge, a deck or the fountain rim. Now that the building's
    // ground sampler is attached, put her back exactly where she was, facing
    // the way she was facing.
    //
    // **Unless she is on the bus**, which is the one case where somebody has
    // already put her somewhere on purpose. `world.attachPlayer` above runs
    // `ArrivalSequence.attachPlayer`, which seats her in the cat bus out at the
    // kerb; teleporting her to the spawn point immediately afterwards undid
    // that, and then `camera.snapTo(this.player.position)` at the end of this
    // constructor snapped the camera to the **park**, not to the bus. Frame one
    // put her back in her seat and the camera spent the next half second gliding
    // across the park to find her — Jim, 7 August: *"the camera starts in the
    // middle of the park and then scrolls to the bus"*.
    //
    // Shortening the ease would not have fixed it. The camera was told the
    // truth about a position that was wrong.
    if (arrivalOwnsTheSpawn(this.world.entrance.arrival !== null, options.startPlace != null)) {
      // She is aboard. Where she is, is the bus's business.
    } else if (spawn !== DEFAULT_SPAWN && options.startPlace) {
      this.player.teleportTo(spawn.x, spawn.y, spawn.z, options.startPlace.facing);
    } else {
      // A fresh spawn faces into the park rather than back out through the gate
      // she has just come in by. `Player` starts on the camera's own yaw, which
      // was the right default when the spawn was the middle of the plaza and is
      // the wrong one now that it is on the boundary looking inward.
      this.player.teleportTo(spawn.x, this.player.position.y, spawn.z, DEFAULT_SPAWN_FACING);
    }

    // Whatever flower is currently worn in the hair (see `world/Flowers.ts` /
    // `entities/WornFlower.ts`). A store subscriber like `CarriedItem`, so it
    // needs nothing from the rest of this constructor beyond the anchor.
    //
    // The anchor is a closure, not the `Group` itself — `WornFlower` (and
    // every other system below built the same way) reads `player.model.X`
    // fresh every time it draws, rather than caching a copy of it, so the
    // HUD's "Look" pill rebuilding `player.model` in place (`applyLiveLook`)
    // never leaves any of them pointing at an anchor that got disposed out
    // from under them. See `WornHat.ts`'s own doc comment on the same field.
    this.wornFlower = new WornFlower(() => this.player.model.hairAnchor);
    this.addSystem(this.wornFlower);

    // The hat chosen (or granted free) in the character creator — see
    // `entities/WornHat.ts`. Same store-subscriber shape as `wornFlower`
    // above, parented to the head instead of the hairline. `hairHidesHat`
    // is what lets `WornHat` decline to draw a hat that Mohican's crest
    // cannot share the head with, without touching `wornHatUid` itself.
    this.wornHat = new WornHat(
      () => this.player.model.hatAnchor,
      () => this.player.model.hairHidesHat,
      (worn) => this.player.model.setHatWorn(worn),
    );
    this.addSystem(this.wornHat);
    // So the name label can size itself off whatever hat is actually worn —
    // see `Player.labelTopHeight`.
    this.player.wornHat = this.wornHat;

    // The jet pack, if one has been bought — see `entities/WornJetpack.ts`.
    // Third of the three worn slots, and the same store-subscriber shape as the
    // two above; its `onWornChange` puts her own backpack away, because you
    // cannot strap two things to one back.
    this.wornJetpack = new WornJetpack(() => this.player.model.jetpackAnchor, (worn) =>
      this.player.model.setJetpackWorn(worn),
    );
    this.addSystem(this.wornJetpack);
    // So the flight in `Player.update` can ask whether there is actually a pack
    // on her back — the same object the HUD's fly button asks, so a button that
    // is there and a flight that is allowed are one fact rather than two.
    this.player.wornJetpack = this.wornJetpack;

    // The keychain dangling off her bag, if one has been collected — see
    // `entities/WornKeychain.ts`. Fourth worn slot, same store-subscriber
    // shape. No `onWornChange`: a keyring displaces nothing, so unlike the jet
    // pack it has nothing to ask the model to put away.
    this.wornKeychain = new WornKeychain(this.player.model.keychainAnchor);
    this.addSystem(this.wornKeychain);

    // The parade of cute things. Built here, before the tap handler, because a
    // tap has to be offered to the parade first — pressing your bunny means
    // "into the backpack, please", not "walk to where the bunny is standing".
    // It follows the player's breadcrumb trail, so it must also be constructed
    // after `attachPlayer` installed the building's ground sampler.
    this.parade = new Parade(this.player, this.world.collision, this.camera);
    this.engine.scene.add(this.parade.group);
    this.addSystem(this.parade);
    // The seam a nap uses to send a pet to its own bed — see
    // `Hotel.PetParadeLink` and `Hotel.sendPetsToBed`, its one caller.
    // `Parade` satisfies the interface structurally; this is the one place
    // that holds both a `Parade` and a `Hotel` to introduce them.
    //
    // **It is the whole of the wiring, and deliberately one-way.** The parade
    // owns a pet's body from the line all the way onto the cushion and back;
    // nothing here hides a pet, moves one, or holds a second copy of one.
    this.world.hotel.petParade = this.parade;
    // And the same seam again for the great hall's banquet (#449): she sits
    // down at the feast, and her companions go and eat at their own little
    // table. Identical shape, identical reasoning — the building says where
    // the places are, the parade walks the animals to them and owns their
    // bodies the whole way, and nothing comes back the other direction.
    this.world.building.petParade = this.parade;

    // Every balloon the player owns and has not stowed, held above them on a
    // bending string — see `entities/HeldBalloon.ts`'s doc comment for why
    // this is not simply parented to the hand, and `entities/parade/Parade.ts`
    // for the other half of the fix (balloons no longer join the walking
    // line). Built after the parade for no reason but reading order; the two
    // do not interact.
    this.heldBalloons = new HeldBalloons(this.player);
    this.engine.scene.add(this.heldBalloons.group);
    this.addSystem(this.heldBalloons);

    // The map a tapped walk is routed on (ORDER-OF-WORK 1.0). Built here, after
    // `World`, because it bakes the *finished* collision world — everything
    // solid is registered by the time World's constructor returns, and nothing
    // is added afterwards. It does no work at all until the first walk asks for
    // a route, and `CollisionWorld.revision` covers us if that ever stops being
    // true. `PLAYER_RADIUS` and `JUMP_APEX_HEIGHT` are the player's own numbers
    // rather than a second set: the lattice has to agree with the resolver
    // about where she fits and with the auto-hop about which walls she clears.
    // Before the lattice is ever baked, and for the same reason it is built
    // here: the collision world is finished, so this is the one moment the
    // whole park can be checked at once. It refuses to let a wall exist that
    // the route planner would hop and the flight would not clear — the exact
    // shape of bug that stranded a six-year-old against the 1.4 m wall at
    // [3, 19] → [-4, 20]. See `Collision.checkHoppableColliders`.
    this.world.collision.checkHoppableColliders(PLAYER_RADIUS, JUMP_APEX_HEIGHT);
    // And, in the same breath and for the same reason: that the sub-steps her
    // movement is cut into are still short enough for the thinnest thing the
    // park has grown. See `Collision.checkSubstepBudget` — this is the guard
    // on the P1 where a stuttering frame walked her clean through a wall.
    this.world.collision.checkSubstepBudget(PLAYER_RADIUS, PLAYER_LONGEST_STEP);

    this.navGrid = new NavGrid(
      this.world.collision,
      PLAYER_RADIUS,
      JUMP_APEX_HEIGHT,
      // The declared ways between levels — the lobby's sweeping stair, and
      // whatever the imperial rebuild declares after it. Read at lattice
      // build; see NavGrid's header and Decision 11.
      () => this.world.building.surfaces.connectors,
      // Every railway bridge's deck and ramps (issue #116, Decision 8) — see
      // NavGrid's own `bridgeCovers` header.
      (x, z) => this.world.train.bridges.some((bridge) => bridge.covers(x, z)),
    );

    // Tap-to-move. Built after the world so it can ask the building where its
    // tap targets are, and after the player so it can borrow the ground sampler
    // the building installed. `treeClimbing` is constructed further down (it
    // needs the HUD), but this closure only reads it once play starts, by
    // which point construction has finished.
    this.tapNavigator = new TapNavigator(
      this.player,
      this.camera,
      this.input,
      this.navGrid,
      // What a tap may land on is what the castle's cutaway leaves visible —
      // one owner: the same `currentDeck` that drives the floor fade.
      () => this.world.building.visibleSurfaceCeiling,
    );
    this.engine.scene.add(this.tapNavigator.group);

    this.pointer = new PointerControls(canvas, {
      onTap: (point) => {
        // A nap ends on her own say-so now, not a timer (issue #279's
        // follow-up, Jim 24 Aug 2026: *"make them stay in the bed until the
        // player gets them out … tapping anywhere, clicking anywhere … wakes
        // them"*). Checked first, the same way the tree's "tap anywhere means
        // come down" already is below: whatever else the tap might have hit —
        // a prop to select, a pet to call over, a spot to walk to — is not
        // what she asked for while she is asleep, so none of it runs.
        // `Hotel.wakeNap` is a no-op when nobody is actually napping, so this
        // costs nothing the rest of the time.
        if (this.world.hotel.isNapping) {
          this.world.hotel.wakeNap();
          return;
        }
        // Up a tree, a tap anywhere means "come down" — it is not a place to
        // walk to, and the character cannot walk while riding the climb
        // anyway (see `Player.riding`).
        if (this.treeClimbing.playerClimbing) {
          this.treeClimbing.requestDescend();
          return;
        }
        if (this.parade.handleTap(point)) return;
        // GAME_DESIGN.md's SELECTION RULE, step 1: a tap that lands on a thing
        // *selects* it and goes no further. Selection is free — it costs no
        // walk — and that is exactly what makes a distant thing take two taps
        // and stops a child doing anything by accident. A tap that hits nothing
        // falls through to the walk, unchanged since the day it was written.
        if (this.selection.handleTap(point.ndcX, point.ndcY)) return;
        this.tapNavigator.handleTap(point);
      },
      // Pinching is the touch equivalent of the +/- keys, expressed in the same
      // units, so it lands in the camera's existing clamped zoom target.
      //
      // Guarded exactly like `onWheelZoom` below, for the same reason issue
      // #282's fix introduced: `PointerControls` used to track pinch on the
      // canvas alone, so a ride's `cameraOverride` and a mini-game's
      // full-screen `.mg-layer` (`minigames/overlay.ts`, `pointer-events: auto`
      // while `hidesPark`) *incidentally* kept pinch from ever seeing two
      // fingers in either case — the touches simply never reached the canvas.
      // Moving pinch to a window-level, capture-phase listener (so a finger
      // resting on an ordinary HUD button no longer breaks it) removed that
      // incidental protection too: two fingers resting on a mini-game's own
      // hold pad, or on a ride's own on-screen stick, would otherwise still
      // read as a pinch and silently drift `zoomTarget` until it jumps the
      // moment the park camera comes back — the same failure mode
      // `onWheelZoom`'s own `cameraOverride` guard exists to prevent, just
      // reachable by touch now that pinch is not canvas-scoped. `hidesPark`
      // (not the broader `active`) is the precise match for the window
      // `.mg-layer` actually covers the screen: `active` also covers the
      // curtain opening/closing, during which the transition renders to the
      // park's own canvas and a pinch there always worked, before and after
      // this guard.
      // **`parkMap.isOpen` added for #359**, which gives the map its own
      // pinch-to-zoom. `PointerControls` recognises pinch on a window-level
      // capture listener (deliberately — see its own note, so a finger resting
      // on a HUD button cannot break the gesture), which means two fingers on
      // the *open map overlay* are still seen here. Without this guard a pinch
      // meant for the map would zoom the map **and** silently drift the park
      // camera's `zoomTarget` underneath it, to jump the moment the map
      // closed. That is `onWheelZoom`'s `cameraOverride` failure exactly, and
      // #359 would have introduced a fresh instance of it rather than
      // inheriting one.
      onPinch: (delta) => {
        if (this.cameraOverride || this.miniGames.hidesPark || this.parkMap.isOpen) return;
        this.camera.nudgeZoom(delta * CAMERA_ZOOM_STEP * 6);
      },
      // The wheel is the mouse equivalent of pinch (issue #242): same call,
      // same clamp, same damping — `nudgeZoom` is the one and only owner of
      // "how far you may zoom" and neither gesture may restate it. One notch
      // is defined as one keyboard `+`/`-` press's worth of zoom.
      //
      // Guarded on `cameraOverride` alone, unlike `onPinch` above: a mouse
      // wheel notch's `event.target` is still whatever DOM element is
      // topmost, so a mini-game's `.mg-layer` already keeps a wheel notch
      // from ever reaching this file while `hidesPark` — the same thing that
      // used to be true of pinch, before it moved off the canvas. A mouse
      // wheel sits right under a hand that is otherwise idle while enjoying a
      // ride, so without the `cameraOverride` guard a stray notch would fight
      // the ride's own camera the moment it next let go — the camera on
      // screen wouldn't visibly jump (the ride renders through
      // `cameraOverride`, not `this.camera.camera`), but `zoomTarget` would
      // have drifted underneath it for when the ride hands the camera back.
      onWheelZoom: (notches) => {
        if (this.cameraOverride) return;
        this.camera.nudgeZoom(notches * CAMERA_ZOOM_STEP);
      },
      // Drag to look around the park (#419). Jim, 31 Aug 2026: *"while in
      // normal gameplay (walking around) dragging the screen with the mouse or
      // a finger should pan the camera to look around the park. Then, after
      // about 3s of not swiping/dragging it should return to your character"*.
      //
      // Nothing here decides *what a drag is* — `PointerControls` fires this
      // off the very flag that stopped the same gesture becoming a tap, which
      // is `tapGesture.ts`'s one definition. All this closure owns is when a
      // drag is *allowed*, and the camera owns how far it may go.
      onLookDrag: (dx, dy) => {
        if (this.lookAroundBlocked()) return;
        this.camera.lookByPixels(dx, dy);
      },
      // The mouse half of the HIGHLIGHT RULE. Mouse-only, and `Selection` does
      // the picking on the next frame rather than here, so a mouse waggled
      // about cannot cost more than one ray a frame. `selection` is built
      // further down; the closure only runs once play has started.
      onHover: (point) => {
        if (point) this.selection.setCursor(point.ndcX, point.ndcY);
        else this.selection.clearCursor();
      },
    });

    // The HUD clears the overlay when it is built, so everything else that puts
    // DOM in there has to come after it.
    this.hud = new Hud(uiRoot);
    this.hud.setLookHandler(() => this.reopenCharacterCreator());
    // The HIGHLIGHT RULE's activation flash, for the interface: press any
    // button anywhere and the same rainbow radiates off it. One delegated
    // listener and a pool of four overlays — see `ui/TapBurst.ts`; no panel
    // has to know it exists.
    this.tapBurst = new TapBurst(uiRoot);
    // The Rail Race's framing. Mounted here with the rest of the HUD; it is
    // invisible and inert until the race raises its first moment (see the
    // wiring at the end of this constructor).
    this.raceHud = new RaceHud(uiRoot);
    // ...including the world's own HUD. The face-painting stall owns a picker
    // panel and a proximity hint, and `World` was built ~80 lines ago, so it
    // could not have mounted them itself without the line above deleting them.
    this.world.mountUi(uiRoot);
    // The collection book. Mounts its own pill into the HUD's top row and owns
    // the C key, so neither `Hud` nor the input bindings need to know about it.
    this.cuteODex = new CuteODex(uiRoot);
    // "What's new": checks `whatsnew.json` against localStorage and shows
    // itself, synchronously, if there is anything the player has not seen —
    // see `ui/WhatsNew.ts`. Built here so the check happens before the first
    // frame renders, and mounted like every other overlay, as a plain DOM
    // child of `uiRoot` rather than anything the world needs to know about.
    this.whatsNew = new WhatsNew(uiRoot);
    // The park map (GAME_DESIGN.md #24/#30d). Mounts its own HUD pill, same as
    // the Cute-o-dex above; reads `world`/`player` and reuses the tap navigator
    // for tap-to-travel rather than a second movement path. `miniGames` is
    // referenced through a closure rather than passed directly, since it is
    // not built yet at this point in the constructor — the closure is only
    // ever called later, once play has started and it exists.
    this.parkMap = new ParkMap(uiRoot, {
      world: this.world,
      player: this.player,
      walkTo: (x, y, z) => this.tapNavigator.navigateTo(x, y, z),
      // The same question the HUD's own menu asks every frame, through the same
      // one owner — see `core/attraction.ts`. It was written out longhand here
      // and would have been written out longhand a second time in `tick` for
      // #404, which is how "the map refuses but its pill is still there" gets
      // to be a thing.
      blocked: () => this.attractionHasHer(),
      // Issue #309: a map tap that lands on an attraction (a ride, a stall, the
      // hotel lobby, a garden cart…) walks her to its stand point and uses it
      // on arrival, instead of the old flat refusal a solid collider used to
      // get from `isReachable`. `useZoneNear` is built once `selection` exists
      // below (referenced through a closure for the same reason `miniGames`
      // is), and it is the *only* new "use this attraction" path — everything
      // it calls is the ordinary walk-up-and-press-E plumbing.
      useAttraction: (x, y, z) => this.useZoneNear(x, y, z),
    });
    this.screenControls = new ScreenControls(uiRoot, this.input);
    // A DOM layer of its own for the ferris wheel's HUD, so `RideHud` — written
    // for a mini-game's overlay — can be reused unchanged. Hidden except during
    // a ride, and `pointer-events: none` because everything in it is something
    // to read, never something to press.
    this.ferrisHudHost = document.createElement('div');
    this.ferrisHudHost.className = 'ferris-hud-host';
    this.ferrisHudHost.hidden = true;
    // **No way off, on purpose.** Getting off a ride is waiting for it to
    // finish (Jim, 3 August 2026): ninety seconds, and it sets her down beside
    // the wheel itself. There was an X here, added when the review found no
    // touch exit at all — the right fix for the wrong requirement.
    uiRoot.appendChild(this.ferrisHudHost);

    this.transitions = new Transitions(uiRoot);


    // The fairground stalls. Walking up to one and pressing interact hands the
    // frame over to the mini-game host: it freezes the park (exactly as the
    // pause menu does, so nobody moves while you are away), wipes across to a
    // little self-contained world of its own, and wipes back when you are done.
    // See `minigames/MiniGameHost.ts` and ARCHITECTURE.md's mini-game appendix.
    this.miniGames = new MiniGameHost({
      engine: this.engine,
      input: this.input,
      uiRoot,
      stalls: this.world.stalls.stalls,
      touch: isTouchDevice(),
      // Nothing needs this any more. It existed for exactly one stall — the
      // ferris wheel, which was a curtain mini-game and so had no
      // `beginRide`/`endRide` to put a child down at the end of. Now that it
      // is a world ride (`world/ferrisWheel/`) it owns its own dismount, like
      // the train and both coasters do. Every remaining stall is a
      // self-contained game a child steps straight back out of, at the exact
      // doormat she stepped in from.
    });

    // Shops: the join between the shop geometry, the purchase panel and the
    // store. Registered as a system so it updates after the world, which is
    // where the player's position for this frame has just been settled.
    this.shopping = new Shopping(uiRoot, this.player, this.world, this.hud);
    this.addSystem(this.shopping);

    // Tree climbing (family design feedback: NPCs — and the player — climb
    // trees and peek out of the leaves). Registered after `shopping` so its
    // HUD prompt wins when both would otherwise want the same line — trees
    // and shops never actually overlap, but the ordering costs nothing and
    // keeps the two systems from fighting over `hud.setPrompt` if they ever
    // did. See `world/TreeClimbing.ts`.
    this.treeClimbing = new TreeClimbing(
      this.player,
      this.world.npcs,
      this.hud,
      this.world.scenery.climbableTrees,
    );
    this.addSystem(this.treeClimbing);

    // Fades out any tree standing between the camera and the player — the
    // fixed camera (design feedback #16) means one can now hide them
    // completely for as long as they stand there. See `world/FoliageFade.ts`.
    this.foliageFade = new FoliageFade(this.world.scenery, this.camera);
    // Trees are not the only things in the way any more: at 4x the fountain
    // statue (#121) hides a standing child over 32.8 m² of the plaza. It fades
    // itself, so it registers as a plain occluder rather than needing the
    // instanced-foliage stand-in machinery. Anything else tall enough to hide
    // the player joins the same way — see `SightlineOccluder`.
    this.foliageFade.addOccluder(this.world.fountain.statueOccluder);
    this.engine.scene.add(this.foliageFade.group);
    this.addSystem(this.foliageFade);
    // The lift's control panel (GAME_DESIGN.md, "Riding the lift"): appears
    // when a child is standing at the lift doors, calls the car, and then lists
    // the floors. It is handed the building's `floors()` / `go(n)` seam and
    // nothing else — see `world/building/liftRide.ts` for why that matters to
    // ARCHITECTURE-DECISIONS Decision 3.
    //
    // The blocked test is `uiOwnsTheScreen()` **minus riding**, because riding
    // is the one case where this panel is the thing you are using: the whole
    // journey happens with the character handed over to the lift. Every other
    // ride leaves the panel's own state at "away", so it hides itself anyway.
    this.liftPanel = new LiftPanel(
      uiRoot,
      this.world.building.liftPanel,
      () =>
        (this.uiOwnsTheScreen() && !this.player.riding) ||
        this.parkMap.isOpen,
    );
    this.addSystem(this.liftPanel);

    // The Land Hotel's lift drives a second instance of the SAME panel: it
    // implements Decision 3's floors()/go(n) seam (the first portal lift),
    // which is exactly what the panel was written against. Only one of the
    // two can ever be showing — the player is only ever in one space.
    this.hotelLiftPanel = new LiftPanel(
      uiRoot,
      this.world.hotel.liftPanel,
      () =>
        (this.uiOwnsTheScreen() && !this.player.riding) ||
        this.parkMap.isOpen,
    );
    this.addSystem(this.hotelLiftPanel);

    // GAME_DESIGN.md's SELECTION RULE, built once for the whole game: one thing
    // in the park is selected at a time — by standing at it, hovering it or
    // tapping it — and that is what the rainbow outlines and what the chips
    // offer actions for. See `world/Selection.ts`; registering a tap target with
    // actions is all it takes to be covered by it.
    //
    // Riding is deliberately NOT blocked, unlike every other panel-ish test in
    // here: a child in the train's first-person seat is looking straight at the
    // platform, and "Get off" has to be pressable from there. Which zones may
    // be selected while a ride owns her is the zone's own business — see
    // `InteractZone.selectableWhileRiding`.
    this.selection = new Selection(this.player, this.camera, canvas, {
      zones: () => this.currentZones(),
      blocked: () => this.selectionBlocked(),
      walkTo: (x, y, z) => this.tapNavigator.navigateTo(x, y, z),
      walking: () => this.tapNavigator.isNavigating,
      flash: (zone) => this.highlights.flashZone(zone),
    });
    this.addSystem(this.selection);

    // GitHub issue #122: **a single E press routes to the zone the selection
    // currently shows.** Registered immediately after `Selection` so the pick it
    // dispatches to is this frame's, already settled — and it is the only thing
    // in the game that reads the interact key at all (see
    // `InputSystem.takeInteractPress`, and `world/InteractRouter.ts` for why the
    // claims below are not a way back to the bug).
    //
    // Order is priority, most modal first.
    this.addSystem(
      new InteractRouter(
        [
          {
            // The welcome panel is over everything, including itself.
            name: 'whatsNew',
            active: () => this.whatsNew.isOpen,
            run: () => this.whatsNew.close(),
          },
          {
            name: 'ferrisEndCard',
            active: () => this.world.ferrisWheel.cardDismissable,
            run: () => this.world.ferrisWheel.dismissCard(),
          },
          {
            // Under her hand, and a far better affordance than any chip — see
            // the panel's own wiring above.
            name: 'liftPanel',
            active: () => this.liftPanel.awaitingPress,
            run: () => this.liftPanel.pressFocused(),
          },
          {
            name: 'hotelLiftPanel',
            active: () => this.hotelLiftPanel.awaitingPress,
            run: () => this.hotelLiftPanel.pressFocused(),
          },
          {
            // Up a tree: `player.riding` is true, so nothing is selectable and
            // there is no chip for this to disagree with. This is the
            // double-fire hazard from #103, now impossible — climbing is a zone
            // action, coming down is this, and the key has one reader.
            name: 'treeDescend',
            active: () => this.treeClimbing.playerPeeking,
            run: () => this.treeClimbing.requestDescend(),
          },
        ] satisfies readonly InteractClaim[],
        this.selection,
      ),
    );

    // The chips themselves, floating over the selected item.
    this.actionChips = new ActionChips(
      uiRoot,
      this.selection,
      () => this.cameraOverride ?? this.camera.camera,
      () => this.player.riding,
    );
    this.addSystem(this.actionChips);

    // Registered last of the systems, and it has to be: it draws the pick
    // `selection` has just made this frame, so the outline can never point
    // somewhere different from the chips naming the action.
    this.highlights = new Highlights(this.engine.scene, {
      selected: () => this.selection.selected,
      blocked: () => this.selectionBlocked(),
    });
    this.addSystem(this.highlights);

    // The autosave. Not an `addSystem` registration on purpose — it is a
    // `setInterval`, so it fires *between* frames rather than inside `tick()`.
    // Everything it needs is a closure over what it must never write during:
    // a mini-game entrance or exit wipe, an iris carrying her between spaces,
    // or a ride driving the character. See `SaveSystem`.
    this.saveSystem = new SaveSystem({
      position: () => this.player.position,
      facing: () => this.player.facing,
      canSave: () => !this.miniGames.active && !this.transitions.wiping && !this.player.riding,
    });

    this.frameContext = {
      dt: 0,
      elapsed: 0,
      frame: 0,
      input: this.input,
      playerPosition: this.player.position,
      cameraForward: this.camera.forward,
    };

    this.engine.onResize((width, height) => {
      this.camera.resize(width, height);
      this.world.train.rideView?.resize(width, height);
      this.world.coaster.rideView?.resize(width, height);
      this.world.railRace.rideView?.resize(width, height);
      this.world.ferrisWheel.rideView?.resize(width, height);
      this.world.building.resizeRideCameras(width, height);
      this.world.hotel.resizeCinematic(width, height);
      this.sky.setAspect(width / Math.max(1, height));
    });
    this.world.train.rideView?.resize(window.innerWidth, window.innerHeight);
    // The slide's two cameras, fitted once at boot as well as on every resize.
    // Its **trackside** camera is built in `Building`'s constructor rather than
    // on boarding, so on a window that never resizes it would otherwise render
    // the whole ride at the 1:1 aspect it was constructed with.
    this.world.building.resizeRideCameras(window.innerWidth, window.innerHeight);
    this.world.hotel.resizeCinematic(window.innerWidth, window.innerHeight);

    // First person on the train (Decision 4 C2): boarding wipes into the
    // seat's RideCamera, alighting wipes back. The override is the third
    // render state Decision 1 specified — render() swaps cameras, nothing
    // else changes. Her own model hides while the eye is in her head.
    const rideCamera = (
      camera: import('three').PerspectiveCamera | null,
      playerStaysVisible = false,
    ) => {
      this.transitions.irisWipe(() => {
        this.cameraOverride = camera;
        this.player.group.visible = camera === null || playerStaysVisible;
      });
    };
    this.world.train.onRideChange = (riding) =>
      rideCamera(riding ? (this.world.train.rideView?.camera ?? null) : null);
    this.world.coaster.onRideChange = (riding) =>
      rideCamera(riding ? (this.world.coaster.rideView?.camera ?? null) : null);
    // The ginormous slide, ridden **chase** since 5 August 2026 (REQUIREMENTS
    // §9) — so, like the Rail Race, it passes `playerStaysVisible` and she is
    // not hidden. Reading the flag off the ride rather than writing `true` here
    // is what keeps the camera and the visibility one decision: a ride that
    // ever goes back to first person changes one field, not two files.
    //
    // **`rideCameraNow`, not `rideView.camera`.** Since 6 August the ride cuts
    // between a chase camera and trackside ones, and which shot it opens on is
    // the shot plan's business (`world/slide/cameras.ts`) — asking the ride
    // keeps that one decision in one place, so changing the opening shot does
    // not also mean editing this file.
    this.world.building.onRideChange = (riding) =>
      rideCamera(
        riding ? this.world.building.rideCameraNow : null,
        this.world.building.playerStaysVisible,
      );
    // **Mid-ride, a hard cut** — no wipe, deliberately. A real on-ride video
    // cuts between the cart cam and the trackside cameras, and an iris here
    // would turn each of the ride's five edits into a blink. `slide/cameras.ts`
    // sets out why a blend would be worse still.
    this.world.building.onRideCameraCut = (camera) => {
      // Only once a ride camera is actually what we are rendering with. The
      // ride starts a frame or two before `onRideChange`'s wipe reaches its
      // midpoint, and cutting into the ride before then would show through the
      // closing iris while the player is still on the roof.
      if (this.cameraOverride === null) return;
      this.cameraOverride = camera;
    };
    this.world.railRace.onRideChange = (riding) =>
      rideCamera(
        riding ? (this.world.railRace.rideView?.camera ?? null) : null,
        this.world.railRace.playerStaysVisible,
      );
    // The hotel's own camera moments — the food close-up, a picture on the
    // wall, the view out of a fiftieth-floor window (`hotel/cinematic.ts`).
    //
    // **Set directly, with no iris wipe**, exactly as `onRideCameraCut` above
    // does: these are gentle push-ins and a wipe would turn each one into a
    // blink. That is safe because the shot's first frame is the iso camera's
    // own position and aim, so the instant control changes hands nothing on
    // screen moves. Her model stays visible throughout — for two of the three
    // she is the subject.
    this.world.hotel.onCinematic = (camera) => {
      this.cameraOverride = camera;
    };
    this.world.ferrisWheel.touch = isTouchDevice();
    this.world.ferrisWheel.onRideChange = (riding) => {
      if (riding) {
        rideCamera(this.world.ferrisWheel.rideView?.camera ?? null);
        return;
      }
      // Getting *off* needs the teardown to happen at the wipe's midpoint,
      // where the camera swaps and the iris is shut — not before it, which left
      // the closing half of the wipe looking through the gondola's camera at
      // 340 m with the gondola already gone. `rideCamera` cannot express that,
      // so this one spells the wipe out.
      this.transitions.irisWipe(() => {
        this.cameraOverride = null;
        this.player.group.visible = true;
        this.world.ferrisWheel.hideRide();
      });
    };
    // The ride raises moments and knows nothing about the DOM; this is the only
    // place the two meet, in the same idiom as the Rail Race's `onRaceMoment`.
    // The HUD is built on boarding and torn down on landing rather than kept
    // around: it is ninety seconds of a park you can play in for hours.
    this.world.ferrisWheel.onMoment = (moment) => {
      switch (moment.kind) {
        case 'start':
          this.ferrisHud?.dispose();
          this.ferrisHudHost.hidden = false;
          // Appends its own layer; the X above is a sibling and survives.
          this.ferrisHud = createRideHud(this.ferrisHudHost);
          break;
        case 'shout':
          this.ferrisHud?.shout(moment.text, moment.seconds);
          break;
        case 'stick':
          this.ferrisHud?.setStick(moment.stick);
          break;
        case 'card':
          this.ferrisHud?.showCard(moment.title, moment.line, moment.hint);
          break;
        case 'end':
          this.ferrisHud?.dispose();
          this.ferrisHud = null;
          this.ferrisHudHost.hidden = true;
          break;
      }
    };
    // No stall may open while a ride has her — see `MiniGameHost.riding`.
    this.miniGames.riding = () => this.player.riding;
    // Every booth's chip, wired to the framework that runs what is behind it.
    this.world.stalls.onEnter = (stallId) => this.miniGames.enter(stallId);
    this.miniGames.boardRide = (stallId) => {
      if (stallId === 'railRacer') return this.world.railRace.requestBoard();
      if (stallId === 'skyCruiser') return this.world.coaster.requestBoard();
      if (stallId === 'spaceFerrisWheel') return this.world.ferrisWheel.requestBoard();
      // The ginormous slide is not a stall — you reach it by climbing the
      // castle — so these two ids exist only for its deep links, which is the
      // difference between QA testing the ride and QA testing the stairs.
      if (stallId === 'ginormousSlide') return this.world.building.requestBoardSlide(false);
      if (stallId === 'ginormousSlideWithGrownUp') {
        return this.world.building.requestBoardSlide(true);
      }
      // The same ride with **a line of companions already caught**, for #507.
      // The pets coming down the chute behind her are the whole of that fix,
      // and one animal is not a line — a single starting pet would show the
      // lead gap and nothing about the spacing *between* companions, which is
      // half of what this fixes. Granted through the store's own catch, the
      // roof garden's route into the parade, so what rides down is a real
      // parade rather than a stand-in.
      //
      // **Three are granted here and four ride**, because the character creator
      // already gave her a starting pet, unstowed and paradeable from the first
      // frame (`grantFree`'s other caller). That is the better test rather than
      // an accident: an extra body means the chain is solved one link deeper
      // than `check:pet-slide`'s own three. If a starting pet ever *is* one of
      // these three, `catchWildPetOnce` reuses it and three ride — which is the
      // wanted behaviour, not a special case.
      if (stallId === 'ginormousSlideWithPets') {
        // `catchWildPetOnce`, because somebody will paste this link twice and
        // six animals would trail her. The store owns "already got one" — an
        // ownership test written here would be a second description of it.
        for (const id of ['pet.kitten', 'pet.bunny', 'pet.mouse']) {
          const spec = shopItem(id);
          if (spec) gameStore.catchWildPetOnce(spec);
        }
        return this.world.building.requestBoardSlide(false);
      }
      // Not a ride: the hotel's front door, for its deep link.
      if (stallId === 'hotelLobby') return this.world.hotel.requestEnterLobby();
      // Not a ride either: the keychain stall's picker, for its own deep
      // link — `KeychainShop.requestOpen`'s own doc comment names this as
      // its entry point, mirroring `hotelLobby` above.
      if (stallId === 'keychainStall') return this.world.keychainShop.requestOpen();
      // Not a ride either: a guest-floor bathroom, for its deep link (#281).
      // `hotelBathroom` keeps its original target (Floor 1, `BREAKFAST`) for
      // link stability; the other three reach the lobby's, garden's and
      // ocean floor's own rooms, now that each is a real room worth QA'ing
      // on its own rather than a nook that always looked the same shape.
      if (stallId === 'hotelBathroom') return this.world.hotel.requestEnterBathroom();
      if (stallId === 'hotelBathroomLobby') return this.world.hotel.requestEnterBathroom(LOBBY);
      if (stallId === 'hotelBathroomGarden') return this.world.hotel.requestEnterBathroom(GARDEN_FLOOR);
      if (stallId === 'hotelBathroomOcean') return this.world.hotel.requestEnterBathroom(OCEAN_FLOOR);
      // Not a ride either: the hotel's breakfast room, seated, for #276's
      // clipped action-chip-row deep link.
      if (stallId === 'hotelBreakfast') return this.world.hotel.requestEnterBreakfast();
      // Not a ride either: the guest suite, for its own deep link — see
      // `Hotel.requestEnterSuite`.
      if (stallId === 'hotelSuite') return this.world.hotel.requestEnterSuite();
      return false;
    };

    // The Rail Race's framing — the 3-2-1, the lap, the level choice and the
    // card at the end. `RailRace` raises moments and knows nothing about the
    // DOM; this is the only place the two meet, in the same idiom as
    // `onRideChange` above.
    //
    // The HUD is also the *touch controls on a phone*: `screenIsBusy()` hides
    // the normal on-screen buttons while a ride has hold of you, so without
    // this the race would have no control at all on the device it is most
    // likely played on. Two separate signals now, not one hold button — see
    // `RaceHud`'s own header for how its single pad tells a tap from a
    // drag-down-and-hold.
    this.world.railRace.takeTouchBoostPresses = () => this.raceHud.takeBoostPresses();
    this.world.railRace.touchDucking = () => this.raceHud.ducking;
    this.raceHud.onChooseLevel = (level) => this.world.railRace.chooseLevel(level);
    this.world.railRace.onRaceMoment = (moment) => {
      switch (moment.kind) {
        case 'start':
          // `setShown(true)` before `setRacers`: hiding is what disposes the
          // strip, so building it first would throw it away again.
          this.raceHud.setShown(true);
          this.raceHud.setRacers(moment.racers);
          break;
        case 'levelSelect':
          this.raceHud.setLevelSelect(moment.shown);
          break;
        case 'controls':
          this.raceHud.flashControlsTip();
          break;
        case 'standings':
          this.raceHud.setStandings(moment.order);
          break;
        case 'count':
          this.raceHud.setCount(moment.text);
          break;
        case 'lap':
          this.raceHud.setLap(`Lap ${moment.lap} of ${moment.of}`);
          break;
        case 'bonk':
          this.raceHud.flashBonk();
          break;
        case 'result':
          this.raceHud.setLap(null);
          this.raceHud.setBanner(moment.won ? 'won' : 'lost');
          break;
        case 'end':
          this.raceHud.setShown(false);
          break;
      }
    };

    // **On the bus from the very first frame drawn**, not eased towards it.
    // `player.position` is wherever she genuinely is by now — her seat, if the
    // cat bus is bringing her in (see the spawn block above) — and `snapTo`
    // skips the follow smoothing outright rather than shortening it, so there
    // is no opening pan across a park she has not arrived at yet.
    this.camera.snapTo(this.player.position);
    this.loop = new Loop((tick) => this.tick(tick));
  }

  /** Registers an extra per-frame system. Updated after the world, in order. */
  addSystem(system: GameSystem): void {
    this.systems.push(system);
  }

  /**
   * Every interactable in the park this frame, built once and shared.
   *
   * Three systems want this list now — tap-to-move, the action button and the
   * highlight system — and it is several hundred freshly-allocated zones,
   * because a couple of them move (the lift, the trampoline) and the flowers come
   * and go. Building it three times a frame was pure waste; the memo is keyed on
   * the frame counter, so everything inside one frame provably sees the same
   * list, and a tap arriving between frames sees the most recent one.
   */
  private currentZones(): readonly InteractZone[] {
    if (this.zoneCacheFrame !== this.frameContext.frame) {
      this.zoneCacheFrame = this.frameContext.frame;
      this.zoneCache = [
        ...this.world.interactZones(),
        ...this.treeClimbing.interactZones(),
      ];
    }
    return this.zoneCache;
  }

  /**
   * GitHub issue #309: a tap on `ui/ParkMap.ts` that landed on an attraction.
   *
   * Picks the zone the same way a 3D tap does — `world/interact.ts`'s
   * `pickInteractZone`, over the same `currentZones()` list the SELECTION
   * RULE itself reads — and hands it straight to `Selection.commitZone`,
   * which is the *existing* "walk there if far, run the action now if
   * close" machinery a chip commit already uses. Returns false for anything
   * that isn't a real, usable attraction (open ground, the castle's bare
   * facade, a sign) so `ParkMap` falls back to its own plain "walk here" —
   * this only ever narrows what the old flat refusal used to reject, never
   * widens what a tap can do.
   *
   * A zone with no `actions()` at all — the front door, the hotel's own
   * doorway — still counts as found: walking her to its `standX/standZ`
   * (the ordinary routed walk, same as any other tap-to-move) is the whole
   * of what "using" it means, because arriving is what fires the doorway's
   * own crossing trigger (`Building`/`Hotel`'s `checkDoorways`), not a chip.
   */
  private useZoneNear(x: number, y: number, z: number): boolean {
    const zone = pickInteractZone(this.currentZones(), x, y, z);
    if (!zone) return false;
    const actions = zone.actions?.() ?? [];
    const primary = actions.find((action) => action.id === PRIMARY_ACTION) ?? actions[0];
    if (primary) this.selection.commitZone(zone, primary);
    else this.tapNavigator.navigateTo(zone.standX, zone.y, zone.standZ);
    return true;
  }

  /**
   * True while an **attraction** has her — a ride posing the character, or a
   * curtain mini-game with the park frozen behind it. See `core/attraction.ts`
   * for why both terms are read back rather than set, and where the line
   * between a ride and a transition is drawn.
   *
   * Narrower than {@link uiOwnsTheScreen}, deliberately: that one also counts
   * the panels a child opened *from* the menu (a shop, the Cute-o-dex, the
   * what's-new card), and the menu button has no business vanishing because
   * somebody used it.
   */
  private attractionHasHer(): boolean {
    return attractionOwnsTheScreen({
      riding: this.player.riding,
      miniGameFrozen: this.miniGames.frozen,
    });
  }

  /**
   * True while a panel, a book, a ride or a mini-game owns the screen.
   *
   * One definition, shared by the action button, the sign reader and the
   * highlight system — three things that must agree about whether the park is
   * being played right now, and used to say it three times over.
   */
  private uiOwnsTheScreen(): boolean {
    return (
      this.shopping.uiOpen ||
      this.world.facePaintStall.uiOpen ||
      this.cuteODex.isOpen ||
      this.whatsNew.isOpen ||
      this.miniGames.frozen ||
      this.player.riding
    );
  }

  /**
   * True while ANYTHING is up over the park — a panel, the map, a stair menu,
   * a sign being read, or a plain pause.
   *
   * {@link uiOwnsTheScreen} plus the overlays that are not panels. This is the
   * predicate the highlight system has always used to switch the rainbow
   * outlines off; the touch controls now share it, because they did not, and
   * the family's photo showed the floating "hop" button sitting on top of the
   * what's-new panel's "OK, let's go!" button. `updateHud()` only hid the
   * cluster while riding, so every other overlay got a thumb-sized pink circle
   * dropped on its bottom-right corner — a button you cannot press, over a
   * button you need. Overlap is always a bug (GAME_DESIGN.md).
   */
  private screenIsBusy(): boolean {
    return (
      this.uiOwnsTheScreen() ||
      this.parkMap.isOpen ||
      gameStore.get().paused
    );
  }

  /**
   * True while dragging must **not** pan the park (#419) — and, because
   * `tick()` acts on it too, while any offset already out must be put away.
   *
   * "Normal gameplay (walking around)" was Jim's own framing of when this is
   * on, so this is that phrase written as a predicate, and everything in it is
   * a thing that has taken the camera or the screen away from ordinary play:
   *
   * - **`cameraOverride`** — a ride is drawing the frame through its own
   *   camera. That covers the slides, the train, the coaster, the rail race,
   *   the ferris wheel, the cat bus and the lift. The camera belongs to the
   *   ride; a pan under it would be a second camera nobody can see.
   * - **`player.riding` and `treeClimbing.playerClimbing`** as well as, not
   *   instead of, the above: `riding` is the broader truth (it is what #405
   *   hides the HUD on) and not every ride installs a `cameraOverride` — up a
   *   tree the park's own rig is still drawing, and dragging the view off her
   *   while she is stuck in a branch is not a thing to offer.
   * - **`miniGames.hidesPark`** and **`parkMap.isOpen`** — the same two guards
   *   `onPinch` above already carries, for the same reason it carries them: a
   *   window-level capture listener still sees fingers dragging on an overlay,
   *   and without this a swipe across the open map would silently drag the park
   *   underneath it, to be discovered the moment the map closed.
   * - **`screenIsBusy()`** — a panel, a sign, a pause. The park is not being
   *   walked around.
   *
   * The keychain rack's zoomed picker is deliberately *not* listed: it holds
   * the camera through `setFocusOverride`, and `IsoCamera.updateLook` already
   * zeroes the offset for the whole time any focus override is asserted, which
   * is the one place that can be true of a shot this file has never heard of.
   */
  private lookAroundBlocked(): boolean {
    return (
      this.cameraOverride !== null ||
      this.player.riding ||
      this.treeClimbing.playerClimbing ||
      this.miniGames.hidesPark ||
      this.parkMap.isOpen ||
      this.screenIsBusy()
    );
  }

  /**
   * {@link screenIsBusy}, minus riding.
   *
   * The one predicate the SELECTION RULE runs on. Riding is the exception it has
   * to make: on the train the park is still on screen, the platform is right
   * there, and the "Get off" chip is the only way off. Nothing else becomes
   * selectable by it — a zone has to say `selectableWhileRiding` for that.
   */
  private selectionBlocked(): boolean {
    return (
      this.shopping.uiOpen ||
      this.world.facePaintStall.uiOpen ||
      this.cuteODex.isOpen ||
      this.whatsNew.isOpen ||
      this.miniGames.frozen ||
      this.parkMap.isOpen ||
      gameStore.get().paused
    );
  }

  /**
   * What the building is allowed to do to the rest of the game.
   *
   * Every one of these is something the building genuinely needs and genuinely
   * does not own: the camera has to be *snapped* rather than followed when a
   * child changes space, and the iris has to be closed over it.
   *
   * It used to carry `walkTo`, `setTimeScale` and `setWhoosh` as well, for the
   * stair ride's 3.5x time-scaled walk with speed-lines. The stairs are gone
   * (#377) and so are all three — `Game` keeps `setTimeScale` for Decision 2's
   * queue skip, which owns it now.
   */
  private interiorControls(): InteriorControls {
    return {
      cancelWalk: () => this.tapNavigator.cancel(),
      iris: (midpoint) => this.transitions.irisWipe(midpoint),
      flash: () => this.transitions.flash(),
      snapCamera: () => this.camera.snapTo(this.player.position),
      // The building owns the shop geometry; `Shopping` owns the panel. This is
      // the one place the two meet — see `Shopping.openShopById`.
      openShop: (unitId) => this.shopping.openShopById(unitId),
    };
  }

  // `openStairMenu` and `takeStairs` stood here, with the Climb / Descend
  // menu they drove. The lift is the only way between floors now (#377), and
  // it has a control panel of its own that the family designed — see
  // GAME_DESIGN.md's "Riding the lift".

  /**
   * "Look" pill in the HUD menu (`Hud.ts`). Mounts `CharacterCreation`
   * straight over this running `Game` — the park, the save, the session all
   * stay exactly as they are; only `onComplete` (below, {@link
   * applyLiveLook}) does anything, and only to the player's own model and
   * name. This used to flush the save, set a same-tab flag and reload the
   * whole page back through `main.ts`'s `boot()`, because there was no way
   * to rebuild a live player model — see `Player.replaceModel`, which is
   * what closed that gap.
   */
  private reopenCharacterCreator(): void {
    // Belt and braces: `Hud.setLookAvailable` already hides the pill while she
    // is riding or climbing, so this should be unreachable — but the model
    // rebuild genuinely cannot be made safe in those states, and that is worth
    // more than one line of defence.
    if (this.player.riding || this.treeClimbing.playerClimbing) return;
    if (this.lookOpen) return;

    // The pause itself is not taken here. {@link syncLookPaused} re-derives it
    // from `lookOpen` every frame instead — see its doc comment for why a
    // one-shot toggle here was wrong.
    this.lookOpen = true;

    new CharacterCreation(this.uiRoot, {
      onComplete: (choice) => {
        try {
          this.applyLiveLook(choice);
        } finally {
          // Cleared last, so nothing in `applyLiveLook` runs against a park
          // that has already started moving again — but cleared *unfailingly*,
          // which is the point of the `finally`. `lookOpen` is the one
          // un-derived value the whole derivation hangs off: if it stayed true
          // because `applyLiveLook` threw, `syncLookPaused` would freeze the
          // park for ever and `tick`'s Escape branch — guarded on
          // `!this.lookOpen` — would leave no way to unfreeze it. The dialog
          // disposes itself either way, so there would not even be anything on
          // screen to explain why the park had stopped.
          this.lookOpen = false;
        }
      },
    });
  }

  /**
   * Keeps the park's pause a mirror of {@link lookOpen}, re-derived every
   * frame — see `core/overlayPause.ts`, which owns the reasoning and the one
   * bug that made it necessary. Escape is *also* excluded in {@link tick}, but
   * that is the courtesy; this is the fix.
   */
  private syncLookPaused(): void {
    this.lookPause.sync(this.lookOpen);
  }

  /**
   * What the "Look" pill's `CharacterCreation` overlay actually changes: the
   * store (name plus every cosmetic field, exactly as a fresh character
   * creation would), then the player's own model, name label, and every
   * system that reads the player's own anchors *live* rather than caching
   * them — see `WornHat.ts`'s doc comment on why they are built that way.
   * None of those need reconstructing, only telling that the ground moved:
   *
   * - `wornFlower`/`wornHat`/`wornJetpack`, `shopping`'s own
   *   `CarriedItem`/`EatenTreat` and `parade`'s own `BackpackPeek` all get
   *   `.rebind()` — the model swap already left each one's own bookkeeping
   *   pointing at a mesh that no longer exists, so each forgets it and
   *   redraws from the current fact (worn hat, carried item, whatever) onto
   *   wherever its anchor closure now resolves.
   * - the face-paint stall's overlay is keyed off `player.model` by identity,
   *   not an anchor, so simply calling `attachPlayer` again picks up the new
   *   one — see `FacePaintStall.attachPlayer`'s own doc comment.
   *
   * This list was found by grepping `src/` for everything that reads
   * `player.model.<anchor>` outside `Player` itself, and it is exhaustive.
   */
  private applyLiveLook(choice: CharacterCreationChoice): void {
    // Riding and climbing are checked *again* here, not only when the pill was
    // pressed: the two are separated by however long she spends choosing, and
    // "she was on her feet when this opened" is not the same claim as "she is
    // on her feet now". The park is frozen throughout (`syncLookPaused`) and
    // the pill is hidden in both states, so this should be unreachable — it is
    // here because the cost of being wrong is a model that a ride has already
    // written state onto, which is exactly the class of bug this whole change
    // set exists to close.
    //
    // Checked before `completeCharacterCreation` rather than after, so the
    // operation stays all-or-nothing: bailing later would leave the store
    // carrying a new look that the model on screen does not have.
    if (this.player.riding || this.treeClimbing.playerClimbing) return;

    gameStore.completeCharacterCreation(choice);
    const playerState = gameStore.get().player;

    this.player.replaceModel(playerState);
    this.player.label.setName(playerState.name);

    this.wornFlower.rebind();
    this.wornHat.rebind();
    this.wornJetpack.rebind();
    this.shopping.rebindPlayerModel();
    this.parade.rebindPlayerModel();
    this.world.facePaintStall.attachPlayer(this.player);
  }

  /**
   * Debug-only: drops a free camera at an arbitrary position/orientation and,
   * if asked, freezes the clock at a given time of day — without boarding a
   * ride, walking anywhere, or touching the player at all. See `/view` in
   * `main.ts`, the only caller; a URL a developer types, never a button a
   * child presses, same spirit as `RIDE_DEEP_LINKS`.
   *
   * Reuses the exact `cameraOverride` mechanism the ride cameras already use
   * (`render()` below picks it up automatically) rather than inventing a
   * second way to swap what's on screen.
   */
  enterDebugView(position: Vector3, lookAt: Vector3, timeOfDay?: number, space?: number): void {
    const camera = new PerspectiveCamera(50, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 500);
    camera.position.copy(position);
    camera.lookAt(lookAt);
    this.cameraOverride = camera;
    // `space=0..1` takes the sky past night towards space without needing a
    // ferris wheel to climb — the only way to look at that blend, and to get
    // the family's verdict on it, before the ride that drives it exists. Not
    // paired with `gameStore.setPaused` the way `timeOfDay` is: this is a look
    // override, not a clock, and freezing the park is `timeOfDay`'s business.
    if (space !== undefined) this.world.dayNight.setSpaceFactor(space);
    if (timeOfDay !== undefined) {
      this.world.dayNight.setTimeOfDay(timeOfDay);
      // Freezing the *whole park* via `gameStore`, not `dayNight.setPaused`
      // directly — `tick()` below re-derives `dayNight`'s own paused flag from
      // `gameStore.get().paused` every single frame (that's how the pause
      // menu freezes the clock along with everything else), so a one-off call
      // straight to `dayNight.setPaused(true)` is overwritten the very next
      // frame. Going through the store is also the *better* result here: it
      // zeroes `frameContext.dt` for everything, not just the sky, so a
      // requested moment stays a still photo — no NPC mid-stride, no wobbling
      // ride — exactly what a debug screenshot wants.
      gameStore.setPaused(true);
    }
  }

  /**
   * Debug-only: stands the **real player** at an arbitrary world point, ready
   * to walk. See `/spawn` in `main.ts`, the only caller.
   *
   * The deliberate difference from {@link enterDebugView} next door is that
   * nothing here is a camera trick. There is no `cameraOverride`, no pause and
   * no second scene object: this teleports the one `Player` the game already
   * has, so collision, interact zones, the parade, the HUD and every control
   * are live from the first frame — the question `/view` cannot answer is
   * *"does it feel right to stand here?"*, and only the actual character
   * standing there can.
   *
   * `y` omitted means "stand on whatever the ground is", sampled through
   * `Player`'s own sampler rather than a second copy of the terrain question.
   * Pass it only for somewhere the ground is not a function of the terrain — a
   * deck, a bridge, the castle.
   *
   * `facing` omitted turns her to look at the middle of the park, the same
   * spirit as `/view`'s `camDir` defaulting to looking back at the origin: a
   * hand-typed URL with no bearing in it should still open on the park rather
   * than on whatever happens to be behind her.
   *
   * **The camera is snapped, not eased.** Without this it opens on the
   * entrance (where the constructor put her) and glides across the park to
   * catch up — the exact opening-pan bug `world/entrance/arrivalSpawn.ts`
   * records, arrived at from the other direction.
   */
  enterDebugSpawn(x: number, z: number, y?: number, facing?: number): void {
    // A `rotation.y` of `t` sends local +Z to world `(sin t, cos t)`, so
    // looking at the origin from `(x, z)` is the bearing of `(-x, -z)`. At the
    // origin itself that degenerates (`atan2(0, 0)` is 0, i.e. an arbitrary
    // direction), so fall back to the bearing a fresh game starts on.
    const towardsCentre =
      x === 0 && z === 0 ? DEFAULT_SPAWN_FACING : Math.atan2(-x, -z);
    const yaw = facing ?? towardsCentre;
    if (y === undefined) this.player.teleport(x, z, yaw);
    else this.player.teleportTo(x, y, z, yaw);
    this.camera.snapTo(this.player.position);
  }

  /**
   * `/bridge` — stand her on a humpback railway bridge, whichever seed this
   * is. Issue #339.
   *
   * `/spawn?pos=x,z` can already do this if you happen to know a deck's
   * coordinates, and `/view` can look at one. Neither is any use for the
   * question actually being asked — *is there a bridge, and does it feel like
   * a bridge to walk over?* — because a bridge's coordinates are a function
   * of the seed, so the link has to be re-derived by hand for every park.
   * That cost is paid on every round of feedback, which is exactly what
   * CLAUDE.md's deep-link rule exists to stop.
   *
   * Picks the bridge **nearest the park entrance**, so the link is stable for
   * a given seed and lands on the one a player would meet first. Stands her on
   * the crown of the deck (`bridge.deckY` plus a whisker, so the first frame's
   * ground resolve settles her onto the deck rather than through it), facing
   * along the deck so both parapets and the track below are in shot.
   *
   * Returns false — and changes nothing — when this park built no bridges at
   * all, so the URL degrades to an ordinary spawn and says so, rather than
   * teleporting her to the origin and looking like the park is broken.
   */
  enterBridgeSpawn(): boolean {
    const bridges = this.world.train.bridges;
    if (bridges.length === 0) return false;
    const crossings = this.world.train.crossings;
    let best: { x: number; z: number; y: number; facing: number } | null = null;
    let bestDistance = Infinity;
    for (const crossing of crossings) {
      const bridge = bridges.find((candidate) => candidate.deckCovers(crossing.x, crossing.z));
      if (!bridge) continue;
      const distance = Math.hypot(crossing.x - ENTRANCE_GATE_X, crossing.z - ENTRANCE_GATE_Z);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = {
        x: crossing.x,
        z: crossing.z,
        // The deck's own height at this exact point, from the bridge itself —
        // never `deckY` restated, which is the crown of the hump and not
        // necessarily over the crossing's own centre.
        y: bridge.heightAt(crossing.x, crossing.z),
        // Along the deck, not across it: across it she would be looking at a
        // parapet from 30 cm away.
        facing: Math.atan2(crossing.pathDirX, crossing.pathDirZ),
      };
    }
    if (!best) return false;
    this.enterDebugSpawn(best.x, best.z, best.y, best.facing);
    return true;
  }

  /**
   * `/castle?deck=N` — inside the castle, on that storey, on the first frame.
   *
   * A thin forward to `Building.enterCastleSpawn`, which is where the
   * knowledge lives: being inside the castle is a *space*, not a coordinate,
   * so only the building can put her in one. See that method for why
   * `/spawn?pos=` cannot do this.
   */
  enterCastleSpawn(deck: number, at?: { readonly x: number; readonly z: number }): boolean {
    return this.world.building.enterCastleSpawn(deck, at);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.input.attach();
    this.pointer.attach();
    this.tapBurst.attach();
    this.saveSystem.start();
    this.loop.start();
  }

  stop(): void {
    this.started = false;
    this.loop.stop();
    this.input.detach();
    this.pointer.detach();
    this.tapBurst.detach();
    // Writes one last time on the way out, so a dev-console `game.stop()`
    // never loses the last few seconds either.
    this.saveSystem.flush();
    this.saveSystem.stop();
  }

  dispose(): void {
    this.stop();
    this.saveSystem.dispose();
    for (const system of this.systems) system.dispose?.();
    this.miniGames.dispose();
    this.tapNavigator.dispose();
    this.tapBurst.dispose();
    this.raceHud.dispose();
    this.screenControls.dispose();
    this.transitions.dispose();
    this.world.dispose();
    this.player.dispose();
    this.cuteODex.dispose();
    this.whatsNew.dispose();
    this.parkMap.dispose();
    this.hud.dispose();
    this.sky.dispose();
    this.engine.dispose();
  }

  // ------------------------------------------------------------------ frame

  private tick(tick: LoopTick): void {
    this.input.update();

    // Changing her look rebuilds the player's model in place, which a ride or
    // a climb is not prepared for — see `Hud.setLookAvailable`, which owns the
    // reasoning. Cheap enough to re-assert every frame; the setter itself
    // short-circuits when nothing changed.
    this.hud.setLookAvailable(!this.player.riding && !this.treeClimbing.playerClimbing);
    // "The menu button should only show during normal gameplay. It should hide
    // during attractions" (#404). Re-derived every frame from the ride's own
    // grip on the character rather than announced by each ride, so a ride
    // written next year cannot forget to give the button back — see
    // `core/attraction.ts`. The setter short-circuits when nothing changed.
    this.hud.setMenuAvailable(!this.attractionHasHer());
    // Re-derived every frame, like the shop's and the face-paint stall's.
    this.syncLookPaused();

    if (this.input.justPressed('debug')) gameStore.toggleDebugOverlay();
    // The what's-new welcome takes priority over everything else. It can only
    // ever be open in the first moment of a session — before a shop or the
    // Cute-o-dex could plausibly be open too — but checking it first keeps
    // that a guarantee rather than an accident. Esc, E/Enter or B on a pad all
    // say "got it" (E/Enter via `InteractRouter`); there is no key-handling in
    // `WhatsNew` itself, unlike
    // `CuteODex`, because none of its keys need anything beyond the ordinary
    // action vocabulary already read here.
    //
    // Below it: while a shop, the backpack or the stairs menu is open, Escape
    // belongs to it — see `Shopping.uiOpen`. And when the Cute-o-dex has the
    // screen, Escape belongs to the book. Otherwise Escape would close the
    // panel *and* pause the park behind it.
    if (this.whatsNew.isOpen) {
      // Esc and B here; E/Enter arrives a few lines later, through
      // `InteractRouter`'s first claim, because the interact key now has exactly
      // one reader in the whole game (issue #122).
      if (this.input.justPressed('menu') || this.input.justPressed('cancel')) {
        this.whatsNew.close();
      }
    } else if (this.cuteODex.isOpen) {
      // The book has the screen: Escape and B close it, and nothing else.
      if (this.input.justPressed('menu') || this.input.justPressed('cancel')) {
        this.cuteODex.close();
      }
    } else if (this.parkMap.isOpen) {
      // The map has the screen: Escape and B close it, same as every other
      // full-screen overlay. `M` is handled inside `ParkMap` itself.
      if (this.input.justPressed('menu') || this.input.justPressed('cancel')) {
        this.parkMap.close();
      }
    } else if (
      this.input.justPressed('menu') &&
      !this.shopping.uiOpen &&
      !this.world.facePaintStall.uiOpen &&
      // The keychain rack's zoomed view reads this same key to close itself
      // (`KeychainShop.update`, run later this frame via `world.update`) —
      // without this exclusion Escape would also pause the park behind it,
      // exactly the bug the two exclusions above this one already guard
      // against.
      !this.world.keychainShop.viewOpen &&
      // The look overlay owns the screen the same way those two do. Without
      // this, Escape — the one key anyone presses to back out of a modal —
      // toggled the pause of the park *behind* the open dialog. `lookOpen`
      // has no close path of its own, so Escape here is simply ignored;
      // `syncLookPaused` would put the pause back a frame later anyway, but
      // ignoring it outright means the park never flickers between the two.
      !this.lookOpen
    ) {
      gameStore.setPaused(!gameStore.get().paused);
    }

    // Mini-games run on the loop's real delta, not the frame context's: the
    // context's is about to be zeroed by the very freeze they ask for.
    this.miniGames.update(tick.dt);

    const paused = gameStore.get().paused || this.miniGames.frozen;
    this.world.dayNight.setPaused(paused);

    // Fast-forward is a *time* effect, not an animation one: scaling the frame
    // delta speeds the clock, the sky, the escalators, the walk cycle and the
    // stair ride all at once, and nothing downstream needs to know about it.
    // Pausing still runs `elapsed` at normal speed so idle animations keep
    // breathing behind the pause screen, exactly as they always have.
    const scaled = paused ? tick.dt : tick.dt * this.timeScale;
    this.elapsed += paused ? tick.dt : scaled;

    this.frameContext.dt = paused ? 0 : scaled;
    this.frameContext.elapsed = this.elapsed;
    this.frameContext.frame = tick.frame;

    // Between the input scan and the player, and it has to be exactly here:
    // `input.update()` has just overwritten the movement stick from the real
    // devices, and the navigator pushes it back on the character's behalf before
    // anybody reads it. Registered as an ordinary system it would be a frame
    // late — which, since the scan happens first, means never moving at all.
    if (!paused) this.tapNavigator.update(this.frameContext);

    if (!paused) this.player.update(this.frameContext);

    // **The arrival camera — the three beats Jim asked for.** Jim, 3 September
    // 2026: *"when the bus arrives at the park, the camera needs to face the
    // bus's doors as the children get off the bus, then follow your character
    // as they walk into the park and under the arch, and then once through the
    // arch the camera moves up to its usual pseudo-isometric perspective."*
    //
    // | beat | when | what happens |
    // |---|---|---|
    // | 1 doors | the bus is stopped and unloading | a low three-quarter shot facing the door, orbiting the bus's own drop point |
    // | 2 follow her in | she is walking the bezier | the yaw arcs home and the focus rides with her through the arch |
    // | 3 rise | across the hand-over | the tilt finishes lifting on to the rig's own pose |
    //
    // Every one of those decisions is `arrivalShot(elapsed)`, a pure function
    // of one number, for the reason `arrivalSpawn.ts` exists: `Game` builds a
    // real `WebGLRenderer` and cannot be constructed in a test, so a camera
    // decision made inline *here* is a camera decision no check can reach —
    // which is exactly how the last camera bug on this feature stayed green.
    // This block is wiring and nothing else.
    //
    // **It re-derives the whole camera state from the clock every frame**
    // rather than acting on an edge, which is the trap this file's own `/view`
    // note describes and the one CLAUDE.md records `dayNight.setPaused` dying
    // to: `tick()` re-derives the world every frame, so anything set once here
    // is silently overwritten by whatever runs next.
    //
    // The one thing re-derivation cannot excuse it from is #329 — writing a
    // *constant* to `setZoomTarget` every frame swallows every pinch and wheel
    // notch, because `nudgeZoom` writes the same field. That is why the zoom
    // below is written only while `ArrivalShot.ownsTheZoom` says so, and that
    // flag goes false at **`ARRIVAL_CONTROL_AT`** — the instant she gets the
    // controls, not the later `AT_SHOT_HOME` when the shot finally lands. The
    // two are `ARRIVAL_RISE_TAIL` apart, and the shot is still moving across
    // that gap: the tilt is deliberately still lifting under her hand. Writing
    // the zoom through it would eat her first pinch for those seconds, so it
    // stops at the earlier of the two. The pose has no such competitor — the
    // stick cannot fight it — and is simply driven to the end.
    // **One owner for the focus override, decided once a frame.**
    //
    // Two things in this method want the camera to orbit something other than
    // the player — the arrival's door beat and the keychain rack's zoomed
    // picker — and until now each wrote `IsoCamera`'s single override itself.
    // The rack's branch ends in an unconditional `clearFocusOverride()` for
    // "my picker is shut", which ran *after* the arrival's own write and threw
    // it away every single frame. Measured on the running game: through the
    // whole door beat the camera orbited the player at z 67.70 while
    // `doorFocus` sat at z 64.34, so the shot Jim watched was never the shot
    // the code describes. Nothing failed; there was simply a second writer.
    //
    // So both claim into this, and it is written to the camera exactly once,
    // below the two of them. A third claimant added later inherits the
    // arbitration instead of quietly winning it by being last.
    let focusClaim: Readonly<Vector3> | null = null;

    const arrival = this.world.entrance.arrival;
    const shot = arrival && !arrival.finished ? arrivalShot(arrival.elapsed, arrival.archPassAt) : null;
    if (arrival && shot && !this.arrivalCameraReleased) {
      // **Skippable, and it is the camera that yields, not the bus.** Touching
      // the stick hands the view straight back: the shot stops being driven,
      // so the pose damps home from wherever it had got to and the focus
      // returns to her — it reads as the game getting out of the way. The
      // sequence itself keeps running, because she is not standing anywhere
      // yet and "skipping" it would mean teleporting her, which is a worse
      // answer than a nine-second arrival. She is handed the controls at
      // `ARRIVAL_CONTROL_AT` either way, so this can shorten the watching but
      // can never strand her: there is no state here she can get stuck in and
      // no input that stops the clock.
      if (this.frameContext.input.manualMoveActive) {
        this.arrivalCameraReleased = true;
      } else {
        // Only while it is genuinely moving — see `ArrivalShot.ownsTheZoom`.
        // The shot outlives the zoom by `ARRIVAL_RISE_TAIL`, and writing a
        // constant into a field `nudgeZoom` shares is #329.
        if (shot.ownsTheZoom) this.camera.setZoomTarget(shot.zoom);
        this.camera.setShotOverride(shot.yawDegrees, shot.pitchDegrees, shot.distance);
        // The focus is *claimed* here, not written — see `focusClaim` below.
        if (shot.watchesTheDoor) focusClaim = arrival.doorFocus;
        this.arrivalCameraEngaged = true;
      }
    }
    if ((!shot || this.arrivalCameraReleased) && this.arrivalCameraEngaged) {
      // **The way out, for every way of leaving** — landed, skipped, finished
      // or disposed. Anything the shot had asserted would otherwise be
      // stranded on the camera for the rest of the session: a park seen for
      // ever from twelve degrees, orbiting a bus door that no longer exists.
      //
      // Clearing the pose override sets its target to `(0, 0, 0)`, which is
      // the rig's own pose *by construction* rather than a remembered copy of
      // it — so beat three lands exactly on the ordinary camera.
      //
      // **This runs exactly once**, because it clears the flag that let it
      // run — which is what makes writing the zoom here safe where writing it
      // every frame is #329. It is needed for the skip: a child who grabs the
      // stick two seconds in is halfway to the bus's wide framing, and without
      // this she would play the rest of the session zoomed out with nothing to
      // tell her why. On the ordinary landing it is a no-op, the shot having
      // already driven the zoom back to 1.
      this.arrivalCameraEngaged = false;
      this.camera.setZoomTarget(1);
      this.camera.clearPoseOverride();
    }

    // The keychain rack's zoomed picker (#331): the camera orbits the centre of
    // everything that must be in shot (`KeychainShop.viewFocus`) instead of the
    // player while `viewOpen`, at whatever zoom actually holds it
    // (`viewContent`, through `IsoCamera.zoomToFit`).
    //
    // This used to pass `KEYCHAIN_VIEW_ZOOM`, a constant tuned against a real
    // screenshot of the composed shot — of a desktop window, which is #418: on
    // a 390x844 phone in portrait the frame is less than half as wide and two
    // of the six keyrings sat outside it. Asking the camera each frame means
    // the answer is right on whatever viewport is actually there, and a child
    // rotating her phone reframes for free. Re-asserted every frame for the
    // same reason the arrival's zoom above is: see
    // `IsoCamera.setFocusOverride`'s own doc comment.
    const keychainShopOpen = this.world.keychainShop.viewOpen;
    if (keychainShopOpen && !this.keychainShopWasOpen) {
      this.zoomBeforeKeychainShop = this.camera.targetZoom;
    } else if (!keychainShopOpen && this.keychainShopWasOpen) {
      this.camera.setZoomTarget(this.zoomBeforeKeychainShop);
    }
    this.keychainShopWasOpen = keychainShopOpen;
    if (keychainShopOpen) {
      this.camera.setZoomTarget(this.world.keychainShop.viewZoom(this.camera));
      // **Claims, and wins.** A modal picker she has opened outranks a
      // cutscene: if both ever hold at once she is being asked to choose
      // between six keyrings and must be able to see them.
      focusClaim = this.world.keychainShop.viewFocus;
    }

    // The single write. Everything above only ever *claims*.
    if (focusClaim) this.camera.setFocusOverride(focusClaim);
    else this.camera.clearFocusOverride();

    // Drag-to-look-around's two per-frame duties (#419).
    //
    // The leash first: she may look anywhere she could *walk*, and no further.
    // `playBounds` is a single mutable that `Collision.setPlayBounds` swaps on
    // every change of space, so re-asserting it here — rather than handing the
    // camera a boundary once at construction — is what makes this correct in
    // the castle. Its floors are disjoint spaces hundreds of metres apart and
    // per-space visibility means a camera that leaves the floor she is on
    // renders empty sky; the boundary that is fitted while she is on that floor
    // is exactly the floor, so the void is unreachable without the camera
    // knowing anything about castles.
    this.camera.setLookBounds(this.world.collision.playBounds);
    // And then: a ride, a mini-game or a panel takes the view back at once,
    // rather than easing. `cancelLook` says why an ease would be wrong here.
    // Unconditional while blocked, deliberately, so a ride that starts
    // mid-drag cannot inherit an offset.
    if (this.lookAroundBlocked()) this.camera.cancelLook();

    this.camera.update(this.frameContext, this.player.position, this.player.velocity);
    // Straight after the camera moves and before the sky is drawn: the stars,
    // the moon and the sun all slide with the park so the night sky reads as a
    // place a long way off rather than as wallpaper stuck to the screen. Fed
    // from the isometric rig even while a ride's first-person camera has the
    // world, exactly as the sun's own screen bearing already is.
    this.sky.setParallax(
      this.camera.skyAnchor.x,
      this.camera.skyAnchor.y,
      this.camera.viewHalfHeight,
    );
    // And which camera is about to draw it, which is a different question:
    // parallax above is about where she is *standing* (and is deliberately fed
    // from the isometric rig even mid-ride), this is about where the view is
    // *pointing*. The park's own rig cannot turn, so this collapses to nothing
    // in ordinary play; a ride's first-person camera turns as she turns her
    // head, and without this the whole sky turned with it. See `Sky.setView`.
    this.sky.setView(skyViewFor(this.cameraOverride, this.camera.forward));
    this.world.update(this.frameContext);

    // Nothing between the world and the systems any more. There used to be a
    // line here taking the parade's pets off screen for the length of a hotel
    // nap, because the hotel put a *second* copy of each animal in its pet
    // beds; there is one body per pet now (`Hotel.sendPetsToBed` hands the
    // parade the bed and the parade's own member walks into it), so there is
    // nothing to hide and no second system with an opinion about whether a
    // pet is drawn. See `entities/parade/ParadeMember.ts`.
    for (const system of this.systems) system.update(this.frameContext);

    this.updateHud(tick);
    this.render();
  }

  private updateHud(tick: LoopTick): void {
    this.hud.setFps(tick.fps);
    this.hud.setGamepadConnected(this.input.gamepadConnected);
    // Nothing to hop while a slide has hold of you or while a panel is up, and
    // the buttons sit right where the view of the ride — or the panel's own OK
    // button — is. See {@link screenIsBusy}.
    this.screenControls.setVisible(!this.screenIsBusy());
    // The hop button re-skins itself into the fly button on exactly the same
    // question the take-off itself asks — a pack on her back and room here to
    // use it — so a control that looks like it will fly and a take-off that is
    // refused can never happen at once.
    this.screenControls.setJetpackAvailable(this.player.canFlyHere);
    this.hud.updateDebug([
      // The park clock lives here now rather than in a pill of its own: the
      // family had the clock removed from the HUD entirely (GAME_DESIGN.md,
      // "The top bar takes too much space"), but a grown-up debugging the
      // day/night cycle still wants to see it.
      `${this.world.dayNight.formatClock()} day ${gameStore.get().world.dayCount + 1}`,
      `x ${this.player.position.x.toFixed(1)} z ${this.player.position.z.toFixed(1)}`,
      `zoom ${this.camera.zoom.toFixed(2)}`,
      `night ${this.world.dayNight.nightFactor.toFixed(2)}`,
      `colliders ${this.world.collision.colliderCount}`,
    ]);
  }

  /**
   * When set, the world renders through this camera instead of the isometric
   * one — the first-person rides. The sky pass keeps the park's sky.
   */
  private cameraOverride: import('three').PerspectiveCamera | null = null;

  /**
   * Whether the arrival has written anything to the camera that still needs
   * taking back. Drives the `else` branch that unwinds the shot however the
   * arrival ends — finished, disposed, or skipped.
   */
  private arrivalCameraEngaged = false;

  /**
   * Set once she asks for the controls during the arrival; never unset, because
   * a shot she has already dismissed must not creep back on the next phase
   * change.
   */
  private arrivalCameraReleased = false;

  private render(): void {
    const renderer = this.engine.renderer;
    // The sky is a full-screen backdrop drawn first with depth testing off; the
    // depth buffer is then cleared so the world composites cleanly on top.
    renderer.clear(true, true, true);
    // A mini-game paints its own sky, so the park's passes are skipped entirely
    // while one is on screen — the frame costs no more than it would at home.
    if (!this.miniGames.hidesPark) {
      this.sky.render(renderer);
      renderer.clearDepth();
      const camera = this.cameraOverride ?? this.camera.camera;
      renderer.render(this.engine.scene, camera);
      // The ferris wheel's car, drawn a second time over the finished frame.
      // The camera is bolted inside it, so nothing outside it should ever be in
      // front — but the ride flies through twelve-metre cloud puffs, and while
      // one is passing, parts of it really are nearer than parts of the car.
      // The depth buffer is right and the picture is wrong. So the car is a
      // viewmodel: clear the depth and put it back on top, where it still sorts
      // correctly against itself. See `FerrisWheelRide.drawsCarInFront`.
      if (this.world.ferrisWheel.drawsCarInFront && this.cameraOverride) {
        renderer.clearDepth();
        this.cameraOverride.layers.set(VIEWMODEL_LAYER);
        renderer.render(this.engine.scene, this.cameraOverride);
        this.cameraOverride.layers.set(0);
      }
    }
    this.miniGames.render(renderer);
  }
}

/**
 * Internal mutable twin of {@link FrameContext}.
 *
 * The context object is allocated once and rewritten each frame — systems see
 * it as fully readonly, which stops anyone stashing and mutating it.
 */
/**
 * Where a continued game puts her, from the save file's space id plus local
 * offset (`world/spaces.ts`).
 *
 * Two things send her back to the default spawn instead, and both are
 * deliberate rather than defensive:
 *
 * 1. **The space no longer exists.** ARCHITECTURE-DECISIONS Decision 3 turns
 *    `castle` into five per-floor spaces; a save written before that names a
 *    place tomorrow's build has never heard of. `localToWorld` says so by
 *    returning `null`, and everything *else* in the save still loads — her
 *    character, her hat, her whole Cute-o-dex. Losing the exact spot she was
 *    standing in is a shrug; losing the park is not.
 * 2. **She was indoors.** Being inside the building is not just a coordinate:
 *    `Building` has to have swapped its interior on, moved the play bounds and
 *    snapped the camera, and none of that has happened at construction time.
 *    Rather than reproduce the door-transition sequence at boot — untestable
 *    without the browser, and about to be rewritten wholesale by Decision 3's
 *    portal system — a continued game starts back out on the plaza, which is
 *    somewhere a six-year-old always recognises. The indoor position is still
 *    *written* to the save, so restoring into a space is a small addition the
 *    day `SpaceManager` exists.
 */
function resolveSpawn(place: SavedPlace | undefined): Vector3 {
  if (!place) return DEFAULT_SPAWN;
  // Hotel rooms restore IN PLACE — they are true disjoint spaces with their
  // own origins, so "being there" is a position plus one adoption call
  // (`Hotel.adoptRestoredPlayer`), unlike the castle's stacked decks, whose
  // restore stays deliberately deferred to Decision 3 (see below).
  if (place.space !== SPACE_GARDEN && !place.space.startsWith('hotel.')) return DEFAULT_SPAWN;
  const world = localToWorld(place.space, place.x, place.y, place.z);
  if (!world) return DEFAULT_SPAWN;
  return new Vector3(world.x, world.y, world.z);
}

interface MutableFrameContext {
  dt: number;
  elapsed: number;
  frame: number;
  readonly input: InputSystem;
  readonly playerPosition: Vector3;
  readonly cameraForward: Readonly<Vector3>;
}
