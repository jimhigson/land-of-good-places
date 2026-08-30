/**
 * **Where a market could stand** — free floor on the castle plate (#403).
 *
 * Jim's ruling on the shop packing: *"Come up with an aisle-based market-like
 * layout with the stalls in a grid, not all against the back wall."* Before
 * designing that grid, this measures what floor is actually available for it,
 * because the answer decides the stall size and the aisle count rather than
 * the other way round.
 *
 * ## Why one plan and not five
 *
 * Indoor collision is **height-blind**: a stall counter on deck 2 is an
 * invisible wall on deck 0 as well (see `SHOP_UNITS`' rule 1). So seven stalls
 * on five storeys is still a **single** 2D packing problem, and everything
 * that occupies floor on *any* deck blocks that square metre on *every* deck.
 * That is why this rasterises one plan and folds every deck's obstacles into
 * it.
 *
 * Measures the room that was built: obstacles are read off `BUILDING_SHAFTS`,
 * `TOILET_ROOM`, `DECK_ROUNDEL` and the assembled great-hall furniture group,
 * never re-derived from the numbers that placed them.
 *
 * Run: `pnpm exec node --import ./scripts/ts-extension-resolver-register.mjs
 *       scripts/measure-market-floor.mts`
 */
import './headless-canvas.mjs';
import { Box3, Group, InstancedMesh, Matrix4, Vector3, type Object3D } from 'three';
import { INTERIOR_HALF_X, INTERIOR_HALF_Z, PLAYER_RADIUS } from '../src/core/constants.ts';
import {
  BUILDING_SHAFTS,
  INTERIOR_DOOR_MAX_X,
  INTERIOR_DOOR_MIN_X,
  LIFT_DOOR_MAX_Z,
  LIFT_DOOR_MIN_Z,
  regionContains,
  TOILET_ROOM,
  TOP_DECK,
} from '../src/world/building/layout.ts';
import { DECK_ROUNDEL } from '../src/world/building/dressing.ts';
import { dressGreatHall } from '../src/world/building/castleFurniture.ts';

/** Grid resolution. Fine enough that a 0.25 m error cannot hide an aisle. */
const CELL = 0.25;
/** The perimeter ceiling beam's own width — a stall may not open under one. */
const BEAM = 0.8;

const minX = -INTERIOR_HALF_X + BEAM;
const maxX = INTERIOR_HALF_X - BEAM;
const minZ = -INTERIOR_HALF_Z + BEAM;
const maxZ = INTERIOR_HALF_Z - BEAM;
const cols = Math.floor((maxX - minX) / CELL);
const rows = Math.floor((maxZ - minZ) / CELL);

const centreX = (i: number): number => minX + (i + 0.5) * CELL;
const centreZ = (j: number): number => minZ + (j + 0.5) * CELL;

/** Axis-aligned obstacle boxes in interior-local metres. */
const boxes: { name: string; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
const discs: { name: string; x: number; z: number; radius: number }[] = [];

for (const shaft of BUILDING_SHAFTS) {
  const r = shaft.region;
  if (r.kind === 'rect') boxes.push({ name: `shaft:${shaft.id}`, ...r });
  else discs.push({ name: `shaft:${shaft.id}`, x: r.x, z: r.z, radius: r.radius });
}
boxes.push({ name: 'toilets', ...TOILET_ROOM });
discs.push({ name: 'roundel', x: DECK_ROUNDEL.x, z: DECK_ROUNDEL.z, radius: DECK_ROUNDEL.radius });
// The way in, and the walk from it. A stall may not stand in the doorway.
boxes.push({
  name: 'doorway',
  minX: INTERIOR_DOOR_MIN_X - 1,
  maxX: INTERIOR_DOOR_MAX_X + 1,
  minZ: INTERIOR_HALF_Z - 5,
  maxZ: INTERIOR_HALF_Z,
});
// The lift lobby: the floor a child stands on to wait, on every deck.
boxes.push({
  name: 'lift-lobby',
  minX: INTERIOR_HALF_X - 5,
  maxX: INTERIOR_HALF_X,
  minZ: LIFT_DOOR_MIN_Z - 1.5,
  maxZ: LIFT_DOOR_MAX_Z + 1.5,
});

// The great hall, measured off the furniture that was actually built.
const hall = new Group();
dressGreatHall(0, hall);
let hallBoxes = 0;
const walk = (object: Object3D): void => {
  if (object instanceof InstancedMesh) {
    const m = new Matrix4();
    for (let i = 0; i < object.count; i += 1) {
      object.getMatrixAt(i, m);
      const box = new Box3().setFromBufferAttribute(object.geometry.attributes['position'] as never);
      box.applyMatrix4(m.premultiply(object.matrixWorld));
      boxes.push({ name: `hall:${object.name}[${i}]`, minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z });
      hallBoxes += 1;
    }
    return;
  }
  if ((object as { isMesh?: boolean }).isMesh) {
    const box = new Box3().setFromObject(object);
    if (Number.isFinite(box.min.x)) {
      boxes.push({ name: `hall:${object.name || 'mesh'}`, minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z });
      hallBoxes += 1;
    }
    return;
  }
  for (const child of object.children) walk(child);
};
hall.updateMatrixWorld(true);
walk(hall);

/** Clearance a child needs to walk past an obstacle, from the game. */
const CLEAR = PLAYER_RADIUS;

const free: boolean[][] = [];
let freeCells = 0;
for (let j = 0; j < rows; j += 1) {
  const row: boolean[] = [];
  for (let i = 0; i < cols; i += 1) {
    const x = centreX(i);
    const z = centreZ(j);
    let ok = true;
    for (const b of boxes) {
      if (x > b.minX - CLEAR && x < b.maxX + CLEAR && z > b.minZ - CLEAR && z < b.maxZ + CLEAR) {
        ok = false;
        break;
      }
    }
    if (ok) {
      for (const d of discs) {
        if (Math.hypot(x - d.x, z - d.z) < d.radius + CLEAR) {
          ok = false;
          break;
        }
      }
    }
    row.push(ok);
    if (ok) freeCells += 1;
  }
  free.push(row);
}

const cellArea = CELL * CELL;
console.log(`Plate inside the perimeter beams: ${(maxX - minX).toFixed(2)} x ${(maxZ - minZ).toFixed(2)} m`);
console.log(`Obstacles folded in: ${boxes.length} boxes (${hallBoxes} of them great-hall furniture), ${discs.length} discs`);
console.log(`Free floor: ${(freeCells * cellArea).toFixed(1)} m² of ${((maxX - minX) * (maxZ - minZ)).toFixed(1)} m² (${((freeCells / (cols * rows)) * 100).toFixed(0)}%)`);

/** Largest all-free axis-aligned rectangle, by the standard histogram scan. */
function largestRect(): { area: number; minX: number; maxX: number; minZ: number; maxZ: number } {
  const heights = new Array<number>(cols).fill(0);
  let best = { area: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) heights[i] = free[j]![i] ? (heights[i] ?? 0) + 1 : 0;
    const stack: number[] = [];
    for (let i = 0; i <= cols; i += 1) {
      const h = i === cols ? 0 : heights[i] ?? 0;
      while (stack.length && (heights[stack[stack.length - 1]!] ?? 0) >= h) {
        const top = stack.pop()!;
        const height = heights[top] ?? 0;
        const left = stack.length ? stack[stack.length - 1]! + 1 : 0;
        const area = height * (i - left) * cellArea;
        if (area > best.area) {
          best = {
            area,
            minX: minX + left * CELL,
            maxX: minX + i * CELL,
            minZ: minZ + (j + 1 - height) * CELL,
            maxZ: minZ + (j + 1) * CELL,
          };
        }
      }
      stack.push(i);
    }
  }
  return best;
}

const best = largestRect();
console.log(
  `Largest clear rectangle: ${(best.maxX - best.minX).toFixed(2)} x ${(best.maxZ - best.minZ).toFixed(2)} m ` +
    `= ${best.area.toFixed(1)} m² at x[${best.minX.toFixed(2)}, ${best.maxX.toFixed(2)}] z[${best.minZ.toFixed(2)}, ${best.maxZ.toFixed(2)}]`,
);

// A market grid needs a block that holds `rows x cols` stalls plus the aisles
// between them. Report what the largest clear rectangle can actually carry.
const AISLE = 2 * PLAYER_RADIUS + 1.2; // two children passing, plus elbow room
for (const stall of [3.2, 2.8, 2.4, 2.0]) {
  const w = best.maxX - best.minX;
  const d = best.maxZ - best.minZ;
  const across = Math.floor((w + AISLE) / (stall + AISLE));
  const along = Math.floor((d + AISLE) / (stall + AISLE));
  console.log(
    `  stall ${stall.toFixed(1)} m square, aisle ${AISLE.toFixed(2)} m -> ${across} x ${along} = ${across * along} stalls` +
      (across * along >= 7 ? '  <= fits seven' : ''),
  );
}

/**
 * The real question: a **plate-wide lattice**, not one block.
 *
 * A market does not have to fit in the largest clear rectangle. It can be a
 * grid laid over the whole plate with stalls standing in whichever cells are
 * free — which is also what makes it derive from the plate rather than from
 * seven typed positions. This asks, for each stall size, how many lattice
 * cells are entirely clear.
 */
function latticeCells(stall: number, aisle: number): { x: number; z: number }[] {
  const pitch = stall + aisle;
  const half = stall / 2;
  const across = Math.floor((maxX - minX + aisle) / pitch);
  const along = Math.floor((maxZ - minZ + aisle) / pitch);
  // Centre the lattice on the plate, so it reads as laid out rather than as
  // pushed into a corner.
  const spanX = across * pitch - aisle;
  const spanZ = along * pitch - aisle;
  const originX = (minX + maxX) / 2 - spanX / 2 + half;
  const originZ = (minZ + maxZ) / 2 - spanZ / 2 + half;
  const cells: { x: number; z: number }[] = [];
  for (let a = 0; a < across; a += 1) {
    for (let b = 0; b < along; b += 1) {
      const x = originX + a * pitch;
      const z = originZ + b * pitch;
      let clear = true;
      for (let dx = -half; dx <= half + 1e-9 && clear; dx += CELL) {
        for (let dz = -half; dz <= half + 1e-9 && clear; dz += CELL) {
          const i = Math.floor((x + dx - minX) / CELL);
          const j = Math.floor((z + dz - minZ) / CELL);
          if (i < 0 || j < 0 || i >= cols || j >= rows || !free[j]![i]) clear = false;
        }
      }
      if (clear) cells.push({ x, z });
    }
  }
  return cells;
}

console.log('\nPlate-wide lattice — stalls stand in whichever cells are clear:');
for (const stall of [5.6, 4.8, 4.0, 3.6, 3.2]) {
  const cells = latticeCells(stall, AISLE);
  const pitch = stall + AISLE;
  console.log(
    `  stall ${stall.toFixed(1)} m, pitch ${pitch.toFixed(2)} m -> ${String(cells.length).padStart(2)} clear cell(s)` +
      (cells.length >= 7 ? '   <= SEVEN STALLS FIT' : ''),
  );
  if (cells.length >= 7) {
    for (const c of cells) console.log(`        (${c.x.toFixed(2)}, ${c.z.toFixed(2)})`);
  }
}

console.log(`\nDecks: ${TOP_DECK + 1}. Every figure above is one plan, because collision is height-blind.`);
