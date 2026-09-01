import { Vector3 } from 'three';
import type { SlideRide } from '../building/SlideRide';

/**
 * **Where the pets ride while she goes down the ginormous slide** — issue #468.
 *
 * Jim: *"When going down the slide, the pet should slide down behind the
 * player."* A child who brings her cat to the park should not leave it standing
 * at the top while she rides.
 *
 * ## One line, one chute, one description of where anybody is
 *
 * The child, the grown-up in front of her and now every companion behind her
 * are all placed the same way: a distance along the ride's own curve, turned to
 * the tangent there and pitched to the slope there. Nothing here re-describes
 * the chute, and nothing here builds a second animal — the pet a child has been
 * watching walk behind her all afternoon is the pet that comes down the slide,
 * exactly as `Parade.sendPetsToTable` (#449) sends *that* pet to the banquet
 * rather than a stand-in. See `entities/parade/ParadeMember.rideSlide`.
 *
 * The seam is the same one-way shape the banquet and the hotel's pet beds use:
 * the ride says *here is where the slot-th companion is this frame*, the parade
 * puts that body there, and nothing crosses back. {@link PetSlideLink} is
 * stated here, next to the ride, because the ride is the consumer — `Parade`
 * satisfies it structurally without ever importing the castle.
 */

/**
 * One companion's seat on the chute for one frame: where it is, which way it
 * faces, and how steeply the chute is falling under it.
 *
 * Mutable and filled in place, because this is written once per companion per
 * frame and a fresh object each time would be eight allocations a frame for the
 * whole descent.
 */
export interface SlideSeat {
  x: number;
  y: number;
  z: number;
  /** Yaw, radians, the same units `Player.setRidePose` takes. */
  facing: number;
  /** Nose-down pitch, radians. See {@link slopeOf}. */
  pitch: number;
}

/** Fills `seat` with where the `slot`-th companion rides this frame. */
export type SlideSeatFor = (slot: number, seat: SlideSeat) => void;

/**
 * **What the ginormous slide needs from the parade, and the whole of it.**
 *
 * The direct analogue of `greatHallBanquet.ts`'s `PetTableLink`, deliberately
 * the same shape: the ride offers seats, the parade puts the animals in them,
 * and **nothing crosses back**. No second follower to keep in step by hand,
 * which is this codebase's most-cited defect.
 */
export interface PetSlideLink {
  /**
   * Everybody in the line takes to the chute, and stays on it: called **every
   * frame** of the descent with a callback that answers where each one is by
   * its place in the line. Returns how many are aboard, which is what a check
   * measures.
   *
   * Idempotent — boarding is simply the first frame a member is given a seat.
   */
  ridePetsDownSlide(seatFor: SlideSeatFor): number;
  /**
   * The ride is over: back into the line from wherever on the chute they had
   * got to. Safe to call when nobody ever boarded.
   */
  callPetsOffSlide(): void;
  /** How many companions are on the chute right now. */
  petsOnSlide(): number;
}

/**
 * How far behind her the first companion rides, in metres of chute.
 *
 * **Read off the framed shot, not chosen as a gap in metres.** The chase camera
 * sits `CHASE_EYE.z` = 4.35 m behind her (`Building.ts`), so anything further
 * back than that is behind the lens and simply not in the ride at all from a
 * child's seat. 1.5 m puts the first companion clearly separate from her — a
 * pet at half a metre reads as part of her — and leaves room for a second and a
 * third at {@link PET_SLIDE_GAP} before the camera is reached.
 */
export const PET_SLIDE_LEAD = 1.5;

/**
 * Gap between one companion and the next, in metres of chute.
 *
 * Wide enough that two pets are never on the same spot — the whole line is
 * strictly ordered along one curve, so "not piled up" is true by construction
 * rather than by a separation force — and tight enough that the first three
 * are all in front of the chase camera (1.5, 2.7, 3.9 m against its 4.35 m).
 */
export const PET_SLIDE_GAP = 1.2;

/**
 * How far a companion's feet sit above the chute's centre line.
 *
 * The same lift the child rides at (`RIDER_LIFT`, 0.06 m): the trough's floor
 * is the curve, and a model whose origin is at its feet sits on it with a hair
 * of clearance so it never z-fights the floor it is sliding down.
 */
export const PET_RIDE_LIFT = 0.06;

/**
 * How steeply the chute is falling here, as a rotation about the rider's own
 * left-right axis.
 *
 * Derived from the unit tangent whatever is being placed is *already* being
 * turned by, so there is no second description of the chute's slope that could
 * drift from the first. Under a `YXZ` composition a model's forward (+Z) maps
 * to `(0, -sin θ, cos θ)` once yaw has been applied, so matching the tangent's
 * rise against its horizontal run is exactly `atan2(-y, |xz|)` — positive is
 * nose-down, which is the way a slide goes.
 *
 * Taking `atan2` of the run rather than `asin` of the rise keeps it honest if a
 * tangent ever arrives un-normalised; `SlideRide.tangentAt` normalises today,
 * and this does not have to care whether it still does tomorrow.
 *
 * Lives here, rather than in `Building.ts` where it was written, because the
 * child, the grown-up and now every companion all need the same answer and two
 * copies of it is the bug this repo files most often.
 */
export function slopeOf(tangent: Vector3): number {
  return Math.atan2(-tangent.y, Math.hypot(tangent.x, tangent.z));
}

const point = new Vector3();
const tangent = new Vector3();

/**
 * Fills `seat` with where the `slot`-th companion rides when the child has
 * travelled `riderDistance` metres down `slide`.
 *
 * **Before the top of the chute the line runs on backwards in a straight
 * line**, along the tangent at the lip, rather than being clamped to it. The
 * clamp was the obvious version and it is wrong twice over: eight companions
 * would stand inside one another at the entry for the first second and a half
 * of every ride — the pile-up #468 explicitly rules out — and a line that
 * *starts* at the mouth of a chute reads as having been spawned there rather
 * than as having followed her in. Extending the curve backwards puts them where
 * they would have been a moment ago, which is up inside the castle's own
 * geometry, so they emerge from it one after another as she pulls away.
 */
export function petSeatOnSlide(
  slide: SlideRide,
  riderDistance: number,
  slot: number,
  seat: SlideSeat,
): void {
  const distance = riderDistance - PET_SLIDE_LEAD - slot * PET_SLIDE_GAP;
  const t = Math.min(1, Math.max(0, distance) / slide.length);
  slide.pointAt(t, point);
  slide.tangentAt(t, tangent);
  // Behind the lip: carry on along the entry tangent, backwards. `distance` is
  // negative here, so this subtracts.
  if (distance < 0) point.addScaledVector(tangent, distance);

  seat.x = point.x;
  seat.y = point.y + PET_RIDE_LIFT;
  seat.z = point.z;
  seat.facing = Math.atan2(tangent.x, tangent.z);
  seat.pitch = slopeOf(tangent);
}
