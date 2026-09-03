/**
 * Instrument for issue #480: every torus/tube-ish mesh in the built park,
 * with its world bounding box and its distance from the park boundary.
 *
 * Control: it also prints the total mesh count it walked and how many of them
 * were torus/tube, so a run that found nothing can be told apart from a run
 * that walked nothing.
 */
import { Box3, Mesh, Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';

const park = quietly(() => buildHeadlessPark());

let meshes = 0;
let torusLike = 0;
const rows: string[] = [];
const box = new Box3();
const size = new Vector3();
const centre = new Vector3();

park.scene.updateMatrixWorld(true);
park.scene.traverse((o) => {
  if (!(o instanceof Mesh)) return;
  meshes += 1;
  const type = o.geometry.type;
  if (!/Torus|Tube|Lathe/.test(type)) return;
  torusLike += 1;
  box.setFromObject(o, true);
  if (!isFinite(box.min.x)) return;
  box.getSize(size);
  box.getCenter(centre);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim < 1.5) return; // tiny rims, collars, keyrings
  rows.push(
    [
      (o.name || '(unnamed)').padEnd(28),
      type.padEnd(14),
      `centre ${centre.x.toFixed(2)},${centre.y.toFixed(2)},${centre.z.toFixed(2)}`.padEnd(34),
      `size ${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}`.padEnd(28),
      `min ${box.min.x.toFixed(2)},${box.min.y.toFixed(2)},${box.min.z.toFixed(2)}`,
      ` max ${box.max.x.toFixed(2)},${box.max.y.toFixed(2)},${box.max.z.toFixed(2)}`,
    ].join(' '),
  );
});

rows.sort();
for (const r of rows) console.log(r);
console.log(`\nwalked ${meshes} meshes; ${torusLike} torus/tube/lathe; ${rows.length} of them >= 1.5 m`);
