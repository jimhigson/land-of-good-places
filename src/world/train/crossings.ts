import type { TrainRoute } from './route';
import { pathCentreline } from '../pathGraph';
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
  /**
   * Half the paved width of the actual drawn path that crosses here — read
   * off the path's own centreline samples (`paths.ts`'s `PathSample.
   * halfWidth`, the same number `addRibbon` paves with), never re-chosen.
   * Jim's bridge feedback (2026-08-23): *"the bridge deck should be exactly
   * the same width as the path that crosses it"* — this is the one owner of
   * that width, so the bridge asks the path rather than sizing itself off
   * `halfGap` (a fence-gap figure measured along the *rail*, which is why
   * decks used to come out 12.9–15.8 m wide over a ~4 m path).
   */
  readonly pathHalfWidth: number;
  /**
   * The drawn path's own centreline through this crossing, ordered along
   * {@link pathDirX}/{@link pathDirZ}, arc-length-trimmed to a bridge's
   * plausible reach either side — so a bridge can follow the path's own
   * gentle curve instead of forcing a rigid straight line through it
   * (Jim's bridge feedback, 2026-08-23). Empty when no drawn run passes
   * through the crossing (the hand-sampled gate walk): the bridge then
   * falls back to the straight line the old geometry always assumed.
   */
  readonly spine: readonly SpinePoint[];
}

/** One point of a crossing's {@link LevelCrossing.spine}. */
export interface SpinePoint {
  readonly x: number;
  readonly z: number;
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
export const SITE_SNAP_TOLERANCE = 8;

/**
 * A crossing whose nearest drawn-path sample is further away than this has
 * no drawn run through it at all (the gate walk's hand-sampled corridor,
 * mostly) — it gets the straight-line fallback spine and the default width
 * below instead of another run's numbers. Comfortably bigger than the
 * sample pitch (~0.8 m) and much smaller than the gap to any *other* path.
 */
const SPINE_ADOPT_DISTANCE = 3.0;

/**
 * Paved half-width assumed for a crossing with no drawn run through it —
 * the gate walk. Matches the widest ordinary spur (`paths.ts` routes at
 * 2.6–3.2 m wide), because the walk in from the gate is the park's own
 * front door and should not read narrower than a stall spur.
 */
const GATE_WALK_HALF_WIDTH = 1.6;

/** How far along the path, either side of the rail, a crossing's spine is
 * worth recording — past any bridge's own deck-plus-ramp reach. */
const SPINE_REACH = 32;

/**
 * Extract the run of drawn-path centreline samples passing through
 * `(x, z)`, oriented along `(dirX, dirZ)` and trimmed to
 * {@link SPINE_REACH} of arc either side. Empty when no run passes close
 * enough ({@link SPINE_ADOPT_DISTANCE}).
 */
function spineThrough(
  samples: readonly { x: number; z: number; halfWidth: number; run: number }[],
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
): { spine: SpinePoint[]; halfWidth: number | null } {
  let bestIndex = -1;
  let bestDistance = SPINE_ADOPT_DISTANCE;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i] as { x: number; z: number };
    const d = Math.hypot(sample.x - x, sample.z - z);
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }
  if (bestIndex === -1) return { spine: [], halfWidth: null };

  // Walk outward within the run — the same stride rule `consider` uses to
  // keep two different paths hugging opposite fence sides from reading as
  // one (`RUN_BREAK`), PLUS a direction-continuity guard: `pathCentreline`
  // concatenates every route's own samples, and two routes meeting at a
  // shared graph node are spatially contiguous (the seam stride is tiny,
  // so `RUN_BREAK` alone never fires) while the next route can head
  // straight back the way the first came. Without the guard the walk
  // folded back on itself at exactly such a seam and produced a spine that
  // doubled over the crossing (found live, canonical seed, first run of
  // this extraction: every frame sample beyond the fold sat back on the
  // rail corridor and the whole bridge search read as blocked). A genuine
  // fold is a ~180° turn between consecutive ~0.8 m samples; a real
  // grid-aligned elbow, smoothed by the Catmull-Rom draw, turns a few tens
  // of degrees per sample at most — so "next stride must not point against
  // the previous one" (dot > 0) separates the two cleanly.
  const run = (samples[bestIndex] as { run: number }).run;
  const walk = (step: 1 | -1): SpinePoint[] => {
    const out: SpinePoint[] = [];
    let travelled = 0;
    let previous = samples[bestIndex] as { x: number; z: number };
    let previousStrideX = 0;
    let previousStrideZ = 0;
    for (let i = bestIndex + step; i >= 0 && i < samples.length; i += step) {
      const sample = samples[i] as { x: number; z: number; run: number };
      // Never cross a route boundary — the samples either side of a seam
      // belong to a DIFFERENT drawn path, however spatially contiguous the
      // shared graph node makes them (the run id is the authority; the
      // stride/direction guards below are only a belt for within-run
      // anomalies). Found live, seed 2: the walk crossed a seam onto an
      // adjacent route and hair-pinned the spine mid-ramp.
      if (sample.run !== run) break;
      const strideX = sample.x - previous.x;
      const strideZ = sample.z - previous.z;
      const stride = Math.hypot(strideX, strideZ);
      if (stride < 0.01) continue; // duplicate point at a route seam
      if (stride > RUN_BREAK) break;
      if (previousStrideX !== 0 || previousStrideZ !== 0) {
        if (strideX * previousStrideX + strideZ * previousStrideZ <= 0) break;
      }
      travelled += stride;
      if (travelled > SPINE_REACH) break;
      out.push({ x: sample.x, z: sample.z });
      previous = sample;
      previousStrideX = strideX;
      previousStrideZ = strideZ;
    }
    return out;
  };
  const backward = walk(-1);
  const forward = walk(1);
  const centre = samples[bestIndex] as { x: number; z: number };
  const spine: SpinePoint[] = [...backward.reverse(), { x: centre.x, z: centre.z }, ...forward];
  if (spine.length < 2) return { spine: [], halfWidth: null };

  // Orient the spine along the crossing's own path direction, so `along`
  // grows the same way for every consumer. Judged from the LOCAL tangent
  // at the crossing, not the global endpoints — a long spine can curve far
  // enough that its endpoints' chord disagrees with the direction the path
  // actually crosses the rail at.
  const centreIndex = backward.length;
  const tangentFrom = spine[Math.max(0, centreIndex - 2)] as SpinePoint;
  const tangentTo = spine[Math.min(spine.length - 1, centreIndex + 2)] as SpinePoint;
  if ((tangentTo.x - tangentFrom.x) * dirX + (tangentTo.z - tangentFrom.z) * dirZ < 0) {
    spine.reverse();
  }
  const halfWidth = (samples[bestIndex] as { halfWidth: number }).halfWidth;
  return { spine, halfWidth };
}

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

  // **The esplanade: the arch to wherever the drawn network takes over.**
  // Its first sample stands far from the last path sample, so the RUN_BREAK
  // stride guard keeps the seam between them from ever reading as a flip.
  //
  // This used to march a flat 32 m straight in from the arch on the radial,
  // regardless of what was drawn there, and that is what put a level crossing
  // at the park's own front door and kept it there. `paths.ts`'s gate
  // corridor now stops short of the railway and hands the walk to the street
  // lattice, which crosses only at a planned site (issue #339) — but a hand-
  // sampled straight line ploughing on to `z = 28` still flipped sides at the
  // track, so `computeCrossings` minted the crossing anyway: a fence gap and a
  // timber deck at a place no path goes any more. Measured on the canonical
  // seed with the reroute in and this still at 32 m: three crossings, the
  // front-door one at railDistance 148.5 with nothing walking over it.
  //
  // The honest span is the bit of the walk that really is un-drawn: from the
  // arch to the first point where the drawn network is under her feet. Beyond
  // that the drawn route is the walk, and `pathCentreline()` above has already
  // measured it. The march still runs its full 32 m when nothing drawn comes
  // near — a seed whose network stops short of the gate is exactly the case
  // the old 32 m was raised to 32 m for.
  const inX = -ENTRANCE_GATE_X / Math.hypot(ENTRANCE_GATE_X, ENTRANCE_GATE_Z);
  const inZ = -ENTRANCE_GATE_Z / Math.hypot(ENTRANCE_GATE_X, ENTRANCE_GATE_Z);
  const drawn = pathCentreline();
  const onDrawnPath = (x: number, z: number): boolean => {
    for (const sample of drawn) {
      if (Math.hypot(sample.x - x, sample.z - z) <= sample.halfWidth + 0.4) return true;
    }
    return false;
  };
  //
  // **The march overlaps the drawn ribbon rather than stopping dead at it.**
  // A side flip is only ever measured between two *consecutive* samples, and
  // the drawn ribbon's samples are a different run — so a loop crossing in the
  // seam between the last esplanade sample and the ribbon's own first point
  // would be invisible to both, and the fence would seal with no gap where a
  // child walks. Found on seed 11 before the railway was told to keep off the
  // walk in (`train/route.ts`): the loop cut `x = 0` at `z = 54.3`, six metres
  // in from the arch, in exactly that seam.
  const ESPLANADE_OVERLAP = 4;
  let sinceDrawn = -1;
  for (let step = 0; step <= 32; step += 1) {
    const x = ENTRANCE_GATE_X + inX * step;
    const z = ENTRANCE_GATE_Z + inZ * step;
    if (sinceDrawn >= 0) sinceDrawn += 1;
    else if (step > 0 && onDrawnPath(x, z)) sinceDrawn = 0;
    if (sinceDrawn > ESPLANADE_OVERLAP) break;
    consider(x, z);
  }

  flips.sort((a, b) => a - b);
  type BareCrossing = Omit<LevelCrossing, 'pathHalfWidth' | 'spine'>;
  const crossings: BareCrossing[] = [];
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
    const first = crossings[0] as BareCrossing;
    const last = crossings[crossings.length - 1] as BareCrossing;
    if (first.railDistance + (route.length - last.railDistance) < CLUSTER_GAP) crossings.pop();
  }

  // Enrich each crossing with the drawn path's own width and centreline
  // through it — see the two fields' own doc comments. Read once, here,
  // rather than per-bridge later, so every consumer (the footprint search,
  // the built geometry, the invariants) shares the identical spine.
  const centreline = pathCentreline();
  return crossings.map((crossing): LevelCrossing => {
    const found = spineThrough(centreline, crossing.x, crossing.z, crossing.pathDirX, crossing.pathDirZ);
    return {
      ...crossing,
      pathHalfWidth: found.halfWidth ?? GATE_WALK_HALF_WIDTH,
      spine: found.spine,
    };
  });
}
