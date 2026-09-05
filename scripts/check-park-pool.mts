/**
 * **`check:park`, on every park a child can actually be given.** Issue #510.
 *
 * ```
 * pnpm run check:park-pool            # every seed in PARK_SEED_POOL
 * pnpm run check:park-pool -- --list  # print the seeds it would sweep, as JSON
 * ```
 *
 * ## The gap this closes, measured rather than asserted
 *
 * `check:park` is the gate that asks whether a park *works* — every attraction
 * routes from the entrance, nothing walks across the railway, every waypoint is
 * connected. Until this script it ran on **one** seed, `CANONICAL_PARK_SEED`,
 * and nothing else in the blocking chain built a second park either.
 *
 * Classified on `main` at `61e95fe5`, the 63 expanded steps of `pnpm run check`
 * are: **40 seed-dependent and canonical-only**, **1 sweeping**
 * (`check:fountain-hop`, over `CI_SWEEP_SEEDS`'s seven), and 22 that build no
 * park at all. So **nine of the sixteen pool seeds — 115, 128, 208, 225, 267,
 * 274, 346, 428, 451 — were built by no required check whatever**, and none of
 * the sixteen was ever put through `check:park`. The pool is the product and
 * the gates measured a sixteenth of it.
 *
 * ## It runs the real `check:park`, it does not re-implement it
 *
 * One child process per seed, running `scripts/check-park.mts` itself with
 * `LGP_SEED` set — because `parkManifest.ts` reads the seed **once, at import**,
 * so a single process cannot build two different parks. That is the same
 * mechanism `check:gateway` and `check:coplanar` use.
 *
 * The important half is what it does *not* do: it contains no assertion of its
 * own about what makes a park sound. `check-park.mts` owns that, and this asks
 * it the same question sixteen times. A sweep that re-stated the standard would
 * be a second definition of it, kept in step by hand — the most common bug in
 * this repo — and it would drift the first time somebody tuned one of them.
 *
 * ## The ratchet stays ON, and that is not the obvious choice
 *
 * `check:park` takes `LGP_RATCHET=off`, under which only `route.unreachable`,
 * `route.crossesRail` and `boot.asserts` are hard and `poi.stranded` becomes
 * soft. That mode exists for `sweep-park-seeds.mts`, which is *hunting* for new
 * seeds and must not reject a candidate over drift tuned to a different park.
 *
 * **This is not a hunt. These sixteen are parks a child is given**, so they are
 * held to the bar `vet:seeds --pool` already holds them to — the ratchet **on**,
 * exactly as `vet-seed-pool.mts` does at its `checkPark(seed, true)`. Turning it
 * off here would make the gate pass on the very finding #510 was written about:
 * the issue's own evidence was `check:park: poi.stranded: 1` on seed 24, and
 * `poi.stranded` is hard **only** while the ratchet is enforced.
 *
 * Measured on this branch: all sixteen pass with the ratchet on, so this lands
 * green rather than needing an allowance carved for it.
 *
 * ## Cost, and why it is here rather than in `pnpm run check`
 *
 * `check:park` measures 4.9 s on the canonical seed and 16.6 s on seed 428;
 * across the pool on six lanes this is ~60 s wall, the same shape as
 * `check:gateway`'s measured 56 s.
 *
 * That is cheap, but it is not free, and `checks.yml` is the one place it must
 * not go: its recent **successful** runs on `main` are 26.7, 26.8 and 25.9
 * minutes against its own `timeout-minutes: 30`. A job killed by a timeout
 * reports as `cancelled`, which reads as "superseded" rather than as a failure
 * — the shape that took this project's deploy down on 29 August. So this runs
 * in the `Procgen invariants` job, which is **already a required status check**,
 * so the gate takes effect on the day it lands rather than waiting on a
 * branch-protection change only Jim can make. That is the same reasoning
 * `check:gateway` is there under, and it is deliberate.
 */
import { execFile } from 'node:child_process';
import { cpus } from 'node:os';
import { promisify } from 'node:util';

import { PARK_SEED_POOL } from '../src/world/parkSeedPool.ts';

/**
 * **The seeds this sweep asks, taken from the pool itself** — never a list
 * written down here. `--list` prints them so `check:seed-coverage` can compare
 * what CI actually sweeps against `PARK_SEED_POOL`, by running this rather than
 * by reading it. A copy of the pool in this file would be the second definition
 * the whole ticket is about.
 */
const seeds = [...PARK_SEED_POOL].sort((a, b) => a - b);

if (process.argv.includes('--list')) {
  process.stdout.write(`${JSON.stringify(seeds)}\n`);
  process.exit(0);
}

interface SeedResult {
  readonly seed: number;
  readonly ok: boolean;
  /** `check:park`'s own one-line summary, or the keys it rejected on. */
  readonly note: string;
  readonly seconds: number;
}

const run = promisify(execFile);

/**
 * Runs the real `check:park` for one seed and reads its verdict from its **exit
 * code**, never by matching words in its output. A parser looking for the word
 * "passed" would report a crashed run as a pass, which is the failure mode this
 * repo has hit twice.
 */
async function checkPark(seed: number): Promise<SeedResult> {
  const started = Date.now();
  const args = [
    '--no-warnings',
    '--import',
    './scripts/ts-extension-resolver-register.mjs',
    'scripts/check-park.mts',
  ];
  // The ratchet is deliberately NOT disabled — see this file's header.
  const env = { ...process.env, LGP_SEED: String(seed) };
  const seconds = (): number => Math.round((Date.now() - started) / 100) / 10;
  try {
    const { stdout, stderr } = await run(process.execPath, args, {
      env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return { seed, ok: true, note: summarise(`${stdout}\n${stderr}`), seconds: seconds() };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    return {
      seed,
      ok: false,
      note: reasons(`${failed.stdout ?? ''}\n${failed.stderr ?? ''}`),
      seconds: seconds(),
    };
  }
}

/** `check:park`'s own summary line. It writes it to stderr, so look in both. */
function summarise(output: string): string {
  const line = output.split('\n').find((l) => l.trim().startsWith('check:park:')) ?? '';
  return line.replace(/^\s*check:park:\s*/, '').trim().slice(0, 120);
}

/**
 * The keys a rejected seed actually failed on.
 *
 * **Only the lines after the regression header count.** `check:park` prints a
 * summary table above it whose lines look identical to a finding
 * (`destinations: 19 checked …`), and quoting one of those as the reason a seed
 * was rejected would be a report about the wrong thing entirely — the same trap
 * `vet-seed-pool.mts` documents at its own parser.
 */
function reasons(output: string): string {
  const lines = output.split('\n').map((l) => l.trim());
  const at = lines.findIndex((l) => /^check:park: \d+ invariant regression/.test(l));
  if (at === -1) {
    // No regression header at all — the park did not build, or the process
    // died. Say so with whatever it did emit rather than inventing a key.
    const last = lines.filter(Boolean).at(-1) ?? '(no output)';
    return `did not complete: ${last.slice(0, 120)}`;
  }
  const keys = lines
    .slice(at + 1)
    .filter((l) => /^[a-z][\w.]*:/i.test(l))
    .slice(0, 4);
  return keys.length > 0 ? keys.join('; ').slice(0, 160) : lines[at] ?? '';
}

// ------------------------------------------------------------- across the pool

/**
 * Six lanes saturated this Mac and one lane died silently, taking
 * `Promise.all` and the whole sweep's report with it — ten seeds printed, six
 * never ran, and **no error, no summary and no clue which seed was to blame**.
 * A sweep that can vanish is worse than one that is slow: the exit code was
 * still 1, so in CI it would have read as "a park is broken" while naming none.
 *
 * Two fixes, and both matter. The lane body below can no longer reject — an
 * unexpected throw is recorded against the seed that caused it. And the lane
 * count is overridable, because the right number is a property of the machine
 * rather than of this script.
 */
const lanes = Math.max(1, Math.min(Number(process.env['LGP_LANES'] ?? 4), cpus().length));
const queue = [...seeds];
const results: SeedResult[] = [];

process.stdout.write(
  `check:park-pool: ${seeds.length} seed(s) from PARK_SEED_POOL, ${lanes} at a time, ratchet enforced\n`,
);

await Promise.all(
  Array.from({ length: Math.min(lanes, queue.length) }, async () => {
    for (let seed = queue.pop(); seed !== undefined; seed = queue.pop()) {
      // Never let one seed reject the lane: see the note on `lanes` above.
      const result = await checkPark(seed).catch(
        (error: unknown): SeedResult => ({
          seed,
          ok: false,
          note: `the sweep itself threw: ${String(error).slice(0, 140)}`,
          seconds: 0,
        }),
      );
      results.push(result);
      process.stdout.write(
        `  seed ${String(result.seed).padStart(8)}: ${result.ok ? 'PASS' : 'FAIL'} ` +
          `${String(result.seconds).padStart(5)}s  ${result.note}\n`,
      );
    }
  }),
);

results.sort((a, b) => a.seed - b.seed);
const failed = results.filter((r) => !r.ok);

/**
 * **What this sweep does and does not cover, said on every run** — CLAUDE.md:
 * "When a check stops covering something, it must say so on every run — and you
 * must confirm anyone can hear it."
 *
 * On **stdout**, not stderr. This is a plain Node script rather than a Vitest
 * suite, so both streams are unconditionally visible, and stdout is where a
 * reader of a CI log looks. (Measured on this branch: neither `check:park` nor
 * `check:gateway` emits any `THREE.*` noise at all — 0 lines of it in either —
 * so the "stderr gets buried" caution does not apply to these two. Verified by
 * running them and counting, not by reading the code.)
 */
process.stdout.write(
  `\ncheck:park-pool: ${results.length - failed.length}/${results.length} pool seed(s) ` +
    `pass check:park with the ratchet enforced.\n` +
    `  - COVERS: every seed in PARK_SEED_POOL, which is every park a child can be drawn.\n` +
    `    Nine of them (115, 128, 208, 225, 267, 274, 346, 428, 451) were built by NO\n` +
    `    required check before #510, and none of the sixteen had ever been put\n` +
    `    through check:park.\n` +
    `  - DOES NOT COVER: the procgen invariant suite, which keeps per-seed files for\n` +
    `    ${'CI_SWEEP_SEEDS'}' seven seeds only. A pool seed outside that set passes here\n` +
    `    having had its placement checked by test/procgen not at all. The two gates do\n` +
    `    not imply each other (#437) — a seed has gone green through the whole chain\n` +
    `    while stranding eight waypoints, and another has failed three invariants with\n` +
    `    check:park green.\n` +
    `  - DOES NOT COVER: a seed that is not in the pool. Those are not parks a child\n` +
    `    can be given; ${'`'}vet:seeds${'`'} is the instrument for candidates.\n`,
);

if (failed.length > 0) {
  process.stdout.write(
    `\ncheck:park-pool: ${failed.length} pool seed(s) FAILED — these are parks a child can be given:\n` +
      failed.map((f) => `  seed ${f.seed}: ${f.note}`).join('\n') +
      `\n`,
  );
  process.exitCode = 1;
}
