import { Quaternion, Vector3, type Object3D } from 'three';
import type { Player } from '../../entities/Player';
import { railTurn } from '../rail/sweptRail';
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

/**
 * A cart's heading, off the chart route's `tangentAt` — kept because the
 * quaternion no longer says, and because the race's physics and cameras reason
 * in the chart. The cart itself is turned by the drawn rails, not by this.
 */
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
const _ahead = /* @__PURE__ */ new Vector3();
const _behind = /* @__PURE__ */ new Vector3();
/**
 * Half the span, in metres, of the difference the rails' drawn direction is
 * read from. A tenth of the ring's tightest bend radius (53.5 m) would do; this
 * is far inside it, and far above float noise on a 600 m ring.
 */
const DRAWN_STEP = 0.05;
const _turnBody = /* @__PURE__ */ new Quaternion();
const _seat = /* @__PURE__ */ new Vector3();
// flat-ok: the tub's own local up, the axis her face turn is taken about
const _yAxis = /* @__PURE__ */ new Vector3(0, 1, 0);
const _up = /* @__PURE__ */ new Vector3();
const _across = /* @__PURE__ */ new Vector3();

/**
 * Put `cart` on `lane` at arc length `at`, leant with the rails under it.
 *
 * `route.pointAt` is already leant onto the sphere, and the tub is turned onto
 * the direction the rails are drawn in there, by `railTurn` — the sleepers'
 * own side/up convention — so it sits on exactly the track under it. Writes
 * the quaternion from scratch, so it is safe every frame. Does not touch scale —
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
  heading.yaw = Math.atan2(_tangent.x, _tangent.z);
  // Pitch with the hill it is on — the whole point of the undulation.
  heading.pitch = -Math.asin(Math.max(-0.6, Math.min(0.6, _tangent.y)));
  // **Square on the rails as drawn.** The heading above is read off
  // `tangentAt`, which is the *unleant* chart route — right for the physics,
  // which wants the gradient against local gravity, and the wrong thing to turn
  // a cart by. Turned by it through `rideFrame` (lean about the lane's column,
  // then that heading) the tub's nose ran 1.83° p50 and 3.51° worst off the
  // rails under it round the lap. So the tub takes the direction the rails are
  // actually drawn in, and `railTurn` — the sleepers' own side/up convention —
  // stands it on them.
  route.pointAt(lane, route.wrap(at + DRAWN_STEP), _ahead);
  route.pointAt(lane, route.wrap(at - DRAWN_STEP), _behind);
  railTurn(cart.position, _ahead.sub(_behind).normalize(), cart.quaternion);
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
 * body's share of the face turn (`faceTurnTowardsCamera`), taken about the
 * tub's own up. Her lean is the tub's: see the note at `setRideFrame` below.
 */
export function seatRaceRider(
  player: Player,
  cart: Object3D,
  heading: Readonly<CartHeading>,
  rideScale: number,
  wobble: number,
  turnBody: number,
): void {
  // flat-ok: local axis, leant by the cart's own quaternion
  const up = _up.set(0, 1, 0).applyQuaternion(cart.quaternion);
  const across = _across.set(1, 0, 0).applyQuaternion(cart.quaternion);
  const lift = SEAT_HEIGHT * rideScale;
  _seat
    .copy(cart.position)
    .addScaledVector(up, lift)
    .addScaledVector(across, wobble);
  // **In the cart's own frame, handed over whole** — the tub's turn, then her
  // share of the face turn about the tub's up. She used to be turned by
  // `setRidePose` -> `faceOnGround` from the same yaw and pitch, leant about the
  // sphere at *her* seat, while the tub was leant about its rails: two turns of
  // one heading, which agreed to 1.4° when both composed alike and came apart
  // by 10.7° the day one of them changed order. Rivals get this for free —
  // `kid.root` is a child of the cart group — and now so does she.
  player.setRideFrame(
    _seat,
    _turnBody.setFromAxisAngle(_yAxis, turnBody).premultiply(cart.quaternion),
    heading.yaw + turnBody,
  );
}
