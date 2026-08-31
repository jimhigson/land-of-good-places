import { Vector3 } from 'three';
import { TrainRoute } from './route';
import { COASTER_PLANS } from '../coaster/plan';
import { terrainHeight } from '../terrain';
import { PALETTE } from '../../core/palette';

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

const STATION_SEEDS = [
  {
    name: 'Sunny Side',
    accent: PALETTE.markerLemon,
    bearingX: 1,
    bearingZ: 0,
  },
  {
    name: 'Bluebell Halt',
    accent: PALETTE.markerSky,
    bearingX: -1,
    bearingZ: 0,
  },
] as const;

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
function clearStationDistance(route: TrainRoute, target: number): number {
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
    let approachBlocked = false;
    for (const reach of [4, 7]) {
      if (!clearOfPlots(standX + parkX * reach, standZ + parkZ * reach, 2)) {
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

    const score =
      (conflict.alongLoop ? 5000 : 0) +
      (conflict.inSpace ? 5000 : 0) +
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

function planStations(route: TrainRoute): readonly PlannedStation[] {
  return STATION_SEEDS.map((seed, index) => {
    const target = route.distanceNear(seed.bearingX * 60, seed.bearingZ * 60);
    const distance = clearStationDistance(route, target);
    const { standX, standZ } = stationStand(route, distance);
    const tangent = route.tangentAt(distance, new Vector3());
    // Away from the track, through the stand — the platform's park side.
    const centre = route.pointAt(distance, new Vector3());
    const off = Math.hypot(standX - centre.x, standZ - centre.z) || 1;
    const parkX = (standX - centre.x) / off;
    const parkZ = (standZ - centre.z) / off;
    return {
      index,
      name: seed.name,
      accent: seed.accent,
      distance,
      standX,
      standZ,
      approachX: standX + tangent.x * 3.5,
      approachZ: standZ + tangent.z * 3.5,
      // Straight out into the park from the platform's centre. From here the
      // remaining legs run lead -> approach -> stand entirely in the
      // platform's furniture-free (+tangent) half-plane: in platform
      // coordinates the lead is (along 0, park 6) and the approach
      // (along 3.5, park 0), so the connecting segment never enters the
      // negative-along half where the canopy posts stand — measured 2.8 m
      // clear of the nearest post, against the graph's 0.7 m requirement. A
      // lead past the platform's far END was tried first and made things
      // worse: a spur arriving from anywhere in the park then had to sweep
      // the whole frontage to get there, 0.3 m from the posts.
      leadX: standX + parkX * 6,
      leadZ: standZ + parkZ * 6,
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
