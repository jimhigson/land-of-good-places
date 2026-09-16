import { Vector3 } from 'three';
import { Geo } from './Geo';

const _up = /* @__PURE__ */ new Vector3();
const _tangent = /* @__PURE__ */ new Vector3();
const _axis = /* @__PURE__ */ new Vector3();

/**
 * **Walk `metres` along the surface, on a heading, and come out facing the
 * right way.**
 *
 * This is the locomotion primitive, and it replaces every
 * `position.x += dir.x * speed * dt` in the codebase. Two things happen at
 * once, and *both* are why it is one function rather than two:
 *
 * - The position rotates about the planet's centre, along the great circle that
 *   the heading points down. It keeps its radius exactly, so a child walking
 *   does not sink or climb.
 * - **The heading is parallel-transported with it.** A direction that was
 *   tangent at the start is no longer tangent at the end — it points into the
 *   sky by the angle walked — so carrying it unchanged is how a mover slowly
 *   lifts off the ground over a long run. Rotating it by the same amount keeps
 *   it tangent exactly.
 *
 * ## Why this, and not "re-derive the position from an altitude"
 *
 * Because that was tried, measured, and loses the surface. An engineer on
 * `eng/radial-collide` found that re-deriving a mover's position from its
 * altitude each step **teleports it sideways**, and 401 of 1280 runs came off
 * the ground. The reason is the one in `terrain.ts`'s `liftFromGround` docblock
 * read backwards: a lift along the radial moves `x` and `z` too, so a round
 * trip through a scalar altitude is not the identity. A rotation is.
 *
 * `heading` is updated in place and stays unit. Pass a heading that is not
 * tangent and you get the rotation anyway, which is the sensible answer for a
 * velocity with a vertical component: its tangential part turns with the
 * planet and its radial part is left alone.
 */
export function advance(g: Geo, heading: Vector3, metres: number): void {
  if (metres === 0) return;
  const r = g.radius();
  if (r === 0) return;
  g.up(_up);
  // The axis of the great circle: perpendicular to both the up and the heading.
  _axis.crossVectors(_up, heading);
  const al = _axis.length();
  // A heading with no tangential component — straight up or straight down — has
  // no great circle to follow, and the honest answer is that nothing moves
  // along the surface. Returning here rather than normalising a zero vector is
  // the difference between "no movement" and "every component NaN".
  if (al < 1e-12) return;
  _axis.multiplyScalar(1 / al);
  const theta = metres / r;
  rotateGeoAbout(g, _axis, theta);
  heading.applyAxisAngle(_axis, theta);
}

/** Rodrigues' rotation, applied to a position about an axis through the planet's centre. */
export function rotateGeoAbout(g: Geo, axis: Readonly<Vector3>, radians: number): void {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dot = g.cx * axis.x + g.cy * axis.y + g.cz * axis.z;
  const k = dot * (1 - cos);
  const crossX = axis.y * g.cz - axis.z * g.cy;
  const crossY = axis.z * g.cx - axis.x * g.cz;
  const crossZ = axis.x * g.cy - axis.y * g.cx;
  g.set(
    g.cx * cos + crossX * sin + axis.x * k,
    g.cy * cos + crossY * sin + axis.y * k,
    g.cz * cos + crossZ * sin + axis.z * k,
  );
}

/**
 * The unit tangent at `from` pointing along the great circle towards `to` — the
 * `Geo` answer to "which way is it".
 *
 * The replacement for `atan2(dz, dx)`. A bearing scalar means nothing without a
 * frame to measure it in; a tangent direction means the same thing everywhere
 * and needs no frame, which is why solvers should prefer this and only turn it
 * into a bearing at the point where something has to be drawn.
 *
 * Two positions on the same radial have no direction between them, and this
 * returns a zero vector rather than a NaN one. Check `lengthSq()` if the caller
 * can be handed a degenerate pair.
 */
export function tangentTowards(
  from: Readonly<Geo>,
  to: Readonly<Geo>,
  target: Vector3,
): Vector3 {
  from.up(_up);
  _tangent.set(to.cx, to.cy, to.cz).normalize();
  const dot = _tangent.dot(_up);
  target.set(
    _tangent.x - _up.x * dot,
    _tangent.y - _up.y * dot,
    _tangent.z - _up.z * dot,
  );
  const l = target.length();
  if (l < 1e-12) return target.set(0, 0, 0);
  return target.multiplyScalar(1 / l);
}

/**
 * Interpolate along the surface — a slerp of the two directions, with the radii
 * interpolated linearly.
 *
 * The replacement for `Vector3.lerp` on anything that is a *place*. A straight
 * lerp cuts the corner through the planet: negligible over a metre, 1.1 m short
 * over 100 m on this planet, and the thing that makes a long rail run sit
 * slightly under its own ground.
 */
export function geodesicLerp(a: Readonly<Geo>, b: Readonly<Geo>, t: number, target: Geo): Geo {
  const ra = a.radius();
  const rb = b.radius();
  if (ra === 0 || rb === 0) {
    return target.set(
      a.cx + (b.cx - a.cx) * t,
      a.cy + (b.cy - a.cy) * t,
      a.cz + (b.cz - a.cz) * t,
    );
  }
  const ax = a.cx / ra;
  const ay = a.cy / ra;
  const az = a.cz / ra;
  const bx = b.cx / rb;
  const by = b.cy / rb;
  const bz = b.cz / rb;
  let cos = ax * bx + ay * by + az * bz;
  cos = cos < -1 ? -1 : cos > 1 ? 1 : cos;
  const theta = Math.acos(cos);
  const r = ra + (rb - ra) * t;
  // Coincident (or near-coincident) directions: the slerp weights go to 0/0 and
  // the linear blend is both correct and stable there.
  if (theta < 1e-7) {
    const dx = ax + (bx - ax) * t;
    const dy = ay + (by - ay) * t;
    const dz = az + (bz - az) * t;
    const l = Math.hypot(dx, dy, dz) || 1;
    return target.set((dx / l) * r, (dy / l) * r, (dz / l) * r);
  }
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return target.set(
    (ax * wa + bx * wb) * r,
    (ay * wa + by * wb) * r,
    (az * wa + bz * wb) * r,
  );
}

const _ua = /* @__PURE__ */ new Vector3();
const _ub = /* @__PURE__ */ new Vector3();
const _up2 = /* @__PURE__ */ new Vector3();
const _normal = /* @__PURE__ */ new Vector3();
const _proj = /* @__PURE__ */ new Vector3();

/** The angle between two unit vectors, clamped so acos cannot hand back NaN. */
const angleBetweenUnits = (a: Readonly<Vector3>, b: Readonly<Vector3>): number => {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(dot < -1 ? -1 : dot > 1 ? 1 : dot);
};

/**
 * **How far `p` is from the geodesic arc running from `a` to `b`, along the
 * surface, in metres.**
 *
 * The sphere's answer to point-to-segment distance, and the missing half of the
 * claims registry: `boot/groundClaims.ts`'s `Capsule` — the shape of every
 * path, rail run, road, wall and bridge deck in the park — is a segment with a
 * half-width, and its distance kernel was `distPointSegment`, plane geometry
 * over world `(x, z)`.
 *
 * That is not merely approximate, it is measurably wrong in a direction that
 * matters: world `(x, z)` is an **orthographic** projection of this planet
 * (`terrain.ts` puts the ground for `(x, z)` at `√(R² − x² − z²) − R`), so its
 * radial axis compresses by `cos θ`. A flat `hypot` reads a 1 m radial gap as
 * 1 m where a child walks 1/cos θ — 1.12 m at 100 m from the origin, 1.37 m at
 * 150 m — and a demand disc is stretched by the same factor.
 * `scripts/claim-chart-error.mts` prints that table from the constants.
 *
 * ## How it works, and the case that makes it more than one line
 *
 * The arc from `a` to `b` lies on the great circle whose normal is `â × b̂`. The
 * **cross-track** distance from `p` to that whole great circle is
 * `R · |asin(p̂ · n̂)|` — exact, closed form, no iteration.
 *
 * But a great circle is not a segment. The cross-track answer is only right
 * where `p` projects *onto the arc itself*; beyond either end the nearest point
 * is that end, and using cross-track there gives a distance to a piece of
 * circle the claim does not occupy — which on a closed loop means the far side
 * of the planet. So `p` is projected onto the great circle and the projection
 * is tested for lying between the endpoints (the angles sum), falling back to
 * the nearer endpoint when it does not. That is the spherical form of the `t`
 * clamp in the planar version, and skipping it is the bug that makes a ring
 * claim appear to cover ground it is nowhere near.
 *
 * Degenerate pairs are handled rather than producing NaN: endpoints that
 * coincide (no great circle is defined) reduce to a point distance, which is
 * also the right answer.
 *
 * Radii are ignored — this is a distance **along the ground**, and both the
 * claims registry and everything that asks it care about bearing, not height.
 */
export function arcToSegment(
  p: Readonly<Geo>,
  a: Readonly<Geo>,
  b: Readonly<Geo>,
  radius: number,
): number {
  const rp = p.radius();
  const ra = a.radius();
  const rb = b.radius();
  if (rp === 0 || ra === 0 || rb === 0) return 0;
  _up2.set(p.cx / rp, p.cy / rp, p.cz / rp);
  _ua.set(a.cx / ra, a.cy / ra, a.cz / ra);
  _ub.set(b.cx / rb, b.cy / rb, b.cz / rb);

  const toA = radius * angleBetweenUnits(_up2, _ua);
  const toB = radius * angleBetweenUnits(_up2, _ub);
  const ends = toA < toB ? toA : toB;

  _normal.crossVectors(_ua, _ub);
  const nl = _normal.length();
  // Coincident or antipodal endpoints: there is no unique great circle through
  // them, and the honest answer is the distance to the ends themselves.
  if (nl < 1e-12) return ends;
  _normal.multiplyScalar(1 / nl);

  // Signed cross-track: how far off the great circle's plane `p` sits.
  const offPlane = _up2.dot(_normal);
  // The projection of `p` onto the great circle, normalised back to the sphere.
  _proj.set(
    _up2.x - _normal.x * offPlane,
    _up2.y - _normal.y * offPlane,
    _up2.z - _normal.z * offPlane,
  );
  const pl = _proj.length();
  // `p` sits exactly on the great circle's own axis — every point of the arc is
  // equidistant, and the endpoints give that distance correctly.
  if (pl < 1e-12) return ends;
  _proj.multiplyScalar(1 / pl);

  // Is the projection *on the arc*, rather than on the far side of the circle?
  // The angles sum to the whole only between the endpoints.
  const span = angleBetweenUnits(_ua, _ub);
  const viaProjection = angleBetweenUnits(_ua, _proj) + angleBetweenUnits(_proj, _ub);
  if (viaProjection > span + 1e-9) return ends;

  const crossTrack = radius * Math.abs(Math.asin(offPlane < -1 ? -1 : offPlane > 1 ? 1 : offPlane));
  // The clamp cannot make the answer larger than going round by an end.
  return crossTrack < ends ? crossTrack : ends;
}

/** Scratch-free convenience: a new `Geo` `metres` along `heading` from `g`. */
export function advancedFrom(
  g: Readonly<Geo>,
  heading: Readonly<Vector3>,
  metres: number,
): Geo {
  const out = new Geo().copy(g);
  const h = new Vector3().copy(heading);
  advance(out, h, metres);
  return out;
}
