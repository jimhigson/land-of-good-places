import type { Ray, Vector3 } from 'three';
import type { GroundSampler } from '../entities/Player';

/**
 * "Where would the character stand if I tapped here?"
 *
 * The park has no collision meshes to raycast against — the floor of the world
 * is a *function*, `WalkSurfaces.sample()`, and the geometry is only its
 * portrait. So instead of firing a three.js `Raycaster` at triangles (which
 * would happily hit the underside of a deck, a pane of glass, or a tree canopy)
 * this walks along the ray asking that same function where the ground is, and
 * stops at the first place the ray is no longer above it.
 *
 * Two things fall out of doing it this way, both of them the reason it is done
 * this way:
 *
 * - **A tap can only ever land somewhere you could actually stand.** Glass,
 *   railings, balloons and shop signs are invisible to it.
 * - **Multi-floor taps work by themselves.** The sampler is asked with the
 *   *walker's* height as its reference, so it only ever answers with surfaces
 *   within one step of the player's own feet — which is precisely the set of
 *   floors that the cutaway view is showing them. Tapping the patch of deck
 *   three you can see gets you deck three; the invisible decks above are not
 *   candidates, so a tap can never send a child to a floor they cannot see.
 */

/**
 * Far enough to cross the whole park from the camera's near plane, which sits
 * `CAMERA_DISTANCE` back from the focus.
 */
const MAX_RAY_DISTANCE = 240;

/**
 * Coarse march step, in metres along the ray.
 *
 * At the camera's 38° pitch this drops the ray about 22 cm per step, so nothing
 * a child can stand on is stepped over; the binary refinement afterwards brings
 * the answer inside a centimetre.
 */
const COARSE_STEP = 0.35;

const REFINE_ITERATIONS = 14;

/**
 * Marches `ray` until it meets the walkable surface and writes the meeting point
 * into `out`. Returns false if the ray leaves the park without touching ground
 * (a tap on the sky).
 *
 * `referenceY` is the height of whoever is going to walk there — pass the
 * player's feet.
 */
export function pickWalkablePoint(
  ray: Ray,
  sample: GroundSampler,
  referenceY: number,
  out: Vector3,
): boolean {
  // A tap that starts below ground (the camera clipped into a hill) is not a
  // sensible pick; treat it as a miss rather than teleporting to the near plane.
  if (surfaceGap(ray, sample, referenceY, 0, out) <= 0) return false;

  let previous = 0;
  for (let distance = COARSE_STEP; distance <= MAX_RAY_DISTANCE; distance += COARSE_STEP) {
    if (surfaceGap(ray, sample, referenceY, distance, out) <= 0) {
      refine(ray, sample, referenceY, previous, distance, out);
      return true;
    }
    previous = distance;
  }

  return false;
}

/**
 * Height of the ray above the walkable surface at `distance` along it. Negative
 * means the ray has gone under the floor. `out` is used as scratch.
 */
function surfaceGap(
  ray: Ray,
  sample: GroundSampler,
  referenceY: number,
  distance: number,
  out: Vector3,
): number {
  ray.at(distance, out);
  return out.y - sample(out.x, out.z, referenceY);
}

/** Bisects the bracketing interval down to a centimetre and writes the hit. */
function refine(
  ray: Ray,
  sample: GroundSampler,
  referenceY: number,
  above: number,
  below: number,
  out: Vector3,
): void {
  let low = above;
  let high = below;
  for (let i = 0; i < REFINE_ITERATIONS; i += 1) {
    const middle = (low + high) / 2;
    if (surfaceGap(ray, sample, referenceY, middle, out) > 0) low = middle;
    else high = middle;
  }
  ray.at(high, out);
  // Snap to the surface itself rather than to wherever on it the ray stopped, so
  // the marker sits flat on the floor.
  out.y = sample(out.x, out.z, referenceY);
}
