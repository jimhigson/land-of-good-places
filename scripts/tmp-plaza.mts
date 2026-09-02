import { Vector3 } from 'three';
import { PLAZA, debugGridReach } from '../src/world/paths.ts';
import { PATH_GRAPH } from '../src/world/pathGraph.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
void debugGridReach;
const route = TRAIN_PLAN.route;
const point = new Vector3();
const tangent = new Vector3();
const side = (x: number, z: number): number => {
  const d = route.distanceNear(x, z);
  route.pointAt(d, point);
  route.tangentAt(d, tangent);
  return Math.sign(tangent.z * (x - point.x) - tangent.x * (z - point.z)) || 1;
};
console.log('plaza', PLAZA.x.toFixed(1), PLAZA.z.toFixed(1), 'side', side(PLAZA.x, PLAZA.z));
console.log('gate side', side(0, 54));
for (const e of PATH_GRAPH.edges) {
  if (!e.paved) { console.log('UNPAVED EDGE', e.route.name); continue; }
  const sides = new Set(e.route.points.map(([x, z]) => side(x, z)));
  if (sides.size > 1) console.log('spans rail:', e.route.name);
}
