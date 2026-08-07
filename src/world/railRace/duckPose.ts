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
export const DUCK_BEND = 0.70;

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
export const DUCK_SQUASH = 0.14;

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
 * **Zero now that she starts seated.** It was 0.22 when the duck began from
 * standing and had a long way to come down; from a seat her hips are already
 * there, and sinking them further pushed her pelvis through the cart's tub
 * floor. The fold does the work instead. Kept as a named constant rather than
 * deleted because it is the thing to reach for if the seat is ever raised.
 */
export const DUCK_HIP_DROP = 0;

/** Chin tuck, radians, on top of whatever the bend already did to the head. */
export const DUCK_HEAD_TUCK = 0.5;

/** How far the arms pull in as she folds, radians. */
const DUCK_ARM_TUCK = 1.15;

/**
 * **How far her hips drop to sit down**, in her own pre-`RIDE_SCALE` metres.
 *
 * Jim, 6 August 2026: *"why does the character stand up in the cart anyway?
 * can't they sit down?"* Nobody had asked, and the answer was not that the rig
 * could not: `setRidePose` only ever owned the **root**, so it put her in the
 * cart and did nothing whatever to her limbs. She stood in a race cart for
 * months because no seated pose had been written.
 *
 * The hip pivot sits 0.36 above `body`'s origin (`kid.ts`), so dropping `body`
 * by that would put the joint exactly *on* the seat. This is a little less,
 * because a bottom has volume: she sits **on** the seat rather than through it,
 * and the six centimetres are what keeps her lowest visible part above the
 * cart's tub floor when she folds. Read off the rig, then set by what the tub
 * can actually take — `check:rail-race` asserts the second part.
 */
export const SIT_HIP_DROP = 0.30;

/**
 * How far the legs swing forward from the hip, radians — negative is forward.
 *
 * A soapbox racer's posture: legs out in front, knees towards the nose of the
 * cart. Well inside the −1.25 rad the ferris wheel gondola already folds a
 * seated child's legs to, so it asks nothing new of the rig.
 *
 * **This is the pose the missing knee shows up in**, and it is worth being
 * plain rather than quietly picking an angle that hides it: with no knee the
 * leg is one rigid piece from hip to shoe, so "sitting" can only ever be legs
 * held out straight. That happens to suit a soapbox cart — a child really does
 * sit in one with their legs stretched towards the front — which is why this
 * reads correctly *here* and would not in a chair.
 */
export const SIT_LEG = -1.35;

/** A little forward lean, so she reads as riding rather than lounging. */
const SIT_LEAN = 0.16;

/** Arms forward onto the cart's rail. */
const SIT_ARM = -1.0;

/**
 * **How far her torso throws forward on a pump, radians.**
 *
 * Jim, 6 August 2026: the boost needs more visual feedback — *"torso rocks
 * forward while boosting"*.
 *
 * Driven by {@link Rider.bob}, the per-press spring `simulate.ts` already keeps
 * and which the **player had no use for at all**: the rivals spent it on a seat
 * dip (`kid.root.position.y`) and the player's own pose ignored it, so the one
 * control in the game gave her nothing to look at. A per-tap throw reads far
 * better than a sustained lean would, because pumping a handcar *is* a rhythm —
 * you can see how fast she is going by how fast she rocks.
 *
 * **0.21 rad is 12°.** It was 0.42 (24°) for exactly one round, and that round
 * was the first in which the rock was *drawn at all* — until the ordering fix in
 * round 8, `applyRidePose` stamped `body.rotation.x` back to a constant after
 * this had written it, so every earlier number here was chosen against a screen
 * that never showed it. Jim rode the first version that reached his eyes and
 * said the lean was *"too exagerated - reduce the range of motion by 50%"*.
 *
 * Halved rather than re-solved, because 0.42 was never a measurement either —
 * it was a guess at legibility at the ~37 px/m the phone rig draws her at, and
 * the only real evidence about it is that a person watched it and found it too
 * much. Halving keeps the rhythm (you can still read her tap rate off the rock,
 * which is the whole point of driving it from `Rider.bob`) and takes out the
 * bow.
 */
export const BOOST_ROCK = 0.21;

/**
 * How high she springs out of the seat when she wins, in her own metres.
 *
 * `body`, not `root`, for the same reason the crouch uses `body` — except that
 * here the direction is the safe one. A jump is the one motion that *cannot*
 * clip her through the tub, because it goes up; using `body` anyway keeps one
 * rule ("the ride never moves the root") rather than one rule and an exception.
 */
export const CHEER_HOP = 0.55;

/**
 * **How far a bonk's wobble slides the rider sideways across the tub**, in world
 * metres — and the reason it is a named number rather than the `0.08` it was.
 *
 * `RailRace.poseRider` places her at `cart.position.x + wobble` while the cart
 * stays at `cart.position.x`. So this is not a pose at all: it is a displacement
 * of the rider *relative to the seat she is sitting in*, applied after the pose
 * pipeline has run.
 *
 * That distinction is the whole of Jim's 7 August report — *"after a head bonk
 * the players hands clip through the cart"*. The arm-clearance check swept every
 * pose the ride can make ({@link RiderPose} is three numbers each clamped to
 * 0..1, so the set is finite and it is now enumerated rather than listed) and
 * found a worst case of **0.057 m of clearance**, comfortably inside the tub. It
 * could not have found this, because the sway is not one of those three numbers.
 * At the old 0.08 m the arm went **0.023 m through** the tub wall on a fresh
 * bonk.
 *
 * **0.04 m, not 0.08, and the cart is not touched.**
 * `CART_WIDTH_AT_PARK_SCALE` is 1.10 and that is a measured ceiling — 1.12 fails
 * `raceCameraNeverRunsBackwards` on seed 5, and the lane spacing derives from it
 * — so the sway is what gives way. It keeps 0.017 m of margin against the
 * 0.057 m the tightest pose leaves, and `check:rail-race` asserts that
 * relationship against the **built** hopper rather than trusting this comment:
 * change either number and the check re-does the subtraction.
 *
 * The shake reads the same. It is a fast `sin(wobble * 34)` tremor against a
 * 2.75 m-wide cart, so halving its amplitude is a change of a few pixels, and
 * the shove *down* into the seat (`RailRace.ts`'s `knockdown`) is what carries
 * the feedback.
 */
export const BONK_SWAY = 0.04;


/** How far she leans back as she throws her arms up. Negative of the sit lean. */
const CHEER_LEAN = 0.34;

/** Arms straight up in the air. */
const CHEER_ARM = 2.5;

/**
 * How far her legs come down out of the soapbox stretch as she jumps.
 *
 * Jim asked for legs on for the celebration (*"this one will need legs
 * showing"*), and legs still held out at {@link SIT_LEG} while the rest of her
 * jumps read as a mannequin being lifted. Bringing them under her is what makes
 * it a jump.
 */
const CHEER_LEG = 0.95;

/**
 * **How long the result card sits there before she is set down at the booth**,
 * seconds — which is also exactly how long the camera holds on her, because
 * finishing freezes `Rider.travelled` and the rig settles where she stopped.
 *
 * Here rather than in `RailRace.ts` because {@link CHEER_SECONDS} has to fit
 * inside it, and "two numbers kept in step by a comment promising they agree" is
 * the single most common bug in this repo. One owner; `RailRace` imports it, and
 * `check:rail-race` asserts the jump lands before it runs out.
 */
export const RESULT_SECONDS = 5;

/** How long one celebration hop takes, seconds. */
const CHEER_HOP_SECONDS = 0.62;

/**
 * How long she keeps jumping for, seconds.
 *
 * Comfortably inside {@link RESULT_SECONDS} so the bouncing stops and she
 * settles while the camera is still on her, rather than being cut off in mid-air
 * when the result card goes. Guarded, not merely intended.
 */
const CHEER_SECONDS = 3.2;

/**
 * **How far through the victory jump a winner is, 0..1**, `since` seconds after
 * she crossed the line.
 *
 * A pure function of the clock, here rather than inside `RailRace`, for the
 * reason this whole module exists: `check:rail-race` drives **this** curve
 * through **the real {@link poseRailRaceRider}** and measures where her head
 * actually ends up. A check that fed a hand-picked `cheer: 1` into the pose
 * would prove the pose can lift her while saying nothing whatsoever about
 * whether the ride ever asks it to — and "the flag was right, the screen was
 * still" is the exact failure this PR has now hit five times. Note the curve
 * never reaches 1 (it peaks near 0.90, fade included), so `cheer: 1` was not
 * even a value the game produces.
 *
 * `max(0, sin)` gives a hop and then a pause before the next one, which is what
 * jumping on the spot actually looks like; a plain sine is a bob. The linear
 * fade means the last hop lands and she settles.
 */
export function cheerAt(since: number): number {
  if (since < 0 || since >= CHEER_SECONDS) return 0;
  const fade = 1 - since / CHEER_SECONDS;
  return Math.max(0, Math.sin((since / CHEER_HOP_SECONDS) * Math.PI)) * fade;
}

/**
 * The phases a Rail Race passes through. Lives here, beside the two rules that
 * are derived from it ({@link riderLegsShow} and the celebration), so
 * `RailRace.ts` and `check:rail-race` cannot end up with two lists that
 * disagree about what a phase is called.
 */
export type RidePhase = 'waiting' | 'levelSelect' | 'countdown' | 'racing' | 'finishing';

/**
 * **Whether riders' legs are drawn in a given phase** — the rule itself, so it
 * can be checked against every phase rather than only the one a test happens to
 * put the ride in.
 *
 * Off while the race is actually on, because a seated rider's legs sink below
 * the cart's tub floor as she ducks and clip through it, which is what Jim
 * reported. On for everything else — which includes the win celebration
 * (`'finishing'`), where he asked for them back, and the whole time rivals idle
 * round the walk-past ring in view of a child on foot.
 */
export function riderLegsShow(phase: RidePhase): boolean {
  return phase !== 'countdown' && phase !== 'racing';
}

/**
 * **Whether a rider's legs are drawn.**
 *
 * Jim: *"legs also clip through slightly on the race ride — just hide the legs
 * entirely I think they're not visible anyway"*, and then, of the win
 * celebration: *"this one will need legs showing"*. So it is three states in
 * one ride — off while racing, on to celebrate, on again once she is out — and
 * that is exactly the shape that must **not** be done with a remembered list.
 *
 * `TreeClimbing.hidePlayerBody` kept such a list, skipped children that were
 * already hidden, and so recorded an empty restore set on its second call; she
 * stayed a floating head on every ride in the park afterwards, including ones
 * that had never heard of trees. It was deleted today. So this **asks** the
 * ride state every frame and sets `visible` outright. Nothing is remembered,
 * so nothing can be stranded: the worst a bug can do here is draw legs on the
 * wrong frame, not permanently delete them.
 *
 * It stays scoped to this ride — `RailRace` is the only caller, and the legs
 * are switched back on in `arrive()` whatever happened during the race.
 */
export function setRiderLegsVisible(target: Duckable, visible: boolean): void {
  const leftLeg = target.limbs?.leftLeg ?? target.leftLeg;
  const rightLeg = target.limbs?.rightLeg ?? target.rightLeg;
  if (leftLeg) leftLeg.visible = visible;
  if (rightLeg) rightLeg.visible = visible;
}

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
  readonly leftLeg?: Group;
  readonly rightLeg?: Group;
}

/**
 * **Everything the ride wants a rider's body to be doing, in one object.**
 *
 * There are four things that want `body.rotation.x` on this ride — the seated
 * pose, the duck fold, the boost rock and the win jump — and `Player.animate()`
 * rewrites that property from scratch every single frame, so anything set from
 * outside is stamped over before it is drawn. The answer is not four setters
 * that take turns; it is **one owner that is told everything at once** and
 * writes the property exactly once, which is what {@link poseRailRaceRider}
 * does. Add a fifth claimant by adding a field here, never by assigning to the
 * body from somewhere else.
 */
export interface RiderPose {
  /** 0 upright, 1 fully ducked — her own duck or the shove a bar gave her. */
  readonly duck: number;
  /** 0..1, the per-press pump spring (`Rider.bob`). See {@link BOOST_ROCK}. */
  readonly pump: number;
  /** 0..1 through the win celebration's jump. See {@link CHEER_HOP}. */
  readonly cheer: number;
}

/** Seated and doing nothing else — the resting state of {@link RiderPose}. */
export const SEATED: RiderPose = { duck: 0, pump: 0, cheer: 0 };

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Poses `target` for the ride.
 *
 * Safe to call every frame with {@link SEATED} — that is the plain seated pose,
 * written out in full, so a rider who has just stopped ducking is actively put
 * back rather than left wherever the last frame happened to leave her. It is
 * never the *standing* pose: a rider on this ride is sat down for as long as she
 * is aboard, and `RailRace.arrive()` stops calling this at all when she gets
 * off.
 */
export function poseRailRaceRider(target: Duckable, pose: RiderPose): void {
  const fold = clamp01(pose.duck);
  const cheer = clamp01(pose.cheer);
  // **The rock is gated by the fold, and that is not cosmetic.** A child will
  // hold boost under a bar — `simulate.ts` already refuses to let a press build
  // boost while ducking (`registersAsPressed`), and `Rider.bob` is set from the
  // raw press regardless, so without this the two would disagree: she would
  // throw her torso forward on a pump that bought her nothing, on top of a 40°
  // fold, and put her head through her own knees. One rule, stated once.
  //
  // **The cheer is deliberately NOT gated the same way**, and it is worth saying
  // why, because gating it was tried first. A pump throws the torso forward and
  // the celebration leans it back, so where they overlap they subtract — but
  // they barely overlap: `simulate.ts`'s pump spring is empty `BOB_SECONDS`
  // (0.22 s) after her last press, and the first hop of {@link cheerAt} does not
  // peak until 0.31 s. By the time the jump is worth looking at, the rock is
  // already zero on its own.
  //
  // A `(1 - cheer)` factor was written, and `check:rail-race` caught it claiming
  // more than it delivered: the curve peaks at 0.905, so 9.5% of the rock
  // survived a gate whose whole point was that none of it should. A leaky gate
  // that reads as a rule is worse than no gate — it invites the next person to
  // trust it. The overlap is instead guarded where it is actually decided, as a
  // relationship between the spring and the curve; see `check:rail-race`.
  const pump = clamp01(pose.pump) * (1 - fold);

  // Seated first, then everything else on top of it — she ducks, pumps and
  // cheers *from* the seat, so their numbers add to the seat's rather than
  // replacing them. This is the only write to each of these properties.
  target.body.rotation.x = SIT_LEAN + DUCK_BEND * fold + BOOST_ROCK * pump - CHEER_LEAN * cheer;
  target.body.position.y = -(SIT_HIP_DROP + DUCK_HIP_DROP * fold) + CHEER_HOP * cheer;
  const squash = 1 - DUCK_SQUASH * fold;
  // Widen as she flattens, the way every squash in this park does: a body that
  // only loses height reads as scaled, one that spreads reads as squashed.
  target.body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
  target.head.rotation.x = DUCK_HEAD_TUCK * fold - CHEER_LEAN * cheer;

  const leftLeg = target.limbs?.leftLeg ?? target.leftLeg;
  const rightLeg = target.limbs?.rightLeg ?? target.rightLeg;
  if (leftLeg && rightLeg) {
    const leg = SIT_LEG + (CHEER_LEG - SIT_LEG) * cheer;
    leftLeg.rotation.x = leg;
    rightLeg.rotation.x = leg;
  }

  const leftArm = target.limbs?.leftArm ?? target.leftArm;
  const rightArm = target.limbs?.rightArm ?? target.rightArm;
  if (leftArm && rightArm) {
    // Hands on the rail when she is up, pulled in to her head when she folds,
    // straight up in the air when she has won.
    const seatedArm = SIT_ARM - (DUCK_ARM_TUCK + SIT_ARM) * fold;
    const arm = seatedArm + (CHEER_ARM - seatedArm) * cheer;
    leftArm.rotation.x = arm;
    rightArm.rotation.x = arm;
    leftArm.rotation.z = 0.3 * fold + 0.5 * cheer;
    rightArm.rotation.z = -0.3 * fold - 0.5 * cheer;
  }
}
