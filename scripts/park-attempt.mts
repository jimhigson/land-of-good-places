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
import { cpuMs } from './lib/cpuClock.mts';

export interface AttemptFailure {
  /** The measure's name — an invariant's test name, `check:park <key>`, or `build`. */
  readonly measure: string;
  readonly count: number;
  /** The first few complaints, verbatim. */
  readonly first: readonly string[];
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
};
process.stdout.write(`park-attempt: ${JSON.stringify(verdict)}\n`);
// Handles the build left open (timers in the World) must not keep the process alive.
process.exit(0);
