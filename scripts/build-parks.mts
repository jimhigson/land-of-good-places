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
 * Each seed is built at its **accepted restart** (`src/world/acceptedRestarts.ts`),
 * and its file carries that restart and how it was found — the root acceptance
 * loop's log for the seed (`procgen/acceptanceLog.json`, written beside the
 * restarts by `accept:parks --write`), as the file's `acceptance`.
 *
 * Every file is **proven before it is kept**: hydrated in a second process and
 * digested against the fresh solve it came from (`scripts/lib/parkFiles.mts`),
 * with a perturbed-file control once per run.
 *
 * And then **accepted as shipped**: every acceptance measure is asked of the
 * park hydrated from the file itself (`park-attempt.mts` under
 * `LGP_PARK_FILE`), in a fresh process per seed — the park a child will be
 * given, built the way her device builds it. The restart was accepted on
 * whichever machine ran `accept:parks`; a park solver's decisions can differ
 * between machines (Linux x64 against Mac arm64: seeds 0, 2, 4, 8, 11 on
 * 1 Oct), so the file this machine wrote is only shipped if it passes here
 * too. A rejection fails the build, naming the seed, the restart and the
 * first failing measure. It is never re-searched: a recorded restart means one
 * park, and a machine that builds another one is a divergence to remove at
 * source. Any failure exits 1 and writes
 * no manifest, and without a manifest `vite build` ships no parks — so the
 * game has none, and says so (`ParkUnavailable`). `LGP_REQUIRE_PARKS=1` on the
 * build (set by the deploy workflows) turns "no parks" into a failed build.
 *
 * This is not part of `pnpm run build`, which stays a fast artefact step
 * (CLAUDE.md, "`build` and `check` are different things"). It takes minutes;
 * CI caches its output on the same inputs {@link parkSourceHash} hashes.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { attemptInFreshProcess } from './lib/acceptedPark.mts';
import { acceptanceLogProblem, readAcceptanceLog, ACCEPTANCE_LOG_FILE } from './lib/acceptanceLog.mts';
import { ACCEPTED_RESTARTS } from '../src/world/acceptedRestarts.ts';

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

// Any other switch changes what a park build does (`LGP_WARP`, `LGP_LAYOUT_RUNG`,
// `LGP_PARK_RESTART`, …), and a file built under one is not the park its
// seed is: refused rather than shipped.
const HARMLESS = new Set(['LGP_SEEDS', 'LGP_LANES', 'LGP_PARK_TIMEOUT_MS', 'LGP_REQUIRE_PARKS']);
const switches = Object.keys(process.env).filter((key) => key.startsWith('LGP_') && !HARMLESS.has(key));
if (switches.length > 0) {
  console.error(`build:parks: refusing to build parks under ${switches.join(', ')} — they would not be the parks the seeds are`);
  process.exit(1);
}

// How each seed's restart was found, checked before minutes are spent solving.
const acceptance = readAcceptanceLog(root);
const logProblems = seeds
  .map((seed) => acceptanceLogProblem(acceptance[String(seed)], seed, ACCEPTED_RESTARTS[seed] ?? -1))
  .filter((p): p is string => p !== null);
if (logProblems.length > 0) {
  for (const problem of logProblems) console.error(`build:parks: ${problem} (${ACCEPTANCE_LOG_FILE})`);
  process.exit(1);
}

const sourceHash = parkSourceHash(root);
const outDir = join(root, PREBUILT_PARKS_OUT);
mkdirSync(outDir, { recursive: true });
// Start clean: a manifest or a file left from another source must not survive
// into this run's output, whatever this run does.
// (Files only: `.parks/dev/` is the dev server's own cache, keyed by source.)
for (const name of readdirSync(outDir)) if (name.endsWith('.json')) rmSync(join(outDir, name));

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

// Proven; now asked every acceptance measure, as the park it will ship as.
console.log(`\nbuild:parks: accepting the ${outcomes.length} file(s) as shipped — every measure, on the park hydrated from each`);
const acceptBegan = performance.now();
const rejected: string[] = [];
const acceptQueue = [...outcomes].reverse();
await Promise.all(
  Array.from({ length: Math.min(lanes, acceptQueue.length) }, async () => {
    for (let o = acceptQueue.pop(); o !== undefined; o = acceptQueue.pop()) {
      const restart = ACCEPTED_RESTARTS[o.seed] as number;
      const began = performance.now();
      let line: string;
      try {
        const verdict = await attemptInFreshProcess(o.seed, restart, o.file);
        if (verdict.parkFile === null || verdict.restart !== restart || verdict.seed !== o.seed) {
          line = `seed ${o.seed} restart ${restart}: the acceptance attempt did not build the file (it built seed ${verdict.seed} restart ${verdict.restart}, file ${verdict.parkFile})`;
          rejected.push(line);
        } else if (!verdict.accepted) {
          const first = verdict.failures[0];
          line =
            `seed ${o.seed} restart ${restart}: the shipped file is REJECTED by ${verdict.failures.length} measure(s); first: ` +
            `${first?.measure ?? '(none)'} — ${first?.first[0] ?? verdict.broken ?? '(no complaint)'}` +
            (verdict.failures.length > 1 ? `; also ${verdict.failures.slice(1).map((f) => f.measure).join(', ')}` : '');
          rejected.push(line);
        } else {
          line = `seed ${o.seed} restart ${restart}: accepted as shipped, ${verdict.measuresAsked} measures`;
        }
      } catch (error) {
        line = `seed ${o.seed} restart ${restart}: the acceptance attempt broke — ${String(error).split('\n').slice(0, 6).join(' | ')}`;
        rejected.push(line);
      }
      console.log(`  ${line} (${((performance.now() - began) / 1000).toFixed(0)} s)`);
    }
  }),
);
console.log(`build:parks: acceptance of the shipped files took ${((performance.now() - acceptBegan) / 1000).toFixed(0)} s`);
if (rejected.length > 0) {
  for (const line of rejected) console.error(`build:parks: ${line}`);
  console.error(
    'build:parks: FAILED — a shipped park must be the park that was accepted. Not re-searched: remove the divergence at ' +
      'source (scripts/park-identity.mts names the first decision that differs), or re-run accept:parks. No manifest written.',
  );
  process.exit(1);
}

// Proven; now say how each restart was found. `acceptance` is not read by
// the game, so adding it after the proof changes nothing the proof covered.
for (const o of outcomes) {
  const file = JSON.parse(readFileSync(o.file, 'utf8')) as Record<string, unknown>;
  file['acceptance'] = acceptance[String(o.seed)] as unknown;
  writeFileSync(o.file, JSON.stringify(file));
}

const manifest: PrebuiltParksManifest = {
  format: PARK_FILE_FORMAT,
  sourceHash,
  seeds,
  digests: Object.fromEntries(outcomes.map((o) => [String(o.seed), o.solved.park])),
};
writeFileSync(join(outDir, PREBUILT_PARKS_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\nbuild:parks: ${outcomes.length} park(s) proven and written to ${PREBUILT_PARKS_OUT}/ in ${((performance.now() - started) / 1000).toFixed(0)} s`);
