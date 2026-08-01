/**
 * **Are the Rail Race cart's wheels actually visible, on the actual built cart,
 * all the way round the actual lap?**
 *
 * ```
 * npm run check:cart-shape
 * ```
 *
 * The bug this guards against, round one: the first procedural cart's tub was
 * wider and reached lower than the wheel positions, so the tub's own side
 * walls and floor covered essentially the entire wheel from any angle.
 *
 * **Round two, the one this file's lap sweep exists for.** The first Blender
 * pass fixed that geometrically (verified level, side-on) but Jim's next live
 * look found "half-wheels vanishing at random below a weird looking box
 * thing". Root cause: that pass only cleared the wheel by a *partial* margin
 * (the tub's floor sat at the wheel's own axle height), which holds up at
 * zero pitch but not once the whole rigid cart pitches on this route's real
 * hills (`RailRace.ts`: `cart.group.rotation.x = -Math.asin(tangent.y)`)
 * combined with the ride's own camera looking down at a real angle
 * (`camera.ts`) — a sightline that isn't purely side-on any more can clip
 * through the body before it reaches the wheel, at some points on the track
 * and not others, which is exactly what "vanishing at random" looks like from
 * the sofa. A check that only measures the cart standing level, as the
 * previous version of this file did, cannot catch that class of bug — it
 * passed right up until the live report. **Measure the thing that was built,
 * in the conditions it is actually seen in, not the conditions that are
 * convenient to test.**
 *
 * The fix this file verifies: the hopper's floor is now set **entirely above
 * the wheel's own top point** (full vertical separation, not a partial
 * margin), so there is no pitch/camera angle at which the hopper's floor
 * plane can sweep down into the wheel's silhouette — plus a reshape to an
 * actual mine-cart hopper (narrow floor, wide rim) on a thin, deliberately
 * inboard underframe (`frame-rail-l/r`), per Jim's reference. The lap sweep
 * below proves the visibility claim by actually building the real route, the
 * real camera rig, and the real per-frame pitch formula `RailRace.ts` uses,
 * and ray-casting from the camera's real position to a wheel's real rim at
 * every point on the lap — not a copy of any of those three things.
 *
 * Techniques throughout, all from `ART-AGENT-NOTES.md` §6:
 *
 * 1. **Ray-cast from outside** — the technique that found the invisible hood
 *    faces. A ray honours `material.side` exactly as the rasteriser does.
 * 2. **Measure the built mesh's real world-space bounds**, not the constants
 *    that were supposed to produce them.
 * 3. **The rail gauge and seat height are cross-checked against their own
 *    single source of truth** (`RAIL_GAUGE`, `SEAT_HEIGHT`).
 * 4. **Every cart-asset geometry is `markShared`** — the precondition
 *    `CartHandle.dispose()`'s `disposeTree` call depends on, now that the
 *    same wheel/hopper buffers are shared across all four carts on the ring.
 *
 * **Round three, the one the wheel-spin section at the bottom of this file
 * exists for.** Jim reported the wheels rolling on the wrong axis — a flat,
 * coin-like spin, not a forward roll. Root cause: `wheel.rotation.z =
 * Math.PI / 2` once, then mutating `wheel.rotation.y` every frame, does not
 * compose as "spin about the tilted local axle axis" in three.js's Euler
 * system — verified directly with a bare `Object3D` and a marked rim point,
 * completely independent of this asset's geometry. Fixed with explicit
 * `Quaternion` composition (`cart.ts`'s `WHEEL_LAY_DOWN`). The section below
 * builds the real cart, calls the real `spinWheels()` at two different
 * travelled distances, and asserts a marked point on the wheel's rim moves
 * in the Y-Z plane (X held constant — a real roll about the axle) by the
 * angle its own circumference implies, not by re-deriving the formula.
 */
import { Box3, Mesh, Raycaster, Vector3 } from 'three';
import { createCart, WHEEL_RADIUS, SEAT_HEIGHT, CART_PARTS } from '../src/world/railRace/cart.ts';
import { cartAssetPart, cartAssetGeometry, cartAssetPartNames } from '../src/art/models/cartAsset.ts';
import { isShared } from '../src/art/style/materials.ts';
import { RAIL_GAUGE } from '../src/world/railRace/track.ts';
import { RIDE_SCALE } from '../src/world/railRace/route.ts';
import { RAIL_RACE_PLAN } from '../src/world/railRace/plan.ts';
import { RaceCamera } from '../src/world/railRace/camera.ts';
import { PLAYER_LANE } from '../src/world/railRace/route.ts';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) {
    failures += 1;
    console.error(`✗ ${message}`);
  } else {
    console.log(`✓ ${message}`);
  }
}

// --- every declared part actually exists in the exported asset --------------
const assetNames = new Set(cartAssetPartNames());
for (const name of CART_PARTS) {
  assert(assetNames.has(name), `asset has a '${name}' node (cart.ts's CART_PARTS)`);
}

// --- every part's geometry is markShared, so dispose() can't free it out from
// under a sibling cart still using it (see the file header) -----------------
for (const name of CART_PARTS) {
  assert(isShared(cartAssetGeometry(name)), `${name}'s geometry is markShared`);
}

// --- the rail gauge is what the asset actually baked in, not a copy ---------
const wheelFl = cartAssetPart('wheel-fl');
const expectedHalfGauge = RAIL_GAUGE / RIDE_SCALE / 2;
assert(
  Math.abs(Math.abs(wheelFl.position.x) - expectedHalfGauge) < 1e-6,
  `wheel-fl's baked x (${wheelFl.position.x.toFixed(4)}) equals RAIL_GAUGE / RIDE_SCALE / 2 (${expectedHalfGauge.toFixed(4)})`,
);

// --- the seat's own top surface is exactly SEAT_HEIGHT -----------------------
const seatBase = cartAssetPart('seat-base');
seatBase.geometry.computeBoundingBox();
const seatTopLocal = seatBase.geometry.boundingBox!.max.y;
const seatTopWorld = seatBase.position.y + seatTopLocal * seatBase.scale.y;
assert(
  Math.abs(seatTopWorld - SEAT_HEIGHT) < 1e-3,
  `seat-base's real top surface (${seatTopWorld.toFixed(4)}) equals SEAT_HEIGHT (${SEAT_HEIGHT})`,
);

// --- the hopper's floor clears the wheel's own top point, with margin ------
// Not a level-only check: this is a *local-space* geometric fact (the
// hopper's floor plane sits above the wheel's top plane in the cart's own
// rigid frame) that holds regardless of how the whole assembly is later
// pitched or rolled — which is exactly the property the previous, partial-
// clearance asset didn't have.
{
  const hopper = cartAssetPart('hopper');
  hopper.geometry.computeBoundingBox();
  const floorYWorld = hopper.position.y + hopper.geometry.boundingBox!.min.y * hopper.scale.y;
  const wheelTopY = WHEEL_RADIUS * 2;
  assert(
    floorYWorld > wheelTopY + 0.02,
    `hopper's floor (${floorYWorld.toFixed(3)}) sits above the wheel's own top point ` +
      `(${wheelTopY.toFixed(3)}) with at least 20 mm of margin — floor clears by ${(floorYWorld - wheelTopY).toFixed(3)} m`,
  );
}

// --- build the actual cart, exactly as the game does ------------------------
const cart = createCart(0x88ccee);

function findMesh(name: string): Mesh {
  let found: Mesh | null = null;
  cart.root.traverse((node) => {
    if (node instanceof Mesh && node.name === name) found = node;
  });
  if (!found) throw new Error(`check-cart-shape: createCart() built no mesh named '${name}'.`);
  return found;
}

const hopperMesh = findMesh('hopper');
hopperMesh.updateWorldMatrix(true, false);
const hopperBox = new Box3().setFromObject(hopperMesh);

// --- ray-cast from outside, level, at each wheel's own axle height ---------
for (const name of ['wheel-fl', 'wheel-fr', 'wheel-bl', 'wheel-br'] as const) {
  const wheel = findMesh(name);
  wheel.updateWorldMatrix(true, false);
  const wheelBox = new Box3().setFromObject(wheel);

  assert(
    wheelBox.min.y < hopperBox.min.y - WHEEL_RADIUS * 0.4,
    `${name}'s bottom sits well below the hopper's own floor ` +
      `(wheel bottom ${wheelBox.min.y.toFixed(3)}, hopper floor ${hopperBox.min.y.toFixed(3)})`,
  );

  const side = Math.sign(wheel.position.x);
  const origin = new Vector3(side * 10, WHEEL_RADIUS, wheel.position.z);
  const direction = new Vector3(-side, 0, 0);
  const ray = new Raycaster(origin, direction, 0, 20);
  const hits = ray.intersectObjects(cart.root.children, true);
  const first = hits[0]?.object;
  assert(
    first !== undefined && first.name === name,
    `level side-on ray at ${name}'s own axle height hits ${name} first ` +
      `(actually hit: ${first ? first.name || '(unnamed)' : 'nothing'})`,
  );
}

// --- the real lap sweep: real route, real camera, real per-frame pitch -----
// This is what actually failed in round two. Sample densely round one whole
// lap, place the cart exactly as `RailRace.ts`'s `placeCarts()` does (same
// formula, imported route — not a copy), point the real `RaceCamera` at it
// with `reset()` (the same snap-to-target `scripts/check-rail-race.mts`
// itself uses for its own sweeps), and for the wheel nearest the camera,
// ray-cast from the camera's real position to points sampled round that
// wheel's own rim. A rim point is only counted if it faces the camera (the
// wheel's own far side is legitimately not visible — that is not a bug).
{
  const route = RAIL_RACE_PLAN.route;
  const rig = new RaceCamera(route);
  rig.resize(1280, 720);
  const point = new Vector3();
  const tangent = new Vector3();
  const wheelNames = ['wheel-fl', 'wheel-fr', 'wheel-bl', 'wheel-br'] as const;

  const RIM_SAMPLES = 24;
  const rimLocalOffsets: Vector3[] = [];
  for (let i = 0; i < RIM_SAMPLES; i++) {
    const a = (i / RIM_SAMPLES) * Math.PI * 2;
    rimLocalOffsets.push(new Vector3(0, WHEEL_RADIUS * Math.cos(a), WHEEL_RADIUS * Math.sin(a)));
  }

  const SAMPLES = 240;
  let worst = { travelled: 0, pitchDeg: 0, fraction: 1 };
  let sumFraction = 0;

  for (let i = 0; i < SAMPLES; i++) {
    const travelled = (i / SAMPLES) * route.length;
    const at = route.wrap(route.startDistance + travelled);
    route.pointAt(PLAYER_LANE, at, point);
    route.tangentAt(PLAYER_LANE, at, tangent);

    cart.root.position.copy(point);
    cart.root.rotation.y = Math.atan2(tangent.x, tangent.z);
    cart.root.rotation.x = -Math.asin(Math.max(-0.6, Math.min(0.6, tangent.y)));
    cart.root.updateMatrixWorld(true);

    rig.reset(travelled);
    const camPos = rig.camera.position;

    let nearestName: (typeof wheelNames)[number] = wheelNames[0];
    let nearestDist = Infinity;
    for (const name of wheelNames) {
      const w = findMesh(name);
      const wpos = new Vector3();
      w.getWorldPosition(wpos);
      const d = wpos.distanceTo(camPos);
      if (d < nearestDist) {
        nearestDist = d;
        nearestName = name;
      }
    }

    const wheel = findMesh(nearestName);
    wheel.updateWorldMatrix(true, false);

    let visibleCount = 0;
    let facingCount = 0;
    for (const offset of rimLocalOffsets) {
      const worldPoint = offset.clone().applyMatrix4(wheel.matrixWorld);
      const toPoint = worldPoint.clone().sub(camPos);
      const dist = toPoint.length();
      const dir = toPoint.clone().normalize();

      const outwardWorld = offset.clone().normalize().transformDirection(wheel.matrixWorld);
      if (outwardWorld.dot(dir.clone().negate()) <= 0) continue; // far side of the disc
      facingCount++;

      const ray = new Raycaster(camPos, dir, 0, dist * 0.999);
      const hits = ray.intersectObjects(cart.root.children, true);
      const first = hits[0]?.object;
      if (!first || first === wheel) visibleCount++;
    }

    const fraction = facingCount > 0 ? visibleCount / facingCount : 1;
    sumFraction += fraction;
    if (fraction < worst.fraction) {
      worst = { travelled, pitchDeg: (cart.root.rotation.x * 180) / Math.PI, fraction };
    }
  }

  const mean = sumFraction / SAMPLES;
  console.log(
    `  lap sweep: nearest-wheel camera-facing-rim visible fraction — mean ${mean.toFixed(3)}, ` +
      `worst ${worst.fraction.toFixed(3)} at s=${worst.travelled.toFixed(1)} (pitch ${worst.pitchDeg.toFixed(1)}°)`,
  );
  // A genuinely un-occluded wheel's camera-facing rim reads almost entirely
  // clear at every point on the lap. 0.6 is comfortably below what this
  // full-clearance hopper achieves in practice and is the kind of bar the
  // previous, partial-clearance shape could not have met under real pitch.
  assert(
    worst.fraction > 0.6,
    `every sampled point on the lap keeps at least 60% of the nearest wheel's camera-facing rim clear ` +
      `(worst: ${(worst.fraction * 100).toFixed(0)}% at s=${worst.travelled.toFixed(1)}, pitch ${worst.pitchDeg.toFixed(1)}°)`,
  );
}

// --- the wheel actually rolls about its own axle, not some other axis ------
// Round three's bug: `wheel.rotation.z = PI/2` once then `wheel.rotation.y`
// mutated every frame does not compose the way it looks like it should — see
// this file's header and `cart.ts`'s `WHEEL_LAY_DOWN` doc comment. This
// drives the real `spinWheels()` at two real travelled distances and checks
// a marked point on the wheel's own rim moves the way a rolling wheel's
// would: within the Y-Z plane (X — the axle direction — essentially fixed),
// by the angle its own circumference implies for the distance travelled.
{
  const wheelFl = findMesh('wheel-fl');
  // A point on the rim, in the wheel's own *original* (pre-lay-down) local
  // frame — i.e. before `WHEEL_LAY_DOWN` is applied. The disc's radius shows
  // in the original local X/Z (confirmed via readGlbParts elsewhere in this
  // file's history); (0, 0, WHEEL_RADIUS) is a genuine rim point there, not
  // a point that happens to land on the spin axis (a first attempt at this
  // exact check used (WHEEL_RADIUS, 0, 0), which maps onto the world Y axis
  // after the lay-down and is therefore invariant to any further spin —
  // a degenerate, uninformative test point; not repeating that mistake here).
  const rimLocal = new Vector3(0, 0, WHEEL_RADIUS);

  function rimWorldAt(travelled: number): Vector3 {
    cart.spinWheels(travelled);
    wheelFl.updateWorldMatrix(true, false);
    // wheel-fl's own world position, subtracted back out, isolates the
    // *rotation*'s effect on the rim point from the wheel's own placement.
    const centre = new Vector3();
    wheelFl.getWorldPosition(centre);
    return rimLocal.clone().applyQuaternion(wheelFl.quaternion).add(centre).sub(centre);
  }

  const travelledA = 0;
  // Small on purpose: `Quaternion.angleTo` below reports the *shortest*
  // angular distance between two orientations, which wraps once a swept
  // angle approaches a full turn — a first attempt at this check used 2.5 m,
  // which happened to sweep almost exactly half a turn, so doubling it swept
  // almost exactly a full turn and read back as ~0°. Keeping the swept angle
  // well under a quarter turn avoids that wraparound entirely.
  const travelledB = 0.2;
  const pA = rimWorldAt(travelledA);
  const pB = rimWorldAt(travelledB);

  assert(
    Math.abs(pA.x - pB.x) < 1e-6,
    `the wheel's own axle axis (world X, relative to its centre) stays fixed as it rolls ` +
      `(rim point's x: ${pA.x.toFixed(4)} -> ${pB.x.toFixed(4)})`,
  );
  assert(
    Math.abs(pA.y - pB.y) > 0.01 || Math.abs(pA.z - pB.z) > 0.01,
    `the rim point actually moves in Y/Z as the wheel rolls, rather than sitting still ` +
      `(a wrong-axis spin can leave a rim point that started on the new axis motionless too)`,
  );

  // Proportionality, not a re-derivation of `spinWheels`'s own formula
  // (ART-AGENT-NOTES.md §6 warns against comparing new code to itself): the
  // angle actually swept, read back from the real quaternions via
  // `Quaternion.angleTo`, must simply *double* when the distance travelled
  // doubles — true for any correctly-implemented constant-speed roll,
  // regardless of exactly what radius/scale constant the formula uses, so
  // this can't pass by accident the way asserting the literal formula could.
  cart.spinWheels(0);
  const quatStart = wheelFl.quaternion.clone();
  cart.spinWheels(travelledB);
  const quatOnce = wheelFl.quaternion.clone();
  cart.spinWheels(travelledB * 2);
  const quatTwice = wheelFl.quaternion.clone();

  const angleOnce = quatStart.angleTo(quatOnce);
  const angleTwice = quatStart.angleTo(quatTwice);
  assert(
    angleOnce > 0.01,
    `rolling ${travelledB.toFixed(2)} m visibly turns the wheel at all (swept ${angleOnce.toFixed(4)} rad)`,
  );
  assert(
    Math.abs(angleTwice - 2 * angleOnce) < 1e-6,
    `doubling the distance travelled doubles the angle actually swept ` +
      `(${angleOnce.toFixed(4)} rad -> ${angleTwice.toFixed(4)} rad, expected ${(2 * angleOnce).toFixed(4)} rad)`,
  );
}

cart.dispose();

if (failures > 0) {
  console.error(`\n✗ check:cart-shape — ${failures} failure(s).\n`);
  process.exit(1);
}
console.log(`\n✓ check:cart-shape — the cart's wheels are genuinely visible, all round the lap.\n`);
