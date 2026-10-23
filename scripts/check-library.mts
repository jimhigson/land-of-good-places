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
import { Color, Group, HemisphereLight, Mesh, MeshToonMaterial, Vector3, type BufferAttribute, type Light, type Object3D, type Texture } from 'three';
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
import { BOOKS, CHAPTER_BOOKS, PICTURE_BOOKS, type LibraryBook } from '../src/world/library/books.ts';
import { isBookRead, markBookRead } from '../src/world/library/readBooks.ts';
import { RECOMMENDATION_ORDER, recommendFor } from '../src/world/library/recommendation.ts';
import { LIBRARY_CARD, hasLibraryCard } from '../src/world/library/libraryCard.ts';
import { HEAD_TURN_LIMIT, OWL_LOOK_RANGE, OWL_ZONE_ID, SHUSH_COOLDOWN_SECONDS, SHUSH_RUN_SECONDS, SHUSH_WING_X } from '../src/world/library/LibraryOwl.ts';
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
import { SHELF_BOOK_ZONE_PREFIX, shelfBookZoneId } from '../src/world/library/shelfBooks.ts';
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
  say(CHAPTER_BOOKS.length <= chapterSlots.length, `${chapterSlots.length} big readers' slots for the ${CHAPTER_BOOKS.length} chapter books`);
  if (CHAPTER_BOOKS.length < chapterSlots.length) {
    note(
      `${chapterSlots.length - CHAPTER_BOOKS.length} of the ${chapterSlots.length} big readers' slots wait for their chapter books — ` +
        `BOOKS (${BOOKS.length}) and LIBRARY_READABLE_SLOTS (${LIBRARY_READABLE_SLOTS.length}) must be equal before track A's shelf books are paired with them`,
    );
  }
  const shelves = libraryBookcaseSize('wall').shelfTops;
  say(shelves.some((top) => top > KID_REACH_HEIGHT), `CONTROL: the drawn case does have shelves out of her reach (${shelves.filter((top) => top > KID_REACH_HEIGHT).map((top) => top.toFixed(3)).join(', ')}), so the measure can say no`);

  // Which book the check expects in which slot: `shelfBooks.ts`'s pairing, by
  // index — read back here from the two lists, never from the pairing itself.
  // `shift-books` expects the next book along instead, which must go red,
  // naming the books.
  const shift = mutating('shift-books') ? 1 : 0;
  if (shift > 0) note('SHIFTED the pairing this check expects by one on purpose (slot i must hold BOOKS[i+1]) — this run must go red, naming the books');
  // A slot past the last book waits for one (the big readers' shelf, until its
  // chapter books land): it holds nothing, and nothing below asks it to.
  const expected = LIBRARY_READABLE_SLOTS.map((slot, i): { slot: (typeof LIBRARY_READABLE_SLOTS)[number]; book: (typeof BOOKS)[number] | null } => ({
    slot,
    book: i < BOOKS.length ? BOOKS[(i + shift) % BOOKS.length]! : null,
  }));
  const waiting = expected.filter(({ book }) => book === null);
  note(
    waiting.length === 0
      ? `every one of the ${LIBRARY_READABLE_SLOTS.length} slots holds a book`
      : `${waiting.length} slot(s) WAIT for their books, so nothing is asserted about what stands in them: ${waiting.map(({ slot }) => `slot ${slot.index + 1} (${slot.bookcase}, shelf ${slot.shelf}, ${slot.along} m along)`).join(', ')}`,
  );

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
    if (!book) continue;
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
    if (!book) continue;
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
}

const child: RealChild = (() => {
  const player = quietly(() => new Player(world.collision, camera, new Vector3(OX + LIBRARY_ARRIVAL.x, LIBRARY_FLOOR_Y, OZ + LIBRARY_ARRIVAL.z)));
  scene.add(player.group);
  quietly(() => world.attachPlayer(player));
  const input = new InputSystem();
  const context = { dt: CHILD_DT, elapsed: 0, input, playerPosition: player.position, cameraForward: camera.forward, frame: 0 };
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
  };
})();

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

console.log('\nOWL — the librarian at her desk: solid, and alive:');
{
  const player = child.player;
  const solid = library.solids.find((candidate) => candidate.what === 'the owl');
  say(
    !!solid &&
      solid.shape === 'wall' &&
      solid.points.length === 2 &&
      solid.points.every((point) => point.x === owlSpot.x && point.z === owlSpot.z) &&
      solid.radius === owl.radius &&
      solid.top === owl.handle.height,
    `'the owl' is registered as a zero-length capsule at (${owlSpot.x}, ${owlSpot.z}): a disc of r ${owl.radius.toFixed(3)} (her measured plan reach, head and glasses included), ` +
      `top ${owl.handle.height.toFixed(3)} m (her measured height)${solid ? '' : ' — NOT REGISTERED'}`,
  );
  say(owl.radius > 0.5 && owl.radius < 0.9, `her reach is a round owl's: ${owl.radius.toFixed(3)} m (0.5..0.9 wanted; the Artist's body alone is ±0.40, her head and glasses reach further)`);
  say(!libraryKeepOuts().some((spot) => spot.what === owlSpot.what), `${owlSpot.what} is no longer a keep-out (${libraryKeepOuts().length} keep-outs, none of them hers)`);
  const seen = fill(collision, OX + LIBRARY_ARRIVAL.x, OZ + LIBRARY_ARRIVAL.z);
  say(!reachedAt(seen, OX + owlSpot.x, OZ + owlSpot.z), `the fill does not reach her middle at (${owlSpot.x}, ${owlSpot.z}) — she is solid (${seen.reached.size} cells reached from the arrival)`);
  // Marched at her from sixteen bearings, as MARCHED marches at every box: a body's edge never gets into her drawn disc.
  let marches = 0;
  let skipped = 0;
  let deepest = -Infinity;
  const reach = owl.radius + 2.2;
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
      deepest = Math.max(deepest, PLAYER_RADIUS - (Math.hypot(end.x - OX - owlSpot.x, end.z - OZ - owlSpot.z) - owl.radius));
    }
  }
  say(
    marches >= 16 && deepest <= RESOLVER_SLACK,
    `${marches} marches at her from ${16 - skipped} bearings (${skipped} starts skipped: off the plate or inside a solid — the desk stands in front of her): ` +
      `the deepest a body's edge got into her drawn disc is ${deepest.toFixed(3)} m (allowance ${RESOLVER_SLACK})`,
  );
  let nearestAisle = { id: '', clearance: Infinity };
  for (const aisle of LIBRARY_AISLES) {
    for (let i = 0; i + 1 < aisle.points.length; i += 1) {
      const clearance = segmentDistance(aisle.points[i]!, aisle.points[i + 1]!, owlSpot) - owl.radius - PLAYER_RADIUS;
      if (clearance < nearestAisle.clearance) nearestAisle = { id: aisle.id, clearance };
    }
  }
  say(nearestAisle.clearance >= 0, `AISLES above swept every aisle with her in the world; the nearest, '${nearestAisle.id}', passes ${nearestAisle.clearance.toFixed(3)} m clear of her disc at a player's radius`);

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
  note(`OWL: r ${owl.radius.toFixed(3)}, top ${owl.handle.height.toFixed(3)}; blink changes ${changes}, longest ${longest} frame(s); head ${left.rot.toFixed(2)} / ${right.rot.toFixed(2)}; ${child.frames} frames stepped so far`);
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
  for (let i = 0; i < Math.round(20 / CHILD_DT) && owl.speaking; i += 1) {
    child.step();
    if (owl.lastSaid !== null) said.add(owl.lastSaid);
    flapLow = Math.min(flapLow, owl.handle.wingR.rotation.z);
  }
  const lines = LIBRARY_LINES.owl.card;
  say(
    lines.every((line) => said.has(line)) && !owl.speaking,
    `her ${lines.length} card lines were said in turn and the bubble went away: ${[...said].map((line) => `"${line}"`).join(', ')}`,
  );
  say(flapLow <= -0.3, `on the hand-over line (#${LIBRARY_LINES.owl.cardCheerAt + 1}) she flapped the wing that holds her book: rotation.z down to ${flapLow.toFixed(2)}`);
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

  note(
    `KIDS: ${kids.length} children, seeds 0x${LIBRARY_KID_SEED.toString(16)} + i·${LIBRARY_KID_SEED_STRIDE}; ${legs.length} legs swept at ${SWEEP_STEP} m with a ${SWEEP_RADIUS.toFixed(2)} m body; ` +
      `the walk to a seat ends ${seatArrive.toFixed(2)} m from its middle (cushion ${cushionRadius.toFixed(2)} + NPC_RADIUS ${NPC_RADIUS} + slack) and the sit is a snap of that; ` +
      `stroll pace ${GUEST_PACE}, summons pace ${KID_SUMMON_PACE}, route arrive ${KID_ROUTE_ARRIVE}, leg timeout ${KID_LEG_TIMEOUT} s; ${child.frames} frames stepped so far`,
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
