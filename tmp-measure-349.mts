/**
 * Scratch measurement for issue #349: how far does bridge-lifted paving hang
 * past that bridge's own masonry, in plan?
 *
 * Measures the built park: every vertex of the drawn path meshes that a
 * bridge claims via `pavingHeightAt`, plan-projected against the union of
 * that bridge's own shell triangles.
 */
import { buildHeadlessPark } from './scripts/park-harness.mts';
import { Mesh, type BufferAttribute, type Object3D } from 'three';
import { terrainHeight } from './src/world/terrain.ts';

const park = buildHeadlessPark();
const train = park.world.train;

const bridgesGroup = train.group.getObjectByName('railway-bridges');
if (!bridgesGroup) throw new Error('no railway-bridges group');
bridgesGroup.updateMatrixWorld(true);

// --- the drawn paving ------------------------------------------------------
const pathMeshes: Mesh[] = [];
park.world.scene?.traverse?.(() => {});
const roots: Object3D[] = [];
// The scene the harness built into:
const scene = (park as unknown as { scene: Object3D }).scene;
roots.push(scene);
for (const root of roots) {
  root.traverse((object) => {
    if (object instanceof Mesh && (object.name === 'path-surface' || object.name === 'path-kerb')) {
      pathMeshes.push(object);
    }
  });
}
if (pathMeshes.length === 0) throw new Error('no path meshes found');

// --- plan triangles of each bridge's masonry -------------------------------
interface Tri {
  ax: number; az: number; bx: number; bz: number; cx: number; cz: number;
  minX: number; maxX: number; minZ: number; maxZ: number;
}

function planTriangles(group: Object3D): Tri[] {
  const tris: Tri[] = [];
  group.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    if (object.name === 'deck') return; // invisible clearance marker, not masonry
    const geometry = object.geometry;
    const position = geometry.getAttribute('position') as BufferAttribute;
    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    const at = (i: number): [number, number] => {
      const vi = index ? index.getX(i) : i;
      const x = position.getX(vi);
      const y = position.getY(vi);
      const z = position.getZ(vi);
      const v = { x, y, z } as { x: number; y: number; z: number };
      // apply world matrix
      const m = object.matrixWorld.elements;
      const wx = m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12];
      const wz = m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14];
      return [wx as number, wz as number];
    };
    for (let i = 0; i + 2 < count; i += 3) {
      const [ax, az] = at(i);
      const [bx, bz] = at(i + 1);
      const [cx, cz] = at(i + 2);
      tris.push({
        ax, az, bx, bz, cx, cz,
        minX: Math.min(ax, bx, cx), maxX: Math.max(ax, bx, cx),
        minZ: Math.min(az, bz, cz), maxZ: Math.max(az, bz, cz),
      });
    }
  });
  return tris;
}

function insideTri(px: number, pz: number, t: Tri): boolean {
  const d1 = (px - t.bx) * (t.az - t.bz) - (t.ax - t.bx) * (pz - t.bz);
  const d2 = (px - t.cx) * (t.bz - t.cz) - (t.bx - t.cx) * (pz - t.cz);
  const d3 = (px - t.ax) * (t.cz - t.az) - (t.cx - t.ax) * (pz - t.az);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function segDist(px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq > 0 ? ((px - x1) * dx + (pz - z1) * dz) / lenSq : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}

function distanceOutside(px: number, pz: number, tris: Tri[]): number {
  let best = Infinity;
  for (const t of tris) {
    if (px >= t.minX && px <= t.maxX && pz >= t.minZ && pz <= t.maxZ && insideTri(px, pz, t)) {
      return 0;
    }
  }
  for (const t of tris) {
    // cheap bound: if the box is already further than `best`, skip
    const dxBox = px < t.minX ? t.minX - px : px > t.maxX ? px - t.maxX : 0;
    const dzBox = pz < t.minZ ? t.minZ - pz : pz > t.maxZ ? pz - t.maxZ : 0;
    if (Math.hypot(dxBox, dzBox) >= best) continue;
    const d = Math.min(
      segDist(px, pz, t.ax, t.az, t.bx, t.bz),
      segDist(px, pz, t.bx, t.bz, t.cx, t.cz),
      segDist(px, pz, t.cx, t.cz, t.ax, t.az),
    );
    if (d < best) best = d;
  }
  return best;
}

// --- measure ---------------------------------------------------------------
const bridgeGroups = bridgesGroup.children;
console.log(`bridges built: ${train.bridges.length}, groups: ${bridgeGroups.length}`);

for (let i = 0; i < train.bridges.length; i += 1) {
  const bridge = train.bridges[i]!;
  const group = bridgeGroups[i]!;
  const tris = planTriangles(group);
  let lifted = 0;
  let outside = 0;
  let worst = 0;
  let worstAt = '';
  let worstY = 0;
  const hang: { d: number; aboveGround: number; x: number; z: number; y: number }[] = [];
  for (const mesh of pathMeshes) {
    const position = mesh.geometry.getAttribute('position') as BufferAttribute;
    for (let v = 0; v < position.count; v += 1) {
      const x = position.getX(v);
      const z = position.getZ(v);
      if (bridge.pavingHeightAt(x, z) === null) continue;
      lifted += 1;
      const y = position.getY(v);
      const aboveGround = y - terrainHeight(x, z);
      const d = distanceOutside(x, z, tris);
      if (d > 1e-6) hang.push({ d, aboveGround, x, z, y });
      if (d > 1e-6) {
        outside += 1;
        if (d > worst) {
          worst = d;
          worstAt = `(${x.toFixed(2)}, ${position.getY(v).toFixed(2)}, ${z.toFixed(2)})`;
          worstY = position.getY(v);
        }
      }
    }
  }
  const floating = hang.filter((h) => h.aboveGround > 0.1);
  floating.sort((a, b) => b.d - a.d);
  const f0 = floating[0];
  console.log(
    `  -> outside AND floating (>0.1 m over terrain): ${floating.length}` +
      (f0 ? `, worst ${f0.d.toFixed(3)} m at (${f0.x.toFixed(2)}, ${f0.y.toFixed(2)}, ${f0.z.toFixed(2)}), ${f0.aboveGround.toFixed(2)} m over terrain` : ''),
  );
  console.log(
    `${group.name.padEnd(14)} tris=${tris.length}\n` +
      `               lifted=${lifted}  outside masonry plan=${outside}  worst=${worst.toFixed(3)} m` +
      (worstAt ? `\n               worst vertex ${worstAt}` : ''),
  );
  void worstY;
}
