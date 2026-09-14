/**
 * **Which drawn route crosses the railway, and does it cross at a planned
 * site?**
 *
 * `crossings.ts` throws naming a coordinate; it cannot name the leg. This walks
 * every `ROUTES` entry's own curve, flips sides against the solved rail exactly
 * as `computeCrossings` does, and reports the route by NAME.
 *
 * CONTROL: the set of crossings found here must match `computeCrossings`' own
 * count and distances on a seed where that function returns. Run it on a seed
 * that builds to check that before trusting it on one that does not.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';

const seed = process.env['LGP_SEED'] ?? 'default(canonical)';
const { buildHeadlessPark } = await import('./park-harness.mts');
try {
  buildHeadlessPark();
} catch {
  // Expected on the failing seed — paths are drawn before crossings throw.
}

const { pathCentreline } = await import('../src/world/pathGraph.ts');
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');
const { CROSSING_SITES } = await import('../src/world/train/crossingPlan.ts');

const route = TRAIN_PLAN.route;
const point = new Vector3();
const tangent = new Vector3();
const sideAt = (x: number, z: number): { side: number; d: number; perp: number } => {
  const d = route.distanceNear(x, z);
  route.pointAt(d, point);
  route.tangentAt(d, tangent);
  const perp = Math.hypot(point.x - x, point.z - z);
  return { side: Math.sign(tangent.z * (x - point.x) - tangent.x * (z - point.z)) || 1, d, perp };
};

const samples = pathCentreline();
const byRun = new Map<number, { x: number; z: number }[]>();
for (const s2 of samples) {
  const list = byRun.get(s2.run) ?? [];
  list.push({ x: s2.x, z: s2.z });
  byRun.set(s2.run, list);
}
console.log(
  `seed ${seed}: ${byRun.size} drawn runs, loop ${route.length.toFixed(1)} m, ${CROSSING_SITES.length} site(s)`,
);
console.log('');

for (const [run, pts] of [...byRun].sort((a, b) => a[0] - b[0])) {
  if (pts.length < 2) continue;
  let previous = sideAt(pts[0]!.x, pts[0]!.z);
  for (let i = 1; i < pts.length; i += 1) {
    const now = sideAt(pts[i]!.x, pts[i]!.z);
    const stride = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z);
    if (stride < 3 && now.side !== previous.side && Math.min(now.perp, previous.perp) <= 3.2) {
      let nearest = Infinity;
      for (const site of CROSSING_SITES) {
        const along = Math.abs(route.wrap(now.d - site.railDistance + route.length / 2) - route.length / 2);
        if (along < nearest) nearest = along;
      }
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      console.log(
        `  run ${String(run).padStart(3)} crosses at railD ${now.d.toFixed(1)} ` +
          `(${pts[i]!.x.toFixed(1)}, ${pts[i]!.z.toFixed(1)}) — nearest site ` +
          `${nearest === Infinity ? 'NONE AT ALL' : nearest.toFixed(1) + ' m'} ` +
          `${nearest <= 8 ? '(SNAPS)' : '*** NO SITE ***'}`,
      );
      console.log(
        `          that run: ${pts.length} samples, (${a.x.toFixed(1)}, ${a.z.toFixed(1)}) ` +
          `to (${b.x.toFixed(1)}, ${b.z.toFixed(1)}), width ${(samples.find((s3) => s3.run === run)?.halfWidth ?? 0) * 2}`,
      );
    }
    previous = now;
  }
}
