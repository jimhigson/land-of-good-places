import { Euler, Quaternion, Vector3, type Object3D } from 'three';
import { SPACE_GARDEN, spaceAt } from './spaces';
import { INDOOR_UP, tiltToSphere, upAt } from './terrain';

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
