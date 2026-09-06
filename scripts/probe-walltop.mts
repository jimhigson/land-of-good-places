/** Throwaway: the shell/wallTop seam on pool seed 326, in triangles. */
import './headless-canvas.mjs';
import { Mesh, Vector3, type Object3D } from 'three';
import { buildHeadlessPark } from './park-harness.mts';

const AT = new Vector3(59.25, -1.14, -10.36);
const N = new Vector3(0.668, 0.690, 0.277).normalize();

const park = buildHeadlessPark();
park.scene.updateMatrixWorld(true);

const found: { name: string; owner: string; n: Vector3; c: Vector3; v: Vector3[] }[] = [];
park.scene.traverse((node: Object3D) => {
  if (!(node instanceof Mesh)) return;
  if (node.name !== 'shell' && node.name !== 'wallTop') return;
  const g = node.geometry;
  const pos = g.getAttribute('position');
  const idx = g.index;
  const tris = idx ? idx.count / 3 : pos.count / 3;
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let t = 0; t < tris; t += 1) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(node.matrixWorld);
    b.fromBufferAttribute(pos, i1).applyMatrix4(node.matrixWorld);
    c.fromBufferAttribute(pos, i2).applyMatrix4(node.matrixWorld);
    const centre = new Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    if (centre.distanceTo(AT) > 1.2) continue;
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    if (n.lengthSq() === 0) continue;
    n.normalize();
    if (Math.abs(n.dot(N)) < 0.97) continue;
    found.push({
      name: node.name,
      owner: (node.parent?.name ?? '?'),
      n: n.clone(),
      c: centre.clone(),
      v: [a.clone(), b.clone(), c.clone()],
    });
  }
});
const f = (v: Vector3): string => `(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
for (const t of found.sort((x, y) => x.name.localeCompare(y.name))) {
  console.log(`${t.owner}/${t.name}  n=${f(t.n)}  d=${t.n.dot(t.v[0] as Vector3).toFixed(6)}`);
  console.log(`    ${t.v.map(f).join(' ')}`);
}
console.log(`\n${found.length} triangles within 1.2 m of ${f(AT)} facing that plane.`);
