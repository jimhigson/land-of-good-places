import { ConeGeometry, Group, Mesh, SphereGeometry } from 'three';
import { PALETTE } from '../../core/palette';
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

  const wrapColour = WRAP_COLOURS[seed % WRAP_COLOURS.length] ?? PALETTE.markerLilac;
  const wrapMaterial = toonMaterial(wrapColour);
  const foilMaterial = toonMaterial(PALETTE.buildingWall);

  const bodyHeight = 0.16;

  const body = solid(new Mesh(new SphereGeometry(0.075, 14, 10), wrapMaterial));
  body.scale.set(1, 0.62, 0.62);
  body.position.y = bodyHeight;
  body.rotation.z = Math.PI / 2;
  root.add(body);
  addOutline(body, 0.008);

  for (const side of [-1, 1] as const) {
    const twist = solid(new Mesh(new ConeGeometry(0.052, 0.075, 8), foilMaterial));
    twist.position.set(side * 0.095, bodyHeight, 0);
    twist.rotation.z = side * (Math.PI / 2 - 0.5);
    twist.scale.set(1, 1, 0.55);
    root.add(twist);
  }

  return {
    root,
    height: bodyHeight + 0.05,
  };
}
