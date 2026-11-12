import { Vector3 } from 'three';
import type { FrameContext } from '../core/types';
import { extendFramePath, type FramePath } from './framePath';

/** What {@link FrameStrides} needs of the navigator: `TapNavigator`. */
export interface StrideSteerer {
  stridesFor(dt: number): number;
  update(context: FrameContext): void;
  /** False on a stride whose marker animation nobody will see. */
  drawThisUpdate: boolean;
  /** True while a journey is running faster than a walk. */
  readonly dashing: boolean;
}

/** What {@link FrameStrides} needs of the mover: `Player`. */
export interface StrideMover {
  readonly position: Vector3;
  readonly previousPosition: Vector3;
  readonly framePath: FramePath;
  /** False on a stride whose pose nobody will see. */
  poseThisUpdate: boolean;
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
 * - **The frame's path is kept stride by stride** (`mover.framePath`), so a
 *   doorway asks what she crossed along the strides she ran, not along one
 *   straight chord that could cut a corner (`tapSpacing.ts`'s
 *   `bandWalkedThrough`).
 * - **The parade's trail is fed every stride** (`Parade.followStride`), so the
 *   ground she ran over is the ground her animals follow, and a long frame is
 *   not mistaken for a teleport.
 *
 * And two things are done **once a frame**, not once a stride: her pose and
 * the tap marker's animation are only drawn on the last stride
 * (`poseThisUpdate`, `drawThisUpdate`), so a dash costs the movement it needs
 * and none of the drawing it does not.
 */
/**
 * A frame longer than this many times the recent typical frame is a hitch, and
 * a dash moves only this many typical frames' worth in it. See
 * {@link FrameStrides.step}.
 */
export const DASH_HITCH_FRAMES = 1.25;

export class FrameStrides {
  /**
   * The recent typical frame, in seconds — an average that a single long frame
   * moves only a tenth of the way.
   */
  private typicalDt = 1 / 60;
  private readonly frameStart = new Vector3();
  private readonly strideStart = new Vector3();

  /** Strides the last {@link step} was cut into — 1 for an ordinary frame. */
  lastStrides = 1;
  /** Seconds of movement the last {@link step} ran — less than the frame on a dash's hitch. */
  lastMoveDt = 0;

  /** Starts the typical frame at `dt`, as a device steadily running at it would have it. */
  settleAt(dt: number): void {
    this.typicalDt = dt;
  }

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
    // **A hitch does not carry a dash** (#745's QA). The first tap of a session
    // plans a lattice, and the frame after it is ~0.55 s, clamped to 1/12 s —
    // which at full dash is a 7 m pop. So on a frame much longer than the
    // recent ones, a dash moves only a typical frame's worth: the journey loses
    // a few hundredths of a second and never jumps. A device that is steadily
    // slow raises the typical frame with it and is not clamped at all. Walks
    // and sprints are never touched.
    const frameDt = context.dt;
    const typical = this.typicalDt;
    this.typicalDt += (frameDt - typical) * 0.1;
    const moveDt = steerer.dashing ? Math.min(frameDt, typical * DASH_HITCH_FRAMES) : frameDt;
    this.lastMoveDt = moveDt;
    const strides = steerer.stridesFor(moveDt);
    this.lastStrides = Math.max(1, strides);
    const path = mover.framePath;
    if (strides <= 1 && moveDt === frameDt) {
      path.count = 0;
      steerer.update(context);
      mover.update(context);
      afterStride?.();
      return;
    }
    const dt = frameDt;
    this.frameStart.copy(mover.position);
    path.count = 0;
    extendFramePath(path, mover.position.x, mover.position.z);
    context.dt = moveDt / Math.max(1, strides);
    try {
      const count = Math.max(1, strides);
      for (let stride = 0; stride < count; stride += 1) {
        const last = stride === count - 1;
        steerer.drawThisUpdate = last;
        mover.poseThisUpdate = last;
        this.strideStart.copy(mover.position);
        steerer.update(context);
        mover.update(context);
        if (!mover.previousPosition.equals(this.strideStart)) {
          // Moved rather than walked mid-frame (a put-down, a teleport): the
          // frame's line starts again from where she was put.
          this.frameStart.copy(mover.previousPosition);
          path.count = 0;
          extendFramePath(path, mover.previousPosition.x, mover.previousPosition.z);
        }
        extendFramePath(path, mover.position.x, mover.position.z);
        followers?.followStride();
        afterStride?.();
      }
    } finally {
      context.dt = dt;
      steerer.drawThisUpdate = true;
      mover.poseThisUpdate = true;
    }
    mover.previousPosition.copy(this.frameStart);
  }
}
