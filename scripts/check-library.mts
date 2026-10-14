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
 * LIBRARY_CHECK_MUTATE=block-walk pnpm run check:library      # a wall across the real child's way in: must go red
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
 *  1. CONTROL — the fill instrument sees a sealed pocket (a hollow rectangle in
 *     an empty room of its own) and floods an empty room.
 *  2. CONTROL on the real room — a disc dropped on the desk's front stand makes
 *     the fill call that keep-out unreachable; taken back out, reachable again.
 *  3. REACHABILITY — from the arrival, at her radius: every keep-out
 *     (`libraryKeepOuts`), the exit band, and no clear cell on the plate left
 *     unreached (a pocket she could be stuck in). Every stack's and the desk's
 *     middle is NOT reached (they are solid).
 *  4. AISLES — a player disc swept along every `LIBRARY_AISLES` polyline.
 *  5. MARCHED — a player-sized body marched at every bookcase, the desk and
 *     every chair from sixteen bearings, at 5 cm and at the sprint stride, and
 *     at the room's four walls: the body's edge never gets into a drawn box
 *     past the corner rounding its capsules leave. Every box is the **model's**
 *     drawn footprint (`libraryAssets.ts`), never the collider's own.
 *  6. LANDING — a jump landed on every top she may stand on (the chairs, the
 *     desk, the bins, the cushions) finds it under her feet everywhere across
 *     its drawn footprint; the control: just outside the footprint, the floor.
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
 *     room's lights plus that lift — renders brighter than ink; with a control
 *     — the same floor under a near-dark rig goes below it.
 * 12. READABLE — the twelve readable slots' shelves, measured, within her reach.
 * 13. PAINTED FACES — the owl's, the dragon's and the cat's faces (#718, #719),
 *     on freshly built creatures: each head's UVs read against its own
 *     texture's flip, the canvas row falling as the head rises, and the eyes
 *     above the mouth (the owl's, above her beak).
 * 14. WITH A REAL CHILD — from here on a real `Player`, stepped the game's way
 *     and steered by the stick ({@link RealChild}): from the arrival, she walks
 *     into the room on the floor. Parts 4 and 5 add their clauses to it.
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
import { CollisionWorld } from '../src/world/Collision.ts';
import { WalkSurfaces } from '../src/world/building/surfaces.ts';
import { MAX_FRAME_DELTA, PLAYER_LONGEST_STEP, PLAYER_RADIUS, BUILDING_STEP_UP } from '../src/core/constants.ts';
import { PALETTE } from '../src/core/palette.ts';
import { KID_REACH_HEIGHT } from '../src/art/models/kid.ts';
import { bandCrossed } from '../src/world/tapSpacing.ts';
import { SPACE_GARDEN, SPACE_LIBRARY, spaceAt } from '../src/world/spaces.ts';
import { terrainHeight } from '../src/world/terrain.ts';
import { END_HALF, libraryKeepOuts, type BoxFootprint } from '../src/world/library/props.ts';
import { bookcaseCentre } from '../src/world/library/furnish.ts';
import { buildReadingRoomShell } from '../src/world/library/shell.ts';
import { floorIrradiance, LIBRARY_LIGHT_BUDGET } from '../src/world/library/lighting.ts';
import { libraryArmchairSize, libraryBookcaseSize, libraryDeskSize } from '../src/art/models/libraryAssets.ts';
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
  LIBRARY_AISLES,
  LIBRARY_ARRIVAL,
  LIBRARY_BOOKCASES,
  LIBRARY_DESK_STAND,
  LIBRARY_DOOR_HALF,
  LIBRARY_DOOR_X,
  LIBRARY_FLOOR_Y,
  LIBRARY_FURNITURE,
  LIBRARY_HALF_X,
  LIBRARY_HALF_Z,
  LIBRARY_INNER_X,
  LIBRARY_INNER_Z,
  LIBRARY_ORIGIN_X,
  LIBRARY_ORIGIN_Z,
  LIBRARY_READABLE_SLOTS,
  type FurnitureSpec,
  type LocalPoint,
} from '../src/world/library/layout.ts';
import type { FrameContext } from '../src/core/types.ts';

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

function fill(collision: CollisionWorld, fromX: number, fromZ: number, radius = PLAYER_RADIUS): Fill {
  const clear = new Set<string>();
  const reachX = Math.ceil((LIBRARY_HALF_X + 1) / CELL);
  const reachZ = Math.ceil((LIBRARY_HALF_Z + 1) / CELL);
  for (let cx = -reachX; cx <= reachX; cx += 1) {
    for (let cz = -reachZ; cz <= reachZ; cz += 1) {
      const x = OX + cx * CELL;
      const z = OZ + cz * CELL;
      if (!onPlate(x - OX, z - OZ)) continue;
      if (collision.isClearCircle(x, z, radius)) clear.add(key(cx, cz));
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
    boxes.push({ what: `bookcase ${spec.id}`, x: centre.x, z: centre.z, facing: spec.facing, halfLength: size.length / 2, halfDepth: size.depth / 2 });
  }
  const desk = libraryDeskSize();
  const chair = libraryArmchairSize();
  for (const piece of LIBRARY_FURNITURE) {
    if (piece.kind === 'desk') {
      const centre = turned(piece, desk.centreX, desk.centreZ);
      boxes.push({ what: 'the desk', x: centre.x, z: centre.z, facing: piece.facing, halfLength: desk.width / 2, halfDepth: desk.depth / 2 });
    } else if (piece.kind === 'armchair' || piece.kind === 'storyChair') {
      const centre = turned(piece, chair.centreX, chair.centreZ);
      boxes.push({ what: piece.id, x: centre.x, z: centre.z, facing: piece.facing, halfLength: chair.width / 2, halfDepth: chair.depth / 2 });
    }
  }
  return boxes;
}

// ---------------------------------------------------------------------------
// 1. CONTROLS — the instrument, before the building.
// ---------------------------------------------------------------------------
console.log('CONTROL — the fill instrument:');
{
  const control = new CollisionWorld();
  buildReadingRoomShell(new Group(), control, new WalkSurfaces());
  control.addRectangle(OX - 6, OZ, 2.5, 2.5, 0.3);
  const seen = fill(control, OX + LIBRARY_ARRIVAL.x, OZ + LIBRARY_ARRIVAL.z);
  const pockets = [...seen.clear].filter((k) => !seen.reached.has(k));
  say(seen.reached.size > 10000, `the fill floods the empty room: ${seen.reached.size} cells reached`);
  say(pockets.length > 30 && !reachedAt(seen, OX - 6, OZ), `the fill sees a sealed pocket: ${pockets.length} clear cells inside a hollow rectangle are unreachable`);
  say(!seen.clear.has(key(...cellOf(OX, OZ + LIBRARY_HALF_Z + 4))), 'nothing off the plate counts as floor');
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
const remove = process.env['LIBRARY_CHECK_REMOVE'];
if (remove) {
  const victims = library.solids.filter((solid) => solid.what.includes(remove));
  if (victims.length === 0) throw new Error(`LIBRARY_CHECK_REMOVE=${remove} names no solid`);
  for (const victim of victims) {
    if (typeof victim.handle === 'number') collision.removeCircle(victim.handle);
    else collision.removeWall(victim.handle);
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
  note(`OPENED the plinth's edge ${index} (east, back, west) on purpose — this run must go red`);
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

console.log(`\nREACHABILITY — ${library.solids.length} solids registered by the reading room:`);
{
  const seen = fill(collision, OX + LIBRARY_ARRIVAL.x, OZ + LIBRARY_ARRIVAL.z);
  say(seen.reached.size > 5000, `the fill leaves the arrival: ${seen.reached.size} cells reached of ${seen.clear.size} clear`);
  const keepOuts = libraryKeepOuts();
  let unreachable = 0;
  for (const spot of keepOuts) {
    if (!reachedAt(seen, OX + spot.x, OZ + spot.z)) {
      unreachable += 1;
      say(false, `${spot.what} at (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)}) is not reachable from the arrival`);
    }
  }
  say(unreachable === 0, `every keep-out is reachable: ${keepOuts.length - unreachable} of ${keepOuts.length}`);
  say(reachedAt(seen, OX + LIBRARY_DOOR_X, OZ + LIBRARY_HALF_Z), "the exit band's centre is reachable");
  for (const box of drawnBoxes()) {
    if (box.halfDepth * 2 < 0.5) continue;
    if (reachedAt(seen, OX + box.x, OZ + box.z)) say(false, `${box.what}'s middle IS reachable — it is not solid`);
  }
  const pockets = [...seen.clear].filter((k) => !seen.reached.has(k));
  if (pockets.length > 0) {
    const sample = pockets.slice(0, 6).map((k) => {
      const [cx, cz] = k.split(',').map(Number) as [number, number];
      return `(${(cx * CELL).toFixed(2)}, ${(cz * CELL).toFixed(2)})`;
    });
    say(false, `${pockets.length} clear cell(s) on the plate are unreachable — a pocket a child could be stuck in: ${sample.join(' ')}…`);
  } else {
    say(true, `no pockets: every one of the ${seen.clear.size} clear cells on the plate is reachable`);
  }
  note(`${keepOuts.length} keep-outs (arrival, doorway, desk, librarian, rug, seats, secret shelf, 12 readable slots, every aisle node)`);
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
        if (!collision.isClearCircle(x, z, PLAYER_RADIUS)) {
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

console.log('\nLANDING — a jump landed on every top she may stand on:');
{
  let points = 0;
  let missed = 0;
  let controls = 0;
  let controlWrong = 0;
  const firstMiss: string[] = [];
  const standables = library.standables;
  /** Does any standable's drawn footprint (other than `except`) cover room-local (x, z)? */
  const coveredByAnother = (x: number, z: number, except: (typeof standables)[number]): boolean =>
    standables.some((other) => other !== except && footprintCovers(other.footprint, x, z));
  for (const standable of standables) {
    for (const [u, v] of grid(standable.footprint, 0)) {
      points += 1;
      const y = surfaces.sample(OX + u, OZ + v, standable.top + 0.1);
      if (Math.abs(y - standable.top) > FEET_TOLERANCE) {
        missed += 1;
        if (firstMiss.length < 4) firstMiss.push(`${standable.what} at (${u.toFixed(2)}, ${v.toFixed(2)}): landed at ${y.toFixed(3)}, its top is ${standable.top.toFixed(3)}`);
      }
    }
    // The control: a ring just outside the drawn footprint is the floor (or another top).
    for (const [u, v] of grid(standable.footprint, 0.1)) {
      if (coveredByAnother(u, v, standable)) continue;
      controls += 1;
      const y = surfaces.sample(OX + u, OZ + v, standable.top + 0.1);
      if (Math.abs(y) > FEET_TOLERANCE) controlWrong += 1;
    }
  }
  for (const line of firstMiss) say(false, line);
  say(standables.length >= 10 && missed === 0, `${standables.length} tops, ${points} landings across their drawn footprints: ${missed} fell through`);
  say(controls > 0 && controlWrong === 0, `CONTROL: ${controls} landings 0.1 m outside a footprint found the floor (${controlWrong} found a top in the air)`);
  note(`the tops: ${standables.map((s) => `${s.what} ${s.top.toFixed(2)}`).join(', ')}`);
}

/** Does a standable footprint cover room-local (x, z)? */
function footprintCovers(footprint: (typeof library.standables)[number]['footprint'], x: number, z: number): boolean {
  if ('radius' in footprint) return Math.abs(x - footprint.x) <= footprint.radius && Math.abs(z - footprint.z) <= footprint.radius;
  return outsideBox(footprint, x, z) <= 0;
}

/** A grid of room-local points across a footprint grown by `grow` (on its edge when growing). */
function grid(footprint: (typeof library.standables)[number]['footprint'], grow: number): [number, number][] {
  const out: [number, number][] = [];
  if ('radius' in footprint) {
    const r = footprint.radius;
    if (grow > 0) {
      for (let k = 0; k < 16; k += 1) {
        const a = (k / 16) * Math.PI * 2;
        // The square plate's corners reach r·√2; a ring outside that is clear of it.
        out.push([footprint.x + Math.cos(a) * (r * Math.SQRT2 + grow), footprint.z + Math.sin(a) * (r * Math.SQRT2 + grow)]);
      }
      return out;
    }
    for (let i = -4; i <= 4; i += 1) for (let j = -4; j <= 4; j += 1) out.push([footprint.x + (i / 4) * r * 0.98, footprint.z + (j / 4) * r * 0.98]);
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
      const p = new Vector3(frame.x + Math.sin(bearing) * 16, 0, frame.z + Math.cos(bearing) * 16);
      let closest = Infinity;
      for (let travelled = 0; travelled < 20; travelled += step) {
        collision.resolveMovement(p, -Math.sin(bearing) * step, -Math.cos(bearing) * step, PLAYER_RADIUS, 0, MAX_FRAME_DELTA);
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

  // Square at the plinth's sides and back, from the lawn: she stops at its drawn edge.
  let edgeMarches = 0;
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
      const p = new Vector3(from.x, 0, from.z);
      const dir = new Vector3(to.x - from.x, 0, to.z - from.z).normalize();
      for (let travelled = 0; travelled < 5; travelled += step) {
        collision.resolveMovement(p, dir.x * step, dir.z * step, PLAYER_RADIUS, 0, MAX_FRAME_DELTA);
        const depth = intoPlinth(p.x, p.z);
        if (depth > worstEdge.depth) worstEdge = { depth, at: approach.at };
      }
    }
  }
  say(worstEdge.depth <= CORNER_ALLOWANCE, `${edgeMarches} marches square at the plinth's sides and back: deepest a body's edge got over its stone ${worstEdge.depth.toFixed(3)} m (${worstEdge.at}), allowance ${CORNER_ALLOWANCE.toFixed(3)}`);

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
      const p = new Vector3(start.x, 0, start.z);
      const dir = new Vector3(target.x - start.x, 0, target.z - start.z).normalize();
      for (let travelled = 0; travelled < 10; travelled += step) {
        collision.resolveMovement(p, dir.x * step, dir.z * step, PLAYER_RADIUS, 0, MAX_FRAME_DELTA);
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
  const p = new Vector3(start.x, 0, start.z);
  let crossed = false;
  for (let t = 0; t < 14; t += PLAYER_LONGEST_STEP) {
    const fx = p.x;
    const fz = p.z;
    collision.resolveMovement(p, -Math.sin(frame.yaw) * PLAYER_LONGEST_STEP, -Math.cos(frame.yaw) * PLAYER_LONGEST_STEP, PLAYER_RADIUS, 0, MAX_FRAME_DELTA);
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
    const dark = [new HemisphereLight(PALETTE.ink, PALETTE.ink, 0.05)];
    const control = lit(darkest.at[0]!, darkest.at[1]!, dark) + lift;
    say(control < ink, `CONTROL: the same floor under a near-dark rig renders ${control.toFixed(4)}, below ink — the measure can fail`);
  }
}

console.log('\nREADABLE — the twelve readable books within her reach:');
{
  const heights = LIBRARY_READABLE_SLOTS.map((slot) => {
    const spec = LIBRARY_BOOKCASES.find((candidate) => candidate.id === slot.bookcase);
    return spec ? (libraryBookcaseSize(spec.kind).shelfTops[slot.shelf] ?? Infinity) : Infinity;
  });
  const highest = Math.max(...heights);
  say(LIBRARY_READABLE_SLOTS.length === 12 && highest <= KID_REACH_HEIGHT, `${LIBRARY_READABLE_SLOTS.length} slots, the highest shelf ${highest.toFixed(3)} m, her reach ${KID_REACH_HEIGHT} m`);
  const shelves = libraryBookcaseSize('wall').shelfTops;
  say(shelves.some((top) => top > KID_REACH_HEIGHT), `CONTROL: the drawn case does have shelves out of her reach (${shelves.filter((top) => top > KID_REACH_HEIGHT).map((top) => top.toFixed(3)).join(', ')}), so the measure can say no`);
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
 * - `child.towards(dx, dz, sprint?)` — a {@link Steer} that holds the stick
 *   the way a thumb would to walk her along world direction (dx, dz): the
 *   stick is camera-relative, so it is solved from the live camera's ground
 *   basis, and fed in through `input.setNavigationMove` (tap-to-move's road
 *   into the same stick). Sprint is `setNavigationSprint`, released every frame
 *   a steer does not ask for it.
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
  towards(dx: number, dz: number, sprint?: boolean): Steer;
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
    towards(dx, dz, sprint = false) {
      const length = Math.hypot(dx, dz);
      if (length === 0) throw new Error('WITH A REAL CHILD: towards() needs a direction');
      const x = dx / length;
      const z = dz / length;
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
