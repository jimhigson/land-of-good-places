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
import { PARK_RESTARTS, layoutRestartSearch, type ParkLayout } from './parkLayout';
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
import { slideSearch, type PlannedSlide } from './slide/solve';
import { crossingSitesSearch, refuseBridgeSiteForPaths, type SolvedCrossingSites } from './train/crossingPlanSolve';
import {
  bridgesThatWallPathsIn,
  DISABLE_LEGIBILITY_SCREEN,
  STREET_PITCH,
  drawnEdgeOf,
  pathGraphSearch,
  plannedPavingGround,
  resetPathsState,
  type PathGraph,
} from './paths';
import { longDiagonals, offLatticeStreetRuns } from './pavingLegibility';
import { computeCrossings } from './train/crossings';
import { planBridgeFootprints, type PlannedFootprint } from './train/bridgeFootprint';
import { screenDrawnPathsForOffSiteCrossings } from './train/crossingPredicate';
import { drawnSamplesFor } from './pathGraph';
import { entranceRoadClaims, ROAD_FEATURE } from './entrance/roadCorridor';
import { offerPrewarmedGroundClaims } from '../boot/groundClaimsPrewarm';
import { Rng } from '../core/mathUtils';
import { PARK_BOUNDARY } from './boundary';
import { BOUNDARY_WALL_COLLISION_HALF } from './Garden';
import { FENCE_HALF_THICKNESS, FENCE_OFFSET, PLATFORM_LENGTH, STATION_GAP } from './train/clearance';
import { distanceToRailCorridor, nearestRailDistanceAlong } from './train/plan';
import { PLAYER_RADIUS } from '../core/constants';
import type { PathSample } from './pathGraph';
import { NAV_CELL } from './NavGrid';

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
// The two keep distances are computed inside `pinchedSample`, not here:
// `Garden.ts` (the wall half's owner) is mid-import when this module
// evaluates — the pathGraph → paths → parkPlan → Garden cycle — so a
// module-scope read of it is a TDZ crash on every seed (measured).
/** A child's lane needs this much from the boundary's collision face. */
const wallKeep = (): number => BOUNDARY_WALL_COLLISION_HALF + PLAYER_RADIUS;
/** ...and this much from the rail centreline: the fence stands `FENCE_OFFSET` off it. */
const fenceKeep = (): number => FENCE_OFFSET + FENCE_HALF_THICKNESS + PLAYER_RADIUS;
/**
 * Along the rail, a crossing's fence gap reaches at most this far either side
 * of its site (`computeCrossings`' cap on `halfGap`); within it there is no
 * fence for a lane to be pinched against, so the rail rule is waived there and
 * only the wall rule stands. Measured along the RAIL, not from the site's
 * centre: seeds 11 and 131 approach their bridges obliquely, and a radial
 * waiver read the approach beside the open gap as a pinch and re-rolled parks
 * that passed every invariant.
 */
const FENCE_GAP_REACH = 14;
/**
 * The lane must be a band wider than the child by one NavGrid cell, or the
 * children's own grid (`NavGrid.ts`, `NAV_CELL`) can miss it: seed 7's gate
 * approach had a 0.5 m clear band between the boundary wall and the railway's
 * fence — a child fits, no lattice column did, and the whole park was
 * unreachable from the entrance (measured: `route.unreachable` 17).
 */
const laneSlack = (): number => NAV_CELL;
/**
 * How far beyond the ribbon's edge a lane may lie — she may walk the lawn
 * beside a path, and the children's grid routes over lawn too. A metre was
 * too little: seed 131 reported a sample "pinched" whose passing band sat at
 * the very edge of the window, 3.15 m from the rail with the wall 43 m off.
 */
const LANE_OVERHANG = 3;

/**
 * The first drawn sample with no walkable lane across it — no point across the
 * ribbon (plus a metre of lawn each side) clear of both the boundary wall and
 * the railway's fence. Null when every sample has one.
 */
function pinchedSample(
  drawn: readonly PathSample[],
  sites: readonly { readonly railDistance: number }[],
  stations: readonly { readonly distance: number }[],
  loopLength: number,
): { sample: PathSample; wall: number; fence: number } | null {
  const WALL_KEEP = wallKeep();
  const FENCE_KEEP = fenceKeep();
  const LANE_SLACK = laneSlack();
  for (let i = 0; i < drawn.length; i += 1) {
    const sample = drawn[i] as PathSample;
    const before = drawn[i - 1];
    const after = drawn[i + 1];
    const a = before && before.run === sample.run ? before : sample;
    const b = after && after.run === sample.run ? after : sample;
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    dx /= length;
    dz /= length;
    const along = nearestRailDistanceAlong(sample.x, sample.z);
    const alongApart = (at: number): number => {
      const apart = Math.abs(along - at);
      return Math.min(apart, loopLength - apart);
    };
    // No fence to be pinched against within a crossing's gap — nor beside a
    // station, where the platform spur runs along the rail by design (seeds
    // 5 and 131 paid seven and eight re-rolls for their platform spurs).
    const nearSite =
      sites.some((site) => alongApart(site.railDistance) <= FENCE_GAP_REACH) ||
      stations.some((station) => alongApart(station.distance) <= PLATFORM_LENGTH / 2 + STATION_GAP);
    const span = sample.halfWidth + LANE_OVERHANG;
    // A lane is a BAND of passing offsets at least one NavGrid cell wide —
    // the slack is asked for once, across the band, not once per side.
    let lane = false;
    let bestWall = -Infinity;
    let bestFence = -Infinity;
    let bandStart: number | null = null;
    const STEP = 0.25;
    for (let o = -span; o <= span + 1e-9; o += STEP) {
      const x = sample.x - dz * o;
      const z = sample.z + dx * o;
      const wall = PARK_BOUNDARY.distanceToEdge(x, z);
      const fence = nearSite ? Infinity : distanceToRailCorridor(x, z);
      // Report the point that came nearest to having a lane.
      if (Math.min(wall - WALL_KEEP, fence - FENCE_KEEP) > Math.min(bestWall - WALL_KEEP, bestFence - FENCE_KEEP)) {
        bestWall = wall;
        bestFence = fence;
      }
      const passes = wall >= WALL_KEEP && fence >= FENCE_KEEP;
      if (passes) {
        bandStart ??= o;
        if (o - bandStart + 1e-9 >= LANE_SLACK) {
          lane = true;
          break;
        }
      } else {
        bandStart = null;
      }
    }
    if (!lane) return { sample, wall: bestWall, fence: bestFence };
  }
  return null;
}

/**
 * The cruiser finish's yields, for the boot's piece counts: the **structural
 * seams** are the yields that carry zero (a fixed property of
 * `coasterProfileSearch`; `check:park-boot` asserts exactly eight), the rest
 * are its vertical repair passes (`pass + 1`), which are data.
 */
var cruiserFinishSeams = 0;
var cruiserFinishPieces = 0;
function* countingSeams<T>(steps: Generator<number, T, void>): Generator<number, T, void> {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
    cruiserFinishPieces += 1;
    if (step.value === 0) cruiserFinishSeams += 1;
    yield step.value;
  }
}
export function parkPlanCruiserFinishSeams(): number {
  return cruiserFinishSeams;
}
export function parkPlanCruiserFinishPieces(): number {
  return cruiserFinishPieces;
}

function builders(): readonly FeatureBuilder[] {
  const layoutBuilder = coarse<ParkLayout>({
    name: 'layout',
    deps: [],
    supply: PARK_RESTARTS,
    *solve(attempt) {
      const restart = layoutRestartBase() + attempt;
      const outcome = yield* layoutRestartSearch(restart);
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
      const planned = yield* countingSeams(finishCruiserPlanSearch(route, start.rng));
      // The search asked the plan; this asks the curve riders fly. Both are
      // `spanInsideCastle` (coaster/route.ts) — `crossesTheCastle` on the plan,
      // `CoasterRoute.castleSpan` on the built curve, which is the very field
      // `skyCruiserAlwaysFliesThroughTheCastle` reads — so a loop that missed
      // is refused here, before anything is built on it, never shipped.
      if (planned.route.castleSpan === null) {
        return refusal('sky cruiser: the built loop never enters the castle', { consumed: ['layout'] });
      }
      return planned;
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
      const outcome = yield* slideSearch(attempt === 0 ? 0 : decisionSeed(PARK_SEED, 'slide', 'solve', attempt));
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
    // One draw per bridge site the paths may refuse (`refuseBridgeSiteForPaths`),
    // beyond the first.
    supply: 4,
    *solve(attempt) {
      try {
        return yield* crossingSitesSearch(attempt);
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
      //
      // `state.pathGraph` is NOT assigned here. The screens below yield back to
      // the frame loop between them, and the graph may yet be refused; bound
      // now, an unvalidated graph would sit in `state` across those yields for
      // anything that asked `planPart('pathGraph')` between slices. The driver
      // binds it through `set()` once `graph` is returned, screened.
      const train = planPart('train');
      const routes = graph.edges.filter((edge) => edge.paved).map((edge) => edge.route);
      // Each screen below is its own piece. Together they were one unbroken
      // 15.57 ms `next()` — the fattest single step of the whole plan drive,
      // measured — and it is the LAST one, so the slice that began it had
      // already spent most of its 8 ms budget on the steps before it. That is
      // the 22.4-23.1 ms `parkPlan` slice `check:park-boot` named on run after
      // run, against a ~20 ms ceiling: not a fat park, a fat piece. Four
      // independent passes over the same samples split into four pieces.
      yield 0;
      const drawn = drawnSamplesFor(routes);
      yield 0;
      // A drawn path must stay inside the park. On seed 4 `spur-waterFight`
      // was routed 1.8 m OUTSIDE the boundary wall, and its waypoint seeds
      // had nowhere to stand (`poi.nospot`). That is a plot standing too near
      // the wall for its spur — the layout's decision, so the refusal names it.
      // Refused only when the whole ribbon is outside: a centreline a few
      // tens of centimetres past the edge still has paving inside the wall,
      // and whether a child can walk it is the lane rule's question below.
      // Seed 7 paid a decision zero apiece for 0.24 m and 0.33 m.
      const outside = drawn.find((sample) => PARK_BOUNDARY.distanceToEdge(sample.x, sample.z) < -sample.halfWidth);
      if (outside) {
        return refusal(
          `paths: a drawn path leaves the park at (${outside.x.toFixed(1)}, ${outside.z.toFixed(1)}), ` +
            `${(-PARK_BOUNDARY.distanceToEdge(outside.x, outside.z)).toFixed(2)} m outside the boundary wall`,
          { consumed: ['layout'] },
        );
      }
      yield 0;
      const screen = screenDrawnPathsForOffSiteCrossings(train.route, drawn, { esplanadeOver: drawn });
      if (screen.fouls.length > 0) {
        const foul = screen.fouls[0] as (typeof screen.fouls)[number];
        const sites = planPart('crossings').bridges.map((site) => site.railDistance.toFixed(1)).join(', ');
        return refusal(
          `paths: ${screen.fouls.length} drawn crossing(s) off every proven site — first at railD ${foul.railDistance.toFixed(1)} ` +
            `(${foul.x.toFixed(1)}, ${foul.z.toFixed(1)}) by drawn run ${foul.run}; sites at railD ${sites}`,
          // Not the slide: a spur crossing the rail off-site is the loop's and the sites'.
          { consumed: ['crossings', 'train', 'cruiser', 'layout'] },
        );
      }
      // A drawn ribbon must leave a child a lane. Seed 7's gate approach ran
      // 0.35-0.47 m inside the boundary wall with the railway's fence 2-3 m
      // in from it: every sample was inside the park and no crossing was off
      // a site, and the whole park was unreachable from the entrance — the
      // path was squeezed shut between the wall and the fence. The loop is
      // the decision that pinched it.
      yield 0;
      const pinched = pinchedSample(drawn, planPart('crossings').bridges, train.stations, train.route.length);
      if (pinched) {
        return refusal(
          `paths: drawn run ${pinched.sample.run} is pinched shut at (${pinched.sample.x.toFixed(1)}, ${pinched.sample.z.toFixed(1)}): ` +
            `nearest lane point is ${pinched.wall.toFixed(2)} m from the boundary edge (needs ${wallKeep().toFixed(2)}) ` +
            `and ${pinched.fence.toFixed(2)} m from the rail centreline (needs ${fenceKeep().toFixed(2)}, in a band ${laneSlack().toFixed(2)} m wide)`,
          { consumed: ['train', 'layout'] },
        );
      }
      // A bridge that walls a path in — a route the repair could not take off
      // it, or could only by walking the long way round — is the crossing
      // plan's decision, so the plan is re-drawn without that site. See
      // `paths.ts`'s `commitRouteOffBridges`.
      const walled = bridgesThatWallPathsIn()[0];
      if (walled) {
        refuseBridgeSiteForPaths(walled.railDistance);
        return refusal(
          `paths: the bridge at railD ${walled.railDistance.toFixed(1)} walls ${walled.route} in — ` +
            `${walled.stillOn.toFixed(1)} m still on it after repair, ${walled.added.toFixed(1)} m added to a ` +
            `${walled.length.toFixed(1)} m route`,
          { consumed: ['crossings'] },
        );
      }
      // **The drawn paving must read as a grid** — `pathsRunOnGridAxes` and
      // `streetsShareLatticeLines`, asked here of the graph about to be
      // returned through `pavingLegibility.ts`, the one measure those two
      // invariants ask of the built park. Optional paving already met it at
      // its own point of decision (`addInterconnects` draws no connector that
      // fails it); what fails here is mandatory paving — a spur, a station
      // lead — routed onto its own private line or down a long diagonal by
      // where the plots, the loop and its crossings stand. Never shipped: the
      // park unwinds as for a pinched lane.
      yield 0;
      const legibility = DISABLE_LEGIBILITY_SCREEN ? null : yield* illegiblePaving(graph, drawn, train.route);
      if (legibility) {
        return refusal(`paths: ${legibility}`, { consumed: ['train', 'layout'] });
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

/**
 * The first way the graph's drawn paving fails to read as a grid, or null —
 * `pavingLegibility.ts`'s two measures over every paved edge, standing on
 * the planned park with the bridges of the crossings this very graph makes
 * (`computeCrossings` over its own samples; the conservative footprint, the
 * one known before a bridge is built — a superset of the built one's, so
 * this can only ever be looser than the built park's verdict at a bridge,
 * never stricter, and a park the invariants accept is never refused here).
 */
function* illegiblePaving(
  graph: PathGraph,
  drawn: readonly PathSample[],
  route: TrainRoute,
): Generator<number, string | null, void> {
  // Four pieces, not one: together they measured 7-8 ms on the canonical
  // seed, the whole of a slice's budget (see the screens' own note above).
  let footprints: readonly PlannedFootprint[] = [];
  try {
    footprints = planBridgeFootprints(computeCrossings(route, [], drawn));
  } catch {
    // An off-site crossing — refused by the screen above before this runs.
  }
  const ground = plannedPavingGround(
    (x, z) => footprints.some((footprint) => footprint?.covers(x, z) === true),
    // The same conservative footprint, padded: a superset of the built stone,
    // so like the exemption above it can only excuse MORE here than the
    // built park will. Deliberately: no bridge exists yet to ask, and a
    // screen without them would refuse every crossing's own diagonal ramp.
    // What slips through is caught by the root acceptance loop — measured on
    // seed 5 restart 0: `gate-approach` (z = 60.00) and `spur-building`
    // (x = -12.56) pass this screen and fail the built park's lattice
    // measure, the conservative footprint covering 29 gate-approach samples
    // the built bridge does not (57 both, 0 built-only).
    (x, z, pad) => footprints.some((footprint) => footprint?.covers(x, z, pad) === true),
  );
  yield 0;
  const edges = graph.edges.filter((edge) => edge.paved).map((edge) => drawnEdgeOf(edge.route));
  yield 0;
  const diagonal = longDiagonals(edges, ground)[0];
  if (diagonal) {
    return (
      `drawn paving from (${diagonal.from[0].toFixed(1)}, ${diagonal.from[1].toFixed(1)}) to ` +
      `(${diagonal.to[0].toFixed(1)}, ${diagonal.to[1].toFixed(1)}) runs diagonally for ${diagonal.extent.toFixed(1)} m ` +
      `(${diagonal.carriers.join(', ')})`
    );
  }
  yield 0;
  const run = offLatticeStreetRuns(edges, ground, STREET_PITCH)[0];
  if (run) {
    return (
      `${run.edge} runs ${run.axis === 'z' ? 'north-south' : 'east-west'} for ${run.length.toFixed(1)} m on ` +
      `${run.axis === 'z' ? 'x' : 'z'} = ${run.line.toFixed(2)}, ${run.off.toFixed(2)} m off the street lattice`
    );
  }
  return null;
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
    const ms = Object.entries(stats.msByFeature)
      .map(([name, value]) => `${name}=${value.toFixed(0)}ms/${stats.piecesByFeature[name] ?? 0}p`)
      .join(' ');
    nodeProcess?.stderr?.write(`park-solve: seed=${PARK_SEED} time/pieces ${ms} cruiser-finish-seams=${cruiserFinishSeams}\n`);
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
