/**
 * **`check:library` — the Library is solid, walkable, lit, and nobody can get
 * stuck in it** (#716, part 2 of epic #714).
 *
 * ```
 * pnpm run check:library
 * LIBRARY_CHECK_REMOVE='stack-2-3' pnpm run check:library    # take a room solid out: must go red
 * LIBRARY_CHECK_OPEN_SHELL=1 pnpm run check:library          # open one of the cella's ring walls (1..8): must go red
 * LIBRARY_CHECK_OPEN_CORNERS=1 pnpm run check:library        # take the corner squaring out: must go red
 * LIBRARY_CHECK_OPEN_EDGE=1 pnpm run check:library           # open one of the plinth's edges (1 east, 2 back, 3 west): must go red
 * LIBRARY_CHECK_DARK=1 pnpm run check:library                # the room's fill and key turned off: must go red
 * LIBRARY_CHECK_MUTATE=faces-upside-down pnpm run check:library  # the creatures' faces flipped: must go red
 * LIBRARY_CHECK_MUTATE=shift-books pnpm run check:library   # expect slot i to hold BOOKS[i+1]: must go red, naming the books
 * LIBRARY_CHECK_REMOVE='bookcase north-2' pnpm run check:library  # a readable book's case not solid: REACHABILITY must go red
 * LIBRARY_CHECK_MUTATE=block-walk pnpm run check:library      # a wall across the real child's way in: must go red
 * LIBRARY_CHECK_MUTATE=block-route pnpm run check:library     # a disc on Lark's way to the rug: KIDS must go red naming the leg
 * LIBRARY_CHECK_REMOVE='den wall (west)' pnpm run check:library  # a wall of the secret den out: DEN WALLS must go red
 * LIBRARY_CHECK_REMOVE='bookcase west-2' pnpm run check:library  # the shut secret shelf out: the den is reachable, must go red
 * LIBRARY_CHECK_MUTATE=no-lintel pnpm run check:library       # the lintel over the den's doorway out: LINTEL must go red
 * LIBRARY_CHECK_REMOVE='the owl' pnpm run check:library       # the owl's solid out: OWL must go red (her middle is reachable)
 * LIBRARY_CHECK_MUTATE=card-twice pnpm run check:library      # a second card given through the non-idempotent door: CARD must go red
 * LIBRARY_CHECK_MUTATE=fixed-hysteresis pnpm run check:library  # the selection's band a fixed 0.6 m (before #734): SHELF WALK's arrivals must go red
 * LIBRARY_CHECK_MUTATE=no-hysteresis pnpm run check:library  # no band at all: SHELF WALK's sway midway must go red (flicker)
 * LIBRARY_CHECK_MUTATE=tap-loses pnpm run check:library      # a tap dropped while proximity holds anything else (before #734): SHELF WALK's taps must go red
 * ```
 *
 * `LIBRARY_CHECK_MUTATE` is the one allow-list of this check's own mutations
 * (see {@link MUTATIONS}); an unknown value throws, and a known one no clause
 * in this build arms fails the run rather than passing it.
 *
 * Built on the real `World` (`park-harness.mts`), so every number is measured
 * off the colliders, surfaces and lights the game registers, never off a
 * description of them — `check-reptile-house.mts` is the shape this copies.
 * In order, **with a control on every instrument before it is trusted**
 * (CLAUDE.md: two agents got clean, decisive, entirely wrong answers from flood
 * fills that were measuring the wrong thing):
 *
 *  1. CONTROL — the fill instrument sees a sealed pocket (a pen of four walls
 *     in an empty room of its own) and floods an empty room; built with both
 *     shells, the room's and the secret den's (#719), and nothing in the den's
 *     doorway, it walks into the den — so the den is in its domain, and a den
 *     spot it does not reach later is one it looked for.
 *  2. CONTROL on the real room — a disc dropped on the desk's front stand makes
 *     the fill call that keep-out unreachable; taken back out, reachable again.
 *  3. REACHABILITY — from the arrival, at her radius: every keep-out
 *     (`libraryKeepOuts`), the exit band, and no clear cell on the plate left
 *     unreached (a pocket she could be stuck in). Every stack's and the desk's
 *     middle is NOT reached (they are solid). With the secret shelf shut, every
 *     `den` keep-out is NOT reached, and the one pocket is the den
 *     (`libraryDenContains`): any other is a child stuck.
 *  4. AISLES — a player disc swept along every `LIBRARY_AISLES` polyline.
 *  5. MARCHED — a player-sized body marched at every bookcase, the desk and
 *     every chair from sixteen bearings, at 5 cm and at the sprint stride, and
 *     at the room's four walls: the body's edge never gets into a drawn box
 *     past the corner rounding its capsules leave. Every box is the **model's**
 *     drawn footprint (`libraryAssets.ts`), never the collider's own. Then
 *     DEN WALLS — bodies in the den marched at its three walls never leave it
 *     but by its doorway — and LINTEL — a flier over the shut secret shelf
 *     stops at the lintel, at every height, and with the shelf's colliders out
 *     a walker passes under it.
 *  6. LANDING — her feet, asked the way `Player` asks them
 *     (`world/standing.ts`), find every solid's top under them everywhere
 *     across its drawn footprint (the chairs, the desk, the bins, the
 *     cushions, the lamps); the control: just outside the footprint, the
 *     floor.
 *  7. FACADE — the building marched at from forty-eight bearings at both
 *     strides: nothing gets inside the cella but through the doorway, nothing
 *     into a column, the deepest reading reported per outside corner; marches
 *     square at the plinth's sides and back stop at its drawn edge; marches
 *     sideways in the recess stay in the doorway; and a sprinter through the
 *     door stops on the door leaves, inside the band.
 *  8. STEPS — up the steps across the whole front, between and beside the
 *     columns: wherever she stands over the drawn stone, her feet are on it.
 *  9. DOORS — both ways, on the real `Library`: the door link stands her on the
 *     doormat; a sprint stride across the front band enters at the arrival,
 *     clear of the exit band; a stride across the exit band leaves onto clear
 *     ground on the doormat, clear of the front band; `/library` enters from
 *     inside too.
 * 10. FADE — standing behind a stack, the stack fades; standing in the open
 *     central aisle (the control), nothing does.
 * 11. LIGHT — no light is black or off, the pools are within the budget, the
 *     floor's own small lift is asserted to be under `PALETTE.ink` (so it
 *     cannot pass the room by itself), and the darkest patch of floor — the
 *     room's lights plus that lift — renders brighter than ink, the secret
 *     den's floor too; with a control — the same floor under a near-dark rig
 *     goes below it.
 * 12. READABLE — the readable books (#718), one per `BOOKS` entry: their
 *     slots' shelves within her reach; slot `i` holds `BOOKS[i]` and is of
 *     that book's kind (the picture books' twelve, then the big readers'
 *     shelf), counted from `BOOKS`, never typed; one `library.book.<id>` mesh
 *     each, in its own slot (by index), wholly inside its case's drawn box, on
 *     its board, in its cover's paint; a Read zone each, inside only and never
 *     while she rides, stood at its slot's stand, whose chip opens its own
 *     book through the attached opener; and a stack's book fading with it.
 *     REACHABILITY also asserts every readable book is out of her walk.
 * 13. PAINTED FACES — the owl's, the dragon's and the cat's faces (#718, #719),
 *     on freshly built creatures: each head's UVs read against its own
 *     texture's flip, the canvas row falling as the head rises, and the eyes
 *     above the mouth (the owl's, above her beak).
 * 14. WITH A REAL CHILD — from here on a real `Player`, stepped the game's way
 *     and steered by the stick ({@link RealChild}): from the arrival, she walks
 *     into the room on the floor. Parts 4 and 5 add their clauses to it.
 * 15. OWL, CARD, RECOMMEND, SHUSH — the owl librarian (#718, plan Step 6), on
 *     the real child: her solid is a disc of her measured reach the fill does
 *     not get into and a body marched at her does not get into; coming in
 *     without a card she is invited over; quiet at the desk the owl blinks and
 *     never holds a blink; stood either side of her the head turns to face
 *     her, measured off the head's own axis. The card is hers on the press,
 *     once, through four lines and a wing flap; pressed again the owl names
 *     the first unread book of her one seeded order, which glows on its shelf
 *     until read and says "Read me!"; a sprint held gets a "Shhh!" with no
 *     penalty, a walk never does (the control), a jump does, and mid-script
 *     only her wing answers.
 * 16. SIT (#718, the story cushions) and KIDS (#718, the library's three
 *     children: their routes swept, their stroll inside and freeze outside,
 *     and the story-time rehearsal — summoned, sat, furniture to the player,
 *     dismissed).
 * 17. SHELF WALK (QA, PR #734) — the big readers' shelf, six books 0.6 m
 *     apart, walked the way QA walked it: one continuous session, a real
 *     `Selection` wired as `Game` wires it, E through the InputSystem's own
 *     key listener and `InteractRouter`. Every arrival on a stand opens that
 *     stand's book — walked north, walked back south, come from the aisle,
 *     and stood on link after link — a tap on a neighbour's book selects it
 *     and E opens it, and a sway midway between two stands never changes the
 *     selection (no flicker). Its three mutations put back each half of the
 *     old rule.
 *
 * **One seed, and why that is the whole of it.** The reading room stands at its
 * own origin, built from `layout.ts`'s tables and the kit's meshes, and nothing
 * about it depends on the park's seed — so one seed measures it completely.
 * The exterior *does* change with the seed (where the plot is, how the ground
 * falls under it, how far the building leans): this check measures it on the
 * canonical seed, and `test/procgen/invariants.ts`'s
 * `aChildWalksUpTheLibraryStepsAndIn` walks it on every seed in the pool.
 *
 * Coverage notes go to stderr, so a passing run says what it measured.
 */
import './headless-canvas.mjs';
import { Box3, Color, Group, HemisphereLight, Mesh, MeshToonMaterial, Raycaster, Vector3, type BufferAttribute, type Light, type Material, type Object3D, type Texture } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { Player } from '../src/entities/Player.ts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import { saveFlags } from '../src/state/flags.ts';
import { CollisionWorld, JUMP_CLEARANCE_GRACE } from '../src/world/Collision.ts';
import { WalkSurfaces } from '../src/world/building/surfaces.ts';
import { standingAt, walkableAt } from './lib/standable.mts';
import { MAX_FRAME_DELTA, PLAYER_LONGEST_STEP, PLAYER_RADIUS, BUILDING_STEP_UP, PLAYER_DECELERATION, PLAYER_MAX_SPEED, NPC_RADIUS } from '../src/core/constants.ts';
import { PALETTE } from '../src/core/palette.ts';
import { KID_REACH_HEIGHT } from '../src/art/models/kid.ts';
import { BLINK_DURATION } from '../src/art/style/faceLife.ts';
import { gameStore } from '../src/state/index.ts';
import { BOOKS, CHAPTER_BOOKS, PICTURE_BOOKS, storyTimeMayRead, type LibraryBook } from '../src/world/library/books.ts';
import { isBookRead, markBookRead } from '../src/world/library/readBooks.ts';
import { RECOMMENDATION_ORDER, recommendFor } from '../src/world/library/recommendation.ts';
import { LIBRARY_CARD, hasLibraryCard } from '../src/world/library/libraryCard.ts';
import {
  BREATH_DEPTH,
  HEAD_TURN_LIMIT,
  OWL_BUBBLE_OVER_HEAD,
  OWL_CRUISE_OVER_STACKS,
  OWL_FLIGHT_SECONDS,
  OWL_LOOK_RANGE,
  OWL_PERCH_BACK,
  OWL_WING_BEAT,
  OWL_ZONE_ID,
  OWL_HEADROOM,
  owlCruiseHeight,
  owlFlightPose,
  owlPerch,
  owlWingOpening,
  flightReach,
  perchReach,
  SHUSH_COOLDOWN_SECONDS,
  SHUSH_RUN_SECONDS,
  SHUSH_WING_X,
  type LibraryOwl,
} from '../src/world/library/LibraryOwl.ts';
import { GATHER_TIMEOUT, STORY_EVERY, STORY_FIRST_AFTER, STORY_LISTENER_SECRET_ID, STORY_SIT_SECONDS, StoryTime, type StoryPhase } from '../src/world/library/storyTime.ts';
import { Parade } from '../src/entities/parade/Parade.ts';
import { shopItem } from '../src/world/building/shops/catalogue.ts';
import { playerNavGrid } from '../src/world/playerLattice.ts';
import { visibleBounds, visiblePoints, visibleReachXZ } from '../src/art/style/measure.ts';
import { KID_HEIGHT } from '../src/art/models/kidHeight.ts';
import { PLAYER_SEPARATION, SEPARATION } from '../src/entities/npc/NpcSystem.ts';
import { GUEST_PACE } from '../src/entities/npc/residentLooks.ts';
import { KID_LEG_TIMEOUT, KID_ROUTE_ARRIVE, KID_SUMMON_PACE, libraryKidSeatArrive } from '../src/world/library/libraryKidDriver.ts';
import { LIBRARY_KID_SEED, LIBRARY_KID_SEED_STRIDE } from '../src/world/library/LibraryKids.ts';
import { bandCrossed } from '../src/world/tapSpacing.ts';
import { SPACE_GARDEN, SPACE_LIBRARY, spaceAt } from '../src/world/spaces.ts';
import { terrainHeight } from '../src/world/terrain.ts';
import { END_HALF, LibraryProps, libraryKeepOuts, segmentDistance, type BoxFootprint, type LibrarySolid } from '../src/world/library/props.ts';
import { bookcaseCentre, READABLE_LEAN, READABLE_PROUD } from '../src/world/library/furnish.ts';
import { SHELF_BOOK_ZONE_PREFIX, SHELF_BOOKS, shelfBookZoneId } from '../src/world/library/shelfBooks.ts';
import { Selection } from '../src/world/Selection.ts';
import { InteractRouter } from '../src/world/InteractRouter.ts';
import { buildLibraryDenShell, buildReadingRoomShell } from '../src/world/library/shell.ts';
import { floorIrradiance, LIBRARY_LIGHT_BUDGET } from '../src/world/library/lighting.ts';
import { libraryArmchairSize, libraryBookcaseSize, libraryCushionSize, libraryDeskSize } from '../src/art/models/libraryAssets.ts';
import {
  createLibraryBookPile,
  createLibraryCat,
  createLibraryDragon,
  createLibraryDragonNest,
  createLibraryOwl,
} from '../src/art/models/libraryCreatures.ts';
import {
  catFaceTextures,
  dragonFaceTextures,
  LIBRARY_FACE_ROWS,
  LIBRARY_FACED_HEADS,
  libraryFaceCanvasSize,
  owlFaceTextures,
  type LibraryFacedHead,
} from '../src/art/models/libraryFaces.ts';
import {
  bookcaseFrontOut,
  libraryDenContains,
  LIBRARY_AISLES,
  LIBRARY_ARRIVAL,
  LIBRARY_BOOKCASES,
  LIBRARY_DEN_DOOR_HALF,
  LIBRARY_DEN_INNER,
  LIBRARY_DESK_STAND,
  LIBRARY_DOOR_HALF,
  LIBRARY_DOOR_X,
  LIBRARY_FLOOR_Y,
  LIBRARY_FURNITURE,
  LIBRARY_HALF_X,
  LIBRARY_HALF_Z,
  LIBRARY_INNER_X,
  LIBRARY_INNER_Z,
  LIBRARY_KID_PLANS,
  LIBRARY_LIBRARIAN_SPOT,
  LIBRARY_ORIGIN_X,
  LIBRARY_ORIGIN_Z,
  LIBRARY_PLAYER_SEATS,
  LIBRARY_READABLE_SLOTS,
  LIBRARY_SECRET_BOOKCASE,
  LIBRARY_STORY_CHAIR,
  LIBRARY_WALL_HALF,
  libraryCushion,
  libraryFacingStoryChair,
  aisleNode,
  libraryKidAisle,
  libraryKidCircuit,
  libraryKidRugRoute,
  type FurnitureSpec,
  type LibraryKidPlan,
  type LocalPoint,
} from '../src/world/library/layout.ts';
import type { FrameContext } from '../src/core/types.ts';
import { LIBRARY_CHIPS, LIBRARY_LINES } from '../src/world/library/libraryLines.ts';
import { PRIMARY_ACTION, standRadiusOf, type InteractZone, type ZoneAction } from '../src/world/interact.ts';
import { FLOOR_TOLERANCE, SEAT_TOLERANCE, seatedErrors } from './lib/seatedPose.mts';

const OX = LIBRARY_ORIGIN_X;
const OZ = LIBRARY_ORIGIN_Z;
const CELL = 0.25;
/**
 * The resolver's slack: how far a body may end past a face it was pushed back
 * to, from a sub-step's overshoot. 3 cm, the room's and the facade's both.
 */
const RESOLVER_SLACK = 0.03;
/** A capsule's square-off at a corner leaves `END_HALF · (√2 − 1)` of the drawn corner outside it. */
const CORNER_ALLOWANCE = END_HALF * (Math.SQRT2 - 1) + RESOLVER_SLACK;
/** Feet on the stone means on its top, to float noise: the sampler returns the plate's own height. */
const FEET_TOLERANCE = 1e-3;

let bad = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) bad += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${line}`);
};
const note = (line: string): void => {
  process.stderr.write(`  note: ${line}\n`);
};

/**
 * **`LIBRARY_CHECK_MUTATE` — the one allow-list of this check's own
 * mutations** (#714 parts 4 and 5 arm theirs here; no clause invents a second
 * switch). Each breaks the thing one clause measures, in the check only —
 * never a test branch in game code — so the run must go red.
 *
 * Two guards, so a red proof cannot pass by accident: an unknown value throws
 * before anything is built, and a known value that **no clause in this build
 * arms** fails the verdict ("asserts nothing"), which is what a run would
 * otherwise quietly report on a branch where that clause has not landed yet.
 * A clause arms its mutation by asking {@link mutating}.
 *
 * `block-walk` is the real child's own (the WITH A REAL CHILD harness clause,
 * added with the harness); the rest are the plan's (Steps 3-14).
 */
const MUTATIONS = [
  '',
  'faces-upside-down',
  'shift-books',
  'card-twice',
  'block-route',
  'block-cushion',
  'no-story',
  'no-lintel',
  'seal-den',
  'open-leaf-hollow',
  'resident-in-den',
  'block-walk',
  'fixed-hysteresis',
  'no-hysteresis',
  'tap-loses',
] as const;
type Mutation = Exclude<(typeof MUTATIONS)[number], ''>;
const MUTATE = process.env['LIBRARY_CHECK_MUTATE'] ?? '';
if (!(MUTATIONS as readonly string[]).includes(MUTATE)) {
  throw new Error(`LIBRARY_CHECK_MUTATE=${MUTATE} is not one of this check's mutations: ${MUTATIONS.filter((m) => m !== '').join(', ')}`);
}
let mutationArmed = false;
/** Is `name` the mutation this run was asked for? Asking is what arms it — see {@link MUTATIONS}. */
function mutating(name: Mutation): boolean {
  if (MUTATE !== name) return false;
  mutationArmed = true;
  return true;
}

/** Least-squares slope of one series against another (`check-reptile-house.mts`'s, for the painted faces). */
function slope(xs: readonly number[], ys: readonly number[]): number {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i += 1) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return den > 0 ? num / den : Number.NaN;
}

// ---------------------------------------------------------------------------
// The instrument: a flood fill over the plate at the player's radius.
// ---------------------------------------------------------------------------

interface Fill {
  readonly reached: Set<string>;
  readonly clear: Set<string>;
}

const key = (cx: number, cz: number): string => `${cx},${cz}`;
const cellOf = (x: number, z: number): [number, number] => [Math.round((x - OX) / CELL), Math.round((z - OZ) / CELL)];

/** On the walkable plate: the floor inside the walls, plus the doorway's threshold. */
function onPlate(localX: number, localZ: number): boolean {
  if (Math.abs(localX) <= LIBRARY_INNER_X && Math.abs(localZ) <= LIBRARY_INNER_Z) return true;
  return Math.abs(localX - LIBRARY_DOOR_X) <= LIBRARY_DOOR_HALF && localZ > LIBRARY_INNER_Z && localZ <= LIBRARY_HALF_Z + 0.55;
}

/**
 * **The fill's floor: the plate, and the secret den** (#719) — asked of
 * `libraryDenContains`, the one owner of where the den is, never a rectangle
 * of this check's own. The den is in the domain whether its doorway is open or
 * shut, so a den spot the fill does not reach is one it looked for and could
 * not get to; CONTROL 1 proves it does get there when the doorway is empty.
 */
function onFloor(localX: number, localZ: number): boolean {
  return onPlate(localX, localZ) || libraryDenContains(localX, localZ);
}

/** A fill cell's room-local centre. */
function cellCentre(k: string): LocalPoint {
  const [cx, cz] = k.split(',').map(Number) as [number, number];
  return { x: cx * CELL, z: cz * CELL };
}

function fill(collision: CollisionWorld, fromX: number, fromZ: number, radius = PLAYER_RADIUS): Fill {
  const clear = new Set<string>();
  // West as far as the den's west wall and a metre past it; the rest the plate's own reach.
  const fromCX = Math.floor((LIBRARY_DEN_INNER.west - 1) / CELL);
  const toCX = Math.ceil((LIBRARY_HALF_X + 1) / CELL);
  const reachZ = Math.ceil((LIBRARY_HALF_Z + 1) / CELL);
  for (let cx = fromCX; cx <= toCX; cx += 1) {
    for (let cz = -reachZ; cz <= reachZ; cz += 1) {
      const x = OX + cx * CELL;
      const z = OZ + cz * CELL;
      if (!onFloor(x - OX, z - OZ)) continue;
      // Somewhere she can stand: clear of every solid she could not step up
      // onto from the floor. A cushion on the rug is a step, not a wall.
      if (walkableAt(collision, x, z, radius, 0)) clear.add(key(cx, cz));
    }
  }
  const [sx, sz] = cellOf(fromX, fromZ);
  const reached = new Set<string>();
  const queue: [number, number][] = [[sx, sz]];
  if (clear.has(key(sx, sz))) reached.add(key(sx, sz));
  while (queue.length > 0) {
    const [cx, cz] = queue.pop()!;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const k = key(cx + dx, cz + dz);
      if (reached.has(k) || !clear.has(k)) continue;
      reached.add(k);
      queue.push([cx + dx, cz + dz]);
    }
  }
  return { reached, clear };
}

/** Reached at the cell nearest (x, z), or a neighbour of it — a spot sits between cell centres. */
function reachedAt(result: Fill, x: number, z: number): boolean {
  const [cx, cz] = cellOf(x, z);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) if (result.reached.has(key(cx + dx, cz + dz))) return true;
  }
  return false;
}

/** March a body from `from` towards `to` in `step`s; returns where it ended. */
function march(collision: CollisionWorld, from: Vector3, to: Vector3, step: number, travel = 12): Vector3 {
  const p = from.clone();
  const dir = to.clone().sub(from);
  dir.y = 0;
  dir.normalize();
  for (let t = 0; t < travel; t += step) collision.resolveMovement(p, dir.x * step, dir.z * step, PLAYER_RADIUS, 0, MAX_FRAME_DELTA);
  return p;
}

/** A drawn box, room-local. */
interface DrawnBox extends BoxFootprint {
  readonly what: string;
  /** Its drawn top above the room's floor — where her feet come to rest on it. */
  readonly top: number;
}

/** How far outside a drawn box (x, z) stands — negative inside. */
function outsideBox(box: BoxFootprint, x: number, z: number): number {
  const yaw = (box.facing * Math.PI) / 180;
  const dx = x - box.x;
  const dz = z - box.z;
  const along = Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw)) - box.halfLength;
  const out = Math.abs(dx * Math.sin(yaw) + dz * Math.cos(yaw)) - box.halfDepth;
  const outside = Math.hypot(Math.max(along, 0), Math.max(out, 0));
  return outside > 0 ? outside : Math.max(along, out);
}

/** A model's own-frame point carried to a piece's spot and turned with it (`furnish.ts`'s frame). */
function turned(piece: FurnitureSpec, x: number, z: number): LocalPoint {
  const yaw = (piece.facing * Math.PI) / 180;
  return { x: piece.at.x + x * Math.cos(yaw) + z * Math.sin(yaw), z: piece.at.z - x * Math.sin(yaw) + z * Math.cos(yaw) };
}

/**
 * Every drawn box the room stands, **from the models** — each bookcase's
 * measured size at its spot, the desk's and every chair's measured footprint
 * at its drawn middle — never from the colliders, so a collider that has
 * slipped off its mesh cannot measure itself.
 */
function drawnBoxes(): DrawnBox[] {
  const boxes: DrawnBox[] = [];
  for (const spec of LIBRARY_BOOKCASES) {
    const size = libraryBookcaseSize(spec.kind);
    const centre = bookcaseCentre(spec);
    boxes.push({ what: `bookcase ${spec.id}`, x: centre.x, z: centre.z, facing: spec.facing, halfLength: size.length / 2, halfDepth: size.depth / 2, top: size.height });
  }
  const desk = libraryDeskSize();
  const chair = libraryArmchairSize();
  for (const piece of LIBRARY_FURNITURE) {
    if (piece.kind === 'desk') {
      const centre = turned(piece, desk.centreX, desk.centreZ);
      boxes.push({ what: 'the desk', x: centre.x, z: centre.z, facing: piece.facing, halfLength: desk.width / 2, halfDepth: desk.depth / 2, top: desk.top });
    } else if (piece.kind === 'armchair' || piece.kind === 'storyChair') {
      const centre = turned(piece, chair.centreX, chair.centreZ);
      boxes.push({ what: piece.id, x: centre.x, z: centre.z, facing: piece.facing, halfLength: chair.width / 2, halfDepth: chair.depth / 2, top: chair.seat });
    }
  }
  return boxes;
}

// ---------------------------------------------------------------------------
// 1. CONTROLS — the instrument, before the building.
// ---------------------------------------------------------------------------
console.log('CONTROL — the fill instrument:');
{
  // Both shells, the room's and the secret den's (#719), and no furniture —
  // so nothing in the den's doorway: no secret shelf to shut it.
  const control = new CollisionWorld();
  const controlSurfaces = new WalkSurfaces();
  const shell = buildReadingRoomShell(new Group(), control, controlSurfaces);
  buildLibraryDenShell(new Group(), new LibraryProps(control, OX, OZ), controlSurfaces, shell.fabric);
  // A pen: four walls round an empty square, the one kind of sealed pocket
  // there can be now a rectangle is a filled box.
  for (const [ax, az, bx, bz] of [
    [-2.5, -2.5, 2.5, -2.5],
    [2.5, -2.5, 2.5, 2.5],
    [2.5, 2.5, -2.5, 2.5],
    [-2.5, 2.5, -2.5, -2.5],
  ] as const) {
    control.addWall(OX - 6 + ax, OZ + az, OX - 6 + bx, OZ + bz, 0.3);
  }
  const seen = fill(control, OX + LIBRARY_ARRIVAL.x, OZ + LIBRARY_ARRIVAL.z);
  const pockets = [...seen.clear].filter((k) => !seen.reached.has(k));
  say(seen.reached.size > 10000, `the fill floods the empty room: ${seen.reached.size} cells reached`);
  say(pockets.length > 30 && !reachedAt(seen, OX - 6, OZ), `the fill sees a sealed pocket: ${pockets.length} clear cells inside a pen of four walls are unreachable`);
  say(!seen.clear.has(key(...cellOf(OX, OZ + LIBRARY_HALF_Z + 4))), 'nothing off the plate counts as floor');
  // The den is in the fill's domain: with its doorway empty, the fill walks in.
  const denSpots = libraryKeepOuts().filter((spot) => spot.den);
  const denSpotsReached = denSpots.filter((spot) => reachedAt(seen, OX + spot.x, OZ + spot.z)).length;
  const denCells = [...seen.reached].filter((k) => libraryDenContains(cellCentre(k).x, cellCentre(k).z)).length;
  say(
    denSpots.length > 0 && denSpotsReached === denSpots.length && denCells > 50,
    `with nothing in the den's doorway the fill walks into the den: ${denSpotsReached} of ${denSpots.length} den spots and ${denCells} den cells reached ` +
      '— so the den is in its domain, and a den spot it does not reach later is one it looked for',
  );
}

// ---------------------------------------------------------------------------
// The real building, in the real park.
// ---------------------------------------------------------------------------
// Built the way a `/library` link builds it: with no cat bus at the kerb. A
// deep link boots with `arriveByBus: false` (`main.ts`), and a returning save
// has already arrived; headless, the arrival's default is the save's flag
// (`arrivalIsDue`), so it is set first. Without it, `world.attachPlayer` seats
// WITH A REAL CHILD's player in the bus, riding, and the Library (rightly)
// refuses to let a riding child through its door. Nothing before that section
// reads the arrival: the probe above is never attached to the world.
saveFlags.markArrived();
const { world, scene, camera } = quietly(() => buildHeadlessPark());
const library = world.library;
const collision = world.collision;
const surfaces = world.building.surfaces;
/**
 * **A body standing on the garden's ground at `(x, z)`** — the walk sampler's
 * surface there (the plinth, the step, the terrain). Every solid has its real
 * top now, measured against the body's feet, so a march out here starts on
 * the ground and follows it (`p.y = surfaces.sample(...)` after each step)
 * rather than floating at y = 0 metres above the sphere and clearing the
 * building it was sent at.
 */
const onGround = (x: number, z: number): Vector3 => new Vector3(x, surfaces.sample(x, z, terrainHeight(x, z) + 3), z);
const remove = process.env['LIBRARY_CHECK_REMOVE'];
/** The solids `LIBRARY_CHECK_REMOVE` took out: a clause that takes a solid out and puts it back leaves these out. */
const removedOnPurpose = new Set<LibrarySolid>();
/**
 * Takes a registered solid out of the collision world, whatever its shape: a
 * disc (by id), a capsule, or a box — one filled box per case, desk and chair
 * since PR #722 (`props.box`), so `removeWall` on a box's handle would take
 * nothing out and a red proof would come out green.
 */
const takeOut = (solid: LibrarySolid): void => {
  if (typeof solid.handle === 'number') collision.removeCircle(solid.handle);
  else if ('halfX' in solid.handle) collision.removeBox(solid.handle);
  else collision.removeWall(solid.handle);
};
/** Puts a solid {@link takeOut} took out back: the same object (`restoreWall` / `restoreBox`). A disc cannot come back — `CollisionWorld` restores only walls and boxes. */
const putBack = (solid: LibrarySolid): void => {
  if (typeof solid.handle === 'number') throw new Error(`${solid.what} is a disc, and CollisionWorld restores only walls and boxes`);
  if ('halfX' in solid.handle) collision.restoreBox(solid.handle);
  else collision.restoreWall(solid.handle);
};
if (remove) {
  const victims = library.solids.filter((solid) => solid.what.includes(remove));
  if (victims.length === 0) throw new Error(`LIBRARY_CHECK_REMOVE=${remove} names no solid`);
  for (const victim of victims) {
    takeOut(victim);
    removedOnPurpose.add(victim);
  }
  note(`REMOVED ${victims.map((v) => v.what).join(', ')} on purpose — this run must go red`);
}
const openShell = process.env['LIBRARY_CHECK_OPEN_SHELL'];
if (openShell) {
  const index = Number(openShell);
  const wall = library.shellSolids.walls[index - 1];
  if (!Number.isInteger(index) || !wall) throw new Error(`LIBRARY_CHECK_OPEN_SHELL=${openShell}: walls are 1..${library.shellSolids.walls.length}`);
  collision.removeWall(wall);
  note(`OPENED the cella's ring wall ${index} (back, west, east, front west, front east, west jamb, east jamb, recess back) on purpose — this run must go red`);
}
if (process.env['LIBRARY_CHECK_OPEN_CORNERS']) {
  for (const corner of library.shellSolids.corners) collision.removeWall(corner);
  note(`REMOVED the ${library.shellSolids.corners.length} corner-squaring capsules on purpose — this run must go red`);
}
const openEdge = process.env['LIBRARY_CHECK_OPEN_EDGE'];
if (openEdge) {
  const index = Number(openEdge);
  const edge = library.shellSolids.edges[index - 1];
  if (!Number.isInteger(index) || !edge) throw new Error(`LIBRARY_CHECK_OPEN_EDGE=${openEdge}: edges are 1..${library.shellSolids.edges.length}`);
  collision.removeWall(edge);
  note(`OPENED the plinth's edge piece ${index} of ${library.shellSolids.edges.length} (each side's runs, tread by tread, then the back; each in pieces of up to 2 m) on purpose — this run must go red`);
}
const bounds = collision.playBounds;
collision.setPlayBounds({ radius: 1e6, distanceToEdge: () => 1e6 } as never);

console.log(`\nCONTROL on the real room — a disc on ${LIBRARY_DESK_STAND.what}:`);
{
  const blocker = collision.addCircle(OX + LIBRARY_DESK_STAND.x, OZ + LIBRARY_DESK_STAND.z, 1.2);
  const blocked = fill(collision, OX + LIBRARY_ARRIVAL.x, OZ + LIBRARY_ARRIVAL.z);
  say(!reachedAt(blocked, OX + LIBRARY_DESK_STAND.x, OZ + LIBRARY_DESK_STAND.z), `with the disc down, the fill calls ${LIBRARY_DESK_STAND.what} unreachable (the instrument can say no)`);
  collision.removeCircle(blocker);
  const open = fill(collision, OX + LIBRARY_ARRIVAL.x, OZ + LIBRARY_ARRIVAL.z);
  say(reachedAt(open, OX + LIBRARY_DESK_STAND.x, OZ + LIBRARY_DESK_STAND.z), `taken back out, it is reachable again (and can say yes)`);
}

console.log(`\nREACHABILITY — ${library.solids.length} solids registered by the reading room and the den, the secret shelf shut:`);
{
  const seen = fill(collision, OX + LIBRARY_ARRIVAL.x, OZ + LIBRARY_ARRIVAL.z);
  say(seen.reached.size > 5000, `the fill leaves the arrival: ${seen.reached.size} cells reached of ${seen.clear.size} clear`);
  const keepOuts = libraryKeepOuts();
  const roomSpots = keepOuts.filter((spot) => !spot.den);
  const denSpots = keepOuts.filter((spot) => spot.den);
  let unreachable = 0;
  for (const spot of roomSpots) {
    if (!reachedAt(seen, OX + spot.x, OZ + spot.z)) {
      unreachable += 1;
      say(false, `${spot.what} at (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)}) is not reachable from the arrival`);
    }
  }
  say(unreachable === 0, `every keep-out in the reading room is reachable: ${roomSpots.length - unreachable} of ${roomSpots.length}`);
  // The den's (#719): the shut secret shelf seals its doorway, so the fill —
  // whose domain holds the den, as CONTROL 1 showed — must not get there.
  const leaked = denSpots.filter((spot) => reachedAt(seen, OX + spot.x, OZ + spot.z));
  for (const spot of leaked) say(false, `${spot.what} at (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)}) IS reachable with the secret shelf shut — the den's doorway is open`);
  say(denSpots.length > 0 && leaked.length === 0, `no keep-out in the secret den is reachable while the secret shelf is shut: ${denSpots.length - leaked.length} of ${denSpots.length} sealed off`);
  say(reachedAt(seen, OX + LIBRARY_DOOR_X, OZ + LIBRARY_HALF_Z), "the exit band's centre is reachable");
  // Every drawn box is solid. One taller than a step must not be reached at
  // all; one she steps up onto (a chair's seat) is reached — she stands on it —
  // so for that one the clause asks the floor-level question directly: a body
  // with her feet on the floor in its middle is pushed out.
  const floorProbe = new Vector3();
  let steppedOnto = 0;
  for (const box of drawnBoxes()) {
    if (box.halfDepth * 2 < 0.5) continue;
    if (box.top <= BUILDING_STEP_UP) {
      steppedOnto += 1;
      floorProbe.set(OX + box.x, 0, OZ + box.z);
      if (collision.deepestSolidOverlap(floorProbe, PLAYER_RADIUS) <= 0) say(false, `${box.what}'s middle does not push a body standing on the floor — it is not solid`);
    } else if (reachedAt(seen, OX + box.x, OZ + box.z)) {
      say(false, `${box.what}'s middle IS reachable — it is not solid`);
    }
  }
  note(`${steppedOnto} drawn box(es) within one ${BUILDING_STEP_UP} m step of the floor (their middles are stood on, so asked as solid at the floor instead)`);
  // Drawn implies solid: every readable book (#718) stands where she cannot
  // walk — inside its case's solid, never a mesh in the open a child strolls through.
  let walkable = 0;
  for (const placed of library.shelfBooks) {
    if (!reachedAt(seen, OX + placed.local.x, OZ + placed.local.z)) continue;
    walkable += 1;
    say(false, `readable book '${placed.book.id}' on ${placed.slot.bookcase}, at (${placed.local.x.toFixed(2)}, ${placed.local.z.toFixed(2)}), IS reachable — drawn, and not solid`);
  }
  say(
    library.shelfBooks.length === BOOKS.length && walkable === 0,
    `every readable book stands inside solid shelving, out of her walk: ${library.shelfBooks.length - walkable} of ${library.shelfBooks.length} (${BOOKS.length} books)`,
  );
  // The unreached clear cells must be the den's — the one pocket the room is
  // meant to have, while the shelf is shut — and nobody else's.
  const pockets = [...seen.clear].filter((k) => !seen.reached.has(k));
  const strays = pockets.filter((k) => !libraryDenContains(cellCentre(k).x, cellCentre(k).z));
  if (strays.length > 0) {
    const sample = strays.slice(0, 6).map((k) => `(${cellCentre(k).x.toFixed(2)}, ${cellCentre(k).z.toFixed(2)})`);
    say(false, `${strays.length} clear cell(s) outside the secret den are unreachable — a pocket a child could be stuck in: ${sample.join(' ')}…`);
  }
  const inDen = pockets.length - strays.length;
  say(
    strays.length === 0 && inDen > 50,
    `the one pocket is the secret den: ${pockets.length} clear cells are unreached, ${inDen} of them inside libraryDenContains (more than 50 wanted) and ${strays.length} anywhere else; ` +
      `the other ${seen.clear.size - pockets.length} clear cells are all reached`,
  );
  note(
    `${keepOuts.length} keep-outs: ${roomSpots.length} in the reading room (arrival, doorway, desk, rug, seats, secret shelf, ` +
      `${LIBRARY_READABLE_SLOTS.length} readable slots, every aisle node) and ${denSpots.length} in the secret den (${denSpots.map((spot) => spot.what).join(', ')})`,
  );
}

console.log('\nAISLES — a player disc swept along every aisle:');
{
  let stations = 0;
  let blocked = 0;
  for (const aisle of LIBRARY_AISLES) {
    for (let i = 0; i + 1 < aisle.points.length; i += 1) {
      const a = aisle.points[i]!;
      const b = aisle.points[i + 1]!;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      for (let s = 0; s <= length; s += CELL) {
        const t = length === 0 ? 0 : s / length;
        const x = OX + a.x + (b.x - a.x) * t;
        const z = OZ + a.z + (b.z - a.z) * t;
        stations += 1;
        if (!walkableAt(collision, x, z, PLAYER_RADIUS, 0)) {
          blocked += 1;
          if (blocked <= 5) say(false, `aisle '${aisle.id}' is blocked at (${(x - OX).toFixed(2)}, ${(z - OZ).toFixed(2)})`);
        }
      }
    }
  }
  say(blocked === 0, `${stations} stations swept on ${LIBRARY_AISLES.length} aisles, ${blocked} blocked`);
}

console.log('\nMARCHED at every case, the desk and every chair — 16 bearings, 5 cm and the sprint stride:');
{
  const boxes = drawnBoxes();
  let marches = 0;
  let skipped = 0;
  let worst = { what: '', over: 0 };
  for (const box of boxes) {
    let deepest = 0;
    for (let b = 0; b < 16; b += 1) {
      const angle = (b / 16) * Math.PI * 2;
      const reach = Math.hypot(box.halfLength, box.halfDepth) + 2.2;
      const start = new Vector3(OX + box.x + Math.cos(angle) * reach, 0, OZ + box.z + Math.sin(angle) * reach);
      if (!onPlate(start.x - OX, start.z - OZ) || !collision.isClearCircle(start.x, start.z, PLAYER_RADIUS)) {
        skipped += 1;
        continue;
      }
      for (const step of [0.05, PLAYER_LONGEST_STEP]) {
        marches += 1;
        const end = march(collision, start, new Vector3(OX + box.x, 0, OZ + box.z), step, reach + 1);
        deepest = Math.max(deepest, PLAYER_RADIUS - outsideBox(box, end.x - OX, end.z - OZ));
      }
    }
    if (deepest > worst.over) worst = { what: box.what, over: deepest };
    if (deepest > CORNER_ALLOWANCE) say(false, `${box.what}: a body's edge got ${deepest.toFixed(3)} m into it (allowance ${CORNER_ALLOWANCE.toFixed(3)})`);
  }
  say(worst.over <= CORNER_ALLOWANCE, `${boxes.length} drawn boxes, ${marches} marches; deepest a body's edge got into one: ${worst.over.toFixed(3)} m (${worst.what || 'none'}), allowance ${CORNER_ALLOWANCE.toFixed(3)}`);
  note(`${skipped} march starts skipped (off the plate or inside another solid)`);
  // The walls: from inside, at 12 stations a side, nobody leaves but through the door.
  let escaped = 0;
  for (let i = 0; i < 12; i += 1) {
    const t = -0.9 + (1.8 * i) / 11;
    for (const [from, to] of [
      [new Vector3(OX + t * LIBRARY_INNER_X, 0, OZ - 6), new Vector3(OX + t * LIBRARY_INNER_X, 0, OZ - 30)],
      [new Vector3(OX + t * LIBRARY_INNER_X, 0, OZ + 9), new Vector3(OX + t * LIBRARY_INNER_X, 0, OZ + 30)],
      [new Vector3(OX - 12, 0, OZ + t * LIBRARY_INNER_Z), new Vector3(OX - 40, 0, OZ + t * LIBRARY_INNER_Z)],
      [new Vector3(OX + 12, 0, OZ + t * LIBRARY_INNER_Z), new Vector3(OX + 40, 0, OZ + t * LIBRARY_INNER_Z)],
    ] as const) {
      const end = march(collision, from, to, PLAYER_LONGEST_STEP, 30);
      const lx = end.x - OX;
      const lz = end.z - OZ;
      const throughDoor = Math.abs(lx - LIBRARY_DOOR_X) < LIBRARY_DOOR_HALF && lz > LIBRARY_INNER_Z;
      if ((Math.abs(lx) > LIBRARY_HALF_X + 0.05 || Math.abs(lz) > LIBRARY_HALF_Z + 0.05) && !throughDoor) escaped += 1;
    }
  }
  say(escaped === 0, `the walls hold: ${escaped} of 48 marches left the room other than through the door`);
}

/** March a body from `from` along (dx, dz) in `step`s at a clearance over the floor (a flier's); returns where it ended. */
function marchAt(from: Vector3, dx: number, dz: number, step: number, clearance: number, travel = 12): Vector3 {
  const p = from.clone();
  const length = Math.hypot(dx, dz);
  for (let t = 0; t < travel; t += step) collision.resolveMovement(p, (dx / length) * step, (dz / length) * step, PLAYER_RADIUS, clearance, MAX_FRAME_DELTA);
  return p;
}

console.log("\nDEN WALLS — bodies in the secret den, marched at its three walls, never leave it but by its doorway:");
{
  // Twelve bodies over the den's floor, a hand's breadth clear of every wall,
  // from the den's own inner faces (layout.ts) — never typed here.
  const inner = LIBRARY_DEN_INNER;
  const x0 = inner.west + PLAYER_RADIUS + 0.2;
  const x1 = -(LIBRARY_HALF_X + LIBRARY_WALL_HALF) - PLAYER_RADIUS - 0.2;
  const z0 = inner.north + PLAYER_RADIUS + 0.2;
  const z1 = inner.south - PLAYER_RADIUS - 0.2;
  const bodies: LocalPoint[] = [];
  for (let i = 0; i < 4; i += 1) for (let j = 0; j < 3; j += 1) bodies.push({ x: x0 + ((x1 - x0) * i) / 3, z: z0 + ((z1 - z0) * j) / 2 });
  /** Each heading, and how far a body's edge has got past that wall's drawn inner face (negative: short of it). */
  const headings = [
    { name: 'west (−X)', dx: -1, dz: 0, past: (p: LocalPoint): number => inner.west - (p.x - PLAYER_RADIUS) },
    { name: 'north (−Z)', dx: 0, dz: -1, past: (p: LocalPoint): number => inner.north - (p.z - PLAYER_RADIUS) },
    { name: 'south (+Z)', dx: 0, dz: 1, past: (p: LocalPoint): number => p.z + PLAYER_RADIUS - inner.south },
  ] as const;
  let placed = 0;
  let marches = 0;
  let escaped = 0;
  const deepest = headings.map(() => -Infinity);
  for (const body of bodies) {
    if (!libraryDenContains(body.x, body.z) || !collision.isClearCircle(OX + body.x, OZ + body.z, PLAYER_RADIUS)) {
      say(false, `a body could not be stood in the den at (${body.x.toFixed(2)}, ${body.z.toFixed(2)}) — nothing is measured from there`);
      continue;
    }
    placed += 1;
    for (const [h, heading] of headings.entries()) {
      for (const step of [0.05, PLAYER_LONGEST_STEP]) {
        marches += 1;
        const end = marchAt(new Vector3(OX + body.x, LIBRARY_FLOOR_Y, OZ + body.z), heading.dx, heading.dz, step, 0);
        const at = { x: end.x - OX, z: end.z - OZ };
        deepest[h] = Math.max(deepest[h]!, heading.past(at));
        if (!libraryDenContains(at.x, at.z) && !onPlate(at.x, at.z)) {
          escaped += 1;
          if (escaped <= 4) {
            say(false, `a body marched ${heading.name} from (${body.x.toFixed(2)}, ${body.z.toFixed(2)}) at ${step.toFixed(2)} m a step ended at (${at.x.toFixed(2)}, ${at.z.toFixed(2)}), outside the den and the room`);
          }
        }
      }
    }
  }
  say(
    placed === bodies.length && escaped === 0,
    `${placed} of ${bodies.length} bodies stood in the den, ${marches} marches (${headings.length} headings, 5 cm and the sprint stride): ${escaped} ended outside the den and the room`,
  );
  // Against each wall's drawn inner face: no deeper than the resolver's slack,
  // and some body got within 5 cm of it — so each heading measured its wall,
  // not something stood in front of it.
  say(
    deepest.every((d) => d <= RESOLVER_SLACK && d >= -0.05),
    `each wall stopped them at its drawn face — deepest a body's edge got past it: ${headings.map((heading, h) => `${heading.name} ${deepest[h]!.toFixed(3)} m`).join(', ')} ` +
      `(at most ${RESOLVER_SLACK}, and some body within 0.05 of every face)`,
  );
  note(`the den's floor x ${x0.toFixed(2)}..${x1.toFixed(2)}, z ${z0.toFixed(2)}..${z1.toFixed(2)} (body centres); its walls' inner faces x ${inner.west.toFixed(2)}, z ${inner.north.toFixed(2)} and ${inner.south.toFixed(2)}`);
}

console.log("\nLINTEL — over the den's doorway: a flier stops at it, at every height nobody slips between it and the shut shelf, and a walker passes under it:");
{
  if (mutating('no-lintel')) {
    collision.removeWall(library.lintel);
    note("REMOVED the lintel over the den's doorway on purpose — this run must go red");
  }
  const caseTop = libraryBookcaseSize(LIBRARY_SECRET_BOOKCASE.kind).height;
  const throughZ = OZ + LIBRARY_SECRET_BOOKCASE.at.z;
  const start = (feet: number): Vector3 => new Vector3(OX - 16, LIBRARY_FLOOR_Y + feet, throughZ);
  /** Marched west through the doorway's middle at a height (its clearance over the floor); where it ended, room-local x. */
  const westAt = (feet: number, step: number): number => marchAt(start(feet), -1, 0, step, feet).x - OX;
  /** Stopped with her edge on the lintel's (the wall's) inner face, less the resolver's slack. */
  const atLintel = -LIBRARY_INNER_X + PLAYER_RADIUS - RESOLVER_SLACK;
  /** Where the shut shelf's front stops a walker, less the slack: a flier ending west of this cleared the shelf. */
  const atShelf = LIBRARY_SECRET_BOOKCASE.at.x + bookcaseFrontOut(LIBRARY_SECRET_BOOKCASE) + PLAYER_RADIUS - RESOLVER_SLACK;
  const flier = caseTop + 0.8;
  for (const step of [0.05, PLAYER_LONGEST_STEP]) {
    const end = westAt(flier, step);
    say(
      end >= atLintel && end < atShelf,
      `a flier at ${flier.toFixed(2)} m (the shut shelf's top + 0.8), marched west at ${step.toFixed(2)} m a step from x −16, stops at x ${end.toFixed(2)}: ` +
        `at the lintel (at least ${atLintel.toFixed(2)}), and past where the shut shelf stops a walker (${atShelf.toFixed(2)}) — so she cleared the shelf and met the lintel`,
    );
  }
  // The lintel's top is the wall's own top — one owner, read back off both
  // colliders. Every room wall has its real top since PR #722 (nothing drawn
  // carries a flag for one), so over the wall's top the room holds no flier
  // anywhere, and the lintel can hold her exactly as high as the wall beside
  // it does, no higher and no lower.
  const wallX = OX - LIBRARY_HALF_X;
  const westSpans = library.roomWalls.filter((wall) => Math.abs(wall.x1 - wallX) < 1e-6 && Math.abs(wall.x2 - wallX) < 1e-6);
  /** The west wall's own top — the reference every height below is taken from, so a lintel built wrong cannot move the ruler it is measured with. */
  const wallTop = westSpans.length > 0 && westSpans.every((span) => Number.isFinite(span.topHeight)) ? westSpans[0]!.topHeight : Number.NaN;
  say(
    westSpans.length === 2 && Number.isFinite(wallTop) && westSpans.every((span) => Math.abs(span.topHeight - library.lintel.topHeight) < 1e-9),
    `the lintel's top is the west wall's own: ${library.lintel.topHeight.toFixed(2)} m, against the wall's ${westSpans.length} spans at ` +
      `${westSpans.map((span) => span.topHeight.toFixed(2)).join(', ')} m (two spans wanted, either side of the doorway, each with a real top)`,
  );
  if (!Number.isFinite(wallTop)) throw new Error("LINTEL: the west wall has no finite top to measure the lintel against — the room's walls lost their real tops");
  // Every height the wall itself holds a flier at — the floor up to where her
  // feet plus the jump grace reach the wall's top: the shut shelf holds
  // whoever is below its top less the grace, the lintel whoever is above its
  // base, and the two bands overlap — no height slips between them.
  const held = wallTop - LIBRARY_FLOOR_Y - JUMP_CLEARANCE_GRACE - 0.05;
  const heights = Math.floor(held / 0.05);
  let furthest = { x: Infinity, feet: 0 };
  let swept = 0;
  for (let i = 0; i <= heights; i += 1) {
    const feet = i * 0.05;
    for (const step of [0.05, PLAYER_LONGEST_STEP]) {
      swept += 1;
      const end = westAt(feet, step);
      if (end < furthest.x) furthest = { x: end, feet };
    }
  }
  say(
    heights >= 60 && furthest.x >= atLintel,
    `${swept} marches at every height from the floor to ${(heights * 0.05).toFixed(2)} m (the highest the wall's top holds a flier), 5 cm apart, both strides: ` +
      `the furthest west any got is x ${furthest.x.toFixed(2)} (at ${furthest.feet.toFixed(2)} m), at least ${atLintel.toFixed(2)} — ` +
      `the shut shelf holds her below ${(caseTop - JUMP_CLEARANCE_GRACE).toFixed(2)} m, the lintel from ${library.lintel.baseHeight.toFixed(2)} m up to the wall's top at ${wallTop.toFixed(2)} m`,
  );
  // CONTROL — over the wall's top: a flier whose feet clear the top by the
  // grace passes the lintel and the plain west wall alike, so the lintel's
  // ceiling is the wall's, not a hole of its own. The plain wall is marched
  // at the south span, well clear of the doorway.
  const over = wallTop - LIBRARY_FLOOR_Y - JUMP_CLEARANCE_GRACE + 0.05;
  const plainZ = (LIBRARY_SECRET_BOOKCASE.at.z + LIBRARY_DEN_DOOR_HALF + LIBRARY_HALF_Z) / 2;
  const overLintel = westAt(over, 0.05);
  const overWall = marchAt(new Vector3(OX - 16, LIBRARY_FLOOR_Y + over, OZ + plainZ), -1, 0, 0.05, over).x - OX;
  const outside = -(LIBRARY_HALF_X + LIBRARY_WALL_HALF) - PLAYER_RADIUS;
  say(
    overLintel < outside && overWall < outside,
    `CONTROL, a flier at ${over.toFixed(2)} m (over the wall's top by the jump grace): she passes over the lintel (to x ${overLintel.toFixed(2)}) ` +
      `and over the plain west wall at z ${plainZ.toFixed(2)} (to x ${overWall.toFixed(2)}) alike — the lintel ends where the wall does`,
  );
  // CONTROL — the shut shelf's collider out, the doorway as the open shelf
  // will leave it (plan Step 12): a walker passes under the lintel into the
  // den, and the flier still stops at it. So the lintel is a band, not a wall,
  // and what stopped the flier above was the lintel, not the shelf. The shelf
  // is one filled box since PR #722, named by its case.
  const shelf = library.solids.filter((solid) => solid.what === `bookcase ${LIBRARY_SECRET_BOOKCASE.id}` && !removedOnPurpose.has(solid));
  for (const solid of shelf) takeOut(solid);
  try {
    const walker = westAt(0, 0.05);
    const alone = westAt(flier, 0.05);
    say(
      libraryDenContains(walker, LIBRARY_SECRET_BOOKCASE.at.z) && walker < outside && alone >= atLintel,
      `CONTROL, the shut shelf's ${shelf.length} collider(s) out: a walker on the floor passes under the lintel into the den (to x ${walker.toFixed(2)}), ` +
        `and the flier at ${flier.toFixed(2)} m still stops at x ${alone.toFixed(2)} — the lintel alone holds her`,
    );
  } finally {
    for (const solid of shelf) putBack(solid);
  }
}

console.log('\nLANDING — her feet find every solid top across its drawn footprint:');
{
  let points = 0;
  let missed = 0;
  let controls = 0;
  let controlWrong = 0;
  let shared = 0;
  const firstMiss: string[] = [];
  const standables = library.standables;
  /** Does any other solid's drawn footprint cover room-local (x, z)? Where two overlap (a lamp on a desk), her feet rest on whichever is higher. */
  const coveredByAnother = (x: number, z: number, except: (typeof standables)[number]): boolean =>
    standables.some((other) => other !== except && footprintCovers(other.footprint, x, z));
  /** Where her feet come to rest at room-local (x, z), asked from just over `top` — `Player.groundAt`'s rule. */
  const feetAt = (x: number, z: number, top: number): number => standingAt(collision, surfaces.sample.bind(surfaces), OX + x, OZ + z, top + 0.1);
  for (const standable of standables) {
    for (const [u, v] of grid(standable.footprint, 0)) {
      if (coveredByAnother(u, v, standable)) {
        shared += 1;
        continue;
      }
      points += 1;
      const y = feetAt(u, v, standable.top);
      if (Math.abs(y - standable.top) > FEET_TOLERANCE) {
        missed += 1;
        if (firstMiss.length < 4) firstMiss.push(`${standable.what} at (${u.toFixed(2)}, ${v.toFixed(2)}): landed at ${y.toFixed(3)}, its top is ${standable.top.toFixed(3)}`);
      }
    }
    // The control: a ring just outside the drawn footprint is the floor (or another top).
    for (const [u, v] of grid(standable.footprint, 0.1)) {
      if (coveredByAnother(u, v, standable)) continue;
      controls += 1;
      const y = feetAt(u, v, standable.top);
      if (Math.abs(y) > FEET_TOLERANCE) controlWrong += 1;
    }
  }
  for (const line of firstMiss) say(false, line);
  say(standables.length >= 10 && missed === 0, `${standables.length} tops, ${points} landings across their drawn footprints: ${missed} fell through`);
  say(controls > 0 && controlWrong === 0, `CONTROL: ${controls} landings 0.1 m outside a footprint found the floor (${controlWrong} found a top in the air)`);
  note(`${shared} point(s) shared by two solids (a lamp on a desk or a table) left to the higher one; the tops: ${standables.map((s) => `${s.what} ${s.top.toFixed(2)}`).join(', ')}`);
}

/** Does a solid's drawn footprint cover room-local (x, z)? */
function footprintCovers(footprint: (typeof library.standables)[number]['footprint'], x: number, z: number): boolean {
  if ('radius' in footprint) return Math.hypot(x - footprint.x, z - footprint.z) <= footprint.radius;
  return outsideBox(footprint, x, z) <= 0;
}

/** A grid of room-local points across a footprint, or a ring `grow` outside it. */
function grid(footprint: (typeof library.standables)[number]['footprint'], grow: number): [number, number][] {
  const out: [number, number][] = [];
  if ('radius' in footprint) {
    const r = footprint.radius;
    if (grow > 0) {
      for (let k = 0; k < 16; k += 1) {
        const a = (k / 16) * Math.PI * 2;
        out.push([footprint.x + Math.cos(a) * (r + grow), footprint.z + Math.sin(a) * (r + grow)]);
      }
      return out;
    }
    // Rings across the disc, its rim (at 98%) included.
    out.push([footprint.x, footprint.z]);
    for (const fraction of [0.33, 0.66, 0.98]) {
      for (let k = 0; k < 12; k += 1) {
        const a = (k / 12) * Math.PI * 2;
        out.push([footprint.x + Math.cos(a) * r * fraction, footprint.z + Math.sin(a) * r * fraction]);
      }
    }
    return out;
  }
  const yaw = (footprint.facing * Math.PI) / 180;
  const along = (a: number, o: number): [number, number] => [footprint.x + a * Math.cos(yaw) + o * Math.sin(yaw), footprint.z - a * Math.sin(yaw) + o * Math.cos(yaw)];
  if (grow > 0) {
    const hl = footprint.halfLength + grow;
    const hd = footprint.halfDepth + grow;
    for (let i = -6; i <= 6; i += 1) {
      out.push(along((i / 6) * hl, hd), along((i / 6) * hl, -hd));
      out.push(along(hl, (i / 6) * hd), along(-hl, (i / 6) * hd));
    }
    return out;
  }
  for (let i = -6; i <= 6; i += 1) {
    for (let j = -6; j <= 6; j += 1) out.push(along((i / 6) * footprint.halfLength * 0.98, (j / 6) * footprint.halfDepth * 0.98));
  }
  return out;
}

console.log('\nFACADE — the building marched at from 48 bearings, at 5 cm and the sprint stride:');
{
  const frame = library.frame;
  const plan = library.plan;
  const local = new Vector3();
  /**
   * Building-local plan point of a world point, **read at the building's own
   * base** — where its colliders' feet are. The building leans (tan up to
   * ~0.4), so a plan point read at some other height (world y 0 is metres
   * above the ground out on the sphere's curve) slides across the building by
   * that height times the lean: read at y 0, a sprinter stopped on the door
   * leaves once measured 1.3 m "inside" them.
   */
  const toPlan = (x: number, z: number): Vector3 => frame.toLocal(x, frame.surfaceY(x, z, 0, () => true) ?? 0, z, local);
  /** How far a body's edge is into the cella's drawn extent (the recess excepted), or into a column. */
  const intoSolid = (x: number, z: number): { depth: number; what: string; lx: number; lz: number } => {
    toPlan(x, z);
    const inRecess = Math.abs(local.x) < plan.doorHalf && local.z > plan.recessBackZ;
    let depth = -Infinity;
    let what = '';
    if (!inRecess) {
      const dx = Math.abs(local.x) - plan.cellaHalfX;
      const dz = Math.max(plan.cellaBackZ - local.z, local.z - plan.cellaFrontZ);
      const outside = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
      depth = PLAYER_RADIUS - (outside > 0 ? outside : Math.max(dx, dz));
      what = 'the cella';
    }
    for (const [i, column] of plan.columns.entries()) {
      const d = PLAYER_RADIUS - (Math.hypot(local.x - column.x, local.z - column.z) - column.radius);
      if (d > depth) {
        depth = d;
        what = `column ${i + 1}`;
      }
    }
    return { depth, what, lx: local.x, lz: local.z };
  };
  const corners = [
    { name: 'back west', x: -plan.cellaHalfX, z: plan.cellaBackZ },
    { name: 'back east', x: plan.cellaHalfX, z: plan.cellaBackZ },
    { name: 'front west', x: -plan.cellaHalfX, z: plan.cellaFrontZ },
    { name: 'front east', x: plan.cellaHalfX, z: plan.cellaFrontZ },
    { name: 'mouth west', x: -plan.doorHalf, z: plan.cellaFrontZ },
    { name: 'mouth east', x: plan.doorHalf, z: plan.cellaFrontZ },
  ];
  const atCorner = new Map<string, number>(corners.map((corner) => [corner.name, -Infinity]));
  let deepest = { depth: -Infinity, what: '', bearing: 0 };
  let reachedShell = 0;
  let marches = 0;
  for (let i = 0; i < 48; i += 1) {
    const bearing = frame.yaw + (i / 48) * Math.PI * 2;
    for (const step of [0.05, PLAYER_LONGEST_STEP]) {
      marches += 1;
      const p = onGround(frame.x + Math.sin(bearing) * 16, frame.z + Math.cos(bearing) * 16);
      let closest = Infinity;
      for (let travelled = 0; travelled < 20; travelled += step) {
        collision.resolveMovement(p, -Math.sin(bearing) * step, -Math.cos(bearing) * step, PLAYER_RADIUS, 0, MAX_FRAME_DELTA);
        p.y = surfaces.sample(p.x, p.z, p.y);
        const into = intoSolid(p.x, p.z);
        if (into.depth > deepest.depth) deepest = { depth: into.depth, what: into.what, bearing: (i / 48) * 360 };
        if (into.what === 'the cella') {
          for (const corner of corners) {
            if (Math.hypot(into.lx - corner.x, into.lz - corner.z) < PLAYER_RADIUS + 1) atCorner.set(corner.name, Math.max(atCorner.get(corner.name)!, into.depth));
          }
        }
        closest = Math.min(closest, Math.hypot(p.x - frame.x, p.z - frame.z));
      }
      if (closest < Math.hypot(plan.plinthHalfX, plan.stepFrontZ) + 1.5) reachedShell += 1;
    }
  }
  say(deepest.depth <= CORNER_ALLOWANCE, `deepest a body's edge got into the cella or a column: ${deepest.depth.toFixed(3)} m (${deepest.what}, ${deepest.bearing.toFixed(0)}° round from the door), allowance ${CORNER_ALLOWANCE.toFixed(3)}`);
  say(reachedShell >= marches * 0.75, `${reachedShell} of ${marches} marches reached the building (the rest met a neighbour or the doorway)`);
  note(`deepest per outside corner: ${corners.map((corner) => `${corner.name} ${Number.isFinite(atCorner.get(corner.name)!) ? atCorner.get(corner.name)!.toFixed(3) : 'not reached'}`).join(', ')}`);

  // Square at the plinth's sides and back, from the lawn: she stops at its drawn
  // edge — **wherever it stands proud of the ground she walks up on.** Every
  // solid has its real top now (17 Oct 2026): where the hillside rises to the
  // plinth's own top, there is no edge to stop her and she walks onto the stone
  // as onto a step, which is the physics, not a hole. So a body counts as *in*
  // the stone only with the stone's top more than the clearance grace over her
  // feet — sinking into it, the fault this clause is for.
  let edgeMarches = 0;
  let steppedOnto = 0;
  let worstEdge = { depth: -Infinity, at: '' };
  const intoPlinth = (x: number, z: number): number => {
    toPlan(x, z);
    const dx = Math.abs(local.x) - plan.plinthHalfX;
    const dz = Math.max(plan.plinthBackZ - local.z, local.z - plan.stepFrontZ);
    const outside = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
    return PLAYER_RADIUS - (outside > 0 ? outside : Math.max(dx, dz));
  };
  const approaches: { from: { x: number; z: number }; to: { x: number; z: number }; at: string }[] = [];
  for (let z = plan.plinthBackZ + 0.4; z <= plan.stepFrontZ - 0.4; z += 0.8) {
    for (const side of [-1, 1]) {
      approaches.push({ from: { x: side * (plan.plinthHalfX + 3), z }, to: { x: 0, z }, at: `${side < 0 ? 'west' : 'east'} side, ${z.toFixed(1)} along` });
    }
  }
  for (let x = -plan.plinthHalfX + 0.4; x <= plan.plinthHalfX - 0.4; x += 0.8) {
    approaches.push({ from: { x, z: plan.plinthBackZ - 3 }, to: { x, z: 0 }, at: `the back, ${x.toFixed(1)} across` });
  }
  // And head-on at the plinth's two back corners, where its edges meet.
  for (const side of [-1, 1]) {
    approaches.push({
      from: { x: side * (plan.plinthHalfX + 3), z: plan.plinthBackZ - 3 },
      to: { x: side * plan.plinthHalfX, z: plan.plinthBackZ },
      at: `the back ${side < 0 ? 'west' : 'east'} corner, head on`,
    });
  }
  for (const approach of approaches) {
    const from = frame.foot(approach.from.x, approach.from.z);
    const to = frame.foot(approach.to.x, approach.to.z);
    for (const step of [0.05, PLAYER_LONGEST_STEP]) {
      edgeMarches += 1;
      const p = onGround(from.x, from.z);
      const dir = new Vector3(to.x - from.x, 0, to.z - from.z).normalize();
      for (let travelled = 0; travelled < 5; travelled += step) {
        collision.resolveMovement(p, dir.x * step, dir.z * step, PLAYER_RADIUS, 0, MAX_FRAME_DELTA);
        p.y = surfaces.sample(p.x, p.z, p.y);
        const depth = intoPlinth(p.x, p.z);
        const stoneTop = frame.topY(p.x, p.z, local.x, local.z, plan.plinthTop);
        if (depth > CORNER_ALLOWANCE && stoneTop - p.y <= JUMP_CLEARANCE_GRACE) {
          steppedOnto += 1;
          continue;
        }
        if (depth > worstEdge.depth) worstEdge = { depth, at: approach.at };
      }
    }
  }
  say(worstEdge.depth <= CORNER_ALLOWANCE, `${edgeMarches} marches square at the plinth's sides and back: deepest a body's edge got into its stone below its top ${worstEdge.depth.toFixed(3)} m (${worstEdge.at}), allowance ${CORNER_ALLOWANCE.toFixed(3)}`);
  note(`${steppedOnto} march step(s) went onto the plinth where the ground rises level with its top — a step, not a hole`);

  // From the portico — the central bay between the middle columns — at the
  // front wall either side of the door, head on at the doorway's two outside
  // corners, along the portico to its ends, and from inside the recess
  // sideways, into its back corners and straight at the door: her body never
  // gets into the masonry. (The recess is shallow — the door leaves stand
  // 0.79 m behind the cella's front — so the wings' corner caps and the
  // recess's back wall overlap behind each jamb, leaving 0.19 m: a jamb taken
  // out opens nothing she fits through. The recess's back wall taken out lets
  // her in by metres, and so does the front wall either side.)
  const band = library.doorBands()[0]!;
  let porticoWorst = { depth: -Infinity, at: '' };
  const bandCentre = toPlan(band.centreX, band.centreZ).clone();
  const columnLine = Math.min(...plan.columns.map((column) => column.z - column.radius));
  const bay = { x: 0, z: (plan.cellaFrontZ + columnLine) / 2 + PLAYER_RADIUS / 2 };
  const fromBay = (x: number, z: number, at: string): { from: { x: number; z: number }; to: { x: number; z: number }; at: string } => ({ from: bay, to: { x, z }, at });
  const fromRecess = (x: number, z: number, at: string): { from: { x: number; z: number }; to: { x: number; z: number }; at: string } => ({
    from: { x: 0, z: bandCentre.z },
    to: { x, z },
    at,
  });
  const porticoMarches = [
    ...[-1, 1].flatMap((side) => [
      fromBay(side * (plan.doorHalf + 1.5), plan.cellaFrontZ - 2, `the front wall ${side < 0 ? 'west' : 'east'} of the door`),
      fromBay(side * (plan.cellaHalfX - 1), plan.cellaFrontZ - 2, `the front wall's ${side < 0 ? 'west' : 'east'} end`),
      fromBay(side * (plan.cellaHalfX + 3), bay.z, `along the portico ${side < 0 ? 'west' : 'east'}`),
      // At the doorway's outside corner, from the bay: the columns stand too
      // close for a square-on 45-degree approach, so this is the steepest one
      // the portico allows.
      fromBay(side * plan.doorHalf, plan.cellaFrontZ, `the doorway's ${side < 0 ? 'west' : 'east'} corner`),
      fromRecess(side * (plan.doorHalf + 3), bandCentre.z, `sideways in the recess, ${side < 0 ? 'west' : 'east'}`),
      fromRecess(side * (plan.doorHalf + 3), plan.recessBackZ - 3, `into the recess's back ${side < 0 ? 'west' : 'east'} corner`),
    ]),
    fromRecess(0, plan.cellaBackZ, 'straight at the door'),
  ];
  for (const aim of porticoMarches) {
    for (const step of [0.05, PLAYER_LONGEST_STEP]) {
      const start = frame.foot(aim.from.x, aim.from.z);
      const target = frame.foot(aim.to.x, aim.to.z);
      const p = onGround(start.x, start.z);
      const dir = new Vector3(target.x - start.x, 0, target.z - start.z).normalize();
      for (let travelled = 0; travelled < 10; travelled += step) {
        collision.resolveMovement(p, dir.x * step, dir.z * step, PLAYER_RADIUS, 0, MAX_FRAME_DELTA);
        p.y = surfaces.sample(p.x, p.z, p.y);
        const into = intoSolid(p.x, p.z);
        if (into.what === 'the cella' && into.depth > porticoWorst.depth) porticoWorst = { depth: into.depth, at: aim.at };
      }
    }
  }
  say(
    porticoWorst.depth <= CORNER_ALLOWANCE,
    `${porticoMarches.length * 2} marches in the portico and the recess: deepest a body's edge got into the masonry ${porticoWorst.depth.toFixed(3)} m (${porticoWorst.at}), allowance ${CORNER_ALLOWANCE.toFixed(3)}`,
  );

  // A sprinter through the door stops on the door leaves, inside the band.
  const start = frame.foot(0, plan.stepFrontZ + 3);
  const p = onGround(start.x, start.z);
  let crossed = false;
  for (let t = 0; t < 14; t += PLAYER_LONGEST_STEP) {
    const fx = p.x;
    const fz = p.z;
    collision.resolveMovement(p, -Math.sin(frame.yaw) * PLAYER_LONGEST_STEP, -Math.cos(frame.yaw) * PLAYER_LONGEST_STEP, PLAYER_RADIUS, 0, MAX_FRAME_DELTA);
    p.y = surfaces.sample(p.x, p.z, p.y);
    if (bandCrossed(band, fx, fz, p.x, p.z)) crossed = true;
  }
  toPlan(p.x, p.z);
  say(crossed && local.z > plan.recessBackZ && local.z < plan.cellaFrontZ + 0.2, `a sprinter through the door crosses the band and stops at ${local.z.toFixed(2)} m along (door leaves' front ${plan.recessBackZ.toFixed(2)})`);
  note(`the building at (${frame.x.toFixed(1)}, ${frame.z.toFixed(1)}) leaning tan ${frame.leanTangent().toFixed(3)}; set ${library.baseSink.toFixed(3)} m along its up; skirt ${library.skirtDepth.toFixed(2)} m`);
}

console.log('\nSTEPS — up the steps across the whole front, feet on the stone:');
{
  const frame = library.frame;
  const plan = library.plan;
  const local = new Vector3();
  const columns = plan.columns.map((column) => column.x).sort((a, b) => a - b);
  // Every column's line, every gap's middle, the middle and either end she can
  // reach inside the plinth's edges: the ground falls away under one end of a
  // step on a sloping seed, and a column stops a climb at its foot.
  const reachEnd = plan.plinthHalfX - END_HALF * 2 - PLAYER_RADIUS;
  const across = [
    0,
    -reachEnd,
    reachEnd,
    ...columns,
    ...columns.slice(1).map((x, i) => (x + columns[i]!) / 2),
  ];
  /** The highest drawn top over a world column, asked the way the plates ask it: at each top's own height. */
  const stoneTop = (x: number, z: number): number | null => {
    let top: number | null = null;
    for (const [height, fromZ, toZ] of [
      [plan.plinthTop, plan.plinthBackZ, plan.stepBackZ],
      [plan.stepTop, plan.stepBackZ, plan.stepFrontZ],
    ] as const) {
      const y = frame.surfaceY(x, z, height, (lx, lz) => Math.abs(lx) <= plan.plinthHalfX && lz >= fromZ && lz <= toZ);
      if (y !== null && (top === null || height > top)) top = height;
    }
    return top;
  };
  let worst = { at: 0, deepest: 0 };
  let over = 0;
  for (const x of across) {
    const start = frame.foot(x, plan.stepFrontZ + 2.5);
    const p = new Vector3(start.x, surfaces.sample(start.x, start.z, terrainHeight(start.x, start.z) + 3), start.z);
    for (let t = 0; t < 4.5; t += 0.05) {
      collision.resolveMovement(p, -Math.sin(frame.yaw) * 0.05, -Math.cos(frame.yaw) * 0.05, PLAYER_RADIUS, 0, MAX_FRAME_DELTA);
      p.y = surfaces.sample(p.x, p.z, p.y);
      const top = stoneTop(p.x, p.z);
      if (top === null) continue;
      over += 1;
      const feet = frame.toLocal(p.x, p.y, p.z, local).y;
      if (top - feet > worst.deepest) worst = { at: x, deepest: top - feet };
    }
  }
  say(over > 50, `${over} samples over the stone, ${across.length} climbs`);
  say(worst.deepest <= FEET_TOLERANCE, `her feet at worst ${worst.deepest.toFixed(3)} m into the stone (${worst.at.toFixed(2)} m across; step-up rule ${BUILDING_STEP_UP} m, base set ${library.baseSink.toFixed(3)} m)`);
}

console.log('\nDOORS — both ways, on the real building:');
{
  // The owl (#718) reads a frame's input and her child's run and jump flags
  // every frame she is inside: a probe that has none of them is a probe she
  // reads `undefined` off, so it carries the stillness it stands for.
  const probe = {
    position: new Vector3(0, 0, 0),
    previousPosition: new Vector3(0, 0, 0),
    riding: false,
    isRunning: false,
    isAirborne: false,
    verticalSpeed: 0,
    model: { height: 2.12 },
    topHeight: 2.12,
    teleportTo(x: number, y: number, z: number) {
      probe.position.set(x, y, z);
      probe.previousPosition.set(x, y, z);
    },
  };
  library.attachPlayer(probe as never);
  collision.setPlayBounds(bounds);
  const context = { dt: 1 / 60, elapsed: 1, input: new InputSystem(), playerPosition: probe.position, frame: 1 } as unknown as FrameContext;
  const settle = (): void => {
    for (let i = 0; i < 70; i += 1) library.update(context);
  };
  say(library.requestEnterDoor(), '/library-door puts her outside the door');
  settle();
  say(spaceAt(probe.position.x, probe.position.z) === SPACE_GARDEN && !library.playerIsInside, `she stands in the park (${spaceAt(probe.position.x, probe.position.z)})`);
  const mat = library.doormat;
  say(Math.hypot(probe.position.x - mat.x, probe.position.z - mat.z) < 0.01, `on the plot's own doormat (${mat.x.toFixed(2)}, ${mat.z.toFixed(2)})`);
  const [front, exit] = library.doorBands() as [NonNullable<ReturnType<typeof library.doorBands>[0]>, NonNullable<ReturnType<typeof library.doorBands>[1]>];
  say(!bandCrossed(front, mat.x, mat.z, mat.x, mat.z), 'the doormat stands clear of the band that would send her in');
  say(library.interactZones().some((zone) => zone.id === 'library-entrance'), 'the entrance zone is offered from outside');
  // In through the front band, at a sprint stride.
  const frame = library.frame;
  const out = frame.foot(0, library.plan.cellaFrontZ + 0.4);
  const in1 = frame.foot(0, library.plan.cellaFrontZ + 0.4 - PLAYER_LONGEST_STEP);
  say(bandCrossed(front, out.x, out.z, in1.x, in1.z), 'a sprint stride across the front band fires it');
  probe.previousPosition.set(out.x, 0, out.z);
  probe.position.set(in1.x, 0, in1.z);
  library.update(context);
  settle();
  const arrivalOff = Math.hypot(probe.position.x - OX - LIBRARY_ARRIVAL.x, probe.position.z - OZ - LIBRARY_ARRIVAL.z);
  say(spaceAt(probe.position.x, probe.position.z) === SPACE_LIBRARY && library.playerIsInside, 'walking through the front door enters the reading room');
  say(arrivalOff < 0.01, `she arrives ${arrivalOff.toFixed(3)} m from the arrival (${LIBRARY_ARRIVAL.x}, ${LIBRARY_ARRIVAL.z})`);
  say(!bandCrossed(exit, probe.position.x, probe.position.z, probe.position.x, probe.position.z), 'the arrival stands clear of the band that would send her out');
  say(collision.isClearCircle(probe.position.x, probe.position.z, PLAYER_RADIUS), 'the arrival is clear floor');
  // Out through the exit band.
  probe.previousPosition.set(OX + LIBRARY_DOOR_X, 0, OZ + LIBRARY_HALF_Z - 1.2);
  probe.position.set(OX + LIBRARY_DOOR_X, 0, OZ + LIBRARY_HALF_Z - 1.2 + PLAYER_LONGEST_STEP);
  say(bandCrossed(exit, probe.previousPosition.x, probe.previousPosition.z, probe.position.x, probe.position.z), 'a sprint stride across the exit band fires it');
  library.update(context);
  settle();
  say(!library.playerIsInside && spaceAt(probe.position.x, probe.position.z) === SPACE_GARDEN, 'walking out through the exit leaves into the park');
  say(Math.hypot(probe.position.x - mat.x, probe.position.z - mat.z) < 0.01, 'onto the doormat');
  say(collision.isClearCircle(probe.position.x, probe.position.z, PLAYER_RADIUS), 'she lands on clear ground outside the door');
  // `/library` from inside too (a save written inside restores her there first).
  say(library.requestEnter(), '/library enters');
  settle();
  say(library.requestEnter({ x: -12, z: -3.9, facing: 90 }), '/library from inside still enters');
  settle();
  say(Math.abs(probe.position.x - OX + 12) < 0.01 && Math.abs(probe.position.z - OZ + 3.9) < 0.01, 'and stands her exactly where she was asked');
  library.adoptRestoredPlayer();
  say(library.playerIsInside, 'a player restored into the room is adopted as inside');

  console.log('\nFADE — a stack between the camera and her goes translucent:');
  const behind = { x: -9, z: -0.5 };
  const stack = library.stacks.find((candidate) => candidate.id === 'stack-3-2');
  probe.position.set(OX + behind.x, 0, OZ + behind.z);
  probe.previousPosition.copy(probe.position);
  camera.snapTo(probe.position);
  for (let i = 0; i < 60; i += 1) library.update(context);
  say(!!stack && stack.alpha < 0.5, `standing in the aisle behind stack-3-2, it fades to ${stack?.alpha.toFixed(2) ?? 'nothing'}`);
  probe.position.set(OX + 0.6, 0, OZ + 1.2);
  probe.previousPosition.copy(probe.position);
  camera.snapTo(probe.position);
  for (let i = 0; i < 90; i += 1) library.update(context);
  const faded = library.stacks.filter((candidate) => candidate.alpha < 0.999).map((candidate) => candidate.id);
  say(faded.length === 0, `CONTROL: in the open central aisle no stack fades (${faded.length === 0 ? 'none' : faded.join(', ')})`);
}

console.log('\nLIGHT — dim, warm, never black:');
{
  const lights = library.lighting.lights;
  if (process.env['LIBRARY_CHECK_DARK']) {
    for (const light of lights) if (light.name === 'library-fill' || light.name === 'library-key') light.intensity = 1e-4;
    note("TURNED the room's fill and key down to nothing on purpose — this run must go red");
  }
  const black = lights.filter((light) => light.intensity <= 0 || light.color.r + light.color.g + light.color.b < 0.01);
  say(black.length === 0, `no light is black or off: ${lights.length} lights, ${black.map((light) => light.name).join(', ') || 'none'} dark`);
  const pools = lights.filter((light) => light.type === 'PointLight').length;
  say(pools <= LIBRARY_LIGHT_BUDGET, `${pools} lamp pools (budget ${LIBRARY_LIGHT_BUDGET})`);
  const floor = library.roomRoot.getObjectByName('library.floor') as Mesh | undefined;
  const material = floor?.material as MeshToonMaterial | undefined;
  if (!floor || !material) {
    say(false, 'the floor mesh was not found — nothing measured');
  } else {
    const luminance = (c: Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    /** What the floor renders at (x, z) from the given lights alone: albedo x irradiance / pi (three.js's Lambert). */
    const lit = (x: number, z: number, rig: readonly Light[]): number =>
      luminance(material.color.clone().multiply(floorIrradiance(rig, x, z)).multiplyScalar(1 / Math.PI));
    const lift = luminance(material.emissive.clone().multiplyScalar(material.emissiveIntensity));
    const ink = luminance(new Color(PALETTE.ink));
    let darkest = { at: [0, 0], value: Infinity };
    let brightest = 0;
    for (let x = -LIBRARY_INNER_X; x <= LIBRARY_INNER_X; x += 1) {
      for (let z = -LIBRARY_INNER_Z; z <= LIBRARY_INNER_Z; z += 1) {
        const value = lit(x, z, lights);
        brightest = Math.max(brightest, value);
        if (value < darkest.value) darkest = { at: [x, z], value };
      }
    }
    // The floor's own lift is part of what renders, so it is counted — but a
    // lift past ink would pass a room with no lights at all, so it is asserted
    // to be under ink first: then the clause after it is a measure of the lights.
    say(
      lift < ink,
      `the floor's own lift alone renders ${lift.toFixed(4)}, under PALETTE.ink's ${ink.toFixed(4)} — so the next clause measures the room's lights, not its paint`,
    );
    say(
      darkest.value + lift > ink,
      `the darkest patch of floor, (${darkest.at[0]!.toFixed(1)}, ${darkest.at[1]!.toFixed(1)}), renders at ${(darkest.value + lift).toFixed(4)} linear ` +
        `(${darkest.value.toFixed(4)} from the room's lights, ${lift.toFixed(4)} its own lift), brighter than PALETTE.ink's ${ink.toFixed(4)}`,
    );
    say(
      brightest + lift > (darkest.value + lift) * 2,
      `the pools read as pools: brightest ${(brightest + lift).toFixed(4)}, ${((brightest + lift) / (darkest.value + lift)).toFixed(1)}x the darkest`,
    );
    // The secret den (#719), behind the west wall and out of every lamp's
    // reach: the fill and the key light it, and no PointLight is added for it
    // (the budget is spent). Its floor is the room floor's own material, so the
    // same albedo and lift are measured. Every whole metre a half-metre in from
    // its walls' inner faces.
    const den = LIBRARY_DEN_INNER;
    let denDarkest = { at: [0, 0], value: Infinity };
    let denCells = 0;
    for (let x = Math.ceil(den.west + 0.5); x <= Math.floor(-(LIBRARY_HALF_X + LIBRARY_WALL_HALF) - 0.5); x += 1) {
      for (let z = Math.ceil(den.north + 0.5); z <= Math.floor(den.south - 0.5); z += 1) {
        if (!libraryDenContains(x, z)) continue;
        denCells += 1;
        const value = lit(x, z, lights);
        if (value < denDarkest.value) denDarkest = { at: [x, z], value };
      }
    }
    say(
      denCells > 0 && denDarkest.value + lift > ink,
      `the darkest patch of the secret den's floor, (${denDarkest.at[0]!.toFixed(1)}, ${denDarkest.at[1]!.toFixed(1)}), renders at ${(denDarkest.value + lift).toFixed(4)} linear, ` +
        `brighter than PALETTE.ink's ${ink.toFixed(4)} (${denCells} den cells measured)`,
    );
    note(
      `the den's darkest cell (${denDarkest.at[0]!.toFixed(1)}, ${denDarkest.at[1]!.toFixed(1)}): ${denDarkest.value.toFixed(4)} from the room's lights + ${lift.toFixed(4)} lift, ` +
        `over ${denCells} cells x ${Math.ceil(den.west + 0.5)}..${Math.floor(-(LIBRARY_HALF_X + LIBRARY_WALL_HALF) - 0.5)}, z ${Math.ceil(den.north + 0.5)}..${Math.floor(den.south - 0.5)}; ` +
        `lit by the fill and the key, ${pools} pools in the room and none added for the den`,
    );
    const darkestOfAll = denDarkest.value < darkest.value ? denDarkest : darkest;
    const dark = [new HemisphereLight(PALETTE.ink, PALETTE.ink, 0.05)];
    const control = lit(darkestOfAll.at[0]!, darkestOfAll.at[1]!, dark) + lift;
    say(control < ink, `CONTROL: the same floor under a near-dark rig renders ${control.toFixed(4)}, below ink — the measure can fail`);
  }
}

console.log(`\nREADABLE — the ${BOOKS.length} readable books: within her reach, in their own slots of their own kind, inside their cases, each opening its own book:`);
{
  const heights = LIBRARY_READABLE_SLOTS.map((slot) => {
    const spec = LIBRARY_BOOKCASES.find((candidate) => candidate.id === slot.bookcase);
    return spec ? (libraryBookcaseSize(spec.kind).shelfTops[slot.shelf] ?? Infinity) : Infinity;
  });
  const highest = Math.max(...heights);
  say(
    LIBRARY_READABLE_SLOTS.length >= BOOKS.length && BOOKS.length > 0 && highest <= KID_REACH_HEIGHT,
    `${LIBRARY_READABLE_SLOTS.length} slots for ${BOOKS.length} books, the highest shelf ${highest.toFixed(3)} m, her reach ${KID_REACH_HEIGHT} m`,
  );
  // Slot i holds BOOKS[i] (the pairing is by index): every book's slot must be
  // of its own kind, so the picture books' slots come first, then the big
  // readers' — whichever list grows. Counted from BOOKS, never typed.
  const pictureSlots = LIBRARY_READABLE_SLOTS.filter((slot) => slot.kind === 'picture');
  const chapterSlots = LIBRARY_READABLE_SLOTS.filter((slot) => slot.kind === 'chapter');
  const firstChapterSlot = LIBRARY_READABLE_SLOTS.findIndex((slot) => slot.kind === 'chapter');
  const ordered = firstChapterSlot < 0 || LIBRARY_READABLE_SLOTS.slice(firstChapterSlot).every((slot) => slot.kind === 'chapter');
  const wrongKind = BOOKS.map((book, index) => ({ book, slot: LIBRARY_READABLE_SLOTS[index] })).filter(({ book, slot }) => slot?.kind !== book.kind);
  say(
    ordered && wrongKind.length === 0,
    `every one of the ${BOOKS.length} books stands on a slot of its own kind: ${pictureSlots.length} picture-book slots, then ${chapterSlots.length} on the big readers' shelf` +
      (wrongKind.length > 0 ? ` — wrong: ${wrongKind.map(({ book, slot }) => `${book.id} (${book.kind}) on ${slot ? `a ${slot.kind} slot` : 'no slot'}`).join(', ')}` : ''),
  );
  say(pictureSlots.length === PICTURE_BOOKS.length, `${pictureSlots.length} picture-book slots for the ${PICTURE_BOOKS.length} picture books`);
  // The six chapter books are all on the shelf (the books' join), so no big
  // readers' slot waits any more: one missing goes red here, never a WAIT.
  say(CHAPTER_BOOKS.length === chapterSlots.length, `${chapterSlots.length} big readers' slots for the ${CHAPTER_BOOKS.length} chapter books`);
  const shelves = libraryBookcaseSize('wall').shelfTops;
  say(shelves.some((top) => top > KID_REACH_HEIGHT), `CONTROL: the drawn case does have shelves out of her reach (${shelves.filter((top) => top > KID_REACH_HEIGHT).map((top) => top.toFixed(3)).join(', ')}), so the measure can say no`);

  // Which book the check expects in which slot: `shelfBooks.ts`'s pairing, by
  // index — read back here from the two lists, never from the pairing itself.
  // `shift-books` expects the next book along instead, which must go red,
  // naming the books.
  const shift = mutating('shift-books') ? 1 : 0;
  if (shift > 0) note('SHIFTED the pairing this check expects by one on purpose (slot i must hold BOOKS[i+1]) — this run must go red, naming the books');
  const expected = LIBRARY_READABLE_SLOTS.map((slot, i) => ({ slot, book: BOOKS[(i + shift) % BOOKS.length]! }));

  // Every `library.book.<id>` mesh in the room (an outline is `<…>.outline`).
  const named = new Map<string, Mesh[]>();
  library.roomRoot.traverse((object) => {
    const match = object instanceof Mesh ? /^library\.book\.([^.]+)$/.exec(object.name) : null;
    if (match) named.set(match[1]!, [...(named.get(match[1]!) ?? []), object as Mesh]);
  });
  const ids = BOOKS.map((book) => book.id);
  const meshCount = [...named.values()].reduce((sum, list) => sum + list.length, 0);
  const missing = ids.filter((id) => !named.has(id));
  const strays = [...named.keys()].filter((id) => !ids.includes(id));
  const twice = [...named.entries()].filter(([, list]) => list.length > 1).map(([id]) => id);
  say(
    meshCount === BOOKS.length && missing.length === 0 && strays.length === 0 && twice.length === 0,
    `${meshCount} library.book.* meshes for ${BOOKS.length} books — missing: ${missing.join(', ') || 'none'}; not a book: ${strays.join(', ') || 'none'}; drawn twice: ${twice.join(', ') || 'none'}`,
  );

  // Each in its slot: inside its case's drawn box, at its place along the
  // shelf, its base on its board, under the board above, in its cover's paint.
  const boxes = new Map(drawnBoxes().map((box) => [box.what, box]));
  const vertex = new Vector3();
  const at = new Vector3();
  let worstOut = { what: 'none', by: -Infinity };
  let placedOk = 0;
  for (const { slot, book } of expected) {
    const mesh = named.get(book.id)?.[0];
    const spec = LIBRARY_BOOKCASES.find((candidate) => candidate.id === slot.bookcase);
    const box = boxes.get(`bookcase ${slot.bookcase}`);
    const where = `slot ${slot.index + 1} (${slot.bookcase}, shelf ${slot.shelf}, ${slot.along} m along)`;
    if (!mesh || !spec || !box) {
      say(false, `${where} should hold '${book.id}', but there is ${!mesh ? 'no such book mesh' : 'no such case'}`);
      continue;
    }
    const size = libraryBookcaseSize(spec.kind);
    const shelfTop = size.shelfTops[slot.shelf] ?? Number.NaN;
    const boardAbove = shelfTop + (size.shelfClear[slot.shelf] ?? Number.NaN);
    mesh.getWorldPosition(at);
    const lx = at.x - OX;
    const lz = at.z - OZ;
    const inside = outsideBox(box, lx, lz);
    const yaw = (box.facing * Math.PI) / 180;
    const along = (lx - box.x) * Math.cos(yaw) - (lz - box.z) * Math.sin(yaw);
    // Every drawn vertex of the book itself — never its ink outline, which is
    // a child and as far past the paper as the case's own ink is past its wood.
    mesh.updateWorldMatrix(true, false);
    const position = mesh.geometry.getAttribute('position') as BufferAttribute;
    let base = Infinity;
    let top = -Infinity;
    let out = -Infinity;
    for (let i = 0; i < position.count; i += 1) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      base = Math.min(base, vertex.y - LIBRARY_FLOOR_Y); // flat-ok: heights over the reading room's own flat floor, off the sphere
      top = Math.max(top, vertex.y - LIBRARY_FLOOR_Y); // flat-ok: as above
      out = Math.max(out, outsideBox(box, vertex.x - OX, vertex.z - OZ));
    }
    if (out > worstOut.by) worstOut = { what: book.id, by: out };
    const painted = (mesh.material as MeshToonMaterial).color.equals(new Color(PALETTE[book.cover]));
    const ok = inside < 0 && Math.abs(along - slot.along) < 0.005 && Math.abs(base - shelfTop) <= 0.02 && top < boardAbove && out <= 1e-6 && painted;
    if (ok) {
      placedOk += 1;
      continue;
    }
    say(
      false,
      `${where} should hold '${book.id}': its mesh stands ${inside < 0 ? `${(-inside).toFixed(3)} m inside` : `${inside.toFixed(3)} m OUTSIDE`} ${slot.bookcase}'s drawn box, ` +
        `${along.toFixed(3)} m along it (the slot: ${slot.along}); its base at ${base.toFixed(3)} m (the shelf: ${shelfTop.toFixed(3)}), its top at ${top.toFixed(3)} m (the board above: ${boardAbove.toFixed(3)}); ` +
        `its furthest drawn point ${out <= 1e-6 ? 'inside' : `${out.toFixed(3)} m PAST`} the case's drawn box; painted ${painted ? 'its cover' : 'NOT its cover'}`,
    );
  }
  say(
    placedOk === BOOKS.length,
    `${placedOk} of ${BOOKS.length} readable books stand in their own slots: inside their case's drawn box, every drawn point of them (drawn implies solid — ` +
      'the case\'s capsules cover it), at their slot\'s place along the shelf, the base within 0.02 m of the board, under the board above, in their cover\'s paint',
  );
  const nearest = Math.abs(worstOut.by) <= 1e-6 ? 'flush with it' : worstOut.by < 0 ? `${(-worstOut.by).toFixed(4)} m inside it` : `${worstOut.by.toFixed(4)} m PAST it`;
  note(
    `the readable books lean ${READABLE_LEAN} rad and stand up to ${READABLE_PROUD} m proud of their rows, as far as their case's front allows; ` +
      `the nearest any drawn point of one comes to leaving its case's drawn box: ${nearest} ('${worstOut.what}')`,
  );

  // The Read zones, with a probe standing in the room the way DOORS stood one.
  const probe = {
    position: new Vector3(0, 0, 0),
    previousPosition: new Vector3(0, 0, 0),
    riding: false,
    model: { height: 2.12 },
    topHeight: 2.12,
    teleportTo(x: number, y: number, z: number) {
      probe.position.set(x, y, z);
      probe.previousPosition.set(x, y, z);
    },
  };
  library.attachPlayer(probe as never);
  const context = { dt: 1 / 60, elapsed: 1, playerPosition: probe.position, frame: 1 } as unknown as FrameContext;
  const settle = (): void => {
    for (let i = 0; i < 70; i += 1) library.update(context);
  };
  const bookZones = (): InteractZone[] => library.interactZones().filter((zone) => zone.id.startsWith(SHELF_BOOK_ZONE_PREFIX));
  library.requestEnter();
  settle();
  const zones = bookZones();
  const zoneIds = zones.map((zone) => zone.id);
  const wanted = ids.map((id) => shelfBookZoneId(id));
  say(
    library.playerIsInside && zones.length === BOOKS.length && wanted.every((id) => zoneIds.includes(id)),
    `inside, standing in the room: ${zones.length} Read zones for ${BOOKS.length} books, ${wanted.filter((id) => !zoneIds.includes(id)).length} book(s) without one`,
  );
  probe.riding = true;
  const whileRiding = bookZones().length;
  probe.riding = false;
  say(whileRiding === 0, `while she is riding (sat down), the room offers ${whileRiding} Read zones`);
  library.requestEnterDoor();
  settle();
  const outside = bookZones().length;
  say(!library.playerIsInside && outside === 0, `outside on the doormat: ${outside} Read zones (inside: ${library.playerIsInside})`);
  library.requestEnter();
  settle();

  // Each zone in its slot, read against the expected pairing.
  let zonesOk = 0;
  for (const { slot, book } of expected) {
    const zone = zones.find((candidate) => candidate.id === shelfBookZoneId(book.id));
    const mesh = named.get(book.id)?.[0];
    if (!zone || !mesh) {
      say(false, `slot ${slot.index + 1} (${slot.bookcase}): no Read zone, or no mesh, for '${book.id}'`);
      continue;
    }
    mesh.getWorldPosition(at);
    const standOff = Math.hypot(zone.standX - (OX + slot.stand.x), zone.standZ - (OZ + slot.stand.z));
    const offBook = Math.hypot(zone.x - at.x, zone.z - at.z);
    const ringed = zone.highlight?.object === mesh;
    if (standOff < 1e-9 && offBook < 1e-6 && ringed && zone.label === book.title) {
      zonesOk += 1;
      continue;
    }
    say(
      false,
      `'${zone.id}' should be stood at slot ${slot.index + 1}'s stand (${slot.stand.what}, (${slot.stand.x.toFixed(2)}, ${slot.stand.z.toFixed(2)})): it is ${standOff.toFixed(3)} m off it; ` +
        `it is ${offBook.toFixed(3)} m off its book; the rainbow ${ringed ? 'rings' : 'does NOT ring'} its book; labelled '${zone.label}'`,
    );
  }
  say(zonesOk === BOOKS.length, `${zonesOk} of ${BOOKS.length} Read zones stand her at their slot's stand, sit on their own book, ring it in the rainbow and carry its title`);

  // A stub opener: pressing every zone's primary action opens that zone's book.
  const opened: string[] = [];
  library.attachBookReader({
    open: (bookId) => {
      opened.push(bookId);
      return true;
    },
    isOpen: () => false,
  });
  const chips: string[] = [];
  for (const zone of zones) {
    const primary = zone.actions?.().find((action) => action.id === PRIMARY_ACTION);
    chips.push(primary?.label ?? '(no chip)');
    primary?.run();
  }
  const pressed = opened.map((bookId) => shelfBookZoneId(bookId));
  const wrong = zoneIds.filter((id, i) => pressed[i] !== id);
  say(
    pressed.length === zones.length && zones.length > 0 && wrong.length === 0,
    `a stub opener, pressed through all ${zones.length} zones' primary actions, recorded ${opened.length} opens — each the zone's own book (${wrong.length === 0 ? 'none wrong' : `wrong: ${wrong.join(', ')}`})`,
  );
  say(chips.length > 0 && chips.every((chip) => chip === LIBRARY_CHIPS.read), `every zone's chip says "${LIBRARY_CHIPS.read}" (${[...new Set(chips)].map((chip) => `"${chip}"`).join(', ')})`);
  library.attachBookReader(null);
  let threw = '';
  try {
    for (const zone of zones) zone.actions?.().find((action) => action.id === PRIMARY_ACTION)?.run();
  } catch (error) {
    threw = String(error);
  }
  say(threw === '', `with no reader attached (headless), pressing every chip is harmless${threw ? ` — it threw ${threw}` : ''}`);

  // A book in a stack fades with its stack, outline and all; one on a wall case never does.
  const stacked = library.shelfBooks.find((placed) => library.stacks.some((stack) => stack.id === placed.slot.bookcase));
  const walled = library.shelfBooks.find((placed) => !library.stacks.some((stack) => stack.id === placed.slot.bookcase));
  const stack = stacked ? library.stacks.find((candidate) => candidate.id === stacked.slot.bookcase) : undefined;
  if (!stacked || !stack || !walled) {
    say(false, `the fade clause measures nothing: a readable book in a stack ${stacked ? 'found' : 'NOT found'}, one on a wall case ${walled ? 'found' : 'NOT found'}`);
  } else {
    const alphas = (placed: typeof stacked): number[] => {
      const out: number[] = [];
      placed.mesh.traverse((part) => {
        if (part instanceof Mesh) out.push((part.material as MeshToonMaterial).opacity);
      });
      return out;
    };
    // Behind it from the camera, which looks in from the south-east: on its
    // north side, a body's width clear of it, in the aisle FADE stands in.
    const behind = { x: stack.centre.x, z: stack.centre.z - stack.halfDepth - PLAYER_RADIUS - 0.5 };
    probe.teleportTo(OX + behind.x, 0, OZ + behind.z);
    camera.snapTo(probe.position);
    for (let i = 0; i < 60; i += 1) library.update(context);
    const faded = alphas(stacked);
    const solidStill = alphas(walled);
    say(
      stack.alpha < 0.5 && faded.length >= 2 && faded.every((alpha) => alpha < 0.5),
      `standing behind ${stack.id} at (${behind.x.toFixed(2)}, ${behind.z.toFixed(2)}), the stack fades to ${stack.alpha.toFixed(2)} and its readable book '${stacked.book.id}' with it (book and outline: ${faded.map((alpha) => alpha.toFixed(2)).join(', ')})`,
    );
    say(
      solidStill.length >= 2 && solidStill.every((alpha) => alpha === 1),
      `CONTROL: '${walled.book.id}', on ${walled.slot.bookcase} (a wall case, which never fades), stays solid (${solidStill.map((alpha) => alpha.toFixed(2)).join(', ')})`,
    );
    // Back into the open central aisle, so every stack is solid again for what follows.
    probe.teleportTo(OX + 0.6, 0, OZ + 1.2);
    camera.snapTo(probe.position);
    for (let i = 0; i < 90; i += 1) library.update(context);
  }
  note(`READABLE: ${BOOKS.length} books (BOOKS.length), ${LIBRARY_READABLE_SLOTS.length} slots, ${zones.length} zones pressed through a stub opener; the pairing read from books.ts and layout.ts by index`);
}

console.log('\nPAINTED FACES — the owl, the dragon and the cat wear their faces the right way up:');
{
  // The three heads carry their faces in their own UVs, authored the planar
  // way (`library_build.py`, "Faces"), so they are painted through
  // `planarUvCanvasTexture`. Read each head's UVs against its texture's own
  // `flipY` and ask which canvas row a vertex samples: higher on the head must
  // be nearer the top of the canvas, and the eye row must land above the mouth
  // row (the owl's, above her beak — she has no painted mouth). Painted through
  // the other helper, every face would wear its mouth over its eyes and no
  // frame would say so: the Reptile House's snakes did (2 October 2026).
  // Freshly built handles, so this measures the assets, not where a room put them.
  const handles = {
    owl: createLibraryOwl(),
    dragon: createLibraryDragon(),
    nest: createLibraryDragonNest(),
    cat: createLibraryCat(),
    pile: createLibraryBookPile(),
  };
  const sets: Readonly<Record<LibraryFacedHead, Readonly<Record<string, Texture>>>> = {
    'owl-head': owlFaceTextures(),
    'dragon-head': dragonFaceTextures(),
    'cat-head': catFaceTextures(),
  };
  if (mutating('faces-upside-down')) {
    let flipped = 0;
    for (const set of Object.values(sets)) {
      for (const texture of Object.values(set)) {
        texture.flipY = !texture.flipY;
        flipped += 1;
      }
    }
    note(`FLIPPED all ${flipped} painted faces the other way up on purpose (what painting them through glbCanvasTexture does) — this run must go red`);
  }
  const owners: Readonly<Record<LibraryFacedHead, { readonly root: Object3D; readonly rows: { readonly eye: number; readonly mouth?: number } }>> = {
    'owl-head': { root: handles.owl.root, rows: LIBRARY_FACE_ROWS.owl },
    'dragon-head': { root: handles.dragon.root, rows: LIBRARY_FACE_ROWS.dragon },
    'cat-head': { root: handles.cat.root, rows: LIBRARY_FACE_ROWS.cat },
  };
  const point = new Vector3();
  /** Every vertex of a mesh (never its outline, which is a child), as heights in its handle's frame. */
  const heightsOf = (mesh: Mesh): number[] => {
    const position = mesh.geometry.getAttribute('position') as BufferAttribute;
    const out: number[] = [];
    for (let i = 0; i < position.count; i += 1) out.push(point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).y);
    return out;
  };
  for (const head of LIBRARY_FACED_HEADS) {
    const { root, rows: faceRows } = owners[head];
    root.updateMatrixWorld(true);
    const mesh = root.getObjectByName(head);
    if (!(mesh instanceof Mesh)) {
      say(false, `${head}: no such mesh under its creature — nothing measured`);
      continue;
    }
    const map = (mesh.material as MeshToonMaterial).map;
    const position = mesh.geometry.getAttribute('position') as BufferAttribute;
    const uv = mesh.geometry.getAttribute('uv') as BufferAttribute | undefined;
    if (!map || !uv) {
      say(false, `${head} wears no painted face (map ${!!map}, uv ${!!uv})`);
      continue;
    }
    const ys: number[] = [];
    const rows: number[] = [];
    let parked = 0;
    for (let i = 0; i < uv.count; i += 1) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      // The back faces, parked at library_build.py's (0.02, 0.02) — (0.02, 0.98)
      // once the exporter's 1 − v has been applied: plain fill, no face.
      if (u < 0.05 && v > 0.95) {
        parked += 1;
        continue;
      }
      ys.push(point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).y);
      rows.push(map.flipY ? 1 - v : v);
    }
    if (ys.length < 30) {
      say(false, `${head}: only ${ys.length} front vertices carry the face (${parked} parked) — nothing to measure`);
      continue;
    }
    const fall = slope(ys, rows);
    const nearest = (target: number): number => rows.reduce((best, row, i) => (Math.abs(row - target) < Math.abs(rows[best]! - target) ? i : best), 0);
    const eyeY = ys[nearest(faceRows.eye)]!;
    const how = `${ys.length} front vertices (${parked} parked), the canvas row ${fall < 0 ? 'falls' : 'RISES'} ${Math.abs(fall).toFixed(2)}/m as the head rises (flipY ${map.flipY})`;
    if (faceRows.mouth === undefined) {
      const beak = root.getObjectByName('owl-beak');
      const beakTop = beak instanceof Mesh ? Math.max(...heightsOf(beak)) : Number.NaN;
      say(fall < 0 && eyeY > beakTop, `${head}: ${how}; the eye row lands at y ${eyeY.toFixed(3)}, over the beak's top at ${beakTop.toFixed(3)}`);
    } else {
      const mouthY = ys[nearest(faceRows.mouth)]!;
      say(fall < 0 && eyeY > mouthY, `${head}: ${how}; the eye row lands at y ${eyeY.toFixed(3)} and the mouth row at y ${mouthY.toFixed(3)}`);
    }
    const image = map.image as { readonly width: number; readonly height: number };
    const size = libraryFaceCanvasSize(head);
    note(`${head}: canvas ${image.width} x ${image.height} (asked ${size.width} x ${size.height}); slope ${fall.toFixed(3)}`);
  }
  const showing = new Set<Texture>();
  for (const handle of Object.values(handles)) {
    handle.root.traverse((object) => {
      if (object instanceof Mesh && (object.material as MeshToonMaterial).map) showing.add((object.material as MeshToonMaterial).map!);
    });
  }
  const painted = Object.entries(sets).map(([head, set]) => `${head.replace('-head', '')} ${Object.keys(set).length}`);
  const total = Object.values(sets).reduce((sum, set) => sum + Object.keys(set).length, 0);
  note(
    `textures: ${showing.size} face canvases showing under the five creature handles, ${total} painted in all (${painted.join(', ')}) — ` +
      "the creatures' share of ASSET_MANIFEST's informal under-40 budget",
  );
}

// ---------------------------------------------------------------------------
// WITH A REAL CHILD — a real Player, stepped the game's way, steered by the stick.
// ---------------------------------------------------------------------------

/** One frame of the real child: the game's 60 fps. */
const CHILD_DT = 1 / 60;

/** A thumb on the stick for one frame: called after `input.update()`, before anything reads the input. */
type Steer = (input: InputSystem) => void;

/**
 * **The real child — the harness every clause from here on drives** (plan
 * Step 6's recipe, which is `check-labels.mts`'s).
 *
 * The DOORS probe above is a position and two flags. From here on she is a
 * real `Player` in the real park — her own collision, ground sampler, walk
 * and face — attached the way `Game` attaches her (`world.attachPlayer`, which
 * also takes the probe's place in the Library). One {@link RealChild.step} is
 * the game's own order for everything a library clause reads, at 1/60 s:
 *
 *     input.update → (steer) → player.update → camera.update → library.update → world.npcs.update
 *
 * `world.npcs.update` is in it so the library's children (#718, Step 8) walk
 * exactly as the game walks them.
 *
 * - `child.enter(at?)` — into the reading room through `Library.requestEnter`,
 *   the road `/library?at=x,z&facing=deg` takes; without `at`, at the arrival.
 *   Headless, the iris is instant, so she is there when it returns; the camera
 *   is snapped onto her the way the iris snaps it.
 * - `child.stand(x, z, facing?)` — stand her at a room-local spot (degrees, the
 *   layout's convention) without a change of space; for a clause already inside.
 * - `child.step(steer?)`, `child.run(seconds, steer?)` — frames.
 * - `child.towards(dx, dz, sprint?, amount?)` — a {@link Steer} that holds the
 *   stick the way a thumb would to walk her along world direction (dx, dz): the
 *   stick is camera-relative, so it is solved from the live camera's ground
 *   basis, and fed in through `input.setNavigationMove` (tap-to-move's road
 *   into the same stick). `amount` is how far the stick is pushed (1, full
 *   tilt; less walks her slower, as the stick does). Sprint is
 *   `setNavigationSprint`, released every frame a steer does not ask for it.
 * - `child.room()` — where she stands, room-local.
 * - `child.player`, `child.input`, `child.frames` — the real ones, for the
 *   rest (`input.pressVirtual('jump')`, `player.isRunning`, `player.riding`…).
 *
 * Parts 4 and 5 add their clauses below the harness's own, each track after
 * its own marker. Leave her as you found her: standing in the reading room,
 * not riding, with nothing of yours still running.
 */
interface RealChild {
  readonly player: Player;
  readonly input: InputSystem;
  /** Frames stepped so far. */
  readonly frames: number;
  step(steer?: Steer): void;
  run(seconds: number, steer?: Steer): void;
  enter(at?: { readonly x: number; readonly z: number; readonly facing?: number }): void;
  stand(x: number, z: number, facing?: number): void;
  towards(dx: number, dz: number, sprint?: boolean, amount?: number): Steer;
  room(): { readonly x: number; readonly z: number };
  /** Steps one more of `Game`'s systems after the crowd every frame from now on (her pets' parade, STORY). */
  also(system: { update(context: FrameContext): void }): void;
}

const child: RealChild = (() => {
  const player = quietly(() => new Player(world.collision, camera, new Vector3(OX + LIBRARY_ARRIVAL.x, LIBRARY_FLOOR_Y, OZ + LIBRARY_ARRIVAL.z)));
  scene.add(player.group);
  quietly(() => world.attachPlayer(player));
  const input = new InputSystem();
  const context = { dt: CHILD_DT, elapsed: 0, input, playerPosition: player.position, cameraForward: camera.forward, frame: 0 };
  const extra: { update(frame: FrameContext): void }[] = [];
  let frames = 0;
  const step = (steer?: Steer): void => {
    input.update();
    input.setNavigationSprint(false);
    steer?.(input);
    context.frame = frames;
    context.elapsed = frames * CHILD_DT;
    quietly(() => {
      player.update(context);
      camera.update(context, player.position, player.velocity);
      library.update(context);
      world.npcs.update(context);
      for (const system of extra) system.update(context);
    });
    frames += 1;
  };
  return {
    player,
    input,
    get frames() {
      return frames;
    },
    step,
    run(seconds, steer) {
      for (let i = 0; i < Math.round(seconds / CHILD_DT); i += 1) step(steer);
    },
    enter(at) {
      if (!quietly(() => library.requestEnter(at))) throw new Error('WITH A REAL CHILD: Library.requestEnter refused her (riding, or a change of space already running)');
      camera.snapTo(player.position);
    },
    stand(x, z, facing) {
      player.teleportTo(OX + x, LIBRARY_FLOOR_Y, OZ + z, facing === undefined ? undefined : (facing * Math.PI) / 180);
      camera.snapTo(player.position);
    },
    towards(dx, dz, sprint = false, amount = 1) {
      const length = Math.hypot(dx, dz);
      if (length === 0) throw new Error('WITH A REAL CHILD: towards() needs a direction');
      if (!(amount > 0 && amount <= 1)) throw new Error(`WITH A REAL CHILD: towards() wants a stick amount in (0, 1], not ${amount}`);
      const x = (dx / length) * amount;
      const z = (dz / length) * amount;
      return (held) => {
        const right = camera.right;
        const forward = camera.forward;
        held.setNavigationMove(x * right.x + z * right.z, x * forward.x + z * forward.z);
        held.setNavigationSprint(sprint);
      };
    },
    room() {
      return { x: player.position.x - OX, z: player.position.z - OZ };
    },
    also(system) {
      extra.push(system);
    },
  };
})();

// Story time (plan Step 9) calls itself forty seconds into a visit. The clauses before STORY measure
// the owl and the children at other things, over minutes of the room's time, so its clock is held
// until STORY — which asks for its story, and then lets the clock go and measures the call itself.
library.storyTime.holdClock(true);

console.log('\nWITH A REAL CHILD — a real Player, from the arrival, walks up the central aisle on the stick:');
{
  child.enter();
  const start = child.room();
  say(
    library.playerIsInside && Math.hypot(start.x - LIBRARY_ARRIVAL.x, start.z - LIBRARY_ARRIVAL.z) < 0.01,
    `the real child enters at the arrival: (${start.x.toFixed(2)}, ${start.z.toFixed(2)}), inside ${library.playerIsInside}`,
  );
  // `block-walk`: a wall across the aisle a metre ahead of her, the width of the
  // entrance hall — her way into the room is shut, so she cannot travel.
  const blocker = mutating('block-walk')
    ? collision.addWall(OX + LIBRARY_ARRIVAL.x - 3, OZ + LIBRARY_ARRIVAL.z - 1, OX + LIBRARY_ARRIVAL.x + 3, OZ + LIBRARY_ARRIVAL.z - 1, 0.2)
    : null;
  if (blocker) note(`BUILT a wall across the central aisle at z ${(LIBRARY_ARRIVAL.z - 1).toFixed(1)}, a metre ahead of the arrival, on purpose — this run must go red`);
  // Up the central aisle: the room's -Z, away from the door.
  const up = child.towards(0, -1);
  const seconds = 2;
  let pushed = 0;
  let offFloor = 0;
  const frames = Math.round(seconds / CHILD_DT);
  for (let i = 0; i < frames; i += 1) {
    child.step(up);
    if (child.input.moveAmount > 0.99) pushed += 1;
    offFloor = Math.max(offFloor, Math.abs(child.player.position.y - LIBRARY_FLOOR_Y)); // flat-ok: the reading room is its own flat space at (-600, -600), off the sphere; her height above its one floor
  }
  const end = child.room();
  const travelled = Math.hypot(end.x - start.x, end.z - start.z);
  say(
    pushed === frames && travelled >= 1.5 && offFloor <= 0.02 && library.playerIsInside,
    `steered up the central aisle for ${seconds} s (the stick pushed on ${pushed} of ${frames} frames), she travelled ${travelled.toFixed(2)} m (at least 1.5) ` +
      `to (${end.x.toFixed(2)}, ${end.z.toFixed(2)}), her feet never more than ${offFloor.toFixed(3)} m off the floor (0.02 allowed), still inside: ${library.playerIsInside}`,
  );
  if (blocker) collision.removeWall(blocker);
  note(`the real child: ${child.frames} frames stepped; camera forward (${camera.forward.x.toFixed(2)}, ${camera.forward.z.toFixed(2)}), right (${camera.right.x.toFixed(2)}, ${camera.right.z.toFixed(2)})`);
}

// ── Track A (#718: the readable shelves and the owl, plan Steps 5-6) adds its WITH A REAL CHILD clauses below this line. ──

/**
 * **OWL, CARD, RECOMMEND, SHUSH** (#718, plan Step 6) — the owl librarian at
 * her desk (`LibraryOwl.ts`), on the real child.
 *
 * Every threshold is the game's own: the owl's radius and height are read off
 * her registered solid, the shush's run and cooldown off `LibraryOwl.ts`, a
 * blink's length off `faceLife.ts`, the recommendation's order off
 * `recommendation.ts` and restated here as "the first unread in it". The label
 * manager is given a landscape-phone screen (`camera.resize`) so a bubble can
 * be measured and granted the way the game grants it; the stick's basis is the
 * camera's and does not change with its frame, so the SIT clause after this
 * walks exactly as before.
 *
 * Proved red by `LIBRARY_CHECK_REMOVE='the owl'` (her middle is reachable and
 * a body marches into her disc), `LIBRARY_CHECK_MUTATE=card-twice` (the check
 * hands her a second card through the non-idempotent `catchWildPet`), and by
 * hand: `Player.isRunning` without its speed (the walking CONTROL shushes) and
 * `LibraryOwl.glow` without its `isBookRead` reset (RECOMMEND: a read book
 * still glows).
 */
const owl = library.owl;
const owlSpot = LIBRARY_LIBRARIAN_SPOT;
/** The owl's Talk zone as the room offers it this frame, or undefined. */
const owlZone = (): InteractZone | undefined => library.interactZones().find((zone) => zone.id === OWL_ZONE_ID);
const owlOffer = (): readonly ZoneAction[] => owlZone()?.actions?.() ?? [];
/** How many library cards her inventory holds — the inventory is the one owner of "has she got the card" (`libraryCard.ts`). */
const cardsHeld = (): number => gameStore.get().inventory.filter((item) => item.id === LIBRARY_CARD.id).length;
/** Steps until the owl falls quiet, or `seconds` have passed, and hands back every line she said meanwhile. */
const untilQuiet = (seconds: number): Set<string> => {
  const said = new Set<string>();
  if (owl.lastSaid !== null && owl.speaking) said.add(owl.lastSaid);
  for (let i = 0; i < Math.round(seconds / CHILD_DT) && owl.speaking; i += 1) {
    child.step();
    if (owl.lastSaid !== null) said.add(owl.lastSaid);
  }
  return said;
};
/** The screen the label manager lays labels out on from here: a landscape phone. */
const SCREEN = { width: 1280, height: 720 } as const;
camera.resize(SCREEN.width, SCREEN.height);
const view = { camera: camera.camera, width: SCREEN.width, height: SCREEN.height };
/** What a sprint mid-card-script measured — CARD runs it (the script is only ever running then), SHUSH reports it. */
let midCard: { ran: boolean; shushed: number; wingLow: number; stayedOnScript: boolean; stillSpeaking: boolean; travelled: number } | null = null;

/**
 * **The owl as drawn, measured apart from her solid** — the radius her solid
 * must cover: a FRESH model (never the room's, never `LibraryOwl.radius`),
 * posed through every pose she holds standing at her desk — her head turned
 * anywhere in ±`HEAD_TURN_LIMIT` (21 turns), her breath at rest and at either
 * extreme of `BREATH_DEPTH` — and the largest plan reach of them
 * (`visibleReachXZ`). The instrument the OWL clause measures her solid, the
 * marches and the aisles against; reading her solid's own radius instead would
 * measure the collider against itself (the review of Step 6: a solid 20 % too
 * small passed every clause).
 */
const drawnOwlReach = ((): number => {
  const fresh = createLibraryOwl();
  let reach = 0;
  for (let i = 0; i <= 20; i += 1) {
    fresh.head.rotation.y = -HEAD_TURN_LIMIT + (2 * HEAD_TURN_LIMIT * i) / 20;
    for (const breath of [-BREATH_DEPTH, 0, BREATH_DEPTH]) {
      fresh.body.scale.set(1 + 0.6 * breath, 1 - breath, 1 + 0.6 * breath);
      reach = Math.max(reach, visibleReachXZ(fresh.root));
    }
  }
  return reach;
})();

/**
 * **The owl's drawn top at her tallest, measured apart** — a FRESH model's visible top with her breath at
 * rest and at either extreme of `BREATH_DEPTH` (her head rides her body, so a breath in lifts it): the
 * top every solid of hers must stand to, so a child stood on her head is never pierced by her ear tufts
 * as she breathes (NEVER INSIDE HER found that, with her solid's top at the rest pose's height).
 */
const drawnOwlTop = ((): number => {
  const fresh = createLibraryOwl();
  let top = 0;
  for (const breath of [-BREATH_DEPTH, 0, BREATH_DEPTH]) {
    fresh.body.scale.set(1 + 0.6 * breath, 1 - breath, 1 + 0.6 * breath);
    top = Math.max(top, visibleBounds(fresh.root).top);
  }
  return top;
})();

/** Every bearing (5° bins) where the drawn owl reaches past her solid, the furthest she reaches, and the bins a child can stand in. */
interface PastHerSolid {
  furthest: number;
  /** Frames measured — with a wing turned from rest; none means the gestures were never seen. */
  frames: number;
  readonly bins: Set<number>;
  readonly standable: Set<number>;
}
const pastHerSolid = (): PastHerSolid => ({ furthest: 0, frames: 0, bins: new Set(), standable: new Set() });
/** Her solid's radius as registered — read off the collision registration, never `LibraryOwl.radius`. */
const owlSolidRadius = library.solids.find((candidate) => candidate.what === 'the owl')?.radius ?? 0;
/**
 * **Where the live owl's drawn body reaches past her solid, and whether a
 * child could be standing there** — added into `into`, one frame. Every
 * visible point of her model, room-local, further from her spot than her
 * solid's radius + `RESOLVER_SLACK` is binned by its bearing from her; for
 * each new bin, a body of her size touching her solid along that bearing is
 * asked of the real world (`isClearCircle`). A bin a child can stand in is a
 * place where the drawn owl reaches into a child who is standing against her
 * — a wing through a child, the defect this exists to see. Measured on the
 * owl as the game poses her, whatever axis a gesture turns.
 */
const measurePastHerSolid = (radius: number, into: PastHerSolid): void => {
  into.frames += 1;
  visiblePoints(
    owl.handle.root,
    (point) => {
      const dx = point.x - owlSpot.x;
      const dz = point.z - owlSpot.z;
      const r = Math.hypot(dx, dz);
      if (r > into.furthest) into.furthest = r;
      if (r <= radius + RESOLVER_SLACK) return;
      const bin = Math.round((Math.atan2(dx, dz) * 180) / Math.PI / 5) * 5;
      if (into.bins.has(bin)) return;
      into.bins.add(bin);
      const toward = (bin * Math.PI) / 180;
      const x = owlSpot.x + Math.sin(toward) * (radius + PLAYER_RADIUS);
      const z = owlSpot.z + Math.cos(toward) * (radius + PLAYER_RADIUS);
      if (onPlate(x, z) && collision.isClearCircle(OX + x, OZ + z, PLAYER_RADIUS)) into.standable.add(bin);
    },
    library.roomRoot,
  );
};
/** The owl's wings at their widest — the card flap (CARD) and the shush wing (SHUSH) — measured live, asserted under SHUSH. */
const wingsWide = pastHerSolid();
/** Any wing of hers turned from rest — the frames worth measuring her at. */
const wingsOut = (): boolean =>
  Math.abs(owl.handle.wingL.rotation.x) + Math.abs(owl.handle.wingL.rotation.z) + Math.abs(owl.handle.wingR.rotation.x) + Math.abs(owl.handle.wingR.rotation.z) > 0.05;

/** A world point on the check's screen, through the game's own camera (CSS pixels, y down). */
const screenPoint = (world: Readonly<Vector3>): { x: number; y: number; ahead: boolean } => {
  camera.camera.updateMatrixWorld();
  const v = world.clone().project(camera.camera);
  return { x: ((v.x + 1) / 2) * SCREEN.width, y: ((1 - v.y) / 2) * SCREEN.height, ahead: v.z < 1 };
};
/**
 * **Where the owl's bubble is drawn on the screen, now**: its painted pill and tail (`contentBox`), the
 * sprite's corners laid out on the camera's own axes exactly as `LabelManager.measureSprite` lays them out
 * (and `owlBubbleBehindTheRoom` below), projected onto the check's screen — the rectangle anything behind it
 * is hidden by, since it is drawn over the scenery.
 */
const owlBubbleOnScreen = (): { x0: number; y0: number; x1: number; y1: number } => {
  const sprite = owl.bubble.sprite;
  const box = owl.bubble.contentBox;
  sprite.updateWorldMatrix(true, false);
  const e = sprite.matrixWorld.elements;
  const scaleX = Math.hypot(e[0]!, e[1]!, e[2]!);
  const scaleY = Math.hypot(e[4]!, e[5]!, e[6]!);
  const centre = new Vector3().setFromMatrixPosition(sprite.matrixWorld);
  camera.camera.updateMatrixWorld();
  const c = camera.camera.matrixWorld.elements;
  const right = new Vector3(c[0]!, c[1]!, c[2]!).normalize();
  const up = new Vector3(c[4]!, c[5]!, c[6]!).normalize();
  const rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const fx of [box.x0, box.x1]) {
    for (const fy of [box.y0, box.y1]) {
      const corner = centre
        .clone()
        .addScaledVector(right, (fx - sprite.center.x) * scaleX)
        .addScaledVector(up, (1 - fy - sprite.center.y) * scaleY);
      const at = screenPoint(corner);
      rect.x0 = Math.min(rect.x0, at.x);
      rect.y0 = Math.min(rect.y0, at.y);
      rect.x1 = Math.max(rect.x1, at.x);
      rect.y1 = Math.max(rect.y1, at.y);
    }
  }
  return rect;
};

console.log('\nOWL — the librarian at her desk: solid, and alive:');
{
  const player = child.player;
  const solid = library.solids.find((candidate) => candidate.what === 'the owl');
  say(
    !!solid &&
      solid.shape === 'wall' &&
      solid.points.length === 2 &&
      solid.points.every((point) => point.x === owlSpot.x && point.z === owlSpot.z) &&
      Math.abs(solid.top - drawnOwlTop) <= 0.002,
    `'the owl' is registered as a zero-length capsule at (${owlSpot.x}, ${owlSpot.z}): a disc of r ${solid?.radius.toFixed(3) ?? '?'}, ` +
      `top ${solid?.top.toFixed(3) ?? '?'} m against her drawn top at her tallest breath ${drawnOwlTop.toFixed(3)} m, measured apart (2 mm allowed; her rest pose's ${owl.handle.height.toFixed(3)})${solid ? '' : ' — NOT REGISTERED'}`,
  );
  const solidRadius = solid?.radius ?? 0;
  say(
    solidRadius >= drawnOwlReach - 0.002,
    `her solid covers her as drawn: r ${solidRadius.toFixed(3)} against her drawn plan reach ${drawnOwlReach.toFixed(3)} m, measured apart on a fresh model ` +
      `across every pose she holds at her desk (head anywhere in ±${HEAD_TURN_LIMIT} rad, breath ±${BREATH_DEPTH}; 2 mm allowed)`,
  );
  say(drawnOwlReach > 0.5 && drawnOwlReach < 0.9, `her drawn reach is a round owl's: ${drawnOwlReach.toFixed(3)} m (0.5..0.9 wanted; the Artist's body alone is ±0.40, her head and glasses reach further)`);
  say(!libraryKeepOuts().some((spot) => spot.what === owlSpot.what), `${owlSpot.what} is no longer a keep-out (${libraryKeepOuts().length} keep-outs, none of them hers)`);
  const seen = fill(collision, OX + LIBRARY_ARRIVAL.x, OZ + LIBRARY_ARRIVAL.z);
  say(!reachedAt(seen, OX + owlSpot.x, OZ + owlSpot.z), `the fill does not reach her middle at (${owlSpot.x}, ${owlSpot.z}) — she is solid (${seen.reached.size} cells reached from the arrival)`);
  // Marched at her from sixteen bearings, as MARCHED marches at every box: a body's edge never gets into her drawn disc.
  let marches = 0;
  let skipped = 0;
  let deepest = -Infinity;
  const reach = drawnOwlReach + 2.2;
  for (let b = 0; b < 16; b += 1) {
    const angle = (b / 16) * Math.PI * 2;
    const start = new Vector3(OX + owlSpot.x + Math.cos(angle) * reach, 0, OZ + owlSpot.z + Math.sin(angle) * reach);
    if (!onPlate(start.x - OX, start.z - OZ) || !collision.isClearCircle(start.x, start.z, PLAYER_RADIUS)) {
      skipped += 1;
      continue;
    }
    for (const step of [0.05, PLAYER_LONGEST_STEP]) {
      marches += 1;
      const end = march(collision, start, new Vector3(OX + owlSpot.x, 0, OZ + owlSpot.z), step, reach + 1);
      deepest = Math.max(deepest, PLAYER_RADIUS - (Math.hypot(end.x - OX - owlSpot.x, end.z - OZ - owlSpot.z) - drawnOwlReach));
    }
  }
  say(
    marches >= 16 && deepest <= RESOLVER_SLACK,
    `${marches} marches at her from ${16 - skipped} bearings (${skipped} starts skipped: off the plate or inside a solid — the desk stands in front of her): ` +
      `the deepest a body's edge got into her drawn disc (r ${drawnOwlReach.toFixed(3)}, measured apart) is ${deepest.toFixed(3)} m (allowance ${RESOLVER_SLACK})`,
  );
  let nearestAisle = { id: '', clearance: Infinity };
  for (const aisle of LIBRARY_AISLES) {
    for (let i = 0; i + 1 < aisle.points.length; i += 1) {
      const clearance = segmentDistance(aisle.points[i]!, aisle.points[i + 1]!, owlSpot) - drawnOwlReach - PLAYER_RADIUS;
      if (clearance < nearestAisle.clearance) nearestAisle = { id: aisle.id, clearance };
    }
  }
  say(nearestAisle.clearance >= 0, `AISLES above swept every aisle with her in the world; the nearest, '${nearestAisle.id}', passes ${nearestAisle.clearance.toFixed(3)} m clear of her drawn disc (r ${drawnOwlReach.toFixed(3)}) at a player's radius`);

  // Out of the door and back in to the desk's front: a visit — which is when she is invited over.
  if (!quietly(() => library.requestEnterDoor())) throw new Error('OWL: /library-door refused her (riding, or a change of space already running)');
  camera.snapTo(player.position);
  child.run(0.2);
  if (library.playerIsInside) throw new Error('OWL: she is still inside after /library-door, so nothing below would be a fresh visit');
  child.enter({ x: LIBRARY_DESK_STAND.x, z: LIBRARY_DESK_STAND.z, facing: LIBRARY_DESK_STAND.facing });
  child.step();
  say(
    owl.speaking && owl.lastSaid === LIBRARY_LINES.owl.welcome && cardsHeld() === 0,
    `coming in without her card (${cardsHeld()} held), the owl invites her over: "${owl.lastSaid ?? ''}" (wanted "${LIBRARY_LINES.owl.welcome}")`,
  );

  // Blink: quiet at the desk for 15 s, her face changes (she blinks) and is never held changed longer than a blink.
  untilQuiet(6);
  const resting = owl.handle.headMaterial.map;
  const restingFace = owl.handle.face;
  let changes = 0;
  let run = 0;
  let longest = 0;
  let spoke = false;
  for (let i = 0; i < Math.round(15 / CHILD_DT); i += 1) {
    child.step();
    spoke ||= owl.speaking;
    if (owl.handle.headMaterial.map !== resting) {
      if (run === 0) changes += 1;
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  const blinkFrames = Math.ceil(BLINK_DURATION * 60) + 2;
  say(
    !spoke && restingFace === 'neutral' && changes >= 1 && longest <= blinkFrames,
    `quiet at the desk for 15 s (resting face '${restingFace}'; spoke meanwhile: ${spoke}), her face changed ${changes} time(s) — she blinks — ` +
      `and was never held changed longer than ${longest} frame(s) (a blink: at most ${blinkFrames}, from BLINK_DURATION ${BLINK_DURATION} s)`,
  );

  // Head-turn: 3 m to either side of her for 2 s each. The direction her face
  // points is measured off the head's own +Z axis in the world, never assumed
  // from a sign; the sign is then reported as found.
  const look = (side: number): { rot: number; dot: number; clear: boolean } => {
    const at = { x: owlSpot.x + side * 3, z: owlSpot.z };
    const clear = collision.isClearCircle(OX + at.x, OZ + at.z, PLAYER_RADIUS);
    child.stand(at.x, at.z, side > 0 ? 270 : 90);
    child.run(2);
    const dir = owl.handle.head.getWorldDirection(new Vector3());
    dir.y = 0;
    dir.normalize();
    const toward = new Vector3(player.position.x - (OX + owlSpot.x), 0, player.position.z - (OZ + owlSpot.z)).normalize();
    return { rot: owl.handle.head.rotation.y, dot: dir.dot(toward), clear };
  };
  const left = look(1);
  const right = look(-1);
  const canTurnTo = ((Math.PI / 2 - HEAD_TURN_LIMIT) * 180) / Math.PI;
  say(
    left.clear && right.clear && Math.abs(left.rot) > 0.4 && Math.abs(right.rot) > 0.4 && Math.sign(left.rot) !== Math.sign(right.rot),
    `stood 3 m to either side of her for 2 s each (both spots clear floor: ${left.clear && right.clear}), her head turns: rotation.y ${left.rot.toFixed(3)} with the child at +X, ` +
      `${right.rot.toFixed(3)} at −X — opposite signs, each beyond 0.4 rad (the turn is clamped at ±${HEAD_TURN_LIMIT})`,
  );
  say(
    left.dot >= 0.8 && right.dot >= 0.8,
    `and it turns TOWARD her, measured off the head's own axis: within ${((Math.acos(Math.min(1, Math.min(left.dot, right.dot))) * 180) / Math.PI).toFixed(0)}° of the child on both sides ` +
      `(cos ≥ 0.8 wanted; a head that turns at most ${HEAD_TURN_LIMIT} rad to a child 90° round can get within ${canTurnTo.toFixed(0)}°)`,
  );
  // CONTROL: beyond her look range, straight ahead.
  const far = { x: owlSpot.x - (OWL_LOOK_RANGE + 3), z: owlSpot.z + 2 };
  const farClear = collision.isClearCircle(OX + far.x, OZ + far.z, PLAYER_RADIUS);
  child.stand(far.x, far.z, 90);
  child.run(2);
  say(farClear && Math.abs(owl.handle.head.rotation.y) < 0.05, `CONTROL: stood ${Math.hypot(far.x - owlSpot.x, far.z - owlSpot.z).toFixed(1)} m away (clear: ${farClear}; her look range ${OWL_LOOK_RANGE}), her head comes back to straight ahead: ${owl.handle.head.rotation.y.toFixed(3)} rad`);
  note(`OWL: solid r ${owl.radius.toFixed(3)}, drawn ${drawnOwlReach.toFixed(3)}, top ${owl.handle.height.toFixed(3)}; blink changes ${changes}, longest ${longest} frame(s); head ${left.rot.toFixed(2)} / ${right.rot.toFixed(2)}; ${child.frames} frames stepped so far`);
}

console.log('\nCARD — her library card, on the first press at the desk:');
{
  const player = child.player;
  child.stand(LIBRARY_DESK_STAND.x, LIBRARY_DESK_STAND.z, LIBRARY_DESK_STAND.facing);
  child.run(0.3);
  say(!hasLibraryCard(gameStore.get()) && cardsHeld() === 0, `on a fresh store she has no library card (${cardsHeld()} held; hasLibraryCard ${hasLibraryCard(gameStore.get())})`);
  const zone = owlZone();
  const offer = owlOffer();
  const reach = zone ? Math.hypot(player.position.x - zone.standX, player.position.z - zone.standZ) : Infinity;
  say(
    !!zone && offer.length === 1 && offer[0]?.id === PRIMARY_ACTION && offer[0].label === LIBRARY_CHIPS.getCard && reach <= standRadiusOf(zone),
    `at the desk's front (${reach.toFixed(2)} m from her zone's stand, reach ${zone ? standRadiusOf(zone) : '?'}) the owl offers '${offer[0]?.label ?? 'nothing'}' (wanted '${LIBRARY_CHIPS.getCard}'), verb '${zone?.verb ?? '?'}'`,
  );
  const shushesBefore = owl.shushes;
  offer[0]?.run();
  const atOnce = hasLibraryCard(gameStore.get());
  if (mutating('card-twice')) {
    gameStore.catchWildPet(LIBRARY_CARD);
    note('GAVE her a second card through the non-idempotent catchWildPet on purpose — this run must go red');
  }
  say(atOnce && cardsHeld() === 1, `pressing it gives her the card at once (${atOnce}): ${cardsHeld()} '${LIBRARY_CARD.id}' in her inventory (exactly one wanted)`);
  say(owl.midScript && owl.lastSaid === LIBRARY_LINES.owl.card[0], `and starts her script: "${owl.lastSaid ?? ''}" (wanted "${LIBRARY_LINES.owl.card[0]}")`);
  // A second press mid-ceremony — an E press or a tap commits the zone's primary action whether or
  // not its chip is drawn (Selection.handleInteractPress) — does nothing: the script goes on.
  const pressedAgain = owlOffer()[0];
  pressedAgain?.run();
  say(
    !!pressedAgain && owl.midScript && owl.lastSaid === LIBRARY_LINES.owl.card[0] && owl.recommendedBookId === null && cardsHeld() === 1,
    `pressed again mid-ceremony ('${pressedAgain?.label ?? 'nothing offered'}'), she carries on: still "${owl.lastSaid ?? ''}" (mid-script ${owl.midScript}), ` +
      `nothing recommended (${owl.recommendedBookId ?? 'none'}), ${cardsHeld()} card`,
  );

  // Mid-script, a sprint — measured here, where the script is running; reported under SHUSH.
  child.run(0.4);
  const from = child.room();
  let ran = false;
  let wingLow = 0;
  let stayedOnScript = true;
  for (let i = 0; i < Math.round(1.2 / CHILD_DT); i += 1) {
    child.step(child.towards(-1, 0, true));
    ran ||= player.isRunning;
    wingLow = Math.min(wingLow, owl.handle.wingL.rotation.x);
    stayedOnScript &&= owl.lastSaid !== null && (LIBRARY_LINES.owl.card as readonly string[]).includes(owl.lastSaid);
  }
  const to = child.room();
  midCard = { ran, shushed: owl.shushes - shushesBefore, wingLow, stayedOnScript, stillSpeaking: owl.midScript, travelled: Math.hypot(to.x - from.x, to.z - from.z) };

  // Back to the desk for the rest of the ceremony: every line in turn, and the flap on the hand-over.
  child.stand(LIBRARY_DESK_STAND.x, LIBRARY_DESK_STAND.z, LIBRARY_DESK_STAND.facing);
  const said = new Set<string>(owl.lastSaid === null ? [] : [owl.lastSaid]);
  let flapLow = 0;
  /** The card's sparkles on the hand-over line, frame by frame: how many were drawn on the screen, and how many of those behind her bubble. */
  const sparkles = { frames: 0, seen: 0, underBubble: 0, first: '' };
  const handOver = LIBRARY_LINES.owl.card[LIBRARY_LINES.owl.cardCheerAt];
  for (let i = 0; i < Math.round(20 / CHILD_DT) && owl.speaking; i += 1) {
    child.step();
    if (owl.lastSaid !== null) said.add(owl.lastSaid);
    flapLow = Math.min(flapLow, owl.handle.wingR.rotation.x);
    if (wingsOut()) measurePastHerSolid(owlSolidRadius, wingsWide);
    if (owl.lastSaid !== handOver) continue;
    const live = owl.cardSparkles.sprites.filter((sprite) => sprite.visible);
    if (live.length === 0) continue;
    sparkles.frames += 1;
    const bubble = owlBubbleOnScreen();
    for (const sprite of live) {
      const at = screenPoint(sprite.getWorldPosition(new Vector3()));
      if (!at.ahead || at.x < 0 || at.x > SCREEN.width || at.y < 0 || at.y > SCREEN.height) continue;
      sparkles.seen += 1;
      if (at.x >= bubble.x0 && at.x <= bubble.x1 && at.y >= bubble.y0 && at.y <= bubble.y1) {
        sparkles.underBubble += 1;
        if (!sparkles.first) sparkles.first = `a sparkle at (${at.x.toFixed(0)}, ${at.y.toFixed(0)}) px inside her bubble's (${bubble.x0.toFixed(0)}, ${bubble.y0.toFixed(0)})–(${bubble.x1.toFixed(0)}, ${bubble.y1.toFixed(0)})`;
      }
    }
  }
  const lines = LIBRARY_LINES.owl.card;
  say(
    lines.every((line) => said.has(line)) && !owl.speaking,
    `her ${lines.length} card lines were said in turn and the bubble went away: ${[...said].map((line) => `"${line}"`).join(', ')}`,
  );
  say(flapLow <= -0.3, `on the hand-over line (#${LIBRARY_LINES.owl.cardCheerAt + 1}) she flapped the wing that holds her book forward, over her desk: rotation.x down to ${flapLow.toFixed(2)}`);
  say(
    sparkles.frames > 0 && sparkles.seen > 0 && sparkles.underBubble === 0,
    `the card's sparkles can be seen (browser QA round 1: "the card sparkles hardly show"): on ${sparkles.frames} frames of the hand-over line, ${sparkles.seen} sparkle-frames drawn on the ` +
      `${SCREEN.width}×${SCREEN.height} screen from the desk's front, ${sparkles.underBubble} of them behind her bubble, which is drawn over the scenery${sparkles.first ? ` — e.g. ${sparkles.first}` : ''}` +
      `${sparkles.frames === 0 ? ' — NO SPARKLE WAS EVER LIVE: this asserts nothing' : ''}`,
  );
  const again = owlOffer();
  say(
    again.length === 1 && again[0]?.label === LIBRARY_CHIPS.hello && cardsHeld() === 1,
    `with the card she offers '${again[0]?.label ?? 'nothing'}' (wanted '${LIBRARY_CHIPS.hello}'), and the count is still ${cardsHeld()}`,
  );
  note(`CARD: ${cardsHeld()} card(s); ${said.size} distinct line(s) said; flap ${flapLow.toFixed(2)}; ${child.frames} frames stepped so far`);
}

console.log("\nRECOMMEND — 'Say hello!' names the first unread book of the owl's order, and it glows until it is read:");
{
  /** The rule, restated: the first book in RECOMMENDATION_ORDER she has not read. */
  const firstUnread = (): LibraryBook | undefined => RECOMMENDATION_ORDER.find((book) => !isBookRead(gameStore.get(), book.id));
  const first = firstUnread();
  if (!first) throw new Error('RECOMMEND: every book is already read on this store, so there is nothing to recommend and nothing to measure');
  const onceId = recommendFor(gameStore.get())?.id;
  const twiceId = recommendFor(gameStore.get())?.id;
  const emissiveOf = (id: string): number => library.shelfBooks.find((placed) => placed.book.id === id)?.material.emissiveIntensity ?? Number.NaN;
  const chipFor = (id: string): string | undefined =>
    library
      .interactZones()
      .find((zone) => zone.id === shelfBookZoneId(id))
      ?.actions?.()[0]?.label;
  const glowing = (): string[] => library.shelfBooks.filter((placed) => placed.material.emissiveIntensity > 0.2).map((placed) => placed.book.id);
  say(glowing().length === 0 && owl.recommendedBookId === null, `before the press no book glows (${glowing().length} over 0.2) and nothing is recommended`);
  owlOffer()[0]?.run();
  let lit = -1;
  for (let i = 0; i < 60; i += 1) {
    child.step();
    if (emissiveOf(first.id) > 0.2) {
      lit = i + 1;
      break;
    }
  }
  const others = library.shelfBooks.filter((placed) => placed.book.id !== first.id);
  const dark = others.filter((placed) => placed.material.emissiveIntensity === 0).length;
  say(lit > 0, `within 1 s of the press '${first.id}' glows: emissive ${emissiveOf(first.id).toFixed(3)} after ${lit} frame(s) (over 0.2 wanted; recommended: '${owl.recommendedBookId ?? 'none'}')`);
  say(dark === others.length && others.length === BOOKS.length - 1, `the other ${others.length} read exactly 0 (${dark} do; BOOKS.length − 1 = ${BOOKS.length - 1} wanted)`);
  const otherId = others[0]?.book.id ?? '';
  say(
    chipFor(first.id) === LIBRARY_CHIPS.readGlowing && chipFor(otherId) === LIBRARY_CHIPS.read,
    `its Read chip says '${chipFor(first.id) ?? 'nothing'}' (wanted '${LIBRARY_CHIPS.readGlowing}'); another book's ('${otherId}') says '${chipFor(otherId) ?? 'nothing'}' ('${LIBRARY_CHIPS.read}')`,
  );
  const said = untilQuiet(20);
  say(
    said.has(LIBRARY_LINES.owl.recommend(first.title)) && said.has(LIBRARY_LINES.owl.recommendGlow) && !owl.speaking,
    `she said "${LIBRARY_LINES.owl.recommend(first.title)}" — the first unread title in RECOMMENDATION_ORDER — and "${LIBRARY_LINES.owl.recommendGlow}" (${said.size} lines, then quiet)`,
  );
  // Found from the desk (browser QA round 1: from here the glowing book was a pale sliver 5 px wide among
  // the spines): 3 s at the desk's front, the camera where the game puts it, and every frame the glow's
  // sparkles asked whether one stands in the open over the top of the book's own case, on the screen and
  // in clear view of the camera — a ray from it reaching the sparkle past every opaque mesh of the room.
  {
    const placed = library.shelfBooks.find((candidate) => candidate.book.id === first.id);
    const spec = placed ? LIBRARY_BOOKCASES.find((candidate) => candidate.id === placed.slot.bookcase) : undefined;
    const caseTop = spec ? libraryBookcaseSize(spec.kind).height : Number.NaN;
    child.stand(LIBRARY_DESK_STAND.x, LIBRARY_DESK_STAND.z, LIBRARY_DESK_STAND.facing);
    child.run(0.3);
    const opaque = (material: Material): boolean => material.visible && material.depthWrite && (!material.transparent || material.opacity >= 0.999);
    const drawnNode = (node: Object3D): boolean => {
      for (let at: Object3D | null = node; at; at = at.parent) if (!at.visible) return false;
      return true;
    };
    const meshes: Mesh[] = [];
    for (const root of [library.roomRoot, library.kidsRoot]) {
      root.traverse((node) => {
        if (!(node instanceof Mesh) || !drawnNode(node)) return;
        for (let at: Object3D | null = node; at; at = at.parent) if (at === owl.handle.root) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        if (materials.some(opaque)) meshes.push(node);
      });
    }
    const ray = new Raycaster();
    const eye = new Vector3();
    let frames = 0;
    let framesSeen = 0;
    let seenSprites = 0;
    let hidden = 0;
    let lowest = Infinity;
    for (let i = 0; i < Math.round(3 / CHILD_DT); i += 1) {
      child.step();
      frames += 1;
      camera.camera.updateMatrixWorld();
      eye.setFromMatrixPosition(camera.camera.matrixWorld);
      let seenNow = false;
      for (const sprite of [...owl.beacon.sprites, ...owl.twinkles.sprites]) {
        if (!sprite.visible) continue;
        const at = sprite.getWorldPosition(new Vector3());
        const up = at.y - LIBRARY_FLOOR_Y; // flat-ok: a height over the reading room's own flat floor
        const screen = screenPoint(at);
        if (!screen.ahead || screen.x < 0 || screen.x > SCREEN.width || screen.y < 0 || screen.y > SCREEN.height) continue;
        if (up < caseTop) continue;
        lowest = Math.min(lowest, up);
        const towards = at.clone().sub(eye);
        const distance = towards.length();
        ray.set(eye, towards.normalize());
        ray.far = distance - 0.05;
        if (ray.intersectObjects(meshes, false).length > 0) {
          hidden += 1;
          continue;
        }
        seenSprites += 1;
        seenNow = true;
      }
      if (seenNow) framesSeen += 1;
    }
    say(
      framesSeen >= frames * 0.8,
      `found from the desk (browser QA round 1: from here the glowing book was a sliver among the spines): over ${frames} frames at the desk's front, a sparkle of its glow stood in the open ` +
        `over the top of '${placed?.slot.bookcase ?? '?'}' (${caseTop.toFixed(2)} m), on the ${SCREEN.width}×${SCREEN.height} screen and in clear view of the camera, on ${framesSeen} ` +
        `(${seenSprites} sparkle-frames; ${hidden} hidden by the room; the lowest at ${Number.isFinite(lowest) ? lowest.toFixed(2) : '—'} m) — 80% wanted`,
    );
  }
  // Read to the end: the glow goes on the next frames, the recommendation clears, the chip is plain again.
  markBookRead(first);
  child.step();
  child.step();
  const stillLit = library.shelfBooks.filter((placed) => placed.material.emissiveIntensity !== 0).map((placed) => placed.book.id);
  say(
    isBookRead(gameStore.get(), first.id) && stillLit.length === 0 && owl.recommendedBookId === null && chipFor(first.id) === LIBRARY_CHIPS.read,
    `read to the end (markBookRead) and two frames on, every book reads 0 (${stillLit.length === 0 ? 'none lit' : `still lit: ${stillLit.join(', ')}`}), ` +
      `the recommendation is cleared ('${owl.recommendedBookId ?? 'none'}') and its chip says '${chipFor(first.id) ?? 'nothing'}' again`,
  );
  const next = firstUnread();
  owlOffer()[0]?.run();
  const saidNext = untilQuiet(20);
  say(
    !!next && next.id !== first.id && saidNext.has(LIBRARY_LINES.owl.recommend(next.title)),
    `the next press names a different title: "${next ? LIBRARY_LINES.owl.recommend(next.title) : '?'}" (said: ${next ? saidNext.has(LIBRARY_LINES.owl.recommend(next.title)) : false}; before: '${first.id}', now: '${next?.id ?? 'none'}')`,
  );
  say(onceId === first.id && twiceId === first.id, `recommendFor, asked twice on the same state, answered '${onceId ?? 'none'}' and '${twiceId ?? 'none'}' (the rule's own '${first.id}')`);
  note(`RECOMMEND: the order ${RECOMMENDATION_ORDER.map((book) => book.id).join(' → ')}; '${first.id}' was marked read on this run's store; '${next?.id ?? 'none'}' glows now`);
}

console.log('\nSHUSH — a sprint through the room gets a "Shhh!", and nothing else:');
{
  const player = child.player;
  // The cooldown from the mid-card shush and the owl's last script run out first.
  child.run(SHUSH_COOLDOWN_SECONDS + 0.5);
  untilQuiet(10);
  const startAt = { x: 0, z: 4 };
  const startClear = collision.isClearCircle(OX + startAt.x, OZ + startAt.z, PLAYER_RADIUS);
  child.stand(startAt.x, startAt.z, 270);
  const before = owl.shushes;
  let runningFrames = 0;
  let rode = false;
  let granted = false;
  let firedAt = -1;
  const frames = Math.round(3 / CHILD_DT);
  for (let i = 0; i < frames; i += 1) {
    child.step(child.towards(-1, 0, true));
    world.labels.resolve(view, CHILD_DT);
    if (player.isRunning) runningFrames += 1;
    rode ||= player.riding;
    granted ||= owl.bubble.sprite.visible;
    if (firedAt < 0 && owl.shushes > before) firedAt = i + 1;
    if (wingsOut()) measurePastHerSolid(owlSolidRadius, wingsWide);
  }
  const end = child.room();
  const travelled = Math.hypot(end.x - startAt.x, end.z - startAt.z);
  say(startClear && runningFrames > 0, `from (${startAt.x}, ${startAt.z}) (clear floor: ${startClear}) she sprinted west for 3 s and got up to a run: isRunning on ${runningFrames} of ${frames} frames (none would measure nothing)`);
  say(
    owl.shushes === before + 1 && owl.lastSaid === LIBRARY_LINES.owl.shush,
    `the owl shushed once (${owl.shushes - before}), on frame ${firedAt} (a run of ${SHUSH_RUN_SECONDS} s wanted first): "${owl.lastSaid ?? ''}"`,
  );
  say(!rode && travelled >= 5 && library.playerIsInside, `and nothing else: never taken (riding ${rode}), she travelled ${travelled.toFixed(2)} m (at least 5) and is still in the room (${library.playerIsInside})`);
  say(granted, `her bubble was drawn: the label manager granted its sprite a frame (visible on some frame: ${granted})`);

  // CONTROL: after the cooldown, 3 s of walking the same way never shushes.
  child.run(SHUSH_COOLDOWN_SECONDS + 0.2);
  child.stand(startAt.x, startAt.z, 270);
  const beforeWalk = owl.shushes;
  let walkedRunning = false;
  for (let i = 0; i < frames; i += 1) {
    child.step(child.towards(-1, 0, false));
    walkedRunning ||= player.isRunning;
  }
  const walked = Math.hypot(child.room().x - startAt.x, child.room().z - startAt.z);
  say(
    owl.shushes === beforeWalk && !walkedRunning && walked >= 3,
    `CONTROL: 3 s of walking the same way, no sprint, never shushes (${owl.shushes - beforeWalk}; isRunning ever true: ${walkedRunning}); she walked ${walked.toFixed(2)} m (at least 3)`,
  );

  // A jump shushes.
  child.run(0.5);
  const beforeJump = owl.shushes;
  let tookOff = false;
  child.input.pressVirtual('jump');
  for (let i = 0; i < 30; i += 1) {
    child.step();
    tookOff ||= player.isAirborne;
  }
  say(tookOff && owl.shushes === beforeJump + 1 && owl.lastSaid === LIBRARY_LINES.owl.shush, `a jump (took off: ${tookOff}) shushes her: ${owl.shushes - beforeJump} more, "${owl.lastSaid ?? ''}"`);

  // Mid-script, measured during CARD: her wing and face answer, her words do not.
  say(
    !!midCard && midCard.ran && midCard.shushed === 1 && midCard.stayedOnScript && midCard.stillSpeaking && midCard.wingLow <= SHUSH_WING_X * 0.5,
    `mid-card-script (measured in CARD): a ${midCard?.travelled.toFixed(1) ?? '?'} m sprint (running: ${midCard?.ran ?? false}) shushed her ${midCard?.shushed ?? '?'} time(s) with her free wing ` +
      `(rotation.x down to ${midCard?.wingLow.toFixed(2) ?? '?'}; the full lift is ${SHUSH_WING_X}) — her words stayed on the card's lines (${midCard?.stayedOnScript ?? false}) and the script went on (${midCard?.stillSpeaking ?? false})`,
  );
  // Her wings at their widest — the card flap (CARD) and the shush wing (just above) — reach past
  // her solid only where no child can stand: over her desk.
  const bins = [...wingsWide.bins].sort((a, b) => a - b);
  const standable = [...wingsWide.standable].sort((a, b) => a - b);
  say(
    wingsWide.frames > 0 && standable.length === 0,
    `her wings at their widest (the card flap and the shush, measured live on ${wingsWide.frames} frames${wingsWide.frames ? '' : ' — NONE: this asserts nothing'}) reach ${wingsWide.furthest.toFixed(3)} m from her middle; ` +
      `past her solid (r ${owlSolidRadius.toFixed(3)}) at bearings ${bins.join(', ') || 'none'}°, and a child can stand against her solid at ${standable.length} of them` +
      `${standable.length ? ` (${standable.join(', ')}°): a wing through a child` : ' — over the desk, where nobody can'}`,
  );
  note(`SHUSH: a run of ${SHUSH_RUN_SECONDS} s, cooldown ${SHUSH_COOLDOWN_SECONDS} s (LibraryOwl.ts); ${owl.shushes} shushes in all; the screen ${SCREEN.width}×${SCREEN.height}; ${child.frames} frames stepped so far`);
}

// ── Track B (#718: the story cushions and the library's children, plan Steps 7-8) adds its clauses below this line. ──

/**
 * **SIT** (#718, plan Step 7) — the real child walks onto one of her story
 * cushions on the stick, presses its Sit chip and sits down to listen:
 * riding, posture `'listening'`, on the cushion's middle with her root on the
 * floor, facing the storyteller's chair. Then, measured on her drawn body on
 * every frame of two seconds' sitting (the pose sways, so one frame could pass
 * by luck of phase): her lowest drawn point and each of her soles on the
 * floor, and her hip pivot on the cushion's top, to the tolerances of
 * `scripts/lib/seatedPose.mts`. While she sits no Read chip is offered, her
 * cushion offers 'Get up' and the other offers nothing. 'Get up' stands her
 * where she sat, on the cushion's top (where her feet were before she sat, and
 * inside no solid there), and she walks off it onto the floor; sat down again,
 * a jump stands her up, with no hop in it.
 *
 * Proved red by hand: a leg rotated in `applyListeningPose` — one leg (its
 * sole, `seatedErrors`' `soles`) or both (her lowest point too). The whole
 * child's lowest point alone could not see one leg lifted: the other sole
 * still touches the floor (`seatedPose.mts` has the numbers).
 */
console.log('\nSIT — the real child walks onto a story cushion, sits down to listen, and gets up again:');
{
  const player = child.player;
  const seatId = LIBRARY_PLAYER_SEATS[0];
  const cushion = libraryCushion(seatId);
  const cushionTop = libraryCushionSize().top;
  const sitId = `library-sit:${seatId}`;
  const otherId = `library-sit:${LIBRARY_PLAYER_SEATS[1]}`;
  const zones = (): InteractZone[] => library.interactZones();
  const zone = (id: string): InteractZone | undefined => zones().find((candidate) => candidate.id === id);
  const actions = (id: string): readonly ZoneAction[] => zone(id)?.actions?.() ?? [];
  /** The Read chips offered right now (Step 5's `library-book:<id>` zones). */
  const readChips = (): number => zones().filter((candidate) => candidate.id.startsWith('library-book:')).length;
  /** The readable books drawn on the shelves (Step 5's `library.book.<id>` meshes — READABLE's own name pattern, never an outline `<…>.outline`): what arms the Read-chip half below. */
  let drawnReadable = 0;
  library.roomRoot.traverse((node) => {
    if (node instanceof Mesh && /^library\.book\.[^.]+$/.test(node.name)) drawnReadable += 1;
  });
  /**
   * How hard to push the stick for the last stretch onto the cushion: the
   * amount at which, let go, she coasts {@link ONTO_COAST} at most — from her
   * own braking (`v² / 2·PLAYER_DECELERATION`, with `v` the stick's share of
   * `PLAYER_MAX_SPEED`). Full tilt would coast 0.8 m, off the far side of a
   * 0.45 m cushion.
   */
  const ONTO_COAST = 0.1;
  const lightTouch = Math.min(1, Math.sqrt(2 * PLAYER_DECELERATION * ONTO_COAST) / PLAYER_MAX_SPEED);
  /**
   * Walk her onto room-local (x, z) on the stick and let her come to rest
   * there. **The stick stays held until she is over the spot**: a solid within
   * a step of the floor — the cushion, since PR #722 — is climbed only while
   * she is walking *into* it (`Player.update` asks `walkingOntoStep` of the
   * stick's own direction); let go short of it and coasting, she meets its
   * side as a wall and stops at its face. Full tilt from afar, then the light
   * touch above for the last stretch.
   */
  const walkOnto = (x: number, z: number): void => {
    for (let frame = 0; frame < Math.round(8 / CHILD_DT); frame += 1) {
      const here = child.room();
      const left = Math.hypot(x - here.x, z - here.z);
      if (left <= ONTO_COAST) break;
      child.step(child.towards(x - here.x, z - here.z, false, left > 1.6 ? 1 : lightTouch));
    }
    child.run(1);
  };
  const offCentre = (): number => Math.hypot(child.room().x - cushion.at.x, child.room().z - cushion.at.z);
  const feet = (): number => player.position.y - LIBRARY_FLOOR_Y; // flat-ok: the reading room is its own flat space at (-600, -600), off the sphere; her height above its one floor
  const facingChair = (libraryFacingStoryChair(cushion.at) * Math.PI) / 180;
  /** Where she comes from: out from the cushion, away from the storyteller, into the room. */
  const away = facingChair + Math.PI;

  // Her two cushions carry a Sit chip, and no others: the library's children take the other three.
  const sitZones = zones()
    .filter((candidate) => candidate.id.startsWith('library-sit:'))
    .map((candidate) => candidate.id)
    .sort();
  const wanted = LIBRARY_PLAYER_SEATS.map((id) => `library-sit:${id}`).sort();
  say(sitZones.join(' ') === wanted.join(' '), `Sit chips on ${sitZones.join(', ') || 'no cushion'} (wanted ${wanted.join(', ')}: her two cushions, never a child's)`);

  // She walks onto the cushion from 2.5 m out, on the stick: a low solid she steps up onto while walking into it.
  const start = { x: cushion.at.x + Math.sin(away) * 2.5, z: cushion.at.z + Math.cos(away) * 2.5 };
  const startClear = collision.isClearCircle(OX + start.x, OZ + start.z, PLAYER_RADIUS);
  child.stand(start.x, start.z, libraryFacingStoryChair(cushion.at));
  walkOnto(cushion.at.x, cushion.at.z);
  say(
    startClear && offCentre() <= 0.3 && Math.abs(feet() - cushionTop) <= FEET_TOLERANCE,
    `from (${start.x.toFixed(2)}, ${start.z.toFixed(2)}) (clear floor: ${startClear}) she walks onto ${seatId} and comes to rest ` +
      `${offCentre().toFixed(2)} m from its middle (0.3 allowed), her feet ${feet().toFixed(3)} m up on its top (${cushionTop.toFixed(3)}; the stick at ${lightTouch.toFixed(2)} for the last stretch)`,
  );

  // The chip she is offered standing there — and, for the control below, the Read chips while she stands.
  const sitZone = zone(sitId);
  const press = actions(sitId).find((action) => action.id === PRIMARY_ACTION);
  const reach = sitZone ? Math.hypot(player.position.x - sitZone.standX, player.position.z - sitZone.standZ) : Infinity;
  say(
    !!sitZone && press?.label === LIBRARY_CHIPS.sit && reach <= standRadiusOf(sitZone),
    `standing on it, ${sitId} offers '${press?.label ?? 'nothing'}' (wanted '${LIBRARY_CHIPS.sit}'), ` +
      `${reach.toFixed(2)} m from its stand, inside its ${sitZone ? standRadiusOf(sitZone) : '?'} m reach`,
  );
  const readStanding = readChips();

  // Sit, then two seconds sitting, measured on every frame and the worst kept.
  press?.run();
  const seatedFrames = Math.round(2 / CHILD_DT);
  let ridingHeld = true;
  let postureHeld = true;
  let worstSlide = 0;
  let worstRoot = 0;
  let worstFloor = 0;
  let worstSoles = 0;
  let worstSeat = 0;
  let lowestAtWorst = Number.NaN;
  let solesAtWorst = { left: Number.NaN, right: Number.NaN };
  let hipAtWorst = Number.NaN;
  for (let i = 0; i < seatedFrames; i += 1) {
    child.step();
    ridingHeld &&= player.riding;
    postureHeld &&= player.ridePosture === 'listening';
    worstSlide = Math.max(worstSlide, offCentre());
    worstRoot = Math.max(worstRoot, Math.abs(feet()));
    const errors = seatedErrors(player.model, LIBRARY_FLOOR_Y, LIBRARY_FLOOR_Y + cushionTop);
    // `!(a <= b)` rather than `a > b`, so a NaN measure is kept as the worst and fails.
    if (!(errors.floor <= worstFloor)) {
      worstFloor = errors.floor;
      lowestAtWorst = errors.lowestY;
    }
    if (!(errors.soles <= worstSoles)) {
      worstSoles = errors.soles;
      solesAtWorst = errors.soleY;
    }
    if (!(errors.seat <= worstSeat)) {
      worstSeat = errors.seat;
      hipAtWorst = errors.hipY;
    }
  }
  const turn = Math.abs(Math.atan2(Math.sin(player.facing - facingChair), Math.cos(player.facing - facingChair)));
  say(
    ridingHeld && postureHeld,
    `pressing '${LIBRARY_CHIPS.sit}' sits her down: riding and posture 'listening' on all ${seatedFrames} frames (now riding ${player.riding}, '${player.ridePosture}')`,
  );
  say(
    worstSlide <= 1e-3 && worstRoot <= 1e-6,
    `on the cushion's middle with her root on the floor: ${(worstSlide * 1000).toFixed(2)} mm off its centre at worst (1 mm allowed), her root ${(worstRoot * 1000).toFixed(3)} mm off the floor`,
  );
  say(turn <= 0.01, `facing the storyteller's chair: ${player.facing.toFixed(3)} rad, the chair's bearing ${facingChair.toFixed(3)} (${turn.toFixed(4)} rad round)`);
  say(
    worstFloor <= FLOOR_TOLERANCE && worstSoles <= FLOOR_TOLERANCE,
    `her feet on the floor: her lowest drawn point at worst ${(worstFloor * 1000).toFixed(1)} mm off it, and the worse sole ` +
      `${(worstSoles * 1000).toFixed(1)} mm (left y ${solesAtWorst.left.toFixed(4)}, right y ${solesAtWorst.right.toFixed(4)}), over ${seatedFrames} frames ` +
      `(y ${lowestAtWorst.toFixed(4)}; ${(FLOOR_TOLERANCE * 1000).toFixed(0)} mm allowed, each)`,
  );
  say(
    worstSeat <= SEAT_TOLERANCE,
    `her hips on the cushion: her hip pivot at worst ${(worstSeat * 1000).toFixed(1)} mm off its top over ${seatedFrames} frames ` +
      `(y ${hipAtWorst.toFixed(4)} against ${cushionTop.toFixed(4)}; ${(SEAT_TOLERANCE * 1000).toFixed(0)} mm allowed)`,
  );

  // While she sits: no Read chip, 'Get up' on her cushion, nothing on the other.
  const readSeated = readChips();
  if (drawnReadable > 0 || readStanding > 0) {
    // Armed by either sign that the shelves are readable: books drawn, or Read chips offered. Drawn
    // books with no chip while she stands is a red too — the control could not have said no.
    say(
      readStanding > 0 && readSeated === 0 && (drawnReadable === 0 || readStanding === drawnReadable),
      `no Read chip while she sits: ${readSeated} offered (CONTROL: standing, ${readStanding} were, ` +
        `for ${drawnReadable} readable books drawn as 'library.book.*')`,
    );
  } else {
    note(
      `SIT asserts nothing about Read chips in this build: no readable book is drawn (0 'library.book.*' meshes; ${readStanding} standing / ${readSeated} seated ` +
        `'library-book:' zones). Track A's Step 5 draws them; this half arms itself when they land`,
    );
  }
  const seatedOffer = actions(sitId);
  say(
    zone(sitId)?.selectableWhileRiding === true && seatedOffer.length === 1 && seatedOffer[0]?.id === 'get-up' && seatedOffer[0].label === LIBRARY_CHIPS.getUp,
    `sitting, ${sitId} offers ${seatedOffer.map((action) => `'${action.label}'`).join(', ') || 'nothing'} (wanted '${LIBRARY_CHIPS.getUp}' alone), ` +
      `and stays selectable while she rides: ${zone(sitId)?.selectableWhileRiding === true}`,
  );
  const otherOffer = actions(otherId);
  say(
    otherOffer.length === 0 && library.playerIsSeated,
    `${otherId} offers ${otherOffer.map((action) => `'${action.label}'`).join(', ') || 'nothing'} while she sits on ${seatId} (a chip there could only refuse); ` +
      `playerIsSeated ${library.playerIsSeated}`,
  );

  // 'Get up': up at once, where she sat — on the cushion's top, where her feet were before she
  // sat (the hotel nap's way off a mattress) — and she walks off it. Her body there, at the top's
  // height, is inside no solid: the put-down rule's own clause 3, asked of the resolver.
  seatedOffer[0]?.run();
  const upByChip = !player.riding && !library.playerIsSeated;
  const upAt = child.room();
  const upOff = Math.hypot(upAt.x - cushion.at.x, upAt.z - cushion.at.z);
  const upFeet = feet();
  const upOverlap = collision.deepestSolidOverlap(player.position, PLAYER_RADIUS, 0, undefined, KID_HEIGHT, player.position.y);
  child.run(0.5);
  const restOff = Math.hypot(child.room().x - cushion.at.x, child.room().z - cushion.at.z);
  say(
    upByChip && upOff <= 0.05 && Math.abs(upFeet - cushionTop) <= FEET_TOLERANCE && upOverlap <= 1e-3 && restOff <= 0.05 && Math.abs(feet() - cushionTop) <= FEET_TOLERANCE,
    `'${LIBRARY_CHIPS.getUp}' stands her up (riding ${player.riding}, seated ${library.playerIsSeated}) where she sat: ${upOff.toFixed(3)} m from the cushion's middle ` +
      `(0.05 allowed), her feet ${upFeet.toFixed(3)} m up on its top (${cushionTop.toFixed(3)}), her body there inside no solid (deepest overlap ${(upOverlap * 1000).toFixed(1)} mm); ` +
      `half a second on she still stands there, at (${child.room().x.toFixed(2)}, ${child.room().z.toFixed(2)}), ${restOff.toFixed(3)} m off its middle, her feet ${feet().toFixed(3)} m up`,
  );
  const leaving = child.room();
  child.run(0.6, child.towards(Math.sin(away), Math.cos(away)));
  const walked = Math.hypot(child.room().x - leaving.x, child.room().z - leaving.z);
  say(
    walked >= 1 && Math.abs(feet()) <= FEET_TOLERANCE && !player.riding,
    `and walks off it: ${walked.toFixed(2)} m in 0.6 s on the stick (at least 1), back on the floor (her feet ${feet().toFixed(3)} m up)`,
  );

  // Sat down again, a jump stands her up — one press, one frame — and is no hop.
  walkOnto(cushion.at.x, cushion.at.z);
  actions(sitId)
    .find((action) => action.id === PRIMARY_ACTION)
    ?.run();
  child.step();
  const satAgain = player.riding && library.playerIsSeated;
  child.input.pressVirtual('jump');
  child.step();
  const upByJump = !player.riding && !library.playerIsSeated;
  let highest = -Infinity;
  for (let i = 0; i < 30; i += 1) {
    child.step();
    highest = Math.max(highest, feet());
  }
  say(
    satAgain && upByJump && highest <= cushionTop + FEET_TOLERANCE && !player.riding,
    `sat down again (${satAgain}), a press of jump and one frame stand her up (${upByJump}), with no hop: ` +
      `her feet at most ${highest.toFixed(3)} m up over the next 30 frames (the cushion's top ${cushionTop.toFixed(3)})`,
  );
  note(
    `SIT on ${seatId} at (${cushion.at.x}, ${cushion.at.z}), top ${cushionTop.toFixed(3)}; ${seatedFrames} seated frames measured; ` +
      `worst lowest point ${(worstFloor * 1000).toFixed(1)} mm, worst sole ${(worstSoles * 1000).toFixed(1)} mm, worst hip ${(worstSeat * 1000).toFixed(1)} mm; ` +
      `${child.frames} frames stepped so far`,
  );
}

/**
 * **KIDS** (#718, plan Step 8) — the library's three children, measured on the
 * real crowd and the real collision world:
 *
 * 1. Three children, met in the crowd (`library.children`), each driven by her
 *    own `LibraryKidDriver`, each model under `kidsRoot` (in the scene, an
 *    identity transform, shown while she is inside).
 * 2. The seats apart: every child's cushion ≥ `SEPARATION` from the others'
 *    and ≥ `PLAYER_SEPARATION` from the player's two (the numbers behind
 *    `LibraryKids.ts`'s load-time throw).
 * 3. Every leg a child can walk — her circuit (the wrap included), her way to
 *    the rug and the same way back — swept every 0.1 m with a body of
 *    `NPC_RADIUS` + 0.05 against the real world; the last leg to the seat only
 *    as far as her walk goes (`libraryKidSeatArrive`: the cushion is a solid).
 *    Every leg keeps `PLAYER_SEPARATION` − 0.1 from the player's cushions (a
 *    brush, never a block) and `SEPARATION` from the other children's seats.
 * 4. At every route node a child-sized body is pushed ≤ 1 cm by the resolver.
 * 5. With the real child inside for 60 s, every child strolls her own aisle:
 *    metres walked, feet within 2 cm of the floor, no step over `NPC_RADIUS`·2
 *    (`check:jitter`'s bound), never off her circuit by more than
 *    `KID_ROUTE_ARRIVE` + 0.15, never marked elsewhere.
 * 6. With the real child in the garden for 5 s, every child moves exactly 0
 *    (marked elsewhere, #362) and their root is hidden.
 * 7. **The story-time rehearsal**, the way `storyTime.ts` (Step 9) will do it:
 *    `summon()` all three — every one reaches her cushion's edge, turned to the
 *    storyteller's chair, none gives up; `beginSeated` + `markSeated` — hips
 *    on the cushion, soles on the floor (`seatedPose.mts`), nobody drifts; the
 *    real child walks at a seated one and the seated child is furniture (she
 *    does not move, the player is held off); `endSeated` + `dismiss` — every
 *    child is off her cushion and back on her own aisle, strolling.
 *
 * Proved red by `LIBRARY_CHECK_MUTATE=block-route` (a 0.8 m disc on the last
 * point of Lark's way to the rug: the sweep and the node clause name the leg)
 * and by hand (the handoff has the transcripts).
 */
console.log("\nKIDS — the library's three children: their aisles, their ways to the rug, and their seats:");
{
  const kids = library.children;
  const plans = LIBRARY_KID_PLANS;
  const SWEEP_STEP = 0.1;
  const SWEEP_RADIUS = NPC_RADIUS + 0.05;
  /** A brush against a seated player's separation disc, never a block: the plan's − 0.1. */
  const PLAYER_SEAT_BRUSH = 0.1;
  /** How far off her circuit a strolling child may wander: the stroll's own arrival radius and a resolver's nudge. */
  const OFF_AISLE = KID_ROUTE_ARRIVE + 0.15;
  /** The rehearsal's own bounds: a gathering, a sitting, a dismissal (Step 9 owns the game's `GATHER_TIMEOUT`). */
  const GATHER_SECONDS = 40;
  const DISMISS_SECONDS = 40;
  const seatArrive = libraryKidSeatArrive();
  const cushionRadius = libraryCushionSize().radius;
  const cushionTop = libraryCushionSize().top;
  const toWorld = (point: LocalPoint): LocalPoint => ({ x: OX + point.x, z: OZ + point.z });
  const label = (point: LocalPoint): string => `(${point.x.toFixed(1)}, ${point.z.toFixed(1)})`;
  const root = library.kidsRoot;

  // 1. Three children, met in the crowd.
  say(plans.length === 3 && kids.length === plans.length, `${kids.length} children met in the crowd for ${plans.length} plans (${plans.map((plan) => plan.name).join(', ')}; three wanted)`);
  const underRoot = kids.filter((kid) => kid.model.root.parent === root).length;
  const identity = root.position.lengthSq() === 0 && root.quaternion.w === 1 && root.scale.x === 1 && root.scale.y === 1 && root.scale.z === 1;
  say(
    underRoot === kids.length && scene.children.includes(root) && identity && root.visible === library.playerIsInside,
    `every child's model hangs under '${root.name}' (${underRoot} of ${kids.length}), in the scene (${scene.children.includes(root)}), an identity transform (${identity}), ` +
      `shown exactly while she is inside (visible ${root.visible}, inside ${library.playerIsInside})`,
  );
  say(
    kids.length > 0 && kids.every((kid) => kid.body.driver === kid.driver && kid.driver.name === 'library-kid'),
    `each body is driven by its own LibraryKidDriver: ${kids.map((kid) => `${kid.plan.name} by '${kid.body.driver.name}'`).join(', ') || 'nobody'} (never a wander or waypoint driver)`,
  );

  // 2. The seats apart.
  const seatOf = (plan: LibraryKidPlan): LocalPoint => libraryCushion(plan.seat).at;
  let kidPair = { apart: Infinity, who: '' };
  let playerPair = { apart: Infinity, who: '' };
  for (let i = 0; i < plans.length; i += 1) {
    const a = plans[i]!;
    for (let j = i + 1; j < plans.length; j += 1) {
      const b = plans[j]!;
      const apart = Math.hypot(seatOf(a).x - seatOf(b).x, seatOf(a).z - seatOf(b).z);
      if (apart < kidPair.apart) kidPair = { apart, who: `${a.seat} and ${b.seat}` };
    }
    for (const id of LIBRARY_PLAYER_SEATS) {
      const seat = libraryCushion(id).at;
      const apart = Math.hypot(seatOf(a).x - seat.x, seatOf(a).z - seat.z);
      if (apart < playerPair.apart) playerPair = { apart, who: `${a.seat} and the player's ${id}` };
    }
  }
  say(
    kidPair.apart >= SEPARATION && playerPair.apart >= PLAYER_SEPARATION,
    `the seats are apart: the nearest two children's cushions ${kidPair.apart.toFixed(2)} m (${kidPair.who}; SEPARATION ${SEPARATION.toFixed(2)} wanted), ` +
      `the nearest child's cushion to a player's ${playerPair.apart.toFixed(2)} m (${playerPair.who}; PLAYER_SEPARATION ${PLAYER_SEPARATION.toFixed(2)} wanted)`,
  );

  // `block-route`: a 0.8 m disc on the last point of Lark's way to the rug —
  // her leg into it and her leg out of it are both shut to a child.
  const lark = plans.find((plan) => plan.name === 'Lark');
  const blockedPoint = lark?.toSeat[lark.toSeat.length - 1];
  const blocker = mutating('block-route') && blockedPoint ? collision.addCircle(OX + blockedPoint.x, OZ + blockedPoint.z, 0.8) : null;
  if (blocker && blockedPoint) note(`DROPPED a 0.8 m disc on Lark's ${label(blockedPoint)} on purpose — this run must go red naming that leg`);

  // 3. Every leg, swept.
  interface Leg {
    readonly who: string;
    readonly way: string;
    readonly from: LocalPoint;
    readonly to: LocalPoint;
    /** The seat this leg ends at, so its own seat is not a seat it must keep away from. */
    readonly ownSeat: string;
    /** How far along the leg the sweep runs, 0..1: short of the seat, where her walk ends. */
    readonly until: number;
  }
  const legs: Leg[] = [];
  for (const plan of plans) {
    const circuit = libraryKidCircuit(plan);
    for (let i = 0; i < circuit.length; i += 1) {
      legs.push({ who: plan.name, way: 'circuit', from: circuit[i]!, to: circuit[(i + 1) % circuit.length]!, ownSeat: plan.seat, until: 1 });
    }
    const rug = libraryKidRugRoute(plan);
    for (let i = 0; i + 1 < rug.length; i += 1) {
      const from = rug[i]!;
      const to = rug[i + 1]!;
      const last = i + 2 === rug.length;
      const length = Math.hypot(to.x - from.x, to.z - from.z);
      const until = last ? Math.max(0, 1 - seatArrive / length) : 1;
      legs.push({ who: plan.name, way: 'way to the rug', from, to, ownSeat: plan.seat, until });
      legs.push({ who: plan.name, way: 'way back', from: to, to: from, ownSeat: plan.seat, until: 1 });
    }
  }
  let stations = 0;
  let blockedLegs = 0;
  let nearestPlayerSeat = { apart: Infinity, who: '' };
  let nearestOtherSeat = { apart: Infinity, who: '' };
  const circuitLegs = legs.filter((leg) => leg.way === 'circuit').length;
  const rugLegs = legs.filter((leg) => leg.way === 'way to the rug').length;
  for (const leg of legs) {
    const length = Math.hypot(leg.to.x - leg.from.x, leg.to.z - leg.from.z);
    // The way back's first leg starts where her walk ended: `seatArrive` out from the seat.
    const start = leg.way === 'way back' && leg.from === libraryCushion(leg.ownSeat).at ? Math.min(1, seatArrive / length) : 0;
    let blockedAt: LocalPoint | null = null;
    for (let s = start * length; s <= leg.until * length + 1e-9; s += SWEEP_STEP) {
      const t = length === 0 ? 0 : s / length;
      const x = leg.from.x + (leg.to.x - leg.from.x) * t;
      const z = leg.from.z + (leg.to.z - leg.from.z) * t;
      stations += 1;
      if (!collision.isClearCircle(OX + x, OZ + z, SWEEP_RADIUS) && !blockedAt) blockedAt = { x, z };
      for (const id of LIBRARY_PLAYER_SEATS) {
        const seat = libraryCushion(id).at;
        const apart = Math.hypot(x - seat.x, z - seat.z);
        if (apart < nearestPlayerSeat.apart) nearestPlayerSeat = { apart, who: `${leg.who}'s ${leg.way} ${label(leg.from)} → ${label(leg.to)} at ${label({ x, z })}, to ${id}` };
      }
      for (const other of plans) {
        if (other.seat === leg.ownSeat) continue;
        const seat = seatOf(other);
        const apart = Math.hypot(x - seat.x, z - seat.z);
        if (apart < nearestOtherSeat.apart) nearestOtherSeat = { apart, who: `${leg.who}'s ${leg.way} ${label(leg.from)} → ${label(leg.to)} at ${label({ x, z })}, to ${other.name}'s ${other.seat}` };
      }
    }
    if (blockedAt) {
      blockedLegs += 1;
      say(false, `${leg.who}'s ${leg.way}: the leg ${label(leg.from)} → ${label(leg.to)} is blocked at (${blockedAt.x.toFixed(2)}, ${blockedAt.z.toFixed(2)}) for a body of ${SWEEP_RADIUS.toFixed(2)} m`);
    }
  }
  say(
    blockedLegs === 0 && stations > 0,
    `${legs.length} legs (${circuitLegs} circuit legs, the wraps included; ${rugLegs} to the rug, the last of each only to ${seatArrive.toFixed(2)} m from the seat; ${rugLegs} back) ` +
      `swept every ${SWEEP_STEP} m with a ${SWEEP_RADIUS.toFixed(2)} m body: ${stations} stations, ${blockedLegs} legs blocked`,
  );
  say(
    nearestPlayerSeat.apart >= PLAYER_SEPARATION - PLAYER_SEAT_BRUSH,
    `every leg keeps ${(PLAYER_SEPARATION - PLAYER_SEAT_BRUSH).toFixed(2)} m from the player's cushions (PLAYER_SEPARATION less a ${PLAYER_SEAT_BRUSH} m brush): the nearest is ${nearestPlayerSeat.apart.toFixed(2)} m, ${nearestPlayerSeat.who}`,
  );
  say(
    nearestOtherSeat.apart >= SEPARATION,
    `every leg keeps SEPARATION (${SEPARATION.toFixed(2)} m) from the other children's seats: the nearest is ${nearestOtherSeat.apart.toFixed(2)} m, ${nearestOtherSeat.who}`,
  );

  // 4. A child-sized body at every route node is pushed almost nowhere.
  {
    const probe = new Vector3();
    let nodes = 0;
    let worst = { push: 0, who: 'none' };
    for (const plan of plans) {
      const rug = libraryKidRugRoute(plan);
      const points = [...libraryKidCircuit(plan), ...rug.slice(0, rug.length - 1)];
      for (const point of points) {
        nodes += 1;
        probe.set(OX + point.x, LIBRARY_FLOOR_Y, OZ + point.z);
        collision.resolve(probe, NPC_RADIUS, 0, Infinity, undefined, KID_HEIGHT);
        const push = Math.hypot(probe.x - (OX + point.x), probe.z - (OZ + point.z));
        if (push > worst.push) worst = { push, who: `${plan.name}'s ${label(point)}` };
      }
    }
    say(nodes > 0 && worst.push <= 0.01, `at every one of ${nodes} route nodes the resolver pushes a child-sized body at most ${(worst.push * 1000).toFixed(1)} mm (${worst.who}; 10 mm allowed)`);
  }
  if (blocker !== null) collision.removeCircle(blocker);

  // The real child stands at the desk's front for the rest, out of every route and every aisle.
  const desk = LIBRARY_DESK_STAND;
  child.stand(desk.x, desk.z, desk.facing);
  const circuitsWorld = kids.map((kid) => libraryKidCircuit(kid.plan).map(toWorld));
  const offCircuit = (index: number, x: number, z: number): number => {
    const circuit = circuitsWorld[index]!;
    let nearest = Infinity;
    for (let i = 0; i < circuit.length; i += 1) nearest = Math.min(nearest, segmentDistance(circuit[i]!, circuit[(i + 1) % circuit.length]!, { x, z }));
    return nearest;
  };
  const stepOf = (kid: (typeof kids)[number], last: { x: number; z: number }): number => Math.hypot(kid.body.position.x - last.x, kid.body.position.z - last.z);
  const feetOf = (kid: (typeof kids)[number]): number => Math.abs(kid.body.position.y - LIBRARY_FLOOR_Y); // flat-ok: the reading room is its own flat space at (-600, -600), off the sphere; her height above its one floor
  const marked = (kid: (typeof kids)[number]): boolean => world.npcs.markedElsewhere.includes(kid.body);

  // 5. Sixty seconds of strolling, with her inside.
  {
    const seconds = 60;
    const walked = kids.map(() => 0);
    const maxStep = kids.map(() => 0);
    const maxFeet = kids.map(() => 0);
    const maxOff = kids.map(() => 0);
    let markedFrames = 0;
    let leftTheRoom = 0;
    const last = kids.map((kid) => ({ x: kid.body.position.x, z: kid.body.position.z }));
    for (let frame = 0; frame < Math.round(seconds / CHILD_DT); frame += 1) {
      child.step();
      kids.forEach((kid, i) => {
        const step = stepOf(kid, last[i]!);
        walked[i] = walked[i]! + step;
        maxStep[i] = Math.max(maxStep[i]!, step);
        maxFeet[i] = Math.max(maxFeet[i]!, feetOf(kid));
        maxOff[i] = Math.max(maxOff[i]!, offCircuit(i, kid.body.position.x, kid.body.position.z));
        last[i] = { x: kid.body.position.x, z: kid.body.position.z };
        if (marked(kid)) markedFrames += 1;
        if (spaceAt(kid.body.position.x, kid.body.position.z) !== SPACE_LIBRARY) leftTheRoom += 1;
      });
    }
    const each = (values: readonly number[], unit: string, digits: number): string => kids.map((kid, i) => `${kid.plan.name} ${values[i]!.toFixed(digits)}${unit}`).join(', ');
    say(
      kids.length > 0 && walked.every((metres) => metres >= 2) && markedFrames === 0 && leftTheRoom === 0,
      `with her inside for ${seconds} s every child strolled her aisle: ${each(walked, ' m', 1)} walked (at least 2 each), ` +
        `none marked elsewhere (${markedFrames} child-frames), none left the room (${leftTheRoom})`,
    );
    say(
      // flat-ok: `feetOf` is her height above the reading room's own flat floor (its own space at (-600, -600), off the sphere)
      kids.length > 0 && maxFeet.every((feet) => feet <= 0.02) && maxStep.every((step) => step <= NPC_RADIUS * 2),
      `their feet stayed within ${Math.max(...maxFeet, 0).toFixed(3)} m of the floor (0.02 allowed) and no step in any frame was over ${Math.max(...maxStep, 0).toFixed(3)} m ` +
        `(${(NPC_RADIUS * 2).toFixed(2)} allowed, check:jitter's own bound)`,
    );
    say(
      kids.length > 0 && maxOff.every((off) => off <= OFF_AISLE),
      `each kept to her own aisle: at most ${each(maxOff, ' m', 2)} off her circuit (${OFF_AISLE.toFixed(2)} allowed: the stroll's arrival radius and a nudge)`,
    );
  }

  // 6. Five seconds with her in the garden: frozen, hidden.
  {
    const left = quietly(() => library.requestEnterDoor());
    child.step();
    const outside = !library.playerIsInside && spaceAt(child.player.position.x, child.player.position.z) === SPACE_GARDEN;
    const before = kids.map((kid) => kid.body.position.clone());
    for (let frame = 0; frame < Math.round(5 / CHILD_DT); frame += 1) child.step();
    const moved = Math.max(0, ...kids.map((kid, i) => kid.body.position.distanceTo(before[i]!)));
    const frozen = kids.filter((kid) => marked(kid)).length;
    say(
      left && outside && moved === 0 && frozen === kids.length && !root.visible,
      `with her in the garden (through the door link: ${left}, outside ${outside}) for 5 s, the children moved exactly ${moved} m ` +
        `(marked elsewhere: ${frozen} of ${kids.length}) and their root is hidden (visible ${root.visible})`,
    );
    child.enter({ x: desk.x, z: desk.z, facing: desk.facing });
    child.step();
    say(library.playerIsInside && root.visible, `back inside at the desk's front, the children are shown again (visible ${root.visible})`);
  }

  // 7. The story-time rehearsal.
  {
    const chair = toWorld(LIBRARY_STORY_CHAIR.at);
    const bearingTo = (kid: (typeof kids)[number]): number => Math.atan2(chair.x - kid.body.position.x, chair.z - kid.body.position.z);
    const turnError = (kid: (typeof kids)[number]): number => {
      const wanted = bearingTo(kid);
      return Math.abs(Math.atan2(Math.sin(kid.body.facingAngle - wanted), Math.cos(kid.body.facingAngle - wanted)));
    };
    const seatDistance = (kid: (typeof kids)[number]): number => Math.hypot(kid.body.position.x - kid.driver.seat.x, kid.body.position.z - kid.driver.seat.z);

    // CONTROL for the furniture clause below, run now, while the children stroll their aisles far
    // from the rug: with nobody on it, the real child walking at the first child's cushion steps up
    // onto it (a low solid, climbed while walking into it) — so what holds her off it later is the
    // child sitting there, not the cushion's side.
    const sitter = kids[0]!;
    const sitterSeat = sitter.driver.seat;
    const approach = { x: sitterSeat.x - OX - 1.6, z: sitterSeat.z - OZ };
    const approachClear = collision.isClearCircle(OX + approach.x, OZ + approach.z, PLAYER_RADIUS);
    const playerFeet = (): number => child.player.position.y - LIBRARY_FLOOR_Y; // flat-ok: the reading room is its own flat space at (-600, -600), off the sphere; her height above its one floor
    /** A moderate push of the stick: her damped height lags under a full-tilt stride, and a seat is somewhere she slows down. */
    const SEAT_WALK = 0.6;
    const walkAtTheSeat = (): { highest: number; closest: number; nearestKid: number } => {
      child.stand(approach.x, approach.z, 90);
      let highest = -Infinity;
      let closest = Infinity;
      let nearestKid = Infinity;
      for (let frame = 0; frame < Math.round(1.5 / CHILD_DT); frame += 1) {
        child.step(child.towards(1, 0, false, SEAT_WALK));
        highest = Math.max(highest, playerFeet());
        closest = Math.min(closest, Math.hypot(child.player.position.x - sitterSeat.x, child.player.position.z - sitterSeat.z));
        for (const kid of kids) nearestKid = Math.min(nearestKid, kid.body.position.distanceTo(child.player.position));
      }
      child.run(1, child.towards(-1, 0));
      child.stand(desk.x, desk.z, desk.facing);
      return { highest, closest, nearestKid };
    };
    const empty = walkAtTheSeat();
    say(
      approachClear && empty.highest >= cushionTop - 0.05 && empty.nearestKid > PLAYER_SEPARATION,
      `CONTROL: from (${approach.x.toFixed(2)}, ${approach.z.toFixed(2)}) (clear floor: ${approachClear}) the real child walks at ${sitter.plan.name}'s empty ${sitter.plan.seat} ` +
        `and steps up onto it: her feet rise to ${empty.highest.toFixed(3)} m (its top ${cushionTop.toFixed(3)}, within 0.05: the damped height lags at a walk), ` +
        `${empty.closest.toFixed(2)} m from its middle at nearest, with the nearest child ${empty.nearestKid.toFixed(1)} m away the whole time (more than PLAYER_SEPARATION ${PLAYER_SEPARATION.toFixed(2)})`,
    );

    // Summoned: everybody to the edge of her cushion.
    for (const kid of kids) kid.driver.summon();
    const arrivedAt = kids.map(() => Number.NaN);
    let maxStep = 0;
    let elapsed = 0;
    const last = kids.map((kid) => ({ x: kid.body.position.x, z: kid.body.position.z }));
    while (elapsed < GATHER_SECONDS && !kids.every((kid) => kid.driver.arrived || kid.driver.gaveUp)) {
      child.step();
      elapsed += CHILD_DT;
      kids.forEach((kid, i) => {
        maxStep = Math.max(maxStep, stepOf(kid, last[i]!));
        last[i] = { x: kid.body.position.x, z: kid.body.position.z };
        if (Number.isNaN(arrivedAt[i]) && (kid.driver.arrived || kid.driver.gaveUp)) arrivedAt[i] = elapsed;
      });
    }
    const gaveUp = kids.filter((kid) => kid.driver.gaveUp).map((kid) => kid.plan.name);
    say(
      kids.length > 0 && kids.every((kid) => kid.driver.arrived),
      `summoned, every child reaches her cushion's edge in ${elapsed.toFixed(1)} s (${kids.map((kid, i) => `${kid.plan.name} ${arrivedAt[i]!.toFixed(1)} s`).join(', ')}; ${GATHER_SECONDS} allowed), ` +
        `${gaveUp.length === 0 ? 'none gave up' : `gave up: ${gaveUp.join(', ')}`}; no step over ${maxStep.toFixed(3)} m on the way`,
    );
    const standing = kids.map((kid) => seatDistance(kid));
    say(
      kids.every((kid, i) => standing[i]! >= cushionRadius + NPC_RADIUS - RESOLVER_SLACK && standing[i]! <= seatArrive + 0.1 && feetOf(kid) <= 0.02),
      `each stands at her cushion's edge, on the floor: ${kids.map((kid, i) => `${kid.plan.name} ${standing[i]!.toFixed(2)} m from the middle`).join(', ')} ` +
        `(the cushion's ${cushionRadius.toFixed(2)} plus her ${NPC_RADIUS.toFixed(2)} up to ${(seatArrive + 0.1).toFixed(2)}: the walk ends at ${seatArrive.toFixed(2)})`,
    );
    child.run(1.5);
    const turned = kids.map((kid) => turnError(kid));
    say(turned.every((error) => error <= 0.05), `waiting, each has turned to the storyteller's chair: ${kids.map((kid, i) => `${kid.plan.name} ${turned[i]!.toFixed(3)} rad off`).join(', ')} (0.05 allowed)`);

    // Sat, as story time sits them: root on the floor at the cushion's middle, facing the chair, her own phase.
    kids.forEach((kid, i) => {
      kid.body.beginSeated(kid.driver.seat.x, LIBRARY_FLOOR_Y, kid.driver.seat.z, kid.driver.seatFacing, i * 1.7);
      kid.driver.markSeated();
    });
    const seatedFrames = Math.round(2 / CHILD_DT);
    let worstFloor = 0;
    let worstSoles = 0;
    let worstSeat = 0;
    let worstDrift = 0;
    let seatedHeld = true;
    for (let frame = 0; frame < seatedFrames; frame += 1) {
      child.step();
      for (const kid of kids) {
        const errors = seatedErrors(kid.model, LIBRARY_FLOOR_Y, LIBRARY_FLOOR_Y + cushionTop);
        // `!(a <= b)`, so a NaN measure is kept as the worst and fails.
        if (!(errors.floor <= worstFloor)) worstFloor = errors.floor;
        if (!(errors.soles <= worstSoles)) worstSoles = errors.soles;
        if (!(errors.seat <= worstSeat)) worstSeat = errors.seat;
        worstDrift = Math.max(worstDrift, seatDistance(kid), Math.abs(kid.body.position.y - LIBRARY_FLOOR_Y)); // flat-ok: her root's height above the room's own flat floor, off the sphere
        seatedHeld &&= kid.body.seated && kid.driver.seated;
      }
    }
    say(
      kids.length > 0 && worstFloor <= FLOOR_TOLERANCE && worstSoles <= FLOOR_TOLERANCE && worstSeat <= SEAT_TOLERANCE,
      `sat on their cushions as story time sits them, over ${seatedFrames} frames: lowest drawn point at worst ${(worstFloor * 1000).toFixed(1)} mm off the floor, ` +
        `the worse sole ${(worstSoles * 1000).toFixed(1)} mm (${(FLOOR_TOLERANCE * 1000).toFixed(0)} allowed, each), hip pivot ${(worstSeat * 1000).toFixed(1)} mm off the cushion's top (${(SEAT_TOLERANCE * 1000).toFixed(0)} allowed)`,
    );
    say(seatedHeld && worstDrift <= 1e-6, `every child stayed seated on her cushion's middle with her root on the floor: ${(worstDrift * 1000).toFixed(3)} mm of drift at worst, seated held ${seatedHeld}`);

    // A seated child is furniture: the same walk, at the same cushion, with the child sitting on it.
    // The push-apart (`NpcSystem.separateFromPlayer`) gives the whole correction to the player,
    // through `Player.nudge`, which re-resolves her against the world with no step in it — so the
    // occupied cushion is a wall to her, the sitter never moves, and nobody climbs onto a seated child.
    {
      const sitterBefore = sitter.body.position.clone();
      const occupied = walkAtTheSeat();
      const sitterMoved = sitter.body.position.distanceTo(sitterBefore);
      const side = cushionRadius + PLAYER_RADIUS;
      say(
        sitterMoved <= 1e-3 && occupied.highest <= 0.02 && occupied.closest >= side - RESOLVER_SLACK && occupied.closest <= side + 0.1,
        `a seated child is furniture: the same walk at ${sitter.plan.name} on ${sitter.plan.seat} for 1.5 s moves her ${(sitterMoved * 1000).toFixed(2)} mm (1 allowed), ` +
          `while the player is held at the cushion's side, ${occupied.closest.toFixed(2)} m from its middle (its ${cushionRadius.toFixed(2)} plus her ${PLAYER_RADIUS.toFixed(2)} = ${side.toFixed(2)}, ` +
          `less ${RESOLVER_SLACK} m of resolver slack), her feet ${occupied.highest.toFixed(3)} m up at most (0.02: never onto an occupied cushion; the CONTROL stepped onto the empty one to ${empty.highest.toFixed(3)})`,
      );
    }

    // Dismissed: up, off the cushion, back to her aisle.
    for (const kid of kids) {
      kid.body.endSeated();
      kid.driver.dismiss();
    }
    const offCushionAt = kids.map(() => Number.NaN);
    const strollingAt = kids.map(() => Number.NaN);
    let returnStep = 0;
    let returned = 0;
    const lastBack = kids.map((kid) => ({ x: kid.body.position.x, z: kid.body.position.z }));
    while (returned < DISMISS_SECONDS && !kids.every((kid) => kid.driver.mode === 'stroll')) {
      child.step();
      returned += CHILD_DT;
      kids.forEach((kid, i) => {
        returnStep = Math.max(returnStep, stepOf(kid, lastBack[i]!));
        lastBack[i] = { x: kid.body.position.x, z: kid.body.position.z };
        if (Number.isNaN(offCushionAt[i]) && seatDistance(kid) >= 1) offCushionAt[i] = returned;
        if (Number.isNaN(strollingAt[i]) && kid.driver.mode === 'stroll') strollingAt[i] = returned;
      });
    }
    say(
      kids.length > 0 && offCushionAt.every((at) => at <= 20) && kids.every((kid) => kid.driver.mode === 'stroll'),
      `dismissed, every child is a metre off her cushion within ${Math.max(...offCushionAt).toFixed(1)} s (${kids.map((kid, i) => `${kid.plan.name} ${offCushionAt[i]!.toFixed(1)} s`).join(', ')}; 20 allowed) ` +
        `and back to her stroll within ${returned.toFixed(1)} s (${kids.map((kid, i) => `${kid.plan.name} ${strollingAt[i]!.toFixed(1)} s`).join(', ')}; ${DISMISS_SECONDS} allowed); ` +
        `no step over ${returnStep.toFixed(3)} m on the way back (${(NPC_RADIUS * 2).toFixed(2)} allowed)`,
    );
    say(returnStep <= NPC_RADIUS * 2, `the way back was walked, never jumped: the longest step ${returnStep.toFixed(3)} m`);
    child.run(10);
    const backOnAisle = kids.map((kid, i) => offCircuit(i, kid.body.position.x, kid.body.position.z));
    say(
      kids.every((kid, i) => backOnAisle[i]! <= OFF_AISLE && feetOf(kid) <= 0.02),
      `ten seconds on, each is back on her own aisle: ${kids.map((kid, i) => `${kid.plan.name} ${backOnAisle[i]!.toFixed(2)} m off her circuit`).join(', ')} (${OFF_AISLE.toFixed(2)} allowed), feet on the floor`,
    );
  }

  // Every way a child walks, world metres — her circuit (the wrap included), her aisle and her
  // rug route, both ways — and how far off them she is: what a straight line nobody swept would show.
  const waysWorld = kids.map((kid) => {
    const segments: [LocalPoint, LocalPoint][] = [];
    const circuit = libraryKidCircuit(kid.plan).map(toWorld);
    for (let i = 0; i < circuit.length; i += 1) segments.push([circuit[i]!, circuit[(i + 1) % circuit.length]!]);
    const aisle = libraryKidAisle(kid.plan).map(toWorld);
    for (let i = 0; i + 1 < aisle.length; i += 1) segments.push([aisle[i]!, aisle[i + 1]!]);
    const rug = libraryKidRugRoute(kid.plan).map(toWorld);
    for (let i = 0; i + 1 < rug.length; i += 1) segments.push([rug[i]!, rug[i + 1]!]);
    return segments;
  });
  const offWays = (index: number): number => {
    const at = kids[index]!.body.position;
    let nearest = Infinity;
    for (const [a, b] of waysWorld[index]!) nearest = Math.min(nearest, segmentDistance(a, b, at));
    return nearest;
  };
  /**
   * Up against a solid by her own steering — away from her own cushion (whose
   * side her walk ends at, and which she stands up out of), and with no other
   * child within `SEPARATION` of her: a child the crowd's push-apart squeezes
   * against something as another walks past is the push-apart's doing
   * (`check:npc-separation`'s), counted apart as `squeezed`, not a lean.
   */
  const againstASolid = (kid: (typeof kids)[number]): boolean =>
    !kid.body.seated &&
    Math.hypot(kid.body.position.x - kid.driver.seat.x, kid.body.position.z - kid.driver.seat.z) > seatArrive + 0.2 &&
    !collision.isClearCircle(kid.body.position.x, kid.body.position.z, NPC_RADIUS + 0.01);
  const crowded = (kid: (typeof kids)[number]): boolean => kids.some((other) => other !== kid && other.body.position.distanceTo(kid.body.position) < SEPARATION);
  const pressed = (kid: (typeof kids)[number]): boolean => againstASolid(kid) && !crowded(kid);
  /**
   * One run of the crowd, measured: each child's frames up against a solid, the
   * longest run of them (a **lean**: pushing at something, where a brush past a
   * corner is a few frames), her furthest off her ways, and the longest step.
   */
  interface Watch {
    readonly pressedFrames: number[];
    /** Frames up against a solid with another child within SEPARATION of her — the push-apart's squeeze, reported. */
    readonly squeezed: number[];
    readonly lean: number[];
    readonly run: number[];
    readonly off: number[];
    step: number;
  }
  /** The longest a child may stay up against a solid: a second — a brush at a corner, never a lean. */
  const LEAN_FRAMES = Math.round(1 / CHILD_DT);
  const watch = (): Watch => ({ pressedFrames: kids.map(() => 0), squeezed: kids.map(() => 0), lean: kids.map(() => 0), run: kids.map(() => 0), off: kids.map(() => 0), step: 0 });
  const stepWatched = (w: Watch, last: { x: number; z: number }[]): void => {
    child.step();
    kids.forEach((kid, i) => {
      if (pressed(kid)) {
        w.pressedFrames[i] = w.pressedFrames[i]! + 1;
        w.run[i] = w.run[i]! + 1;
        w.lean[i] = Math.max(w.lean[i]!, w.run[i]!);
      } else {
        w.run[i] = 0;
        if (againstASolid(kid)) w.squeezed[i] = w.squeezed[i]! + 1;
      }
      w.off[i] = Math.max(w.off[i]!, offWays(i));
      w.step = Math.max(w.step, stepOf(kid, last[i]!));
      last[i] = { x: kid.body.position.x, z: kid.body.position.z };
    });
  };
  const lastOf = (): { x: number; z: number }[] => kids.map((kid) => ({ x: kid.body.position.x, z: kid.body.position.z }));
  const eachKid = (values: readonly number[], fmt: (value: number) => string): string => kids.map((kid, i) => `${kid.plan.name} ${fmt(values[i]!)}`).join(', ');
  const allStrolling = (): boolean => kids.every((kid) => kid.driver.mode === 'stroll');
  /**
   * Steps until every child strolls again, at most `seconds`, **and then `after`
   * seconds more** — where a child sent off from the wrong place would walk her
   * unswept line — measured into `w`.
   */
  const untilStrolling = (w: Watch, seconds: number, after = 0): number => {
    const last = lastOf();
    let t = 0;
    while (t < seconds && !allStrolling()) {
      stepWatched(w, last);
      t += CHILD_DT;
    }
    for (let i = 0; i < Math.round(after / CHILD_DT); i += 1) stepWatched(w, last);
    return t;
  };
  /** How long a child is watched once she strolls again: her stroll's first leg and some. */
  const STROLL_WATCH = 10;

  // 8. The gathering with her standing still where a child at story time is most likely to stand
  //    (the review of Step 8): the central aisle's end, the door to the story rug (central[5]), and
  //    the junction both Juno's and Lark's ways pass (central[4]); the desk's front is the CONTROL.
  //    A player standing still is furniture to the crowd (PR #722, `Player.isStandingStill`): a
  //    child goes round her or waits, and never shoves her. A point of a child's way the player
  //    stands on is passed as near as she lets her come (`heldByStillPlayer`).
  {
    // `wayRound`: a way round her exists, so every child must arrive; where none does (she stands in the
    // one gap a child's way has, between the west story armchair and the cushions, or between the
    // stacks and the rug), the child held off settles and listens from there within seconds.
    const stillSpots = [
      { what: "the desk's front (CONTROL)", at: { x: desk.x, z: desk.z }, wayRound: true },
      { what: "the central aisle's end, the door to the story rug (central[5])", at: aisleNode('central', 5), wayRound: true },
      { what: "the junction Juno's and Lark's ways both pass (central[4])", at: aisleNode('central', 4), wayRound: true },
      { what: 'the gap between the west story armchair and cushion 4, on Juno\'s way', at: { x: 1.4, z: -9.5 }, wayRound: false },
      { what: 'the gap between the stacks and cushion 2, on Lark\'s way', at: { x: 3.0, z: -6.4 }, wayRound: false },
    ];
    const results: {
      what: string;
      wayRound: boolean;
      stood: LocalPoint;
      times: number[];
      settled: number[];
      gaveUp: string[];
      playerMoved: number;
      w: Watch;
      back: boolean;
      wBack: Watch;
    }[] = [];
    for (const spot of stillSpots) {
      child.stand(spot.at.x, spot.at.z, 180);
      child.run(0.5);
      const where = child.player.position.clone();
      const stood = child.room();
      for (const kid of kids) kid.driver.summon();
      const times = kids.map(() => Number.NaN);
      const settled = kids.map(() => Number.NaN);
      const w = watch();
      const last = lastOf();
      let elapsed = 0;
      while (elapsed < GATHER_SECONDS && !kids.every((kid) => kid.driver.arrived || kid.driver.gaveUp)) {
        stepWatched(w, last);
        elapsed += CHILD_DT;
        kids.forEach((kid, i) => {
          if (Number.isNaN(times[i]) && kid.driver.arrived) times[i] = elapsed;
          if (Number.isNaN(settled[i]) && (kid.driver.arrived || kid.driver.gaveUp)) settled[i] = elapsed;
        });
      }
      const gaveUp = kids.filter((kid) => !kid.driver.arrived).map((kid) => `${kid.plan.name} (${kid.driver.mode} at ${label({ x: kid.body.position.x - OX, z: kid.body.position.z - OZ })})`);
      const playerMoved = Math.hypot(child.player.position.x - where.x, child.player.position.z - where.z);
      // And dismissed with her still standing there: the way back passes her too.
      for (const kid of kids) kid.driver.dismiss();
      const wBack = watch();
      untilStrolling(wBack, DISMISS_SECONDS, STROLL_WATCH);
      results.push({ what: spot.what, wayRound: spot.wayRound, stood, times, settled, gaveUp, playerMoved, w, back: allStrolling(), wBack });
    }
    child.stand(desk.x, desk.z, desk.facing);
    const control = results[0]!;
    const bound = Math.max(...control.times) + 6;
    for (const result of results) {
      const isControl = result === control;
      if (result.wayRound) {
        say(
          result.gaveUp.length === 0 && result.times.every((time) => time <= (isControl ? GATHER_SECONDS : bound)) && result.playerMoved <= 0.01 && result.back,
          `summoned with her standing still at ${result.what}, stood at ${label(result.stood)}: every child reaches her cushion's edge — ` +
            `${eachKid(result.times, (time) => (Number.isNaN(time) ? 'NEVER' : `${time.toFixed(1)} s`))} ` +
            `(${isControl ? `${GATHER_SECONDS} s allowed` : `${bound.toFixed(1)} s allowed: the control's slowest and 6 s to go round her`}); gave up: ${result.gaveUp.join(', ') || 'none'}; ` +
            `she was never shoved (${result.playerMoved.toFixed(3)} m); back strolling after: ${result.back}`,
        );
      } else {
        // No way round her: the child held off settles, listening from where she is, and story time is not held up.
        say(
          result.gaveUp.length >= 1 && result.settled.every((time) => time <= bound) && result.playerMoved <= 0.01 && result.back,
          `summoned with her standing still in ${result.what}, stood at ${label(result.stood)}, where no way round her exists: ` +
            `every child is at her cushion or listening from where she was held, within ${Math.max(...result.settled).toFixed(1)} s ` +
            `(${eachKid(result.settled, (time) => (Number.isNaN(time) ? 'NEVER' : `${time.toFixed(1)} s`))}; ${bound.toFixed(1)} s allowed — the leg's own ${KID_LEG_TIMEOUT} s would hold the story up); ` +
            `listening where she was held: ${result.gaveUp.join(', ') || 'nobody — so this spot asserts nothing about a child with no way round'}; she was never shoved (${result.playerMoved.toFixed(3)} m)`,
        );
      }
      say(
        result.w.lean.every((frames) => frames <= LEAN_FRAMES) && result.w.step <= NPC_RADIUS * 2,
        `  and on the way nobody leant on the furniture: the longest any stayed up against a solid ${eachKid(result.w.lean, (frames) => `${frames}`)} frame(s) ` +
          `(${LEAN_FRAMES} allowed: a brush, never a lean; in all ${eachKid(result.w.pressedFrames, (frames) => `${frames}`)}); ` +
          `furthest off her ways ${eachKid(result.w.off, (off) => `${off.toFixed(2)} m`)}${isControl || !result.wayRound ? '' : ' (a way round her)'}; longest step ${result.w.step.toFixed(3)} m`,
      );
      say(
        result.back && result.wBack.lean.every((frames) => frames <= LEAN_FRAMES) && result.wBack.step <= NPC_RADIUS * 2,
        `  dismissed with her still standing there, every child walks back past her to her stroll (${result.back}, watched ${STROLL_WATCH} s more): ` +
          `the longest any stayed up against a solid ${eachKid(result.wBack.lean, (frames) => `${frames}`)} frame(s) (${LEAN_FRAMES} allowed; ` +
          `squeezed there by a child passing ${eachKid(result.wBack.squeezed, (frames) => `${frames}`)} frame(s), the push-apart's); ` +
          `furthest off her ways ${eachKid(result.wBack.off, (off) => `${off.toFixed(2)} m`)}; longest step ${result.wBack.step.toFixed(3)} m`,
      );
    }
  }

  // 9. Story time abandoned (`storyTime.abort`, she leaves the library): every child is dismissed,
  //    whatever she is doing — mid-walk to the rug, or waiting at her cushion; and dismissed again
  //    while already on her way back (the review of Step 8: a second dismissal turned the way back
  //    round, into the west story armchair and the stacks). CONTROL: dismissed once.
  {
    const runs: { what: string; w: Watch; strolling: boolean; secondModes: string }[] = [];
    // (a) Mid-walk: 2.5 s into the summons, dismissed once.
    for (const kid of kids) kid.driver.summon();
    child.run(2.5);
    const midModes = kids.map((kid) => kid.driver.mode).join('/');
    for (const kid of kids) kid.driver.dismiss();
    const wMid = watch();
    untilStrolling(wMid, 30, STROLL_WATCH);
    runs.push({ what: `dismissed mid-walk (modes ${midModes})`, w: wMid, strolling: allStrolling(), secondModes: '' });
    // (b) CONTROL: at her cushion's edge, dismissed once.
    // (c) At her cushion's edge, dismissed, and dismissed again 2 s into the way back.
    for (const twice of [false, true]) {
      for (const kid of kids) kid.driver.summon();
      let t = 0;
      while (t < GATHER_SECONDS && !kids.every((kid) => kid.driver.arrived || kid.driver.gaveUp)) {
        child.step();
        t += CHILD_DT;
      }
      for (const kid of kids) kid.driver.dismiss();
      const w = watch();
      let secondModes = '';
      if (twice) {
        const last = lastOf();
        for (let i = 0; i < Math.round(2 / CHILD_DT); i += 1) stepWatched(w, last);
        secondModes = kids.map((kid) => kid.driver.mode).join('/');
        for (const kid of kids) kid.driver.dismiss();
      }
      untilStrolling(w, 30, STROLL_WATCH);
      runs.push({ what: twice ? 'dismissed at her cushion, and again 2 s into the way back' : 'CONTROL: dismissed once at her cushion', w, strolling: allStrolling(), secondModes });
    }
    // (d) Summoned again while on the way back (a story called as the last one's children walk off):
    //     she turns round along her declared way and comes back to her cushion.
    {
      for (const kid of kids) kid.driver.summon();
      let t = 0;
      while (t < GATHER_SECONDS && !kids.every((kid) => kid.driver.arrived || kid.driver.gaveUp)) {
        child.step();
        t += CHILD_DT;
      }
      for (const kid of kids) kid.driver.dismiss();
      child.run(2);
      const modes = kids.map((kid) => kid.driver.mode).join('/');
      for (const kid of kids) kid.driver.summon();
      const w = watch();
      const last = lastOf();
      let back = 0;
      while (back < GATHER_SECONDS && !kids.every((kid) => kid.driver.arrived || kid.driver.gaveUp)) {
        stepWatched(w, last);
        back += CHILD_DT;
      }
      const arrived = kids.filter((kid) => kid.driver.arrived).length;
      say(
        modes === kids.map(() => 'returning').join('/') && arrived === kids.length && w.lean.every((frames) => frames <= LEAN_FRAMES) && w.off.every((off) => off <= OFF_AISLE),
        `summoned again 2 s into the way back (found ${modes}), every child turns round along her way and is back at her cushion's edge in ${back.toFixed(1)} s ` +
          `(${arrived} of ${kids.length}); the longest any stayed up against a solid ${eachKid(w.lean, (frames) => `${frames}`)} frame(s); ` +
          `furthest off her ways ${eachKid(w.off, (off) => `${off.toFixed(2)} m`)} (${OFF_AISLE.toFixed(2)} allowed)`,
      );
      for (const kid of kids) kid.driver.dismiss();
      untilStrolling(watch(), 30);
    }
    for (const run of runs) {
      say(
        run.strolling && run.w.lean.every((frames) => frames <= LEAN_FRAMES) && run.w.off.every((off) => off <= OFF_AISLE) && run.w.step <= NPC_RADIUS * 2,
        `${run.what}${run.secondModes ? ` (the second dismissal found them ${run.secondModes})` : ''}: every child back to her stroll (${run.strolling}), watched ${STROLL_WATCH} s more; ` +
          `the longest any stayed up against a solid ${eachKid(run.w.lean, (frames) => `${frames}`)} frame(s) (${LEAN_FRAMES} allowed; in all ${eachKid(run.w.pressedFrames, (frames) => `${frames}`)}); ` +
          `furthest off her ways ${eachKid(run.w.off, (off) => `${off.toFixed(2)} m`)} (${OFF_AISLE.toFixed(2)} allowed); longest step ${run.w.step.toFixed(3)} m`,
      );
    }
  }

  // 10. A way back held up past the leg's timeout: a disc on a point of Juno's way back for longer than
  //     KID_LEG_TIMEOUT, then taken away. She waits her turn on her declared way and goes on when it
  //     clears — never a straight line from wherever she gave up (the review of Step 8: from 9 of 11
  //     declared points, that line ran into furniture).
  {
    const juno = kids.findIndex((kid) => kid.plan.name === 'Juno');
    const kid = kids[juno]!;
    const held = kid.plan.toSeat[1]!;
    for (const each of kids) each.driver.summon();
    let t = 0;
    while (t < GATHER_SECONDS && !kids.every((each) => each.driver.arrived || each.driver.gaveUp)) {
      child.step();
      t += CHILD_DT;
    }
    const HOLD = 0.5;
    const disc = collision.addCircle(OX + held.x, OZ + held.z, HOLD);
    note(`KIDS: a ${HOLD} m disc dropped on Juno's way back at ${label(held)} for ${(KID_LEG_TIMEOUT + 5).toFixed(0)} s, then taken away`);
    for (const each of kids) each.driver.dismiss();
    /** Up against a solid other than the disc dropped in her way. */
    const leaning = (): boolean => pressed(kid) && Math.hypot(kid.body.position.x - (OX + held.x), kid.body.position.z - (OZ + held.z)) > HOLD + NPC_RADIUS + 0.02;
    let lean = 0;
    let run = 0;
    let offWhileHeld = 0;
    let modeAtTimeout = '';
    for (let i = 0; i < Math.round((KID_LEG_TIMEOUT + 5) / CHILD_DT); i += 1) {
      child.step();
      run = leaning() ? run + 1 : 0;
      lean = Math.max(lean, run);
      offWhileHeld = Math.max(offWhileHeld, offWays(juno));
      if (i === Math.round((KID_LEG_TIMEOUT + 1) / CHILD_DT)) modeAtTimeout = kid.driver.mode;
    }
    collision.removeCircle(disc);
    const offAtRemoval = offWays(juno);
    const after = watch();
    untilStrolling(after, 30);
    child.run(5);
    const backOn = offCircuit(juno, kid.body.position.x, kid.body.position.z);
    say(
      modeAtTimeout === 'returning' && offWhileHeld <= HOLD + NPC_RADIUS + OFF_AISLE && lean <= LEAN_FRAMES,
      `held up on her way back past the leg's ${KID_LEG_TIMEOUT} s, Juno waits on her way: a second past the timeout she is still '${modeAtTimeout}' (never a stroll from where she gave up), ` +
        `at most ${offWhileHeld.toFixed(2)} m off her ways (the disc's ${HOLD}, her ${NPC_RADIUS} and ${OFF_AISLE.toFixed(2)} allowed), ` +
        `up against anything but the disc for ${lean} frame(s) at most (${LEAN_FRAMES} allowed)`,
    );
    say(
      after.lean[juno]! <= LEAN_FRAMES && after.off[juno]! <= HOLD + NPC_RADIUS + OFF_AISLE && allStrolling() && backOn <= OFF_AISLE,
      `  the disc taken away, she walks on along her way: at most ${after.off[juno]!.toFixed(2)} m off it (${offAtRemoval.toFixed(2)} where the disc held her; ` +
        `${(HOLD + NPC_RADIUS + OFF_AISLE).toFixed(2)} allowed — the sidestep she was using to get past it carries her a little way on before it lets go), ` +
        `up against a solid ${after.lean[juno]} frame(s) at most, strolling again (${allStrolling()}), ${backOn.toFixed(2)} m off her circuit five seconds on`,
    );
  }

  note(
    `KIDS: ${kids.length} children, seeds 0x${LIBRARY_KID_SEED.toString(16)} + i·${LIBRARY_KID_SEED_STRIDE}; ${legs.length} legs swept at ${SWEEP_STEP} m with a ${SWEEP_RADIUS.toFixed(2)} m body; ` +
      `the walk to a seat ends ${seatArrive.toFixed(2)} m from its middle (cushion ${cushionRadius.toFixed(2)} + NPC_RADIUS ${NPC_RADIUS} + slack) and the sit is a snap of that; ` +
      `stroll pace ${GUEST_PACE}, summons pace ${KID_SUMMON_PACE}, route arrive ${KID_ROUTE_ARRIVE}, leg timeout ${KID_LEG_TIMEOUT} s; ${child.frames} frames stepped so far`,
  );
}

// ── Story time (#718, plan Step 9): STORY, FLIGHT, the clock and the abort. ──

/**
 * **STORY** (#718, plan Step 9) — the real child, three pets at her heels,
 * walks onto her story cushion and sits; story time is asked for
 * (`requestStoryTime`, the `/library?story=now` road); then the room, every
 * frame, until the story is over and the owl is home:
 *
 * - **the vacuity guard**: the story reaches `'reading'`, or this says it
 *   asserts nothing;
 * - **the children**: all three seated on their own cushions within
 *   `GATHER_TIMEOUT` of the call, each on its middle, hips on the cushion and
 *   soles on the floor (`seatedPose.mts`); no child's own step in any frame
 *   over `NPC_RADIUS`·2 — the hop onto the cushion and off it included, so a
 *   sit is never a metre's snap; none moving more than 0.05 while the story
 *   is read;
 * - **the owl**: perched within 0.1 of `owlPerch()`, her desk spot clear while
 *   she is away, **solid on the chair** (the top over her perch is her head
 *   while she sits there, and the seat's again once she has gone — browser QA
 *   round 1: the child stood inside her on the seat), and **as drawn on the
 *   chair, no point a child standing on clear floor can touch beyond her
 *   solids** (the reason she sits `OWL_PERCH_BACK` into it); her two flights
 *   each `OWL_FLIGHT_SECONDS` long, with nobody in her way to wait for;
 * - **her bubble** (plan Step 9: "the bubble follows her"): on every frame she
 *   speaks — the call at her desk, the story on the chair — its tail is over
 *   her head, read off the bubble (`worldAnchor`) against the live owl, and
 *   **never a word on the wing** (she calls first and then flies, so her bubble
 *   never hides her flight: browser QA round 1); the
 *   label manager (`world.labels.resolve`, every frame here, as `Game` runs
 *   it) draws it on every frame she reads aloud, so the child on her cushion
 *   can read the story; and, seen from that cushion, the room's furniture
 *   cannot cut it (it is drawn over the scenery);
 * - **the words**: the title line, every page of the book, both ending lines;
 * - **her pets** (Jim, 19 Oct 2026): a cushion is a seat, not a ride — all
 *   three out at her heels the whole story, none in a seat beside her
 *   (`check:exits`' 4c never asks the cushion: its exit loop gets her up
 *   first);
 * - **the card**: Story listener, which she did not have before (the control);
 * - **afterwards**: every child up and a metre off her cushion within 20 s of
 *   the last word, the owl home within 10 s, her middle unreachable again;
 *   story time idle with one more story told and its clock at `STORY_EVERY`.
 *
 * Then **FLIGHT** (the path over the stacks, both ways, and the live owl on
 * it), **CLOCK** (with the clock let go, the next story is called
 * `STORY_EVERY` after the last one's landing and reads a different book; a
 * fresh visit's first, `STORY_FIRST_AFTER` in) and **ABORT** (she leaves by
 * the door mid-story: nobody left sitting, the owl home and solid, quiet, the
 * clock restarted). The story clock is held from the real child's first
 * clause until CLOCK lets it go, so nothing else is timed by it.
 *
 * Proved red by `LIBRARY_CHECK_MUTATE=no-story` (the vacuity guard),
 * `block-cushion` (a 0.9 m disc on cushion 4: "every child seated" goes red
 * while the story still reads), and by hand (the handoff): the cruise under
 * the stacks (FLIGHT), the perch on the seat centre (the owl as drawn), the
 * bubble left where she was (`LibraryOwl.update` without `anchorBubble`: the
 * bubble clauses), the bubble depth-tested (no `overScenery`).
 */
/** What the live owl's flights measured against `owlFlightPose` — STORY flies them, FLIGHT reports them. */
const liveFlight = { frames: 0, worst: 0, flights: 0, waited: 0 };
/** The book STORY's story read to its end — CLOCK's next story must be another. */
let storyHeard: LibraryBook | null = null;

/**
 * **How far the owl's bubble's tail is from over her head, now** — read off the
 * bubble (`SpeechBubble.worldAnchor`: where its tail points, in the world)
 * against the live owl: her root (room-local), `OWL_BUBBLE_OVER_HEAD` over her
 * measured height, taken into the world through the room. Zero while the
 * bubble follows her; a bubble left anchored where she was reads the distance
 * she has flown since.
 */
function owlBubbleOffHerHead(): number {
  const owl = library.owl;
  const over = new Vector3(owl.feet.x, owl.feet.y + owl.handle.height + OWL_BUBBLE_OVER_HEAD, owl.feet.z);
  library.roomRoot.updateWorldMatrix(true, false);
  return owl.bubble.worldAnchor().distanceTo(library.roomRoot.localToWorld(over));
}

/**
 * **How much of the owl's bubble the room stands in front of, from the game's camera** — a grid of 9 × 5
 * points over its painted pill and tail (`contentBox`, laid out on the camera's own axes exactly as
 * `LabelManager.measureSprite` lays out its corners), each asked of a ray from the camera: does an opaque,
 * drawn mesh of the reading room or its children (never the owl herself, never a stack faded for the
 * camera) stand nearer than the point? A depth-tested bubble is cut wherever one does; a bubble drawn over
 * the scenery (`depthTest` off) is not. Measured, not assumed: the story chair is backed onto the bookcase
 * wall, and headless Chrome showed a depth-tested bubble there losing its right side ("A day in the pa…").
 */
function owlBubbleBehindTheRoom(): { points: number; behind: number; first: string; depthTested: boolean; offHerHead: number; drawn: boolean } {
  const sprite = library.owl.bubble.sprite;
  const box = library.owl.bubble.contentBox;
  sprite.updateWorldMatrix(true, false);
  const e = sprite.matrixWorld.elements;
  const scaleX = Math.hypot(e[0]!, e[1]!, e[2]!);
  const scaleY = Math.hypot(e[4]!, e[5]!, e[6]!);
  const centre = new Vector3().setFromMatrixPosition(sprite.matrixWorld);
  const lens = camera.camera;
  lens.updateMatrixWorld();
  const c = lens.matrixWorld.elements;
  const right = new Vector3(c[0]!, c[1]!, c[2]!).normalize();
  const up = new Vector3(c[4]!, c[5]!, c[6]!).normalize();
  const eye = new Vector3().setFromMatrixPosition(lens.matrixWorld);
  const opaque = (material: Material): boolean => material.visible && material.depthWrite && (!material.transparent || material.opacity >= 0.999);
  const drawn = (node: Object3D): boolean => {
    for (let at: Object3D | null = node; at; at = at.parent) if (!at.visible) return false;
    return true;
  };
  const owlRoot = library.owl.handle.root;
  const meshes: Mesh[] = [];
  for (const root of [library.roomRoot, library.kidsRoot]) {
    root.traverse((node) => {
      if (!(node instanceof Mesh) || !drawn(node)) return;
      for (let at: Object3D | null = node; at; at = at.parent) if (at === owlRoot) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (materials.some(opaque)) meshes.push(node);
    });
  }
  const ray = new Raycaster();
  let points = 0;
  let behind = 0;
  let first = '';
  for (let i = 0; i <= 8; i += 1) {
    for (let j = 0; j <= 4; j += 1) {
      const fx = box.x0 + (box.x1 - box.x0) * (0.05 + 0.9 * (i / 8));
      const fy = box.y0 + (box.y1 - box.y0) * (0.05 + 0.9 * (j / 4));
      const point = centre
        .clone()
        .addScaledVector(right, (fx - sprite.center.x) * scaleX)
        .addScaledVector(up, (1 - fy - sprite.center.y) * scaleY);
      const towards = point.clone().sub(eye);
      const distance = towards.length();
      ray.set(eye, towards.normalize());
      ray.far = distance;
      points += 1;
      const hit = ray.intersectObjects(meshes, false)[0];
      if (!hit) continue;
      behind += 1;
      if (!first) {
        const what = hit.object.name || hit.object.parent?.name || hit.object.type;
        first = `(${(point.x - OX).toFixed(2)}, ${(point.y - LIBRARY_FLOOR_Y).toFixed(2)} up, ${(point.z - OZ).toFixed(2)}) behind '${what}', which stands ${(distance - hit.distance).toFixed(2)} m nearer the camera`; // flat-ok: room-local, the reading room's own flat space
      }
    }
  }
  // Which bubble was measured: hers, over her head and drawn — never a stale sprite left somewhere else.
  return { points, behind, first, depthTested: sprite.material.depthTest, offHerHead: owlBubbleOffHerHead(), drawn: sprite.visible };
}
console.log("\nSHELF WALK — the real child walks the big readers' shelf stand to stand, both ways, in one session, and presses E at every stand; taps a neighbour's book; sways midway between two stands (QA, PR #734):");
{
  const player = child.player;
  const input = child.input;
  /**
   * The six chapter books on west-4, in shelf order, and their stands (room-local). Read off
   * `SHELF_BOOKS`, the pairing the game itself builds the shelf from — never typed here.
   */
  const shelf = SHELF_BOOKS.filter((entry) => entry.book.kind === 'chapter').map((entry) => ({
    id: entry.book.id,
    zoneId: shelfBookZoneId(entry.book.id),
    x: entry.slot.stand.x,
    z: entry.slot.stand.z,
    facing: entry.slot.stand.facing,
  }));
  /**
   * Standing ON a stand, to the readout's precision: QA stopped on each by the F3 readout, which reads
   * to 0.1 m, so within 5 cm. The walk's own stop is held to it below — a stop further off is the
   * instrument failing, and says so, never a pass.
   */
  const ON_STAND = 0.05;
  /** How far she may coast once the stick is let go near a spot: the light touch below is solved from it. */
  const COAST = 0.05;
  const touch = Math.min(1, Math.sqrt(2 * PLAYER_DECELERATION * COAST) / PLAYER_MAX_SPEED);

  // The mutations this clause arms: each puts back one half of the rule it measures, in the check only.
  const innards = Selection.prototype as unknown as Record<string, unknown>;
  const restore: (() => void)[] = [];
  const patch = (name: string, value: unknown): void => {
    const before = innards[name];
    if (typeof before !== 'function') throw new Error(`SHELF WALK: Selection has no '${name}' to mutate — this run would assert nothing`);
    innards[name] = value;
    restore.push(() => {
      innards[name] = before;
    });
  };
  if (mutating('fixed-hysteresis')) {
    patch('hysteresisBand', () => 0.6);
    note('MUTATED Selection.hysteresisBand to a fixed 0.6 m whatever the gap (the rule before PR #734): the arrivals must go red — every one from the aisle; a straight walk stops on an exact tie at 0.6 m, so some of those pass by rounding');
  }
  if (mutating('no-hysteresis')) {
    patch('hysteresisBand', () => 0);
    note('MUTATED Selection.hysteresisBand to 0 (no hysteresis at all): the sway midway between two stands must go red');
  }
  if (mutating('tap-loses')) {
    patch('tapOutlives', () => false);
    note('MUTATED Selection.tapOutlives to false (a tap dropped whenever proximity holds anything else, the rule before PR #734): the taps must go red');
  }

  // The selection, wired as `Game` wires it: the world's zones, blocked while a book is open
  // (`Game.selectionBlocked` asks `bookReader.isOpen`); she walks herself, so no navigator.
  let readerOpen = false;
  const opened: string[] = [];
  library.attachBookReader({
    open: (bookId) => {
      opened.push(bookId);
      readerOpen = true;
      return true;
    },
    isOpen: () => readerOpen,
  });
  const canvas = { dataset: {} } as unknown as HTMLCanvasElement;
  const selection = new Selection(player, camera, canvas, {
    zones: () => world.interactZones(),
    blocked: () => readerOpen,
    walkTo: () => {},
    walking: () => false,
    flash: () => {},
  });
  // E reaches the selection the one way the game's E does: the key's own listener on the InputSystem,
  // `takeInteractPress`, `InteractRouter`, `Selection.handleInteractPress`.
  const router = new InteractRouter([], selection);
  const listeners = new Map<string, (event: unknown) => void>();
  const keyTarget = {
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  input.attach(keyTarget as unknown as Window);
  const pressE = (): void => {
    listeners.get('keydown')?.({ code: 'KeyE', key: 'e', repeat: false, target: null, preventDefault() {} });
    listeners.get('keyup')?.({ code: 'KeyE', key: 'e', target: null });
  };
  const context = { dt: CHILD_DT, elapsed: 0, input, playerPosition: player.position, cameraForward: camera.forward, frame: 0 } as unknown as FrameContext;
  /** One frame: the child's (input, player, camera, library, crowd), then `Game`'s order after them — the selection, then E's router. */
  const frame = (steer?: Steer): void => {
    child.step(steer);
    context.frame = child.frames;
    context.elapsed = child.frames * CHILD_DT;
    selection.update(context);
    router.update(context);
  };
  const run = (seconds: number, steer?: Steer): void => {
    for (let i = 0; i < Math.round(seconds / CHILD_DT); i += 1) frame(steer);
  };
  /** Walk her on the stick onto room-local (x, z) and let her come to rest: full tilt from afar, then the light touch. */
  const walkTo = (x: number, z: number): void => {
    for (let i = 0; i < Math.round(8 / CHILD_DT); i += 1) {
      const here = child.room();
      const left = Math.hypot(x - here.x, z - here.z);
      if (left <= COAST) break;
      frame(child.towards(x - here.x, z - here.z, false, left > 1.6 ? 1 : touch));
    }
    run(0.6);
  };
  const where = (): string => `(${child.room().x.toFixed(2)}, ${child.room().z.toFixed(2)})`;
  const offStand = (stand: { readonly x: number; readonly z: number }): number => Math.hypot(child.room().x - stand.x, child.room().z - stand.z);
  /** E on the stand she is standing on: what was selected, and what opened — then the book closed, as the reader's ✕ closes it. */
  const pressHere = (): { selected: string; opened: string | null } => {
    const selected = selection.selected?.id ?? 'nothing';
    const before = opened.length;
    pressE();
    frame();
    const got = opened.length > before ? opened[opened.length - 1]! : null;
    run(0.3);
    readerOpen = false;
    run(0.3);
    return { selected, opened: got };
  };
  const results: { what: string; ok: boolean }[] = [];
  const arrive = (how: string, stand: (typeof shelf)[number]): void => {
    const off = offStand(stand);
    const at = where();
    const { selected, opened: got } = pressHere();
    const ok = off <= ON_STAND && selected === stand.zoneId && got === stand.id;
    results.push({ what: `${how}: '${stand.id}'`, ok });
    say(
      ok,
      `${how}, onto '${stand.id}''s stand (${stand.x.toFixed(2)}, ${stand.z.toFixed(2)}): stopped at ${at}, ${off.toFixed(3)} m off it (${ON_STAND} allowed); ` +
        `selected '${selected}', and E opened ${got === null ? 'NOTHING' : `'${got}'`}${got === stand.id ? '' : ` — WRONG, wanted '${stand.id}'`}`,
    );
  };

  // The geometry this clause is proved against, read off the built shelf and the selection itself.
  const zoneOf = (id: string): InteractZone | undefined => world.interactZones().find((zone) => zone.id === id);
  /** The selection's own band between two zones, or null where this build's Selection has none (the rule before PR #734: a fixed 0.6 m). */
  const band = (a: string, b: string): number | null => {
    const one = zoneOf(a);
    const two = zoneOf(b);
    const ask = (selection as unknown as { hysteresisBand?: (x: InteractZone, y: InteractZone) => number }).hysteresisBand;
    return one && two && typeof ask === 'function' ? ask.call(selection, one, two) : null;
  };
  const bandText = (value: number | null): string => (value === null ? 'none (no hysteresisBand: a fixed 0.6 m)' : `${value.toFixed(3)} m`);
  const { PARK_SEED_ASKED, PARK_RESTART } = await import('../src/world/parkManifest.ts');
  const gaps = shelf.slice(1).map((stand, i) => Math.hypot(stand.x - shelf[i]!.x, stand.z - shelf[i]!.z));
  note(
    `SHELF WALK geometry: seed ${PARK_SEED_ASKED} restart ${PARK_RESTART}, the reading room at (${OX}, ${OZ}); west-4's stands, room-local, facing ${shelf[0]?.facing}: ` +
      shelf.map((stand) => `${stand.id} (${stand.x.toFixed(2)}, ${stand.z.toFixed(2)})`).join(', ') +
      `; gaps ${gaps.map((gap) => gap.toFixed(3)).join(', ')} m; the selection's band between neighbours ` +
      shelf.slice(1).map((stand, i) => bandText(band(shelf[i]!.zoneId, stand.zoneId))).join(', ') +
      `; stand radius ${zoneOf(shelf[0]!.zoneId) ? standRadiusOf(zoneOf(shelf[0]!.zoneId)!) : '?'} m; the stick's light touch ${touch.toFixed(3)} (coast ${COAST} m)`,
  );
  say(shelf.length === 6 && shelf.every((stand) => zoneOf(stand.zoneId) !== undefined), `six chapter books on the big readers' shelf, each with a Read zone (${shelf.length} found)`);

  // 1. North, on foot: onto the first stand (the PR's own link stands her there), then walked to each next one.
  const first = shelf[0]!;
  child.stand(first.x, first.z, first.facing);
  run(0.6);
  arrive('stood on the first stand, as /library?at= does', first);
  for (let i = 1; i < shelf.length; i += 1) {
    walkTo(shelf[i]!.x, shelf[i]!.z);
    arrive(`walked north from '${shelf[i - 1]!.id}'`, shelf[i]!);
  }
  // 2. South, on foot, all the way back.
  for (let i = shelf.length - 2; i >= 0; i -= 1) {
    walkTo(shelf[i]!.x, shelf[i]!.z);
    arrive(`walked south from '${shelf[i + 1]!.id}'`, shelf[i]!);
  }
  // 3. From the room: out from the stand she is at into the aisle, then onto the next stand along.
  const aisleOut = 1.5;
  for (let i = 1; i < shelf.length; i += 1) {
    const from = shelf[i - 1]!;
    const out = { x: from.x + aisleOut, z: from.z };
    const outClear = collision.isClearCircle(OX + out.x, OZ + out.z, PLAYER_RADIUS);
    walkTo(out.x, out.z);
    const heldOut = selection.selected?.id ?? 'nothing';
    walkTo(shelf[i]!.x, shelf[i]!.z);
    arrive(`from the aisle at (${out.x.toFixed(2)}, ${out.z.toFixed(2)}) (clear floor: ${outClear}; held there: '${heldOut}')`, shelf[i]!);
  }
  // 4. The deep links one after another: stood on the stand before (the save's spot), then on this one.
  for (let i = 1; i < shelf.length; i += 1) {
    const before = shelf[i - 1]!;
    child.stand(before.x, before.z, before.facing);
    run(0.6);
    const heldBefore = selection.selected?.id ?? 'nothing';
    child.stand(shelf[i]!.x, shelf[i]!.z, shelf[i]!.facing);
    run(0.6);
    arrive(`stood on it straight from '${before.id}''s stand, as the next /library?at= link does (held before: '${heldBefore}')`, shelf[i]!);
  }

  const walked = results.filter((result) => result.ok).length;
  say(walked === results.length, `${walked} of ${results.length} arrivals on a stand — on foot both ways, from the aisle, and by link after link — opened that stand's own book`);

  // 5. A tap on a neighbour's book, standing on a stand: it selects that book, and E opens it.
  camera.camera.updateMatrixWorld(true);
  let tapsOk = 0;
  let taps = 0;
  for (let i = 0; i < shelf.length; i += 1) {
    for (const j of [i - 1, i + 1]) {
      const target = shelf[j];
      if (!target) continue;
      const here = shelf[i]!;
      child.stand(here.x, here.z, here.facing);
      // A fresh pick where she stands (a book opened and closed clears the selection, as the reader
      // does), so this measures the tap alone and never the hysteresis — that is 1-4's question.
      readerOpen = true;
      frame();
      readerOpen = false;
      run(0.6);
      const heldBefore = selection.selected?.id ?? 'nothing';
      const mesh = library.roomRoot.getObjectByName(`library.book.${target.id}`);
      camera.camera.updateMatrixWorld(true);
      const aim = mesh ? new Box3().setFromObject(mesh).getCenter(new Vector3()).project(camera.camera) : null;
      const tapped = aim ? selection.handleTap(aim.x, aim.y) : false;
      frame();
      const { selected, opened: got } = pressHere();
      const ok = tapped && heldBefore === here.zoneId && selected === target.zoneId && got === target.id;
      taps += 1;
      if (ok) tapsOk += 1;
      say(
        ok,
        `on '${here.id}''s stand (holding '${heldBefore}'), a tap on '${target.id}''s book at NDC (${aim ? `${aim.x.toFixed(3)}, ${aim.y.toFixed(3)}` : 'no mesh'}) ` +
          `${tapped ? 'landed on a zone' : 'MISSED every zone'}: selected '${selected}', and E opened ${got === null ? 'NOTHING' : `'${got}'`}${got === target.id ? '' : ` — WRONG, wanted '${target.id}'`}`,
      );
    }
  }
  say(taps === 10 && tapsOk === taps, `${tapsOk} of ${taps} taps on a neighbour's book selected that book, and E opened it`);

  // 6. Midway between two stands, swaying a hand's breadth either side: the selection holds still.
  const north = shelf[2]!;
  const south = shelf[3]!;
  const mid = { x: (north.x + south.x) / 2, z: (north.z + south.z) / 2 };
  /** A hand's breadth either side of the midpoint: well inside the band the rule keeps for a shelf like this (a quarter of the gap). */
  const SWAY = 0.08;
  /** How far past SWAY a stop may coast before the instrument, not the rule, is to blame. */
  const SWAY_SLACK = 0.04;
  walkTo(mid.x, mid.z);
  const settled = selection.selected?.id ?? 'nothing';
  let changes = 0;
  let last = settled;
  let nearest = Infinity;
  let furthest = 0;
  const along = (): number => {
    const here = child.room();
    // signed distance from the midpoint along the shelf line, + towards the north stand
    const dx = north.x - south.x;
    const dz = north.z - south.z;
    const length = Math.hypot(dx, dz);
    return ((here.x - mid.x) * dx + (here.z - mid.z) * dz) / length;
  };
  const watch = (): void => {
    const now = selection.selected?.id ?? 'nothing';
    if (now !== last) changes += 1;
    last = now;
    const a = along();
    nearest = Math.min(nearest, a);
    furthest = Math.max(furthest, a);
  };
  const swayTo = (sign: number): void => {
    const length = Math.hypot(north.x - south.x, north.z - south.z);
    const x = mid.x + (sign * SWAY * (north.x - south.x)) / length;
    const z = mid.z + (sign * SWAY * (north.z - south.z)) / length;
    for (let i = 0; i < Math.round(3 / CHILD_DT); i += 1) {
      const here = child.room();
      const left = Math.hypot(x - here.x, z - here.z);
      if (left <= COAST) break;
      frame(child.towards(x - here.x, z - here.z, false, touch));
      watch();
    }
    for (let i = 0; i < Math.round(0.6 / CHILD_DT); i += 1) {
      frame();
      watch();
    }
  };
  for (let cycle = 0; cycle < 4; cycle += 1) {
    swayTo(1);
    swayTo(-1);
  }
  const swayBand = band(north.zoneId, south.zoneId);
  const inside = Math.max(-nearest, furthest) <= SWAY + SWAY_SLACK;
  say(
    inside && changes === 0 && settled !== 'nothing',
    `midway between '${north.id}' and '${south.id}' (${mid.x.toFixed(2)}, ${mid.z.toFixed(2)}), swaying ${SWAY} m either way 4 times ` +
      `(she reached ${nearest.toFixed(3)} .. +${furthest.toFixed(3)} m along the shelf): the selection changed ${changes} time(s) from '${settled}' (0 wanted — no flicker; ` +
      `the band between the two: ${bandText(swayBand)})${inside ? '' : ' — the sway left its hand\'s breadth: the instrument, not the rule, failed'}`,
  );

  input.detach(keyTarget as unknown as Window);
  library.attachBookReader(null);
  for (const undo of restore) undo();
}
console.log('\nSTORY — the owl calls, flies to the big chair, the children sit, she reads a whole book, and everyone wanders off:');
{
  const player = child.player;
  const owl = library.owl;
  const kids = library.children;
  const seatId = LIBRARY_PLAYER_SEATS[0];
  const cushion = libraryCushion(seatId);
  const cushionTop = libraryCushionSize().top;
  const perch = owlPerch();
  const desk = { x: LIBRARY_LIBRARIAN_SPOT.x, y: 0, z: LIBRARY_LIBRARIAN_SPOT.z };

  // Her pets: three, bought and out, walking in her parade as `Game` wires it.
  gameStore.earn(1000);
  const pets: string[] = [];
  for (const id of ['pet.bunny', 'pet.kitten', 'pet.mouse']) {
    const spec = shopItem(id);
    const bought = spec ? gameStore.buy(spec) : null;
    if (bought?.outcome === 'kept') pets.push(id);
  }
  gameStore.setCarried(null);
  const parade = quietly(() => new Parade(player as never, collision, camera));
  scene.add(parade.group);
  world.attachParade(parade);
  parade.setNavGrid(playerNavGrid(world));
  child.also(parade as never);

  // Out from her cushion, away from the storyteller; her line forms up; then onto it on the stick, and sit.
  const facingChair = (libraryFacingStoryChair(cushion.at) * Math.PI) / 180;
  const away = facingChair + Math.PI;
  const start = { x: cushion.at.x + Math.sin(away) * 2.5, z: cushion.at.z + Math.cos(away) * 2.5 };
  child.stand(start.x, start.z, libraryFacingStoryChair(cushion.at));
  child.run(3);
  const lineBefore = parade.lineNow();
  const lightTouch = Math.min(1, Math.sqrt(2 * PLAYER_DECELERATION * 0.1) / PLAYER_MAX_SPEED);
  for (let frame = 0; frame < Math.round(8 / CHILD_DT); frame += 1) {
    const here = child.room();
    const left = Math.hypot(cushion.at.x - here.x, cushion.at.z - here.z);
    if (left <= 0.1) break;
    child.step(child.towards(cushion.at.x - here.x, cushion.at.z - here.z, false, left > 1.6 ? 1 : lightTouch));
  }
  child.run(1);
  library
    .interactZones()
    .find((zone) => zone.id === `library-sit:${seatId}`)
    ?.actions?.()
    .find((action) => action.id === PRIMARY_ACTION)
    ?.run();
  child.step();
  const sat = player.riding && library.playerIsSeated;
  const cardBefore = gameStore.get().collection[STORY_LISTENER_SECRET_ID]?.discovered === true;
  say(
    pets.length === 3 && lineBefore.out === pets.length && sat && !cardBefore,
    `set-up: ${pets.length} pets bought and ${lineBefore.out} out at her heels, then she sat on ${seatId} (riding ${player.riding}, seated ${library.playerIsSeated}); ` +
      `no Story listener card yet (the control: ${cardBefore ? 'ALREADY HELD' : 'not held'})`,
  );

  // `block-cushion`: a 0.9 m disc on cushion 4 — Juno's — before anyone is summoned.
  const blocked = mutating('block-cushion') ? collision.addCircle(OX + libraryCushion('cushion-4').at.x, OZ + libraryCushion('cushion-4').at.z, 0.9) : null;
  if (blocked !== null) note("DROPPED a 0.9 m disc on cushion 4 (Juno's) on purpose — this run must go red: not every child sits");
  if (mutating('no-story')) note('ASKED FOR NO STORY on purpose — this run must go red: the vacuity guard');
  else library.requestStoryTime();

  const said = new Set<string>();
  const phaseAt: Partial<Record<StoryPhase, number>> = {};
  const seatedAt = kids.map(() => Number.NaN);
  const offSeat = kids.map(() => 0);
  const worstPose = { floor: 0, soles: 0, seat: 0 };
  let maxStep = 0;
  const last = kids.map((kid) => ({ x: kid.body.position.x, z: kid.body.position.z }));
  const anchor: (Vector3 | null)[] = kids.map(() => null);
  const readingDrift = kids.map(() => 0);
  let awayFrames = 0;
  let deskClearAway = true;
  let perchedOff = Infinity;
  let perchedTouch: { points: number; touchable: number; first: string } | null = null;
  let petFrames = 0;
  let petsOutLeast = Infinity;
  let petsSeatedMost = 0;
  /** The owl's bubble against the room, a second into the reading, from her cushion's camera. */
  let bubbleCut: ReturnType<typeof owlBubbleBehindTheRoom> | null = null;
  /** Her bubble's tail against over her head, on every frame she spoke: frames by where she was, and the worst. */
  const trail = { wing: 0, chair: 0, desk: 0, worst: 0, worstAt: '' };
  /** Frames she read the story aloud from the chair, and how many of them the label manager drew her bubble on. */
  let readAloud = 0;
  let readDrawn = 0;
  /** Story time as the owl landed home — idle again: its clock, and how many stories it has told. */
  const toldBefore = library.storyTime.told;
  let landed: { nextIn: number; told: number } | null = null;
  const offCushionAt = kids.map(() => Number.NaN);
  let homeAt = Number.NaN;
  /** The top over her perch, read off the collision world the first frame she sits there: her head, if her chair solid came with her. */
  let perchTopSat = Number.NaN;
  let prevFeet = new Vector3().copy(owl.feet);
  let flight: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number }; k: number } | null = null;
  /** Each flight's frames, as she landed it. */
  const flightFrames: number[] = [];
  const expected = { x: 0, y: 0, z: 0 };
  let t = 0;
  const LIMIT = 150;
  while (t < LIMIT) {
    child.step();
    // The label manager decides, once a frame after every system, which labels are drawn (`Game.tick`'s order).
    world.labels.resolve(view, CHILD_DT);
    t += CHILD_DT;
    const phase = library.storyPhase;
    if (phaseAt[phase] === undefined) phaseAt[phase] = t;
    if (owl.lastSaid !== null) said.add(owl.lastSaid);
    // Her bubble follows her: on every frame she speaks, wherever she is.
    if (owl.speaking) {
      const off = owlBubbleOffHerHead();
      const where = owl.flying ? 'wing' : owl.perched ? 'chair' : 'desk';
      trail[where] += 1;
      if (off > trail.worst) {
        trail.worst = off;
        trail.worstAt = `on the ${where} ${t.toFixed(1)} s in, the owl's feet at room (${owl.feet.x.toFixed(2)}, ${owl.feet.z.toFixed(2)})`;
      }
    }
    if (phase === 'reading' && owl.speaking) {
      readAloud += 1;
      if (owl.bubble.sprite.visible) readDrawn += 1;
    }
    // The live owl on her path, at the progress she has made along it (a wait pauses her on it).
    if (owl.flying) {
      if (!flight) {
        const home = phase === 'dispersing';
        flight = { from: { x: prevFeet.x, y: prevFeet.y, z: prevFeet.z }, to: home ? desk : perch, k: 0 };
        liveFlight.flights += 1;
      }
      flight.k += 1;
      owlFlightPose(flight.from, flight.to, owl.flightProgress, expected);
      // flat-ok: two room-local points (her root in the room's group, the pure path's pose) in the reading room's own flat space
      liveFlight.worst = Math.max(liveFlight.worst, Math.hypot(owl.feet.x - expected.x, owl.feet.y - expected.y, owl.feet.z - expected.z));
      liveFlight.frames += 1;
      liveFlight.waited = Math.max(liveFlight.waited, owl.waited);
    } else {
      if (flight) flightFrames.push(flight.k);
      flight = null;
    }
    prevFeet.copy(owl.feet);
    if (!owl.atDesk) {
      awayFrames += 1;
      deskClearAway &&= collision.isClearCircle(OX + desk.x, OZ + desk.z, PLAYER_RADIUS);
    }
    if (owl.perched) {
      if (Number.isNaN(perchTopSat)) perchTopSat = collision.highestTopAt(OX + perch.x, OZ + perch.z, Infinity) - LIBRARY_FLOOR_Y; // flat-ok: a top over the reading room's own flat floor
      // flat-ok: two room-local points (her root in the room's group, owlPerch()) in the reading room's own flat space
      perchedOff = Math.min(perchedOff, Math.hypot(owl.feet.x - perch.x, owl.feet.y - perch.y, owl.feet.z - perch.z));
      if (!perchedTouch) {
        // The owl as drawn on the chair: every visible point more than the resolver's slack outside every
        // solid that a child standing on clear floor could touch — none wanted.
        let points = 0;
        let touchable = 0;
        let first = '';
        visiblePoints(
          owl.handle.root,
          (p) => {
            points += 1;
            if (!collision.isClearCircle(OX + p.x, OZ + p.z, RESOLVER_SLACK)) return;
            const out = Math.atan2(p.x - perch.x, p.z - perch.z);
            for (let k = 0; k < 8; k += 1) {
              const bearing = out + ((k - 3.5) / 8) * Math.PI;
              const cx = p.x + Math.sin(bearing) * (PLAYER_RADIUS + 0.01);
              const cz = p.z + Math.cos(bearing) * (PLAYER_RADIUS + 0.01);
              if (onPlate(cx, cz) && collision.isClearCircle(OX + cx, OZ + cz, PLAYER_RADIUS)) {
                touchable += 1;
                if (!first) first = `(${p.x.toFixed(2)}, ${p.y.toFixed(2)} up, ${p.z.toFixed(2)}) from a child at (${cx.toFixed(2)}, ${cz.toFixed(2)})`;
                break;
              }
            }
          },
          library.roomRoot,
        );
        perchedTouch = { points, touchable, first };
      }
    }
    if (!bubbleCut && phase === 'reading' && owl.perched && owl.speaking && t - (phaseAt.reading ?? t) >= 1) bubbleCut = owlBubbleBehindTheRoom();
    if (library.playerIsSeated) {
      petFrames += 1;
      const line = parade.lineNow();
      petsOutLeast = Math.min(petsOutLeast, line.out);
      petsSeatedMost = Math.max(petsSeatedMost, line.seated);
    }
    kids.forEach((kid, i) => {
      maxStep = Math.max(maxStep, Math.hypot(kid.body.position.x - last[i]!.x, kid.body.position.z - last[i]!.z));
      last[i] = { x: kid.body.position.x, z: kid.body.position.z };
      const sitting = kid.driver.seated && kid.body.seated && !kid.body.hopping;
      if (sitting) {
        if (Number.isNaN(seatedAt[i]!)) seatedAt[i] = t - (phaseAt.gathering ?? t);
        offSeat[i] = Math.max(offSeat[i]!, Math.hypot(kid.body.position.x - kid.driver.seat.x, kid.body.position.z - kid.driver.seat.z));
        const errors = seatedErrors(kid.model, LIBRARY_FLOOR_Y, LIBRARY_FLOOR_Y + cushionTop);
        if (!(errors.floor <= worstPose.floor)) worstPose.floor = errors.floor;
        if (!(errors.soles <= worstPose.soles)) worstPose.soles = errors.soles;
        if (!(errors.seat <= worstPose.seat)) worstPose.seat = errors.seat;
        if (phase === 'reading') {
          anchor[i] ??= kid.body.position.clone();
          readingDrift[i] = Math.max(readingDrift[i]!, kid.body.position.distanceTo(anchor[i]!));
        }
      }
      if (phaseAt.dispersing !== undefined && Number.isNaN(offCushionAt[i]!) && !kid.body.seated) {
        const off = Math.hypot(kid.body.position.x - kid.driver.seat.x, kid.body.position.z - kid.driver.seat.z);
        if (off >= 1) offCushionAt[i] = t - phaseAt.dispersing;
      }
    });
    if (phaseAt.dispersing !== undefined && Number.isNaN(homeAt) && owl.atDesk && !owl.flying) homeAt = t - phaseAt.dispersing;
    if (phaseAt.dispersing !== undefined && phase === 'idle' && landed === null) landed = { nextIn: library.storyTime.nextIn, told: library.storyTime.told };
    if (phaseAt.dispersing !== undefined && phase === 'idle' && kids.every((kid, i) => !Number.isNaN(offCushionAt[i]!) || kid.driver.mode === 'stroll')) break;
  }
  if (blocked !== null) collision.removeCircle(blocked);
  const book = BOOKS.find((candidate) => candidate.title !== '' && said.has(LIBRARY_LINES.owl.storyBegin(candidate.title))) ?? null;
  const reached = phaseAt.reading !== undefined;
  say(
    reached,
    reached
      ? `the story was read: called at ${(phaseAt.gathering ?? Number.NaN).toFixed(1)} s, the reading began ${((phaseAt.reading ?? 0) - (phaseAt.gathering ?? 0)).toFixed(1)} s after the call, ` +
          `the last word ${((phaseAt.dispersing ?? Number.NaN) - (phaseAt.reading ?? 0)).toFixed(1)} s later ('${book?.title ?? '?'}', ${book?.kind ?? '?'} book)`
      : `STORY ASSERTS NOTHING: story time never reached 'reading' in ${LIMIT} s (phases seen: ${Object.keys(phaseAt).join(', ')})`,
  );
  say(
    !!book && storyTimeMayRead(book),
    `the book is one story time may read (storyTimeMayRead — a picture book): '${book?.id ?? 'none'}' is a ${book?.kind ?? '?'} book`,
  );
  say(
    reached && kids.length === 3 && seatedAt.every((at) => at <= GATHER_TIMEOUT) && offSeat.every((off) => off <= 0.05),
    `every child sat on her own cushion within GATHER_TIMEOUT (${GATHER_TIMEOUT} s) of the call: ` +
      `${kids.map((kid, i) => `${kid.plan.name} ${Number.isNaN(seatedAt[i]!) ? 'NEVER' : `${seatedAt[i]!.toFixed(1)} s`} on ${kid.plan.seat}, at most ${offSeat[i]!.toFixed(3)} m off its middle`).join(', ')} (0.05 allowed)`,
  );
  say(
    worstPose.floor <= FLOOR_TOLERANCE && worstPose.soles <= FLOOR_TOLERANCE && worstPose.seat <= SEAT_TOLERANCE,
    `sat to listen: lowest drawn point at worst ${(worstPose.floor * 1000).toFixed(1)} mm off the floor, the worse sole ${(worstPose.soles * 1000).toFixed(1)} mm ` +
      `(${(FLOOR_TOLERANCE * 1000).toFixed(0)} allowed), hip pivot ${(worstPose.seat * 1000).toFixed(1)} mm off the cushion's top (${(SEAT_TOLERANCE * 1000).toFixed(0)} allowed)`,
  );
  say(
    maxStep <= NPC_RADIUS * 2,
    `no child's own step in any frame was over ${maxStep.toFixed(3)} m (${(NPC_RADIUS * 2).toFixed(2)} allowed, check:jitter's bound) — the hop onto her cushion and off it included`,
  );
  /** A hop, never a snap: a walk at the summons' pace is a few centimetres a frame, and a sit from a metre out must be too. */
  const HOP_STEP = 0.1;
  say(
    maxStep <= HOP_STEP,
    `sitting down and getting up are hops (${STORY_SIT_SECONDS} s), never snaps: the longest step any child took through the story was ${maxStep.toFixed(3)} m (${HOP_STEP} allowed; her walk ends a metre out)`,
  );
  say(
    readingDrift.every((drift) => drift <= 0.05) && anchor.some((at) => at !== null),
    `while the story was read, no seated child moved more than ${Math.max(...readingDrift).toFixed(3)} m (0.05 allowed; ${anchor.filter((at) => at !== null).length} seated through it)`,
  );
  say(
    perchedOff <= 0.1,
    `the owl perched on the story chair within ${perchedOff.toFixed(3)} m of owlPerch() (${perch.x.toFixed(2)}, ${perch.y.toFixed(2)}, ${perch.z.toFixed(2)}; 0.1 allowed), ${OWL_PERCH_BACK} m back of its seat's middle`,
  );
  say(
    awayFrames > 0 && deskClearAway,
    `while she was away (${awayFrames} frames) her desk spot (${desk.x}, ${desk.z}) was clear for a child: ${deskClearAway} — her solid goes with her`,
  );
  const chairSeat = libraryArmchairSize().seat;
  const perchTopGone = collision.highestTopAt(OX + perch.x, OZ + perch.z, Infinity) - LIBRARY_FLOOR_Y; // flat-ok: a top over the reading room's own flat floor
  say(
    Math.abs(perchTopSat - (perch.y + drawnOwlTop)) <= 0.002 && Math.abs(perchTopGone - chairSeat) <= 0.002,
    `solid on the chair: the top over her perch was ${perchTopSat.toFixed(3)} m the first frame she sat there — her head (${(perch.y + drawnOwlTop).toFixed(3)}: the seat ` +
      `${perch.y.toFixed(3)} and her drawn top ${drawnOwlTop.toFixed(3)}), a body nobody stands inside — and ${perchTopGone.toFixed(3)} m once she had flown home (the seat's, ${chairSeat.toFixed(3)})`,
  );
  say(
    !!perchedTouch && perchedTouch.points > 0 && perchedTouch.touchable === 0,
    `the owl as drawn on the chair: ${perchedTouch?.touchable ?? '?'} of her ${perchedTouch?.points ?? 0} visible points are beyond the chair's solids (by more than ${RESOLVER_SLACK} m) ` +
      `where a child standing on clear floor could touch them${perchedTouch?.first ? ` — e.g. ${perchedTouch.first}` : ''}`,
  );
  /** How far a bubble's tail may be from over her head: the anchor is written the frame she moves, so this is rounding. */
  const TAIL_OFF = 0.02;
  say(
    trail.desk > 0 && trail.chair > 0 && trail.worst <= TAIL_OFF,
    `her bubble follows her: on every frame she spoke through the story (${trail.desk} at her desk, the call; ${trail.chair} on the story chair, the reading) ` +
      `its tail was at most ${trail.worst.toFixed(3)} m from ${OWL_BUBBLE_OVER_HEAD} m over her head (${TAIL_OFF} allowed)${trail.worstAt ? `, the worst ${trail.worstAt}` : ''}` +
      `${trail.desk === 0 ? ' — SHE NEVER SPOKE AT HER DESK: the call was not measured' : ''}${trail.chair === 0 ? ' — SHE NEVER SPOKE ON THE CHAIR: nothing measured there' : ''}`,
  );
  say(
    trail.wing === 0 && liveFlight.frames > 0,
    `her flights are silent, so her bubble never hides her flying over the stacks (browser QA round 1): she spoke on ${trail.wing} of her ${liveFlight.frames} frames on the wing — the call is said at her desk, and she takes off when it is said`,
  );
  say(
    readAloud > 0 && readDrawn === readAloud,
    `the child on her cushion can read the story: the label manager drew the owl's bubble on ${readDrawn} of the ${readAloud} frames she read aloud (every one wanted; the screen ${SCREEN.width}×${SCREEN.height})`,
  );
  const bubbleHers = !!bubbleCut && bubbleCut.offHerHead <= TAIL_OFF && bubbleCut.drawn;
  say(
    !!bubbleCut && bubbleHers && (bubbleCut.behind === 0 || !bubbleCut.depthTested),
    `her bubble as she reads from the chair, seen from her cushion — hers, its tail ${bubbleCut?.offHerHead.toFixed(3) ?? '?'} m off over her head (${TAIL_OFF} allowed), drawn ${bubbleCut?.drawn ?? false}: ` +
      `${bubbleCut?.behind ?? '?'} of ${bubbleCut?.points ?? 0} points of it stand behind the room's own furniture from the camera` +
      `${bubbleCut?.first ? ` (e.g. ${bubbleCut.first})` : ''}; it is drawn ${bubbleCut?.depthTested === false ? 'over the scenery (depthTest off), so none of it is cut' : 'DEPTH-TESTED, so it is cut there'}`,
  );
  if (bubbleCut && bubbleHers && bubbleCut.behind === 0) note("STORY: the owl's bubble cleared the room's furniture from this camera — the bubble clause asserted nothing about its depth on this run");
  const pages = book?.pages.map((page) => page.text) ?? [];
  const missing = [
    ...(book ? [LIBRARY_LINES.owl.storyBegin(book.title)] : ['the title line']),
    ...pages,
    ...LIBRARY_LINES.owl.storyEnd,
  ].filter((line) => !said.has(line));
  say(
    !!book && missing.length === 0,
    `she read it all aloud: the title line, all ${pages.length} pages and both ending lines${missing.length ? ` — MISSING ${missing.map((line) => `"${line}"`).join(', ')}` : ''}`,
  );
  say(
    petFrames > 0 && petsOutLeast === pets.length && petsSeatedMost === 0,
    `her pets, a seat not a ride (Jim, 19 Oct): over ${petFrames} frames sitting, at least ${petsOutLeast === Infinity ? '?' : petsOutLeast} of her ${pets.length} out at her heels, ${petsSeatedMost} in a seat beside her`,
  );
  const card = gameStore.get().collection[STORY_LISTENER_SECRET_ID]?.discovered === true;
  say(card, `sitting through the whole story earned her the Story listener card: ${card}`);
  say(
    offCushionAt.every((at) => at <= 20) && homeAt <= 10,
    `afterwards every child was up and a metre off her cushion within ${Math.max(...offCushionAt).toFixed(1)} s of the last word ` +
      `(${kids.map((kid, i) => `${kid.plan.name} ${offCushionAt[i]!.toFixed(1)} s`).join(', ')}; 20 allowed), and the owl home, solid, within ${homeAt.toFixed(1)} s (10 allowed)`,
  );
  const flightLength = Math.round(OWL_FLIGHT_SECONDS / CHILD_DT);
  say(
    flightFrames.length === 2 && flightFrames.every((frames) => Math.abs(frames - flightLength) <= 2) && liveFlight.waited === 0,
    `nobody was in her way: her ${flightFrames.length} flights took ${flightFrames.join(' and ')} frames (${flightLength} for OWL_FLIGHT_SECONDS ${OWL_FLIGHT_SECONDS} s, 2 allowed either way), ` +
      `and she waited ${liveFlight.waited.toFixed(2)} s for anybody (the child on her cushion, her pets at her heels, the children on theirs)`,
  );
  say(
    landed !== null && landed.told === toldBefore + 1 && landed.nextIn === STORY_EVERY,
    `the owl home, story time is idle again with one more story told (${toldBefore} → ${landed?.told ?? '?'}) and the next story's clock set to ${landed?.nextIn ?? '?'} s (STORY_EVERY ${STORY_EVERY} s)` +
      `${landed === null ? ' — STORY TIME NEVER CAME BACK TO IDLE' : ''}`,
  );
  storyHeard = book;
  const seen = fill(collision, OX + LIBRARY_ARRIVAL.x, OZ + LIBRARY_ARRIVAL.z);
  say(!reachedAt(seen, OX + desk.x, OZ + desk.z) && owl.atDesk, `back behind her desk, her middle is unreachable again (the fill from the arrival: ${seen.reached.size} cells)`);
  note(
    `STORY: '${book?.id ?? 'none'}'; phases ${Object.entries(phaseAt).map(([phase, at]) => `${phase} ${at.toFixed(1)} s`).join(', ')}; ` +
      `${liveFlight.flights} flight(s), ${liveFlight.frames} flying frames; ${petFrames} frames sitting with ${pets.length} pets; ${child.frames} frames stepped so far`,
  );
  // Up again, for whoever comes next.
  library.standUp();
  child.run(0.5);
}

console.log("\nFLIGHT — the owl's path to the story chair and home: over every solid with room to spare, and the live owl on it:");
{
  const owl = library.owl;
  const perch = owlPerch();
  const desk = { x: LIBRARY_LIBRARIAN_SPOT.x, y: 0, z: LIBRARY_LIBRARIAN_SPOT.z };
  /** Her drawn plan reach in flight, at an opening of her wings' beat: a fresh model, the beat at either extreme. */
  const reachAt = (open: number): number => {
    let reach = 0;
    for (const sign of [1, -1]) {
      const fresh = createLibraryOwl();
      fresh.wingL.rotation.z = sign * OWL_WING_BEAT * open;
      fresh.wingR.rotation.z = -sign * OWL_WING_BEAT * open;
      reach = Math.max(reach, visibleReachXZ(fresh.root));
    }
    return reach;
  };
  const OPENINGS = [0, 0.25, 0.5, 0.75, 1].map((open) => ({ open, reach: reachAt(open) }));
  const reachFor = (open: number): number => OPENINGS.find((entry) => entry.open >= open - 1e-9)?.reach ?? OPENINGS[OPENINGS.length - 1]!.reach;
  const CLEAR_OVER = 0.3;
  // Her landing and her take-off are her own: the story chair she sits down in, and her desk solid
  // (taken out as she takes off) — out of the world while the path is measured, back after.
  const own = library.solids.filter((solid) => solid.what === LIBRARY_STORY_CHAIR.id || solid.what === 'the owl');
  for (const solid of own) takeOut(solid);
  const flights = [
    { what: 'desk → story chair', from: desk, to: perch },
    { what: 'story chair → desk', from: perch, to: desk },
  ];
  let worst = { margin: Infinity, at: '', top: 0 };
  let over = 0;
  const pose = { x: 0, y: 0, z: 0 };
  for (const leg of flights) {
    for (let i = 0; i <= 400; i += 1) {
      const t = i / 400;
      owlFlightPose(leg.from, leg.to, t, pose);
      const reach = reachFor(owlWingOpening(t));
      let top = -Infinity;
      for (let k = 0; k <= 16; k += 1) {
        const r = k === 0 ? 0 : reach;
        const bearing = (k / 16) * Math.PI * 2;
        top = Math.max(top, collision.highestTopAt(OX + pose.x + Math.sin(bearing) * r, OZ + pose.z + Math.cos(bearing) * r, Infinity));
      }
      if (top === -Infinity) continue;
      over += 1;
      const margin = pose.y - (top - LIBRARY_FLOOR_Y); // flat-ok: the reading room's own flat floor, off the sphere
      if (margin < worst.margin) worst = { margin, at: `${leg.what} at t ${t.toFixed(3)}, (${pose.x.toFixed(2)}, ${pose.y.toFixed(2)}, ${pose.z.toFixed(2)})`, top: top - LIBRARY_FLOOR_Y };
    }
  }
  for (const solid of own) putBack(solid);
  const stack = libraryBookcaseSize('stack').height;
  say(
    over > 0 && worst.margin >= CLEAR_OVER,
    `both flights sampled at 401 points with her drawn plan reach in flight (${OPENINGS.map((entry) => entry.reach.toFixed(2)).join('/')} m as her wings open): over a solid at ${over} of them, ` +
      `her feet at least ${worst.margin.toFixed(2)} m over its top (${CLEAR_OVER} wanted; the least ${worst.at}, over a top of ${worst.top.toFixed(2)} m); ` +
      `her cruise ${owlCruiseHeight().toFixed(2)} m against the stacks' ${stack.toFixed(2)} m`,
  );
  say(
    liveFlight.flights >= 2 && liveFlight.frames > 0 && liveFlight.worst <= 0.01,
    `the live owl flew owlFlightPose itself: ${liveFlight.flights} flights, ${liveFlight.frames} frames, at most ${(liveFlight.worst * 100).toFixed(2)} cm off it (1 cm allowed)`,
  );
  note(`FLIGHT: ${OWL_FLIGHT_SECONDS} s a flight, cruise ${owlCruiseHeight().toFixed(2)} m (the stacks' ${stack.toFixed(2)} + ${OWL_CRUISE_OVER_STACKS}); the owl's own desk solid and the chair she lands in left out of the sweep; ${owl.atDesk ? 'she is home' : 'SHE IS NOT HOME'}`);
}


/**
 * **NEVER INSIDE HER** (browser QA round 1, 23 Oct 2026) — the owl is solid
 * wherever she is drawn, and never moves into anybody.
 *
 * QA found the two drawn inside each other twice: the child hopped onto the
 * story chair's seat and stood inside the reading owl (her only solid was her
 * desk's; the seat is a top), and the owl flew home onto a child standing in
 * her spot behind the desk (her desk solid deliberately waited, so she stood
 * drawn through the child). Now she has a solid on the chair, one moving body
 * on the wing, and she waits for anybody in her way (`LibraryOwl`'s class doc).
 *
 * **The instrument** is the thing QA saw, measured: every visible point of the
 * owl as the game poses her, each frame, inside the real child's own collision
 * cylinder (`PLAYER_RADIUS` round her feet, `KID_HEIGHT` tall — what every
 * solid in the game keeps her out of) by more than the resolver's slack. It
 * has a control first: a cylinder stood on the owl's own feet finds her inside
 * it, one 2.5 m off finds nothing. Then, each by the real child on the stick
 * — her three pets at her heels, the library's children strolling — with the
 * real owl flying by her own `flyTo` (story time not asked, its clock held),
 * each from a state it sets up and asserts:
 *
 * 1. **the seat, the owl on it** (QA's major): hops at the seat from the floor
 *    at its front and from the tops of cushions 4 and 5, at three moments of a
 *    step — she is never up on the chair, the owl never inside her;
 * 2. **the seat, the child on it first**: the owl comes to the chair and waits
 *    over her, never moving her, and perches once she has stepped down;
 * 3. **her desk spot, the child in it** (QA's other major): the owl comes home,
 *    waits over her through three hops, and lands once she has walked out,
 *    her desk solid back;
 * 4. **beside her at take-off**: the child pressed against her north side,
 *    where the climb goes — she waits on the ground until the child steps away;
 * 5. **on her head at take-off**: she does not fly off with the child on her
 *    head, and goes once the child has stepped off.
 *
 * Who she waited for is reported with each (`LibraryOwl.waitingFor`).
 *
 * Proved red by hand (the handoff, with the geometry): the chair solid never
 * attached; the wait taken out (`wouldTouch` always false); her solids' top at
 * the rest pose's height; and the old `LibraryOwl` whole.
 */
console.log('\nNEVER INSIDE HER — the owl is solid wherever she is drawn, and never flies into anybody or comes down on them:');
{
  const spot = LIBRARY_LIBRARIAN_SPOT;
  const perch = owlPerch();
  const chair = libraryArmchairSize();
  const seatTop = chair.seat;
  /** A room-local point in the story chair's own frame (+Z its front, the way its sitter looks). */
  const chairLocal = (x: number, z: number): { x: number; z: number } => {
    const yaw = (LIBRARY_STORY_CHAIR.facing * Math.PI) / 180;
    const dx = x - LIBRARY_STORY_CHAIR.at.x;
    const dz = z - LIBRARY_STORY_CHAIR.at.z;
    return { x: dx * Math.cos(yaw) - dz * Math.sin(yaw), z: dx * Math.sin(yaw) + dz * Math.cos(yaw) };
  };
  /** Up on the story chair: her feet on its seat's top, her middle over the chair or just off its front (QA stood her there). */
  const upOnTheChair = (): boolean => {
    const at = chairLocal(child.room().x, child.room().z);
    const front = chair.centreZ + chair.depth / 2;
    return (
      Math.abs(at.x - chair.centreX) <= chair.width / 2 + 0.1 &&
      at.z <= front + 0.35 &&
      Math.abs(child.player.position.y - (LIBRARY_FLOOR_Y + seatTop)) <= 0.03 // flat-ok: her feet over the reading room's own flat floor
    );
  };

  /** How much of the owl is drawn inside an upright cylinder `radius` round `feet` (world), `height` tall — deeper than the resolver's slack. */
  const owlDrawnInside = (feet: Readonly<Vector3>, radius: number, height: number): { points: number; inside: number; first: string } => {
    let points = 0;
    let inside = 0;
    let first = '';
    const fx = feet.x - OX;
    const fy = feet.y - LIBRARY_FLOOR_Y; // flat-ok: the reading room's own flat floor
    const fz = feet.z - OZ;
    visiblePoints(
      owl.handle.root,
      (p) => {
        points += 1;
        if (Math.hypot(p.x - fx, p.z - fz) > radius - RESOLVER_SLACK) return;
        const up = p.y - fy; // flat-ok: a height in the reading room's own flat space
        if (up < RESOLVER_SLACK || up > height - RESOLVER_SLACK) return;
        inside += 1;
        if (!first) first = `(${p.x.toFixed(2)}, ${p.y.toFixed(2)} up, ${p.z.toFixed(2)})`;
      },
      library.roomRoot,
    );
    return { points, inside, first };
  };
  /** Every frame of a scenario: on how many the owl was drawn inside the child, the worst and where, frames she was up on the chair, and who the owl waited for. */
  interface Watch {
    frames: number;
    insideFrames: number;
    worst: number;
    worstAt: string;
    onChair: number;
    readonly waitedFor: Set<string>;
  }
  const watching = (): Watch => ({ frames: 0, insideFrames: 0, worst: 0, worstAt: '', onChair: 0, waitedFor: new Set() });
  const look = (into: Watch, what: string): void => {
    into.frames += 1;
    if (owl.waitingFor) into.waitedFor.add(owl.waitingFor);
    if (upOnTheChair() && owl.perched) into.onChair += 1;
    const seen = owlDrawnInside(child.player.position, PLAYER_RADIUS, KID_HEIGHT);
    if (seen.inside === 0) return;
    into.insideFrames += 1;
    if (seen.inside <= into.worst) return;
    into.worst = seen.inside;
    const at = child.player.position;
    into.worstAt =
      `${what}: ${seen.inside} of her ${seen.points} points inside the child, e.g. ${seen.first}; the child's feet at room ` +
      `(${(at.x - OX).toFixed(2)}, ${(at.y - LIBRARY_FLOOR_Y).toFixed(2)} up, ${(at.z - OZ).toFixed(2)})`; // flat-ok: room-local, the reading room's own flat space
  };
  /** Steps `seconds` (or until `until`), watching every frame; hands back the seconds `until` took, or NaN. */
  const run = (into: Watch, what: string, seconds: number, steer?: Steer, until?: () => boolean): number => {
    for (let i = 0; i < Math.round(seconds / CHILD_DT); i += 1) {
      child.step(steer);
      look(into, what);
      if (until?.()) return (i + 1) * CHILD_DT;
    }
    return Number.NaN;
  };
  const verdict = (watch: Watch): string =>
    (watch.insideFrames === 0
      ? `the owl drawn inside her on 0 of ${watch.frames} frames`
      : `the owl drawn INSIDE HER on ${watch.insideFrames} of ${watch.frames} frames — the worst ${watch.worstAt}`) +
    `; she waited for ${watch.waitedFor.size ? [...watch.waitedFor].join(', ') : 'nobody'}`;
  /** The top over a room-local point: a solid's, or the floor's. */
  const topAt = (x: number, z: number): number => collision.highestTopAt(OX + x, OZ + z, Infinity) - LIBRARY_FLOOR_Y; // flat-ok: a top over the reading room's own flat floor
  /**
   * **The owl home, or on the chair, with the child well out of her way first** (at the desk's front,
   * her pets with her) — a scenario's starting state, asserted: a set-up that did not happen throws, and
   * says who the owl was waiting for.
   */
  const settle = (home: boolean, into: Watch, what: string): void => {
    child.stand(LIBRARY_DESK_STAND.x, LIBRARY_DESK_STAND.z, LIBRARY_DESK_STAND.facing);
    child.run(1);
    if (home ? owl.atDesk : owl.perched) return;
    owl.flyTo(home);
    const took = run(into, what, OWL_FLIGHT_SECONDS + 6, undefined, () => (home ? owl.atDesk : owl.perched));
    if (Number.isNaN(took)) throw new Error(`NEVER INSIDE HER: ${what} — the owl never got there in ${OWL_FLIGHT_SECONDS + 6} s (waiting for: ${owl.waitingFor || 'nobody'}; flying ${owl.flying}, progress ${owl.flightProgress.toFixed(3)})`);
  };

  // CONTROL — the instrument finds the owl inside a cylinder stood on her own feet, and nothing in one 2.5 m off.
  const atHer = new Vector3(OX + owl.feet.x, LIBRARY_FLOOR_Y + owl.feet.y, OZ + owl.feet.z);
  const onHer = owlDrawnInside(atHer, PLAYER_RADIUS, KID_HEIGHT);
  const offHer = owlDrawnInside(atHer.clone().add(new Vector3(0, 0, -2.5)), PLAYER_RADIUS, KID_HEIGHT);
  say(
    owl.atDesk && onHer.inside > 0 && offHer.inside === 0,
    `CONTROL — the instrument: a child's cylinder (r ${PLAYER_RADIUS}, ${KID_HEIGHT} m) stood on the owl's own feet has ${onHer.inside} of her ${onHer.points} drawn points inside it; ` +
      `one 2.5 m north of her, ${offHer.inside}`,
  );

  // Her solids, as registered, against her drawn reach measured apart on fresh models.
  const perchSolid = library.solids.find((candidate) => candidate.what === 'the owl on the story chair');
  const drawnPerchReach = perchReach(createLibraryOwl());
  const drawnFlightReach = flightReach(createLibraryOwl());
  say(
    !!perchSolid &&
      perchSolid.shape === 'wall' &&
      perchSolid.points.every((point) => Math.abs(point.x - perch.x) < 1e-9 && Math.abs(point.z - perch.z) < 1e-9) &&
      perchSolid.radius >= drawnPerchReach - 0.002 &&
      Math.abs(perchSolid.top - (perch.y + drawnOwlTop)) <= 0.002 &&
      owl.flightRadius >= drawnFlightReach - 0.002,
    `her solid on the story chair: 'the owl on the story chair' ${perchSolid ? `a zero-length capsule at (${perch.x.toFixed(2)}, ${perch.z.toFixed(2)}), r ${perchSolid.radius.toFixed(3)}, top ${perchSolid.top.toFixed(3)}` : 'NOT REGISTERED'} ` +
      `against her drawn reach perched ${drawnPerchReach.toFixed(3)} m (a fresh model: breath at its widest, head straight, wings down) and her head on the seat ` +
      `${(perch.y + drawnOwlTop).toFixed(3)}; on the wing a moving body r ${owl.flightRadius.toFixed(3)} against her drawn reach in flight ${drawnFlightReach.toFixed(3)} m (2 mm allowed)`,
  );

  // 1. The seat, the owl on it: hops at the seat from the floor at its front (QA's spot between
  // cushions 4 and 5) and from the tops of cushions 4 and 5 (QA's other road, "Up+Left from cushion
  // 5"), each at three moments of a step.
  const toChair = watching();
  settle(false, toChair, 'flying to the chair');
  const seatTopPerched = topAt(perch.x, perch.z);
  const cushionTop = libraryCushionSize().top;
  const seatFront = { x: perch.x - 0.2, z: perch.z + 0.5 };
  const STARTS = [
    { what: "the floor at the chair's front", x: 4.0, z: -9.95, up: 0, dx: seatFront.x - 4.0, dz: seatFront.z + 9.95 },
    { what: 'the top of cushion 5', x: libraryCushion('cushion-5').at.x, z: libraryCushion('cushion-5').at.z, up: cushionTop, dx: -0.55, dz: -0.85 },
    { what: 'the top of cushion 4', x: libraryCushion('cushion-4').at.x, z: libraryCushion('cushion-4').at.z, up: cushionTop, dx: 0.55, dz: -0.85 },
  ];
  /** Stood at a start: on the floor, or on a cushion's top (a teleport to its height, as a child who climbed it is). */
  const standAt = (start: (typeof STARTS)[number]): void => {
    child.player.teleportTo(OX + start.x, LIBRARY_FLOOR_Y + start.up, OZ + start.z, Math.PI);
    camera.snapTo(child.player.position);
    child.run(0.3);
  };
  /** QA's hop: the stick held toward the seat, jump pressed `after` seconds in, the stick let go `hold` seconds in. */
  const hopAtTheSeat = (start: (typeof STARTS)[number], after: number, hold: number, into: Watch | null): void => {
    const steer = child.towards(start.dx, start.dz);
    for (let i = 0; i < Math.round(1.6 / CHILD_DT); i += 1) {
      if (i === Math.round(after / CHILD_DT)) child.input.pressVirtual('jump');
      child.step(i * CHILD_DT < hold ? steer : undefined);
      if (into) look(into, `hopping at the seat from ${start.what}, the jump ${after} s in`);
    }
  };
  const hops = watching();
  let hopsTried = 0;
  for (const start of STARTS) {
    for (const after of [0.06, 0.15, 0.3]) {
      standAt(start);
      hopAtTheSeat(start, after, 0.45, hops);
      hopsTried += 1;
    }
  }
  say(
    owl.perched && Math.abs(seatTopPerched - (perch.y + drawnOwlTop)) <= 0.002 && hops.onChair === 0 && hops.insideFrames === 0 && toChair.insideFrames === 0,
    `the seat with the owl on it (QA's major): perched (${owl.perched}), the top over her perch ${seatTopPerched.toFixed(3)} m — her head; ` +
      `${hopsTried} hops at the seat from its front and from cushions 4 and 5 — the child up on the chair on ${hops.onChair} frames, ${verdict(hops)}; flying in, ${verdict(toChair)}`,
  );

  // 2. The seat, the child on it first: the owl home, the child hops up the way QA did, the owl comes — and waits.
  const home1 = watching();
  settle(true, home1, 'flying home');
  let upOn = false;
  for (const hold of [0.38, 0.3, 0.45, 0.52]) {
    standAt(STARTS[1]!);
    hopAtTheSeat(STARTS[1]!, 0.06, hold, null);
    upOn = upOnTheChair() && !child.player.isAirborne;
    if (upOn) break;
  }
  child.run(0.3);
  const onSeatAt = child.room();
  const rescuesOnSeat = child.player.wedgeRescues;
  const firstOn = watching();
  owl.flyTo(false);
  run(firstOn, 'the owl coming to the chair with the child on its seat', 6);
  const waitedOverHer = owl.waited;
  const waitingThen = owl.waitingFor;
  const stillUp = upOnTheChair();
  const perchedOnHer = owl.perched;
  const offAt = child.room();
  const stayedPut = Math.hypot(offAt.x - onSeatAt.x, offAt.z - onSeatAt.z);
  const rescuesWaited = child.player.wedgeRescues - rescuesOnSeat;
  // Down off the chair the way she came, and off with her pets along the north aisle, out of the owl's way.
  // Down off the chair the way she came, over cushion 5's top (a step, climbed walking into it: the floor
  // in front of the chair between cushions 4 and 5 is narrower than she is), and then she goes — stood at the
  // desk's front, as a child who walked off would be; her pets walk after her.
  const back = child.room();
  run(firstOn, 'the child stepping down off the seat over cushion 5, the owl waiting over her', 0.8, child.towards(libraryCushion('cushion-5').at.x + 0.6 - back.x, libraryCushion('cushion-5').at.z + 0.6 - back.z));
  const steppedTo = child.room();
  child.stand(LIBRARY_DESK_STAND.x, LIBRARY_DESK_STAND.z, LIBRARY_DESK_STAND.facing);
  const goneTo = child.room();
  const perchedAfter = run(firstOn, 'the owl perching once the seat is free', OWL_FLIGHT_SECONDS + 8, undefined, () => owl.perched);
  say(
    upOn && stillUp && !perchedOnHer && waitedOverHer > 2 && waitingThen === 'the child' && stayedPut <= 0.01 && !Number.isNaN(perchedAfter) && firstOn.insideFrames === 0,
    `the child on the seat first (up on it: ${upOn}, at room (${onSeatAt.x.toFixed(2)}, ${onSeatAt.z.toFixed(2)})): the owl came and waited ${waitedOverHer.toFixed(1)} s for '${waitingThen || 'nobody'}' ` +
      `(perched on her: ${perchedOnHer}; the child moved ${stayedPut.toFixed(3)} m meanwhile, 0.01 allowed; still up on the chair: ${stillUp}), and perched ${perchedAfter.toFixed(1)} s after she had gone ` +
      `(stepped down to room (${steppedTo.x.toFixed(2)}, ${steppedTo.z.toFixed(2)}), then off to the desk's front (${goneTo.x.toFixed(2)}, ${goneTo.z.toFixed(2)})); ${verdict(firstOn)}`,
  );
  say(
    upOn && rescuesWaited === 0,
    `nothing about where she stood changed with the owl waiting over her (${OWL_HEADROOM} m of headroom kept over a head, a step): ${rescuesWaited} wedge put-down(s) ` +
      `while the owl waited (none wanted; an owl hovering a hand over her hair once made the chair's arm — a step she could climb — a wall, and put her down on a cushion 1.25 m off)`,
  );

  // 3. Her desk spot, the child in it (QA's other major): the owl comes home, waits over her through three hops, lands once she has walked out.
  const toChair2 = watching();
  settle(false, toChair2, 'flying to the chair');
  child.stand(spot.x, spot.z, 0);
  child.run(0.5);
  const inSpot = child.room();
  const spotClear = topAt(spot.x, spot.z) <= 0.01;
  const homing = watching();
  owl.flyTo(true);
  run(homing, 'the owl coming home with the child in her spot', 6);
  const waitedHome = owl.waited;
  const waitingHome = owl.waitingFor;
  const landedOnHer = owl.atDesk;
  const stood = child.room();
  const moved = Math.hypot(stood.x - inSpot.x, stood.z - inSpot.z);
  for (let hop = 0; hop < 3; hop += 1) {
    child.input.pressVirtual('jump');
    run(homing, `hop ${hop + 1} under the waiting owl`, 1.2);
  }
  // Out from behind the desk the way a child goes: north onto the entrance hall's aisle, and off east along it, her pets after her.
  run(homing, 'the child walking out of her spot, north', 0.3, child.towards(0, -1));
  run(homing, 'the child going off east along the aisle, her pets after her', 1.2, child.towards(1, 0));
  const leftTo = child.room();
  const landed = run(homing, 'the owl landing once her spot is free', OWL_FLIGHT_SECONDS + 8, undefined, () => owl.atDesk);
  const deskTop = topAt(spot.x, spot.z);
  say(
    spotClear && !landedOnHer && waitedHome > 2 && waitingHome === 'the child' && moved <= 0.01 && !Number.isNaN(landed) && Math.abs(deskTop - drawnOwlTop) <= 0.002 && homing.insideFrames === 0,
    `the child in the owl's desk spot (QA's other major; the spot clear floor while she was away: ${spotClear}): the owl came home and waited ${waitedHome.toFixed(1)} s for '${waitingHome || 'nobody'}' ` +
      `(landed on her: ${landedOnHer}; the child moved ${moved.toFixed(3)} m, 0.01 allowed; three hops under her), and landed ${landed.toFixed(1)} s after she had walked out (to room (${leftTo.x.toFixed(2)}, ${leftTo.z.toFixed(2)})), ` +
      `the top over her spot then ${deskTop.toFixed(3)} m — her head, her desk solid back; ${verdict(homing)}`,
  );

  // 4. Beside her at take-off: the child pressed against her north side, in the climb's way.
  const home2 = watching();
  settle(true, home2, 'flying home');
  child.stand(spot.x, spot.z - (owl.radius + PLAYER_RADIUS + 0.02), 180);
  child.run(0.5);
  const beside = child.room();
  const besideApart = Math.hypot(beside.x - spot.x, beside.z - spot.z);
  const takeOff = watching();
  owl.flyTo(false);
  run(takeOff, 'the owl about to take off with the child against her', 3);
  const heldOnGround = !owl.airborne && owl.waited >= 2.9 && Math.abs(topAt(spot.x, spot.z) - drawnOwlTop) <= 0.002;
  const waitingBeside = owl.waitingFor;
  run(takeOff, 'the child stepping away west', 1.2, child.towards(-1, 0));
  const flewOff = run(takeOff, 'the owl taking off once there is room', OWL_FLIGHT_SECONDS + 8, undefined, () => owl.perched);
  say(
    besideApart <= owl.flightRadius + PLAYER_RADIUS && heldOnGround && takeOff.waitedFor.has('the child') && !Number.isNaN(flewOff) && takeOff.insideFrames === 0,
    `the child pressed against her at take-off, ${besideApart.toFixed(2)} m north of her middle (her wings want ${(owl.flightRadius + PLAYER_RADIUS).toFixed(2)}): ` +
      `she waited on the ground (for '${waitingBeside || 'nobody'}' at 3 s), her desk solid still under her (${heldOnGround}), and flew once the child stepped away (perched ${flewOff.toFixed(1)} s later); ${verdict(takeOff)}`,
  );

  // 5. On her head at take-off: home first, then the child stood on her head, then asked to fly.
  const home3 = watching();
  settle(true, home3, 'flying home');
  child.player.teleportTo(OX + spot.x, LIBRARY_FLOOR_Y + drawnOwlTop, OZ + spot.z, 0);
  camera.snapTo(child.player.position);
  child.run(0.5);
  const headFeet = child.player.position.y - LIBRARY_FLOOR_Y; // flat-ok: her feet over the reading room's own flat floor
  const onHead = Math.abs(headFeet - drawnOwlTop) <= 0.02 && !child.player.isAirborne;
  const onHerHead = watching();
  owl.flyTo(false);
  run(onHerHead, 'the owl asked to fly with the child on her head', 3);
  const stayedDown = !owl.airborne && owl.waited >= 2.9;
  const waitingHead = owl.waitingFor;
  // Off her head the way a child goes: a step off its edge, north, onto the floor, and off east along the aisle.
  run(onHerHead, 'the child stepping off her head', 0.4, child.towards(0, -1));
  run(onHerHead, 'the child going off east along the aisle, her pets after her', 1.2, child.towards(1, 0));
  const flewAfter = run(onHerHead, 'the owl taking off once her head is free', OWL_FLIGHT_SECONDS + 8, undefined, () => owl.perched);
  say(
    onHead && stayedDown && onHerHead.waitedFor.has('the child') && !Number.isNaN(flewAfter) && onHerHead.insideFrames === 0,
    `the child stood on her head (her feet at ${headFeet.toFixed(3)} m, her drawn top ${drawnOwlTop.toFixed(3)}: on her head ${onHead}): asked to fly, she stayed down for '${waitingHead || 'nobody'}' (${stayedDown}) ` +
      `(for '${waitingHead || 'nobody'}' at 3 s) and flew once the child stepped off (perched ${flewAfter.toFixed(1)} s later); ${verdict(onHerHead)}`,
  );

  // Home again, the child at the desk's front, for CLOCK.
  const home4 = watching();
  settle(true, home4, 'flying home');
  const between = [home1, toChair2, home2, home3, home4];
  const merged: Watch = watching();
  for (const watch of between) {
    merged.frames += watch.frames;
    merged.insideFrames += watch.insideFrames;
    if (watch.worst > merged.worst) {
      merged.worst = watch.worst;
      merged.worstAt = watch.worstAt;
    }
    for (const who of watch.waitedFor) merged.waitedFor.add(who);
  }
  say(
    owl.atDesk && !owl.flying && Math.abs(topAt(spot.x, spot.z) - drawnOwlTop) <= 0.002 && merged.insideFrames === 0,
    `and home behind her desk at the end, solid there (${owl.atDesk}); her flights between the scenarios, the child at the desk's front: ${verdict(merged)}`,
  );
  note(
    `NEVER INSIDE HER: ${[toChair, hops, home1, firstOn, toChair2, homing, home2, takeOff, home3, onHerHead, home4].reduce((sum, watch) => sum + watch.frames, 0)} frames watched ` +
      `(the owl's ${onHer.points} drawn points against the child's cylinder each frame); her chair solid r ${perchSolid?.radius.toFixed(3) ?? '?'}, her body on the wing r ${owl.flightRadius.toFixed(3)}, ` +
      `her solids' top ${drawnOwlTop.toFixed(3)} m over her feet; ${child.frames} frames stepped so far`,
  );
}

console.log('\nCLOCK and ABORT — the next story comes STORY_EVERY after the last one, a different book; a fresh visit\'s forty seconds in; and leaving mid-story leaves nobody sitting:');
{
  const owl = library.owl;
  const kids = library.children;
  // The next story. STORY left story time idle at its landing, its clock held at STORY_EVERY (asserted
  // there): let it go where FLIGHT left her, at the desk's front, and wait for the call.
  const told = library.storyTime.told;
  const clockAt = library.storyTime.nextIn;
  const recommended = owl.recommendedBookId;
  library.storyTime.holdClock(false);
  let calledNext = Number.NaN;
  for (let t = 0; t < STORY_EVERY + 5; t += CHILD_DT) {
    child.step();
    if (library.storyPhase !== 'idle') {
      calledNext = t + CHILD_DT;
      break;
    }
  }
  const nextBook = library.storyTime.book;
  say(
    clockAt === STORY_EVERY && Math.abs(calledNext - STORY_EVERY) <= 2 * CHILD_DT,
    `with the clock let go after story ${told}'s landing, the next story is called ${calledNext.toFixed(2)} s on (STORY_EVERY ${STORY_EVERY} s; the clock stood at ${clockAt} s)`,
  );
  // The rule, restated: a different story every time — the recommended book if no story has read it yet,
  // else the first of the owl's order story time may read that no story has; never the one just heard.
  const mayRead = RECOMMENDATION_ORDER.filter(storyTimeMayRead);
  const unheard = (id: string | null): boolean => id !== null && id !== storyHeard?.id && mayRead.some((book) => book.id === id);
  const wantedId = unheard(recommended) ? recommended : (mayRead.find((book) => unheard(book.id))?.id ?? null);
  say(
    !!storyHeard && told === 1 && !!nextBook && nextBook.id === wantedId && nextBook.id !== storyHeard.id,
    `and it reads a different book: '${nextBook?.id ?? 'none'}' after STORY's '${storyHeard?.id ?? 'none'}' (story ${told + 1} of this session; ` +
      `'${wantedId ?? 'none'}' wanted — the owl recommending '${recommended ?? 'nothing'}', which ${recommended !== null && recommended === storyHeard?.id ? 'STORY has read' : 'no story has read'})`,
  );
  // And over whole rounds, which no child stays long enough for here (twelve stories is half an hour):
  // the real StoryTime, driven through its four phases by a stand-in owl that is always free, perched
  // and quiet, with no children — four frames a story. Three owls: one recommending STORY's book all
  // along, one recommending nothing, and one that starts recommending the last book of her order just
  // before the round's last story (so the round ends on it, and the next must not begin with it).
  const lastOfOrder = mayRead[mayRead.length - 1]?.id ?? null;
  const rounds = [
    { what: `recommending '${storyHeard?.id ?? 'none'}' all along`, recommends: (_story: number): string | null => storyHeard?.id ?? null },
    { what: 'recommending nothing', recommends: (_story: number): string | null => null },
    { what: `recommending '${lastOfOrder ?? 'none'}' from story ${mayRead.length}`, recommends: (story: number): string | null => (story >= mayRead.length ? lastOfOrder : null) },
  ].map(({ what, recommends }) => {
    let story = 1;
    const standIn = {
      atDesk: true,
      midScript: false,
      perched: true,
      speaking: false,
      flying: false,
      get recommendedBookId(): string | null {
        return recommends(story);
      },
      tell: (): void => {},
      flyTo: (): void => {},
      sparkleOver: (): void => {},
    };
    const time = new StoryTime(standIn as unknown as LibraryOwl, () => [], () => ({ seated: false, feet: { x: 0, y: 0, z: 0 } }));
    const read: string[] = [];
    for (; story <= mayRead.length + 2; story += 1) {
      time.requestStoryTime();
      time.update(CHILD_DT, true);
      read.push(time.book?.id ?? 'none');
      for (let frame = 0; frame < 3; frame += 1) time.update(CHILD_DT, true);
    }
    const firstRound = read.slice(0, mayRead.length);
    const repeats = read.flatMap((id, i) => (i > 0 && id === read[i - 1] ? [`${i}→${i + 1} '${id}'`] : []));
    const ok =
      new Set(firstRound).size === mayRead.length &&
      mayRead.every((book) => firstRound.includes(book.id)) &&
      repeats.length === 0 &&
      (recommends(1) === null || read[0] === recommends(1)) &&
      time.told === read.length;
    return { what, read, repeats, ok };
  });
  say(
    rounds.every((round) => round.ok),
    `a different story every time, over whole rounds (the real StoryTime, ${mayRead.length + 2} stories each): the first ${mayRead.length} all different and every book story time may read among them, ` +
      `the recommended one first, never the same book twice running — ${rounds.map((round) => `${round.what}: ${round.read.join(' → ')}${round.repeats.length ? ` (TWICE RUNNING: ${round.repeats.join(', ')})` : ''}`).join('; ')}`,
  );
  // A fresh visit: out by the door (which leaves this story mid-gathering) and back in at the desk's front, the clock let go.
  if (!quietly(() => library.requestEnterDoor())) throw new Error('CLOCK: /library-door refused her');
  child.run(0.2);
  child.enter({ x: LIBRARY_DESK_STAND.x, z: LIBRARY_DESK_STAND.z, facing: LIBRARY_DESK_STAND.facing });
  const startsAt = library.storyTime.nextIn;
  let called = Number.NaN;
  for (let t = 0; t < STORY_FIRST_AFTER + 5; t += CHILD_DT) {
    child.step();
    if (library.storyPhase !== 'idle') {
      called = t + CHILD_DT;
      break;
    }
  }
  say(
    startsAt === STORY_FIRST_AFTER && Math.abs(called - STORY_FIRST_AFTER) <= 2 * CHILD_DT,
    `with the clock let go, a fresh visit's first story is called ${called.toFixed(2)} s in (STORY_FIRST_AFTER ${STORY_FIRST_AFTER} s; the clock started at ${startsAt} s)`,
  );
  // Mid-gathering, at least one child sitting: she leaves by the door.
  let anySeated = false;
  for (let t = 0; t < GATHER_TIMEOUT && !anySeated; t += CHILD_DT) {
    child.step();
    anySeated = kids.some((kid) => kid.body.seated && !kid.body.hopping);
  }
  const phaseLeft = library.storyPhase;
  if (!quietly(() => library.requestEnterDoor())) throw new Error('ABORT: /library-door refused her');
  child.run(0.2);
  const deskSolid = !collision.isClearCircle(OX + LIBRARY_LIBRARIAN_SPOT.x, OZ + LIBRARY_LIBRARIAN_SPOT.z, 0.05);
  say(
    anySeated && phaseLeft !== 'idle' && library.storyPhase === 'idle' && kids.every((kid) => !kid.body.seated && kid.driver.mode !== 'seated') &&
      owl.atDesk && !owl.flying && !owl.perched && !owl.speaking && deskSolid && library.storyTime.nextIn === STORY_FIRST_AFTER,
    `left by the door mid-story (it was '${phaseLeft}', a child sitting: ${anySeated}): story time is idle (${library.storyPhase}), ` +
      `nobody left sitting (${kids.map((kid) => `${kid.plan.name} ${kid.body.seated ? 'SEATED' : kid.driver.mode}`).join(', ')}), ` +
      `the owl home behind her desk (at desk ${owl.atDesk}, flying ${owl.flying}, perched ${owl.perched}) and solid there (${deskSolid}), quiet (${!owl.speaking}), ` +
      `the next visit's clock at ${library.storyTime.nextIn} s`,
  );
  // Back in, at the desk's front, the clock held again for whatever comes next.
  library.storyTime.holdClock(true);
  child.enter({ x: LIBRARY_DESK_STAND.x, z: LIBRARY_DESK_STAND.z, facing: LIBRARY_DESK_STAND.facing });
  child.run(0.5);
  note(
    `CLOCK: the next story called ${calledNext.toFixed(2)} s after story ${told}'s landing, reading '${nextBook?.id ?? 'none'}'; a fresh visit's called ${called.toFixed(2)} s in; ` +
      `ABORT left at '${phaseLeft}'; ${child.frames} frames stepped so far`,
  );
}

// ── Track C (#719: the den's walls, the secret shelf, the dragon and the cat, plan Steps 11-13) adds its clauses below this line. ──

console.log('\nHOUSEKEEPING:');
{
  say(spaceAt(OX, OZ) === SPACE_LIBRARY, `spaceAt the room's origin is '${spaceAt(OX, OZ)}'`);
  say(scene.children.includes(library.roomRoot), 'the room root is in the scene');
  let parent = library.parkRoot.parent;
  while (parent && parent.parent && parent.parent !== scene) parent = parent.parent;
  say(library.parkRoot.parent?.name === 'anchor:library' && Boolean(parent), `the building stands in its park plot (${library.parkRoot.parent?.name ?? 'nowhere'})`);
  say(library.bookCount >= 300, `${library.bookCount} decorative books on the shelves`);
  say(library.stacks.length === LIBRARY_BOOKCASES.filter((spec) => spec.kind === 'stack').length, `${library.stacks.length} stacks, each able to fade`);
  say(library.screenLabels.includes(library.nameLabel), `the building names itself over its door ('${library.nameLabel.identity.id}')`);
  say(
    library.screenLabels.includes(library.owl.bubble) && library.owl.bubble.identity.item === OWL_ZONE_ID && library.owl.bubble.identity.kind === 'actionFeedback',
    `the owl's bubble is among the room's labels, as '${library.owl.bubble.identity.kind}' for item '${library.owl.bubble.identity.item}' (so it is drawn over her chip, never under it)`,
  );
  const owlSolid = library.solids.find((candidate) => candidate.what === 'the owl');
  note(
    `the librarian's spot is a solid, not a keep-out: 'the owl' at (${LIBRARY_LIBRARIAN_SPOT.x}, ${LIBRARY_LIBRARIAN_SPOT.z}), ` +
      `a disc of r ${owlSolid?.radius.toFixed(3) ?? '?'} with its top at ${owlSolid?.top.toFixed(3) ?? '?'} m — a jump off the desk's top (${libraryDeskSize().top.toFixed(2)} m) can land on her head`,
  );
  say(
    library.denRoot.parent === library.roomRoot && !library.denRoot.visible,
    `the secret den is built in the reading room ('${library.denRoot.parent?.name ?? 'nowhere'}'), so it leaves the park's drawn reach with it, and is hidden while the shelf is shut`,
  );
  note(
    `the secret den: ${library.denWalls.length} walls; the lintel's band from ${library.lintel.baseHeight.toFixed(2)} m over its doorway z ${(library.lintel.z1 - OZ).toFixed(2)}..${(library.lintel.z2 - OZ).toFixed(2)}`,
  );
  note(
    `seed's library at (${library.frame.x.toFixed(1)}, ${library.frame.z.toFixed(1)}), ${library.solids.length} room solids, ` +
      `${library.shellSolids.walls.length} ring walls, ${library.shellSolids.corners.length} corner squares, ${library.shellSolids.edges.length} plinth edges, ${library.shellSolids.columns.length} columns`,
  );
  note('the reading room is seed-independent, so one seed measures it; the exterior is walked on every seed by aChildWalksUpTheLibraryStepsAndIn');
}

if (MUTATE !== '' && !mutationArmed) {
  say(false, `LIBRARY_CHECK_MUTATE=${MUTATE} was asked for, but no clause in this build arms it — this run ASSERTS NOTHING about it`);
}
console.log(bad === 0 ? '\nAll clauses passed.' : `\n${bad} clause(s) FAILED.`);
process.exit(bad === 0 ? 0 : 1);
