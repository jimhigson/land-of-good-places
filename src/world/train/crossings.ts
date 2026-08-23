import type { TrainRoute } from './route';
import { pathCentreline } from '../paths';
import { ENTRANCE_GATE_X, ENTRANCE_GATE_Z } from '../entrance/layout';
import { CROSSING_SITES, LEVEL_CROSSING_SITES } from './crossingPlan';
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

/** How close a path sample must be to the rail for a side flip between it
 * and its neighbour to count as a crossing of the rail. */
const TOUCH_DISTANCE = 3.2;

/** Two flips this far apart along the loop belong to different crossings. */
const CLUSTER_GAP = 8;

/** Consecutive centreline samples further apart than this belong to
 * different drawn runs — `pathCentreline()` concatenates every route's own
 * samples (about 0.8 m apart within a run), so a stride bigger than this is
 * the seam between one route and the next, never a walkable step. A side
 * flip is only ever measured *within* one run: two different paths hugging
 * opposite sides of the fence must not read as a crossing between them
 * (measured live, canonical seed 2026-08-23: a phantom crossing at
 * railDistance 214.9 — inside a station's sealed window — minted from a
 * station spur inside the fence and a stall spur outside it, interleaved by
 * the old sort-all-touches clustering). */
const RUN_BREAK = 3;

/** How far (along the loop) a measured crossing may sit from a planned site
 * and still be recognised as that site — the drawn leg was routed *through*
 * the site by `paths.ts`, so a miss beyond a few metres is a different
 * crossing (the gate walk's own fixed corridor, mostly), not the site. */
const SITE_SNAP_TOLERANCE = 8;

export function computeCrossings(
  route: TrainRoute,
  stationDistances: readonly number[] = [],
): LevelCrossing[] {
  void stationDistances; // crossings are planned station-clear (crossingPlan.ts); kept for callers
  const point = new Vector3();
  const tangent = new Vector3();

  /**
   * Flip events: a single drawn run's consecutive samples landing on
   * opposite sides of the centre line while at least one of them is within
   * {@link TOUCH_DISTANCE} of it. This — not the cloud of "touches" the old
   * clustering collected — is what a crossing *is*: in the strips between
   * rail and boundary a path legitimately runs beside the fence for tens of
   * metres, and measuring from raw touch spans smeared one crossing's
   * halfGap to the 14 m cap and let it swallow the gate walk's own separate
   * crossing 20 m away.
   */
  const flips: number[] = [];
  let previous: { x: number; z: number; railDistance: number; side: number; perp: number } | null =
    null;

  const consider = (x: number, z: number) => {
    const railDistance = route.distanceNear(x, z);
    route.pointAt(railDistance, point);
    route.tangentAt(railDistance, tangent);
    const perp = Math.hypot(point.x - x, point.z - z);
    const side = Math.sign(tangent.z * (x - point.x) - tangent.x * (z - point.z)) || 1;
    const current = { x, z, railDistance, side, perp };
    if (previous) {
      const stride = Math.hypot(x - previous.x, z - previous.z);
      if (
        stride < RUN_BREAK &&
        side !== previous.side &&
        Math.min(perp, previous.perp) <= TOUCH_DISTANCE
      ) {
        const half = route.length / 2;
        const delta = route.wrap(railDistance - previous.railDistance + half) - half;
        flips.push(route.wrap(previous.railDistance + delta / 2));
      }
    }
    previous = current;
  };

  for (const sample of pathCentreline()) consider(sample.x, sample.z);

  // The gate walk: from the gate to well inside, sampled every metre. Its
  // first sample stands far from the last path sample, so the RUN_BREAK
  // stride guard keeps the seam between them from ever reading as a flip.
  const inX = -ENTRANCE_GATE_X / Math.hypot(ENTRANCE_GATE_X, ENTRANCE_GATE_Z);
  const inZ = -ENTRANCE_GATE_Z / Math.hypot(ENTRANCE_GATE_X, ENTRANCE_GATE_Z);
  // Sample the walk deep enough to meet the track however far in this
  // seed's loop dips — 14 m missed the crossing entirely on seeds whose
  // gate-side dip sat low, sealing the gate outside the fence.
  for (let step = 0; step <= 32; step += 1) {
    consider(ENTRANCE_GATE_X + inX * step, ENTRANCE_GATE_Z + inZ * step);
  }

  flips.sort((a, b) => a - b);
  const crossings: LevelCrossing[] = [];
  let group: number[] = [];
  const emit = () => {
    if (!group.length) return;
    const first = group[0] as number;
    const last = group[group.length - 1] as number;
    const midDistance = (first + last) / 2;
    const spread = last - first;
    const halfGap = Math.min(14, Math.max(4.5, spread / 2 + 3.5));
    // **Snap to the planned crossing site, whose frame is the one owner of
    // "where and at what angle does the park cross here"** (crossingPlan.ts
    // proved a bridge fits in exactly that frame, against the boundary, the
    // plots and the rail's own curvature). The measured midpoint jitters a
    // metre or two off the site — flips average over curve wobble — and the
    // re-derived perpendicular jitters with it; the bridge search's
    // rail-corridor test sits right at its margin on curved stretches, so
    // that jitter alone flipped provably-feasible sites into level-crossing
    // fallbacks (canonical seed, 2026-08-23: sites 172/228 both lost to it).
    for (const site of [...CROSSING_SITES, ...LEVEL_CROSSING_SITES]) {
      const along = Math.abs(
        route.wrap(midDistance - site.railDistance + route.length / 2) - route.length / 2,
      );
      if (along <= SITE_SNAP_TOLERANCE) {
        crossings.push({
          x: site.x,
          z: site.z,
          railDistance: site.railDistance,
          pathDirX: site.dirX,
          pathDirZ: site.dirZ,
          // Capped at the width the site was actually proven feasible at —
          // `halfGap` is also the bridge search's deck-width FLOOR, so a
          // floor above the proven width would doom a narrow site's search
          // before it started. A path snapped to a site arrives square, so
          // the wide-gap-for-oblique-paths reasoning behind the ordinary
          // 4.5 floor does not apply here.
          halfGap: Math.min(halfGap, Math.max(3.0, site.halfWidth - 0.5)),
        });
        group = [];
        return;
      }
    }
    const mid = route.pointAt(midDistance, new Vector3());
    const midTangent = route.tangentAt(midDistance, new Vector3());
    crossings.push({
      x: mid.x,
      z: mid.z,
      railDistance: midDistance,
      pathDirX: midTangent.z,
      pathDirZ: -midTangent.x,
      halfGap,
    });
    group = [];
  };
  for (const flip of flips) {
    const last = group[group.length - 1];
    if (last !== undefined && flip - last > CLUSTER_GAP) emit();
    group.push(flip);
  }
  emit();
  // The loop wraps: a crossing straddling distance 0 would appear twice.
  if (crossings.length > 1) {
    const first = crossings[0] as LevelCrossing;
    const last = crossings[crossings.length - 1] as LevelCrossing;
    if (first.railDistance + (route.length - last.railDistance) < CLUSTER_GAP) crossings.pop();
  }
  return crossings;
}
