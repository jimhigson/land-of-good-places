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
