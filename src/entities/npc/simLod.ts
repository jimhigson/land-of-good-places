import { Frustum, Matrix4, Sphere, type Camera } from 'three';

/**
 * **Simulation level-of-detail for the crowd** — step 11 of
 * docs/perf/FRAME-DROPS-2026-11.md (`NpcSystem.update` measured at 69 ms per
 * second of play, in a park view with none of the crowd on screen).
 *
 * A child nobody can see is still walked, at the same speed and on the same
 * clock — but in fewer, longer steps:
 *
 * - **steering** (her driver, her movement, her collision) every
 *   {@link SIM_LOD_STEER_EVERY}th frame, and
 * - **pose** (the walk cycle onto her rig, and the upload of her instance
 *   matrices) every {@link SIM_LOD_POSE_EVERY}th.
 *
 * The time she was not stepped for is **banked and handed to her next step
 * whole**, so nothing is lost: a throttled child covers the same ground in the
 * same seconds (`check:npc-sim-lod` walks two crowds side by side and measures
 * it). A child on screen, near the player, or doing anything a player could be
 * part of is stepped every frame exactly as before — `NpcSystem` decides who
 * that is; this file owns the two things it decides *with*:
 *
 * - {@link NpcView}: **the one definition of "on screen" for NPC simulation**,
 *   a sphere against the frustum of the camera that last drew the park.
 * - {@link NpcSimLod}: the schedule, the banked time, and the counts.
 *
 * Throttled children are staggered by their index, so a quarter of them pose
 * on any one frame and the cost is flat rather than a spike every fourth.
 */

/** A throttled child steers (driver, movement, collision) once in this many frames. */
export const SIM_LOD_STEER_EVERY = 2;
/** A throttled child is posed, and her instance matrices uploaded, once in this many frames. */
export const SIM_LOD_POSE_EVERY = 4;

/**
 * Metres added to a child's own bounding sphere before it is asked whether
 * the camera sees it. Generous on purpose, because three things hide in it:
 *
 * - the frustum is the one the *last* frame was drawn through, so a camera on
 *   the move is a frame ahead of it;
 * - a throttled child's drawn pose is up to {@link SIM_LOD_POSE_EVERY} − 1
 *   frames old, and she must be back at full rate before any of her is drawn;
 * - her shadow is drawn where she is not: a 1.3 m child under a sun 20° up
 *   throws one 3.6 m long, so a child this far off the edge of the screen can
 *   still have her shadow on it.
 */
export const SIM_LOD_VIEW_MARGIN = 4;

/** A noted view older than this many simulation frames is no view at all — see {@link NpcView.known}. */
const VIEW_STALE_AFTER = 2;

const scratchMatrix = new Matrix4();
const scratchSphere = new Sphere();

/**
 * **What the camera sees, as NPC simulation understands it** — the single
 * owner of "is this child on screen".
 *
 * `Game.render` tells it which camera it is about to draw the park through
 * ({@link noteNpcViewCamera}) — the ride's, the story's or the debug view's
 * when one has taken over, never just the isometric one — and `NpcSystem` asks
 * it about one sphere per child on the next simulation frame.
 *
 * **With no recent view it says everybody is on screen.** A headless check
 * stepping the world without drawing it, a mini-game that draws another scene,
 * the frames before the first render: nobody has said what is visible, so
 * nothing is assumed invisible and the whole crowd runs at full rate.
 */
export class NpcView {
  private readonly frustum = new Frustum();
  private age = Infinity;

  /** The camera the park is about to be drawn through. Its world matrix must be current, as it is just before `render`. */
  note(camera: Camera): void {
    scratchMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(scratchMatrix, camera.coordinateSystem, camera.reversedDepth);
    this.age = 0;
  }

  /** One simulation frame has passed since the view was noted. */
  tick(): void {
    this.age += 1;
  }

  /** Forgets the view: everybody is on screen until the next {@link note}. */
  forget(): void {
    this.age = Infinity;
  }

  /** Whether anybody has said, recently enough to trust, what the camera sees. */
  get known(): boolean {
    return this.age <= VIEW_STALE_AFTER;
  }

  /**
   * Whether a body of `radius` round (x, y, z) could have any of itself, or of
   * its shadow, on screen — padded by {@link SIM_LOD_VIEW_MARGIN}. True
   * whenever the view is not {@link known}.
   */
  onScreen(x: number, y: number, z: number, radius: number): boolean {
    if (!this.known) return true;
    scratchSphere.center.set(x, y, z);
    scratchSphere.radius = radius + SIM_LOD_VIEW_MARGIN;
    return this.frustum.intersectsSphere(scratchSphere);
  }
}

/** The park's own view — what `Game.render` notes and `NpcSystem` reads by default. */
export const npcView = new NpcView();

/**
 * Tells NPC simulation which camera the park is about to be drawn through.
 * Called by `Game.render` beside `cullCrowdsFor`, with the same camera.
 */
export function noteNpcViewCamera(camera: Camera): void {
  npcView.note(camera);
}

/** {@link NpcSimLod.plan}: step her driver, movement and collision this frame. */
export const SIM_STEER = 1;
/** {@link NpcSimLod.plan}: pose her rig and upload her matrices this frame. Never set without {@link SIM_STEER}. */
export const SIM_POSE = 2;

/** Counts since the last {@link NpcSimLod.resetCounts}, for `check:npc-sim-lod` and the perf harness. */
export interface SimLodCounts {
  /** Simulation frames counted. */
  frames: number;
  /** Children offered a step: everybody not marked elsewhere, every frame. What "update everyone every frame" costs. */
  eligible: number;
  /** Of those, the ones that had to be stepped every frame (on screen, near her, or busy). */
  everyFrame: number;
  /** Steering steps actually taken (`NpcCharacter.update` calls). */
  steered: number;
  /** Poses actually written (`NpcCharacter.animate` calls). */
  posed: number;
  /** The most throttled children posed on any one frame — the stagger keeps this near a quarter of them. */
  peakThrottledPoses: number;
}

/**
 * The schedule: who steps this frame, with how much time.
 *
 * One per `NpcSystem`. Allocates only when the crowd grows; nothing per frame.
 */
export class NpcSimLod {
  /**
   * Off, every child is stepped every frame with that frame's `dt` — the
   * behaviour before this file existed, kept switchable so a check can run the
   * same crowd both ways and compare where they end up.
   */
  enabled = true;

  /** After {@link plan}: the seconds this step must cover — this frame's, plus whatever was banked. */
  stepDt = 0;
  /** After {@link plan}: whether the player hopped on this frame or any frame skipped since her last step. */
  stepHopped = false;

  readonly counts: SimLodCounts = {
    frames: 0,
    eligible: 0,
    everyFrame: 0,
    steered: 0,
    posed: 0,
    peakThrottledPoses: 0,
  };

  private frame = 0;
  private throttledPosesThisFrame = 0;
  /** Seconds each child has lived through but not yet been stepped for. */
  private readonly banked: number[] = [];
  /** A hop of the player's each child has not yet been told about — the cue lasts one frame. */
  private readonly hopOwed: boolean[] = [];

  beginFrame(): void {
    this.frame += 1;
    this.counts.frames += 1;
    if (this.throttledPosesThisFrame > this.counts.peakThrottledPoses) {
      this.counts.peakThrottledPoses = this.throttledPosesThisFrame;
    }
    this.throttledPosesThisFrame = 0;
  }

  /**
   * What child `index` does this frame: a mask of {@link SIM_STEER} and
   * {@link SIM_POSE}, or 0 to leave her exactly as she is. When it steers,
   * {@link stepDt} and {@link stepHopped} are what to step her with.
   *
   * `everyFrame` is the caller's verdict that she must not be throttled. A
   * child promoted from throttled to every-frame is stepped at once, with her
   * banked time, so she arrives on screen already caught up and freshly posed.
   */
  plan(index: number, dt: number, playerHopped: boolean, everyFrame: boolean): number {
    const banked = (this.banked[index] ?? 0) + dt;
    const hopOwed = (this.hopOwed[index] ?? false) || playerHopped;
    this.counts.eligible += 1;

    let mask: number;
    if (everyFrame || !this.enabled) {
      mask = SIM_STEER | SIM_POSE;
      this.counts.everyFrame += 1;
    } else {
      // Staggered by index: a quarter of the throttled crowd poses on any one
      // frame, and another quarter only steers.
      const phase = (this.frame + index) % SIM_LOD_POSE_EVERY;
      mask = phase === 0 ? SIM_STEER | SIM_POSE : phase % SIM_LOD_STEER_EVERY === 0 ? SIM_STEER : 0;
      if (mask & SIM_POSE) this.throttledPosesThisFrame += 1;
    }

    if (mask === 0) {
      this.banked[index] = banked;
      this.hopOwed[index] = hopOwed;
      return 0;
    }
    this.banked[index] = 0;
    this.hopOwed[index] = false;
    this.stepDt = banked;
    this.stepHopped = hopOwed;
    this.counts.steered += 1;
    if (mask & SIM_POSE) this.counts.posed += 1;
    return mask;
  }

  /**
   * Child `index` is not being simulated at all (marked elsewhere, #362): she
   * banks nothing, because that time is deliberately not lived.
   */
  forget(index: number): void {
    this.banked[index] = 0;
    this.hopOwed[index] = false;
  }

  resetCounts(): void {
    const c = this.counts;
    c.frames = 0;
    c.eligible = 0;
    c.everyFrame = 0;
    c.steered = 0;
    c.posed = 0;
    c.peakThrottledPoses = 0;
    this.throttledPosesThisFrame = 0;
  }
}
