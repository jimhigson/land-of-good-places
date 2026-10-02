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

/**
 * The lobby back wall, along the facade bearing: two metres inside the flat
 * of the 16-gon face the door is cut into, so a sprinting child stops on it
 * while the iris closes. Derived; a Blender script wanting it re-derives it.
 */
export const REPTILE_BACK_WALL_ALONG = REPTILE_SHELL_RADIUS * Math.cos(Math.PI / 16) - 2;

/** The tail signpost's base, radially from the building centre. */
export const REPTILE_TAIL_REACH = 11.2;

/**
 * The tail base's bearing, in degrees past the facade bearing. 40, not the
 * spec's 28: the coil starts at this bearing too, and at 28° its first tube
 * ran 0.6 m into the flank of the head now lying in front of the door
 * (`reptile_house_build.py`'s `check_head_clearance`, 2 October 2026).
 */
export const REPTILE_TAIL_BEARING_OFFSET = 40;

/** The round "snake hole" entrance arch's clear width and height. */
export const REPTILE_ARCH_WIDTH = 3.4;
export const REPTILE_ARCH_HEIGHT = 3.6;

/**
 * Manifest numbers for the placement agents (not this effort). The bounding
 * radius is 12, not the spec's 11.5: the tongue — the doormat — lolls out of
 * the mouth to its fork at 11.9 m (`reptile_house_build.py` measures it).
 */
export const REPTILE_FOOTPRINT_RADIUS = 10.5;
export const REPTILE_BOUNDING_RADIUS = 12;

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
 * Open (glass-less) enclosure walls: above what a jump clears and below
 * `KID_EYE_HEIGHT` (1.5164). She looks over, cannot get in, nothing inside
 * has to be leavable.
 *
 * **1.45, not the spec's 1.4.** `Collision.ts`'s `clearsTop` grants a mover
 * `JUMP_CLEARANCE_GRACE` (0.15 m) over her feet, so a body at the 1.28 m
 * apex clears anything up to 1.43 m — measured by `check:reptile-house`'s
 * hop probe, which marched a body over a 1.4 m wall from 25 of 60 bearings.
 * `ReptileHouse`'s constructor asserts this constant against the engine's
 * own `clearsTop(…, JUMP_APEX_HEIGHT)`, because neither the apex nor the
 * grace can be read from here.
 */
export const REPTILE_ENCLOSURE_WALL_HEIGHT = 1.45;

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
    // Beside her bearing rather than on it: a child stood on the head's own
    // 45° line hid the head from the 38° camera almost entirely (the noodle
    // kit's `game-view-with-child.png`), so she stands a stride to the east
    // and looks west along the kerb at the chin.
    stand: { x: 4.4, z: 2.4, facing: 267 },
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

/**
 * The stall in the foyer facing +X+Z (the camera), and where she stands to
 * buy: 2.6 m out along its facing, a stride clear of the counter's front.
 */
export const STALL_POSITION: LocalPoint = { x: 1.2, z: 13.4 };
export const STALL_FACING = 45;
export const STALL_STAND: StandSpot = { x: 3.04, z: 15.24, facing: 225 };

/** The Noodle-o-meter in the foyer, facing the camera, and where she stands to be measured. */
export const METER_POSITION: LocalPoint = { x: 10.5, z: 13.5 };
export const METER_FACING = 45;
export const METER_STAND: StandSpot = { x: 11.9, z: 14.9, facing: 225 };

/**
 * **The Tortoise Ride** (Jim, 2 October 2026: *"Yeah, put the two rides in,
 * why not?"*): a big friendly tortoise parked in the foyer's south-east
 * corner, facing the arrival, that plods one lap of the ring with her on
 * its shell and comes back. Parked, it is a solid disc; walking, it is
 * scenery (she is on it). The parking spot is off every path node and the
 * foyer's 3 m sweep; the stand spot is where she boards and is put down.
 */
export const TORTOISE_RIDE_PARK: StandSpot = { x: 9, z: 16.3, facing: 270 };
export const TORTOISE_RIDE_PARK_RADIUS = 1.3;
export const TORTOISE_RIDE_STAND: StandSpot = { x: 8, z: 14.3, facing: 23 };
/** The tortoise at this scale is ≈ 2.9 m long and its shell ≈ 1.9 m up. */
export const TORTOISE_RIDE_SCALE = 2.4;
/** Plodding — a lap is about 45 s. */
export const TORTOISE_RIDE_SPEED = 1.3;
/**
 * The lap, closed: out of the foyer, up the south opening, once round the
 * ring anticlockwise, and back down the opening to the parking spot. The ring
 * is 4 m wide on r 5.6 and the opening 5 m wide, so a 2.5 m tortoise fits
 * with a stride to spare; the beds' kerbs stand at `RING_OUTER` 7.6.
 */
export const TORTOISE_RIDE_LOOP: readonly LocalPoint[] = [
  { x: TORTOISE_RIDE_PARK.x, z: TORTOISE_RIDE_PARK.z },
  { x: 8.8, z: 13.2 },
  { x: 6.2, z: 11.6 },
  { x: 3.8, z: 9.5 },
  { x: 3.7, z: 7.2 },
  { x: 3.96, z: 3.96 },
  { x: 5.6, z: 0 },
  { x: 3.96, z: -3.96 },
  { x: 0, z: -5.6 },
  { x: -3.96, z: -3.96 },
  { x: -5.6, z: 0 },
  { x: -3.96, z: 3.96 },
  { x: 0, z: 5.6 },
  { x: 2.3, z: 8.6 },
  { x: 5.5, z: 11.2 },
  { x: 8.3, z: 13.3 },
];

/**
 * Where she stands to find each of the three hidden babies that have their
 * own zones (two more ride on exhibits: Tock's shell and the Frog Jar). The
 * babies themselves sit a stride away — in the log's knothole, in the
 * grotto's pool, in the foyer's banana pot — at spots `exhibits.ts` derives
 * from the kit's own anchors.
 */
export const HIDDEN_BABY_SPOTS: readonly StandSpot[] = [
  { x: -13, z: 0, facing: 180 }, // the Hollow Log's knothole, on its north wall
  { x: -19.3, z: 11, facing: 0 }, // the Grotto pool
  { x: -1.6, z: 15.1, facing: 336 }, // the foyer's tall-banana pot
];

/** The foyer's tall-banana pot, in the south-west corner of the foyer — hidden baby #3's hiding place. */
export const FOYER_POT: LocalPoint = { x: -2.4, z: 16.9 };
export const FOYER_POT_RADIUS = 0.6;

/**
 * The grotto rock, in the south-west corner, yawed so its pool side faces +X
 * — the one side the fixed +X+Z camera can see into a corner.
 */
export const GROTTO_ROCK: LocalPoint = { x: -21.6, z: 15.5 };
export const GROTTO_ROCK_YAW = 90;

/**
 * How much clear floor a child must have around a stand spot, the arrival
 * point and the doorway — the radii `reptileKeepOuts()` publishes and every
 * collider is asserted clear of.
 */
export const REPTILE_STAND_KEEP_OUT = 1;
export const REPTILE_ARRIVAL_KEEP_OUT = 1.5;
export const REPTILE_DOORWAY_KEEP_OUT = 1.6;

// ---------------------------------------------------------------------------
// The planted beds — the solid mass between the paths
// ---------------------------------------------------------------------------

/**
 * A bed's radius-1.2 discs and their absolute top. The top is above
 * `JUMP_APEX_HEIGHT` (≈ 1.28) so a jump never clears a bed; the discs are
 * what `planting.ts` registers, chained along the inset outline and tiled
 * across the inside so there is no hollow for a child to land in.
 */
export const REPTILE_BED_DISC_RADIUS = 1.2;
export const REPTILE_BED_TOP = 2.4;

export interface BedSpec {
  readonly id: string;
  /** The visual outline, hall-local, counter-clockwise or clockwise alike. */
  readonly outline: readonly LocalPoint[];
}

/** Points along an arc of radius `r` about the origin, from `fromDeg` to `toDeg` (compass-style, 0 = +Z). */
function arc(r: number, fromDeg: number, toDeg: number, steps: number): LocalPoint[] {
  const out: LocalPoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const deg = fromDeg + ((toDeg - fromDeg) * i) / steps;
    const rad = (deg * Math.PI) / 180;
    out.push({ x: Math.sin(rad) * r, z: Math.cos(rad) * r });
  }
  return out;
}

/** The ring path's outer edge: beds stop here. */
const RING_OUTER = 7.6;

/**
 * The Hollow Log lies across the Log Walk with its bore walls on the walk's
 * edges (|z| = `REPTILE_LOG_INNER_RADIUS`) and its bark out to
 * `REPTILE_LOG_OUTER_RADIUS`, so the two beds either side are notched round
 * it: along the log's length their kerb stops here, **inside the log's wall**
 * — buried in bark rather than lying in the bore wall's own plane, which is
 * where the first cut put it and where `check:coplanar` found 0.9 m² of kerb
 * face fighting the bore (2 October 2026). The notch runs 0.3 m past each end
 * of the log so the kerb's step faces stand clear of the log's end caps.
 */
const LOG_NOTCH_Z = REPTILE_LOG_OUTER_RADIUS - 0.1;
const LOG_NOTCH_WEST = REPTILE_LOG_CENTRE_X - REPTILE_LOG_LENGTH / 2 - 0.3;
const LOG_NOTCH_EAST = REPTILE_LOG_CENTRE_X + REPTILE_LOG_LENGTH / 2 + 0.3;

/**
 * Every bed's outline, each edge lying exactly on the path edge it faces, so
 * the paths keep the widths the `PATHS` table promises — the width probe in
 * `scripts/check-reptile-house.mts` is what holds them to it.
 */
export const BEDS: readonly BedSpec[] = [
  {
    // NW island: between the West Strip, the North Strip, the north channel,
    // the Log Walk and the ring.
    id: 'nwIsland',
    outline: [
      { x: -17.5, z: -11 },
      { x: -1.8, z: -11 },
      ...arc(RING_OUTER, 193.7, 257.5, 6),
      { x: LOG_NOTCH_EAST, z: -REPTILE_LOG_INNER_RADIUS },
      { x: LOG_NOTCH_EAST, z: -LOG_NOTCH_Z },
      { x: LOG_NOTCH_WEST, z: -LOG_NOTCH_Z },
      { x: LOG_NOTCH_WEST, z: -REPTILE_LOG_INNER_RADIUS },
      { x: -17.5, z: -REPTILE_LOG_INNER_RADIUS },
    ],
  },
  {
    // NE island: between the north channel, the North Strip, the NE Clearing,
    // the lagoon, the Lagoon Walk and the ring.
    id: 'neIsland',
    outline: [
      { x: 1.8, z: -11 },
      { x: 10, z: -11 },
      { x: 10, z: 0 },
      { x: RING_OUTER, z: 0 },
      ...arc(RING_OUTER, 90, 166.3, 6),
    ],
  },
  {
    // SW bed: between the Log Walk, the West Strip, the SW Walk and the
    // ring; the Frog Jar stands at its south-east corner.
    id: 'swBed',
    outline: [
      { x: -17.5, z: REPTILE_LOG_INNER_RADIUS },
      { x: LOG_NOTCH_WEST, z: REPTILE_LOG_INNER_RADIUS },
      { x: LOG_NOTCH_WEST, z: LOG_NOTCH_Z },
      { x: LOG_NOTCH_EAST, z: LOG_NOTCH_Z },
      { x: LOG_NOTCH_EAST, z: REPTILE_LOG_INNER_RADIUS },
      ...arc(RING_OUTER, 282.5, 307.8, 4),
      { x: -6, z: 8.95 },
      { x: -17.5, z: 8.95 },
    ],
  },
  {
    // SE island: between the south opening, the Lagoon Walk, the Nursery and
    // the foyer.
    id: 'seIsland',
    outline: [
      { x: 6, z: 9.1 },
      ...arc(RING_OUTER, 52.2, 61.7, 3),
      { x: 13.5, z: 3.6 },
      { x: 13.5, z: 9.1 },
    ],
  },
  {
    // Grotto: the south-west corner behind the SW Walk, taking the Iguana
    // Rocks' west flank.
    id: 'grotto',
    outline: [
      { x: -23.75, z: 12.5 },
      { x: -13.5, z: 12.5 },
      { x: -13.5, z: 17.75 },
      { x: -23.75, z: 17.75 },
    ],
  },
  {
    // SW-E bed: between the Iguana Rocks and the foyer, under the south wall.
    id: 'swEast',
    outline: [
      { x: -10.5, z: 12.5 },
      { x: -3, z: 12.5 },
      { x: -3, z: 17.75 },
      { x: -10.5, z: 17.75 },
    ],
  },
  {
    // SE corner: south of the SE Channel, east of the foyer.
    id: 'seCorner',
    outline: [
      { x: 16, z: 12.5 },
      { x: 23.75, z: 12.5 },
      { x: 23.75, z: 17.75 },
      { x: 16, z: 17.75 },
    ],
  },
  {
    // W-S bed: the west wall between the skink's case and the SW Walk.
    id: 'westSouth',
    outline: [
      { x: -23.75, z: 6.8 },
      { x: -21.15, z: 6.8 },
      { x: -21.15, z: 12.5 },
      { x: -23.75, z: 12.5 },
    ],
  },
  {
    // Grove-side bed: the west wall between the tree snake's case and the
    // Snake Grove, run into the grove's own disc.
    id: 'groveSide',
    outline: [
      { x: -23.75, z: -10.2 },
      { x: -21.15, z: -10.2 },
      { x: -21.15, z: -12.6 },
      { x: -22.3, z: -14 },
      { x: -23.75, z: -15 },
    ],
  },
  {
    // The nook between the first north case and the grove, with the corner palm.
    id: 'nwNook',
    outline: [
      { x: -18.4, z: -17.75 },
      { x: -15.2, z: -17.75 },
      { x: -15.2, z: -15.15 },
      { x: -16, z: -15.15 },
      { x: -18.4, z: -16 },
    ],
  },
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
    // The foyer is open floor; these two polylines are how it is swept — the
    // east leg to the SE Channel, the west one round the stall to the SW Walk.
    id: 'foyer',
    width: 9,
    points: [
      { x: REPTILE_ARRIVAL_X, z: REPTILE_ARRIVAL_Z },
      { x: 6, z: 12.5 },
      { x: 6, z: 11.8 },
      { x: 14, z: 11.8 },
    ],
  },
  { id: 'foyerWest', width: 4, points: [{ x: 6, z: 12.5 }, { x: 3.3, z: 10.3 }, { x: -1.5, z: 12.5 }] },
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
  { id: 'northStrip', width: 4.05, points: [{ x: -16, z: -13 }, { x: 0, z: -13 }, { x: 13.5, z: -13 }] },
  { id: 'neClearing', width: 5.7, points: [{ x: 13.5, z: -13 }, { x: 15, z: -8.85 }, { x: 21.9, z: -8.85 }] },
  { id: 'eastStrip', width: 3.75, points: [{ x: 21.9, z: -8.85 }, { x: 21.9, z: 1.8 }, { x: 21.9, z: 6.35 }] },
  {
    id: 'seChannel',
    width: 3.4,
    points: [{ x: 21.9, z: 6.35 }, { x: 21.9, z: 10.8 }, { x: 14, z: 11.8 }],
  },
  { id: 'swWalk', width: 3.25, points: [{ x: -19.3, z: 10.7 }, { x: -3, z: 10.7 }, { x: -1.5, z: 12.5 }] },
];
