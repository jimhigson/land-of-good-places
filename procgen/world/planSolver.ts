import { DISABLE_LEGIBILITY_SCREEN, STREET_PITCH, bridgesThatWallPathsIn, drawnEdgeOf, plannedPavingGround } from './paths';
import { type PlannedFootprint } from '../../src/world/train/bridgeFootprint';
import { computeCrossings } from '../../src/world/train/crossings';
import { longDiagonals, offLatticeStreetRuns } from '../../src/world/pavingLegibility';
import { planBridgeFootprints } from './train/bridgeSearch';
import { refuseBridgeSiteForPaths } from './train/crossingPlanSolve';
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
import { ParkSolve, COARSE_ATTEMPT_CAP, type SolveBudget, type SolveStats } from '../boot/parkSolve';
import { decisionSeed, refusal, type Advance, type FeatureBuilder, type Refusal } from '../boot/featureBuilder';
import { PARK_RESTART, PARK_SEED, PARK_SEED_ASKED } from '../../src/world/parkManifest';
import { PARK_RESTARTS, type ParkLayout } from '../../src/world/parkLayout';
import { BUILT_SOLID_MARGIN, distanceToBuiltSolids } from '../../src/world/paths';
import { PATH_KERB_OVERHANG } from '../../src/core/constants';
import { layoutRestartSearch } from './parkLayout';
import { layoutRestartBase } from './parkWarp';
import { cruiserStartSearch, finishCruiserPlanSearch, type CruiserSearchStart } from './coaster/solve';
import { type PlannedCoaster } from '../../src/world/coaster/planned';
import { CruiserMissedTheCastle, cruiserRouteSearch } from './coaster/route';

/** Draws of the cruiser a castle miss is offered — see the cruiser builder's `supply`. */
const CASTLE_MISS_DRAWS = 2;
import { type SolvedRailRoute } from '../../src/world/rail/generate';
import { RailRouteUnsolvable } from './rail/generate';
import { TrainRoute } from '../../src/world/train/route';
import { TrainRouteUnsolvable, trainRouteSearch } from './train/route';
import { planStations } from './train/stations';
import { finishSlideSearch, slideRouteSearch, type SlideRefusal } from './slide/solve';
import { type PlannedSlide } from '../../src/world/slide/planned';
import { crossingSitesSearch, refusedBridgeSiteCount } from './train/crossingPlanSolve';
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
import { ARCH_STATIONS, planRailRaceAt } from './railRace/plan';
import { barSlotWithNoSupportRoom } from './railRace/trestleSearch';

/**
 * **Test seams** — a test replaces one of these to inject a fault into a
 * builder without editing its source (`test/parkSolveBounded.test.ts`). Unset
 * in every real build. `var` for the reason `state` is: a solve can be forced
 * while this module is still mid-evaluation.
 */
export interface ParkPlanSeams {
  barSlotWithNoSupportRoom?: typeof barSlotWithNoSupportRoom;
  /** Tighter driver bounds, so a test reaches the end of a budget in seconds. */
  budget?: Partial<SolveBudget>;
}
/* eslint-disable-next-line no-var */
export var parkPlanSeams: ParkPlanSeams | undefined;
/** Install (or, with `undefined`, remove) the test seams. */
export function setParkPlanSeams(seams: ParkPlanSeams | undefined): void {
  parkPlanSeams = seams;
}
import { RAIL_RACE_PLAN } from '../../src/world/railRace/plan';
import { HAZARD_LAYOUT } from '../../src/world/railRace/simulate';
import { inRailCorridor } from './paths';
import type { RailRaceDecision } from '../../src/world/railRace/plan';
import { DuckBarRefusal } from '../../src/world/railRace/hazards';
import { planRaceBars } from '../../src/world/railRace/simulate';
import { clearPlanDecision, parkPlanOrder, planPart, setLayout, setPathGraph, setPlanDecision, type TrainDecision } from '../../src/world/parkPlan';
import type { PlanSolverRun } from '../../src/world/prebuilt/solverPort';
import { type ParkFile } from '../../src/world/prebuilt/parkFile';
import { encodeParkFile } from './parkFileWriter';
import type { WorldDecisions } from '../../src/world/worldPhase';


/**
 * A feature that is one solve: one increment, placed or refused. `solve` runs
 * at the given attempt; `set`/`clear` hold the decision in `parkPlan.ts`'s state.
 */
function coarse<T>(spec: {
  readonly name: string;
  readonly deps: readonly string[];
  /** Attempts on offer; a function when what is on offer depends on what has been refused (the crossings). */
  readonly supply?: number | (() => number);
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
    supply: () => (typeof spec.supply === 'function' ? spec.supply() : (spec.supply ?? COARSE_ATTEMPT_CAP)),
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

/**
 * **A path refusal the train's re-draw did not change is not the train's.**
 *
 * The pinch, off-site-crossing and legibility screens name the train because
 * the loop *can* cause them. Whether it did is measurable after the fact: the
 * driver re-draws the train, the paths are routed again, and if the screen
 * refuses with the **same reason, character for character** — the same run,
 * at the same coordinates to 0.1 m, by the same margins — under a loop that is
 * a different loop, then that refusal does not depend on the loop, and every
 * further re-draw buys a full loop search and a full path graph to be told it
 * again. Measured (fix/sb-trainsearch3): seed 7's first layout drew six trains
 * against `spur-dodgems runs east-west for 32.5 m on z = 33.22, 5.59 m off
 * the street lattice` and `drawn run 1 is pinched shut at (0.0, 54.0)` —
 * three loops each, identical text — before the layout was re-drawn and solved
 * first time; seed 15's third layout the same with one diagonal, three times.
 * In every sweep run on this line since the crossing replays were removed, no
 * layout on which a train-naming refusal repeated under a different loop went
 * on to a finished park.
 *
 * So the second time a reason is seen under a different loop, the refusal
 * names the layout alone. Reset whenever the layout changes; keyed on the
 * loop's own shape (length and two points), not its attempt number.
 */
// `var` and lazily made, for the reason `state` is: a solve can be forced
// while this module is still mid-evaluation.
/* eslint-disable-next-line no-var */
var pathRefusalsMap: Map<string, string> | undefined;
function pathRefusals(): Map<string, string> {
  return (pathRefusalsMap ??= new Map());
}
function trainKey(train: TrainDecision): string {
  const a = train.route.pointAt(0).clone();
  const b = train.route.pointAt(train.route.length / 3);
  return `${train.route.length}:${a.x},${a.z}:${b.x},${b.z}`;
}
function unlessTrainInnocent(
  reason: string,
  train: TrainDecision,
  consumed: readonly string[],
): readonly string[] {
  const key = trainKey(train);
  const seenUnder = pathRefusals().get(reason);
  if (seenUnder !== undefined && seenUnder !== key) return ['layout'];
  if (seenUnder === undefined) pathRefusals().set(reason, key);
  return consumed;
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
      pathRefusals().clear();
      setLayout(layout);
    },
    clear() {
      clearPlanDecision('layout');
      pathRefusals().clear();
    },
  });

  // Whether the cruiser's most recent search closed loops that all missed the
  // castle — read by its `supply` (below) at the moment the driver decides
  // whether to retry.
  let cruiserMissedTheCastle = false;
  const cruiserBuilder = coarse<PlannedCoaster>({
    name: 'cruiser',
    deps: ['layout'],
    // **A castle miss gets one re-draw, not five.** A re-draw of the cruiser
    // changes only the ORDER of its start poses (`stationPoseSearch` shuffles
    // with the retry stream; the set of poses, both briefs and their seeds
    // are functions of the layout alone), and each draw searches every pose
    // twice over — 2 x 308 on seed 5 — before it can say it missed. Where the
    // miss is the layout's (seed 5's second layout draw stands the
    // castle 24.9 m from the boundary with its window axis pointing at it:
    // measured, only near-straight passages along that axis clear the walls,
    // and the far side leaves 21.5 m to turn in), all six draws missed and
    // were 2/3 of the canonical park's whole cruiser cost. Over the sixteen
    // supported seeds ten castle-miss runs were recorded: six missed all six
    // draws, three passed at the first re-draw, one at the fifth. One re-draw
    // keeps the three; the castle rule itself is untouched — a missed castle
    // is still refused, it just names the layout sooner.
    supply: () => (cruiserMissedTheCastle ? CASTLE_MISS_DRAWS : COARSE_ATTEMPT_CAP),
    *solve(attempt) {
      cruiserMissedTheCastle = false;
      const rng = attempt === 0 ? undefined : new Rng(seedFor('cruiser', attempt, 0));
      const start: CruiserSearchStart = yield* cruiserStartSearch(rng);
      let route: SolvedRailRoute;
      try {
        route = yield* cruiserRouteSearch(start.briefs);
      } catch (error) {
        if (!(error instanceof RailRouteUnsolvable)) throw error;
        cruiserMissedTheCastle = error instanceof CruiserMissedTheCastle;
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
        // **The layout, not the cruiser.** The train reads the cruiser only
        // through its low corridor beside the station and its dismount point
        // (`trainObstacles`), and both stand where the layout put the
        // cruiser's booth: a cruiser re-draw re-orders the same start poses
        // around the same booth (`stationPoseSearch`), so it moves the
        // corridor little. Measured over every sweep of the sixteen supported
        // seeds this branch's line has run (six sweeps, fix/sb-trainsearch3):
        // seven distinct layouts had a cruiser draw whose six train searches
        // all failed, and none of the further train searches bought on its
        // re-drawn cruisers led to a finished park on that layout;
        // and no accepted park in any sweep used a cruiser re-draw for its
        // train. Named as well, the cruiser was re-drawn five times per such
        // layout — 30 more exhaustive loop searches, most of seed 9's train
        // cost. The cruiser does take part (its obstacles reject samples
        // nothing else rejects — counted in the reason below), but re-drawing
        // it is not a different enough decision to be worth naming.
        const cruiserOnly = error instanceof TrainRouteUnsolvable ? `; ${error.cruiserRejections} cruiser-only rejections` : '';
        return refusal(`railway loop: ${timeless(error.message)}${cruiserOnly}`, { consumed: ['layout'] });
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

  /**
   * **Where the Rail Race's arch stands, so that its duck bars can — refused
   * here, where the ring is decided, never thrown from the world phase.**
   *
   * The bar layout is a pure function of the two planned rings
   * (`railRace/simulate.ts`'s `planRaceBars`: the slots where a bar would hang
   * in another lane's track, and the slots where a flat-out rider would meet it
   * at the speed floor). Which slots those are turns on where the arch puts the
   * bar window against the lanes' undulation — the walk-past ring refuses
   * 13-26 of 49 slots a lane, the window holds 42 for 40 bars, and a slide of
   * the arch by a few metres moves the refusals across it (seed 5 restart 0:
   * 75 of 121 stations fit, the arch's own station does not, 5.25 m along
   * does). It used to be found by `new RailRace` in the world phase, as a
   * `DuckBarRefusal` thrown out of the whole build, and the root loop paid a
   * full park to start again.
   *
   * So the arch station is this builder's decision: attempt `n` is the `n`-th
   * clear station (`route.ts`'s `archStation`; attempt 0 is the arch as it
   * always stood, so a park whose bars fit is unchanged), refused when the bars
   * do not fit there and retried at the next. When the ring has no clear
   * station left, it refuses naming the decisions that placed the ring and its
   * arch's candidates (`archDecidedBy`: the layout always — its boundary and
   * booth; the cruiser or the railway only when their keep-offs pushed the
   * arch), and the driver re-chooses the most recent of them.
   */
  let archStationsOnOffer = ARCH_STATIONS;
  const railRaceBarsBuilder = coarse<RailRaceDecision>({
    name: 'railRaceBars',
    deps: ['layout', 'cruiser', 'train'],
    supply: () => archStationsOnOffer,
    *solve(attempt) {
      const plan = planRailRaceAt(attempt);
      if ('unplaceable' in plan) {
        // Nothing a later station can answer: unwind now, to what decided it.
        if (!plan.anotherStationMayHelp) archStationsOnOffer = attempt + 1;
        return refusal(plan.unplaceable, { consumed: plan.decidedBy });
      }
      try {
        return { archChoice: attempt, plan, bars: planRaceBars(plan) };
      } catch (error) {
        if (!(error instanceof DuckBarRefusal)) throw error;
        const ring = plan.raceRing;
        return refusal(
          `rail race: no lane rotation leaves every duck bar a legal slot on the ${ring.length.toFixed(1)} m ` +
            `ring with the arch at ${ring.startDistance.toFixed(2)} m (station ${attempt})`,
          { consumed: ring.archDecidedBy },
        );
      }
    },
    set(decision) {
      setPlanDecision('railRaceBars', decision);
    },
    clear() {
      clearPlanDecision('railRaceBars');
      archStationsOnOffer = ARCH_STATIONS;
    },
  });

  /**
   * **The slide's searches, kept for as long as what they read stands.**
   *
   * The chute's search reads the layout and the Sky Cruiser alone
   * (`slideRouteSearch`); only its finish reads the railway, to keep the exit
   * off the rail corridor. Yet the slide comes after the train in the build
   * order, so every railway re-draw — and every unwind that reaches it from the
   * crossings or the paths — backs the slide out and asks it again, and it ran
   * the identical search to the identical answer. Measured on seed 11 restart
   * 4 (fix/sb-slidecost): of 11 slide searches, 2 were repeats under an
   * unchanged layout and cruiser (89,182 and 145,830 pieces, the same counts
   * as the searches they repeated). Cheap there; on a layout whose slide is
   * the expensive one, each train re-draw would have paid it again.
   *
   * So the answer per attempt is kept, keyed on the very layout and cruiser
   * objects it was searched under — a re-drawn cruiser or layout is a new
   * object and empties the memo, so nothing is ever answered from a decision
   * that is gone — and only the finish (a few milliseconds, the exit read
   * against the railway as it now stands) runs again. Every decision is the
   * one the search would have made: the search draws only its own seeded
   * stream, so the same inputs and attempt give the same route or refusal.
   */
  let slideSearchedUnder: { readonly layout: ParkLayout; readonly cruiser: PlannedCoaster } | null = null;
  const slideSearched = new Map<number, { readonly route: SolvedRailRoute } | SlideRefusal>();
  // Attempts on offer while the slide's search has not run out of pieces.
  let slideAttemptsOnOffer = COARSE_ATTEMPT_CAP;
  const slideBuilder = coarse<PlannedSlide>({
    name: 'slide',
    deps: ['layout', 'cruiser', 'train'],
    // **A slide that ran out of pieces is not re-salted.** A retry changes only
    // the search's random stream; the doors, the pit mouths, the cruiser's air
    // and the ladder are the same, so a search that spent `SLIDE_PIECE_BUDGET`
    // on them is told the same thing again. Measured on seed 11 restart 4's
    // fourth layout (fix/sb-slidecost): all five re-salted searches spent the
    // whole budget too, each at the same decision (the 62 m target from the
    // door at 9.5 m) — 80 M pieces, ~190 s — and the cruiser re-draw the
    // driver then reached placed the slide in 18,978 pieces. So a budget
    // refusal names the cruiser at once (`consumed` below), which is the
    // driver's next rung once no retry is on offer.
    supply: () => slideAttemptsOnOffer,
    *solve(attempt) {
      const layout = planPart('layout');
      const cruiser = planPart('cruiser');
      if (slideSearchedUnder?.layout !== layout || slideSearchedUnder.cruiser !== cruiser) {
        slideSearched.clear();
        slideSearchedUnder = { layout, cruiser };
      }
      let found = slideSearched.get(attempt);
      if (found === undefined) {
        found = yield* slideRouteSearch(attempt === 0 ? 0 : decisionSeed(PARK_SEED, 'slide', 'solve', attempt));
        slideSearched.set(attempt, found);
      }
      const outcome = 'refused' in found ? found : yield* finishSlideSearch(found.route);
      if ('refused' in outcome) {
        if (outcome.budgetSpent) slideAttemptsOnOffer = attempt + 1;
        return refusal(`ginormous slide: ${outcome.blocker}`, { consumed: ['cruiser', 'layout'] });
      }
      return outcome;
    },
    set(slide) {
      setPlanDecision('slide', slide);
    },
    clear() {
      clearPlanDecision('slide');
      slideAttemptsOnOffer = COARSE_ATTEMPT_CAP;
    },
  });

  const crossingsBuilder = coarse<SolvedCrossingSites>({
    name: 'crossings',
    deps: ['train'],
    // One draw per bridge site the paths may refuse (`refuseBridgeSiteForPaths`),
    // beyond the first, up to four — and **only** per site actually refused.
    // Attempt n plans without the first n refused sites and is otherwise the
    // same pure function of the loop, so an attempt with no new ban behind it
    // is attempt n-1 again, byte for byte. It was offered anyway: seed 6
    // restart 5 re-drew identical sites three times per off-site-crossing
    // refusal (seed 1 likewise, seed 3 fifteen times), re-routing every path
    // to be refused the same way, before the unwind reached the decision that
    // could change something.
    supply: () => Math.min(4, 1 + refusedBridgeSiteCount()),
    *solve(attempt) {
      try {
        return yield* crossingSitesSearch(attempt);
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
    // `railRaceBars`: the paving keeps off the Rail Race arch's feet (`paths.ts`
    // BLOCKERS), and that builder decides where the arch stands.
    deps: ['layout', 'cruiser', 'train', 'railRaceBars', 'slide', 'crossings'],
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
      // **No drawn paving lies under a booth or a building.** Every route was
      // screened as it was chosen (`paths.ts`'s `routeClearsSolids`), but a
      // spur with no clear candidate falls back to a raw route rather than
      // leave a destination unreached — and that route can run under the
      // castle (seed 5, 2 Oct 2026: 24 m of it) or through a booth (seed 12:
      // the ferris kiosk). The layout is the decision that left no way round.
      const under = drawnSampleUnderASolid(drawn);
      // **Inside the railway's fences is the railway's to answer, not the
      // layout's.** It was the commonest single reason a whole layout was
      // redrawn (the gate approach alone: 66 of ~210 path refusals over 18
      // seed-14/0/15 solves, and as common on #706's base) — and every one of
      // them spent a decision zero, the budget a solve has least of. The loop
      // is what ran through the paving, so the solve unwinds to the train and
      // tries its next loop, exactly as an off-site crossing does; a refusal
      // that recurs under a different loop is the layout's after all
      // (`unlessTrainInnocent`). Keyed without coordinates so a different
      // loop hitting the same run counts as the same refusal.
      if (under && under.inRail) {
        const key = `paths: drawn run ${routes[under.run]?.name ?? under.run} runs inside the railway's fences`;
        return refusal(`${key} at (${under.x.toFixed(1)}, ${under.z.toFixed(1)})`, {
          consumed: unlessTrainInnocent(key, train, ['crossings', 'train']),
        });
      }
      if (under) {
        return refusal(
          `paths: drawn run ${under.run} lays paving under a booth, a building or inside the railway's fences at ` +
            `(${under.x.toFixed(1)}, ${under.z.toFixed(1)})`,
          { consumed: ['layout'] },
        );
      }
      yield 0;
      const screen = screenDrawnPathsForOffSiteCrossings(train.route, drawn, { esplanadeOver: drawn });
      if (screen.fouls.length > 0) {
        const foul = screen.fouls[0] as (typeof screen.fouls)[number];
        const sites = planPart('crossings').bridges.map((site) => site.railDistance.toFixed(1)).join(', ');
        const reasonOffSite =
          `paths: ${screen.fouls.length} drawn crossing(s) off every proven site — first at railD ${foul.railDistance.toFixed(1)} ` +
            `(${foul.x.toFixed(1)}, ${foul.z.toFixed(1)}) by drawn run ${foul.run}; sites at railD ${sites}`;
        return refusal(
          reasonOffSite,
          // Not the slide: a spur crossing the rail off-site is the loop's and the sites'.
          { consumed: unlessTrainInnocent(reasonOffSite, train, ['crossings', 'train', 'cruiser', 'layout']) },
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
        const reasonPinched =
          `paths: drawn run ${pinched.sample.run} is pinched shut at (${pinched.sample.x.toFixed(1)}, ${pinched.sample.z.toFixed(1)}): ` +
            `nearest lane point is ${pinched.wall.toFixed(2)} m from the boundary edge (needs ${wallKeep().toFixed(2)}) ` +
            `and ${pinched.fence.toFixed(2)} m from the rail centreline (needs ${fenceKeep().toFixed(2)}, in a band ${laneSlack().toFixed(2)} m wide)`;
        return refusal(reasonPinched, { consumed: unlessTrainInnocent(reasonPinched, train, ['train', 'layout']) });
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
        const reasonIllegible = `paths: ${legibility}`;
        return refusal(reasonIllegible, { consumed: unlessTrainInnocent(reasonIllegible, train, ['train', 'layout']) });
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
    deps: ['layout', 'railRaceBars', 'pathGraph'],
    supply: 1,
    *solve() {
      // **The road leaves every Rail Race duck bar its support.** Nothing of a
      // walk-past trestle may stand over the carriageway (`track.ts`'s road
      // rule), and no trunk may lean past its bound; a bar's slot with no
      // candidate left is a support the world phase could only fail to place,
      // refused by the road or the lean alone — nothing movable to ask aside.
      // It used to throw there. The bar slots are `railRaceBars`' decision, so
      // that is the decision re-chosen. Asked here because the road is the
      // last thing decided that the answer depends on.
      const road = entranceRoadClaims().filter((claim) => claim.kind === 'corridor');
      for (const [name, ring, keepOff] of [
        ['walk-past', RAIL_RACE_PLAN.walkPastRing, road],
        ['race', RAIL_RACE_PLAN.raceRing, []],
      ] as const) {
        const slot = (parkPlanSeams?.barSlotWithNoSupportRoom ?? barSlotWithNoSupportRoom)(ring, HAZARD_LAYOUT, keepOff);
        if (slot !== null) {
          return refusal(
            `rail race: the ${name} ring's duck bar at slot ${slot} has no support that is a trunk` +
              (keepOff.length > 0 ? ' and keeps off the entrance road' : ''),
            { consumed: ['railRaceBars'] },
          );
        }
      }
      return true;
    },
    set() {},
    clear() {},
    claims: () => ({ claims: entranceRoadClaims() }),
  });


  return [layoutBuilder, cruiserBuilder, trainBuilder, railRaceBarsBuilder, slideBuilder, crossingsBuilder, pathGraphBuilder, roadBuilder];
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

/* eslint-disable no-var */
var last: ParkSolve | null = null;
/* eslint-enable no-var */

/** A fresh plan search for this process's seed — what `procgen/install.ts` plugs into the park. */
export function createPlanSolver(): PlanSolverRun {
  const solve = new ParkSolve(PARK_SEED, builders(), new GroundClaims(), parkPlanSeams?.budget ?? {});
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

/**
 * The plan's settled decisions, `feature#section attempt=n`, in ledger order —
 * for `scripts/scatter-digest.mts`, so two parks built to differ in one spur
 * can prove they did not differ in their layout too.
 */
export function parkPlanDecisions(): readonly string[] {
  return (last?.decisions ?? []).map((entry) => `${entry.feature}#${entry.section} attempt=${entry.attempt}`);
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
export function parkPlanFile(world: WorldDecisions, built: Readonly<Record<string, unknown>>, build?: string): ParkFile {
  return encodeParkFile(
    PARK_SEED_ASKED,
    PARK_RESTART,
    {
      layout: planPart('layout'),
      cruiser: planPart('cruiser'),
      train: planPart('train'),
      slide: planPart('slide'),
      railRaceBars: planPart('railRaceBars'),
      crossings: planPart('crossings'),
      pathGraph: planPart('pathGraph'),
      pathLattice: planPart('pathLattice'),
      planOrder: parkPlanOrder(),
      world,
      built,
    },
    build,
  );
}

/**
 * The first drawn sample whose cross-section — centre and out to half its
 * width plus the kerb either side, square to the run — reaches inside a booth
 * or a building (`distanceToBuiltSolids`), or `null`.
 */
function drawnSampleUnderASolid(drawn: readonly PathSample[]): (PathSample & { readonly inRail: boolean }) | null {
  for (let i = 0; i < drawn.length; i += 1) {
    const here = drawn[i] as PathSample;
    const before = drawn[i - 1]?.run === here.run ? (drawn[i - 1] as PathSample) : here;
    const after = drawn[i + 1]?.run === here.run ? (drawn[i + 1] as PathSample) : here;
    const tx = after.x - before.x;
    const tz = after.z - before.z;
    const t = Math.hypot(tx, tz);
    if (t < 1e-9) continue;
    const reach = here.halfWidth + PATH_KERB_OVERHANG;
    for (const k of [0, -1, -0.5, 0.5, 1]) {
      const px = here.x - (tz / t) * reach * k;
      const pz = here.z + (tx / t) * reach * k;
      if (distanceToBuiltSolids(px, pz) < BUILT_SOLID_MARGIN) return { ...here, inRail: false };
      if (inRailCorridor(px, pz)) return { ...here, inRail: true };
    }
  }
  return null;
}
