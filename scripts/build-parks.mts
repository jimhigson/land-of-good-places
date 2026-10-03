/**
 * **`pnpm run build:parks` — find every park a child can be given, now, so
 * that her device does not have to.** Writes `.parks/<seed>.json` and
 * `.parks/manifest.json` for `vite build` to ship (`docs/design/PREBUILT-PARKS.md`).
 *
 * ```
 * pnpm run build:parks                 # SUPPORTED_PARK_SEEDS — the parks that ship
 * LGP_SEEDS=0,1,2 pnpm run build:parks # some seeds (still 0..15 only)
 * LGP_LANES=8 …                        # seeds at a time (default: min(4, cores))
 * LGP_RESTART_LANES=4 …                # restarts of one seed at a time, speculatively (default 1;
 *                                      #   the answer is the same — acceptPark consumes them in order)
 * LGP_PARKS_OUT=dir …                  # write somewhere other than .parks/ (the dev server)
 * ```
 *
 * **It owns the accepted restart** (Jim, Oct 2026: the re-record is automatic).
 * Per seed it runs the accept loop — restart 0, 1, 2, … until the park
 * hydrated from that restart's file passes every acceptance measure — and the
 * file carries the restart and every attempt that led to it (`acceptance`).
 * Nothing is recorded by hand: the output is keyed by the source hash
 * (`scripts/lib/park-source-hash.mjs` — the game, the generator and the
 * measures), CI caches it on the same inputs, and a change to any of them
 * searches again. `builtRestartOf` (`scripts/lib/parkFiles.mts`) is how Node
 * tooling reads a seed's restart back, fresh or not at all.
 *
 * Every accepted file is then **proven**: hydrated in another process and
 * digested against the solve it came from, nothing searched, with a
 * perturbed-file control once per run (`parkFiles.mts`). Any failure exits 1
 * and writes no manifest, and without a manifest `vite build` ships no parks —
 * so the game has none, and says so (`ParkUnavailable`). `LGP_REQUIRE_PARKS=1`
 * on the build (set by the deploy workflows) turns "no parks" into a failed
 * build.
 *
 * This is not part of `pnpm run build`, which stays a fast artefact step
 * (CLAUDE.md, "`build` and `check` are different things").
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';

import { PARK_SEED_POOL } from '../src/world/parkSeedPool.ts';
import { PREBUILT_PARKS_MANIFEST, PREBUILT_PARKS_OUT } from '../src/world/prebuilt/parkFileName.ts';
import { SUPPORTED_PARK_SEEDS } from '../src/world/prebuilt/parkFileName.ts';
import { parkSourceHash } from './lib/park-source-hash.mjs';
import { buildAcceptedParks, parksManifest } from './lib/parkFiles.mts';

const root = process.cwd();
const started = performance.now();
const requested = (process.env['LGP_SEEDS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);
if (requested.some((n) => !Number.isInteger(n) || n < 0)) throw new Error(`build:parks: bad LGP_SEEDS ${process.env['LGP_SEEDS']}`);
const seeds = requested.length > 0 ? requested : [...PARK_SEED_POOL];
const unsupported = seeds.filter((seed) => !SUPPORTED_PARK_SEEDS.includes(seed));
if (unsupported.length > 0) throw new Error(`build:parks: seeds ${unsupported.join(', ')} are not supported (0..15 only)`);
const lanes = Math.max(1, Math.min(Number(process.env['LGP_LANES'] ?? 4), cpus().length));

// Any other switch changes what a park build does (`LGP_WARP`, `LGP_LAYOUT_RUNG`,
// `LGP_PARK_RESTART`, …), and a file built under one is not the park its
// seed is: refused rather than shipped.
const HARMLESS = new Set(['LGP_SEEDS', 'LGP_LANES', 'LGP_RESTART_LANES', 'LGP_PARK_TIMEOUT_MS', 'LGP_REQUIRE_PARKS', 'LGP_PARKS_OUT']);
const switches = Object.keys(process.env).filter((key) => key.startsWith('LGP_') && !HARMLESS.has(key));
if (switches.length > 0) {
  console.error(`build:parks: refusing to build parks under ${switches.join(', ')} — they would not be the parks the seeds are`);
  process.exit(1);
}

const sourceHash = parkSourceHash(root);
const outDir = join(root, process.env['LGP_PARKS_OUT'] || PREBUILT_PARKS_OUT);
mkdirSync(outDir, { recursive: true });
// Start clean: a manifest or a file left from another source must not survive
// into this run's output, whatever this run does.
// (Files only: `.parks/dev/` is the dev server's own cache, keyed by source.)
for (const name of readdirSync(outDir)) if (name.endsWith('.json')) rmSync(join(outDir, name));

console.log(
  `build:parks: ${seeds.length} seed(s) [${seeds.join(', ')}], ${lanes} at a time, ` +
    `${process.env['LGP_RESTART_LANES'] ?? 1} restart(s) of each at a time, source ${sourceHash.slice(0, 12)}`,
);
const restartLanes = Math.max(1, Number(process.env['LGP_RESTART_LANES'] ?? 1));
const { outcomes, controlProblem } = await buildAcceptedParks(seeds, outDir, lanes, (line) => console.log(line), restartLanes);

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
console.log('\n| seed | restart | attempts | seconds | raw | gzip -9 | brotli 11 | plan searched | plan hydrated | digest |');
console.log('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
for (const o of outcomes) {
  console.log(
    `| ${o.seed} | ${o.restart} | ${o.acceptance.attempts} | ${(o.acceptance.log.reduce((t, a) => t + a.wallMs, 0) / 1000).toFixed(0)} | ${kb(o.raw)} | ${kb(o.gzip)} | ${kb(o.brotli)} | ${o.solved.planCpuMs} ms | ${o.hydrated.planCpuMs} ms | ${o.solved.park} |`,
  );
}
const sum = (pick: (o: (typeof outcomes)[number]) => number): number => outcomes.reduce((t, o) => t + pick(o), 0);
console.log(`| **total** | | ${sum((o) => o.acceptance.attempts)} | | ${kb(sum((o) => o.raw))} | ${kb(sum((o) => o.gzip))} | ${kb(sum((o) => o.brotli))} | | | |`);

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

const manifest = parksManifest(sourceHash, outcomes);
writeFileSync(join(outDir, PREBUILT_PARKS_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\nbuild:parks: ${outcomes.length} park(s) proven and written to ${PREBUILT_PARKS_OUT}/ in ${((performance.now() - started) / 1000).toFixed(0)} s`);
