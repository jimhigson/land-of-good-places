/**
 * How much paving is laid inside a built bridge's own footprint, against the
 * least that could be: one ribbon down the axis. The clump, in square metres.
 *
 * Rasterised on a 0.25 m grid from the DRAWN ribbons (routeCurve + each
 * route's own width), so it measures the paving a child sees, not the
 * planner's control points.
 */
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { CROSSING_SITES } from '../src/world/train/crossingPlan.ts';
import { ROUTES, routeCurve } from '../src/world/pathGraph.ts';
import { DECK_HALF_LENGTH } from '../src/world/train/clearance.ts';

const park = buildHeadlessPark();
const built = park.world.train.bridges;
const isBuilt = (s: { x: number; z: number }): boolean =>
  built.some((b) => b.pavingHeightAt(s.x, s.z) !== null);

// Every drawn ribbon as (sample, halfWidth).
const ribbon: { x: number; z: number; hw: number }[] = [];
for (const def of ROUTES) {
  const curve = routeCurve(def);
  const n = Math.max(2, Math.ceil(curve.getLength() / 0.2));
  for (let i = 0; i <= n; i += 1) {
    const p = curve.getPointAt(i / n);
    ribbon.push({ x: p.x, z: p.z, hw: def.width / 2 });
  }
}

const CELL = 0.25;
console.log(`seed ${PARK_SEED}`);
for (const site of CROSSING_SITES) {
  if (!site.bridge || !isBuilt(site)) continue;
  const alongMax = DECK_HALF_LENGTH + site.rampReachPos;
  const alongMin = -(DECK_HALF_LENGTH + site.rampReachNeg);
  const hw = site.halfWidth;
  let paved = 0, cells = 0;
  for (let a = alongMin; a <= alongMax; a += CELL) {
    for (let c = -hw; c <= hw; c += CELL) {
      const x = site.x + site.dirX * a - site.dirZ * c;
      const z = site.z + site.dirZ * a + site.dirX * c;
      cells += 1;
      for (const r of ribbon) {
        if (Math.abs(r.x - x) > r.hw || Math.abs(r.z - z) > r.hw) continue;
        if (Math.hypot(r.x - x, r.z - z) <= r.hw) { paved += 1; break; }
      }
    }
  }
  const area = paved * CELL * CELL;
  const foot = cells * CELL * CELL;
  // The least a crossing needs: one ribbon the length of the footprint.
  const need = (alongMax - alongMin) * 3.2;
  console.log(
    `  railD ${site.railDistance.toFixed(0).padStart(4)} (${site.x.toFixed(1)},${site.z.toFixed(1)}): ` +
    `footprint ${foot.toFixed(0)} m2, paved ${area.toFixed(0)} m2 ` +
    `(${((area / foot) * 100).toFixed(0)}% of it), one ribbon would be ${need.toFixed(0)} m2 ` +
    `— excess ${(area - need).toFixed(0)} m2 (${(area / need).toFixed(2)}x)`,
  );
}
