/**
 * Vet candidate park seeds for the pool the game draws from (issue #426).
 *
 * The pool in `src/world/parkSeedPool.ts` is not a list somebody liked the
 * look of: every seed in it has been put through **both** gates a park has to
 * pass on `main`, and this script is how. Re-run it whenever the generator
 * changes — a pool vetted against an older generator is a list of seeds that
 * *used* to work.
 *
 * ```
 * pnpm run vet:seeds -- 1 60            # vet the range [1, 60]
 * pnpm run vet:seeds -- --list 5,11,24  # vet exactly these
 * pnpm run vet:seeds -- 1 60 --jobs 4   # …with four at a time
 * ```
 *
 * ## The two gates, and why both
 *
 * - **`check:park`** — whether the park *works*: every attraction routes from
 *   the entrance, every waypoint is connected, the boot asserts pass.
 * - **`test/procgen/invariants.ts`** — whether its furniture is *placed
 *   sanely*: no wall through a wall, no tree through a tree, every path lit.
 *
 * CLAUDE.md keeps those separate on purpose and neither implies the other, so
 * a candidate must pass both to enter the pool. A seed that merely *generates
 * without throwing* has passed neither.
 *
 * ## `LGP_RATCHET` stays ON here
 *
 * `scripts/sweep-park-seeds.mts` turns the ratchet off, because its job is to
 * show a human a range of parks and the recorded deviations are tuned to the
 * canonical one. This script's job is the opposite — to admit a seed to a pool
 * a child will actually be given — so it runs the ratchet **on**, exactly as
 * `pnpm run check` does, and a seed that trips a recorded deviation is
 * rejected rather than excused. When one fails that way the script re-runs it
 * with the ratchet off, purely to say in the report *which* of the two gates
 * did the rejecting.
 *
 * ## Results are written as they are produced
 *
 * Each verdict is appended to the results file (`--out`, default
 * `seed-vetting.jsonl`) the moment it is known, one JSON object per line. A
 * search that only exists in a terminal scrollback is a search that has to be
 * done again.
 */
import { execFile } from 'node:child_process';
import { appendFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

interface Verdict {
  readonly seed: number;
  /** `pass` only if BOTH gates passed with the ratchet enforced. */
  readonly verdict: 'pass' | 'fail';
  readonly park: 'pass' | 'fail';
  /** Non-null only when `park` failed: did it also fail with the ratchet off? */
  readonly parkWithoutRatchet?: 'pass' | 'fail';
  readonly invariants: 'pass' | 'fail';
  /** How many invariants ran, and how many of them failed. */
  readonly invariantsPassed?: number;
  readonly invariantsFailed?: number;
  /** One line a person can act on. */
  readonly note: string;
  readonly seconds: number;
}

// `pnpm run vet:seeds -- 1 80` hands the bare `--` through as an argument of
// its own, so drop it before parsing — otherwise the `1` looks like the value
// of a flag and the range comes out empty.
const args = process.argv.slice(2).filter((a) => a !== '--');
const FLAGS = ['--list', '--jobs', '--out'] as const;

function flag(name: (typeof FLAGS)[number]): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

const isFlag = (a: string | undefined): boolean => FLAGS.includes(a as (typeof FLAGS)[number]);
const positional = args.filter((a, i) => !a.startsWith('--') && !isFlag(args[i - 1]));
const listed = flag('--list');
const seeds = listed
  ? listed.split(',').map((s) => Number(s.trim()))
  : rangeInclusive(Number(positional[0] ?? 1), Number(positional[1] ?? 30));
const jobs = Math.max(1, Number(flag('--jobs') ?? 3));
const out = flag('--out') ?? 'seed-vetting.jsonl';

function rangeInclusive(from: number, to: number): number[] {
  const list: number[] = [];
  for (let n = from; n <= to; n += 1) list.push(n);
  return list;
}

/** `check:park`, on one seed, in a child process. */
async function checkPark(seed: number, ratchet: boolean): Promise<{ ok: boolean; note: string }> {
  const env = { ...process.env, LGP_SEED: String(seed), ...(ratchet ? {} : { LGP_RATCHET: 'off' }) };
  try {
    const { stdout } = await run(
      process.execPath,
      ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', 'scripts/check-park.mts'],
      { env, maxBuffer: 64 * 1024 * 1024 },
    );
    const summary = stdout.split('\n').find((line) => line.startsWith('check:park:')) ?? '';
    return { ok: true, note: summary.replace('check:park: ', '').slice(0, 200) };
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout ?? '';
    const stderr = (error as { stderr?: string }).stderr ?? '';
    const lines = `${stdout}\n${stderr}`.split('\n').map((l) => l.trim());
    // `check:park` reports a rejection as a "N invariant regression(s):"
    // header followed by one `key: measured` line per finding, and a park that
    // would not build at all as a thrown error. Name the actual keys: "did not
    // solve" for a park that solved fine but stranded two waypoints would be a
    // report that says nothing, which is the whole failure this repo keeps
    // catching in its own checks.
    const keys = lines.filter((l) => /^[a-z][\w.:-]*: -?\d/.test(l) && !l.startsWith('check:park:'));
    if (keys.length > 0) return { ok: false, note: keys.join('; ').slice(0, 200) };
    const line =
      lines.find(
        (l) =>
          l.includes('no valid position') ||
          l.includes('unsolvable') ||
          l.includes('Error') ||
          l.includes('regression'),
      ) ?? 'did not solve, and printed no finding key';
    return { ok: false, note: line.slice(0, 200) };
  }
}

/**
 * The full invariant suite, registered for one seed.
 *
 * The seed reaches the generators through `LGP_SEED`, which `parkManifest.ts`
 * reads once at module load, so a seed is only really a seed if it gets a test
 * file (and so a module registry) of its own — see `vitest.config.ts`. Hence a
 * throwaway file per candidate rather than one file reading an env var.
 *
 * It has to live under `test/procgen/` — `vitest.config.ts`'s `include` is
 * `test/**` and the invariants import by relative path — so it is named
 * `vet-seed-*.test.ts`, gitignored, deleted in a `finally`, and any stray left
 * by a killed run is swept before the next one starts.
 */
const vetFile = (seed: number): string => `test/procgen/vet-seed-${seed}.test.ts`;

async function checkInvariants(
  seed: number,
): Promise<{ ok: boolean; passed?: number; failed?: number; note: string }> {
  const file = vetFile(seed);
  writeFileSync(
    file,
    `import { registerParkInvariants } from './invariants.ts';\nregisterParkInvariants(${seed});\n`,
  );
  try {
    const { stdout } = await run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', file], {
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
    });
    const counts = parseCounts(stdout);
    return { ok: true, note: `${counts.passed ?? '?'} invariants passed`, ...counts };
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout ?? '';
    const stderr = (error as { stderr?: string }).stderr ?? '';
    const counts = parseCounts(stdout);
    const failures = [...stdout.matchAll(/(?:FAIL|×|✕)\s+(.+)/g)].map((m) => m[1]!.trim());
    // A seed whose park will not build at all fails *before* any test runs, so
    // there is no failure line to quote and the reason is in the thrown error.
    // Skip Node's own noise on the way to it: reporting `--localstorage-file`
    // as the reason a park is unbuildable would be a report that says nothing.
    const noise = /localstorage-file|trace-warnings|ExperimentalWarning|^\(node:\d+\)/;
    const thrown =
      `${stdout}\n${stderr}`
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l && !noise.test(l) && /Error|Unsolvable|unsolvable|no valid position/.test(l)) ??
      stderr
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l && !noise.test(l)) ??
      'suite did not run, and printed no reason';
    const note = failures.length > 0 ? failures.slice(0, 4).join(' | ') : thrown;
    return { ok: false, note: note.slice(0, 400), ...counts };
  } finally {
    rmSync(file, { force: true });
  }
}

function parseCounts(stdout: string): { passed?: number; failed?: number } {
  const line = stdout.split('\n').find((l) => l.includes('Tests') && (l.includes('passed') || l.includes('failed')));
  if (!line) return {};
  const passed = /(\d+) passed/.exec(line)?.[1];
  const failed = /(\d+) failed/.exec(line)?.[1];
  return {
    ...(passed ? { passed: Number(passed) } : {}),
    ...(failed ? { failed: Number(failed) } : {}),
  };
}

async function vet(seed: number): Promise<Verdict> {
  const started = Date.now();
  const park = await checkPark(seed, true);
  let parkWithoutRatchet: 'pass' | 'fail' | undefined;
  if (!park.ok) {
    parkWithoutRatchet = (await checkPark(seed, false)).ok ? 'pass' : 'fail';
  }
  // Both gates are always run, even when the first has already rejected the
  // seed: a rejected candidate's *other* failures are the interesting part of
  // the report — that is how #429's pathological seed was understood.
  const inv = await checkInvariants(seed);
  return {
    seed,
    verdict: park.ok && inv.ok ? 'pass' : 'fail',
    park: park.ok ? 'pass' : 'fail',
    ...(parkWithoutRatchet ? { parkWithoutRatchet } : {}),
    invariants: inv.ok ? 'pass' : 'fail',
    ...(inv.passed === undefined ? {} : { invariantsPassed: inv.passed }),
    ...(inv.failed === undefined ? {} : { invariantsFailed: inv.failed }),
    note: park.ok ? inv.note : `check:park: ${park.note}${inv.ok ? '' : ` || invariants: ${inv.note}`}`,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
}

const queue = [...seeds];
let passes = 0;
let done = 0;

async function worker(): Promise<void> {
  for (;;) {
    const seed = queue.shift();
    if (seed === undefined) return;
    const verdict = await vet(seed);
    done += 1;
    if (verdict.verdict === 'pass') passes += 1;
    appendFileSync(out, `${JSON.stringify(verdict)}\n`);
    process.stdout.write(
      `${String(seed).padStart(5)} ${verdict.verdict.toUpperCase().padEnd(4)} ` +
        `park=${verdict.park} invariants=${verdict.invariants}` +
        `${verdict.invariantsFailed ? `(${verdict.invariantsFailed} red)` : ''} ` +
        `${verdict.seconds}s  ${verdict.note.slice(0, 100)}\n`,
    );
    process.stderr.write(`[vet] ${done}/${seeds.length} done, ${passes} pass\n`);
  }
}

// Sweep any throwaway test file a killed run left behind, before vitest can
// pick it up as if it were part of the real suite.
for (const name of readdirSync('test/procgen')) {
  if (name.startsWith('vet-seed-')) rmSync(`test/procgen/${name}`, { force: true });
}

process.stdout.write(
  `vetting ${seeds.length} seed(s), ${jobs} at a time, into ${relative(process.cwd(), out) || out}\n`,
);
await Promise.all(Array.from({ length: Math.min(jobs, seeds.length) }, () => worker()));
process.stdout.write(`\n${passes}/${seeds.length} candidate seeds passed both gates\n`);
