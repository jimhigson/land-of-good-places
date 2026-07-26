import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../style/bridge';
import { ART } from '../style/artPalette';
import { addOutline, decal, solid, toonMaterial } from '../style/materials';
import { starGeometry } from '../style/shapes';
import { blob, type AssetHandle } from '../style/asset';

/**
 * The small things the shops sell: candy floss, ice creams, sticker sheets,
 * surprise eggs and a plush star.
 *
 * All of them are ≤ 0.4 m, all of them are origin-at-base facing +Z, and all of
 * them are used twice over — once standing on a shop display, once shrunk into
 * the player's `holdAnchor` when they buy one. That is the whole reason they are
 * assets rather than geometry buried in the shop builder.
 */

/** Candy floss colours. The rainbow one is rare — see `rainbowFlossWindow`. */
export type FlossFlavour = 'pink' | 'blue' | 'rainbow';

const FLOSS_COLOURS: Readonly<Record<FlossFlavour, readonly number[]>> = {
  pink: [PALETTE.blossomPink, PALETTE.markerPink],
  blue: [PALETTE.markerSky, PALETTE.flowerBlue],
  rainbow: [PALETTE.markerPink, PALETTE.flowerYellow, PALETTE.markerMint, PALETTE.markerLilac],
};

/** The paper stick every candy floss is wound on. Shared, so it is instanced. */
export function flossStickGeometry(): CylinderGeometry {
  return new CylinderGeometry(0.018, 0.018, 0.34, 6);
}

/**
 * A cloud of candy floss on a stick.
 *
 * The cloud is three overlapping squashed spheres rather than one: floss is
 * lumpy, and a single sphere on a stick reads as a lollipop.
 */
export function createCandyFloss(flavour: FlossFlavour): AssetHandle {
  const root = new Group();
  root.name = `floss.${flavour}`;

  const stick = solid(new Mesh(flossStickGeometry(), toonMaterial(ART.creamDark)));
  stick.position.y = 0.17;
  root.add(stick);

  const colours = FLOSS_COLOURS[flavour];
  const lumps: readonly (readonly [number, number, number, number])[] = [
    [0, 0.4, 0, 0.13],
    [-0.08, 0.34, 0.03, 0.095],
    [0.08, 0.36, -0.03, 0.1],
    [0.01, 0.47, 0.02, 0.085],
  ];
  lumps.forEach(([x, y, z, radius], index) => {
    const colour = colours[index % colours.length] ?? PALETTE.blossomPink;
    const lump = blob(radius, toonMaterial(colour), [1, 0.92, 1], 16);
    lump.position.set(x, y, z);
    root.add(lump);
    if (index === 0) addOutline(lump, 0.011);
  });

  return { root, height: 0.56 };
}

/** Silly ice cream flavours, as scoop colours from the top of the cone up. */
export function createIceCream(scoops: readonly number[]): AssetHandle {
  const root = new Group();
  root.name = 'icecream';

  const cone = solid(
    new Mesh(new CylinderGeometry(0.085, 0.02, 0.2, 14), toonMaterial(ART.creamDark)),
  );
  cone.position.y = 0.1;
  root.add(cone);
  addOutline(cone, 0.011);

  let y = 0.24;
  scoops.forEach((colour, index) => {
    const scoop = blob(0.095, toonMaterial(colour), [1, 0.92, 1], 18);
    // Each scoop leans a little the other way, so a triple-decker wobbles.
    scoop.position.set(index % 2 === 0 ? 0.012 : -0.012, y, 0);
    root.add(scoop);
    if (index === scoops.length - 1) addOutline(scoop, 0.011);
    y += 0.145;
  });

  const cherry = decal(new Mesh(new SphereGeometry(0.032, 10, 8), toonMaterial(PALETTE.flowerRed)));
  cherry.position.y = y - 0.03;
  root.add(cherry);

  return { root, height: y + 0.02 };
}

/** A sheet of stickers, standing up like a little card. */
export function createStickerSheet(paper: number, sticker: number): AssetHandle {
  const root = new Group();
  root.name = 'sticker.sheet';

  const sheet = solid(new Mesh(new BoxGeometry(0.24, 0.32, 0.012), toonMaterial(paper)));
  sheet.position.y = 0.16;
  root.add(sheet);
  addOutline(sheet, 0.008);

  // Six stickers on the face, one instanced mesh — the stickers are the only
  // repeated geometry on the card and they are what makes it read as stickers.
  const stars = new InstancedMesh(starGeometry(0.062, 0.012), toonMaterial(sticker), 6);
  stars.castShadow = false;
  stars.receiveShadow = true;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3(0, 0, 1);
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  for (let i = 0; i < 6; i += 1) {
    const column = i % 2;
    const row = Math.floor(i / 2);
    rotation.setFromAxisAngle(axis, (i % 3) * 0.24 - 0.24);
    position.set(column * 0.1 - 0.05, 0.26 - row * 0.09, 0.012);
    matrix.compose(position, rotation, scale);
    stars.setMatrixAt(i, matrix);
  }
  stars.instanceMatrix.needsUpdate = true;
  root.add(stars);

  return { root, height: 0.33 };
}

/** A spotted surprise egg, sitting in its own little dimple. */
export function createSurpriseEgg(shell: number, spots: number): AssetHandle {
  const root = new Group();
  root.name = 'egg.surprise';

  const body = blob(0.13, toonMaterial(shell), [1, 1.3, 1], 20);
  body.position.y = 0.17;
  root.add(body);
  addOutline(body, 0.012);

  // Seven spots as one instanced mesh, laid on the shell far enough out that
  // they protrude rather than intersecting it in a jagged starburst.
  const count = 7;
  const dots = new InstancedMesh(new SphereGeometry(0.032, 10, 8), toonMaterial(spots), count);
  dots.castShadow = false;
  dots.receiveShadow = true;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 0.5);
  const position = new Vector3();
  for (let i = 0; i < count; i += 1) {
    const lon = i * 2.4;
    const lat = -0.5 + (i / count) * 1.4;
    const cl = Math.cos(lat);
    position.set(0.128 * cl * Math.sin(lon), 0.17 + 0.166 * Math.sin(lat), 0.128 * cl * Math.cos(lon));
    rotation.setFromUnitVectors(new Vector3(0, 0, 1), position.clone().sub(new Vector3(0, 0.17, 0)).normalize());
    matrix.compose(position, rotation, scale);
    dots.setMatrixAt(i, matrix);
  }
  dots.instanceMatrix.needsUpdate = true;
  root.add(dots);

  return { root, height: 0.35 };
}

/** A plush star — a toy-shop filler and one of the surprise-egg prizes. */
export function createStarToy(colour: number): AssetHandle {
  const root = new Group();
  root.name = 'toy.star';

  const star = solid(new Mesh(starGeometry(0.34, 0.12), toonMaterial(colour)));
  star.position.y = 0.19;
  root.add(star);
  addOutline(star, 0.012);

  // A face patch would be a whole canvas for a 30 cm prop; two ink dots and a
  // blush do the same job at this size.
  for (const side of [-1, 1] as const) {
    const eye = decal(new Mesh(new SphereGeometry(0.022, 8, 6), toonMaterial(ART.ink)));
    eye.position.set(side * 0.05, 0.21, 0.062);
    eye.scale.set(0.8, 1.2, 0.5);
    root.add(eye);

    const cheek = decal(new Mesh(new SphereGeometry(0.026, 8, 6), toonMaterial(ART.blush)));
    cheek.position.set(side * 0.095, 0.175, 0.058);
    cheek.scale.set(1, 0.7, 0.3);
    root.add(cheek);
  }

  return { root, height: 0.36 };
}
