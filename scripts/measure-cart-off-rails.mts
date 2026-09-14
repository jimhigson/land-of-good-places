/**
 * **Is each ride's vehicle actually on the rails it is drawn beside?**
 *
 * The rails are drawn through `drawnOnSphere`. For a long time the vehicles
 * were placed at the *flat* `route.pointAt` with a plain Euler yaw/pitch, so
 * they were not — measured at up to 10.83 m away on the Sky Cruiser.
 *
 * This measures **the cart that gets drawn**, found by name in the built scene,
 * against **the rails that get drawn**. It deliberately does not re-derive
 * where the cart ought to be: a check that recomputes the code's own formula
 * agrees with the code rather than with the world, which is the fault
 * `check-tie-frame.mts` was caught in.
 *
 * Controls run first, and they are the point (CLAUDE.md: "run a control on the
 * instrument first"). Two agents here have had clean, decisive, entirely wrong
 * answers from instruments nobody controlled.
 */
import { Quaternion, Vector3, type Object3D } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { drawnOnSphere } from '../src/world/rail/sweptRail';
import { placeOnSphere, terrainHeight } from '../src/world/terrain';
import { Player } from '../src/entities/Player';
import { IsoCamera } from '../src/core/IsoCamera';
import { CollisionWorld } from '../src/world/Collision';
import type { FrameContext } from '../src/core/types';

let failed = false;

// ---------------------------------------------------------------- controls

{
  const flat = { x: 0, y: terrainHeight(0, 0) + 6.2, z: 0 };
  const p = new Vector3();
  placeOnSphere(flat, 0, p, new Quaternion());
  const moved = Math.hypot(p.x - flat.x, p.y - flat.y, p.z - flat.z);
  console.log(`control 1  placeOnSphere at the origin is the identity: ${moved.toFixed(4)} m`);
  if (moved > 1e-6) {
    console.error('   CONTROL FAILED — the instrument is measuring the wrong thing');
    failed = true;
  }
}

{
  const gap = new Vector3(10, 5, 10).distanceTo(new Vector3(10, 5, 11));
  console.log(`control 2  a known 1 m offset reads back as: ${gap.toFixed(4)} m`);
  if (Math.abs(gap - 1) > 1e-9) {
    console.error('   CONTROL FAILED');
    failed = true;
  }
}

console.log('control 3  lean displacement 6.2 m up, against the cap table:');
for (const r of [0, 40, 100, 157]) {
  const flat = { x: r, y: terrainHeight(r, 0) + 6.2, z: 0 };
  const p = new Vector3();
  placeOnSphere(flat, 0, p, new Quaternion());
  const moved = Math.hypot(p.x - flat.x, p.y - flat.y, p.z - flat.z);
  console.log(`             r = ${String(r).padStart(3)} m -> ${moved.toFixed(3)} m`);
}

// ------------------------------------------------------------------ the ride

console.log('\n--- building the park ---');
const park = quietly(() => buildHeadlessPark());
const player = new Player(new CollisionWorld(), new IsoCamera(), new Vector3());
const coaster = park.world.coaster;
const route = coaster.route;
const drawn = drawnOnSphere(route);

const wantedName = `${coaster.name}-cart`;
let cart: Object3D | null = null;
coaster.group.traverse((child) => {
  if (child.name === wantedName) cart = child;
});
if (cart === null) {
  console.error(
    `\nVOID: no object named '${wantedName}' in the built coaster group. ` +
      'The cart was renamed and this instrument is now measuring nothing — ' +
      'fix the name here rather than deleting the check.',
  );
  process.exit(1);
}
const theCart: Object3D = cart;

// Where the drawn rails are, sampled densely enough that "nearest point on the
// track" is not itself the thing being measured.
const railPoints: Vector3[] = [];
for (let d = 0; d < route.length; d += 0.25) {
  railPoints.push(drawn.pointAt(d, new Vector3()));
}

/** Distance from `p` to the nearest drawn rail centre-line point. */
function offTheRails(p: Vector3): number {
  let best = Infinity;
  for (const rail of railPoints) {
    const gap = p.distanceTo(rail);
    if (gap < best) best = gap;
  }
  return best;
}

/** How far along the loop the nearest drawn rail point is, for coverage. */
function offTheRailsDistance(p: Vector3): number {
  let best = Infinity;
  let bestAt = 0;
  for (let i = 0; i < railPoints.length; i += 1) {
    const gap = p.distanceTo(railPoints[i] as Vector3);
    if (gap < best) {
      best = gap;
      bestAt = i * 0.25;
    }
  }
  return bestAt;
}

// **Board it, or nothing moves.** `update` returns immediately while the phase
// is 'waiting', and `requestBoard` refuses without a player — so a run that
// skips this watches 3000 identical frames of a parked cart and reports a
// confident number about one point of the loop. That is exactly what the first
// version of this instrument did: it read 0.161 m with the fix deliberately
// removed, where the real worst is two orders of magnitude larger, and it was
// the *worst == mean* equality that gave it away rather than the value.
coaster.attachPlayer(player);
if (!coaster.requestBoard()) {
  console.error('\nVOID: the ride refused to board, so nothing below is measured.');
  process.exit(1);
}

const cartWorld = new Vector3();
let worst = 0;
let worstWhere = new Vector3();
let sum = 0;
let n = 0;
const elapsedStep = 1 / 60;
let elapsed = 0;
const visited = new Set<number>();
// Enough frames to carry the cart right round the circuit at ride speed —
// scaled to the circuit, because these differ by a factor of three between
// seeds and a fixed count silently measured a third of seed 11's loop.
const frames = Math.ceil(route.length * 30);
for (let frame = 0; frame < frames; frame += 1) {
  elapsed += elapsedStep;
  coaster.update({ dt: elapsedStep, elapsed } as unknown as FrameContext);
  coaster.group.updateMatrixWorld(true);
  theCart.getWorldPosition(cartWorld);
  const gap = offTheRails(cartWorld);
  sum += gap;
  n += 1;
  visited.add(Math.floor(offTheRailsDistance(cartWorld)));
  if (gap > worst) {
    worst = gap;
    worstWhere = cartWorld.clone();
  }
}

// How much of the loop this run actually saw. A measurement over a tenth of the
// circuit is not a measurement of the circuit, and it must say so out loud
// rather than passing quietly — see CLAUDE.md on checks that stop covering
// something.
const coverage = (visited.size / route.length) * 100;
console.error(
  `[coverage] the cart visited ${visited.size} of ${Math.ceil(route.length)} metre-buckets ` +
    `round the loop (${coverage.toFixed(0)}%)`,
);
if (coverage < 80) {
  console.error(
    `\nVOID: only ${coverage.toFixed(0)}% of the circuit was ridden, so the worst ` +
      'point may never have been visited. Give it more frames.',
  );
  failed = true;
}

console.log(`\n${coaster.name}: circuit ${route.length.toFixed(1)} m, ${n} frames watched`);
console.log(`  drawn cart to drawn rails: worst ${worst.toFixed(3)} m, mean ${(sum / n).toFixed(3)} m`);
console.log(
  `  worst at world (${worstWhere.x.toFixed(1)}, ${worstWhere.y.toFixed(1)}, ` +
    `${worstWhere.z.toFixed(1)}), radius ${Math.hypot(worstWhere.x, worstWhere.z).toFixed(1)} m`,
);

// The cart is a rigid body a metre or so across riding a sampled centre line,
// so it is never exactly on it. A tolerance well under the cart's own size,
// and two orders of magnitude under the 10.83 m this was written to catch.
const TOLERANCE = 0.35;
if (worst > TOLERANCE) {
  console.error(
    `\nthe cart rides ${worst.toFixed(3)} m off its own rails (allowed ${TOLERANCE} m).`,
  );
  failed = true;
}

if (failed) process.exit(1);
console.log('\nthe cart rides on its rails');
