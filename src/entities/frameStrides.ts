import { Vector3 } from 'three';
import type { FrameContext } from '../core/types';

/** What {@link FrameStrides} needs of the navigator: `TapNavigator`. */
export interface StrideSteerer {
  stridesFor(dt: number): number;
  update(context: FrameContext): void;
}

/** What {@link FrameStrides} needs of the mover: `Player`. */
export interface StrideMover {
  readonly position: Vector3;
  readonly previousPosition: Vector3;
  update(context: FrameContext): void;
}

/** What {@link FrameStrides} needs of the followers: `Parade`. */
export interface StrideFollowers {
  followStride(): void;
}

/**
 * **The navigator steers, then she moves: once a frame — or, while a tapped
 * journey is dashing (`entities/tapDash.ts`), once per stride.**
 *
 * The one owner of that loop, run by `Game.tick` and by `check:tap-dash`, so
 * the check measures the frame the game runs rather than a copy of it.
 *
 * A dash covers up to 3.5 m in a clamped frame, four times the
 * `PLAYER_LONGEST_STEP` every collision, ground and step-up rule in the game is
 * sized for. Rather than re-size any of them, the frame is cut into strides of
 * at most `DASH_STRIDE` and each one is an ordinary navigator update and an
 * ordinary `Player.update` at its share of `dt` — so a dash is collided,
 * sampled, auto-hopped and steered exactly as a walk is, only more often. A
 * walk or a sprint is one stride, unchanged.
 *
 * Two things the rest of the frame reads are left the way one long step would
 * leave them:
 *
 * - **`previousPosition` spans the whole frame**, so a doorway's or a
 *   doormat's `bandCrossed` (run later, in `world.update`) asks what she
 *   crossed this frame, not this stride. If a stride collapses it — a put-down,
 *   a teleport — the frame's line starts again from there, as it would have.
 * - **The parade's trail is fed every stride** (`Parade.followStride`), so the
 *   ground she ran over is the ground her animals follow, and a long frame is
 *   not mistaken for a teleport.
 */
export class FrameStrides {
  private readonly frameStart = new Vector3();
  private readonly strideStart = new Vector3();

  /** Strides the last {@link step} was cut into — 1 for an ordinary frame. */
  lastStrides = 1;

  /**
   * Runs one frame. `afterStride` is for an instrument that wants to see every
   * stride (`check:tap-dash`); the game passes none.
   */
  step(
    // Its `dt` is shared out among the strides and put back afterwards.
    context: FrameContext & { dt: number },
    steerer: StrideSteerer,
    mover: StrideMover,
    followers: StrideFollowers | null,
    afterStride?: () => void,
  ): void {
    const strides = steerer.stridesFor(context.dt);
    this.lastStrides = Math.max(1, strides);
    if (strides <= 1) {
      steerer.update(context);
      mover.update(context);
      afterStride?.();
      return;
    }
    const dt = context.dt;
    this.frameStart.copy(mover.position);
    context.dt = dt / strides;
    try {
      for (let stride = 0; stride < strides; stride += 1) {
        this.strideStart.copy(mover.position);
        steerer.update(context);
        mover.update(context);
        if (!mover.previousPosition.equals(this.strideStart)) this.frameStart.copy(mover.previousPosition);
        followers?.followStride();
        afterStride?.();
      }
    } finally {
      context.dt = dt;
    }
    mover.previousPosition.copy(this.frameStart);
  }
}
