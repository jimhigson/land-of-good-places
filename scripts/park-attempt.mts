/**
 * **One attempt at one park: build it, and ask it every acceptance measure.**
 *
 * ```
 * LGP_SEED=11 LGP_PARK_RESTART=0 pnpm run park:attempt
 * ```
 *
 * The unit of work of the root acceptance loop (`scripts/lib/acceptedPark.mts`):
 * a fresh process per attempt, because the seed and the restart are read once,
 * at module load, by everything that generates anything — one process can
 * build exactly one park. It builds restart `LGP_PARK_RESTART` of park
 * `LGP_SEED` headlessly, then asks it:
 *
 * 1. every entry of `PARK_ACCEPTANCE` (`test/procgen/invariants.ts`) — the
 *    furnished floors and every procgen invariant, the same functions the
 *    suite asserts;
 * 2. `check:park`'s measures (`scripts/lib/parkFindings.mts`), ratchet
 *    enforced — last, because `checkHoppableColliders` demotes colliders as
 *    the game's boot does, and the invariants are measured on the park as
 *    built, exactly as the suite measures them.
 *
 * A build that throws is an attempt that failed, not a crash of the loop: a
 * solver giving up is one more reason to start again.
 *
 * Prints one line, `park-attempt: {json}`, on stdout — the verdict the loop
 * reads. Exit 0 whether or not the park passed; non-zero only if this script
 * itself broke.
 */
import './headless-canvas.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cpuMs } from './lib/cpuClock.mts';

/**
 * **Whole check scripts that judge a per-park decision, asked as acceptance
 * measures.** Some checks measure a property the park's own decisions set, but
 * are written as one top-level script rather than a function over a built park
 * — `check:rail-race`'s camera and face clauses depend on the ring's shape, and
 * the ring follows the park's boundary (seed 14 restart 2: the rider's far eye
 * faces the monitor lens at 0.336 against 0.35, at the face turn's 55° limit —
 * no rig change fixes that ring without breaking another clause). Rather than a
 * second copy of the check, the attempt runs the check itself, on the same
 * seed and restart, in its own process (it builds its own park: the seed and
 * restart are read once per process). One owner: the check. A park it rejects
 * is a failed attempt.
 */
const ACCEPTANCE_CHECK_SCRIPTS: readonly string[] = ['scripts/check-rail-race.mts'];
const runScript = promisify(execFile);

export interface AttemptFailure {
  /** The measure's name — an invariant's test name, `check:park <key>`, or `build`. */
  readonly measure: string;
  readonly count: number;
  /** The first few complaints, verbatim. */
  readonly first: readonly string[];
}

export interface BacktrackStats {
  readonly refusals: number;
  readonly retries: number;
  readonly accommodations: number;
  readonly unwinds: number;
  readonly deepestUnwind: number;
  readonly decisionZero: number;
  readonly forgone: number;
}

export interface AttemptVerdict {
  readonly seed: number;
  readonly restart: number;
  readonly built: boolean;
  readonly accepted: boolean;
  /** A measure threw: an instrument bug no restart can fix. The loop stops on it. */
  readonly broken: string | null;
  readonly failures: readonly AttemptFailure[];
  /** How many measures were asked, so a verdict that asked nothing cannot pass for one that asked everything. */
  readonly measuresAsked: number;
  readonly cpuMs: { readonly build: number; readonly invariants: number; readonly findings: number };
  /**
   * How hard the driver worked inside this park — the backtracking below the
   * root rung, per phase: refusals, retries, accommodations, unwinds, trips to
   * decision zero, forgone optional increments. Null where the phase never ran.
   */
  readonly backtracking: { readonly plan: BacktrackStats | null; readonly world: BacktrackStats | null };
  readonly wallMs: number;
}

const seed = Number(process.env['LGP_SEED'] ?? NaN);
const restart = Number(process.env['LGP_PARK_RESTART'] ?? 0);
if (!Number.isInteger(seed) || seed < 0 || !Number.isInteger(restart) || restart < 0) {
  console.error(`park-attempt: LGP_SEED (${process.env['LGP_SEED']}) and LGP_PARK_RESTART must be non-negative integers`);
  process.exit(2);
}

const FIRST = 3;
const began = performance.now();
const failures: AttemptFailure[] = [];
let measuresAsked = 0;
let built = false;
let buildCpu = 0;
let invariantsCpu = 0;
let findingsCpu = 0;

const firstLine = (error: unknown): string =>
  (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).split('\n')[0]?.slice(0, 400) ?? '';

/**
 * A measure that throws is an instrument bug, not a park that failed: a
 * restart cannot fix it, and letting the loop restart on it would hide it
 * behind a long search. So it is reported as `broken`, and the loop stops.
 */
let broken: string | null = null;

const cpu0 = cpuMs();
let facts: import('../test/procgen/parkFacts.ts').ParkFacts | null = null;
try {
  const { buildParkFacts } = await import('../test/procgen/parkFacts.ts');
  facts = await buildParkFacts(seed, restart);
  built = true;
} catch (error) {
  // The build itself gave up — a solver exhausted, a search that threw. That
  // is a park that could not be made from this stream: a reason to start again.
  failures.push({ measure: 'build', count: 1, first: [firstLine(error)] });
}
buildCpu = cpuMs() - cpu0;

if (facts) {
  const cpu1 = cpuMs();
  const { PARK_ACCEPTANCE } = await import('../test/procgen/invariants.ts');
  for (const [name, measure] of PARK_ACCEPTANCE) {
    measuresAsked += 1;
    let complaints: readonly string[];
    try {
      complaints = measure(facts);
    } catch (error) {
      broken ??= `${name}: ${firstLine(error)}`;
      complaints = [`the measure threw: ${firstLine(error)}`];
    }
    if (complaints.length > 0) failures.push({ measure: name, count: complaints.length, first: complaints.slice(0, FIRST) });
  }
  invariantsCpu = cpuMs() - cpu1;

  const cpu2 = cpuMs();
  try {
    const { measureParkFindings } = await import('./lib/parkFindings.mts');
    const park = measureParkFindings(facts.headless, true);
    measuresAsked += 1;
    for (const line of park.regressions) {
      const key = line.split(':')[0] ?? line;
      failures.push({ measure: `check:park ${key}`, count: 1, first: [line] });
    }
  } catch (error) {
    broken ??= `check:park: ${firstLine(error)}`;
    failures.push({ measure: 'check:park', count: 1, first: [`the measure threw: ${firstLine(error)}`] });
  }
  findingsCpu = cpuMs() - cpu2;

  for (const script of ACCEPTANCE_CHECK_SCRIPTS) {
    measuresAsked += 1;
    const name = `check:${script.replace(/^scripts\/check-|\.mts$/g, '')}`;
    try {
      await runScript(process.execPath, ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', script], {
        env: { ...process.env, LGP_SEED: String(seed), LGP_PARK_RESTART: String(restart) },
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
      });
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      const lines = `${failed.stdout ?? ''}\n${failed.stderr ?? ''}`
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^(FAIL|✗)/.test(l));
      failures.push({ measure: name, count: Math.max(1, lines.length), first: (lines.length > 0 ? lines : ['exited non-zero with no FAIL line']).slice(0, FIRST) });
    }
  }
}

const backtrackOf = (stats: BacktrackStats | null | undefined): BacktrackStats | null =>
  stats
    ? {
        refusals: stats.refusals,
        retries: stats.retries,
        accommodations: stats.accommodations,
        unwinds: stats.unwinds,
        deepestUnwind: stats.deepestUnwind,
        decisionZero: stats.decisionZero,
        forgone: stats.forgone,
      }
    : null;
let backtracking: AttemptVerdict['backtracking'] = { plan: null, world: null };
try {
  const { parkSolveStats } = await import('../src/world/parkPlan.ts');
  const { worldSolveStats } = await import('../src/world/worldPhase.ts');
  backtracking = { plan: backtrackOf(parkSolveStats()), world: backtrackOf(worldSolveStats()) };
} catch {
  // A build that threw before the plan existed has no stats to give.
}

const verdict: AttemptVerdict = {
  seed,
  restart,
  built,
  accepted: built && failures.length === 0 && broken === null,
  broken,
  failures,
  measuresAsked,
  cpuMs: { build: Math.round(buildCpu), invariants: Math.round(invariantsCpu), findings: Math.round(findingsCpu) },
  wallMs: Math.round(performance.now() - began),
  backtracking,
};
process.stdout.write(`park-attempt: ${JSON.stringify(verdict)}\n`);
// Handles the build left open (timers in the World) must not keep the process alive.
process.exit(0);
