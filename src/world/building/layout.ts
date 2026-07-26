import { PALETTE } from '../../core/palette';
import {
  BUILDING_CENTRE_X,
  BUILDING_CENTRE_Z,
  BUILDING_FLOOR_COUNT,
  BUILDING_FLOOR_HEIGHT,
  BUILDING_HALF_X,
  BUILDING_HALF_Z,
  BUILDING_PLINTH,
} from '../../core/constants';
import { terrainHeight } from '../terrain';

/**
 * The floor plan of the big building, as data.
 *
 * Everything here is in **building-local metres**: `x` and `z` are measured from
 * the middle of the footprint, and `y = 0` is the ground-floor deck. Deck `k`
 * sits at `y = k * BUILDING_FLOOR_HEIGHT`.
 *
 * Keeping the plan as a table rather than scattering numbers through the
 * builders means the walkable-surface sampler (`surfaces.ts`) and the geometry
 * (`Shell.ts`, `Stairs.ts`, …) can never disagree about where a hole is.
 *
 * The one rule that must not be broken: **every hole in a deck has to be fully
 * spanned by a ramp or platform, with solid deck at both ends.** Otherwise a
 * child walking towards the stairs drops through the floor instead.
 */

// --------------------------------------------------------------- geometry

/** Ground-floor deck height in world units. Deck 0 is level; the site is not. */
export const BUILDING_BASE_Y = highestTerrainUnderFootprint() + BUILDING_PLINTH;

/** Index of the topmost deck (the one the ginormous slide leaves from). */
export const TOP_DECK = BUILDING_FLOOR_COUNT - 1;

/** World height of deck `index`. */
export function deckY(index: number): number {
  return BUILDING_BASE_Y + index * BUILDING_FLOOR_HEIGHT;
}

/** Local -> world on the ground plane. */
export function worldX(localX: number): number {
  return BUILDING_CENTRE_X + localX;
}

export function worldZ(localZ: number): number {
  return BUILDING_CENTRE_Z + localZ;
}

function highestTerrainUnderFootprint(): number {
  let highest = -Infinity;
  for (let x = -BUILDING_HALF_X; x <= BUILDING_HALF_X; x += 1.5) {
    for (let z = -BUILDING_HALF_Z; z <= BUILDING_HALF_Z; z += 1.5) {
      const h = terrainHeight(BUILDING_CENTRE_X + x, BUILDING_CENTRE_Z + z);
      if (h > highest) highest = h;
    }
  }
  return highest;
}

// ------------------------------------------------------------------ holes

export interface RectRegion {
  readonly kind: 'rect';
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface CircleRegion {
  readonly kind: 'circle';
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export type Region = RectRegion | CircleRegion;

export function rect(minX: number, maxX: number, minZ: number, maxZ: number): RectRegion {
  return { kind: 'rect', minX, maxX, minZ, maxZ };
}

export function circle(x: number, z: number, radius: number): CircleRegion {
  return { kind: 'circle', x, z, radius };
}

export function regionContains(region: Region, x: number, z: number): boolean {
  if (region.kind === 'rect') {
    return x >= region.minX && x <= region.maxX && z >= region.minZ && z <= region.maxZ;
  }
  const dx = x - region.x;
  const dz = z - region.z;
  return dx * dx + dz * dz <= region.radius * region.radius;
}

/** A hole cut through the listed decks. */
export interface DeckHole {
  readonly id: string;
  readonly region: Region;
  readonly decks: readonly number[];
}

/**
 * The five vertical shafts.
 *
 * Stairs, escalator, bubble and trampoline sit in a band across the middle so
 * the north and south strips stay clear for shop units, and there is always a
 * corridor at least a metre wide between two shafts — otherwise a child walking
 * from one end of a floor to the other drops through it.
 */
export const STAIRWELL = rect(-11.5, -6.6, -2.7, 2.7);
export const ESCALATOR_WELL = rect(-5.2, -0.9, -2.7, 2.7);
export const BUBBLE_SHAFT = circle(2.6, 0, 2.1);
export const TRAMPOLINE_SHAFT = circle(8.6, 0.4, 2.5);
/** North-east corner: the helter-skelter winds down this one. */
export const HELTER_SHAFT = rect(6.6, 11.8, -8.6, -2.6);

const UPPER_DECKS = [1, 2, 3, 4] as const;

export const DECK_HOLES: readonly DeckHole[] = [
  { id: 'stairwell', region: STAIRWELL, decks: UPPER_DECKS },
  { id: 'escalator', region: ESCALATOR_WELL, decks: UPPER_DECKS },
  { id: 'bubble', region: BUBBLE_SHAFT, decks: UPPER_DECKS },
  // The trampoline only throws you as high as deck 2, and the helter-skelter
  // starts there too — so neither shaft needs to pierce the upper decks.
  { id: 'trampoline', region: TRAMPOLINE_SHAFT, decks: [1, 2] },
  { id: 'helter', region: HELTER_SHAFT, decks: [1, 2] },
];

/** True if deck `index` is solid at this local point. Deck 0 never has holes. */
export function deckIsSolid(index: number, x: number, z: number): boolean {
  if (index <= 0) return true;
  for (const hole of DECK_HOLES) {
    if (!hole.decks.includes(index)) continue;
    if (regionContains(hole.region, x, z)) return false;
  }
  return true;
}

// ------------------------------------------------------------------ doors

/** Big welcoming way in, on the +Z (south) face of the ground floor. */
export const ENTRANCE_MIN_X = -1;
export const ENTRANCE_MAX_X = 4;

/** Way through the +X (east) wall into the glass lift, on every deck. */
export const LIFT_DOOR_MIN_Z = 3.5;
export const LIFT_DOOR_MAX_Z = 6.5;

/** Where the ginormous slide leaves the top deck, through the +Z wall. */
export const SLIDE_DOOR_MIN_X = 7.4;
export const SLIDE_DOOR_MAX_X = 11.6;

// -------------------------------------------------------- glass lift shaft

export const LIFT_SHAFT = rect(12, 15.4, 3.3, 6.7);
export const LIFT_CAR_X = 13.7;
export const LIFT_CAR_Z = 5;
export const LIFT_CAR_HALF = 1.3;

// ------------------------------------------------------------------ ramps

/**
 * A walkable slope or landing.
 *
 * `axis` is the direction the ramp climbs along; outside `[from, to]` the height
 * is clamped, which is what turns the top of a stair flight into its landing
 * without needing a separate platform definition.
 */
export interface RampDefinition {
  readonly id: string;
  readonly footprint: RectRegion;
  readonly axis: 'x' | 'z';
  readonly from: number;
  readonly to: number;
  /** Local height at `from` and at `to`. */
  readonly yFrom: number;
  readonly yTo: number;
}

/** Steps up from the garden into the entrance. */
export const ENTRANCE_RAMP: RampDefinition = {
  id: 'entrance',
  footprint: rect(ENTRANCE_MIN_X, ENTRANCE_MAX_X, BUILDING_HALF_Z, BUILDING_HALF_Z + 3),
  axis: 'z',
  from: BUILDING_HALF_Z + 2.8,
  to: BUILDING_HALF_Z,
  yFrom: -0.75,
  yTo: 0,
};

/** Half-floor landing height, shared by both flights of a switchback. */
const HALF_RISE = BUILDING_FLOOR_HEIGHT / 2;

/** The two flights that carry you from deck `k` to deck `k + 1`. */
export function stairFlights(deck: number): readonly [RampDefinition, RampDefinition] {
  const bottom = deck * BUILDING_FLOOR_HEIGHT;
  return [
    {
      id: `stair-${deck}-a`,
      footprint: rect(-11.5, -9.05, -2.9, 3.3),
      axis: 'z',
      from: 3.3,
      to: -2.4,
      yFrom: bottom,
      yTo: bottom + HALF_RISE,
    },
    {
      id: `stair-${deck}-b`,
      footprint: rect(-9.05, -6.6, -2.9, 2.9),
      axis: 'z',
      from: -2.4,
      to: 2.9,
      yFrom: bottom + HALF_RISE,
      yTo: bottom + BUILDING_FLOOR_HEIGHT,
    },
  ];
}

/** The single up escalator from deck `k` to deck `k + 1`. Real ones are 30°. */
export function escalatorRamp(deck: number): RampDefinition {
  const bottom = deck * BUILDING_FLOOR_HEIGHT;
  return {
    id: `escalator-${deck}`,
    footprint: rect(-4.6, -1.5, -2.9, 3.3),
    axis: 'z',
    from: 3.3,
    to: -2.9,
    yFrom: bottom,
    yTo: bottom + BUILDING_FLOOR_HEIGHT,
  };
}

/** Direction an escalator carries you, on the ground plane. */
export const ESCALATOR_DIRECTION_Z = -1;

/** The floor of the lift shaft, so nobody falls out of the bottom of it. */
export const LIFT_PIT: RampDefinition = {
  id: 'lift-pit',
  footprint: LIFT_SHAFT,
  axis: 'z',
  from: 0,
  to: 1,
  yFrom: 0,
  yTo: 0,
};

export function allRamps(): RampDefinition[] {
  const ramps: RampDefinition[] = [ENTRANCE_RAMP, LIFT_PIT];
  for (let deck = 0; deck < TOP_DECK; deck += 1) {
    ramps.push(...stairFlights(deck), escalatorRamp(deck));
  }
  return ramps;
}

// ----------------------------------------------------------- fun machinery

export const TRAMPOLINE_X = TRAMPOLINE_SHAFT.x;
export const TRAMPOLINE_Z = TRAMPOLINE_SHAFT.z;
export const TRAMPOLINE_RADIUS = 1.7;

export const BUBBLE_X = BUBBLE_SHAFT.x;
export const BUBBLE_Z = BUBBLE_SHAFT.z;
export const BUBBLE_RADIUS = 1.9;

/**
 * The helter-skelter: an oval helix down the north-east shaft, from deck 2 to
 * the ground floor. Oval rather than circular because the shaft is not square,
 * and 1.75 turns because that gives a 15° slope — steep enough to whoosh, gentle
 * enough that the chute never looks like a fireman's pole.
 */
export const HELTER_DECK = 2;
/** Where you stand to get on; the chute mouth itself is a touch further east. */
export const HELTER_ENTRY_X = 5.8;
export const HELTER_ENTRY_Z = -4;
export const HELTER_MOUTH_X = 6.4;
export const HELTER_CENTRE_X = 9.2;
export const HELTER_CENTRE_Z = -5.6;
export const HELTER_SEMI_X = 1.6;
export const HELTER_SEMI_Z = 2;

/** Where you step on to ride the ginormous slide, on the top deck. */
export const GIANT_SLIDE_ENTRY_X = 9.5;
export const GIANT_SLIDE_ENTRY_Z = 4.6;
/** The cuddly grown-up waits here, ready to be asked along. */
export const GROWN_UP_X = 6.6;
export const GROWN_UP_Z = 5.2;

// ------------------------------------------------------------- shop units

export interface ShopUnitDefinition {
  readonly id: string;
  readonly deck: number;
  /** Local position of the unit's front-centre, on its deck. */
  readonly x: number;
  readonly z: number;
  /** Yaw in radians; 0 faces +Z. */
  readonly yaw: number;
  readonly title: string;
  readonly glyph: string;
  readonly accent: number;
}

const NORTH_WALL_Z = -BUILDING_HALF_Z + 0.5;
const WEST_WALL_X = -BUILDING_HALF_X + 0.5;
/** A unit on the north wall looks back into the room, i.e. down +Z. */
const FACE_SOUTH = 0;
/** A unit on the west wall looks east. */
const FACE_EAST = Math.PI / 2;

/**
 * The seven shops from the design document, one named anchor group each.
 *
 * Build step 4 fits these out; for now each is an empty alcove with an
 * "opening soon" sign. Spread deliberately across four decks so a child has a
 * reason to try every way up.
 *
 * They all sit on the north and west walls, which are the *far* walls in the
 * default isometric view — a unit on a near wall spends most of its life hidden
 * behind that wall's parapet.
 */
export const SHOP_UNITS: readonly ShopUnitDefinition[] = [
  {
    id: 'toy',
    deck: 0,
    x: WEST_WALL_X,
    z: -6.5,
    yaw: FACE_EAST,
    title: 'Toy Shop',
    glyph: '🧸',
    accent: PALETTE.markerPink,
  },
  {
    // Moved west from x = 7.5, which put the whole shop inside HELTER_SHAFT:
    // the helter-skelter's chute wound down through its awning and a customer
    // standing at the counter could see nothing but purple slide. It has to
    // come this far: the camera looks in along the +X+Z diagonal, so a shop is
    // hidden by anything on that diagonal, not just by what is in front of it.
    id: 'balloon',
    deck: 0,
    // Threading a needle. The camera looks in along the +X+Z diagonal, so a
    // shop is hidden by anything on *that line*, however far away it is:
    // further east and the glass lift's 18 m frame stands in front of it, a
    // little east of that and the floating bubble does, and further east again
    // is the helter-skelter. This is the clear lane. Nearly stacked with the hat
    // shop two decks up, which costs nothing — two units on one footprint share
    // a single counter collision segment instead of leaving two.
    x: -3.5,
    z: NORTH_WALL_Z,
    yaw: FACE_SOUTH,
    title: 'Balloon Shop',
    glyph: '🎈',
    accent: PALETTE.markerSky,
  },
  {
    // Moved east from x = -9. Collision is height-blind, so this counter is
    // also an invisible wall on every other deck — and at -9 it ran straight
    // across the spot a child stands on to be served at the toy shop
    // downstairs, which shoved them backwards out of their own shop.
    id: 'candyFloss',
    deck: 1,
    x: -6.2,
    z: NORTH_WALL_Z,
    yaw: FACE_SOUTH,
    title: 'Candy Floss',
    glyph: '🍬',
    accent: PALETTE.blossomPink,
  },
  {
    id: 'iceCream',
    deck: 1,
    x: WEST_WALL_X,
    z: 6.5,
    yaw: FACE_EAST,
    title: 'Ice Cream',
    glyph: '🍦',
    accent: PALETTE.markerMint,
  },
  {
    id: 'hat',
    deck: 2,
    x: -3,
    z: NORTH_WALL_Z,
    yaw: FACE_SOUTH,
    title: 'Hat Shop',
    glyph: '🎩',
    accent: PALETTE.markerLilac,
  },
  {
    id: 'stickerPet',
    deck: 2,
    x: 2.5,
    z: NORTH_WALL_Z,
    yaw: FACE_SOUTH,
    title: 'Stickers & Pets',
    glyph: '🐹',
    accent: PALETTE.markerLemon,
  },
  {
    id: 'surpriseEgg',
    deck: 3,
    // Stacked with the candy floss stand two decks down, and moved with it for
    // the same reason.
    x: -6.2,
    z: NORTH_WALL_Z,
    yaw: FACE_SOUTH,
    title: 'Surprise Eggs',
    glyph: '🥚',
    accent: PALETTE.flowerViolet,
  },
];

/** Scene-graph name for a shop unit's anchor group. */
export function shopGroupName(id: string): string {
  return `shop:${id}`;
}

/**
 * Unit-local metres to building-local metres.
 *
 * A unit's anchor group is translated to `(x, z)` and rotated by `yaw`, so its
 * own +Z points into the room whichever wall it is on. Anything that has to
 * agree with the geometry from *outside* the group — the counter's collision
 * segment, the spot a child stands on to be served — goes through here rather
 * than re-deriving the rotation, so the two can never drift apart.
 */
export function shopLocalToBuilding(
  unit: ShopUnitDefinition,
  localX: number,
  localZ: number,
): [number, number] {
  const cos = Math.cos(unit.yaw);
  const sin = Math.sin(unit.yaw);
  return [unit.x + localX * cos + localZ * sin, unit.z - localX * sin + localZ * cos];
}

// --------------------------------------------------------------- ball pit

/** Centre of the ball pit, in world coordinates (the `ballPit` anchor). */
export const BALL_PIT_X = -9;
export const BALL_PIT_Z = -15;
export const BALL_PIT_RADIUS = 6;
/** How far the pit floor sits below the surrounding grass. */
export const BALL_PIT_DEPTH = 0.5;
export const BALL_PIT_FLOOR_Y = terrainHeight(BALL_PIT_X, BALL_PIT_Z) - BALL_PIT_DEPTH;
