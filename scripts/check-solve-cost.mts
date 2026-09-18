/**
 * **The solver stages' module-scope cost, held to a budget on main.**
 *
 * ### The question this check owns — and the one it deliberately does not
 *
 * This check owns: *the raw wall-clock cost of each procgen solver stage's
 * module evaluation, in Node, on the canonical seed, against a coarse
 * regression budget.* It is a tripwire for the order-of-magnitude class of
 * regression, built after the Land Hotel merge (#241) took the train stage
 * from ~44 ms to ~153 ms — and the bare import of `train/plan.ts` to 1.5 s —
 * with nothing on main measuring it (the check that would have caught it,
 * `check:park-boot`, lives on the unmerged `e/cat-bus-stage-a` branch and
 * went red there the moment that branch merged main's hotel work; nobody
 * asks it the question on main — the #231 five-hollow-gates shape).
 *
 * `check:park-boot` owns a different question: *whether generation fits the
 * ride's frame slices* — `ParkGeneration.advance()` against
 * `GENERATION_BUDGET_MS`, plus event-loop lag, driven the way `main.ts`
 * drives it. When the cat-bus branch lands, BOTH checks will be on main and
 * that is the intended end state, because they answer different questions —
 * but whoever does that merge should reconcile the *numbers*: its "the
 * train's is ~44 ms" prose must be re-measured (this file's table is the
 * current measurement), and if its per-stage lag ceilings make one of this
 * file's budgets redundant, fold that budget into check-park-boot and slim
 * this file rather than keeping two owners of one threshold.
 *
 * ### How the budgets were chosen — measured, then multiplied
 *
 * Measured 8 Aug 2026, canonical seed, M-series laptop, idle, median of
 * three runs (the `measuredMs` column below). The cruiser and slide rows
 * were re-measured the same day, same machine, same method, after the
 * cruiser hot-path pass (fix/cruiser-solve-cost) cut the shared rail
 * generator's cost: cruiser 1274 → 788, slide 4609 → 4070 — byte-identical
 * routes both, proven by fingerprint, so this is the same work measured
 * cheaper, not different work. Re-measure with:
 *
 *     node --no-warnings \
 *       --import ./scripts/ts-extension-resolver-register.mjs \
 *       scripts/measure-procgen.mts --no-world
 *
 * Budget = **8 × measured, floored at 250 ms**. The 8x absorbs the honest
 * multipliers this check must never trip on — CI hardware ~2-3x slower than
 * the machine measured on, parallel load ~2x (the cat-bus branch measured
 * its train stage at 47 ms idle and 70 ms under load) — while a 30x
 * regression of any stage that matters clears its budget several times
 * over. The 250 ms floor keeps the sub-20 ms stages (layout, railRace,
 * paths) from tripping on JIT/GC noise that dwarfs their real cost; for
 * them the effective detection threshold is coarser (~15-30x), which is the
 * stated trade: this is a tripwire, not a profiler. Timings are taken from
 * dynamic imports in dependency order (ESM bills each stage only for what
 * it adds), three.js warmed first — the same method as measure-procgen.mts.
 *
 * Never tighten a budget to what your machine printed today; re-derive it
 * from a fresh median and the formula, and write both down here.
 *
 * ### It gates on CPU time, not wall clock (the flake, root-caused)
 *
 * This check read **260.3 ms against a 250 ms budget** once, and 96.6 / 98.0 /
 * 99.3 ms on the same commit when the box was quiet; a second agent measured
 * 96.1 / 97.4 / 102.2 / **216.5** / **275.1** / 99.8 ms, with both reds taken
 * at load average 14.82 with four other worktrees busy. Every reading was of
 * `performance.now()` around a dynamic `import()` — wall clock, which charges a
 * descheduled process for time it did not compute in. A budget whose verdict
 * depends on what else is running is non-deterministic by construction, and
 * CLAUDE.md is explicit that the fix is to remove the non-determinism rather
 * than to widen the budget or retry.
 *
 * So each stage is now gated on `min(wall, thread CPU)` — `scripts/lib/cpuClock.mts`,
 * the same instrument and the same three controls `check:park-boot` uses, for
 * the same reason (issue #606). A stage that is descheduled accrues no CPU time
 * and drops straight out of the minimum. Both numbers are printed, so a large
 * gap between them is visible as the contention it is. If the instrument fails
 * its control the gate falls back to raw wall clock and says so, loudly: the
 * old flaky check rather than a check that passes everything.
 *
 * ### What this check no longer covers, and why it says so on every run
 *
 * Under the backtracking rework nothing solves at module scope any more — every
 * plan is a `lazyView` over `parkPlan.ts`'s driver, and reading one is what
 * forces the work. So five of the seven stages below now measure module *parse*
 * and nothing else. Measured on this branch:
 *
 *     cruiser   0.3 ms vs a  6304 ms budget
 *     train     0.2 ms vs a 12000 ms budget
 *     slide     0.1 ms vs a 32560 ms budget
 *     paths     0.1 ms vs a  2744 ms budget
 *     railRace  0.1 ms vs a   250 ms budget
 *
 * Those clauses are four to five orders of magnitude from their thresholds:
 * they cannot fail, and a green line from them means nothing. Only `boundary`
 * (54.5 ms, still a real `cachedSolve` at module scope) and `layout` (122.5 ms
 * of module graph evaluation, against the coarse 250 ms floor — and it is the
 * one that flaked) still read anything.
 *
 * That is not something to leave implied by a quiet green line, so
 * {@link ASSERTS_NOTHING_HEADROOM} names every such stage on stderr on every
 * run, with its real numbers. **Re-deriving those five budgets is a threshold
 * decision, deliberately not taken here** — the work they used to measure now
 * lives in the driver, which `check:park-boot` gates per-slice and
 * `parkPlan.ts` reports per-feature on every build, so the honest resolution is
 * the reconciliation this file's header has always asked for, not a number
 * invented in passing.
 */
import { performance } from 'node:perf_hooks';

import { busyLabel, busyMsOf, controlOfCpuClock, cpuMs, describeControl } from './lib/cpuClock.mts';

interface Stage {
  readonly stage: string;
  readonly load: () => Promise<unknown>;
  /** Median of three idle runs, canonical seed — see header for date/machine. */
  readonly measuredMs: number;
}

/** One owner for the budget formula: 8x measured, floored at 250 ms. */
const budgetMs = (measured: number): number => Math.max(8 * measured, 250);

const STAGES: readonly Stage[] = [
  { stage: 'boundary', load: () => import('../src/world/boundary.ts'), measuredMs: 54 },
  { stage: 'layout', load: () => import('../src/world/parkLayout.ts'), measuredMs: 9 },
  { stage: 'cruiser', load: () => import('../src/world/coaster/plan.ts'), measuredMs: 788 },
  // Re-derived 11 August 2026: the train no longer solves a bespoke ~41 ms
  // radius-per-bearing profile — it grows its loop with the generic rail
  // generator (so it respects turns and dodges stalls), which is a real search
  // in the ~1.5 s class of the cruiser. Same category, same reason its budget is
  // large: the runtime cost is sliced over the cat-bus ride (`train/prewarm.ts`,
  // driven by the slice scheduler), so this cold module-load figure is what the
  // budget's 8x absorbs, exactly as the cruiser's 788 ms is. Back-derived from a
  // 2.6x-slow CI-class box that timed the cruiser at 2066 ms (ref 788) and the
  // train at 3875 ms, i.e. ~1490 ms at reference speed.
  { stage: 'train', load: () => import('../src/world/train/plan.ts'), measuredMs: 1500 },
  { stage: 'slide', load: () => import('../src/world/slide/plan.ts'), measuredMs: 4070 },
  { stage: 'railRace', load: () => import('../src/world/railRace/plan.ts'), measuredMs: 13 },
  // Re-measured 2026-08-23 (three fresh runs: 357 / 343 / 330 ms, median
  // 343), after the stage legitimately grew: it now also solves the railway
  // crossing plan (`train/crossingPlan.ts` — a feasibility march of the
  // whole loop against boundary, plots and stations, ~295 ms of the total
  // even after its query memos) and routes every rail-crossing leg through
  // the planned sites with side-holding repairs and quality backtracking.
  // The old 12 ms row described a router that did not know the railway
  // existed. Fed through the one budget formula (8 x measured) exactly like
  // every other row — the 8x is the cross-machine/parallel-load headroom
  // the file header derives, not this row's to trim.
  { stage: 'paths', load: () => import('../src/world/pathGraph.ts'), measuredMs: 343 },
];

/**
 * A stage whose reading is this many times under its budget is reported as
 * asserting nothing. It is a reporting threshold, never a gate: nothing passes
 * or fails because of it, so it cannot be tuned to make a run green.
 */
const ASSERTS_NOTHING_HEADROOM = 100;

// The control runs before anything is measured, because this check's own
// subject is a budget that was measuring the machine rather than the code.
const cpuClock = controlOfCpuClock();
console.log(`  ${describeControl(cpuClock)}`);

await import('three'); // parse cost lands here, not on the first stage to touch it

const fouls: string[] = [];
const assertsNothing: string[] = [];
console.log(`solver stage cost vs budget (canonical seed), gated on ${busyLabel(cpuClock)}:`);
for (const { stage, load, measuredMs } of STAGES) {
  const wallAt = performance.now();
  const cpuAt = cpuMs();
  await load();
  const wallMs = performance.now() - wallAt;
  const cpuDeltaMs = cpuMs() - cpuAt;
  const ms = busyMsOf(cpuClock, wallMs, cpuDeltaMs);
  const budget = budgetMs(measuredMs);
  const verdict = ms <= budget ? 'ok' : 'OVER';
  console.log(
    `  ${stage.padEnd(10)} ${ms.toFixed(1).padStart(9)} ms   budget ${budget
      .toFixed(0)
      .padStart(6)} ms (8 x ${measuredMs} ms measured, floor 250)   ${verdict}` +
      `   [wall ${wallMs.toFixed(1)} ms, cpu ${cpuDeltaMs.toFixed(1)} ms]`,
  );
  if (ms > budget) {
    fouls.push(
      `${stage} stage cost ${ms.toFixed(1)} ms of ${busyLabel(cpuClock)} against a ` +
        `${budget.toFixed(0)} ms budget (8 x its measured ${measuredMs} ms) — a regression of this ` +
        `size is structural, not noise, and it is not contention either, because a descheduled ` +
        `stage accrues no CPU time (wall was ${wallMs.toFixed(1)} ms, CPU ${cpuDeltaMs.toFixed(1)} ms); ` +
        `profile it (node --cpu-prof) and fix the stage, or re-derive the budget from a fresh ` +
        `median if the stage legitimately grew and say so in scripts/check-solve-cost.mts`,
    );
  }
  if (ms > 0 && budget / ms >= ASSERTS_NOTHING_HEADROOM) {
    assertsNothing.push(
      `${stage} (${ms.toFixed(1)} ms against ${budget.toFixed(0)} ms — ${Math.round(budget / ms)}x under)`,
    );
  }
}

// stderr, not console.log: a coverage note written to stdout is invisible in
// exactly the case it exists for, a passing run (CLAUDE.md).
if (!cpuClock.usable) {
  process.stderr.write(
    "check:solve-cost NOTE: this runtime's CPU clock failed its control — " +
      `${cpuClock.failures.join('; ')}. Every budget in this run was therefore compared against ` +
      'RAW WALL CLOCK, so a busy machine can redden it for reasons no commit caused. Fix the clock ' +
      'reading, do not raise the budgets.\n',
  );
}
if (assertsNothing.length > 0) {
  process.stderr.write(
    `check:solve-cost NOTE: ${assertsNothing.length} of ${STAGES.length} stages ASSERT NOTHING on ` +
      `this run — ${assertsNothing.join(', ')}. Under backtracking these stages no longer solve at ` +
      'module scope (every plan is a lazyView over parkPlan.ts\'s driver, and reading one is what ' +
      'forces the work), so what is measured here is module parse and the budget is four to five ' +
      'orders of magnitude away from it. A green line from those stages means nothing. The work ' +
      'itself is gated per-slice by check:park-boot and reported per-feature by parkPlan.ts\'s ' +
      '"time/pieces" line; re-pointing these budgets at that is the reconciliation this file\'s ' +
      'header asks for and is a threshold decision for whoever takes it, not a number to invent.\n',
  );
}

if (fouls.length > 0) {
  console.error(`\ncheck:solve-cost FAILED (${fouls.length}):`);
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log('check:solve-cost passed');
