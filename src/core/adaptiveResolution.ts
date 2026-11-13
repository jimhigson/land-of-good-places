import { FRAME_BUDGET_MS } from './perfProbe';

/**
 * **Adaptive resolution: give up pixels before giving up frames** (120 fps
 * plan, step 17; `docs/perf/FRAME-DROPS-2026-11.md` §10 on #746).
 *
 * The target is 8.3 ms a frame. Some scenes miss it on the GPU, not the CPU:
 * the reptile house's eleven point lights, measured on an M4 Pro at DPR 2,
 * dropped 11 frames over a walk with the main thread idle; at DPR 1 the same
 * walk dropped none. Fill cost scales with the pixel count, and DPR 2 → 1.5 is
 * 44 % fewer pixels for a softness most people cannot see on a phone. So when
 * frames keep missing vsync *while the main thread was idle*, this steps the
 * renderer's pixel ratio down the {@link LADDER}, and back up once the frames
 * have been calm for a while.
 *
 * Pure and DOM-free: it is fed one `(start, cpu)` pair per frame and answers
 * the pixel ratio to draw at, so its hysteresis is unit-tested on synthetic
 * traces (`test/adaptiveResolution.test.ts`) rather than trusted. `Engine`
 * owns applying the answer.
 *
 * ## What counts as a GPU-bound miss
 *
 * A frame whose interval (start to previous start) is more than 1.5 refresh
 * periods — it was shown at least twice — **and** whose main-thread work was
 * under three quarters of a period. A frame that missed because the *CPU* was
 * slow (a shader link, the NavGrid rebuild, a GC) is not evidence: fewer pixels
 * would not have saved it, and stepping down on it would cost sharpness for
 * nothing.
 *
 * ## The refresh period, which is not always 8.3 ms
 *
 * On a 60 Hz phone every frame is 16.7 ms, and "missed 120 Hz" would be true
 * of all of them; the controller would sink to its floor on a device that is
 * keeping up perfectly. So the period is **measured**: the shortest interval
 * seen over the last few seconds ({@link PERIOD_BLOCK_FRAMES} ×
 * {@link PERIOD_BLOCKS}), never shorter than the 8.3 ms budget (a 240 Hz
 * screen is still held to 120 fps, not 240). It is a rolling minimum, not a
 * session one, so iOS Low Power Mode capping the screen to 60 Hz mid-game is
 * re-learnt within seconds rather than read as permanent overload.
 *
 * The limit of that, said plainly: a scene that is GPU-bound at *exactly*
 * two periods from the very first frame for longer than the window looks
 * like a slower screen. Then the controller holds its DPR rather than
 * stepping down — sharpness kept, nothing lost against today.
 *
 * ## Hysteresis, so it never flickers
 *
 * - **Down is quick, up is slow.** Down when {@link DOWN_MISSES} of the last
 *   {@link DOWN_WINDOW} frames were GPU-bound misses (~0.5 s of evidence at
 *   120 fps). Up only after {@link UP_HOLD_MS} in which the recent window
 *   held at most {@link CALM_MISSES} such misses — a much stricter bar than
 *   the one that stepped down, so a scene sitting between the two stays put.
 * - **A step that was regretted costs more to retry.** If a step *up* to a
 *   level is followed by a step back down within {@link REGRET_MS}, that
 *   level's hold doubles (to at most {@link MAX_UP_HOLD_MS}). A scene that
 *   only manages DPR 1.5 tries 2 again after 4 s, then 8, 16, 32, 60 — the
 *   softness change becomes a once-a-minute event, then stays.
 * - **Every change is followed by {@link SETTLE_FRAMES} frames of ignoring
 *   evidence**: resizing the drawing buffer is itself a hitch, and the window
 *   is cleared so a decision at the new level rests on frames drawn at it.
 * - **Hidden-tab gaps** (> {@link GAP_MS}) are not frames and are ignored.
 */

/** The pixel ratios the controller may use, best first. Never below 1.25 unless the screen itself is lower. */
export const LADDER: readonly number[] = [2, 1.5, 1.25];
/** Frames of evidence for stepping down. */
export const DOWN_WINDOW = 60;
/** GPU-bound misses in {@link DOWN_WINDOW} that step down: one frame in five. */
export const DOWN_MISSES = 12;
/** At most this many GPU-bound misses in the window still counts as calm. */
export const CALM_MISSES = 1;
/** Calm needed before the first try at stepping up to a level. */
export const UP_HOLD_MS = 4000;
/** The longest the backoff grows to. */
export const MAX_UP_HOLD_MS = 60_000;
/** A step down this soon after stepping up to that level means the step up was wrong. */
export const REGRET_MS = 10_000;
/** Frames ignored after any change. */
export const SETTLE_FRAMES = 30;
/** An interval longer than this is a hidden tab or a debugger, not a frame. */
export const GAP_MS = 250;
/** The rolling minimum is kept in blocks of this many frames… */
export const PERIOD_BLOCK_FRAMES = 120;
/** …this many blocks long (~5 s at 120 fps). */
export const PERIOD_BLOCKS = 5;
/** Intervals shorter than this are rAF bunching, not a refresh period. */
const MIN_PLAUSIBLE_PERIOD_MS = 3;

/**
 * The ladder for a screen whose own cap is `cap`: the cap itself first, then
 * every rung below it. A DPR-1 screen gets `[1]` and the controller is inert —
 * which is also why CI's headless runs at `deviceScaleFactor: 1` are untouched.
 */
export function ladderFor(cap: number): number[] {
  const rungs = LADDER.filter((r) => r < cap - 1e-6);
  return [cap, ...rungs];
}

export interface AdaptiveResolutionState {
  /** The pixel ratio to draw at. */
  readonly pixelRatio: number;
  /** The best this screen allows. */
  readonly cap: number;
  /** Index into the ladder; 0 is the cap. */
  readonly level: number;
  /** The refresh period the controller believes in, ms. */
  readonly periodMs: number;
  /** GPU-bound misses in the current down window. */
  readonly recentMisses: number;
  /** ms of calm accumulated towards the next step up. */
  readonly calmMs: number;
  /** The hold the next step up needs, ms. */
  readonly upHoldMs: number;
  /** Total steps taken, both directions, since construction. */
  readonly changes: number;
}

export class AdaptiveResolution {
  private ladder: number[];
  private levelValue = 0;
  private readonly window: boolean[] = [];
  private missesInWindow = 0;
  private previousStart = -1;
  private settle = 0;
  private calm = 0;
  /** Per level, the calm needed to step up *to* it. */
  private readonly holds: number[];
  /** When we last stepped up to each level, for regret. */
  private readonly steppedUpAt: number[];
  private changesValue = 0;
  // Rolling minimum of the interval, in blocks.
  private blockMin = Infinity;
  private blockFrames = 0;
  private readonly blockMins: number[] = [];

  constructor(cap: number) {
    this.ladder = ladderFor(cap);
    this.holds = this.ladder.map(() => UP_HOLD_MS);
    this.steppedUpAt = this.ladder.map(() => -Infinity);
  }

  get pixelRatio(): number {
    return this.ladder[this.levelValue]!;
  }

  get cap(): number {
    return this.ladder[0]!;
  }

  /**
   * The screen's own cap changed (a window dragged to another monitor). Starts
   * again from the top of the new ladder rather than guessing a mapping.
   */
  setCap(cap: number): void {
    if (Math.abs(cap - this.cap) < 1e-6) return;
    this.ladder = ladderFor(cap);
    this.holds.length = 0;
    this.steppedUpAt.length = 0;
    for (let i = 0; i < this.ladder.length; i++) {
      this.holds.push(UP_HOLD_MS);
      this.steppedUpAt.push(-Infinity);
    }
    this.levelValue = 0;
    this.restartEvidence();
  }

  /** The refresh period currently believed in, never shorter than the budget. */
  get periodMs(): number {
    let min = this.blockMin;
    for (const m of this.blockMins) if (m < min) min = m;
    return Number.isFinite(min) ? Math.max(min, FRAME_BUDGET_MS) : FRAME_BUDGET_MS;
  }

  /**
   * Feeds one frame. `start` is `performance.now()` at the start of the
   * frame, `cpu` the ms of main-thread work in it. Returns the pixel ratio to
   * draw the **next** frame at.
   */
  frame(start: number, cpu: number): number {
    const interval = this.previousStart < 0 ? 0 : start - this.previousStart;
    this.previousStart = start;
    if (interval <= 0 || interval > GAP_MS) return this.pixelRatio;
    this.notePeriod(interval);
    if (this.ladder.length < 2) return this.pixelRatio;
    if (this.settle > 0) {
      this.settle--;
      return this.pixelRatio;
    }

    const period = this.periodMs;
    const gpuMiss = interval > period * 1.5 && cpu < period * 0.75;
    this.window.push(gpuMiss);
    if (gpuMiss) this.missesInWindow++;
    if (this.window.length > DOWN_WINDOW && this.window.shift()) this.missesInWindow--;

    if (this.missesInWindow >= DOWN_MISSES && this.levelValue < this.ladder.length - 1) {
      // Regret: we stepped up to this level a moment ago, and it did not hold.
      if (start - this.steppedUpAt[this.levelValue]! < REGRET_MS) {
        this.holds[this.levelValue] = Math.min(MAX_UP_HOLD_MS, this.holds[this.levelValue]! * 2);
      }
      this.levelValue++;
      this.changesValue++;
      this.restartEvidence();
      return this.pixelRatio;
    }

    if (this.levelValue > 0 && this.window.length >= DOWN_WINDOW / 2 && this.missesInWindow <= CALM_MISSES) {
      this.calm += interval;
      if (this.calm >= this.holds[this.levelValue - 1]!) {
        this.levelValue--;
        this.steppedUpAt[this.levelValue] = start;
        this.changesValue++;
        this.restartEvidence();
      }
    } else {
      this.calm = 0;
    }
    return this.pixelRatio;
  }

  state(): AdaptiveResolutionState {
    return {
      pixelRatio: this.pixelRatio,
      cap: this.cap,
      level: this.levelValue,
      periodMs: this.periodMs,
      recentMisses: this.missesInWindow,
      calmMs: this.calm,
      upHoldMs: this.levelValue > 0 ? this.holds[this.levelValue - 1]! : 0,
      changes: this.changesValue,
    };
  }

  private restartEvidence(): void {
    this.window.length = 0;
    this.missesInWindow = 0;
    this.calm = 0;
    this.settle = SETTLE_FRAMES;
  }

  private notePeriod(interval: number): void {
    if (interval >= MIN_PLAUSIBLE_PERIOD_MS && interval < this.blockMin) this.blockMin = interval;
    if (++this.blockFrames < PERIOD_BLOCK_FRAMES) return;
    this.blockMins.push(this.blockMin);
    if (this.blockMins.length > PERIOD_BLOCKS) this.blockMins.shift();
    this.blockMin = Infinity;
    this.blockFrames = 0;
  }
}

/** `?adaptiveDpr=0` pins the pixel ratio at the screen's cap — for A/B measurement. */
export function adaptiveResolutionRequested(
  search: string = typeof location === 'undefined' ? '' : location.search,
): boolean {
  return new URLSearchParams(search).get('adaptiveDpr') !== '0';
}
