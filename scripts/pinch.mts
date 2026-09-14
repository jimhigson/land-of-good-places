import './headless-canvas.mjs';
import { Vector3 } from 'three';
const { buildHeadlessPark } = await import('./park-harness.mts');
try { buildHeadlessPark(); } catch { /* expected */ }
const { TRAIN_PLAN, RAIL_CORRIDOR_CLEARANCE } = await import('../src/world/train/plan.ts');
const route = TRAIN_PLAN.route;
const p = new Vector3();
// For each point on limb A (railD 30..55), how far to the NEAREST OTHER limb?
console.log(`RAIL_CORRIDOR_CLEARANCE=${RAIL_CORRIDOR_CLEARANCE}; a legal corridor needs 2x that = ${(RAIL_CORRIDOR_CLEARANCE*2).toFixed(1)} m between limbs`);
let worst = Infinity; let worstAt = '';
for (let d = 25; d <= 60; d += 1) {
  route.pointAt(d, p);
  const ax = p.x, az = p.z;
  let best = Infinity; let bestD = 0;
  for (let e = 0; e < route.length; e += 1) {
    const along = Math.abs(route.wrap(e - d + route.length / 2) - route.length / 2);
    if (along < 25) continue; // same limb
    route.pointAt(e, p);
    const dist = Math.hypot(p.x - ax, p.z - az);
    if (dist < best) { best = dist; bestD = e; }
  }
  if (best < worst) { worst = best; worstAt = `railD ${d} at (${ax.toFixed(1)}, ${az.toFixed(1)}) to railD ${bestD.toFixed(0)}`; }
  if (best < RAIL_CORRIDOR_CLEARANCE * 2 + 3) {
    console.log(`  railD ${d} (${ax.toFixed(1)}, ${az.toFixed(1)}): nearest other limb ${best.toFixed(2)} m away (railD ${bestD.toFixed(0)})${best < RAIL_CORRIDOR_CLEARANCE*2 ? '  <-- NO LEGAL CORRIDOR' : ''}`);
  }
}
console.log(`\nworst pinch in that stretch: ${worst.toFixed(2)} m — ${worstAt}`);
