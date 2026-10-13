/**
 * **The Library's layout — where everything stands, and the one owner of
 * every shared position** (#716, part 2 of epic #714).
 *
 * A leaf module: it imports `core/constants` and nothing else, so the park
 * manifest, the path router, the colliders, the checks and the procgen
 * invariants can all read the same figure without dragging the building in.
 * `hotel/towerDimensions.ts` and `reptileHouse/layout.ts` are the precedent.
 *
 * **What this file owns, and what it does not.** It owns *where* things go:
 * the reading room's plate, the door, the arrival, every bookcase's spot and
 * facing, every piece of furniture's spot, every place a child must be able
 * to stand ({@link LIBRARY_STAND_SPOTS}, read by `props.ts`'s
 * `libraryKeepOuts`). It does **not** own how big a bookcase or a desk is:
 * that is the mesh's own size, measured off the model by
 * `art/models/libraryAssets.ts` (primitives built to the art contract today,
 * `library.glb` measured with `visibleBounds()` once the 3D Artist's #715
 * lands). A wall bookcase is therefore placed by the point on the wall its
 * **back** stands against, and the builder adds half the measured depth —
 * so the day the glb's shelf is 0.62 deep instead of 0.6, nothing here moves
 * and nothing is typed twice.
 *
 * The exterior's plan-time numbers ({@link LIBRARY_FOOTPRINT_RADIUS},
 * {@link LIBRARY_BOUNDING_RADIUS}, the door's reach) have to be literals here,
 * because the park is solved before any mesh exists; `Library.ts` measures
 * the model at load and throws if it reaches past any of them — the Reptile
 * House's `REPTILE_LIPS_REACH` rule.
 *
 * ## Frames
 *
 * - **Room-local** (the interior): origin at the floor plate's centre, +X
 *   east, +Z south (towards the camera). World = local + the origin. `facing`
 *   is `Player.facing` in degrees: 0 looks along +Z (south), 90 along +X
 *   (east), 180 along -Z (north), 270 along -X (west).
 * - **Building-local** (the exterior): origin on the ground at the plot's
 *   centre, +Z out through the front door, +X across the facade, +Y up the
 *   building's own (leaning) axis. The building stands on its plot turned so
 *   +Z is the camera's diagonal (`cameraFacing`), exactly as the hotel's door
 *   is.
 */
import { LIBRARY_FLOOR_Y, LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z } from '../../core/constants';

export { LIBRARY_FLOOR_Y, LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z };

/** A point on the floor, room-local (or building-local, where a name says so). */
export interface LocalPoint {
  readonly x: number;
  readonly z: number;
}

/** A spot a child stands on, and which way she faces when put there. */
export interface StandSpot extends LocalPoint {
  /** For failure messages: "the desk", "armchair 2's seat". */
  readonly what: string;
  /** `Player.facing`, degrees. */
  readonly facing: number;
}

// ===========================================================================
// The space
// ===========================================================================

/** `spaceAt`'s radius test — the hotel rooms' and the Reptile House's figure. */
export const LIBRARY_SPACE_RADIUS = 70;

/** Half-extents of the 36 x 26 m floor plate. */
export const LIBRARY_HALF_X = 18;
export const LIBRARY_HALF_Z = 13;

/**
 * The play boundary bound while inside. The plate's corner is
 * sqrt(18^2 + 13^2) = 22.2 m out, so 24 would hold it; 28 leaves the secret
 * den behind the west wall (#719) room to be built without moving this. The
 * walls are what stop her — the boundary is only the backstop.
 */
export const LIBRARY_PLAY_RADIUS = 28;

/**
 * The room's walls: half-thickness of the drawn box **and** of its collider,
 * one number, centred on the plate's edge. Their inner faces are therefore at
 * `LIBRARY_HALF_X - LIBRARY_WALL_HALF` (17.7) and `LIBRARY_HALF_Z -
 * LIBRARY_WALL_HALF` (12.7), which is where every wall bookcase's back stands.
 */
export const LIBRARY_WALL_HALF = 0.3;
export const LIBRARY_WALL_HEIGHT = 5.2;

/** The inner wall faces, room-local. */
export const LIBRARY_INNER_X = LIBRARY_HALF_X - LIBRARY_WALL_HALF;
export const LIBRARY_INNER_Z = LIBRARY_HALF_Z - LIBRARY_WALL_HALF;

/**
 * The south wall's doorway — the inside of the front door — centred on X 0,
 * the exterior's door width (3.2 m), so going in and coming out are the same
 * size of hole.
 */
export const LIBRARY_DOOR_X = 0;
export const LIBRARY_DOOR_HALF = 1.6;

/**
 * Where she lands on coming in: 2.1 m inside the doorway, facing north down
 * the central aisle at the story rug. The exit band's inner edge is at
 * `LIBRARY_HALF_Z - LIBRARY_EXIT_BAND_HALF_ALONG` = 12.4, so she stands 1.8 m
 * clear of the band that would send her back out (her radius is 0.62).
 */
export const LIBRARY_ARRIVAL: StandSpot = { what: 'the arrival', x: 0, z: 10.6, facing: 180 };

/** The exit `PortalBand`: centred on the doorway line, this deep either side. */
export const LIBRARY_EXIT_BAND_HALF_ALONG = 0.6;

// ===========================================================================
// The exterior — a classic pillared library, in toy proportions
// ===========================================================================

/**
 * The plinth: 18 m across the facade by 14 m deep, its top 0.36 m up, with
 * the lower of the two front steps a full-width tread across its front.
 * Building-local. These are the art contract's numbers (#715's
 * `art/blend/library_build.py` CONTRACT); the loader asserts the drawn
 * plinth against them.
 */
export const LIBRARY_PLINTH_HALF_X = 9;
export const LIBRARY_PLINTH_HALF_Z = 7;
export const LIBRARY_PLINTH_TOP = 0.36;
/** Each of the two risers — the ground to the step, the step to the plinth. */
export const LIBRARY_STEP_RISE = 0.18;
/** The lower step's tread, front to back: the step runs z [7 - this, 7]. */
export const LIBRARY_STEP_TREAD = 0.6;

/**
 * The cella — the walled hall behind the portico — building-local. It runs the
 * plinth's whole width less a 0.3 m ledge, from 0.3 m in off the back to the
 * front wall the door is cut in.
 */
export const LIBRARY_CELLA_HALF_X = 8.7;
export const LIBRARY_CELLA_BACK_Z = -6.7;
export const LIBRARY_CELLA_FRONT_Z = 2;

/** The rounded door opening in the cella's front wall: 3.2 m wide, 4.0 m to the top of its arch. */
export const LIBRARY_DOOR_WIDTH = 3.2;
export const LIBRARY_DOOR_HEIGHT = 4;

/**
 * The door is a recess 1.6 m deep, closed by a back wall a sprinting child
 * stops on while the iris closes (the Reptile House's and the hotel tower's
 * rule). Building-local z of that back wall's centre line.
 */
export const LIBRARY_RECESS_BACK_Z = 0.4;

/**
 * The six fat columns of the portico: their centres across the facade, and
 * the line they stand on. The middle pair stand 2.8 m apart in the clear, so
 * the way to the door is the widest gap; the others 1.8 m, still wider than a
 * child (1.24 m).
 */
export const LIBRARY_COLUMN_XS: readonly number[] = [-8, -5, -2, 2, 5, 8];
export const LIBRARY_COLUMN_Z = 4.6;

/**
 * **The park's plot.** The building's footprint is the plinth's 18 x 14
 * rectangle, but plots are axis-aligned and a camera-facing door turns it 45
 * degrees, so the plot is the circle that holds the plinth at any turn: its
 * corner radius, sqrt(9^2 + 7^2) = 11.40. `Library.ts` asserts the drawn
 * plinth inside it.
 */
export const LIBRARY_FOOTPRINT_RADIUS = 11.41;

/** The manifest's bounding radius: everything drawn stands inside it (the roof is held to the plinth's plan). */
export const LIBRARY_BOUNDING_RADIUS = 11.5;

/**
 * **Where the path arrives** — the foot of the steps, building-local z: the
 * front of the lower tread. The park's doormat stands a spur's paved
 * half-width (plus the router's margin) out past it, and the paving runs on
 * in to here and `DOOR_PAVING_OVERLAP` under the step (`parkManifest.ts`).
 */
export const LIBRARY_STEPS_FRONT_Z = LIBRARY_PLINTH_HALF_Z;

/**
 * The front door's walk-through band, building-local: from the recess back
 * wall's face out to just past the door's front. Crossing it enters.
 */
export const LIBRARY_ENTRY_BAND_INNER_Z = LIBRARY_RECESS_BACK_Z + 0.35;
export const LIBRARY_ENTRY_BAND_OUTER_Z = LIBRARY_CELLA_FRONT_Z + 0.2;

// ===========================================================================
// The reading room — bookcases
// ===========================================================================

/**
 * A bookcase unit's spot.
 *
 * - `wall` — tall, against a wall, books on its front: `at` is the point on
 *   the wall's inner face its back stands against.
 * - `low` — knee-high picture-book bins along the two walls the camera looks
 *   in over (south and east, drawn hidden): a tall case there would show the
 *   camera its back and hide the room. `at` is the back's point on the wall.
 * - `stack` — tall, free-standing, books on both faces: `at` is its centre.
 *   Stacks fade when they stand between the camera and her (`Library.ts`).
 */
export interface BookcaseSpec {
  readonly id: string;
  readonly kind: 'wall' | 'low' | 'stack';
  readonly at: LocalPoint;
  /** Which way its front faces, `Player.facing` degrees. Stacks: one of their two faces. */
  readonly facing: number;
  /**
   * **The secret shelf** (#719): pull one special book and this unit swings
   * open on a hinge onto a hidden den beyond the west wall. Today it is an
   * ordinary bookcase that knows it is the one.
   */
  readonly secret?: true;
}

/** The north wall's eight tall cases, x centres, backs on the inner face. */
const NORTH_XS = [-14, -10, -6, -2, 2, 6, 10, 14] as const;
/** The west wall's five tall cases, z centres. */
const WEST_ZS = [-8, -4, 0, 4, 8] as const;
/** The stacks: three east-west rows, each a west block of three units and an east block of two. */
const STACK_ROW_ZS = [-5.6, -2.2, 1.2] as const;
const STACK_WEST_XS = [-13, -9, -5] as const;
const STACK_EAST_XS = [6, 10] as const;
/** The low bins: the south wall either side of the door, and the east wall's south half. */
const SOUTH_LOW_XS = [-14, -10, -6, 10, 14] as const;
const EAST_LOW_ZS = [-2, 2, 6, 10] as const;

/** Which west-wall case is the secret one: the second from the north, beside the nook. */
const SECRET_WEST_Z = -4;

export const LIBRARY_BOOKCASES: readonly BookcaseSpec[] = [
  ...NORTH_XS.map((x, i): BookcaseSpec => ({ id: `north-${i + 1}`, kind: 'wall', at: { x, z: -LIBRARY_INNER_Z }, facing: 0 })),
  ...WEST_ZS.map(
    (z, i): BookcaseSpec => ({
      id: `west-${i + 1}`,
      kind: 'wall',
      at: { x: -LIBRARY_INNER_X, z },
      facing: 90,
      ...(z === SECRET_WEST_Z ? { secret: true as const } : {}),
    }),
  ),
  ...STACK_ROW_ZS.flatMap((z, row) =>
    [...STACK_WEST_XS, ...STACK_EAST_XS].map((x, i): BookcaseSpec => ({ id: `stack-${row + 1}-${i + 1}`, kind: 'stack', at: { x, z }, facing: 0 })),
  ),
  ...SOUTH_LOW_XS.map((x, i): BookcaseSpec => ({ id: `south-low-${i + 1}`, kind: 'low', at: { x, z: LIBRARY_INNER_Z }, facing: 180 })),
  ...EAST_LOW_ZS.map((z, i): BookcaseSpec => ({ id: `east-low-${i + 1}`, kind: 'low', at: { x: LIBRARY_INNER_X, z }, facing: 270 })),
];

/** The secret shelf's own entry — the one #719 hinges. */
export const LIBRARY_SECRET_BOOKCASE: BookcaseSpec = (() => {
  const found = LIBRARY_BOOKCASES.find((spec) => spec.secret);
  if (!found) throw new Error('library layout: no bookcase is the secret one');
  return found;
})();

// ===========================================================================
// The reading room — furniture
// ===========================================================================

/**
 * A piece of furniture's spot. Its size is the model's (`libraryAssets.ts`);
 * its collider and plate are `props.ts`'s.
 *
 * - `desk` — the librarian's desk, 3 m along its facing's across-axis, its top
 *   at the kiosk counter's height (`stallShape.ts`'s `COUNTER_TOP_Y`).
 * - `armchair` — a reading chair. A child sits in it from its front.
 * - `storyChair` — the big chair the owl reads from at story time (#714 part 4).
 * - `floorLamp` / `readingLamp` (on a `sideTable`) — warm pools of light.
 * - `rug` — the story rug, flat, walked on.
 * - `cushion` — a floor cushion on the rug: soft, so a platform she steps up
 *   onto rather than a wall she bumps (the hotel beds' "a prop that is its
 *   own floor is placed soft").
 * - `sconce` — a wall light above the cases, out of reach: drawn, lit, no
 *   collider, because nothing at that height can meet her.
 */
export type FurnitureKind = 'desk' | 'armchair' | 'storyChair' | 'floorLamp' | 'sideTable' | 'readingLamp' | 'rug' | 'cushion' | 'sconce';

export interface FurnitureSpec {
  readonly id: string;
  readonly kind: FurnitureKind;
  readonly at: LocalPoint;
  /** `Player.facing` degrees: a chair's sitter looks this way; a desk's front faces it. */
  readonly facing: number;
  /** A sconce's height on its wall, or a reading lamp's on its table. */
  readonly y?: number;
  /** This lamp throws a real `PointLight` pool (the rest glow; see `lighting.ts`'s budget). */
  readonly pool?: true;
}

/** The story rug's centre — the far end of the central aisle, under the storyteller's eye. */
export const LIBRARY_STORY_RUG: LocalPoint = { x: 4, z: -9 };

export const LIBRARY_FURNITURE: readonly FurnitureSpec[] = [
  // The librarian's desk, just inside the door to the right, facing the
  // camera so the owl behind it (#714 part 4) faces it too.
  { id: 'desk', kind: 'desk', at: { x: 6, z: 6.8 }, facing: 0 },
  { id: 'desk-lamp', kind: 'readingLamp', at: { x: 7.1, z: 6.7 }, facing: 0, pool: true },

  // The story corner at the far end of the central aisle.
  { id: 'story-rug', kind: 'rug', at: LIBRARY_STORY_RUG, facing: 0 },
  { id: 'story-chair', kind: 'storyChair', at: { x: 4, z: -11.1 }, facing: 0 },
  { id: 'story-armchair-west', kind: 'armchair', at: { x: -0.6, z: -9 }, facing: 90 },
  { id: 'story-armchair-east', kind: 'armchair', at: { x: 8.6, z: -9 }, facing: 270 },
  { id: 'story-lamp-west', kind: 'floorLamp', at: { x: -1.3, z: -10.7 }, facing: 0, pool: true },
  { id: 'story-lamp-east', kind: 'floorLamp', at: { x: 9.3, z: -10.7 }, facing: 0, pool: true },
  { id: 'cushion-1', kind: 'cushion', at: { x: 2.1, z: -8 }, facing: 180 },
  { id: 'cushion-2', kind: 'cushion', at: { x: 4, z: -7.6 }, facing: 180 },
  { id: 'cushion-3', kind: 'cushion', at: { x: 5.9, z: -8 }, facing: 180 },
  { id: 'cushion-4', kind: 'cushion', at: { x: 3, z: -9.5 }, facing: 180 },
  { id: 'cushion-5', kind: 'cushion', at: { x: 5, z: -9.5 }, facing: 180 },

  // The north-west reading nook, by the secret shelf.
  { id: 'nook-armchair', kind: 'armchair', at: { x: -12.6, z: -9.4 }, facing: 135 },
  { id: 'nook-table', kind: 'sideTable', at: { x: -14.4, z: -10.6 }, facing: 0 },
  { id: 'nook-lamp', kind: 'readingLamp', at: { x: -14.4, z: -10.6 }, facing: 0, pool: true },

  // The north-east reading nook.
  { id: 'east-armchair', kind: 'armchair', at: { x: 14, z: -9.4 }, facing: 225 },
  { id: 'east-table', kind: 'sideTable', at: { x: 15.8, z: -10.6 }, facing: 0 },
  { id: 'east-lamp', kind: 'readingLamp', at: { x: 15.8, z: -10.6 }, facing: 0 },
  { id: 'east-floor-lamp', kind: 'floorLamp', at: { x: 12.2, z: -10.9 }, facing: 0, pool: true },

  // Sconces above the cases: the north wall's three and the west wall's two.
  { id: 'sconce-north-1', kind: 'sconce', at: { x: -8, z: -LIBRARY_INNER_Z }, facing: 0, y: 3.9, pool: true },
  { id: 'sconce-north-2', kind: 'sconce', at: { x: 0, z: -LIBRARY_INNER_Z }, facing: 0, y: 3.9 },
  { id: 'sconce-north-3', kind: 'sconce', at: { x: 8, z: -LIBRARY_INNER_Z }, facing: 0, y: 3.9, pool: true },
  { id: 'sconce-west-1', kind: 'sconce', at: { x: -LIBRARY_INNER_X, z: -6 }, facing: 90, y: 3.9 },
  { id: 'sconce-west-2', kind: 'sconce', at: { x: -LIBRARY_INNER_X, z: 6 }, facing: 90, y: 3.9, pool: true },
];

// ===========================================================================
// Where a child must be able to stand
// ===========================================================================

/**
 * In front of the librarian's desk, where she is served (and handed her
 * library card, #714 part 4).
 */
export const LIBRARY_DESK_STAND: StandSpot = { what: "the desk's front", x: 6, z: 8.7, facing: 180 };

/** Behind the desk, where the owl stands (#714 part 4) — kept clear for her. */
export const LIBRARY_LIBRARIAN_SPOT: StandSpot = { what: "the librarian's spot", x: 6, z: 5.3, facing: 0 };

/** Where she stands to pull the secret book (#719): in front of the secret case, facing it. */
export const LIBRARY_SECRET_STAND: StandSpot = {
  what: 'in front of the secret shelf',
  x: -LIBRARY_INNER_X + 1.9,
  z: LIBRARY_SECRET_BOOKCASE.at.z,
  facing: 270,
};

/**
 * **The twelve readable books' slots** (#718): each names the case it stands
 * in, which shelf (0 the bottom) and how far along the shelf from the case's
 * middle (metres, along the case's right-hand side as you face it), and where
 * she stands to take it down. Books #718 fills them; this PR only keeps their
 * stand spots clear and leaves the gap on the shelf.
 */
export interface ReadableSlot {
  readonly index: number;
  readonly bookcase: string;
  readonly shelf: number;
  readonly along: number;
  readonly stand: StandSpot;
}

function slotStand(bookcase: string, along: number, index: number): StandSpot {
  const spec = LIBRARY_BOOKCASES.find((candidate) => candidate.id === bookcase);
  if (!spec) throw new Error(`library layout: readable slot ${index} names no bookcase '${bookcase}'`);
  const yaw = (spec.facing * Math.PI) / 180;
  // Out from the front face along its facing, then `along` to her right as
  // she faces the case (the case's own left, looking out of it).
  const outX = Math.sin(yaw);
  const outZ = Math.cos(yaw);
  const rightX = -outZ;
  const rightZ = outX;
  const out = spec.kind === 'stack' ? 1.4 : 1.6;
  return {
    what: `readable book ${index + 1}'s stand (${bookcase})`,
    x: spec.at.x + outX * out - rightX * along,
    z: spec.at.z + outZ * out - rightZ * along,
    facing: (spec.facing + 180) % 360,
  };
}

const READABLE: readonly (readonly [string, number, number])[] = [
  ['north-1', 2, 0.6],
  ['north-3', 1, -0.8],
  ['north-7', 2, 0.4],
  ['north-8', 1, -0.6],
  ['west-1', 2, 0.5],
  ['west-3', 1, -0.5],
  ['west-5', 2, 0.6],
  ['stack-3-1', 1, 0.6],
  ['stack-3-3', 2, -0.6],
  ['stack-3-4', 1, 0.4],
  ['stack-2-2', 2, 0.5],
  ['stack-1-5', 1, -0.5],
];

export const LIBRARY_READABLE_SLOTS: readonly ReadableSlot[] = READABLE.map(([bookcase, shelf, along], index) => ({
  index,
  bookcase,
  shelf,
  along,
  stand: slotStand(bookcase, along, index),
}));

/**
 * **The aisles** — the walking graph of the room, as polylines whose every
 * node is a spot she must be able to stand on and whose every segment a
 * player-sized disc must sweep (`check:library`). Room-local.
 */
export interface Aisle {
  readonly id: string;
  readonly points: readonly LocalPoint[];
}

export const LIBRARY_AISLES: readonly Aisle[] = [
  // The central aisle, door to story rug.
  { id: 'central', points: [{ x: 0, z: 11.6 }, { x: 0, z: 6 }, { x: 0.6, z: 1.2 }, { x: 0.6, z: -2.2 }, { x: 0.6, z: -5.6 }, { x: 2, z: -7.4 }] },
  // Between the rows, west block.
  { id: 'west-aisle-1', points: [{ x: -15.9, z: -3.9 }, { x: -11, z: -3.9 }, { x: -7, z: -3.9 }, { x: -1.5, z: -3.9 }] },
  { id: 'west-aisle-2', points: [{ x: -15.9, z: -0.5 }, { x: -11, z: -0.5 }, { x: -7, z: -0.5 }, { x: -1.5, z: -0.5 }] },
  // Between the rows, east block.
  { id: 'east-aisle-1', points: [{ x: 2.5, z: -3.9 }, { x: 8, z: -3.9 }, { x: 13.5, z: -3.9 }] },
  { id: 'east-aisle-2', points: [{ x: 2.5, z: -0.5 }, { x: 8, z: -0.5 }, { x: 13.5, z: -0.5 }] },
  // Along the west wall's cases, between them and the stacks' ends.
  { id: 'west-wall', points: [{ x: -15.9, z: 9 }, { x: -15.9, z: 4 }, { x: -15.9, z: -0.5 }, { x: -15.9, z: -3.9 }, { x: -15.9, z: -7.6 }] },
  // Across the north, in front of the north wall's cases.
  { id: 'north', points: [{ x: -15.6, z: -7.6 }, { x: -10, z: -7.4 }, { x: -4, z: -7.4 }, { x: 2, z: -7.4 }] },
  // Across the entrance hall, south of the stacks.
  { id: 'entrance-hall', points: [{ x: -15.9, z: 4 }, { x: -9, z: 4 }, { x: -3, z: 4 }, { x: 0, z: 6 }, { x: 4, z: 4 }, { x: 10, z: 4 }, { x: 14.5, z: 4 }] },
  // Up the east side, past the low bins, to the north-east nook.
  { id: 'east', points: [{ x: 14.5, z: 4 }, { x: 14.5, z: -0.5 }, { x: 14.5, z: -3.9 }, { x: 14.5, z: -7 }, { x: 11, z: -7.4 }] },
];

/**
 * **Every spot a child must be able to stand on, room-local** — the arrival,
 * the doorway, the desk's front, the librarian's spot, the rug, every seat's
 * front, the secret shelf's stand, the twelve readable books' stands, and
 * every aisle node. `props.ts`'s `libraryKeepOuts` turns these into keep-out
 * discs and refuses any collider inside one; `check:library` floods the floor
 * from the arrival and asserts every one is reached.
 */
export function libraryStandSpots(): StandSpot[] {
  const spots: StandSpot[] = [
    LIBRARY_ARRIVAL,
    { what: 'the doorway', x: LIBRARY_DOOR_X, z: LIBRARY_INNER_Z - 0.4, facing: 0 },
    LIBRARY_DESK_STAND,
    LIBRARY_LIBRARIAN_SPOT,
    { what: 'the story rug', x: LIBRARY_STORY_RUG.x, z: LIBRARY_STORY_RUG.z, facing: 180 },
    LIBRARY_SECRET_STAND,
  ];
  for (const piece of LIBRARY_FURNITURE) {
    if (piece.kind !== 'armchair' && piece.kind !== 'storyChair') continue;
    const yaw = (piece.facing * Math.PI) / 180;
    spots.push({ what: `${piece.id}'s front`, x: piece.at.x + Math.sin(yaw) * 1.25, z: piece.at.z + Math.cos(yaw) * 1.25, facing: (piece.facing + 180) % 360 });
  }
  for (const slot of LIBRARY_READABLE_SLOTS) spots.push(slot.stand);
  for (const aisle of LIBRARY_AISLES) {
    for (const point of aisle.points) spots.push({ what: `aisle '${aisle.id}' node (${point.x}, ${point.z})`, x: point.x, z: point.z, facing: 0 });
  }
  return spots;
}
