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
