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
 * It does not read a list and compare it with itself. It **asks vitest**
 * (`vitest list`, in a child process) which tests the invariant suite would
 * run, file by file, and requires every pool seed to have a file that runs the
 * whole-park measures in {@link WHOLE_PARK_MEASURES}: the invariants'
 * representatives, `check:park` (with its ratchet), the walk in through the
 * front gate and the fountain hop. Each seed's park is built once, by that
 * file, and every one of those is asked of it. So it fails if a seed file goes
 * missing, if one is skipped, or if a measure is dropped from the per-seed
 * registration.
 *
 * Until 2 October 2026 those three ran as sweeps of their own
 * (`check:park-pool`, `check:gateway`, `check:fountain-hop`), each building all
 * sixteen parks again; at sixteen seeds the pool job was cancelled at its
 * 25-minute cap on every run and fountain-hop outgrew its check shard. They are
 * still scripts, for running by hand.
 *
 * It then checks the suite is wired into a workflow that **blocks a merge**.
 * A suite nobody runs is exactly the condition #510 is about, and a script
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
 * `Seed pool` is deliberately NOT here: the whole-pool measures run inside
 * `Procgen invariants`, which is already required, so they gate on the day
 * they land rather than waiting on a branch-protection change only Jim can make.
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
 * **What every seed's file must ask of its park**, by the test names vitest
 * registers. Each is the one owner of its measure; the per-seed file is the one
 * place the park is built.
 */
const WHOLE_PARK_MEASURES: readonly string[] = [
  'built the park it was asked for',
  'check:park finds nothing new on it',
  'a child can walk in through the front gate',
  'a tap on the fountain wades her in, and she can get out',
];

/** Test names per per-seed file, as vitest itself collects them. */
function testsBySeed(): Map<number, Set<string>> {
  const out = `${process.env['TMPDIR'] ?? '/tmp'}/lgp-seed-coverage-${process.pid}.json`;
  // The per-seed files only: other files in test/procgen do real work while
  // they are collected, and this asks only what each seed file registers.
  const files = readdirSync('test/procgen')
    .filter((f) => /^seed-\d+\.test\.ts$/.test(f))
    .map((f) => `test/procgen/${f}`);
  execFileSync('pnpm', ['exec', 'vitest', 'list', `--json=${out}`, ...files], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
  const parsed: unknown = JSON.parse(readFileSync(out, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('vitest list --json did not write an array');
  const bySeed = new Map<number, Set<string>>();
  for (const entry of parsed as { name?: unknown; file?: unknown }[]) {
    if (typeof entry.name !== 'string' || typeof entry.file !== 'string') continue;
    const match = /\/seed-(\d+)\.test\.ts$/.exec(entry.file);
    if (!match?.[1]) continue;
    const seed = Number(match[1]);
    const name = entry.name.replace(/^seed \d+ > /, '');
    if (!bySeed.has(seed)) bySeed.set(seed, new Set());
    bySeed.get(seed)!.add(name);
  }
  return bySeed;
}

const bySeed = testsBySeed();
const pool = [...PARK_SEED_POOL];
const swept = new Set(pool.filter((seed) => WHOLE_PARK_MEASURES.every((m) => bySeed.get(seed)?.has(m))));

process.stdout.write(
  `check:seed-coverage: ${pool.length} seed(s) in PARK_SEED_POOL, ` +
    `${swept.size} with a per-seed file asking all ${WHOLE_PARK_MEASURES.length} whole-park measures\n`,
);

for (const seed of pool) {
  const tests = bySeed.get(seed);
  if (!tests) {
    fail(`pool seed ${seed} has no per-seed file in test/procgen — a park a child can be given that nothing builds`);
    continue;
  }
  const missing = WHOLE_PARK_MEASURES.filter((m) => !tests.has(m));
  if (missing.length > 0) fail(`seed-${seed}.test.ts does not ask: ${missing.map((m) => `"${m}"`).join(', ')}`);
}

/**
 * The other direction: a per-seed file for a seed outside the pool measures a
 * park nobody is given, and spends CI on it.
 */
const strangers = [...bySeed.keys()].filter((seed) => !pool.includes(seed));
if (strangers.length > 0) {
  fail(
    `test/procgen has per-seed files for ${strangers.length} seed(s) not in PARK_SEED_POOL: ${strangers.join(', ')}. ` +
      `A seed outside the pool is not a park a child can be given — vet:seeds is the instrument for those.`,
  );
}

/** `test:procgen` or its watchdog wrapper, and not some longer script name that merely starts the same. */
const invocation = /pnpm run test:procgen(?::watchdog)?(?![\w:-])/;
const wiredInto = BLOCKING_JOBS.filter((where) => {
  let text: string;
  try {
    text = readFileSync(where.workflow, 'utf8');
  } catch {
    fail(`${where.workflow} does not exist — a job named in BLOCKING_JOBS has been moved or renamed`);
    return false;
  }
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
    `no merge-blocking workflow runs test:procgen, so the per-seed measures gate nothing. ` +
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
    `    check:park          canonical seed in the ${'`check`'} chain; every pool seed in test:procgen\n` +
    `    whole-park measures ${swept.size} of ${pool.length} pool seeds, in ${
      wiredInto.map((w) => w.job).join(' + ') || 'NOTHING — see the failure above'
    }: ${WHOLE_PARK_MEASURES.join('; ')}\n` +
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
