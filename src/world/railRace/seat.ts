import { Vector3, type Object3D } from 'three';
import type { Player } from '../../entities/Player';
import { rideFrame } from '../rail/sweptRail';
import { SEAT_HEIGHT } from './cart';
import type { RailRaceRoute } from './route';

/**
 * **The one owner of where a Rail Race cart is, which way it leans, and where
 * the child sits in it.**
 *
 * Both halves used to live inline in `RailRace.placeCarts`/`poseRider`, and
 * `check-rail-race.mts` built its own copy of the pair: a cart group with a
 * position, a scale and **no rotation**, and a rider seated straight up world
 * `+Y`. When the ring was leant onto the sphere the game's cart learned to lean
 * with it and the check's did not — so the check went on measuring an upright
 * tub against a leant rider the game no longer draws, and reported her ducking
 * through a floor that was not there. Two copies of one transform, kept in step
 * by hand, and the copy was the one that was wrong. Now both ask here.
 */

/** A cart's heading: what `rideFrame` was handed, kept because the quaternion no longer says. */
export interface CartHeading {
  /**
   * Read this, never `group.rotation.y` — once the quaternion carries a lean,
   * the Euler three.js decomposes out of it mixes lean, yaw and pitch, and its
   * `.y` is none of the three.
   */
  yaw: number;
  /** Pitch with the hill, for the same reason as {@link yaw}. */
  pitch: number;
}

const _tangent = /* @__PURE__ */ new Vector3();
const _flat = /* @__PURE__ */ new Vector3();
const _up = /* @__PURE__ */ new Vector3();
const _across = /* @__PURE__ */ new Vector3();

/**
 * Put `cart` on `lane` at arc length `at`, leant with the rails under it.
 *
 * `route.pointAt` is already leant onto the sphere; `rideFrame` takes the lean
 * about `flatPointAt`'s column, which is the column the rails were leant about,
 * so the tub tilts by exactly what the track under it does. Writes the
 * quaternion from scratch, so it is safe every frame. Does not touch scale —
 * a cart is sized by the ring it is on (`RailRace.setActiveRing`).
 */
export function placeRaceCart(
  route: RailRaceRoute,
  lane: number,
  at: number,
  cart: Object3D,
  heading: CartHeading,
): void {
  route.pointAt(lane, at, cart.position);
  route.tangentAt(lane, at, _tangent);
  route.flatPointAt(lane, at, _flat);
  heading.yaw = Math.atan2(_tangent.x, _tangent.z);
  // Pitch with the hill it is on — the whole point of the undulation.
  heading.pitch = -Math.asin(Math.max(-0.6, Math.min(0.6, _tangent.y)));
  rideFrame(_flat, heading.yaw, heading.pitch, cart.quaternion);
}

/**
 * Seat `player` in `cart`, **along the cart's own axes, not the world's**.
 *
 * The lift used to be `cart.position.y + SEAT_HEIGHT * rideScale` and the bonk
 * sway `cart.position.x + wobble` — world `+Y` and world `+X`. On a flat park
 * those are the tub's own up and across; on a ring that leans 15-30 degrees
 * they are neither, so she was lifted out of the seat towards the park's centre
 * and shaken along an axis the cart does not have.
 *
 * `wobble` is the sideways slide across the tub in metres; `turnBody` the
 * body's share of the face turn (`faceTurnTowardsCamera`). The player's own
 * lean comes from `setRidePose` → `faceOnGround`, about her seat.
 */
export function seatRaceRider(
  player: Player,
  cart: Object3D,
  heading: Readonly<CartHeading>,
  rideScale: number,
  wobble: number,
  turnBody: number,
): void {
  const up = _up.set(0, 1, 0).applyQuaternion(cart.quaternion);
  const across = _across.set(1, 0, 0).applyQuaternion(cart.quaternion);
  const lift = SEAT_HEIGHT * rideScale;
  player.setRidePose(
    cart.position.x + up.x * lift + across.x * wobble,
    cart.position.y + up.y * lift + across.y * wobble,
    cart.position.z + up.z * lift + across.z * wobble,
    heading.yaw + turnBody,
    // Rivals get this for free — `kid.root` is a child of the cart group — but
    // the player's own model is positioned independently every frame, so the
    // cart's pitch has to be handed over.
    heading.pitch,
  );
}
