/**
 * The shape of the park, as far as a rail route is concerned.
 *
 * This exists as an interface rather than a radius constant because the park's
 * boundary is going to stop being a circle (issue #115 wants a gentle spline
 * roughly twice the area). When that lands, it plugs in here and the route
 * generator does not reopen.
 *
 * The pattern being avoided is `train/route.ts`, which bakes
 * `WALL_INNER_RADIUS = GARDEN_HALF_SIZE - 2 - 0.45` straight into its solver in
 * three places. Every one of those is a site that has to be found and changed
 * when the boundary stops being a radius, and a solver that reads a number
 * cannot be handed a different *shape* at all.
 *
 * `distanceToEdge` is signed the way a signed distance field is: positive
 * inside, so a corridor of width `w` fits wherever `distanceToEdge >= w`, and a
 * caller never has to know whether the edge is a circle, a polygon or a spline.
 */
export interface ParkBoundary {
  /** Is (x, z) inside the park at all? */
  contains(x: number, z: number): boolean;
  /** Metres from (x, z) to the nearest edge. Positive inside, negative out. */
  distanceToEdge(x: number, z: number): number;
}

/**
 * Today's only implementation: a circle about the origin.
 *
 * Note that a rail ride's boundary is not the player's boundary. The garden's
 * soft wall is `GARDEN_PLAY_RADIUS` (58 m) and the masonry is at 60 m, but the
 * train owns the 48-58 m band and the Rail Race rings it at 53.5 m, so a route
 * that may not trespass into either is handed a much smaller circle than the
 * park's own. Callers pass the radius they are entitled to.
 */
export function circleBoundary(radius: number): ParkBoundary {
  return {
    contains: (x, z) => Math.hypot(x, z) <= radius,
    distanceToEdge: (x, z) => radius - Math.hypot(x, z),
  };
}
