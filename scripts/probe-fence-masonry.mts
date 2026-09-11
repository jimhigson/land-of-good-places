/**
 * Throwaway: fence-vs-masonry overlap, **exactly**, not as axis-aligned boxes.
 *
 * Both the wall's blocks and the fence's pickets are boxes rotated about Y, so
 * the world-space AABB of either is inflated by up to its own diagonal — a
 * 1.63 x 0.70 m block laid at 45 degrees has a 1.65 m AABB against a true
 * 0.85 m half-width. Testing those AABBs against each other therefore reports
 * contact that is not there, and the count it gives is an upper bound rather
 * than a measurement.
 *
 * Boxes rotated about one axis are exactly separable by SAT on four axes in the
 * XZ plane plus an interval test in Y, which is what this does. It prints both
 * numbers so the size of the AABB lie is visible rather than assumed.
 */
import './headless-canvas.mjs';
import { Box3, InstancedMesh, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_SEED } from '../src/world/parkManifest.ts';

interface Slab {
  /** Centre. */
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  /** Half extents along the box's own axes. */
  readonly hx: number;
  readonly hy: number;
  readonly hz: number;
  /** Unit axis along local X, in world XZ. */
  readonly ax: number;
  readonly az: number;
}

function slabsOf(mesh: Mesh): Slab[] {
  mesh.geometry.computeBoundingBox();
  const local = mesh.geometry.boundingBox;
  if (!local) return [];
  const size = local.getSize(new Vector3());
  const offset = local.getCenter(new Vector3());
  const matrix = new Matrix4();
  const out: Slab[] = [];
  const copies = mesh instanceof InstancedMesh ? mesh.count : 1;
  const centre = new Vector3();
  const axis = new Vector3();
  const scale = new Vector3();
  for (let i = 0; i < copies; i += 1) {
    if (mesh instanceof InstancedMesh) {
      mesh.getMatrixAt(i, matrix);
      matrix.premultiply(mesh.matrixWorld);
    } else matrix.copy(mesh.matrixWorld);
    centre.copy(offset).applyMatrix4(matrix);
    // The instance's own X axis, and its scale on each axis.
    axis.set(matrix.elements[0] as number, 0, matrix.elements[2] as number);
    const axisLength = Math.hypot(axis.x, axis.z) || 1;
    scale.setFromMatrixScale(matrix);
    out.push({
      cx: centre.x,
      cy: centre.y,
      cz: centre.z,
      hx: (size.x * scale.x) / 2,
      hy: (size.y * scale.y) / 2,
      hz: (size.z * scale.z) / 2,
      ax: axis.x / axisLength,
      az: axis.z / axisLength,
    });
  }
  return out;
}

/** Exact for two boxes that are only ever rotated about Y. */
function overlaps(a: Slab, b: Slab): boolean {
  if (Math.abs(a.cy - b.cy) >= a.hy + b.hy) return false;
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  const axes = [
    [a.ax, a.az],
    [-a.az, a.ax],
    [b.ax, b.az],
    [-b.az, b.ax],
  ] as const;
  for (const [ux, uz] of axes) {
    const distance = Math.abs(dx * ux + dz * uz);
    const reachA = a.hx * Math.abs(a.ax * ux + a.az * uz) + a.hz * Math.abs(-a.az * ux + a.ax * uz);
    const reachB = b.hx * Math.abs(b.ax * ux + b.az * uz) + b.hz * Math.abs(-b.az * ux + b.ax * uz);
    if (distance >= reachA + reachB) return false;
  }
  return true;
}

function aabbOf(s: Slab): Box3 {
  const rx = s.hx * Math.abs(s.ax) + s.hz * Math.abs(s.az);
  const rz = s.hx * Math.abs(s.az) + s.hz * Math.abs(s.ax);
  return new Box3(
    new Vector3(s.cx - rx, s.cy - s.hy, s.cz - rz),
    new Vector3(s.cx + rx, s.cy + s.hy, s.cz + rz),
  );
}

const park = buildHeadlessPark();
park.scene.updateMatrixWorld(true);

const masonry: Slab[] = [];
const pickets: { name: string; slabs: Slab[] }[] = [];
park.scene.traverse((n: Object3D) => {
  if (!(n instanceof Mesh)) return;
  if (n.name === 'boundary-blocks') masonry.push(...slabsOf(n));
  if (n.parent?.name === 'rail-fence') pickets.push({ name: n.name || n.type, slabs: slabsOf(n) });
});

process.stdout.write(`seed ${PARK_SEED}: ${masonry.length} wall slabs\n`);
const masonryBoxes = masonry.map(aabbOf);
for (const group of pickets) {
  let aabbHits = 0;
  let exactHits = 0;
  let worst = '';
  for (const p of group.slabs) {
    const pb = aabbOf(p);
    for (let i = 0; i < masonry.length; i += 1) {
      if (!pb.intersectsBox(masonryBoxes[i] as Box3)) continue;
      aabbHits += 1;
      if (!overlaps(p, masonry[i] as Slab)) continue;
      exactHits += 1;
      if (!worst) worst = `(${p.cx.toFixed(2)}, ${p.cy.toFixed(2)}, ${p.cz.toFixed(2)})`;
    }
  }
  process.stdout.write(
    `  ${group.name} (${group.slabs.length}): AABB says ${aabbHits}, exact says ${exactHits}` +
      `${worst ? ` e.g. ${worst}` : ''}\n`,
  );
}
