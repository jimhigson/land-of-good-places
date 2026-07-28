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

  const body = solid(new Mesh(new SphereGeometry(0.075, 14, 10), wrapMaterial));
  body.scale.set(1, 0.62, 0.62);
  body.position.y = bodyHeight;
  body.rotation.z = Math.PI / 2;
  sweet.add(body);
  addOutline(body, 0.008);

  for (const side of [-1, 1] as const) {
    const twist = solid(new Mesh(new ConeGeometry(0.052, 0.075, 8), foilMaterial));
    twist.position.set(side * 0.095, bodyHeight, 0);
    twist.rotation.z = side * (Math.PI / 2 - 0.5);
    twist.scale.set(1, 1, 0.55);
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
