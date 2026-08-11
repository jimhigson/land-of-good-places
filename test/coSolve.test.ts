import { describe, it, expect } from 'vitest';
import {
  CoSolveEngine,
  CoSolveUnsolvable,
  PlacementField,
  type CoSolveFeature,
  type Obstacle,
} from '../src/boot/coSolve.ts';

/**
 * Unit tests for the cooperative backtracking engine. Pure and fast — no park, no
 * seed, no canvas — so they prove the *engine* in isolation: that features
 * round-robin against the shared field, that a stuck one makes a committed
 * neighbour step aside, that the result is the same whatever the frame cadence,
 * and that a hopeless case fails cleanly rather than hanging.
 *
 * The scenarios are deliberately geometric-but-tiny: a handful of discs and a
 * handful of slots, arranged so the *greedy* commit order paints a feature into a
 * corner and only a backtrack can free it — which is exactly the situation the
 * real park is in when the railway wants the ground a stall took.
 */

/**
 * A feature that claims a single disc. It tries `candidates` in **preference
 * order rotated by `attempt`**, yielding once per candidate examined and returning
 * the first that fits — or throwing {@link CoSolveUnsolvable} when none do.
 *
 * Rotation, not truncation, is what a restart wants: a feature with several
 * options prefers a *different* one after being backtracked (so it does not
 * immediately re-grab the ground it was just asked to give up), while a feature
 * with a single option keeps re-trying it against the now-changed field — which
 * is exactly the spot a backtrack was meant to free. This mirrors the real rail
 * solvers, whose seed salt is their `attempt`.
 */
function placer(
  name: string,
  candidates: readonly (readonly [number, number])[],
  radius: number,
  extra: { blockers?: readonly string[]; tick?: (ms: number) => void } = {},
): CoSolveFeature {
  return {
    name,
    ...(extra.blockers ? { blockers: () => extra.blockers as readonly string[] } : {}),
    *place(field: PlacementField, attempt: number): Generator<number, readonly Obstacle[], void> {
      const pivot = candidates.length ? attempt % candidates.length : 0;
      const order = [...candidates.slice(pivot), ...candidates.slice(0, pivot)];
      for (let i = 0; i < order.length; i += 1) {
        extra.tick?.(10);
        yield i;
        const [x, z] = order[i] as readonly [number, number];
        if (field.clear(x, z, radius, name)) return [{ x, z, reach: radius }];
      }
      throw new CoSolveUnsolvable(`${name}: no candidate fits`);
    },
  };
}

/** Drives an engine to completion in one big frame; guards against a hang. */
function solveAll(engine: CoSolveEngine, cap = 100_000): void {
  let advances = 0;
  while (!engine.done && !engine.failed) {
    engine.advance(Number.POSITIVE_INFINITY);
    advances += 1;
    if (advances > cap) throw new Error('did not converge');
  }
}

/** Where each feature's single disc landed, for comparing two runs. */
function placements(engine: CoSolveEngine): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of engine.committedOrder) {
    const [o] = engine.field.obstaclesOf(name);
    if (o) out[name] = `${o.x},${o.z}`;
  }
  return out;
}

describe('CoSolveEngine', () => {
  it('round-robins features and commits them all when nothing conflicts', () => {
    const engine = new CoSolveEngine(
      [
        placer('a', [[0, 0]], 2),
        placer('b', [[10, 0]], 2),
        placer('c', [[20, 0]], 2),
      ],
      { now: () => 0 },
    );
    solveAll(engine);
    expect(engine.done).toBe(true);
    expect(engine.backtracks).toBe(0);
    // All three placed, none overlapping.
    expect(engine.field.committedFeatures().sort()).toEqual(['a', 'b', 'c']);
  });

  it('backtracks a committed neighbour so a stuck feature can be placed', () => {
    // Three 1-metre-ish slots. `a` will greedily take slot 0 first; `b` fits ONLY
    // in slot 0 and `c` ONLY in slot 10. So the greedy order paints `b` into a
    // corner, and the only way everyone fits is for `a` to give up slot 0.
    const engine = new CoSolveEngine(
      [
        placer('a', [[0, 0], [10, 0], [20, 0]], 2),
        placer('b', [[0, 0]], 2),
        placer('c', [[10, 0]], 2),
      ],
      { now: () => 0 },
    );
    solveAll(engine);
    expect(engine.done).toBe(true);
    expect(engine.backtracks).toBeGreaterThanOrEqual(1);
    // The only assignment that fits: b@0, c@10, a pushed out to 20.
    expect(placements(engine)).toEqual({ a: '20,0', b: '0,0', c: '10,0' });
    // And the field really is conflict-free.
    for (const name of ['a', 'b', 'c']) {
      const [o] = engine.field.obstaclesOf(name);
      if (o) expect(engine.field.clear(o.x, o.z, o.reach, name)).toBe(true);
    }
  });

  it('uses a feature\'s blockers hint to choose whom to back out', () => {
    // `b` fits only in slot 0; it names `a` as its blocker. `a` and `pad` both sit
    // on slot 0 initially in commit order a, pad — the chronological default would
    // back out `pad` (most recent), but `pad` is not in b's way, so the hint must
    // steer the backtrack to `a`.
    const seen: string[] = [];
    const engine = new CoSolveEngine(
      [
        placer('a', [[0, 0], [30, 0]], 2),
        placer('pad', [[100, 0]], 2),
        {
          name: 'b',
          blockers: () => ['a'],
          *place(field, attempt) {
            seen.push(`b:${attempt}`);
            yield 0;
            if (field.clear(0, 0, 2, 'b')) return [{ x: 0, z: 0, reach: 2 }];
            throw new CoSolveUnsolvable('b: needs slot 0');
          },
        },
      ],
      { now: () => 0 },
    );
    solveAll(engine);
    expect(engine.done).toBe(true);
    // `pad` never moved (it was never in the way); `a` did.
    expect(placements(engine).pad).toBe('100,0');
    expect(placements(engine).b).toBe('0,0');
    expect(placements(engine).a).toBe('30,0');
  });

  it('reaches the same configuration whatever the frame budget', () => {
    // A clock that advances on every read, so a small budget genuinely slices the
    // search across many frames while a huge one does it in one — and the result
    // must not care which.
    const incrementing = () => {
      let t = 0;
      return () => (t += 1);
    };
    const build = (): CoSolveEngine =>
      new CoSolveEngine(
        [
          placer('a', [[0, 0], [10, 0], [20, 0]], 2),
          placer('b', [[0, 0]], 2),
          placer('c', [[10, 0]], 2),
        ],
        { now: incrementing() },
      );

    const oneFrame = build();
    solveAll(oneFrame);

    const manyFrames = build();
    let advances = 0;
    while (!manyFrames.done && !manyFrames.failed) {
      manyFrames.advance(3); // a few slices per frame at most
      advances += 1;
      if (advances > 100_000) throw new Error('did not converge');
    }

    expect(advances).toBeGreaterThan(1); // it really was spread over many frames
    expect(placements(manyFrames)).toEqual(placements(oneFrame));
    expect(manyFrames.committedOrder).toEqual(oneFrame.committedOrder);
    expect(manyFrames.backtracks).toBe(oneFrame.backtracks);
    expect(manyFrames.sliceCounts).toEqual(oneFrame.sliceCounts);
  });

  it('stops within the budget, and no slice begins past the deadline', () => {
    let t = 0;
    const clock = () => t;
    // A search that yields 100 times, each yield ticking the clock 10 ms. Under a
    // 25 ms budget the frame fits three slices (begun at 0, 10, 20 < 25) and stops
    // before a fourth begins.
    const ticking: CoSolveFeature = {
      name: 'long',
      *place() {
        for (let i = 0; i < 100; i += 1) {
          t += 10;
          yield i;
        }
        return [{ x: 0, z: 0, reach: 1 }];
      },
    };
    const engine = new CoSolveEngine([ticking], { now: clock });
    engine.advance(25);
    expect(engine.sliceCounts['long']).toBe(3);
    expect(engine.slicesPastDeadline).toBe(0);
    expect(engine.done).toBe(false);
  });

  it('fails cleanly when a feature fits nowhere and nothing can move for it', () => {
    // Two features that both fit only in slot 0. One takes it; the other cannot be
    // placed, and backing out the first does not help (it has nowhere else), so
    // the search ends in a clean failure rather than a hang.
    const engine = new CoSolveEngine(
      [placer('x', [[0, 0]], 2), placer('y', [[0, 0]], 2)],
      { now: () => 0 },
    );
    solveAll(engine);
    expect(engine.done).toBe(false);
    expect(engine.failed).toBeInstanceOf(CoSolveUnsolvable);
  });

  it('gives up at the backtrack cap instead of looping forever', () => {
    // The scenario needs a backtrack to solve, but the cap forbids even one.
    const engine = new CoSolveEngine(
      [
        placer('a', [[0, 0], [10, 0]], 2),
        placer('b', [[0, 0]], 2),
      ],
      { now: () => 0, maxBacktracks: 0 },
    );
    solveAll(engine);
    expect(engine.done).toBe(false);
    expect(engine.failed?.message).toMatch(/gave up after 0 backtracks/);
  });

  it('propagates a non-Unsolvable throw as a failure, never as a backtrack', () => {
    const engine = new CoSolveEngine(
      [
        {
          name: 'boom',
          *place() {
            yield 0;
            throw new Error('kaboom');
            // eslint-disable-next-line no-unreachable
            return [];
          },
        },
      ],
      { now: () => 0 },
    );
    solveAll(engine);
    expect(engine.failed?.message).toBe('kaboom');
    expect(engine.backtracks).toBe(0);
  });

  it('rejects two features that share a name at construction', () => {
    expect(
      () => new CoSolveEngine([placer('dup', [[0, 0]], 1), placer('dup', [[1, 0]], 1)]),
    ).toThrow(/share a name/);
  });

  it('excludes a feature\'s own contribution from its clearance queries', () => {
    const field = new PlacementField();
    field.commit('self', [{ x: 0, z: 0, reach: 5 }]);
    // A point inside self's own disc is "clear" to self, but not to a neighbour.
    expect(field.clear(0, 0, 1, 'self')).toBe(true);
    expect(field.clear(0, 0, 1, 'other')).toBe(false);
    field.withdraw('self');
    expect(field.clear(0, 0, 1, 'other')).toBe(true);
  });
});
