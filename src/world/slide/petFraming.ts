import { PARADE_MEMBER_RADIUS } from '../../core/constants';
import { PET_RECLINED_LENGTH } from './petRiders';

/**
 * **How much of the chase shot a companion may fill — the one owner.**
 *
 * These two numbers are a **band**, and reading them as anything else is the
 * mistake this file exists to prevent:
 *
 * - Under {@link PET_FRAME_FLOOR} the animal is **not in the picture**. That
 *   was #514: the nearest companion sat 34°–45° below the camera's own axis
 *   against a 30° half-fov, out of shot on every raster of every park, and the
 *   4–12% the clause scored was its top edge clipping in from underneath.
 * - Over {@link PET_FRAME_CEILING} the animal is **pressed against the glass**.
 *   That failure is already on the record: with the seats laid out plainly the
 *   third companion rode **0.45 m in front of the lens** and filled essentially
 *   the whole frame with the child nowhere in it.
 *
 * **So the target is a band, not a maximum, and "bigger is better" is the wrong
 * reading of any change in this area.** The honest case — a companion genuinely
 * following her at 1.5–2.7 m — lands at a few percent, comfortably inside both.
 *
 * ## Why this module exists at all
 *
 * `check:pet-slide` owned both numbers, and `slide/chaseEye.ts` now has to
 * respect them while *placing* the camera. A second copy in the solver would be
 * the two-definitions-kept-in-step-by-hand fault — **inside the fix for a
 * two-definitions fault** — so the constants moved here, to `src/`, where both
 * the game and the check can read them. The check imports them; it does not
 * restate them.
 */

/**
 * The least of the chase frame the nearest companion may fill and still count
 * as being in the shot.
 *
 * 1% of a 120 × 68 raster is 82 px — about a third the area a pet at the back
 * of the line makes, and far more than the handful of pixels an ear clipping
 * the border would.
 */
export const PET_FRAME_FLOOR = 0.01;

/**
 * The most of the chase frame any one companion may fill.
 *
 * **Read off the failure, not chosen in the abstract.** 25% sits far above the
 * honest case and far below the wall-of-fur one, so it cannot be satisfied by
 * accident and cannot fail correct behaviour.
 */
export const PET_FRAME_CEILING = 0.25;

/**
 * **The radius to predict a reclining companion's screen area with** — and
 * emphatically *not* `PARADE_MEMBER_RADIUS`.
 *
 * `PARADE_MEMBER_RADIUS` is **0.22 m**, and its own doc says what it is for:
 * the number "the parade shoves that companion about with", shared with
 * `petBedFit` so two beds leave a walkable strip. It is a **collision** radius.
 * Using it to predict how much of the *screen* an animal covers is a category
 * error, and a measurable one: with it, the solve's estimate came out a
 * **median 4.2× under** what `check:pet-slide` then rastered, across 154 wired
 * samples on all 16 parks (range 1.65×–5.89×).
 *
 * A companion lying on the chute is not a 0.22 m ball. It is **1.53 m long**
 * (`PET_RECLINED_LENGTH`) and about 0.44 m across, presented side-on to a lens
 * following it down a slide. Modelling that as a circle of its *width* is what
 * made the guard optimistic in exactly the direction that stops it binding.
 *
 * So: the **ellipse-equivalent radius**, `sqrt(halfLength × halfWidth)`, which
 * is the radius of a circle with the same area as the ellipse the animal
 * actually projects. That is a real geometric quantity rather than a fudge
 * factor, and it is derived from the two lengths their own owners already
 * publish, so neither is copied here.
 *
 * **Measured before and after**, 154 wired rasters across all 16 parks,
 * comparing this estimate against what `check:pet-slide` actually rasters:
 *
 * | radius used | ratio measured ÷ estimate |
 * |---|---|
 * | `PARADE_MEMBER_RADIUS` (0.22) | median **4.21×**, range 1.65–5.89, *rising with distance* |
 * | `PET_SCREEN_RADIUS` (0.41) | around **1.0**, range ~0.67–1.61 |
 *
 * The old error was not a calibration — it swung by 3.6× and trended with
 * distance, so no safety factor could have absorbed it. That is why the model
 * was corrected rather than the factor, and why {@link estimatedFrameShare}'s
 * "cheap estimate" disclaimer is not licence for it to be wrong in shape.
 *
 * **It still does not make the ceiling bind — see the note on the solver's
 * reference point in `chaseEye.ts`.** Fixing the radius was necessary and is
 * not sufficient.
 */
export const PET_SCREEN_RADIUS = Math.sqrt(
  // half-length × half-width. The half-width *is* the collision radius: that
  // number is a radius already, which is precisely why it was so easy to reach
  // for here and so wrong to use alone.
  (PET_RECLINED_LENGTH / 2) * PARADE_MEMBER_RADIUS,
);

/**
 * Roughly what fraction of the frame a body of `radius` at `distance` covers.
 *
 * **An estimate, and deliberately a cheap one** — it treats the animal as a
 * sphere and the frame as a rectangle of angles. It exists so the camera solve
 * can *reject* a placement that would press a companion against the glass
 * before drawing it, at a cost it can afford every frame.
 *
 * It is **not** the measurement. `check:pet-slide` rasters the real camera and
 * counts what the rays land on, which is the honest form of the question and
 * far too expensive to run per frame. This only has to be right enough to keep
 * the solve inside the band; the check is what proves it landed there.
 */
export function estimatedFrameShare(
  distance: number,
  radius: number,
  halfFovRad: number,
  aspect: number,
): number {
  if (distance <= radius) return 1;
  const angular = Math.asin(Math.min(1, radius / distance));
  const halfHeight = halfFovRad;
  const halfWidth = Math.atan(Math.tan(halfFovRad) * aspect);
  const frame = 4 * halfHeight * halfWidth;
  if (frame <= 0) return 1;
  return Math.min(1, (Math.PI * angular * angular) / frame);
}
