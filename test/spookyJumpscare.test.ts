import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/mathUtils.ts';
import {
  gapSecondsFor,
  HOLD_EXTENSION_SECONDS,
  JUMPSCARE_TUNING,
  JumpscareDirector,
  MAX_HOLD_EXTENSION_SECONDS,
  windowSecondsFor,
  type JumpscareTuning,
} from '../src/minigames/spookyHouse/jumpscare.ts';

/**
 * Unit tests for the jump-scare cycle director (#293). Pure and fast — no
 * three.js, no DOM, no canvas — same reasoning as `solveScheduler.test.ts`:
 * this proves the *engine* (when the face jumps out, how long the reflex
 * window stays open, what counts as a hit) in isolation from the scene it
 * drives in `SpookyHouse.ts`.
 *
 * Two kinds of test here:
 *
 *  1. The state-machine mechanics — cycle count, window/gap timing, one-hit-
 *     per-cycle scoring, frame-rate independence — driven with a fake clock
 *     exactly like `SolveScheduler`'s tests.
 *  2. A Monte-Carlo fairness check against the reasoned reaction-time model
 *     written up at the bottom of `jumpscare.ts` ("Where the reflex window
 *     came from"). This is the "tune the timing empirically" half of the
 *     issue: there is no browser in this session to press a real child's
 *     thumb against a real screen (CLAUDE.md — QA is not optional, and this
 *     PR says so plainly), so the empirical measurement is against a
 *     documented model instead. If a future edit loosens or tightens
 *     `windowStartSeconds`/`windowEndSeconds` enough to fall out of a sane
 *     difficulty band, this goes red and says so with real percentages, not
 *     a bare "expected true".
 */

describe('windowSecondsFor', () => {
  it('starts at windowStartSeconds and ends at windowEndSeconds', () => {
    expect(windowSecondsFor(0)).toBeCloseTo(JUMPSCARE_TUNING.windowStartSeconds, 6);
    expect(windowSecondsFor(JUMPSCARE_TUNING.cycles - 1)).toBeCloseTo(
      JUMPSCARE_TUNING.windowEndSeconds,
      6,
    );
  });

  it('tightens monotonically — no cycle is easier than the one before it', () => {
    let previous = windowSecondsFor(0);
    for (let i = 1; i < JUMPSCARE_TUNING.cycles; i += 1) {
      const current = windowSecondsFor(i);
      expect(current).toBeLessThanOrEqual(previous);
      previous = current;
    }
  });

  it('clears the mouth double-tap floor: a reflex window is not an impossible target', () => {
    // A reflex window has to fit a whole reaction *plus* one tap landing, so
    // it must sit comfortably above the fastest two *already-decided* taps
    // this same mouth target can already tell apart (`DOUBLE_TAP_MS`,
    // `SpookyHouse.ts`) — a sanity floor, not the tuning itself.
    const DOUBLE_TAP_SECONDS = 0.32;
    expect(windowSecondsFor(JUMPSCARE_TUNING.cycles - 1)).toBeGreaterThan(DOUBLE_TAP_SECONDS);
  });
});

describe('gapSecondsFor', () => {
  it('stays within [min, max] of the configured range at cycle 0', () => {
    const rng = new Rng(1);
    const [min, max] = JUMPSCARE_TUNING.gapRange;
    for (let i = 0; i < 200; i += 1) {
      const gap = gapSecondsFor(0, rng);
      expect(gap).toBeGreaterThanOrEqual(min);
      expect(gap).toBeLessThanOrEqual(max);
    }
  });

  it('shrinks the expected gap for later cycles — the escalating rhythm', () => {
    const rng = new Rng(2);
    const sample = (cycleIndex: number, trials: number): number => {
      let total = 0;
      for (let i = 0; i < trials; i += 1) total += gapSecondsFor(cycleIndex, rng);
      return total / trials;
    };
    const early = sample(1, 500);
    const late = sample(JUMPSCARE_TUNING.cycles - 1, 500);
    expect(late).toBeLessThan(early);
  });

  it('never shrinks the gap below the 40% floor, however many cycles have passed', () => {
    const rng = new Rng(3);
    const [min] = JUMPSCARE_TUNING.gapRange;
    const gap = gapSecondsFor(50, rng); // far past any real cycle count — the floor must still hold
    expect(gap).toBeGreaterThanOrEqual(min * 0.4 - 1e-9);
  });
});

describe('JumpscareDirector', () => {
  it('fires exactly `cycles` jump-outs, in order, each followed by a retreat', () => {
    const director = new JumpscareDirector(new Rng(42));
    const kinds: string[] = [];
    const cycleIndices: number[] = [];
    // One big step easily covers the whole schedule (worst case ~28.5s —
    // see `jumpscare.ts`'s tuning comment); this also proves large-dt safety.
    for (const event of director.update(120)) {
      kinds.push(event.kind);
      if (event.kind === 'jumpOut') cycleIndices.push(event.cycleIndex);
    }
    expect(director.finished).toBe(true);
    expect(cycleIndices).toEqual([0, 1, 2, 3, 4, 5]);
    expect(kinds.filter((k) => k === 'jumpOut')).toHaveLength(JUMPSCARE_TUNING.cycles);
    expect(kinds.filter((k) => k === 'retreat')).toHaveLength(JUMPSCARE_TUNING.cycles);
    expect(kinds.filter((k) => k === 'complete')).toHaveLength(1);
    // jumpOut/retreat strictly alternate, one pair per cycle.
    const jumpAndRetreat = kinds.filter((k) => k === 'jumpOut' || k === 'retreat');
    for (let i = 0; i < jumpAndRetreat.length; i += 2) {
      expect(jumpAndRetreat[i]).toBe('jumpOut');
      expect(jumpAndRetreat[i + 1]).toBe('retreat');
    }
  });

  it('builds the same event order whatever the frame cadence — one big step or many small ones', () => {
    const run = (dtStep: number): string[] => {
      const director = new JumpscareDirector(new Rng(7));
      const log: string[] = [];
      let elapsed = 0;
      while (!director.finished && elapsed < 120) {
        for (const event of director.update(dtStep)) log.push(event.kind);
        elapsed += dtStep;
      }
      return log;
    };
    expect(run(1 / 60)).toEqual(run(0.25));
  });

  it('completes comfortably inside SpookyHouse.ts\'s 30s VISIT_SECONDS across many seeds', () => {
    const VISIT_SECONDS = 30;
    for (let seed = 0; seed < 50; seed += 1) {
      const director = new JumpscareDirector(new Rng(seed));
      let elapsed = 0;
      const dt = 1 / 30;
      while (!director.finished && elapsed < VISIT_SECONDS) {
        director.update(dt);
        elapsed += dt;
      }
      expect(director.finished).toBe(true);
    }
  });

  it('scores a hit only while a window is open', () => {
    const director = new JumpscareDirector(new Rng(11));
    expect(director.registerHit()).toBe(false); // waiting for the first delay — nothing to hit yet
    expect(director.score).toBe(0);

    director.update(JUMPSCARE_TUNING.firstDelaySeconds + 0.001); // now inside cycle 0's window
    expect(director.windowOpen).toBe(true);
    expect(director.registerHit()).toBe(true);
    expect(director.score).toBe(1);
  });

  it('only scores once per cycle — extra taps in the same window are free, not extra points', () => {
    const director = new JumpscareDirector(new Rng(12));
    director.update(JUMPSCARE_TUNING.firstDelaySeconds + 0.001);
    expect(director.registerHit()).toBe(true);
    expect(director.registerHit()).toBe(false);
    expect(director.registerHit()).toBe(false);
    expect(director.score).toBe(1);
  });

  it('a hit after the window has closed does not score', () => {
    const director = new JumpscareDirector(new Rng(13));
    const windowSeconds = windowSecondsFor(0);
    director.update(JUMPSCARE_TUNING.firstDelaySeconds + windowSeconds + 0.001); // window 0 has just closed
    expect(director.windowOpen).toBe(false);
    expect(director.registerHit()).toBe(false);
    expect(director.score).toBe(0);
  });

  // ---------------------------------------------------- mouth-tap hold (#294)

  it('extendHold pushes the window\'s close out, tap by tap, but stops applying past the 2s cap', () => {
    const director = new JumpscareDirector(new Rng(20));
    director.update(JUMPSCARE_TUNING.firstDelaySeconds + 0.001); // now inside cycle 0's window
    expect(director.windowOpen).toBe(true);
    const windowSeconds = windowSecondsFor(0);

    // Tap the mouth far more than enough to blow past the cap: 20 taps of
    // HOLD_EXTENSION_SECONDS each request 20 * 0.3s = 6s, well over the 2s cap.
    for (let i = 0; i < 20; i += 1) director.extendHold(HOLD_EXTENSION_SECONDS);

    // The window should now close at (original close) + the 2s cap, not 6s
    // later — advance to just short of that and it must still be open.
    const remaining = windowSeconds - 0.001 + MAX_HOLD_EXTENSION_SECONDS;
    const beforeClose = director.update(remaining - 0.01);
    expect(beforeClose).toHaveLength(0);
    expect(director.windowOpen).toBe(true);

    // Taps offered after the cap is already spent do nothing further.
    director.extendHold(HOLD_EXTENSION_SECONDS);
    director.extendHold(HOLD_EXTENSION_SECONDS);

    const afterClose = director.update(0.02);
    expect(afterClose.some((e) => e.kind === 'retreat')).toBe(true);
    expect(director.windowOpen).toBe(false);
  });

  it('registerHit alone — what tapping the EYE does — never extends the window; only extendHold does', () => {
    const director = new JumpscareDirector(new Rng(21));
    director.update(JUMPSCARE_TUNING.firstDelaySeconds + 0.001); // now inside cycle 0's window
    const windowSeconds = windowSecondsFor(0);

    // Simulate many eye taps: registerHit only, exactly what tapEye() calls.
    for (let i = 0; i < 10; i += 1) director.registerHit();

    // The window still closes on its original, un-extended schedule.
    const remaining = windowSeconds - 0.001;
    const beforeClose = director.update(remaining - 0.001);
    expect(beforeClose).toHaveLength(0);
    const afterClose = director.update(0.002);
    expect(afterClose.some((e) => e.kind === 'retreat')).toBe(true);
  });

  it('no taps at all leaves the window\'s timing exactly as it was before this feature existed', () => {
    const director = new JumpscareDirector(new Rng(22));
    director.update(JUMPSCARE_TUNING.firstDelaySeconds + 0.001); // now inside cycle 0's window
    const windowSeconds = windowSecondsFor(0);

    // Nothing tapped, hit or extended — the window closes exactly at
    // firstDelaySeconds + windowSeconds, the same schedule windowSecondsFor
    // has always described.
    const remaining = windowSeconds - 0.001;
    const beforeClose = director.update(remaining - 0.001);
    expect(beforeClose).toHaveLength(0);
    expect(director.windowOpen).toBe(true);
    const afterClose = director.update(0.002);
    expect(afterClose.some((e) => e.kind === 'retreat')).toBe(true);
    expect(director.windowOpen).toBe(false);
  });

  it('the hold-extension budget resets for each new cycle — no carry-over credit', () => {
    const director = new JumpscareDirector(new Rng(23));
    director.update(JUMPSCARE_TUNING.firstDelaySeconds + 0.001); // cycle 0's window open
    // Spend the whole cap on cycle 0.
    for (let i = 0; i < 20; i += 1) director.extendHold(HOLD_EXTENSION_SECONDS);

    // Run all the way through cycle 0's (extended) retreat and into cycle 1's
    // window, reading cycle 1's own window length off its `jumpOut` event
    // rather than assuming anything about internal state.
    let cycle1WindowSeconds: number | null = null;
    let elapsed = 0;
    const dt = 1 / 30;
    while (cycle1WindowSeconds === null && elapsed < 60) {
      for (const event of director.update(dt)) {
        if (event.kind === 'jumpOut' && event.cycleIndex === 1) {
          cycle1WindowSeconds = event.windowSeconds;
        }
      }
      elapsed += dt;
    }
    expect(cycle1WindowSeconds).not.toBeNull();
    expect(director.windowOpen).toBe(true);
    const win = cycle1WindowSeconds as number;

    // Spend most of a fresh cap. If cycle 0's cap had NOT reset (a bug: still
    // sitting maxed-out from cycle 0), this would be a no-op — room would be
    // zero — and the window would close on its natural, un-extended
    // schedule; because a fresh 2s cap is available, it does not.
    const extension = MAX_HOLD_EXTENSION_SECONDS - 0.1;
    director.extendHold(extension);

    // Comfortably past the natural close, comfortably short of natural close
    // + the extension just applied.
    const stillOpen = director.update(win + extension / 2);
    expect(stillOpen).toHaveLength(0);
    expect(director.windowOpen).toBe(true);

    // And it does eventually close once the (reset, fresh) extended budget
    // itself runs out.
    const afterClose = director.update(extension);
    expect(afterClose.some((e) => e.kind === 'retreat')).toBe(true);
  });

  it('a missed cycle costs nothing — no fail state, the next cycle still happens on schedule', () => {
    const director = new JumpscareDirector(new Rng(14));
    let elapsed = 0;
    const dt = 1 / 30;
    let sawSecondJumpOut = false;
    while (!director.finished && elapsed < 30) {
      for (const event of director.update(dt)) {
        // Deliberately never call registerHit() — every window is missed.
        if (event.kind === 'jumpOut' && event.cycleIndex === 1) sawSecondJumpOut = true;
      }
      elapsed += dt;
    }
    expect(sawSecondJumpOut).toBe(true);
    expect(director.score).toBe(0);
    expect(director.cycleCount).toBe(JUMPSCARE_TUNING.cycles);
  });
});

// ------------------------------------------------------------------ fairness

/** Standard normal sample via Box-Muller, drawn from the game's own seeded `Rng`. */
function gaussian(rng: Rng): number {
  const u1 = Math.max(rng.unit(), Number.EPSILON); // avoid log(0)
  const u2 = rng.unit();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * The reasoned child-reaction-time model from `jumpscare.ts`'s "Where the
 * reflex window came from": mean 600 ms, SD 180 ms, floored at 200 ms (faster
 * than that is not a reaction). Returns seconds.
 */
function simulatedChildReactionSeconds(rng: Rng): number {
  const MEAN_S = 0.6;
  const SD_S = 0.18;
  const FLOOR_S = 0.2;
  return Math.max(FLOOR_S, MEAN_S + gaussian(rng) * SD_S);
}

/** Fraction of `trials` simulated reactions that land inside `windowSeconds`. */
function hitRate(windowSeconds: number, rng: Rng, trials: number): number {
  let hits = 0;
  for (let i = 0; i < trials; i += 1) {
    if (simulatedChildReactionSeconds(rng) <= windowSeconds) hits += 1;
  }
  return hits / trials;
}

describe('reflex window fairness (Monte-Carlo against the reasoned reaction-time model)', () => {
  const TRIALS = 20_000;

  it('cycle 0 is a near-gimme — confidence-building, not a test yet', () => {
    const rate = hitRate(windowSecondsFor(0), new Rng(101), TRIALS);
    expect(rate).toBeGreaterThan(0.85);
  });

  it('the last cycle is a genuine coin-flip-ish challenge, not a wall', () => {
    const rate = hitRate(windowSecondsFor(JUMPSCARE_TUNING.cycles - 1), new Rng(102), TRIALS);
    expect(rate).toBeGreaterThan(0.45);
    expect(rate).toBeLessThan(0.75);
  });

  it('the whole-visit average sits in a fun-and-fair band for a six-year-old', () => {
    const rng = new Rng(103);
    let total = 0;
    for (let i = 0; i < JUMPSCARE_TUNING.cycles; i += 1) {
      total += hitRate(windowSecondsFor(i), rng, TRIALS);
    }
    const average = total / JUMPSCARE_TUNING.cycles;
    // Neither "always wins" (not a test) nor "usually loses" (not fair to a
    // young child, and this game's whole ethos is nobody loses here).
    expect(average).toBeGreaterThan(0.65);
    expect(average).toBeLessThan(0.9);
  });

  it('difficulty escalates: the last cycle is meaningfully harder than the first', () => {
    const first = hitRate(windowSecondsFor(0), new Rng(104), TRIALS);
    const last = hitRate(windowSecondsFor(JUMPSCARE_TUNING.cycles - 1), new Rng(105), TRIALS);
    expect(first - last).toBeGreaterThan(0.15);
  });

  it('a custom tuning with a much shorter window would fail the fairness band (the test can fail)', () => {
    // Proves this suite is actually discriminating rather than incapable of
    // failing (CLAUDE.md — "green can mean incapable of failing"): a window
    // an order of magnitude tighter than the tuned one should read as unfair.
    const harsh: JumpscareTuning = { ...JUMPSCARE_TUNING, windowEndSeconds: 0.05 };
    const rate = hitRate(windowSecondsFor(harsh.cycles - 1, harsh), new Rng(106), TRIALS);
    expect(rate).toBeLessThan(0.1);
  });
});
