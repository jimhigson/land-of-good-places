import { buildHeadlessPark, quietly } from './park-harness.mts';
import { computeCrossings } from '../src/world/train/crossings.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
import { CROSSING_SITES } from '../src/world/train/crossingPlan.ts';
quietly(() => buildHeadlessPark());
const crossings = computeCrossings(TRAIN_PLAN.route, TRAIN_PLAN.stations.map((s) => s.distance));
console.log('proven sites', CROSSING_SITES.map((c) => `${c.railDistance.toFixed(0)}@(${c.x.toFixed(1)},${c.z.toFixed(1)})`).join(' '));
console.log('crossed     ', crossings.map((c) => `${c.railDistance.toFixed(0)}@(${c.x.toFixed(1)},${c.z.toFixed(1)})`).join(' '));
