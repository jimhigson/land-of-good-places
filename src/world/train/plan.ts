import { Vector3 } from 'three';
import { TrainRoute } from './route';
import { COASTER_PLANS } from '../coaster/plan';
import { terrainHeight } from '../terrain';
import { STATION_SEEDS, STATION_SEED_RADIUS } from './stationSeeds';
import { FENCE_OFFSET, PLATFORM_LENGTH, STATION_GAP, STATION_SPUR_WIDTH } from './clearance';

/**
 * The rail plan — the railway as *data*, solved at module load from the park
 * layout alone, before any scene object exists.
 *
 * This inverts the old order. The route used to be solved against the
 * finished collision world (so a tree bent the track), which meant nothing
 * upstream of the train could know where the railway was: paths could not
 * treat stations as destinations, and the path network had to be discovered
 * by the trains rather than planned with them. Now the plan is pure — layout
 * in, centre line and station positions out — and everything else reacts:
 * trees keep off the corridor (`Scenery`), the path graph gets a node per
 * station (`paths.ts`), and `ParkTrain` simply *builds* what was planned.
 */

export interface PlannedStation {
  readonly index: number;
  readonly name: string;
  readonly accent: number;
  /** Metres along the loop of the platform's centre. */
  readonly distance: number;
  /** Where a child waits: on the park side of the platform. */
  readonly standX: number;
  readonly standZ: number;
  /**
   * Where a path should arrive: a few metres along the platform on its
   * *empty* half. The canopy posts and the bench all stand at negative
   * platform-along by construction (`station.ts`), so a spur walking in at
   * positive along, then turning down the platform to the stand, never has
   * furniture across its line.
   */
  readonly approachX: number;
  readonly approachZ: number;
  /**
   * Where the spur should arrive from the park: past the platform's empty
   * end and stepped out into the park, so the incoming leg never cuts
   * diagonally across the canopy posts on the furnished half. Added when
   * issue #241 spread the plots: with stations landing on the loop's rim
   * bulges, `bestBranchPoint` can sit at almost any bearing from the
   * platform, and the straight leg it drew to the approach paved through the
   * posts and stranded Bluebell Halt's waypoints.
   */
  readonly leadX: number;
  readonly leadZ: number;
}

/** Clear of every plot's bounding circle by `radius` — the pure counterpart
 * of the old `collision.isClearCircle`. Trees no longer count: they are
 * seeded *after* this plan now, and keep off the railway rather than the
 * railway bending round them.
 *
 * Exported so any other pure plan solved at module load — `coaster/plan.ts`,
 * the ferris wheel's exit point — can ask the same question of the same
 * layout, rather than each re-deriving it. */
export { clearOfPlots } from '../parkLayout';
import { clearOfPlots } from '../parkLayout';
import {
  STATION_SEARCH_STEP,
  STATION_SEARCH_WINDOW,
  chosenCrossingCorridor,
  stationCrossingConflict,
} from './crossingKeepOut';
import type { Vec2 } from '../rail/segments';

/** The waiting spot beside the platform at `distance` — same side math the
 * station builder uses: the park side, 2.15 m off the centre line. */
export function stationStand(
  route: TrainRoute,
  distance: number,
): { standX: number; standZ: number } {
  const centre = route.pointAt(distance, new Vector3());
  const tangent = route.tangentAt(distance, new Vector3());
  const rightX = tangent.z;
  const rightZ = -tangent.x;
  const parkIsRight = rightX * -centre.x + rightZ * -centre.z >= 0;
  const side = parkIsRight ? 1 : -1;
  return {
    standX: centre.x + rightX * side * 2.15,
    standZ: centre.z + rightZ * side * 2.15,
  };
}

/**
 * Slides along the loop from `target` (0, +1, -1, +2 … metres) until the
 * platform area — three discs across its length — is clear of every plot.
 * Gives up at ±24 m and returns the target; the boot assert and check:park
 * then say so loudly rather than a child finding a platform inside a booth.
 */
function clearStationDistance(
  route: TrainRoute,
  target: number,
  placed: readonly Vec2[],
): number {
  const tangent = new Vector3();
  const centre = new Vector3();

  // **The loop's own chosen crossing** (issue #427) — the ground a station may
  // not stand on, in either of the two senses `crossingKeepOut.ts` owns. Built
  // once here and asked per candidate below; the module's header says why the
  // rule lives there rather than being written out at each of its two callers.
  const crossingWindow: Vec2 = { x: 0, z: 0 };
  const corridor = chosenCrossingCorridor(
    route.flatPointAt(0, { x: 0, z: 0 }),
    route.tangentAt(0, new Vector3()),
  );
  const crossingConflictAt = (distance: number) =>
    stationCrossingConflict(distance, route.length, corridor, (d) =>
      route.flatPointAt(d, crossingWindow),
    );

  // Scored, not first-fit (issue #241). With the plots unpinned and the loop
  // hugging a spline rim, the stretch nearest a seed bearing can be one
  // where the track plunges RADIALLY between a dip and the rim — and a
  // platform parallel to a radial run walls off its own approach: the spur
  // has to run the fence line for its whole length, and Bluebell Halt's
  // waypoints stranded in the pocket that made. So every candidate along a
  // generous window is scored, and the score prefers exactly what Decision 4
  // asked of stations in the first place:
  //  - a TANGENTIAL stretch (platform across the park's view, approach open),
  //  - an inward dip rather than the far rim (short spur, near the paths),
  //  - open ground on the park side where the spur will actually arrive,
  //  - and, mildly, nearness to the seed's bearing.
  let best = target;
  let bestScore = Infinity;
  for (
    let offset = -STATION_SEARCH_WINDOW;
    offset <= STATION_SEARCH_WINDOW;
    offset += STATION_SEARCH_STEP
  ) {
    const distance = target + offset;
    const { standX, standZ } = stationStand(route, distance);
    route.tangentAt(distance, tangent);
    route.pointAt(distance, centre);

    let blocked = false;
    for (const along of [-2.6, 0, 2.6]) {
      if (!clearOfPlots(standX + tangent.x * along, standZ + tangent.z * along, 1.7)) {
        blocked = true;
        break;
      }
    }
    const radius = Math.hypot(centre.x, centre.z) || 1;
    const radialDot = Math.abs((tangent.x * centre.x + tangent.z * centre.z) / radius);
    const off = Math.hypot(standX - centre.x, standZ - centre.z) || 1;
    const parkX = (standX - centre.x) / off;
    const parkZ = (standZ - centre.z) / off;
    // **The park side has to be open against the RAILWAY too, not only
    // against the plots.** This probe knew about plots and nothing else — the
    // hand-picked obstacle list CLAUDE.md's procgen rule warns about — and the
    // one obstacle it could not see is the loop's own other limb. On seed 451
    // at the park's authored size the loop runs back within 3.95 m of itself,
    // and station 0 was placed with its whole approach inside that pinch: a
    // strip with a lineside fence down both sides and no walkable width
    // between them. Everything downstream then failed in turn — the lead
    // stepped across the far limb, the rail-aware street router correctly
    // refused the leg, and the fallback wove the spur over the rails a dozen
    // times. A station is the movable thing here, so it moves.
    let approachBlocked = false;
    for (const reach of [4, 7]) {
      const probeX = standX + parkX * reach;
      const probeZ = standZ + parkZ * reach;
      if (!clearOfPlots(probeX, probeZ, 2)) {
        approachBlocked = true;
        break;
      }
      if (
        distanceToForeignRail(route, distance, probeX, probeZ) < STATION_LEAD_RAIL_MARGIN
      ) {
        approachBlocked = true;
        break;
      }
    }

    // Not under the Sky Cruiser's station flat or ramps either: the cruiser
    // solves before the train, its low corridor is real geometry, and a
    // platform under a 1-to-5 m coaster rail collides in plain sight
    // (seed 11 built exactly that before this term existed).
    const cruiserLow = nearCruiserLowCorridor(standX, standZ, 8);

    // **Never on the loop's own chosen crossing** (issue #427), in either
    // sense: not within `CROSSING_STATION_CLEARANCE` of it *along the loop*,
    // and not within `CROSSING_STATION_STRUCTURE_CLEARANCE` of the corridor its
    // deck and ramps occupy *in space*. The loop winds, so those are two rules
    // and not one seen twice — a station a hundred metres away around the
    // circuit can still stand a few metres from the crossing.
    //
    // The loop was grown from a pose where a bridge provably fits, and
    // `crossingPlanSolve.ts` refuses to plan a crossing near a station either
    // way, so a station placed here silently destroys the one thing the whole
    // loop was grown to guarantee. Measured before these terms existed, seed 2:
    // a station at d = -2.0 m, on the crossing, and a park with **no bridge at
    // all**. Weighted above every other term put together, because a park with
    // no bridge is invalid (Jim's ruling on #414) while a station a few metres
    // off its ideal spot is merely not ideal — and `crossingKeepOut.ts`'s
    // `crossingSurvivesStationAt` relies on that ordering holding.
    const conflict = crossingConflictAt(distance);

    // **Not on top of a station that is already there** (#472).
    //
    // Every station used to be planned in ignorance of the others — two
    // independent searches, each sliding up to `STATION_SEARCH_WINDOW` along
    // the loop from its own bearing. The two bearings are opposite, so that
    // looks safe and mostly is; on seeds 3 and 23 it was not. Both searches
    // converged on the same stretch and the park was built with **Sunny Side
    // and Bluebell Halt inside each other** — two platforms, two canopies and
    // two benches interpenetrating, 18 m² of deck and 9 m² of roof in one
    // plane. The coplanar sweep is what found it; a child would have seen a
    // single smeared station.
    //
    // CLAUDE.md's standing rule for every generator here: backtrack against
    // the world as it stands, not against the two or three things this
    // generator happens to know by name. So the stations are planned in turn
    // and each one is scored against the stands already chosen.
    //
    // Proportional rather than a step, so a loop that genuinely cannot spread
    // them still returns its least-bad answer instead of a coin toss between
    // two equally-forbidden candidates.
    let crowding = 0;
    for (const other of placed) {
      const gap = Math.hypot(standX - other.x, standZ - other.z);
      crowding = Math.max(crowding, Math.max(0, STATION_SEPARATION - gap) / STATION_SEPARATION);
    }

    const score =
      (conflict.alongLoop ? 5000 : 0) +
      (conflict.inSpace ? 5000 : 0) +
      // Below the crossing terms, and deliberately: a park with no bridge is
      // invalid (Jim's ruling on #414) while two stations closer together than
      // we would like is merely bad. Above `blocked`, because a platform inside
      // another platform is worse than a platform near a booth.
      crowding * 3000 +
      (blocked ? 1000 : 0) +
      (approachBlocked ? 120 : 0) +
      (cruiserLow ? 400 : 0) +
      radialDot * 30 +
      radius * 0.35 +
      Math.abs(offset) * 0.2;
    if (score < bestScore) {
      bestScore = score;
      best = distance;
    }
  }
  return best;
}

let cruiserLowXs: Float64Array | null = null;
let cruiserLowZs: Float64Array | null = null;

/**
 * The Sky Cruiser's low-flying sample points, walked once and kept.
 *
 * {@link clearStationDistance} asks {@link nearCruiserLowCorridor} for every
 * candidate offset of every station — 122 calls a solve — and each call used
 * to re-walk the whole cruiser curve through `pointAt` (an arc-length lookup
 * per sample). The walk depends only on the cruiser's solved route, so it is
 * the same walk every time: same `d` sequence, same height test, same points
 * in the same order. Caching it changes when the points are computed, never
 * which points come back — the queries below compare against an identical
 * list and so return identical booleans.
 */
function cruiserLowPoints(): { readonly xs: Float64Array; readonly zs: Float64Array } {
  if (!cruiserLowXs || !cruiserLowZs) {
    const cruiser = COASTER_PLANS.cruiser.route;
    const probe = new Vector3();
    const xs: number[] = [];
    const zs: number[] = [];
    for (let d = 0; d < cruiser.length; d += 3) {
      cruiser.pointAt(d, probe);
      if (probe.y - terrainHeight(probe.x, probe.z) >= 5.9) continue;
      xs.push(probe.x);
      zs.push(probe.z);
    }
    cruiserLowXs = Float64Array.from(xs);
    cruiserLowZs = Float64Array.from(zs);
  }
  return { xs: cruiserLowXs, zs: cruiserLowZs };
}

/** Is (x, z) within `reach` of anywhere the Sky Cruiser flies low? */
function nearCruiserLowCorridor(x: number, z: number, reach: number): boolean {
  const { xs, zs } = cruiserLowPoints();
  for (let i = 0; i < xs.length; i += 1) {
    if (Math.hypot((xs[i] ?? 0) - x, (zs[i] ?? 0) - z) < reach) return true;
  }
  return false;
}

/**
 * **How far apart two station stands must be before neither is crowding the
 * other**, in metres.
 *
 * Taken from the game rather than chosen: `fence.ts` opens the lineside fence
 * for `STATION_GAP` either side of a station, so two stations closer together
 * than two of those windows plus a platform's own length are sharing one
 * opening — which is the point past which they have stopped being two stations.
 */
const STATION_SEPARATION = PLATFORM_LENGTH + STATION_GAP * 2;

/**
 * How far out from the stand a station's lead stands.
 *
 * An **ideal, not a law** — {@link planStationLead} keeps this reach and
 * turns the *bearing* when the railway is in the way. It used to be a bare
 * `6` added straight onto the stand along the park-ward radial, on the
 * premise stated in `crossingPlan.ts` that "the loop is simple (never
 * self-crossing), so the sign is stable park-wide". That premise died when
 * the park went back to its authored size: on seed 451 the loop runs back
 * within 3.95 m of itself right beside station 0, so the platform's park
 * side is an isthmus narrower than this reach, and a fixed 6 m step off it
 * landed *across the other limb* — 0.76 m from a rail centre line, on the
 * far side of the railway from its own platform. The spur then drew its
 * `lead -> approach` leg straight over the track at railD 133.6, where no
 * bridge site exists, and `crossings.ts` failed the build exactly as it
 * should have ("find the router that drew this leg" — this one).
 *
 * Measured over the whole pool: 18 of 20 stations are clear on the plain
 * park-ward bearing and keep the lead they always had; seed 24's station 0
 * and seed 451's station 0 are the two that turn.
 */
const STATION_LEAD_REACH = 6;

/**
 * How far a lead must stay off any part of the loop that is **not its own
 * station's stretch**.
 *
 * Both terms are read from their owners, never chosen: the lineside fence
 * stands {@link FENCE_OFFSET} from the rail centre line, and the spur that
 * will be paved to this lead is {@link STATION_SPUR_WIDTH} wide, so its
 * outer edge has to stop short of the fence rather than run through it. A
 * station's *own* stretch is excluded because a platform legitimately
 * stands close to its own track — the stand itself is 2.15 m from it — and
 * `fence.ts` opens the fence there ({@link STATION_GAP}) precisely so a
 * child can walk in.
 */
const STATION_LEAD_RAIL_MARGIN = FENCE_OFFSET + STATION_SPUR_WIDTH / 2;

/**
 * How far along the loop from a station's own centre the track stops being
 * "its own platform" and becomes another limb the lead has to keep off.
 * The platform's own half-length plus the fence opening `fence.ts` leaves
 * around it — past that, the fence is up again and the lead is looking at
 * ordinary railway.
 */
const STATION_LEAD_OWN_STRETCH = PLATFORM_LENGTH / 2 + STATION_GAP;

/** Bearings tried for a lead, in degrees off park-ward, swung toward the
 * platform's **empty** (+tangent) half — the same half the approach already
 * uses, so a turned lead still never reaches across the canopy posts and
 * the bench, which stand at negative platform-along by construction. */
const STATION_LEAD_SWING_STEP = 5;
const STATION_LEAD_MAX_SWING = 80;

/**
 * Distance from a point to the loop, ignoring the stretch belonging to the
 * station at `ownDistance` — by segment projection, so the answer is the
 * real distance to the curve rather than to whichever sample happened to be
 * nearest.
 */
function distanceToForeignRail(
  route: TrainRoute,
  ownDistance: number,
  x: number,
  z: number,
): number {
  const count = Math.max(64, Math.ceil(route.length / 2));
  const half = route.length / 2;
  const point = new Vector3();
  let best = Infinity;
  let ax = 0;
  let az = 0;
  let aOwn = false;
  for (let i = 0; i <= count; i += 1) {
    const distance = (i / count) * route.length;
    route.pointAt(distance % route.length, point);
    const bx = point.x;
    const bz = point.z;
    const bOwn =
      Math.abs(((distance - ownDistance + half * 3) % route.length) - half) <=
      STATION_LEAD_OWN_STRETCH;
    if (i > 0 && !aOwn && !bOwn) {
      const dx = bx - ax;
      const dz = bz - az;
      const lengthSquared = dx * dx + dz * dz;
      const t =
        lengthSquared < 1e-12
          ? 0
          : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared));
      const gap = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (gap < best) best = gap;
    }
    ax = bx;
    az = bz;
    aOwn = bOwn;
  }
  return best;
}

/**
 * Where a station's spur should arrive from the park — **backtracking on the
 * railway as it actually stands**, per CLAUDE.md's standing procgen rule.
 *
 * Keeps {@link STATION_LEAD_REACH} and turns the bearing into the platform's
 * empty half until both legs the spur will draw through the lead
 * (`stand -> lead` and `lead -> approach`) clear every foreign limb of the
 * loop by {@link STATION_LEAD_RAIL_MARGIN}. Turning rather than shortening
 * is deliberate: shortening trades the defect for a lead too close to the
 * platform to do its job, and on both affected stations a turn keeps the
 * full reach (seed 24 station 0 at 35 deg, seed 451 station 0 at 50 deg).
 *
 * If no bearing clears — no seed in the pool does this — it returns the
 * roomiest one rather than a known-bad ideal, and `crossings.ts` stays the
 * backstop that refuses to ship a path over the rails.
 */
function planStationLead(
  route: TrainRoute,
  distance: number,
  standX: number,
  standZ: number,
  approachX: number,
  approachZ: number,
  parkX: number,
  parkZ: number,
  tangentX: number,
  tangentZ: number,
): { leadX: number; leadZ: number } {
  /** Worst clearance along the two legs a spur draws through this lead. */
  const clearanceOf = (leadX: number, leadZ: number): number => {
    let worst = Infinity;
    const legs = [
      [standX, standZ, leadX, leadZ],
      [leadX, leadZ, approachX, approachZ],
    ] as const;
    for (const [ax, az, bx, bz] of legs) {
      const steps = Math.max(4, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const gap = distanceToForeignRail(
          route,
          distance,
          ax + (bx - ax) * t,
          az + (bz - az) * t,
        );
        if (gap < worst) worst = gap;
      }
    }
    return worst;
  };

  let bestX = standX + parkX * STATION_LEAD_REACH;
  let bestZ = standZ + parkZ * STATION_LEAD_REACH;
  let bestClearance = -Infinity;
  for (let degrees = 0; degrees <= STATION_LEAD_MAX_SWING; degrees += STATION_LEAD_SWING_STEP) {
    const radians = (degrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const leadX = standX + (parkX * cos + tangentX * sin) * STATION_LEAD_REACH;
    const leadZ = standZ + (parkZ * cos + tangentZ * sin) * STATION_LEAD_REACH;
    const clearance = clearanceOf(leadX, leadZ);
    // The first bearing that clears wins: park-ward is tried first, so a
    // station with room keeps exactly the lead it has always had.
    if (clearance >= STATION_LEAD_RAIL_MARGIN) return { leadX, leadZ };
    if (clearance > bestClearance) {
      bestClearance = clearance;
      bestX = leadX;
      bestZ = leadZ;
    }
  }
  return { leadX: bestX, leadZ: bestZ };
}

function planStations(route: TrainRoute): readonly PlannedStation[] {
  // Sequential, not `map`: each station is scored against the stands already
  // chosen, which is what stops two of them landing in the same place. See the
  // `crowding` term in `clearStationDistance`.
  const placed: Vec2[] = [];
  return STATION_SEEDS.map((seed, index) => {
    const target = route.distanceNear(
      seed.bearingX * STATION_SEED_RADIUS,
      seed.bearingZ * STATION_SEED_RADIUS,
    );
    const distance = clearStationDistance(route, target, placed);
    const { standX, standZ } = stationStand(route, distance);
    placed.push({ x: standX, z: standZ });
    const tangent = route.tangentAt(distance, new Vector3());
    // Away from the track, through the stand — the platform's park side.
    const centre = route.pointAt(distance, new Vector3());
    const off = Math.hypot(standX - centre.x, standZ - centre.z) || 1;
    const parkX = (standX - centre.x) / off;
    const parkZ = (standZ - centre.z) / off;
    const approachX = standX + tangent.x * 3.5;
    const approachZ = standZ + tangent.z * 3.5;
    const { leadX, leadZ } = planStationLead(
      route,
      distance,
      standX,
      standZ,
      approachX,
      approachZ,
      parkX,
      parkZ,
      tangent.x,
      tangent.z,
    );
    return {
      index,
      name: seed.name,
      accent: seed.accent,
      distance,
      standX,
      standZ,
      approachX,
      approachZ,
      // Out into the park from the platform's centre — park-ward where there
      // is room, swung toward the platform's empty end where the railway is
      // in the way (see {@link planStationLead}). Either way the remaining
      // legs run lead -> approach -> stand entirely in the platform's
      // furniture-free (+tangent) half-plane: the lead is at platform-along
      // >= 0 for every bearing tried and the approach at (along 3.5, park
      // 0), so the connecting segment never enters the negative-along half
      // where the canopy posts stand — measured 2.8 m clear of the nearest
      // post, against the graph's 0.7 m requirement. A lead past the
      // platform's far END was tried first and made things worse: a spur
      // arriving from anywhere in the park then had to sweep the whole
      // frontage to get there, 0.3 m from the posts.
      leadX,
      leadZ,
    };
  });
}

/**
 * Distance from (x, z) to the solved rail centre line, by segment projection
 * over a fine sampling of the curve.
 *
 * This is what lets `Scenery` keep its garden walls off the tracks: walls are
 * scattered long before the train is *built*, but the route is *planned* at
 * module load, so the question has an exact answer by then. (An earlier
 * version approximated this with a separate "corridor pre-solve" because the
 * route used to bend around trees at build time; the pure plan made the
 * approximation — and its caveats — unnecessary.)
 */
export function distanceToRailCorridor(x: number, z: number): number {
  ensureCorridorSamples();
  let best = Infinity;
  const xs = corridorX as Float64Array;
  const zs = corridorZ as Float64Array;
  for (let i = 0; i < xs.length; i += 1) {
    const j = (i + 1) % xs.length;
    const ax = xs[i] ?? 0;
    const az = zs[i] ?? 0;
    const bx = xs[j] ?? 0;
    const bz = zs[j] ?? 0;
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSquared = dx * dx + dz * dz;
    const t =
      lengthSquared < 1e-12
        ? 0
        : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared));
    const gap = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (gap < best) best = gap;
  }
  return best;
}

/**
 * How far a scattered structure must keep off {@link distanceToRailCorridor}.
 *
 * Measured, not chosen: the fence stands 2 m off the rails (`train/fence.ts`)
 * and a station platform's canopy reaches 3.7 m from the centre line
 * (`train/station.ts`: `PLATFORM_OFFSET` 2.15 + half of `PLATFORM_WIDTH` 2.6,
 * + 0.25 of roof overhang). Anything at 4.2 m clears the widest of those with
 * room for its own thickness.
 */
export const RAIL_CORRIDOR_CLEARANCE = 4.2;

let corridorX: Float64Array | null = null;
let corridorZ: Float64Array | null = null;

function ensureCorridorSamples(): void {
  if (corridorX) return;
  const route = TRAIN_PLAN.route;
  const count = Math.max(64, Math.ceil(route.length / 2));
  corridorX = new Float64Array(count);
  corridorZ = new Float64Array(count);
  const point = new Vector3();
  for (let i = 0; i < count; i += 1) {
    route.pointAt((i / count) * route.length, point);
    corridorX[i] = point.x;
    corridorZ[i] = point.z;
  }
}

/** The one plan. Import this; never re-solve — same rule as `PARK_LAYOUT`. */
export const TRAIN_PLAN: {
  readonly route: TrainRoute;
  readonly stations: readonly PlannedStation[];
} = (() => {
  const route = new TrainRoute();
  return { route, stations: planStations(route) };
})();
