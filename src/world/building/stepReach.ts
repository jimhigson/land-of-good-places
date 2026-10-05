/**
 * **What "one step up" means, for feet and for the lattice alike** — the reach
 * rule `WalkSurfaces.sample` spends and `NavGrid` walks, in one place (#643,
 * #660). See `surfaces.ts`, which re-exports these, for the class that samples
 * surfaces with them.
 *
 * **A leaf on purpose**: `core/constants`, `spaces.ts` (itself a leaf) and
 * nothing else. `parkLayout.ts` floods a `NavGrid` while the park is still
 * being solved, so nothing on `NavGrid`'s import path may reach the castle's
 * placed geometry — that is derived from the layout being solved.
 */

import { BUILDING_STEP_UP, GROUND_SPHERE_RADIUS } from '../../core/constants';
import { SPACE_GARDEN, spaceAt } from '../spaces';

/**
 * **The highest world `y` in column `(x, z)` a walker standing at `(x, y, z)`
 * can step up to** — the one owner of what "one step up" means (#643).
 *
 * Outdoors the world is a sphere, and up is away from its centre, so the step
 * is measured **radially**: a surface is within reach when its distance from
 * the planet's centre is no more than `BUILDING_STEP_UP` past hers. It used to
 * be `y + BUILDING_STEP_UP`, a world-`y` reach, which at lean `θ` counts the
 * planet's lean as climb: a riser `h` tall reads `h / cos θ` plus the
 * sub-step's own plan travel times `tan θ`, so whether a child could step up a
 * knee-high edge depended on which way she walked and her frame rate — 584
 * honest step-ups refused and 55 over-tall ones admitted on the canonical park
 * (`scripts/measure-walk-reach.mts`). The deeper fall-through far out (a 0.5
 * ramp at r = 140 m dropping her 13.7 m) is cured mostly by
 * {@link carryReference}, not by this; the two are one change because a reach
 * and its reference must be measured in the same frame. Indoors up is `+Y`, the castle floors and
 * hotel rooms are hundreds of metres out where a radial reach would lean by
 * tens of degrees, so there the reach stays the plain world-`y` step — the same
 * split `up.ts`'s `upFor` makes, asked of the same `spaceAt`.
 *
 * A reference at or below the planet's centre (the `-1e6` "bare ground,
 * please" some checks ask with) is not a place anyone stands; it keeps the
 * plain world-`y` arithmetic so it still refuses everything built.
 */
export function stepCeilingAt(x: number, z: number, y: number): number {
  const cy = y + GROUND_SPHERE_RADIUS;
  if (cy <= 0 || spaceAt(x, z) !== SPACE_GARDEN) return y + BUILDING_STEP_UP;
  const reach = Math.hypot(x, cy, z) + BUILDING_STEP_UP;
  const above = reach * reach - x * x - z * z;
  // Past the horizon no column reaches that radius. Unreachable while `reach`
  // exceeds her own radius, which is never less than the column's plan
  // distance — guarded anyway, for symmetry with the inverse.
  if (above <= 0) return y + BUILDING_STEP_UP;
  return Math.sqrt(above) - GROUND_SPHERE_RADIUS;
}

/**
 * **How far `b` stands above `a` along the local up** — the one owner of "is
 * this rise within a step", for everything that decides steps without asking
 * `WalkSurfaces.sample` itself (`NavGrid`'s edges, its line walk and its
 * level separation).
 *
 * Outdoors, the difference of the two points' distances from the planet's
 * centre — exactly what {@link stepCeilingAt} spends, once a walker's reference
 * has been carried to the next column by {@link carryReference}, so a nav edge
 * and a real foot can never disagree about the same pair of heights (#643).
 * Indoors, or when either end is not in the garden, the plain `y` difference.
 */
export function riseBetween(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  const acy = ay + GROUND_SPHERE_RADIUS;
  const bcy = by + GROUND_SPHERE_RADIUS;
  if (acy <= 0 || bcy <= 0) return by - ay;
  if (spaceAt(ax, az) !== SPACE_GARDEN || spaceAt(bx, bz) !== SPACE_GARDEN) return by - ay;
  return Math.hypot(bx, bcy, bz) - Math.hypot(ax, acy, az);
}

/** True when `b` is no more than `limit` above or below `a` along the local up. */
export function withinStep(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  limit: number = BUILDING_STEP_UP,
): boolean {
  return Math.abs(riseBetween(ax, ay, az, bx, by, bz)) <= limit;
}

/**
 * **The inverse of {@link stepCeilingAt}**: the reference `y` in column
 * `(x, z)` whose step ceiling is exactly `ceilingY`. For a caller that wants
 * "everything at or below this height" out of `WalkSurfaces.sample` —
 * `NavGrid`'s level peel — and used to get it by subtracting
 * `BUILDING_STEP_UP`, which is only the inverse while the reach is world-`y`.
 */
export function stepReferenceFor(x: number, z: number, ceilingY: number): number {
  const cy = ceilingY + GROUND_SPHERE_RADIUS;
  if (cy <= 0 || spaceAt(x, z) !== SPACE_GARDEN) return ceilingY - BUILDING_STEP_UP;
  const radius = Math.hypot(x, cy, z) - BUILDING_STEP_UP;
  const below = radius * radius - x * x - z * z;
  if (radius <= 0 || below <= 0) return ceilingY - BUILDING_STEP_UP;
  return Math.sqrt(below) - GROUND_SPHERE_RADIUS;
}

/**
 * **A reference height taken in one column, re-expressed in another at the
 * same distance from the planet's centre.**
 *
 * A walker's sampler reference is the surface she was standing on, and she
 * moves in plan: asked unchanged in the next column, that `y` is a point lower
 * (towards the park) or higher (away from it) than her foot by the sub-step
 * times the sine of the lean, and the reach would spend that on the planet
 * rather than on the ramp. `Player` and `playerSim.mts` carry the reference
 * through this between sub-steps, so a level deck asks for no climb at all.
 * Indoors, or for a reference that is not a place, it is the identity.
 */
export function carryReference(
  fromX: number,
  fromZ: number,
  y: number,
  toX: number,
  toZ: number,
): number {
  const cy = y + GROUND_SPHERE_RADIUS;
  if (!Number.isFinite(y) || cy <= 0) return y;
  if (spaceAt(fromX, fromZ) !== SPACE_GARDEN || spaceAt(toX, toZ) !== SPACE_GARDEN) return y;
  const radius = Math.hypot(fromX, cy, fromZ);
  const above = radius * radius - toX * toX - toZ * toZ;
  if (above <= 0) return y;
  return Math.sqrt(above) - GROUND_SPHERE_RADIUS;
}

