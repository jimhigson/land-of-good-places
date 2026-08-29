/**
 * Follow-up diagnostic for #349: Jim still sees "a big lump of stuff" clipping
 * into the bridge after the first fix.
 *
 * Two hypotheses, measured together:
 *  A. paving escaping ALONG the spine at the ramp feet (the case the first
 *     measurement excluded by construction);
 *  B. the first fix widened the real deck by 0.85 m, so the early conservative
 *     reservation that keeps trees/lamps off the bridge may no longer cover
 *     it — scenery planted inside the masonry would read as "a big lump".
 */
import './scripts/headless-canvas.mjs';
import { buildHeadlessPark } from './scripts/park-harness.mts';
import { terrainHeight } from './src/world/terrain.ts';
import { frameFor } from './src/world/train/bridgeSpine.ts';
import { Mesh, Vector3, Box3, type BufferAttribute, type Object3D } from 'three';

const park = buildHeadlessPark();
const world = park.world;
const train = world.train;
const bridgesGroup = train.group.getObjectByName('railway-bridges');
if (!bridgesGroup) throw new Error('no railway-bridges group');
bridgesGroup.updateMatrixWorld(true);

const layers: { name: string; mesh: Mesh }[] = [];
world.garden.group.traverse((o) => {
  if (o instanceof Mesh && (o.name === 'path-surface' || o.name === 'path-kerb')) {
    layers.push({ name: o.name, mesh: o });
  }
});

const corner = new Vector3();
function planOf(group: Object3D): number[][] {
  const tris: number[][] = [];
  group.traverse((o) => {
    if (!(o instanceof Mesh) || o.name === 'deck') return;
    const pos = o.geometry.getAttribute('position') as BufferAttribute;
    const idx = o.geometry.getIndex();
    const count = idx ? idx.count : pos.count;
    const at = (s: number): [number, number] => {
      const v = idx ? idx.getX(s) : s;
      corner.set(pos.getX(v), pos.getY(v), pos.getZ(v)).applyMatrix4(o.matrixWorld);
      return [corner.x, corner.z];
    };
    for (let i = 0; i + 2 < count; i += 3) {
      const [ax, az] = at(i);
      const [bx, bz] = at(i + 1);
      const [cx, cz] = at(i + 2);
      tris.push([ax, az, bx, bz, cx, cz,
        Math.min(ax, bx, cx), Math.max(ax, bx, cx), Math.min(az, bz, cz), Math.max(az, bz, cz)]);
    }
  });
  return tris;
}
function insideTri(px: number, pz: number, t: number[]): boolean {
  const d1 = (px - t[2]!) * (t[1]! - t[3]!) - (t[0]! - t[2]!) * (pz - t[3]!);
  const d2 = (px - t[4]!) * (t[3]! - t[5]!) - (t[2]! - t[4]!) * (pz - t[5]!);
  const d3 = (px - t[0]!) * (t[5]! - t[1]!) - (t[4]! - t[0]!) * (pz - t[1]!);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
function segD(px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number {
  const dx = x2 - x1, dz = z2 - z1;
  const l = dx * dx + dz * dz;
  let t = l > 0 ? ((px - x1) * dx + (pz - z1) * dz) / l : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}
function outside(px: number, pz: number, tris: number[][]): number {
  for (const t of tris) {
    if (px >= t[6]! && px <= t[7]! && pz >= t[8]! && pz <= t[9]! && insideTri(px, pz, t)) return 0;
  }
  let best = Infinity;
  for (const t of tris) {
    const dx = px < t[6]! ? t[6]! - px : px > t[7]! ? px - t[7]! : 0;
    const dz = pz < t[8]! ? t[8]! - pz : pz > t[9]! ? pz - t[9]! : 0;
    if (Math.hypot(dx, dz) >= best) continue;
    const d = Math.min(
      segD(px, pz, t[0]!, t[1]!, t[2]!, t[3]!),
      segD(px, pz, t[2]!, t[3]!, t[4]!, t[5]!),
      segD(px, pz, t[4]!, t[5]!, t[0]!, t[1]!));
    if (d < best) best = d;
  }
  return best;
}

console.log('=== A. paving outside the masonry plan, by height above terrain ===');
for (let i = 0; i < train.bridges.length; i += 1) {
  const bridge = train.bridges[i]!;
  const group = bridgesGroup.children[i]!;
  const crossing = train.crossings.find((c) => `bridge-${c.railDistance.toFixed(1)}` === group.name);
  const frame = crossing ? frameFor(crossing) : null;
  const tris = planOf(group);
  const rows: { d: number; h: number; along: number; across: number; x: number; z: number; y: number; layer: string }[] = [];
  for (const { name, mesh } of layers) {
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
    for (let v = 0; v < pos.count; v += 1) {
      const x = pos.getX(v), z = pos.getZ(v);
      if (bridge.pavingHeightAt(x, z) === null) continue;
      const y = pos.getY(v);
      const d = outside(x, z, tris);
      if (d <= 1e-6) continue;
      const p = frame ? frame.project(x, z, 0) : { along: NaN, across: NaN };
      rows.push({ d, h: y - terrainHeight(x, z), along: p.along, across: p.across, x, z, y, layer: name });
    }
  }
  rows.sort((a, b) => b.d - a.d);
  console.log(`\n${group.name}: ${rows.length} vertices outside the masonry plan`);
  const box = new Box3().setFromObject(group);
  console.log(`  masonry bbox y ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)}`);
  for (const r of rows.slice(0, 10)) {
    console.log(
      `  out=${r.d.toFixed(3)}m  ${r.h >= 0.1 ? 'FLOATING' : 'on-ground'} h=${r.h.toFixed(3)}  ` +
        `along=${r.along.toFixed(2)} across=${r.across.toFixed(2)}  (${r.x.toFixed(2)}, ${r.y.toFixed(2)}, ${r.z.toFixed(2)})  ${r.layer}`);
  }
}

console.log('\n=== B. does the conservative reservation still cover the real bridge? ===');
const { planBridgeFootprints } = await import('./src/world/train/bridgeFootprint.ts');
const reservations = planBridgeFootprints(train.crossings);
for (let i = 0; i < train.crossings.length; i += 1) {
  const c = train.crossings[i]!;
  const res = reservations[i];
  const name = `bridge-${c.railDistance.toFixed(1)}`;
  const group = bridgesGroup.getObjectByName(name);
  if (!group || !res) { console.log(`  ${name}: no built bridge or no reservation`); continue; }
  // Every masonry vertex must lie inside the reservation, or scenery could
  // legally have been planted where the bridge now stands.
  let outsideRes = 0;
  let total = 0;
  group.traverse((o) => {
    if (!(o instanceof Mesh) || o.name === 'deck') return;
    const pos = o.geometry.getAttribute('position') as BufferAttribute;
    for (let v = 0; v < pos.count; v += 1) {
      corner.set(pos.getX(v), pos.getY(v), pos.getZ(v)).applyMatrix4(o.matrixWorld);
      total += 1;
      if (!res.covers(corner.x, corner.z)) outsideRes += 1;
    }
  });
  console.log(`  ${name}: ${outsideRes}/${total} masonry vertices OUTSIDE the scenery reservation`);
}

console.log('\n=== C. anything solid standing inside a bridge? ===');
for (const [label, positions] of [
  ['tree', world.scenery?.trees?.map?.((t: { x: number; z: number }) => [t.x, t.z]) ?? []],
  ['lamp', world.lampPosts.positions.map((p) => [p.x, p.z])],
] as [string, number[][]][]) {
  for (const [x, z] of positions) {
    for (const bridge of train.bridges) {
      if (bridge.footprintNear(x!, z!, 0)) {
        console.log(`  ${label} at (${x!.toFixed(2)}, ${z!.toFixed(2)}) stands inside a bridge footprint`);
      }
    }
  }
}
