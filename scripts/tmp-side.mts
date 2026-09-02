import { Vector3 } from 'three';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
const route = TRAIN_PLAN.route;
const point = new Vector3();
const tangent = new Vector3();
const rows = process.argv.slice(2).join(' ');
const pts = [...rows.matchAll(/\(([-\d.]+), ([-\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
const tally = new Map<number, number>();
for (const [x, z] of pts) {
  const d = route.distanceNear(x, z);
  route.pointAt(d, point);
  route.tangentAt(d, tangent);
  const side = Math.sign(tangent.z * (x - point.x) - tangent.x * (z - point.z)) || 1;
  tally.set(side, (tally.get(side) ?? 0) + 1);
}
console.log('stranded by rail side:', [...tally.entries()].map(([s, n]) => `${s}:${n}`).join(' '), 'of', pts.length);
