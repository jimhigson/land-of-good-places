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

import { GroundClaims } from '../boot/groundClaims';
import { ParkSolve, COARSE_ATTEMPT_CAP, type SolveStats } from '../boot/parkSolve';
import { decisionSeed, refusal, type Advance, type FeatureBuilder, type Refusal } from '../boot/featureBuilder';
import { PARK_SEED } from './parkManifest';
import { PARK_RESTARTS, solveLayoutRestart, type ParkLayout } from './parkLayout';
import { layoutRestartBase } from './parkWarp';
import { bindCastlePlacement } from './building/layout';
import {
  cruiserStartSearch,
  finishCruiserPlanSearch,
  type CruiserSearchStart,
  type PlannedCoaster,
} from './coaster/solve';
import { cruiserRouteSearch } from './coaster/route';
import { RailRouteUnsolvable, type SolvedRailRoute } from './rail/generate';
import { TrainRoute, trainRouteSearch } from './train/route';
import { planStations, type PlannedStation } from './train/plan';
import { solveSlide, type PlannedSlide } from './slide/solve';
import { crossingSitesSearch, type SolvedCrossingSites } from './train/crossingPlanSolve';
import { pathGraphSearch, resetPathsState, type PathGraph } from './paths';
import { screenDrawnPathsForOffSiteCrossings } from './train/crossingPredicate';
import { drawnSamplesFor } from './pathGraph';
import { entranceRoadClaims, ROAD_FEATURE } from './entrance/roadCorridor';
import { offerPrewarmedGroundClaims } from '../boot/groundClaimsPrewarm';
import { Rng } from '../core/mathUtils';
import { PARK_BOUNDARY } from './boundary';
import { PLAYER_RADIUS } from '../core/constants';

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
}

// `var`, deliberately: this module is imported by `parkLayout.ts`, so it is
// evaluated in the middle of that module's evaluation, and a view read from
// any module further down the same import chain reaches `planPart` before
// these lines have run. A `let` would be in its temporal dead zone and throw
// "Cannot access before initialization"; a `var` is hoisted and simply not yet
// set, which `planPart` handles (it forces the solve, or records the read).
/* eslint-disable no-var */
var state: PlanState = {};
var driver: ParkSolve | null = null;
var solved = false;
var forcing = false;
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

/** The driver's trace, for stderr and the digest. Empty until the plan is driven. */
export function parkSolveTrace(): readonly string[] {
  return driver?.trace ?? [];
}

export function parkSolveStats(): SolveStats | null {
  return driver?.stats ?? null;
}

/** Which features the driver has placed so far, in order — for the boot screen's stage line. */
export function parkPlanPlaced(): readonly string[] {
  return driver?.placedFeatures ?? [];
}

/** The registry every builder committed into — the `World` adopts it. */
export function parkPlanClaims(): GroundClaims {
  if (!driver) solveParkPlanNow();
  return (driver as ParkSolve).claims;
}

// ------------------------------------------------------------- the builders

/**
 * A feature that is one solve: one increment, placed or refused. `solve` runs
 * at the given attempt; `set`/`clear` hold the decision in {@link state}.
 */
function coarse<T>(spec: {
  readonly name: string;
  readonly deps: readonly string[];
  readonly supply?: number;
  solve(attempt: number): Generator<number, T | Refusal, void>;
  set(value: T): void;
  clear(): void;
  claims?(value: T): Advance & object;
}): FeatureBuilder {
  let placed = false;
  return {
    name: spec.name,
    deps: spec.deps,
    *advance(attempt) {
      if (placed) return 'done';
      const outcome = yield* spec.solve(attempt);
      if (typeof outcome === 'object' && outcome !== null && (outcome as Refusal).refused === true) {
        return outcome as Refusal;
      }
      spec.set(outcome as T);
      placed = true;
      const increment = spec.claims ? spec.claims(outcome as T) : { claims: [] };
      return { ...increment, label: `attempt=${attempt}` };
    },
    back() {
      placed = false;
      spec.clear();
    },
    supply: () => spec.supply ?? COARSE_ATTEMPT_CAP,
    reset() {
      placed = false;
      spec.clear();
    },
  };
}

/**
 * A solver's own message, minus anything that is not a function of the seed:
 * `RailRouteUnsolvable` reports its elapsed milliseconds, and the trace is
 * hashed into the park digest, so a timing in a refusal reason would make the
 * same park hash differently on every run.
 */
function timeless(message: string): string {
  return (message.split('\n')[0] ?? '').replace(/,? in \d+(\.\d+)? ?ms\b/g, '');
}

function seedFor(feature: string, attempt: number, base: number): number {
  return attempt === 0 ? base : (base ^ decisionSeed(PARK_SEED, feature, 'solve', attempt)) >>> 0;
}

/**
 * The builders, made on first drive — **never at module scope**. `parkLayout.ts`
 * imports this module for `planPart`, so this module is evaluated in the
 * middle of `parkLayout.ts`'s own evaluation, when its exports are still in
 * their temporal dead zone; anything read from a solver module here at import
 * time would throw. The build order is fixed, and it is also the
 * accommodation precedence (earlier needs the space more).
 */
function builders(): readonly FeatureBuilder[] {
  const layoutBuilder = coarse<ParkLayout>({
    name: 'layout',
    deps: [],
    supply: PARK_RESTARTS,
    *solve(attempt) {
      const restart = layoutRestartBase() + attempt;
      const outcome = solveLayoutRestart(restart);
      if (outcome.kind === 'layout') return outcome.layout;
      return refusal(`layout restart ${restart}: ${outcome.reason}`);
    },
    set(layout) {
      state.layout = layout;
      bindCastlePlacement(layout);
    },
    clear() {
      delete state.layout;
    },
  });

  const cruiserBuilder = coarse<PlannedCoaster>({
    name: 'cruiser',
    deps: ['layout'],
    *solve(attempt) {
      const rng = attempt === 0 ? undefined : new Rng(seedFor('cruiser', attempt, 0));
      const start: CruiserSearchStart = yield* cruiserStartSearch(rng);
      let route: SolvedRailRoute;
      try {
        route = yield* cruiserRouteSearch(start.briefs);
      } catch (error) {
        if (!(error instanceof RailRouteUnsolvable)) throw error;
        return refusal(`sky cruiser: ${timeless(error.message)}`, { consumed: ['layout'] });
      }
      return yield* finishCruiserPlanSearch(route, start.rng);
    },
    set(cruiser) {
      state.cruiser = cruiser;
    },
    clear() {
      delete state.cruiser;
    },
  });

  const trainBuilder = coarse<TrainDecision>({
    name: 'train',
    deps: ['layout', 'cruiser'],
    *solve(attempt) {
      let solvedRoute: SolvedRailRoute;
      try {
        solvedRoute = yield* trainRouteSearch(attempt === 0 ? 0 : decisionSeed(PARK_SEED, 'train', 'solve', attempt));
      } catch (error) {
        if (!(error instanceof RailRouteUnsolvable)) throw error;
        return refusal(`railway loop: ${timeless(error.message)}`, { consumed: ['cruiser', 'layout'] });
      }
      const route = new TrainRoute(solvedRoute);
      return { route, stations: planStations(route) };
    },
    set(train) {
      state.train = train;
    },
    clear() {
      delete state.train;
    },
  });

  const slideBuilder = coarse<PlannedSlide>({
    name: 'slide',
    deps: ['layout', 'cruiser', 'train'],
    *solve(attempt) {
      const outcome = solveSlide(attempt === 0 ? 0 : decisionSeed(PARK_SEED, 'slide', 'solve', attempt));
      if ('refused' in outcome) {
        return refusal(`ginormous slide: ${outcome.blocker}`, { consumed: ['cruiser', 'layout'] });
      }
      return outcome;
    },
    set(slide) {
      state.slide = slide;
    },
    clear() {
      delete state.slide;
    },
  });

  const crossingsBuilder = coarse<SolvedCrossingSites>({
    name: 'crossings',
    deps: ['train'],
    supply: 1,
    *solve() {
      try {
        return yield* crossingSitesSearch();
      } catch (error) {
        if (!(error instanceof Error) || !/NO bridge site/.test(error.message)) throw error;
        return refusal('crossing plan: the railway loop proves no bridge site anywhere', { consumed: ['train'] });
      }
    },
    set(crossings) {
      state.crossings = crossings;
    },
    clear() {
      delete state.crossings;
    },
  });

  const pathGraphBuilder = coarse<PathGraph>({
    name: 'pathGraph',
    deps: ['layout', 'cruiser', 'train', 'slide', 'crossings'],
    supply: 1,
    *solve() {
      resetPathsState();
      const graph = yield* pathGraphSearch();
      // The drawn paths must cross the railway only at proven sites. Asked here,
      // at the point of decision, of the CURVES as they will be drawn
      // (`crossingPredicate.ts`, stage 4 point 1) — `computeCrossings` cannot be
      // asked yet: it reads the centreline `buildPaths` publishes when the World
      // is built, which is empty now, and it fouled falsely on every seed. Its
      // throw stays as the guard and must be unreachable from here on.
      state.pathGraph = graph;
      const train = planPart('train');
      const routes = graph.edges.filter((edge) => edge.paved).map((edge) => edge.route);
      const drawn = drawnSamplesFor(routes);
      // A drawn path must stay inside the park. On seed 4 `spur-waterFight`
      // was routed 1.8 m OUTSIDE the boundary wall, and its waypoint seeds
      // had nowhere to stand (`poi.nospot`). That is a plot standing too near
      // the wall for its spur — the layout's decision, so the refusal names it.
      const outside = drawn.find((sample) => PARK_BOUNDARY.distanceToEdge(sample.x, sample.z) < PLAYER_RADIUS);
      if (outside) {
        delete state.pathGraph;
        return refusal(
          `paths: a drawn path leaves the park at (${outside.x.toFixed(1)}, ${outside.z.toFixed(1)}), ` +
            `${(-PARK_BOUNDARY.distanceToEdge(outside.x, outside.z)).toFixed(2)} m past the boundary wall`,
          { consumed: ['layout'] },
        );
      }
      const screen = screenDrawnPathsForOffSiteCrossings(train.route, drawn);
      if (screen.fouls.length > 0) {
        delete state.pathGraph;
        const foul = screen.fouls[0] as (typeof screen.fouls)[number];
        const sites = planPart('crossings').bridges.map((site) => site.railDistance.toFixed(1)).join(', ');
        return refusal(
          `paths: ${screen.fouls.length} drawn crossing(s) off every proven site — first at railD ${foul.railDistance.toFixed(1)} ` +
            `(${foul.x.toFixed(1)}, ${foul.z.toFixed(1)}) by drawn run ${foul.run}; sites at railD ${sites}`,
          // Not the slide: a spur crossing the rail off-site is the loop's and the sites'.
          { consumed: ['crossings', 'train', 'cruiser', 'layout'] },
        );
      }
      return graph;
    },
    set(graph) {
      state.pathGraph = graph;
    },
    clear() {
      delete state.pathGraph;
      resetPathsState();
    },
  });

  const roadBuilder = coarse<true>({
    name: ROAD_FEATURE,
    deps: ['layout', 'pathGraph'],
    supply: 1,
    *solve() {
      return true;
    },
    set() {},
    clear() {},
    claims: () => ({ claims: entranceRoadClaims() }),
  });


  return [layoutBuilder, cruiserBuilder, trainBuilder, slideBuilder, crossingsBuilder, pathGraphBuilder, roadBuilder];
}

// ---------------------------------------------------------------- driving

function startDriver(): ParkSolve {
  if (driver) return driver;
  driver = new ParkSolve(PARK_SEED, builders(), new GroundClaims());
  return driver;
}

function finish(): void {
  solved = true;
  offerPrewarmedGroundClaims((driver as ParkSolve).claims);
  try {
    const nodeProcess = (globalThis as { process?: { stderr?: { write: (s: string) => unknown } } }).process;
    const stats = (driver as ParkSolve).stats;
    // The whole unwind trace, every build: a regression reads as "seed n now
    // unwinds where it did not", on the seed, not on a randomly re-drawn one.
    for (const line of (driver as ParkSolve).trace) nodeProcess?.stderr?.write(`park-solve:   ${line}\n`);
    nodeProcess?.stderr?.write(
      `park-solve: seed=${PARK_SEED} increments=${stats.increments} refusals=${stats.refusals} retries=${stats.retries} ` +
        `accommodations=${stats.accommodations} unwinds=${stats.unwinds} deepest-unwind=${stats.deepestUnwind} ` +
        `decision-zero=${stats.decisionZero} worst-attempt=${JSON.stringify(stats.worstAttempt)}\n`,
    );
  } catch {
    // Not Node: the trace is still on `parkSolveTrace()`.
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
    const run = startDriver().run();
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
    const trace = (driver?.trace ?? []).join('\n');
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n--- park-solve trace (seed ${PARK_SEED}) ---\n${trace}\n--- forced from ---\n${forcedFrom}`,
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
    yield* startDriver().run();
    finish();
  } finally {
    forcing = false;
  }
}
