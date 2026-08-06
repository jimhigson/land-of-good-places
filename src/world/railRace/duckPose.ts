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
 * - {@link DUCK_HIP_DROP} sinks her hips into the cart. This is the crouch, and
 *   the part that actually gains the clearance — `body`, never `root`, so she
 *   folds down *within* the cart instead of sliding out through the bottom of
 *   it. See its own comment for why that is the whole distinction Jim was
 *   drawing, and for the one thing it depends on.
 * - {@link DUCK_SQUASH} compresses her a little on top. `body` scales about its
 *   own origin, so this costs nothing in feet position; it is the same
 *   squash-and-stretch the shared walk cycle already applies to every character
 *   in the park (`art/style/asset.ts`), just held and a bit deeper.
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
 * Deliberately **small**, and it took two goes to get there. A cartoon child's
 * head is 3.74 m across at ride scale, and tipping a big round head forward
 * brings the *back* of the skull up almost as fast as it brings the crown down:
 * measured on the real model, the 45° bend on its own lowers the top of her
 * head by **0.077 m** out of 2.109. So the bend reads beautifully and buys
 * almost no clearance.
 *
 * The first version of this file answered that by squashing her 22%, which got
 * her under the bar and looked like a child being *compressed* rather than one
 * ducking — 88% of the height came from scaling her. {@link DUCK_HIP_DROP} is
 * what fixed it: dropping the hips buys more clearance than that squash did,
 * so the squash could come back down to a supporting effect. It is still twice
 * the walk cycle's, because a held pose can carry more than a passing one.
 */
export const DUCK_SQUASH = 0.12;

/**
 * **How far her hips sink, in her own pre-`RIDE_SCALE` metres — this is the
 * crouch.**
 *
 * `body`, not `root`, and the distinction is the whole of Jim's complaint.
 * Moving `root` moved the entire child, feet included, down **through the
 * cart's floor and out of the bottom of it** — a lift descending. Moving `body`
 * leaves `root` pinned to the seat and sinks her hips *within* the cart, which
 * is what a person does when they duck. Her feet come down with the hips,
 * because this rig hangs the legs off `body` and **has no knee** to fold them
 * at — but they come down into the hollow of the tub, where the legs already
 * live and where the cart's own sides (which rise to 1.44 against a seat at
 * 0.958) hide them. Measured: the soles land at 0.541 against a tub floor at 0,
 * so nothing ever leaves the cart. The dodgems settled this precedent already
 * by burying its riders' legs in the tub.
 *
 * **Worth being plain about the limit**, because it decides whether this rig
 * ever needs a modelling pass: this works *here* only because a cart hides the
 * legs. Nothing about it would survive a crouch in the open — a pelvis joint
 * and a knee would be needed for that, and neither exists.
 */
export const DUCK_HIP_DROP = 0.22;

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
  target.body.position.y = -DUCK_HIP_DROP * fold;
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
