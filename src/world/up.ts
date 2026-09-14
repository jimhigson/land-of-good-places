import { Euler, Quaternion, Vector3, type Object3D } from 'three';
import { GROUND_SPHERE_RADIUS } from '../core/constants';
import { SPACE_GARDEN, spaceAt } from './spaces';
import { INDOOR_UP, planetRadiusAt, tiltToSphere, upAt } from './terrain';

/**
 * **Which way is up, for a thing that might be indoors or out.**
 *
 * Jim, 12 September 2026: *"I want 'up' everywhere to mean away from the centre
 * of the sphere. Indoors can still use plain 'up'."* Two answers, and this file
 * is the one place that chooses between them.
 *
 * `world/terrain.ts` owns the outdoor answer and knows nothing about rooms;
 * `world/spaces.ts` owns which room a coordinate is in and knows nothing about
 * spheres. Anything that moves between the two — the player, an NPC, a pet, a
 * carried balloon — asks here, and a module that is only ever outdoors (the
 * treeline, the railway, the lamp posts) may go straight to `terrain.ts` and
 * save the lookup.
 *
 * **Why the branch has to exist at all, rather than one formula everywhere.**
 * Interiors are not a mode; they are real coordinates a very long way off. The
 * castle's floors and the hotel's rooms sit six hundred metres from the park's
 * origin, and `upAt` at six hundred metres on a four-hundred-metre sphere leans
 * by **fifty-six degrees**. Applied blind, the first thing a child would see on
 * walking into the hotel is the entire lobby lying on its side. So the rule is
 * not "tilt unless told otherwise"; it is "ask which space you are in", which
 * is exactly the question `spaceAt` already answers for collision and for the
 * walk surfaces.
 */
export function upFor(x: number, y: number, z: number, target = new Vector3()): Vector3 {
  if (spaceAt(x, z) !== SPACE_GARDEN) return target.copy(INDOOR_UP);
  return upAt(x, y, z, target);
}

/** True when this world position is out in the park, where up leans. */
export function isOutdoors(x: number, z: number): boolean {
  return spaceAt(x, z) === SPACE_GARDEN;
}

const _eyeTilt = /* @__PURE__ */ new Quaternion();

/**
 * **Where a camera's eye actually ends up — the one owner of that question.**
 *
 * Every fixed-angle rig in this game is "stand `distance` back on bearing
 * `yaw`, pitched `pitch` down", which `core/cameraRig.ts` turns into an offset
 * from the focus. That offset is solved in the **flat** frame, because a yaw
 * and a pitch are angles against a ground plane and the park was authored on
 * one. Outdoors there is no longer a single ground plane, so the offset has to
 * be rotated into the local frame at the focus before it means anything.
 *
 * **Why this is a shared function and not four lines inside `IsoCamera`.** It
 * was four lines inside `IsoCamera`, and the arrival camera — which has to know
 * where its own eye will land, in order to stand it clear of the grass — had a
 * second, *flat* model of the same thing. So did
 * `scripts/check-arrival-camera.mts`, which is how the check stayed green while
 * the shot dipped 0.18 m under the ground on seed 428: it was measuring a
 * camera nobody renders. Two definitions of one thing kept in step by hand, in
 * the place this repo has paid for that most often.
 *
 * Writes the eye into `eye` and the frame's up into `up`, because every caller
 * wants both and re-deriving `up` is the other half of the same mistake.
 * Indoors `upFor` hands back plain `+Y`, the rotation is the identity, and this
 * collapses to `focus + offset` — which is exactly what it should be.
 */
export function eyeForFocus(
  focus: Readonly<Vector3>,
  flatOffset: { readonly x: number; readonly y: number; readonly z: number },
  eye: Vector3,
  up: Vector3,
): void {
  upFor(focus.x, focus.y, focus.z, up);
  _eyeTilt.setFromUnitVectors(INDOOR_UP, up);
  eye.set(flatOffset.x, flatOffset.y, flatOffset.z).applyQuaternion(_eyeTilt).add(focus);
}

const _tilt = /* @__PURE__ */ new Quaternion();
const _euler = /* @__PURE__ */ new Euler();

/**
 * Point an object along a yaw (and optionally a pitch) **and** stand it on the
 * ground it is on — written from scratch, so it is safe to call every frame.
 *
 * **Use this, not {@link standOnGround}, for anything that is re-oriented each
 * tick**, and it is worth knowing exactly why, because the wrong one of the two
 * does not look wrong for the first second.
 *
 * `object.rotation.y = yaw` does not set the *rotation* to a yaw. It rebuilds
 * the quaternion from **all three** Euler components, and `x` and `z` are
 * whatever they were last frame. Tilt by a pre-multiply and the tilt is
 * decomposed straight back into `rotation.x` and `rotation.z`; the next frame's
 * `rotation.y =` picks those up as if they were intentional and the tilt is
 * applied on top of itself. Measured on the player at the park's boundary: a
 * 10.5 degree lean, then `rotation.x = -0.59` on the first frame and
 * `(1.11, 3.14)` a second later — she was slowly tumbling. The first screenshot
 * of it happened to catch her the right way up, which is the whole reason this
 * paragraph exists.
 *
 * So this takes the yaw as an argument and never reads what is already there.
 * The build-time helpers may pre-multiply safely, because they run once.
 */
export function faceOnGround(object: Object3D, yaw: number, pitch = 0): void {
  object.quaternion.setFromEuler(_euler.set(pitch, yaw, 0));
  const { x, y, z } = object.position;
  if (spaceAt(x, z) !== SPACE_GARDEN) return;
  object.quaternion.premultiply(tiltToSphere(x, y, z, _tilt));
}

/**
 * Lean an already-positioned, already-yawed object onto the ground it is
 * standing on — the sphere outdoors, plain `+Y` in any interior.
 *
 * The space-aware twin of `terrain.ts`'s `standOnSphere`. Reads the object's
 * own `position`, so set the position first; pre-multiplies, so the object's
 * yaw keeps meaning "a turn about its own up".
 *
 * **Build time only.** Called once, on an object being assembled, it is exactly
 * right. Called every frame on an object whose orientation is written as
 * `rotation.y = yaw`, it compounds its own tilt until the thing tumbles — see
 * {@link faceOnGround}, which exists for that case and is the one to reach for
 * if there is any doubt.
 *
 * Indoors this is a no-op by construction rather than by a flag somebody has to
 * remember to clear, which matters because the same character object is used in
 * both places and is never rebuilt at the door.
 */
export function standOnGround(object: Object3D): void {
  const { x, y, z } = object.position;
  if (spaceAt(x, z) !== SPACE_GARDEN) return;
  object.quaternion.premultiply(tiltToSphere(x, y, z, _tilt));
}

/**
 * **The height of a point in a frame its neighbours agree with** — the scalar
 * two nearby standing places may be differenced against each other.
 *
 * This is the one owner of "is that a step up?", and it exists because world
 * `y` stopped being able to answer it. Outdoors, `y` is dominated by *where you
 * are* rather than *how high you are*: the radial gradient reaches 1.02 m of
 * `y` per metre walked outward at the park's reach, so a half-metre step across
 * level grass at 157 m differences to 0.52 m of `y` — and a diagonal one to
 * **0.729 m**, past `NavGrid`'s own 0.62 m walking step. Measured, not read:
 * `scratch/nav-control.mts`.
 *
 * So outdoors the answer is the **distance from the centre of the planet**,
 * offset by {@link GROUND_SPHERE_RADIUS} so the number still reads as "metres
 * above the park's middle" and so it is numerically interchangeable with the
 * `y` it replaces at the park's origin. The offset is a constant and cancels in
 * every difference; it is there to keep a `Float32Array` of these honest and to
 * stop a debug print looking like nonsense.
 *
 * Indoors it is plain `y`, for exactly the reason {@link upFor} branches: a
 * room six hundred metres from the park's origin would lean by fifty-odd
 * degrees under the radial formula, and its floor is flat.
 *
 * **Why this is not {@link altitudeAt}.** `altitudeAt` answers "how high above
 * *the ground under me*", which is 0 for everyone standing on grass anywhere.
 * That is the right question for a jump and the wrong one for a step: two
 * neighbouring cells both at altitude 0 tell you nothing about the ledge
 * between them. This answers "how high above *a datum the whole space shares*",
 * so the difference between two of them is the ledge and nothing else. On flat
 * grass that difference is the wave field alone — worst 0.016 m anywhere in the
 * park, against 0.729 m for the same step measured in `y`.
 *
 * **What this deliberately refuses to do**, and it is worth stating because it
 * is the reason the whole conversion is two substitutions rather than a
 * rewrite: it does not solve anything in a frame local to one mover. Two movers
 * standing in different places would then disagree about the geometry
 * *between* them, so a wall's position would depend on who asked. `(x, z)` is a
 * shared, global, exactly invertible chart of the ground — an orthographic
 * projection of the cap, preserving tangential distance and compressing radial
 * distance by `cos θ` — and everything here stays in it. A tangent frame at the
 * mover is not shared and cannot.
 */
export function walkHeight(x: number, y: number, z: number): number {
  // **A non-finite height is a sentinel, not a coordinate**, and it has to come
  // back out with its sign intact. `Collision.ts` writes "no ceiling" as
  // `+Infinity` and "no floor" as `-Infinity`, and `planetRadiusAt` is a
  // `hypot`, which is unsigned: `hypot(x, -Infinity, z)` is `+Infinity`. So a
  // `-Infinity` base converted naively comes back as `+Infinity`, the gate
  // `moverUp < baseUp` is then true for every mover, and **every collider in
  // the game silently stops being solid** — a park a child walks straight
  // through, from a one-line conversion that typechecks. Verified by running
  // it, not by reading it.
  if (!Number.isFinite(y)) return y;
  if (spaceAt(x, z) !== SPACE_GARDEN) return y;
  return planetRadiusAt(x, y, z) - GROUND_SPHERE_RADIUS;
}

const _footUp = /* @__PURE__ */ new Vector3();

/**
 * **Where a mover's feet actually are, given where her body is and how high she
 * is off the ground** — the foot column, for asking what surface is under her.
 *
 * A hop runs along the local up, so out in the park it carries a child
 * *outwards* as well as upwards: 1.28 m of hop at the rim moves her 0.91 m
 * across the ground. Her position is therefore not over the patch of ground she
 * took off from, and "what am I standing on?" must be asked at the foot, not at
 * the body. Sampling at the body instead is what tilts a hop — she would rise
 * along a line of constant `(x, z)`, which decomposes in her own frame into
 * `altitude` of height **and `altitude · tan θ` of lurch towards the park's
 * middle**, a metre and a quarter of sideways at the rim on an ordinary jump.
 *
 * Writes into `target`. Indoors the local up is `+Y`, so the foot is directly
 * under the body and this is the identity in `x` and `z` — which is exactly
 * what a flat room wants, with no flag to remember.
 */
export function footColumn(
  x: number,
  y: number,
  z: number,
  altitude: number,
  target = new Vector3(),
): Vector3 {
  upFor(x, y, z, _footUp);
  return target.set(x - _footUp.x * altitude, y - _footUp.y * altitude, z - _footUp.z * altitude);
}

/**
 * **A point `altitude` metres above a surface, along the local up** — the
 * inverse of {@link footColumn}, and the one place a hop's height becomes a
 * world position.
 *
 * `terrain.ts`'s {@link liftFromGround} is the same idea for the *terrain*
 * specifically; this takes the surface height as an argument because a child
 * hops off bridge decks, castle floors and the ball pit's lip as well as off
 * the grass, and the thing she is standing on is whatever `WalkSurfaces`
 * answered with, not what the terrain function says.
 */
export function liftAlongUp(
  footX: number,
  surfaceY: number,
  footZ: number,
  altitude: number,
  target = new Vector3(),
): Vector3 {
  upFor(footX, surfaceY, footZ, _footUp);
  return target.set(
    footX + _footUp.x * altitude,
    surfaceY + _footUp.y * altitude,
    footZ + _footUp.z * altitude,
  );
}
