/** TEMP diagnostic: is the park gate on the same side of the loop as the park
 * centre, and did the second-tier gate pass add a site on this seed? */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { CROSSING_SITES, railSideOf } from '../src/world/train/crossingPlan.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
quietly(() => buildHeadlessPark());
const route = TRAIN_PLAN.route;
const gateD = route.distanceNear(0, 54);
const alongLoop = (a: number, b: number): number =>
  Math.abs(route.wrap(a - b + route.length / 2) - route.length / 2);
const near = CROSSING_SITES.filter((s) => alongLoop(s.railDistance, gateD) < 24);
console.log(
  `gateSide=${railSideOf(0, 54)} centreSide=${railSideOf(0, 0)} sites=${CROSSING_SITES.length} nearGate=${near.length} ` +
    near.map((s) => `railD=${s.railDistance.toFixed(0)}@(${s.x.toFixed(1)},${s.z.toFixed(1)}) reach=${s.rampReachPos.toFixed(1)}/${s.rampReachNeg.toFixed(1)}`).join(' '),
);
