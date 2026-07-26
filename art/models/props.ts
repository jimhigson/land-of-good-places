import {
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  type BufferGeometry,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE, pinkStoneTexture, woodTexture, Rng } from '../style/bridge';
import { ART } from '../style/artPalette';
import { addOutline, decal, solid, toonMaterial } from '../style/materials';
import { blob, type AssetHandle } from '../style/asset';

/**
 * Garden props: the lollipop tree and the two kinds of wall.
 *
 * These are the highest-count objects in the park, so they are authored
 * **instancing-friendly**: geometry and materials are module-level singletons
 * created once and shared by every copy. A builder wanting an `InstancedMesh`
 * can take `treeCanopyGeometry()` + `foliageMaterial()` directly and drive
 * per-instance colour with `instanceColor`; a builder wanting a one-off just
 * calls the factory.
 *
 * Never call these factories inside a render loop. Build the garden once.
 */

// --------------------------------------------------------------- shared parts

let canopyGeo: SphereGeometry | null = null;
let trunkGeo: CylinderGeometry | null = null;
let stoneGeo: BufferGeometry | null = null;
let copingGeo: BufferGeometry | null = null;
let plankGeo: BufferGeometry | null = null;

/** The lollipop ball. One geometry, scaled and tinted per tree. */
export function treeCanopyGeometry(): SphereGeometry {
  canopyGeo ??= new SphereGeometry(1, 22, 16);
  return canopyGeo;
}

/** The tapered trunk. Origin at its base. */
export function treeTrunkGeometry(): CylinderGeometry {
  if (!trunkGeo) {
    trunkGeo = new CylinderGeometry(0.13, 0.21, 1.45, 12, 1);
    trunkGeo.translate(0, 0.725, 0);
  }
  return trunkGeo;
}

export function stoneBlockGeometry(): BufferGeometry {
  stoneGeo ??= new RoundedBoxGeometry(2.4, 1.1, 0.44, 5, 0.12);
  return stoneGeo;
}

export function stoneCopingGeometry(): BufferGeometry {
  copingGeo ??= new RoundedBoxGeometry(2.56, 0.22, 0.6, 4, 0.09);
  return copingGeo;
}

export function woodPlankGeometry(): BufferGeometry {
  plankGeo ??= new RoundedBoxGeometry(2.4, 0.34, 0.16, 3, 0.06);
  return plankGeo;
}

// -------------------------------------------------------------- lollipop tree

export type TreeVariant = 'plain' | 'blossom' | 'fruit' | 'tall';

export interface TreeOptions {
  variant?: TreeVariant;
  /** Seed so the same spot in the park always grows the same tree. */
  seed?: number;
}

/**
 * A lollipop tree: one fat ball of leaves on a short leaning trunk, plus two
 * smaller puffs so the silhouette is not a perfect circle.
 *
 * Two rules make these read as "storybook" rather than "low-poly programmer
 * tree": the trunk leans a few degrees (nothing in a cute world is plumb), and
 * the canopy overhangs the trunk generously so the tree looks top-heavy and
 * pettable.
 */
export function createLollipopTree(options: TreeOptions = {}): AssetHandle {
  const { variant = 'plain', seed = 1 } = options;
  const rng = new Rng(seed * 7919 + 13);

  const root = new Group();
  root.name = 'prop.lollipopTree';

  const barkMat = toonMaterial(rng.chance(0.5) ? PALETTE.bark : PALETTE.barkDark);
  // The canopy is ONE colour. An earlier version gave the side puffs a lighter
  // green and they read as bald patches — a lollipop tree has to look like one
  // solid sweet, with variation coming from the light, not from the paint.
  const leafMat = toonMaterial(rng.chance(0.4) ? ART.lollipopLeafAlt : PALETTE.leafMid);
  const leafLightMat = leafMat;

  const tallness = variant === 'tall' ? 1.45 : 1;
  const trunk = solid(new Mesh(treeTrunkGeometry(), barkMat));
  trunk.scale.set(1, tallness, 1);
  trunk.rotation.z = rng.range(-0.07, 0.07);
  trunk.rotation.x = rng.range(-0.05, 0.05);
  root.add(trunk);
  addOutline(trunk, 0.022);

  // Root flare — a squashed ball where the trunk meets the grass. Without it a
  // cylinder looks like a pole stuck in a lawn.
  const flare = solid(blob(0.27, barkMat, [1, 0.5, 1], 14));
  root.add(flare);

  const canopy = new Group();
  canopy.position.y = 1.42 * tallness;
  canopy.rotation.z = trunk.rotation.z * 2;
  root.add(canopy);

  const r = rng.range(0.86, 1.02);
  const main = solid(new Mesh(treeCanopyGeometry(), leafMat));
  main.scale.set(r * 1.06, r * 0.94, r * 1.06);
  main.position.y = r * 0.72;
  canopy.add(main);
  addOutline(main, 0.028);

  // Two shoulder puffs, set LOW and overlapping the main ball, so the canopy
  // reads as one lumpy sweet rather than three separate balloons.
  for (let i = 0; i < 2; i += 1) {
    const puff = solid(new Mesh(treeCanopyGeometry(), leafLightMat));
    const a = rng.range(0, Math.PI * 2) + i * Math.PI;
    const pr = r * rng.range(0.5, 0.62);
    puff.scale.setScalar(pr);
    puff.position.set(
      Math.cos(a) * r * 0.66,
      r * rng.range(0.42, 0.62),
      Math.sin(a) * r * 0.66,
    );
    canopy.add(puff);
    addOutline(puff, 0.024);
  }

  // Blossom and fruit are SCATTERED DOTS on a green canopy, never a recoloured
  // canopy — a solid pink ball stops reading as a tree.
  if (variant === 'blossom' || variant === 'fruit') {
    const dotMat = toonMaterial(variant === 'blossom' ? PALETTE.blossomPink : ART.lollipopBerry);
    const count = variant === 'blossom' ? 16 : 6;
    for (let i = 0; i < count; i += 1) {
      const dot = decal(new Mesh(treeCanopyGeometry(), dotMat));
      dot.scale.setScalar(variant === 'blossom' ? r * rng.range(0.1, 0.16) : 0.105);
      const a = rng.range(0, Math.PI * 2);
      const t = rng.range(0.08, 0.78);
      const sinT = Math.sin(t * Math.PI);
      dot.position.set(
        Math.cos(a) * r * 0.99 * sinT,
        r * 0.72 + Math.cos(t * Math.PI) * r * 0.9,
        Math.sin(a) * r * 0.99 * sinT,
      );
      canopy.add(dot);
    }
  }

  return { root, height: (1.42 + r * 1.6) * tallness };
}

// ------------------------------------------------------------------- the walls

export interface WallOptions {
  /** Segments end to end. Each is 2.4 m wide. */
  length?: number;
  seed?: number;
}

/**
 * The park's signature pink stone wall.
 *
 * Uses the existing `pinkStoneTexture` so it matches whatever the world already
 * built. What the art direction adds is the **coping**: a pale rounded cap along
 * the top and a little ball finial at each end. A bare box of cobbles reads as a
 * texture demo; a capped wall reads as something a park keeper built.
 */
export function createPinkWall(options: WallOptions = {}): AssetHandle {
  const { length = 1, seed = 3 } = options;
  const rng = new Rng(seed * 104729 + 7);

  const root = new Group();
  root.name = 'prop.pinkWall';

  const stoneMat = toonMaterial(0xffffff, { map: pinkStoneTexture(2, 1) });
  const copingMat = toonMaterial(PALETTE.stonePinkLight);
  const finialMat = toonMaterial(PALETTE.stonePink);

  for (let i = 0; i < length; i += 1) {
    const x = (i - (length - 1) / 2) * 2.4;

    const block = solid(new Mesh(stoneBlockGeometry(), stoneMat));
    block.position.set(x, 0.55, 0);
    block.rotation.y = rng.range(-0.012, 0.012);
    root.add(block);
    addOutline(block, 0.018);

    const cap = solid(new Mesh(stoneCopingGeometry(), copingMat));
    cap.position.set(x, 1.19, 0);
    root.add(cap);
    addOutline(cap, 0.016);
  }

  // Ball finials on the ends — the single detail that makes it look cared for.
  for (const side of [-1, 1] as const) {
    const finial = solid(blob(0.19, finialMat, [1, 1.15, 1], 18));
    finial.position.set((side * (length * 2.4)) / 2 + side * -0.05, 1.42, 0);
    root.add(finial);
    addOutline(finial, 0.014);

    const collar = solid(blob(0.13, copingMat, [1.2, 0.5, 1.2], 14));
    collar.position.set((side * (length * 2.4)) / 2 + side * -0.05, 1.28, 0);
    root.add(collar);
  }

  return { root, height: 1.62 };
}

/** The wooden hide-and-seek walls. Three heights, per GAME_DESIGN. */
export function createWoodWall(options: WallOptions & { height?: 'low' | 'mid' | 'high' } = {}): AssetHandle {
  const { length = 1, seed = 5, height = 'mid' } = options;
  const rng = new Rng(seed * 15485863 + 11);
  const rows = height === 'low' ? 2 : height === 'mid' ? 4 : 6;

  const root = new Group();
  root.name = 'prop.woodWall';
  const boardMat = toonMaterial(0xffffff, { map: woodTexture(1, 1) });
  const postMat = toonMaterial(PALETTE.woodDark);

  for (let i = 0; i < length; i += 1) {
    const x = (i - (length - 1) / 2) * 2.4;
    for (let row = 0; row < rows; row += 1) {
      const board = solid(new Mesh(woodPlankGeometry(), boardMat));
      board.position.set(x, 0.24 + row * 0.36, 0);
      board.rotation.z = rng.range(-0.006, 0.006);
      root.add(board);
      if (row === rows - 1) addOutline(board, 0.014);
    }
  }

  for (let i = 0; i <= length; i += 1) {
    const post = solid(
      new Mesh(new CylinderGeometry(0.11, 0.12, 0.28 + rows * 0.36, 10), postMat),
    );
    post.position.set((i - length / 2) * 2.4, (0.28 + rows * 0.36) / 2, 0);
    root.add(post);
    addOutline(post, 0.016);

    const capBall = solid(blob(0.14, postMat, [1, 0.85, 1], 14));
    capBall.position.set((i - length / 2) * 2.4, 0.28 + rows * 0.36, 0);
    root.add(capBall);
  }

  return { root, height: 0.28 + rows * 0.36 + 0.14 };
}

/** Frees the shared prop geometry. Call only on teardown. */
export function disposePropGeometry(): void {
  canopyGeo?.dispose();
  trunkGeo?.dispose();
  stoneGeo?.dispose();
  copingGeo?.dispose();
  plankGeo?.dispose();
  canopyGeo = trunkGeo = null;
  stoneGeo = copingGeo = plankGeo = null;
}

/** Convenience re-export so callers do not need to know the Material type. */
export type PropMaterial = Material;
