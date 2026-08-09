import { Rng, TAU } from '../core/mathUtils';
import { cachedSolve } from '../core/solveCache';
import { GARDEN_PLAY_RADIUS, RIM_OUTSET_END } from '../core/constants';
import { ENTRANCE_ANGLE, ENTRANCE_WALL_RADIUS } from './entrance/layout';
import { PARK_SEED } from './parkManifest';

/** Axis-aligned extent of a boundary. */
export interface BoundaryExtent {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * **The shape of the park.**
 *
 * This was `rail/boundary.ts` — an interface cut so the rail generator would
 * not have to reopen when the park stopped being a circle (issue #115). It has
 * moved up here because it stopped being a rail concept the moment the terrain,
 * the player's clamp and the layout solver all had to ask the same question.
 *
 * `distanceToEdge` is signed like a signed distance field: positive inside, so
 * a corridor of width `w` fits wherever `distanceToEdge >= w`, and a caller
 * never has to know whether the edge is a circle, a polygon or a spline.
 */
export interface ParkBoundary {
  /** Is (x, z) inside the park at all? */
  contains(x: number, z: number): boolean;
  /** Metres from (x, z) to the nearest edge. Positive inside, negative out. */
  distanceToEdge(x: number, z: number): number;
  /** Enclosed area in square metres — what "twice the park" is measured on. */
  readonly area: number;
  /** Length once round the edge. What the boundary wall has to cover. */
  readonly perimeter: number;
  /** Furthest the edge ever gets from the origin. Sizing terrain and meshes. */
  readonly maxRadius: number;
  /**
   * Axis-aligned extent of the edge, for anything that has to allocate a grid
   * over the whole space — `NavGrid`'s lattice, chiefly. A radius is not enough
   * once the shape is neither circular nor centred on the origin.
   */
  readonly extent: BoundaryExtent;
  /** The edge as a closed polygon, for anything that has to *draw* it. */
  outline(): readonly (readonly [number, number])[];
}

/**
 * A circle about the origin.
 *
 * Still here, and still the right answer for a *ride's* territory: the Sky
 * Cruiser is handed a much smaller circle than the park's own because the train
 * owns the band outside it. A ride's boundary is not the park's boundary.
 */
export function circleBoundary(radius: number, centreX = 0, centreZ = 0): ParkBoundary {
  return {
    contains: (x, z) => Math.hypot(x - centreX, z - centreZ) <= radius,
    distanceToEdge: (x, z) => radius - Math.hypot(x - centreX, z - centreZ),
    area: Math.PI * radius * radius,
    perimeter: TAU * radius,
    maxRadius: radius,
    extent: {
      minX: centreX - radius,
      maxX: centreX + radius,
      minZ: centreZ - radius,
      maxZ: centreZ + radius,
    },
    outline: () => {
      const points: [number, number][] = [];
      for (let i = 0; i < PROFILE_SAMPLES; i += 1) {
        const angle = (i / PROFILE_SAMPLES) * TAU;
        points.push([centreX + Math.cos(angle) * radius, centreZ + Math.sin(angle) * radius]);
      }
      return points;
    },
  };
}

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

// --------------------------------------------------------------- the profile

/**
 * How many bearings the boundary is sampled at.
 *
 * The curve is smooth and low-frequency by construction (see
 * {@link generateParkBoundary}), so this is about the accuracy of the *distance
 * query*, not about resolving detail: 512 segments round an ~80 m park is a
 * chord every ~1 m, well under the metre-scale clearances anything asks about.
 */
const PROFILE_SAMPLES = 512;

/**
 * A boundary given as a radius per bearing.
 *
 * Representing the park's edge as `r(theta)` is the thing Decision 4 warns
 * against for a *rail loop*, and for a good reason there: a track that has to
 * dip inward past an obstacle is not a function of bearing at all. The park's
 * edge is a different object. It encloses the origin once, it never doubles
 * back, and the whole point of it is to be gentle — so a radius per bearing is
 * not a limitation being smuggled in, it is an accurate description. It also
 * makes `contains` exact rather than a polygon test with a tolerance.
 *
 * ### The limit, and the ruling on it (5 August 2026)
 *
 * This is **star-shaped**: every ray from the centre crosses the edge exactly
 * once. It gives bays and waists, but it can never express a crescent,
 * horseshoe or kidney whose boundary wraps back past itself. Jim asked for a
 * park that could take "any arbitrary curved shape", so whether that limit is
 * one he would notice was a real question, and it was **measured rather than
 * argued**: for a polar curve the signed curvature numerator
 * `r^2 + 2r'^2 - r r''` goes negative exactly where the edge curves inward, and
 * it does so across 23-28% of the perimeter on every seed, with an
 * isoperimetric quotient of 0.84-0.88 against a circle's 1.000. The outlines
 * were drawn and shown to him and he approved them as they are.
 *
 * So the star-shaped limit is **accepted, not merely tolerated**. Two reasons
 * not to spend the generality: a general closed curve makes `distanceToEdge`
 * substantially harder — it has already been wrong by 14.4 m once here, see
 * below — and a horseshoe park is miserable to walk around as well as hostile
 * to the layout solver and to every ride that must fit inside.
 *
 * If it is ever wanted anyway, the change stays contained: every consumer asks
 * {@link ParkBoundary}, never a radius, so only this function and
 * {@link generateParkBoundary} would be replaced. The gate pin survives either
 * representation.
 */
export function profileBoundary(radii: readonly number[]): ParkBoundary {
  const count = radii.length;
  const points: [number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * TAU;
    const r = radii[i] as number;
    points.push([Math.cos(angle) * r, Math.sin(angle) * r]);
  }

  // Shoelace over the sampled polygon. This is the area of the polygon that is
  // actually used for every distance query, so it is the honest area of the
  // boundary as implemented rather than the analytic area of the curve it was
  // sampled from — they differ by ~0.001% at 512 samples.
  let twiceArea = 0;
  for (let i = 0; i < count; i += 1) {
    const [ax, az] = points[i] as [number, number];
    const [bx, bz] = points[(i + 1) % count] as [number, number];
    twiceArea += ax * bz - bx * az;
  }
  const area = Math.abs(twiceArea) / 2;
  const maxRadius = radii.reduce((a, b) => Math.max(a, b), 0);

  let perimeter = 0;
  for (let i = 0; i < count; i += 1) {
    const [ax, az] = points[i] as [number, number];
    const [bx, bz] = points[(i + 1) % count] as [number, number];
    perimeter += Math.hypot(bx - ax, bz - az);
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [px, pz] of points) {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (pz < minZ) minZ = pz;
    if (pz > maxZ) maxZ = pz;
  }
  const extent: BoundaryExtent = { minX, maxX, minZ, maxZ };

  const radiusAt = (bearing: number): number => {
    // Linear interpolation between the two nearest samples. The profile is
    // low-frequency, so this is far more accurate than the sample spacing
    // suggests.
    const t = ((bearing % TAU) + TAU) % TAU;
    const scaled = (t / TAU) * count;
    const i = Math.floor(scaled) % count;
    const frac = scaled - Math.floor(scaled);
    const a = radii[i] as number;
    const b = radii[(i + 1) % count] as number;
    return a + (b - a) * frac;
  };

  /**
   * Nearest approach to the polygon, coarse pass then refine.
   *
   * The obvious shortcut here — search only the segments near the query
   * point's own bearing — is **wrong**, and measurably so. It assumes the
   * nearest edge is at roughly your own bearing, which holds for a circle and
   * fails for a park whose radius runs from 57 m to 110 m: from near the
   * origin the closest edge is wherever the park is *narrowest*, which can be
   * most of a turn away. Measured against brute force it was out by up to
   * 14.4 m before this was replaced.
   *
   * Striding the coarse pass does not fix it either, and that failure is worth
   * recording because it looked like it worked: sampling every 8th vertex left
   * a 0.13 m error that no amount of widening the refinement window removed.
   * The cause was a near-tie — an eccentric park has two edges almost equally
   * close, 108 vertices apart, and the strided pass simply picked the wrong
   * one, after which refining around it can never reach the other.
   *
   * So every vertex is scanned, but cheaply: squared distances, no `hypot` and
   * no projection. Only the handful of segments beside the winner get the real
   * point-to-segment treatment. That is 512 multiply-adds plus 5 projections
   * rather than 512 projections — this is called from `terrainHeight`, which
   * runs hundreds of thousands of times a build, so the constant matters. The
   * invariant suite checks it against a brute-force search over every segment,
   * including the degenerate query at the origin, so it stays measured.
   */
  const REFINE = 2;

  const distanceToEdge = (x: number, z: number): number => {
    let coarse = 0;
    let coarseBest = Infinity;
    for (let i = 0; i < count; i += 1) {
      const [px, pz] = points[i] as [number, number];
      const dx = x - px;
      const dz = z - pz;
      const d = dx * dx + dz * dz;
      if (d < coarseBest) {
        coarseBest = d;
        coarse = i;
      }
    }

    let best = Infinity;
    for (let step = -REFINE; step <= REFINE; step += 1) {
      const i = (((coarse + step) % count) + count) % count;
      const [ax, az] = points[i] as [number, number];
      const [bx, bz] = points[(i + 1) % count] as [number, number];
      const dx = bx - ax;
      const dz = bz - az;
      const lengthSq = dx * dx + dz * dz;
      let t = lengthSq > 0 ? ((x - ax) * dx + (z - az) * dz) / lengthSq : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < best) best = d;
    }
    // Sign from the profile rather than from a winding test: the curve is a
    // function of bearing, so "inside" is exactly "closer to the origin than
    // the edge is, on my own bearing".
    return Math.hypot(x, z) <= radiusAt(Math.atan2(z, x)) ? best : -best;
  };

  return {
    contains: (x, z) => Math.hypot(x, z) <= radiusAt(Math.atan2(z, x)),
    distanceToEdge,
    area,
    perimeter,
    maxRadius,
    extent,
    outline: () => points,
  };
}

/**
 * A fast read-only view of a star-shaped boundary, for the ride solvers.
 *
 * `profileBoundary`'s `distanceToEdge` scans all 512 vertices per query so a
 * one-off ask (a lamp, a plot candidate) is exact even at the eccentric
 * near-tie its comment documents. A route search is a different customer: it
 * asks per CANDIDATE PIECE — measured at 776k pieces on one seed, the scan
 * was most of a 31-second solve. This view answers in O(1) from two lookup
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

// ------------------------------------------------------------- the generator

/**
 * Harmonics the park's outline is built from.
 *
 * Only 2 through 5. One (`k = 1`) is not a shape at all — it just slides the
 * whole park off the origin — and anything above 5 puts more than five lobes
 * round the edge, which stops reading as a park and starts reading as a flower.
 * Low harmonics are also what *makes* the curve gentle: the tightest possible
 * curvature scales with `k` squared, so keeping `k` small is the same act as
 * keeping the spline smooth.
 */
const HARMONICS = [2, 3, 4, 5] as const;

/**
 * How much of the mean radius the wiggle may claim, before the area and gate
 * constraints are solved.
 *
 * These are the numbers that decide how *different* two seeds' parks look, and
 * the family's ruling (5 Aug 2026) is that every park should be unique — so
 * this is deliberately pushed until the curvature floor is what stops it, not
 * timidity. Amplitudes are re-rolled and shrunk if the result would be too
 * sharp; see {@link generateParkBoundary}.
 */
const WIGGLE_MIN = 0.1;
const WIGGLE_MAX = 0.32;

/**
 * How many candidate outlines to try before taking the best one.
 *
 * This number is load-bearing and was measured, not guessed. Taking the *first*
 * candidate that cleared a gentleness floor produced no park at all: every seed
 * exhausted its attempts and silently fell back to a circle, which is the
 * "every park is the same park" failure the family's uniqueness ruling exists
 * to prevent. Searching properly and keeping the best fixes it, and the budget
 * is what decides whether it works:
 *
 * | tries | best curvature radius found, across the five test seeds |
 * |---|---|
 * | 200 | 18.2 - 37.4 m (three seeds too sharp) |
 * | 2000 | 30.1 - 37.4 m (every seed comfortable) |
 *
 * Which is the family's ruling on ride generation applied here (5 Aug 2026):
 * keep trying, and only bail after a very large number of tries.
 */
const ATTEMPTS = 2000;

/**
 * The sharpest the boundary may ever turn, in metres of curvature radius.
 *
 * Taken from the camera rather than from the generator: the fixed iso view
 * shows roughly 36 m of ground depth (ARCHITECTURE.md, "the park is a diorama
 * on a hilltop"), so an edge whose curvature radius is under half that turns
 * visibly inside a single screen and reads as a corner rather than as a gentle
 * park boundary. The generator does far better than this in practice — 30 m and
 * up on every test seed — and that headroom is the point: this is the floor
 * below which the shape is *wrong*, not the target it aims for.
 */
export const GENTLE_CURVATURE_RADIUS = 20;

export interface ParkBoundaryOptions {
  readonly seed: number;
  /** Enclosed area to hit, in square metres. */
  readonly targetArea: number;
  /** Bearing of the park gate, which the edge must pass exactly through. */
  readonly gateBearing: number;
  /** Distance from the origin to the gate. */
  readonly gateRadius: number;
}

/**
 * **A gentle closed outline, unique to its seed, of a given area, passing
 * exactly through the gate.**
 *
 * The park's edge is `r(theta) = A + B * u(theta)`, where `u` is a seeded
 * zero-mean sum of low harmonics. That form is chosen because both constraints
 * then have closed forms and neither has to be searched for:
 *
 * - **Area.** For a polar curve, area is `0.5 * integral(r^2 dtheta)`. The
 *   cross term vanishes because `u` has zero mean, leaving
 *   `pi * (A^2 + Q * B^2 / 2)` with `Q` the sum of the squared amplitudes.
 * - **The gate.** Decision 5 pins the entrance as the one fixed thing a
 *   returning child can rely on, so the edge must pass through it exactly:
 *   `A + B * u(gate) = gateRadius`.
 *
 * Two equations, two unknowns, and substituting the second into the first
 * leaves a quadratic in `B`. So the park hits its area exactly and meets its
 * gate exactly, and everything left over — which way it bulges, how much, where
 * it pinches — is the seed's own.
 *
 * That pinch at the gate is the interesting consequence. A park twice the area
 * has a mean radius well outside the gate, so the outline has to come *in* to
 * meet it: the park is narrow at the entrance and swells away from it,
 * differently on every seed. This is deliberately not a reserved gate zone
 * (family ruling, 5 Aug: nothing reserves space) — it is one pinned point on a
 * curve that is otherwise free.
 *
 * Rerolls if the outline would be too sharp or would fold back through the
 * origin, shrinking the wiggle as it goes, and only falls back to a plain
 * circle after {@link ATTEMPTS} failures.
 */
export function generateParkBoundary(options: ParkBoundaryOptions): ParkBoundary {
  const radii = cachedSolve(
    'boundary',
    `${options.seed}:${options.targetArea.toFixed(0)}:${options.gateBearing.toFixed(4)}:${options.gateRadius}`,
    () => solveBoundaryRadii(options),
    (value) => value,
    (raw) => {
      const list = raw as number[];
      if (!Array.isArray(list) || list.length !== PROFILE_SAMPLES) throw new Error('stale profile');
      return list;
    },
  );
  return profileBoundary(radii);
}

function solveBoundaryRadii(options: ParkBoundaryOptions): number[] {
  const { seed, targetArea, gateBearing, gateRadius } = options;
  const rng = new Rng(seed);
  const areaOverPi = targetArea / Math.PI;

  let best: { radii: number[]; curvature: number } | null = null;

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const amplitudes = HARMONICS.map(() => rng.range(WIGGLE_MIN, WIGGLE_MAX));
    const phases = HARMONICS.map(() => rng.range(0, TAU));

    const u = (angle: number): number => {
      let total = 0;
      for (let h = 0; h < HARMONICS.length; h += 1) {
        total += (amplitudes[h] as number) * Math.cos((HARMONICS[h] as number) * angle + (phases[h] as number));
      }
      return total;
    };

    const q = amplitudes.reduce((sum, a) => sum + a * a, 0);
    const gateU = u(gateBearing);

    // (gateU^2 + q/2) B^2 - 2 gateRadius gateU B + (gateRadius^2 - areaOverPi) = 0
    const qa = gateU * gateU + q / 2;
    const qb = -2 * gateRadius * gateU;
    const qc = gateRadius * gateRadius - areaOverPi;
    if (Math.abs(qa) < 1e-9) continue;
    const discriminant = qb * qb - 4 * qa * qc;
    if (discriminant < 0) continue;
    const root = Math.sqrt(discriminant);
    // The `+` root is the one that grows the park outward from the gate.
    const b = (-qb + root) / (2 * qa);
    const a = gateRadius - b * gateU;
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) continue;

    const radii: number[] = [];
    let smallest = Infinity;
    for (let i = 0; i < PROFILE_SAMPLES; i += 1) {
      const angle = (i / PROFILE_SAMPLES) * TAU;
      const r = a + b * u(angle);
      if (r < smallest) smallest = r;
      radii.push(r);
    }
    // A profile that dips to nothing is not a park.
    if (smallest < gateRadius * 0.5) continue;

    // Keep the gentlest candidate rather than the first acceptable one. See
    // ATTEMPTS: first-acceptable found nothing at all and fell back to a
    // circle on every seed.
    const curvature = minCurvatureRadius(radii);
    if (!best || curvature > best.curvature) best = { radii, curvature };
  }

  // No silent fallback to a circle. A boundary that cannot be generated is a
  // broken park, and quietly handing back a circle would turn that into "every
  // seed produced the same park" — which is exactly how this went wrong the
  // first time, and it took a spread-of-radii probe to notice. The seed is
  // committed and CI builds five of them, so this failing is a build-time
  // failure, which is where it belongs.
  if (!best || best.curvature < GENTLE_CURVATURE_RADIUS) {
    throw new Error(
      `generateParkBoundary: no gentle outline for seed ${seed} after ${ATTEMPTS} tries ` +
        `(best curvature radius ${best ? best.curvature.toFixed(1) : 'none'} m, ` +
        `floor ${GENTLE_CURVATURE_RADIUS} m). Target area ${targetArea.toFixed(0)} m2 ` +
        `with the gate pinned at ${gateRadius} m may be geometrically impossible.`,
    );
  }
  return best.radii;
}

/**
 * How much bigger the generated park is than the circular one it replaces.
 *
 * REQUIREMENTS-2026-07-28 §6 asks for "about 2x current". *Current* has never
 * been written down anywhere — the park's area was only ever implied by
 * whichever circle you took as its edge — so this multiplies the honest one:
 * `GARDEN_PLAY_RADIUS`, the soft wall the player is actually held inside.
 *
 * **This is deliberately one number.** Which circle "2x" is measured against
 * changes the park a great deal and is a family decision, not an engineering
 * one, and every candidate needs the same work underneath. Everything else
 * derives from the boundary, so changing the answer is changing this line.
 *
 * It is not a free dial, though: the gap between the resulting mean radius and
 * the pinned gate is what the outline has to swell to cover, and that swelling
 * is where the difference between two seeds' parks comes from. A smaller
 * multiplier is gentler on the outer shell and makes every park more alike.
 */
export const PARK_AREA_MULTIPLIER = 2;

/** The circular park this one replaces — the area the multiplier multiplies. */
export const CIRCULAR_PARK_AREA = Math.PI * GARDEN_PLAY_RADIUS * GARDEN_PLAY_RADIUS;

/**
 * **The park.** One per build, from `PARK_SEED`, exactly like the layout.
 *
 * Read the seed the same way everything else does, so `LGP_SEED=n` re-rolls the
 * boundary along with the rest of the park and the invariant suite's five seeds
 * genuinely get five different parks.
 */
export const PARK_BOUNDARY: ParkBoundary = generateParkBoundary({
  seed: PARK_SEED,
  targetArea: CIRCULAR_PARK_AREA * PARK_AREA_MULTIPLIER,
  gateBearing: ENTRANCE_ANGLE,
  gateRadius: ENTRANCE_WALL_RADIUS,
});

/**
 * **The soft boundary the player is held inside.**
 *
 * This is now the generated park. It could only move here once the whole shell
 * moved with it — the hill is measured out from this edge, the masonry walks
 * it, the terrain disc follows it and the treeline sits in a band beyond it.
 * Switching it alone, at any earlier point, would have let a child walk out to
 * 110 m through where the wall was not and off the side of a terrain disc that
 * still stopped at 83.5 m.
 *
 * It stays a named constant rather than `PARK_BOUNDARY` inlined at both sites,
 * so the clamp's default and the value `Building` restores on leaving the
 * castle are the *same object* rather than two copies of one idea — the failure
 * mode #114 was made of.
 */
export const GARDEN_PLAY_BOUNDARY: ParkBoundary = PARK_BOUNDARY;

/**
 * Where the ground stops, now that the park's edge moves.
 *
 * The terrain mesh stays a plain polar disc, which is not the compromise it
 * looks like: the park's *shape* comes from the rim falloff in `terrainHeight`,
 * not from the outline of the mesh, so the disc only has to be big enough to
 * contain the hill. Re-tessellating it to the boundary would buy nothing and
 * cost the even vertex distribution the grass tiling depends on.
 *
 * Big enough means: past the furthest the edge ever reaches, plus the whole
 * width of the crest, plus a little so the cut edge is below the horizon rather
 * than level with it.
 */
/** Ground beyond the crest, so the cut edge sits below the horizon not level with it. */
/**
 * How far inside the park's edge a ride's exit must sit, in metres.
 *
 * A statement about the boundary, so it lives with the boundary: a point can
 * be clear of every plot and still be somewhere a child cannot be put down,
 * because it is on the wrong side of the park's own edge — which is also
 * exactly what "not reachable from the entrance" turns out to mean.
 *
 * Both the Rail Race (`railRace/plan.ts`, which re-exports this so
 * `check:rail-race` keeps its one owner) and the Sky Cruiser
 * (`coaster/plan.ts`) clamp their exits with it. It is here rather than in
 * either of them because those two modules cannot import from each other:
 * `coaster/plan -> railRace/plan -> train/plan -> coaster/plan` is a cycle that
 * `tsc` accepts and Node fails at load.
 */
export const EXIT_INSIDE_EDGE = 2;

export const TERRAIN_APRON = RIM_OUTSET_END + 1.5;

export const TERRAIN_EDGE_RADIUS = PARK_BOUNDARY.maxRadius + TERRAIN_APRON;

/**
 * Distance from the origin to the park's edge on a given bearing.
 *
 * Only meaningful because the boundary is star-shaped (see
 * {@link profileBoundary}) — every ray from the centre crosses the edge exactly
 * once, so "the radius on this bearing" is a well-defined thing. Anything that
 * needs a *distance* rather than a radius should ask `distanceToEdge` instead;
 * this is for the handful of places that scatter things polar-fashion and want
 * the park's own reach on the bearing they picked.
 */
export function edgeRadiusAt(boundary: ParkBoundary, bearing: number): number {
  const points = boundary.outline();
  const count = points.length;
  const t = ((bearing % TAU) + TAU) % TAU;
  const scaled = (t / TAU) * count;
  const i = Math.floor(scaled) % count;
  const frac = scaled - Math.floor(scaled);
  const [ax, az] = points[i] as readonly [number, number];
  const [bx, bz] = points[(i + 1) % count] as readonly [number, number];
  const a = Math.hypot(ax, az);
  const b = Math.hypot(bx, bz);
  return a + (b - a) * frac;
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

/** A point along the park's edge, with the way the edge runs there. */
export interface EdgeStation {
  readonly x: number;
  readonly z: number;
  /** Yaw putting a box's local X axis along the edge, for `Object3D.rotation.y`. */
  readonly yaw: number;
}

/**
 * Walks the edge at even spacing, by **arc length**.
 *
 * The wall used to be laid out by sweeping an angle at a constant radius, which
 * is only even spacing while the radius is constant. On an outline running from
 * 57 m to 110 m the same angular step is a 1.0 m block on one side of the park
 * and a 1.9 m gap on the other — bonded masonry at the pinch, a picket fence at
 * the bulge. Stepping along the curve instead keeps every block the same size
 * and the same distance from its neighbour the whole way round.
 *
 * `offset` shifts the whole run along the edge, which is what staggers
 * alternate courses into a proper bond.
 */
export function alongBoundary(
  boundary: ParkBoundary,
  spacing: number,
  offset = 0,
): EdgeStation[] {
  const points = boundary.outline();
  const count = points.length;

  const cumulative: number[] = [0];
  for (let i = 0; i < count; i += 1) {
    const [ax, az] = points[i] as readonly [number, number];
    const [bx, bz] = points[(i + 1) % count] as readonly [number, number];
    cumulative.push((cumulative[i] as number) + Math.hypot(bx - ax, bz - az));
  }
  const perimeter = cumulative[count] as number;

  const stations: EdgeStation[] = [];
  const steps = Math.max(3, Math.round(perimeter / spacing));
  let cursor = 0;
  for (let step = 0; step < steps; step += 1) {
    const target = (((step / steps) * perimeter + offset) % perimeter + perimeter) % perimeter;
    while (cursor < count - 1 && (cumulative[cursor + 1] as number) < target) cursor += 1;
    while (cursor > 0 && (cumulative[cursor] as number) > target) cursor -= 1;
    const [ax, az] = points[cursor] as readonly [number, number];
    const [bx, bz] = points[(cursor + 1) % count] as readonly [number, number];
    const segment = (cumulative[cursor + 1] as number) - (cumulative[cursor] as number);
    const t = segment > 1e-9 ? (target - (cumulative[cursor] as number)) / segment : 0;
    const tangentX = bx - ax;
    const tangentZ = bz - az;
    stations.push({
      x: ax + tangentX * t,
      z: az + tangentZ * t,
      // Yaw about Y takes local +X to (cos, -sin), so this points the block's
      // long axis along the edge rather than across it — the difference between
      // a wall and a ring of tombstones.
      yaw: Math.atan2(-tangentZ, tangentX),
    });
  }
  return stations;
}

/**
 * Smallest radius of curvature anywhere on a sampled polar profile.
 *
 * `kappa = (r^2 + 2 r'^2 - r r'') / (r^2 + r'^2)^1.5`, with the derivatives
 * taken by central difference on the samples — measured off the profile that
 * will actually be used, not from the harmonics it was built from, so it stays
 * true if the profile is ever produced some other way.
 */
export function minCurvatureRadius(radii: readonly number[]): number {
  const count = radii.length;
  const step = TAU / count;
  let smallest = Infinity;
  for (let i = 0; i < count; i += 1) {
    const previous = radii[(i - 1 + count) % count] as number;
    const r = radii[i] as number;
    const next = radii[(i + 1) % count] as number;
    const first = (next - previous) / (2 * step);
    const second = (next - 2 * r + previous) / (step * step);
    const numerator = r * r + 2 * first * first - r * second;
    if (Math.abs(numerator) < 1e-9) continue;
    const curvature = numerator / Math.pow(r * r + first * first, 1.5);
    const radius = Math.abs(1 / curvature);
    if (radius < smallest) smallest = radius;
  }
  return smallest;
}
