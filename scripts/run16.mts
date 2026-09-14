import './headless-canvas.mjs';
import { Vector3 } from 'three';
const { buildHeadlessPark } = await import('./park-harness.mts');
try { buildHeadlessPark(); } catch { /* expected */ }
const { pathCentreline } = await import('../src/world/pathGraph.ts');
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');
const route = TRAIN_PLAN.route;
const p = new Vector3(); const t = new Vector3();
const info = (x: number, z: number) => {
  const d = route.distanceNear(x, z);
  route.pointAt(d, p); route.tangentAt(d, t);
  return { side: Math.sign(t.z * (x - p.x) - t.x * (z - p.z)) || 1, dist: Math.hypot(p.x - x, p.z - z), d };
};
const pts = pathCentreline().filter((s) => s.run === 16);
console.log(`run 16: ${pts.length} samples`);
const a = pts[0]!, b = pts[pts.length - 1]!;
console.log(`  start (${a.x.toFixed(1)}, ${a.z.toFixed(1)}) side ${info(a.x,a.z).side} dist ${info(a.x,a.z).dist.toFixed(2)}`);
console.log(`  end   (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) side ${info(b.x,b.z).side} dist ${info(b.x,b.z).dist.toFixed(2)}`);
let flips = 0;
for (let i = 1; i < pts.length; i += 1) {
  const q = info(pts[i]!.x, pts[i]!.z), r = info(pts[i-1]!.x, pts[i-1]!.z);
  if (q.side !== r.side) { flips += 1; console.log(`  FLIP ${flips} between sample ${i-1} and ${i} at (${pts[i]!.x.toFixed(1)}, ${pts[i]!.z.toFixed(1)}), rail dist ${q.dist.toFixed(2)}`); }
}
console.log(`  total side flips along the drawn run: ${flips}`);
console.log(`  min rail distance along the run: ${Math.min(...pts.map(s=>info(s.x,s.z).dist)).toFixed(2)} m`);
