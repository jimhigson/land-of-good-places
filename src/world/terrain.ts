import { Quaternion, Vector3, type Object3D } from 'three';
import { GROUND_SPHERE_RADIUS, TERRAIN_HEIGHT_SCALE } from '../core/constants';

/**
 * The shape of the ground, as a pure function.
 *
 * Everything that needs to sit on the grass — the player's feet, tree trunks,
 * fence posts, path ribbons — calls {@link terrainHeight} rather than
 * ray-casting against the mesh. It is a handful of sine waves, so it is cheap
 * enough to call thousands of times per frame and, being deterministic, the
 * world looks identical on every reload.
 *
 * Amplitude is deliberately tiny: the design calls for a "big flat-ish garden",
 * and steep ground would fight the fixed isometric camera.
 */
export function terrainHeight(x: number, z: number): number {
  const base = groundWaves(x, z);

  // **The ground is a piece of a very large sphere (#511)** — tangent to
  // horizontal at the park's centre, curving away on every bearing.
  //
  // What was here before was a `smoothstep` rim: flat inside the boundary, then
  // a 17 m cliff just outside it, which put the park on a hilltop. Jim asked for
  // that to go — *"just not make the park on a hill. Let the land spread out in
  // all directions for a long way"* — and, when a flat apron was proposed as the
  // fix for the road-versus-ride contention outside the wall, ruled that out
  // too: *"there should be no 'flat ground' it is a sphere"*.
  //
  // **Why a sphere rather than simply deleting the rim.** The rim was not
  // decoration; it was the only thing letting any sky be seen at ground level,
  // because an orthographic camera pitched 38° never sees a horizon over a
  // plane — sky appears only where the ground *runs out*. Deleting it alone
  // gives a flat disc ending in a cut edge at eye level. A sphere restores a
  // real horizon instead of a cliff, and it is the shape a child would draw for
  // "the world". It only *reads* as a horizon under a perspective camera, which
  // is why #511's ground work and the projection change are one piece of work
  // and not two — see HANDOFF-no-hill-511.md.
  //
  // Exact spherical cap rather than the `d²/2R` paraboloid everyone writes: at
  // these distances they differ by centimetres, but the exact form cannot
  // quietly stop being a sphere far out, and one `sqrt` is nothing against the
  // three trigonometric calls above it.
  //
  // `Math.max(0, …)` guards the horizon itself: past `GROUND_SPHERE_RADIUS` the
  // cap has curved through vertical and there is no real square root. No ground
  // is authored within two orders of magnitude of that, but a NaN leaking into
  // `terrainHeight` would put every prop in the park at `NaN` height, and this
  // is one line.
  const distanceSquared = x * x + z * z;
  const rise = Math.sqrt(
    Math.max(0, GROUND_SPHERE_RADIUS * GROUND_SPHERE_RADIUS - distanceSquared),
  );
  const fall = GROUND_SPHERE_RADIUS - rise;

  // **The waves ride on the sphere's surface, not on a flat plane under it.**
  // Jim, 12 September 2026: *"that's fine, apply the sine waves on the surface
  // of the sphere."*
  //
  // What that means geometrically: the wave is a displacement of `base` metres
  // along the **local surface normal** — which on a sphere is the radial
  // direction, the same "up" the rest of the outdoor world now uses. Its
  // vertical component is therefore `base * cos(tilt)`, and `cos(tilt)` is
  // `rise / R`. At the park's centre that is 1 and nothing changes; out at the
  // road's reach the wave leans with the ground instead of standing stubbornly
  // vertical over it.
  //
  // This is not cosmetic. Stacked the old way, the wave's gradient and the
  // cap's gradient were both measured in the same vertical axis and simply
  // added — which is why the ground's worst measured slope ran two to three
  // points steeper than the cap alone. Displaced along the normal, the wave's
  // slope is the slope a child feels **relative to her own up**, and it no
  // longer inherits the cap's tilt. See HANDOFF-ground-gradient.md for the
  // before-measurements.
  return base * (rise / GROUND_SPHERE_RADIUS) - fall;
}

/**
 * The rolling sine waves, in metres of displacement **along the local surface
 * normal** — not in metres of world Y.
 *
 * Split out from {@link terrainHeight} so there is exactly one owner of the
 * wave field. `terrainHeight` leans it onto the sphere; anything that wants to
 * know how bumpy the ground is *in its own frame* (the gradient a child or the
 * cat bus feels, which is what `BUS_MAX_GRADE` is really about now) asks this
 * rather than differencing world heights and having the cap's tilt come back
 * in with the answer.
 */
export function groundWaves(x: number, z: number): number {
  const broad = Math.sin(x * 0.055) * Math.cos(z * 0.048) * 0.62;
  const medium = Math.sin(x * 0.108 + 1.7) * Math.sin(z * 0.094 - 0.6) * 0.3;
  const fine = Math.cos((x + z) * 0.031) * 0.34;
  return (broad + medium + fine) * TERRAIN_HEIGHT_SCALE;
}

/**
 * **"Up", outdoors: away from the centre of the ground sphere.**
 *
 * Jim, 12 September 2026: *"I want 'up' everywhere to mean away from the centre
 * of the sphere. Indoors can still use plain 'up'."*
 *
 * The cap is tangent to horizontal at the park's origin, so its centre sits at
 * `(0, -GROUND_SPHERE_RADIUS, 0)` and the local up at any world point is simply
 * the direction from there to the point. At the origin that is exactly `+Y`, so
 * nothing at the middle of the park moves; a hundred metres out it leans by
 * `asin(d / R)` — about 14° at the road's reach on a 400 m sphere.
 *
 * **Pass the real `y`.** It is small next to `R` and it is tempting to drop it,
 * but a child forty metres up a ferris wheel is forty metres further from the
 * centre than her feet are, and on a small sphere that is a measurable
 * difference in where "up" points. The cost is one add.
 *
 * **This is the outdoor answer only.** Interiors are disjoint spaces hundreds
 * of metres from the park's origin, where this formula would lean everything
 * wildly; they keep plain `+Y`. See {@link INDOOR_UP} and `world/spaces.ts`.
 */
export function upAt(x: number, y: number, z: number, target = new Vector3()): Vector3 {
  return target.set(x, y + GROUND_SPHERE_RADIUS, z).normalize();
}

/** Plain `+Y`, for interiors. A named constant so the choice is legible at the call site. */
export const INDOOR_UP = /* @__PURE__ */ new Vector3(0, 1, 0);

/**
 * Surface normal at a point, from finite differences.
 *
 * Still the *true* normal of the drawn ground, tilt and all — it is what a
 * shadow, a decal or a ramp wants. It is **not** the same thing as
 * {@link upAt}: this one includes the waves, that one is the sphere's own
 * radial. On a flat park they were the same vector, which is why a good deal
 * of code used them interchangeably.
 */
export function terrainNormal(x: number, z: number, target = new Vector3()): Vector3 {
  const e = 0.6;
  const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return target.set(-dx, 2 * e, -dz).normalize();
}

/** Convenience: writes the ground position for an (x, z) into `target`. */
export function groundPoint(x: number, z: number, target = new Vector3()): Vector3 {
  return target.set(x, terrainHeight(x, z), z);
}

const _up = /* @__PURE__ */ new Vector3();

/**
 * The rotation that takes a thing built the old way — standing along `+Y` — and
 * stands it along the outdoor "up" at a world point instead.
 *
 * Use it as a **pre**-multiply, never a replacement: a prop's own yaw is still
 * a rotation about its own up axis, and `tilt * yaw` keeps that meaning while
 * `yaw * tilt` does not.
 *
 * ```ts
 * mesh.position.set(x, terrainHeight(x, z), z);
 * mesh.rotation.y = bearing;
 * standOnSphere(mesh);
 * ```
 */
export function tiltToSphere(
  x: number,
  y: number,
  z: number,
  target = new Quaternion(),
): Quaternion {
  return target.setFromUnitVectors(INDOOR_UP, upAt(x, y, z, _up));
}

const _tilt = /* @__PURE__ */ new Quaternion();

/**
 * Lean an already-positioned, already-yawed outdoor object onto the sphere.
 *
 * Reads the object's own `position`, so **set the position first**. It is the
 * one-line form of {@link tiltToSphere} and is what almost every call site
 * wants; reach for the quaternion directly only when you are composing a
 * transform by hand.
 */
export function standOnSphere(object: Object3D): void {
  const { x, y, z } = object.position;
  object.quaternion.premultiply(tiltToSphere(x, y, z, _tilt));
}

/**
 * **The one map from the flat frame everything in this park was authored in,
 * onto the sphere.**
 *
 * Nearly every prop here is placed as "an (x, z), and a height above the ground
 * at that (x, z)" — `position.set(x, terrainHeight(x, z) + 1.4, z)` is the
 * commonest line in the whole codebase. That description is still exactly what
 * the author meant; what has changed is that "above" now leans. This turns the
 * one into the other:
 *
 * - the foot stays put, on the ground, at the (x, z) it was given;
 * - the height is re-measured **along the local up** instead of along world Y,
 *   so the thing leans away from the park's centre;
 * - the yaw it was given is still a turn about its own up.
 *
 * **Why the foot and not the centre.** A tree's canopy and its trunk are
 * separate instances with separate world positions, and rotating each about its
 * own centre would pull the tree apart — the trunk would lean and the ball
 * would stay. Measuring both from the ground under them keeps the tree rigid,
 * because a rigid lean *is* what "same foot, height along the same up" means.
 *
 * Writes into `position` and `quaternion`; reads `flat` without touching it, so
 * it is safe to pass a stored authoring position and call this every rebuild.
 */
export function placeOnSphere(
  flat: { x: number; y: number; z: number },
  yaw: number,
  position: Vector3,
  quaternion: Quaternion,
): void {
  const ground = terrainHeight(flat.x, flat.z);
  upAt(flat.x, ground, flat.z, _up);
  const height = flat.y - ground;
  position.set(
    flat.x + _up.x * height,
    ground + _up.y * height,
    flat.z + _up.z * height,
  );
  quaternion
    .setFromAxisAngle(INDOOR_UP, yaw)
    .premultiply(_tilt.setFromUnitVectors(INDOOR_UP, _up));
}
