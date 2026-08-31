/**
 * The drawn `gate-approach` ribbon's control points, with the authored gate
 * landmarks beside them — for seeing where the walk in from the gate jogs off
 * the corridor and why. Not used by the game.
 */
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { ROUTES } from '../src/world/pathGraph.ts';
import { ENTRANCE_GATE_X, ENTRANCE_GATE_Z } from '../src/world/entrance/layout.ts';
import { PLAZA } from '../src/world/paths.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';

buildHeadlessPark();
const edge = ROUTES.find((r) => r.name === 'gate-approach');
console.log(`seed ${PARK_SEED}: gate arch (${ENTRANCE_GATE_X}, ${ENTRANCE_GATE_Z}), plaza (${PLAZA.x.toFixed(2)}, ${PLAZA.z.toFixed(2)}), loop ${TRAIN_PLAN.route.length.toFixed(1)} m`);
if (!edge) { console.log('no gate-approach drawn'); process.exit(0); }
let along = 0;
edge.points.forEach((p, i) => {
  const prev = edge.points[i - 1];
  if (prev) along += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
  const seg = prev ? `  ${Math.abs(p[0] - prev[0]) < 0.01 ? 'N-S' : Math.abs(p[1] - prev[1]) < 0.01 ? 'E-W' : 'diag'} ${Math.hypot(p[0] - prev[0], p[1] - prev[1]).toFixed(1)} m` : '';
  console.log(`  [${String(i).padStart(2)}] (${p[0].toFixed(2)}, ${p[1].toFixed(2)})  along ${along.toFixed(1)}${seg}`);
});

// The railway along the gate's own line, and where the walk's own side sits.
const route = TRAIN_PLAN.route;
const { Vector3 } = await import('three');
const at = new Vector3();
const tangent = new Vector3();
const sideAt = (x: number, z: number): number => {
  const d = route.distanceNear(x, z);
  route.pointAt(d, at);
  route.tangentAt(d, tangent);
  return Math.sign(tangent.z * (x - at.x) - tangent.x * (z - at.z)) || 1;
};
const gap = (x: number, z: number): number => {
  route.pointAt(route.distanceNear(x, z), at);
  return Math.hypot(x - at.x, z - at.z);
};
console.log('\nthe railway along x = 0, arch (z=60) inward:');
let previous = sideAt(0, 60);
for (let z = 60; z >= -60; z -= 1) {
  const s = sideAt(0, z);
  if (s !== previous) console.log(`  side flips at z = ${z.toFixed(0)}, railGap ${gap(0, z).toFixed(1)}`);
  previous = s;
}
console.log(`  side at the arch (0,60): ${sideAt(0, 60)}; at the mouth (0,47.8): ${sideAt(0, 47.8)}; at the plaza: ${sideAt(PLAZA.x, PLAZA.z)}`);
console.log(`  railGap at (0,54) ${gap(0, 54).toFixed(1)}, (0,47.8) ${gap(0, 47.8).toFixed(1)}, (0,40) ${gap(0, 40).toFixed(1)}, (0,30) ${gap(0, 30).toFixed(1)}`);
