/**
 * **The Library's layout — where everything stands, and the one owner of
 * every shared position** (#716, part 2 of epic #714).
 *
 * Light on purpose: it imports `core/constants` and the kit's bare geometry
 * (`art/models/libraryKit.ts` — the glb, read, with no materials), so the
 * park manifest, the path router, the colliders, the checks and the procgen
 * invariants can all read the same figure without dragging the building in.
 * `hotel/towerDimensions.ts` and `reptileHouse/layout.ts` are the precedent.
 *
 * **What this file owns, and what it does not.** It owns *where* things go:
 * the reading room's plate, the door, the arrival, every bookcase's spot and
 * facing, every piece of furniture's spot, every place a child must be able
 * to stand ({@link libraryStandSpots}, read by `props.ts`'s
 * `libraryKeepOuts`). It does **not** own how big anything drawn is: that is
 * `library.glb`'s (#715), measured off the loaded mesh — the bookcase's
 * footprint here through `libraryKit.ts`, every other size by
 * `art/models/libraryAssets.ts`. A wall bookcase is therefore placed by the
 * point on the wall its **back** stands against, and the builder adds the
 * measured depth — so the day the Artist's shelf is 0.62 deep instead of 0.6,
 * nothing here moves and nothing is typed twice. Where a child stands in front
 * of a case is worked out from that same measured depth.
 *
 * The exterior's plan-time numbers — the plot's radius, its bounding radius,
 * where the doormat stands — are derived here from the drawn shell's own
 * vertices (`LIBRARY_EXTERIOR_PLAN`), because the park is solved before any
 * dressed mesh exists; `Library.ts` measures the dressed model, outlines and
 * all, and throws if it reaches past the plot.
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
import { LIBRARY_FLOOR_Y, LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z, PLAYER_RADIUS } from '../../core/constants';
import { LIBRARY_EXTERIOR_PLAN, LIBRARY_SHELF_FOOTPRINT } from '../../art/models/libraryKit';
import type { BookKind } from './bookKinds';

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
  /**
   * **In the secret den** (#719), behind the swung-open secret shelf: reached
   * only while the shelf is open, so it must be unreachable while it is shut.
   * `props.ts`'s `libraryKeepOuts` copies the tag onto the spot's keep-out.
   * Omitted for every spot in the reading room.
   */
  readonly den?: true;
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
 * and exactly as wide as the drawn front door (measured off the shell), so
 * going in and coming out are the same size of hole.
 */
export const LIBRARY_DOOR_X = 0;
export const LIBRARY_DOOR_HALF = LIBRARY_EXTERIOR_PLAN.doorHalf;

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
 * **The exterior's plan is the drawn shell's, measured — never typed here.**
 * `library.glb`'s shell (the 3D Artist's #715, `art/blend/library_build.py`,
 * its `CONTRACT` asserted against the emitted vertices) is read by
 * `art/models/libraryKit.ts`, which measures the plinth, the steps, the cella,
 * the doorway and the six columns off its bare geometry. Everything below is
 * derived from that, so the plot the park solves, the paths the router keeps
 * off the stone and the colliders are three readings of one mesh.
 */
export { LIBRARY_EXTERIOR_PLAN, type LibraryExteriorPlan } from '../../art/models/libraryKit';

/**
 * **The park's plot.** The building's footprint is the plinth's rectangle,
 * steps and all, but plots are axis-aligned and a camera-facing door turns it
 * 45 degrees, so the plot is the circle that holds the plinth at any turn:
 * its corner's distance from the centre.
 */
export const LIBRARY_FOOTPRINT_RADIUS = Math.hypot(
  LIBRARY_EXTERIOR_PLAN.plinthHalfX,
  Math.max(-LIBRARY_EXTERIOR_PLAN.plinthBackZ, LIBRARY_EXTERIOR_PLAN.stepFrontZ),
);

/**
 * What the drawn building's ink outlines add to its bare reach, at most — a
 * hand's breadth. `Library.ts` measures the dressed model, outlines and all,
 * and throws if any vertex stands past {@link LIBRARY_BOUNDING_RADIUS}, so a
 * thicker outline cannot quietly reach a neighbour's plot.
 */
export const LIBRARY_OUTLINE_ALLOWANCE = 0.1;

/** The manifest's bounding radius: every drawn vertex, its outline included, stands inside it. */
export const LIBRARY_BOUNDING_RADIUS = LIBRARY_EXTERIOR_PLAN.reach + LIBRARY_OUTLINE_ALLOWANCE;

/**
 * **Where the path arrives** — the foot of the steps, building-local z: the
 * front of the bottom tread. The park's doormat stands a spur's paved
 * half-width (plus the router's margin) out past it, and the paving runs on
 * in to here and `DOOR_PAVING_OVERLAP` under the step (`parkManifest.ts`).
 */
export const LIBRARY_STEPS_FRONT_Z = LIBRARY_EXTERIOR_PLAN.stepFrontZ;

/**
 * The front door's walk-through band, as offsets from the measured doorway:
 * its inner edge this far out from the door leaves (her radius takes her
 * centre further out than this when she walks into them, so a walk always
 * crosses it), its outer edge this far out past the cella's front.
 */
export const LIBRARY_ENTRY_BAND_INNER_INSET = 0.35;
export const LIBRARY_ENTRY_BAND_OUTER_REACH = 0.2;

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

/**
 * How deep a bookcase of each kind stands, off the drawn shelf
 * (`library.glb`'s `shelf`, measured by `libraryKit.ts`): a wall case and a
 * low bin are one shelf deep; a stack is two shelves back to back, so it has
 * books on both faces.
 */
export function libraryBookcaseDepth(kind: BookcaseSpec['kind']): number {
  return kind === 'stack' ? LIBRARY_SHELF_FOOTPRINT.depth * 2 : LIBRARY_SHELF_FOOTPRINT.depth;
}

/** Where a case's front face is, room-local: out from `at` along its facing. */
export function bookcaseFrontOut(spec: BookcaseSpec): number {
  return spec.kind === 'stack' ? libraryBookcaseDepth(spec.kind) / 2 : libraryBookcaseDepth(spec.kind);
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
 * - `storyChair` — the chair the owl reads from at story time (#714 part 4):
 *   the readers' armchair, in the storyteller's own cloth.
 * - `floorLamp` / `readingLamp` (on a `sideTable`) — warm pools of light.
 * - `rug` — the story rug, flat, walked on.
 * - `doormat` — inside the way out, across the doorway's own width: the south
 *   wall is drawn hidden so the camera can look in, so this is what tells a
 *   child where the door is from across the room.
 * - `cushion` — a floor cushion on the rug: soft, so a platform she steps up
 *   onto rather than a wall she bumps (the hotel beds' "a prop that is its
 *   own floor is placed soft").
 * - `sconce` — a wall light above the cases at {@link LIBRARY_SCONCE_HEIGHT},
 *   out of reach: drawn, lit, no collider, because nothing at that height can
 *   meet her.
 */
export type FurnitureKind = 'desk' | 'armchair' | 'storyChair' | 'floorLamp' | 'sideTable' | 'readingLamp' | 'rug' | 'doormat' | 'cushion' | 'sconce';

export interface FurnitureSpec {
  readonly id: string;
  readonly kind: FurnitureKind;
  readonly at: LocalPoint;
  /** `Player.facing` degrees: a chair's sitter looks this way; a desk's front faces it. */
  readonly facing: number;
  /** This lamp throws a real `PointLight` pool (the rest glow; see `lighting.ts`'s budget). */
  readonly pool?: true;
}

/**
 * How high the wall sconces hang: above the tall cases' tops, out of every
 * reach (a child's jumping head included), so they are drawn and lit with no
 * collider.
 */
export const LIBRARY_SCONCE_HEIGHT = 3.9;

/** The story rug's centre — the far end of the central aisle, under the storyteller's eye. */
export const LIBRARY_STORY_RUG: LocalPoint = { x: 4, z: -9 };

export const LIBRARY_FURNITURE: readonly FurnitureSpec[] = [
  // The doormat inside the way out, on the wall's inner face.
  { id: 'doormat', kind: 'doormat', at: { x: LIBRARY_DOOR_X, z: LIBRARY_INNER_Z }, facing: 0 },

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

  // The north-west reading nook, by the secret shelf. Its side table stands a
  // hand's breadth clear of the chair's back corner: with the chair's arms and
  // wings solid to their own tops (17 Oct 2026) — no longer one block she
  // walked over at seat height — the slot between them at (-14.4, -10.6) was
  // a dimple a child fits in and cannot walk out of (`check:library`).
  { id: 'nook-armchair', kind: 'armchair', at: { x: -12.6, z: -9.4 }, facing: 45 },
  { id: 'nook-table', kind: 'sideTable', at: { x: -14.6, z: -10.8 }, facing: 0 },
  { id: 'nook-lamp', kind: 'readingLamp', at: { x: -14.6, z: -10.8 }, facing: 0, pool: true },

  // The north-east reading nook.
  { id: 'east-armchair', kind: 'armchair', at: { x: 14, z: -9.4 }, facing: 315 },
  { id: 'east-table', kind: 'sideTable', at: { x: 15.8, z: -10.6 }, facing: 0 },
  { id: 'east-lamp', kind: 'readingLamp', at: { x: 15.8, z: -10.6 }, facing: 0 },
  { id: 'east-floor-lamp', kind: 'floorLamp', at: { x: 15.6, z: -8.2 }, facing: 0, pool: true },

  // Sconces above the cases: the north wall's three and the west wall's two.
  { id: 'sconce-north-1', kind: 'sconce', at: { x: -8, z: -LIBRARY_INNER_Z }, facing: 0, pool: true },
  { id: 'sconce-north-2', kind: 'sconce', at: { x: 0, z: -LIBRARY_INNER_Z }, facing: 0 },
  { id: 'sconce-north-3', kind: 'sconce', at: { x: 8, z: -LIBRARY_INNER_Z }, facing: 0, pool: true },
  // West-1 sits over its own case, not between it and the secret shelf: at
  // z −6 it hung on the den doorway's north jamb (#719), half over the gap.
  // It is no pool, so the light rig is unchanged.
  { id: 'sconce-west-1', kind: 'sconce', at: { x: -LIBRARY_INNER_X, z: -8 }, facing: 90 },
  { id: 'sconce-west-2', kind: 'sconce', at: { x: -LIBRARY_INNER_X, z: 6 }, facing: 90, pool: true },
];

// ===========================================================================
// The story corner — who sits where (#718)
// ===========================================================================

/**
 * **The two cushions she is offered** — a Sit chip on each, whether a story
 * is on or not. The library's three children take the other three at story
 * time (cushions 2, 4 and 5: the build plan's Decision 13), so these two are
 * always free for her, and a chip on them never has to refuse.
 */
export const LIBRARY_PLAYER_SEATS = ['cushion-1', 'cushion-3'] as const;
export type LibraryPlayerSeat = (typeof LIBRARY_PLAYER_SEATS)[number];

/** A cushion's spot, looked up in {@link LIBRARY_FURNITURE} — the one table of where furniture stands. */
export function libraryCushion(id: string): FurnitureSpec {
  const piece = LIBRARY_FURNITURE.find((candidate) => candidate.id === id);
  if (!piece || piece.kind !== 'cushion') throw new Error(`library layout: '${id}' is not a cushion in LIBRARY_FURNITURE`);
  return piece;
}

/** The storyteller's chair: the one `storyChair` in {@link LIBRARY_FURNITURE}. */
export const LIBRARY_STORY_CHAIR: FurnitureSpec = (() => {
  const chairs = LIBRARY_FURNITURE.filter((piece) => piece.kind === 'storyChair');
  if (chairs.length !== 1 || !chairs[0]) {
    throw new Error(`library layout: ${chairs.length} story chairs in LIBRARY_FURNITURE, where the story corner needs exactly one`);
  }
  return chairs[0];
})();

/**
 * **Which way a listener at `from` looks to see the storyteller**:
 * `Player.facing` degrees (0 along +Z, 90 along +X) from `from` to the story
 * chair's spot. The one bearing a cushion's sitter is turned to — the
 * cushion's stand spot and her seated facing both read it.
 */
export function libraryFacingStoryChair(from: LocalPoint): number {
  const degrees = (Math.atan2(LIBRARY_STORY_CHAIR.at.x - from.x, LIBRARY_STORY_CHAIR.at.z - from.z) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

// ===========================================================================
// Where a child must be able to stand
// ===========================================================================

/**
 * How much clear floor a stand spot keeps round it: her own radius and a
 * hand's breadth more (`props.ts`'s `libraryKeepOuts` refuses any collider
 * inside it).
 */
export const LIBRARY_STAND_KEEP_OUT = PLAYER_RADIUS + 0.28;

/**
 * How far in front of a case's front face she stands to take a book down, or
 * to pull the secret one: the stand's own keep-out and a hand's breadth more,
 * so the keep-out never reaches the case whatever depth the drawn shelf is.
 */
export const LIBRARY_CASE_STAND_OUT = LIBRARY_STAND_KEEP_OUT + 0.1;

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
  x: LIBRARY_SECRET_BOOKCASE.at.x + bookcaseFrontOut(LIBRARY_SECRET_BOOKCASE) + LIBRARY_CASE_STAND_OUT,
  z: LIBRARY_SECRET_BOOKCASE.at.z,
  facing: 270,
};

// ===========================================================================
// The secret den (#719) — a walled pocket behind the west wall
// ===========================================================================

/**
 * **How deep the secret den runs west of the reading room's west wall** —
 * from the wall's outer face to the den's own west wall's inner face. Room
 * for a baby dragon's nest of books in the far corner and a child beside it,
 * and for the secret shelf to swing in and lie flat against the den's south
 * wall (#719, plan Step 12) with the doorway still clear.
 */
export const LIBRARY_DEN_DEPTH = 5.6;

/**
 * **Half the den's doorway** — the gap in the west wall is exactly as wide as
 * the secret shelf, so the shut shelf fills it: the art contract's case length
 * (`art/blend/library_build.py`, 4 m), halved. Typed here because the den's
 * walls are laid out from it; `shell.ts`'s `libraryDenGap` measures the drawn
 * case and throws unless the two agree within 2 cm, so a case of another width
 * stops the build rather than leaving a slit beside the shut shelf.
 */
export const LIBRARY_DEN_DOOR_HALF = 2;

/**
 * How far the den runs on north past its doorway's north edge: the far
 * corner the baby dragon's nest is tucked into ({@link LIBRARY_DRAGON_NEST}).
 */
const DEN_NORTH_PAST_DOOR = 1.6;

/**
 * **The den's three inner wall faces**, room-local. The south face is flush
 * with the doorway's south edge (the swung-open shelf lies along it); the
 * north runs {@link DEN_NORTH_PAST_DOOR} on past the doorway's north edge.
 * Its far corner, walls included — (−24.5, −8.2) — stands 25.8 m from the
 * room's middle, inside {@link LIBRARY_PLAY_RADIUS} (28), which was reserved
 * for it: the den's walls stop her, and the boundary is only the backstop.
 */
export const LIBRARY_DEN_INNER: { readonly west: number; readonly north: number; readonly south: number } = {
  west: -(LIBRARY_HALF_X + LIBRARY_WALL_HALF + LIBRARY_DEN_DEPTH),
  north: LIBRARY_SECRET_BOOKCASE.at.z - LIBRARY_DEN_DOOR_HALF - DEN_NORTH_PAST_DOOR,
  south: LIBRARY_SECRET_BOOKCASE.at.z + LIBRARY_DEN_DOOR_HALF,
};

/**
 * **The one owner of "she is in the den"**, room-local: west of the reading
 * room's inner wall face — so the doorway, the wall's own thickness at the
 * gap, already counts as the den — and inside the centre lines of the den's
 * three walls. Every question about the den asks this, never a rectangle of
 * its own: the guard that opens the secret shelf if she is ever found in the
 * den with it shut, entering and restoring, the fades and the owl's shush
 * (#719, plan Steps 12-14), and `check:library`'s fill and marches.
 */
export function libraryDenContains(x: number, z: number): boolean {
  return (
    x < -LIBRARY_INNER_X &&
    x >= LIBRARY_DEN_INNER.west - LIBRARY_WALL_HALF &&
    z >= LIBRARY_DEN_INNER.north - LIBRARY_WALL_HALF &&
    z <= LIBRARY_DEN_INNER.south + LIBRARY_WALL_HALF
  );
}

/** Just inside the den, through its doorway, looking in (#719) — where `/library-den` stands her. */
export const LIBRARY_DEN_DOORWAY_STAND: StandSpot = { what: "inside the secret den's doorway", x: -19.6, z: -4.3, facing: 270, den: true };

/**
 * **Beside the baby dragon's nest, facing it** (#719) — where she stands to
 * say hi, and where a tap on the dragon walks her. Due east of the nest, so
 * she and the dragon stand side by side on screen: the camera looks into the
 * room along (−1, −1), and the first spot, (−21.3, −5.0) straight in front of
 * the dragon, was on that line — her body covered the dragon from the camera
 * the whole time she talked to it (plan Step 13, looked at in Chrome). The
 * dragon turns its head toward her here as far as it goes.
 */
export const LIBRARY_DRAGON_STAND: StandSpot = { what: 'beside the baby dragon', x: -20.6, z: -6.3, facing: 270, den: true };

/** The baby dragon's nest of books (#719): in the den's far corner, facing the doorway and the camera. */
export const LIBRARY_DRAGON_NEST: LocalPoint & { readonly facing: number } = { x: -22.6, z: -6.3, facing: 45 };

/**
 * The secret shelf's pull book (#719): the second shelf up — inside her
 * reach, like every book she is meant to take hold of — and centred on it,
 * where {@link LIBRARY_SECRET_STAND} already faces.
 */
export const LIBRARY_SECRET_BOOK: { readonly shelf: number; readonly along: number } = { shelf: 1, along: 0 };

// Typed spots, so they are held to the den's one owner as the module loads:
// a stand or the nest moved outside the walls is a build failure, not a
// child standing in the reading room's wall.
for (const spot of [LIBRARY_DEN_DOORWAY_STAND, LIBRARY_DRAGON_STAND, { what: "the dragon's nest", ...LIBRARY_DRAGON_NEST }]) {
  if (!libraryDenContains(spot.x, spot.z)) throw new Error(`library layout: ${spot.what} at (${spot.x}, ${spot.z}) is not inside the secret den (libraryDenContains)`);
}

// ===========================================================================
// The library cat (#719) — asleep on a pile of books by the desk
// ===========================================================================

/**
 * **The library cat's pile of books** (#719): beside the desk, in the desk
 * lamp's pool of light, on the camera's near side of the stacks and turned to
 * face it — 1.7 m clear of the desk's east end and 3.1 m from the entrance
 * hall's aisle, so nobody walking the room has to step round her. The pile
 * and the cat asleep on it are one group (`LibraryCat.ts`).
 */
export const LIBRARY_CAT_PILE: LocalPoint & { readonly facing: number } = { x: 9.6, z: 7.2, facing: 45 };

/**
 * Where she stands to pet the cat (#719): 1.6 m in front of the pile, looking
 * at it — re-measured against the pile's true size: 1.4 m (the first design's)
 * put the pile's near corner inside this spot's keep-out.
 */
export const LIBRARY_CAT_STAND: StandSpot = { what: 'beside the library cat', x: 9.6, z: 8.8, facing: 180 };

/**
 * **The readable books' slots** (#718): each names the case it stands in,
 * which shelf (0 the bottom) and how far along the shelf from the case's
 * middle (metres, along the case's right-hand side as you face it), and where
 * she stands to take it down. Books #718 fills them; this PR only keeps their
 * stand spots clear and leaves the gap on the shelf.
 *
 * **Slot `i` holds `BOOKS[i]`**: the picture books' twelve first, in
 * `books.ts`'s order, then the big readers' shelf, one slot per chapter book in
 * `chapterBooks/index.ts`'s shelf order. Each slot names the kind of book it is
 * for ({@link ReadableSlot.kind}), so a check can hold every book to a slot of
 * its own kind, whichever list grows.
 *
 * **Only the two bottom shelves**: the drawn shelf's third board stands above
 * `KID_REACH_HEIGHT` (#715's contract: "only rows 1-2 are under it"), and a
 * readable book a child cannot reach is a gap she can see and never fill.
 * `furnish.ts` measures each slot's shelf off the model and throws if one is
 * out of reach, so a taller glb cannot move a book out of her hand either.
 */
export interface ReadableSlot {
  readonly index: number;
  /** The kind of book this slot is for: a picture book's, or the big readers' shelf's chapter book. */
  readonly kind: BookKind;
  readonly bookcase: string;
  readonly shelf: number;
  readonly along: number;
  readonly stand: StandSpot;
}

function slotStand(bookcase: string, along: number, index: number, kind: BookKind, ofKind: number): StandSpot {
  const spec = LIBRARY_BOOKCASES.find((candidate) => candidate.id === bookcase);
  if (!spec) throw new Error(`library layout: readable slot ${index} names no bookcase '${bookcase}'`);
  const yaw = (spec.facing * Math.PI) / 180;
  // Out from the front face along its facing, then `along` to her right as
  // she faces the case (the case's own left, looking out of it).
  const outX = Math.sin(yaw);
  const outZ = Math.cos(yaw);
  const rightX = -outZ;
  const rightZ = outX;
  const out = bookcaseFrontOut(spec) + LIBRARY_CASE_STAND_OUT;
  return {
    what: kind === 'picture' ? `readable book ${index + 1}'s stand (${bookcase})` : `big reader ${ofKind + 1}'s stand (${bookcase})`,
    x: spec.at.x + outX * out - rightX * along,
    z: spec.at.z + outZ * out - rightZ * along,
    facing: (spec.facing + 180) % 360,
  };
}

/** The picture books' twelve, spread round the room, in `books.ts`'s order. */
const PICTURE_SHELF: readonly (readonly [string, number, number])[] = [
  ['north-2', 1, 0.6],
  ['north-3', 0, -0.8],
  ['north-6', 1, 0.6],
  ['north-8', 0, -0.6],
  ['west-1', 1, 0.5],
  ['west-3', 0, -0.5],
  ['west-5', 1, 0.6],
  ['stack-3-1', 0, 0.6],
  ['stack-3-3', 1, -0.6],
  ['stack-3-4', 0, 0.4],
  ['stack-2-2', 1, 0.5],
  ['stack-1-5', 0, -0.5],
];

/**
 * **The big readers' shelf** (track D of #714): the chapter books, in
 * `chapterBooks/index.ts`'s shelf order, together on one tall case —
 * `west-4`, the west wall's south-middle case, at the end of the entrance
 * hall's aisle and under `sconce-west-2`'s pool of light. Chosen because it is
 * the quiet end of the room: nothing else she can press stands near it, no
 * child's walk (Steps 7–8: the cushions, Juno's, Lark's and Fenn's routes)
 * passes it, and it is four metres south of the secret shelf (`west-2`) and of
 * the gap the den's doorway is cut through (Step 11), with `west-3` between.
 *
 * Read left to right as she faces the case, zig-zagging between the two shelves
 * she can reach (1, then 0) so each book has its own `along`, 0.6 m from the
 * next, and therefore its own stand spot.
 */
const BIG_READERS_SHELF: readonly (readonly [string, number, number])[] = [
  ['west-4', 1, -1.5],
  ['west-4', 0, -0.9],
  ['west-4', 1, -0.3],
  ['west-4', 0, 0.3],
  ['west-4', 1, 0.9],
  ['west-4', 0, 1.5],
];

export const LIBRARY_READABLE_SLOTS: readonly ReadableSlot[] = [
  ...PICTURE_SHELF.map(([bookcase, shelf, along], ofKind) => ({ kind: 'picture' as const, bookcase, shelf, along, ofKind })),
  ...BIG_READERS_SHELF.map(([bookcase, shelf, along], ofKind) => ({ kind: 'chapter' as const, bookcase, shelf, along, ofKind })),
].map(({ kind, bookcase, shelf, along, ofKind }, index) => ({
  index,
  kind,
  bookcase,
  shelf,
  along,
  stand: slotStand(bookcase, along, index, kind, ofKind),
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
 * Where she stands to sit in a chair: this far out along its facing from its
 * middle — a metre clear of the seat's front edge, so the stand spot's keep-out
 * never reaches the chair itself.
 */
export const LIBRARY_SEAT_FRONT = 1.5;

/**
 * **Every spot a child must be able to stand on, room-local** — the arrival,
 * the doorway, the desk's front, the librarian's spot, the rug, every seat's
 * front, every story cushion's seat, the secret shelf's stand, the secret
 * den's two (tagged `den`), every readable book's stand (the picture books'
 * twelve and the big readers' shelf, {@link LIBRARY_READABLE_SLOTS}), and
 * every aisle node. `props.ts`'s `libraryKeepOuts` turns these into keep-out
 * discs and refuses any collider inside one; `check:library` floods the floor
 * from the arrival and asserts every one is reached — and, while the secret
 * shelf is shut, that every `den` one is not: the den is the one pocket the
 * room is meant to have.
 */
export function libraryStandSpots(): StandSpot[] {
  const spots: StandSpot[] = [
    LIBRARY_ARRIVAL,
    { what: 'the doorway', x: LIBRARY_DOOR_X, z: LIBRARY_INNER_Z - 0.4, facing: 0 },
    LIBRARY_DESK_STAND,
    LIBRARY_LIBRARIAN_SPOT,
    { what: 'the story rug', x: LIBRARY_STORY_RUG.x, z: LIBRARY_STORY_RUG.z, facing: 180 },
    LIBRARY_SECRET_STAND,
    LIBRARY_DEN_DOORWAY_STAND,
    LIBRARY_DRAGON_STAND,
    LIBRARY_CAT_STAND,
  ];
  for (const piece of LIBRARY_FURNITURE) {
    if (piece.kind !== 'armchair' && piece.kind !== 'storyChair') continue;
    const yaw = (piece.facing * Math.PI) / 180;
    spots.push({
      what: `${piece.id}'s front`,
      x: piece.at.x + Math.sin(yaw) * LIBRARY_SEAT_FRONT,
      z: piece.at.z + Math.cos(yaw) * LIBRARY_SEAT_FRONT,
      facing: (piece.facing + 180) % 360,
    });
  }
  // Every story cushion's own middle (#718): **the seat is the stand**. She
  // walks onto the soft cushion and sits where she stands, so nothing has to
  // step her back off it; and a keep-out on each is what stops a collider
  // landing on a seat she, or one of the library's children, is invited to.
  for (const piece of LIBRARY_FURNITURE) {
    if (piece.kind !== 'cushion') continue;
    spots.push({ what: `${piece.id}'s seat`, x: piece.at.x, z: piece.at.z, facing: libraryFacingStoryChair(piece.at) });
  }
  for (const slot of LIBRARY_READABLE_SLOTS) spots.push(slot.stand);
  for (const aisle of LIBRARY_AISLES) {
    for (const point of aisle.points) spots.push({ what: `aisle '${aisle.id}' node (${point.x}, ${point.z})`, x: point.x, z: point.z, facing: 0 });
  }
  return spots;
}
