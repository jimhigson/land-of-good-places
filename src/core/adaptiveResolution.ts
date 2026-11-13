import { FRAME_BUDGET_MS } from './perfProbe';

/**
 * **The quality governor: give up pixels before giving up frames** (120 fps
 * plan, step 17; `docs/perf/FRAME-DROPS-2026-11.md` §10 on #746).
 *
 * The target is one display refresh a frame. Some scenes miss it on the GPU,
 * not the CPU: the reptile house's eleven point lights, measured on an M4 Pro
 * at DPR 2, dropped 11 frames over a walk with the main thread idle; at DPR 1
 * the same walk dropped none. Fill cost scales with the pixel count, and DPR
 * 2 → 1.5 is 44 % fewer pixels for a softness most people cannot see on a
 * phone. So when frames keep missing vsync *while the main thread was idle*,
 * this steps the renderer's pixel ratio down the {@link LADDER}, and back up
 * once the frames have been calm for a while.
 *
 * Pure and DOM-free: it is fed one `(start, cpu)` pair per frame and answers
 * the pixel ratio to draw at, so its hysteresis is unit-tested on synthetic
 * traces (`test/adaptiveResolution.test.ts`) rather than trusted. `Engine`
 * owns applying the answer.
 *
 * ## It is the one owner of "how hard is this device being pushed?"
 *
 * {@link AdaptiveResolution.quality} is the quality level and
 * {@link AdaptiveResolution.subscribe} announces every change of it. Today only
 * the drawing buffer listens (through `Engine`). Anything that later wants to
 * shed work under load — shadow cadence, crowd LOD distance — reads this
 * signal rather than growing a second frame-time detector that would disagree
 * with this one about when the device is struggling.
 *
 * ## What counts as a GPU-bound miss
 *
 * A frame whose interval (its start to the next frame's start) is more than
 * 1.5 refresh periods — it was shown at least twice — **and** whose own
 * main-thread work was under three quarters of a period. A frame that missed
 * because the *CPU* was slow (a shader link, the NavGrid rebuild, a GC) is not
 * evidence: fewer pixels would not have saved it, and stepping down on it
 * would cost sharpness for nothing.
 *
 * That is as far as a browser lets us see. There is no portable GPU timer
 * (`EXT_disjoint_timer_query_webgl2` is absent on iOS and was measured as
 * relative-only on the plan's harness), so "the display skipped while the main
 * thread sat idle" is the signature, and main-thread work *outside* the frame
 * callback (another rAF, a timer, a GC between frames) is invisible to it.
 *
 * ## The budget is the display's, measured — not 8.3 ms
 *
 * On a 60 Hz phone every frame is 16.7 ms, and "missed 120 Hz" would be true
 * of all of them; the controller would sink to its floor on a device that is
 * keeping up perfectly. So the period is **measured**: the shortest interval
 * the screen *keeps* producing over the last few seconds
 * ({@link PERIOD_BLOCK_FRAMES} × {@link PERIOD_BLOCKS}), never shorter than
 * the game's own target (`FRAME_BUDGET_MS`, owned by `perfProbe`: a 240 Hz
 * screen is still held to 120 fps, not 240). It is a rolling figure, not a
 * session one, so iOS Low Power Mode capping the screen to 60 Hz mid-game is
 * re-learnt within seconds rather than read as permanent overload.
 *
 * **"Keeps producing", not "ever produced".** The intervals are
 * `performance.now()` at the start of each frame callback, not vsync
 * timestamps, so one over-budget frame is followed by a *short* interval: the
 * late callback, then the next one back on vsync (25 ms then 8.3 ms on a
 * 60 Hz screen). A plain minimum would take that 8.3 ms for the refresh
 * period and read every ordinary 16.7 ms frame for the next ten seconds as a
 * miss — the floor DPR on a phone that is keeping up. So each block's figure
 * is its {@link PERIOD_OUTLIERS}-th-from-shortest interval (the shortest
 * tenth is set aside), and the block in progress sets aside the same share
 * of what it has seen so far, and never fewer than one.
 *
 * The limit of that, said plainly: a scene that is GPU-bound at two periods
 * on more than nine frames in ten, for longer than the window, looks like a
 * slower screen. Then the controller holds its DPR (or climbs back, with the
 * regret backoff spacing the retries) rather than stepping down — sharpness
 * kept, nothing lost against today.
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
 *
 * ## One-off hitches are not evidence
 *
 * Adaptation **pauses** — no evidence gathered, no calm accrued, nothing
 * decided — around the moments a frame is slow for a reason pixels cannot fix:
 *
 * - **a space change or an iris wipe** (`busy`, or a new `scene` key): the
 *   first frames of a room link its shaders and upload its textures, in the
 *   GPU process, with the main thread idle — exactly the GPU-bound signature,
 *   and exactly wrong. Paused while busy and for {@link PAUSE_AFTER_BUSY_MS}
 *   after; the evidence window is thrown away, since it described the room
 *   she just left.
 * - **a hidden tab** (an interval over {@link GAP_MS} is not a frame): paused
 *   for {@link PAUSE_AFTER_GAP_MS} after she comes back, while the browser
 *   catches up.
 * - **a CPU hitch** (main-thread work over {@link HITCH_PERIODS} periods — a
 *   compile, a big GC): the frames straight after one are the GPU draining
 *   its queue; {@link PAUSE_AFTER_HITCH_MS} of them are ignored.
 *
 * A pause never resets the calm already earned towards a step up, so a child
 * walking in and out of rooms cannot hold the resolution down for ever.
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
/** Adaptation stays paused this long after an iris wipe or a space change ends. */
export const PAUSE_AFTER_BUSY_MS = 1500;
/** …and this long after a hidden tab comes back. */
export const PAUSE_AFTER_GAP_MS = 1000;
/** Main-thread work over this many refresh periods is a hitch, not a frame. */
export const HITCH_PERIODS = 4;
/** Adaptation stays paused this long after a CPU hitch. */
export const PAUSE_AFTER_HITCH_MS = 500;
/** The period is learnt in blocks of this many frames… */
export const PERIOD_BLOCK_FRAMES = 120;
/** …this many blocks long (~5 s at 120 fps). */
export const PERIOD_BLOCKS = 5;
/**
 * A block's shortest this-many intervals are set aside as catch-up after a
 * late frame, not a refresh period: one in ten. The period is the next one up.
 */
export const PERIOD_OUTLIERS = PERIOD_BLOCK_FRAMES / 10;
/** Intervals shorter than this are rAF bunching, not a refresh period. */
const MIN_PLAUSIBLE_PERIOD_MS = 3;

/**
 * The ladder for a screen whose own cap is `cap`: the cap itself first, then
 * every rung below it. A DPR-1 screen gets `[1]` and the controller is inert —
 * which is also why CI's headless runs at `deviceScaleFactor: 1` are untouched.
 * `pinned` (`?adaptiveDpr=0`) is the same one-rung ladder on any screen.
 *
 * Never above the cap (the device's own ratio, already clamped by
 * `device.pixelRatioCap`), and never below 1 unless the device itself is: the
 * lowest rung is 1.25, and a cap at or under that has nothing beneath it.
 */
export function ladderFor(cap: number, pinned = false): number[] {
  if (pinned) return [cap];
  const rungs = LADDER.filter((r) => r < cap - 1e-6);
  return [cap, ...rungs];
}

/** What the governor is doing this frame — the `?perf=1` overlay prints it. */
export type GovernorPhase =
  /** One rung only: a DPR ≤ 1.25 screen, or `?adaptiveDpr=0`. */
  | 'fixed'
  /** Ignoring frames around a space change, a hidden tab or a hitch. */
  | 'paused'
  /** Ignoring the frames straight after its own change of level. */
  | 'settling'
  /** Below the cap, with calm accruing towards a step back up. */
  | 'recovering'
  /** Gathering evidence. */
  | 'watching';

/**
 * The quality-level signal: what {@link AdaptiveResolution.subscribe} hands
 * out. `level` 0 is full quality; `levels - 1` is the floor.
 */
export interface QualityLevel {
  /** Index into the ladder; 0 is the cap. */
  readonly level: number;
  /** How many levels this device has (1 means the governor is inert). */
  readonly levels: number;
  /** The pixel ratio to draw at. */
  readonly pixelRatio: number;
  /** The best this screen allows. */
  readonly cap: number;
}

export interface AdaptiveResolutionState extends QualityLevel {
  readonly phase: GovernorPhase;
  /** The refresh period the controller believes in, ms — the frame budget. */
  readonly periodMs: number;
  /** GPU-bound misses in the current down window. */
  readonly recentMisses: number;
  /** ms of calm accumulated towards the next step up. */
  readonly calmMs: number;
  /** The hold the next step up needs, ms. */
  readonly upHoldMs: number;
  /** ms of pause still to run. */
  readonly pausedMs: number;
  /** Total steps taken, both directions, since construction. */
  readonly changes: number;
}

export class AdaptiveResolution {
  private ladder: number[];
  private readonly pinned: boolean;
  private levelValue = 0;
  private readonly window: boolean[] = [];
  private missesInWindow = 0;
  private previousStart = -1;
  private settle = 0;
  private calm = 0;
  private pausedUntil = -Infinity;
  private scene: string | number | undefined;
  /** Per level, the calm needed to step up *to* it. */
  private readonly holds: number[];
  /** When we last stepped up to each level, for regret. */
  private readonly steppedUpAt: number[];
  private changesValue = 0;
  private readonly listeners = new Set<(quality: QualityLevel) => void>();
  // The period, in blocks. `lows` is the current block's shortest
  // PERIOD_OUTLIERS + 1 intervals, ascending — all a block's figure needs.
  private readonly lows = new Float64Array(PERIOD_OUTLIERS + 1);
  private lowCount = 0;
  private blockFrames = 0;
  private readonly blockPeriods: number[] = [];

  constructor(cap: number, options: { pinned?: boolean } = {}) {
    this.pinned = options.pinned ?? false;
    this.ladder = ladderFor(cap, this.pinned);
    this.holds = this.ladder.map(() => UP_HOLD_MS);
    this.steppedUpAt = this.ladder.map(() => -Infinity);
  }

  get pixelRatio(): number {
    return this.ladder[this.levelValue]!;
  }

  get cap(): number {
    return this.ladder[0]!;
  }

  /** The quality level right now. */
  get quality(): QualityLevel {
    return { level: this.levelValue, levels: this.ladder.length, pixelRatio: this.pixelRatio, cap: this.cap };
  }

  /**
   * Calls `listener` on every change of level (either direction, and on a new
   * screen cap) — not once a frame. Answers the unsubscribe. Read
   * {@link quality} for the value at subscription time.
   */
  subscribe(listener: (quality: QualityLevel) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * The screen's own cap changed (a window dragged to another monitor). Starts
   * again from the top of the new ladder rather than guessing a mapping.
   */
  setCap(cap: number): void {
    if (Math.abs(cap - this.cap) < 1e-6) return;
    this.ladder = ladderFor(cap, this.pinned);
    this.holds.length = 0;
    this.steppedUpAt.length = 0;
    for (let i = 0; i < this.ladder.length; i++) {
      this.holds.push(UP_HOLD_MS);
      this.steppedUpAt.push(-Infinity);
    }
    this.levelValue = 0;
    this.restartEvidence();
    this.announce();
  }

  /** The refresh period currently believed in, never shorter than the game's target. */
  get periodMs(): number {
    let min = this.blockPeriod();
    for (const m of this.blockPeriods) if (m < min) min = m;
    return Number.isFinite(min) ? Math.max(min, FRAME_BUDGET_MS) : FRAME_BUDGET_MS;
  }

  /**
   * Feeds one frame, **at the start of the next**: `start` is
   * `performance.now()` as the new frame begins, `cpu` the main-thread ms of
   * the frame that has just ended — so the interval ending now and the work
   * that filled it describe the same frame. Returns the pixel ratio to draw
   * the frame now starting at.
   *
   * `busy` is true while a transition covers the screen; `scene` is any key
   * that changes when she changes space. Either pauses adaptation (see the
   * file comment).
   */
  frame(start: number, cpu: number, busy = false, scene?: string | number): number {
    const interval = this.previousStart < 0 ? 0 : start - this.previousStart;
    this.previousStart = start;
    const sceneChanged = scene !== undefined && this.scene !== undefined && scene !== this.scene;
    if (scene !== undefined) this.scene = scene;
    if (interval <= 0) return this.pixelRatio;
    if (interval > GAP_MS) {
      this.pause(start + PAUSE_AFTER_GAP_MS, true);
      return this.pixelRatio;
    }
    this.notePeriod(interval);
    if (this.ladder.length < 2) return this.pixelRatio;

    const period = this.periodMs;
    if (busy || sceneChanged) this.pause(start + PAUSE_AFTER_BUSY_MS, true);
    else if (cpu > period * HITCH_PERIODS) this.pause(start + PAUSE_AFTER_HITCH_MS, false);
    if (start < this.pausedUntil) return this.pixelRatio;
    if (this.settle > 0) {
      this.settle--;
      return this.pixelRatio;
    }

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
      this.announce();
      return this.pixelRatio;
    }

    if (this.levelValue > 0) {
      if (this.missesInWindow > CALM_MISSES) {
        this.calm = 0;
      } else if (this.window.length >= DOWN_WINDOW / 2) {
        // A window still refilling (after a pause) neither earns calm nor
        // forfeits what was earned.
        this.calm += interval;
        if (this.calm >= this.holds[this.levelValue - 1]!) {
          this.levelValue--;
          this.steppedUpAt[this.levelValue] = start;
          this.changesValue++;
          this.restartEvidence();
          this.announce();
        }
      }
    }
    return this.pixelRatio;
  }

  state(): AdaptiveResolutionState {
    const pausedMs = Math.max(0, this.pausedUntil - this.previousStart);
    const phase: GovernorPhase =
      this.ladder.length < 2
        ? 'fixed'
        : pausedMs > 0
          ? 'paused'
          : this.settle > 0
            ? 'settling'
            : this.levelValue > 0 && this.calm > 0
              ? 'recovering'
              : 'watching';
    return {
      ...this.quality,
      phase,
      periodMs: this.periodMs,
      recentMisses: this.missesInWindow,
      calmMs: this.calm,
      upHoldMs: this.levelValue > 0 ? this.holds[this.levelValue - 1]! : 0,
      pausedMs,
      changes: this.changesValue,
    };
  }

  /** Ignore frames until `until`; `forget` also throws away the evidence so far. */
  private pause(until: number, forget: boolean): void {
    if (until > this.pausedUntil) this.pausedUntil = until;
    if (!forget) return;
    this.window.length = 0;
    this.missesInWindow = 0;
  }

  private announce(): void {
    const quality = this.quality;
    for (const listener of this.listeners) listener(quality);
  }

  private restartEvidence(): void {
    this.window.length = 0;
    this.missesInWindow = 0;
    this.calm = 0;
    this.settle = SETTLE_FRAMES;
  }

  private notePeriod(interval: number): void {
    if (interval >= MIN_PLAUSIBLE_PERIOD_MS) this.noteLow(interval);
    if (++this.blockFrames < PERIOD_BLOCK_FRAMES) return;
    this.blockPeriods.push(this.blockPeriod());
    if (this.blockPeriods.length > PERIOD_BLOCKS) this.blockPeriods.shift();
    this.lowCount = 0;
    this.blockFrames = 0;
  }

  /** Keeps `lows` the block's shortest intervals, ascending. No allocation: this runs every frame. */
  private noteLow(interval: number): void {
    const lows = this.lows;
    let i = this.lowCount;
    if (i === lows.length) {
      if (interval >= lows[i - 1]!) return;
      i--;
    } else {
      this.lowCount++;
    }
    for (; i > 0 && lows[i - 1]! > interval; i--) lows[i] = lows[i - 1]!;
    lows[i] = interval;
  }

  /**
   * The block in progress's period: its shortest interval once the shortest
   * tenth of what it has seen (never fewer than one) is set aside. `Infinity`
   * while it has seen nothing. With one interval there is nothing to set
   * aside, and that one is the answer.
   */
  private blockPeriod(): number {
    if (this.lowCount === 0) return Infinity;
    const setAside = Math.ceil((this.blockFrames * PERIOD_OUTLIERS) / PERIOD_BLOCK_FRAMES);
    return this.lows[Math.min(setAside, this.lowCount - 1)]!;
  }
}

/** `?adaptiveDpr=0` pins the pixel ratio at the screen's cap — for A/B measurement. */
export function adaptiveResolutionRequested(
  search: string = typeof location === 'undefined' ? '' : location.search,
): boolean {
  return new URLSearchParams(search).get('adaptiveDpr') !== '0';
}
