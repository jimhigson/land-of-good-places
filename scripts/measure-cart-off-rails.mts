/**
 * How far is each ride's vehicle from the rails it is supposed to be riding?
 *
 * The rails are drawn through `drawnOnSphere`; the vehicles are placed at the
 * flat `route.pointAt`. If those two disagree the cart is visibly off its own
 * track. This measures the disagreement, on a seed that builds.
 *
 * CONTROLS FIRST (CLAUDE.md: "run a control on the instrument first"):
 *  - control 1: `placeOnSphere` at the park origin must be the identity, so the
 *    gap there is ~0. If this prints a big number the instrument is wrong.
 *  - control 2: a deliberate 1.000 m offset must be reported as 1.000 m.
 */
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { drawnOnSphere } from '../src/world/rail/sweptRail';
import { placeOnSphere, terrainHeight } from '../src/world/terrain';
import { Quaternion } from 'three';

// ---- control 1: placeOnSphere at the origin is the identity ----
{
  const flat = { x: 0, y: terrainHeight(0, 0) + 6.2, z: 0 };
  const p = new Vector3();
  const q = new Quaternion();
  placeOnSphere(flat, 0, p, q);
  const moved = Math.hypot(p.x - flat.x, p.y - flat.y, p.z - flat.z);
  console.log(`control 1  origin lean displacement: ${moved.toFixed(4)} m  (expect ~0)`);
}

// ---- control 2: the instrument can see a known offset ----
{
  const a = new Vector3(10, 5, 10);
  const b = new Vector3(10, 5, 11);
  console.log(`control 2  known 1 m offset reads: ${a.distanceTo(b).toFixed(4)} m  (expect 1.0000)`);
}

// ---- control 3: lean displacement grows with radius, as the cap says ----
for (const r of [0, 40, 100, 157]) {
  const flat = { x: r, y: terrainHeight(r, 0) + 6.2, z: 0 };
  const p = new Vector3();
  const q = new Quaternion();
  placeOnSphere(flat, 0, p, q);
  const moved = Math.hypot(p.x - flat.x, p.y - flat.y, p.z - flat.z);
  console.log(`control 3  r=${String(r).padStart(3)} m, 6.2 m up: lean moves it ${moved.toFixed(3)} m`);
}

console.log('\n--- building the park ---');
const park = quietly(() => buildHeadlessPark());
const route = park.world.coaster.route;
const drawn = drawnOnSphere(route);

const flatP = new Vector3();
const drawnP = new Vector3();
let worst = 0;
let worstAt = 0;
let worstFlat = new Vector3();
let sum = 0;
let n = 0;
for (let d = 0; d < route.length; d += 1) {
  route.pointAt(d, flatP);
  drawn.pointAt(d, drawnP);
  const gap = flatP.distanceTo(drawnP);
  sum += gap;
  n += 1;
  if (gap > worst) {
    worst = gap;
    worstAt = d;
    worstFlat = flatP.clone();
  }
}
console.log(`\nSky Cruiser: circuit ${route.length.toFixed(1)} m`);
console.log(`  cart-to-rails gap: worst ${worst.toFixed(3)} m at ${worstAt.toFixed(0)} m along`);
console.log(`    (there the flat point is (${worstFlat.x.toFixed(1)}, ${worstFlat.y.toFixed(1)}, ${worstFlat.z.toFixed(1)}), radius ${Math.hypot(worstFlat.x, worstFlat.z).toFixed(1)} m)`);
console.log(`  mean gap ${(sum / n).toFixed(3)} m over ${n} samples`);
