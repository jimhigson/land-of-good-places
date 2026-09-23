/**
 * **`pnpm run build:parks` — solve every park a child can be given, now, so
 * that her device does not have to.** Writes `.parks/<seed>.json` and
 * `.parks/manifest.json` for `vite build` to ship (`docs/design/PREBUILT-PARKS.md`).
 *
 * ```
 * pnpm run build:parks                 # PARK_SEED_POOL — the parks that ship
 * LGP_SEEDS=0,1,2 pnpm run build:parks # any seeds, for measuring
 * LGP_LANES=8 …                        # parallelism (default: min(4, cores))
 * ```
 *
 * Every file is **proven before it is kept**: hydrated in a second process and
 * digested against the fresh solve it came from (`scripts/lib/parkFiles.mts`),
 * with a perturbed-file control once per run. Any failure exits 1 and writes
 * no manifest, and without a manifest `vite build` ships no parks — the
 * client then solves, which is slow and correct. `LGP_REQUIRE_PARKS=1` on the
 * build (set by the deploy workflows) turns "no parks" into a failed build.
 *
 * This is not part of `pnpm run build`, which stays a fast artefact step
 * (CLAUDE.md, "`build` and `check` are different things"). It takes minutes;
 * CI caches its output on the same inputs {@link parkSourceHash} hashes.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';

import { PARK_SEED_POOL } from '../src/world/parkSeedPool.ts';
import {
  PARK_FILE_FORMAT,
  PREBUILT_PARKS_MANIFEST,
  PREBUILT_PARKS_OUT,
  type PrebuiltParksManifest,
} from '../src/world/prebuilt/parkFileName.ts';
import { parkSourceHash } from './lib/park-source-hash.mjs';
import { buildAndVerify } from './lib/parkFiles.mts';

const root = process.cwd();
const started = performance.now();
const requested = (process.env['LGP_SEEDS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);
if (requested.some((n) => !Number.isInteger(n) || n < 0)) throw new Error(`build:parks: bad LGP_SEEDS ${process.env['LGP_SEEDS']}`);
const seeds = requested.length > 0 ? requested : [...PARK_SEED_POOL];
const lanes = Math.max(1, Math.min(Number(process.env['LGP_LANES'] ?? 4), cpus().length));

const sourceHash = parkSourceHash(root);
const outDir = join(root, PREBUILT_PARKS_OUT);
mkdirSync(outDir, { recursive: true });
// Start clean: a manifest or a file left from another source must not survive
// into this run's output, whatever this run does.
for (const name of readdirSync(outDir)) rmSync(join(outDir, name));

console.log(`build:parks: ${seeds.length} seed(s) [${seeds.join(', ')}], ${lanes} at a time, source ${sourceHash.slice(0, 12)}`);
const { outcomes, controlProblem } = await buildAndVerify(seeds, outDir, lanes, (line) => console.log(line));

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
console.log('\n| seed | raw | gzip -9 | brotli 11 | plan searched | plan hydrated | digest |');
console.log('|---:|---:|---:|---:|---:|---:|---|');
for (const o of outcomes) {
  console.log(
    `| ${o.seed} | ${kb(o.raw)} | ${kb(o.gzip)} | ${kb(o.brotli)} | ${o.solved.planCpuMs} ms | ${o.hydrated.planCpuMs} ms | ${o.solved.park} |`,
  );
}
const sum = (pick: (o: (typeof outcomes)[number]) => number): number => outcomes.reduce((t, o) => t + pick(o), 0);
console.log(`| **total** | ${kb(sum((o) => o.raw))} | ${kb(sum((o) => o.gzip))} | ${kb(sum((o) => o.brotli))} | | | |`);

const failed = outcomes.filter((o) => o.problems.length > 0);
for (const o of failed) for (const problem of o.problems) console.error(`build:parks: seed ${o.seed}: ${problem}`);
if (controlProblem) console.error(`build:parks: ${controlProblem}`);
if (parkSourceHash(root) !== sourceHash) {
  console.error('build:parks: the source changed while the parks were being solved — run it again');
  process.exit(1);
}
if (failed.length > 0 || controlProblem) {
  console.error(`build:parks: FAILED — no manifest written, so vite build will ship no parks`);
  process.exit(1);
}

const manifest: PrebuiltParksManifest = {
  format: PARK_FILE_FORMAT,
  sourceHash,
  seeds,
  digests: Object.fromEntries(outcomes.map((o) => [String(o.seed), o.solved.park])),
};
writeFileSync(join(outDir, PREBUILT_PARKS_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\nbuild:parks: ${outcomes.length} park(s) proven and written to ${PREBUILT_PARKS_OUT}/ in ${((performance.now() - started) / 1000).toFixed(0)} s`);
