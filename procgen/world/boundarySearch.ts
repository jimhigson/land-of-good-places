import { TAU } from '../../src/core/mathUtils';
import { PARK_BOUNDARY, PROFILE_SAMPLES, TERRAIN_APRON, edgeRadiusAt, profileBoundary, type ParkBoundary } from '../../src/world/boundary';
/**
 * **The inset boundaries the solvers plan against.** Moved verbatim from
 * `src/world/boundary.ts`. Build-time only.
 */

/**
 * The same park, `inset` metres smaller all the way round.
 *
 * For the rides that solve *inside* the park — the ginormous slide and the
 * Sky Cruiser hand their route search a territory, and until issue #241 that
 * territory was a hand-sized circle (`GARDEN_PLAY_RADIUS`, `OUTER_RADIUS`)
 * which quietly stopped meaning "the park" when the park became a spline:
 * plots now spread to the real edge, and a ride whose start pose sits beyond
 * its own territory circle rejects every candidate piece as out of bounds
 * and cannot solve at all.
 *
 * Built by walking each bearing in from the true edge until the signed
 * distance field reads `inset`, then wrapping those radii in
 * {@link profileBoundary} — so the result is a full, honest `ParkBoundary`
 * (area, perimeter, outline and all), not a wrapper that lies about
 * everything but distance. The inset curve of a gentle star-shaped curve is
 * still star-shaped while `inset` stays far below
 * {@link GENTLE_CURVATURE_RADIUS}, which every caller's few metres does.
 */
export function insetBoundary(boundary: ParkBoundary, inset: number): ParkBoundary {
  const search = insetBoundarySearch(boundary, inset);
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
  }
}


/**
 * Bearings resolved between yields in {@link insetBoundarySearch}.
 *
 * 8 of the 512 — 1/64th of the job, ~0.4 ms on an M4 Pro. Deliberately a
 * fraction of the whole rather than a millisecond count: how long 8 bearings
 * take is a property of the machine, but "the driver can stop 64 times on the
 * way through" is a property of this code and true on every device.
 */
const INSET_BEARINGS_PER_SLICE = 8;


/**
 * {@link insetBoundary}, a handful of bearings at a time.
 *
 * **Why this one is sliced and the rest of the file is not.** It is 512
 * bearings times a 24-step binary search, and every probe calls
 * `distanceToEdge`, which itself scans 512 vertices — about 12,000 of them, for
 * **~25 ms measured, cold and warm alike**. That made it the single largest
 * uninterruptible block in the Sky Cruiser's brief, which `boot/parkGeneration.ts`
 * builds inside one frame of the cat-bus ride. It passed on a fast laptop and
 * failed in CI, which is the signature of a unit of work that is too big rather
 * than a budget that is too small.
 *
 * The straight-through {@link insetBoundary} above is a thin driver over this,
 * so there is one algorithm and two cadences — the same relationship
 * `solveRailRoute` has with `railRouteSearch`. Suspending cannot move the
 * result: every piece of state is a local, and there is no randomness here at
 * all.
 */
export function* insetBoundarySearch(
  boundary: ParkBoundary,
  inset: number,
): Generator<number, ParkBoundary, void> {
  const radii: number[] = [];
  for (let i = 0; i < PROFILE_SAMPLES; i += 1) {
    if (i > 0 && i % INSET_BEARINGS_PER_SLICE === 0) yield i;
    const angle = (i / PROFILE_SAMPLES) * TAU;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    let low = 0;
    let high = edgeRadiusAt(boundary, angle);
    // The signed distance shrinks towards the edge along the ray, so binary
    // search finds where it crosses `inset` to well under geometry noise.
    for (let step = 0; step < 24; step += 1) {
      const mid = (low + high) / 2;
      if (boundary.distanceToEdge(dirX * mid, dirZ * mid) >= inset) low = mid;
      else high = mid;
    }
    radii.push(low);
  }
  return profileBoundary(radii);
}


/**
 * A fast read-only view of a star-shaped boundary, for the ride solvers.
 *
 * `profileBoundary`'s `distanceToEdge` is **exact** — including at the
 * eccentric near-tie its comment documents — and since 18 September 2026 it is
 * no longer a 512-vertex scan either: a per-cell candidate list narrows it to a
 * handful of squared distances without changing an answer. (This paragraph used
 * to say it "scans all 512 vertices per query", which stopped being true in the
 * same commit that added the list; it is corrected here rather than left to
 * decay, which is the fault that change was itself cleaning up.)
 *
 * So the reason to prefer this view is no longer the scan. It is that a route
 * search asks per CANDIDATE PIECE — measured at 776k pieces on one seed, and at
 * 36 million on seed 7's railway — and this answers in O(1) from two lookup
 * tables: the radius per bearing, and the cosine of the angle between the
 * radial and the edge NORMAL per bearing (the obliquity), so
 * `distance ≈ (radiusAt(θ) − |p|) · cosAt(θ)` — exact on a circle, and on
 * these deliberately gentle curves (curvature radius ≥ 20 m by construction)
 * within a few percent, erring by UNDER-stating distance wherever the edge
 * runs oblique, which for a solver holding a corridor INSIDE the park is the
 * safe direction: it can only reject a piece the exact test would allow,
 * never accept one it would forbid.
 *
 * Only `contains`/`distanceToEdge` are re-derived; everything else delegates.
 */
export function solverBoundary(boundary: ParkBoundary): ParkBoundary {
  const points = boundary.outline();
  const count = points.length;
  const radii = new Float64Array(count);
  const obliquity = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const [x, z] = points[i] as readonly [number, number];
    const [nx, nz] = points[(i + 1) % count] as readonly [number, number];
    const [px, pz] = points[(i - 1 + count) % count] as readonly [number, number];
    const radius = Math.hypot(x, z) || 1;
    radii[i] = radius;
    // Edge direction by central difference; its normal versus the radial.
    const ex = nx - px;
    const ez = nz - pz;
    const edge = Math.hypot(ex, ez) || 1;
    // normal = (-ez, ex)/edge; radial = (x, z)/radius; |dot| is the cosine.
    obliquity[i] = Math.abs((-ez * x + ex * z) / (edge * radius));
  }
  const at = (table: Float64Array, bearing: number): number => {
    const t = ((bearing % TAU) + TAU) % TAU;
    const scaled = (t / TAU) * count;
    const i = Math.floor(scaled) % count;
    const frac = scaled - Math.floor(scaled);
    const a = table[i] as number;
    const b = table[(i + 1) % count] as number;
    return a + (b - a) * frac;
  };
  return {
    contains: (x, z) => Math.hypot(x, z) <= at(radii, Math.atan2(z, x)),
    distanceToEdge: (x, z) => {
      // Both tables looked up from ONE bearing reduction. This is `at` twice
      // with the index arithmetic hoisted — the same operations on the same
      // values in the same order, so the same doubles — because the route
      // search asks this on every sample of every candidate piece and the
      // mod/floor/lerp was being derived twice for one bearing.
      const bearing = Math.atan2(z, x);
      const t = ((bearing % TAU) + TAU) % TAU;
      const scaled = (t / TAU) * count;
      const i = Math.floor(scaled) % count;
      const frac = scaled - Math.floor(scaled);
      const j = (i + 1) % count;
      const radiusA = radii[i] as number;
      const radiusB = radii[j] as number;
      const cosA = obliquity[i] as number;
      const cosB = obliquity[j] as number;
      return (
        (radiusA + (radiusB - radiusA) * frac - Math.hypot(x, z)) *
        (cosA + (cosB - cosA) * frac)
      );
    },
    area: boundary.area,
    perimeter: boundary.perimeter,
    maxRadius: boundary.maxRadius,
    extent: boundary.extent,
    outline: () => points,
  };
}


/**
 * Where the ground stops, on a given bearing.
 *
 * The terrain disc follows the park's outline rather than being a circle around
 * it, and that is not cosmetic. The apron between the edge and the cut has to be
 * the *same width all the way round*: on a circular disc around a boundary
 * running 57-110 m it would be 22 m at the widest bearing and 67 m at the
 * narrowest, so the treeline that hides the cut would either stand miles out on
 * a bare hillside or fail to reach the cut at all. Following the outline keeps
 * the hill, the treeline and the cut edge in the same relationship on every
 * bearing.
 */
export function terrainEdgeRadiusAt(bearing: number): number {
  return edgeRadiusAt(PARK_BOUNDARY, bearing) + TERRAIN_APRON;
}
