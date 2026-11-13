/**
 * **`pnpm run build:parks` — put the checked-in parks right for this source,
 * solving only what has to be solved.**
 *
 * ```
 * pnpm run build:parks                      # validate all sixteen; re-solve only the rejected
 * LGP_SEEDS=7 pnpm run build:parks          # just seed 7
 * LGP_SEEDS=7 pnpm run build:parks -- --force   # solve seed 7 again even though it is accepted
 * LGP_LANES=8 …                             # seeds at a time (default: min(4, cores))
 * LGP_RESTART_LANES=4 …                     # restarts of one seed at a time, speculatively (default 1;
 *                                           #   the answer is the same — acceptPark consumes them in order)
 * ```
 *
 * The solved parks are tracked in `parks/` (`docs/design/PREBUILT-PARKS.md`,
 * "Checked in"; Jim, 13 November 2026: *"how about if we checked in the result
 * of the solve so we don't have to do it every time?"*). Nothing else in the
 * repository solves one: the dev server, `vite build`, every check and the
 * invariant suite read the files. So this is the one command for someone who
 * really is changing park geometry, a footprint, or a measure. Per seed:
 *
 * 1. **validate** the checked-in file against this source (`validatePark`,
 *    exactly what `validate:parks` and CI run);
 * 2. **accepted** — kept, untouched;
 * 3. **placement moved** (accepted, but the manifest's placement digest is not
 *    what this source builds, or was never stamped) — the manifest line is
 *    re-stamped. No solve;
 * 4. **rejected**, missing, or `--force` — solved again by the accept loop
 *    (restart 0, 1, 2, … until the park hydrated from that restart's file
 *    passes every acceptance measure), proven (hydrated in another process
 *    and digested against the solve, nothing searched, a perturbed-file
 *    control once per run — `parkFiles.mts`), and written to `parks/` with
 *    its manifest line.
 *
 * It says how many it kept, and exits 0 only when every seed asked for ends
 * accepted. **Commit what it changed in `parks/` with the change that made it
 * necessary.**
 *
 * Two refusals. A seed that *could not be measured* (a measure threw) is a bug
 * no re-solve fixes: nothing is solved for it. And if **every** seed asked for
 * (four or more) is rejected, that is almost always one broken instrument
 * rather than that many bad parks, and a from-scratch solve of sixteen is
 * 30-45 minutes of CI-sized work — so it stops unless `LGP_SOLVE_ALL=1` says
 * you mean it.
 *
 * This is not part of `pnpm run build`, which stays a fast artefact step
 * (CLAUDE.md, "`build` and `check` are different things").
 */
import { cpus } from 'node:os';

import { PARK_FILE_FORMAT, PREBUILT_PARKS_MANIFEST, PREBUILT_PARKS_OUT, SUPPORTED_PARK_SEEDS } from '../src/world/prebuilt/parkFileName.ts';
import { readParksManifest } from './lib/checked-in-parks.mjs';
import { parkSourceHash } from './lib/park-source-hash.mjs';
import { buildAcceptedParks, stampManifestLine, validateParks, type ParkValidation } from './lib/parkFiles.mts';

const root = process.cwd();
const started = performance.now();
const requested = (process.env['LGP_SEEDS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);
if (requested.some((n) => !Number.isInteger(n) || n < 0)) throw new Error(`build:parks: bad LGP_SEEDS ${process.env['LGP_SEEDS']}`);
const seeds = requested.length > 0 ? requested : [...SUPPORTED_PARK_SEEDS];
const unsupported = seeds.filter((seed) => !SUPPORTED_PARK_SEEDS.includes(seed));
if (unsupported.length > 0) throw new Error(`build:parks: seeds ${unsupported.join(', ')} are not supported (0..15 only)`);
const lanes = Math.max(1, Math.min(Number(process.env['LGP_LANES'] ?? 4), cpus().length));
const force = process.argv.includes('--force');
const fresh = process.argv.includes('--fresh');
const solveAll = process.env['LGP_SOLVE_ALL'] === '1';

// Any other switch changes what a park build does (`LGP_WARP`, `LGP_LAYOUT_RUNG`,
// `LGP_PARK_RESTART`, …), and a file built under one is not the park its
// seed is: refused rather than checked in.
const HARMLESS = new Set(['LGP_SEEDS', 'LGP_LANES', 'LGP_RESTART_LANES', 'LGP_PARK_TIMEOUT_MS', 'LGP_SOLVE_ALL']);
const switches = Object.keys(process.env).filter((key) => key.startsWith('LGP_') && !HARMLESS.has(key));
if (switches.length > 0) {
  console.error(`build:parks: refusing to build parks under ${switches.join(', ')} — they would not be the parks the seeds are`);
  process.exit(1);
}
if (force && requested.length === 0 && !solveAll) {
  console.error(
    'build:parks: --force with no LGP_SEEDS would solve all sixteen parks from scratch (30-45 minutes on sixteen CI runners, hours on one Mac). ' +
      'Name the seeds (`LGP_SEEDS=7 pnpm run build:parks -- --force`), or set LGP_SOLVE_ALL=1 if you mean all of them.',
  );
  process.exit(1);
}

const sourceHash = parkSourceHash(root);
console.log(`build:parks: ${seeds.length} seed(s) [${seeds.join(', ')}], ${lanes} at a time, source ${sourceHash.slice(0, 12)}`);

// 1. What does this source make of the parks that are checked in?
let validations: ParkValidation[] = [];
if (force) {
  console.log(`build:parks: --force — solving seed(s) ${seeds.join(', ')} again without asking whether they are still accepted`);
} else {
  console.log(`build:parks: validating the checked-in park(s) first — only the rejected are solved again`);
  validations = await validateParks(root, seeds, lanes, { fresh, label: 'build:parks' });
}
const withStatus = (status: ParkValidation['status']): number[] => validations.filter((v) => v.status === status).map((v) => v.seed);
const kept = withStatus('accepted');
const moved = validations.filter((v) => v.status === 'restamp');
const broken = withStatus('broken');
const toSolve = force ? [...seeds] : withStatus('rejected');

// 2. Accepted, but no longer the placements the manifest records: re-stamp. No solve.
for (const v of moved) {
  const was = readParksManifest(root)?.seeds[String(v.seed)];
  stampManifestLine(root, v.seed, {
    restart: v.restart as number,
    file: v.fileSha as string,
    layout: v.layout as string,
    // A note of what it was solved under, which re-stamping does not change;
    // a file adopted with no line was solved under something this cannot know.
    solvedUnder: was?.solvedUnder ?? 'unknown',
  });
  console.log(`build:parks: seed ${v.seed} re-stamped — placement ${v.recordedLayout ?? '(none)'} -> ${v.layout}; no solve`);
}

if (broken.length > 0) {
  console.error(
    `build:parks: seed(s) ${broken.join(', ')} could not be measured (said above). That is a bug in a measure or in the code that hydrates ` +
      'a park; solving again cannot fix it, so nothing was solved. Fix the cause and run this again.',
  );
}

// 3. Rejected: solve those seeds again, and only those.
let solved: Awaited<ReturnType<typeof buildAcceptedParks>> = { outcomes: [], controlProblem: null };
let refusedToSolve = false;
if (toSolve.length > 0 && broken.length === 0) {
  if (!force && !solveAll && toSolve.length === seeds.length && seeds.length >= 4) {
    refusedToSolve = true;
    console.error(
      `build:parks: STOPPED — all ${seeds.length} seeds asked for were rejected. That is almost always one broken instrument or one ` +
        'change that broke every park, not that many bad parks; read the rejections above before paying for the solves. ' +
        'If the park geometry really did change for every seed, run it again with LGP_SOLVE_ALL=1.',
    );
  } else {
    console.log(
      `build:parks: solving ${toSolve.length} seed(s) again [${toSolve.join(', ')}] — ${process.env['LGP_RESTART_LANES'] ?? 1} restart(s) of each at a time. ` +
        'This is minutes per seed.',
    );
    const restartLanes = Math.max(1, Number(process.env['LGP_RESTART_LANES'] ?? 1));
    solved = await buildAcceptedParks(toSolve, root, lanes, (line) => console.log(line), restartLanes);
  }
}

const { outcomes, controlProblem } = solved;
if (outcomes.length > 0) {
  const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
  console.log('\n| seed | restart | attempts | seconds | raw | gzip -9 | brotli 11 | plan searched | plan hydrated | placement |');
  console.log('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const o of outcomes) {
    console.log(
      `| ${o.seed} | ${o.restart} | ${o.acceptance.attempts} | ${o.seconds} | ${kb(o.raw)} | ${kb(o.gzip)} | ${kb(o.brotli)} | ${o.solved.planCpuMs} ms | ${o.hydrated.planCpuMs} ms | ${o.hydrated.layout} |`,
    );
  }
}

const failed = outcomes.filter((o) => o.problems.length > 0 || !o.installed);
for (const o of failed) for (const problem of o.problems) console.error(`build:parks: seed ${o.seed}: ${problem}`);
if (outcomes.length > 0 && controlProblem) console.error(`build:parks: ${controlProblem}`);
const sourceMoved = parkSourceHash(root) !== sourceHash;
if (sourceMoved) console.error('build:parks: the source changed while this was running — run it again');

const resolved = outcomes.filter((o) => o.installed).map((o) => o.seed);
const manifest = readParksManifest(root);
const missing = seeds.filter((seed) => !manifest || manifest.format !== PARK_FILE_FORMAT || !manifest.seeds[String(seed)]?.layout);
const took = ((performance.now() - started) / 1000).toFixed(0);
console.log(
  `\nbuild:parks: kept ${kept.length} of ${seeds.length} checked-in park(s) as they were` +
    (kept.length > 0 ? ` [${kept.join(', ')}]` : '') +
    `, re-stamped ${moved.length}` +
    (moved.length > 0 ? ` [${moved.map((v) => v.seed).join(', ')}]` : '') +
    `, solved ${resolved.length} again` +
    (resolved.length > 0 ? ` [${resolved.join(', ')}]` : '') +
    ` — ${took} s.`,
);
if (broken.length > 0 || refusedToSolve || failed.length > 0 || (outcomes.length > 0 && controlProblem) || sourceMoved || missing.length > 0) {
  console.error(`build:parks: FAILED — not every seed asked for is accepted${missing.length > 0 ? ` (no stamped manifest line for seed ${missing.join(', ')})` : ''}.`);
  process.exit(1);
}
if (moved.length > 0 || resolved.length > 0) {
  const files = [...resolved.map((seed) => `${PREBUILT_PARKS_OUT}/${seed}.json`), `${PREBUILT_PARKS_OUT}/${PREBUILT_PARKS_MANIFEST}`];
  console.log(`build:parks: commit ${files.join(' ')} with your change.`);
} else {
  console.log('build:parks: nothing to commit — every park asked for is accepted by this source as it is checked in.');
}
