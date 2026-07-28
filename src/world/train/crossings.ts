import type { TrainRoute } from './route';
import { pathCentreline } from '../paths';
import { ENTRANCE_GATE_X, ENTRANCE_GATE_Z } from '../entrance/layout';
import { Vector3 } from 'three';

/**
 * Where feet legitimately cross the railway.
 *
 * Now the loop dives through the park (Decision 4), the paths and the track
 * genuinely meet. Each meeting becomes a **level crossing**: a gap in the
 * exclusion fence, a timber deck between the rails, and — for the checker —
 * a declared place where a route crossing the rail is correct rather than a
 * bug. Computed at boot from the solved curve and the drawn path
 * centreline, so a crossing can never drift off either.
 *
 * The walk in from the park gate is included by hand: the esplanade is not
 * a drawn route yet (`Entrance.ts` predates the generated park), but a
 * child walks it from her first second in the park, and fencing the loop
 * without a gap there would fence the whole park shut.
 */
export interface LevelCrossing {
  /** Centre of the crossing, on the track centre line. */
  readonly x: number;
  readonly z: number;
  /** Metres along the loop. */
  readonly railDistance: number;
  /** Unit direction of the path as it crosses. */
  readonly pathDirX: number;
  readonly pathDirZ: number;
  /**
   * Half-length of the fence gap this crossing needs, along the loop. Self-
   * measured from the touch cluster's own spread: an oblique path occupies
   * more corridor than a perpendicular one, and a fixed gap strands the
   * path's own waypoint samples between the compartment walls.
   */
  readonly halfGap: number;
}

/** How close a path sample must come to the rail to count as touching it. */
const TOUCH_DISTANCE = 3.2;

/** Two touches this far apart along the loop belong to different crossings. */
const CLUSTER_GAP = 8;

export function computeCrossings(route: TrainRoute): LevelCrossing[] {
  const point = new Vector3();
  const touches: { railDistance: number; x: number; z: number }[] = [];

  const consider = (x: number, z: number) => {
    const railDistance = route.distanceNear(x, z);
    route.pointAt(railDistance, point);
    if (Math.hypot(point.x - x, point.z - z) <= TOUCH_DISTANCE) {
      touches.push({ railDistance, x: point.x, z: point.z });
    }
  };

  for (const sample of pathCentreline()) consider(sample.x, sample.z);

  // The gate walk: from the gate to well inside, sampled every metre.
  const inX = -ENTRANCE_GATE_X / Math.hypot(ENTRANCE_GATE_X, ENTRANCE_GATE_Z);
  const inZ = -ENTRANCE_GATE_Z / Math.hypot(ENTRANCE_GATE_X, ENTRANCE_GATE_Z);
  // Sample the walk deep enough to meet the track however far in this
  // seed's loop dips — 14 m missed the crossing entirely on seeds whose
  // gate-side dip sat low, sealing the gate outside the fence.
  for (let step = 0; step <= 32; step += 1) {
    consider(ENTRANCE_GATE_X + inX * step, ENTRANCE_GATE_Z + inZ * step);
  }

  touches.sort((a, b) => a.railDistance - b.railDistance);
  const crossings: LevelCrossing[] = [];
  let cluster: typeof touches = [];
  const flush = () => {
    if (!cluster.length) return;
    const mid = cluster[Math.floor(cluster.length / 2)] as (typeof touches)[number];
    const first = cluster[0] as (typeof touches)[number];
    const last = cluster[cluster.length - 1] as (typeof touches)[number];
    const spread = last.railDistance - first.railDistance;
    const tangent = route.tangentAt(mid.railDistance, new Vector3());
    crossings.push({
      x: mid.x,
      z: mid.z,
      railDistance: mid.railDistance,
      pathDirX: tangent.z,
      pathDirZ: -tangent.x,
      halfGap: Math.min(14, Math.max(4.5, spread / 2 + 3.5)),
    });
    cluster = [];
  };
  for (const touch of touches) {
    const last = cluster[cluster.length - 1];
    if (last && touch.railDistance - last.railDistance > CLUSTER_GAP) flush();
    cluster.push(touch);
  }
  flush();
  // The loop wraps: a cluster straddling distance 0 would appear twice.
  if (crossings.length > 1) {
    const first = crossings[0] as LevelCrossing;
    const last = crossings[crossings.length - 1] as LevelCrossing;
    if (first.railDistance + (route.length - last.railDistance) < CLUSTER_GAP) crossings.pop();
  }
  return crossings;
}
