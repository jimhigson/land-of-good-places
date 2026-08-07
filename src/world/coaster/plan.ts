import { Vector3 } from 'three';
import { CoasterRoute, type CoasterRouteOptions } from './route';
import { placedEntry } from '../parkLayout';
import { clearOfPlots } from '../parkLayout';

/**
 * The coaster plan — the Sky Cruiser as *data*, solved at module load
 * from the park layout alone, mirroring `train/plan.ts` exactly (see that
 * file's header for why this inversion matters).
 *
 * `CoasterRoute` already depended on nothing but the layout, so this is a
 * move rather than a redesign: `Coaster` used to call `new CoasterRoute(...)`
 * itself, in its own constructor, which meant nothing upstream of the ride —
 * least of all the path graph — could know where a coaster's station (and so
 * its exit) actually was. Now both loops are solved here, before any scene
 * object exists, and `paths.ts` gives each one's exit a node in the same walk
 * network a station gets.
 *
 * `CoasterRouteOptions.avoid` still exists for a second loop that ever wants to
 * grow here; nothing uses it now that the Rail Race is a perimeter ring.
 */

export interface PlannedCoaster {
  readonly name: string;
  readonly route: CoasterRoute;
  readonly stationStallId: string;
  /** Where a rider is put down after the ride (GAME_DESIGN.md's EXIT rule). */
  readonly exitX: number;
  readonly exitZ: number;
}

interface CoasterSeed {
  readonly name: string;
  readonly routeSalt: number;
  readonly stationStallId: string;
  /** How far out this loop may reach. Defaults to the route's own limit. */
  readonly outerRadius?: number;
  /** Metres of track wanted. Defaults to the route's own target. */
  readonly desiredLength?: number;
}

const CRUISER_SEED: CoasterSeed = {
  name: 'skyCruiser',
  routeSalt: 0xc0a57e,
  stationStallId: 'stall.skyCruiser',
};

/**
 * The exit point: beside the station, on the far side from the booth, clear
 * of every plot blocker — the `clearOfPlots`/slide pattern `train/plan.ts`
 * uses for a station's platform, adapted from a distance-along-the-loop
 * search to a 2D one, because an exit is a point beside the track rather than
 * a point on it.
 *
 * Starts a few metres past the station's platform deck (it is 6 m long) so
 * the exit never lands *on* the platform, then slides further along the same
 * line — straight out from the booth, through the station — until the ground
 * there is genuinely clear.
 */
function planExit(route: CoasterRoute, stationStallId: string): { exitX: number; exitZ: number } {
  const stall = placedEntry(stationStallId);
  const station = route.pointAt(route.stationDistance, new Vector3());
  const dx = station.x - stall.x;
  const dz = station.z - stall.z;
  const length = Math.hypot(dx, dz) || 1;
  const nx = dx / length;
  const nz = dz / length;
  for (let distance = 5; distance <= 24; distance += 1) {
    const x = station.x + nx * distance;
    const z = station.z + nz * distance;
    // 2.6, from 1.4 — same reasoning as railRace/plan.ts's exit margin.
    if (clearOfPlots(x, z, 2.6)) return { exitX: x, exitZ: z };
  }
  // Never found clear ground out to 24 m — hand back the nearest try rather
  // than nothing; `dismount.ts`'s runtime safety net is the last resort for
  // exactly this case, and the procgen invariant is the loud way to hear
  // about it before a child does.
  return { exitX: station.x + nx * 5, exitZ: station.z + nz * 5 };
}

function planCoaster(seed: CoasterSeed, avoid: CoasterRoute | null): PlannedCoaster {
  const options: CoasterRouteOptions = {
    salt: seed.routeSalt,
    stationStallId: seed.stationStallId,
    avoid,
    ...(seed.outerRadius !== undefined ? { outerRadius: seed.outerRadius } : {}),
    ...(seed.desiredLength !== undefined ? { desiredLength: seed.desiredLength } : {}),
  };
  const route = new CoasterRoute(options);
  const { exitX, exitZ } = planExit(route, seed.stationStallId);
  return { name: seed.name, route, stationStallId: seed.stationStallId, exitX, exitZ };
}

/**
 * The coaster plans. Import this; never re-solve — same rule as `TRAIN_PLAN`.
 *
 * There is only one now. The Rail Race used to be a second solved loop here,
 * steering clear of the cruiser; the reform of 31 July 2026 moved it out to the
 * park's perimeter, where it needs no solver at all — it is a circle. Its plan
 * lives in `railRace/plan.ts` and satisfies the same shape `paths.ts` wants,
 * which is why the walk network still gives its exit a node alongside this one.
 */
export const COASTER_PLANS: {
  readonly cruiser: PlannedCoaster;
} = { cruiser: planCoaster(CRUISER_SEED, null) };
