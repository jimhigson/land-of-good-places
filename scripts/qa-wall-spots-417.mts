/**
 * Scratch: pick fair before/after camera spots for #417. Not part of the build.
 *
 *   LGP_SEED=5 node --import ./scripts/ts-extension-resolver-register.mjs \
 *     scripts/qa-wall-spots-417.mts
 *
 * Prints `x,z,facingDegrees` for a handful of points **on the paved network**,
 * chosen from the path geometry alone and from nothing else.
 *
 * That last part is the whole point. The walls are what moved, so a spot
 * chosen by looking at the walls would move with them, and a before/after pair
 * shot from two different places proves nothing at all. Paths are untouched by
 * this branch, so the same coordinates frame the same view of the same park in
 * both builds, and the only thing that differs between the two screenshots is
 * the thing under review.
 *
 * The camera looks **along** the path rather than across it, because "walls
 * run alongside the paths" is a claim about what lines the verge as you walk.
 */
import './headless-canvas.mjs';
import { buildPaths, pathCentreline } from '../src/world/pathGraph.ts';
import { PARK_SEED } from '../src/world/parkManifest.ts';

buildPaths();
const samples = pathCentreline();

// Widely separated samples, taken at fixed fractions along the recorded
// centreline so the choice cannot drift with anything but the network itself.
const fractions = [0.08, 0.3, 0.52, 0.74, 0.9];
const spots: string[] = [];
for (const f of fractions) {
  const i = Math.floor(f * (samples.length - 1));
  const here = samples[i]!;
  // Face along the path: towards a sample a little further on, staying on the
  // same drawn run so the bearing is the path's own and not a jump across a seam.
  let ahead = here;
  for (let j = i + 1; j < samples.length && j < i + 40; j += 1) {
    const candidate = samples[j]!;
    if (candidate.run !== here.run) break;
    ahead = candidate;
  }
  const facing = (Math.atan2(ahead.z - here.z, ahead.x - here.x) * 180) / Math.PI;
  spots.push(`${here.x.toFixed(1)},${here.z.toFixed(1)},${facing.toFixed(0)}`);
}
process.stdout.write(`${PARK_SEED} ${spots.join(' ')}\n`);
