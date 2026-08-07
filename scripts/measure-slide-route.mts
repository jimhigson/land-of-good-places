/** What did the ginormous slide actually solve to? Run per seed via LGP_SEED. */
import { Vector3 } from 'three';
import { SLIDE_PLAN } from '../src/world/slide/plan';
import { BALL_PIT_RADIUS, BALL_PIT_X, BALL_PIT_Z } from '../src/world/building/layout';

const f = (n: number): string => n.toFixed(2);
const plan = SLIDE_PLAN;
const r = plan.route;

console.log(`solved: ${r.segments.length} segments, ${f(r.length)} m, minCurvature ${f(r.minCurvature)}`);
console.log(
  `report: attempt ${r.report.startPoseIndex}/${r.report.startPoseCount}, backtracks ${r.report.backtracks}, candidates ${r.report.candidatesTried}, finisher tries ${r.report.closerAttempts}, ${r.report.elapsedMs} ms`,
);
console.log(
  `rejected: collision ${r.report.rejected.collision}, boundary ${r.report.rejected.boundary}, self ${r.report.rejected.selfClearance}, curvature ${r.report.rejected.curvature}`,
);

const start = plan.points[0] as Vector3;
const end = plan.points[plan.points.length - 1] as Vector3;
console.log(`\npoints: ${plan.points.length}`);
console.log(`start  (${f(start.x)}, ${f(start.y)}, ${f(start.z)})`);
console.log(`end    (${f(end.x)}, ${f(end.y)}, ${f(end.z)})`);
console.log(`startY ${f(plan.startY)}  endY ${f(plan.endY)}  drop ${f(plan.startY - plan.endY)}`);
console.log(`end -> pit centre ${f(Math.hypot(end.x - BALL_PIT_X, end.z - BALL_PIT_Z))} (pit radius ${BALL_PIT_RADIUS})`);
console.log(`exit   (${f(plan.exitX)}, ${f(plan.exitZ)})  -> pit ${f(Math.hypot(plan.exitX - BALL_PIT_X, plan.exitZ - BALL_PIT_Z))}`);

let rises = 0;
let worstRise = 0;
for (let i = 1; i < plan.points.length; i += 1) {
  const a = plan.points[i - 1] as Vector3;
  const b = plan.points[i] as Vector3;
  if (b.y > a.y) {
    rises += 1;
    worstRise = Math.max(worstRise, b.y - a.y);
  }
}
console.log(`\ncontrol points that rise: ${rises}, worst ${f(worstRise)} m`);

// Steepest gradient, as a rider experiences it.
let steepest = 0;
for (let i = 1; i < plan.points.length; i += 1) {
  const a = plan.points[i - 1] as Vector3;
  const b = plan.points[i] as Vector3;
  const run = Math.hypot(b.x - a.x, b.z - a.z);
  if (run > 0.01) steepest = Math.max(steepest, Math.abs(b.y - a.y) / run);
}
console.log(`steepest gradient ${f(steepest)} (${f((Math.atan(steepest) * 180) / Math.PI)} deg)`);
console.log(`lateral g at 8 m/s on tightest turn: ${f(64 / r.minCurvature / 9.81)} g`);

console.log('\n=== path (every 3rd point) ===');
for (let i = 0; i < plan.points.length; i += 3) {
  const p = plan.points[i] as Vector3;
  console.log(`  ${String(i).padStart(3)} (${f(p.x).padStart(7)}, ${f(p.y).padStart(6)}, ${f(p.z).padStart(7)})`);
}
