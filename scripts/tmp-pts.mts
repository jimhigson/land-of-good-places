import { Vector3 } from 'three';
import { PATH_GRAPH } from '../src/world/pathGraph.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
const route = TRAIN_PLAN.route;
const point = new Vector3();
const tangent = new Vector3();
const info = (x: number, z: number) => {
  const d = route.distanceNear(x, z);
  route.pointAt(d, point);
  route.tangentAt(d, tangent);
  return { side: Math.sign(tangent.z * (x - point.x) - tangent.x * (z - point.z)) || 1, dist: Math.hypot(point.x - x, point.z - z) };
};
for (const name of process.argv.slice(2)) {
  const e = PATH_GRAPH.edges.find((q) => q.route.name === name);
  if (!e) { console.log('no route', name); continue; }
  console.log(name, e.route.points.map(([x, z]) => { const i = info(x, z); return `(${x.toFixed(1)},${z.toFixed(1)})s${i.side}d${i.dist.toFixed(1)}`; }).join(' '));
}
