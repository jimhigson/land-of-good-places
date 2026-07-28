import { Vector3 } from 'three';
import { TrainRoute } from './route';
import { PARK_LAYOUT } from '../parkLayout';
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
  readonly subtitle: string;
  readonly glyph: string;
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
}

const STATION_SEEDS = [
  {
    name: 'Sunny Side',
    subtitle: 'all aboard for the whole park!',
    glyph: '🚂',
    accent: PALETTE.markerLemon,
    bearingX: 1,
    bearingZ: 0,
  },
  {
    name: 'Bluebell Halt',
    subtitle: 'mind the gap, and the bunnies',
    glyph: '🚉',
    accent: PALETTE.markerSky,
    bearingX: -1,
    bearingZ: 0,
  },
] as const;

/** Clear of every plot's bounding circle by `radius` — the pure counterpart
 * of the old `collision.isClearCircle`. Trees no longer count: they are
 * seeded *after* this plan now, and keep off the railway rather than the
 * railway bending round them. */
function clearOfPlots(x: number, z: number, radius: number): boolean {
  for (const entry of PARK_LAYOUT.entries.values()) {
    if (Math.hypot(x - entry.x, z - entry.z) < entry.boundingRadius + radius) return false;
  }
  return true;
}

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
  for (let step = 0; step <= 48; step += 1) {
    const offset = (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2);
    const distance = target + offset;
    const { standX, standZ } = stationStand(route, distance);
    route.tangentAt(distance, tangent);
    let clear = true;
    for (const along of [-2.6, 0, 2.6]) {
      if (!clearOfPlots(standX + tangent.x * along, standZ + tangent.z * along, 1.7)) {
        clear = false;
        break;
      }
    }
    if (clear) return distance;
  }
  return target;
}

function planStations(route: TrainRoute): readonly PlannedStation[] {
  return STATION_SEEDS.map((seed, index) => {
    const target = route.distanceNear(seed.bearingX * 60, seed.bearingZ * 60);
    const distance = clearStationDistance(route, target);
    const { standX, standZ } = stationStand(route, distance);
    const tangent = route.tangentAt(distance, new Vector3());
    return {
      index,
      name: seed.name,
      subtitle: seed.subtitle,
      glyph: seed.glyph,
      accent: seed.accent,
      distance,
      standX,
      standZ,
      approachX: standX + tangent.x * 3.5,
      approachZ: standZ + tangent.z * 3.5,
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
