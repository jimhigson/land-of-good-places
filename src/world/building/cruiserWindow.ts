import { BUILDING_HALF_X, BUILDING_HALF_Z, BUILDING_WALL_THICKNESS } from '../../core/constants';
import { CART_ENVELOPE } from '../coaster/cart';
import { BUILDING_BASE_Y, BUILDING_CENTRE_X, BUILDING_CENTRE_Z } from './layout';

/**
 * **The castle, as the Sky Cruiser's route solver sees it** — and the opening
 * that gets cut wherever the solved route crosses a side wall (issue #113).
 *
 * The family's complaint was that the coaster went *through* castle walls. Half
 * the fix (#112/PR 148) was a generator that cannot place a piece inside an
 * obstacle. This is the other half: where the Sky Cruiser meets the castle the
 * pass is made **deliberate** — a large masonry-surrounded window in a side
 * wall that it flies through, rather than a near miss that happens to be legal.
 *
 * ### One description of the castle, consumed by everyone
 *
 * The route solver, the wall builder, the boot assert and the procgen invariant
 * all read the geometry from here. That is the whole point of the module. A
 * hole cut at one set of numbers and a route steered by a second set is exactly
 * the failure the hood-face bug (CLAUDE.md) and the ginormous slide's twelve
 * hand-authored coordinates (#118) are both instances of: two formulas that
 * have to agree, and no test that they do. There is one formula here.
 *
 * ### The opening is cut from the route, never the route bent to the opening
 *
 * Nothing in this file names a place where a window goes. `openingsFor` in
 * `coaster/castleWindows.ts` takes a **measured crossing of the built curve**
 * and returns the opening that fits it. Move the castle, reseed the park, retune the loop, and the hole
 * follows, because the hole is derived from the thing it has to line up with.
 *
 * ### The frame
 *
 * The facade is axis-aligned and never rotated (`AnchorPlots` only translates),
 * so castle-local coordinates are plain world offsets: local x = world x minus
 * {@link BUILDING_CENTRE_X}, local y = world y minus {@link BUILDING_BASE_Y}
 * (so the wall stands from 0 to {@link CASTLE_WALL_HEIGHT}), local z likewise.
 * The door faces +Z, which makes ±X the **side** walls and ±Z the front and
 * back — the issue is explicit that the window goes in a side wall.
 */

/** Half the wall's thickness; the wall runs straddle the half-extent lines. */
const HALF_WALL = BUILDING_WALL_THICKNESS / 2;

/** Outer face of the side walls, castle-local x. Mirrored for the west wall. */
export const CASTLE_OUTER_X = BUILDING_HALF_X + HALF_WALL;
/** Outer face of the front and back walls, castle-local z. */
export const CASTLE_OUTER_Z = BUILDING_HALF_Z + HALF_WALL;
/** Inner face of the side walls. */
export const CASTLE_INNER_X = BUILDING_HALF_X - HALF_WALL;
/** Inner face of the front and back walls. */
export const CASTLE_INNER_Z = BUILDING_HALF_Z - HALF_WALL;

/**
 * Curtain wall height, castle-local. Duplicated from `Shell.ts`'s private
 * constant of the same name deliberately — see the note on
 * {@link CASTLE_WALL_HEIGHT_SOURCE}.
 */
export const CASTLE_WALL_HEIGHT = 8.8;

/**
 * Where the number above comes from, so a future reader can check it rather
 * than trust it: `Shell.ts`'s `CASTLE_WALL_HEIGHT`, which is module-private
 * there.
 *
 * **Nothing asserts the two are equal**, and an earlier version of this comment
 * claimed `check:castle-window` did — it does not. What catches a drift is
 * indirect but real: if this copy and `Shell.ts`'s disagree, the opening is cut
 * at the wrong height in a wall of the true height, and `sweptCartHits` finds
 * the car passing through masonry. That is a strictly later alarm than a
 * direct comparison would be, so if these two are ever hard to keep in step,
 * measure the built wall mesh rather than restating the number a third time.
 */
export const CASTLE_WALL_HEIGHT_SOURCE = 'Shell.ts CASTLE_WALL_HEIGHT';

/** Corner tower centres, castle-local. They stand on the outer corners. */
export const TOWER_CENTRES: readonly (readonly [number, number])[] = [
  [-CASTLE_OUTER_X, -CASTLE_OUTER_Z],
  [CASTLE_OUTER_X, -CASTLE_OUTER_Z],
  [-CASTLE_OUTER_X, CASTLE_OUTER_Z],
  [CASTLE_OUTER_X, CASTLE_OUTER_Z],
];

/**
 * The widest a tower gets: the conical roof, not the cylinder under it.
 *
 * `Shell.ts` builds the body at `TOWER_RADIUS` 2.05 and the roof cone at
 * `TOWER_RADIUS + 0.4`. The roof is what a cart at cruise height would actually
 * meet, so the roof is the number the solver and the asserts use.
 */
export const TOWER_KEEPOUT_RADIUS = 2.45;

/**
 * How much solid wall must survive between the opening's edge and the tower
 * that eats the end of its panel.
 *
 * The tower is a 2.05 m cylinder centred on the wall's outer *corner*, so it
 * swallows the last 2.05 m of the panel outright: the panel runs to
 * |z| = {@link CASTLE_INNER_Z} and the tower reaches back to
 * |z| = `CASTLE_OUTER_Z - 2.05`. An opening is "well clear of towers" when
 * there is this much masonry left over beyond that, which is what makes the
 * surround read as a window in a wall rather than a bite out of a turret.
 */
export const TOWER_MASONRY_MARGIN = 1.5;

/**
 * Half-width of the opening, castle-local metres.
 *
 * Sized from the cart, not chosen: `CART_ENVELOPE.halfWidth` (0.75, half of the
 * `toonBox(1.5, …)` body in `Coaster.ts`) plus {@link WINDOW_SIDE_CLEARANCE}.
 * Written as a sum so that widening the car widens the hole.
 */
export const WINDOW_SIDE_CLEARANCE = 0.85;

/**
 * Air above the rider's **eye**, not above the cart's roof.
 *
 * The Sky Cruiser is a first-person ride (`camera: 'firstPerson'`, so the player
 * model is not even drawn) and the camera sits 1.55 m above the centre line —
 * 0.85 m clear of the 0.7 m body. An opening sized to the visible cart would
 * fly the camera straight through the lintel, which is a far worse experience
 * than clipping a mesh the player cannot see.
 */
export const WINDOW_EYE_CLEARANCE = 0.5;

/** Air below the lowest thing on the track: the ties, 0.16 m under the rails. */
export const WINDOW_SILL_CLEARANCE = 1.5;

/**
 * The furthest a crossing may sit from the middle of its panel, castle-local.
 *
 * Derived, not picked: the tower eats the last `TOWER_KEEPOUT_RADIUS - 0.4`
 * (the cylinder, 2.05) of the panel, {@link TOWER_MASONRY_MARGIN} of solid wall
 * has to survive beyond the opening, and the opening is `halfWidth` wide —
 * {@link WINDOW_HALF_WIDTH} at every call site the park makes. What is left is
 * where a crossing may land.
 */
export function crossingBand(halfWidth: number): number {
  const towerBite = TOWER_KEEPOUT_RADIUS - 0.4;
  return CASTLE_OUTER_Z - towerBite - TOWER_MASONRY_MARGIN - halfWidth;
}

/** Half the opening, from the car's own half-width outwards. */
export const WINDOW_HALF_WIDTH = CART_ENVELOPE.halfWidth + WINDOW_SIDE_CLEARANCE;

/** Air the opening leaves above and below the track centre line. */
export const WINDOW_ABOVE_TRACK = CART_ENVELOPE.above + WINDOW_EYE_CLEARANCE;
export const WINDOW_BELOW_TRACK = CART_ENVELOPE.below + WINDOW_SILL_CLEARANCE;

/**
 * Where a crossing may land along its panel, measured from the panel's middle.
 * The one call site of {@link crossingBand} that everything else agrees with.
 */
export const CROSSING_BAND = crossingBand(WINDOW_HALF_WIDTH);

/**
 * The band of castle-local heights a crossing may happen at.
 *
 * Bounded below by the sill needing to stay above the courtyard floor and
 * above by the lintel needing to stay under the wall top — so the opening comes
 * out "fully within a single wall panel", which is one of the issue's own boot
 * asserts, rather than a notch out of the battlements.
 */
export const CROSSING_MIN_Y = WINDOW_BELOW_TRACK + 2.4;
export const CROSSING_MAX_Y = CASTLE_WALL_HEIGHT - WINDOW_ABOVE_TRACK - 0.7;

/**
 * Castle-local height the loop flies through the castle at.
 *
 * A free solve crosses at whatever height the hill profile happens to be —
 * measured across 24 seeded loops it ranged from 1.6 m to 10.2 m up an 8.8 m
 * wall, and only one in 24 landed somewhere a window could be cut. That is not
 * bad luck and no amount of backtracking fixes it: `rail/generate.ts` solves in
 * **plan view only** and height is a separate pass afterwards, so at the moment
 * the search accepts a piece there is no height yet for it to reject.
 *
 * So the profile is carved here exactly as it already is at the station, which
 * is pinned to 1.1 m because a platform is there. This is the same statement
 * about the castle. It reserves nothing: the carve is applied *wherever the
 * solved plan turned out to run inside the castle*, and a loop that misses the
 * castle is carved nowhere and cuts no holes.
 *
 * The value is chosen so both bands of masonry read as masonry: the head lands
 * at 7.65 m leaving a 1.15 m lintel under the wall top, and the sill at 3.94 m,
 * just above the 3.6 m seam where the lower wall band ends — so the opening
 * sits wholly within the upper band and no hole ever straddles the two.
 */
export const WINDOW_TRACK_Y = 5.6;

/** Is a world plan point inside the castle's outer footprint, plus `pad`? */
export function insideCastleFootprint(x: number, z: number, pad: number): boolean {
  const { lx, lz } = toCastleLocal(x, z);
  return Math.abs(lx) <= CASTLE_OUTER_X + pad && Math.abs(lz) <= CASTLE_OUTER_Z + pad;
}

/** World y of castle-local y. The facade is never rotated, only translated. */
export function castleY(localY: number): number {
  return BUILDING_BASE_Y + localY;
}

/** Castle-local coordinates of a world point, in the plan. */
export function toCastleLocal(x: number, z: number): { lx: number; lz: number } {
  return { lx: x - BUILDING_CENTRE_X, lz: z - BUILDING_CENTRE_Z };
}

/** World coordinates of a castle-local plan point. */
export function toWorld(lx: number, lz: number): { x: number; z: number } {
  return { x: BUILDING_CENTRE_X + lx, z: BUILDING_CENTRE_Z + lz };
}

/** Distance from a point to an axis-aligned rectangle; 0 inside it. */
function distanceToRect(
  px: number,
  pz: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): number {
  const dx = Math.max(minX - px, 0, px - maxX);
  const dz = Math.max(minZ - pz, 0, pz - maxZ);
  return Math.hypot(dx, dz);
}

/**
 * Distance from a castle-local plan point to the nearest castle masonry the
 * Sky Cruiser could hit at cruise height, **treating the middle of each side
 * wall as open**. Negative is not reported; zero means "inside it".
 *
 * The side walls are the two runs a window may be cut in, so within
 * {@link crossingBand} of their middle they are not counted as solid: the hole
 * that makes that true is cut later, from wherever the route actually went. The
 * front wall (which carries the door, the entrance arch and the rose window),
 * the back wall and all four towers stay solid, because the issue says the pass
 * goes through a side wall and never a tower.
 */
export function castleMasonryDistance(lx: number, lz: number, band: number): number {
  let best = Infinity;

  // Front (+Z) and back (−Z) runs: solid the whole way across, and they run the
  // full outer width so they also cover the wall corners.
  best = Math.min(
    best,
    distanceToRect(lx, lz, -CASTLE_OUTER_X, CASTLE_OUTER_X, CASTLE_INNER_Z, CASTLE_OUTER_Z),
    distanceToRect(lx, lz, -CASTLE_OUTER_X, CASTLE_OUTER_X, -CASTLE_OUTER_Z, -CASTLE_INNER_Z),
  );

  // Side (±X) runs, minus the band in the middle where a window may be cut.
  for (const sign of [-1, 1] as const) {
    const minX = sign > 0 ? CASTLE_INNER_X : -CASTLE_OUTER_X;
    const maxX = sign > 0 ? CASTLE_OUTER_X : -CASTLE_INNER_X;
    best = Math.min(
      best,
      distanceToRect(lx, lz, minX, maxX, band, CASTLE_INNER_Z),
      distanceToRect(lx, lz, minX, maxX, -CASTLE_INNER_Z, -band),
    );
  }

  for (const [tx, tz] of TOWER_CENTRES) {
    best = Math.min(best, Math.max(0, Math.hypot(lx - tx, lz - tz) - TOWER_KEEPOUT_RADIUS));
  }

  return best;
}

/**
 * Is a corridor of `radius` about a **world** point clear of castle masonry?
 *
 * This is the term the Sky Cruiser's `clear` predicate uses in place of the old
 * "circle of `boundingRadius` about the plot" — which was never a description of
 * the castle at all. That circle is 19 m about a point 3.54 m from the building,
 * and it does not even contain the castle's own corner towers; it is a *layout
 * spacing* number that the coaster borrowed. Modelling the masonry itself is
 * both tighter and honest, and it is what makes a deliberate pass expressible:
 * a wall you have described is a wall you can put a window in.
 */
export function castleClear(x: number, z: number, radius: number, band: number): boolean {
  const lx = x - BUILDING_CENTRE_X;
  const lz = z - BUILDING_CENTRE_Z;
  // **Far from the castle is the common case, and it is answerable in two
  // comparisons.** Every piece of masonry lives inside the outer footprint,
  // so a point more than `radius` outside that box on either axis is at least
  // `radius` from all of it. The Sky Cruiser's route search asks this on every
  // sample of every candidate piece — a Node CPU profile put this function and
  // its `distanceToRect` at 14% of the whole solve, nearly all of it spent
  // measuring seven rectangles and four towers for points that were never
  // near any of them. Same answer, reached without the measuring.
  //
  // The box is the outer footprint inflated by {@link TOWER_KEEPOUT_RADIUS},
  // because the four corner towers are centred ON the corners and so reach
  // that far OUTSIDE it — a box drawn to the walls alone would wave a route
  // straight through a tower, which is the one thing the castle pass is not
  // allowed to do.
  const reachX = CASTLE_OUTER_X + TOWER_KEEPOUT_RADIUS + radius;
  const reachZ = CASTLE_OUTER_Z + TOWER_KEEPOUT_RADIUS + radius;
  if (lx >= reachX || -lx >= reachX || lz >= reachZ || -lz >= reachZ) return true;
  return castleMasonryDistance(lx, lz, band) >= radius;
}
