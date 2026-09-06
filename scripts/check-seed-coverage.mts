/**
 * **Every park a child can be given is built by something that blocks a merge.**
 * Issue #510.
 *
 * ```
 * pnpm run check:seed-coverage
 * ```
 *
 * ## The failure this exists to make impossible
 *
 * Both required checks were fully green on `main` while **fourteen of the
 * sixteen pool seeds were unmeasured**, and nine of them were built by no
 * required check whatever. Nothing was wrong with any individual assertion;
 * the *sample* they ran against was not the park a child gets. A gate can be
 * sound and still be pointed at a sixteenth of the product.
 *
 * That is invisible by construction — a coverage gap has no failing test, it
 * has an *absence* of one — so the only way it stops recurring is if coverage
 * is itself an asserted, printed fact. This is that assertion.
 *
 * ## What it actually measures, and why it is not tautological
 *
 * It does not read a list and compare it with itself. It **runs
 * `check:park-pool --list`** — the very script CI runs — in a child process,
 * and compares the seeds that script says it will sweep against
 * `PARK_SEED_POOL`. So it fails if somebody slices the sweep, filters it,
 * caps it for speed, or points it at a hand-written list; the sweep has to
 * keep telling the truth about itself to stay green.
 *
 * It then checks the sweep is wired into a workflow that **blocks a merge**.
 * A sweep nobody runs is exactly the condition #510 is about, and a script
 * sitting in `package.json` unreferenced looks identical to a working gate
 * from the inside.
 *
 * ## The one thing it cannot see, said out loud
 *
 * **Whether a workflow is a required status check lives in GitHub's branch
 * protection, not in this repository**, and reading it needs an authenticated
 * `gh api repos/jimhigson/land-of-good-places/branches/main/protection`. A
 * check script has no token and must not have one. So {@link BLOCKING_JOBS} is
 * a statement *about* a setting held elsewhere, which is precisely the
 * two-definitions shape this repo keeps paying for — and it is unavoidable
 * here, so it is labelled rather than hidden. It is printed on every run with
 * the command to verify it, and if branch protection is changed without this
 * list being changed, this check will go on believing the old answer.
 *
 * That is a real limit and not a small one. It is still worth having: the
 * common failure is somebody deleting a step or adding a seed, not somebody
 * silently editing branch protection.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

import { CI_SWEEP_SEEDS, PARK_SEED_POOL } from '../src/world/parkSeedPool.ts';

/**
 * **Workflow jobs that block a merge, by the `name:` GitHub matches on.**
 *
 * Verify against the setting that actually decides it — this file cannot:
 *
 * ```
 * gh api repos/jimhigson/land-of-good-places/branches/main/protection
 * ```
 *
 * `Seed pool` is deliberately NOT here: the whole-pool sweep runs inside
 * `Procgen invariants`, which is already required, so it gates on the day it
 * lands rather than waiting on a branch-protection change only Jim can make.
 * That is the same reasoning `check:gateway` is in that job under.
 */
const BLOCKING_JOBS: readonly { readonly workflow: string; readonly job: string }[] = [
  { workflow: '.github/workflows/checks.yml', job: 'Checks' },
  { workflow: '.github/workflows/procgen-invariants.yml', job: 'Procgen invariants' },
];

/**
 * **Read back from the real setting on 5 September 2026**, so this list is a
 * measurement rather than an assumption on the day it was written:
 *
 * ```
 * gh api .../branches/main/protection --jq '.required_status_checks.contexts'
 * ["Procgen invariants","Checks"]
 * ```
 *
 * Exactly two. Every other workflow in `.github/workflows` runs and blocks
 * nothing, which is why they are enumerated and named below rather than
 * counted — see {@link nonBlockingGates}.
 */
const PROTECTION_READ_BACK = '5 September 2026: ["Procgen invariants","Checks"]';

/**
 * **Jobs that run on a PR and are not gates at all**, so listing them as
 * "blocks nothing" would be crying wolf.
 *
 * A deploy *publishes*; it asserts nothing about the change, so there is
 * nothing for it to gate and it should never be a required check. The
 * distinction matters because a report that names three things when only two
 * are wrong gets skimmed, and then the two get missed.
 *
 * **Keep this tiny, and never add a check to it to quieten the output.** The
 * question to ask is "would making this required be a mistake?" — for a deploy
 * the answer is yes; for `Coplanar faces` it is emphatically no, which is why
 * that one is named every run.
 */
const NOT_A_GATE: readonly string[] = ['Deploy PR preview'];

let failures = 0;
function fail(what: string): void {
  failures += 1;
  process.stdout.write(`  FAIL  ${what}\n`);
}

// ------------------------------------------------- 1. what the sweep sweeps

/**
 * Ask the sweep itself, by running it. Reading `PARK_SEED_POOL` here and
 * calling that "coverage" would be this check asserting a constant against
 * itself — green forever, and blind to the only thing that can actually go
 * wrong.
 */
function seedsTheSweepWillAsk(): number[] {
  const raw = execFileSync(
    process.execPath,
    [
      '--no-warnings',
      '--import',
      './scripts/ts-extension-resolver-register.mjs',
      'scripts/check-park-pool.mts',
      '--list',
    ],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
  const line = raw.trim().split('\n').at(-1) ?? '[]';
  const parsed: unknown = JSON.parse(line);
  if (!Array.isArray(parsed) || parsed.some((n) => typeof n !== 'number')) {
    throw new Error(`check:park-pool --list did not print a list of numbers, got: ${line.slice(0, 120)}`);
  }
  return parsed as number[];
}

const swept = new Set(seedsTheSweepWillAsk());
const pool = [...PARK_SEED_POOL];

process.stdout.write(
  `check:seed-coverage: ${pool.length} seed(s) in PARK_SEED_POOL, ` +
    `${swept.size} swept by check:park-pool\n`,
);

const uncovered = pool.filter((seed) => !swept.has(seed));
if (uncovered.length > 0) {
  fail(
    `${uncovered.length} pool seed(s) are built by no whole-pool sweep: ${uncovered.join(', ')}. ` +
      `These are parks a child can be given. #510 is exactly this condition — the correct ` +
      `number here is zero, and it is reachable, so this does not ratchet.`,
  );
}

/**
 * A sweep asking for a seed that is **not** a park a child can draw is the
 * other direction of the same fault: it burns CI on a park nobody is given and,
 * worse, a retired seed failing would make the gate red for a reason that is
 * not a defect. `CI_SWEEP_SEEDS` already throws on this; the sweep should too.
 */
const strangers = [...swept].filter((seed) => !pool.includes(seed));
if (strangers.length > 0) {
  fail(
    `check:park-pool sweeps ${strangers.length} seed(s) not in PARK_SEED_POOL: ${strangers.join(', ')}. ` +
      `A seed outside the pool is not a park a child can be given — vet:seeds is the instrument for those.`,
  );
}

// -------------------------------------- 2. the sweep is wired into a blocker

const invocation = /pnpm run check:park-pool(?![\w:-])/;
const wiredInto = BLOCKING_JOBS.filter((where) => {
  let text: string;
  try {
    text = readFileSync(where.workflow, 'utf8');
  } catch {
    fail(`${where.workflow} does not exist — a job named in BLOCKING_JOBS has been moved or renamed`);
    return false;
  }
  // **The indentation is the whole assertion.** A workflow file carries its own
  // top-level `name:` as well as each job's, and both read `name: Procgen
  // invariants` here — on lines 1 and 40. GitHub gates on the **job's**, so
  // matching without requiring indentation matched the *workflow* name and
  // stayed green while the job was renamed: green through the exact rename this
  // exists to catch.
  //
  // **`[ \t]{2,}`, never `\s{2,}` — `\s` matches a NEWLINE.** With `\s{2,}` the
  // quantifier is satisfied by two *line breaks*, so `^\s{2,}name:` happily
  // matches a top-of-file `name:` preceded by two blank lines and the check goes
  // blind again, silently, in precisely the way it was just fixed not to.
  // Proved in isolation against
  //   "\n\nname: Procgen invariants\njobs:\n  invariants:\n    name: Procgen invariants (fast)\n"
  // — a file whose JOB is renamed, i.e. one where this must fail:
  //   \s{2,}    matches -> true    (blind: reports the gate is fine)
  //   [ \t]{2,} matches -> false   (correct)
  // and both still match an ordinary healthy file, so the fix does not simply
  // break the match.
  if (!new RegExp(`^[ \\t]{2,}name:\\s*${where.job}\\s*$`, 'm').test(text)) {
    fail(
      `${where.workflow} no longer contains a job named "${where.job}". A required status check is ` +
        `matched BY NAME, so renaming it stops it gating merges and nothing goes red. Update branch ` +
        `protection in the same change and read it back.`,
    );
  }
  return invocation.test(text);
});

if (wiredInto.length === 0) {
  fail(
    `no merge-blocking workflow runs check:park-pool, so the whole-pool sweep gates nothing. ` +
      `It is defined in package.json and never run — which looks identical to a working gate ` +
      `from the inside, and is the failure #510 was written about.`,
  );
}

// ------------------------- 3. workflows that look like a gate and are not

/**
 * **Every workflow that runs on a pull request, and whether it actually blocks
 * one.**
 *
 * A workflow which runs on every PR, goes red on a real defect, and gates
 * nothing is the most expensive kind of check in this repository: it costs the
 * runner minutes, it produces the reassuring green tick, and a merge sails past
 * it. It is #510's own disease one level up — a gate pointed at the wrong
 * sample versus a gate wired to nothing — and on `main` today there are two.
 *
 * They are **named, not counted**. "5 of 7 workflows block" tells a reader
 * nothing they can act on; "Coplanar faces runs on every PR and blocks nothing"
 * is a sentence somebody can take to Jim.
 *
 * This does **not** fail the check. Whether a workflow should be required is
 * Jim's call and a repository setting nobody here may touch — CLAUDE.md is
 * report-don't-act on settings. Printing it every run is the report.
 */
function nonBlockingGates(): string[] {
  const blocking = new Set(BLOCKING_JOBS.map((b) => b.job));
  const out: string[] = [];
  for (const file of readdirSync('.github/workflows').sort()) {
    if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
    const path = `.github/workflows/${file}`;
    const text = readFileSync(path, 'utf8');
    // Only workflows that run on a pull request can gate one at all. A deploy
    // or a scheduled job is not a gate that is missing, it is not a gate.
    if (!/^on:/m.test(text) || !/^\s+pull_request:?\s*$/m.test(text)) continue;
    for (const line of text.split('\n')) {
      // [ \t]{2,}, not \s{2,}: this one splits on newlines first so \s cannot span
      // them today, but the trap is one refactor away and the sibling assertion
      // above shipped with exactly this bug. Same shape, same fix.
      const match = /^[ \t]{2,}name:\s*(.+?)\s*$/.exec(line);
      if (!match?.[1]) continue;
      const job = match[1].replace(/^['"]|['"]$/g, '');
      if (!blocking.has(job) && !NOT_A_GATE.includes(job)) out.push(`${job}  (${file})`);
    }
  }
  return out;
}

const looksLikeAGate = nonBlockingGates();

// ------------------------------------------------------- 4. the coverage map

/**
 * **Printed on every run, pass or fail** — CLAUDE.md: "When a check stops
 * covering something, it must say so on every run — and you must confirm
 * anyone can hear it."
 *
 * On **stdout**. This is a plain Node script, not a Vitest suite, so both
 * streams are visible and stdout is where a reader of a CI log looks.
 * (Measured on this branch: `console.log` is invisible on a *passing* Vitest
 * run while both `process.stdout.write` and `process.stderr.write` are
 * visible — so the real distinction there is `console.*` interception, not
 * stdout-versus-stderr. Neither applies to a script like this one.)
 */
const perSeedFiles = [...CI_SWEEP_SEEDS];
process.stdout.write(
  `\n  the coverage map, as it stands:\n` +
    `    check:park          canonical seed only, in the ${'`check`'} chain\n` +
    `    check:park-pool     all ${pool.length} pool seeds, in ${
      wiredInto.map((w) => w.job).join(' + ') || 'NOTHING — see the failure above'
    }\n` +
    `    check:gateway       all ${pool.length} pool seeds, in Procgen invariants\n` +
    `    check:fountain-hop  ${CI_SWEEP_SEEDS.length} seeds (CI_SWEEP_SEEDS), in the ${'`check`'} chain\n` +
    `    test:procgen        ${perSeedFiles.length} seeds with per-seed files: ${perSeedFiles.join(', ')}\n` +
    `\n  WHAT IS STILL NOT COVERED, and it is not nothing:\n` +
    `    - ${pool.length - perSeedFiles.length} pool seed(s) have NO per-seed invariant file, so their\n` +
    `      furniture placement is never checked by test/procgen. check:park and the\n` +
    `      invariant suite do not imply each other (#437).\n` +
    `    - the other ${'~'}40 seed-dependent steps of the ${'`check`'} chain build the canonical\n` +
    `      park and nothing else. This check does NOT assert otherwise, and running them\n` +
    `      on sixteen seeds is not proposed: checks.yml is at ~27 of its 30-minute cap.\n` +
    `\n  RUNS ON EVERY PR AND BLOCKS NOTHING — a green tick a merge sails past:\n` +
    (looksLikeAGate.length === 0
      ? `    (none — every PR-triggered workflow is a required check)\n`
      : looksLikeAGate.map((w) => `    ${w}\n`).join('')) +
    `    Making one of these required is a repository setting, which is Jim's alone\n` +
    `    (CLAUDE.md: report, do not act). Named here so the report is actionable.\n` +
    `\n  BLOCKING_JOBS is a claim about GitHub branch protection, which lives outside\n` +
    `  this repository and cannot be read from here. Read back ${PROTECTION_READ_BACK}.\n` +
    `  Verify it with:\n` +
    `    gh api repos/jimhigson/land-of-good-places/branches/main/protection \\\n` +
    `      --jq '.required_status_checks.contexts'\n`,
);

if (failures > 0) {
  process.stdout.write(`\ncheck:seed-coverage: ${failures} failure(s).\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `\ncheck:seed-coverage: every one of the ${pool.length} parks a child can be given is built by ` +
      `a merge-blocking check.\n`,
  );
}
