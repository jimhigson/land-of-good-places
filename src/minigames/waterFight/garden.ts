import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  SRGBColorSpace,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE, hexToCss } from '../../core/palette';
import { Rng } from '../../core/mathUtils';
import {
  addOutline,
  decal,
  disposeTree,
  softMaterial,
  solid,
  toonMaterial,
} from '../../art/style/materials';
import { ARENA_HALF_X, ARENA_HALF_Z, HEDGES, POOLS, SPRINKLERS } from './arena';

/**
 * The water-fight garden itself: lawn, fence, hedges, paddling pools and
 * sprinklers.
 *
 * A sunny back garden on the best afternoon of the summer, built to the park's
 * own rules (ART_DIRECTION §2): **the toys are toon-shaded and the ground is
 * not.** Hedges, fence, pool rims and sprinklers get `toonMaterial`; the lawn
 * and the water in the pools keep `softMaterial`, because banding a lawn looks
 * like a rendering fault rather than a style.
 *
 * Everything here is decoration with two exceptions that are also gameplay:
 * the **hedges** are the things you duck behind and bump into (their boxes come
 * from `arena.ts`, so what you see and what you collide with cannot disagree),
 * and the **sprinklers** quietly wet the air all round, which is what makes the
 * rainbow feel like it belongs to the garden rather than to the scoring.
 */

export interface Garden {
  readonly root: Group;
  /** Where each sprinkler head is, for the water system to spray from. */
  readonly sprinklerHeads: readonly Vector3[];
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

export function createGarden(): Garden {
  const root = new Group();
  root.name = 'waterfight:garden';

  const rng = new Rng(0x9a7e12);
  const disposables: { dispose(): void }[] = [];
  const materials = {
    lawn: softMaterial(PALETTE.grass, 0.78),
    lawnMown: softMaterial(PALETTE.grassLight, 0.8),
    water: softMaterial(PALETTE.waterTop, 0.24),
    waterDeep: softMaterial(PALETTE.waterDeep, 0.3),
    wood: toonMaterial(PALETTE.wood),
    woodDark: toonMaterial(PALETTE.woodDark),
    leaf: toonMaterial(PALETTE.leafMid),
    leafLight: toonMaterial(PALETTE.leafLight),
    leafDeep: toonMaterial(PALETTE.leafDeep),
    bark: toonMaterial(PALETTE.bark),
    blossom: toonMaterial(PALETTE.blossomPink),
    pipe: toonMaterial(PALETTE.markerMint),
  };
  for (const material of Object.values(materials)) disposables.push(material);

  // --- the lawn ---------------------------------------------------------------
  // Two greens: a big field that runs off past the fence to the hills, and the
  // brighter mown rectangle the fight actually happens on. The seam is what
  // tells a child where the garden ends without having to read the fence.
  const field = new Mesh(new CircleGeometry(46, 44), materials.lawn);
  field.rotation.x = -Math.PI / 2;
  field.receiveShadow = true;
  root.add(field);
  disposables.push(field.geometry);

  const mown = new Mesh(
    new RoundedBoxGeometry(ARENA_HALF_X * 2 + 0.6, 0.06, ARENA_HALF_Z * 2 + 0.6, 3, 0.5),
    materials.lawnMown,
  );
  mown.position.y = 0.02;
  mown.receiveShadow = true;
  root.add(mown);
  disposables.push(mown.geometry);

  // --- the fence ---------------------------------------------------------------
  // Instanced posts: about thirty of them, and as separate meshes they would be
  // a tenth of the garden's whole draw budget for a picket fence.
  const postGeometry = new CylinderGeometry(0.09, 0.11, 1.05, 7);
  const posts: Vector3[] = [];
  const step = 1.9;
  for (let x = -ARENA_HALF_X; x <= ARENA_HALF_X + 0.01; x += step) {
    posts.push(new Vector3(x, 0.5, -ARENA_HALF_Z), new Vector3(x, 0.5, ARENA_HALF_Z));
  }
  for (let z = -ARENA_HALF_Z + step; z < ARENA_HALF_Z - 0.01; z += step) {
    posts.push(new Vector3(-ARENA_HALF_X, 0.5, z), new Vector3(ARENA_HALF_X, 0.5, z));
  }

  const fencePosts = new InstancedMesh(postGeometry, materials.wood, posts.length);
  const matrix = new Matrix4();
  const noRotation = new Quaternion();
  const one = new Vector3(1, 1, 1);
  posts.forEach((point, index) => {
    matrix.compose(point, noRotation, one);
    fencePosts.setMatrixAt(index, matrix);
  });
  fencePosts.instanceMatrix.needsUpdate = true;
  root.add(fencePosts);
  disposables.push(postGeometry, fencePosts);

  // Two rails a side, and a cheerful cap on every corner post.
  for (const height of [0.4, 0.78]) {
    for (const side of [-1, 1] as const) {
      const along = new Mesh(
        new BoxGeometry(ARENA_HALF_X * 2 + 0.22, 0.11, 0.08),
        materials.woodDark,
      );
      along.position.set(0, height, side * ARENA_HALF_Z);
      root.add(along);
      disposables.push(along.geometry);

      const across = new Mesh(
        new BoxGeometry(0.08, 0.11, ARENA_HALF_Z * 2 + 0.22),
        materials.woodDark,
      );
      across.position.set(side * ARENA_HALF_X, height, 0);
      root.add(across);
      disposables.push(across.geometry);
    }
  }

  const capGeometry = new SphereGeometry(0.14, 12, 9);
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const cap = decal(new Mesh(capGeometry, materials.blossom));
      cap.position.set(sx * ARENA_HALF_X, 1.06, sz * ARENA_HALF_Z);
      root.add(cap);
    }
  }
  disposables.push(capGeometry);

  // --- hedges -------------------------------------------------------------------
  // Read straight from the collision table, so a hedge you can see is always a
  // hedge you can hide behind.
  const hedgeTops: Mesh[] = [];
  for (const hedge of HEDGES) {
    const body = solid(
      new Mesh(
        new RoundedBoxGeometry(hedge.halfX * 2, hedge.height, hedge.halfZ * 2, 4, 0.24),
        materials.leaf,
      ),
    );
    body.position.set(hedge.x, hedge.height / 2, hedge.z);
    root.add(body);
    addOutline(body, 0.02);
    disposables.push(body.geometry);

    // A row of lighter puffs along the top, so the hedge is a clipped bush and
    // not a green brick.
    const puffs = Math.max(2, Math.round(hedge.halfX * 2.2));
    for (let i = 0; i < puffs; i += 1) {
      const t = puffs === 1 ? 0.5 : i / (puffs - 1);
      const puff = decal(new Mesh(new SphereGeometry(hedge.halfZ * 0.92, 12, 9), materials.leafLight));
      puff.scale.set(1.1, 0.62, 1.05);
      puff.position.set(
        hedge.x + (t - 0.5) * hedge.halfX * 1.75,
        hedge.height + hedge.halfZ * 0.16,
        hedge.z + rng.range(-0.06, 0.06),
      );
      root.add(puff);
      hedgeTops.push(puff);
      disposables.push(puff.geometry);
    }
  }

  // --- paddling pools -------------------------------------------------------------
  const pools: { water: Mesh; base: number }[] = [];
  for (const pool of POOLS) {
    const rimMaterial = toonMaterial(pool.rim);
    disposables.push(rimMaterial);

    const rim = solid(new Mesh(new TorusGeometry(pool.radius, 0.17, 9, 30), rimMaterial));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(pool.x, 0.15, pool.z);
    root.add(rim);
    addOutline(rim, 0.016);
    disposables.push(rim.geometry);

    const water = new Mesh(new CircleGeometry(pool.radius, 30), materials.water);
    water.rotation.x = -Math.PI / 2;
    water.position.set(pool.x, 0.12, pool.z);
    water.receiveShadow = true;
    root.add(water);
    disposables.push(water.geometry);
    pools.push({ water, base: 0.12 });

    // A darker disc just under the surface reads as depth without a shader.
    const deep = new Mesh(new CircleGeometry(pool.radius * 0.62, 24), materials.waterDeep);
    deep.rotation.x = -Math.PI / 2;
    deep.position.set(pool.x, 0.1, pool.z);
    root.add(deep);
    disposables.push(deep.geometry);
  }

  // --- sprinklers ------------------------------------------------------------------
  const sprinklerHeads: Vector3[] = [];
  const sprinklers: Mesh[] = [];
  for (const [x, z] of SPRINKLERS) {
    const post = solid(new Mesh(new CylinderGeometry(0.06, 0.08, 0.55, 8), materials.pipe));
    post.position.set(x, 0.27, z);
    root.add(post);
    disposables.push(post.geometry);

    const head = solid(new Mesh(new SphereGeometry(0.16, 12, 9), materials.pipe));
    head.scale.set(1, 0.72, 1);
    head.position.set(x, 0.6, z);
    root.add(head);
    sprinklers.push(head);
    disposables.push(head.geometry);

    sprinklerHeads.push(new Vector3(x, 0.68, z));
  }

  // --- beyond the fence ---------------------------------------------------------
  // Everything out here is decoration nobody can reach, and it all lives in a
  // narrow band just outside the fence. That band is not a guess: the camera
  // frames the garden and about two metres past it (see `WaterFight.resize`),
  // so anything further out than roughly seventeen metres is never once seen.
  // The first version scattered trees to twenty-four metres and put pastel hills
  // at forty, and the entire lot was off screen — a garden surrounded by nothing
  // but flat green.
  for (let i = 0; i < 16; i += 1) {
    const angle = rng.range(0, Math.PI * 2);
    const distance = rng.range(10.5, 16.5);
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance * 0.86;
    const height = rng.range(2.4, 4.2);

    const trunk = solid(new Mesh(new CylinderGeometry(0.16, 0.22, height, 7), materials.bark));
    trunk.position.set(x, height / 2, z);
    root.add(trunk);
    disposables.push(trunk.geometry);

    const crownMaterial = rng.chance(0.25)
      ? materials.blossom
      : rng.chance(0.5)
        ? materials.leafDeep
        : materials.leaf;
    for (let p = 0; p < 3; p += 1) {
      const puff = solid(new Mesh(new SphereGeometry(rng.range(0.9, 1.5), 12, 9), crownMaterial));
      puff.position.set(x + rng.range(-0.7, 0.7), height + rng.range(-0.2, 0.7), z + rng.range(-0.7, 0.7));
      root.add(puff);
      disposables.push(puff.geometry);
    }
  }

  // Bushes and flower dots filling the gap between the fence and the trees, so
  // the lawn outside the garden is not a flat green field. Instanced would be
  // overkill for forty small things that never move.
  const flowerMaterials = [
    toonMaterial(PALETTE.flowerYellow),
    toonMaterial(PALETTE.flowerRed),
    toonMaterial(PALETTE.flowerBlue),
    toonMaterial(PALETTE.flowerViolet),
  ];
  for (const material of flowerMaterials) disposables.push(material);

  for (let i = 0; i < 40; i += 1) {
    const angle = rng.range(0, Math.PI * 2);
    const distance = rng.range(9.6, 16);
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance * 0.84;
    // Never inside the fence: the garden's own ground is kept clear so nothing
    // can be mistaken for a child to squirt.
    if (Math.abs(x) < ARENA_HALF_X + 0.7 && Math.abs(z) < ARENA_HALF_Z + 0.7) continue;

    if (rng.chance(0.45)) {
      const bush = solid(new Mesh(new SphereGeometry(rng.range(0.5, 0.95), 12, 9), rng.chance(0.4) ? materials.leafDeep : materials.leaf));
      bush.scale.set(1.15, 0.82, 1.1);
      bush.position.set(x, 0.4, z);
      root.add(bush);
      disposables.push(bush.geometry);
      continue;
    }

    const material = flowerMaterials[rng.int(0, flowerMaterials.length - 1)];
    if (!material) continue;
    const flower = decal(new Mesh(new SphereGeometry(0.15, 8, 6), material));
    flower.scale.set(1, 0.5, 1);
    flower.position.set(x, 0.1, z);
    root.add(flower);
    disposables.push(flower.geometry);
  }

  return {
    root,
    sprinklerHeads,

    update(_dt: number, elapsed: number): void {
      // Pools breathe: the surface lifts a millimetre or two and the disc
      // swells very slightly. Two sine waves, no shader, and it is enough to
      // stop three flat blue discs looking like painted lids.
      for (let i = 0; i < pools.length; i += 1) {
        const pool = pools[i];
        if (!pool) continue;
        const wobble = Math.sin(elapsed * 1.7 + i * 2.1);
        pool.water.position.y = pool.base + wobble * 0.012;
        pool.water.scale.setScalar(1 + wobble * 0.012);
      }

      // Hedge tops nod in the breeze, out of phase with each other.
      for (let i = 0; i < hedgeTops.length; i += 1) {
        const puff = hedgeTops[i];
        if (!puff) continue;
        puff.rotation.z = Math.sin(elapsed * 1.3 + i * 0.8) * 0.045;
      }

      // Sprinkler heads sweep back and forth. The water they throw is spawned
      // by `WaterFight`, which owns every particle in the garden.
      for (let i = 0; i < sprinklers.length; i += 1) {
        const head = sprinklers[i];
        if (!head) continue;
        head.rotation.y = Math.sin(elapsed * 0.9 + i * 1.6) * 1.2;
      }
    },

    dispose(): void {
      // The sweep first, because it also catches the outline shells `addOutline`
      // parented to the hedges and pool rims — geometry this file never held a
      // reference to. Then the explicit list, for the instanced mesh and the
      // shared materials no mesh owns.
      disposeTree(root);
      for (const item of disposables) item.dispose();
    },
  };
}

/**
 * The sky behind the garden: a painted vertical gradient, set as the scene
 * background.
 *
 * Unlit and toneMapped-off, exactly like `world/Sky.ts` and the rail racer's
 * backdrop — a sky is a painting, not a surface.
 */
export function paintSky(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot paint the sky.');

  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, hexToCss(PALETTE.skyDayTop));
  gradient.addColorStop(0.6, hexToCss(PALETTE.skyDayBottom));
  gradient.addColorStop(1, hexToCss(PALETTE.blossomWhite));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
