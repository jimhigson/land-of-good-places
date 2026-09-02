import { Vector3 } from 'three';
import { PATH_GRAPH } from '../src/world/pathGraph.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
const route = TRAIN_PLAN.route;
const point = new Vector3();
const tangent = new Vector3();
const side = (x: number, z: number): number => {
  const d = route.distanceNear(x, z);
  route.pointAt(d, point);
  route.tangentAt(d, tangent);
  return Math.sign(tangent.z * (x - point.x) - tangent.x * (z - point.z)) || 1;
};
for (const n of PATH_GRAPH.nodes) {
  console.log(`${n.id.padEnd(26)} (${n.x.toFixed(1)}, ${n.z.toFixed(1)}) side ${side(n.x, n.z)}`);
}
let paved = 0;
for (const e of PATH_GRAPH.edges) if (e.paved) paved += 1;
console.log('paved edges', paved, 'of', PATH_GRAPH.edges.length);
