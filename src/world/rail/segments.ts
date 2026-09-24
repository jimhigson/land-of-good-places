

/**
 * The vocabulary a rail route is built from: pieces of track, each a cubic
 * bezier in the horizontal plane.
 *
 * ### Why cubics, and why they are really arcs
 *
 * A route is a chain of pieces, and the join between two pieces has to be
 * smooth or the ride feels a kink and the swept rail geometry creases. The
 * cheap way to guarantee that is to make every piece start with its first
 * control point placed **along the incoming heading**: the outgoing tangent at
 * a joint is then parallel to the incoming one by construction, for every piece
 * in the vocabulary, forever. There is no continuity check to forget, because
 * there is no way to express a discontinuous joint.
 *
 * Each piece is a circular arc of a chosen length and turn angle, expressed as
 * the cubic that best approximates it — control offset `k = 4/3 * r *
 * tan(theta/4)`, the standard construction, exact at both ends in position and
 * tangent and under a thousandth of a radius wrong in between for the turn
 * angles used here. Arcs rather than free cubics because *radius* is the
 * parameter that matters: a ride's minimum turning radius is the thing the
 * family has opinions about, and this way it is a number in the vocabulary
 * rather than an emergent property nobody can name.
 *
 * ### Sign convention
 *
 * Positive `turn` rotates the heading towards `(-hz, hx)`, i.e. the same sense
 * as rotating `(x, z)` by a positive angle in the XZ plane. Which way that
 * looks on screen does not matter to anything here; only that it is consistent,
 * because the closure bias in `generate.ts` picks a turn *sign* to steer home.
 */

/** A position and a unit heading in the horizontal plane. */
export interface Pose2 {
  readonly x: number;
  readonly z: number;
  readonly hx: number;
  readonly hz: number;
}

/** A mutable 2D point, so hot paths can write into a caller's scratch. */
export interface Vec2 {
  x: number;
  z: number;
}

/** One piece of track: a cubic bezier, control points in order. */
export interface CubicSegment {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  readonly x2: number;
  readonly z2: number;
  readonly x3: number;
  readonly z3: number;
  /** Arc length in metres, as asked for when the piece was made. */
  readonly length: number;
  /** Signed turn angle in radians. Zero for a straight. */
  readonly turn: number;
  /** Which kind of piece this is, for the diagnostic report. */
  readonly kind: string;
}

/**
 * A kind of track piece the generator may reach for.
 *
 * `minRadius` is not decoration: it is the promise this kind makes about how
 * tight its tightest instance can be, and the generator reports the minimum
 * across the whole vocabulary as the ride's turning radius.
 */
export interface SegmentKind {
  readonly name: string;
  /** Tightest turn this kind will ever make, in metres. Infinity for straights. */
  readonly minRadius: number;
  /** Sign of the turn: -1, 0 or +1. The closure bias filters on this. */
  readonly turnSign: -1 | 0 | 1;
  make(from: Pose2, rng: { range(min: number, max: number): number }): CubicSegment;
}

/** Two circular arcs meeting at a common tangent, joining two poses exactly. */
export interface Biarc {
  readonly arcs: readonly { readonly length: number; readonly turn: number }[];
  /** The tighter of the two arcs. Known exactly, not sampled. */
  readonly minRadius: number;
}

/** Point on the cubic at parameter `t`. */
export function cubicPoint(seg: CubicSegment, t: number, target: Vec2): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  target.x = a * seg.x0 + b * seg.x1 + c * seg.x2 + d * seg.x3;
  target.z = a * seg.z0 + b * seg.z1 + c * seg.z2 + d * seg.z3;
  return target;
}

/** First derivative at `t`, not normalised. */
export function cubicDerivative(seg: CubicSegment, t: number, target: Vec2): Vec2 {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  target.x = a * (seg.x1 - seg.x0) + b * (seg.x2 - seg.x1) + c * (seg.x3 - seg.x2);
  target.z = a * (seg.z1 - seg.z0) + b * (seg.z2 - seg.z1) + c * (seg.z3 - seg.z2);
  return target;
}

/** Unit tangent at `t`. */
export function cubicTangent(seg: CubicSegment, t: number, target: Vec2): Vec2 {
  cubicDerivative(seg, t, target);
  const m = Math.hypot(target.x, target.z) || 1;
  target.x /= m;
  target.z /= m;
  return target;
}

/**
 * How many points curvature is measured at.
 *
 * Fixed, and shared by everything that asks, because a curvature limit that
 * depends on sample density is not a limit. Sampling a cubic at 24 points let
 * closer pieces with a **0.3 m cusp** pass a 12 m minimum radius: the samples
 * simply straddled the cusp. The generator then reported a solved route with a
 * hairpin tighter than the one the whole exercise was meant to remove.
 */
const CURVATURE_SAMPLES = 64;

/**
 * The tightest radius of curvature anywhere on the piece, or **zero if the
 * piece doubles back on itself**.
 *
 * Measured on the cubic that will actually be built, not inferred from the
 * length and turn angle it was asked for — the closer's pieces are not arcs at
 * all and have no nominal radius, and this is the only honest way to hold them
 * to the same standard as the vocabulary.
 *
 * A cubic whose control points fold produces a cusp: the curve stops, reverses
 * and carries on, and its speed passes through zero. Curvature there is
 * unbounded, but sampled curvature near it is whatever the samples happened to
 * catch, so a cusp cannot be caught reliably by curvature alone. It is caught
 * directly instead — a piece whose speed collapses relative to its own average
 * is reported as radius zero, which fails every minimum-radius test there is.
 *
 * ### `bailBelow` — for the caller that only asks "is it under the limit?"
 *
 * The route search rejects a candidate the moment this returns anything under
 * the brief's minimum radius, and **half of all candidates die exactly here**
 * (canonical seed: 165,228 of 236,320; a Node CPU profile put this function at
 * 14-18% of the whole cruiser solve). A vocabulary arc has near-constant
 * curvature, so a too-tight piece is usually under the limit at the very first
 * sample — yet the full scan carried on through all 65.
 *
 * Passing `bailBelow` returns the first sampled radius found under it, at once.
 * That changes no verdict anywhere: the full-scan result is the *minimum* over
 * all samples, so one sample under the threshold proves the minimum is under it
 * too (and a cusp's 0 is under every threshold), and the caller's
 * `< brief.minRadius` comparison comes out identical. What it may change is the
 * *value* returned for a rejected piece — which that caller never reads. Every
 * caller that uses the value (the solve report's `minRadius`, `buildRoute`'s
 * `minCurvature`) omits `bailBelow` and gets the full scan, unchanged.
 */
export function minCurvatureRadius(
  seg: CubicSegment,
  samples = CURVATURE_SAMPLES,
  bailBelow?: number,
): number {
  // The two derivatives, written out rather than called.
  //
  // This is asked of **every candidate piece the route search draws** — a Node
  // CPU profile of one Sky Cruiser solve put it at 14% of the whole thing —
  // and 65 samples each made two calls that re-derived the same six control
  // differences every time and wrote them into two scratch objects. Hoisting
  // them is the same arithmetic in the same order on the same values, so it is
  // the same floating-point answer to the last bit; it just stops doing it 130
  // times per piece. `cubicDerivative` is still the one owner of the formula
  // for everybody else — this is the same expression, not a second rule.
  const ax = seg.x1 - seg.x0;
  const bx = seg.x2 - seg.x1;
  const cx = seg.x3 - seg.x2;
  const az = seg.z1 - seg.z0;
  const bz = seg.z2 - seg.z1;
  const cz = seg.z3 - seg.z2;
  const sx0 = seg.x2 - 2 * seg.x1 + seg.x0;
  const sx1 = seg.x3 - 2 * seg.x2 + seg.x1;
  const sz0 = seg.z2 - 2 * seg.z1 + seg.z0;
  const sz1 = seg.z3 - 2 * seg.z2 + seg.z1;
  let worst = Infinity;
  let slowest = Infinity;
  let totalSpeed = 0;
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const u = 1 - t;
    const wa = 3 * u * u;
    const wb = 6 * u * t;
    const wc = 3 * t * t;
    const d1x = wa * ax + wb * bx + wc * cx;
    const d1z = wa * az + wb * bz + wc * cz;
    const d2x = 6 * u * sx0 + 6 * t * sx1;
    const d2z = 6 * u * sz0 + 6 * t * sz1;
    const speed = Math.hypot(d1x, d1z);
    totalSpeed += speed;
    if (speed < slowest) slowest = speed;
    const cross = Math.abs(d1x * d2z - d1z * d2x);
    if (speed < 1e-6) return 0;
    // radius = |r'|^3 / |r' x r''|
    const radius = cross < 1e-9 ? Infinity : (speed * speed * speed) / cross;
    if (radius < worst) worst = radius;
    if (bailBelow !== undefined && worst < bailBelow) return worst;
  }
  const meanSpeed = totalSpeed / (samples + 1);
  if (meanSpeed > 0 && slowest < meanSpeed * 0.2) return 0;
  return worst;
}
