/**
 * How high above the ground is the Sky Cruiser, really?
 *
 * `route.clearanceAt` is a flat-frame quantity and `placeOnSphere` is supposed
 * to preserve it, so the drawn car should fly at its authored clearance. The
 * clearance sweep says it flies through bare `terrain`, so one of those two is
 * not true. This asks both, on the same samples, and prints where they part.
 */
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { drawnOnSphere } from '../src/world/rail/sweptRail';
import { altitudeAt, terrainHeight } from '../src/world/terrain';

// Control: a point lifted a known height above the ground reads back that
// height, at the centre and at the rim.
for (const r of [0, 100, 157]) {
  const y = terrainHeight(r, 0) + 6.2;
  console.log(
    `control  flat point 6.2 m up at r=${String(r).padStart(3)}: ` +
      `altitudeAt reads ${altitudeAt(r, y, 0).toFixed(3)} m`,
  );
}

const park = quietly(() => buildHeadlessPark());
const route = park.world.coaster.route;
const drawn = drawnOnSphere(route);

const flat = new Vector3();
const leant = new Vector3();
let worstFlat = Infinity;
let worstFlatAt = 0;
let worstDrawn = Infinity;
let worstDrawnAt = 0;

console.log('\n   d   flat clearanceAt   drawn altitudeAt   radius');
for (let d = 0; d < route.length; d += 1) {
  route.pointAt(d, flat);
  drawn.pointAt(d, leant);
  const flatClear = route.clearanceAt(d);
  const drawnAlt = altitudeAt(leant.x, leant.y, leant.z);
  if (flatClear < worstFlat) {
    worstFlat = flatClear;
    worstFlatAt = d;
  }
  if (drawnAlt < worstDrawn) {
    worstDrawn = drawnAlt;
    worstDrawnAt = d;
  }
  if (d % 10 === 0 || Math.abs(d - 85) < 3 || Math.abs(d - 100) < 2) {
    console.log(
      `${String(d).padStart(4)}   ${flatClear.toFixed(2).padStart(13)}   ` +
        `${drawnAlt.toFixed(2).padStart(15)}   ${Math.hypot(leant.x, leant.z).toFixed(1).padStart(6)}`,
    );
  }
}

console.log(`\nworst flat clearanceAt : ${worstFlat.toFixed(2)} m at ${worstFlatAt} m along`);
console.log(`worst drawn altitudeAt : ${worstDrawn.toFixed(2)} m at ${worstDrawnAt} m along`);
