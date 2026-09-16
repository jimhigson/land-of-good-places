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
/**
 * The sphere on its own — the ground with the rolling waves switched off.
 *
 * `terrainHeight` is this plus {@link groundWaves} leant onto it, and the split
 * matters to anything that **flies at a constant height**. A ride's rails are
 * not laid on the grass; they are held a fixed distance above the world, and
 * "the world" here is the sphere, not the bumps. A ring that followed
 * `terrainHeight` would ripple with every hummock under it; one held at a
 * constant world `y` — which is what the rail race did while the park was
 * nearly flat — varies its clearance by **11 m** round its own circumference
 * once the sphere is 400 m, because the boundary it follows runs anywhere from
 * 58 m to 110 m out. This is the middle answer, and the only one that means
 * "the same height above the world all the way round".
 */
export function capHeight(x: number, z: number): number {
  const distanceSquared = x * x + z * z;
  return (
    Math.sqrt(Math.max(0, GROUND_SPHERE_RADIUS * GROUND_SPHERE_RADIUS - distanceSquared)) -
    GROUND_SPHERE_RADIUS
  );
}

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

/**
 * **How far this world point is from the centre of the planet.**
 *
 * The cap is tangent to horizontal at the park's origin, so the centre sits at
 * `(0, -GROUND_SPHERE_RADIUS, 0)` — the same centre {@link upAt} measures its
 * direction from, and the same one this file's whole vocabulary is built on.
 *
 * On its own it is one `hypot`. What it is *for* is {@link altitudeAt}, and
 * that is the one to read the docblock of.
 */
export function planetRadiusAt(x: number, y: number, z: number): number {
  return Math.hypot(x, y + GROUND_SPHERE_RADIUS, z);
}

/** The same, for the ground in this column — {@link altitudeAt}'s datum. */
export function groundRadiusAt(x: number, z: number): number {
  return planetRadiusAt(x, terrainHeight(x, z), z);
}

/**
 * **How high this point actually is above the ground — measured from the centre
 * of the planet, not along world `+Y`.**
 *
 * Jim, 14 September 2026, on the arrival camera going through the grass:
 * *"EVERYWHERE that uses altitude now needs to use it relative from the centre
 * of the planet, not absolute, including cameras."* This is that quantity, and
 * it is the one owner of it.
 *
 * **What it replaces, and why the thing it replaces is now wrong.** The whole
 * park is written in the idiom `y - terrainHeight(x, z)` — "how far above the
 * grass is this". That was exactly right while the ground was flat, because
 * world `+Y` and the ground's own normal were the same direction. They are not
 * any more. At the park's reach — 157 m out on a {@link GROUND_SPHERE_RADIUS}
 * of 220 — the ground leans **44 degrees**, so a subtraction along `+Y`
 * over-reads a real clearance by a factor of `1 / cos(44°)` ≈ 1.39 and, worse,
 * compares a point against ground it is not actually over: step 6 m towards the
 * park's centre out there and the terrain climbs nearly 6 m, so "the highest
 * ground within a few metres" — a perfectly sensible question on a flat park —
 * answers with a number that has nothing to do with what is under you.
 *
 * That second failure is the arrival-camera bug in one sentence. Measured on
 * seed 428 before the fix: the door shot's focus was shoved **10 m** into the
 * air by ground it was nowhere near, and the eye still dipped **0.18 m below
 * the grass** at the worst frame — over-lifted and clipping at once, which is
 * the signature of a height measured in the wrong frame rather than a height
 * that is merely wrong.
 *
 * **Both terms are radii from the same centre**, so the tilt cancels exactly
 * and the answer is the clearance a child would feel under her feet. At the
 * park's origin it is identical to `y - terrainHeight(x, z)` to the last
 * decimal, which is why converting a call site can never make a centre-of-park
 * measurement worse.
 *
 * **Outdoors only.** Interiors are real coordinates hundreds of metres away
 * where this formula is meaningless — use plain `y - floorY` there, exactly as
 * `world/up.ts` keeps plain `+Y` for them. This file knows nothing about rooms;
 * ask `isOutdoors` first if the call site can be either.
 */
export function altitudeAt(x: number, y: number, z: number): number {
  return planetRadiusAt(x, y, z) - groundRadiusAt(x, z);
}

/**
 * **The world `y` at which a point in this column stands `altitude` metres above
 * the ground** — the inverse of {@link altitudeAt} that keeps `(x, z)` fixed.
 *
 * The other inverse, {@link liftFromGround}, moves along the local up and so
 * slides `x` and `z` outwards by `altitude · sin(tilt)`. That is exactly right
 * for *placing* something — a prop lifted off the grass leans with the grass —
 * and exactly wrong for anything that has already decided which column it is in
 * and only wants its height back. The camera's follow is the latter: its `x` and
 * `z` are a damped chase of the player and must not be quietly dragged outwards
 * by a lift.
 *
 * `altitudeAt(x, yAtAltitude(x, z, a), z) === a` exactly, for any `a`, because
 * both sides are radii in the same column.
 *
 * The `max(0, …)` is the horizon guard {@link terrainHeight} carries for the
 * same reason: past the sphere's own radius there is no real square root, and a
 * `NaN` leaking into a camera position is how a frame ends up drawing nothing.
 */
export function yAtAltitude(x: number, z: number, altitude: number): number {
  const wanted = groundRadiusAt(x, z) + altitude;
  return Math.sqrt(Math.max(0, wanted * wanted - x * x - z * z)) - GROUND_SPHERE_RADIUS;
}

const _up = /* @__PURE__ */ new Vector3();

/**
 * **The world point `height` metres above the ground at `(x, z)`, measured
 * along the local up** — the inverse of {@link altitudeAt}, and the position
 * half of {@link placeOnSphere} without the rotation.
 *
 * Write `liftFromGround(x, z, 1.4, v)` wherever you would have written
 * `v.set(x, terrainHeight(x, z) + 1.4, z)`. The two agree exactly at the park's
 * centre and diverge with the lean; out at the boundary the old form puts the
 * point 1.4 m up a vertical that the ground no longer agrees with, which both
 * shortens its real clearance to `1.4 · cos(tilt)` and slides it sideways
 * relative to the thing it was supposed to be standing on.
 *
 * **The round trip is exact on the sphere and approximate on the waves**, and
 * the difference is worth knowing before you use it as an equality.
 * `planetRadiusAt(liftFromGround(x, z, h))` is exactly `groundRadiusAt(x, z) + h`
 * by construction — the lift runs along the radial, so the radii simply add.
 * But the lift also moves the point `h · sin(tilt)` sideways, and
 * {@link altitudeAt} takes its datum from the ground in the *new* column. The
 * cap contributes nothing to that (every column of a sphere has the same ground
 * radius), so the whole discrepancy is the **wave field's** change over that
 * sideways step: bounded by `groundWaves`'s own amplitude, a few centimetres at
 * the heights anything here is lifted to. `check:altitude-frame` asserts the
 * round trip against that bound rather than against zero, and prints the worst
 * it found, so the claim cannot quietly become untrue if the waves are retuned.
 */
export function liftFromGround(
  x: number,
  z: number,
  height: number,
  target = new Vector3(),
): Vector3 {
  const ground = terrainHeight(x, z);
  upAt(x, ground, z, _up);
  return target.set(x + _up.x * height, ground + _up.y * height, z + _up.z * height);
}

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
 *
 * **Build time only — once per object, never per frame.** It pre-multiplies,
 * and three.js writes the result straight back into `object.rotation`, so the
 * next `rotation.y = yaw` inherits this tilt as if it had been asked for and
 * leans again on top of it. `world/up.ts`'s `faceOnGround` is the per-frame
 * form; it takes the yaw and never reads what is already there.
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


/**
 * **The inverse of {@link placeOnSphere}: where a drawn point was authored.**
 *
 * `placeOnSphere` takes an `(x, z)` and a height above the ground there, and
 * leans the height along the local up. So a drawn point lies on the ray from the
 * planet's centre through its own foot, and the foot is where that ray meets the
 * ground. This finds the foot and hands back `(foot.x, ground + altitude,
 * foot.z)` — the flat-frame point every ride planner in this park solves in.
 *
 * It exists for measurement. A built mesh is drawn leant; the plan it was built
 * from is flat. Comparing the one against the other's `(x, z)` reads the lean
 * itself as an error — `height · sin(tilt)`, several metres at a ride's height
 * out at the boundary — and that one mix accounted for most of a day's red
 * procgen invariants. Unlean the drawn point, then compare like with like.
 *
 * Exact at convergence: `placeOnSphere(unplaceFromSphere(p))` returns `p`. The
 * foot is solved by the same fixed point `geo/ground.ts`'s `groundRadiusToward`
 * uses (only the waves move between steps, so it contracts fast).
 */
export function unplaceFromSphere(
  drawn: { readonly x: number; readonly y: number; readonly z: number },
  target = new Vector3(),
): Vector3 {
  const cy = drawn.y + GROUND_SPHERE_RADIUS;
  const radius = Math.hypot(drawn.x, cy, drawn.z);
  const dx = drawn.x / radius;
  const dz = drawn.z / radius;
  let ground = GROUND_SPHERE_RADIUS;
  for (let step = 0; step < 6; step += 1) {
    const x = dx * ground;
    const z = dz * ground;
    ground = Math.hypot(x, terrainHeight(x, z) + GROUND_SPHERE_RADIUS, z);
  }
  const footX = dx * ground;
  const footZ = dz * ground;
  return target.set(footX, terrainHeight(footX, footZ) + (radius - ground), footZ);
}
