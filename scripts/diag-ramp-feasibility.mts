/**
 * **If the downhill ramp run were sized honestly, how many bridge sites would
 * still prove?**
 *
 * The question that decides whether the ramp-grade fix is a multi-round change
 * worth taking or a ticket to hand over. Roughly doubling the required run on
 * the downhill side shrinks the set of loop points that admit a bridge — and
 * seed 451 already proves only 2 of 175. A seed that proves **zero** has no way
 * over its own railway and `crossingPlanSolve.ts` throws the park away.
 *
 * Measured through the planner's own `explainBridgeRefusal`, so "feasible today"
 * is the planner's own verdict rather than a reimplementation of it. The
 * terrain-aware verdict re-uses the reaches that same call reports, and only
 * changes the bar they are held to.
 *
 * CONTROL: the count of today-feasible points must match what
 * `diag-sites-sweep.mts` reports independently, and the terrain-aware count can
 * never exceed it (the bar only ever rises). Both are asserted below.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';

const seed = process.env['LGP_SEED'] ?? 'default(canonical)';
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');
const solve = await import('../src/world/train/crossingPlanSolve.ts');
const { CROSSING_SITES } = await import('../src/world/train/crossingPlan.ts');
const { BRIDGE_RISE, DECK_HALF_LENGTH } = await import('../src/world/train/clearance.ts');
const { MAX_RAMP_GRADIENT, MIN_RAMP_RUN, MIN_BRIDGE_HALF_LENGTH } = await import(
  '../src/world/train/bridgeFootprint.ts'
);
const { terrainHeight } = await import('../src/world/terrain.ts');

const route = TRAIN_PLAN.route;
const point = new Vector3();
const tangent = new Vector3();

/** The run this side really needs, given the reach it achieved. */
const neededRun = (x: number, z: number, dx: number, dz: number, side: 1 | -1, reach: number): number => {
  const here = terrainHeight(x, z);
  const footX = x + dx * side * (DECK_HALF_LENGTH + reach);
  const footZ = z + dz * side * (DECK_HALF_LENGTH + reach);
  const fall = Math.max(0, here - terrainHeight(footX, footZ));
  return Math.max(MIN_RAMP_RUN, (BRIDGE_RISE + fall) / MAX_RAMP_GRADIENT + 0.5);
};

let todayFeasible = 0;
let terrainFeasible = 0;
let marched = 0;
const worstNeeded: number[] = [];
for (let d = 0; d < route.length; d += 2) {
  marched += 1;
  const lines = solve.explainBridgeRefusal(d);
  const ok = lines.filter((l) => l.includes('-- OK'));
  if (ok.length === 0) continue;
  todayFeasible += 1;
  route.pointAt(d, point);
  route.tangentAt(d, tangent);
  // `sidePlusDirection`: perpendicular to the tangent. The small angle offsets
  // the planner also tries move this by at most 45 deg and are ignored here —
  // which can only make this MORE optimistic, never less, so a zero it reports
  // is a real zero.
  const dx = tangent.z;
  const dz = -tangent.x;
  let anySurvives = false;
  for (const line of ok) {
    const m = /reach ([\d.]+)\/([\d.]+)/.exec(line);
    if (!m) continue;
    const pos = Number(m[1]);
    const neg = Number(m[2]);
    const needPos = neededRun(point.x, point.z, dx, dz, 1, pos);
    const needNeg = neededRun(point.x, point.z, dx, dz, -1, neg);
    worstNeeded.push(Math.max(needPos, needNeg));
    if (pos >= needPos && neg >= needNeg) anySurvives = true;
  }
  if (anySurvives) terrainFeasible += 1;
}

const longest = worstNeeded.length ? Math.max(...worstNeeded) : 0;
console.log(
  `seed ${seed}: loop ${route.length.toFixed(0)} m, ${marched} points marched, ` +
    `${CROSSING_SITES.length} site(s) kept today`,
);
console.log(
  `  feasible TODAY (flat floor ${MIN_RAMP_RUN.toFixed(1)} m):        ${todayFeasible}`,
);
console.log(
  `  feasible with an HONEST downhill run:            ${terrainFeasible}` +
    `${terrainFeasible === 0 ? '   <-- ZERO: park would have no way over its railway' : ''}`,
);
console.log(
  `  longest run the honest rule would demand here:   ${longest.toFixed(1)} m ` +
    `(flat rule demands ${MIN_RAMP_RUN.toFixed(1)} m)`,
);
console.log(
  `  two-bridge spacing: MIN_BRIDGE_HALF_LENGTH ${MIN_BRIDGE_HALF_LENGTH.toFixed(1)} m today, ` +
    `so 2x = ${(MIN_BRIDGE_HALF_LENGTH * 2).toFixed(1)} m between bridges; ` +
    `honest would be ${(DECK_HALF_LENGTH + longest).toFixed(1)} m each, 2x = ${((DECK_HALF_LENGTH + longest) * 2).toFixed(1)} m`,
);
if (terrainFeasible > todayFeasible) {
  console.log('  CONTROL FAILED: the bar only ever rises, so this cannot exceed the flat count — VOID');
}
