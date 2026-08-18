import { ConeGeometry, Group, Mesh, SphereGeometry } from 'three';
import { PALETTE } from '../../core/palette';
import { visibleBounds } from '../../art/style/measure';
import { addOutline, solid, toonMaterial } from '../../art/style/materials';
import type { AssetHandle } from '../../art/style/asset';

/**
 * The candy the Spooky House's mouth pours out.
 *
 * A classic wrapped sweet: a squashed lozenge body with a twisted foil paper
 * pinch at each end. Small (≤ 0.16 m), origin at the base, facing +Z — the same
 * contract as every other catalogue prop (`art/models/shopItems.ts` is the
 * closest sibling to copy from), so it drops straight into the backpack peek,
 * the held-item anchor and a shop-style shelf without any special-casing.
 *
 * Lives here rather than in `art/models/` because it belongs to this mini-game
 * — the catalogue only imports the factory, it does not own the geometry.
 */

const WRAP_COLOURS = [
  PALETTE.markerLilac,
  PALETTE.markerMint,
  PALETTE.markerPink,
  PALETTE.markerLemon,
] as const;

/**
 * The sweet's shape, as numbers rather than as this file's `Mesh`es — the one
 * source of truth for "what shape is a wrapped sweet" shared with
 * `candyShower.ts`'s `buildSweetGeometry()`. That function cannot import
 * `createSpookyCandy` itself: it needs a merged, instance-ready
 * `BufferGeometry` for an `InstancedMesh`, and this factory builds a `Group`
 * of separate outlined `Mesh`es for one held/shelved item — a different
 * output for a different rendering need. So the shared thing is these
 * numbers, not the function; both files build their own geometry from the
 * same constants, and a shape change here only has one place to also change.
 */
export const SWEET_SHAPE = {
  bodyRadius: 0.075,
  bodySquashYZ: 0.62,
  twistRadius: 0.052,
  twistConeHeight: 0.075,
  twistOffsetX: 0.095,
  twistRotationZ: Math.PI / 2 - 0.5,
  twistSquashZ: 0.55,
} as const;

export function createSpookyCandy(seed = 0): AssetHandle {
  const root = new Group();
  root.name = 'prop.spookyCandy';
  // The sweet is drawn around `bodyHeight`, with nothing below it, so it used
  // to hang 77 mm clear of whatever it was put on — a shelf, the backpack peek,
  // a held-item anchor. `sweet` carries the drop onto the origin, measured
  // below, so the shape stays authored the way it reads here.
  const sweet = new Group();
  root.add(sweet);

  const wrapColour = WRAP_COLOURS[seed % WRAP_COLOURS.length] ?? PALETTE.markerLilac;
  const wrapMaterial = toonMaterial(wrapColour);
  const foilMaterial = toonMaterial(PALETTE.buildingWall);

  const bodyHeight = 0.16;

  const body = solid(
    new Mesh(new SphereGeometry(SWEET_SHAPE.bodyRadius, 14, 10), wrapMaterial),
  );
  body.scale.set(1, SWEET_SHAPE.bodySquashYZ, SWEET_SHAPE.bodySquashYZ);
  body.position.y = bodyHeight;
  body.rotation.z = Math.PI / 2;
  sweet.add(body);
  addOutline(body, 0.008);

  for (const side of [-1, 1] as const) {
    const twist = solid(
      new Mesh(
        new ConeGeometry(SWEET_SHAPE.twistRadius, SWEET_SHAPE.twistConeHeight, 8),
        foilMaterial,
      ),
    );
    twist.position.set(side * SWEET_SHAPE.twistOffsetX, bodyHeight, 0);
    twist.rotation.z = side * SWEET_SHAPE.twistRotationZ;
    twist.scale.set(1, 1, SWEET_SHAPE.twistSquashZ);
    sweet.add(twist);
  }

  // Origin at the base and the real tip, both from one measurement. The old
  // `bodyHeight + 0.05` was a guess at the lozenge's half-thickness: the body
  // is a sphere squashed on two axes and then turned on its side, so the radius
  // that ends up vertical is the unsquashed 0.075, plus its outline hull — not
  // the 0.05 somebody estimated. It declared 0.21 m and built 0.243 m.
  const { bottom, top } = visibleBounds(sweet);
  sweet.position.y = -bottom;

  return {
    root,
    height: top - bottom,
  };
}
