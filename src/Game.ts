import { Vector3 } from 'three';
import { Engine } from './core/Engine';
import { Loop, type LoopTick } from './core/Loop';
import { IsoCamera } from './core/IsoCamera';
import { InputSystem } from './core/input';
import type { FrameContext, GameSystem } from './core/types';
import { Sky, World } from './world';
import { Player } from './entities';
import { Hud } from './ui';
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

  private readonly loop: Loop;
  private readonly systems: GameSystem[] = [];
  private readonly frameContext: MutableFrameContext;
  private started = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.engine = new Engine(canvas);
    this.camera = new IsoCamera();
    this.input = new InputSystem();
    this.sky = new Sky();

    this.world = new World(this.engine.scene, this.sky);

    // Spawn on the plaza, just south of the fountain, looking at the park.
    this.player = new Player(this.world.collision, this.camera, new Vector3(0, 0, 7));
    this.engine.scene.add(this.player.group);
    // The building owns "how high is the ground?" from here on, so that its
    // decks, stairs, lift and bubble are all walkable.
    this.world.attachPlayer(this.player);

    this.hud = new Hud(uiRoot);

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

  start(): void {
    if (this.started) return;
    this.started = true;
    this.input.attach();
    this.loop.start();
  }

  stop(): void {
    this.started = false;
    this.loop.stop();
    this.input.detach();
  }

  dispose(): void {
    this.stop();
    for (const system of this.systems) system.dispose?.();
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
    if (this.input.justPressed('menu')) gameStore.setPaused(!gameStore.get().paused);

    const paused = gameStore.get().paused;
    this.world.dayNight.setPaused(paused);

    this.frameContext.dt = paused ? 0 : tick.dt;
    this.frameContext.elapsed = tick.elapsed;
    this.frameContext.frame = tick.frame;

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
interface MutableFrameContext {
  dt: number;
  elapsed: number;
  frame: number;
  readonly input: InputSystem;
  readonly playerPosition: Vector3;
  readonly cameraForward: Readonly<Vector3>;
}
