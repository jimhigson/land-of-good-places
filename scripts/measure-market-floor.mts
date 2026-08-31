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

/**
 * **The market block: two rows of stalls facing each other across an aisle.**
 *
 * The centred lattice above lands six contiguous cells and seven are needed,
 * so this sweeps the lattice's origin over one whole pitch in both axes and
 * asks, for every offset, what the best *pair of adjacent rows* is. A pair of
 * rows is the thing that makes a market rather than a scatter: you walk down
 * between them and a stall faces you from either side.
 *
 * Reported as an offset from the centred lattice so the result stays a
 * property of the plate — `layout.ts` can take the pitch and the offset and
 * re-lay the market at any plate size.
 */
function cellIsClear(x: number, z: number, half: number): boolean {
  for (let dx = -half; dx <= half + 1e-9; dx += CELL) {
    for (let dz = -half; dz <= half + 1e-9; dz += CELL) {
      const i = Math.floor((x + dx - minX) / CELL);
      const j = Math.floor((z + dz - minZ) / CELL);
      if (i < 0 || j < 0 || i >= cols || j >= rows || !free[j]![i]) return false;
    }
  }
  return true;
}

function bestMarketBlock(stall: number, aisle: number) {
  const pitch = stall + aisle;
  const half = stall / 2;
  const steps = 24;
  let best: {
    total: number;
    offX: number;
    offZ: number;
    rowA: number;
    rowB: number;
    xsA: number[];
    xsB: number[];
  } | null = null;

  for (let sx = 0; sx < steps; sx += 1) {
    for (let sz = 0; sz < steps; sz += 1) {
      const offX = (sx / steps) * pitch;
      const offZ = (sz / steps) * pitch;
      // Every lattice column and row that fits on the plate at this offset.
      const xs: number[] = [];
      for (let x = minX + half + offX; x <= maxX - half + 1e-9; x += pitch) xs.push(x);
      const zs: number[] = [];
      for (let z = minZ + half + offZ; z <= maxZ - half + 1e-9; z += pitch) zs.push(z);

      for (let r = 0; r + 1 < zs.length; r += 1) {
        const zA = zs[r]!;
        const zB = zs[r + 1]!;
        const xsA = xs.filter((x) => cellIsClear(x, zA, half));
        const xsB = xs.filter((x) => cellIsClear(x, zB, half));
        const total = xsA.length + xsB.length;
        if (!best || total > best.total) {
          best = { total, offX, offZ, rowA: zA, rowB: zB, xsA, xsB };
        }
      }
    }
  }
  return best;
}

console.log('\nBest pair of facing rows — the market block:');
for (const stall of [4.0, 3.6, 3.2]) {
  const b = bestMarketBlock(stall, AISLE);
  if (!b) continue;
  const pitch = stall + AISLE;
  console.log(
    `  stall ${stall.toFixed(1)} m, pitch ${pitch.toFixed(2)} m -> ${b.total} stall(s) in two rows` +
      (b.total >= 7 ? '   <= SEVEN FIT' : ''),
  );
  console.log(`      lattice offset (${b.offX.toFixed(2)}, ${b.offZ.toFixed(2)}) from the plate's low corner`);
  console.log(`      row A z=${b.rowA.toFixed(2)}: x = ${b.xsA.map((v) => v.toFixed(2)).join(', ')}`);
  console.log(`      row B z=${b.rowB.toFixed(2)}: x = ${b.xsB.map((v) => v.toFixed(2)).join(', ')}`);
  console.log(`      aisle centre z = ${((b.rowA + b.rowB) / 2).toFixed(2)}, clear width ${AISLE.toFixed(2)} m`);
}

/**
 * **What is standing in this cell?**
 *
 * A cell count is not actionable — "six of seven" needs a name before anything
 * can move. Names every obstacle that overlaps a stall footprint, so the
 * blocker can be argued about rather than guessed at.
 */
function whatBlocks(x: number, z: number, stall: number): string[] {
  const half = stall / 2;
  const hit: string[] = [];
  for (const b of boxes) {
    if (
      x + half > b.minX - CLEAR &&
      x - half < b.maxX + CLEAR &&
      z + half > b.minZ - CLEAR &&
      z - half < b.maxZ + CLEAR
    ) {
      hit.push(b.name);
    }
  }
  for (const d of discs) {
    const nearX = Math.max(x - half, Math.min(d.x, x + half));
    const nearZ = Math.max(z - half, Math.min(d.z, z + half));
    if (Math.hypot(nearX - d.x, nearZ - d.z) < d.radius + CLEAR) hit.push(d.name);
  }
  if (x - half < minX || x + half > maxX || z - half < minZ || z + half > maxZ) hit.push('off-plate');
  return hit;
}

// The cell that keeps the market at six: row A's middle column.
for (const [x, z, stall] of [
  [-12.07, -12.7, 3.6],
  [0.01, -12.7, 3.6],
  [6.05, -6.66, 3.6],
  [6.05, -12.7, 3.6],
] as const) {
  const hit = whatBlocks(x, z, stall);
  console.log(
    `\nCell (${x.toFixed(2)}, ${z.toFixed(2)}) at ${stall} m: ` +
      (hit.length === 0 ? 'CLEAR' : `blocked by ${[...new Set(hit)].join(', ')}`),
  );
}

/**
 * **The tightest compact market block that holds seven stalls.**
 *
 * The pair-of-rows search above reaches seven only by counting a cell 24 m
 * east of the others, which is a scatter and not a market. This searches
 * **rectangular windows of the lattice** — adjacent rows by adjacent columns —
 * and reports the smallest window that contains seven clear cells, so the
 * stalls are actually within sight of each other down one aisle.
 *
 * Two or three rows: two rows is one aisle, three rows is two aisles, and a
 * real market has either.
 */
function compactBlock(stall: number, aisle: number) {
  const pitch = stall + aisle;
  const half = stall / 2;
  const steps = 16;
  let best: { span: number; rows: number; cols: number; cells: { x: number; z: number }[] } | null =
    null;

  for (let sx = 0; sx < steps; sx += 1) {
    for (let sz = 0; sz < steps; sz += 1) {
      const xs: number[] = [];
      for (let x = minX + half + (sx / steps) * pitch; x <= maxX - half + 1e-9; x += pitch) xs.push(x);
      const zs: number[] = [];
      for (let z = minZ + half + (sz / steps) * pitch; z <= maxZ - half + 1e-9; z += pitch) zs.push(z);

      const clear = zs.map((z) => xs.map((x) => cellIsClear(x, z, half)));

      for (let r0 = 0; r0 < zs.length; r0 += 1) {
        for (const rowCount of [2, 3]) {
          if (r0 + rowCount > zs.length) continue;
          for (let c0 = 0; c0 < xs.length; c0 += 1) {
            for (let colCount = 2; c0 + colCount <= xs.length; colCount += 1) {
              const cells: { x: number; z: number }[] = [];
              for (let r = r0; r < r0 + rowCount; r += 1) {
                for (let c = c0; c < c0 + colCount; c += 1) {
                  if (clear[r]![c]) cells.push({ x: xs[c]!, z: zs[r]! });
                }
              }
              if (cells.length < 7) continue;
              // Span of the window itself — smaller is tighter, so more of the
              // market is in one frame.
              const span = (colCount - 1) * pitch + (rowCount - 1) * pitch;
              if (!best || span < best.span) {
                best = { span, rows: rowCount, cols: colCount, cells: cells.slice(0, 7) };
              }
            }
          }
        }
      }
    }
  }
  return best;
}

console.log('\nTightest compact block holding seven stalls:');
for (const stall of [3.6, 3.2, 2.8]) {
  const b = compactBlock(stall, AISLE);
  const pitch = stall + AISLE;
  if (!b) {
    console.log(`  stall ${stall.toFixed(1)} m, pitch ${pitch.toFixed(2)} m -> NO compact block holds seven`);
    continue;
  }
  const xs = b.cells.map((c) => c.x);
  const zs = b.cells.map((c) => c.z);
  console.log(
    `  stall ${stall.toFixed(1)} m, pitch ${pitch.toFixed(2)} m -> ${b.rows} row(s) x ${b.cols} col(s), ` +
      `footprint ${(Math.max(...xs) - Math.min(...xs) + stall).toFixed(2)} x ${(Math.max(...zs) - Math.min(...zs) + stall).toFixed(2)} m`,
  );
  for (const c of b.cells) console.log(`        (${c.x.toFixed(2)}, ${c.z.toFixed(2)})`);
}

/**
 * **The proposed market, verified cell by cell.**
 *
 * Two rows of four anchored at the plate's inside north-west corner. The
 * along-row pitch is the walking aisle; the **row separation is wider**,
 * because two stalls facing each other across an aisle put their tap targets
 * nose to nose and `check:tap-spacing` needs `TAP_FINGER_METRES` between them.
 * Both numbers come from the game.
 */
{
  const STALL = 2.8;
  const WALK_AISLE = 2 * PLAYER_RADIUS + 1.2;
  // Tap points sit 1.15 m in front of each stall's centre (interactZones), so
  // two facing stalls' targets are `sep - 2.3` apart.
  const TAP_SEP = 2.3 + 2.3 + 1.13;
  const ROW_SEP = Math.max(STALL + WALK_AISLE, TAP_SEP);
  const PITCH_X = STALL + WALK_AISLE;
  const originX = minX + STALL / 2;
  const originZ = minZ - 0.8 + 1.8 + STALL / 2;
  console.log(
    `\nProposed market: stall ${STALL} m, along-row pitch ${PITCH_X.toFixed(2)} m, ` +
      `row separation ${ROW_SEP.toFixed(2)} m (aisle ${(ROW_SEP - STALL).toFixed(2)} m)`,
  );
  let clearCount = 0;
  for (let row = 0; row < 2; row += 1) {
    const z = originZ + row * ROW_SEP;
    const line: string[] = [];
    for (let col = 0; col < 6; col += 1) {
      const x = originX + col * PITCH_X;
      const ok = cellIsClear(x, z, STALL / 2);
      if (ok) clearCount += 1;
      line.push(`c${col} ${ok ? 'clear' : 'X:' + [...new Set(whatBlocks(x, z, STALL))].slice(0,2).join('/')}`);
    }
    console.log(`  row ${row}: ${line.join('  |  ')}`);
  }
  console.log(`  -> ${clearCount} of 12 cells clear; seven stalls need seven.`);
}

/**
 * **Sweep for a grid offset that seats seven stalls with their keep-outs.**
 *
 * The footprint sweep above was not enough, and that is the lesson of this
 * script: a stall's *footprint* is 2.8 m square, but the thing that has to
 * clear the room is its **queue keep-out** — a 4 m disc at each of three spots
 * along the counter (`shopKeepOut`, `dressing.ts`), which `check:castle`
 * measures against every fixed prop. Seven cells were clear by footprint and
 * only six once the hearth's fire was measured against the keep-out, which
 * `check:castle` caught on the built room and this had not.
 *
 * So the keep-out is modelled here now. Sweeps the grid's origin and reports
 * offsets that seat all seven.
 */
{
  const STALL = 2.8;
  const SCALE = 0.8;
  const KEEP_R = 2.6 + 1.4;
  const CHECK_MARGIN = 0.62; // check:castle demands radius + this
  const WALK = 2 * PLAYER_RADIUS + 1.2;
  const PITCH = STALL + WALK;
  const ROW_SEP = Math.max(PITCH, 2.3 + 2.3 + 1.13);

  // Fixed props the keep-out must clear: the hearth's fire and woodpile.
  const HEARTH = { x: -14 * Math.SQRT1_2, z: -INTERIOR_HALF_Z + 0.85 };

  const seats = (offX: number, offZ: number): { row: number; col: number }[] => {
    const ok: { row: number; col: number }[] = [];
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 6; col += 1) {
        const x = minX + STALL / 2 + offX + col * PITCH;
        const z = minZ + STALL / 2 + offZ + row * ROW_SEP;
        if (!cellIsClear(x, z, STALL / 2)) continue;
        // Three keep-out spots along the counter, facing into the aisle.
        const face = row === 0 ? 1 : -1;
        let clean = true;
        for (const along of [-1.8, 0, 1.8]) {
          const sx = x + along * SCALE;
          const sz = z + face * 2 * SCALE;
          if (Math.hypot(sx - HEARTH.x, sz - HEARTH.z) < KEEP_R + CHECK_MARGIN) clean = false;
        }
        if (clean) ok.push({ row, col });
      }
    }
    return ok;
  };

  let best: { n: number; offX: number; offZ: number; cells: { row: number; col: number }[] } | null = null;
  for (let a = 0; a <= 40; a += 1) {
    for (let b = 0; b <= 40; b += 1) {
      const offX = (a / 40) * PITCH;
      const offZ = (b / 40) * ROW_SEP;
      const cells = seats(offX, offZ);
      if (!best || cells.length > best.n) best = { n: cells.length, offX, offZ, cells };
      if (best.n >= 7) break;
    }
    if (best && best.n >= 7) break;
  }
  console.log('\nSweep with the queue keep-out modelled:');
  if (best) {
    console.log(`  best ${best.n} seat(s) at offset (${best.offX.toFixed(2)}, ${best.offZ.toFixed(2)})`);
    for (const c of best.cells) {
      const x = minX + STALL / 2 + best.offX + c.col * PITCH;
      const z = minZ + STALL / 2 + best.offZ + c.row * ROW_SEP;
      console.log(`      row ${c.row} col ${c.col} -> (${x.toFixed(2)}, ${z.toFixed(2)})`);
    }
  }
}

/**
 * **Two aisles (Jim's ruling, via the Overseer).**
 *
 * One row against a wall with a gangway in front is a shopping parade; two
 * aisles is a market. The north aisle is what fits beside the hearth, and the
 * south strip takes the rest. The hearth, the roundel and the toilets are all
 * **obstacles to design around, not to move**.
 *
 * Tests both the footprint *and* the queue keep-out, because the keep-out is
 * the thing that actually bound the north aisle: seven cells were clear by
 * footprint and six once the queue was measured.
 */
{
  const STALL = 2.8;
  const SCALE = 0.8;
  const KEEP = 2.6 + 1.4 + 0.62; // shopKeepOut radius + check:castle's margin
  const WALK = 2 * PLAYER_RADIUS + 1.2;
  const PITCH = STALL + WALK;
  const ROW_SEP = Math.max(PITCH, 2.3 + 2.3 + 1.13);

  /** Fixed things a stall's queue may not crowd. Measured, not assumed. */
  const fixedPoints: { name: string; x: number; z: number }[] = [];
  // The hearth's fire and woodpile, as check:castle sees them.
  for (let k = -1; k <= 1; k += 1) {
    fixedPoints.push({ name: 'hearth', x: -14 * Math.SQRT1_2 + k * 0.9, z: -INTERIOR_HALF_Z + 0.6 });
  }
  // The roundel's planter ring — fixed geometry, not scattered dressing.
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * Math.PI * 2;
    fixedPoints.push({
      name: 'planter',
      x: DECK_ROUNDEL.x + Math.cos(a) * (DECK_ROUNDEL.radius - 0.9),
      z: DECK_ROUNDEL.z + Math.sin(a) * (DECK_ROUNDEL.radius - 0.9),
    });
  }

  const seatOk = (x: number, z: number, face: number): boolean => {
    if (!cellIsClear(x, z, STALL / 2)) return false;
    for (const along of [-1.8, 0, 1.8]) {
      const sx = x + along * SCALE;
      const sz = z + face * 2 * SCALE;
      for (const f of fixedPoints) if (Math.hypot(sx - f.x, sz - f.z) < KEEP) return false;
      // The queue may not stand in the toilets either.
      if (sx > TOILET_ROOM.minX - 1 && sx < TOILET_ROOM.maxX + 1 && sz > TOILET_ROOM.minZ - 1 && sz < TOILET_ROOM.maxZ + 1) return false;
    }
    return true;
  };

  const report = (label: string, rowZ: readonly number[]) => {
    const seats: { x: number; z: number; face: number }[] = [];
    for (let r = 0; r < rowZ.length; r += 1) {
      const z = rowZ[r]!;
      const face = r === 0 ? 1 : -1;
      const line: string[] = [];
      for (let col = 0; col < 8; col += 1) {
        const x = minX + STALL / 2 + col * PITCH;
        if (x + STALL / 2 > maxX) break;
        const ok = seatOk(x, z, face);
        if (ok) seats.push({ x, z, face });
        line.push(`c${col}:${ok ? 'Y' : '.'}`);
      }
      console.log(`  ${label} row ${r} z=${z.toFixed(2)} face ${face > 0 ? '+Z' : '-Z'}  ${line.join(' ')}`);
    }
    return seats;
  };

  console.log('\nTwo aisles — Y is a seat that clears both footprint and queue:');
  const northZ0 = minZ + 1.0 + STALL / 2;
  const north = report('north', [northZ0, northZ0 + ROW_SEP]);
  // South aisle: as far south as it can go while its back row clears the
  // shaft band, then the second row toward the south wall.
  const southZ0 = 3.24 + 1.0 + STALL / 2;
  const south = report('south', [southZ0, southZ0 + ROW_SEP]);
  console.log(`  -> north ${north.length} seat(s), south ${south.length} seat(s), total ${north.length + south.length}`);
  if (north.length + south.length >= 7) {
    console.log('  SEVEN OR MORE SEAT. Cells:');
    for (const s2 of [...north, ...south]) console.log(`      (${s2.x.toFixed(2)}, ${s2.z.toFixed(2)}) face ${s2.face > 0 ? '+Z' : '-Z'}`);
  }
}

console.log(`\nDecks: ${TOP_DECK + 1}. Every figure above is one plan, because collision is height-blind.`);
