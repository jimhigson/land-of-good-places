/**
 * Do the rail-race finish-rainbow legs (or the fence) actually stand inside a
 * bridge's masonry, or merely inside its bounding box?
 * Tests every vertex of the suspect meshes against the bridge's own plan
 * triangles AND its height at that point.
 */
import './scripts/headless-canvas.mjs';
import { buildHeadlessPark } from './scripts/park-harness.mts';
import { Mesh, Vector3, type BufferAttribute, type Object3D } from 'three';

const park = buildHeadlessPark();
const scene = (park as unknown as { scene: Object3D }).scene;
scene.updateMatrixWorld(true);
const train = park.world.train;
const bridgesGroup = train.group.getObjectByName('railway-bridges')!;

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
      const [ax, az] = at(i); const [bx, bz] = at(i + 1); const [cx, cz] = at(i + 2);
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
const inPlan = (px: number, pz: number, tris: number[][]): boolean =>
  tris.some((t) => px >= t[6]! && px <= t[7]! && pz >= t[8]! && pz <= t[9]! && insideTri(px, pz, t));

const SUSPECTS = /finish-rainbow|rail-fence|trestle|track-|lamp|flower/;

for (const group of bridgesGroup.children) {
  const tris = planOf(group);
  console.log(`\n=== ${group.name} ===`);
  const found = new Map<string, { n: number; ymin: number; ymax: number; sample: string }>();
  scene.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible) return;
    let n: Object3D | null = o; let own = false;
    while (n) { if (n === group) { own = true; break; } n = n.parent; }
    if (own) return;
    const full: string[] = [];
    let q: Object3D | null = o;
    while (q) { full.unshift(q.name || q.type); q = q.parent; }
    const path = full.join('/');
    if (!SUSPECTS.test(path)) return;
    const pos = o.geometry.getAttribute('position') as BufferAttribute;
    // Sample up to 400 vertices per mesh.
    const stride = Math.max(1, Math.floor(pos.count / 400));
    for (let v = 0; v < pos.count; v += stride) {
      corner.set(pos.getX(v), pos.getY(v), pos.getZ(v)).applyMatrix4(o.matrixWorld);
      if (!inPlan(corner.x, corner.z, tris)) continue;
      // Is it above the ground, i.e. actually in the bridge's solid body or
      // sitting on/through its road, rather than under the arch?
      const e = found.get(path) ?? { n: 0, ymin: Infinity, ymax: -Infinity, sample: '' };
      e.n += 1;
      e.ymin = Math.min(e.ymin, corner.y);
      e.ymax = Math.max(e.ymax, corner.y);
      if (!e.sample) e.sample = `(${corner.x.toFixed(2)}, ${corner.y.toFixed(2)}, ${corner.z.toFixed(2)})`;
      found.set(path, e);
    }
  });
  if (found.size === 0) { console.log('  nothing suspect inside the masonry plan'); continue; }
  for (const [p, e] of [...found.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${String(e.n).padStart(4)} verts  y ${e.ymin.toFixed(2)}..${e.ymax.toFixed(2)}  first ${e.sample}  ${p}`);
  }
}
