/** Which drawn path runs are near a bridge, and are they crossing it or going round it? */
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { CROSSING_SITES } from '../src/world/train/crossingPlan.ts';
import { ROUTES, routeCurve } from '../src/world/pathGraph.ts';
import { DECK_HALF_LENGTH } from '../src/world/train/clearance.ts';

buildHeadlessPark();
const ZONE = 8; // metres of slack around the footprint rectangle

console.log(`seed ${PARK_SEED}`);
for (const site of CROSSING_SITES) {
  if (!site.bridge) continue;
  const alongMax = DECK_HALF_LENGTH + site.rampReachPos;
  const alongMin = -(DECK_HALF_LENGTH + site.rampReachNeg);
  console.log(`\n=== bridge site railD ${site.railDistance.toFixed(0)} at (${site.x.toFixed(1)}, ${site.z.toFixed(1)}), footprint along ${alongMin.toFixed(1)}..${alongMax.toFixed(1)}, halfWidth ${site.halfWidth.toFixed(1)}`);
  for (const def of ROUTES) {
    const curve = routeCurve(def);
    const n = Math.max(2, Math.ceil(curve.getLength() / 0.5));
    let inZone = 0;
    let onDeck = 0;
    let minAcross = Infinity, maxAcross = -Infinity;
    let sideChange = false;
    let prevSign = 0;
    for (let i = 0; i <= n; i += 1) {
      const p = curve.getPointAt(i / n);
      const dx = p.x - site.x, dz = p.z - site.z;
      const across = -dx * site.dirZ + dz * site.dirX;
      const along = dx * site.dirX + dz * site.dirZ;
      if (along > alongMax + ZONE || along < alongMin - ZONE) continue;
      if (Math.abs(across) > site.halfWidth + ZONE) continue;
      inZone += curve.getLength() / n;
      if (Math.abs(across) <= site.halfWidth && along <= alongMax && along >= alongMin) onDeck += curve.getLength() / n;
      minAcross = Math.min(minAcross, across); maxAcross = Math.max(maxAcross, across);
      const sign = Math.sign(along);
      if (prevSign !== 0 && sign !== 0 && sign !== prevSign) sideChange = true;
      if (sign !== 0) prevSign = sign;
    }
    if (inZone < 1) continue;
    console.log(`  ${def.name.padEnd(28)} ${inZone.toFixed(1).padStart(6)} m in zone, ${onDeck.toFixed(1).padStart(6)} m on the bridge itself, across ${minAcross.toFixed(1)}..${maxAcross.toFixed(1)}${sideChange ? '  [spans the rail]' : ''}`);
  }
}
