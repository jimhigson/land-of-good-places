/**
 * **`check:stall-shape`** — the seven market stalls are different from each
 * other, and every one of them fits (issue #444).
 *
 * ## Why this exists at all
 *
 * `check:shop-spacing` owns where the stalls *stand*: the aisle, the queue
 * room, the seating plan. It says nothing about their shape, because until #444
 * they had only one shape between them. Now each stall builds its own canopy
 * and stands a giant piece of its own stock on top, and that introduces exactly
 * two ways to break the market — grow *up* through the ceiling, or grow
 * *sideways* into the aisle a child walks down. Both are invisible in a diff
 * and both are obvious in the game a day later.
 *
 * ## Measure the stall that was built, never the rules that built it
 *
 * Every number below is read off a real `THREE.Object3D` — each mesh's own
 * geometry bounds put through its own world matrix, and each `InstancedMesh`'s
 * bounds put through **every one of its instance matrices**, which is the part
 * that is easy to get wrong: an instanced mesh's `matrixWorld` is the *base*
 * transform, so measuring it alone reports a stack of slats sitting at the
 * origin and passes about nothing. The thresholds come from the game
 * (`CASTLE_CEILING_CLEAR`, `MARKET_STALL`, `PLAYER_RADIUS`), never from
 * `stallShape.ts`'s own intentions.
 *
 * ## The clauses
 *
 * 1. **Nothing reaches the ceiling.** A stall is built inside a group scaled by
 *    `SHOP_SCALE_XZ` across and `shopScaleY` up, so this measures world metres
 *    above the deck, not the local numbers the module writes down.
 * 2. **Nothing a child could walk into leaves the footprint.** Canopies may
 *    overhang — she walks under an awning — so the test is applied below head
 *    height, which is where a body is. Above that, the limit is the neighbour.
 * 3. **A canopy does not meet the next stall's canopy.** Two awnings that touch
 *    turn an aisle into a tunnel and hide the stock from a camera at 38°.
 * 4. **The seven are actually different.** The regression this whole ticket is
 *    about was not a stall that broke; it was seven stalls that quietly became
 *    one. So: no two stalls may share a canopy kind, and every stall must carry
 *    something a child can name — a distinct outline, not just a colour. A
 *    check that could not have caught the original bug is not worth writing.
 *
 * Run: `pnpm run check:stall-shape`
 */
import './headless-canvas.mjs';
import { Box3, InstancedMesh, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import { PLAYER_RADIUS } from '../src/core/constants.ts';
import { KID_HEIGHT } from '../src/art/models/kid.ts';
import { CASTLE_CEILING_CLEAR } from '../src/world/building/castleFabric.ts';
import {
  MARKET_PITCH_X,
  MARKET_STALL,
  SHOP_SCALE_XZ,
  SHOP_UNITS,
  shopHasForecourt,
  shopScaleY,
} from '../src/world/building/layout.ts';
import { STALL_STYLES, buildStallDress } from '../src/world/building/shops/stallShape.ts';
import type { ShopId } from '../src/world/building/shops/catalogue.ts';

let failures = 0;
const fail = (message: string): void => {
  console.error(`FAIL: ${message}`);
  failures += 1;
};

/**
 * A world-space box round everything drawn in `root`, **including every
 * instance of every `InstancedMesh`**.
 *
 * `Box3.setFromObject` handles instanced meshes in recent three.js, but only if
 * the geometry has a bounding box and the instance matrices have been flushed;
 * doing it by hand here means the check cannot be quietly weakened by a version
 * bump, and the ceiling clause is the one thing standing between a stall and
 * the slab above it.
 */
function measure(root: Object3D, scale: Vector3): Box3 {
  root.scale.copy(scale);
  root.updateWorldMatrix(true, true);
  const box = new Box3();
  const instance = new Matrix4();
  const corner = new Vector3();
  root.traverse((object) => {
    const mesh = object as Mesh | InstancedMesh;
    if (!mesh.isMesh && !(mesh as InstancedMesh).isInstancedMesh) return;
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    if (!bounds) return;
    const instanced = mesh as InstancedMesh;
    const count = instanced.isInstancedMesh ? instanced.count : 1;
    for (let index = 0; index < count; index += 1) {
      if (instanced.isInstancedMesh) instanced.getMatrixAt(index, instance);
      else instance.identity();
      instance.premultiply(mesh.matrixWorld);
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            box.expandByPoint(corner.set(x, y, z).applyMatrix4(instance));
          }
        }
      }
    }
  });
  return box;
}

const HALF_FOOTPRINT = MARKET_STALL / 2;
/**
 * How high off the deck a body reaches. Below this, nothing may overhang.
 *
 * `KID_HEIGHT` from the model itself rather than a number that looked right —
 * she is 2.12 m, which is a lot for a six-year-old and exactly why a canopy
 * that a grown-up eye reads as "high up" is not.
 */
const HEAD_HEIGHT = KID_HEIGHT;

console.log(
  `Ceiling ${CASTLE_CEILING_CLEAR.toFixed(2)} m, stall footprint ${MARKET_STALL.toFixed(2)} m ` +
    `square, pitch along a row ${MARKET_PITCH_X.toFixed(2)} m\n`,
);

interface Measured {
  readonly id: string;
  readonly box: Box3;
}
const measured: Measured[] = [];

for (const unit of SHOP_UNITS) {
  const scale = new Vector3(SHOP_SCALE_XZ, shopScaleY(unit), SHOP_SCALE_XZ);
  const box = measure(buildStallDress(unit), scale);
  measured.push({ id: unit.id, box });

  // A recessed stall's deck is `SHOP_RECESS_DEPTH` below the room's, which buys
  // it that much more headroom. None on the mall has one, and the clause says so
  // rather than assuming it.
  const headroom = CASTLE_CEILING_CLEAR + (shopHasForecourt(unit) ? 0.3 : 0);
  const style = STALL_STYLES[unit.id as ShopId];
  console.log(
    `  ${unit.id.padEnd(12)} ${style?.canopy.padEnd(9) ?? '?'} ` +
      `top ${box.max.y.toFixed(2)} m  ` +
      `x ±${Math.max(-box.min.x, box.max.x).toFixed(2)}  ` +
      `z [${box.min.z.toFixed(2)}, ${box.max.z.toFixed(2)}]`,
  );

  // 1. Nothing reaches the ceiling.
  if (box.max.y >= headroom) {
    fail(
      `${unit.id} reaches ${box.max.y.toFixed(2)} m and the ceiling is at ${headroom.toFixed(2)} m`,
    );
  }

  // 2. Nothing below head height leaves the footprint. Measured on the geometry
  //    below `HEAD_HEIGHT` only, which is why each mesh is re-measured rather
  //    than the whole-stall box being reused: a canopy at 2.2 m may overhang and
  //    a crate at 0.4 m may not.
  const low = new Box3();
  const instance = new Matrix4();
  const corner = new Vector3();
  const dress = buildStallDress(unit);
  dress.scale.copy(scale);
  dress.updateWorldMatrix(true, true);
  dress.traverse((object) => {
    const mesh = object as Mesh | InstancedMesh;
    if (!mesh.isMesh && !(mesh as InstancedMesh).isInstancedMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox;
    if (!bounds) return;
    const instanced = mesh as InstancedMesh;
    const count = instanced.isInstancedMesh ? instanced.count : 1;
    for (let index = 0; index < count; index += 1) {
      if (instanced.isInstancedMesh) instanced.getMatrixAt(index, instance);
      else instance.identity();
      instance.premultiply(mesh.matrixWorld);
      const part = new Box3();
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            part.expandByPoint(corner.set(x, y, z).applyMatrix4(instance));
          }
        }
      }
      if (part.min.y < HEAD_HEIGHT) low.union(part);
    }
  });
  const reach = Math.max(-low.min.x, low.max.x, -low.min.z, low.max.z);
  if (reach > HALF_FOOTPRINT + 1e-6) {
    fail(
      `${unit.id} puts something a child walks into ${reach.toFixed(2)} m from its centre; the ` +
        `footprint is ${HALF_FOOTPRINT.toFixed(2)} m and the rest is aisle`,
    );
  }
}

// 3. Canopies must not meet across the pitch.
{
  const widest = measured.reduce(
    (best, m) => Math.max(best, -m.box.min.x, m.box.max.x),
    0,
  );
  const gap = MARKET_PITCH_X - widest * 2;
  if (gap < 2 * PLAYER_RADIUS) {
    fail(
      `the widest canopy is ${(widest * 2).toFixed(2)} m across, leaving ${gap.toFixed(2)} m ` +
        `between neighbours — a child is ${(2 * PLAYER_RADIUS).toFixed(2)} m across and the gap ` +
        `between two stalls should not be a tunnel`,
    );
  } else {
    console.log(`\n  widest canopy ${(widest * 2).toFixed(2)} m; ${gap.toFixed(2)} m to the next stall`);
  }
}

// 4. And the point of the whole ticket: they are not all the same.
{
  const kinds = new Set<string>();
  const named: string[] = [];
  for (const unit of SHOP_UNITS) {
    const style = STALL_STYLES[unit.id as ShopId];
    if (!style) {
      fail(`${unit.id} has no stall style, so it falls back to another shop's shape`);
      continue;
    }
    if (kinds.has(style.canopy)) {
      fail(
        `${unit.id} wears a '${style.canopy}' canopy and so does another stall — the regression ` +
          `#444 is about is seven shops sharing one outline`,
      );
    }
    kinds.add(style.canopy);
    named.push(`${unit.id}=${style.canopy}${style.emblem === 'none' ? '' : `+${style.emblem}`}`);
  }
  console.log(`  ${kinds.size} distinct canopies for ${SHOP_UNITS.length} stalls`);
  console.log(`  ${named.join(', ')}`);
}

console.log(
  failures === 0
    ? `\nPASS: ${SHOP_UNITS.length} stalls, all different, all under the ceiling and inside the aisle.`
    : `\n${failures} FAILURE(S)`,
);
process.exit(failures === 0 ? 0 : 1);
