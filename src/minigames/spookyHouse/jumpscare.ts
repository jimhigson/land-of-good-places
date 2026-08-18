import type { Rng } from '../../core/mathUtils';

/**
 * The jump-scare cycle director (#293): a small, framework-free state machine
 * that says *when* the face should lunge out, how long the reflex window
 * stays open, and whether a tap landed inside it. It knows nothing about
 * three.js, the DOM or sound — `SpookyHouse.ts` drives it with `dt` every
 * frame and reacts to the events it hands back. Kept pure and dependency-free
 * the same way `boot/solveScheduler.ts` is, so it can be driven by a fake
 * clock in `test/spookyJumpscare.test.ts` without a canvas or a scene in
 * sight.
 *
 * One cycle: **waiting** (a quiet gap) → **out** (the reflex window: the face
 * is leaning in and eyes/mouth are hittable) → **retreating** (the lean
 * spring is still settling back, nothing scores any more) → back to
 * **waiting** for the next cycle, or **done** once `tuning.cycles` have all
 * happened.
 *
 * `SpookyHouse.ts`'s existing `tapEye`/`tapMouth` handlers are untouched by
 * this — it only *adds* a call to {@link JumpscareDirector.registerHit} at
 * the top of each, so the eye still pops and the mouth still squirts or
 * pours candy exactly as it did before, jump-scare window open or not. That
 * is the "reuse the existing hit-target mechanic" half of #293's ask; this
 * file is only the "make it a repeating, timed reflex test" half.
 */

export type JumpscareEvent =
  | {
      readonly kind: 'jumpOut';
      readonly cycleIndex: number;
      readonly cycleCount: number;
      /** How long the reflex window stays open this cycle, seconds. */
      readonly windowSeconds: number;
    }
  | {
      readonly kind: 'retreat';
      readonly cycleIndex: number;
      readonly cycleCount: number;
      /** Whether a tap registered inside this cycle's window before it closed. */
      readonly hit: boolean;
    }
  | {
      readonly kind: 'complete';
      readonly cycleCount: number;
    };

/**
 * Timing constants for the cycle.
 *
 * `windowStartSeconds` / `windowEndSeconds` are the one pair of numbers here
 * that actually needed measuring rather than guessing — see the "Where the
 * reflex window came from" block at the bottom of this file, and the
 * Monte-Carlo fairness test in `test/spookyJumpscare.test.ts` that checks
 * they still land in a sane difficulty band whenever either changes.
 *
 * Everything else is a pacing choice made to fit `SpookyHouse.ts`'s
 * `VISIT_SECONDS` (30s): with these numbers the cycle schedule sums to
 * 22.4s–28.5s depending on how the random gaps land (see the same comment
 * block), which is comfortably inside the visit with room for the toy-box
 * play (the eye-pop, the squirt, the candy double-tap) the family already
 * has either side of it.
 */
/**
 * A plain `number`-typed interface, not `typeof JUMPSCARE_TUNING` off an
 * `as const` object — the fairness test in `test/spookyJumpscare.test.ts`
 * builds a deliberately-harsh variant (`{ ...JUMPSCARE_TUNING,
 * windowEndSeconds: 0.05 }`) to prove the test can actually fail, which needs
 * `windowEndSeconds` to accept any number, not just the literal `0.65`.
 */
export interface JumpscareTuning {
  readonly cycles: number;
  readonly firstDelaySeconds: number;
  readonly windowStartSeconds: number;
  readonly windowEndSeconds: number;
  readonly retreatSeconds: number;
  readonly gapRange: readonly [number, number];
  readonly gapShrinkPerCycle: number;
}

export const JUMPSCARE_TUNING: JumpscareTuning = {
  /** Issue #293 asked for "about 5-6" jump-scares per visit. 6 fits the visit's time budget with room to spare — see above. */
  cycles: 6,
  /** Seconds from the visit starting to the very first jump-scare — long enough that walking in isn't itself the scare. */
  firstDelaySeconds: 3.2,
  /** Reflex window on cycle 0: generous, so the first jump-scare teaches the pattern rather than testing it. */
  windowStartSeconds: 0.85,
  /** Reflex window on the last cycle: the tight one, a genuine test. */
  windowEndSeconds: 0.65,
  /**
   * Seconds the face's own retreat spring is given to settle before the gap
   * to the next cycle starts counting. Roughly matches how long `face.ts`'s
   * `lean` spring (`lean.update(dt, 40, 7)`) takes to settle back from a full
   * lean by eye — not read back from the spring itself, since that would
   * make this module depend on three.js for a number that only needs to be
   * "about right", but keep them in the same ballpark if either changes.
   */
  retreatSeconds: 0.55,
  /** Random gap, seconds, from one cycle's retreat finishing to the next jump-out — the quiet stretch that makes the *next* one land as a surprise. */
  gapRange: [3.0, 4.6],
  /**
   * Each completed cycle shrinks the *next* gap by this fraction of the base
   * range (floored at 40%, so the last gap is still a real pause and not a
   * flicker) — the "escalating, fun jump-scare rhythm" the family asked for:
   * later scares come at you a little quicker than the first ones.
   */
  gapShrinkPerCycle: 0.08,
};

/**
 * Linear interpolation from `windowStartSeconds` to `windowEndSeconds` across
 * the cycles, so the reflex window tightens steadily rather than jumping
 * straight from generous to hard.
 */
export function windowSecondsFor(
  cycleIndex: number,
  tuning: JumpscareTuning = JUMPSCARE_TUNING,
): number {
  const { cycles, windowStartSeconds, windowEndSeconds } = tuning;
  if (cycles <= 1) return windowStartSeconds;
  const t = Math.min(1, Math.max(0, cycleIndex / (cycles - 1)));
  return windowStartSeconds + (windowEndSeconds - windowStartSeconds) * t;
}

/**
 * The gap before cycle `cycleIndex` jumps out, shrinking a little each cycle
 * for the escalating rhythm.
 */
export function gapSecondsFor(
  cycleIndex: number,
  rng: Rng,
  tuning: JumpscareTuning = JUMPSCARE_TUNING,
): number {
  const shrink = Math.max(0.4, 1 - tuning.gapShrinkPerCycle * cycleIndex);
  const [min, max] = tuning.gapRange;
  return rng.range(min, max) * shrink;
}

type Phase = 'waiting' | 'out' | 'retreating' | 'done';

export class JumpscareDirector {
  private phase: Phase = 'waiting';
  private timer: number;
  private cycleIndex = 0;
  private hitThisCycle = false;
  private hitCount = 0;

  private readonly rng: Rng;
  private readonly tuning: JumpscareTuning;

  constructor(rng: Rng, tuning: JumpscareTuning = JUMPSCARE_TUNING) {
    this.rng = rng;
    this.tuning = tuning;
    this.timer = tuning.firstDelaySeconds;
  }

  /** How many reflex windows were hit in time, out of {@link cycleCount}. */
  get score(): number {
    return this.hitCount;
  }

  get cycleCount(): number {
    return this.tuning.cycles;
  }

  /** True only on the frames a reflex window is open — the face is out and a tap on eye/mouth should score. */
  get windowOpen(): boolean {
    return this.phase === 'out';
  }

  get finished(): boolean {
    return this.phase === 'done';
  }

  /**
   * Advance by `dt` seconds. May cross more than one phase boundary in a
   * single call (a dropped frame, or a test fast-forwarding by whole
   * seconds), so this returns every event that fired, in order, rather than
   * just the first — and carries any overshoot into the next phase's timer
   * instead of resetting to it, so the schedule stays accurate under an
   * uneven frame rate.
   */
  update(dt: number): JumpscareEvent[] {
    const events: JumpscareEvent[] = [];
    this.timer -= dt;
    // `this.phase` re-checked every iteration, not hoisted, because `advance()`
    // is exactly what changes it — the loop is how more than one phase
    // boundary gets crossed in a single big `dt`.
    while (this.phase !== 'done' && this.timer <= 0) {
      const event = this.advance();
      if (event) events.push(event);
    }
    return events;
  }

  /**
   * A tap landed on a reflex target (either eye, or the mouth) this frame.
   * Scores once per cycle — a second tap in the same still-open window is
   * free enthusiasm, not a second point. Returns whether this particular tap
   * was the one that scored, so the caller can decide whether to celebrate.
   */
  registerHit(): boolean {
    if (this.phase !== 'out' || this.hitThisCycle) return false;
    this.hitThisCycle = true;
    this.hitCount += 1;
    return true;
  }

  private advance(): JumpscareEvent | null {
    if (this.phase === 'waiting') {
      this.phase = 'out';
      this.hitThisCycle = false;
      const windowSeconds = windowSecondsFor(this.cycleIndex, this.tuning);
      this.timer += windowSeconds;
      return {
        kind: 'jumpOut',
        cycleIndex: this.cycleIndex,
        cycleCount: this.tuning.cycles,
        windowSeconds,
      };
    }

    if (this.phase === 'out') {
      this.phase = 'retreating';
      this.timer += this.tuning.retreatSeconds;
      return {
        kind: 'retreat',
        cycleIndex: this.cycleIndex,
        cycleCount: this.tuning.cycles,
        hit: this.hitThisCycle,
      };
    }

    // 'retreating' -> the next cycle's wait, or done.
    this.cycleIndex += 1;
    if (this.cycleIndex >= this.tuning.cycles) {
      this.phase = 'done';
      return { kind: 'complete', cycleCount: this.tuning.cycles };
    }
    this.phase = 'waiting';
    this.timer += gapSecondsFor(this.cycleIndex, this.rng, this.tuning);
    return null;
  }
}

/**
 * Where the reflex window came from.
 *
 * There is no chrome-devtools access in the session that built this (CLAUDE.md
 * — "no browser access this session"), so this was not tuned against a real
 * six-year-old's thumb. It was tuned against a reasoned model instead, and the
 * model, the target, and the result are all written down here so a human
 * playtester has something concrete to confirm or correct rather than a bare
 * number:
 *
 * - **Model**: a child's simple visual-reaction-to-tap latency as a normal
 *   distribution, mean 600 ms, SD 180 ms, floored at 200 ms (faster than that
 *   is not a reaction, it's a guess). 600 ms sits in the middle of the range
 *   the developmental-psychology literature reports for unprimed simple
 *   reaction time at this age (studies of 6-8-year-olds typically land
 *   440-700 ms depending on task); the SD is wide because a six-year-old's
 *   reaction time is far less consistent than an adult's. This game already
 *   has one measured constant in the same neighbourhood to sanity-check
 *   against: `DOUBLE_TAP_MS` (320 ms) in `SpookyHouse.ts`, which is how fast
 *   this same mouth-tap target can register *two separate, already-decided*
 *   taps — i.e. a floor on motor speed with no reaction-time component. A
 *   reflex window has to clear a full reaction *plus* one tap, so it must sit
 *   comfortably above 320 ms, and every number below does.
 * - **Target**: cycle 0 should be a near-gimme (confidence-building, not a
 *   test yet — the family's "not jarring" ask) and the last cycle should be a
 *   real coin-flip-ish challenge, because that is what "genuinely test
 *   reflexes" means for a game with no fail state: some misses, most hits.
 * - **Result** (`test/spookyJumpscare.test.ts`'s Monte-Carlo test measures
 *   this directly against the actual `JUMPSCARE_TUNING` values, so it moves
 *   if the tuning does): cycle 0's 0.85s window clears the model about 92% of
 *   the time; the last cycle's 0.65s window clears it about 61% of the time;
 *   the six-cycle average is about 78%. That is the "tight enough to
 *   genuinely test reflexes, but fair for a young child" the issue asked for
 *   — asserted, not eyeballed, but still owed a real playtest before anyone
 *   calls it finished.
 */
