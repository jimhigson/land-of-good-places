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
 * ### How the budgets were chosen — measured where it runs, then multiplied by three
 *
 * Budget = **3 x measured CPU, floored at 250 ms**, where "measured" is taken
 * **on the kind of machine the check is running on**: `localMs` is the median
 * of three runs on an M-series laptop, `ciMs` the median of the canonical-seed
 * solves in one `Checks` job on GitHub's runner. On CI (`CI=true`, which
 * GitHub Actions sets) the CI column is the baseline; everywhere else the
 * local one. Every run prints which.
 *
 * **Why two columns and not one multiplier wide enough for both.** CI reads
 * 2.0-2.3x the laptop (23 Sep 2026, `Checks` run 35878196330: 33 canonical
 * solves in the one job — cruiser 6676-7357 ms against 3441 here). One
 * multiplier on the laptop's number cannot be tight on both:
 *
 * - **3x local** left CI at 1.3-1.4x of its budget on its worst solve — one
 *   slower runner generation from a red `main` for no commit's sake.
 * - **4x local** gave CI 1.7x, and then **failed to catch the regression this
 *   check exists for**: the slide with its `endRadius()` memo removed (the
 *   #681 cost, below) read **15374 ms against a 15644 ms budget — `ok`** on
 *   this laptop. Measured, not supposed.
 *
 * A baseline per machine class makes both 3x: a 3x regression is caught
 * wherever it is run, and CI's worst reading sits 2.7x under its own budget.
 * The multiplier is 3, not the 8 this file used to carry: the old 8x had to
 * absorb CI hardware **and** parallel load, and a CPU reading sees neither
 * the load (it is thread CPU time) nor, now, the hardware (it is compared
 * with a baseline from the same class of machine). 8 x 3305 ms would have put
 * the slide at 26440 ms and waved the 16641 ms regression straight through.
 *
 * A machine that is neither — a slow cloud sandbox without `CI` set — is
 * judged against the laptop column and may read red for its hardware. That is
 * a wrong baseline, not a regression; set `CI=true` there or measure it.
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
 * The **world phase** (`src/world/worldPhase.ts`; what it builds is
 * `WORLD_PHASE_FEATURES`, printed from there) is a second `ParkSolve` run
 * inside the `World` constructor and is not measured here; nor is anything that
 * happens after the plan. Only the seven coarse plan features and the boundary
 * are budgeted.
 */
import { performance } from 'node:perf_hooks';

import { busyLabel, busyMsOf, controlOfCpuClock, cpuMs, describeControl } from './lib/cpuClock.mts';
import { WORLD_PHASE_FEATURES } from '../src/world/worldPhase.ts';

/** One owner for the budget formula: 3x measured CPU, floored at 250 ms. */
const BUDGET_MULTIPLIER = 3;
/** Which column is the baseline: GitHub Actions sets `CI=true`. */
const onCi = process.env['CI'] === 'true';
const baselineName = onCi ? 'CI' : 'local';
const budgetMs = (measured: number): number => Math.max(BUDGET_MULTIPLIER * measured, 250);

/**
 * The driver's coarse features, in build order, with the median CPU cost of
 * three runs on the canonical seed. Re-derive with `LGP_SOLVE_COST_REPORT=1`.
 */
const FEATURES: readonly { readonly feature: string; readonly localMs: number; readonly ciMs: number }[] = [
  // Measured 23 Sep 2026 on 6a407a87 (the slide's end-radius memo in),
  // canonical seed, CPU time.
  //   local: M-series laptop, load average ~8-12, three runs, median taken; the
  //          three readings are given so the spread is visible.
  //   CI:    `Checks` run 35878196330 on that commit, median of the 33
  //          canonical-seed solves in the one job (min-max beside it). Those are
  //          the driver's `time/pieces` line, wall clock; on that runner the
  //          check's own CPU row agreed with wall to within 1% (cruiser 6644.4
  //          CPU / 6688.5 wall), so they are the same number there.
  //                                                        local runs (ms CPU)     CI median (min-max)
  { feature: 'layout', localMs: 67, ciMs: 139 }, //       64.2 /   91.9 /   67.2     139 (132-153)
  { feature: 'cruiser', localMs: 3441, ciMs: 6739 }, // 3275.0 / 3933.8 / 3440.5    6739 (6676-7357)
  { feature: 'train', localMs: 1417, ciMs: 2876 }, //   1403.9 / 1488.0 / 1416.8    2876 (2849-3252)
  { feature: 'slide', localMs: 3911, ciMs: 7755 }, //   4087.6 / 3910.7 / 3663.5    7755 (7644-8612)
  { feature: 'crossings', localMs: 12, ciMs: 28 }, //     17.2 /   12.2 /   10.6      28 (22-36)
  { feature: 'pathGraph', localMs: 67, ciMs: 136 }, //    70.7 /   66.9 /   51.6     136 (127-149)
  { feature: 'road', localMs: 1, ciMs: 1 }, //             0.5 /    0.5 /    0.4       1 (0-1)
];

/**
 * `boundary` is not a driver feature: it really does solve at module scope,
 * through `cachedSolve` in `src/world/boundary.ts`, so it is still timed as an
 * import — and it is the one row whose old shape was always honest.
 */
const BOUNDARY_MS = { localMs: 57, ciMs: 101 }; // local 51.0 / 73.4 / 56.7; CI 100.5 (one reading: it is timed only here)

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
      .padStart(6)} ms (${BUDGET_MULTIPLIER} x ${measuredMs} ms ${baselineName}, floor 250)   ${verdict}   ${how}`,
  );
  if (ms > budget && !reportOnly) {
    fouls.push(
      `${name} cost ${ms.toFixed(1)} ms of CPU against a ${budget.toFixed(0)} ms budget ` +
        `(${BUDGET_MULTIPLIER} x its ${baselineName} baseline of ${measuredMs} ms) — a regression of this size is structural, not noise, and ` +
        'it is not contention either, because a descheduled solve accrues no CPU time; profile it ' +
        '(node --cpu-prof) and fix the feature, or re-derive the budget from a fresh median with ' +
        'LGP_SOLVE_COST_REPORT=1 if it legitimately grew and say so in scripts/check-solve-cost.mts',
    );
  }
};

console.log(
  `solver cost vs budget (canonical seed), gated on ${busyLabel(cpuClock)}, against the ` +
    `${baselineName} baseline (CI=${process.env['CI'] ?? 'unset'}):`,
)
judge('boundary', boundaryMs, onCi ? BOUNDARY_MS.ciMs : BOUNDARY_MS.localMs, `module import, wall ${boundaryWallMs.toFixed(1)} ms`);
for (const { feature, localMs, ciMs } of FEATURES) {
  const measuredMs = onCi ? ciMs : localMs;
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
    `The world phase (src/world/worldPhase.ts — ${WORLD_PHASE_FEATURES.join(', ')}) is a second ` +
    'ParkSolve inside the World constructor and is NOT budgeted here, ' +
    'nor is anything after the plan. A green run says nothing about those.\n',
);

if (reportOnly) {
  process.stderr.write(
    'check:solve-cost NOTE: LGP_SOLVE_COST_REPORT=1 — this run asserted NOTHING about the budgets. ' +
      'It is the re-derivation mode; take the median of three and write it into FEATURES — localMs from a laptop, ' +
      'ciMs from a Checks job log (the time/pieces lines).\n',
  );
}

if (fouls.length > 0) {
  console.error(`\ncheck:solve-cost FAILED (${fouls.length}):`);
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log('check:solve-cost passed');
