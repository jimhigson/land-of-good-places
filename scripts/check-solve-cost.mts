/**
 * **What the park costs to solve, per feature, held to a budget.**
 *
 * ### The question this check owns
 *
 * *How much CPU each procgen feature spends deciding itself, on the canonical
 * seed, against a coarse regression budget.* It is a tripwire for the
 * order-of-magnitude class of regression — the sort that doubles a boot.
 *
 * `check:park-boot` owns a different question: whether that work is offered up
 * in **slices small enough for a frame**. A feature can be perfectly sliced and
 * still cost four times what it used to; that is this check's business.
 *
 * ### It was rewritten because every interesting row had stopped asserting
 *
 * Until now it timed a **dynamic `import()`** of each solver module, on the
 * premise that importing one solved it. Under the backtracking rework that
 * premise died: every plan is a `lazyView` over `parkPlan.ts`'s driver
 * (`export const SLIDE_PLAN = lazyView(...)`), so importing decides nothing and
 * the rows were timing a module parse. Measured on this branch before the
 * rewrite:
 *
 *     cruiser   0.1 ms vs a  6304 ms budget    (57,309x under)
 *     train     0.1 ms vs a 12000 ms budget   (150,000x under)
 *     slide     0.0 ms vs a 32560 ms budget   (757,209x under)
 *     railRace  0.0 ms vs a   250 ms budget     (5,556x under)
 *     paths     0.0 ms vs a  2744 ms budget    (60,978x under)
 *
 * Five of seven rows were incapable of failing, and the proof of what that
 * cost is exact: after #681 the slide solver went from **3206 ms to 16641 ms**,
 * its pieces from 597k to 3,008k, and the whole park build doubled from 15.1 s
 * to 29.9 s — and this check reported `ok`.
 *
 * (That slide cost, once this check could see it, turned out to be **one
 * constant recomputed three million times**: `endRadius()` in
 * `src/world/slide/solve.ts`, a `worldYAtAltitude` solve per sample of every
 * candidate piece, was 12.1 s of 17.6 s on a `--cpu-prof`. Memoised on the
 * ball pit it is a function of, the slide is back to ~3.9 s with the same
 * 3,008,025 pieces and a byte-identical park on seeds 0-15.)
 *
 * So the rows now read the **driver's own measurement of its own features**
 * (`parkSolveStats().cpuMsByFeature`, `src/boot/parkSolve.ts`) after forcing a
 * real solve. One owner: the driver times the work as it does it, and this
 * check only asserts. Nothing here re-derives a cost from the outside, which is
 * what let the old rows drift away from reality unnoticed.
 *
 * ### CPU time, not wall clock — and why that lets the budgets be tight
 *
 * Every old reading was `performance.now()` around the import: wall clock,
 * which charges a descheduled process for time it did not compute in. The
 * `layout` row read, across two agents on the same commit, **90 / 96.1 / 96.6 /
 * 97.4 / 98.0 / 99.3 / 102.2 / 110 / 117 / 216.5 / 260.3 / 275.1 ms** against a
 * 250 ms budget, the reds taken at load average 14.82 with four other worktrees
 * busy. A budget whose verdict depends on what else is running is
 * non-deterministic by construction, and CLAUDE.md is explicit that the fix is
 * to remove the non-determinism rather than widen the budget or retry.
 *
 * `cpuMsByFeature` is `process.threadCpuUsage()`, which does not advance while
 * its thread is descheduled. (`threadCpuUsage`, not `cpuUsage`: the latter
 * charges every thread of the process including V8's concurrent marker —
 * `check:park-boot` found that by measurement and `scripts/lib/cpuClock.mts`
 * owns the reading for the checks.)
 *
 * **Best-of-N was considered and is not needed.** It is legitimate reasoning —
 * contention can only ever add time, so the minimum of N runs is the truest
 * cost — but it buys nothing once the clock itself ignores contention, and it
 * would cost N full park solves on a check that now does real work. The CPU
 * clock gets the same property for one run.
 *
 * ### How the budgets were chosen — measured, then multiplied by four
 *
 * Budget = **4 x measured CPU, floored at 250 ms**, where `measuredMs` is the
 * median of three local runs on the canonical seed (see each row), and each
 * row also carries what **CI** read, because CI is where this check gates.
 *
 * The multiplier was 8 for a long time. The old 8x had to absorb CI hardware
 * **and** parallel load (~2x); contention no longer reaches a CPU reading, so
 * only the hardware term is left, and 8x is wide enough to be useless: 8 x 3305
 * ms would have put the slide's budget at 26440 ms and waved the 16641 ms
 * regression above straight through.
 *
 * It is 4 rather than 3 because of what CI actually reads. Measured 23 Sep
 * 2026, `Checks` run 35878196330: every park solve in that job prints its
 * per-feature times, and across **33 canonical-seed solves** in the one job
 * the worst readings were cruiser 7357, train 3252, slide 8612, layout 153,
 * pathGraph 149 ms — **2.1-2.3x** the local medians below. At 3x that left CI
 * 1.3-1.4x from its own budget, which one slower runner generation would eat.
 * At 4x it is **1.7x or more on every row**, and a 4x regression is still
 * caught locally as well as on CI (the #681 slide, 4.6x, would read 17.9 s
 * against a 15.6 s budget here and ~35 s against it on CI).
 *
 * The 250 ms floor keeps the sub-20 ms features (crossings, pathGraph, road)
 * from tripping on JIT and GC noise that dwarfs their real cost; for them the
 * effective detection threshold is coarser, which is the stated trade — this is
 * a tripwire, not a profiler.
 *
 * Re-measure with `LGP_SOLVE_COST_REPORT=1 pnpm run check:solve-cost`, which
 * prints the table and asserts nothing. Never tighten a budget to what your
 * machine printed today; re-derive it from a fresh median and the formula, and
 * write both down here.
 *
 * ### What this check does not cover, and says so on every run
 *
 * The **world phase** (`src/world/worldPhase.ts` — fountain, walls, trees,
 * bushes, fairy poles, lamps, rail-race trestles) is a second `ParkSolve` run
 * inside the `World` constructor and is not measured here; nor is anything that
 * happens after the plan. Only the seven coarse plan features and the boundary
 * are budgeted.
 */
import { performance } from 'node:perf_hooks';

import { busyLabel, busyMsOf, controlOfCpuClock, cpuMs, describeControl } from './lib/cpuClock.mts';

/** One owner for the budget formula: 4x measured CPU, floored at 250 ms. */
const BUDGET_MULTIPLIER = 4;
const budgetMs = (measured: number): number => Math.max(BUDGET_MULTIPLIER * measured, 250);

/**
 * The driver's coarse features, in build order, with the median CPU cost of
 * three runs on the canonical seed. Re-derive with `LGP_SOLVE_COST_REPORT=1`.
 */
const FEATURES: readonly { readonly feature: string; readonly measuredMs: number }[] = [
  // Measured 23 Sep 2026 on 6a407a87 (the slide's end-radius memo in),
  // canonical seed, M-series laptop, load average ~8-12, three runs, CPU time,
  // median taken. The three readings are given so the spread is visible. `CI`
  // is the same row in `Checks` run 35878196330 (ubuntu runner), the worst of
  // 33 canonical-seed solves in that one job — the number the budget has to
  // clear with room.
  //                                            local runs (ms CPU)       CI worst   budget
  { feature: 'layout', measuredMs: 67 }, //       64.2 /   91.9 /   67.2     153      268
  { feature: 'cruiser', measuredMs: 3441 }, // 3275.0 / 3933.8 / 3440.5    7357    13764
  { feature: 'train', measuredMs: 1417 }, //   1403.9 / 1488.0 / 1416.8    3252     5668
  { feature: 'slide', measuredMs: 3911 }, //   4087.6 / 3910.7 / 3663.5    8612    15644
  { feature: 'crossings', measuredMs: 12 }, //   17.2 /   12.2 /   10.6      36      250
  { feature: 'pathGraph', measuredMs: 67 }, //   70.7 /   66.9 /   51.6     149      268
  { feature: 'road', measuredMs: 1 }, //          0.5 /    0.5 /    0.4       1      250
];

/**
 * `boundary` is not a driver feature: it really does solve at module scope,
 * through `cachedSolve` in `src/world/boundary.ts`, so it is still timed as an
 * import — and it is the one row whose old shape was always honest.
 */
const BOUNDARY_MEASURED_MS = 57; // 51.0 / 73.4 / 56.7 local; CI 100.5; budget 250 (floor)

const reportOnly = process.env['LGP_SOLVE_COST_REPORT'] === '1';

// The control runs before anything is measured, because this check's own
// subject is a budget that was measuring the machine rather than the code.
const cpuClock = controlOfCpuClock();
console.log(`  ${describeControl(cpuClock)}`);

await import('three'); // parse cost lands here, not on the first thing to touch it

const fouls: string[] = [];
const rows: string[] = [];

// ------------------------------------------------------- boundary, by import
const boundaryWallAt = performance.now();
const boundaryCpuAt = cpuMs();
await import('../src/world/boundary.ts');
const boundaryWallMs = performance.now() - boundaryWallAt;
const boundaryMs = busyMsOf(cpuClock, boundaryWallMs, cpuMs() - boundaryCpuAt);

// ------------------------------------------- the plan, solved for real, once
const plan = await import('../src/world/parkPlan.ts');
const solveWallAt = performance.now();
plan.solveParkPlanNow();
const solveWallMs = performance.now() - solveWallAt;
const stats = plan.parkSolveStats();
if (!stats) throw new Error('check:solve-cost: the park solved but the driver published no stats');

/**
 * **The control on the instrument, before a single budget is read.** A
 * `cpuMsByFeature` of all zeroes — a runtime without `threadCpuUsage`, a driver
 * that stopped accumulating, a solve that was served from a cache and never ran
 * — would clear every budget below and leave exactly the check that this
 * rewrite exists to abolish. So the totals must add up to a real solve.
 */
const cpuTotal = Object.values(stats.cpuMsByFeature).reduce((sum, ms) => sum + ms, 0);
const featuresWithTime = Object.values(stats.cpuMsByFeature).filter((ms) => ms > 0).length;
rows.push(
  `control: the driver solved ${stats.increments} increment(s) over ${stats.turns} turn(s) ` +
    `and priced ${featuresWithTime} feature(s) at ${cpuTotal.toFixed(0)} ms of CPU ` +
    `(${solveWallMs.toFixed(0)} ms of wall clock)`,
);
if (cpuTotal <= 0 || featuresWithTime < 3) {
  fouls.push(
    `the driver published no usable per-feature CPU time — ${featuresWithTime} feature(s) above zero, ` +
      `${cpuTotal.toFixed(1)} ms in total, over ${stats.increments} increment(s). Every budget below would ` +
      'pass on an absence rather than on a cost. Fix cpuMsByFeature in src/boot/parkSolve.ts before ' +
      'reading anything else in this run.',
  );
}

// -------------------------------------------------------------------- verdict
const judge = (name: string, ms: number, measuredMs: number, how: string): void => {
  const budget = budgetMs(measuredMs);
  const verdict = ms <= budget ? 'ok' : 'OVER';
  rows.push(
    `  ${name.padEnd(10)} ${ms.toFixed(1).padStart(9)} ms   budget ${budget
      .toFixed(0)
      .padStart(6)} ms (${BUDGET_MULTIPLIER} x ${measuredMs} ms measured, floor 250)   ${verdict}   ${how}`,
  );
  if (ms > budget && !reportOnly) {
    fouls.push(
      `${name} cost ${ms.toFixed(1)} ms of CPU against a ${budget.toFixed(0)} ms budget ` +
        `(${BUDGET_MULTIPLIER} x its measured ${measuredMs} ms) — a regression of this size is structural, not noise, and ` +
        'it is not contention either, because a descheduled solve accrues no CPU time; profile it ' +
        '(node --cpu-prof) and fix the feature, or re-derive the budget from a fresh median with ' +
        'LGP_SOLVE_COST_REPORT=1 if it legitimately grew and say so in scripts/check-solve-cost.mts',
    );
  }
};

console.log(`solver cost vs budget (canonical seed), gated on ${busyLabel(cpuClock)}:`);
judge('boundary', boundaryMs, BOUNDARY_MEASURED_MS, `module import, wall ${boundaryWallMs.toFixed(1)} ms`);
for (const { feature, measuredMs } of FEATURES) {
  const ms = stats.cpuMsByFeature[feature] ?? 0;
  const wall = stats.msByFeature[feature] ?? 0;
  const pieces = stats.piecesByFeature[feature] ?? 0;
  judge(feature, ms, measuredMs, `${pieces} pieces, wall ${wall.toFixed(1)} ms`);
}
for (const row of rows) console.log(row);

// A feature the driver never ran is not a feature that cost nothing, and a row
// budgeting it would be the old disease in a new place. Named, every run.
const missing = FEATURES.filter(({ feature }) => stats.cpuMsByFeature[feature] === undefined);
if (missing.length > 0) {
  fouls.push(
    `${missing.length} budgeted feature(s) were never run by the driver and so were never priced: ` +
      `${missing.map((m) => m.feature).join(', ')}. Either the build order changed and this table is ` +
      'stale, or the solve stopped short; a budget on a feature that did not run asserts nothing.',
  );
}

// stderr, not console.log: a coverage note written to stdout is invisible in
// exactly the case it exists for, a passing run (CLAUDE.md).
if (!cpuClock.usable) {
  process.stderr.write(
    "check:solve-cost NOTE: this runtime's CPU clock failed its control — " +
      `${cpuClock.failures.join('; ')}. The boundary row was therefore compared against RAW WALL ` +
      'CLOCK, so a busy machine can redden it for reasons no commit caused. Fix the clock reading, ' +
      'do not raise the budgets.\n',
  );
}
process.stderr.write(
  'check:solve-cost NOTE: this check covers the seven coarse PLAN features and the boundary only. ' +
    'The world phase (src/world/worldPhase.ts — fountain, walls, trees, bushes, fairy poles, lamps, ' +
    'rail-race trestles) is a second ParkSolve inside the World constructor and is NOT budgeted here, ' +
    'nor is anything after the plan. A green run says nothing about those.\n',
);

if (reportOnly) {
  process.stderr.write(
    'check:solve-cost NOTE: LGP_SOLVE_COST_REPORT=1 — this run asserted NOTHING about the budgets. ' +
      'It is the re-derivation mode; take the median of three and write it into FEATURES.\n',
  );
}

if (fouls.length > 0) {
  console.error(`\ncheck:solve-cost FAILED (${fouls.length}):`);
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log('check:solve-cost passed');
