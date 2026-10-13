/**
 * **`check:library` — the Library is solid, walkable, lit, and nobody can get
 * stuck in it** (#716, part 2 of epic #714).
 *
 * ```
 * pnpm run check:library
 * LIBRARY_CHECK_REMOVE='stack-2-3' pnpm run check:library    # take a solid out: must go red
 * LIBRARY_CHECK_OPEN_SHELL=1 pnpm run check:library          # open the exterior's back wall: must go red
 * ```
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
 *     past the corner rounding its capsules leave.
 *  6. FACADE — the building marched at from forty-eight bearings at both
 *     strides: nothing gets inside the cella but through the doorway, nothing
 *     into a column, and a sprinter through the door stops on the recess's
 *     back wall.
 *  7. STEPS — up the steps at seven points across them: her feet on the stone.
 *  8. DOORS — both ways, on the real `Library`: the door link stands her on the
 *     doormat; a sprint stride across the front band enters at the arrival,
 *     clear of the exit band; a stride across the exit band leaves onto clear
 *     ground on the doormat, clear of the front band; `/library` enters from
 *     inside too.
 *  9. FADE — standing behind a stack, the stack fades; standing in the open
 *     central aisle (the control), nothing does.
 * 10. LIGHT — no light is black or off, the pools are within the budget, and
 *     the darkest patch of floor renders brighter than `PALETTE.ink` (with a
 *     control: the same floor with no lift under a dark rig measures below it).
 *
 * Coverage notes go to stderr, so a passing run says what it measured.
 */
import './headless-canvas.mjs';
import { Color, Group, HemisphereLight, MeshToonMaterial, Vector3, type Mesh } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { CollisionWorld } from '../src/world/Collision.ts';
import { WalkSurfaces } from '../src/world/building/surfaces.ts';
import { MAX_FRAME_DELTA, PLAYER_LONGEST_STEP, PLAYER_RADIUS, BUILDING_STEP_UP } from '../src/core/constants.ts';
import { PALETTE } from '../src/core/palette.ts';
import { bandCrossed } from '../src/world/tapSpacing.ts';
import { SPACE_GARDEN, SPACE_LIBRARY, spaceAt } from '../src/world/spaces.ts';
import { terrainHeight } from '../src/world/terrain.ts';
import { libraryKeepOuts } from '../src/world/library/props.ts';
import { bookcaseCentre } from '../src/world/library/furnish.ts';
import { buildReadingRoomShell } from '../src/world/library/shell.ts';
import { floorIrradiance, LIBRARY_LIGHT_BUDGET } from '../src/world/library/lighting.ts';
import { libraryBookcaseSize, libraryDeskSize } from '../src/art/models/libraryAssets.ts';
import {
  LIBRARY_AISLES,
  LIBRARY_ARRIVAL,
  LIBRARY_BOOKCASES,
  LIBRARY_DESK_STAND,
  LIBRARY_DOOR_HALF,
  LIBRARY_DOOR_X,
  LIBRARY_FURNITURE,
  LIBRARY_HALF_X,
  LIBRARY_HALF_Z,
  LIBRARY_INNER_X,
  LIBRARY_INNER_Z,
  LIBRARY_ORIGIN_X,
  LIBRARY_ORIGIN_Z,
  type LocalPoint,
} from '../src/world/library/layout.ts';
import type { FrameContext } from '../src/core/types.ts';

const OX = LIBRARY_ORIGIN_X;
const OZ = LIBRARY_ORIGIN_Z;
const CELL = 0.25;

let bad = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) bad += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${line}`);
};
const note = (line: string): void => {
  process.stderr.write(`  note: ${line}\n`);
};

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

/** A drawn box, room-local: how far outside it (x, z) stands — negative inside. */
interface DrawnBox {
  readonly what: string;
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly halfLength: number;
  readonly halfDepth: number;
}
function outsideBox(box: DrawnBox, x: number, z: number): number {
  const yaw = (box.facing * Math.PI) / 180;
  const dx = x - box.x;
  const dz = z - box.z;
  const along = Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw)) - box.halfLength;
  const out = Math.abs(dx * Math.sin(yaw) + dz * Math.cos(yaw)) - box.halfDepth;
  const outside = Math.hypot(Math.max(along, 0), Math.max(out, 0));
  return outside > 0 ? outside : Math.max(along, out);
}

/** Every drawn box the room registers, from the same tables the room is built from. */
function drawnBoxes(): DrawnBox[] {
  const boxes: DrawnBox[] = [];
  for (const spec of LIBRARY_BOOKCASES) {
    const size = libraryBookcaseSize(spec.kind);
    const centre = bookcaseCentre(spec);
    boxes.push({ what: `bookcase ${spec.id}`, x: centre.x, z: centre.z, facing: spec.facing, halfLength: size.length / 2, halfDepth: size.depth / 2 });
  }
  const desk = LIBRARY_FURNITURE.find((piece) => piece.kind === 'desk');
  if (desk) {
    const size = libraryDeskSize();
    boxes.push({ what: 'the desk', x: desk.at.x, z: desk.at.z, facing: desk.facing, halfLength: size.width / 2, halfDepth: size.depth / 2 });
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
  note(`OPENED the exterior's wall ${index} (1 is the back) on purpose — this run must go red`);
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
  // A filled box is a capsule down its length plus a 0.1 m capsule across each
  // end (`LibraryProps.box`), so its square corners round off by
  // 0.1 x (sqrt 2 - 1) = 0.04 m; plus 3 cm of resolver slack.
  const allowance = 0.1 * (Math.SQRT2 - 1) + 0.03;
  const boxes = drawnBoxes();
  for (const piece of LIBRARY_FURNITURE) {
    if (piece.kind !== 'armchair' && piece.kind !== 'storyChair') continue;
    const drawn = library.solids.find((solid) => solid.what === `${piece.id} (body)`);
    if (!drawn || drawn.points.length !== 2) continue;
    const [a, b] = drawn.points as [LocalPoint, LocalPoint];
    const half = Math.hypot(b.x - a.x, b.z - a.z) / 2 + drawn.radius;
    boxes.push({ what: piece.id, x: piece.at.x, z: piece.at.z, facing: piece.facing, halfLength: half, halfDepth: drawn.radius });
  }
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
    if (deepest > allowance) say(false, `${box.what}: a body's edge got ${deepest.toFixed(3)} m into it (allowance ${allowance.toFixed(3)})`);
  }
  say(worst.over <= allowance, `${boxes.length} drawn boxes, ${marches} marches; deepest a body's edge got into one: ${worst.over.toFixed(3)} m (${worst.what || 'none'}), allowance ${allowance.toFixed(3)}`);
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

console.log('\nFACADE — the building marched at from 48 bearings, at 5 cm and the sprint stride:');
{
  const frame = library.frame;
  const plan = library.plan;
  const local = new Vector3();
  /** How far a body's edge is into the cella's drawn walls (the recess excepted), or into a column. */
  const intoSolid = (x: number, z: number): { depth: number; what: string } => {
    frame.toLocal(x, terrainHeight(x, z), z, local);
    const inRecess = Math.abs(local.x) < plan.doorHalf && local.z > plan.recessBackZ;
    let depth = -Infinity;
    let what = '';
    if (!inRecess) {
      const dx = Math.abs(local.x) - plan.cellaHalfX;
      const dzBack = plan.cellaBackZ - local.z;
      const dzFront = local.z - plan.cellaFrontZ;
      const dz = Math.max(dzBack, dzFront);
      const outside = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
      const signed = outside > 0 ? outside : Math.max(dx, dz);
      depth = PLAYER_RADIUS - signed;
      what = 'the cella';
    }
    for (const [i, column] of plan.columns.entries()) {
      const d = PLAYER_RADIUS - (Math.hypot(local.x - column.x, local.z - column.z) - column.radius);
      if (d > depth) {
        depth = d;
        what = `column ${i + 1}`;
      }
    }
    return { depth, what };
  };
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
        if (into.depth > deepest.depth) deepest = { ...into, bearing: (i / 48) * 360 };
        closest = Math.min(closest, Math.hypot(p.x - frame.x, p.z - frame.z));
      }
      if (closest < Math.hypot(plan.cellaHalfX, plan.cellaFrontZ) + 1.5) reachedShell += 1;
    }
  }
  // The cella's colliders are its drawn walls exactly; a column is its base.
  // 3 cm of resolver slack, as for the room's boxes.
  say(deepest.depth <= 0.03, `deepest a body's edge got into the cella or a column: ${deepest.depth.toFixed(3)} m (${deepest.what}, ${deepest.bearing.toFixed(0)}° round from the door)`);
  say(reachedShell >= marches * 0.75, `${reachedShell} of ${marches} marches reached the building (the rest met a neighbour or the doorway)`);
  // A sprinter through the door stops on the recess's back wall, inside the band.
  const band = library.doorBands()[0]!;
  const start = frame.foot(0, plan.stepFrontZ + 3);
  const p = new Vector3(start.x, 0, start.z);
  let crossed = false;
  for (let t = 0; t < 14; t += PLAYER_LONGEST_STEP) {
    const fx = p.x;
    const fz = p.z;
    collision.resolveMovement(p, -Math.sin(frame.yaw) * PLAYER_LONGEST_STEP, -Math.cos(frame.yaw) * PLAYER_LONGEST_STEP, PLAYER_RADIUS, 0, MAX_FRAME_DELTA);
    if (bandCrossed(band, fx, fz, p.x, p.z)) crossed = true;
  }
  frame.toLocal(p.x, 0, p.z, local);
  say(crossed && local.z > plan.recessBackZ && local.z < plan.cellaFrontZ + 0.2, `a sprinter through the door crosses the band and stops at ${local.z.toFixed(2)} m along (recess back wall ${plan.recessBackZ.toFixed(2)})`);
}

console.log('\nSTEPS — straight up the step at seven points across it, feet on the stone:');
{
  const frame = library.frame;
  const plan = library.plan;
  const local = new Vector3();
  let worst = { at: 0, deepest: 0 };
  let over = 0;
  for (const across of [-8.3, -6.5, -3.5, 0, 3.5, 6.5, 8.3]) {
    const start = frame.foot(across, plan.stepFrontZ + 2.5);
    const p = new Vector3(start.x, surfaces.sample(start.x, start.z, terrainHeight(start.x, start.z) + 3), start.z);
    for (let t = 0; t < 4.5; t += 0.05) {
      collision.resolveMovement(p, -Math.sin(frame.yaw) * 0.05, -Math.cos(frame.yaw) * 0.05, PLAYER_RADIUS, 0, MAX_FRAME_DELTA);
      p.y = surfaces.sample(p.x, p.z, p.y);
      frame.toLocal(p.x, p.y, p.z, local);
      if (Math.abs(local.x) <= plan.plinthHalfX && local.z <= plan.stepFrontZ && local.z >= plan.recessBackZ) {
        over += 1;
        const top = local.z >= plan.stepBackZ ? plan.stepTop : plan.plinthTop;
        if (top - local.y > worst.deepest) worst = { at: across, deepest: top - local.y };
      }
    }
  }
  say(over > 50, `${over} samples over the stone`);
  say(worst.deepest <= 0.02, `her feet at worst ${worst.deepest.toFixed(3)} m into the stone (${worst.at} m across; step-up rule ${BUILDING_STEP_UP} m, base set ${library.baseSink.toFixed(3)} m)`);
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
    /** What the floor renders at (x, z): albedo x irradiance / pi (three.js's Lambert), plus its own lift. */
    const rendered = (x: number, z: number, rig = lights, lift = true): number => {
      const irradiance = floorIrradiance(rig, x, z);
      const out = material.color.clone().multiply(irradiance).multiplyScalar(1 / Math.PI);
      if (lift) out.add(material.emissive.clone().multiplyScalar(material.emissiveIntensity));
      return luminance(out);
    };
    const ink = luminance(new Color(PALETTE.ink));
    let darkest = { at: [0, 0], value: Infinity };
    let brightest = 0;
    for (let x = -LIBRARY_INNER_X; x <= LIBRARY_INNER_X; x += 1) {
      for (let z = -LIBRARY_INNER_Z; z <= LIBRARY_INNER_Z; z += 1) {
        const value = rendered(x, z);
        brightest = Math.max(brightest, value);
        if (value < darkest.value) darkest = { at: [x, z], value };
      }
    }
    say(darkest.value > ink, `the darkest patch of floor, (${darkest.at[0]}, ${darkest.at[1]}), renders at ${darkest.value.toFixed(4)} linear, brighter than PALETTE.ink's ${ink.toFixed(4)}`);
    say(brightest > darkest.value * 2, `the pools read as pools: brightest ${brightest.toFixed(4)}, ${(brightest / darkest.value).toFixed(1)}x the darkest`);
    const dark = [new HemisphereLight(PALETTE.ink, PALETTE.ink, 0.05)];
    const control = rendered(darkest.at[0]!, darkest.at[1]!, dark, false);
    say(control < ink, `CONTROL: the same floor with no lift under a near-dark rig renders ${control.toFixed(4)}, below ink — the measure can fail`);
  }
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
  note(`seed's library at (${library.frame.x.toFixed(1)}, ${library.frame.z.toFixed(1)}), ${library.solids.length} room solids, ${library.shellSolids.walls.length} shell walls, ${library.shellSolids.columns.length} columns`);
}

console.log(bad === 0 ? '\nAll clauses passed.' : `\n${bad} clause(s) FAILED.`);
process.exit(bad === 0 ? 0 : 1);
