/**
 * The one place the dodgems arena's dimensions live.
 *
 * The arena is a **circle**, not the rectangle a real fairground uses. Three
 * reasons, all of them about a six-year-old on a phone: a circle has no corners
 * to get wedged in, its wall collision is four lines of maths that can never
 * tunnel, and from the pseudo-top-down camera a round rink fills a portrait
 * screen far better than a wide rectangle does.
 */

/** Inner radius of the barrier — the floor a car can actually reach. */
export const ARENA_RADIUS = 12.4;

/** Bumper radius of one car. Cars are round for collision, whatever they look like. */
export const CAR_RADIUS = 1.15;

/** The fake wooden tree's bumper radius, at the centre of the rink. */
export const TREE_RADIUS = 1.7;

/** How bouncy a car-to-car bump is. Above 1 on purpose: feel beats realism. */
export const CAR_BOUNCE = 1.35;

/** How bouncy the barrier and the tree are. */
export const WALL_BOUNCE = 0.72;
export const TREE_BOUNCE = 1.15;

/** Impact speed (m/s) below which a touch is a nudge and makes no sparks. */
export const BUMP_THRESHOLD = 1.6;
