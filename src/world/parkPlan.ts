/**
 * **The park's decisions, made by the backtracking driver, viewed by everyone
 * else.**
 *
 * Before this file every generation decision was a module constant computed
 * at import — `PARK_LAYOUT`, `COASTER_PLANS`, `TRAIN_PLAN`, `SLIDE_PLAN`,
 * `CROSSING_SITES`, `PATH_GRAPH` — each solved once, in import order, and each
 * throwing when its seed's geometry defeated it. Nothing could be re-chosen.
 *
 * Now those constants are **views** ({@link lazyView}) of the state held here,
 * and the state is filled by {@link ParkSolve} driving one
 * {@link FeatureBuilder} per feature in a fixed order. A builder that cannot
 * place returns a refusal naming the decisions it consumed; the driver unwinds
 * to the most recent of them, re-chooses it, and replays. In the worst case it
 * unwinds to the layout's first draw and chooses a different park — the same
 * seed, deterministically.
 *
 * ## How the plan is forced
 *
 * Headless (every check, every test): `solveParkPlanNow()` drains the driver
 * synchronously — the harness calls it before it builds a `World`, and any
 * view read before that forces it too. In the browser `boot/parkGeneration.ts`
 * drives {@link parkPlanSearch} a slice per frame, exactly as it drove the
 * separate solvers before. A view read while the driver is mid-solve returns
 * the decision as it stands; a read of one not yet made throws, because that
 * is an ordering bug (a builder reading a feature later in the order than
 * itself).
 *
 * ## Coarse builders
 *
 * Every builder here is coarse — one increment, the whole solve — because each
 * of these generators is one search (Jim: *"not a fundamental rewrite — just
 * the existing looping, but with the ability to backtrack"*). Attempt 0 of
 * each is the exact solve the park made before, seeded as before; attempt n
 * folds n into the search's seed through {@link decisionSeed}, so a retry is a
 * genuinely different search and the same seed always makes the same park.
 */

import { GroundClaims, type FeatureContribution } from '../boot/groundClaims';
import { PARK_SEED } from './parkManifest';
import type { ParkLayout } from './parkLayout';
import { bindCastlePlacement } from './building/layout';
import type { PlannedCoaster } from './coaster/planned';
import type { TrainRoute } from './train/route';
import type { PlannedStation } from './train/plan';
import type { PlannedSlide } from './slide/planned';
import type { SolvedCrossingSites } from './train/crossingSite';
import {
  latticeStateSnapshot,
  resetPathsState,
  restoreLatticeState,
  type LatticeStateSnapshot,
  type PathGraph,
} from './paths';
import { entranceRoadClaims, ROAD_FEATURE } from './entrance/roadCorridor';
import { offerPrewarmedGroundClaims } from '../boot/groundClaimsPrewarm';
import { offeredParkFile, parkFileMissingReason } from './prebuilt/parkFileStore';
import { ParkUnavailable } from './prebuilt/parkUnavailable';
import { parkSolver, type PlanSolverRun } from './prebuilt/solverPort';
import { readCruiser, readCrossings, readLayout, readPathGraph, readSlide, readTrain, type ParkFile, PARK_FILE_FEATURES } from './prebuilt/parkFile';
import { parkFileProblem } from './prebuilt/plainData';

export interface TrainDecision {
  readonly route: TrainRoute;
  readonly stations: readonly PlannedStation[];
}

interface PlanState {
  layout?: ParkLayout;
  cruiser?: PlannedCoaster;
  train?: TrainDecision;
  slide?: PlannedSlide;
  crossings?: SolvedCrossingSites;
  pathGraph?: PathGraph;
  /** The street paving `pathGraphSearch` left in `paths.ts`, captured when the graph was decided. */
  pathLattice?: LatticeStateSnapshot;
}

// `var`, deliberately: this module is imported by `parkLayout.ts`, so it is
// evaluated in the middle of that module's evaluation, and a view read from
// any module further down the same import chain reaches `planPart` before
// these lines have run. A `let` would be in its temporal dead zone and throw
// "Cannot access before initialization"; a `var` is hoisted and simply not yet
// set, which `planPart` handles (it forces the solve, or records the read).
/* eslint-disable no-var */
var state: PlanState = {};
var driver: PlanSolverRun | null = null;
var solved = false;
var forcing = false;
/**
 * The prebuilt park the plan was hydrated from, or null if it was searched
 * (`docs/design/PREBUILT-PARKS.md`).
 */
var hydrateFrom: ParkFile | null = null;
/** The registry a hydrated plan committed into — the driver's own when it searched. */
var hydratedClaims: GroundClaims | null = null;
/** The features a hydrated plan has decided so far, in order. */
var hydratedPlaced: string[] = [];
/* eslint-enable no-var */

/**
 * The decision named by `key`, as it stands. Forces the whole solve if
 * nothing has driven it yet; throws if the decision has not been made.
 */
export function planPart<K extends keyof PlanState>(key: K): NonNullable<PlanState[K]> {
  if (!solved && !driver) {
    if (noForce()) {
      // The import-time scan (`scripts/scan-plan-reads.mts`): record who read
      // what before the plan was driven and hand back an inert stub so the
      // module keeps evaluating and every such site is found in one run.
      (importTimeReads ??= []).push(`${String(key)} ${new Error().stack ?? ''}`);
      return (inertStub ??= makeInertStub()) as NonNullable<PlanState[K]>;
    }
    solveParkPlanNow();
  }
  const value = (state ??= {})[key];
  if (value === undefined) {
    throw new Error(
      `park plan: ${key} was read before it was decided` +
        (driver && !solved ? ' — a builder is reading a feature later in the build order than itself' : ''),
    );
  }
  return value;
}

export function parkPlanSolved(): boolean {
  return solved;
}

/** Which features the driver has placed so far, in order — for the boot screen's stage line. */
export function parkPlanPlaced(): readonly string[] {
  return driver?.placedFeatures ?? hydratedPlaced ?? [];
}

/** The registry every builder committed into — the `World` adopts it. */
export function parkPlanClaims(): GroundClaims {
  if (!driver && !hydratedClaims) solveParkPlanNow();
  return hydratedClaims ?? (driver as PlanSolverRun).claims;
}

export function setLayout(layout: ParkLayout): void {
  state.layout = layout;
  bindCastlePlacement(layout);
}

export function setPathGraph(graph: PathGraph): void {
  state.pathGraph = graph;
  state.pathLattice = latticeStateSnapshot();
}

/** Record a decision the plan search made (`procgen/world/planSolver.ts`). */
export function setPlanDecision<K extends 'cruiser' | 'train' | 'slide' | 'crossings'>(key: K, value: NonNullable<PlanState[K]>): void {
  state[key] = value;
}

/** Forget a decision the plan search has withdrawn. */
export function clearPlanDecision(key: keyof PlanState): void {
  delete state[key];
  if (key === 'pathGraph') {
    delete state.pathLattice;
    resetPathsState();
  }
}

/**
 * One plan feature from a prebuilt park file: its decision set exactly as the
 * search would have set it, and the claims its increment commits. No search
 * runs; this is all the game as delivered can do (`docs/design/PREBUILT-PARKS.md`).
 */
function hydrateFeature(feature: string, file: ParkFile): FeatureContribution {
  switch (feature) {
    case 'layout':
      setLayout(readLayout(file.features.layout));
      break;
    case 'cruiser':
      state.cruiser = readCruiser(file.features.cruiser);
      break;
    case 'train':
      state.train = readTrain(file.features.train);
      break;
    case 'slide':
      state.slide = readSlide(file.features.slide);
      break;
    case 'crossings':
      state.crossings = readCrossings(file.features.crossings);
      break;
    case 'pathGraph': {
      const { graph, lattice } = readPathGraph(file.features.pathGraph);
      resetPathsState();
      restoreLatticeState(lattice);
      setPathGraph(graph);
      break;
    }
    case ROAD_FEATURE:
      return { claims: entranceRoadClaims() };
    default:
      throw new ParkUnavailable(PARK_SEED, `its park file names a plan feature this game does not know: '${feature}'`);
  }
  return { claims: [] };
}

/** The whole plan from a park file, one feature per step, committed in the order the search committed them. */
function* hydratePlan(file: ParkFile): Generator<number, void, void> {
  hydrateFrom = file;
  hydratedClaims = new GroundClaims();
  hydratedPlaced = [];
  for (const feature of file.planOrder) {
    hydratedClaims.commitSection(feature, 0, hydrateFeature(feature, file));
    hydratedPlaced.push(feature);
    yield hydratedPlaced.length;
  }
}

// ---------------------------------------------------------------- driving

/**
 * The plan, decided: hydrated from the park file when there is one. Otherwise
 * searched — but only if a solver is installed (`prebuilt/solverPort.ts`),
 * which Node tooling does and the game as delivered never does: there, no
 * park file is {@link ParkUnavailable}.
 */
function* decidePlan(): Generator<number, void, void> {
  const file = offeredParkFile();
  if (file) {
    const problem = parkFileProblem(file, PARK_SEED);
    if (problem) throw new ParkUnavailable(PARK_SEED, problem);
    yield* hydratePlan(file);
    return;
  }
  const solver = parkSolver();
  if (!solver) throw new ParkUnavailable(PARK_SEED, parkFileMissingReason() ?? 'no park file was loaded');
  driver = solver.plan();
  yield* driver.run();
}

/** Whether this park's plan was hydrated from a prebuilt file rather than searched. */
export function parkPlanHydrated(): boolean {
  return hydrateFrom !== null;
}

/** The plan's features in the order they were committed to the claims registry. */
export function parkPlanOrder(): readonly string[] {
  return driver ? driver.placedFeatures : hydratedPlaced;
}

function finish(): void {
  solved = true;
  offerPrewarmedGroundClaims(parkPlanClaims());
  if (hydrateFrom) {
    console.info(`Park plan: seed ${PARK_SEED} hydrated from its prebuilt file (${PARK_FILE_FEATURES.join(', ')}).`);
  }
}

/** Drive the whole plan now, synchronously. Idempotent. */
export function solveParkPlanNow(): void {
  if (solved) return;
  if (forcing) return; // a view read from inside a builder: the partial state answers
  if (noForce()) return;
  forcing = true;
  forcedFrom = new Error('park plan forced here').stack ?? '';
  void forcedFrom;
  try {
    const run = decidePlan();
    for (;;) {
      const step = run.next();
      if (step.done) break;
    }
    finish();
  } catch (error) {
    // The one remaining failure carries the whole story: what was decided,
    // what refused, and who forced the solve (a module-scope read of a view
    // during import is the classic cause of a solver running before its
    // module finished evaluating).
    if (error instanceof ParkUnavailable) throw error;
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n--- forced from ---\n${forcedFrom}`,
      { cause: error },
    );
  } finally {
    forcing = false;
  }
}

/* eslint-disable-next-line no-var -- see the note on `state` above: read before this line runs */
var forcedFrom = '';

/** Every plan read made at import under the scan switch — the sites that must become lazy. */
/* eslint-disable no-var */
export var importTimeReads: string[] = [];
var inertStub: unknown;
function makeInertStub(): unknown {
  const stub: unknown = new Proxy(function stub() {}, {
    get: (_t, key) => (key === Symbol.iterator ? function* () {} : key === Symbol.toPrimitive ? () => Number.NaN : stub),
    apply: () => stub,
    construct: () => stub as object,
    has: () => false,
  });
  return stub;
}
/* eslint-enable no-var */

/** A scan switch: with `LGP_PLAN_NO_FORCE=1` a read that would force the plan is recorded instead, and never runs. */
function noForce(): boolean {
  try {
    const nodeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    return nodeProcess?.env?.['LGP_PLAN_NO_FORCE'] === '1';
  } catch {
    return false;
  }
}

/** The same solve, a slice per `next()`, for the browser's boot loop. */
export function* parkPlanSearch(): Generator<number, void, void> {
  if (solved) return;
  forcing = true;
  try {
    yield* decidePlan();
    finish();
  } finally {
    forcing = false;
  }
}
