/**
 * Why does this seed's loop prove so few bridge sites?
 *
 * Marches the whole loop at the planner's own `MARCH_STEP` and, for every
 * candidate rail distance, reports through the planner's own
 * `explainBridgeRefusal` which gate closed. Groups the answers so the shape of
 * the refusal is visible rather than 170 lines of detail.
 *
 * CONTROL: the sites the planner actually kept must come back FEASIBLE here. If
 * a kept site reads as refused, this diagnostic is asking a different question
 * from the planner and nothing it says may be believed.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';

const seed = process.env['LGP_SEED'] ?? 'default(canonical)';
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');
const solve = await import('../src/world/train/crossingPlanSolve.ts');
const { CROSSING_SITES } = await import('../src/world/train/crossingPlan.ts');

const route = TRAIN_PLAN.route;
console.log(`seed ${seed}: loop ${route.length.toFixed(1)} m, ${CROSSING_SITES.length} sites kept`);

const feasibleAt: number[] = [];
const reasons = new Map<string, number>();
const bump = (r: string) => reasons.set(r, (reasons.get(r) ?? 0) + 1);

for (let d = 0; d < route.length; d += 2) {
  const lines = solve.explainBridgeRefusal(d);
  if (lines.some((l) => l.includes('-- OK'))) {
    feasibleAt.push(d);
    continue;
  }
  if (lines[0]?.includes("station's window")) bump('inside a station window');
  else if (lines.every((l, i) => i === 0 || l.includes('DECK BLOCKED'))) bump('deck blocked at every width and angle');
  else if (lines.some((l) => l.includes('DECK BLOCKED'))) bump('deck blocked at some widths, ramp short at the rest');
  else bump('ramp reach SHORT at every width and angle');
}

const total = Math.ceil(route.length / 2);
console.log(`\n${feasibleAt.length} of ${total} marched points are FEASIBLE for a bridge:`);
if (feasibleAt.length) {
  // Collapse runs of consecutive feasible distances into spans.
  const spans: [number, number][] = [];
  let start = feasibleAt[0] as number;
  let previous = start;
  for (const d of feasibleAt.slice(1)) {
    if (d - previous > 2.5) {
      spans.push([start, previous]);
      start = d;
    }
    previous = d;
  }
  spans.push([start, previous]);
  const point = new Vector3();
  for (const [a, b] of spans) {
    route.pointAt((a + b) / 2, point);
    console.log(
      `  railD ${a.toFixed(0)}-${b.toFixed(0)} (${(b - a + 2).toFixed(0)} m) around (${point.x.toFixed(1)}, ${point.z.toFixed(1)})`,
    );
  }
}
console.log('\nwhy the rest were refused:');
for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${reason}`);
}

console.log('\nthe sites the planner kept:');
for (const s of CROSSING_SITES) {
  console.log(`  railD ${s.railDistance.toFixed(1)} at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) halfWidth ${s.halfWidth.toFixed(2)}`);
}

// CONTROL — a kept site must read feasible through this same explainer.
let controlOk = true;
for (const s of CROSSING_SITES) {
  const ok = solve.explainBridgeRefusal(s.railDistance).some((l) => l.includes('-- OK'));
  if (!ok) controlOk = false;
  console.log(`  control: kept site at railD ${s.railDistance.toFixed(1)} reads ${ok ? 'FEASIBLE' : 'REFUSED — DIAGNOSTIC IS VOID'}`);
}
console.log(
  controlOk
    ? '\nCONTROL PASSED — this diagnostic asks the planner its own question.'
    : '\nCONTROL FAILED — VOID.',
);
