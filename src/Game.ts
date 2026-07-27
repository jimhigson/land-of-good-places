import { Vector3 } from 'three';
import { Engine } from './core/Engine';
import { Loop, type LoopTick } from './core/Loop';
import { IsoCamera } from './core/IsoCamera';
import { InputSystem, PointerControls } from './core/input';
import { isTouchDevice } from './core/device';
import { BUILDING_FLOOR_COUNT, CAMERA_ZOOM_STEP } from './core/constants';
import type { FrameContext, GameSystem } from './core/types';
import { FoliageFade, Sky, TreeClimbing, World } from './world';
import type { InteriorControls } from './world/building';
import { HeldBalloons, Parade, Player, TapNavigator, WornFlower, WornHat } from './entities';
import { CuteODex, Hud, TouchControls, WhatsNew } from './ui';
import { ActionButton } from './ui/ActionButton';
import { ParkMap } from './ui/ParkMap';
import { SignReader } from './ui/SignReader';
import { StairMenu, type StairDirection } from './ui/StairMenu';
import { Transitions } from './ui/Transitions';
import { playOpenChime } from './ui/chime';
import { MiniGameHost } from './minigames';
import { Shopping } from './Shopping';
import { gameStore } from './state';

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
  readonly tapNavigator: TapNavigator;
  readonly pointer: PointerControls;
  readonly touchControls: TouchControls | null;
  readonly miniGames: MiniGameHost;
  readonly shopping: Shopping;
  readonly treeClimbing: TreeClimbing;
  readonly foliageFade: FoliageFade;
  readonly signReader: SignReader;
  readonly actionButton: ActionButton;
  readonly transitions: Transitions;
  readonly stairMenu: StairMenu;
  readonly parade: Parade;
  readonly wornFlower: WornFlower;
  readonly wornHat: WornHat;
  readonly heldBalloons: HeldBalloons;
  readonly cuteODex: CuteODex;
  readonly whatsNew: WhatsNew;
  readonly parkMap: ParkMap;

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

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.engine = new Engine(canvas);
    this.camera = new IsoCamera();
    this.input = new InputSystem();
    this.sky = new Sky();

    // The building needs a way to move the camera, the clock and the screen
    // wipe when a child walks through its front door into its own space. It is
    // handed one rather than reaching up in here; the closures are only ever
    // called from a frame, long after everything below is built. The camera
    // goes in too: NPC name labels are screen-space, so the crowd needs it.
    this.world = new World(this.engine.scene, this.sky, this.interiorControls(), this.camera);

    // Spawn on the plaza, just south of the fountain, looking at the park.
    this.player = new Player(this.world.collision, this.camera, new Vector3(0, 0, 7));
    this.engine.scene.add(this.player.group);
    // The building owns "how high is the ground?" from here on, so that its
    // decks, stairs, lift and bubble are all walkable.
    this.world.attachPlayer(this.player);

    // Whatever flower is currently worn in the hair (see `world/Flowers.ts` /
    // `entities/WornFlower.ts`). A store subscriber like `CarriedItem`, so it
    // needs nothing from the rest of this constructor beyond the anchor.
    this.wornFlower = new WornFlower(this.player.model.hairAnchor);
    this.addSystem(this.wornFlower);

    // The hat chosen (or granted free) in the character creator — see
    // `entities/WornHat.ts`. Same store-subscriber shape as `wornFlower`
    // above, parented to the head instead of the hairline.
    this.wornHat = new WornHat(this.player.model.hatAnchor);
    this.addSystem(this.wornHat);
    // So the name label can size itself off whatever hat is actually worn —
    // see `Player.labelTopHeight`.
    this.player.wornHat = this.wornHat;

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

    // Tap-to-move. Built after the world so it can ask the building where its
    // tap targets are, and after the player so it can borrow the ground sampler
    // the building installed. `treeClimbing` is constructed further down (it
    // needs the HUD), but this closure only reads it once play starts, by
    // which point construction has finished.
    this.tapNavigator = new TapNavigator(this.player, this.camera, this.input, () => [
      ...this.world.interactZones(),
      ...this.treeClimbing.interactZones(),
    ]);
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
        // Tapping a sign is deliberately NOT handled here any more — it used
        // to swoop the camera in to read it, which fired by accident and was
        // jarring (family complaint, 26 Jul 2026; see `ui/SignReader.ts`).
        // A tap near a sign now just walks there like any other patch of
        // ground; reading one is a proximity+facing gate and a button.
        if (this.parade.handleTap(point)) return;
        this.tapNavigator.handleTap(point);
      },
      // Pinching is the touch equivalent of the +/- keys, expressed in the same
      // units, so it lands in the camera's existing clamped zoom target.
      onPinch: (delta) => this.camera.nudgeZoom(delta * CAMERA_ZOOM_STEP * 6),
    });

    // The HUD clears the overlay when it is built, so everything else that puts
    // DOM in there has to come after it.
    this.hud = new Hud(uiRoot);
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
    this.touchControls = isTouchDevice() ? new TouchControls(uiRoot, this.input) : null;
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

    // "Do the thing" at whatever ride, shop, stall or traversal device the
    // player is standing next to — see `ui/ActionButton.ts`. Same zone list
    // `tapNavigator` walks, plus tree-climbing's, rebuilt fresh every frame
    // because a couple of them move (the lift, the bubble).
    this.actionButton = new ActionButton(
      uiRoot,
      this.player,
      () => [...this.world.interactZones(), ...this.treeClimbing.interactZones()],
      this.input,
      () =>
        this.shopping.uiOpen ||
        this.cuteODex.isOpen ||
        this.whatsNew.isOpen ||
        this.miniGames.frozen ||
        this.player.riding,
    );
    this.addSystem(this.actionButton);

    // Fades out any tree standing between the camera and the player — the
    // fixed camera (design feedback #16) means one can now hide them
    // completely for as long as they stand there. See `world/FoliageFade.ts`.
    this.foliageFade = new FoliageFade(this.world.scenery, this.camera);
    this.engine.scene.add(this.foliageFade.group);
    this.addSystem(this.foliageFade);
    // "Read" a sign: a HUD button when close and facing one, a full-screen
    // overlay of its own painted face when pressed — see `ui/SignReader.ts`.
    // Signs never move once the world has finished building, so its zone list
    // is captured once here rather than walked afresh every frame.
    //
    // Precedence: an interactable you can act on beats a sign you can read,
    // since the sign is passive — folded in here as one more reason the sign
    // pill stays hidden, rather than by teaching `SignReader` anything about
    // action zones.
    this.signReader = new SignReader(uiRoot, this.player, this.world.signZones(), () =>
      this.shopping.uiOpen ||
      this.cuteODex.isOpen ||
      this.whatsNew.isOpen ||
      this.parkMap.isOpen ||
      this.miniGames.frozen ||
      this.player.riding ||
      this.actionButton.active,
    );
    this.addSystem(this.signReader);

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
      this.sky.setAspect(width / Math.max(1, height));
    });

    this.camera.snapTo(this.player.position);
    this.loop = new Loop((tick) => this.tick(tick));
  }

  /** Registers an extra per-frame system. Updated after the world, in order. */
  addSystem(system: GameSystem): void {
    this.systems.push(system);
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

  start(): void {
    if (this.started) return;
    this.started = true;
    this.input.attach();
    this.pointer.attach();
    this.loop.start();
  }

  stop(): void {
    this.started = false;
    this.loop.stop();
    this.input.detach();
    this.pointer.detach();
  }

  dispose(): void {
    this.stop();
    for (const system of this.systems) system.dispose?.();
    this.miniGames.dispose();
    this.tapNavigator.dispose();
    this.touchControls?.dispose();
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

    if (this.input.justPressed('debug')) gameStore.toggleDebugOverlay();
    // The what's-new welcome takes priority over everything else. It can only
    // ever be open in the first moment of a session — before a shop or the
    // Cute-o-dex could plausibly be open too — but checking it first keeps
    // that a guarantee rather than an accident. Esc, E/Enter or B on a pad all
    // say "got it"; there is no key-handling in `WhatsNew` itself, unlike
    // `CuteODex`, because none of its keys need anything beyond the ordinary
    // action vocabulary already read here.
    //
    // Below it: while a shop, the backpack or the stairs menu is open, Escape
    // belongs to it — see `Shopping.uiOpen`. Same for a sign that is open
    // full-screen: Escape is one of the ordinary "back out" actions
    // `SignReader` already closes on. And when the Cute-o-dex has the screen,
    // Escape belongs to the book. Otherwise Escape would close the panel
    // *and* pause the park behind it.
    if (this.whatsNew.isOpen) {
      if (
        this.input.justPressed('menu') ||
        this.input.justPressed('cancel') ||
        this.input.justPressed('interact')
      ) {
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
      !this.signReader.active
    ) {
      gameStore.setPaused(!gameStore.get().paused);
    }

    // Mini-games run on the loop's real delta, not the frame context's: the
    // context's is about to be zeroed by the very freeze they ask for.
    this.miniGames.update(tick.dt, this.frameContext);

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
    this.world.update(this.frameContext);

    for (const system of this.systems) system.update(this.frameContext);

    this.updateHud(tick);
    this.render();
  }

  private updateHud(tick: LoopTick): void {
    this.hud.setClock(this.world.dayNight.formatClock(), gameStore.get().world.dayCount);
    this.hud.setFps(tick.fps);
    this.hud.setGamepadConnected(this.input.gamepadConnected);
    // Nothing to hop or turn while a slide has hold of you, and the buttons sit
    // right where the view of the ride is.
    this.touchControls?.setVisible(!this.player.riding);
    this.hud.updateDebug([
      `x ${this.player.position.x.toFixed(1)} z ${this.player.position.z.toFixed(1)}`,
      `zoom ${this.camera.zoom.toFixed(2)}`,
      `night ${this.world.dayNight.nightFactor.toFixed(2)}`,
      `colliders ${this.world.collision.colliderCount}`,
    ]);
  }

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
      renderer.render(this.engine.scene, this.camera.camera);
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
