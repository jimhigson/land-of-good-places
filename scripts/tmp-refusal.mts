/** TEMP diagnostic: why the crossing planner refuses a bridge where the gate
 * corridor meets the loop. Control: the same report at a rail distance that
 * DID become a site must read OK. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
import { explainBridgeRefusal } from '../src/world/train/crossingPlanSolve.ts';
import { Vector3 } from 'three';
quietly(() => buildHeadlessPark());
const route = TRAIN_PLAN.route;
const p = new Vector3();
// the rail distance nearest the gate corridor's own line
const target = route.distanceNear(0, 41);
for (const d of [target, ...process.argv.slice(2).map(Number)]) {
  route.pointAt(d, p);
  console.log(`--- railD=${d.toFixed(1)} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
  for (const line of explainBridgeRefusal(d)) console.log('   ', line);
}
