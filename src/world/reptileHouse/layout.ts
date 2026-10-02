/**
 * **The Reptile House's dimensions — the one owner of every shared number.**
 *
 * A leaf module (imports nothing), like `hotel/towerDimensions.ts`, so the
 * park layout, the collider code, the checks and the headless Blender build
 * scripts can all read the same figure without dragging the building in.
 *
 * Every `export const NAME = <literal>;` on its own line here is readable
 * from Python with `blendkit.ts_const('src/world/reptileHouse/layout.ts',
 * 'NAME')`; `art/blend/reptile_constants.py` is the single place that does
 * so, and every `reptile_*_build.py` imports from there. Nothing in this
 * file is typed a second time anywhere — a mesh built to one of these
 * numbers, a collider registered to it, and a check asserting it are all
 * asking this file.
 *
 * Two rules that keep that true:
 *
 * - **Plain literals only** for anything Blender needs. `ts_const` is a
 *   regex, deliberately: it cannot read an expression. Derived values are
 *   fine in TypeScript (`REPTILE_DOOR_BAND_OUTER` below) but a Blender
 *   script wanting one must derive it the same way from the literal parts.
 * - **Coordinates are hall-local metres**: origin at the floor-plate centre,
 *   +X east, +Z south (toward the camera). World = local + (`ORIGIN_X`,
 *   `ORIGIN_Z`). `facing` is `Player.facing` in degrees: 0 looks along +Z,
 *   180 along −Z (north), 90 along +X.
 *
 * Design: `docs/design/REPTILE-HOUSE.md`. Where that document and this file
 * disagree, this file wins and the document is corrected.
 */

// ---------------------------------------------------------------------------
// The space
// ---------------------------------------------------------------------------

/**
 * Where the hall's local origin sits in world space. 1200 m from castle
 * floor 0 (600, 600; r 120), 1706 m from the hotel lobby (−600, 613; r 70),
 * 849 m from the garden — all far past `FOG_FAR`, so nothing of one space is
 * ever drawn from another.
 */
export const REPTILE_HOUSE_ORIGIN_X = 600;
export const REPTILE_HOUSE_ORIGIN_Z = -600;
export const REPTILE_HOUSE_FLOOR_Y = 0;

/** `spaceAt`'s radius test, the same figure as `HOTEL_ROOM_RADIUS`. */
export const REPTILE_HOUSE_SPACE_RADIUS = 70;

/**
 * **The forecourt — where the building stands until the park gives it a
 * plot.** Its own disjoint space, 300 m south of the hall (the castle floors'
 * spacing), holding a flat lawn with "Sunny" standing on it, door facing +Z:
 * `/reptile-house-door` lands here while `placedEntry('reptileHouse')` does
 * not exist, and leaving the hall with no plot comes back out here, so the
 * door works both ways on a park that has not placed the building yet. The
 * day the placement agents add the manifest entry the exterior stands in the
 * park instead and this lawn is simply never visited.
 */
export const REPTILE_FORECOURT_ORIGIN_X = 600;
export const REPTILE_FORECOURT_ORIGIN_Z = -900;
/** The forecourt lawn's radius, and the play boundary bound while on it. */
export const REPTILE_FORECOURT_RADIUS = 26;

/**
 * The play boundary bound while inside. The plate corner is
 * √(24² + 18²) = 30.0 m out, so this clears it with room for the walls.
 */
export const REPTILE_HOUSE_PLAY_RADIUS = 32;

// ---------------------------------------------------------------------------
// The plate and its shell
// ---------------------------------------------------------------------------

/** Half-extents of the 48 × 36 m floor plate. */
export const REPTILE_HALF_X = 24;
export const REPTILE_HALF_Z = 18;

/** Room walls, centred on the plate edge with the hotel's `WALL_HALF_DEPTH`. */
export const REPTILE_WALL_HEIGHT = 4.2;

/**
 * The south wall's doorway, centred here along X; its half-width is the
 * hotel's `DOOR_HALF` (1.3), imported at the point of use in `shell.ts` so
 * the gap is `[4.7, 7.3]` without a second 1.3 living here.
 */
export const REPTILE_DOOR_X = 6;

/**
 * Where she lands on entering: 2.2 m inside the doorway, facing north (180°),
 * so the first frame is Noodle's face on her rock 17 m ahead.
 */
export const REPTILE_ARRIVAL_X = 6;
export const REPTILE_ARRIVAL_Z = 15.8;
export const REPTILE_ARRIVAL_FACING = 180;

/** The exit `PortalBand`'s centre, on the doorway line. */
export const REPTILE_EXIT_BAND_Z = 18;

// ---------------------------------------------------------------------------
// The exterior — "Sunny", the snake who is the building
// ---------------------------------------------------------------------------

/**
 * The exterior collision shell: 16 chords at this circumradius. The plinth
 * in `reptileHouse.glb` is a 16-gon built to it (flats at cos(π/16)·R), so
 * what looks solid is solid; the loader asserts the plinth against it.
 */
export const REPTILE_SHELL_RADIUS = 9.4;

/**
 * The outer edge of the front door's walk-through band along the facade
 * bearing — the park layout stands the tongue doormat on it.
 */
export const REPTILE_DOOR_BAND_OUTER = REPTILE_SHELL_RADIUS + 0.2;

/** Where the drawn arch stands along the facade bearing; paving runs to it. */
export const REPTILE_DRAWN_DOOR_ALONG = REPTILE_SHELL_RADIUS - 1.2;

/** The tail signpost's base, radially from the building centre. */
export const REPTILE_TAIL_REACH = 11.2;

/** The tail base's bearing, in degrees past the facade bearing. */
export const REPTILE_TAIL_BEARING_OFFSET = 28;

/** The round "snake hole" entrance arch's clear width and height. */
export const REPTILE_ARCH_WIDTH = 3.4;
export const REPTILE_ARCH_HEIGHT = 3.6;

/** Manifest numbers for the placement agents (not this effort). */
export const REPTILE_FOOTPRINT_RADIUS = 10.5;
export const REPTILE_BOUNDING_RADIUS = 11.5;

// ---------------------------------------------------------------------------
// Exhibits — masonry the `cases` kit builds and the colliders register
// ---------------------------------------------------------------------------

/** Glass wall case: a stadium plinth, `addWall(end, end, HALF_DEPTH)`. */
export const REPTILE_CASE_SEGMENT = 3;
export const REPTILE_CASE_HALF_DEPTH = 1.2;
export const REPTILE_CASE_PLINTH_HEIGHT = 1.1;
/** The frame rim: the top of the glass and the case's absolute collider top. */
export const REPTILE_GLASS_TOP = 2.9;

/** North-wall plinth centreline (back face 0.2 m off the wall). */
export const REPTILE_NORTH_CASE_Z = -16.35;
/** West-wall plinth centreline. */
export const REPTILE_WEST_CASE_X = -22.35;
/** Where she stands to greet a north / west case. */
export const REPTILE_NORTH_STAND_Z = -13.4;
export const REPTILE_WEST_STAND_X = -19.5;

/** Vine-wrapped pier posts sealing the gaps between plinths. */
export const REPTILE_PIER_POST_RADIUS = 0.45;

/**
 * Open (glass-less) enclosure walls: above `JUMP_APEX_HEIGHT` (≈ 1.28 m,
 * derived in `Player.ts`) and below `KID_EYE_HEIGHT` (1.5164). She looks
 * over, cannot get in, nothing inside has to be leavable. `shell.ts` asserts
 * this against the imported `JUMP_APEX_HEIGHT` at construction, because a
 * derived value cannot be read from here.
 */
export const REPTILE_ENCLOSURE_WALL_HEIGHT = 1.4;

/** Snake Grove and Iguana Rocks: solid discs. */
export const REPTILE_ROUND_WALL_RADIUS = 2.4;

/** Snappy's Lagoon: one filled stadium. */
export const REPTILE_LAGOON_SEGMENT = 4;
export const REPTILE_LAGOON_HALF = 3;

/** Tortoise Garden: one filled stadium, east end sunk into the wall. */
export const REPTILE_TORTOISE_SEGMENT = 3;
export const REPTILE_TORTOISE_HALF = 2.9;

/** The Nursery: a kerb with glass to the rail top. */
export const REPTILE_NURSERY_RADIUS = 2.6;
export const REPTILE_NURSERY_KERB_HEIGHT = 0.6;
export const REPTILE_NURSERY_RAIL_TOP = 1.5;

/** Noodle's Rock: a solid disc; the kerb is drawn at `ISLAND_RADIUS`. */
export const REPTILE_ISLAND_COLLIDER_RADIUS = 3.6;
export const REPTILE_ISLAND_RADIUS = 3.4;
export const REPTILE_ISLAND_KERB_HEIGHT = 0.5;

/** The Frog Jar: a glass drum. */
export const REPTILE_JAR_RADIUS = 1.6;
export const REPTILE_JAR_BASE_HEIGHT = 0.6;

// ---------------------------------------------------------------------------
// The Hollow Log — the walk-through short-cut
// ---------------------------------------------------------------------------

/** Clear bore: 3.3 m, above `TALLEST_CHILD_HEIGHT` (2.97) with headroom. */
export const REPTILE_LOG_INNER_RADIUS = 1.65;
export const REPTILE_LOG_OUTER_RADIUS = 2;
export const REPTILE_LOG_LENGTH = 6;
/** Centre of the log along the Log Walk (z = 0). */
export const REPTILE_LOG_CENTRE_X = -13;

// ---------------------------------------------------------------------------
// Noodle — the centrepiece python
// ---------------------------------------------------------------------------

export const REPTILE_NOODLE_BODY_RADIUS = 0.42;
export const REPTILE_NOODLE_MOUND_HEIGHT = 1.6;
/** Her head's rest position, chin-down on the kerb, baked into `rn-head`. */
export const REPTILE_NOODLE_HEAD_X = 2.3;
export const REPTILE_NOODLE_HEAD_Z = 2.3;
export const REPTILE_NOODLE_HEAD_Y = 0.5;

/** The `creatures` kit's `rr-snake-head` length at scale 1. */
export const REPTILE_SNAKE_HEAD_LENGTH = 0.42;

// ---------------------------------------------------------------------------
// Plants
// ---------------------------------------------------------------------------

export const REPTILE_PALM_HEIGHT = 5.5;
export const REPTILE_BANYAN_HEIGHT = 6;

// ---------------------------------------------------------------------------
// The stall and the Noodle-o-meter
// ---------------------------------------------------------------------------

/** "You are N baby snakes tall!" — one rung of the Noodle-o-meter. */
export const REPTILE_BABY_SNAKE_UNIT = 0.5;
/** Taller than the tallest hat (`TALLEST_CHILD_HEIGHT`). */
export const REPTILE_METER_POST_HEIGHT = 3.2;

// ---------------------------------------------------------------------------
// Positions — the tables every consumer reads
// ---------------------------------------------------------------------------

export interface LocalPoint {
  readonly x: number;
  readonly z: number;
}

export interface StandSpot extends LocalPoint {
  /** `Player.facing` in degrees. */
  readonly facing: number;
}

/**
 * Every exhibit's footprint and the one place she stands to greet it.
 * `reptileKeepOuts()` reads the stand spots; the colliders read the
 * footprints; the checks read both.
 */
export type ExhibitShape =
  | { readonly kind: 'disc'; readonly centre: LocalPoint; readonly radius: number }
  | { readonly kind: 'stadium'; readonly a: LocalPoint; readonly b: LocalPoint; readonly half: number };

export interface ExhibitPlacement {
  readonly id: string;
  readonly shape: ExhibitShape;
  readonly stand: StandSpot;
}

const northCase = (id: string, x: number): ExhibitPlacement => ({
  id,
  shape: {
    kind: 'stadium',
    a: { x: x - REPTILE_CASE_SEGMENT / 2, z: REPTILE_NORTH_CASE_Z },
    b: { x: x + REPTILE_CASE_SEGMENT / 2, z: REPTILE_NORTH_CASE_Z },
    half: REPTILE_CASE_HALF_DEPTH,
  },
  stand: { x, z: REPTILE_NORTH_STAND_Z, facing: 180 },
});

const westCase = (id: string, z: number): ExhibitPlacement => ({
  id,
  shape: {
    kind: 'stadium',
    a: { x: REPTILE_WEST_CASE_X, z: z - REPTILE_CASE_SEGMENT / 2 },
    b: { x: REPTILE_WEST_CASE_X, z: z + REPTILE_CASE_SEGMENT / 2 },
    half: REPTILE_CASE_HALF_DEPTH,
  },
  stand: { x: REPTILE_WEST_STAND_X, z, facing: 270 },
});

export const EXHIBIT_PLACEMENTS: readonly ExhibitPlacement[] = [
  {
    id: 'noodle',
    shape: { kind: 'disc', centre: { x: 0, z: 0 }, radius: REPTILE_ISLAND_COLLIDER_RADIUS },
    stand: { x: 3.5, z: 3.5, facing: 225 },
  },
  northCase('rainbowBoa', -12.5),
  northCase('hatchery', -6.25),
  northCase('cornSnakes', 0),
  northCase('chameleon', 6.25),
  northCase('geckoWall', 12.5),
  westCase('treeSnake', -7.5),
  westCase('milkSnake', -1.7),
  westCase('skink', 4.1),
  {
    id: 'snakeGrove',
    shape: { kind: 'disc', centre: { x: -20.6, z: -15.2 }, radius: REPTILE_ROUND_WALL_RADIUS },
    stand: { x: -17.8, z: -12.4, facing: 315 },
  },
  {
    id: 'tortoiseGarden',
    shape: {
      kind: 'stadium',
      a: { x: 18, z: -14.6 },
      b: { x: 18 + REPTILE_TORTOISE_SEGMENT, z: -14.6 },
      half: REPTILE_TORTOISE_HALF,
    },
    stand: { x: 17.5, z: -9.6, facing: 180 },
  },
  {
    id: 'lagoon',
    shape: {
      kind: 'stadium',
      a: { x: 13, z: -3 },
      b: { x: 13 + REPTILE_LAGOON_SEGMENT, z: -3 },
      half: REPTILE_LAGOON_HALF,
    },
    stand: { x: 15, z: 1.8, facing: 180 },
  },
  {
    id: 'iguanaRocks',
    shape: { kind: 'disc', centre: { x: -12, z: 15.3 }, radius: REPTILE_ROUND_WALL_RADIUS },
    stand: { x: -12.5, z: 10.9, facing: 0 },
  },
  {
    id: 'nursery',
    shape: { kind: 'disc', centre: { x: 15.5, z: 6.5 }, radius: REPTILE_NURSERY_RADIUS },
    stand: { x: 20.4, z: 6.5, facing: 270 },
  },
  {
    id: 'frogJar',
    shape: { kind: 'disc', centre: { x: -8, z: 7.2 }, radius: REPTILE_JAR_RADIUS + 0.15 },
    stand: { x: -7.5, z: 10.8, facing: 180 },
  },
];

/** Pier posts sealing the gaps between case plinths. */
export const PIER_POSTS: readonly LocalPoint[] = [
  { x: -9.375, z: REPTILE_NORTH_CASE_Z },
  { x: -3.125, z: REPTILE_NORTH_CASE_Z },
  { x: 3.125, z: REPTILE_NORTH_CASE_Z },
  { x: 9.375, z: REPTILE_NORTH_CASE_Z },
  { x: REPTILE_WEST_CASE_X, z: -4.6 },
  { x: REPTILE_WEST_CASE_X, z: 1.2 },
];

/** The stall at (2, 13) facing +X+Z, and where she stands to buy. */
export const STALL_POSITION: LocalPoint = { x: 2, z: 13 };
export const STALL_FACING = 45;
export const STALL_STAND: StandSpot = { x: 3.6, z: 14.6, facing: 225 };
export const STALL_KEEPER: LocalPoint = { x: 1.3, z: 12.3 };

/** The Noodle-o-meter in the foyer. */
export const METER_POSITION: LocalPoint = { x: 10.5, z: 13.5 };

/** The three hidden-baby spots with their own zones (two more ride on exhibits). */
export const HIDDEN_BABY_SPOTS: readonly LocalPoint[] = [
  { x: -13, z: 0 }, // the Hollow Log's knothole
  { x: -19.3, z: 11 }, // the Grotto pool
  { x: -1, z: 14.5 }, // the foyer's tall-banana pot
];

/**
 * The path graph. Each path is a centreline polyline with a clear width;
 * the floor paint, the width probe (which sweeps a `2·PLAYER_RADIUS` disc
 * along every polyline and then grows it to ≥ 1.5 at every node) and NPC
 * routes all read this table and nothing else. Nodes shared between paths
 * are repeated verbatim so the fill can join them.
 */
export interface PathSpec {
  readonly id: string;
  readonly width: number;
  readonly points: readonly LocalPoint[];
}

/** Every path must be at least this clear between opposing colliders. */
export const REPTILE_PATH_MIN_CLEAR = 3;

export const PATHS: readonly PathSpec[] = [
  {
    id: 'foyer',
    width: 9,
    points: [
      { x: REPTILE_ARRIVAL_X, z: REPTILE_ARRIVAL_Z },
      { x: 6, z: 12.5 },
      { x: -3, z: 12.5 },
      { x: 16, z: 12.5 },
    ],
  },
  {
    id: 'ring',
    width: 4,
    points: [
      { x: 0, z: 5.6 },
      { x: 3.96, z: 3.96 },
      { x: 5.6, z: 0 },
      { x: 3.96, z: -3.96 },
      { x: 0, z: -5.6 },
      { x: -3.96, z: -3.96 },
      { x: -5.6, z: 0 },
      { x: -3.96, z: 3.96 },
      { x: 0, z: 5.6 },
    ],
  },
  { id: 'southOpening', width: 5, points: [{ x: 3.5, z: 5.6 }, { x: 3.5, z: 9 }, { x: 6, z: 12.5 }] },
  {
    id: 'logWalk',
    width: 3.3,
    points: [{ x: -5.6, z: 0 }, { x: -7.6, z: 0 }, { x: REPTILE_LOG_CENTRE_X, z: 0 }, { x: -17.5, z: 0 }, { x: -19.3, z: 0 }],
  },
  { id: 'northChannel', width: 3.6, points: [{ x: 0, z: -5.6 }, { x: 0, z: -7.6 }, { x: 0, z: -11 }, { x: 0, z: -13 }] },
  { id: 'lagoonWalk', width: 3.6, points: [{ x: 5.6, z: 0 }, { x: 7.6, z: 1.8 }, { x: 20, z: 1.8 }, { x: 21.9, z: 1.8 }] },
  { id: 'westStrip', width: 3.65, points: [{ x: -19.3, z: -11 }, { x: -19.3, z: 0 }, { x: -19.3, z: 10.7 }] },
  { id: 'nwLink', width: 3, points: [{ x: -19.3, z: -11 }, { x: -16, z: -13 }] },
  { id: 'northStrip', width: 4.05, points: [{ x: -16, z: -13 }, { x: 0, z: -13 }, { x: 15, z: -13 }] },
  { id: 'neClearing', width: 5.7, points: [{ x: 15, z: -13 }, { x: 15, z: -8.85 }, { x: 21.9, z: -8.85 }] },
  { id: 'eastStrip', width: 3.75, points: [{ x: 21.9, z: -8.85 }, { x: 21.9, z: 1.8 }, { x: 21.9, z: 6.35 }] },
  {
    id: 'seChannel',
    width: 3.4,
    points: [{ x: 21.9, z: 6.35 }, { x: 21.9, z: 10.8 }, { x: 16, z: 10.8 }, { x: 16, z: 12.5 }],
  },
  { id: 'swWalk', width: 3.25, points: [{ x: -19.3, z: 10.7 }, { x: -3, z: 10.7 }, { x: -3, z: 12.5 }] },
];
