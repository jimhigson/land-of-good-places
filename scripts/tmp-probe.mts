import { buildHeadlessPark, quietly } from './park-harness.mts';
import { computeCrossings } from '../src/world/train/crossings.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
import { PATH_GRAPH } from '../src/world/pathGraph.ts';
quietly(() => buildHeadlessPark());
const crossings = computeCrossings(TRAIN_PLAN.route, TRAIN_PLAN.stations.map((s) => s.distance));
for (const c of crossings) {
  console.log(`crossing railD ${c.railDistance.toFixed(0)} @(${c.x.toFixed(1)},${c.z.toFixed(1)}) halfGap ${c.halfGap.toFixed(2)} pathHalfWidth ${(c as { pathHalfWidth?: number }).pathHalfWidth?.toFixed?.(2)}`);
}
const near = (x: number, z: number, r: number): string[] =>
  PATH_GRAPH.edges.filter((e) => e.paved && e.route.points.some(([px, pz]) => Math.hypot(px - x, pz - z) < r)).map((e) => e.route.name);
for (const c of crossings) console.log(` routes within 20 m of railD ${c.railDistance.toFixed(0)}:`, near(c.x, c.z, 20).join(' '));
