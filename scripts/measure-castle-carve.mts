/**
 * Why does the Sky Cruiser's profile go underground near the castle?
 *
 * The carve pins the span through the castle to ONE absolute world y
 * (`castleY(WINDOW_TRACK_Y)`) and turns it into a per-column clearance with
 * `wanted = windowY - terrainHeight(spot.x, spot.z)`. On a flat park every
 * column has the same ground, so one absolute y is one clearance. On a cap the
 * ground falls away radially, so the same absolute y is a different clearance
 * in every column — and where the ground stands above it, a negative one.
 *
 * This prints, along the loop: the ground, the track, the clearance, the
 * castle's own datum, and how far each sample is from the castle span.
 */
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { terrainHeight, capHeight } from '../src/world/terrain';
import { BUILDING_BASE_Y } from '../src/world/building/layout';
import { WINDOW_TRACK_Y } from '../src/world/building/cruiserWindow';

const park = quietly(() => buildHeadlessPark());
const route = park.world.coaster.route;

const windowY = BUILDING_BASE_Y + WINDOW_TRACK_Y;
console.log(`BUILDING_BASE_Y   = ${BUILDING_BASE_Y.toFixed(2)}`);
console.log(`WINDOW_TRACK_Y    = ${WINDOW_TRACK_Y.toFixed(2)}`);
console.log(`=> windowY (abs)  = ${windowY.toFixed(2)}`);
console.log(`castleSpan        = ${JSON.stringify(route.castleSpan)}`);

const p = new Vector3();
console.log('\n   d   radius   ground    cap    track   clearance   windowY-ground');
for (let d = 70; d <= 125; d += 2) {
  route.pointAt(d, p);
  const ground = terrainHeight(p.x, p.z);
  const cap = capHeight(p.x, p.z);
  const clear = p.y - ground;
  console.log(
    `${String(d).padStart(4)}  ${Math.hypot(p.x, p.z).toFixed(1).padStart(6)}  ` +
      `${ground.toFixed(2).padStart(7)}  ${cap.toFixed(2).padStart(7)}  ` +
      `${p.y.toFixed(2).padStart(7)}  ${clear.toFixed(2).padStart(9)}  ` +
      `${(windowY - ground).toFixed(2).padStart(14)}`,
  );
}
