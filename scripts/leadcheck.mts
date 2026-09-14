import './headless-canvas.mjs';
import { Vector3 } from 'three';
const { buildHeadlessPark } = await import('./park-harness.mts');
try { buildHeadlessPark(); } catch { /* expected */ }
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');
const route = TRAIN_PLAN.route;
const p = new Vector3(); const t = new Vector3();
for (const s of TRAIN_PLAN.stations) {
  const centre = route.pointAt(s.distance, new Vector3());
  const dLead = route.distanceNear(s.leadX, s.leadZ);
  route.pointAt(dLead, p); route.tangentAt(dLead, t);
  const dist = Math.hypot(p.x - s.leadX, p.z - s.leadZ);
  const side = Math.sign(t.z * (s.leadX - p.x) - t.x * (s.leadZ - p.z)) || 1;
  // The same question asked against THIS station's own rail point only.
  const ownDist = Math.hypot(centre.x - s.leadX, centre.z - s.leadZ);
  console.log(`${s.name}: station at railD ${s.distance.toFixed(1)}`);
  console.log(`  lead (${s.leadX.toFixed(1)}, ${s.leadZ.toFixed(1)})`);
  console.log(`    distance to ITS OWN rail point:   ${ownDist.toFixed(2)} m   <- what the derivation assumes`);
  console.log(`    distance to the NEAREST rail:     ${dist.toFixed(2)} m at railD ${dLead.toFixed(1)}, side ${side}`);
  console.log(`    nearest limb is ${Math.abs(route.wrap(dLead - s.distance + route.length/2) - route.length/2).toFixed(1)} m along the loop from its own`);
}
