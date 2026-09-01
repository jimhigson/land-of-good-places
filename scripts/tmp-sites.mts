import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { CROSSING_SITES, LEVEL_CROSSING_SITES } from '../src/world/train/crossingPlan.ts';
const park = buildHeadlessPark();
console.log(`seed ${PARK_SEED}`);
for (const s of CROSSING_SITES)
  console.log(`  CROSSING railD=${s.railDistance.toFixed(1)} at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) dir=(${s.dirX.toFixed(2)},${s.dirZ.toFixed(2)}) bridge=${s.bridge} halfWidth=${s.halfWidth?.toFixed(2)} reach+=${s.rampReachPos?.toFixed(1)} reach-=${s.rampReachNeg?.toFixed(1)}`);
for (const s of LEVEL_CROSSING_SITES)
  console.log(`  LEVEL    railD=${s.railDistance.toFixed(1)} at (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`);
console.log(`built bridges: ${park.world.train.bridges.length}`);
