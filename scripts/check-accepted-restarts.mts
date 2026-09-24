/**
 * **`check:accepted-restarts` — every recorded park is a park the suite
 * measures, and every park a child can get is recorded.**
 *
 * `src/world/acceptedRestarts.ts` records, per shipped seed, the restart the
 * root acceptance loop accepted (`scripts/lib/acceptedPark.mts`). The game and
 * every check build that restart. The record is only honest if something asks
 * it again: `test:procgen` does, building each recorded park and asserting
 * every measure — but only for the seeds that have a seed file. So this proves
 * the three lists are one:
 *
 * 1. every recorded seed has a `test/procgen/seed-*.test.ts` registering it
 *    (else a recorded restart could go stale unseen);
 *    every seed file's seed is recorded (else the suite measures restart 0 of
 *    a seed whose park is something else — or runs the loop in CI);
 * 2. the recorded seeds are exactly `SUPPORTED_PARK_SEEDS` (0..15, the parks a
 *    child can be given) — none missing, none extra (a retired seed's record
 *    would keep a park measured that nobody can get).
 *
 * Cheap: reads files, builds nothing.
 */
import { readdirSync, readFileSync } from 'node:fs';

import { ACCEPTED_RESTARTS } from '../src/world/acceptedRestarts.ts';
import { SUPPORTED_PARK_SEEDS } from '../src/world/parkSeedPool.ts';

const failures: string[] = [];
const recorded = new Set(Object.keys(ACCEPTED_RESTARTS).map(Number));

const fileSeeds = new Map<number, string>();
for (const name of readdirSync('test/procgen').filter((n) => /^seed-.*\.test\.ts$/.test(n)).sort()) {
  const text = readFileSync(`test/procgen/${name}`, 'utf8');
  const calls = [...text.matchAll(/registerParkInvariants\((\d+)/g)].map((m) => Number(m[1]));
  if (calls.length !== 1) failures.push(`${name} registers ${calls.length} seeds — one file, one seed (the seed is read once per module registry)`);
  for (const seed of calls) {
    if (fileSeeds.has(seed)) failures.push(`seed ${seed} is registered by both ${fileSeeds.get(seed)} and ${name}`);
    fileSeeds.set(seed, name);
  }
}

for (const seed of recorded) {
  if (!fileSeeds.has(seed)) failures.push(`seed ${seed} is recorded at restart ${ACCEPTED_RESTARTS[seed]} but no test/procgen seed file measures it`);
}
for (const [seed, name] of fileSeeds) {
  if (!recorded.has(seed)) failures.push(`${name} measures seed ${seed}, which has no recorded restart — run pnpm run accept:parks -- ${seed} --write`);
}
const shipped = [...SUPPORTED_PARK_SEEDS];
for (const seed of shipped) {
  if (!recorded.has(seed)) failures.push(`seed ${seed} is supported but has no recorded restart — run pnpm run accept:parks -- ${seed} --write`);
}
for (const seed of recorded) {
  if (!shipped.includes(seed)) failures.push(`seed ${seed} has a recorded restart but is not a supported seed — delete its entry and its seed file`);
}

process.stdout.write(
  `check:accepted-restarts: ${recorded.size} recorded, ${fileSeeds.size} seed files, ${shipped.length} shipped seeds\n`,
);
if (failures.length > 0) {
  for (const line of failures) process.stdout.write(`  FAIL  ${line}\n`);
  process.exit(1);
}
process.stdout.write('check:accepted-restarts: OK — every recorded park is measured by test:procgen, every supported seed is recorded\n');
