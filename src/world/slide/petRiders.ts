import { Vector3 } from 'three';
import { RIDE_RECLINE } from '../../entities/ridePose';
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
  /**
   * How far back the body lies, radians, **on top of** {@link pitch} and in the
   * same yawed frame — so a companion is turned by `pitch + recline` about its
   * own left-right axis and ends up lying along the chute rather than standing
   * on it.
   *
   * Always `RIDE_RECLINE`, the child's own. It is carried in the seat rather
   * than read by `ParadeMember` directly because the seat is already the one
   * message the ride sends the parade: everything about *how a companion rides*
   * arrives in one object, and there is no second channel to keep in step.
   */
  recline: number;
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
 * The length of a **reclining child**, in metres: how far back along the chute
 * her body reaches from the point her feet are placed at.
 *
 * Measured on a really-built `CharacterModel` posed by `applyRidePose` at
 * `'reclined'` and turned by {@link RIDE_RECLINE} — the pose the game actually
 * draws her in — not reasoned about. Her *head* is 1.33 m behind her feet, and
 * the doc on `RIDE_RECLINE` says so; her **arms**, thrown back over her head at
 * −1.95, reach **2.28 m**, and it is the arms a pet clips into. That gap
 * between the number everybody quotes and the number that matters is exactly
 * why this is measured off the built rig.
 *
 * Written down rather than measured at run time on purpose: building a kid to
 * place a pet would drag `CharacterModel` into the ride's module graph for one
 * scalar. The guard against it drifting is not this comment — it is
 * `check:pet-slide`'s **no companion touches her** clause, which compares the
 * drawn meshes of the real child against the drawn meshes of the real pets on
 * every frame of a real descent and fails on the first millimetre of overlap.
 * A number that a check re-measures every build is not a copy.
 */
const CHILD_RECLINED_LENGTH = 2.28;

/**
 * The same, for the **longest companion**: how far back a reclining animal
 * reaches from its own seat.
 *
 * Measured across every catalogue entry `walksInParade` accepts, in the same
 * pose, the same way `petBedFit` measures the biggest sleeper — so the spacing
 * fits the roundest pet in the game rather than the one that happened to be
 * tried. The puff is the long one at 1.52 m; the bunny is 1.53 m nose to tail
 * but narrower. Standing, every one of them is 1.46 m *tall*; lying down that
 * height becomes length, which is the whole reason this number is not the one
 * the first version of this feature was spaced by.
 */
const PET_RECLINED_LENGTH = 1.53;

/**
 * The daylight left between one body and the next, in metres.
 *
 * **The one number here that is a choice rather than a measurement.** Jim, 1
 * September 2026, having ridden it: *"Pet on the slide shouldn't mean they clip
 * inside the player's head."* They did: the first companion rode 1.5 m behind
 * her, which is 0.78 m *inside* a child whose arms reach 2.28 m back, and it
 * stood upright through her while it did it.
 *
 * 0.45 m is half a pet's width, and it has to absorb four things a measurement
 * of two straight bodies laid end to end cannot:
 *
 * - **the chute bends**, so two rigid bodies spaced along the curve lie across
 *   its chords rather than along it, and reach past each other on the inside of
 *   every turn;
 * - her hair and her backpack are **hers**, chosen in the character creator,
 *   and are not in the 2.28 m above — that is a default kid;
 * - a pet breathes, bobs and squashes, and the reclining lift is measured off
 *   the model at rest;
 * - and the last two metres of chute flatten into the landing, where she and
 *   the animal behind her stop pitching at different rates.
 *
 * Both smaller values were tried and measured, not reasoned about. At 0.30 m
 * the mouse touched her over four frames at the very bottom of the descent —
 * a centimetre, invisible, and exactly the sort of near-miss that becomes a
 * visible clip on a seed whose slide bends harder.
 */
const BODY_CLEARANCE = 0.45;

/**
 * How far behind her the first companion rides, in metres of chute.
 *
 * **Measured against her body, not against the lens.** The version Jim saw put
 * this at 1.5 m because that was a good-looking gap in the chase shot, and a
 * gap that is safe in a plan view is not safe against a child lying down: she
 * occupies the 2.28 m of chute behind her own feet, so 1.5 m was inside her.
 * Keeping a companion out of the *camera* and keeping it out of *her* are
 * different questions, and only the second one is about her.
 */
export const PET_SLIDE_LEAD = CHILD_RECLINED_LENGTH + BODY_CLEARANCE;

/**
 * Gap between one companion and the next, in metres of chute.
 *
 * The same rule one place further down the line: a body's own length plus the
 * daylight after it. This is what makes "no two on the same spot" hold at three
 * pets and at eight — the line is strictly ordered along one curve and every
 * neighbouring pair is spaced by more than either of them is long, so it is
 * true by construction rather than by a separation force that has to converge.
 *
 * It is deliberately *not* {@link PET_SLIDE_LEAD}: a pet is a metre shorter
 * than a reclining child, and spacing the whole line at her length would string
 * eight animals out over twenty metres of chute for no reason.
 */
export const PET_SLIDE_GAP = PET_RECLINED_LENGTH + BODY_CLEARANCE;

/**
 * How far a companion sits to the side of the chute's centre line, in metres,
 * alternating left and right down the line.
 *
 * Two things at once, and the second is the important one:
 *
 * - the child is at the **far** end of the chase shot and everybody else is
 *   between her and the lens, so a line straight down the middle of the trough
 *   puts a pet in front of her face for the whole descent. Staggered, the
 *   middle of the shot stays hers.
 * - a queue of identical animals in single file reads as one long creature.
 *   Zigzagged, it reads as several pets, which is what it is.
 *
 * Inside the trough with room to spare: `CHUTE_ENVELOPE.halfWidth` is 0.95 m
 * and `PARADE_MEMBER_RADIUS` is 0.3, so 0.45 leaves 0.2 m of wall clearance.
 */
export const PET_SIDE_STEP = 0.45;

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
const across = new Vector3();
const UP = new Vector3(0, 1, 0);
const ahead = new Vector3();
const trial = new Vector3();

/**
 * How much extra chute the bend allowance may ever spend, in metres.
 *
 * A stop, not a tuning knob: the solve below walks back until the bodies really
 * are apart, and this bounds the walk so a pathological chute cannot push a
 * companion arbitrarily far up the slide, or loop for ever. Measured worst case
 * across the seed pool is 0.15 m, so 1.5 m is ten times the worst bend the
 * generator has ever produced.
 *
 * **What happens if it is ever reached, said honestly.** The solve gives up and
 * returns the furthest seat it was allowed, which may still be too close — so
 * on such a chute a pet would be drawn clipping into her, exactly as before
 * this fix. The shipped game has no check in it and would simply draw that;
 * nothing would be thrown and a child would see a pet inside her, which is why
 * {@link bendAllowanceExhaustions} exists rather than a comment claiming this
 * "fails visibly". It does not fail visibly on its own. It is *counted*, and
 * `check:pet-slide` asserts the count is zero, so the giving-up is visible to
 * the one thing that can act on it.
 */
export const MAX_BEND_ALLOWANCE = 1.5;

/**
 * How many times the solve has run out of {@link MAX_BEND_ALLOWANCE} since the
 * last reset — i.e. how many companion-frames were seated **closer than the
 * clearance asks for**, because no reachable seat satisfied it.
 *
 * A plain count rather than a throw: this runs every frame of a real ride, and
 * a child who has done nothing wrong should not be shown a crash because her
 * park's chute bends unusually hard. But a silent clamp is how a fix like this
 * rots — it would go on producing exactly the clipping #507 is about while
 * every check stayed green. So the number is kept, and `check:pet-slide`
 * asserts it is zero across the descent.
 */
let bendAllowanceExhausted = 0;

/** See {@link bendAllowanceExhausted}. */
export function bendAllowanceExhaustions(): number {
  return bendAllowanceExhausted;
}

/** Zeroes {@link bendAllowanceExhausted}, so one descent can be measured. */
export function resetBendAllowanceExhaustions(): void {
  bendAllowanceExhausted = 0;
}

/** Resolution of the walk, in metres. Well under the 1 cm clips it must fix. */
const BEND_STEP = 0.05;

/**
 * **The chute's own centre line** at an arc distance, and the single owner of
 * what "before the top of the chute" means — the child's place on it and every
 * companion's are the same question asked at different distances, so they are
 * the same code. Leaves `tangent` at that place, which every caller then wants.
 */
function chutePointAt(slide: SlideRide, distance: number, out: Vector3): void {
  const t = Math.min(1, Math.max(0, distance) / slide.length);
  slide.pointAt(t, out);
  slide.tangentAt(t, tangent);
  // Behind the lip: carry on along the entry tangent, backwards. `distance` is
  // negative here, so this subtracts.
  if (distance < 0) out.addScaledVector(tangent, distance);
}

/** The raw seat point for an arc distance and slot, side-step included. */
function seatPointFor(slide: SlideRide, distance: number, slot: number, out: Vector3): void {
  chutePointAt(slide, distance, out);

  // Left, right, left — see PET_SIDE_STEP. Across the chute is the tangent
  // crossed with world up, which is the same "up is always world up" the chute
  // itself is swept with (`SlideRide`), so a companion stays in the trough
  // through a corkscrew instead of being rolled up its wall by a Frenet frame.
  across.crossVectors(tangent, UP);
  if (across.lengthSq() > 1e-6) {
    across.normalize();
    out.addScaledVector(across, slot % 2 === 0 ? PET_SIDE_STEP : -PET_SIDE_STEP);
  }
}

/**
 * How far back along the chute a body must sit for `wanted` metres of **real
 * daylight** between it and the body in front of it.
 *
 * ## Why this is not just `fromArc - wanted`
 *
 * That is what it used to be, and it is the bug in #507. `PET_SLIDE_LEAD` and
 * `PET_SLIDE_GAP` are lengths of **bodies** — a reclining child is 2.28 m long
 * in a straight line, not 2.28 m of chute — but they were being spent as arc
 * length. On a bend the chord is shorter than the arc, so the daylight the
 * constants promise quietly shrinks by however hard that particular chute
 * happens to turn, and two rigid bodies laid across the chords reach past each
 * other on the inside of the turn. The `BODY_CLEARANCE` doc says exactly this
 * and calls the outcome "a near-miss that becomes a visible clip on a seed
 * whose slide bends harder"; **pool seed 346 is that seed**, clipping 1 cm at
 * rider 50 m of a 78 m chute where its bend eats 0.135 m against the canonical
 * park's 0.114 m.
 *
 * Raising `BODY_CLEARANCE` until those two seeds pass would be tuning a
 * constant against the parks that happen to be in the pool today, and the next
 * chute that bends harder would clip again — the same shape as weakening an
 * assertion, one level down, and exactly what CLAUDE.md's "procgen backtracks
 * on collision" rule forbids. So this asks the chute that was actually built
 * how far back the daylight really is, instead of assuming a straight one.
 *
 * The constants keep their meaning and their single ownership: they still say
 * how long a body is and how much room to leave after it. Only the units they
 * are spent in are corrected, from metres-of-chute to metres.
 */
function arcForChord(
  slide: SlideRide,
  from: Vector3,
  fromArc: number,
  wanted: number,
  slot: number,
): number {
  // The old answer is the first guess and also the floor: a bend can only ever
  // require a companion to sit *further* back, never nearer.
  const floor = fromArc - wanted;
  for (let extra = 0; extra <= MAX_BEND_ALLOWANCE; extra += BEND_STEP) {
    seatPointFor(slide, floor - extra, slot, trial);
    if (trial.distanceTo(from) >= wanted) return floor - extra;
  }
  // Gave up: this seat is closer than `wanted` and a pet may clip. Counted, not
  // thrown — see {@link bendAllowanceExhausted}.
  bendAllowanceExhausted += 1;
  return floor - MAX_BEND_ALLOWANCE;
}

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
 *
 * **Still a plain line, and still plain on purpose.** An older version had a
 * hole punched in it — a "blind band" that shunted any companion landing near
 * the chase lens out past the far side of it, because a 1.46 m animal standing
 * bolt upright 45 cm from the camera filled the entire frame. Lying down
 * retired the problem the band was invented for rather than mitigating it: a
 * reclining pet stands 0.6–0.9 m off the trough floor against a lens 1.62 m
 * above it, so the one that passes under the camera passes *under* it — some
 * 70° below the axis of a shot whose lower edge is 38° down — and is simply not
 * in the picture, instead of being all of it. A hole in the line was visible
 * from the three trackside cameras, which see the whole line in profile and
 * were never the shot the band was protecting. What #507 adds is not a second
 * hole: the bend allowance moves every companion the same way for the same
 * reason, and only ever backwards.
 *
 * Nothing here asserts where the camera is, and that is deliberate — the copy
 * of `CHASE_EYE.z` this module used to keep, purely so the band could be
 * measured around it, is gone with the band. What replaces it is not another
 * constant but a measurement: `check:pet-slide` rasters the **live** chase
 * camera and fails if the child is ever hidden or a pet ever fills more than a
 * quarter of the frame, so moving the lens is answered by the shot rather than
 * by two numbers promising each other they still agree.
 */
export function petSeatOnSlide(
  slide: SlideRide,
  riderDistance: number,
  slot: number,
  seat: SlideSeat,
): void {
  // **Walk the line down from her, link by link.** Each companion's daylight is
  // measured against the body actually in front of it — hers for the first, the
  // previous animal for the rest — which is the same rule the line already had
  // and the same one `check:pet-slide` asserts. It is re-walked per slot rather
  // than cached because the ride asks for one seat at a time and a cache would
  // be a second description of where the line is; at eight companions the whole
  // chain is re-walked for each of them, so the cost is the triangle 8·9/2 = 36
  // links a frame, each sampling the curve at least four times (twice per
  // `seatPointFor`, and more wherever a bend makes the solve step) — call it
  // 150 samples a frame rather than the "few dozen" an earlier draft of this
  // comment claimed, which counted links and forgot what a link costs.
  chutePointAt(slide, riderDistance, ahead);

  let distance = riderDistance;
  for (let link = 0; link <= slot; link += 1) {
    distance = arcForChord(slide, ahead, distance, link === 0 ? PET_SLIDE_LEAD : PET_SLIDE_GAP, link);
    seatPointFor(slide, distance, link, point);
    ahead.copy(point);
  }
  // `seatPointFor` left `tangent` at this companion's own place on the chute,
  // which is what facing and pitch below want.

  seat.x = point.x;
  seat.y = point.y + PET_RIDE_LIFT;
  seat.z = point.z;
  seat.facing = Math.atan2(tangent.x, tangent.z);
  seat.pitch = slopeOf(tangent);
  // **On its back, feet first, exactly as she is.** The child's own recline,
  // taken from the one place that defines it, so there is no second answer to
  // "how does a body lie on this chute" for the two kinds of body on it.
  seat.recline = RIDE_RECLINE;
}
