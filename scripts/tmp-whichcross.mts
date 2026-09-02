import { Vector3 } from 'three';
import { PATH_GRAPH } from '../src/world/pathGraph.ts';
import { CROSSING_SITES } from '../src/world/train/crossingPlan.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
import { routeCurve } from '../src/world/paths.ts';

const route = TRAIN_PLAN.route;
const point = new Vector3();
const tangent = new Vector3();
const sideAt = (x: number, z: number): { side: number; d: number; perp: number } => {
  const d = route.distanceNear(x, z);
  route.pointAt(d, point);
  route.tangentAt(d, tangent);
  return {
    side: Math.sign(tangent.z * (x - point.x) - tangent.x * (z - point.z)) || 1,
    d,
    perp: Math.hypot(point.x - x, point.z - z),
  };
};
const routes = [PATH_GRAPH.ring, ...PATH_GRAPH.edges.filter((e) => e.paved).map((e) => e.route)];
for (const r of routes) {
  const curve = routeCurve(r);
  const n = Math.max(16, Math.ceil(curve.getLength() / 0.5));
  let prev: { side: number; d: number; perp: number } | null = null;
  for (let i = 0; i <= n; i += 1) {
    const p = curve.getPoint(i / n);
    const cur = sideAt(p.x, p.z);
    if (prev && cur.side !== prev.side && Math.min(cur.perp, prev.perp) <= 6) {
      const near = CROSSING_SITES.map((c) => Math.abs(c.railDistance - cur.d)).sort((a, b) => a - b)[0];
      console.log(
        `${r.name}: crosses at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) railD ${cur.d.toFixed(1)} nearest site ${near?.toFixed(1)}`,
      );
    }
    prev = cur;
  }
}
console.log('sites', CROSSING_SITES.map((c) => `${c.railDistance.toFixed(1)}@(${c.x.toFixed(1)},${c.z.toFixed(1)})`).join(' '));
