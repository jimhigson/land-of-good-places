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
 * LIBRARY_CHECK_REMOVE='den wall (west)' pnpm run check:library  # a wall of the secret den out: DEN WALLS must go red
 * LIBRARY_CHECK_REMOVE='bookcase west-2' pnpm run check:library  # the shut secret shelf out: the den is reachable, must go red
 * LIBRARY_CHECK_MUTATE=no-lintel pnpm run check:library       # the lintel over the den's doorway out: LINTEL must go red
 * LIBRARY_CHECK_MUTATE=seal-den pnpm run check:library        # a wall across the doorway once the leaf has landed: SECRET SHELF's open fills must go red
 * LIBRARY_CHECK_MUTATE=open-leaf-hollow pnpm run check:library  # the open leaf's collider out once it has landed: its middle is reachable, must go red
 * LIBRARY_CHECK_REMOVE='dragon' pnpm run check:library        # the baby dragon and its nest not solid: CREATURES must go red
 * LIBRARY_CHECK_REMOVE='cat' pnpm run check:library           # the library cat and her pile not solid: CREATURES must go red
 * LIBRARY_CHECK_REMOVE='the baby dragon' pnpm run check:library  # the dragon alone not solid, its nest still there: CREATURES must go red
 * LIBRARY_CHECK_REMOVE='the library cat' pnpm run check:library  # the cat alone not solid, her pile still there: CREATURES must go red
 * LIBRARY_CHECK_MUTATE=wide-creature-tops pnpm run check:library  # the dragon's and the cat's tops made whole: a jump lands her on one, must go red
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
 * 15. SECRET SHELF, GUARD, FRESH VISIT (#719, plan Step 12) — the real child
 *     presses **Pull the book!** at the pull stand: the gold book slides out,
 *     the leaf swings monotonically to π/2 in 1.8–2.0 s with the shut
 *     collider holding to the last frame, and open, the fill reaches every
 *     keep-out (the den's included) with zero pockets, the den is leavable, the
 *     open leaf is solid and landable, the walls hold in room ∪ den, a walker
 *     passes under the lintel, the swing sweeps no other solid, and the west
 *     wall and the leaf fade while she is in the den. Found in the den with the
 *     leaf shut, the guard opens it in one frame; a link into the den opens it
 *     in the same call; and out through the door and back in from the park,
 *     the leaf is shut and the den sealed again.
 * 16. CREATURES (#719, plan Step 13) — the baby dragon on its nest of books
 *     and the library cat on her pile: four bodies, each in its own shape,
 *     every drawn point of each inside its body at rest and on every frame of
 *     its life; the dragon's and the cat's tops too narrow for her feet; their
 *     middles unreached and each marched at from sixteen bearings (the nest
 *     and the pile from the floor, the dragon and the cat from up on them);
 *     and the real child's jumps at both, standing by and from a sprint,
 *     never stand her on either, never wedge her and never leave her in the
 *     air. The Dragon friend card on meeting it, with a control; its hello,
 *     then "Hello again" on a visit after; Say hi's answers and one discovery;
 *     the idle puff (with a vacuity guard), the belly's glow up and back, the
 *     warm sprites, and the head turning to her side. The cat: Pet the cat!
 *     twitches her ears, lifts her face, makes her happy and then asleep,
 *     purrs, and a second press inside the guard changes nothing.
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
import { Color, Group, HemisphereLight, Mesh, MeshToonMaterial, Sprite, Vector3, type BufferAttribute, type Light, type Object3D, type SpriteMaterial, type Texture } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { Player } from '../src/entities/Player.ts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import { saveFlags } from '../src/state/flags.ts';
import { CollisionWorld, JUMP_CLEARANCE_GRACE, type BoxCollider } from '../src/world/Collision.ts';
import { FOOT_HALF_WIDTH } from '../src/world/measuredTop.ts';
import { WEDGE_DEPTH, wedgeDepth } from '../src/world/standing.ts';
import { visiblePoints } from '../src/art/style/measure.ts';
import { gameStore } from '../src/state/store.ts';
import { DRAGON_BELLY_REST_GLOW } from '../src/art/models/libraryCreatures.ts';
import {
  DRAGON_FRIEND_SECRET,
  DRAGON_HEAD_TURN_LIMIT,
  DRAGON_LOOK_RADIUS,
  DRAGON_MEET_RADIUS,
  DRAGON_NEST_SOLID,
  DRAGON_PUFF_GLOW,
  DRAGON_PUFF_SECONDS,
  DRAGON_SOLID,
  DRAGON_ZONE_ID,
} from '../src/world/library/LibraryDen.ts';
import { CAT_PILE_SOLID, CAT_SOLID, CAT_ZONE_ID, PET_GUARD_SECONDS, PET_SECONDS } from '../src/world/library/LibraryCat.ts';
import { WalkSurfaces } from '../src/world/building/surfaces.ts';
import { standingAt, walkableAt } from './lib/standable.mts';
import { MAX_FRAME_DELTA, PLAYER_LONGEST_STEP, PLAYER_RADIUS, BUILDING_STEP_UP, PLAYER_DECELERATION, PLAYER_MAX_SPEED } from '../src/core/constants.ts';
import { PALETTE } from '../src/core/palette.ts';
import { glowTexture } from '../src/core/textures.ts';
import { KID_REACH_HEIGHT } from '../src/art/models/kid.ts';
import { BOOKS, CHAPTER_BOOKS, PICTURE_BOOKS } from '../src/world/library/books.ts';
import { bandCrossed } from '../src/world/tapSpacing.ts';
import { SPACE_GARDEN, SPACE_LIBRARY, spaceAt } from '../src/world/spaces.ts';
import { terrainHeight } from '../src/world/terrain.ts';
import { END_HALF, LibraryProps, libraryKeepOuts, segmentDistance, type BoxFootprint, type LibrarySolid } from '../src/world/library/props.ts';
import { bookcaseCentre, READABLE_LEAN, READABLE_PROUD } from '../src/world/library/furnish.ts';
import { SHELF_BOOK_ZONE_PREFIX, shelfBookZoneId } from '../src/world/library/shelfBooks.ts';
import { buildLibraryDenShell, buildReadingRoomShell, libraryDenGap, LIBRARY_SECRET_BOOK_ZONE } from '../src/world/library/shell.ts';
import { SECRET_LEAF_OPEN, SLIDE, SLIDE_SECONDS, SWING_END, SWING_SECONDS, TWINKLE_PERIOD } from '../src/world/library/secretShelf.ts';
import { ART } from '../src/art/style/artPalette.ts';
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
  LIBRARY_CAT_PILE,
  LIBRARY_CAT_STAND,
  LIBRARY_DEN_DOOR_HALF,
  LIBRARY_DEN_DOORWAY_STAND,
  LIBRARY_DEN_INNER,
  LIBRARY_DESK_STAND,
  LIBRARY_DOOR_HALF,
  LIBRARY_DOOR_X,
  LIBRARY_DRAGON_NEST,
  LIBRARY_DRAGON_STAND,
  LIBRARY_FLOOR_Y,
  LIBRARY_FURNITURE,
  LIBRARY_HALF_X,
  LIBRARY_HALF_Z,
  LIBRARY_INNER_X,
  LIBRARY_INNER_Z,
  LIBRARY_ORIGIN_X,
  LIBRARY_ORIGIN_Z,
  LIBRARY_PLAYER_SEATS,
  LIBRARY_READABLE_SLOTS,
  LIBRARY_SECRET_BOOK,
  LIBRARY_SECRET_BOOKCASE,
  LIBRARY_SECRET_STAND,
  LIBRARY_WALL_HALF,
  libraryCushion,
  libraryFacingStoryChair,
  type FurnitureSpec,
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
 * added with the harness); `wide-creature-tops` is CREATURES' (#719, plan
 * Step 13 on the engine: the dragon's and the cat's measured narrow tops made
 * whole, so the real child's jumps must land her on them — the control that
 * the jump sweep can see a child standing on a creature at all); the rest are
 * the plan's (Steps 3-14).
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
  'wide-creature-tops',
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
    `${keepOuts.length} keep-outs: ${roomSpots.length} in the reading room (arrival, doorway, desk, librarian, rug, seats, secret shelf, ` +
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
  // The baby dragon on its nest (#719, plan Step 13) fills the den's far
  // corner: a grid spot whose body would stand in one of those two solids is
  // set apart by name, never by a rectangle of this clause's own — and only
  // those; a body that cannot stand anywhere else still fails.
  const creatureSolids = library.solids.filter((solid) => solid.what === DRAGON_SOLID || solid.what === DRAGON_NEST_SOLID);
  const underCreatures: string[] = [];
  for (const body of bodies) {
    if (libraryDenContains(body.x, body.z) && creatureSolids.some((solid) => depthInSolid(solid, body) > -PLAYER_RADIUS)) {
      underCreatures.push(`(${body.x.toFixed(2)}, ${body.z.toFixed(2)})`);
      continue;
    }
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
    placed === bodies.length - underCreatures.length && underCreatures.length <= 2 && creatureSolids.length === 2 && escaped === 0,
    `${placed} of ${bodies.length} bodies stood in the den (${underCreatures.length} spot(s) under the baby dragon and its nest set apart, at most 2: ${underCreatures.join(' ') || 'none'}), ` +
      `${marches} marches (${headings.length} headings, 5 cm and the sprint stride): ${escaped} ended outside the den and the room`,
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
  // The secret shelf (#719) registers two tops and only one is ever in the
  // world: shut, the case's is somewhere to land and the open leaf's is den
  // floor nobody can reach. `Library.standables` says so, or the landings
  // above would have asked the air to hold her.
  const shutTop = standables.some((s) => s.what === `bookcase ${LIBRARY_SECRET_BOOKCASE.id}`);
  const openTop = standables.some((s) => s.what === SECRET_LEAF_OPEN);
  const openRegistered = library.solids.some((s) => s.what === SECRET_LEAF_OPEN);
  say(
    shutTop && !openTop && openRegistered,
    `the secret shelf's shut top is in the world and its open one (registered: ${openRegistered}) is not — only the state the leaf is in is somewhere to land`,
  );
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
  collision.setPlayBounds(bounds);
  const context = { dt: 1 / 60, elapsed: 1, playerPosition: probe.position, frame: 1 } as unknown as FrameContext;
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
 * cushion offers 'Get up' and the other offers nothing. 'Get up' stands her on
 * clear floor and she walks off; sat down again, a jump stands her up, with no
 * hop in it.
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

  // 'Get up': up at once, on clear floor, and she walks off.
  seatedOffer[0]?.run();
  const upByChip = !player.riding && !library.playerIsSeated;
  const clearWhereShe = collision.isClearCircle(player.position.x, player.position.z, PLAYER_RADIUS);
  child.run(0.5);
  say(
    upByChip && clearWhereShe,
    `'${LIBRARY_CHIPS.getUp}' stands her up (riding ${player.riding}, seated ${library.playerIsSeated}) where a body of her size is clear: ${clearWhereShe}; ` +
      `half a second on she stands at (${child.room().x.toFixed(2)}, ${child.room().z.toFixed(2)}), her feet ${feet().toFixed(3)} m up`,
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

// ── Track C (#719: the den's walls, the secret shelf, the dragon and the cat, plan Steps 11-13) adds its clauses below this line. ──

/**
 * **How deep room-local `p` is inside a registered solid**, metres (negative:
 * outside) — a disc by its radius, a capsule by its half-thickness about its
 * segment, a box by the least inward distance to its four edges, whichever way
 * they are wound. For the SWEEP clause, which asks it of every solid the
 * swinging leaf passes over.
 */
function depthInSolid(solid: LibrarySolid, p: LocalPoint): number {
  if (solid.shape === 'disc') return solid.radius - Math.hypot(p.x - solid.points[0]!.x, p.z - solid.points[0]!.z);
  if (solid.shape === 'wall') return solid.radius - segmentDistance(solid.points[0]!, solid.points[1]!, p);
  const corners = solid.points;
  let area = 0;
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    area += a.x * b.z - b.x * a.z;
  }
  const orientation = Math.sign(area) || 1;
  let depth = Infinity;
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const cross = (ex * (p.z - a.z) - ez * (p.x - a.x)) / Math.hypot(ex, ez);
    depth = Math.min(depth, cross * orientation);
  }
  return depth;
}

/** How far a point of the swinging leaf may reach into another solid's footprint and still be a graze, not a sweep: a centimetre, under the leaf's own ink. */
const SWEEP_GRAZE = 0.01;
/** The plan's accepted clip north of the doorway's edge by the leaf's front-free corner (4.5 cm at about 8.5°, plan Step 12), as the most it may be. */
const JAMB_CLIP_ACCEPTED = 0.05;
/** A point-sized probe for "is this exact spot bare floor" — where a body of her size would be in a wall either way. */
const POINT_PROBE = 0.05;

/**
 * **SECRET SHELF** (#719, plan Step 12) — the real child, at the pull stand,
 * presses **Pull the book!** and the leaf swings open into the den.
 *
 * Measured on every frame of the swing: the angle never falls back, never
 * steps further than the ease-out cubic's steepest rate, lands at exactly
 * `SWING_END` 1.8–2.0 s after the press (the slide, then the swing), and the
 * shut case's middle is solid on every turning frame — the swap is on landing.
 * Open: the fill from the arrival reaches every keep-out, the den's included,
 * with zero pockets; the case's old middle is clear and the open leaf's is not;
 * a fill seeded beside the dragon reaches the arrival and the way out
 * (enterable *and* leavable); the open leaf is marched at from sixteen bearings
 * and landed on across its footprint; the walls still hold, in room ∪ den; a
 * walker passes under the lintel; and the pull zone offers nothing. SWEEP:
 * the leaf's rectangle, sampled through every angle, passes over no other
 * solid and no keep-out outside the den, and its front-free corner clips the
 * north jamb's drawn edge by no more than the plan accepts. FADE: in the den
 * the west wall and the leaf go translucent; in the central aisle nothing does.
 *
 * `seal-den` walls the doorway up once the leaf has landed (the open fills go
 * red); `open-leaf-hollow` takes the open collider out once it has landed (the
 * open leaf's middle is reachable). `LIBRARY_CHECK_REMOVE='bookcase west-2'`
 * is REACHABILITY's red above: the den reachable while shut.
 */
console.log('\nSECRET SHELF — the real child pulls the gold book; the leaf swings open into the den, the shut collider holding to the last frame:');
{
  const leaf = library.secretShelf;
  const spec = LIBRARY_SECRET_BOOKCASE;
  const size = libraryBookcaseSize(spec.kind);
  const [gapNorth, gapSouth] = libraryDenGap();
  const shut = leaf.shutFootprint;
  const open = leaf.openFootprint;
  const player = child.player;
  const middleClear = (box: BoxFootprint): boolean => collision.isClearCircle(OX + box.x, OZ + box.z, PLAYER_RADIUS);
  /**
   * Is a footprint's middle bare floor, asked with a point-sized probe: the
   * open footprint lies 0.3 m off the den's south wall, so a body of her size
   * at its middle is in that wall whether or not the leaf is there, and only a
   * point can say which.
   */
  const middleBare = (box: BoxFootprint): boolean => collision.isClearCircle(OX + box.x, OZ + box.z, POINT_PROBE);
  const zones = (): InteractZone[] => library.interactZones();
  const pullZone = (): InteractZone | undefined => zones().find((zone) => zone.id === LIBRARY_SECRET_BOOK_ZONE);
  const pullChip = (): ZoneAction | undefined => pullZone()?.actions?.().find((action) => action.id === PRIMARY_ACTION);
  const denSpots = libraryKeepOuts().filter((spot) => spot.den);

  // Shut to begin with: SIT left her standing in the room, and nothing has pulled the book.
  say(!leaf.open && !leaf.swinging && leaf.angle === 0 && !library.denOpen && !library.denRoot.visible, `shut to begin with: angle ${leaf.angle}, open ${leaf.open}, the den hidden (${library.denRoot.visible})`);
  say(
    !middleClear(shut) && !middleBare(shut) && middleBare(open),
    `shut, the case's middle (${shut.x.toFixed(2)}, ${shut.z.toFixed(2)}) is solid and the open footprint's middle (${open.x.toFixed(2)}, ${open.z.toFixed(2)}) is bare den floor (a ${POINT_PROBE} m probe is clear there)`,
  );
  // The open footprint, read back against the layout: along the den's south
  // wall's inner face, the leaf's own length and depth, facing into the den.
  say(
    Math.abs(open.x - (spec.at.x - size.length / 2)) < 1e-9 &&
      Math.abs(open.z + open.halfDepth - LIBRARY_DEN_INNER.south) < 1e-9 &&
      Math.abs(open.z - (gapSouth - size.depth / 2)) < 1e-9 &&
      open.facing === 180 &&
      Math.abs(open.halfLength - size.length / 2) < 1e-9 &&
      Math.abs(open.halfDepth - size.depth / 2) < 1e-9,
    `the open footprint lies flush along the den's south wall (its back on z ${(open.z + open.halfDepth).toFixed(2)}, the wall's inner face ${LIBRARY_DEN_INNER.south.toFixed(2)}), ` +
      `x ${(open.x - open.halfLength).toFixed(2)}..${(open.x + open.halfLength).toFixed(2)}, facing ${open.facing} (into the den), the case's own ${size.length.toFixed(2)} x ${size.depth.toFixed(2)}`,
  );

  // At the pull stand; the twinkle, over one period shut.
  child.stand(LIBRARY_SECRET_STAND.x, LIBRARY_SECRET_STAND.z, LIBRARY_SECRET_STAND.facing);
  camera.snapTo(player.position);
  let peak = 0;
  let trough = 1;
  for (let i = 0; i < Math.round(TWINKLE_PERIOD / CHILD_DT) + 2; i += 1) {
    child.step();
    const opacity = (leaf.twinkle.material as SpriteMaterial).opacity;
    peak = Math.max(peak, opacity);
    trough = Math.min(trough, opacity);
  }
  say(peak > 0.9 && trough === 0, `shut, the gold book twinkles: over ${TWINKLE_PERIOD} s its sprite's opacity peaks at ${peak.toFixed(2)} and rests at ${trough.toFixed(2)}`);

  // The chip: on the gold book where it stands shut, stood at the pull stand, the rainbow round the book itself.
  library.roomRoot.updateMatrixWorld(true);
  const bookWorld = leaf.pullBook.getWorldPosition(new Vector3());
  const zone = pullZone();
  const chip = pullChip();
  const reach = zone ? Math.hypot(player.position.x - zone.standX, player.position.z - zone.standZ) : Infinity;
  const zoneOffBook = zone ? Math.hypot(zone.x - bookWorld.x, zone.z - bookWorld.z) : Infinity;
  const standOff = zone ? Math.hypot(zone.standX - (OX + LIBRARY_SECRET_STAND.x), zone.standZ - (OZ + LIBRARY_SECRET_STAND.z)) : Infinity;
  say(
    !!zone && chip?.label === LIBRARY_CHIPS.pull && reach <= standRadiusOf(zone) && zoneOffBook < 1e-6 && standOff < 1e-9 && zone.highlight?.object === leaf.pullBook && zone.verb === 'Pull',
    `standing at ${LIBRARY_SECRET_STAND.what} (${LIBRARY_SECRET_STAND.x.toFixed(2)}, ${LIBRARY_SECRET_STAND.z.toFixed(2)}), '${LIBRARY_SECRET_BOOK_ZONE}' offers '${chip?.label ?? 'nothing'}' ` +
      `(wanted '${LIBRARY_CHIPS.pull}'), ${reach.toFixed(2)} m from its stand (reach ${zone ? standRadiusOf(zone) : '?'}), the zone ${zoneOffBook.toFixed(3)} m off the book, ` +
      `its stand ${standOff.toFixed(3)} m off the layout's, verb '${zone?.verb ?? '?'}', the rainbow ${zone?.highlight?.object === leaf.pullBook ? 'rings' : 'does NOT ring'} the gold book`,
  );
  // The gold book itself: inside its case's drawn box (drawn implies solid), on its shelf, in gold.
  const bookLocal = { x: bookWorld.x - OX, z: bookWorld.z - OZ };
  const shelfTop = size.shelfTops[LIBRARY_SECRET_BOOK.shelf] ?? Number.NaN;
  const bookBase = bookWorld.y - LIBRARY_FLOOR_Y; // flat-ok: height over the reading room's own flat floor, off the sphere
  const gold = (leaf.pullBook.material as MeshToonMaterial).color.equals(new Color(ART.helmetGold));
  say(
    outsideBox(shut, bookLocal.x, bookLocal.z) < 0 && Math.abs(bookBase - shelfTop) <= 0.02 && gold && leaf.pullBook.name === 'library.secretBook',
    `the gold book '${leaf.pullBook.name}' stands ${(-outsideBox(shut, bookLocal.x, bookLocal.z)).toFixed(3)} m inside the shut case's drawn box at (${bookLocal.x.toFixed(2)}, ${bookLocal.z.toFixed(2)}), ` +
      `its base at ${bookBase.toFixed(3)} m on shelf ${LIBRARY_SECRET_BOOK.shelf} (${shelfTop.toFixed(3)}), painted ${gold ? 'helmetGold' : 'NOT gold'}`,
  );

  // Press. The swing, frame by frame.
  const homeZ = leaf.pullBook.position.z;
  const pressedAt = child.frames;
  chip?.run();
  let lastAngle = leaf.angle;
  let monotone = true;
  let maxStep = 0;
  let landedFrame = -1;
  let turningFrames = 0;
  let heldThrough = true;
  let slidOut = 0;
  for (let i = 0; i < 150; i += 1) {
    child.step();
    const angle = leaf.angle;
    if (angle < lastAngle - 1e-9) monotone = false;
    maxStep = Math.max(maxStep, angle - lastAngle);
    slidOut = Math.max(slidOut, leaf.pullBook.position.z - homeZ);
    if (angle > 0 && !leaf.open) {
      turningFrames += 1;
      if (middleClear(shut)) heldThrough = false;
    }
    if (landedFrame < 0 && leaf.open) landedFrame = child.frames - pressedAt;
    lastAngle = angle;
  }
  const steepest = (SWING_END * 3) / SWING_SECONDS;
  const landedAfter = landedFrame * CHILD_DT;
  say(
    leaf.swinging === false && leaf.open && monotone && maxStep <= steepest * CHILD_DT + 1e-6,
    `the swing is monotone (never falls back) and never steps more than its steepest rate: the largest frame step ${maxStep.toFixed(4)} rad ` +
      `(the ease-out cubic's ${(steepest * CHILD_DT).toFixed(4)} at most)`,
  );
  say(
    Math.abs(leaf.angle - SWING_END) <= 1e-6 && landedFrame > 0 && landedAfter >= 1.8 && landedAfter <= 2.0,
    `it lands at ${leaf.angle.toFixed(6)} rad (π/2 wanted) ${landedAfter.toFixed(3)} s after the press (1.8–2.0: the slide's ${SLIDE_SECONDS} s then the swing's ${SWING_SECONDS} s)`,
  );
  say(
    turningFrames >= 60 && heldThrough,
    `during the swing (${turningFrames} turning frames) the shut case's middle was never clear floor: she can never walk through a half-open leaf; the swap is the landing frame`,
  );
  say(
    slidOut >= SLIDE - 0.005 && Math.abs(leaf.pullBook.position.z - homeZ) < 1e-3,
    `the gold book slid ${slidOut.toFixed(3)} m out of its row (${SLIDE} wanted) and has eased home (${(leaf.pullBook.position.z - homeZ).toFixed(4)} m out now)`,
  );

  // The mutations: once the leaf has landed, wall the doorway up, or take the open collider out.
  const sealing = mutating('seal-den') ? collision.addWall(OX - LIBRARY_HALF_X, OZ + gapNorth, OX - LIBRARY_HALF_X, OZ + gapSouth, LIBRARY_WALL_HALF) : null;
  if (sealing) note(`WALLED the den's doorway up (x ${-LIBRARY_HALF_X}, z ${gapNorth}..${gapSouth}, half ${LIBRARY_WALL_HALF}) once the leaf landed, on purpose — this run must go red`);
  const openSolid = library.solids.find((solid) => solid.what === SECRET_LEAF_OPEN);
  const hollow = mutating('open-leaf-hollow') ? openSolid : undefined;
  if (hollow) {
    takeOut(hollow);
    note(`TOOK the open leaf's collider ('${SECRET_LEAF_OPEN}') out once it landed, on purpose — this run must go red`);
  }

  // OPEN: the doorway is clear, the open leaf solid, the den enterable and leavable.
  say(middleClear(shut) && !middleBare(open), `open: the case's old middle is clear floor for a body of her size and the open leaf's middle is solid to a ${POINT_PROBE} m probe`);
  const pullOffer = pullZone()?.actions?.().length ?? -1;
  say(pullOffer === 0, `open, the pull zone offers ${pullOffer} action(s): unselectable, so Selection's cached box for a book that has swung away is never consulted`);
  say(library.denOpen && library.denRoot.visible, `the Library says the den is open (${library.denOpen}) and draws it (${library.denRoot.visible})`);
  const seen = fill(collision, OX + LIBRARY_ARRIVAL.x, OZ + LIBRARY_ARRIVAL.z);
  const keepOuts = libraryKeepOuts();
  const unreached = keepOuts.filter((spot) => !reachedAt(seen, OX + spot.x, OZ + spot.z));
  for (const spot of unreached.slice(0, 4)) say(false, `${spot.what} at (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)}) is not reachable from the arrival with the leaf open`);
  say(
    unreached.length === 0 && denSpots.length > 0,
    `from the arrival the fill reaches every keep-out, the den's ${denSpots.length} included: ${keepOuts.length - unreached.length} of ${keepOuts.length}`,
  );
  const pockets = [...seen.clear].filter((k) => !seen.reached.has(k));
  say(pockets.length === 0, `zero pockets with the leaf open: ${pockets.length} clear cell(s) unreached of ${seen.clear.size}${pockets.length > 0 ? `, e.g. (${cellCentre(pockets[0]!).x.toFixed(2)}, ${cellCentre(pockets[0]!).z.toFixed(2)})` : ''}`);
  say(
    reachedAt(seen, OX + shut.x, OZ + shut.z) && !reachedAt(seen, OX + open.x, OZ + open.z),
    `the fill reaches the case's old middle (${shut.x.toFixed(2)}, ${shut.z.toFixed(2)}) and not the open leaf's (${open.x.toFixed(2)}, ${open.z.toFixed(2)})`,
  );
  const fromDen = fill(collision, OX + LIBRARY_DRAGON_STAND.x, OZ + LIBRARY_DRAGON_STAND.z);
  say(
    reachedAt(fromDen, OX + LIBRARY_ARRIVAL.x, OZ + LIBRARY_ARRIVAL.z) && reachedAt(fromDen, OX + LIBRARY_DOOR_X, OZ + LIBRARY_HALF_Z),
    `a fill seeded ${LIBRARY_DRAGON_STAND.what} reaches the arrival and the way out's centre: the den is enterable and leavable (${fromDen.reached.size} cells)`,
  );

  // MARCHED at the open leaf, 16 bearings, both strides: her edge never gets into its drawn footprint past the corner allowance.
  {
    let marches = 0;
    let skipped = 0;
    let deepest = 0;
    const reachOut = Math.hypot(open.halfLength, open.halfDepth) + 2.2;
    for (let b = 0; b < 16; b += 1) {
      const angle = (b / 16) * Math.PI * 2;
      const start = new Vector3(OX + open.x + Math.cos(angle) * reachOut, 0, OZ + open.z + Math.sin(angle) * reachOut);
      if (!onFloor(start.x - OX, start.z - OZ) || !collision.isClearCircle(start.x, start.z, PLAYER_RADIUS)) {
        skipped += 1;
        continue;
      }
      for (const step of [0.05, PLAYER_LONGEST_STEP]) {
        marches += 1;
        const end = march(collision, start, new Vector3(OX + open.x, 0, OZ + open.z), step, reachOut + 1);
        deepest = Math.max(deepest, PLAYER_RADIUS - outsideBox(open, end.x - OX, end.z - OZ));
      }
    }
    say(
      marches >= 8 && deepest <= CORNER_ALLOWANCE,
      `${marches} marches at the open leaf from 16 bearings at 5 cm and the sprint stride (${skipped} starts skipped: off the floor or inside a solid): ` +
        `deepest a body's edge got into its drawn footprint ${deepest.toFixed(3)} m, allowance ${CORNER_ALLOWANCE.toFixed(3)}`,
    );
  }

  // LANDING on the open leaf: her feet find its top across its footprint; a
  // ring outside finds the floor — or another top where another standable
  // stands (west-3's, the case south of the doorway, at the leaf's hinge end),
  // as LANDING's own control leaves those to the higher one.
  {
    const present = library.standables;
    const standable = present.find((s) => s.what === SECRET_LEAF_OPEN);
    const shutStill = present.some((s) => s.what === `bookcase ${spec.id}`);
    if (!standable) {
      say(false, `the open leaf's top ('${SECRET_LEAF_OPEN}') is not in the world's tops now it has landed — nothing landed on`);
    } else {
      let points = 0;
      let missed = 0;
      let controls = 0;
      let controlWrong = 0;
      let covered = 0;
      for (const [u, v] of grid(standable.footprint, 0)) {
        points += 1;
        const y = standingAt(collision, surfaces.sample.bind(surfaces), OX + u, OZ + v, standable.top + 0.1);
        if (Math.abs(y - standable.top) > FEET_TOLERANCE) missed += 1;
      }
      for (const [u, v] of grid(standable.footprint, 0.1)) {
        if (present.some((other) => other !== standable && footprintCovers(other.footprint, u, v))) {
          covered += 1;
          continue;
        }
        controls += 1;
        const y = standingAt(collision, surfaces.sample.bind(surfaces), OX + u, OZ + v, standable.top + 0.1);
        if (Math.abs(y) > FEET_TOLERANCE) controlWrong += 1;
      }
      say(
        !shutStill && points > 100 && missed === 0 && controls > 40 && controlWrong === 0,
        `her feet find the open leaf's top (${standable.top.toFixed(2)} m) at ${points - missed} of ${points} landings across its footprint, and the floor at ${controls - controlWrong} of ${controls} ` +
          `points 0.1 m outside it (${covered} under another top, left to it); the shut case's top is ${shutStill ? 'STILL' : 'no longer'} somewhere to land`,
      );
    }
  }

  // The walls hold with the leaf open: the same 48 marches end in the room or the den, or through the door.
  {
    let escaped = 0;
    let intoDen = 0;
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
        const inRoom = Math.abs(lx) <= LIBRARY_HALF_X + 0.05 && Math.abs(lz) <= LIBRARY_HALF_Z + 0.05;
        const inDen = libraryDenContains(lx, lz);
        const throughDoor = Math.abs(lx - LIBRARY_DOOR_X) < LIBRARY_DOOR_HALF && lz > LIBRARY_INNER_Z;
        if (inDen) intoDen += 1;
        if (!inRoom && !inDen && !throughDoor) escaped += 1;
      }
    }
    say(escaped === 0 && intoDen > 0, `the walls hold with the leaf open: ${escaped} of 48 marches left the room and the den other than through the door (${intoDen} ended in the den, through its doorway)`);
  }

  // Under the lintel, open: a walker passes into the den, a flier over the case's height still stops.
  {
    const caseTop = size.height;
    const throughZ = OZ + spec.at.z;
    const atLintel = -LIBRARY_INNER_X + PLAYER_RADIUS - RESOLVER_SLACK;
    const outside = -(LIBRARY_HALF_X + LIBRARY_WALL_HALF) - PLAYER_RADIUS;
    const walker = marchAt(new Vector3(OX - 16, LIBRARY_FLOOR_Y, throughZ), -1, 0, 0.05, 0).x - OX;
    const flier = marchAt(new Vector3(OX - 16, LIBRARY_FLOOR_Y + caseTop + 0.8, throughZ), -1, 0, 0.05, caseTop + 0.8).x - OX;
    say(
      libraryDenContains(walker, spec.at.z) && walker < outside && flier >= atLintel,
      `with the leaf open a walker on the floor passes under the lintel into the den (to x ${walker.toFixed(2)}) and a flier at ${(caseTop + 0.8).toFixed(2)} m still stops at it (x ${flier.toFixed(2)}, at least ${atLintel.toFixed(2)})`,
    );
  }

  // The mutations' traces come out, so what follows measures the game.
  if (sealing) collision.removeWall(sealing);
  if (hollow) putBack(hollow);

  // SWEEP: the leaf's rectangle, sampled through every angle of its swing, in the room's frame.
  {
    const hinge = { x: spec.at.x, z: gapSouth };
    const yaw = (spec.facing * Math.PI) / 180;
    const L = size.length;
    const D = size.depth;
    /** Leaf-local (u along its length, v through its depth) at swing angle `a`, room-local. */
    const leafPoint = (a: number, u: number, v: number): LocalPoint => {
      const hx = u * Math.cos(a) + v * Math.sin(a);
      const hz = -u * Math.sin(a) + v * Math.cos(a);
      return { x: hinge.x + hx * Math.cos(yaw) + hz * Math.sin(yaw), z: hinge.z - hx * Math.sin(yaw) + hz * Math.cos(yaw) };
    };
    // CONTROL on the sweep's own geometry: shut, the leaf's middle is the shut footprint's; open, the open one's.
    const shutMiddle = leafPoint(0, L / 2, D / 2);
    const openMiddle = leafPoint(SWING_END, L / 2, D / 2);
    say(
      Math.hypot(shutMiddle.x - shut.x, shutMiddle.z - shut.z) < 1e-9 && Math.hypot(openMiddle.x - open.x, openMiddle.z - open.z) < 1e-9,
      `CONTROL: the sweep's leaf at 0 is the shut footprint (middle ${shutMiddle.x.toFixed(2)}, ${shutMiddle.z.toFixed(2)}) and at π/2 the open one (${openMiddle.x.toFixed(2)}, ${openMiddle.z.toFixed(2)})`,
    );
    const others = library.solids.filter((solid) => solid.handle !== leaf.shutColliders[0] && solid.handle !== leaf.openColliders[0]);
    const roomKeepOuts = libraryKeepOuts().filter((spot) => !spot.den);
    let deepestSolid = { what: 'none', depth: -Infinity, at: { x: 0, z: 0 }, angle: 0 };
    let deepestInClip = { what: 'none', depth: -Infinity, angle: 0 };
    let deepestKeepOut = { what: 'none', depth: -Infinity };
    let clip = { over: -Infinity, angle: 0 };
    let samples = 0;
    let inClip = 0;
    const steps = 180;
    for (let ai = 0; ai <= steps; ai += 1) {
      const a = (ai / steps) * SWING_END;
      for (let u = 0; u <= L + 1e-9; u += 0.05) {
        for (const v of [0, D / 2, D]) {
          const p = leafPoint(a, u, v);
          samples += 1;
          // North of the doorway's north edge is the accepted clip: the
          // front-free corner's swing past the shut case's own north end, into
          // the jamb's drawn edge and the drawn end of the case beside it
          // (west-1). It is measured by itself below, and bounded; here it is
          // set apart so that bound, not this clause, is what accepts it.
          const over = gapNorth - p.z;
          if (over > 0) {
            inClip += 1;
            if (over > clip.over) clip = { over, angle: a };
            for (const solid of others) {
              const depth = depthInSolid(solid, p);
              if (depth > deepestInClip.depth) deepestInClip = { what: solid.what, depth, angle: a };
            }
            continue;
          }
          for (const solid of others) {
            const depth = depthInSolid(solid, p);
            if (depth > deepestSolid.depth) deepestSolid = { what: solid.what, depth, at: p, angle: a };
          }
          for (const spot of roomKeepOuts) {
            const depth = spot.radius - Math.hypot(p.x - spot.x, p.z - spot.z);
            if (depth > deepestKeepOut.depth) deepestKeepOut = { what: spot.what, depth };
          }
        }
      }
    }
    say(
      others.length > 50 && samples - inClip > 40000 && deepestSolid.depth <= SWEEP_GRAZE,
      `the swing sweeps no other solid: ${samples - inClip} leaf points through ${steps + 1} angles against ${others.length} solids, the deepest any gets into one ` +
        `${deepestSolid.depth.toFixed(3)} m (${deepestSolid.what}, at (${deepestSolid.at.x.toFixed(2)}, ${deepestSolid.at.z.toFixed(2)}), ${((deepestSolid.angle * 180) / Math.PI).toFixed(1)}°; a graze of ${SWEEP_GRAZE} allowed)`,
    );
    say(
      roomKeepOuts.length > 50 && deepestKeepOut.depth <= 0,
      `and no keep-out outside the den: the nearest the leaf comes to one is ${(-deepestKeepOut.depth).toFixed(3)} m short of ${deepestKeepOut.what} (${roomKeepOuts.length} room keep-outs)`,
    );
    say(
      clip.over > 0 && clip.over <= JAMB_CLIP_ACCEPTED,
      `the front-free corner swings ${Math.max(0, clip.over).toFixed(3)} m north of the doorway's edge at ${((clip.angle * 180) / Math.PI).toFixed(1)}° — through the jamb's drawn edge and ` +
        `${deepestInClip.depth.toFixed(3)} m into ${deepestInClip.what} at ${((deepestInClip.angle * 180) / Math.PI).toFixed(1)}° (${inClip} leaf points) — ` +
        `the plan's accepted clip, up to ${JAMB_CLIP_ACCEPTED}: a slit beside the shut case would give the secret away`,
    );
  }

  // FADE: in the den, the west wall (its spans and the lintel) and the open leaf go translucent; in the central aisle, nothing does.
  child.stand(LIBRARY_DEN_DOORWAY_STAND.x, LIBRARY_DEN_DOORWAY_STAND.z, LIBRARY_DEN_DOORWAY_STAND.facing);
  camera.snapTo(player.position);
  for (let i = 0; i < 60; i += 1) child.step();
  say(library.westMaterial.opacity < 0.5, `in the den (${LIBRARY_DEN_DOORWAY_STAND.what}), the west wall fades to ${library.westMaterial.opacity.toFixed(2)} within 60 frames`);
  const behindLeaf = { x: open.x, z: open.z - open.halfDepth - PLAYER_RADIUS - 0.3 };
  child.stand(behindLeaf.x, behindLeaf.z, 0);
  camera.snapTo(player.position);
  for (let i = 0; i < 60; i += 1) child.step();
  say(leaf.fader.alpha < 0.5, `standing in the den just north of the open leaf at (${behindLeaf.x.toFixed(2)}, ${behindLeaf.z.toFixed(2)}), the leaf hides her and fades to ${leaf.fader.alpha.toFixed(2)}`);
  child.stand(0.6, 1.2, 180);
  camera.snapTo(player.position);
  for (let i = 0; i < 90; i += 1) child.step();
  const fadedStacks = library.stacks.filter((stack) => stack.alpha < 0.999).map((stack) => stack.id);
  say(
    library.westMaterial.opacity === 1 && leaf.fader.alpha === 1 && fadedStacks.length === 0,
    `CONTROL: in the open central aisle the west wall (${library.westMaterial.opacity.toFixed(2)}) and the leaf (${leaf.fader.alpha.toFixed(2)}) are solid again and no stack fades (${fadedStacks.join(', ') || 'none'})`,
  );
  note(
    `SECRET SHELF: hinge at (${spec.at.x.toFixed(2)}, ${gapSouth.toFixed(2)}), the leaf ${size.length.toFixed(2)} x ${size.depth.toFixed(2)} x ${size.height.toFixed(2)}; ` +
      `shut footprint (${shut.x.toFixed(2)}, ${shut.z.toFixed(2)}) facing ${shut.facing}, open (${open.x.toFixed(2)}, ${open.z.toFixed(2)}) facing ${open.facing}; ` +
      `the gold book at (${bookLocal.x.toFixed(2)}, ${bookLocal.z.toFixed(2)}) shut; landed ${landedAfter.toFixed(3)} s after the press; ${child.frames} frames stepped so far`,
  );
}

/**
 * **GUARD** (plan Decision 24) — found in the den with the leaf shut (what a
 * jet pack over the west wall, or a hand-typed link, amounts to), the leaf is
 * open one frame later, silently; and `requestEnter` into the den opens it in
 * the same call. Proved red by hand: the guard's lines deleted from
 * `Library.updateSecretLeaf`.
 */
/** Where GUARD stands her in the den with the leaf shut — CREATURES asks whether that visit met the dragon too. */
const GUARD_DEN_SPOT: LocalPoint = { x: -21, z: -5 };

console.log('\nGUARD — found in the den with the leaf shut, it opens at once; a link into the den opens it in the same call:');
{
  const leaf = library.secretShelf;
  const shut = leaf.shutFootprint;
  const open = leaf.openFootprint;
  const middleClear = (box: BoxFootprint): boolean => collision.isClearCircle(OX + box.x, OZ + box.z, PLAYER_RADIUS);
  const middleBare = (box: BoxFootprint): boolean => collision.isClearCircle(OX + box.x, OZ + box.z, POINT_PROBE);
  child.enter();
  say(!leaf.open && leaf.angle === 0 && !library.denRoot.visible, `in at the arrival the leaf is shut (angle ${leaf.angle}) and the den hidden (drawn: ${library.denRoot.visible})`);
  const inDen = GUARD_DEN_SPOT;
  child.stand(inDen.x, inDen.z, 270);
  const before = leaf.open;
  child.step();
  say(
    !before && leaf.open && Math.abs(leaf.angle - SWING_END) < 1e-9 && library.denRoot.visible && middleClear(shut) && !middleBare(open),
    `stood in the den at (${inDen.x}, ${inDen.z}) with the leaf shut, one frame later it is open (angle ${leaf.angle.toFixed(4)}), the den drawn (${library.denRoot.visible}), ` +
      `the doorway clear (${middleClear(shut)}) and the open leaf solid (${!middleBare(open)})`,
  );
  child.enter();
  const shutBetween = !leaf.open && leaf.angle === 0;
  child.enter({ x: inDen.x, z: inDen.z, facing: 270 });
  const where = child.room();
  say(
    shutBetween && leaf.open && libraryDenContains(where.x, where.z) && library.denRoot.visible,
    `shut again at the arrival (${shutBetween}); /library?at=${inDen.x},${inDen.z} (requestEnter into the den) opens it in the same call, before any frame: open ${leaf.open}, she stands at (${where.x.toFixed(2)}, ${where.z.toFixed(2)})`,
  );
  child.enter({ x: LIBRARY_SECRET_STAND.x, z: LIBRARY_SECRET_STAND.z, facing: LIBRARY_SECRET_STAND.facing });
  say(!leaf.open && leaf.angle === 0 && !library.denRoot.visible, `a link to the pull stand shuts it again (angle ${leaf.angle}, den drawn ${library.denRoot.visible})`);
}

/**
 * **FRESH VISIT** — pulled open, then out through the door link and back in
 * from the park at a sprint through the front door: the leaf is shut, the den
 * hidden, and its spots unreached again — every visit from the park starts
 * with the trick there to find.
 */
console.log('\nFRESH VISIT — out through the door and back in from the park, the leaf is shut again and the den sealed:');
{
  const leaf = library.secretShelf;
  const player = child.player;
  const denSpots = libraryKeepOuts().filter((spot) => spot.den);
  library
    .interactZones()
    .find((zone) => zone.id === LIBRARY_SECRET_BOOK_ZONE)
    ?.actions?.()
    .find((action) => action.id === PRIMARY_ACTION)
    ?.run();
  child.run(2.2);
  say(leaf.open, `pulled open again from the pull stand before leaving (open ${leaf.open})`);
  say(library.requestEnterDoor(), '/library-door puts her outside');
  child.run(1.2);
  say(!library.playerIsInside && !leaf.open && leaf.angle === 0, `outside (inside ${library.playerIsInside}), the leaf shut behind her (angle ${leaf.angle})`);
  // A sprint in through the front door, on the stick, from the foot of the steps.
  const frame = library.frame;
  const start = frame.foot(0, library.plan.stepFrontZ + 2.5);
  player.teleportTo(start.x, onGround(start.x, start.z).y, start.z, frame.yaw + Math.PI);
  camera.snapTo(player.position);
  const inward = child.towards(-Math.sin(frame.yaw), -Math.cos(frame.yaw), true);
  for (let i = 0; i < Math.round(4 / CHILD_DT) && !library.playerIsInside; i += 1) child.step(inward);
  child.run(0.5);
  const at = child.room();
  say(
    library.playerIsInside && Math.hypot(at.x - LIBRARY_ARRIVAL.x, at.z - LIBRARY_ARRIVAL.z) < 0.01 && !leaf.open && leaf.angle === 0 && !library.denRoot.visible,
    `a sprint through the front door enters at the arrival (${at.x.toFixed(2)}, ${at.z.toFixed(2)}) with the leaf shut (angle ${leaf.angle}) and the den hidden (drawn: ${library.denRoot.visible})`,
  );
  const sealed = fill(collision, OX + LIBRARY_ARRIVAL.x, OZ + LIBRARY_ARRIVAL.z);
  const leaked = denSpots.filter((spot) => reachedAt(sealed, OX + spot.x, OZ + spot.z)).length;
  say(denSpots.length > 0 && leaked === 0, `and the den is sealed again: ${denSpots.length - leaked} of ${denSpots.length} den spots unreached from the arrival`);
}

/**
 * **CREATURES** (#719, plan Step 13) — the baby dragon on its nest of books in
 * the secret den, and the library cat asleep on her pile by the desk.
 *
 * - **Solid in their own shapes** (PR #722: one body per solid, its real top —
 *   the plan's "nobody jumps onto a dragon" disc to the ceiling went with the
 *   ceiling flag). Four bodies, registered by name: the nest a disc a step
 *   high; the dragon, the pile and the cat boxes. Every drawn point of each —
 *   the model's own vertices, outlines included, never the collider's own
 *   description — lies inside its body now and on every sampled frame of its
 *   life (the dragon's head turning to her, its tail, its breath, its puffs;
 *   the cat's ears and head as she is petted). The dragon's and the cat's tops
 *   measure under `FOOT_HALF_WIDTH`: they hold nobody.
 * - **Unreached and marched**: the open-state fill reaches neither creature's
 *   middle nor the nest's nor the pile's; a body marched at each drawn plan
 *   from sixteen bearings, at 5 cm and the sprint stride — the nest and the
 *   pile from the floor, the dragon from up on the nest's top, the cat from up
 *   on the pile's — never gets into it past the corner allowance.
 * - **Nobody stands on a dragon or a cat** — the real child jumps at each from
 *   sixteen bearings, from beside it and from a sprint run-up: never standing
 *   on its top, never wedged, never left in the air, never inside it.
 *   `wide-creature-tops` makes both tops whole: the same jumps must then land
 *   her on them (the control that this can see a child on a creature).
 * - **DEX**: GUARD's walk into the den already met it, when GUARD's spot is
 *   inside the meeting radius; taken back out of the collection, the CONTROL
 *   — 60 frames at the arrival, the leaf shut — leaves it unmet and its zone
 *   unoffered, and one frame at the dragon's stand meets it: Dragon friend,
 *   "Oh, a visitor for me!", a puff, the leaf open. Say hi twice: two of its
 *   answers in order and still one discovery. A visit later, "Hello again,
 *   friend!".
 * - **PUFF**: the belly glows past 1.0 within 0.7 s of a puff and is back at
 *   rest within 3 s; warm sprites rise; an idle puff comes by itself inside
 *   20 s (the vacuity guard); the head turns to her side within its look
 *   radius, and straight ahead beyond it.
 * - **CAT**: Pet the cat! twitches her ears and lifts her face within half a
 *   second, she is happy at 1 s and asleep by 3 s, hearts rise, she purrs, and
 *   a second press inside the guard changes nothing.
 *
 * Reds: `LIBRARY_CHECK_REMOVE='dragon'` / `'cat'` (both bodies of one),
 * `'the baby dragon'` / `'the library cat'` (the creature alone, its seat
 * still there), `LIBRARY_CHECK_MUTATE=wide-creature-tops`; by hand,
 * `DRAGON_MEET_RADIUS = 0.5` (DEX) and `PET_SECONDS = 0` (CAT).
 */
console.log('\nCREATURES — the baby dragon on its nest and the cat on her pile: solid in their own shapes, nobody stands on them, met, puffing and petted:');
{
  const den = library.den;
  const cat = library.cat;
  const player = child.player;
  const nest = LIBRARY_DRAGON_NEST;
  const lines = LIBRARY_LINES;
  /** How far outside its body a drawn point may stand: the posed bodies are measured off these same vertices, so this is float noise. */
  const DRAWN_INSIDE = 0.002;
  const zoneById = (id: string): InteractZone | undefined => library.interactZones().find((candidate) => candidate.id === id);
  const chipOf = (id: string): ZoneAction | undefined => zoneById(id)?.actions?.().find((action) => action.id === PRIMARY_ACTION);
  const dex = (): { readonly discovered: boolean; readonly count: number } => {
    const entry = gameStore.get().collection[DRAGON_FRIEND_SECRET];
    return { discovered: entry?.discovered === true, count: entry?.count ?? 0 };
  };
  /** Every drawn point of a model this frame, room-local, outlines included. */
  const drawn = (root: Object3D, visit: (point: Vector3) => void): void => visiblePoints(root, visit, library.roomRoot);
  /** How far the furthest drawn point of `root` stands outside `box` — negative: every one is inside, by that much. */
  const furthestOut = (root: Object3D, box: BoxFootprint): number => {
    let worst = -Infinity;
    drawn(root, (point) => {
      worst = Math.max(worst, outsideBox(box, point.x, point.z));
    });
    return worst;
  };
  /** The furthest a drawn point of `root` reaches from `at` in plan. */
  const reachFrom = (root: Object3D, at: LocalPoint): number => {
    let reach = 0;
    drawn(root, (point) => {
      reach = Math.max(reach, Math.hypot(point.x - at.x, point.z - at.z));
    });
    return reach;
  };
  /** A model's drawn plan this frame, as a box turned to `facing` about `at` — measured off its vertices, never its collider. */
  const drawnBox = (root: Object3D, at: LocalPoint, facing: number): BoxFootprint => {
    const yaw = (facing * Math.PI) / 180;
    let minA = Infinity;
    let maxA = -Infinity;
    let minO = Infinity;
    let maxO = -Infinity;
    drawn(root, (point) => {
      const dx = point.x - at.x;
      const dz = point.z - at.z;
      const along = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const out = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      minA = Math.min(minA, along);
      maxA = Math.max(maxA, along);
      minO = Math.min(minO, out);
      maxO = Math.max(maxO, out);
    });
    const ca = (minA + maxA) / 2;
    const co = (minO + maxO) / 2;
    return { x: at.x + ca * Math.cos(yaw) + co * Math.sin(yaw), z: at.z - ca * Math.sin(yaw) + co * Math.cos(yaw), facing, halfLength: (maxA - minA) / 2, halfDepth: (maxO - minO) / 2 };
  };
  /** Glowing sprites showing under `parent` in `colour` — the dragon's warm puffs, the cat's pink hearts. */
  const spritesUp = (parent: Object3D, colour: number): number =>
    parent.children.filter((object) => object instanceof Sprite && object.visible && (object.material as SpriteMaterial).map === glowTexture(colour)).length;
  let worstDragonDrawn = -Infinity;
  let dragonSamples = 0;
  const sampleDragon = (): void => {
    dragonSamples += 1;
    worstDragonDrawn = Math.max(worstDragonDrawn, furthestOut(den.dragon.root, den.dragonFootprint));
  };

  // ------------------------------------------------------------- DEX first: a child who has never met it.
  const guardDistance = Math.hypot(GUARD_DEN_SPOT.x - nest.x, GUARD_DEN_SPOT.z - nest.z);
  if (guardDistance <= DRAGON_MEET_RADIUS) {
    say(
      dex().discovered,
      `GUARD's walk into the den at (${GUARD_DEN_SPOT.x}, ${GUARD_DEN_SPOT.z}), ${guardDistance.toFixed(2)} m from the nest (the meeting's ${DRAGON_MEET_RADIUS}), already met the baby dragon: Dragon friend is in the collection (${dex().discovered})`,
    );
  } else {
    note(`GUARD's den spot is ${guardDistance.toFixed(2)} m from the nest, outside the meeting's ${DRAGON_MEET_RADIUS}: nothing asked of that visit`);
  }
  // Taken back out of the collection — check-side, the store's own entry — so
  // the CONTROL and the meeting below start from a child who never met it.
  delete (gameStore.get().collection as Record<string, unknown>)[DRAGON_FRIEND_SECRET];
  child.enter();
  const lineBefore = library.lastCreatureLine;
  for (let i = 0; i < 60; i += 1) child.step();
  const unoffered = zoneById(DRAGON_ZONE_ID) === undefined;
  say(
    !dex().discovered && !library.denOpen && unoffered && library.lastCreatureLine === lineBefore && !den.metThisVisit,
    `CONTROL: 60 frames at the arrival with the leaf shut, the baby dragon is not met (Dragon friend: ${dex().discovered}), says nothing new, and its Say hi zone is ${unoffered ? 'not offered' : 'OFFERED'}`,
  );
  child.stand(LIBRARY_DRAGON_STAND.x, LIBRARY_DRAGON_STAND.z, LIBRARY_DRAGON_STAND.facing);
  const puffsBefore = den.puffsSoFar;
  child.step();
  const standDistance = Math.hypot(LIBRARY_DRAGON_STAND.x - nest.x, LIBRARY_DRAGON_STAND.z - nest.z);
  say(
    dex().discovered && dex().count === 1 && library.lastCreatureLine === lines.dragon.firstHello && den.puffsSoFar === puffsBefore + 1 && library.denOpen,
    `stood ${LIBRARY_DRAGON_STAND.what} (${standDistance.toFixed(2)} m from the nest, inside ${DRAGON_MEET_RADIUS}), one frame later it is met: Dragon friend discovered (count ${dex().count}), ` +
      `it says '${library.lastCreatureLine}' (wanted '${lines.dragon.firstHello}') and puffs (${den.puffsSoFar - puffsBefore}); the guard opened the leaf the same frame (${library.denOpen})`,
  );
  const dragonZone = zoneById(DRAGON_ZONE_ID);
  const sayHi = chipOf(DRAGON_ZONE_ID);
  const dragonStandOff = dragonZone ? Math.hypot(dragonZone.standX - (OX + LIBRARY_DRAGON_STAND.x), dragonZone.standZ - (OZ + LIBRARY_DRAGON_STAND.z)) : Infinity;
  const dragonReach = dragonZone ? Math.hypot(player.position.x - dragonZone.standX, player.position.z - dragonZone.standZ) : Infinity;
  say(
    !!dragonZone && sayHi?.label === LIBRARY_CHIPS.sayHi && dragonZone.verb === 'Say hi' && dragonZone.highlight?.object === den.dragon.root && dragonStandOff < 1e-9 && dragonReach <= standRadiusOf(dragonZone),
    `with the leaf open '${DRAGON_ZONE_ID}' offers '${sayHi?.label ?? 'nothing'}' (wanted '${LIBRARY_CHIPS.sayHi}'), verb '${dragonZone?.verb ?? '?'}', its stand ${dragonStandOff.toFixed(3)} m off the layout's, ` +
      `she ${dragonReach.toFixed(2)} m from it (reach ${dragonZone ? standRadiusOf(dragonZone) : '?'}), the rainbow ${dragonZone?.highlight?.object === den.dragon.root ? 'rings' : 'does NOT ring'} the dragon`,
  );

  // ------------------------------------------------------------- Say hi, and the puff it brings.
  sayHi?.run();
  const firstHi = library.lastCreatureLine;
  const pressedAt = child.frames;
  let peakEarly = 0;
  let warmUp = 0;
  for (let i = 0; i < Math.round(3 / CHILD_DT); i += 1) {
    child.step();
    if ((child.frames - pressedAt) * CHILD_DT <= 0.7) peakEarly = Math.max(peakEarly, den.bellyGlow);
    warmUp = Math.max(warmUp, spritesUp(library.denRoot, PALETTE.fairyWarm));
    if (i % 6 === 0) sampleDragon();
  }
  const settled = den.bellyGlow;
  chipOf(DRAGON_ZONE_ID)?.run();
  const secondHi = library.lastCreatureLine;
  say(
    firstHi === lines.dragon.hi[0] && secondHi === lines.dragon.hi[1] && dex().discovered && dex().count === 1,
    `Say hi twice: '${firstHi}', then '${secondHi}' (its answers, in order), and still one discovery (count ${dex().count})`,
  );
  say(
    peakEarly > 1.0 && Math.abs(settled - DRAGON_BELLY_REST_GLOW) <= 0.01,
    `the puff: the belly's warm glow reaches ${peakEarly.toFixed(3)} within 0.7 s (over 1.0: ${DRAGON_BELLY_REST_GLOW} + ${DRAGON_PUFF_GLOW} at the height of its ${DRAGON_PUFF_SECONDS} s) ` +
      `and is back to ${settled.toFixed(3)} 3 s on (${DRAGON_BELLY_REST_GLOW} ± 0.01)`,
  );
  say(warmUp >= 1, `warm sprites rise from its mouth: up to ${warmUp} showing at once during the puff`);
  const beforeIdle = den.puffsSoFar;
  let idleAfter = Number.NaN;
  for (let i = 0; i < Math.round(20 / CHILD_DT); i += 1) {
    child.step();
    if (Number.isNaN(idleAfter) && den.puffsSoFar > beforeIdle) idleAfter = (i + 1) * CHILD_DT;
    if (i % 6 === 0) sampleDragon();
  }
  say(
    den.puffsSoFar > beforeIdle,
    `left alone, it puffs by itself: the first idle puff ${Number.isNaN(idleAfter) ? 'NEVER came' : `${idleAfter.toFixed(1)} s after the last`}, ${den.puffsSoFar - beforeIdle} in 20 s (its stream draws 9–14 s)`,
  );

  // ------------------------------------------------------------- The head turns to her side, within its look radius.
  const yaw = (nest.facing * Math.PI) / 180;
  const sideSpot = (side: number): LocalPoint => ({ x: nest.x + Math.sin(yaw + side * 0.5) * 2, z: nest.z + Math.cos(yaw + side * 0.5) * 2 });
  const turnAt = (spot: LocalPoint): number => {
    child.stand(spot.x, spot.z, ((yaw + Math.PI) * 180) / Math.PI);
    for (let i = 0; i < Math.round(1.5 / CHILD_DT); i += 1) {
      child.step();
      if (i % 6 === 0) sampleDragon();
    }
    return den.headTurn;
  };
  const toLeft = sideSpot(1);
  const toRight = sideSpot(-1);
  const spotsFit = [toLeft, toRight].every((spot) => libraryDenContains(spot.x, spot.z) && walkableAt(collision, OX + spot.x, OZ + spot.z, PLAYER_RADIUS, LIBRARY_FLOOR_Y));
  const turnLeft = turnAt(toLeft);
  const turnRight = turnAt(toRight);
  const farDistance = Math.hypot(LIBRARY_DEN_DOORWAY_STAND.x - nest.x, LIBRARY_DEN_DOORWAY_STAND.z - nest.z);
  const turnFar = turnAt(LIBRARY_DEN_DOORWAY_STAND);
  say(
    spotsFit && 0.5 <= DRAGON_HEAD_TURN_LIMIT && 2 <= DRAGON_LOOK_RADIUS && Math.abs(turnLeft - 0.5) < 0.05 && Math.abs(turnRight + 0.5) < 0.05 && farDistance > DRAGON_LOOK_RADIUS && Math.abs(turnFar) < 0.05,
    `its head follows her: 2 m off its nose 0.5 rad to one side it turns ${turnLeft.toFixed(3)} rad, to the other ${turnRight.toFixed(3)} (±0.5 wanted, its limit ${DRAGON_HEAD_TURN_LIMIT}); ` +
      `${farDistance.toFixed(2)} m away (${LIBRARY_DEN_DOORWAY_STAND.what}, past its ${DRAGON_LOOK_RADIUS} m) it looks straight ahead (${turnFar.toFixed(3)})`,
  );

  // ------------------------------------------------------------- SOLID: four bodies, each its own shape.
  const solidNamed = (what: string): LibrarySolid | undefined => library.solids.find((solid) => solid.what === what);
  const nestSolid = solidNamed(DRAGON_NEST_SOLID);
  const dragonSolid = solidNamed(DRAGON_SOLID);
  const pileSolid = solidNamed(CAT_PILE_SOLID);
  const catSolid = solidNamed(CAT_SOLID);
  /** A box solid's top width (`topHalf`): how much of its top a foot could stand on — NaN for none, or for a disc. */
  const topHalfOf = (solid: LibrarySolid | undefined): number =>
    solid && typeof solid.handle !== 'number' && 'halfX' in solid.handle ? (solid.handle as BoxCollider).topHalf : Number.NaN;
  say(
    nestSolid?.shape === 'disc' && dragonSolid?.shape === 'box' && pileSolid?.shape === 'box' && catSolid?.shape === 'box',
    `four bodies, each its own shape: '${DRAGON_NEST_SOLID}' ${nestSolid?.shape ?? 'MISSING'}, '${DRAGON_SOLID}' ${dragonSolid?.shape ?? 'MISSING'}, ` +
      `'${CAT_PILE_SOLID}' ${pileSolid?.shape ?? 'MISSING'}, '${CAT_SOLID}' ${catSolid?.shape ?? 'MISSING'}`,
  );
  say(
    den.nestTop <= BUILDING_STEP_UP &&
      Math.abs((nestSolid?.top ?? Number.NaN) - den.nestTop) < 1e-9 &&
      (dragonSolid?.top ?? 0) > BUILDING_STEP_UP &&
      topHalfOf(dragonSolid) < FOOT_HALF_WIDTH &&
      cat.pileTop > BUILDING_STEP_UP &&
      topHalfOf(pileSolid) >= FOOT_HALF_WIDTH &&
      topHalfOf(catSolid) < FOOT_HALF_WIDTH &&
      Math.abs((catSolid?.top ?? Number.NaN) - cat.catTop) < 1e-9,
    `their tops, measured off the models: the nest's books ${den.nestTop.toFixed(3)} m (a step: ${BUILDING_STEP_UP}); the dragon ${(dragonSolid?.top ?? Number.NaN).toFixed(3)} m to its horns, ` +
      `its crest ${topHalfOf(dragonSolid).toFixed(3)} m either side; the pile ${cat.pileTop.toFixed(3)} m, ${topHalfOf(pileSolid).toFixed(3)} either side; the cat ${cat.catTop.toFixed(3)} m to her ears, ` +
      `${topHalfOf(catSolid).toFixed(3)} either side — the dragon's and the cat's under the ${FOOT_HALF_WIDTH} her feet need, so neither holds anybody`,
  );
  sampleDragon();
  const nestReach = reachFrom(den.nest.root, nest);
  const pileOut = furthestOut(cat.pile.root, cat.pileFootprint);
  const catOut = furthestOut(cat.cat.root, cat.catFootprint);
  say(
    worstDragonDrawn <= DRAWN_INSIDE && nestReach <= den.nestRadius + DRAWN_INSIDE && pileOut <= DRAWN_INSIDE && catOut <= DRAWN_INSIDE,
    `drawn is solid: the dragon's furthest drawn point over ${dragonSamples} sampled frames of its life (turning, flicking, breathing, puffing) is ${worstDragonDrawn.toFixed(4)} m outside its body; ` +
      `the nest reaches ${nestReach.toFixed(3)} m (its disc ${den.nestRadius.toFixed(3)}); the pile ${pileOut.toFixed(4)} and the cat ${catOut.toFixed(4)} m outside theirs (at most ${DRAWN_INSIDE})`,
  );
  const seen = fill(collision, OX + LIBRARY_ARRIVAL.x, OZ + LIBRARY_ARRIVAL.z);
  const middles: { readonly what: string; readonly at: LocalPoint }[] = [
    { what: 'the baby dragon', at: den.dragonFootprint },
    { what: "the dragon's nest", at: nest },
    { what: "the cat's pile", at: cat.pileFootprint },
    { what: 'the library cat', at: cat.catFootprint },
  ];
  const reachedMiddles = middles.filter((middle) => reachedAt(seen, OX + middle.at.x, OZ + middle.at.z));
  say(
    reachedMiddles.length === 0,
    `with the leaf open the fill from the arrival reaches none of their middles: ${reachedMiddles.map((middle) => `${middle.what} IS reached`).join(', ') || `${middles.length} of ${middles.length} unreached`}`,
  );
  /** Bodies marched at a drawn plan from sixteen bearings at both strides, with her feet at `feet`: the deepest a body's edge got into it, by `depth`. */
  const marchedAt = (centre: LocalPoint, reach: number, feet: number, depth: (end: LocalPoint) => number): { marches: number; skipped: number; deepest: number } => {
    let marches = 0;
    let skipped = 0;
    let deepest = -Infinity;
    const out = reach + 2.2;
    for (let b = 0; b < 16; b += 1) {
      const angle = (b / 16) * Math.PI * 2;
      const sx = centre.x + Math.cos(angle) * out;
      const sz = centre.z + Math.sin(angle) * out;
      if (!onFloor(sx, sz) || !walkableAt(collision, OX + sx, OZ + sz, PLAYER_RADIUS, LIBRARY_FLOOR_Y + feet)) {
        skipped += 1;
        continue;
      }
      for (const step of [0.05, PLAYER_LONGEST_STEP]) {
        marches += 1;
        const end = march(collision, new Vector3(OX + sx, LIBRARY_FLOOR_Y + feet, OZ + sz), new Vector3(OX + centre.x, LIBRARY_FLOOR_Y + feet, OZ + centre.z), step, out + 1);
        deepest = Math.max(deepest, depth({ x: end.x - OX, z: end.z - OZ }));
      }
    }
    return { marches, skipped, deepest };
  };
  const dragonDrawn = drawnBox(den.dragon.root, nest, nest.facing);
  const pileDrawn = drawnBox(cat.pile.root, LIBRARY_CAT_PILE, LIBRARY_CAT_PILE.facing);
  const catDrawn = drawnBox(cat.cat.root, LIBRARY_CAT_PILE, LIBRARY_CAT_PILE.facing);
  const atNest = marchedAt(nest, nestReach, 0, (end) => PLAYER_RADIUS - (Math.hypot(end.x - nest.x, end.z - nest.z) - nestReach));
  const atDragon = marchedAt(dragonDrawn, Math.hypot(dragonDrawn.halfLength, dragonDrawn.halfDepth), den.nestTop, (end) => PLAYER_RADIUS - outsideBox(dragonDrawn, end.x, end.z));
  const atPile = marchedAt(pileDrawn, Math.hypot(pileDrawn.halfLength, pileDrawn.halfDepth), 0, (end) => PLAYER_RADIUS - outsideBox(pileDrawn, end.x, end.z));
  const atCat = marchedAt(catDrawn, Math.hypot(catDrawn.halfLength, catDrawn.halfDepth), cat.pileTop, (end) => PLAYER_RADIUS - outsideBox(catDrawn, end.x, end.z));
  const marched = [
    { what: "the dragon's nest, from the floor", run: atNest, least: 4 },
    { what: `the dragon, up on its nest's top (${den.nestTop.toFixed(2)} m)`, run: atDragon, least: 4 },
    { what: "the cat's pile, from the floor", run: atPile, least: 16 },
    { what: `the cat, up on her pile's top (${cat.pileTop.toFixed(2)} m)`, run: atCat, least: 16 },
  ];
  for (const { what, run, least } of marched) {
    say(
      run.marches >= least && run.deepest <= CORNER_ALLOWANCE,
      `${run.marches} marches at ${what} from 16 bearings at 5 cm and the sprint stride (${run.skipped} starts skipped: off the floor or in a solid; at least ${least} wanted): ` +
        `deepest a body's edge got into its drawn plan ${run.deepest.toFixed(3)} m, allowance ${CORNER_ALLOWANCE.toFixed(3)}`,
    );
  }

  // ------------------------------------------------------------- Nobody stands on a dragon or a cat: the real child jumps at both.
  const narrowTops = [den.dragonCollider[0], cat.catCollider[0]];
  const kept = narrowTops.map((box) => box.topHalf);
  const wide = mutating('wide-creature-tops');
  if (wide) {
    for (const box of narrowTops) box.topHalf = Number.NaN;
    note("MADE the dragon's and the cat's tops whole (topHalf NaN) on purpose — the jumps must land her on them, and this run must go red");
  }
  interface Jumps {
    tried: number;
    skipped: number;
    onTop: number;
    wedged: number;
    aloft: number;
    inside: number;
    leftRoom: number;
    seatTrials: number;
    seatFrames: number;
    first: string;
  }
  const jumpAt = (centre: LocalPoint, seatReach: number, seatTop: number, onSeat: (at: LocalPoint) => boolean, body: BoxFootprint, top: number): Jumps => {
    const jumps: Jumps = { tried: 0, skipped: 0, onTop: 0, wedged: 0, aloft: 0, inside: 0, leftRoom: 0, seatTrials: 0, seatFrames: 0, first: '' };
    const inDen = libraryDenContains(centre.x, centre.z);
    const touch = seatReach + PLAYER_RADIUS + 0.05;
    for (const sprint of [false, true]) {
      for (let b = 0; b < 16; b += 1) {
        const angle = (b / 16) * Math.PI * 2;
        const from = sprint ? touch + 1.5 : touch;
        const sx = centre.x + Math.cos(angle) * from;
        const sz = centre.z + Math.sin(angle) * from;
        if (libraryDenContains(sx, sz) !== inDen || !onFloor(sx, sz) || !walkableAt(collision, OX + sx, OZ + sz, PLAYER_RADIUS, LIBRARY_FLOOR_Y)) {
          jumps.skipped += 1;
          continue;
        }
        jumps.tried += 1;
        child.stand(sx, sz, (Math.atan2(centre.x - sx, centre.z - sz) * 180) / Math.PI);
        for (let i = 0; i < 6; i += 1) child.step();
        const go = child.towards(centre.x - sx, centre.z - sz, sprint);
        let jumpedAt = -1;
        let onTop = 0;
        let seat = 0;
        for (let i = 0; i < Math.round(3 / CHILD_DT); i += 1) {
          const here = child.room();
          if (jumpedAt < 0 && (!sprint || Math.hypot(here.x - centre.x, here.z - centre.z) <= touch + 0.4)) {
            child.input.pressVirtual('jump');
            jumpedAt = i;
          }
          child.step(jumpedAt < 0 || i - jumpedAt < Math.round(0.5 / CHILD_DT) ? go : undefined);
          const feetNow = player.position.y - LIBRARY_FLOOR_Y; // flat-ok: her height over the reading room's own flat floor, off the sphere
          const at = child.room();
          if (!player.isAirborne && feetNow >= top - 0.05) onTop += 1;
          if (!player.isAirborne && Math.abs(feetNow - seatTop) < 0.02 && onSeat(at)) seat += 1;
        }
        const end = child.room();
        const stuck = wedgeDepth(collision, player.position, player.position.y);
        if (onTop > 0) jumps.onTop += 1;
        if (stuck > WEDGE_DEPTH) jumps.wedged += 1;
        if (player.isAirborne) jumps.aloft += 1;
        if (outsideBox(body, end.x, end.z) < 0) jumps.inside += 1;
        if (seat > 0) {
          jumps.seatTrials += 1;
          jumps.seatFrames += seat;
        }
        if (!jumps.first && (onTop > 0 || stuck > WEDGE_DEPTH || player.isAirborne || outsideBox(body, end.x, end.z) < 0)) {
          jumps.first = `${sprint ? 'a sprint' : 'a jump from beside it'} from (${sx.toFixed(2)}, ${sz.toFixed(2)}): ${onTop} frame(s) standing on its top, ended at (${end.x.toFixed(2)}, ${end.z.toFixed(2)}) wedged ${stuck.toFixed(3)} m, airborne ${player.isAirborne}`;
        }
        if (!library.playerIsInside) {
          jumps.leftRoom += 1;
          child.enter();
          if (inDen) library.openDenInstantly();
        }
      }
    }
    return jumps;
  };
  const dragonJumps = jumpAt(nest, den.nestRadius, den.nestTop, (at) => Math.hypot(at.x - nest.x, at.z - nest.z) <= den.nestRadius, den.dragonFootprint, den.dragonTop);
  const pileReach = Math.hypot(cat.pileFootprint.halfLength, cat.pileFootprint.halfDepth);
  const catJumps = jumpAt(LIBRARY_CAT_PILE, pileReach, cat.pileTop, (at) => outsideBox(cat.pileFootprint, at.x, at.z) <= 0, cat.catFootprint, cat.catTop);
  if (wide) narrowTops.forEach((box, i) => {
    box.topHalf = kept[i]!;
  });
  for (const [what, jumps, least] of [
    ['the baby dragon', dragonJumps, 8],
    ['the library cat', catJumps, 20],
  ] as const) {
    say(
      jumps.tried >= least && jumps.onTop === 0 && jumps.wedged === 0 && jumps.aloft === 0 && jumps.inside === 0,
      `nobody stands on ${what}: ${jumps.tried} real jumps at it from 16 bearings, from beside it and from a sprint (${jumps.skipped} starts skipped: in a wall or another solid; at least ${least} wanted) — ` +
        `${jumps.onTop} stood her on its top, ${jumps.wedged} left her wedged, ${jumps.aloft} left her in the air, ${jumps.inside} ended inside it${jumps.first ? `; first: ${jumps.first}` : ''}`,
    );
  }
  note(
    `the jumps' seats: the dragon's nest held her ${dragonJumps.seatFrames} frame(s) in ${dragonJumps.seatTrials} of ${dragonJumps.tried} jumps before its dragon pushed her off; ` +
      `the cat's pile ${catJumps.seatFrames} frame(s) in ${catJumps.seatTrials} of ${catJumps.tried}; ${dragonJumps.leftRoom + catJumps.leftRoom} jump(s) carried her out of the room`,
  );

  // ------------------------------------------------------------- CAT: Pet the cat!
  child.stand(LIBRARY_CAT_STAND.x, LIBRARY_CAT_STAND.z, LIBRARY_CAT_STAND.facing);
  child.run(0.4);
  const catZone = zoneById(CAT_ZONE_ID);
  const pet = chipOf(CAT_ZONE_ID);
  const catStandOff = catZone ? Math.hypot(catZone.standX - (OX + LIBRARY_CAT_STAND.x), catZone.standZ - (OZ + LIBRARY_CAT_STAND.z)) : Infinity;
  const catReach = catZone ? Math.hypot(player.position.x - catZone.standX, player.position.z - catZone.standZ) : Infinity;
  say(
    !!catZone && pet?.label === LIBRARY_CHIPS.pet && catZone.verb === 'Pet' && catZone.highlight?.object === cat.group && catStandOff < 1e-9 && catReach <= standRadiusOf(catZone),
    `stood ${LIBRARY_CAT_STAND.what}, '${CAT_ZONE_ID}' offers '${pet?.label ?? 'nothing'}' (wanted '${LIBRARY_CHIPS.pet}'), verb '${catZone?.verb ?? '?'}', its stand ${catStandOff.toFixed(3)} m off the layout's, ` +
      `she ${catReach.toFixed(2)} m from it (reach ${catZone ? standRadiusOf(catZone) : '?'}), the rainbow ${catZone?.highlight?.object === cat.group ? 'rings' : 'does NOT ring'} the cat and her pile`,
  );
  const { earL, earR, head } = cat.cat;
  const restEarL = earL.rotation.z;
  const restEarR = earR.rotation.z;
  // Her face: the head's front-most drawn point, in the head's own frame, followed into the room.
  const nose = new Vector3(0, 0, -Infinity);
  visiblePoints(head, (point) => {
    if (point.z > nose.z) nose.copy(point);
  }, head);
  const faceY = (): number => {
    head.updateWorldMatrix(true, false);
    return head.localToWorld(nose.clone()).y;
  };
  let restFace = -Infinity;
  for (let i = 0; i < 30; i += 1) {
    child.step();
    restFace = Math.max(restFace, faceY());
  }
  const restFaceShown = cat.cat.face;
  const petsBefore = cat.pets;
  pet?.run();
  const purred = library.lastCreatureLine;
  let earMoved = 0;
  let faceRise = -Infinity;
  let happyAt1 = false;
  let asleepBy3 = false;
  let hearts = 0;
  let secondPressChanged = true;
  let worstCatDrawn = -Infinity;
  let catSamples = 0;
  for (let i = 0; i < Math.round(3.2 / CHILD_DT); i += 1) {
    if (i === Math.round(0.2 / CHILD_DT)) {
      const pets = cat.pets;
      const line = library.lastCreatureLine;
      chipOf(CAT_ZONE_ID)?.run();
      secondPressChanged = cat.pets !== pets || library.lastCreatureLine !== line;
    }
    child.step();
    const t = (i + 1) * CHILD_DT;
    if (t <= 0.5) {
      earMoved = Math.max(earMoved, Math.abs(earL.rotation.z - restEarL), Math.abs(earR.rotation.z - restEarR));
      faceRise = Math.max(faceRise, faceY() - restFace); // flat-ok: her face's height over its own rest, both in the reading room's flat space
    }
    if (Math.abs(t - 1) < CHILD_DT / 2) happyAt1 = cat.cat.face === 'happy';
    if (Math.abs(t - 3) < CHILD_DT / 2) asleepBy3 = cat.cat.face === 'asleep';
    hearts = Math.max(hearts, spritesUp(library.roomRoot, PALETTE.markerPink));
    if (i % 3 === 0) {
      catSamples += 1;
      worstCatDrawn = Math.max(worstCatDrawn, furthestOut(cat.cat.root, cat.catFootprint));
    }
  }
  say(
    restFaceShown === 'asleep' && cat.pets === petsBefore + 1 && earMoved > 0.1 && faceRise > 0.02,
    `asleep before (${restFaceShown}); Pet the cat! counts (${cat.pets - petsBefore}) and within 0.5 s an ear twitches ${earMoved.toFixed(3)} rad off its rest (over 0.1) ` +
      `and she lifts her face ${(faceRise * 100).toFixed(1)} cm (over 2) — the head's lift, ${PET_SECONDS} s of pet`,
  );
  say(happyAt1 && asleepBy3, `she is happy at 1.0 s (${happyAt1}) and asleep again by 3 s (${asleepBy3})`);
  say(
    (lines.cat.purr as readonly string[]).includes(purred ?? '') && hearts >= 1,
    `she purrs '${purred}' (one of ${lines.cat.purr.map((line) => `'${line}'`).join(', ')}) and pink hearts rise (up to ${hearts} at once)`,
  );
  say(!secondPressChanged, `a second press 0.2 s in, inside her ${PET_GUARD_SECONDS} s guard, changes nothing (no second pet, no second line)`);
  say(worstCatDrawn <= DRAWN_INSIDE, `drawn is solid while she is petted: her furthest drawn point over ${catSamples} sampled frames is ${worstCatDrawn.toFixed(4)} m outside her body (at most ${DRAWN_INSIDE})`);

  // ------------------------------------------------------------- A visit later: hello again.
  say(library.requestEnterDoor(), 'out through /library-door');
  child.run(1.2);
  child.enter();
  child.stand(LIBRARY_DRAGON_STAND.x, LIBRARY_DRAGON_STAND.z, LIBRARY_DRAGON_STAND.facing);
  child.step();
  say(
    library.lastCreatureLine === lines.dragon.hello && dex().count === 1,
    `a visit later, at its stand again, it says '${library.lastCreatureLine}' (wanted '${lines.dragon.hello}') — still one discovery (count ${dex().count})`,
  );
  // Leave as found: in at the arrival, the leaf shut, the den hidden.
  child.enter();
  note(
    `CREATURES: the dragon's body (${den.dragonFootprint.x.toFixed(3)}, ${den.dragonFootprint.z.toFixed(3)}) ${(2 * den.dragonFootprint.halfLength).toFixed(3)} x ${(2 * den.dragonFootprint.halfDepth).toFixed(3)} facing ${den.dragonFootprint.facing}, ` +
      `top ${den.dragonTop.toFixed(3)} (crest ${den.dragonTopHalf.toFixed(3)}); its nest a disc r ${den.nestRadius.toFixed(3)} at (${nest.x}, ${nest.z}), top ${den.nestTop.toFixed(3)}; ` +
      `the pile (${cat.pileFootprint.x.toFixed(3)}, ${cat.pileFootprint.z.toFixed(3)}) ${(2 * cat.pileFootprint.halfLength).toFixed(3)} x ${(2 * cat.pileFootprint.halfDepth).toFixed(3)}, top ${cat.pileTop.toFixed(3)}; ` +
      `the cat (${cat.catFootprint.x.toFixed(3)}, ${cat.catFootprint.z.toFixed(3)}) ${(2 * cat.catFootprint.halfLength).toFixed(3)} x ${(2 * cat.catFootprint.halfDepth).toFixed(3)}, top ${cat.catTop.toFixed(3)} (crest ${cat.catTopHalf.toFixed(3)}); ` +
      `${child.frames} frames stepped so far`,
  );
}

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
