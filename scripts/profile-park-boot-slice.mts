/**
 * **Which generation slice costs 105 ms, and what is inside it?** — the
 * `check:park-boot` regression measured on #427.
 *
 * Drives a real `ParkGeneration` at `advance(0)`, which is what the check's
 * own failure message says to do: a zero budget makes every drive loop do
 * exactly one step, so the slice time IS the unit cost. Prints every slice
 * over a threshold with the phase it was in, then names the module import
 * or search step that owns it.
 *
 * Not used by the game.
 *
 *   node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
 *     scripts/profile-park-boot-slice.mts
 */
import './headless-canvas.mjs';

const { ParkGeneration } = await import('../src/boot/parkGeneration.ts');

const generation = new ParkGeneration();
const REPORT_OVER_MS = 5;

/** Which of the class's own letterboxes are filled — the phase, read off the
 * object rather than guessed from ordering. */
const phaseOf = (g: Record<string, unknown>): string => {
  if (!g['cruiserModule']) return 'import(before cruiser / coaster/solve)';
  if (!g['cruiserSolved']) return 'cruiser search';
  if (!g['trainModule']) return 'import(train/route)';
  if (!g['trainSolved']) return 'train search';
  if (!g['solveModule']) return 'import(after cruiser / slide/solve)';
  if (!g['slideSolved']) return 'slide search';
  if (!g['crossingModule']) return 'import(crossingPlanSolve)';
  if (!g['crossingSitesSolved']) return 'crossing-sites search';
  if (!g['pathsModule']) return 'import(paths)';
  if (!g['pathGraphSolved']) return 'path-graph search';
  return 'import(pathGraph)';
};

const slices: { ms: number; phase: string; index: number }[] = [];
let index = 0;
const started = performance.now();
while (!(generation as unknown as { pathsDone: boolean }).pathsDone) {
  const before = phaseOf(generation as unknown as Record<string, unknown>);
  const t0 = performance.now();
  generation.advance(Number(process.env["LGP_PROFILE_BUDGET"] ?? 8));
  const ms = performance.now() - t0;
  slices.push({ ms, phase: before, index });
  index += 1;
  // Module imports are async: let the microtask queue settle, exactly as a
  // real frame does.
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (index > 500000) throw new Error('generation never finished');
  const failure = (generation as unknown as { failure?: unknown }).failure;
  if (failure) throw new Error(`generation failed: ${String(failure)}`);
}
const total = performance.now() - started;

slices.sort((a, b) => b.ms - a.ms);
console.log(`${index} slices, ${total.toFixed(0)} ms wall clock\n`);
console.log('worst slices (advance(0) — one step each):');
for (const slice of slices.filter((s) => s.ms >= REPORT_OVER_MS).slice(0, 20)) {
  console.log(`  ${slice.ms.toFixed(1).padStart(7)} ms  slice #${slice.index}  ${slice.phase}`);
}

const byPhase = new Map<string, { total: number; worst: number; count: number }>();
for (const slice of slices) {
  const entry = byPhase.get(slice.phase) ?? { total: 0, worst: 0, count: 0 };
  entry.total += slice.ms;
  entry.worst = Math.max(entry.worst, slice.ms);
  entry.count += 1;
  byPhase.set(slice.phase, entry);
}
console.log('\nper phase:');
for (const [phase, e] of [...byPhase].sort((a, b) => b[1].worst - a[1].worst)) {
  console.log(
    `  worst ${e.worst.toFixed(1).padStart(7)} ms   total ${e.total.toFixed(0).padStart(6)} ms   ` +
      `${String(e.count).padStart(5)} slices   ${phase}`,
  );
}
