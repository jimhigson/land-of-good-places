/**
 * **The claims registry measures distance on the planet, not on its shadow.**
 *
 * `groundClaims.ts` speaks world `(x, z)`, and every placer that talks to it
 * does too. That is not going to change — it is the coordinate the park is
 * authored in. What changes here is what those numbers *mean* when two of them
 * are compared.
 *
 * `terrain.ts` puts the ground for world `(x, z)` at `√(R² − x² − z²) − R`. So
 * world `(x, z)` is an **orthographic projection** of the planet: the shadow
 * the sphere casts on the plane tangent at the park's origin. Its tangential
 * axis is exact; its radial axis compresses by `cos θ`. `Math.hypot` over it is
 * therefore not "distance in metres", it is distance in a chart that shrinks as
 * you go out — and the park goes out a long way.
 *
 * Measured (`scripts/claim-chart-error.mts`):
 *
 * | distance from origin | lean | a 1 m radial gap really walks |
 * |---|---|---|
 * | 0 m | 0.0° | 1.000 m |
 * | 100 m | 27.0° | 1.124 m |
 * | 150 m | 43.0° | 1.371 m |
 * | 200 m | 65.4° | 2.430 m |
 *
 * **Which way the error points, and why that matters.** A projection can only
 * shorten, so the flat reading is always a *lower bound* on the true distance.
 * For refusing an overlap that is conservative — the registry refuses things
 * that would in fact have cleared, costing solve attempts but never solidity.
 * For {@link GroundClaims.unservedDemands} it is the opposite and it is a real
 * defect: a demand is served when a corridor **ends inside its radius**, so
 * under-reading distance marks a door served by a road that stops 40% further
 * away than the registry believes. A child walks to the door and the paving
 * runs out.
 *
 * ## The broad phase is NOT free, and assuming it was would have been the bug
 *
 * The first draft of this file claimed the registry's cheap axis-box prefilter
 * could stay exactly as it was, on the grounds that a projection can only
 * shorten, so flat ≤ arc. **That is true point-to-point and false
 * point-to-run**, and the test written to confirm it failed instead.
 *
 * A great circle projects orthographically to an *ellipse*, not to the chord
 * between its endpoints. So the chart's straight segment is a different curve
 * from the run that is actually on the ground, and a point can sit nearer the
 * straight line than it does to the real run. Swept over the park, the flat
 * kernel **over-reads by up to 15.4 m**. Left alone, the box prefilter would
 * have dismissed pairs that genuinely share ground: a refusal that never
 * happens, two solid things in one place, and a child walking through the
 * furniture — while every test of the narrow phase stayed green, because the
 * narrow phase was never reached.
 *
 * The fix is not a fudge factor. Measure the chart distance to the **projected
 * geodesic** rather than to the chord and the lower bound is restored exactly:
 * every point of the run is a point, and flat ≤ arc holds for points. Swept
 * against the arc kernel, the residual is pure discretisation and converges as
 * `1/n²`:
 *
 * | samples along the run | worst violation |
 * |---|---|
 * | 8 | 0.269 m |
 * | 32 | 0.006 m |
 * | 128 | 0.000004 m |
 * | 512 | 0.000000 m |
 *
 * So {@link boundsOfRun} boxes the sampled geodesic, and
 * {@link CLAIM_BROAD_PHASE_SLACK} covers the sampling step — a stated number
 * with a measurement behind it, not a margin somebody guessed.
 *
 * One more fact makes this a small change rather than a rewrite:
 *
 * - **A claim's own shape stays a disc or a capsule.** On R = 220 a flat patch
 *   is good to 4.69 m at centimetre tolerance (`Chart.flatDeparture`), which
 *   covers a bench, a stall or a path piece. What was never valid is treating
 *   the *whole park* as one flat chart, and that is what comparing two distant
 *   claims with `hypot` did.
 *
 * Radii are the cap's, not the terrain's: the rolling waves move a point's
 * height by under a metre and its **bearing** not at all, and a ground claim is
 * about bearing. Using the cap keeps this exactly consistent with the drawn
 * ground's own shape rather than re-deriving a second wave field.
 */
import { Vector3 } from 'three';
import { GROUND_SPHERE_RADIUS } from '../core/constants';

/** The planet the claims lie on. One owner; `terrain.ts` uses the same number. */
export const CLAIM_SURFACE_RADIUS = GROUND_SPHERE_RADIUS;

const R = CLAIM_SURFACE_RADIUS;

const _a = /* @__PURE__ */ new Vector3();
const _b = /* @__PURE__ */ new Vector3();
const _p = /* @__PURE__ */ new Vector3();
const _n = /* @__PURE__ */ new Vector3();

const _proj = /* @__PURE__ */ new Vector3();


/**
 * The unit bearing of a world `(x, z)` — the direction from the planet's centre
 * to the ground there.
 *
 * Past the equator (`d ≥ R`) there is no ground: `terrain.ts` clamps to a flat
 * plane and the square root is imaginary. This clamps the bearing to the
 * equator rather than producing a NaN, so a claim written out there measures as
 * being at the horizon instead of poisoning every comparison it takes part in.
 * A park reaching that far is a fault to be reported by
 * `theGroundIsTheSphereItClaimsToBe`, not something to be papered over here —
 * see `scripts/park-past-the-horizon.mts`.
 */
export const bearingOf = (x: number, z: number, target: Vector3): Vector3 => {
  const d2 = x * x + z * z;
  if (d2 >= R * R) {
    const d = Math.sqrt(d2) || 1;
    return target.set(x / d, 0, z / d);
  }
  const y = Math.sqrt(R * R - d2);
  return target.set(x / R, y / R, z / R);
};

/** The angle between two unit vectors, clamped so `acos` cannot return NaN. */
const angleBetween = (a: Readonly<Vector3>, b: Readonly<Vector3>): number => {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(dot < -1 ? -1 : dot > 1 ? 1 : dot);
};

/** **How far a child walks between two world `(x, z)` points.** */
export const arcBetween = (ax: number, az: number, bx: number, bz: number): number => {
  bearingOf(ax, az, _a);
  bearingOf(bx, bz, _b);
  return R * angleBetween(_a, _b);
};

/**
 * **How far `(px, pz)` is from the geodesic run between the two given points**,
 * along the ground.
 *
 * The spherical replacement for `distPointSegment`. The cross-track distance to
 * the great circle through the endpoints is `R·|asin(p̂·n̂)|`, exact and
 * closed-form; the endpoint clamp is what makes it a *segment* rather than a
 * whole circle, and omitting it is the bug that lets a ring claim measure to
 * the far side of the planet.
 */
export const arcToRun = (
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): number => {
  bearingOf(px, pz, _p);
  bearingOf(x1, z1, _a);
  bearingOf(x2, z2, _b);
  return arcPointToRunUnit(_p, _a, _b);
};

/** The unit-vector core of {@link arcToRun}, so callers holding bearings need not rebuild them. */
const arcPointToRunUnit = (
  p: Readonly<Vector3>,
  a: Readonly<Vector3>,
  b: Readonly<Vector3>,
): number => {
  const toA = R * angleBetween(p, a);
  const toB = R * angleBetween(p, b);
  const ends = toA < toB ? toA : toB;

  _n.crossVectors(a, b);
  const nl = _n.length();
  // Coincident endpoints: no great circle is defined, and the endpoints are the
  // honest answer (they are the same point).
  if (nl < 1e-12) return ends;
  _n.multiplyScalar(1 / nl);

  const offPlane = p.x * _n.x + p.y * _n.y + p.z * _n.z;
  _proj.set(p.x - _n.x * offPlane, p.y - _n.y * offPlane, p.z - _n.z * offPlane);
  const pl = _proj.length();
  // `p` is on the great circle's own axis: every point of the arc is equally
  // far, and the endpoints report that distance correctly.
  if (pl < 1e-12) return ends;
  _proj.multiplyScalar(1 / pl);

  // Is the projection ON the arc, or past an end? The angles only sum to the
  // whole between the endpoints.
  const span = angleBetween(a, b);
  if (angleBetween(a, _proj) + angleBetween(_proj, b) > span + 1e-9) return ends;

  const clamped = offPlane < -1 ? -1 : offPlane > 1 ? 1 : offPlane;
  const crossTrack = R * Math.abs(Math.asin(clamped));
  return crossTrack < ends ? crossTrack : ends;
};

/**
 * How many points a run is sampled at when its chart footprint is boxed.
 *
 * 64 rather than a round 32 because the table in this file's header is the
 * reason: the residual falls as `1/n²`, and 32 leaves 6 mm on the table while
 * 64 leaves well under a millimetre. It is a build-time loop over a few hundred
 * claims, so the cost is nothing and the headroom is free.
 */
const RUN_SAMPLES = 64;

/**
 * The slack added to a broad-phase box, in metres.
 *
 * It covers the discretisation of {@link RUN_SAMPLES} and nothing else — the
 * geometric shortfall is eliminated by boxing the *geodesic* rather than the
 * chord, not papered over here. Measured worst violation at 64 samples is under
 * a millimetre across a sweep of the whole park; 0.05 m is two orders of
 * magnitude of headroom, and it is cheap because a broad phase that is slightly
 * too generous costs one narrow-phase test, while one that is slightly too mean
 * costs a child walking through a wall.
 */
export const CLAIM_BROAD_PHASE_SLACK = 0.05;

/**
 * Walk the geodesic between two world `(x, z)` points, calling back with each
 * sample's chart `(x, z)`.
 *
 * The samples are **on the ground**, so their chart coordinates trace the
 * ellipse the great circle really projects to, not the straight line between
 * the endpoints. That difference is the whole reason the broad phase is sound.
 */
export const eachRunSample = (
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  visit: (x: number, z: number) => void,
  samples: number = RUN_SAMPLES,
): void => {
  bearingOf(x1, z1, _a);
  bearingOf(x2, z2, _b);
  const theta = angleBetween(_a, _b);
  const sin = Math.sin(theta);
  // Endpoints on the same bearing: the run is a point.
  if (theta < 1e-9 || sin < 1e-12) {
    visit(x1, z1);
    visit(x2, z2);
    return;
  }
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const wa = Math.sin((1 - t) * theta) / sin;
    const wb = Math.sin(t * theta) / sin;
    // Only x and z are wanted: on the cap they ARE the chart coordinates.
    visit((_a.x * wa + _b.x * wb) * R, (_a.z * wa + _b.z * wb) * R);
  }
};

/**
 * The chart-space bounding box of a geodesic run, already widened by `reach`
 * and {@link CLAIM_BROAD_PHASE_SLACK}.
 *
 * `reach` is an arc distance and is added as a chart distance, which is
 * conservative in the right direction: the chart compresses, so `reach` metres
 * of ground never spans more than `reach` of chart.
 */
export const boundsOfRun = (
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  reach: number,
): [number, number, number, number] => {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  eachRunSample(x1, z1, x2, z2, (x, z) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  });
  const pad = reach + CLAIM_BROAD_PHASE_SLACK;
  return [minX - pad, minZ - pad, maxX + pad, maxZ + pad];
};

/** The angle between two unit vectors given as loose components. */
const angleOf = (
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number => {
  const dot = ax * bx + ay * by + az * bz;
  return Math.acos(dot < -1 ? -1 : dot > 1 ? 1 : dot);
};

/** Is a unit point within the arc spanned by two unit endpoints? The angles sum. */
const withinSpan = (
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean =>
  angleOf(ax, ay, az, px, py, pz) + angleOf(px, py, pz, bx, by, bz) <=
  angleOf(ax, ay, az, bx, by, bz) + 1e-9;

/**
 * **Do two geodesic runs actually cross?**
 *
 * The spherical form of `segmentsCross`, and it is needed for the same reason
 * the planar one was: two runs laid in an X have every endpoint a long way from
 * the other run, so the four endpoint-to-run distances are all positive while
 * the runs share a point. Only an intersection test sees that.
 *
 * Two great circles meet at exactly two antipodal points, `±(n̂₁ × n̂₂)`. They
 * cross as *arcs* when either of those lies inside both spans.
 */
export const runsCross = (
  a1x: number,
  a1z: number,
  a2x: number,
  a2z: number,
  b1x: number,
  b1z: number,
  b2x: number,
  b2z: number,
): boolean => {
  // Plain numbers rather than scratch vectors: this runs in the registry's
  // narrow phase, thousands of times per generation, and holding four unit
  // vectors at once through two cross products is exactly where reused scratch
  // objects get clobbered half way. Nothing here allocates.
  bearingOf(a1x, a1z, _a);
  const ax = _a.x;
  const ay = _a.y;
  const az = _a.z;
  bearingOf(a2x, a2z, _a);
  const bx = _a.x;
  const by = _a.y;
  const bz = _a.z;
  bearingOf(b1x, b1z, _a);
  const cx = _a.x;
  const cy = _a.y;
  const cz = _a.z;
  bearingOf(b2x, b2z, _a);
  const dx = _a.x;
  const dy = _a.y;
  const dz = _a.z;

  // The two great circles' normals.
  let n1x = ay * bz - az * by;
  let n1y = az * bx - ax * bz;
  let n1z = ax * by - ay * bx;
  const n1l = Math.hypot(n1x, n1y, n1z);
  if (n1l < 1e-12) return false;
  n1x /= n1l;
  n1y /= n1l;
  n1z /= n1l;

  let n2x = cy * dz - cz * dy;
  let n2y = cz * dx - cx * dz;
  let n2z = cx * dy - cy * dx;
  const n2l = Math.hypot(n2x, n2y, n2z);
  if (n2l < 1e-12) return false;
  n2x /= n2l;
  n2y /= n2l;
  n2z /= n2l;

  // Where the two circles meet: a pair of antipodal points.
  let ix = n1y * n2z - n1z * n2y;
  let iy = n1z * n2x - n1x * n2z;
  let iz = n1x * n2y - n1y * n2x;
  const il = Math.hypot(ix, iy, iz);
  // Parallel normals — the runs lie on the SAME great circle. They do not cross
  // at a point; any sharing is a run-along, which the distance test already
  // reports as zero separation. Saying "no" here is correct, not a gap.
  if (il < 1e-12) return false;
  ix /= il;
  iy /= il;
  iz /= il;

  for (const sign of [1, -1] as const) {
    const hx = ix * sign;
    const hy = iy * sign;
    const hz = iz * sign;
    if (
      withinSpan(hx, hy, hz, ax, ay, az, bx, by, bz) &&
      withinSpan(hx, hy, hz, cx, cy, cz, dx, dy, dz)
    ) {
      return true;
    }
  }
  return false;
};
