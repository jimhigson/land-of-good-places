import { TAU } from '../../core/mathUtils';

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

/**
 * Beyond about 100 degrees the single-cubic arc approximation starts to be
 * visible, so a piece that would turn further is shortened rather than
 * approximated badly. Splitting into two cubics would also work; shortening is
 * simpler and the generator can always place a second piece.
 */
const MAX_TURN = (100 / 360) * TAU;

/** Rotates (x, z) by `angle`, the same sense `turn` is measured in. */
function rotate(x: number, z: number, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x * c - z * s, z: x * s + z * c };
}

/**
 * The piece of track that leaves `from` and turns through `turn` over `length`
 * metres of arc — as the cubic that matches it at both ends.
 */
export function arcSegment(from: Pose2, length: number, turn: number, kind: string): CubicSegment {
  const theta = Math.max(-MAX_TURN, Math.min(MAX_TURN, turn));
  // Control offset. As theta -> 0 this tends to length/3, which is exactly the
  // straight case, so there is no special-casing to get subtly wrong — only a
  // guard against dividing by an angle of zero.
  const k =
    Math.abs(theta) < 1e-6
      ? length / 3
      : (4 / 3) * (length / Math.abs(theta)) * Math.tan(Math.abs(theta) / 4);

  const end = endOfArc(from, length, theta);
  return {
    x0: from.x,
    z0: from.z,
    x1: from.x + from.hx * k,
    z1: from.z + from.hz * k,
    x2: end.x - end.hx * k,
    z2: end.z - end.hz * k,
    x3: end.x,
    z3: end.z,
    length,
    turn: theta,
    kind,
  };
}

/** Where a circular arc of this length and turn angle ends up, and facing where. */
function endOfArc(from: Pose2, length: number, theta: number): Pose2 {
  const heading = rotate(from.hx, from.hz, theta);
  if (Math.abs(theta) < 1e-6) {
    return {
      x: from.x + from.hx * length,
      z: from.z + from.hz * length,
      hx: from.hx,
      hz: from.hz,
    };
  }
  // Signed radius: the centre sits on the left normal for a positive turn and
  // the right normal for a negative one, which the sign of length/theta gives
  // for free.
  const radius = length / theta;
  const cx = from.x + -from.hz * radius;
  const cz = from.z + from.hx * radius;
  const spun = rotate(from.x - cx, from.z - cz, theta);
  return { x: cx + spun.x, z: cz + spun.z, hx: heading.x, hz: heading.z };
}

/**
 * A run of track of the given length and total turn, split into as many cubics
 * as it takes to keep each one inside {@link MAX_TURN}.
 *
 * Splitting rather than clamping matters: `arcSegment` silently shortens a turn
 * it considers too sharp, which is fine when the generator is free to place
 * whatever piece it likes and *fatal* for the closer, whose whole job is to
 * land on an exact pose. A clamped closer would quietly miss the start.
 */
export function arcChain(from: Pose2, length: number, turn: number, kind: string): CubicSegment[] {
  const pieces = Math.max(1, Math.ceil(Math.abs(turn) / MAX_TURN));
  const out: CubicSegment[] = [];
  let pose = from;
  for (let i = 0; i < pieces; i += 1) {
    const seg = arcSegment(pose, length / pieces, turn / pieces, kind);
    out.push(seg);
    pose = endPose(seg);
  }
  return out;
}

/** Two circular arcs meeting at a common tangent, joining two poses exactly. */
export interface Biarc {
  readonly arcs: readonly { readonly length: number; readonly turn: number }[];
  /** The tighter of the two arcs. Known exactly, not sampled. */
  readonly minRadius: number;
}

/** Signed angle from unit `u` to unit `w`, in the same sense as `turn`. */
function signedAngle(ux: number, uz: number, wx: number, wz: number): number {
  return Math.atan2(ux * wz - uz * wx, ux * wx + uz * wz);
}

/**
 * **The closer.** Joins two poses exactly, with two circular arcs.
 *
 * A biarc is the right tool for landing on a given pose, and the wrong tool was
 * tried first: a Hermite cubic between the two poses also matches both
 * tangents, but its *curvature* is whatever falls out, and when the poses are
 * awkwardly placed what falls out is a **cusp** — the curve stops, reverses and
 * carries on. Sampled curvature cannot reliably see a cusp (the samples
 * straddle it), so cusped closers passed a 12 m minimum-radius test and the
 * generator happily returned loops with a 0.3 m hairpin in them.
 *
 * A biarc has no such failure mode, because its two radii are *known* — they
 * come out of the construction as numbers, not as something to measure
 * afterwards and hope about. A biarc that would turn too tightly says so
 * exactly, and the search moves on.
 *
 * The construction is the standard equal-chord one: pick `d` such that the two
 * arcs share a tangent at their joint, which reduces to a quadratic. Both roots
 * are offered, gentlest first, since one is often a far wider turn than the
 * other.
 */
export function biarcs(from: Pose2, to: Pose2): Biarc[] {
  const vx = to.x - from.x;
  const vz = to.z - from.z;
  const tx = from.hx + to.hx;
  const tz = from.hz + to.hz;
  const a = 2 - 2 * (from.hx * to.hx + from.hz * to.hz);
  const b = 2 * (vx * tx + vz * tz);
  const c = -(vx * vx + vz * vz);

  const roots: number[] = [];
  if (Math.abs(a) < 1e-9) {
    // Headings are parallel: the quadratic degenerates to a linear equation.
    if (Math.abs(b) > 1e-9) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      roots.push((-b + root) / (2 * a), (-b - root) / (2 * a));
    }
  }

  const out: Biarc[] = [];
  for (const d of roots) {
    if (!(d > 1e-6) || !Number.isFinite(d)) continue;
    const jx = (from.x + d * from.hx + (to.x - d * to.hx)) / 2;
    const jz = (from.z + d * from.hz + (to.z - d * to.hz)) / 2;
    const first = arcThrough(from, jx, jz);
    if (!first) continue;
    const midHeading = rotate(from.hx, from.hz, first.turn);
    const second = arcThrough({ x: jx, z: jz, hx: midHeading.x, hz: midHeading.z }, to.x, to.z);
    if (!second) continue;
    out.push({
      arcs: [first, second],
      minRadius: Math.min(first.radius, second.radius),
    });
  }
  // Gentlest first: a wider pair is a nicer ride and likelier to be legal.
  out.sort((p, q) => q.minRadius - p.minRadius);
  return out;
}

/** The single arc leaving `from` that passes through (x, z). */
function arcThrough(
  from: Pose2,
  x: number,
  z: number,
): { length: number; turn: number; radius: number } | null {
  const cx = x - from.x;
  const cz = z - from.z;
  const chord = Math.hypot(cx, cz);
  if (chord < 1e-6) return null;
  const phi = signedAngle(from.hx, from.hz, cx / chord, cz / chord);
  // Turning more than a half circle to reach a chord is the degenerate branch;
  // the other root is the one that means anything.
  if (Math.abs(phi) > Math.PI / 2 - 1e-9) return null;
  if (Math.abs(phi) < 1e-9) return { length: chord, turn: 0, radius: Infinity };
  const radius = chord / (2 * Math.sin(Math.abs(phi)));
  const turn = 2 * phi;
  return { length: radius * Math.abs(turn), turn, radius };
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
 */
export function minCurvatureRadius(seg: CubicSegment, samples = CURVATURE_SAMPLES): number {
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
  }
  const meanSpeed = totalSpeed / (samples + 1);
  if (meanSpeed > 0 && slowest < meanSpeed * 0.2) return 0;
  return worst;
}

/** Arc length of the cubic, by dense chordal sampling. */
export function cubicLength(seg: CubicSegment, samples = 32): number {
  const a: Vec2 = { x: 0, z: 0 };
  const b: Vec2 = { x: 0, z: 0 };
  cubicPoint(seg, 0, a);
  let total = 0;
  for (let i = 1; i <= samples; i += 1) {
    cubicPoint(seg, i / samples, b);
    total += Math.hypot(b.x - a.x, b.z - a.z);
    a.x = b.x;
    a.z = b.z;
  }
  return total;
}

/** The pose a piece hands on to the next one. */
export function endPose(seg: CubicSegment): Pose2 {
  const t: Vec2 = { x: 0, z: 0 };
  cubicTangent(seg, 1, t);
  return { x: seg.x3, z: seg.z3, hx: t.x, hz: t.z };
}

/**
 * Builds a vocabulary of turn kinds from radius bands.
 *
 * Each band becomes a left piece and a right piece; `straight` is added once.
 * A piece picks its radius and length inside the band from the route's own RNG,
 * so two rides sharing a vocabulary still grow different track.
 */
export function turnVocabulary(
  bands: readonly { readonly name: string; readonly minRadius: number; readonly maxRadius: number; readonly minLength: number; readonly maxLength: number }[],
  straight: { readonly minLength: number; readonly maxLength: number } | null,
): readonly SegmentKind[] {
  const kinds: SegmentKind[] = [];
  if (straight) {
    kinds.push({
      name: 'straight',
      minRadius: Infinity,
      turnSign: 0,
      make: (from, rng) =>
        arcSegment(from, rng.range(straight.minLength, straight.maxLength), 0, 'straight'),
    });
  }
  for (const band of bands) {
    for (const sign of [1, -1] as const) {
      kinds.push({
        name: `${band.name}${sign > 0 ? 'Left' : 'Right'}`,
        minRadius: band.minRadius,
        turnSign: sign,
        make: (from, rng) => {
          const radius = rng.range(band.minRadius, band.maxRadius);
          const length = rng.range(band.minLength, band.maxLength);
          return arcSegment(from, length, (sign * length) / radius, `${band.name}${sign > 0 ? 'Left' : 'Right'}`);
        },
      });
    }
  }
  return kinds;
}
