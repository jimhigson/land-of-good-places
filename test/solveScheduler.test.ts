import { describe, it, expect } from 'vitest';
import { SolveScheduler, type SolveTaskSpec } from '../src/boot/solveScheduler.ts';

/**
 * Unit tests for the generic slice scheduler. Pure and fast — no park, no seed,
 * no canvas — so it runs in the same `vitest` pass as the procgen invariants but
 * proves the *engine* in isolation: round-robin interleaving, dependency order,
 * determinism regardless of frame cadence, and "stops when asked".
 */

/** A task that yields `steps` times, recording the global order it ran in. */
function counter(name: string, steps: number, log: string[], deps?: string[]): SolveTaskSpec {
  return {
    name,
    ...(deps ? { deps } : {}),
    *start() {
      for (let i = 0; i < steps; i += 1) {
        log.push(name);
        yield i;
      }
    },
  };
}

/** A clock the test drives by hand, so "a frame's budget" is exact. */
function fakeClock(): { now: () => number; tick: (ms: number) => void } {
  let t = 0;
  return { now: () => t, tick: (ms) => (t += ms) };
}

describe('SolveScheduler', () => {
  it('round-robins independent tasks so they interleave across slices', () => {
    const log: string[] = [];
    const scheduler = new SolveScheduler(
      [counter('a', 3, log), counter('b', 3, log), counter('c', 3, log)],
      () => 0, // time never advances, so one advance() drains everything in round-robin order
    );
    scheduler.advance(1);
    // Not aaabbbccc — the three run turn and turn about.
    expect(log.join('')).toBe('abcabcabc');
    expect(scheduler.done).toBe(true);
  });

  it('never starts a task before its dependencies are done', () => {
    const log: string[] = [];
    const scheduler = new SolveScheduler(
      [
        counter('route', 2, log, ['layout']),
        counter('layout', 2, log),
        counter('paths', 1, log, ['route']),
      ],
      () => 0,
    );
    scheduler.advance(1);
    expect(scheduler.done).toBe(true);
    // layout fully before route starts; route fully before paths starts.
    expect(log.indexOf('route')).toBeGreaterThan(log.lastIndexOf('layout'));
    expect(log.indexOf('paths')).toBeGreaterThan(log.lastIndexOf('route'));
  });

  it('builds the same result whatever the frame cadence — one big frame or many tiny', () => {
    const run = (budgets: number[]): string[] => {
      const log: string[] = [];
      const clock = fakeClock();
      const scheduler = new SolveScheduler(
        [counter('a', 4, log), counter('b', 4, log, ['a']), counter('c', 4, log)],
        clock.now,
      );
      let i = 0;
      while (!scheduler.done && !scheduler.failed) {
        scheduler.advance(budgets[i % budgets.length] as number);
        clock.tick(5); // every slice "costs" enough to end a small frame
        i += 1;
        if (i > 1000) throw new Error('did not converge');
      }
      return log;
    };
    // One generous frame vs. a drip of tiny ones: identical task-completion order.
    expect(run([1000])).toEqual(run([1]));
  });

  it('stops within the budget, and no slice begins past the deadline', () => {
    const clock = fakeClock();
    // Each slice ticks the clock 10 ms. Under a 25 ms budget: slice 1 begins at
    // clock 0, slice 2 begins at 10, slice 3 begins at 20 — all < 25 — and after
    // slice 3 the clock reads 30 >= 25, so the frame stops. Three slices, and not
    // one of them *began* on or after the deadline, so the overrun counter is 0.
    const ticking: SolveTaskSpec = {
      name: 'ticking',
      *start() {
        for (let i = 0; i < 100; i += 1) {
          clock.tick(10);
          yield i;
        }
      },
    };
    const scheduler = new SolveScheduler([ticking], clock.now);
    scheduler.advance(25);
    expect(scheduler.sliceCounts['ticking']).toBe(3);
    expect(scheduler.slicesPastDeadline).toBe(0);
    expect(scheduler.done).toBe(false); // 97 slices still to go, on later frames
  });

  it('reports a task that throws as a failure and stops', () => {
    const scheduler = new SolveScheduler(
      [
        {
          name: 'boom',
          *start() {
            yield 0;
            throw new Error('kaboom');
          },
        },
      ],
      () => 0,
    );
    scheduler.advance(1);
    expect(scheduler.failed?.message).toBe('kaboom');
    expect(scheduler.done).toBe(false);
  });

  it('rejects a dependency cycle at construction', () => {
    expect(
      () =>
        new SolveScheduler([
          counter('x', 1, [], ['y']),
          counter('y', 1, [], ['x']),
        ]),
    ).toThrow(/cycle/);
  });

  it('rejects an unknown dependency at construction', () => {
    expect(() => new SolveScheduler([counter('x', 1, [], ['ghost'])])).toThrow(/unknown task/);
  });
});

describe("SolveScheduler ready gates and 'frame' yields", () => {
  it('holds an unstarted task until ready() answers true, without spinning it', () => {
    const log: string[] = [];
    let moduleLoaded = false;
    const scheduler = new SolveScheduler(
      [
        {
          name: 'gated',
          ready: () => moduleLoaded,
          *start() {
            log.push('ran');
            yield 0;
          },
        },
      ],
      () => 0,
    );
    scheduler.advance(1);
    // Nothing runnable: the task took no slices at all — no busy-wait, so its
    // slice count stays a fact about the park, not the machine.
    expect(log).toEqual([]);
    expect(scheduler.sliceCounts['gated']).toBe(0);
    expect(scheduler.done).toBe(false);
    moduleLoaded = true;
    scheduler.advance(1);
    expect(log).toEqual(['ran']);
    expect(scheduler.done).toBe(true);
  });

  it('ready() is not re-asked once a task has started', () => {
    let asks = 0;
    let open = true;
    const scheduler = new SolveScheduler(
      [
        {
          name: 't',
          ready: () => ((asks += 1), open),
          *start() {
            yield 0;
            yield 1;
            yield 2;
          },
        },
      ],
      () => 0,
    );
    scheduler.advance(1);
    // The gate may slam after the first slice; an in-flight task keeps going.
    open = false;
    scheduler.advance(1);
    expect(scheduler.done).toBe(true);
    expect(asks).toBe(1);
  });

  it("a 'frame' yield ends the task's work for that advance() only", () => {
    const log: string[] = [];
    const scheduler = new SolveScheduler(
      [
        {
          name: 'careful',
          *start() {
            log.push('search');
            yield 'frame';
            log.push('judge'); // must not share a frame with the search step
          },
        },
      ],
      () => 0, // infinite budget: only the 'frame' yield can stop it
    );
    scheduler.advance(1);
    expect(log).toEqual(['search']);
    scheduler.advance(1);
    expect(log).toEqual(['search', 'judge']);
    expect(scheduler.done).toBe(true);
  });

  it("a 'frame' yield hands the rest of the budget to other tasks", () => {
    const log: string[] = [];
    const scheduler = new SolveScheduler(
      [
        {
          name: 'a',
          *start() {
            log.push('a1');
            yield 'frame';
            log.push('a2');
          },
        },
        counter('b', 2, log),
      ],
      () => 0,
    );
    scheduler.advance(1);
    // a stops itself after a1; b then drains fully in the same frame.
    expect(log).toEqual(['a1', 'b', 'b']);
    scheduler.advance(1);
    expect(log).toEqual(['a1', 'b', 'b', 'a2']);
  });

  it("a 'frame' yield does not disturb the recorded progress number", () => {
    const scheduler = new SolveScheduler(
      [
        {
          name: 't',
          *start() {
            yield 7;
            yield 'frame';
            yield 9;
          },
        },
      ],
      () => 0,
    );
    scheduler.advance(1);
    expect(scheduler.progressOf('t')).toBe(7);
    scheduler.advance(1);
    expect(scheduler.progressOf('t')).toBe(9);
  });
});
