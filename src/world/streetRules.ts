/**
 * Rules the street router and the layout's doormat probe must share — a leaf
 * module, because `paths.ts` imports `parkLayout.ts` and the probe runs
 * inside the layout's own solve, so neither can read the other.
 */

/**
 * **A destination's own frontage is exempt from street clearance, and so is
 * any plot standing within this many metres of the destination.** An
 * arriving stub may run along that plot's face — just never through open
 * ground it would otherwise have to clear. `paths.ts`'s `computeStreetStubs`
 * applies it to every arriving stub; sized to cover a doormat's stand-off
 * (1.4 m), its 3.5 m arrival lead and a plot's own frontage wobble (the ball
 * pit's slide exit measured 5.7 m from the plot edge, just past a first 5.6 m
 * version).
 *
 * `parkLayout.ts`'s doormat probe reads the same number for the same reason:
 * a plot the router would let the arriving stub pass is not a plot the probe
 * may refuse a door for. Seed 1, 6 Sep 2026: the castle's doormat stands
 * inside the ball pit's footprint by design (the near pair), the built park
 * has a spot 0.07 m from it, and a probe that counted the pit as solid
 * refused the door, redrew the castle and broke the seed.
 */
export const ARRIVAL_EXEMPT_NEAR = 7;

/** The non-arriving stub's exemption — a plot it is already touching. */
export const DEPARTURE_EXEMPT_NEAR = 0.5;
