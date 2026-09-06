import { NOMINAL_OUTSET } from './route';
import { POST_FOOT_RADIUS } from './trestleGeometry';

/**
 * **How far out from the park's edge the Rail Race may put something on the
 * ground — the one owner, so nobody else has to know how the ride searches.**
 *
 * Everything outside the wall competes for the same apron: the ride's trestle
 * feet, the entrance road, the bus that drives it. Until now the road knew the
 * *ride's* business — a comment in `roadRoute.ts` recited the trestle line's
 * outset and the arithmetic for clearing it — and that is this repo's most
 * expensive habit. A number restating another system's internals goes stale the
 * moment that system changes its mind, and nothing goes red when it does.
 *
 * So the ride publishes the band and the road asks. When the radial nudge
 * ladders are replaced (stage 3 step 2 deletes them in favour of the support's
 * own lean limit), **this file is the only thing that has to change** — the
 * road follows for free.
 *
 * ## Why the band is wider than the trestle line
 *
 * A trestle stands nominally at {@link NOMINAL_OUTSET}, but `track.ts` searches
 * radially either side of that for ground it may actually stand on, and the
 * foot itself has width. The band is therefore the nominal line, plus the
 * furthest the search may push a foot, plus that foot's own radius.
 *
 * The widest foot is the **race** ring's: `track.ts` scales the foot by
 * `ringSizeVsRace = ringScale / RIDE_SCALE`, and the race ring is built at
 * `RIDE_SCALE` (so 1) against the walk-past ring's 1/`RIDE_SCALE` (0.4). Taking
 * `POST_FOOT_RADIUS` unscaled is therefore the widest case rather than an
 * approximation of it.
 */
export const SUPPORT_MAX_RADIAL_NUDGE = 8;

/**
 * The outset band the ride's supports may occupy, in metres beyond the park's
 * own edge — the unit `route.ts`, `terrain.ts` and `ringPath.ts` already use.
 *
 * `inner` is clamped at 0: a support pushed inward past the edge is the park's
 * business, not the apron's, and a negative outset would read as "inside the
 * wall" to a caller reasoning about the ground outside it.
 */
export const SUPPORT_GROUND_BAND = {
  inner: Math.max(0, NOMINAL_OUTSET - SUPPORT_MAX_RADIAL_NUDGE - POST_FOOT_RADIUS),
  outer: NOMINAL_OUTSET + SUPPORT_MAX_RADIAL_NUDGE + POST_FOOT_RADIUS,
} as const;

/**
 * **The first outset at which something may be laid clear of the ride's
 * supports**, given how wide that thing is and how far it overhangs.
 *
 * `halfWidth` is the thing's own half-width; `overhang` is anything that
 * sticks out beyond it as it moves — for the cat bus, the tail, whiskers and
 * swung door that `arrivalSightline.ts` already pads by.
 *
 * A caller that wants to sit *outside* the ride asks this rather than adding up
 * the ride's numbers itself.
 */
export function outsetClearOfSupports(halfWidth: number, overhang = 0): number {
  return SUPPORT_GROUND_BAND.outer + halfWidth + overhang;
}
