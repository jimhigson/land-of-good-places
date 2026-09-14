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

/**
 * **A height two places can be compared by, wherever in the world they are.**
 *
 * The answer to "how big is the step from here to there?" — which is not the
 * same question as {@link altitudeAt}'s "how high is this above the grass", and
 * confusing the two has already cost this sweep a check that could not fail.
 *
 * Outdoors it is the distance from the centre of the planet, so differencing
 * two of them gives the step a foot would actually feel. A world `y` cannot:
 * on a sphere a `y` is dominated by *where* a place is rather than how high its
 * surface is, and at the park's rim the ground drops 1.02 m of `y` per metre
 * travelled outward. Differenced, that is wrong in **both** directions — it
 * refuses ground that is flat, and, far worse, it admits a real 0.70 m ledge as
 * 0.565 m from 40 m out and 0.269 m at the rim, so a router reading `y` plans
 * routes up things a child cannot climb. `world/NavGrid.ts`'s `nodeRadius` and
 * `scripts/check-outward-routing.mts` carry the full measurement.
 *
 * **Indoors it is plain `y`, and that branch is not a nicety.** A castle deck
 * and a hotel room are real coordinates six hundred metres from the park's
 * origin, where the radial formula is meaningless. Applied there blind, one
 * 0.5 m lattice step across a perfectly level floor measures 0.662 m at
 * `(1200, 600)` and 0.684 m at `(600, 600)` — over `MAX_STEP` — so every
 * diagonal of an interior floor would be refused as a wall, and it would fail
 * quietly, as a lobby route that merely got blockier. Measured by the engineer
 * on the collision area, who caught it in review; the same reason {@link upFor}
 * branches on `spaceAt` rather than tilting everything.
 *
 * **Why the `GROUND_SPHERE_RADIUS` offset.** It is a constant, so it cancels in
 * every difference and changes no answer. It is subtracted so the number reads
 * like a height rather than like 220-something — which keeps a debug print
 * legible and, more usefully, means an indoor `y` and an outdoor walk height
 * are the same order of magnitude, so a value that has leaked from the wrong
 * branch looks wrong instead of looking plausible.
 *
 * ## A radius is not a signed height, and every sentinel in this repo is a trap
 *
 * `planetRadiusAt` is a **distance**, so it is never negative, and it therefore
 * **loses the sign of anything below the planet's centre**. Measured:
 * `walkHeight(100, -1e6, 100)` is **+999560**, a point a million metres *under*
 * the park reading as most of a million metres *over* it. The function is
 * monotonic in `y` only for `y > -GROUND_SPHERE_RADIUS`; below that the
 * ordering silently inverts. Real play is nowhere near it — the ground is at
 * `y = -65.7` at the park's furthest furniture — but **sentinels are**, and
 * this codebase is full of them: `Collision`'s `topHeight = Infinity` for
 * "solid however high you jump", `check-hotel.mts`'s `FLOOR_OF_THE_WORLD`,
 * any "very low" starting minimum.
 *
 * Non-finite `y` is therefore passed straight through rather than run through
 * the radius, because the radius maps **both** infinities to `+Infinity` and a
 * comparison that meant "the floor is below the ceiling" becomes false. Left
 * unguarded that is not a wrong number, it is a **reversed one**, and a
 * reversed height in a solidity test makes a collider that is never solid while
 * typechecking perfectly — which is exactly the failure the collision engineer
 * flagged on this function.
 *
 * The general form, and the one the spherical-domain redesign inherits: **a
 * magnitude from a centre is not a substitute for a signed height.** It is the
 * right quantity for *differences between two real places* and the wrong one
 * for an ordering that has to survive an out-of-range value.
 *
 * ## Where this function is the WRONG answer — read before reaching for it
 *
 * A radius cancels the planet **only** between two points in the *same column*,
 * or two points both *on the ground*. It does not cancel it between a point in
 * the air and a point beside it. Measured: two points at the same world `y`,
 * 1.3 m apart radially at 90 m out, differ by **0.54 m** of `walkHeight`.
 *
 * So this is right for a lattice step, a level gap, a stair riser — and
 * **wrong for `topIsAbsolute`**, where a collider's declared top is compared
 * against a mover standing beside it, which is neither case. That comparison
 * wants height **above the ground** — an altitude — not a radius. The collision
 * engineer measured the consequence of getting it the other way: a 1.1 m fence
 * approached from the *inward* side goes **ghost from 80 m out**, and a probe
 * that only walks at it from outward reports all clear, which is why it had
 * never been found.
 *
 * Two quantities, and the redesign needs both named apart: `altitudeAt` for
 * *how high is this above the ground under it*, this for *how big is the step
 * between these two places*. Neither substitutes for the other, and the whole
 * sweep that produced this file turned on the distinction.
 */
export function walkHeight(x: number, y: number, z: number): number {
  if (spaceAt(x, z) !== SPACE_GARDEN) return y;
  // See the docblock: the radius folds the sign, so a sentinel must not enter
  // it. `+Infinity` and `-Infinity` both come out `+Infinity` otherwise.
  if (!Number.isFinite(y)) return y;
  return planetRadiusAt(x, y, z) - GROUND_SPHERE_RADIUS;
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
