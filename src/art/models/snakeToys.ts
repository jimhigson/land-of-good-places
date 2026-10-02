import { BoxGeometry, CylinderGeometry, Group, Mesh, SphereGeometry, Vector3 } from 'three';
import { PALETTE } from '../../core/palette';
import { ART } from '../style/artPalette';
import type { AssetHandle } from '../style/asset';
import { visibleTop } from '../style/measure';
import { addOutline, decal, markShared, solid, toonMaterial } from '../style/materials';
import { STRING_LENGTH } from './balloons';
import { createSnake } from './snake';

/**
 * **Scales & Tails' stock that is not a snake you keep** — the balloon and
 * the jelly snakes. (The plush is `snake.ts`'s `createNoodlePlush`, the hat
 * `hats.ts`'s `'snake'`, the pets `createPetSnake`.) Each follows the shop
 * contract its kind already has: a balloon's origin is the bottom of its
 * string, the knot the hand holds (`balloons.ts`); a treat's is its base.
 */

const BEAD = markShared(new SphereGeometry(1, 10, 8));

/** A long wobbly snake balloon on a string, 1.8 m of snake above the knot. */
export function createSnakeBalloon(): AssetHandle {
  const root = new Group();
  root.name = 'balloon.snake';
  const string = decal(new Mesh(new CylinderGeometry(0.008, 0.008, STRING_LENGTH, 6), toonMaterial(ART.balloonString)));
  string.position.y = STRING_LENGTH / 2;
  root.add(string);
  const knot = solid(new Mesh(BEAD, toonMaterial(ART.snakeCoral)));
  knot.scale.setScalar(0.04);
  knot.position.y = STRING_LENGTH;
  root.add(knot);
  // The snake stands on its tail, wavering upward, head looking at the child.
  const path = [
    new Vector3(0, 0, 0),
    new Vector3(0.14, 0.4, 0.05),
    new Vector3(-0.14, 0.85, -0.05),
    new Vector3(0.12, 1.3, 0.05),
    new Vector3(0, 1.65, 0.1),
  ];
  const snake = createSnake({ length: 1.8, radius: 0.13, colourway: 'coral', seed: 0xba110, path, headLookAt: new Vector3(0, 1.4, 2) });
  snake.root.position.y = STRING_LENGTH;
  root.add(snake.root);
  return { root, height: visibleTop(root), update: snake.update };
}

/** A bag of three jelly snakes, best eaten slowly. Origin at the bag's base. */
/**
 * `BoxGeometry` builds its six faces in the order +x, −x, +y, −y, +z, −z, six
 * indices each for a one-segment box; the bottom is the fourth. The groups go
 * with it — one material, so they carried nothing. `Scenery.ts`'s
 * `withoutBoxTop` is the same operation the other way up.
 */
function withoutBoxBottom(geometry: BoxGeometry): BoxGeometry {
  const index = geometry.getIndex();
  const perFace = 6;
  if (!index || index.count !== 6 * perFace) {
    throw new Error(`snakeToys: withoutBoxBottom wants a one-segment box (36 indices), got ${index?.count ?? 0}`);
  }
  const all = Array.from(index.array);
  geometry.setIndex([...all.slice(0, 3 * perFace), ...all.slice(4 * perFace)]);
  geometry.clearGroups();
  return geometry;
}

export function createJellySnakes(): AssetHandle {
  const root = new Group();
  root.name = 'candy.jellySnakes';
  // No bottom face: the bag always stands on something (the stall's
  // counter), and that face lay in the counter top's own plane
  // (`check:coplanar`, 2 October 2026). ART_DIRECTION §7's deletion.
  const bag = solid(new Mesh(withoutBoxBottom(new BoxGeometry(0.26, 0.3, 0.1)), toonMaterial(PALETTE.markerLemon)));
  bag.position.y = 0.15;
  root.add(bag);
  addOutline(bag, 0.01);
  const header = solid(new Mesh(new BoxGeometry(0.28, 0.06, 0.12), toonMaterial(PALETTE.markerPink)));
  header.position.y = 0.33;
  root.add(header);
  const colours = [PALETTE.markerMint, ART.snakeCoral, PALETTE.markerLilac];
  colours.forEach((colour, index) => {
    for (let k = 0; k < 5; k += 1) {
      const bead = decal(new Mesh(BEAD, toonMaterial(colour)));
      bead.scale.set(0.022, 0.018, 0.022);
      bead.position.set(-0.08 + index * 0.08 + Math.sin(k * 1.3) * 0.02, 0.06 + k * 0.045, 0.055);
      root.add(bead);
    }
  });
  return { root, height: visibleTop(root) };
}
