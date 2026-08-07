/**
 * A fingerprint of the ginormous slide's solved route, so a refactor can be
 * *proved* not to have moved it rather than argued not to have.
 *
 * Same trick as `fingerprint-cruiser.mts`, which proved the Sky Cruiser unmoved
 * across the rail-generator change: a SHA256 over densely sampled points,
 * alongside the segment count, the length and the exit pose. A change that
 * claims to be behaviour-free must not alter a single line of this output on
 * any seed.
 *
 * Two hashes, deliberately. The plan-view route is what the search solves; the
 * 3D chute is what actually gets built and ridden. A change that moved only the
 * height profile would leave the first untouched, so hashing the route alone
 * would quietly under-report.
 *
 * **A fingerprint is only a proof once you have watched it fail.** Before
 * trusting a matching hash, break something on purpose and confirm it moves —
 * a fingerprint computed over the wrong thing reports "identical" forever, and
 * that is the failure this codebase keeps producing.
 *
 * Comfort numbers — tightest bend, lateral g, where on the ride they land —
 * live in `measure-slide-comfort.mts` and are deliberately not duplicated here.
 *
 * `LGP_SEED=n npm run measure:slide-fingerprint` for any seed.
 */
import { createHash } from 'node:crypto';
import { SLIDE_PLAN } from '../src/world/slide/plan';
import { PARK_SEED } from '../src/world/parkManifest';

const route = SLIDE_PLAN.route;
const report = route.report;

const hash = createHash('sha256');
const flat = { x: 0, z: 0 };
for (let i = 0; i < 4000; i += 1) {
  route.pointAt((i / 4000) * route.length, flat);
  hash.update(`${flat.x.toFixed(6)},${flat.z.toFixed(6)};`);
}

const chuteHash = createHash('sha256');
for (const point of SLIDE_PLAN.points) {
  chuteHash.update(`${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z.toFixed(6)};`);
}

console.log(`seed             ${PARK_SEED}`);
console.log(`plan length      ${route.length.toFixed(4)}`);
console.log(`plan segments    ${route.segments.length}`);
console.log(`plan minCurv     ${route.minCurvature.toFixed(4)}`);
console.log(`chute points     ${SLIDE_PLAN.points.length}`);
console.log(`startY / endY    ${SLIDE_PLAN.startY.toFixed(4)} / ${SLIDE_PLAN.endY.toFixed(4)}`);
console.log(`exit             ${SLIDE_PLAN.exitX.toFixed(4)}, ${SLIDE_PLAN.exitZ.toFixed(4)}`);
console.log(
  `facade door      ${SLIDE_PLAN.facadeDoorMinX.toFixed(4)} .. ${SLIDE_PLAN.facadeDoorMaxX.toFixed(4)}`,
);
console.log(
  `roof door        ${SLIDE_PLAN.roofDoorMinX.toFixed(4)} .. ${SLIDE_PLAN.roofDoorMaxX.toFixed(4)}`,
);
console.log(`roof entry       ${SLIDE_PLAN.entryX.toFixed(4)}, ${SLIDE_PLAN.entryZ.toFixed(4)}`);
console.log(
  `report           startPoseIndex=${report.startPoseIndex}/${report.startPoseCount} ` +
    `segs=${report.segmentCount} minRadius=${report.minRadius.toFixed(4)} ` +
    `backtracks=${report.backtracks} candidates=${report.candidatesTried}`,
);
console.log(`ROUTE SHA256     ${hash.digest('hex')}`);
console.log(`CHUTE SHA256     ${chuteHash.digest('hex')}`);
