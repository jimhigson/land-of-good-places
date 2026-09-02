/**
 * Probe: what is the pale flat slab standing near the park entrance?
 *
 * Builds the real park headlessly and lists every mesh whose world-space
 * bounding box lies near the gate, with its size, its ancestry (so the builder
 * that made it is named) and its material colour.
 */
import { buildHeadlessPark } from './park-harness.mts';
import { Box3, Mesh, Vector3, type Object3D, type Material } from 'three';

const park = buildHeadlessPark();

const CENTRE_X = Number(process.argv[2] ?? 0);
const CENTRE_Z = Number(process.argv[3] ?? 55);
const RADIUS = Number(process.argv[4] ?? 18);

interface Row {
  path: string;
  name: string;
  size: Vector3;
  centre: Vector3;
  min: Vector3;
  max: Vector3;
  colour: string;
  geom: string;
}

const rows: Row[] = [];
const box = new Box3();

function ancestry(o: Object3D): string {
  const parts: string[] = [];
  let cur: Object3D | null = o;
  while (cur) {
    parts.unshift(cur.name || `<${cur.type}>`);
    cur = cur.parent;
  }
  return parts.join(' / ');
}

function colourOf(m: Material | Material[] | undefined): string {
  const one = Array.isArray(m) ? m[0] : m;
  const c = (one as unknown as { color?: { getHexString(): string } })?.color;
  return c ? `#${c.getHexString()}` : '(none)';
}

park.scene.updateMatrixWorld(true);
park.scene.traverse((o) => {
  if (!(o instanceof Mesh)) return;
  if (!o.geometry) return;
  box.setFromObject(o, true);
  if (box.isEmpty()) return;
  const centre = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  // Ignore huge things (terrain, boundary spline) that merely span the area.
  if (Math.max(size.x, size.z) > 40) return;
  if (Math.hypot(centre.x - CENTRE_X, centre.z - CENTRE_Z) > RADIUS) return;
  rows.push({
    path: ancestry(o),
    name: o.name,
    size,
    centre,
    min: box.min.clone(),
    max: box.max.clone(),
    colour: colourOf(o.material as Material | Material[]),
    geom: o.geometry.type,
  });
});

rows.sort((a, b) => b.size.y - a.size.y);

const f = (v: Vector3) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;
process.stdout.write(`meshes near (${CENTRE_X}, ${CENTRE_Z}) r=${RADIUS}: ${rows.length}\n\n`);
for (const r of rows) {
  process.stdout.write(
    `h=${r.size.y.toFixed(2)} size=${f(r.size)} centre=${f(r.centre)} ` +
      `y=[${r.min.y.toFixed(2)}..${r.max.y.toFixed(2)}] ${r.colour} ${r.geom}\n    ${r.path}\n`,
  );
}
