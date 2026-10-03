import { Vector3 } from 'three';
import { registerPlanCache } from '../../boot/planCaches';
import type { TrainRoute } from './route';
import { planPart } from '../parkPlan';

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
/**
 * Metres along the loop of the rail point nearest `(x, z)` — the same 2 m
 * corridor samples {@link distanceToRailCorridor} measures against, so the
 * two agree about which point is nearest.
 */
export function nearestRailDistanceAlong(x: number, z: number): number {
  ensureCorridorSamples();
  const xs = corridorX as Float64Array;
  const zs = corridorZ as Float64Array;
  const route = TRAIN_PLAN.route;
  let best = Infinity;
  let along = 0;
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
    if (gap < best) {
      best = gap;
      along = ((i + t) / xs.length) * route.length;
    }
  }
  return along;
}

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
} = {
  /** A view: the park's driver decides the loop (and may re-decide it); the stations follow. */
  get route(): TrainRoute {
    return planPart('train').route;
  },
  get stations(): readonly PlannedStation[] {
    return planPart('train').stations;
  },
};

// Derived from a decision the park's driver may unwind: forgotten with it.
registerPlanCache(() => {
  corridorX = null;
  corridorZ = null;
});
