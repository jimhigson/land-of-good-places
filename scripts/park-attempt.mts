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
 * 2. the per-park clauses of four check scripts, through the functions those
 *    scripts are printers over (`ACCEPTANCE_CHECK_MEASURES` below) — each
 *    judges a decision a different restart could change;
 * 3. `check:park`'s measures (`scripts/lib/parkFindings.mts`), ratchet
 *    enforced — last, because `checkHoppableColliders` demotes colliders as
 *    the game's boot does, and the invariants are measured on the park as
 *    built, exactly as the suite measures them;
 * 4. the whole scripts in `ACCEPTANCE_CHECK_SCRIPTS`, each in its own process.
 *
 * Which checks are deliberately *not* asked, and why, is listed in
 * `docs/design/STRUCTURAL-BACKTRACKING.md` ("Outside acceptance").
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
import type { HeadlessPark } from './park-harness.mts';
import { buildBug } from './lib/attemptError.mts';
import { VOID_EXIT } from './lib/checkScope.mts';

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
const ACCEPTANCE_CHECK_SCRIPTS: readonly string[] = [
  'scripts/check-rail-race.mts',
];

/**
 * **Checks that play the park forward, asked in-process on a fresh World of
 * their own** — they move the world under them (an arrival, a crowd, a ride),
 * so they cannot share the attempt's park, but a second World over the plan
 * this process already solved costs ~6.5 s on seed 5 where a fresh process
 * re-solving the plan costs ~14 s plus module load. Each is handed `fresh`,
 * which builds that World as a fresh process would see it (the arrival due),
 * and asks only its decision clauses. Run after everything that reads the
 * attempt's own park.
 */
const ACCEPTANCE_SIM_MEASURES: readonly (readonly [
  string,
  (fresh: () => HeadlessPark) => Promise<CheckVerdict>,
])[] = [
  [
    'check:cat-bus',
    async (fresh) => {
      const { catBus } = await import('./lib/catBus.mts');
      const { decisions, voids } = await catBus(fresh, { quiet: true, clauses: 'decisions' });
      return { faults: decisions, voids };
    },
  ],
  [
    'check:npc-dispersal',
    async (fresh) => {
      const { npcDispersal } = await import('./lib/npcDispersal.mts');
      const { decisions, voids } = await npcDispersal(fresh, { quiet: true, clauses: 'decisions' });
      return { faults: decisions, voids };
    },
  ],
  [
    'check:slide-rider',
    async () => {
      // Builds its own World (it rides, so it needs live interior controls).
      const { slideRider } = await import('./lib/slideRider.mts');
      const { decisions, voids } = await slideRider({ quiet: true, clauses: 'decisions' });
      return { faults: decisions, voids };
    },
  ],
  [
    'check:pet-slide',
    async () => {
      // Builds its own World; catches three companions into the game store
      // (as the script does), so it runs after everything that reads the park.
      const { petSlide } = await import('./lib/petSlide.mts');
      const { decisions, voids } = await petSlide({ quiet: true, clauses: 'decisions' });
      return { faults: decisions, voids };
    },
  ],
  // Last: it moves booths, and the stand table it moves them in is the module's.
  [
    'check:stall-accommodate',
    async (fresh) => {
      const { stallAccommodate } = await import('./lib/stallAccommodate.mts');
      const { decisions, voids } = await stallAccommodate(fresh, { quiet: true, clauses: 'decisions' });
      return { faults: decisions, voids };
    },
  ],
];

/**
 * What one in-process check measure says about a park: `faults` fail the
 * attempt (a reason to start again); `voids` mean the instrument could not
 * measure at all — a broken measure, which stops the loop like a throw does.
 */
interface CheckVerdict {
  readonly faults: readonly string[];
  readonly voids: readonly string[];
}

/**
 * **Check scripts whose per-park clauses are acceptance measures, asked
 * in-process** through the one function each script is a printer over, so the
 * attempt pays no second park build for them. Each judges something the park's
 * own decisions set — where the Rail Race stands its trestles against the
 * road, where the Sky Cruiser's loop crosses the castle, how tight that loop
 * turns — so a different restart can pass it. Measured on seed 5 restart 0:
 * well under a second together, against a ~25 s park build.
 */
/** Which park an in-process measure is looking at, for the ones keyed on the seed. */
interface AttemptPark {
  readonly seed: number;
  readonly restart: number;
}

const ACCEPTANCE_CHECK_MEASURES: readonly (readonly [
  string,
  (park: HeadlessPark, which: AttemptPark) => Promise<CheckVerdict>,
])[] = [
  [
    'check:every-seed-builds',
    async (_park, { seed, restart }) => {
      const { LAYOUT_TRACE } = await import('../src/world/parkLayout.ts');
      const { builtWellProblems, falseRefusalProblem, falseRefusalsOf, layoutTraceCounts } = await import(
        './lib/builtWell.mts'
      );
      const counts = layoutTraceCounts(LAYOUT_TRACE);
      // A false refusal is the rung's instrument being wrong: a void, never a restart.
      // Proving one costs a second build, so it is asked only when the rung fired.
      const falseRefusal =
        counts.rungFired > 0 ? falseRefusalProblem(seed, await falseRefusalsOf(seed, restart)) : null;
      // Built well is judged against the seed's own record, and only seeds the
      // check sweeps have one: an off-pool seed is not this check's to judge.
      const { DECISION_ZERO_BASELINE, UNBUILT_BASELINE } = await import('./every-seed-builds-baseline.mts');
      const swept = DECISION_ZERO_BASELINE[seed] !== undefined || UNBUILT_BASELINE[seed] !== undefined;
      const faults = swept ? builtWellProblems(seed, counts, UNBUILT_BASELINE[seed] !== undefined) : [];
      return { faults, voids: falseRefusal ? [falseRefusal] : [] };
    },
  ],
  [
    'check:entrance-road',
    async (park) => {
      const { measureEntranceRoad, entranceRoadFaults, entranceRoadVoids } = await import('./lib/entranceRoad.mts');
      const report = await measureEntranceRoad(park);
      return { faults: entranceRoadFaults(report), voids: entranceRoadVoids(report) };
    },
  ],
  [
    'check:swept-bus',
    async (park) => {
      const { measureSweptBus, sweptBusIntrusion, sweptBusVoids } = await import('./lib/sweptBus.mts');
      const report = await measureSweptBus(park);
      const intrusion = sweptBusIntrusion(report);
      return { faults: intrusion === null ? [] : [intrusion], voids: sweptBusVoids(report) };
    },
  ],
  [
    'check:coplanar',
    async (park) => {
      const { gardenCoplanarRegressions } = await import('./lib/coplanarRatchet.mts');
      return { faults: await gardenCoplanarRegressions(park), voids: [] };
    },
  ],
  [
    'check:castle-towers',
    async (park) => {
      const { castleTowerFindings } = await import('./lib/castleTowers.mts');
      // Only the clauses a park decides: turret solidity is code, fixed at cause.
      const { decisions, voids } = await castleTowerFindings(park);
      return { faults: decisions, voids };
    },
  ],
  [
    'check:path-preference',
    async (park) => {
      const { pathPreference } = await import('./lib/pathPreference.mts');
      // Only the clauses the park decides (the network it drew, how routes sit
      // on it); the router's own are code, fixed at cause.
      const { decisions, voids } = await pathPreference(park, { quiet: true, clauses: 'decisions' });
      return { faults: decisions, voids };
    },
  ],
  [
    'check:waypoints',
    async () => {
      const { waypointFindings } = await import('./lib/waypointFindings.mts');
      const { voids, failures } = await waypointFindings();
      return { faults: failures.map((f) => `(${f.x}, ${f.z}) ${f.why}`), voids };
    },
  ],
  [
    'check:hotel',
    async (park) => {
      // Probe 22's park half — what stands in front of the tower. The rest of
      // check:hotel is the authored hotel (and four park builds), the same on
      // every park, so it stays the script's.
      const { hotelTowerFindings } = await import('./lib/hotelTower.mts');
      return { faults: (await hotelTowerFindings(park)).decisions, voids: [] };
    },
  ],
  [
    'check:castle-window',
    async (park) => {
      const { castleWindowFindings } = await import('./lib/rideFindings.mts');
      return { faults: (await castleWindowFindings(park)).complaints, voids: [] };
    },
  ],
  [
    'check:cruiser-turn-radius',
    async () => {
      const { cruiserTurnRadius } = await import('./lib/rideFindings.mts');
      return { faults: (await cruiserTurnRadius()).complaints, voids: [] };
    },
  ],
];
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
  readonly cpuMs: { readonly build: number; readonly invariants: number; readonly checks: number; readonly findings: number };
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
let checksCpu = 0;
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
let restorePlanClaims: (() => void) | null = null;
try {
  // The plan's registry as the plan left it, before any World commits into it:
  // put back before each fresh World the simulated checks build, so theirs is
  // the park a fresh process builds (`lib/freshWorld.mts`).
  const { snapshotPlanClaims } = await import('./lib/freshWorld.mts');
  restorePlanClaims = await snapshotPlanClaims();
  const { buildParkFacts } = await import('../test/procgen/parkFacts.ts');
  facts = await buildParkFacts(seed, restart);
  built = true;
} catch (error) {
  // The build itself gave up — a solver exhausted, a search that threw. That
  // is a park that could not be made from this stream: a reason to start again.
  // **Unless it is a bug** (`lib/attemptError.mts`: a TypeError, RangeError,
  // ReferenceError or SyntaxError anywhere in its cause chain): a restart
  // cannot fix that and must never be what hides it, so it is `broken`.
  const bug = buildBug(error);
  if (bug) broken ??= `build: ${firstLine(bug)}${bug.stack ? ` @ ${(bug.stack.split('\n')[1] ?? '').trim()}` : ''}`;
  failures.push({ measure: 'build', count: 1, first: [firstLine(bug ?? error)] });
}
buildCpu = cpuMs() - cpu0;

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
// Taken now, straight after the build: the simulated checks below build
// fresh Worlds of their own, and the world phase's stats would then be theirs.
// Not wrapped in a catch: a build that threw before the plan existed already
// reads as null stats (the accessors return null), and an import that fails is
// a broken instrument that must be loud — a swallowing catch here once hid a
// moved module and filed `backtracking: null` for every attempt (found on #705).
const { parkSolveStats } = await import('../src/world/parkPlan.ts');
const { worldSolveStats } = await import('../src/world/worldPhase.ts');
const backtracking: AttemptVerdict['backtracking'] = {
  plan: backtrackOf(parkSolveStats()),
  world: backtrackOf(worldSolveStats()),
};


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

  const cpuChecks = cpuMs();
  for (const [name, measure] of ACCEPTANCE_CHECK_MEASURES) {
    measuresAsked += 1;
    try {
      const { faults, voids } = await measure(facts.headless, { seed, restart });
      if (voids.length > 0) {
        broken ??= `${name}: ${voids[0]}`;
        failures.push({ measure: name, count: voids.length, first: voids.slice(0, FIRST) });
      } else if (faults.length > 0) {
        failures.push({ measure: name, count: faults.length, first: faults.slice(0, FIRST) });
      }
    } catch (error) {
      broken ??= `${name}: ${firstLine(error)}`;
      failures.push({ measure: name, count: 1, first: [`the measure threw: ${firstLine(error)}`] });
    }
  }
  checksCpu = cpuMs() - cpuChecks;

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

  const cpu3 = cpuMs();
  const { buildHeadlessPark, quietly } = await import('./park-harness.mts');
  const { saveFlags } = await import('../src/state/flags.ts');
  const fresh = (): HeadlessPark => {
    restorePlanClaims?.();
    saveFlags.hydrate({ arrivedByBus: false });
    return quietly(() => buildHeadlessPark());
  };
  for (const [name, measure] of ACCEPTANCE_SIM_MEASURES) {
    measuresAsked += 1;
    // Slide-rider and pet-slide build their own World: put the plan's registry
    // back for them too.
    restorePlanClaims?.();
    try {
      const { faults, voids } = await measure(fresh);
      if (voids.length > 0) {
        broken ??= `${name}: ${voids[0]}`;
        failures.push({ measure: name, count: voids.length, first: voids.slice(0, FIRST) });
      } else if (faults.length > 0) {
        failures.push({ measure: name, count: faults.length, first: faults.slice(0, FIRST) });
      }
    } catch (error) {
      broken ??= `${name}: ${firstLine(error)}`;
      failures.push({ measure: name, count: 1, first: [`the measure threw: ${firstLine(error)}`] });
    }
  }
  checksCpu += cpuMs() - cpu3;

  for (const script of ACCEPTANCE_CHECK_SCRIPTS) {
    measuresAsked += 1;
    const name = `check:${script.replace(/^scripts\/check-|\.mts$/g, '')}`;
    try {
      await runScript(process.execPath, ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', script], {
        // The scope: a script that knows it (`lib/checkScope.mts`) fails only on
        // its decision clauses and exits VOID_EXIT when it could not measure.
        env: { ...process.env, LGP_SEED: String(seed), LGP_PARK_RESTART: String(restart), LGP_CHECK_SCOPE: 'acceptance' },
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
      });
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; code?: number };
      if (failed.code === VOID_EXIT) {
        const tail = `${failed.stdout ?? ''}\n${failed.stderr ?? ''}`.trim().split('\n').slice(-3).join(' / ');
        broken ??= `${name}: the instrument could not measure — ${tail.slice(0, 400)}`;
      }
      const lines = `${failed.stdout ?? ''}\n${failed.stderr ?? ''}`
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^(FAIL|✗|- |· )|FAILED/.test(l));
      failures.push({ measure: name, count: Math.max(1, lines.length), first: (lines.length > 0 ? lines : ['exited non-zero with no FAIL line']).slice(0, FIRST) });
    }
  }
}

const verdict: AttemptVerdict = {
  seed,
  restart,
  built,
  accepted: built && failures.length === 0 && broken === null,
  broken,
  failures,
  measuresAsked,
  cpuMs: {
    build: Math.round(buildCpu),
    invariants: Math.round(invariantsCpu),
    checks: Math.round(checksCpu),
    findings: Math.round(findingsCpu),
  },
  wallMs: Math.round(performance.now() - began),
  backtracking,
};
process.stdout.write(`park-attempt: ${JSON.stringify(verdict)}\n`);
// Handles the build left open (timers in the World) must not keep the process alive.
process.exit(0);
