import '../headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark } from '../park-harness.mts';
import { PARK_BOUNDARY } from '../../src/world/boundary.ts';
import { FENCE_HALF_THICKNESS, FENCE_OFFSET } from '../../src/world/train/clearance.ts';
import { PLAYER_RADIUS } from '../../src/core/constants.ts';
import { ENTRANCE_GATE_X, ENTRANCE_GATE_Z } from '../../src/world/entrance/layout.ts';
import { PARK_LAYOUT } from '../../src/world/parkLayout.ts';

const { world } = buildHeadlessPark();
const route = world.train.route;
const N = 720;
const xs: number[] = [], zs: number[] = [];
const p = new Vector3();
for (let i = 0; i < N; i++) { route.pointAt((i / N) * route.length, p); xs.push(p.x); zs.push(p.z); }
const REACH = FENCE_OFFSET + FENCE_HALF_THICKNESS + PLAYER_RADIUS;
const cell = 0.5;
const INSET = Number(process.env['INSET'] ?? '0');
const { minX, maxX, minZ, maxZ } = PARK_BOUNDARY.extent;
const nx = Math.ceil((maxX - minX) / cell) + 1, nz = Math.ceil((maxZ - minZ) / cell) + 1;
const walk = new Uint8Array(nx * nz);
for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if (PARK_BOUNDARY.distanceToEdge(minX + i * cell, minZ + j * cell) >= INSET) walk[i * nz + j] = 1;
for (let s = 0; s < N; s++) {
  const ci = Math.round((xs[s]! - minX) / cell), cj = Math.round((zs[s]! - minZ) / cell), r = Math.ceil(REACH / cell) + 1;
  for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
    if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
    if (Math.hypot(minX + i * cell - xs[s]!, minZ + j * cell - zs[s]!) < REACH) walk[i * nz + j] = 0;
  }
}
const label = new Int32Array(nx * nz).fill(-1);
let nreg = 0;
for (let c0 = 0; c0 < nx * nz; c0++) {
  if (!walk[c0] || label[c0]! >= 0) continue;
  const id = nreg++; label[c0] = id; const st = [c0];
  while (st.length) { const c = st.pop()!; const i = Math.floor(c / nz), j = c - i * nz;
    for (const n of [i > 0 ? c - nz : -1, i < nx - 1 ? c + nz : -1, j > 0 ? c - 1 : -1, j < nz - 1 ? c + 1 : -1]) if (n >= 0 && walk[n] && label[n]! < 0) { label[n] = id; st.push(n); } }
}
const at = (x: number, z: number) => label[Math.round((x - minX) / cell) * nz + Math.round((z - minZ) / cell)]!;
const gr = Math.hypot(ENTRANCE_GATE_X, ENTRANCE_GATE_Z);
console.log('gate region', at(ENTRANCE_GATE_X * (1 - 4 / gr), ENTRANCE_GATE_Z * (1 - 4 / gr)));
for (const [id, e] of PARK_LAYOUT.entries) console.log('entry', id, e.entranceX.toFixed(1), e.entranceZ.toFixed(1), 'region', at(e.entranceX, e.entranceZ));
const [x0, x1, z0, z1, step] = (process.env['BOX'] ?? '-10,40,45,70,0.5').split(',').map(Number) as number[];
for (let z = z0!; z <= z1!; z += step!) { let row = `${z.toFixed(1).padStart(6)} `;
  for (let x = x0!; x <= x1!; x += step!) { const l = at(x, z); row += l < 0 ? (PARK_BOUNDARY.contains(x, z) ? '=' : '#') : String.fromCharCode(65 + (l % 26)); }
  console.log(row); }
if (process.env['COMPARE']) {
  const probe = new Vector3();
  const sample = (x: number, z: number, y: number) => world.building.surfaces.sample(x, z, y);
  const standable = (x: number, z: number) => { probe.set(x, sample(x, z, 0), z); world.collision.resolve(probe, PLAYER_RADIUS); return Math.hypot(probe.x - x, probe.z - z) < 1e-3; };
  console.log('COMPARE: fill letter where fill walkable; UPPER = real standable, lower = real blocked; . = fill fenced & real standable, - fill fenced & real blocked');
  for (let z = z0!; z <= z1!; z += step!) { let row = `${z.toFixed(1).padStart(6)} `;
    for (let x = x0!; x <= x1!; x += step!) { const l = at(x, z); const st = standable(x, z);
      if (!PARK_BOUNDARY.contains(x, z)) { row += '#'; continue; }
      if (l < 0) row += st ? '.' : '-'; else { const c = String.fromCharCode(65 + (l % 26)); row += st ? c : c.toLowerCase(); } }
    console.log(row); }
}
