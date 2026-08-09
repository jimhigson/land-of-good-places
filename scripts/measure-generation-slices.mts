/**
 * **Every `advance()` slice, timed, with the stage it happened in.**
 *
 * `check:park-boot` reports only the worst one, which tells you that a frame
 * hitched but not *which* piece of work cannot be interrupted. This drives the
 * same `ParkGeneration` the same way and keeps every slice, so the answer to
 * "what is the largest thing that has no yield point inside it" is a list rather
 * than a guess.
 *
 * ### Why the ranking matters more than the milliseconds
 *
 * Written after `check:park-boot` passed on an M4 Pro at 18 ms and failed in CI
 * at 54.6 ms against the same 24 ms ceiling. The absolute numbers are a property
 * of the machine; **the relative size of the slices is a property of the code**,
 * and it is the code that has the bug. A slice that is 3x the next largest is
 * too coarse on every machine — it just happens to fit on a fast one.
 *
 * So: read the top of this list, not the total. Anything sitting well above the
 * `GENERATION_BUDGET_MS` the driver was given is a unit of work the driver was
 * not able to stop in the middle of, and that is the thing to slice.
 */
import { performance } from 'node:perf_hooks';
import { GENERATION_BUDGET_MS, ParkGeneration } from '../src/boot/parkGeneration.ts';

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

interface Slice {
  readonly ms: number;
  readonly stage: string;
  readonly frame: number;
}

const generation = new ParkGeneration();
const slices: Slice[] = [];
let frame = 0;

const startedAt = performance.now();
while (!generation.ready && !generation.failed && frame < 20000) {
  const stage = generation.stage;
  const before = performance.now();
  generation.advance(GENERATION_BUDGET_MS);
  const ms = performance.now() - before;
  frame += 1;
  slices.push({ ms, stage, frame });
  await nextFrame();
}
const wall = performance.now() - startedAt;

if (generation.failed) {
  console.error(`generation FAILED: ${generation.failed.message}`);
  process.exit(1);
}

const sorted = [...slices].sort((a, b) => b.ms - a.ms);
const total = slices.reduce((sum, s) => sum + s.ms, 0);

console.log(`budget given to each advance(): ${GENERATION_BUDGET_MS} ms`);
console.log(`${frame} frames, ${(wall / 1000).toFixed(2)} s wall, ${(total / 1000).toFixed(2)} s inside advance()`);
console.log(`unbudgeted (module evaluations etc): ${(wall - total).toFixed(0)} ms\n`);

console.log('the first 12 frames in order, where the one-off lumps live:');
for (const slice of slices.slice(0, 12)) {
  console.log(`  frame ${String(slice.frame).padStart(3)}  ${slice.ms.toFixed(1).padStart(7)} ms   ${slice.stage}`);
}
console.log('\nthe last 3 frames of each stage, where the finishers live:');
for (let i = 1; i < slices.length; i += 1) {
  const prev = slices[i - 1];
  const here = slices[i];
  if (prev && here && prev.stage !== here.stage) {
    for (const s of slices.slice(Math.max(0, i - 3), i + 1)) {
      console.log(`  frame ${String(s.frame).padStart(3)}  ${s.ms.toFixed(1).padStart(7)} ms   ${s.stage}`);
    }
    console.log('  ---');
  }
}

console.log('\nthe 15 largest slices — anything far above the budget has no yield point inside it:');
for (const slice of sorted.slice(0, 15)) {
  console.log(`  ${slice.ms.toFixed(1).padStart(7)} ms   frame ${String(slice.frame).padStart(5)}   ${slice.stage}`);
}

// How much headroom is there against the ceiling the check actually applies?
const CEILING = GENERATION_BUDGET_MS * 3;
const worst = sorted[0];
if (worst) {
  console.log(
    `\nworst ${worst.ms.toFixed(1)} ms against a ${CEILING} ms ceiling ` +
      `= ${(CEILING / worst.ms).toFixed(1)}x headroom.`,
  );
  console.log(
    `CI measured ~3x slower than this machine, so a slice needs ~3x headroom here to pass there.`,
  );
}

// Per-stage worst, so a regression can be attributed without re-reading the list.
const byStage = new Map<string, { worst: number; count: number; total: number }>();
for (const slice of slices) {
  const row = byStage.get(slice.stage) ?? { worst: 0, count: 0, total: 0 };
  row.worst = Math.max(row.worst, slice.ms);
  row.count += 1;
  row.total += slice.ms;
  byStage.set(slice.stage, row);
}
console.log('\nper stage:');
for (const [stage, row] of byStage) {
  console.log(
    `  ${stage.padEnd(30)} worst ${row.worst.toFixed(1).padStart(7)} ms   ` +
      `${String(row.count).padStart(5)} slices   ${(row.total / 1000).toFixed(2)} s total`,
  );
}
