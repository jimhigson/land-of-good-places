import { describe, expect, it } from 'vitest';
import { refusal, type Advance, type FeatureBuilder } from '../procgen/boot/featureBuilder';
import { GroundClaims } from '../src/boot/groundClaims';
import { DEFAULT_SOLVE_BUDGET, ParkSolve, ParkSolveExhausted, type SolveBudget } from '../procgen/boot/parkSolve';

/**
 * **The driver's search is bounded, whatever its builders do** — pure and
 * fast, no park. Each case is a synthetic set of builders that can never be
 * satisfied, and each asserts the solve ends in a {@link ParkSolveExhausted}
 * naming the budget that ran out, inside a number of turns computed from the
 * budget itself (`parkSolve.ts`, "Termination").
 *
 * The turn bound is the red proof. Before the budgets the first case still
 * ended — at `MAX_UNWINDS`, 4000 unwinds in, with `B` advanced 4001 times —
 * and on a real park each of those advances is a path-graph solve, which is
 * how the plan "hung" (fix/sb-bounded handoff: seed 15, 480 s, nowhere near
 * that cap). Asserting termination alone would have passed then; asserting
 * the bound would not.
 */

/** A builder that places one increment at any attempt, and offers `supply` attempts. */
function placer(name: string, deps: readonly string[], supply: number): FeatureBuilder & { advances: number } {
  let placed = false;
  const builder = {
    name,
    deps,
    advances: 0,
    *advance(attempt: number): Generator<number, Advance, void> {
      builder.advances += 1;
      if (placed) return 'done';
      placed = true;
      return { claims: [], label: `attempt=${attempt}` };
    },
    back() {
      placed = false;
    },
    supply: () => supply,
    reset() {
      placed = false;
    },
  };
  return builder;
}

/** A builder that refuses every attempt, naming `consumed` as the decisions it failed against. */
function refuser(
  name: string,
  deps: readonly string[],
  consumed: readonly string[],
  supply = 1,
): FeatureBuilder & { advances: number } {
  const builder = {
    name,
    deps,
    advances: 0,
    // eslint-disable-next-line require-yield
    *advance(): Generator<number, Advance, void> {
      builder.advances += 1;
      return refusal(`${name}: never satisfied`, { consumed });
    },
    back() {},
    supply: () => supply,
    reset() {},
  };
  return builder;
}

function drain(solve: ParkSolve): unknown {
  try {
    for (const _ of solve.run()) {
      // drained
    }
  } catch (error) {
    return error;
  }
  return null;
}

/**
 * The most turns a solve of `builders` refusals can take under `budget` when
 * every refusal reaches rung 3 — each targeted unwind or decision-zero redraw
 * replays at most every builder once, plus its own retries.
 */
function turnBound(budget: SolveBudget, builders: number, retriesPerRefusal: number): number {
  const rung3 = (budget.unwindsPerFeature + budget.decisionZeroPerFeature) * builders + 1;
  return rung3 * (builders + retriesPerRefusal + 1) + builders;
}

describe('a refusal no redraw can answer', () => {
  it('ends the solve, at the default budget, naming the feature and the budget — within the bound', () => {
    // root, then A (infinite supply: the driver must clamp it), then B, which
    // blames A forever. Re-choosing A never helps.
    const root = placer('root', [], 1_000_000);
    const a = placer('A', ['root'], Number.POSITIVE_INFINITY);
    const b = refuser('B', ['A'], ['A']);
    const solve = new ParkSolve(1, [root, a, b], new GroundClaims());
    const error = drain(solve);

    expect(error).toBeInstanceOf(ParkSolveExhausted);
    expect((error as ParkSolveExhausted).budget).toBe('decision-zero-per-feature');
    expect((error as Error).message).toContain('B still refuses');
    expect(solve.stats.exhausted).toMatch(/^decision-zero-per-feature: B still refuses/);
    // B spent exactly its unwinds, then sent the solve to decision zero its quota of times.
    expect(solve.stats.unwindsByFeature['B']).toBe(DEFAULT_SOLVE_BUDGET.unwindsPerFeature);
    expect(solve.stats.escalationsByFeature['B']).toBe(DEFAULT_SOLVE_BUDGET.decisionZeroPerFeature);
    expect(solve.stats.decisionZero).toBe(DEFAULT_SOLVE_BUDGET.decisionZeroPerFeature);
    expect(solve.trace.some((line) => line.includes('DECISION-ZERO (budget: B spent its'))).toBe(true);
    // The bound — the red proof (4001 advances of B before the budgets).
    expect(b.advances).toBe(DEFAULT_SOLVE_BUDGET.unwindsPerFeature + DEFAULT_SOLVE_BUDGET.decisionZeroPerFeature + 1);
    expect(solve.stats.turns).toBeLessThanOrEqual(turnBound(DEFAULT_SOLVE_BUDGET, 3, 0));
  });

  it('ends a pair of builders that refuse each other forever, naming the one still refusing', () => {
    // X refuses every other attempt blaming the root; Y refuses every attempt
    // blaming X. Each answer to one is the other's next refusal.
    const root = placer('root', [], 1_000_000);
    let xTurn = 0;
    let xPlaced = false;
    const x: FeatureBuilder = {
      name: 'X',
      deps: ['root'],
      *advance(attempt) {
        if (xPlaced) return 'done';
        xTurn += 1;
        if (xTurn % 2 === 0) return refusal('X: the root is in the way', { consumed: ['root'] });
        xPlaced = true;
        return { claims: [], label: `attempt=${attempt}` };
      },
      back() {
        xPlaced = false;
      },
      supply: () => Number.POSITIVE_INFINITY,
      reset() {
        xPlaced = false;
      },
    };
    const y = refuser('Y', ['X'], ['X'], 3);
    const budget: Partial<SolveBudget> = { unwindsPerFeature: 5, decisionZeroPerFeature: 4 };
    const solve = new ParkSolve(2, [root, x, y], new GroundClaims(), budget);
    const error = drain(solve);

    expect(error).toBeInstanceOf(ParkSolveExhausted);
    expect((error as ParkSolveExhausted).budget).toBe('decision-zero-per-feature');
    const named = /^decision-zero-per-feature: (\w+) still refuses/.exec(solve.stats.exhausted ?? '')?.[1];
    expect(['X', 'Y']).toContain(named);
    expect(solve.stats.unwindsByFeature[named as string]).toBe(5);
    expect(solve.stats.escalationsByFeature[named as string]).toBe(4);
    expect(solve.stats.turns).toBeLessThanOrEqual(turnBound({ ...DEFAULT_SOLVE_BUDGET, ...budget }, 3, 3));
  });

  it('clamps a runaway supply: a refusal with nothing before it ends after the attempts cap, not never', () => {
    const lone = refuser('lone', [], [], Number.POSITIVE_INFINITY);
    const solve = new ParkSolve(3, [lone], new GroundClaims(), { attemptsPerDecision: 10 });
    const error = drain(solve);
    expect(error).toBeInstanceOf(ParkSolveExhausted);
    expect((error as ParkSolveExhausted).budget).toBe('nothing-to-unwind');
    expect(lone.advances).toBe(10);
  });
});

describe('a builder that never finishes', () => {
  it('is stopped by the turn budget, named', () => {
    const endless: FeatureBuilder = {
      name: 'endless',
      deps: [],
      *advance(attempt) {
        return { claims: [], label: `attempt=${attempt}` };
      },
      back() {},
      supply: () => 1,
      reset() {},
    };
    const solve = new ParkSolve(4, [endless], new GroundClaims(), { turns: 500 });
    const error = drain(solve);
    expect(error).toBeInstanceOf(ParkSolveExhausted);
    expect((error as ParkSolveExhausted).budget).toBe('turns');
    expect(solve.stats.turns).toBe(500);
    expect(solve.stats.exhausted).toMatch(/^turns: 500 turns without finishing \(0 of 1 features done\)/);
  });
});

describe('the control', () => {
  it('a satisfiable park solves with no budget touched', () => {
    const root = placer('root', [], 5);
    const a = placer('A', ['root'], 5);
    const solve = new ParkSolve(5, [root, a], new GroundClaims());
    expect(drain(solve)).toBeNull();
    expect(solve.stats.exhausted).toBeNull();
    expect(solve.stats.unwinds).toBe(0);
  });
});
