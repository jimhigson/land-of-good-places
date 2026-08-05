/**
 * **The Sky Cruiser's car, as numbers, in exactly one place.**
 *
 * Every clearance question in the park that involves this ride — does the loop
 * miss the castle, does the cart fit the window cut for it, is there air over
 * the train — is a question about this box. Before this module the width lived
 * as a bare `1.5` inside a `toonBox(…)` call in `Coaster.ts`, and *two separate
 * copies* of the derived `CAR_HALF_WIDTH = 0.75` sat in `coaster/route.ts` and
 * in `test/procgen/invariants.ts`, the second with a comment explaining that it
 * was restated on purpose. Restating a number on purpose is still restating it:
 * widen the car and two of the three places that care would have gone on
 * asserting the old width, and the assert that matters most would have been the
 * one that quietly stopped being true.
 */

/** The body: `toonBox(width, height, length)` in `Coaster.ts`. */
export const CART_BODY_WIDTH = 1.5;
export const CART_BODY_HEIGHT = 0.7;
export const CART_BODY_LENGTH = 2.2;

/**
 * The rider's eye above the track centre line — the seat mount (0.6) plus the
 * eye offset within it (0.95).
 *
 * This, not the roof of the body, is the top of the ride for clearance
 * purposes. The Sky Cruiser is `camera: 'firstPerson'`, so the player model is
 * not drawn at all and the highest thing aboard is a camera floating 0.85 m
 * above the pink box. Fly *that* through a lintel and the screen fills with the
 * inside of a stone block, which is a far worse thing to ship than brushing a
 * mesh nobody can see.
 */
export const CART_EYE_HEIGHT = 1.55;

/** The ties hang this far below the centre line (`mid.y - 0.12`, 0.08 thick). */
export const CART_TIE_DROP = 0.16;

/**
 * The box the ride sweeps along its centre line, in metres.
 *
 * Half-width either side; `above` to the rider's eye; `below` to the underside
 * of the ties. Anything that has to not touch the Sky Cruiser is asking about
 * this envelope, and anything sized *for* the Sky Cruiser — the castle window —
 * is sized from it plus a clearance.
 */
export const CART_ENVELOPE = {
  halfWidth: CART_BODY_WIDTH / 2,
  above: CART_EYE_HEIGHT,
  below: CART_TIE_DROP,
} as const;
