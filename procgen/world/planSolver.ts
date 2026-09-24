/**
 * **The park plan's search** — the seven coarse builders the backtracking
 * driver runs when a park has no prebuilt file, and the only place they exist
 * (`docs/design/PREBUILT-PARKS.md`). Build-time Node code: `build:parks`, the
 * checks, the tests. The game as delivered cannot import this directory
 * (`check:procgen-boundary`); it hydrates the plan from the park file instead.
 *
 * Moved here from `src/world/parkPlan.ts` verbatim, save that a builder records
 * its decision through `setPlanDecision`/`clearPlanDecision` rather than by
 * writing that module's private state.
 */
import { GroundClaims } from '../../src/boot/groundClaims';
import { ParkSolve, COARSE_ATTEMPT_CAP, type SolveStats } from '../boot/parkSolve';
import { decisionSeed, refusal, type Advance, type FeatureBuilder, type Refusal } from '../../src/boot/featureBuilder';
import { PARK_SEED } from '../../src/world/parkManifest';
import { PARK_RESTARTS, type ParkLayout } from '../../src/world/parkLayout';
import { layoutRestartSearch } from './parkLayout';
import { layoutRestartBase } from './parkWarp';
import { cruiserStartSearch, finishCruiserPlanSearch, type CruiserSearchStart } from './coaster/solve';
import { type PlannedCoaster } from '../../src/world/coaster/planned';
import { cruiserRouteSearch } from './coaster/route';
import { type SolvedRailRoute } from '../../src/world/rail/generate';
import { RailRouteUnsolvable } from './rail/generate';
import { TrainRoute } from '../../src/world/train/route';
import { trainRouteSearch } from './train/route';
import { planStations } from '../../src/world/train/plan';
import { slideSearch } from './slide/solve';
import { type PlannedSlide } from '../../src/world/slide/planned';
import { crossingSitesSearch } from './train/crossingPlanSolve';
import { type SolvedCrossingSites } from '../../src/world/train/crossingSite';
import { resetPathsState, type PathGraph } from '../../src/world/paths';
import { pathGraphSearch, resetPathSearchCaches } from './paths';
import { screenDrawnPathsForOffSiteCrossings } from './train/crossingScreen';
import { drawnSamplesFor } from '../../src/world/pathGraph';
import { entranceRoadClaims, ROAD_FEATURE } from '../../src/world/entrance/roadCorridor';
import { Rng } from '../../src/core/mathUtils';
import { PARK_BOUNDARY } from '../../src/world/boundary';
import { BOUNDARY_WALL_COLLISION_HALF } from '../../src/world/Garden';
import { FENCE_HALF_THICKNESS, FENCE_OFFSET, PLATFORM_LENGTH, STATION_GAP } from '../../src/world/train/clearance';
import { distanceToRailCorridor, nearestRailDistanceAlong } from '../../src/world/train/plan';
import { PLAYER_RADIUS } from '../../src/core/constants';
import type { PathSample } from '../../src/world/pathGraph';
import { NAV_CELL } from '../../src/world/NavGrid';
import {
  clearPlanDecision,
  parkPlanOrder,
  planPart,
  setLayout,
  setPathGraph,
  setPlanDecision,
  type TrainDecision,
} from '../../src/world/parkPlan';
import type { PlanSolverRun } from '../../src/world/prebuilt/solverPort';
import { encodeParkFile, type ParkFile } from '../../src/world/prebuilt/parkFile';
import type { WorldDecisions } from '../../src/world/worldPhase';
import type { BridgeDecision } from '../../src/world/train/bridgeFootprint';


/**
 * A feature that is one solve: one increment, placed or refused. `solve` runs
 * at the given attempt; `set`/`clear` hold the decision in `parkPlan.ts`'s state.
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
    set: setLayout,
    clear() {
      clearPlanDecision('layout');
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
      return yield* countingSeams(finishCruiserPlanSearch(route, start.rng));
    },
    set(cruiser) {
      setPlanDecision('cruiser', cruiser);
    },
    clear() {
      clearPlanDecision('cruiser');
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
      setPlanDecision('train', train);
    },
    clear() {
      clearPlanDecision('train');
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
      setPlanDecision('slide', slide);
    },
    clear() {
      clearPlanDecision('slide');
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
      setPlanDecision('crossings', crossings);
    },
    clear() {
      clearPlanDecision('crossings');
    },
  });

  const pathGraphBuilder = coarse<PathGraph>({
    name: 'pathGraph',
    deps: ['layout', 'cruiser', 'train', 'slide', 'crossings'],
    supply: 1,
    *solve() {
      resetPathsState();
      resetPathSearchCaches();
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
      return graph;
    },
    set: setPathGraph,
    clear() {
      clearPlanDecision('pathGraph');
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

/* eslint-disable no-var */
var last: ParkSolve | null = null;
/* eslint-enable no-var */

/** A fresh plan search for this process's seed — what `procgen/install.ts` plugs into the park. */
export function createPlanSolver(): PlanSolverRun {
  const solve = new ParkSolve(PARK_SEED, builders(), new GroundClaims());
  last = solve;
  return {
    claims: solve.claims,
    get placedFeatures() {
      return solve.placedFeatures;
    },
    *run() {
      yield* solve.run();
      printTrace(solve);
    },
  };
}

/** The driver's trace, for stderr and the digest. Empty until the plan is searched. */
export function parkSolveTrace(): readonly string[] {
  return last?.trace ?? [];
}

/** The last plan search's statistics; null when the plan was hydrated (no driver ran). */
export function parkSolveStats(): SolveStats | null {
  return last?.stats ?? null;
}

function printTrace(solve: ParkSolve): void {
  const nodeProcess = (globalThis as { process?: { stderr?: { write: (s: string) => unknown } } }).process;
  const stats = solve.stats;
  // The whole unwind trace, every build: a regression reads as "seed n now
  // unwinds where it did not", on the seed, not on a randomly re-drawn one.
  for (const line of solve.trace) nodeProcess?.stderr?.write(`park-solve:   ${line}\n`);
  nodeProcess?.stderr?.write(
    `park-solve: seed=${PARK_SEED} increments=${stats.increments} refusals=${stats.refusals} retries=${stats.retries} ` +
      `accommodations=${stats.accommodations} unwinds=${stats.unwinds} deepest-unwind=${stats.deepestUnwind} ` +
      `decision-zero=${stats.decisionZero} worst-attempt=${JSON.stringify(stats.worstAttempt)}\n`,
  );
  const ms = Object.entries(stats.msByFeature)
    .map(([name, value]) => `${name}=${value.toFixed(0)}ms/${stats.piecesByFeature[name] ?? 0}p`)
    .join(' ');
  nodeProcess?.stderr?.write(`park-solve: seed=${PARK_SEED} time/pieces ${ms} cruiser-finish-seams=${cruiserFinishSeams}\n`);
}

/**
 * The decided park as a prebuilt park file — what `scripts/build-parks.mts`
 * writes: the plan (forced if nothing has decided it) and the world phase's
 * decisions, which only exist once a `World` has been built.
 */
export function parkPlanFile(world: WorldDecisions, bridges: readonly (BridgeDecision | null)[], build?: string): ParkFile {
  return encodeParkFile(
    PARK_SEED,
    {
      layout: planPart('layout'),
      cruiser: planPart('cruiser'),
      train: planPart('train'),
      slide: planPart('slide'),
      crossings: planPart('crossings'),
      pathGraph: planPart('pathGraph'),
      pathLattice: planPart('pathLattice'),
      planOrder: parkPlanOrder(),
      world,
      bridges,
    },
    build,
  );
}
