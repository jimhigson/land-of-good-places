/** Scratch probe: what does the router's sampler see across the fountain rim? */
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { BUILDING_STEP_UP } from '../src/core/constants.ts';

const park = buildHeadlessPark();
const fountain = park.world.fountain;
// Exactly what `World.attachPlayer` composes onto the player's sampler.
const sample = (x: number, z: number, y: number): number =>
  fountain.groundLevel(x, z, park.sample(x, z, y));

const cx = fountain.centre.x;
const cz = fountain.centre.z;
console.log(`fountain centre ${cx.toFixed(2)}, ${cz.toFixed(2)}  rimRadius ${fountain.rimRadius}`);
console.log(`waterLevel ${fountain.waterLevel.toFixed(3)}  terrain ${park.sample(cx, cz, 500).toFixed(3)}`);
console.log(`BUILDING_STEP_UP (MAX_STEP) = ${BUILDING_STEP_UP}\n`);

console.log(' r      ground   step from previous');
let previous: number | null = null;
for (let r = 6.0; r >= 0; r -= 0.5) {
  const h = sample(cx + r, cz, 500);
  const step = previous === null ? 0 : h - previous;
  console.log(
    `${r.toFixed(1).padStart(4)}   ${h.toFixed(3).padStart(7)}   ${step.toFixed(3).padStart(7)}` +
      `${Math.abs(step) > BUILDING_STEP_UP ? '   <-- REFUSED by the lattice level rule' : ''}`,
  );
  previous = h;
}
