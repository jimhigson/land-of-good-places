/** Is a trestle leg's collider at its foot, and how far is that from the instance centre? */
import './headless-canvas.mjs';
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';

const park = buildHeadlessPark();
const circles: { x: number; z: number; radius: number }[] = [];
park.world.collision.forEachCircle((x, z, radius) => circles.push({ x, z, radius }));

const matrix = new Matrix4();
const centre = new Vector3();
const axis = new Vector3();
const scale = new Vector3();
let worstDrift = 0;
let centreMisses = 0;
let footMisses = 0;
let legs = 0;

park.scene.traverse((object) => {
  const mesh = object as InstancedMesh;
  if (!mesh.isInstancedMesh || mesh.name !== 'railRace:trestle-legs') return;
  // Only the walk-past ring registers colliders; try both and report per ring.
  for (let i = 0; i < mesh.count; i += 1) {
    mesh.getMatrixAt(i, matrix);
    centre.setFromMatrixPosition(matrix);
    matrix.decompose(new Vector3(), new Quaternion(), scale);
    axis.setFromMatrixColumn(matrix, 1).normalize();
    const foot = centre.clone().addScaledVector(axis, -scale.y / 2);
    const nearCentre = circles.some((c) => Math.hypot(c.x - centre.x, c.z - centre.z) < c.radius);
    const nearFoot = circles.some((c) => Math.hypot(c.x - foot.x, c.z - foot.z) < c.radius);
    const drift = Math.hypot(centre.x - foot.x, centre.z - foot.z);
    legs += 1;
    worstDrift = Math.max(worstDrift, drift);
    if (!nearCentre) centreMisses += 1;
    if (!nearFoot) footMisses += 1;
  }
});

console.log(
  `legs ${legs}; worst horizontal drift centre-vs-foot ${worstDrift.toFixed(2)} m; ` +
    `no collider under the instance centre: ${centreMisses}; no collider under the foot: ${footMisses}`,
);
