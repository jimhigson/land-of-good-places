import { Vector3 } from 'three';
import { terrainHeight } from '../terrain';
import { PET_SLIDE_LEAD } from './petRiders';

/**
 * **Where the ginormous slide's chase camera goes, solved against the ride
 * that was actually built** (issues #514, #516).
 *
 * ## The number this replaces, and why it was wrong
 *
 * `Building.ts` used to mount the lens at a fixed `CHASE_EYE = {y: 1.62,
 * z: 4.35}` — an offset chosen, and its own doc says *"reasoned, not seen"*,
 * for **a rider with nobody behind her**. Companions arrived in #468 and the
 * number never moved, so the lens has been sitting *inside the line it is
 * meant to be filming* ever since: the first animal rides `PET_SLIDE_LEAD`
 * = 2.73 m behind her, the lens 4.35 m, so the nearest pet is about **1.05 m
 * in front of the lens and 0.9 m below it** and the second and third are
 * behind it altogether.
 *
 * Measured on the canonical seed, all nine rasters of `check:pet-slide`: the
 * nearest companion sat **34.3°–45.4° below the camera's own axis against a
 * 30° half-fov**. Outside the picture every time, on every park — the 4–12%
 * of frame the clause scored was the animal's top edge clipping in from
 * underneath. That is #514, and it is arithmetic rather than bad luck, which
 * is why no seed escaped it.
 *
 * ## What it does instead
 *
 * Asks the two questions the fixed offset never asked.
 *
 * 1. **What must be in the shot?** The child and the nearest companion. The
 *    lens steps back until the companion is inside the frustum with margin,
 *    and pitches so the axis lies between the two of them rather than over
 *    the top of both.
 * 2. **What is at that point?** {@link terrainHeight}, the same sampler every
 *    prop in the park is placed against. A lens under the ground is #516: near
 *    the bottom the chute runs low and steeply pitched, so "behind and above"
 *    in the chute's tilted frame resolves to a point inside the hill.
 *
 * **It does not clamp and accept.** On a chute where no placement in range
 * satisfies both, it reports `gaveUp` rather than settling on a floor and
 * drawing a shot it knows is wrong — CLAUDE.md's standing rule, and the same
 * shape as `petRiders.ts`'s bend allowance. `check:pet-slide` asserts the
 * count is zero, because a shipped game must not throw at a child mid-ride.
 */

/** Where the lens sits, in the mount's frame: `back` behind, `up` above. */
export interface ChaseEye {
  readonly back: number;
  readonly up: number;
  /**
   * The world point the lens should look at — the midpoint of the child and
   * the nearest companion, or just the child when she rides alone.
   *
   * **Returned as a point rather than an angle, and that is the load-bearing
   * decision in this file — do not turn it back into an angle.**
   *
   * An angle has to be expressed in some frame, and this rig stacks three of
   * them: `rideMount` yawed and pitched with the chute, `eyeMount` turned by
   * `PI` so its +Z is *behind* the rider, and the camera's own look on top.
   * `RideCamera`'s header records **two agents getting a sign backwards** on
   * exactly that kind of composition, and warns you to run `check:ride-camera`
   * before touching one.
   *
   * **A point has no frame to get wrong.** The caller aims at it by decomposing
   * the direction to it against the mount's own forward and up — vectors it
   * already holds, in whatever frame it already has. That does not get the sign
   * right this once; it removes the way of getting it wrong. Returning an angle
   * from here would put the whole class of bug back, however carefully the
   * angle was derived.
   */
  readonly aimAt: Vector3;
  /** True when no placement in range framed the companion and cleared ground. */
  readonly gaveUp: boolean;
}

/**
 * The starting placement — the old `CHASE_EYE`, kept as the **floor** rather
 * than the answer.
 *
 * A bend or a companion can only ever push the lens *further* back and
 * *higher*; nothing wants it closer than the shot Jim asked for ("just behind
 * the player"). Keeping the historical numbers as the floor is what stops this
 * becoming a different camera on the parks that were already fine.
 */
const BASE_BACK = 4.35;
const BASE_UP = 1.62;

/**
 * How much further back the solve may go, and in what steps.
 *
 * A stop, not a tuning knob. Measured need on the pool is under a metre; three
 * metres is the room to solve in, and a chute that wants more is reported
 * rather than clamped.
 */
const MAX_EXTRA_BACK = 3.0;
const BACK_STEP = 0.1;

/** How much the lens may rise to clear ground, and in what steps. */
const MAX_EXTRA_UP = 2.0;
const UP_STEP = 0.1;

/**
 * Ground the lens keeps under it.
 *
 * Not zero: a camera exactly on the ground still renders the hill across the
 * bottom of the frame, and the near plane has thickness. This is the clearance
 * that reads as "above the park" rather than "in it".
 */
const GROUND_CLEARANCE = 0.35;

/**
 * Fraction of the half-fov the companion must sit inside.
 *
 * Framing it at exactly the edge is the state #514 is about — the clause
 * passed for months on an animal's top edge. 0.75 puts the whole body
 * comfortably in the picture rather than clipping into it.
 */
const FRAME_SAFETY = 0.75;

const eye = new Vector3();
const toPet = new Vector3();
const toChild = new Vector3();
const axis = new Vector3();

/**
 * Solve the lens placement for this instant of the descent.
 *
 * `rider`, `pet` and the mount basis are all world-space and all come from the
 * ride that was actually built — the same curve, at the same instant, that
 * seats the child and the animals. Nothing here re-derives where anything is.
 *
 * @param halfFovRad the camera's own vertical half-fov, passed in rather than
 *   restated: `RideCamera` owns it and a copy here would drift the moment the
 *   lens changes.
 */
export function solveChaseEye(
  rider: Vector3,
  pet: Vector3 | null,
  behind: Vector3,
  up: Vector3,
  halfFovRad: number,
): ChaseEye {
  const wanted = halfFovRad * FRAME_SAFETY;

  for (let extraBack = 0; extraBack <= MAX_EXTRA_BACK; extraBack += BACK_STEP) {
    for (let extraUp = 0; extraUp <= MAX_EXTRA_UP; extraUp += UP_STEP) {
      const back = BASE_BACK + extraBack;
      const high = BASE_UP + extraUp;
      eye.copy(rider).addScaledVector(behind, back).addScaledVector(up, high);

      // #516 first, because it is cheap and it disqualifies outright.
      if (eye.y - terrainHeight(eye.x, eye.z) < GROUND_CLEARANCE) continue;

      // With nobody behind her the shot only has to hold the child, which the
      // historical placement already did — so the first candidate wins and
      // every park without companions keeps exactly the camera it had.
      if (!pet) {
        return { back, up: high, aimAt: new Vector3().copy(rider), gaveUp: false };
      }

      // Aim between the two of them, then ask whether both are inside the
      // frustum about that axis. Measured off the real points, so there is no
      // angle in a frame to get the sign of wrong.
      const aim = new Vector3().copy(rider).add(pet).multiplyScalar(0.5);
      axis.copy(aim).sub(eye).normalize();
      toPet.copy(pet).sub(eye);
      const petAngle = Math.acos(
        Math.min(1, Math.max(-1, toPet.clone().normalize().dot(axis))),
      );
      toChild.copy(rider).sub(eye);
      const childAngle = Math.acos(
        Math.min(1, Math.max(-1, toChild.clone().normalize().dot(axis))),
      );
      if (petAngle <= wanted && childAngle <= wanted) {
        return { back, up: high, aimAt: aim, gaveUp: false };
      }
    }
  }

  // **No placement in range framed her line and stayed out of the hill.** Not a
  // floor to settle on — reported, and asserted zero by `check:pet-slide`.
  return {
    back: BASE_BACK,
    up: BASE_UP,
    aimAt: pet ? new Vector3().copy(rider).add(pet).multiplyScalar(0.5) : new Vector3().copy(rider),
    gaveUp: true,
  };
}

/** The nearest companion's own distance behind her, for callers that seat it. */
export const NEAREST_COMPANION_LEAD = PET_SLIDE_LEAD;
