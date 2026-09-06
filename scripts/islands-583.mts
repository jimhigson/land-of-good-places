/** SCRATCH #583 — where exactly are the unreachable islands? */
import './headless-canvas.mjs';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { NavGrid } from '../src/world/NavGrid.ts';
import { circleBoundary } from '../src/world/boundary.ts';
import { HOTEL_PLAY_RADIUS, PLAYER_RADIUS } from '../src/core/constants.ts';
import { JUMP_APEX_HEIGHT } from '../src/entities/Player.ts';
import { ROOMS } from '../src/world/hotel/layout.ts';

const { world } = quietly(() => buildHeadlessPark());
const collision = world.collision;
const CELL = 0.5;

for (const room of ROOMS) {
  const westGap = room.gaps?.west;
  if (!westGap) continue;
  collision.setPlayBounds(circleBoundary(HOTEL_PLAY_RADIUS, room.originX, room.originZ));
  const grid = new NavGrid(collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT, () => world.building.surfaces.connectors);
  const at = (lx: number, lz: number) => world.building.surfaces.sample(room.originX + lx, room.originZ + lz, 3);
  const cols = Math.floor((room.halfX * 2) / CELL), rows = Math.floor((room.halfZ * 2) / CELL);
  const lx = (c: number) => -room.halfX + (c + 0.5) * CELL, lz = (c: number) => -room.halfZ + (c + 0.5) * CELL;
  const free = new Uint8Array(cols * rows);
  for (let cz = 0; cz < rows; cz++) for (let cx = 0; cx < cols; cx++)
    if (grid.canStandAt(room.originX + lx(cx), room.originZ + lz(cz), at(lx(cx), lz(cz)), at)) free[cz * cols + cx] = 1;
  const ex = Math.round((-room.halfX + 1.6 + room.halfX) / CELL - 0.5);
  const ez = Math.round(((westGap[0] + westGap[1]) / 2 + room.halfZ) / CELL - 0.5);
  const seen = new Uint8Array(cols * rows);
  const q = [ez * cols + ex]; seen[q[0]!] = 1;
  const nb = (i: number) => { const cx = i % cols, cz = (i - cx) / cols; const o: number[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz; if (nx < 0 || nx >= cols || nz < 0 || nz >= rows) continue;
      const n = nz * cols + nx; if (free[n] !== 1) continue;
      if (dx && dz && (free[cz * cols + nx] !== 1 || free[nz * cols + cx] !== 1)) continue; o.push(n); } return o; };
  while (q.length) { const a = q.pop()!; for (const n of nb(a)) if (!seen[n]) { seen[n] = 1; q.push(n); } }
  // group the marooned into islands
  const island = new Int32Array(cols * rows).fill(-1);
  let id = 0; const out: { n: number; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  for (let i = 0; i < free.length; i++) {
    if (free[i] !== 1 || seen[i] === 1 || island[i] >= 0) continue;
    const st = [i]; island[i] = id; let n = 0;
    let mnX = 99, mxX = -99, mnZ = 99, mxZ = -99;
    while (st.length) { const a = st.pop()!; n++;
      const cx = a % cols, cz = (a - cx) / cols;
      mnX = Math.min(mnX, lx(cx)); mxX = Math.max(mxX, lx(cx));
      mnZ = Math.min(mnZ, lz(cz)); mxZ = Math.max(mxZ, lz(cz));
      for (const m of nb(a)) if (island[m] < 0 && seen[m] !== 1) { island[m] = id; st.push(m); } }
    out.push({ n, minX: mnX, maxX: mxX, minZ: mnZ, maxZ: mxZ }); id++;
  }
  if (!out.length) continue;
  console.log(`\n${room.space} (halfX ${room.halfX}, halfZ ${room.halfZ}) — ${out.length} island(s):`);
  for (const o of out.sort((a, b) => b.n - a.n))
    console.log(`   ${String(o.n).padStart(4)} cells (${(o.n * CELL * CELL).toFixed(1)} m²)  x ${o.minX.toFixed(2)}..${o.maxX.toFixed(2)}  z ${o.minZ.toFixed(2)}..${o.maxZ.toFixed(2)}`);
}
