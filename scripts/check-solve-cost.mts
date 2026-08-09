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
 *     node --experimental-transform-types --no-warnings \
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
 */
import { performance } from 'node:perf_hooks';

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
  { stage: 'train', load: () => import('../src/world/train/plan.ts'), measuredMs: 41 },
  { stage: 'slide', load: () => import('../src/world/slide/plan.ts'), measuredMs: 4070 },
  { stage: 'railRace', load: () => import('../src/world/railRace/plan.ts'), measuredMs: 13 },
  { stage: 'paths', load: () => import('../src/world/paths.ts'), measuredMs: 12 },
];

await import('three'); // parse cost lands here, not on the first stage to touch it

const fouls: string[] = [];
console.log('solver stage cost vs budget (canonical seed):');
for (const { stage, load, measuredMs } of STAGES) {
  const at = performance.now();
  await load();
  const ms = performance.now() - at;
  const budget = budgetMs(measuredMs);
  const verdict = ms <= budget ? 'ok' : 'OVER';
  console.log(
    `  ${stage.padEnd(10)} ${ms.toFixed(1).padStart(9)} ms   budget ${budget
      .toFixed(0)
      .padStart(6)} ms (8 x ${measuredMs} ms measured, floor 250)   ${verdict}`,
  );
  if (ms > budget) {
    fouls.push(
      `${stage} stage cost ${ms.toFixed(1)} ms against a ${budget.toFixed(0)} ms budget ` +
        `(8 x its measured ${measuredMs} ms) — a regression of this size is structural, not noise; `
        + `profile it (node --cpu-prof) and fix the stage, or re-derive the budget from a fresh ` +
        `median if the stage legitimately grew and say so in scripts/check-solve-cost.mts`,
    );
  }
}

if (fouls.length > 0) {
  console.error(`\ncheck:solve-cost FAILED (${fouls.length}):`);
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log('check:solve-cost passed');
