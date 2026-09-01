/**
 * **How big a step is it into the fountain's water?**
 *
 * The fountain's wading surface is not the terrain: `Fountain.groundLevel`
 * lifts the ground inside the rim to `waterLevel - WADE_SINK`, and
 * `World.attachPlayer` composes that onto the player's own sampler — which is
 * the sampler `NavGrid` builds its lattice from. So the water is a *level*, and
 * whether a route can enter it is decided by the lattice's level rule.
 *
 * This measures the step, on the real park, through the real composed sampler.
 * It is where `NavGrid`'s "inside a band the level rule is the hop's own reach"
 * comes from: the step is **0.631 m** on the canonical seed against a 0.62 m
 * `BUILDING_STEP_UP`, so a walking rule refuses the water by 11 mm — while a
 * child plainly gets in by hopping the rim, which is what she is doing.
 *
 * ```
 * node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
 *      scripts/measure-fountain-rim-step.mts
 * ```
 *
 * `LGP_SEED=n` measures another park.
 */
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
