import { terrainHeight, planetRadiusAt } from '../src/world/terrain';
import { BUILDING_STEP_UP } from '../src/core/constants';

const CELL = 0.5;
const MAX_STEP = BUILDING_STEP_UP;
const STRANDED = [
  [-49.7, -177.4], [-46.0, -158.1], [-46.0, -162.3],
  [-46.0, -166.4], [-46.0, -170.6], [-46.7, -174.5],
] as const;
const NEIGHBOURS = [
  [CELL, 0], [-CELL, 0], [0, CELL], [0, -CELL],
  [CELL, CELL], [CELL, -CELL], [-CELL, CELL], [-CELL, -CELL],
] as const;

console.log(`MAX_STEP = BUILDING_STEP_UP = ${MAX_STEP}, lattice CELL = ${CELL}`);
console.log('');
console.log('At each stranded waypoint: how many of the eight lattice neighbours the');
console.log('step gate admits, on level ground, under each measure.');
console.log('');
let worstFlat = 0;
for (const [x, z] of STRANDED) {
  const y0 = terrainHeight(x, z);
  let openFlat = 0;
  let openRadial = 0;
  let maxFlat = 0;
  for (const [dx, dz] of NEIGHBOURS) {
    const y1 = terrainHeight(x + dx, z + dz);
    const dY = Math.abs(y1 - y0);
    const dR = Math.abs(planetRadiusAt(x + dx, y1, z + dz) - planetRadiusAt(x, y0, z));
    if (dY <= MAX_STEP) openFlat += 1;
    if (dR <= MAX_STEP) openRadial += 1;
    maxFlat = Math.max(maxFlat, dY);
  }
  worstFlat = Math.max(worstFlat, maxFlat);
  const lean = ((Math.asin(Math.min(1, Math.hypot(x, z) / 220)) * 180) / Math.PI).toFixed(1);
  console.log(
    `  (${x.toFixed(1)}, ${z.toFixed(1)})  d=${Math.hypot(x, z).toFixed(1)} m  lean ${lean}deg   ` +
      `flat |dy| gate: ${openFlat}/8 neighbours open (worst step ${maxFlat.toFixed(3)} m)   ` +
      `radial gate: ${openRadial}/8 open`,
  );
}
console.log('');
// CONTROL: the same measure at the park's origin must open all eight under both.
const y0 = terrainHeight(0, 0);
let cf = 0, cr = 0;
for (const [dx, dz] of NEIGHBOURS) {
  const y1 = terrainHeight(dx, dz);
  if (Math.abs(y1 - y0) <= MAX_STEP) cf += 1;
  if (Math.abs(planetRadiusAt(dx, y1, dz) - planetRadiusAt(0, y0, 0)) <= MAX_STEP) cr += 1;
}
console.log(`CONTROL park origin: flat gate ${cf}/8 open, radial gate ${cr}/8 open. Both must be 8/8.`);
