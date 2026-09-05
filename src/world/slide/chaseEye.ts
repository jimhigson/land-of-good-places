import { Vector3 } from 'three';
import { terrainHeight } from '../terrain';
import { PET_SLIDE_LEAD } from './petRiders';
import { PET_FRAME_CEILING, PET_SCREEN_RADIUS, estimatedFrameShare } from './petFraming';

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
 * ## What actually fixes #514: the aim, not the position
 *
 * **Measured across the whole seed pool — 16 parks, ~22,000 solve calls — the
 * first candidate is accepted every time and the lens never moves.** The
 * position search below has never taken a second step on any park in the game.
 *
 * So the fix is the **aim**. The old rig pointed the lens along the mount's own
 * forward, which flew it straight over the top of the line; this aims at the
 * midpoint of the child and the nearest companion and asks whether *both* sit
 * inside the frustum about that axis. At the same 4.35 m / 1.62 m the
 * historical camera used, a better axis brings a pet that was 34°–45° off-axis
 * into the picture.
 *
 * That is a smaller change than "solve the placement", and it is the one that
 * is doing the work. **Saying so here is the point**: an earlier draft of this
 * comment described a lens that "steps back until the companion is inside the
 * frustum", which is what the code *can* do and not what it *does*, and a doc
 * describing machinery that never runs is how the next person inherits a false
 * model of their own camera.
 *
 * ## It aims at the front of the line, not the whole of it
 *
 * **Two of three companions are behind the lens by construction, and no aim can
 * bring them back.** The seats are `PET_SLIDE_LEAD` = 2.73 m, then
 * `PET_SLIDE_GAP` = 1.98 m apart — so 2.73 / 4.71 / 6.69 m behind her — while
 * the lens sits at `BASE_BACK` = 4.35 m. Only the first animal (1.62 m in
 * front of the lens) is ever in the picture at all; the second is 0.36 m behind
 * it and the third 2.34 m behind it.
 *
 * So this module aims at the midpoint of the child and the **nearest**
 * companion, and `check:pet-slide` asserts on `shot.pets[0]` alone. That is a
 * deliberate scope, not an oversight — but it is narrower than "the line", and
 * it is written down here because the fix's own PR title says the camera "aims
 * at the line it is filming" when what it aims at is the front two-thirds of
 * it. Getting the whole line in frame is a **seat-layout** question (a shorter
 * `PET_SLIDE_GAP`, or the lens further back than any bend needs), not an aim
 * one, and nothing here should be read as covering it.
 *
 * ## The search below is a guard, and an unexercised one
 *
 * It is kept because the aim alone has no answer for a chute that genuinely
 * needs more room — a harder bend, a longer line, a portrait phone's narrower
 * frame — and because falling back to a fixed offset in that case is the clamp
 * this codebase forbids. But **it has never fired**, which means it is also
 * **unproven**: nothing has ever validated the shot it would produce. Treat a
 * park that makes it move as unverified territory, not as a solved case.
 *
 * `gaveUp` is reported rather than clamped, per CLAUDE.md's standing rule and
 * in the same shape as `petRiders.ts`'s bend allowance; `check:pet-slide`
 * asserts the count is zero, because a shipped game must not throw at a child
 * mid-ride.
 *
 * ## What this does NOT fix: #516 — and no claim about its cause
 *
 * The {@link terrainHeight} rejection below was written to fix #516 (the lens
 * buried in geometry near the bottom of the chute). **It never rejects
 * anything** — zero rejections in ~22,000 calls across all 16 parks — so it has
 * never once acted, and **#516 is untouched by this file**. That much is a
 * solve-side count and it stands.
 *
 * **What does NOT stand is the explanation an earlier draft of this header gave
 * for it**, and the retraction is worth more here than the deletion would be.
 * It argued that `terrainHeight` never fires because the mass burying the lens
 * is *paving, a mesh, which a height field cannot see*. The corroboration
 * offered for that was `check:pet-slide`'s own sampler reporting the lens
 * −0.09 m below ground and a ray fan naming the nearest object to it. **Both
 * numbers were false readings**: nothing renders in a check process, so the
 * camera's `matrixWorld` was never flushed and the sampler was measuring the
 * **world origin** — `terrainHeight(0, 0)` = 0.09 — rather than the lens. The
 * tell was that the control run, whose camera is somewhere else entirely,
 * printed identical figures.
 *
 * With the sampler fixed (`updateWorldMatrix(true, false)`), the canonical park
 * measures the chase lens **5.41 m above the ground at its lowest, 0 frames
 * underground**, and 53.53 m from the ball pit's rim — where the same run
 * previously claimed 1.99 m. The ray fan, gated on the lens being underground,
 * therefore **never fires at all**, and now says so on every run.
 *
 * So this file makes **no claim about #516's cause**. Its stated culprit (the
 * pit rim) is not supported here, and neither is the paving hypothesis that
 * replaced it — that hypothesis was reasoning from an instrument reading the
 * origin. #516's cause has now been misidentified twice; whoever takes it
 * should measure the camera on the seed the defect was reported on, with an
 * instrument whose control disagrees with its wired run, before naming
 * anything.
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
 * A stop, not a tuning knob, and a chute that wants more is reported rather
 * than clamped.
 *
 * **Never spent.** Measured across the whole pool, the solve accepts its first
 * candidate on every frame of every park, so `extraBack` has never exceeded 0
 * and the measured need is **zero**, not the "under a metre" an earlier draft
 * of this comment claimed. The range is headroom for a chute that needs it, not
 * a described behaviour — see the header's note that this search is a guard,
 * and an unproven one.
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

/**
 * How much of {@link PET_FRAME_CEILING} the solve will actually spend.
 *
 * The solve works off an **estimate** of the frame share (a sphere against a
 * rectangle of angles); the check **measures** it by raster. Leaving headroom
 * between the two means an estimate that runs a little light cannot hand the
 * check a frame it then fails — the solve aims well inside the band rather
 * than at its edge.
 */
const CEILING_SAFETY = 0.6;

const eye = new Vector3();
const toPet = new Vector3();
const toChild = new Vector3();
const axis = new Vector3();

/**
 * **What the near bound actually did, counted rather than assumed** (#518).
 *
 * The ceiling guard below was written to stop the lens pressing a companion
 * against the glass, and for its whole life it **rejected nothing** — the
 * defect #518 is about. A guard that looks calibrated and cannot fire is worse
 * than one visibly absent, and the only thing that tells the two apart is a
 * count, so these are counted and `check:pet-slide` prints them on every run.
 *
 * Kept after the fix, not deleted with it: "it fires now" is exactly as much a
 * measurement as "it never fired", and the next change in this area needs to be
 * able to see which it is without re-deriving an instrument.
 */
let ceilingRejections = 0;
let ceilingCalls = 0;
let ceilingWorstShare = 0;

/** How many placements the near bound has rejected — 0 was the whole of #518. */
export function chaseCeilingRejections(): number {
  return ceilingRejections;
}

/** How many times the near bound was asked at all, so a 0 above can be read. */
export function chaseCeilingCalls(): number {
  return ceilingCalls;
}

/** The largest frame share the near bound ever estimated, against its threshold. */
export function chaseCeilingWorstShare(): number {
  return ceilingWorstShare;
}

/** Zero the near-bound counters — called when a ride is boarded. */
export function resetChaseCeilingCounters(): void {
  ceilingRejections = 0;
  ceilingCalls = 0;
  ceilingWorstShare = 0;
}

/**
 * The threshold the near bound actually compares against, exported so a check
 * can print the guard's worst estimate *beside the number that would have made
 * it fire* rather than restating the product itself.
 */
export const CEILING_REJECT_ABOVE = PET_FRAME_CEILING * CEILING_SAFETY;

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
  aspect: number,
): ChaseEye {
  const wanted = halfFovRad * FRAME_SAFETY;

  for (let extraBack = 0; extraBack <= MAX_EXTRA_BACK; extraBack += BACK_STEP) {
    for (let extraUp = 0; extraUp <= MAX_EXTRA_UP; extraUp += UP_STEP) {
      const back = BASE_BACK + extraBack;
      const high = BASE_UP + extraUp;
      eye.copy(rider).addScaledVector(behind, back).addScaledVector(up, high);

      // Ground first, because it is cheap and it disqualifies outright.
      //
      // **This has never rejected a placement** — 0 rejections in ~22,000 calls
      // across all 16 pool parks — so it is not, in practice, the fix for #516
      // that it was written to be. Measured with a corrected sampler, the lens
      // on the canonical park never comes within 5.41 m of the ground, which is
      // consistent with a guard that never fires and is not evidence about what
      // #516 actually is. **No cause is claimed here — see the header.**
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
      // **The other bound.** Getting the animal inside the frustum is only half
      // the question, and a solve given one bound and not the other is exactly
      // the shape of the bug this file was written to fix — the first version
      // of it traded "pet out of shot" for "pet filling the shot", which is the
      // failure `PET_FRAME_CEILING` was read off in the first place (a
      // companion 0.45 m in front of the lens, the child nowhere in frame).
      //
      // The ceiling is imported, never restated: `slide/petFraming.ts` owns it
      // and `check:pet-slide` reads the same one.
      // **KNOWN GAP — this guard still does not bind, and the reason is the
      // reference point, not the radius.** `toPet` runs to the companion's
      // *seat*, which is its origin at its feet; the reclining body extends
      // back from there **towards the lens**. Measured on the canonical park,
      // the seat sits ~2.3 m from the eye while the drawn body's centre is
      // ~1.35 m, and the threshold only bites under about 1.5 m — so the solve
      // reads ~6% where the raster later measures 21%, and accepts.
      //
      // That is the same disease as **#471** (a check measuring a pet's *root*
      // while its body hangs outside the trough) and as #513: a measurement
      // taken on a convenient point rather than on the thing that gets drawn.
      // Fixing it means asking the companion's real extent, which this module
      // deliberately does not have — it is given seats, not bodies. Recorded
      // here rather than papered over, because the alternative is a guard that
      // looks calibrated and cannot fire.
      const share = estimatedFrameShare(
        toPet.length(),
        // The radius that predicts *screen area*, not the collision radius —
        // see PET_SCREEN_RADIUS. Using PARADE_MEMBER_RADIUS here made this
        // guard read a median 4.2x light across the pool.
        PET_SCREEN_RADIUS,
        halfFovRad,
        aspect,
      );
      ceilingCalls += 1;
      if (share > ceilingWorstShare) ceilingWorstShare = share;
      if (share > CEILING_REJECT_ABOVE) {
        ceilingRejections += 1;
        continue;
      }
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
