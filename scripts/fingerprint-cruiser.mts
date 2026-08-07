/**
 * Prints a fingerprint of the Sky Cruiser's solved route, so a change to the
 * shared generator can be proved not to have moved it.
 */
import { createHash } from 'node:crypto';
import { Vector3 } from 'three';
import { COASTER_PLANS } from '../src/world/coaster/plan';

const route = COASTER_PLANS.cruiser.route;
const plan = route.plan;

const hash = createHash('sha256');
const p = new Vector3();
for (let i = 0; i < 4000; i += 1) {
  route.pointAt((i / 4000) * route.length, p);
  hash.update(`${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)};`);
}

console.log(`plan length      ${plan.length.toFixed(4)}`);
console.log(`plan segments    ${plan.segments.length}`);
console.log(`plan minCurv     ${plan.minCurvature.toFixed(4)}`);
console.log(`curve length     ${route.length.toFixed(4)}`);
console.log(`stationDistance  ${route.stationDistance.toFixed(4)}`);
console.log(`crestY           ${route.crestY.toFixed(4)}`);
console.log(`exit             ${COASTER_PLANS.cruiser.exitX.toFixed(4)}, ${COASTER_PLANS.cruiser.exitZ.toFixed(4)}`);
console.log(`report           startPoseIndex=${plan.report.startPoseIndex} segs=${plan.report.segmentCount} backtracks=${plan.report.backtracks} candidates=${plan.report.candidatesTried} closerAttempts=${plan.report.closerAttempts}`);
console.log(`CURVE SHA256     ${hash.digest('hex')}`);
