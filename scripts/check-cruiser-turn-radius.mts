/**
 * Does the **built** Sky Cruiser curve honour the turning radius its plan
 * promised?
 *
 * The plan is a chain of cubics whose radii the generator validates directly.
 * `CoasterRoute` then resamples that plan into control points and rebuilds it
 * as a `CatmullRomCurve3` — and a rebuild is not a copy. The spline through
 * sampled points is not the curve the points were sampled from, and what it
 * loses it loses at the tightest bends, which are exactly the ones under a
 * limit.
 *
 * That is the same shape of mistake this generator replaced: the old solver
 * pushed its control points clear of the castle and then smoothed them, so the
 * built curve did not respect what had been validated. Validating the plan and
 * shipping the rebuild is that bug one layer down.
 *
 * So this measures the thing riders are actually on. Menger curvature over
 * three points at a fixed arc spacing, horizontal only — turning radius is a
 * plan-view notion and the hills do not change it.
 */
import { Vector3 } from 'three';

const SPACING = 2.5;

function mengerRadius(a: Vector3, b: Vector3, c: Vector3): number {
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
  if (area < 1e-9) return Infinity;
  return (ab * bc * ca) / (4 * area);
}

const { COASTER_PLANS } = await import('../src/world/coaster/plan.ts');
const { MIN_TURN_RADIUS } = await import('../src/world/coaster/route.ts');
const route = COASTER_PLANS.cruiser.route;

const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
let built = Infinity;
let at = 0;
for (let d = 0; d < route.length; d += 0.5) {
  route.pointAt(d - SPACING, a);
  route.pointAt(d, b);
  route.pointAt(d + SPACING, c);
  const radius = mengerRadius(a, b, c);
  if (radius < built) {
    built = radius;
    at = d;
  }
}

const planned = route.plan.minCurvature;
const ok = built >= MIN_TURN_RADIUS;
console.log(
  `check:cruiser-turn-radius: plan ${planned.toFixed(2)} m, built ${built.toFixed(2)} m ` +
    `at ${at.toFixed(0)} m along, limit ${MIN_TURN_RADIUS} m — ${ok ? 'holds' : 'FAILS'} ` +
    `(rebuild cost ${(planned - built).toFixed(2)} m)`,
);
if (!ok) {
  console.error(
    `check:cruiser-turn-radius: the built curve turns tighter than the ${MIN_TURN_RADIUS} m ` +
      `this ride promises. Validating the plan is not enough — the resampling into ` +
      `control points has to keep the promise too.`,
  );
  process.exitCode = 1;
}
