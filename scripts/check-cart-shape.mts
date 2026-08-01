/**
 * **Are the Rail Race cart's wheels actually visible, on the actual built cart?**
 *
 * ```
 * npm run check:cart-shape
 * ```
 *
 * The bug this guards against: the previous, procedural cart's tub was wider
 * and reached lower than the wheel positions, so the tub's own side walls and
 * floor covered essentially the entire wheel from any angle — confirmed by
 * reading the real mesh bounding boxes in the live game, not by re-deriving
 * the generator's own formula (`HANDOFF-rail-cart-blender-asset.md`). Two
 * earlier passes on this cart each looked correct as a set of numbers and
 * were not; this check exists so "the numbers agree with each other" is
 * asserted by a machine rather than by a reviewer eyeballing a diff.
 *
 * Three techniques, all from `ART-AGENT-NOTES.md` §6, and all run against
 * `createCart()` itself — the exact runtime factory, not a copy of its
 * numbers:
 *
 * 1. **Ray-cast from outside.** The same technique that found the invisible
 *    hood faces: a ray honours `material.side` exactly as the rasteriser
 *    does, so it is blind to the same things the camera would be. One ray per
 *    wheel, from outside the cart at the wheel's own axle height, must hit
 *    that wheel — not the tub — first.
 * 2. **Measure the built mesh's real world-space bounds**, not the constants
 *    that were supposed to produce them, and assert the wheel's bottom and
 *    outer edge actually clear the tub's.
 * 3. **The rail gauge and seat height are cross-checked against their own
 *    single source of truth** (`RAIL_GAUGE`, `SEAT_HEIGHT`) rather than
 *    against a second copy of the same number.
 *
 * A fourth thing, not a shape question but a real bug this asset move
 * introduced and fixed in the same pass: every cart used to build its own
 * private geometry, so `CartHandle.dispose()` freeing it outright was safe.
 * Now four carts (and every future one) share one set of buffers
 * (`cartAsset.ts`, `markShared`), so `dispose()` was switched to
 * `disposeTree`, which skips anything `markShared` marked. A geometry a
 * WebGL renderer has already freed still reads back fine from plain JS —
 * `.dispose()` only fires an event the renderer listens for — so this can't
 * be caught by re-reading buffer contents in Node; what *can* be checked
 * headlessly is the precondition `disposeTree` relies on.
 */
import { Box3, Mesh, Raycaster, Vector3 } from 'three';
import { createCart, WHEEL_RADIUS, SEAT_HEIGHT, CART_PARTS } from '../src/world/railRace/cart.ts';
import { cartAssetPart, cartAssetGeometry, cartAssetPartNames } from '../src/art/models/cartAsset.ts';
import { isShared } from '../src/art/style/materials.ts';
import { RAIL_GAUGE } from '../src/world/railRace/track.ts';
import { RIDE_SCALE } from '../src/world/railRace/route.ts';

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

const tub = findMesh('tub');
tub.updateWorldMatrix(true, false);
const tubBox = new Box3().setFromObject(tub);

// --- real world-space bounds: does the wheel actually clear the tub? --------
//
// A wheel's own X extent (after the `rotation.z = PI/2` "lay it on its side"
// idiom every wheel in this game uses) is only its tyre *thickness*, not its
// radius — the radius shows up in Y (height) and Z (fore-aft), which is
// exactly what makes it read as a disc when viewed from the side. Verified
// directly against the dodgem car's own already-shipped wheel (same idiom,
// same geometry shape): its rotated world bounds are ~0.09 m either side of
// its axle in X against a 0.2 m radius, so "does the wheel reach past the
// tub sideways in X" is not the question that matters here — a real cart's
// wheels are visible poking out *below* the carriage, not overhanging its
// width. The two checks that do measure the real thing: vertical floor
// clearance, and a ray-cast from the side at axle height (this ride's own
// camera is a side-on rig — see `camera.ts` — so that is the representative
// angle, not an arbitrary one).
for (const name of ['wheel-fl', 'wheel-fr', 'wheel-bl', 'wheel-br'] as const) {
  const wheel = findMesh(name);
  wheel.updateWorldMatrix(true, false);
  const wheelBox = new Box3().setFromObject(wheel);

  assert(
    wheelBox.min.y < tubBox.min.y - WHEEL_RADIUS * 0.4,
    `${name}'s bottom sits well below the tub's own floor ` +
      `(wheel bottom ${wheelBox.min.y.toFixed(3)}, tub floor ${tubBox.min.y.toFixed(3)})`,
  );

  // Ray-cast from outside, at the wheel's own axle height — the same
  // technique that found the invisible hood faces (ART-AGENT-NOTES.md §6):
  // a ray is blind to exactly what the rasteriser is blind to.
  const side = Math.sign(wheel.position.x);
  const origin = new Vector3(side * 10, WHEEL_RADIUS, wheel.position.z);
  const direction = new Vector3(-side, 0, 0);
  const ray = new Raycaster(origin, direction, 0, 20);
  const hits = ray.intersectObjects(cart.root.children, true);
  const first = hits[0]?.object;
  assert(
    first !== undefined && first.name === name,
    `a ray from outside at ${name}'s own axle height hits ${name} first ` +
      `(actually hit: ${first ? first.name || '(unnamed)' : 'nothing'})`,
  );
}

cart.dispose();

if (failures > 0) {
  console.error(`\n✗ check:cart-shape — ${failures} failure(s).\n`);
  process.exit(1);
}
console.log(`\n✓ check:cart-shape — the cart's wheels are genuinely visible.\n`);
