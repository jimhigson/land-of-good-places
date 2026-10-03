/**
 * Diagnostic: is there a feasible bridge candidate on the loop near the
 * gate radial (railD 0 on the canonical seed), and if so why was it not
 * kept as a site?
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';

const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');
const solve = await import('../procgen/world/train/crossingPlanSolve.ts');
const { CROSSING_SITES } = await import('../src/world/train/crossingPlan.ts');
const { ENTRANCE_GATE_X, ENTRANCE_GATE_Z, isInEntranceGateway } = await import(
  '../src/world/entrance/layout.ts'
);

const route = TRAIN_PLAN.route;
console.log(`loop ${route.length.toFixed(1)} m; gate (${ENTRANCE_GATE_X.toFixed(1)}, ${ENTRANCE_GATE_Z.toFixed(1)})`);

// Where on the loop is the point nearest the gate?
const nearGate = route.distanceNear(ENTRANCE_GATE_X, ENTRANCE_GATE_Z);
const np = route.pointAt(nearGate, new Vector3());
console.log(
  `nearest loop point to the gate: railD ${nearGate.toFixed(1)} at (${np.x.toFixed(1)}, ${np.z.toFixed(1)}), ` +
    `${Math.hypot(np.x - ENTRANCE_GATE_X, np.z - ENTRANCE_GATE_Z).toFixed(1)} m from the arch`,
);
console.log(`isInEntranceGateway(rail point) = ${isInEntranceGateway(np.x, np.z)}`);

console.log('\n-- kept sites within 60 m of railD 0 --');
for (const s of CROSSING_SITES) {
  const along = Math.abs(route.wrap(s.railDistance - nearGate + route.length / 2) - route.length / 2);
  if (along <= 60) console.log(`  railD ${s.railDistance.toFixed(1)} — ${along.toFixed(1)} m along from the gate radial`);
}

console.log('\n-- refusal explanation along the loop near the gate --');
for (let k = -20; k <= 20; k += 2) {
  const d = route.wrap(nearGate + k);
  const lines = solve.explainBridgeRefusal(d);
  const head = lines[0] ?? '';
  const ok = lines.some((l) => l.includes('-- OK'));
  const best = lines.find((l) => l.includes('-- OK')) ?? lines.slice(1).sort()[0] ?? '';
  console.log(`  ${head} ${ok ? 'FEASIBLE' : 'refused'} | ${best.trim()}`);
}
