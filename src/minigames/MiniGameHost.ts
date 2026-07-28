import type { WebGLRenderer } from 'three';
import type { Engine } from '../core/Engine';
import type { InputSystem } from '../core/input';
import type { FrameContext } from '../core/types';
import { PALETTE } from '../core/palette';
import { Transition } from './Transition';
import { MiniGameOverlay } from './overlay';
import type { StallInstance } from './stalls';
import type { MiniGame, MiniGameInput, MiniGameResult } from './types';

/**
 * The thing that runs mini-games.
 *
 * Walk up to a stall, press E (or tap it — tap-to-move walks there and fires
 * the same action on arrival) and the fairground curtain closes over the park,
 * a little self-contained world is built behind it, and the curtain opens again
 * on the game. Coming back is the same journey in reverse.
 *
 * Two decisions shape the whole design:
 *
 * **The park is frozen, not torn down.** While a game is on, `Game.tick` treats
 * the park exactly as it treats the pause menu: no player update, no world
 * update, dt of zero. Nothing is disposed and nothing moves, so coming back is
 * free and Eleri is standing precisely where she left off — which matters,
 * because the stall she walked to is right in front of her.
 *
 * **The renderer keeps running.** The loop, the input scan and the frame never
 * stop; only the park's *update* is suspended. That is what lets the wipe cross
 * from one world to the other in a single continuous frame sequence, and it is
 * why the mini-game gets the loop's real `dt` rather than the frozen park's
 * zero.
 */

/** How close you have to be standing to open a stall, in metres. */
const REACH = 3.4;

type Phase =
  /** Park is running, nothing to do. */
  | 'idle'
  /** Curtain closing over the park. */
  | 'in'
  /** The mini-game is on screen and being updated. */
  | 'play'
  /** Curtain closing over the mini-game (which is still animating behind it). */
  | 'out'
  /** Curtain opening over the park again; the park is already live. */
  | 'back';

export interface MiniGameHostOptions {
  readonly engine: Engine;
  readonly input: InputSystem;
  /** Where the mini-game's DOM layer is appended. The park's `#ui-root`. */
  readonly uiRoot: HTMLElement;
  readonly stalls: readonly StallInstance[];
  /** True on a phone or tablet — changes the on-screen prompts. */
  readonly touch: boolean;
  /** Called when a game closes, with what happened. */
  readonly onResult?: (result: MiniGameResult) => void;
}

export class MiniGameHost {
  readonly name = 'miniGames';

  private readonly engine: Engine;
  private readonly input: InputSystem;
  private readonly stalls: readonly StallInstance[];
  private readonly touch: boolean;
  private readonly onResult: ((result: MiniGameResult) => void) | undefined;

  private readonly overlay: MiniGameOverlay;
  private readonly transition = new Transition();
  private readonly detachResize: () => void;

  private phase: Phase = 'idle';
  private game: MiniGame | null = null;
  private pending: StallInstance | null = null;
  private pendingResult: MiniGameResult | null = null;
  private gameElapsed = 0;
  private holdPrevious = false;
  private lastResultValue: MiniGameResult | null = null;

  constructor(options: MiniGameHostOptions) {
    this.engine = options.engine;
    this.input = options.input;
    this.stalls = options.stalls;
    this.touch = options.touch;
    this.onResult = options.onResult;

    this.overlay = new MiniGameOverlay(options.uiRoot);
    this.overlay.setHoldLabel(this.touch ? 'HOLD anywhere to go!' : 'HOLD Space to go!');
    this.transition.snap('opening');

    this.detachResize = this.engine.onResize((width, height) => {
      this.transition.setAspect(width / Math.max(1, height));
      this.game?.resize(width, height);
    });
  }

  /**
   * True while the park's update must be suspended.
   *
   * Deliberately false again the moment the park is back on screen, so the
   * world is already alive underneath the opening half of the wipe.
   */
  get frozen(): boolean {
    return this.phase === 'in' || this.phase === 'play' || this.phase === 'out';
  }

  /** True while the mini-game is what the screen is showing, not the park. */
  get hidesPark(): boolean {
    return this.phase === 'play' || this.phase === 'out';
  }

  /** True from the first frame of the entrance to the last of the return. */
  get active(): boolean {
    return this.phase !== 'idle';
  }

  /** What the last visit ended with. Handy for the debug overlay and tests. */
  get lastResult(): MiniGameResult | null {
    return this.lastResultValue;
  }

  /**
   * Opens a stall by id, from anywhere.
   *
   * The park uses proximity + the interact action; this exists so a stall can
   * also be opened from a script or the browser console while testing.
   */
  open(stallId: string): boolean {
    if (this.phase !== 'idle') return false;
    const stall = this.stalls.find((candidate) => candidate.definition.id === stallId);
    if (!stall) return false;
    this.begin(stall);
    return true;
  }

  /**
   * Advances the framework.
   *
   * Takes the loop's real `dt` rather than the frame context's, because the
   * context's is zeroed the moment {@link frozen} goes true — the park stopping
   * is precisely what a mini-game must not do.
   */
  update(dt: number, context: FrameContext): void {
    switch (this.phase) {
      case 'idle':
        this.checkStalls(context);
        return;

      case 'in':
        this.transition.update(dt);
        if (!this.transition.busy) this.startGame();
        return;

      case 'play':
        this.transition.update(dt);
        this.updateGame(dt);
        if (this.pendingResult) this.leave();
        return;

      case 'out':
        this.transition.update(dt);
        // Keep the game animating behind the curtain: confetti still falling as
        // it closes reads far better than a freeze-frame.
        this.updateGame(dt);
        if (!this.transition.busy) this.finishLeaving();
        return;

      case 'back':
        this.transition.update(dt);
        if (!this.transition.busy) this.phase = 'idle';
        return;
    }
  }

  /**
   * Draws whatever the framework owns this frame: the mini-game's world when it
   * is the one on screen, then the curtain over the top of everything.
   *
   * Called from `Game.render` *after* the park has (or has not) been drawn.
   */
  render(renderer: WebGLRenderer): void {
    if (this.phase === 'idle') return;
    if (this.hidesPark && this.game) {
      renderer.clearDepth();
      if (this.game.render) this.game.render(renderer);
      else renderer.render(this.game.scene, this.game.camera);
    }
    this.transition.render(renderer);
  }

  dispose(): void {
    this.game?.dispose();
    this.game = null;
    this.detachResize();
    this.overlay.dispose();
    this.transition.dispose();
  }

  // -------------------------------------------------------------- internals

  /** Standing next to a stall and pressing interact opens it. */
  /**
   * Booths that board world rides instead of opening a mini-game — Game
   * wires stall ids to the rides' `requestBoard`s. The 2D rail racer scene
   * is retired; its stall (and the Sky Cruiser's) stay as the ways in.
   */
  boardRide: ((stallId: string) => boolean) | null = null;

  private checkStalls(context: FrameContext): void {
    if (!context.input.justPressed('interact')) return;
    const { x, z } = context.playerPosition;
    for (const stall of this.stalls) {
      if (Math.hypot(x - stall.standX, z - stall.standZ) <= REACH) {
        if (this.boardRide?.(stall.definition.id)) return;
        this.begin(stall);
        return;
      }
    }
  }

  private begin(stall: StallInstance): void {
    this.pending = stall;
    this.pendingResult = null;
    this.phase = 'in';
    this.transition.setAspect(this.engine.aspect);
    this.transition.play('closing', stall.definition.accent);
  }

  /** The curtain is shut: build the world nobody can see yet. */
  private startGame(): void {
    const stall = this.pending;
    if (!stall) {
      this.phase = 'idle';
      return;
    }

    const factory = stall.definition.create;
    if (!factory) {
      // A ride-boarding stall with no mini-game behind it: boardRide should
      // have taken it in checkStalls; ending up here means the wiring is
      // missing, and saying so beats a silent black curtain.
      console.warn(`stall '${stall.definition.id}' has no mini-game and no ride wiring`);
      this.finishLeaving();
      return;
    }
    const game = factory();
    game.init({
      renderer: this.engine.renderer,
      touch: this.touch,
      overlay: this.overlay.content,
      finish: (result) => {
        // First result wins: a game that calls finish twice (a race that ends
        // as the player also quits, say) must not fire two exits.
        if (!this.pendingResult) this.pendingResult = result;
      },
    });
    game.resize(this.engine.width, this.engine.height);

    this.game = game;
    this.gameElapsed = 0;
    this.holdPrevious = false;
    this.overlay.setShown(true);
    this.overlay.setHeld(false);
    this.phase = 'play';
    this.transition.play('opening');
  }

  private updateGame(dt: number): void {
    const game = this.game;
    if (!game) return;

    const hold = this.input.isDown('jump') || this.overlay.held;
    const quit =
      this.input.justPressed('cancel') || this.overlay.takeQuitRequest();

    const input: MiniGameInput = {
      hold,
      holdPressed: hold && !this.holdPrevious,
      holdReleased: !hold && this.holdPrevious,
      quit,
    };
    this.holdPrevious = hold;
    this.overlay.setHeld(hold);

    this.gameElapsed += dt;
    game.update({ dt, elapsed: this.gameElapsed, input });

    // A quit the game chose to ignore still gets the player out of there.
    if (quit && !this.pendingResult && this.phase === 'play') {
      this.pendingResult = { id: game.id, outcome: 'quit', seconds: this.gameElapsed };
    }
  }

  /** Result is in: close the curtain over the game. */
  private leave(): void {
    this.phase = 'out';
    this.transition.play('closing', this.pending?.definition.accent ?? PALETTE.markerPink);
  }

  /** Curtain shut again: put the game away and reveal the park. */
  private finishLeaving(): void {
    const result = this.pendingResult;
    this.game?.dispose();
    this.game = null;
    this.overlay.setShown(false);
    this.overlay.clearContent();
    this.pending = null;
    this.pendingResult = null;
    this.phase = 'back';
    this.transition.play('opening');

    if (result) {
      this.lastResultValue = result;
      this.onResult?.(result);
    }
  }
}
