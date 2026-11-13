/**
 * **`pnpm run validate:parks` — does this source still accept the parks that
 * are checked in?** It never solves anything.
 *
 * ```
 * pnpm run validate:parks                 # all sixteen
 * LGP_SEEDS=7 pnpm run validate:parks     # one seed (CI runs one per runner)
 * LGP_LANES=8 …                           # seeds at a time (default: min(4, cores))
 * pnpm run validate:parks -- --fresh      # measure again even if this exact source already accepted them
 * ```
 *
 * The solved parks are tracked in `parks/` (`docs/design/PREBUILT-PARKS.md`,
 * "Checked in"), and a change to the code does not re-solve them. What keeps a
 * checked-in park honest is this: each file is hydrated by the **current**
 * code in a fresh process and asked the same acceptance attempt a freshly
 * solved park gets (`scripts/lib/parkFiles.mts`' `validatePark`, over
 * `scripts/park-attempt.mts` — one owner of the measures), then held to the
 * placement digest its manifest line records.
 *
 * Per seed, on stderr: `seed N accepted in S s`, or `seed N REJECTED by
 * <clause>: …` with the one command that puts it right
 * (`LGP_SEEDS=N pnpm run build:parks`, which re-solves only that seed), or
 * `seed N PLACEMENT MOVED` when the park is still accepted but is no longer
 * the park the manifest records (re-stamp; no solve). Exit 1 unless every
 * seed asked for is accepted as recorded.
 *
 * Outside CI, a seed this exact source (`park-source-hash.mjs`) has already
 * accepted is not measured again — the verdict is a fact about the file and
 * the source, both unchanged. `--fresh` (or `CI=true`) measures anyway.
 */
import { cpus } from 'node:os';

import { PREBUILT_PARKS_OUT, SUPPORTED_PARK_SEEDS } from '../src/world/prebuilt/parkFileName.ts';
import { PARK_CHANGING_SWITCHES } from './lib/acceptedPark.mts';
import { validateParks } from './lib/parkFiles.mts';

const root = process.cwd();
const started = performance.now();
const requested = (process.env['LGP_SEEDS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);
if (requested.some((n) => !SUPPORTED_PARK_SEEDS.includes(n))) {
  console.error(`validate:parks: bad LGP_SEEDS ${process.env['LGP_SEEDS']} — this game has seeds ${SUPPORTED_PARK_SEEDS.join(', ')}`);
  process.exit(2);
}
const seeds = requested.length > 0 ? requested : [...SUPPORTED_PARK_SEEDS];
const lanes = Math.max(1, Math.min(Number(process.env['LGP_LANES'] ?? 4), cpus().length));
const fresh = process.argv.includes('--fresh');

// A verdict taken under a switch that alters the generator is not a verdict
// about the park that ships.
const altered = PARK_CHANGING_SWITCHES.filter((key) => process.env[key] !== undefined && process.env[key] !== '');
if (altered.length > 0 || process.env['LGP_PARK_RESTART'] !== undefined || process.env['LGP_SOLVE'] === '1') {
  console.error(
    `validate:parks: refusing to validate under ${[...altered, ...(process.env['LGP_PARK_RESTART'] !== undefined ? ['LGP_PARK_RESTART'] : []), ...(process.env['LGP_SOLVE'] === '1' ? ['LGP_SOLVE'] : [])].join(', ')} — the parks measured would not be the checked-in ones`,
  );
  process.exit(2);
}

console.log(`validate:parks: ${seeds.length} checked-in park(s) [${seeds.join(', ')}] from ${PREBUILT_PARKS_OUT}/, ${lanes} at a time — nothing is solved`);
const validations = await validateParks(root, seeds, lanes, { fresh, label: 'validate:parks' });

// What this did not cover, on every run and on stderr (a passing run prints it too).
const unasked = [...new Set(validations.flatMap((v) => v.askedOfASolveOnly))];
process.stderr.write(
  'validate:parks NOTE: a checked-in park has no solve behind it, so the measures that need a live search were NOT asked of ' +
    `${validations.filter((v) => v.askedOfASolveOnly.length > 0).length} of ${validations.length} seed(s): ${unasked.join(', ') || '(none)'}. ` +
    'The only such measure is the layout rung\'s false-refusal proof, and only on a park whose rung fired; it is asked when a park is ' +
    'solved (build:parks). check:stall-accommodate IS asked of every checked-in park (it resumes the stalls builder over the hydrated park).\n',
);
process.stderr.write(
  'validate:parks NOTE: the placement digest covers ground claims and the park boundary only — NOT meshes or colliders ' +
    '(scripts/lib/parkLayoutDigest.mts says why). A reshaped collider is judged by the acceptance measures above, not by the digest.\n',
);

const count = (status: string): number => validations.filter((v) => v.status === status).length;
const seedsOf = (status: string): string =>
  validations
    .filter((v) => v.status === status)
    .map((v) => v.seed)
    .join(', ');
const took = ((performance.now() - started) / 1000).toFixed(0);
const cached = validations.filter((v) => v.cached).length;
if (count('accepted') === validations.length) {
  console.log(
    `validate:parks passed: ${validations.length} of ${validations.length} checked-in park(s) accepted by this source in ${took} s` +
      (cached > 0 ? ` (${cached} already accepted at this exact source, not measured again; --fresh measures them)` : ''),
  );
} else {
  console.error(
    `validate:parks FAILED in ${took} s: ${count('accepted')} accepted` +
      (count('rejected') > 0 ? `, ${count('rejected')} REJECTED [seed ${seedsOf('rejected')}]` : '') +
      (count('restamp') > 0 ? `, ${count('restamp')} with placement moved [seed ${seedsOf('restamp')}]` : '') +
      (count('broken') > 0 ? `, ${count('broken')} could not be measured [seed ${seedsOf('broken')}]` : '') +
      '. Each is said above with what to do. `pnpm run build:parks` does all of it at once: it keeps every park this source ' +
      'accepts, re-stamps the moved ones and re-solves only the rejected ones — commit what it changes in parks/ with your change.',
  );
  process.exitCode = 1;
}
