import './headless-canvas.mjs';
import { Vector3 } from 'three';
const { buildHeadlessPark } = await import('./park-harness.mts');
try { buildHeadlessPark(); } catch { /* expected */ }
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');
const route = TRAIN_PLAN.route;
const p = new Vector3(); const t = new Vector3();
const sideOf = (x: number, z: number) => {
  const d = route.distanceNear(x, z);
  route.pointAt(d, p); route.tangentAt(d, t);
  return { side: Math.sign(t.z * (x - p.x) - t.x * (z - p.z)) || 1, dist: Math.hypot(p.x - x, p.z - z), d };
};
console.log('--- planned stations ---');
for (const s of TRAIN_PLAN.stations) {
  const stand = sideOf(s.standX, s.standZ);
  const app = sideOf(s.approachX, s.approachZ);
  const lead = sideOf(s.leadX, s.leadZ);
  console.log(`  ${s.name} (railD ${s.distance.toFixed(1)})`);
  console.log(`    stand    (${s.standX.toFixed(1)}, ${s.standZ.toFixed(1)}) side ${stand.side} dist ${stand.dist.toFixed(2)}`);
  console.log(`    approach (${s.approachX.toFixed(1)}, ${s.approachZ.toFixed(1)}) side ${app.side} dist ${app.dist.toFixed(2)}`);
  console.log(`    lead     (${s.leadX.toFixed(1)}, ${s.leadZ.toFixed(1)}) side ${lead.side} dist ${lead.dist.toFixed(2)}`);
  console.log(`    distance from run 16's far end (41.9, -43.4): stand ${Math.hypot(s.standX-41.9, s.standZ+43.4).toFixed(2)} m, lead ${Math.hypot(s.leadX-41.9, s.leadZ+43.4).toFixed(2)} m`);
}
