/**
 * Prints a fingerprint of the ginormous slide's solved route, plus the comfort
 * numbers that decide whether a six-year-old enjoys it.
 *
 * Two jobs, deliberately in one script:
 *
 * 1. **The fingerprint** proves a refactor did not move the ride. Same trick as
 *    `fingerprint-cruiser.mts`: a SHA256 over densely sampled points, alongside
 *    the segment count, the length and the exit pose. A refactor that claims to
 *    be behaviour-free must not change a single line of this output.
 * 2. **The comfort numbers** — tightest turn radius, peak lateral g, and where
 *    on the ride they happen — are the evidence for whether moving the parapet
 *    gap is worth doing. Lateral load is v²/r, so the radius is only meaningful
 *    next to the speed.
 *
 * Curvature is measured off the **built** curve by fitting a circle through
 * three consecutive samples, not read out of the generator's own minimum. The
 * generator reports the tightest piece it *chose*; what a rider feels is the
 * tightest place the finished curve actually goes, and those are not the same
 * number once segments have been joined.
 *
 * `LGP_SEED=n npm run measure:slide-fingerprint` for any seed.
 */
import { createHash } from 'node:crypto';
import { GIANT_SLIDE_SPEED, SLIDE_PLAN } from '../src/world/slide/plan';
import { PARK_SEED } from '../src/world/parkManifest';

const G = 9.81;

const route = SLIDE_PLAN.route;
const report = route.report;

/** Radius of the circle through three points; Infinity when they are collinear. */
function circumRadius(
  ax: number, az: number,
  bx: number, bz: number,
  cx: number, cz: number,
): number {
  const a = Math.hypot(bx - cx, bz - cz);
  const b = Math.hypot(ax - cx, az - cz);
  const c = Math.hypot(ax - bx, az - bz);
  // Twice the signed area of the triangle.
  const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  if (Math.abs(cross) < 1e-9) return Infinity;
  return (a * b * c) / (2 * Math.abs(cross));
}

// ---------------------------------------------------------------- fingerprint

const hash = createHash('sha256');
const flat = { x: 0, z: 0 };
for (let i = 0; i < 4000; i += 1) {
  route.pointAt((i / 4000) * route.length, flat);
  hash.update(`${flat.x.toFixed(6)},${flat.z.toFixed(6)};`);
}

// The 3D chute is what actually gets built and ridden, so it is fingerprinted
// separately: a change that moved only the height profile would not show up in
// the plan-view hash at all.
const chuteHash = createHash('sha256');
for (const point of SLIDE_PLAN.points) {
  chuteHash.update(`${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z.toFixed(6)};`);
}

// ------------------------------------------------------------------- comfort

// Sample the plan-view centre line finely and fit a circle to every consecutive
// triple. Half a metre resolves a 5 m bend comfortably without amplifying the
// float noise a much tighter spacing would.
const STEP = 0.5;
const samples: { x: number; z: number; d: number }[] = [];
for (let d = 0; d <= route.length; d += STEP) {
  route.pointAt(d, flat);
  samples.push({ x: flat.x, z: flat.z, d });
}

let tightest = Infinity;
let tightestAt = 0;
for (let i = 1; i < samples.length - 1; i += 1) {
  const p = samples[i - 1]!;
  const q = samples[i]!;
  const r = samples[i + 1]!;
  const radius = circumRadius(p.x, p.z, q.x, q.z, r.x, r.z);
  if (radius < tightest) {
    tightest = radius;
    tightestAt = q.d;
  }
}

// Height at the tightest bend, read off the built chute rather than recomputed
// from the height formula — the point of measuring the thing that was built.
const alongFraction = tightestAt / route.length;
const pointIndex = Math.min(
  SLIDE_PLAN.points.length - 1,
  Math.max(0, Math.round(alongFraction * (SLIDE_PLAN.points.length - 1))),
);
const altitude = SLIDE_PLAN.points[pointIndex]!.y;

const peakG = (GIANT_SLIDE_SPEED * GIANT_SLIDE_SPEED) / tightest / G;
const secondsIn = tightestAt / GIANT_SLIDE_SPEED;
const rideSeconds = route.length / GIANT_SLIDE_SPEED;

// --------------------------------------------------------------------- output

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
console.log('--- comfort ---');
console.log(`tightest radius  ${tightest.toFixed(2)} m`);
console.log(`  at             ${tightestAt.toFixed(2)} m along (${(alongFraction * 100).toFixed(1)}%)`);
console.log(`  altitude       ${altitude.toFixed(2)} m`);
console.log(`  seconds in     ${secondsIn.toFixed(2)} s of ${rideSeconds.toFixed(2)} s`);
console.log(`speed            ${GIANT_SLIDE_SPEED} m/s`);
console.log(`peak lateral g   ${peakG.toFixed(3)} g`);
