import { Mesh, type BufferGeometry, type Material } from 'three';
import { CART_GLB_BASE64 } from '../assets/cartGlb';
import { base64ToArrayBuffer, readGlbParts, type GlbPart } from '../style/glb';
import { markShared } from '../style/materials';
import type { CartPart } from '../../world/railRace/cart';

/**
 * The Rail Race cart's authored geometry, read once at module load.
 *
 * The **second** asset through the pipeline `art/models/kidAsset.ts` and
 * `ART-AGENT-NOTES.md` §6a established for the player kid — see
 * `HANDOFF-rail-cart-blender-asset.md` for why this cart in particular needed
 * it: the tub's own procedural dimensions had drifted wide and deep enough to
 * bury every wheel behind its own walls and floor, twice, in two separate
 * hand-tuned-TypeScript passes that each looked right on paper. Modelling it
 * once in Blender, against the same reference numbers (`WHEEL_RADIUS`, the
 * rail gauge, `SEAT_HEIGHT`) `cart.ts` already exposes, replaces "get four
 * numbers to agree by eye" with "there is only one file that says where a
 * wheel is."
 *
 * Unlike the kid, this asset has no procedural Stage A to stay parity-checked
 * against — `art/blend/cart.blend` is the authoring source from the start
 * (see `art/blend/cart_export.py`).
 *
 * Shared, on the same reasoning as `kidAsset.ts`: one geometry per part for
 * the whole game (four carts on the ring at once, all sharing these buffers),
 * `markShared` so `disposeTree` leaves them alone when any one cart is torn
 * down.
 */
const parts: Map<string, GlbPart> = readGlbParts(base64ToArrayBuffer(CART_GLB_BASE64));

for (const part of parts.values()) markShared(part.geometry);

/** One authored part, by name. Throws rather than returning a hole. */
export function cartAssetPart(name: CartPart): GlbPart {
  const part = parts.get(name);
  if (!part) {
    throw new Error(
      `cartAsset: the asset has no part named '${name}'. Either \`CART_PARTS\` has ` +
        `grown and \`npm run blend:cart\` has not been re-run, or a node lost its name ` +
        `on the way through Blender.`,
    );
  }
  return part;
}

/** Every part name the asset actually contains — for checks, not for the game. */
export function cartAssetPartNames(): readonly string[] {
  return [...parts.keys()];
}

/** The authored geometry for one part. Shared: never mutate it. */
export function cartAssetGeometry(name: CartPart): BufferGeometry {
  return cartAssetPart(name).geometry;
}

/**
 * A mesh of one authored part, placed where the asset says it goes.
 *
 * The transform comes from the asset as well as the shape — the part's shape
 * and where it sits are one decision, made once in Blender, rather than a
 * shape in one place and a hand-picked position in another that has to keep
 * agreeing with it. That is exactly the shape of bug this asset replaces.
 */
export function cartAssetMesh(name: CartPart, material: Material): Mesh {
  const part = cartAssetPart(name);
  const mesh = new Mesh(part.geometry, material);
  mesh.name = name;
  mesh.position.copy(part.position);
  mesh.quaternion.copy(part.quaternion);
  mesh.scale.copy(part.scale);
  return mesh;
}
