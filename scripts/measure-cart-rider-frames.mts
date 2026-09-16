/**
 * **Does the tub lean the same way as the child sitting in it?**
 *
 * `Player.setRidePose` ends in `faceOnGround`, so the rider is stood on the
 * local up. If her cart is not, the angle between the two is the angle her arms
 * are swung out of the tub by — which is Jim's 7 August report, reopened.
 *
 * `check-rail-race.mts` cannot see this: it builds its own `cartGroup` with a
 * position and a scale and no rotation at all, then calls the real
 * `setRidePose`. So it reproduces the very split it is supposed to be
 * measuring, and reports the same 2.042 m whether the real cart leans or not.
 * This measures the two frames the game actually uses.
 */
import { Quaternion, Vector3 } from 'three';
import { rideFrame } from '../src/world/rail/sweptRail';
import { RAIL_RACE_PLAN } from '../src/world/railRace/plan';
import { terrainHeight } from '../src/world/terrain';
import { upFor } from '../src/world/up';

// flat-ok: world +Y is the datum the instrument measures leans AGAINST
const WORLD_UP = new Vector3(0, 1, 0);

function degreesBetween(a: Vector3, b: Vector3): number {
  return (Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 180) / Math.PI;
}

// Control 1: at the park origin nothing leans, so every frame agrees.
{
  const q = new Quaternion();
  rideFrame(new Vector3(0, 0, 0), 0, 0, q);
  // flat-ok: local axis, leant by the quaternion under test
  const up = new Vector3(0, 1, 0).applyQuaternion(q);
  console.log(`control 1  at the origin, cart up vs world up: ${degreesBetween(up, WORLD_UP).toFixed(3)}°`);
}

// Control 2: the instrument can see a known tilt — a cart leaned at a point
// 157 m out should be off world up by the lean the cap table gives (45.5°).
{
  // **On the ground at 157 m, not at y = 0.** `upAt` is a direction from the
  // planet's centre, so it depends on the height as well as the column; asking
  // it at y = 0 asks about a point 65 m in the air and answers 35.51°, which is
  // a true answer to the wrong question. The control caught that on its first
  // run, which is the entire reason for having one.
  const q = new Quaternion();
  const ground = terrainHeight(157, 0);
  rideFrame(new Vector3(157, ground, 0), 0, 0, q);
  // flat-ok: local axis, leant by the quaternion under test
  const up = new Vector3(0, 1, 0).applyQuaternion(q);
  console.log(
    `control 2  on the ground at r=157 (y ${ground.toFixed(2)}), cart up vs world up: ` +
      `${degreesBetween(up, WORLD_UP).toFixed(2)}°  (the cap table says 45.5°)`,
  );
}

const route = RAIL_RACE_PLAN.raceRing;
const flat = new Vector3();
const leant = new Vector3();
const cartSpin = new Quaternion();
const cartUp = new Vector3();
const riderUp = new Vector3();

let worstNow = 0;
let worstBefore = 0;
let worstAt = 0;

for (let d = 0; d < route.length; d += 1) {
  for (let lane = 0; lane < 4; lane += 1) {
    route.flatPointAt(lane, d, flat);
    route.pointAt(lane, d, leant);

    // The cart, as `placeCarts` now builds it: leaned about the FLAT column.
    rideFrame(flat, 0, 0, cartSpin);
    // flat-ok: local axis, leant by the cart's own quaternion
    cartUp.set(0, 1, 0).applyQuaternion(cartSpin);

    // The rider, as `Player.setRidePose` -> `faceOnGround` builds her: leaned
    // about her own world position, which is the seat on the LEANT point.
    upFor(leant.x, leant.y, leant.z, riderUp);

    const now = degreesBetween(cartUp, riderUp);
    // What it was before the fix: the cart's up was plain world +Y.
    const before = degreesBetween(WORLD_UP, riderUp);
    if (now > worstNow) {
      worstNow = now;
      worstAt = d;
    }
    if (before > worstBefore) worstBefore = before;
  }
}

console.log(`\nrail race ring, ${route.length.toFixed(0)} m, four lanes, every metre:`);
console.log(`  cart up vs rider up, BEFORE the fix (cart held at world +Y): worst ${worstBefore.toFixed(2)}°`);
console.log(`  cart up vs rider up, AFTER  the fix (cart on rideFrame)    : worst ${worstNow.toFixed(3)}° at ${worstAt} m`);

// **A residual is expected, and the degrees are not the thing to judge it by.**
//
// The cart leans about the route's FLAT column, because that is the column the
// rails lean about (`route.pointAt` -> `placeOnSphere`) and the cart must match
// the rails before it matches anything else. The rider is leaned by
// `faceOnGround`, which reads her own world position — the seat, which has
// already slid outwards by the track's clearance times sin(tilt). Two nearby
// but different columns, so a small disagreement is structural rather than a
// bug, and it is largest at the rim where `up` swings fastest.
//
// What decides whether it matters is not the angle but how far it moves her
// hand, so that is what is asserted. `CART_HALF_WIDTH` 0.55 is the measured
// ceiling `check-rail-race.mts` refuses to let anyone raise.
const ARM_REACH = 0.35;
const swing = Math.sin((worstNow * Math.PI) / 180) * ARM_REACH;
const CART_HALF_WIDTH = 0.55;
console.log(
  `  worst residual moves a hand ${swing.toFixed(3)} m sideways at ${ARM_REACH} m of reach ` +
    `(the tub's half-width is ${CART_HALF_WIDTH} m)`,
);
if (swing > CART_HALF_WIDTH * 0.2) {
  console.error(
    `\nthe residual swings a hand ${swing.toFixed(3)} m, over a fifth of the tub's half-width — ` +
      'the cart and the rider are not being leaned about compatible columns.',
  );
  process.exit(1);
}
console.log('\nthe tub and the child in it lean together');
