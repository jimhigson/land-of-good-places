import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { SEEDS } from '../src/entities/npc/poiGraph.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
quietly(() => buildHeadlessPark());
const route = TRAIN_PLAN.route;
const point = new Vector3();
const tangent = new Vector3();
const tally = new Map<number, number>();
for (const seed of SEEDS as readonly { x: number; z: number }[]) {
  const d = route.distanceNear(seed.x, seed.z);
  route.pointAt(d, point);
  route.tangentAt(d, tangent);
  const side = Math.sign(tangent.z * (seed.x - point.x) - tangent.x * (seed.z - point.z)) || 1;
  tally.set(side, (tally.get(side) ?? 0) + 1);
}
console.log('seeds by rail side:', [...tally.entries()].map(([s, n]) => `${s}:${n}`).join(' '), 'total', SEEDS.length);
