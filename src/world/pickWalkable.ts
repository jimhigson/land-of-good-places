import type { Ray, Vector3 } from 'three';
import { BUILDING_STEP_UP } from '../core/constants';
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
 * - **A tap lands on what the child can see.** The surface the ray is tested
 *   against is the **topmost visible** one at each point — the lobby's gallery
 *   deck catches a tap from the floor below, because the deck is right there
 *   in front of her. `visibleCeiling` is what "visible" means: everything, in
 *   an open room or the park (`Infinity`), and only the floors the cutaway
 *   has not faded in the castle — so a tap can never send a child to a floor
 *   they cannot see. Which level the tap chose travels onward in the hit's
 *   own `y`; the router treats the same `x, z` on different levels as
 *   different destinations (`NavGrid`, Decision 11).
 *
 * It used to test against the surface within a step of the *walker's feet*
 * instead, which read as level-aware and was the opposite: a tap on the
 * plainly visible deck sailed through it and buried the target at ground
 * level inside the gallery's solid mass, because from down there the deck was
 * "not her floor". Found live, 8 August 2026, diagnosing Jim's mezzanine
 * report.
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
 * `visibleCeiling` is the height above which surfaces are hidden from the
 * player — `Infinity` wherever everything is on show. Surfaces above it are
 * not candidates, exactly as they are not candidates for a finger.
 */
export function pickWalkablePoint(
  ray: Ray,
  sample: GroundSampler,
  visibleCeiling: number,
  out: Vector3,
): boolean {
  // `sample(x, z, r)` answers with the highest surface no more than a step
  // above `r`, so this reference makes it answer with the highest surface at
  // or below the visible ceiling. The ceiling itself may be Infinity; the
  // reference must stay a real number for the arithmetic downstream.
  const reference = Math.min(visibleCeiling - BUILDING_STEP_UP, 500);

  // A tap that starts below ground (the camera clipped into a hill) is not a
  // sensible pick; treat it as a miss rather than teleporting to the near plane.
  if (surfaceGap(ray, sample, reference, 0, out) <= 0) return false;

  let previous = 0;
  for (let distance = COARSE_STEP; distance <= MAX_RAY_DISTANCE; distance += COARSE_STEP) {
    if (surfaceGap(ray, sample, reference, distance, out) <= 0) {
      refine(ray, sample, reference, previous, distance, out);
      return true;
    }
    previous = distance;
  }

  return false;
}

/**
 * Height of the ray above the topmost visible surface at `distance` along it.
 * Negative means the ray has passed through that surface. `out` is scratch.
 *
 * The reference is bounded by the **ray's own height**, so a surface the ray
 * has already passed *under* stops being a candidate: a tap through the
 * lobby's walk-through arch lands on the floor the child can see through it,
 * not on the front edge of the landing overhanging it. Before this bound, the
 * march compared the ray against the topmost surface outright, and the first
 * sample under the landing read "below the landing's top" and snapped the tap
 * 3.84 m up onto its edge — the same one-organ-earlier failure the topmost
 * rule itself fixed for the deck, inverted for an overhang.
 */
function surfaceGap(
  ray: Ray,
  sample: GroundSampler,
  reference: number,
  distance: number,
  out: Vector3,
): number {
  ray.at(distance, out);
  return out.y - sample(out.x, out.z, Math.min(reference, out.y));
}

/** Bisects the bracketing interval down to a centimetre and writes the hit. */
function refine(
  ray: Ray,
  sample: GroundSampler,
  reference: number,
  above: number,
  below: number,
  out: Vector3,
): void {
  let low = above;
  let high = below;
  for (let i = 0; i < REFINE_ITERATIONS; i += 1) {
    const middle = (low + high) / 2;
    if (surfaceGap(ray, sample, reference, middle, out) > 0) low = middle;
    else high = middle;
  }
  ray.at(high, out);
  // Snap to the surface itself rather than to wherever on it the ray stopped, so
  // the marker sits flat on the floor — bounded by the ray's own height for the
  // same overhang reason as `surfaceGap`, or the snap would lift a hit made
  // under the landing back up onto its top.
  out.y = sample(out.x, out.z, Math.min(reference, out.y + 0.05));
}
