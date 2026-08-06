import type { Group } from 'three';
import type { CreatureLimbs } from '../../art/style/asset';

/**
 * **Ducking is her folding, not the whole child going down in a lift.**
 *
 * Jim, twice, 6 August 2026: *"ducking doesn't mean the whole character moving
 * down and clipping through the car"*, and then *"ducking still just lowers the
 * player and clips them through the car — that's not what ducking means."*
 *
 * He is describing a translation, which is exactly what it was: `RailRace.ts`
 * dropped the rider's **root** by `DUCK_DROP × RIDE_SCALE`, so a rigid child
 * slid downward and her feet went through the cart's floor. The give-away is
 * that it read as a lift descending rather than a person avoiding something —
 * nothing about her *changed*, she just moved.
 *
 * So the root never moves any more. Three things happen to her instead, and
 * the ordering of what they are for matters:
 *
 * - {@link DUCK_BEND} folds her at the waist. This is the part that *reads* as
 *   ducking, and it is the same joint and the same 45° that `Player.ts`'s
 *   flower pick already bends by, with the same reasoning: the legs hang off
 *   `body` in this rig, so bending it keeps **the feet planted** where lowering
 *   it would take them through the floor.
 * - {@link DUCK_SQUASH} compresses her. This is the part that actually gains
 *   the clearance, and it is doing more of that work than you would expect —
 *   see its own comment. `body` scales about its own origin, which sits at her
 *   feet, so a squash brings her head down while leaving her feet exactly where
 *   they were. It is the same squash-and-stretch the shared walk cycle already
 *   applies to every character in the park (`art/style/asset.ts`), just held.
 * - {@link DUCK_HEAD_TUCK} tucks her chin in, and the arms come in with it, so
 *   she reads as making herself small rather than merely being short.
 *
 * Applied **outright, not additively**, and applied *last*: the ride owns the
 * whole pose for as long as it is holding one. For a rival that means after
 * `KidHandle.update`; for the player it means at the end of her own animation
 * (`Player.railRaceDuck`), because `Player.animate` writes `body.rotation.x`,
 * `body.scale` and `head.rotation.x` every frame and would otherwise stamp
 * straight over this.
 *
 * Exported as its own module so `scripts/check-rail-race.mts` can pose a real
 * kid with the very function the ride poses her with. A check that re-created
 * the pose would prove only that two copies of the arithmetic agree.
 */

/** How far she folds at the waist, radians. Positive is forwards — measured. */
export const DUCK_BEND = 0.78;

/**
 * How much of her height the squash takes, 0..1 (`scale.y = 1 - this`).
 *
 * **This is doing more work than the bend, and that is not obvious.** A folded
 * body ought to be the thing that gets her under a bar, and for a normally
 * proportioned figure it would be. This is a cartoon child whose head is 3.74 m
 * across at ride scale, and tipping a big round head forward brings the *back*
 * of the skull up almost exactly as fast as it brings the crown down: measured
 * on the real model, a 45° bend on its own lowers the top of her head by
 * **0.077 m** out of 2.109. So the bend is worth having for how it reads and is
 * worth nearly nothing for clearance, and the squash has to find the rest.
 */
export const DUCK_SQUASH = 0.22;

/** Chin tuck, radians, on top of whatever the bend already did to the head. */
export const DUCK_HEAD_TUCK = 0.5;

/** How far the arms pull in as she folds, radians. */
const DUCK_ARM_TUCK = 1.15;

/**
 * Whatever it is that can duck: the player's `CharacterModel`, or a rival
 * `KidHandle`.
 *
 * The two carry their arms differently — a kid keeps them in `limbs`, the
 * player's model hangs them straight off itself — so both are accepted rather
 * than making one of them wrong. The body and the head, which are what the fold
 * actually turns on, are the same on both.
 */
export interface Duckable {
  readonly body: Group;
  readonly head: Group;
  readonly limbs?: CreatureLimbs | null;
  readonly leftArm?: Group;
  readonly rightArm?: Group;
}

/**
 * Folds `target` by `amount` (0 = upright, 1 = fully ducked).
 *
 * Safe to call every frame with 0 — that is the upright pose, written out in
 * full, so a rider who has just stopped ducking is actively put back rather
 * than left wherever the last frame happened to leave her.
 */
export function poseDuck(target: Duckable, amount: number): void {
  const fold = Math.max(0, Math.min(1, amount));
  target.body.rotation.x = DUCK_BEND * fold;
  const squash = 1 - DUCK_SQUASH * fold;
  // Widen as she flattens, the way every squash in this park does: a body that
  // only loses height reads as scaled, one that spreads reads as squashed.
  target.body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
  target.head.rotation.x = DUCK_HEAD_TUCK * fold;
  const leftArm = target.limbs?.leftArm ?? target.leftArm;
  const rightArm = target.limbs?.rightArm ?? target.rightArm;
  if (leftArm && rightArm) {
    leftArm.rotation.x = -DUCK_ARM_TUCK * fold;
    rightArm.rotation.x = -DUCK_ARM_TUCK * fold;
    leftArm.rotation.z = 0.3 * fold;
    rightArm.rotation.z = -0.3 * fold;
  }
}
