/**
 * Where does the DRAWN path network meet the railway, and was a crossing
 * planned there?
 *
 * Walks every drawn ribbon (the swept Catmull-Rom `routeCurve`, not the
 * control polyline — the two differ by metres on a bend, and it is the swept
 * curve a child walks on), records every rail-side flip, and reports each
 * against `CROSSING_SITES` / `LEVEL_CROSSING_SITES` using the same
 * `SITE_SNAP_TOLERANCE` the gate invariant uses.
 *
 * Not used by the game. `pnpm exec tsx scripts/probe-unplanned-crossings.mts`
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
import { CROSSING_SITES, LEVEL_CROSSING_SITES } from '../src/world/train/crossingPlan.ts';
import { SITE_SNAP_TOLERANCE } from '../src/world/train/crossings.ts';
import { ROUTES, routeCurve } from '../src/world/pathGraph.ts';

buildHeadlessPark();

const route = TRAIN_PLAN.route;
const at = new Vector3();
const tangent = new Vector3();
const railSide = (x: number, z: number): number => {
  const d = route.distanceNear(x, z);
  route.pointAt(d, at);
  route.tangentAt(d, tangent);
  return Math.sign(tangent.z * (x - at.x) - tangent.x * (z - at.z)) || 1;
};
const alongLoop = (a: number, b: number): number =>
  Math.abs(route.wrap(a - b + route.length / 2) - route.length / 2);
const nearestOf = (d: number, sites: readonly number[]): number | null => {
  let best: number | null = null;
  for (const s of sites) if (best === null || alongLoop(d, s) < alongLoop(d, best)) best = s;
  return best;
};

const bridgeSites = CROSSING_SITES.map((s) => s.railDistance);
const levelSites = LEVEL_CROSSING_SITES.map((s) => s.railDistance);

console.log(`seed ${PARK_SEED}, loop ${route.length.toFixed(1)} m, snap tolerance ${SITE_SNAP_TOLERANCE}`);
console.log(`bridge sites: ${bridgeSites.map((d) => d.toFixed(0)).join(', ') || '(none)'}`);
console.log(`level sites:  ${levelSites.map((d) => d.toFixed(0)).join(', ') || '(none)'}`);

let planned = 0;
let unplanned = 0;
const offenders = new Map<string, number>();
for (const definition of ROUTES) {
  const curve = routeCurve(definition);
  const length = curve.getLength();
  const steps = Math.max(2, Math.ceil(length / 0.5));
  let previous = curve.getPoint(0);
  let previousSide = railSide(previous.x, previous.z);
  for (let i = 1; i <= steps; i += 1) {
    const here = curve.getPoint(i / steps);
    const side = railSide(here.x, here.z);
    if (side !== previousSide) {
      const midX = (here.x + previous.x) / 2;
      const midZ = (here.z + previous.z) / 2;
      const d = route.distanceNear(midX, midZ);
      const b = nearestOf(d, bridgeSites);
      const l = nearestOf(d, levelSites);
      const onBridge = b !== null && alongLoop(d, b) <= SITE_SNAP_TOLERANCE;
      const onLevel = l !== null && alongLoop(d, l) <= SITE_SNAP_TOLERANCE;
      if (onBridge || onLevel) {
        planned += 1;
      } else {
        unplanned += 1;
        offenders.set(definition.name, (offenders.get(definition.name) ?? 0) + 1);
        const nearest = [
          b === null ? null : `bridge ${b.toFixed(0)} (${alongLoop(d, b).toFixed(1)} m off)`,
          l === null ? null : `level ${l.toFixed(0)} (${alongLoop(d, l).toFixed(1)} m off)`,
        ]
          .filter((s): s is string => s !== null)
          .join(', ');
        console.log(
          `UNPLANNED  ${definition.name} crosses at (${midX.toFixed(1)}, ${midZ.toFixed(1)}) ` +
            `railD ${d.toFixed(1)} — nearest ${nearest}`,
        );
      }
      previousSide = side;
    }
    previous = here;
  }
}

console.log(`\n${planned} planned crossings, ${unplanned} UNPLANNED, over ${ROUTES.length} drawn routes`);
for (const [name, n] of [...offenders].sort((a, b) => b[1] - a[1])) console.log(`  ${name}: ${n}`);
