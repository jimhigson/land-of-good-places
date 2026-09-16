import { Euler, Quaternion, Vector3, type Object3D } from 'three';
import { SPACE_GARDEN, spaceAt } from './spaces';
import { screenBasis3D, type ScreenBasis3D } from '../core/screenBasis';
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
  rigTiltAt(focus, up, _eyeTilt);
  eye.set(flatOffset.x, flatOffset.y, flatOffset.z).applyQuaternion(_eyeTilt).add(focus);
}

/**
 * The rotation a fixed-angle rig is carried through at `focus`, and the up it
 * carries it to — the one owner shared by {@link eyeForFocus} (where the eye
 * goes) and {@link screenBasis3DAt} (which way the picture's axes point), so the
 * two can never solve different rotations.
 */
function rigTiltAt(
  focus: { readonly x: number; readonly y: number; readonly z: number },
  up: Vector3,
  tilt: Quaternion,
): Quaternion {
  upFor(focus.x, focus.y, focus.z, up);
  return tilt.setFromUnitVectors(INDOOR_UP, up);
}

/**
 * **The screen's right and up, in world space, for the rig {@link eyeForFocus}
 * builds over `focus`.**
 *
 * `core/screenBasis.ts`'s `screenBasis3D(yaw, pitch)` is the flat-frame answer —
 * the camera at the park's centre. `IsoCamera` rotates its whole rig by the tilt
 * at its focus (the offset *and* `camera.up`), so the axes it renders with are
 * that flat basis carried through the same rotation. This is that, and it is
 * here beside `eyeForFocus` so the two cannot solve different rotations.
 *
 * Found by `check:keyring-view`: `KeychainShop` cached the flat basis as a
 * module constant and framed its rack about it, while the rendered axes leant
 * with the stall — a drift of **6.07e-2** at scale 1 (1.81e-1 at 2.34x). Indoors
 * the tilt is the identity and this is exactly `screenBasis3D`.
 */
export function screenBasis3DAt(
  focus: { readonly x: number; readonly y: number; readonly z: number },
  yaw: number,
  pitch: number,
): ScreenBasis3D {
  const flat = screenBasis3D(yaw, pitch);
  rigTiltAt(focus, _basisUp, _basisTilt);
  const right = _basisRight.set(flat.rightX, flat.rightY, flat.rightZ).applyQuaternion(_basisTilt);
  const up = _basisScreenUp.set(flat.upX, flat.upY, flat.upZ).applyQuaternion(_basisTilt);
  return { rightX: right.x, rightY: right.y, rightZ: right.z, upX: up.x, upY: up.y, upZ: up.z };
}

const _basisUp = /* @__PURE__ */ new Vector3();
const _basisTilt = /* @__PURE__ */ new Quaternion();
const _basisRight = /* @__PURE__ */ new Vector3();
const _basisScreenUp = /* @__PURE__ */ new Vector3();

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
