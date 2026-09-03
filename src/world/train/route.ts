import { Vector3 } from 'three';
import { TAU } from '../../core/mathUtils';
import { edgeRadiusAt, PARK_BOUNDARY } from '../boundary';
import { COASTER_PLANS } from '../coaster/plan';
import { ENTRANCE_GATE_HALF_WIDTH, ENTRANCE_GATE_X, ENTRANCE_GATE_Z } from '../entrance/layout';
import { RAIL_OVER_RAIL_AIR } from '../coaster/route';
import { PARK_LAYOUT } from '../parkLayout';
import { terrainHeight } from '../terrain';
import { bridgeableCrossingPosesSearch } from './crossingPoses';
import { fitBridgeAcross, railCorridorBlocked } from './bridgeFit';
import { chosenCrossingCorridor, crossingSurvivesStationAt } from './crossingKeepOut';
import { FENCE_HALF_THICKNESS, FENCE_OFFSET } from './clearance';
import { PLAYER_RADIUS } from '../../core/constants';
import { STATION_SEEDS, STATION_SEED_RADIUS } from './stationSeeds';
import { PARK_SEED } from '../parkManifest';
import { type Pose2, type SegmentKind, type Vec2, turnVocabulary } from '../rail/segments';
import { railRouteSearch, RailRouteUnsolvable, type RouteBrief, type SolvedRailRoute } from '../rail/generate';
import { TRAIN_MIN_TURN_RADIUS } from './turning';
import { takePrewarmedTrain } from './prewarm';

/**
 * Where the park train's track goes.
 *
 * **Grown by the generic rail generator** (`rail/generate.ts`), the same one the
 * Sky Cruiser and the Rail Race use, since 11 August 2026. It lays pieces of
 * track end to end from a vocabulary that *encodes a minimum turn radius*, and
 * validates every piece sample-by-sample against the layout before placing it —
 * so a bend tighter than {@link TRAIN_MIN_TURN_RADIUS} and a piece that crosses
 * a stall are both things the search cannot return, rather than things a later
 * check has to catch.
 *
 * ### What this replaced, and why
 *
 * The route used to be a bespoke **radius-per-bearing profile**: 360 spokes,
 * relaxed, snapped into the free radial gaps between obstacles, then built as a
 * Catmull-Rom through control points every 5°. It failed two ways, both visible
 * on the canonical seed (measured):
 *
 * - **No curvature constraint at all.** A sharp radial dip between two control
 *   bearings produced a **0.60 m** bend — a hairpin tighter than one carriage.
 * - **The snap-between-control-points hop.** `snapToFree` was memoryless, so the
 *   profile could sit in one free interval at one 5° bearing and a different one
 *   at the next, and the spline interpolated *straight through the obstacle
 *   between them* — the train ran 0.31 m from the Rail Racer booth's centre and
 *   through the middle of the Water Fight ride. The old code's own comments
 *   flagged this as known and unfixed ("removes the temptation, not the
 *   capability").
 *
 * The generic solver has neither failure mode by construction: avoidance is a
 * precondition of a piece existing, and the curve it ships *is* the validated
 * cubics (this class keeps the `SolvedRailRoute` as its source of truth rather
 * than resampling it into a spline, so there is no rebuild sag to lose radius to
 * either — unlike `CoasterRoute`, which does resample and pays a headroom for
 * it).
 *
 * ### Why it is still solved synchronously at module load
 *
 * Unchanged, and load-bearing: every ride's route is solved from the layout
 * alone, before a scene object exists, because `paths.ts` needs each ride's exit
 * to build the walk graph and cannot wait for a scene. `solveRailRoute` is
 * synchronous, so `TRAIN_PLAN` (in `plan.ts`) gets a finished centre line the
 * same way it always did — `Scenery` keeps trees off it, the path graph gets a
 * node per station, and `ParkTrain` simply builds it.
 */

/**
 * Half the track's width plus a little. The train is 1.5 m across the buffers;
 * this is what a collider is "inside the train" within, and the number the
 * procgen invariant holds every plot and stall to. Exported (see `train/index`).
 */
export const TRACK_CLEARANCE = 1.3;

/**
 * How far the centre line keeps off a plot or a stall while solving.
 *
 * Much larger than {@link TRACK_CLEARANCE}, and for the reason the old solver
 * gave: the fence stands 2 m off the rails and a walkable lane must survive
 * between fence and plot, or a booth whose doormat faces that lane is sealed
 * into a sliver. 2.0 fence + 1.9 lane + 0.3 breathing room.
 */
const TRACK_PLOT_CLEARANCE = 4.2;

/**
 * Half-width kept clear of the boundary wall while solving. The wall's own
 * collision half is ~0.45; this leaves the track's width plus a hair inside it.
 */
const CORRIDOR_RADIUS = 1.8;

/**
 * **How far the centre line keeps off the park's front doorway** (issue #481).
 *
 * The one thing in the park that cannot move out of the railway's way, so the
 * railway moves out of its. Derived, never chosen: the arch's own half-width,
 * plus the fence line, plus the fence's own thickness, plus the child walking
 * past it. Every term is read from its owner, so the day the arch is widened or
 * the fence moved out this follows without anybody remembering it exists.
 *
 * `PLAYER_RADIUS` is in here because the question is not "does the fence miss
 * the arch" but "can she walk through the arch with the fence there" — the
 * outermost half-metre of an 8.6 m opening is opening she uses.
 *
 * Read by {@link loopKeepsItsCrossing}, which asks it of a **closed loop**
 * rather than by `trainObstacles` asking it of every candidate piece. See that
 * clause for why the difference matters more than it looks.
 *
 * **The name says "walk", and it is asked at exactly one point: the arch.** Not
 * along `ENTRANCE_WALK_DEPTH`'s 12 m — that is `check:gateway`'s span, and the
 * two are deliberately different. The railway *may* cross the way in further
 * down, where `crossings.ts` gives it a level crossing or a bridge and the walk
 * stays open; what it may not do is run over the doorway itself, which is the
 * one place no crossing is minted because no path flips sides there. So the
 * rule is one distance from one point, and the 12 m walk is what the check
 * measures afterwards to see whether the result actually works.
 */
const GATE_WALK_RAIL_CLEARANCE =
  ENTRANCE_GATE_HALF_WIDTH + FENCE_OFFSET + FENCE_HALF_THICKNESS + PLAYER_RADIUS;

/** How close the loop may come to an earlier part of itself. */
const SELF_CLEARANCE = 3;

/**
 * The loop lengths tried, as fractions of the rim perimeter, **largest first**.
 *
 * The train wants to ring the park near the rim, so the search aims big first;
 * but a full-perimeter loop is over-constrained on a pinched or densely-plotted
 * seed — measured, it exhausted every start pose with a wall of boundary and
 * self-clearance rejections on seeds 2, 5, 11 and 18. So this is the train's
 * equivalent of the slide's `DESIRED_LENGTH_LADDER` and the cruiser's escalation:
 * a rung that cannot close hands off to a shorter, slacker one, which sits
 * further inside the rim but always has room to solve. A loop shorter than
 * these still avoids everything — it just rings less of the park.
 */
const TRAIN_LENGTH_FRACTIONS: readonly number[] = [0.62, 0.5, 0.4, 0.32];

/**
 * How far inside the wall the ring of candidate start poses sits — the modern
 * reading of the old wall-hugging `RIM_STANDOFF`, kept only to seed the search
 * near the rim so the loop grows into a big park-circling one rather than a
 * knot in the middle. The generator, not this number, decides the actual shape.
 */
const RIM_STANDOFF = 3.35;

/** Bearings of candidate start poses spread round the rim. More is more attempts. */
const START_POSES = 96;

/**
 * How far the loop stays clear of the plaza's heart, in metres — and with it,
 * clear of the whole inner path network the plaza anchors.
 *
 * The generic search knows only "avoid these obstacle discs, stay inside the
 * wall", so left to itself it dips a short loop into the r ≈ 15–37 band where
 * the ring road and its spurs live (`paths.ts`'s `solveRing`, capped 30 m off
 * the plaza). It does not *cross* a path there — it runs *alongside* one, and a
 * rail whose exclusion fence pinches a paved lane against nothing walkable
 * strands that lane's own waypoint samples off the graph. That is exactly what
 * seed 20260728 did: the loop grazed a ring-road sample at (-24, 24) — 1.3 m
 * off the centre line — and `check:park` reported one waypoint nobody could
 * walk to.
 *
 * Paths solve *after* the train (Decision 6), so the train cannot read the ring
 * as an obstacle. But the ring is a pure function of the plaza and the plots,
 * both known here, and it never reaches more than ~29 m from the plaza (its own
 * `highCap`). So keeping the loop this far out clears the ring's whole envelope
 * plus a fence and a walkable lane, everywhere, without coupling to the ring's
 * exact per-bearing shape: the railway rings the park *outside* the path
 * network, the way the old rim-hugging polar solver did (0 rail crossings, all
 * waypoints connected), rather than threading through its middle. Measured to
 * hold on the canonical seed and the four sweep seeds; a value this large has
 * room because the plaza sits in open lawn on every seed the manifest allows.
 */
const PLAZA_INNER_FLOOR = 26;

/**
 * The pieces the train is built from. {@link TRAIN_MIN_TURN_RADIUS} lives in the
 * tightest band; the wider bands and straights are what make the loop a shape
 * rather than a constant-radius ring. Gentle and long, for a slow train.
 */
const TRAIN_VOCABULARY: readonly SegmentKind[] = turnVocabulary(
  [
    { name: 'tight', minRadius: TRAIN_MIN_TURN_RADIUS, maxRadius: 20, minLength: 8, maxLength: 18 },
    { name: 'sweep', minRadius: 20, maxRadius: 42, minLength: 12, maxLength: 26 },
    { name: 'easy', minRadius: 42, maxRadius: 90, minLength: 16, maxLength: 34 },
  ],
  { minLength: 10, maxLength: 26 },
);

/** One thing the loop must keep clear of, as a keep-out disc on the ground. */
interface Obstacle {
  readonly x: number;
  readonly z: number;
  /** Distance the centre line must stay from this point: radius + clearance. */
  readonly reach: number;
}

/**
 * Everything the plan-view search must route around, as circles.
 *
 * Every layout entry (the castle, the plots, the stalls, the hotel, the ball
 * pit, the fountain) at its own `boundingRadius` — the one number the whole park
 * routes and scatters around — plus the Sky Cruiser's published *low* corridor
 * and its dismount point. The cruiser solves first and cannot know the train;
 * the train solves second and treats what the cruiser actually built as ground
 * truth (Decision 6). At cruise height the cruiser is no obstacle at all — only
 * where its rail is too low for the train to pass under with Decision 4's
 * {@link RAIL_OVER_RAIL_AIR} does it become a no-go disc.
 */
function trainObstacles(): Obstacle[] {
  const out: Obstacle[] = [];
  for (const entry of PARK_LAYOUT.entries.values()) {
    // The fountain keeps the loop out of the plaza's heart by PLAZA_INNER_FLOOR,
    // not merely off its own basin — see that constant.
    const reach =
      entry.id === 'fountain'
        ? Math.max(entry.boundingRadius + TRACK_PLOT_CLEARANCE, PLAZA_INNER_FLOOR)
        : entry.boundingRadius + TRACK_PLOT_CLEARANCE;
    out.push({ x: entry.x, z: entry.z, reach });
  }
  // The cruiser's dismount point: a fence across the spot a ride sets a child
  // down is the seed-18 failure shape, so the avoidance lives here.
  out.push({ x: COASTER_PLANS.cruiser.exitX, z: COASTER_PLANS.cruiser.exitZ, reach: 1.6 + 4.0 });

  const cruiser = COASTER_PLANS.cruiser.route;
  const probe = new Vector3();
  const lowCeiling = RAIL_OVER_RAIL_AIR + 0.4; // railhead sits ~0.3 above terrain
  for (let d = 0; d < cruiser.length; d += 2) {
    cruiser.pointAt(d, probe);
    if (probe.y - terrainHeight(probe.x, probe.z) >= lowCeiling) continue;
    // Clearance covers the fence the track carries (r + 2 m) against the
    // cruiser car's 1.45 m half-width — see the old profile's own note.
    out.push({ x: probe.x, z: probe.z, reach: 1.6 + 4.0 });
  }
  return out;
}

/** Everything the ladder's briefs share — the obstacle field, boundary and poses. */
interface TrainContext {
  readonly clear: (x: number, z: number, radius: number) => boolean;
  readonly startPoses: readonly Pose2[];
  readonly perimeter: number;
}

/**
 * Builds the shared search context from the layout alone (obstacles + poses).
 *
 * **A generator only because the pose sweep is 102 ms.** It runs before
 * `trainRouteSearch`'s first `yield`, so as a plain function the whole sweep
 * landed in one `ParkGeneration.advance()` — 100.1 ms against an 8 ms budget,
 * and `check:park-boot` red. See `bridgeableCrossingPosesSearch`'s own note.
 */
function* buildTrainContext(): Generator<number, TrainContext, void> {
  const obstacles = trainObstacles();
  const ox = Float64Array.from(obstacles, (o) => o.x);
  const oz = Float64Array.from(obstacles, (o) => o.z);
  const oreach = Float64Array.from(obstacles, (o) => o.reach);
  const count = obstacles.length;

  /**
   * Is a corridor of `radius` about (x, z) clear of every obstacle? The same
   * `hypot(a, b) >= |a|` axis prefilter the layout scans use, because this is
   * asked on every metre of every candidate piece and most obstacles are a whole
   * axis out of reach of the sample being asked about.
   */
  const clear = (x: number, z: number, radius: number): boolean => {
    for (let i = 0; i < count; i += 1) {
      const reach = (oreach[i] as number) + radius;
      const dx = x - (ox[i] as number);
      if (dx >= reach || -dx >= reach) continue;
      const dz = z - (oz[i] as number);
      if (dz >= reach || -dz >= reach) continue;
      if (Math.hypot(dx, dz) < reach) return false;
    }
    return true;
  };

  // Candidate start poses spread round the rim, each heading along it, so the
  // search grows a park-circling loop rather than a knot in the middle. A pose
  // inside a plot simply has no legal first piece and the search moves on.
  const rim: { x: number; z: number }[] = [];
  for (let i = 0; i < START_POSES; i += 1) {
    const angle = (i / START_POSES) * TAU;
    const r = edgeRadiusAt(PARK_BOUNDARY, angle) - RIM_STANDOFF;
    rim.push({ x: Math.cos(angle) * r, z: Math.sin(angle) * r });
  }
  let perimeter = 0;
  for (let i = 0; i < rim.length; i += 1) {
    const a = rim[i] as { x: number; z: number };
    const b = rim[(i + 1) % rim.length] as { x: number; z: number };
    perimeter += Math.hypot(b.x - a.x, b.z - a.z);
  }
  // **The loop begins at a crossing a bridge fits, not at a rim bearing**
  // (issue #427, Jim's ruling on #414: "the procgen should be able to make
  // parks that meet constraints and this should be a constraint").
  //
  // The rim ring above is still built, because `perimeter` — the length ladder
  // in `trainRouteSearch` is a fraction of it — is a property of the park's
  // own outline and nothing to do with where the loop starts.
  //
  // Every pose here stands where a bridge's deck and both ramps provably fit,
  // headed square across the path that will cross it, so a loop closed from
  // any of them has a bridgeable crossing by construction. See
  // `crossingPoses.ts` for why it is a ranked field rather than the single
  // crossing the literal design called for.
  const startPoses: Pose2[] = yield* bridgeableCrossingPosesSearch(PARK_SEED);

  return { clear, startPoses, perimeter };
}

/**
 * **Does this finished loop still admit a bridge where it started?**
 *
 * `crossingPoses.ts` proves a bridge fits at a pose *before* the railway
 * exists, which is the whole of issue #427 — but two things can only be known
 * once a candidate loop has closed, and both were measured taking the guarantee
 * away again:
 *
 * - **The loop can eat its own ramp room.** Seed 2 grew from a genuinely
 *   bridgeable crossing, then curved back on itself beside it; past the deck a
 *   ramp may not run in the rail's own corridor, and the planner measured
 *   **1.5 m of run against a 12.1 m floor**. The pose generator cannot see
 *   this at any price, because when it runs there is no loop to see.
 * - **Station placement can have no move that helps.** Seed 15's placer window
 *   held no candidate at all that cleared the crossing, so it took the
 *   least-bad one. A penalty does not discriminate when every candidate carries
 *   it — the loop, not the placement, is what has to give.
 *
 * Both are properties of the *solved* loop, so `RouteBrief.satisfies` is the
 * only hook in the search that can ask them: it runs the moment a candidate
 * closes, and a loop that fails simply sends the search on to the next of the
 * ~1200 ranked crossing poses. It also cannot make a park fail — if every pose
 * is exhausted the first solved loop is returned anyway, with
 * `SolveReport.satisfied` false — so this can only ever improve the outcome or
 * cost search time, never lose the railway. `SolveReport.satisfyRejects` counts
 * what it costs; `scripts/measure-train-solve-budget.mts` prints it.
 *
 * Neither test is written out here. The rail-corridor rule comes from
 * `bridgeFit.ts` and the station rule from `crossingKeepOut.ts`, both of which
 * the real planner reads as well — a more permissive second copy of "a bridge
 * fits here" is exactly the prover-versus-builder disagreement issue #414 was,
 * and putting one at this level would recreate it one level earlier.
 *
 * The station-structure test is deliberately *not* applied to the probe: at
 * this moment there is a route but no stations, and asking where they will
 * stand is what {@link crossingSurvivesStationAt} does instead.
 */
function loopKeepsItsCrossing(route: SolvedRailRoute): boolean {
  // The loop as a polyline, sampled once — the same 720 samples and the same
  // nearest-sample answer `TrainRoute.distanceNear` gives, so this measures the
  // railway the crossing planner will later measure, not a finer or coarser
  // idea of it.
  const samples = 720;
  const xs = new Float64Array(samples);
  const zs = new Float64Array(samples);
  const probe: Vec2 = { x: 0, z: 0 };
  for (let i = 0; i < samples; i += 1) {
    route.pointAt((i / samples) * route.length, probe);
    xs[i] = probe.x;
    zs[i] = probe.z;
  }
  const nearestSample = (x: number, z: number): number => {
    let best = 0;
    let bestSquared = Infinity;
    for (let i = 0; i < samples; i += 1) {
      const dx = (xs[i] as number) - x;
      const dz = (zs[i] as number) - z;
      const squared = dx * dx + dz * dz;
      if (squared < bestSquared) {
        bestSquared = squared;
        best = i;
      }
    }
    return best;
  };

  // Memoised on a 1 m grid, like the planner's own — the probe asks about
  // thousands of overlapping points per candidate footprint, and this runs once
  // per solved route rather than once per park.
  const railDistanceCache = new Map<number, number>();
  const railDistanceAt = (x: number, z: number): number => {
    const key = (Math.round(x) + 8192) * 32768 + (Math.round(z) + 8192);
    const hit = railDistanceCache.get(key);
    if (hit !== undefined) return hit;
    const i = nearestSample(x, z);
    const value = Math.hypot(x - (xs[i] as number), z - (zs[i] as number));
    railDistanceCache.set(key, value);
    return value;
  };

  // 0. **Does this loop leave the park's front door open?** (issue #481.)
  //
  // The gate is the one fixed thing in the park, and it was the one fixed thing
  // the railway had never been told about. Measured on `main`: pool seed 288's
  // loop ran 0.3 m from the walk in, 4 m inside the arch, near enough parallel
  // to it — so no path ever flipped sides at it, `crossings.ts` minted no gap,
  // and the lineside fence sealed the doorway a child had just walked through.
  // Sweep seed 18 was worse: the fence ran through the arch itself.
  //
  // **Asked here rather than added to `trainObstacles`, and that is not a
  // detail.** The piece-level search is bounded — `budgets.perJoint` keeps only
  // sixteen candidates at each joint — so an obstacle does not merely forbid
  // the loops that hit it, it changes which candidates survive the shortlist
  // everywhere, and the search returns a *different* first solution on seeds
  // that were never in the doorway at all. Measured: a keep-out disc at the
  // arch re-rolled the canonical park's loop (362 m to 359 m) though its
  // railway was 13.3 m from the gate and never came near, and re-rolled the
  // paths with it until one ended on a bridge; on seed 115 it removed the loop
  // altogether. Asked as a property of the *closed* loop it costs nothing on
  // the pool seeds that already clear the gate — their first solution is
  // unchanged — and sends the search on to the next start pose on the ones that
  // do not. Same reasoning as the two clauses below, which are here for the
  // same reason.
  if (railDistanceAt(ENTRANCE_GATE_X, ENTRANCE_GATE_Z) < GATE_WALK_RAIL_CLEARANCE) return false;

  const centre: Vec2 = { x: 0, z: 0 };
  const tangent: Vec2 = { x: 0, z: 0 };
  route.pointAt(0, centre);
  route.tangentAt(0, tangent);

  // 1. Does a whole bridge still fit across the track at the pose the loop was
  //    grown from, now that the railway is really there?
  const fit = fitBridgeAcross(
    centre.x,
    centre.z,
    tangent.z,
    -tangent.x,
    railCorridorBlocked(railDistanceAt),
  );
  if (!fit) return false;

  // 2. Can both stations be placed somewhere that leaves the crossing alone?
  const corridor = chosenCrossingCorridor(centre, tangent);
  const window: Vec2 = { x: 0, z: 0 };
  const flatPointAt = (distance: number): Vec2 => route.pointAt(distance, window);
  for (const seed of STATION_SEEDS) {
    const target = route.length
      ? (() => {
          const i = nearestSample(
            seed.bearingX * STATION_SEED_RADIUS,
            seed.bearingZ * STATION_SEED_RADIUS,
          );
          return (i / samples) * route.length;
        })()
      : 0;
    if (!crossingSurvivesStationAt(target, route.length, corridor, flatPointAt)) return false;
  }

  return true;
}

/** One ladder rung's brief: the shared context aimed at a particular length. */
function briefForLength(context: TrainContext, desiredLength: number, salt: number): RouteBrief {
  return {
    seed: PARK_SEED ^ 0x7241 ^ salt,
    vocabulary: TRAIN_VOCABULARY,
    desiredLength,
    closed: true,
    startPoses: context.startPoses,
    clear: context.clear,
    boundary: PARK_BOUNDARY,
    corridorRadius: CORRIDOR_RADIUS,
    selfClearance: SELF_CLEARANCE,
    minRadius: TRAIN_MIN_TURN_RADIUS,
    budgets: { perJoint: 16, restarts: context.startPoses.length },
    satisfies: loopKeepsItsCrossing,
  };
}

/**
 * **The train's loop search, as a generator — the sliceable cadence.**
 *
 * `boot/parkGeneration.ts`'s slice scheduler drives this a joint at a time behind
 * the cat bus, so the ~1.5 s search is spread over the ride's frames rather than
 * blocking one, and hands the finished loop to `train/prewarm.ts`. It is the same
 * relationship `railRouteSearch` has with `solveRailRoute`: identical route
 * whatever the cadence, because the whole search lives in the generator's own
 * locals (see `rail/generate.ts`).
 *
 * **It walks the length ladder** ({@link TRAIN_LENGTH_FRACTIONS}): the biggest
 * rim loop first, falling back to a shorter, slacker one when a rung exhausts
 * every start pose — the same escalation the slide and cruiser use, and what
 * keeps the park building on the pinched/dense seeds a single fixed length
 * cannot close (seeds 2, 5, 11, 18). Only if *every* rung fails does the park
 * fail, loudly, with the last rung's diagnostic — exactly as before.
 */
export function* trainRouteSearch(): Generator<number, SolvedRailRoute, void> {
  const context = yield* buildTrainContext();
  let lastFailure: RailRouteUnsolvable | null = null;
  // **A rung that solved but did not satisfy does not end the ladder.**
  //
  // `railRouteSearch` never throws once any start pose closed a loop: if every
  // pose failed `satisfies` it hands back the first route regardless, with
  // `report.satisfied` false, because a park with no railway is far worse than
  // one whose railway missed. That is right at its level and wrong at this one
  // — here there is somewhere else to go, namely the next rung's shorter,
  // slacker loop, and a rung's unsatisfied route was silently ending the walk
  // before the ladder ever got there.
  //
  // Measured on seed 2 (#427): its longest rung closed exactly one loop out of
  // 96 poses, that loop had curved back and eaten its own ramp room, and the
  // search returned it as a fallback — so the shorter rungs, which are the
  // whole reason the ladder exists for the pinched seeds, were never tried.
  //
  // So an unsatisfied route is kept aside and the ladder goes on. Only when
  // every rung has been walked is it handed back, which leaves
  // `railRouteSearch`'s own guarantee exactly as strong as it was: this can
  // still never fail to produce a railway.
  let unsatisfied: SolvedRailRoute | null = null;
  for (let i = 0; i < TRAIN_LENGTH_FRACTIONS.length; i += 1) {
    const fraction = TRAIN_LENGTH_FRACTIONS[i] as number;
    // A distinct seed salt per rung, so a shorter fallback explores differently
    // rather than re-walking the longer rung's dead ends at a new length.
    const brief = briefForLength(context, context.perimeter * fraction, (i + 1) * 0x1000);
    try {
      const route = yield* railRouteSearch(brief);
      if (route.report.satisfied) return route;
      // The first, not the best: the ladder has no ordering over whole routes
      // that could call one unsatisfied loop better than another, and inventing
      // one here would be a second notion of quality beside `scoreOf`. Same
      // reasoning `rail/generate.ts` gives for its own fallback.
      unsatisfied ??= route;
    } catch (error) {
      if (!(error instanceof RailRouteUnsolvable)) throw error;
      lastFailure = error;
    }
  }
  if (unsatisfied) return unsatisfied;
  throw lastFailure ?? new Error('train route: the length ladder was empty');
}

/** Drives {@link trainRouteSearch} straight through — the non-pre-warmed cadence. */
function solveTrainLoop(): SolvedRailRoute {
  const search = trainRouteSearch();
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
  }
}

/** The solved loop, and everything the train and the stations ask of it. */
export class TrainRoute {
  readonly length: number;

  /** Smallest gap between the centre line and the boundary wall. For reporting. */
  readonly minClearance: number;

  /**
   * What the loop search actually cost — start poses offered, which one won,
   * restarts, backtracks (`rail/generate.ts`'s {@link SolveReport}).
   *
   * Exposed for `scripts/measure-train-solve-budget.mts` (#427): growing the
   * loop from a chosen crossing pose trades a ring of 96 candidate rim
   * bearings for a handful of interior ones, and `budgets.restarts` comes
   * straight from `startPoses.length` — so whether that starves the search is
   * a question about these numbers, and they were not readable from outside.
   */
  readonly solveReport: SolvedRailRoute['report'];

  private readonly solved: SolvedRailRoute;
  private readonly sampleX: Float64Array;
  private readonly sampleZ: Float64Array;
  private readonly sampleDistance: Float64Array;
  private readonly scratch = new Vector3();
  private readonly scratch2: Vec2 = { x: 0, z: 0 };

  constructor() {
    // The loop `boot/parkGeneration.ts` already searched a slice at a time behind
    // the cat bus, if there is one; otherwise solve it straight through — the path
    // `check:park`, `test:procgen` and a continued save all take, none of which
    // pre-warm. Either way it is the same ladder walk.
    this.solved = takePrewarmedTrain() ?? solveTrainLoop();
    this.solveReport = this.solved.report;
    this.length = this.solved.length;

    // A lookup table for "where along the loop is this point?" — used to place
    // the stations and to send a child to the nearest one.
    const samples = 720;
    this.sampleX = new Float64Array(samples);
    this.sampleZ = new Float64Array(samples);
    this.sampleDistance = new Float64Array(samples);
    const p: Vec2 = { x: 0, z: 0 };
    let worstWall = Infinity;
    for (let i = 0; i < samples; i += 1) {
      const distance = (i / samples) * this.length;
      this.solved.pointAt(distance, p);
      this.sampleX[i] = p.x;
      this.sampleZ[i] = p.z;
      this.sampleDistance[i] = distance;
      const wall = PARK_BOUNDARY.distanceToEdge(p.x, p.z);
      if (wall < worstWall) worstWall = wall;
    }
    this.minClearance = worstWall;
  }

  /** Position on the centre line, `distance` metres along. Wraps both ways. */
  pointAt(distance: number, target = this.scratch): Vector3 {
    const p = this.solved.pointAt(this.wrap(distance), this.scratch2);
    return target.set(p.x, terrainHeight(p.x, p.z), p.z);
  }

  /**
   * The same centre-line point, ground-plane only — no `terrainHeight`.
   *
   * `paths.ts`'s `railInfoAt` asks "where is the rail near (x, z)?" thousands
   * of times while the walk graph solves, and it only ever reads `.x`/`.z` —
   * but {@link pointAt} pays for a `terrainHeight` sample (a boundary spline
   * walk) to fill in a `y` nobody looks at. Measured 25.7 ms of the paths
   * solve's single main-thread block (`check:park-boot`, 2026-08-24) spent
   * exactly there.
   */
  flatPointAt(distance: number, target: Vec2): Vec2 {
    return this.solved.pointAt(this.wrap(distance), target);
  }

  /** Unit tangent, pointing the way the train travels. Horizontal. */
  tangentAt(distance: number, target = new Vector3()): Vector3 {
    const t = this.solved.tangentAt(this.wrap(distance), this.scratch2);
    return target.set(t.x, 0, t.z).normalize();
  }

  /** Distance along the loop of the point nearest (x, z). */
  distanceNear(x: number, z: number): number {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < this.sampleX.length; i += 1) {
      const dx = (this.sampleX[i] ?? 0) - x;
      const dz = (this.sampleZ[i] ?? 0) - z;
      const squared = dx * dx + dz * dz;
      if (squared < bestDistance) {
        bestDistance = squared;
        best = this.sampleDistance[i] ?? 0;
      }
    }
    return best;
  }

  /** Folds any distance into [0, length). */
  wrap(distance: number): number {
    const wrapped = distance % this.length;
    return wrapped < 0 ? wrapped + this.length : wrapped;
  }

  /**
   * Signed gap from `from` to `to` going *forwards*, in metres. Always in
   * [0, length), so "how far to the next stop" never comes back negative.
   */
  forwardGap(from: number, to: number): number {
    return this.wrap(to - from);
  }
}
