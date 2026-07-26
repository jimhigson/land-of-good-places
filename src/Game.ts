import { Vector3 } from 'three';
import { Engine } from './core/Engine';
import { Loop, type LoopTick } from './core/Loop';
import { IsoCamera } from './core/IsoCamera';
import { InputSystem, PointerControls } from './core/input';
import { isTouchDevice } from './core/device';
import { BUILDING_FLOOR_COUNT, CAMERA_ZOOM_STEP } from './core/constants';
import type { FrameContext, GameSystem } from './core/types';
import { Sky, World } from './world';
import type { InteriorControls } from './world/building';
import { Player, TapNavigator } from './entities';
import { Hud, TouchControls } from './ui';
import { StairMenu, type StairDirection } from './ui/StairMenu';
import { Transitions } from './ui/Transitions';
import { playOpenChime } from './ui/chime';
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
  readonly shopping: Shopping;
  readonly transitions: Transitions;
  readonly stairMenu: StairMenu;

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
    // called from a frame, long after everything below is built.
    this.world = new World(this.engine.scene, this.sky, this.interiorControls());

    // Spawn on the plaza, just south of the fountain, looking at the park.
    this.player = new Player(this.world.collision, this.camera, new Vector3(0, 0, 7));
    this.engine.scene.add(this.player.group);
    // The building owns "how high is the ground?" from here on, so that its
    // decks, stairs, lift and bubble are all walkable.
    this.world.attachPlayer(this.player);

    // Tap-to-move. Built after the world so it can ask the building where its
    // tap targets are, and after the player so it can borrow the ground sampler
    // the building installed.
    this.tapNavigator = new TapNavigator(this.player, this.camera, this.input, () =>
      this.world.interactZones(),
    );
    this.engine.scene.add(this.tapNavigator.group);

    this.pointer = new PointerControls(canvas, {
      onTap: (point) => this.tapNavigator.handleTap(point),
      // Pinching is the touch equivalent of the +/- keys, expressed in the same
      // units, so it lands in the camera's existing clamped zoom target.
      onPinch: (delta) => this.camera.nudgeZoom(delta * CAMERA_ZOOM_STEP * 6),
    });

    // The HUD clears the overlay when it is built, so everything else that puts
    // DOM in there has to come after it.
    this.hud = new Hud(uiRoot);
    this.touchControls = isTouchDevice() ? new TouchControls(uiRoot, this.input) : null;
    this.transitions = new Transitions(uiRoot);
    this.stairMenu = new StairMenu(uiRoot, {
      onChoose: (direction) => this.takeStairs(direction),
      onClose: () => undefined,
    });

    // Shops: the join between the shop geometry, the purchase panel and the
    // store. Registered as a system so it updates after the world, which is
    // where the player's position for this frame has just been settled.
    this.shopping = new Shopping(uiRoot, this.player, this.world, this.hud);
    this.addSystem(this.shopping);

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
    this.stairMenu.show({
      floorLabel: floorName(deck),
      canClimb: deck < BUILDING_FLOOR_COUNT - 1,
      canDescend: deck > 0,
      upLabel: `up to ${floorName(deck + 1).toLowerCase()}`,
      downLabel: `down to ${floorName(deck - 1).toLowerCase()}`,
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
    this.tapNavigator.dispose();
    this.touchControls?.dispose();
    this.stairMenu.dispose();
    this.transitions.dispose();
    this.world.dispose();
    this.player.dispose();
    this.hud.dispose();
    this.sky.dispose();
    this.engine.dispose();
  }

  // ------------------------------------------------------------------ frame

  private tick(tick: LoopTick): void {
    this.input.update();

    if (this.input.justPressed('debug')) gameStore.toggleDebugOverlay();
    // While a shop, the backpack or the stairs menu is open, Escape belongs to
    // it — see `Shopping.uiOpen`. Otherwise Escape would close the panel *and*
    // pause the park behind it.
    if (this.input.justPressed('menu')) {
      if (this.stairMenu.isOpen) this.stairMenu.close();
      else if (!this.shopping.uiOpen) gameStore.setPaused(!gameStore.get().paused);
    }

    const paused = gameStore.get().paused;
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
    this.sky.render(renderer);
    renderer.clearDepth();
    renderer.render(this.engine.scene, this.camera.camera);
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
