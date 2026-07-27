import { PALETTE } from '../../core/palette';
import {
  BUILDING_CENTRE_X,
  BUILDING_CENTRE_Z,
  BUILDING_FLOOR_COUNT,
  BUILDING_FLOOR_HEIGHT,
  BUILDING_HALF_X,
  BUILDING_HALF_Z,
  BUILDING_PLINTH,
  BUILDING_SLAB,
  INTERIOR_HALF_X,
  INTERIOR_HALF_Z,
  INTERIOR_ORIGIN_X,
  INTERIOR_ORIGIN_Z,
  INTERIOR_PLAZA_DROP,
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
 * spanned by a ramp or platform, with solid deck at both ends — or, where it
 * is walked onto directly rather than crossed (the trampoline well, the
 * bubble's shaft, the helter-skelter), fully guarded by a rail and a
 * matching collider (see `ShaftGuards.ts`).** Otherwise a child walking
 * towards the stairs drops through the floor instead.
 *
 * ## Two spaces
 *
 * Since the family asked for a building that is *bigger on the inside*, "the
 * building" is two separate places that never appear in the same frame:
 *
 * - the **facade**, a 24 x 18 m tower standing in the garden at
 *   (`BUILDING_CENTRE_X`, `BUILDING_CENTRE_Z`). It is scenery with a door in it.
 * - the **interior**, a 60 x 44 m floor plate at
 *   (`INTERIOR_ORIGIN_X`, `INTERIOR_ORIGIN_Z`) — six hundred metres away, which
 *   is past the terrain disc *and* past the far fog plane, so the park cannot
 *   leak into the interior nor the interior into the park.
 *
 * `worldX()` / `worldZ()` map interior-local to world, and `facadeX()` /
 * `facadeZ()` do the same for the shell in the garden. Everything that used to
 * say "the building" and meant "where you walk about" goes through the first
 * pair, which is why moving the whole interior six hundred metres sideways cost
 * almost no code.
 */

// --------------------------------------------------------------- geometry

/** Ground-floor deck height in world units. Deck 0 is level; the site is not. */
export const BUILDING_BASE_Y = highestTerrainUnderFootprint() + BUILDING_PLINTH;

/**
 * The interior's own ground, a little below its ground-floor deck.
 *
 * The interior region has no terrain — it is not part of the hilltop. A single
 * soft plaza disc under the floor plate gives the windows something to look out
 * at, gives the roof terrace a "we are very high up" drop, and gives anybody who
 * walks off the edge of deck zero somewhere to land.
 */
export const INTERIOR_GROUND_Y = BUILDING_BASE_Y - INTERIOR_PLAZA_DROP;

/** Index of the topmost deck. It is the roof terrace, and it is outdoors. */
export const TOP_DECK = BUILDING_FLOOR_COUNT - 1;

/** World height of deck `index`. */
export function deckY(index: number): number {
  return BUILDING_BASE_Y + index * BUILDING_FLOOR_HEIGHT;
}

/** Interior-local -> world on the ground plane. */
export function worldX(localX: number): number {
  return INTERIOR_ORIGIN_X + localX;
}

export function worldZ(localZ: number): number {
  return INTERIOR_ORIGIN_Z + localZ;
}

/** Facade-local (the shell in the garden) -> world on the ground plane. */
export function facadeX(localX: number): number {
  return BUILDING_CENTRE_X + localX;
}

export function facadeZ(localZ: number): number {
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
 * They sit in a band across the middle of the plate so the north and south
 * strips stay clear for shop units and the toilets, and there is always a
 * corridor several metres wide between two shafts. With sixty metres of floor to
 * play with they are now genuinely spread out — the old plan had the stairs, the
 * escalator, the bubble and the trampoline crammed into twenty.
 */
export const STAIRWELL = rect(-25.5, -20.6, -2.7, 2.7);
/**
 * Matches the escalator ramp's own footprint (`escalatorRamp`, below)
 * exactly, the same way `STAIRWELL` matches `stairFlights` — so the well is
 * never wider than the ramp that spans it. It used to be 0.6 m wider down
 * each side (architecture review S5): two 0.6 x 5.4 m open slots through the
 * slab, outside the balustrade, on every upper deck — nobody fell only
 * because player radius held them back by 0.22 m, and NPC radius by half that.
 */
export const ESCALATOR_WELL = rect(-13.6, -10.5, -2.9, 3.3);
export const BUBBLE_SHAFT = circle(-1.5, 0, 2.1);
export const TRAMPOLINE_SHAFT = circle(8, 0.4, 2.5);
/** East side: the helter-skelter winds down this one. */
export const HELTER_SHAFT = rect(16.5, 23.5, -9.5, -2.5);

const UPPER_DECKS = [1, 2, 3, 4] as const;

/**
 * The fixed shafts. `DECK_HOLES` (below, defined after `SHOP_UNITS` so it can
 * fold in each shop's sunken forecourt too) starts from this list.
 */
const BASE_DECK_HOLES: readonly DeckHole[] = [
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

/** Is this interior-local point on the floor plate at all? */
export function insideInterior(localX: number, localZ: number, margin = 0): boolean {
  return (
    localX >= -INTERIOR_HALF_X - margin &&
    localX <= INTERIOR_HALF_X + margin &&
    localZ >= -INTERIOR_HALF_Z - margin &&
    localZ <= INTERIOR_HALF_Z + margin
  );
}

// ------------------------------------------------------------------ doors

/** The way out of the interior, on the +Z (south) face of the ground floor. */
export const INTERIOR_DOOR_MIN_X = -3.2;
export const INTERIOR_DOOR_MAX_X = 3.2;

/** The matching door in the facade out in the garden, at the top of the steps. */
export const ENTRANCE_MIN_X = -1;
export const ENTRANCE_MAX_X = 4;

/** Way through the +X (east) wall into the glass lift, on every deck. */
export const LIFT_DOOR_MIN_Z = 3.5;
export const LIFT_DOOR_MAX_Z = 6.5;

/** The gap in the roof parapet the ginormous slide leaves through. */
export const SLIDE_DOOR_MIN_X = 17.5;
export const SLIDE_DOOR_MAX_X = 22.5;

/**
 * The matching hole in the facade's top storey, out in the garden.
 *
 * The slide is a garden object: it hangs off the tower everyone can see from the
 * fountain, whatever is going on in the building's own space. Without this it
 * would appear to grow straight out of a painted wall.
 */
export const FACADE_SLIDE_DOOR_MIN_X = 7.4;
export const FACADE_SLIDE_DOOR_MAX_X = 11.6;

// -------------------------------------------------------- glass lift shaft

export const LIFT_SHAFT = rect(INTERIOR_HALF_X, INTERIOR_HALF_X + 3.4, 3.3, 6.7);
export const LIFT_CAR_X = INTERIOR_HALF_X + 1.7;
export const LIFT_CAR_Z = 5;
export const LIFT_CAR_HALF = 1.3;

/**
 * The lift lobby: where a child stands to wait, and what a tap aims at.
 *
 * `LIFT_STAND_X` is deliberately *inside* the east doorway rather than in the
 * car. The car is only ever at one deck, and the shaft below it is a
 * five-storey drop — walking a six-year-old into an open shaft because she
 * tapped the pretty glass box is not the game we are making. Standing here is
 * what puts the lift's call panel on screen (`liftRide.ts`), and stepping into
 * the car is something the lift does *for* her, once it has actually arrived.
 *
 * Shared by `interactZones.ts` (the tap target) and `liftRide.ts` (the waiting
 * area and the spot she is set down on when she gets out), so the two can
 * never drift apart.
 */
export const LIFT_STAND_X = INTERIOR_HALF_X - 1.1;
export const LIFT_PICK_X = INTERIOR_HALF_X + 0.6;
export const LIFT_DOOR_Z = 5;
/** How far back from the doors the call panel still appears. */
export const LIFT_LOBBY_REACH = 4;

// ------------------------------------------------------------------ ramps

/**
 * A walkable slope or landing.
 *
 * `axis` is the direction the ramp climbs along; outside `[from, to]` the height
 * is clamped, which is what turns the top of a stair flight into its landing
 * without needing a separate platform definition.
 *
 * `space` says which origin the footprint is measured from — the interior, or
 * the facade standing in the garden. The entrance steps are the only thing in
 * the game that is walkable *and* lives out in the park.
 */
export interface RampDefinition {
  readonly id: string;
  readonly space: 'interior' | 'garden';
  readonly footprint: RectRegion;
  readonly axis: 'x' | 'z';
  readonly from: number;
  readonly to: number;
  /** Local height at `from` and at `to`. */
  readonly yFrom: number;
  readonly yTo: number;
}

/** Steps up from the garden to the facade's front door. */
export const ENTRANCE_RAMP: RampDefinition = {
  id: 'entrance',
  space: 'garden',
  footprint: rect(ENTRANCE_MIN_X, ENTRANCE_MAX_X, BUILDING_HALF_Z, BUILDING_HALF_Z + 3),
  axis: 'z',
  from: BUILDING_HALF_Z + 2.8,
  to: BUILDING_HALF_Z,
  yFrom: -0.75,
  yTo: 0,
};

/**
 * The threshold of the facade's door: one flat metre of walkable floor inside
 * the shell, so a child arrives *somewhere* rather than being bounced off the
 * lobby wall by collision before the doorway trigger notices them.
 */
export const FACADE_THRESHOLD: RampDefinition = {
  id: 'facade-threshold',
  space: 'garden',
  footprint: rect(ENTRANCE_MIN_X, ENTRANCE_MAX_X, BUILDING_HALF_Z - 1.6, BUILDING_HALF_Z),
  axis: 'z',
  from: 0,
  to: 1,
  yFrom: 0,
  yTo: 0,
};

/** The interior's porch: the flat step outside its own south door. */
export const INTERIOR_PORCH: RampDefinition = {
  id: 'interior-porch',
  space: 'interior',
  footprint: rect(
    INTERIOR_DOOR_MIN_X - 1,
    INTERIOR_DOOR_MAX_X + 1,
    INTERIOR_HALF_Z,
    INTERIOR_HALF_Z + 3.2,
  ),
  axis: 'z',
  from: 0,
  to: 1,
  yFrom: 0,
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
      space: 'interior',
      footprint: rect(-25.5, -23.05, -2.9, 3.3),
      axis: 'z',
      from: 3.3,
      to: -2.4,
      yFrom: bottom,
      yTo: bottom + HALF_RISE,
    },
    {
      id: `stair-${deck}-b`,
      space: 'interior',
      footprint: rect(-23.05, -20.6, -2.9, 2.9),
      axis: 'z',
      from: -2.4,
      to: 2.9,
      yFrom: bottom + HALF_RISE,
      yTo: bottom + BUILDING_FLOOR_HEIGHT,
    },
  ];
}

/** Where a child stands to tap the stairs, on any deck. Solid floor, both ways. */
export const STAIR_STAND_X = -23.05;
export const STAIR_STAND_Z = 5.2;

/**
 * The route the stair ride walks, from deck `deck` up to `deck + 1`.
 *
 * Returned as plain interior-local waypoints rather than as a spline, because
 * the ride steers the character through the ordinary tap-to-move navigator: it
 * is a *walk*, with the real walk cycle and the real surface sampler under its
 * feet, only with the world running at three and a half times speed. Reverse the
 * list and it is the way down.
 */
export function stairRoute(deck: number): readonly (readonly [number, number])[] {
  const [flightA, flightB] = stairFlights(deck);
  const centreA = (flightA.footprint.minX + flightA.footprint.maxX) / 2;
  const centreB = (flightB.footprint.minX + flightB.footprint.maxX) / 2;
  return [
    [centreA, STAIR_STAND_Z],
    [centreA, flightA.from - 0.4],
    [centreA, flightA.to],
    [centreB, flightB.from],
    [centreB, flightB.to - 0.3],
    [centreB, STAIR_STAND_Z],
  ];
}

/** The single up escalator from deck `k` to deck `k + 1`. Real ones are 30°. */
export function escalatorRamp(deck: number): RampDefinition {
  const bottom = deck * BUILDING_FLOOR_HEIGHT;
  return {
    id: `escalator-${deck}`,
    space: 'interior',
    footprint: rect(-13.6, -10.5, -2.9, 3.3),
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
  space: 'interior',
  footprint: LIFT_SHAFT,
  axis: 'z',
  from: 0,
  to: 1,
  yFrom: 0,
  yTo: 0,
};

export function allRamps(): RampDefinition[] {
  const ramps: RampDefinition[] = [
    ENTRANCE_RAMP,
    FACADE_THRESHOLD,
    INTERIOR_PORCH,
    LIFT_PIT,
  ];
  for (let deck = 0; deck < TOP_DECK; deck += 1) {
    ramps.push(...stairFlights(deck), escalatorRamp(deck));
  }
  ramps.push(...shopForecourtRamps());
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
 * The helter-skelter: an oval helix down the east shaft, from deck 2 to the
 * ground floor. Oval rather than circular because the shaft is not square, and
 * 1.75 turns because that gives a 15° slope — steep enough to whoosh, gentle
 * enough that the chute never looks like a fireman's pole.
 */
export const HELTER_DECK = 2;
/** Where you stand to get on; the chute mouth itself is a touch further east. */
export const HELTER_ENTRY_X = 15.4;
export const HELTER_ENTRY_Z = -6;
export const HELTER_MOUTH_X = 16.2;
export const HELTER_CENTRE_X = 20;
export const HELTER_CENTRE_Z = -6.4;
export const HELTER_SEMI_X = 1.7;
export const HELTER_SEMI_Z = 2.1;

/**
 * Where you step on to ride the ginormous slide — out on the roof terrace now,
 * under the open sky, which is where the family wanted it.
 */
export const GIANT_SLIDE_ENTRY_X = 20;
export const GIANT_SLIDE_ENTRY_Z = 13;
/** The cuddly grown-up waits here, ready to be asked along. */
export const GROWN_UP_X = 15.2;
export const GROWN_UP_Z = 14;

// ------------------------------------------------------------- the toilets

/**
 * The cute toilets, in the north-east corner of deck one.
 *
 * Good manners are part of the game (GAME_DESIGN.md): using one flushes, and
 * then runs the tap while you wash your hands.
 */
export const TOILET_DECK = 1;
export const TOILET_ROOM = rect(21.2, 28.6, -21.5, -14.4);
export const TOILET_STAND_X = 24.9;
export const TOILET_STAND_Z = -13.4;
/** Where the pan itself sits, against the room's back wall. */
export const TOILET_PAN_X = 23.2;
export const TOILET_PAN_Z = -19.6;
/** And the basin, on the other side of the little room. */
export const TOILET_BASIN_X = 27.1;
export const TOILET_BASIN_Z = -19.4;

// ------------------------------------------------------------- roof terrace

/** The pavilion on the roof terrace, at the west end. */
export const ROOF_PAVILION_X = -18;
export const ROOF_PAVILION_Z = -2;
export const ROOF_PAVILION_HALF_X = 5.4;
export const ROOF_PAVILION_HALF_Z = 4.6;

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

const NORTH_WALL_Z = -INTERIOR_HALF_Z + 0.5;
const WEST_WALL_X = -INTERIOR_HALF_X + 0.5;
/** A unit on the north wall looks back into the room, i.e. down +Z. */
const FACE_SOUTH = 0;
/** A unit on the west wall looks east. */
const FACE_EAST = Math.PI / 2;

/**
 * The seven shops from the design document, one named anchor group each.
 *
 * They all sit on the north and west walls, which are the *far* walls in the
 * default isometric view — a unit on a near wall spends most of its life hidden
 * behind that wall's parapet.
 *
 * Two rules govern where they may go, and both used to be a knife fight for
 * space in a 24 x 18 m plate. With sixty metres of north wall they are now
 * simply obeyed:
 *
 * 1. **Collision is height-blind**, so a counter on deck two is an invisible
 *    wall on deck four as well. No two counters may overlap in plan.
 * 2. The camera looks in along the +X+Z diagonal, so anything on that line hides
 *    a shop however far away it is. Nothing is parked in front of one.
 */
/**
 * North-wall x-positions (architecture review S1).
 *
 * `SHOP_SCALE_XZ` widened every counter and forecourt without re-spacing
 * these, so three counters cut invisible walls through a neighbour's
 * forecourt. Re-derived from the real, scaled extents:
 *
 * - a counter is `1.75 * SHOP_SCALE_XZ` (= 2.8 m) either side of centre, plus
 *   `0.35 * SHOP_SCALE_XZ` (= 0.56 m) of wall half-thickness beyond that
 *   (`registerCounter`, `ShopUnits.ts`) — but the half-thickness only bows the
 *   wall out along its own depth, not its length, so the x-extent that
 *   matters for spacing along the wall is the plain `±2.8 m`;
 * - a forecourt is `FORECOURT_HALF_X * SHOP_SCALE_XZ` (= 2.9 * 1.6 = 4.64 m)
 *   either side of centre (`shopForecourtRegion`, below).
 *
 * Four of the five north-wall units have a forecourt (every deck but 0), so
 * the binding clearance between two centres is `4.64 + 4.64 = 9.28 m` when
 * both have one, or `4.64 + 2.8 = 7.44 m` when only one does (`balloon`, on
 * deck 0, is the sole exception) — plus a flat 1 m of solid deck either side
 * so a counter never sits flush against a neighbour's pit edge. Verified
 * numerically in `scripts/checkShopSpacing.mjs`: no counter's x-interval
 * overlaps another shop's forecourt, and the east end (`stickerPet`) clears
 * `TOILET_ROOM`'s x-range (21.2-28.6, itself inside the same z-band) by
 * 1.5 m rather than running into it.
 */
const HAT_X = -22.44;
const SURPRISE_EGG_X = -12.16;
const BALLOON_X = -3.72;
const CANDY_FLOSS_X = 4.72;
const STICKER_PET_X = 15;

export const SHOP_UNITS: readonly ShopUnitDefinition[] = [
  {
    id: 'toy',
    deck: 0,
    x: WEST_WALL_X,
    z: -9,
    yaw: FACE_EAST,
    title: 'Toy Shop',
    glyph: '🧸',
    accent: PALETTE.markerPink,
  },
  {
    id: 'balloon',
    deck: 0,
    x: BALLOON_X,
    z: NORTH_WALL_Z,
    yaw: FACE_SOUTH,
    title: 'Balloon Shop',
    glyph: '🎈',
    accent: PALETTE.markerSky,
  },
  {
    id: 'candyFloss',
    deck: 1,
    x: CANDY_FLOSS_X,
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
    z: 9,
    yaw: FACE_EAST,
    title: 'Ice Cream',
    glyph: '🍦',
    accent: PALETTE.markerMint,
  },
  {
    id: 'hat',
    deck: 2,
    x: HAT_X,
    z: NORTH_WALL_Z,
    yaw: FACE_SOUTH,
    title: 'Hat Shop',
    glyph: '🎩',
    accent: PALETTE.markerLilac,
  },
  {
    id: 'stickerPet',
    deck: 2,
    x: STICKER_PET_X,
    z: NORTH_WALL_Z,
    yaw: FACE_SOUTH,
    title: 'Stickers & Pets',
    glyph: '🐹',
    accent: PALETTE.markerLemon,
  },
  {
    id: 'surpriseEgg',
    deck: 3,
    x: SURPRISE_EGG_X,
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
 * Unit-local metres to interior-local metres.
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

/**
 * A shop unit's own axis-aligned footprint, in interior-local metres.
 *
 * Every yaw a unit actually uses (`FACE_SOUTH`, `FACE_EAST`) is a multiple of
 * 90°, so a unit-local rectangle always maps onto an axis-aligned rectangle in
 * interior-local space too — never a rotated one. Four corners through
 * `shopLocalToBuilding` and a min/max is all that takes, which is why this
 * stays a plain `RectRegion` rather than a general polygon.
 */
function shopFootprintRect(
  unit: ShopUnitDefinition,
  localMinX: number,
  localMaxX: number,
  localMinZ: number,
  localMaxZ: number,
): RectRegion {
  const corners = [
    shopLocalToBuilding(unit, localMinX, localMinZ),
    shopLocalToBuilding(unit, localMaxX, localMinZ),
    shopLocalToBuilding(unit, localMinX, localMaxZ),
    shopLocalToBuilding(unit, localMaxX, localMaxZ),
  ];
  const xs = corners.map((c) => c[0]);
  const zs = corners.map((c) => c[1]);
  return rect(Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs));
}

/**
 * "Shops must dominate their rooms" (design feedback, 26 July 2026): every shop
 * gets a bigger footprint, and — everywhere the ground floor's "never has a
 * hole" rule (see `deckIsSolid`) does not forbid it — a shallow sunken
 * forecourt, so the counter and awning loom over a child standing in front of
 * them instead of reading as a hut in a warehouse.
 *
 * `SHOP_SCALE_XZ` alone is what makes every shop bigger; it is applied to the
 * whole kiosk+stock+shopkeeper group in `ShopUnits`, so nothing that builds a
 * shop's contents (`shops/kiosk.ts`, `shops/fitouts.ts`) has to know it
 * happened. Anything computed independently in *world* space — the counter's
 * collision segment, the till spot, the keep-out zone other floor dressing
 * respects — has to be scaled by hand alongside it; see `ShopUnits.ts`,
 * `shops/Shops.ts` and `dressing.ts`.
 */
export const SHOP_SCALE_XZ = 1.6;

/**
 * How much taller a shop with a sunken forecourt gets to be, on top of
 * `SHOP_SCALE_XZ`.
 *
 * A floor's clear height is only `BUILDING_FLOOR_HEIGHT - BUILDING_SLAB` (3.3 m
 * — the kiosk's awning and sign already reach to within a few centimetres of
 * that), so height cannot simply scale up with the footprint everywhere
 * without poking through the slab above. Sinking the forecourt by
 * `SHOP_RECESS_DEPTH` buys back exactly that much headroom, which is why only
 * recessed shops (`shopHasForecourt`) get any extra height at all.
 */
const SHOP_SCALE_Y_RECESSED = 1.05;

/**
 * How far a shop's own forecourt sinks below its deck.
 *
 * Matches `BUILDING_SLAB` on purpose: the hole cut for it (see `DECK_HOLES`,
 * below) already grows a vertical rim wall exactly `BUILDING_SLAB` deep as
 * part of the deck slab's own extrusion, so that rim is *all* the retaining
 * wall the pit needs — no separate riser geometry to keep in sync with it.
 */
export const SHOP_RECESS_DEPTH = BUILDING_SLAB;

/**
 * Ground floor decks can never carry a hole (`deckIsSolid` hard-codes deck 0
 * solid, and that invariant is relied on elsewhere), so only shops on decks 1
 * and up get the sunken-forecourt treatment. The two ground-floor shops (toy,
 * balloon) still get the full footprint scale-up — only the extra height and
 * the recess are unavailable to them.
 */
export function shopHasForecourt(unit: ShopUnitDefinition): boolean {
  return unit.deck > 0;
}

/** Vertical scale for a shop's kiosk group: bigger only where there is headroom for it. */
export function shopScaleY(unit: ShopUnitDefinition): number {
  return shopHasForecourt(unit) ? SHOP_SCALE_Y_RECESSED : 1;
}

/** Half-width and near/far depth of a shop's forecourt, in *unit-local* metres, pre-scale. */
const FORECOURT_HALF_X = 2.9;
const FORECOURT_NEAR_Z = 0.25;
const FORECOURT_FAR_Z = 3.2;

/**
 * A shop's sunken forecourt footprint, in interior-local metres — the counter,
 * the till spot and the standing room in front of it, all scaled up with the
 * rest of the shop. Only meaningful where `shopHasForecourt` is true; used both
 * as the deck hole (`DECK_HOLES`, below) and as the flat "landing" ramp that
 * fills it (`shopForecourtRamp`), so the two can never disagree about where
 * the pit is.
 */
export function shopForecourtRegion(unit: ShopUnitDefinition): RectRegion {
  return shopFootprintRect(
    unit,
    -FORECOURT_HALF_X * SHOP_SCALE_XZ,
    FORECOURT_HALF_X * SHOP_SCALE_XZ,
    FORECOURT_NEAR_Z * SHOP_SCALE_XZ,
    FORECOURT_FAR_Z * SHOP_SCALE_XZ,
  );
}

/** The flat "landing" ramp that fills a shop's forecourt hole. */
function shopForecourtRamp(unit: ShopUnitDefinition): RampDefinition {
  const y = unit.deck * BUILDING_FLOOR_HEIGHT - SHOP_RECESS_DEPTH;
  return {
    id: `shop-forecourt-${unit.id}`,
    space: 'interior',
    footprint: shopForecourtRegion(unit),
    axis: 'z',
    from: 0,
    to: 1,
    yFrom: y,
    yTo: y,
  };
}

/**
 * Every fixed shaft, plus a hole for each recessed shop's forecourt.
 *
 * Declared here, after `SHOP_UNITS`, rather than back where `BASE_DECK_HOLES`
 * is: it folds `SHOP_UNITS` in, so it has to be assigned after that constant
 * exists. `deckIsSolid` (defined earlier in the file) still resolves this
 * correctly regardless of where it sits in the file — it only reads
 * `DECK_HOLES` when *called*, by which point the whole module has finished
 * initialising.
 */
export const DECK_HOLES: readonly DeckHole[] = [
  ...BASE_DECK_HOLES,
  ...SHOP_UNITS.filter(shopHasForecourt).map((unit) => ({
    id: `shop-forecourt-${unit.id}`,
    region: shopForecourtRegion(unit),
    decks: [unit.deck],
  })),
];

/** Every recessed shop's forecourt ramp, folded into `allRamps()`. */
export function shopForecourtRamps(): readonly RampDefinition[] {
  return SHOP_UNITS.filter(shopHasForecourt).map(shopForecourtRamp);
}

// --------------------------------------------------------------- ball pit

/** Centre of the ball pit, in world coordinates (the `ballPit` anchor). */
export const BALL_PIT_X = -9;
export const BALL_PIT_Z = -15;
export const BALL_PIT_RADIUS = 6;
/** How far the pit floor sits below the surrounding grass. */
export const BALL_PIT_DEPTH = 0.5;
export const BALL_PIT_FLOOR_Y = terrainHeight(BALL_PIT_X, BALL_PIT_Z) - BALL_PIT_DEPTH;
