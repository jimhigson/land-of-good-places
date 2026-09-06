/**
 * **`check:every-seed-builds` — does every seed build a park, and how hard did
 * it have to try?** The totality instrument from
 * `docs/DESIGN-round-robin-generation.md`, "Totality, ruled and mechanised
 * (Jim, 6 Sep)": *"given we can backtrack back to zero, there's no reason this
 * should happen if things are implemented correctly … fix it properly."*
 *
 * ```
 * pnpm run check:every-seed-builds                       # seeds 0–15
 * pnpm run check:every-seed-builds -- --print-baseline \
 *   > scripts/every-seed-builds-baseline.mts             # re-take the ratchet
 * LGP_SEEDS=1,4,6 pnpm run check:every-seed-builds       # a subset (never the gate)
 * LGP_LANES=8 …                                          # parallelism
 * ```
 *
 * ## Two lines per seed, never merged
 *
 * - **built** — the real `check:park` for that seed, in its own process (the
 *   seed is read once at import, so one process cannot build two parks — the
 *   same mechanism `check:park-pool` uses), ratchet **on**. Built means exit 0:
 *   no throw, every attraction routed, no illegal crossing, zero
 *   `poi.stranded`, zero `poi.nospot`, no unserved `anchor.reach`. A red seed
 *   prints its **class** — what refused it: `rail.unsolvable`,
 *   `crossing.nosite`, or `check:park`'s own keys (`poi.stranded`,
 *   `anchor.reach:waterFight`, …) — and the thrown line with its coordinates.
 * - **built well** — the layout's unwind trace (`layout-trace:` lines on
 *   stderr, from `parkLayout.ts`): how many times decision zero was reached.
 *
 * ## It is a bidirectional ratchet, and its endpoint is zero
 *
 * Twelve of sixteen seeds did not build on the day this was written, for three
 * classes of reason, and the rungs that discharge those classes land one at a
 * time. So, exactly `check:swept-bus`'s shape (the Overseer's ruling, 6 Sep):
 * `scripts/every-seed-builds-baseline.mts` records **today's unbuilt seeds by
 * class, keyed on the seed number** — nothing can rename a seed (#520 is what
 * happens to a baseline keyed on names). Then, every run:
 *
 * - a seed that **stops building** and has no entry → **red** (a regression);
 * - a seed whose **class changed** → **red** (a different defect, not the
 *   recorded one — say so rather than let it hide under the old entry);
 * - a seed that **starts building** while still in the baseline → **red**,
 *   until the baseline is re-taken — a rung records its own win in a diff,
 *   never banks it quietly;
 * - a baseline entry for a seed that is **not swept** → **red** (an orphan
 *   is a measurement of nothing);
 * - a seed that built and needed **more** decision-zero restarts than its
 *   recorded count → **red**; fewer → red too, until re-taken.
 *
 * When the baseline is empty, this is fail-on-any-seed: Jim's totality
 * requirement, mechanised. Delete the baseline file's entries, not the file.
 *
 * **A green run means "no worse than the baseline", never "every seed
 * builds"** — the summary line says so on every run, because a check whose
 * name overstates what it asserts is this project's signature disease.
 *
 * ## What it asks, and does not
 *
 * No assertion of its own about what makes a park sound — `check-park.mts`
 * owns that and this asks it sixteen times, as `check-park-pool.mts` does for
 * the pool. Sixteen because it is a convenient number to look at day to day,
 * not because these seeds are special; under totality every integer is a seed,
 * and a rolling random draw is still owed (design doc, stage 5).
 *
 * Runs in its own workflow (`every-seed-builds.yml`), not the `check` chain:
 * the chain is at ~26 minutes against a 30-minute cap and this builds sixteen
 * parks. It must be made a required status check by Jim; until then it runs
 * and goes red without blocking a merge.
 */
import { execFile } from 'node:child_process';
import { cpus } from 'node:os';
import { promisify } from 'node:util';

import { DECISION_ZERO_BASELINE, UNBUILT_BASELINE } from './every-seed-builds-baseline.mts';

const run = promisify(execFile);

const DEFAULT_SEEDS = Array.from({ length: 16 }, (_, i) => i);
const requested = (process.env['LGP_SEEDS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);
const SEEDS = requested.length > 0 ? requested : DEFAULT_SEEDS;
const printBaseline = process.argv.includes('--print-baseline');
const started = performance.now();

interface SeedResult {
  readonly seed: number;
  readonly built: boolean;
  /** The failure class (empty when built). */
  readonly klass: string;
  /** `check:park`'s summary, or the thrown line / regression keys. */
  readonly note: string;
  /** Times the layout reached decision zero (whole-park restart); NaN if no trace. */
  readonly decisionZero: number;
  /** Refusals the rung unwound on (0 on every seed today; printed either way). */
  readonly rungFired: number;
  /** Refusals the built park contradicts, proved with the rung disarmed. */
  readonly falseRefusals: number;
  readonly trace: readonly string[];
  readonly seconds: number;
}

async function buildSeed(seed: number): Promise<SeedResult> {
  const begun = performance.now();
  const args = [
    '--no-warnings',
    '--import',
    './scripts/ts-extension-resolver-register.mjs',
    'scripts/check-park.mts',
  ];
  const env = { ...process.env, LGP_SEED: String(seed) };
  let stdout = '';
  let stderr = '';
  let built = false;
  try {
    const result = await run(process.execPath, args, {
      env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    stdout = result.stdout;
    stderr = result.stderr;
    built = true;
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message?: string };
    stdout = failed.stdout ?? '';
    stderr = failed.stderr ?? failed.message ?? '';
  }
  const all = `${stdout}\n${stderr}`;
  const trace = all
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('layout-trace:'));
  const solved = trace.map((l) => /decision-zero-reached=(\d+)/.exec(l)).find((m) => m);
  const fired = trace.map((l) => /rung-1-fired=(\d+)/.exec(l)).find((m) => m);
  const refusal = built ? null : classify(all);
  // The guard: where the rung fired, prove each refusal against the built
  // park (a second solve with the rung disarmed; `check:park` reports
  // `layout.falseRefusal` for any door the built park reaches). Cheap when
  // nothing fired, which is every seed today; thorough when something did.
  const rungFired = fired ? Number(fired[1]) : 0;
  const falseRefusals = rungFired > 0 ? await falseRefusalsOf(seed) : 0;
  return {
    seed,
    built,
    klass: refusal?.klass ?? '',
    note: built ? summarise(all) : (refusal?.note ?? ''),
    decisionZero: solved ? Number(solved[1]) : NaN,
    rungFired,
    falseRefusals,
    trace,
    seconds: Math.round((performance.now() - begun) / 100) / 10,
  };
}

/** `check:park` with the rung disarmed: how many refusals the built park contradicts. */
async function falseRefusalsOf(seed: number): Promise<number> {
  const args = [
    '--no-warnings',
    '--import',
    './scripts/ts-extension-resolver-register.mjs',
    'scripts/check-park.mts',
  ];
  const env = { ...process.env, LGP_SEED: String(seed), LGP_LAYOUT_RUNG: 'off' };
  let all = '';
  try {
    const result = await run(process.execPath, args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    all = `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    all = `${failed.stdout ?? ''}\n${failed.stderr ?? ''}`;
  }
  const line = all.split('\n').map((l) => l.trim()).find((l) => /^layout\.falseRefusal:\s*\d+/.test(l));
  return line ? Number(/(\d+)/.exec(line)?.[1] ?? 0) : 0;
}

function summarise(output: string): string {
  const line = output.split('\n').find((l) => l.trim().startsWith('check:park:')) ?? '';
  return line.replace(/^\s*check:park:\s*/, '').trim().slice(0, 120);
}

/**
 * The class a seed failed in, and the line that says so.
 *
 * Read from `check:park`'s output the way `check-park-pool.mts` reads it: a
 * thrown error line first (it carries the coordinates), else the regression
 * keys after the regression header. A parser looking for the word "passed"
 * would report a crashed run as a pass.
 *
 * Classes are the ones the design doc maps onto the unwind ladder:
 * - `rail.unsolvable` — `RailRouteUnsolvable` (seeds 8, 9, 10 on 6 Sep);
 * - `crossing.nosite` — no proven bridge site, or a drawn crossing off every
 *   site (seeds 2, 3, 7);
 * - otherwise `check:park`'s own keys, sorted and joined with `+`
 *   (`poi.stranded`, `poi.nospot`, `anchor.reach:waterFight`, …).
 */
function classify(output: string): { klass: string; note: string } {
  const lines = output.split('\n').map((l) => l.trim());
  const at = lines.findIndex((l) => /^check:park: \d+ invariant regression/.test(l));
  if (at === -1) {
    // `RailRouteUnsolvable: …` does not end in "Error" — a regex requiring
    // that (check-park-pool.mts's) files the rail class as "crashed".
    const thrown = lines.find((l) => /^(?:[A-Za-z_$][\w$]*)?(?:Error|Unsolvable)\b/.test(l));
    if (thrown) {
      const klass = /RailRouteUnsolvable/.test(thrown)
        ? 'rail.unsolvable'
        : /crossing plan: .*NO bridge site|rail crossings: .*no proven bridge site/.test(thrown)
          ? 'crossing.nosite'
          : 'throw';
      return { klass, note: `did not build: ${thrown.slice(0, 220)}` };
    }
    const last = lines.filter(Boolean).at(-1) ?? '(no output)';
    return { klass: 'crashed', note: `did not complete, and emitted no error line: ${last.slice(0, 120)}` };
  }
  const keyLines = lines.slice(at + 1).filter((l) => /^[a-z][\w.:]*:/i.test(l));
  const keys = keyLines
    .map((l) => l.split(':').slice(0, l.startsWith('anchor.reach') ? 2 : 1).join(':'))
    .sort();
  return {
    klass: keys.length > 0 ? keys.join('+') : 'regression',
    note: keyLines.slice(0, 4).join('; ').slice(0, 200),
  };
}

// ------------------------------------------------------------------ the sweep

const lanes = Math.max(1, Math.min(Number(process.env['LGP_LANES'] ?? 4), cpus().length));
const queue = [...SEEDS].reverse();
const results: SeedResult[] = [];

if (!printBaseline) {
  process.stdout.write(
    `check:every-seed-builds: seeds ${SEEDS.join(',')}, ${lanes} at a time, ratchet enforced\n`,
  );
}

await Promise.all(
  Array.from({ length: Math.min(lanes, queue.length) }, async () => {
    for (let seed = queue.pop(); seed !== undefined; seed = queue.pop()) {
      const result = await buildSeed(seed).catch(
        (error: unknown): SeedResult => ({
          seed,
          built: false,
          klass: 'crashed',
          note: `the sweep itself threw: ${String(error).slice(0, 140)}`,
          decisionZero: NaN,
          rungFired: 0,
          falseRefusals: 0,
          trace: [],
          seconds: 0,
        }),
      );
      results.push(result);
      if (!printBaseline) {
        process.stdout.write(
          `  seed ${String(result.seed).padStart(3)}: ${result.built ? 'built    ' : 'NOT BUILT'} ` +
            `${result.built ? '' : `[${result.klass}] `}${String(result.seconds).padStart(5)}s  ${result.note}\n` +
            `  seed ${String(result.seed).padStart(3)}: built well? decision-zero=${result.decisionZero} ` +
            `rung-fired=${result.rungFired}${result.rungFired > 0 ? ` false-refusals=${result.falseRefusals}` : ''}\n`,
        );
      }
    }
  }),
);

results.sort((a, b) => a.seed - b.seed);

// ------------------------------------------------------------- the baseline

if (printBaseline) {
  const unbuilt = results.filter((r) => !r.built).map((r) => `  ${r.seed}: '${r.klass}',`);
  const zero = results
    .filter((r) => r.built && Number.isFinite(r.decisionZero))
    .map((r) => `  ${r.seed}: ${r.decisionZero},`);
  process.stdout.write(
    `/**\n` +
      ` * **Which of seeds 0–15 did not build when \`check:every-seed-builds\` was last\n` +
      ` * re-taken, and why.** Generated by\n` +
      ` * \`pnpm run check:every-seed-builds -- --print-baseline\`; never edited by hand.\n` +
      ` *\n` +
      ` * Keyed on the **seed number**, which nothing can rename (#520 is what happens\n` +
      ` * to a baseline keyed on names). An entry for a seed the check does not sweep\n` +
      ` * **fails the check**. A seed with no entry must build. A seed that starts\n` +
      ` * building while still listed here fails the check until this file is\n` +
      ` * re-taken — a rung records its own win in a diff, never banks it quietly.\n` +
      ` *\n` +
      ` * Do not add an entry to make the check pass. An entry means "this seed did not\n` +
      ` * build when the gate was last re-taken, for this reason"; a new one means a\n` +
      ` * seed has just been broken. The endpoint is an empty record: every seed\n` +
      ` * builds (Jim, 6 Sep 2026: "fix it properly"). See\n` +
      ` * \`docs/DESIGN-round-robin-generation.md\`, "Totality, ruled and mechanised".\n` +
      ` */\n` +
      `export const UNBUILT_BASELINE: Readonly<Record<number, string>> = {\n` +
      `${unbuilt.join('\n')}\n};\n\n` +
      `/**\n` +
      ` * Times decision zero (a whole-park layout restart) was reached, per seed that\n` +
      ` * built — the "built well" measurement. More than recorded fails; fewer fails\n` +
      ` * too, until re-taken.\n` +
      ` */\n` +
      `export const DECISION_ZERO_BASELINE: Readonly<Record<number, number>> = {\n` +
      `${zero.join('\n')}\n};\n`,
  );
  process.exit(0);
}

// -------------------------------------------------------------------- verdict

const swept = new Set(SEEDS);
const problems: string[] = [];
const loose: string[] = [];

// A subset run (LGP_SEEDS) is a quick look, never the gate: it compares only
// the seeds it swept and says so. Orphans are only meaningful against the
// full list.
if (requested.length > 0) {
  process.stdout.write(`  SUBSET RUN (LGP_SEEDS) — not the gate; orphan detection skipped.\n`);
} else {
  for (const seed of Object.keys(UNBUILT_BASELINE).map(Number)) {
    if (!swept.has(seed)) problems.push(`BASELINE ORPHAN: seed ${seed} is in the baseline but not swept`);
  }
  for (const seed of Object.keys(DECISION_ZERO_BASELINE).map(Number)) {
    if (!swept.has(seed)) problems.push(`BASELINE ORPHAN: seed ${seed} has a decision-zero entry but is not swept`);
  }
}

for (const r of results) {
  const recorded = UNBUILT_BASELINE[r.seed];
  if (!r.built) {
    if (recorded === undefined) {
      problems.push(`REGRESSION: seed ${r.seed} no longer builds [${r.klass}] — ${r.note}`);
    } else if (recorded !== r.klass) {
      problems.push(
        `CLASS CHANGED: seed ${r.seed} was [${recorded}], now [${r.klass}] — a different defect; ${r.note}`,
      );
    }
    continue;
  }
  if (recorded !== undefined) {
    loose.push(`BASELINE LOOSE: seed ${r.seed} now BUILDS (was [${recorded}]) — re-take the baseline`);
  }
  if (r.falseRefusals > 0) {
    problems.push(
      `FALSE REFUSAL: seed ${r.seed} — the layout rung refused ${r.falseRefusals} door(s) the built park reaches; ` +
        'it moved a plot to satisfy a measurement error (see check:park with LGP_LAYOUT_RUNG=off)',
    );
  }
  const zero = DECISION_ZERO_BASELINE[r.seed];
  if (!Number.isFinite(r.decisionZero)) {
    problems.push(`UNMEASURED: seed ${r.seed} built but printed no layout-trace line`);
  } else if (zero === undefined) {
    if (recorded === undefined) problems.push(`UNMEASURED: seed ${r.seed} has no decision-zero baseline — re-take`);
  } else if (r.decisionZero > zero) {
    problems.push(`WORSE: seed ${r.seed} reached decision zero ${r.decisionZero} time(s), baseline ${zero}`);
  } else if (r.decisionZero < zero) {
    loose.push(`BASELINE LOOSE: seed ${r.seed} reached decision zero ${r.decisionZero} time(s), baseline ${zero}`);
  }
}

const notBuilt = results.filter((r) => !r.built);
process.stdout.write(
  `\ncheck:every-seed-builds: built ${results.length - notBuilt.length}/${results.length}; ` +
    `by class: ${
      [...new Set(notBuilt.map((r) => r.klass))]
        .sort()
        .map((k) => `${k} (${notBuilt.filter((r) => r.klass === k).map((r) => r.seed).join(',')})`)
        .join('; ') || 'none unbuilt'
    }\n` +
    `  - COVERS: seeds ${SEEDS.join(',')} through the real check:park, ratchet on, one process each.\n` +
    `  - DOES NOT COVER: test/procgen's invariants (the two gates do not imply each other, #437),\n` +
    `    nor any seed outside this list — under totality every integer is a seed, and a rolling\n` +
    `    random draw is still owed (design doc, stage 5).\n`,
);

for (const line of problems) process.stdout.write(`  ${line}\n`);
for (const line of loose) process.stdout.write(`  ${line}\n`);
for (const r of notBuilt) {
  for (const l of r.trace) process.stdout.write(`      seed ${r.seed} ${l}\n`);
}

if (problems.length > 0 || loose.length > 0) {
  process.stdout.write(
    `\ncheck:every-seed-builds FAILED — ${problems.length} problem(s), ${loose.length} loose entr${loose.length === 1 ? 'y' : 'ies'}.\n` +
      (loose.length > 0
        ? 'The park got better and the ratchet did not follow; record it:\n' +
          '  pnpm run check:every-seed-builds -- --print-baseline > scripts/every-seed-builds-baseline.mts\n'
        : '') +
      (problems.length > 0
        ? 'A seed that stopped building is a broken generator — never a seed to retire, warp or vet\n' +
          'out (Jim, 6 Sep 2026). Read the trace lines above and the thrown line with its coordinates.\n'
        : ''),
  );
  process.exit(1);
}

const unbuiltCount = Object.keys(UNBUILT_BASELINE).length;
console.log(
  `check:every-seed-builds OK — ${results.length} seed(s) swept; ` +
    `${results.length - notBuilt.length} build, ${notBuilt.length} do not, all within the baseline in ` +
    `scripts/every-seed-builds-baseline.mts. ` +
    (unbuiltCount > 0
      ? `THIS IS NOT CLEAR — green here means "no worse", and ${unbuiltCount} seed(s) are still owed by the rungs that discharge their class. `
      : 'Every swept seed builds. ') +
    `${((performance.now() - started) / 1000).toFixed(1)} s.`,
);
