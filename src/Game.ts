import { PerspectiveCamera, Vector3 } from 'three';
import { Engine } from './core/Engine';
import { Loop, type LoopTick } from './core/Loop';
import { IsoCamera } from './core/IsoCamera';
import { InputSystem, PointerControls } from './core/input';
import { isTouchDevice } from './core/device';
import {
  BUILDING_FLOOR_COUNT,
  CAMERA_ZOOM_STEP,
  PLAYER_LONGEST_STEP,
  PLAYER_RADIUS,
  VIEWMODEL_LAYER,
} from './core/constants';
import type { FrameContext, GameSystem } from './core/types';
import { FoliageFade, Sky, TreeClimbing, World, skyViewFor, type WorldOptions } from './world';
import { ENTRANCE_ANGLE, ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z } from './world/entrance/layout';
import { Highlights } from './world/Highlights';
import { Selection } from './world/Selection';
import type { InteractZone } from './world/interact';
import { InteractRouter, type InteractClaim } from './world/InteractRouter';
import type { InteriorControls } from './world/building';
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
import { StairMenu, type StairDirection } from './ui/StairMenu';
import { Transitions } from './ui/Transitions';
import { playOpenChime } from './ui/chime';
import { MiniGameHost } from './minigames';
import { createRideHud, type RideHud } from './minigames/ferrisWheel/hud';
import { Shopping } from './Shopping';
import { SaveSystem } from './SaveSystem';
import { gameStore, type CharacterCreationChoice } from './state';
import type { SavedPlace } from './state/save';
import { localToWorld, SPACE_GARDEN } from './world/spaces';
import { OverlayPause } from './core/overlayPause';

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
  readonly stairMenu: StairMenu;
  readonly liftPanel: LiftPanel;
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
  private stairMenuDeck = 0;
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
  /** Every sign in the park, as a selectable zone. Built once: signs do not move. */

  constructor(
    canvas: HTMLCanvasElement,
    // Kept as a field (not just a constructor-local) for `applyLiveLook`,
    // which needs somewhere to mount the "Look" pill's `CharacterCreation`
    // overlay long after the constructor has returned.
    private readonly uiRoot: HTMLElement,
    options: GameOptions = {},
  ) {
    this.engine = new Engine(canvas);
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
    // decks, stairs, lift and bubble are all walkable.
    this.world.attachPlayer(this.player);
    // `Player`'s constructor samples the terrain for its own height, which is
    // right for a fresh spawn and wrong for a restored one — she may have been
    // standing on a bridge, a deck or the fountain rim. Now that the building's
    // ground sampler is attached, put her back exactly where she was, facing
    // the way she was facing.
    if (spawn !== DEFAULT_SPAWN && options.startPlace) {
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
    // shape. No `onWornChange`: a charm displaces nothing, so unlike the jet
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

    this.navGrid = new NavGrid(this.world.collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT);

    // Tap-to-move. Built after the world so it can ask the building where its
    // tap targets are, and after the player so it can borrow the ground sampler
    // the building installed. `treeClimbing` is constructed further down (it
    // needs the HUD), but this closure only reads it once play starts, by
    // which point construction has finished.
    this.tapNavigator = new TapNavigator(this.player, this.camera, this.input, this.navGrid);
    this.engine.scene.add(this.tapNavigator.group);

    this.pointer = new PointerControls(canvas, {
      onTap: (point) => {
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
      onPinch: (delta) => this.camera.nudgeZoom(delta * CAMERA_ZOOM_STEP * 6),
      // The wheel is the mouse equivalent of pinch (issue #242): same call,
      // same clamp, same damping — `nudgeZoom` is the one and only owner of
      // "how far you may zoom" and neither gesture may restate it. One notch
      // is defined as one keyboard `+`/`-` press's worth of zoom.
      //
      // Guarded on `cameraOverride` (unlike `onPinch`, which needs no such
      // guard: a pinch takes a finger actually resting on the glass, so it
      // essentially never fires while a ride has taken the camera over, and
      // touch has no scroll-wheel equivalent riding could fight anyway). A
      // mouse wheel sits right under a hand that is otherwise idle while
      // enjoying a ride, so without this a stray notch would fight the ride's
      // own camera the moment it next let go — the camera on screen wouldn't
      // visibly jump (the ride renders through `cameraOverride`, not
      // `this.camera.camera`), but `zoomTarget` would have drifted underneath
      // it for when the ride hands the camera back.
      onWheelZoom: (notches) => {
        if (this.cameraOverride) return;
        this.camera.nudgeZoom(notches * CAMERA_ZOOM_STEP);
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
      blocked: () => this.miniGames.frozen || this.player.riding,
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
    this.stairMenu = new StairMenu(uiRoot, {
      onChoose: (direction) => this.takeStairs(direction),
      onClose: () => undefined,
    });


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
        this.parkMap.isOpen ||
        this.stairMenu.isOpen,
    );
    this.addSystem(this.liftPanel);

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
      this.sky.setAspect(width / Math.max(1, height));
    });
    this.world.train.rideView?.resize(window.innerWidth, window.innerHeight);
    // The slide's two cameras, fitted once at boot as well as on every resize.
    // Its **trackside** camera is built in `Building`'s constructor rather than
    // on boarding, so on a window that never resizes it would otherwise render
    // the whole ride at the 1:1 aspect it was constructed with.
    this.world.building.resizeRideCameras(window.innerWidth, window.innerHeight);

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
   * because a couple of them move (the lift, the bubble) and the flowers come
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
      this.stairMenu.isOpen ||
      gameStore.get().paused
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
      this.stairMenu.isOpen ||
      gameStore.get().paused
    );
  }

  /**
   * What the building is allowed to do to the rest of the game.
   *
   * Every one of these is something the building genuinely needs and genuinely
   * does not own: the camera has to be *snapped* rather than followed when a
   * child changes space, the clock has to run fast while the stairs carry them,
   * and the iris has to be closed over both.
   */
  private interiorControls(): InteriorControls {
    return {
      walkTo: (x, y, z, handlers) => this.tapNavigator.navigateTo(x, y, z, handlers),
      cancelWalk: () => this.tapNavigator.cancel(),
      setTimeScale: (scale) => {
        this.timeScale = scale;
      },
      setWhoosh: (on) => this.transitions.setWhoosh(on),
      iris: (midpoint) => this.transitions.irisWipe(midpoint),
      flash: () => this.transitions.flash(),
      snapCamera: () => this.camera.snapTo(this.player.position),
      openStairMenu: (deck) => this.openStairMenu(deck),
      // The building owns the shop geometry; `Shopping` owns the panel. This is
      // the one place the two meet — see `Shopping.openShopById`.
      openShop: (unitId) => this.shopping.openShopById(unitId),
      closeStairMenu: () => this.stairMenu.close(),
    };
  }

  private openStairMenu(deck: number): void {
    if (this.stairMenu.isOpen || this.player.riding) return;
    this.stairMenuDeck = deck;
    playOpenChime();
    const canClimb = deck < BUILDING_FLOOR_COUNT - 1;
    const canDescend = deck > 0;
    this.stairMenu.show({
      floorLabel: floorName(deck),
      canClimb,
      canDescend,
      // A greyed-out button that still names a floor reads as a bug. Say where
      // it goes only when it goes anywhere.
      upLabel: canClimb ? `up to ${floorName(deck + 1).toLowerCase()}` : 'this is the top!',
      downLabel: canDescend ? `down to ${floorName(deck - 1).toLowerCase()}` : 'you are at the bottom',
    });
  }

  private takeStairs(direction: StairDirection): void {
    this.world.building.takeStairs(this.stairMenuDeck, direction);
  }

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
    this.stairMenu.dispose();
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
    } else if (this.stairMenu.isOpen) {
      // The stairs menu has the screen: Escape backs out without choosing.
      if (this.input.justPressed('menu')) {
        this.stairMenu.close();
      }
    } else if (
      this.input.justPressed('menu') &&
      !this.shopping.uiOpen &&
      !this.world.facePaintStall.uiOpen &&
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
  if (!place || place.space !== SPACE_GARDEN) return DEFAULT_SPAWN;
  const world = localToWorld(place.space, place.x, place.y, place.z);
  if (!world) return DEFAULT_SPAWN;
  return new Vector3(world.x, world.y, world.z);
}

/** What to call each level, for the stairs menu. */
function floorName(deck: number): string {
  if (deck <= 0) return 'Ground floor';
  if (deck >= BUILDING_FLOOR_COUNT - 1) return 'The roof';
  return `Floor ${deck}`;
}

interface MutableFrameContext {
  dt: number;
  elapsed: number;
  frame: number;
  readonly input: InputSystem;
  readonly playerPosition: Vector3;
  readonly cameraForward: Readonly<Vector3>;
}
