import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { GARDEN_HALF_SIZE, TERRAIN_RADIUS } from '../core/constants';
import { PALETTE } from '../core/palette';
import { Rng, TAU } from '../core/mathUtils';
import { pinkStoneTexture, woodTexture } from '../core/textures';
import { terrainHeight } from './terrain';
import { isOnPath } from './paths';
import { ANCHORS } from './anchors';
import type { CollisionWorld } from './Collision';

/**
 * Everything scattered across the lawn: lollipop trees, bushes, flowers, the
 * wooden hiding walls and the low pink stone walls.
 *
 * Two rules keep this fast and tidy:
 *  1. Anything that appears many times is an InstancedMesh, so the whole park's
 *     foliage costs a handful of draw calls.
 *  2. Placement is seeded (see `Rng`), so the park is laid out identically on
 *     every reload — no wandering trees between playtests.
 */

type TreeKind = 'lollipop' | 'stack' | 'pine' | 'blossom';

interface InstanceItem {
  readonly position: Vector3;
  readonly scale: Vector3;
  readonly rotationY: number;
  readonly colour: number;
  /** Optional per-instance brightness multiplier, 1 = unchanged. */
  readonly shade: number;
}

export class Scenery {
  readonly group = new Group();

  constructor(collision: CollisionWorld) {
    this.group.name = 'scenery';
    this.group.add(buildFoliage(collision));
    this.group.add(buildTreeline());
    this.group.add(buildWoodenWalls(collision));
    this.group.add(buildStoneWalls(collision));
  }
}

// ------------------------------------------------------------------ foliage

function buildFoliage(collision: CollisionWorld): Group {
  const group = new Group();
  group.name = 'foliage';

  const rng = new Rng(0xc0ffee);

  const trunks: InstanceItem[] = [];
  const roundCanopies: InstanceItem[] = [];
  const coneCanopies: InstanceItem[] = [];
  const bushes: InstanceItem[] = [];
  const flowers: InstanceItem[] = [];

  const canopyGreens = [PALETTE.leafMid, PALETTE.leafLight, PALETTE.leafDeep, PALETTE.leafBlue];
  const flowerColours = [
    PALETTE.flowerYellow,
    PALETTE.flowerRed,
    PALETTE.flowerBlue,
    PALETTE.flowerViolet,
    PALETTE.blossomPink,
    PALETTE.blossomWhite,
  ];

  // --- trees ---------------------------------------------------------------
  let attempts = 0;
  let treeCount = 0;
  const targetTrees = 58;
  while (treeCount < targetTrees && attempts < 4000) {
    attempts += 1;
    const angle = rng.range(0, TAU);
    const distance = Math.sqrt(rng.unit()) * 54;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (!isPlantable(x, z, 2.6)) continue;

    const kind = pickTreeKind(rng);
    const height = rng.range(2.3, 3.7);
    const y = terrainHeight(x, z);
    const rotationY = rng.range(0, TAU);
    const lean = rng.range(0.92, 1.1);

    trunks.push({
      position: new Vector3(x, y + height / 2, z),
      scale: new Vector3(lean, height, lean),
      rotationY,
      colour: rng.chance(0.4) ? PALETTE.barkDark : PALETTE.bark,
      shade: rng.range(0.92, 1.08),
    });

    const canopyBase = y + height;
    if (kind === 'pine') {
      const layers = rng.int(2, 3);
      for (let i = 0; i < layers; i += 1) {
        const t = i / layers;
        const width = rng.range(1.7, 2.3) * (1 - t * 0.42);
        coneCanopies.push({
          position: new Vector3(x, canopyBase - 0.6 + t * 1.5, z),
          scale: new Vector3(width, rng.range(1.6, 2.2) * (1 - t * 0.2), width),
          rotationY,
          colour: rng.chance(0.5) ? PALETTE.leafDeep : PALETTE.leafMid,
          shade: rng.range(0.94, 1.06),
        });
      }
    } else if (kind === 'stack') {
      const layers = 3;
      for (let i = 0; i < layers; i += 1) {
        const radius = rng.range(1.6, 2.05) * (1 - i * 0.22);
        roundCanopies.push({
          position: new Vector3(x, canopyBase - 0.3 + i * radius * 0.92, z),
          scale: new Vector3(radius, radius * rng.range(0.8, 0.95), radius),
          rotationY: rotationY + i,
          colour: rng.pick(canopyGreens),
          shade: rng.range(0.95, 1.08),
        });
      }
    } else {
      // Lollipop and blossom: one big friendly ball, sometimes with a smaller
      // one tucked beside it so the silhouette isn't a perfect circle.
      const radius = rng.range(1.75, 2.5);
      const colour = kind === 'blossom' ? PALETTE.blossomPink : rng.pick(canopyGreens);
      roundCanopies.push({
        position: new Vector3(x, canopyBase + radius * 0.42, z),
        scale: new Vector3(radius, radius * rng.range(0.82, 1.0), radius),
        rotationY,
        colour,
        shade: rng.range(0.95, 1.06),
      });
      if (rng.chance(0.55)) {
        const small = radius * rng.range(0.5, 0.72);
        const offset = rng.range(0, TAU);
        roundCanopies.push({
          position: new Vector3(
            x + Math.cos(offset) * radius * 0.7,
            canopyBase + radius * rng.range(0.1, 0.5),
            z + Math.sin(offset) * radius * 0.7,
          ),
          scale: new Vector3(small, small * 0.9, small),
          rotationY: rotationY + 1.3,
          colour: kind === 'blossom' ? PALETTE.blossomWhite : colour,
          shade: rng.range(0.92, 1.04),
        });
      }
    }

    collision.addCircle(x, z, 0.55 * lean);
    treeCount += 1;
  }

  // --- bushes --------------------------------------------------------------
  let bushCount = 0;
  attempts = 0;
  while (bushCount < 84 && attempts < 4000) {
    attempts += 1;
    const angle = rng.range(0, TAU);
    const distance = Math.sqrt(rng.unit()) * 55;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (!isPlantable(x, z, 1.6)) continue;

    // Bushes come in clumps of two or three overlapping blobs.
    const blobs = rng.int(2, 3);
    const colour = rng.pick(canopyGreens);
    const y = terrainHeight(x, z);
    for (let i = 0; i < blobs; i += 1) {
      const radius = rng.range(0.62, 1.15);
      const offset = rng.range(0, TAU);
      const spread = i === 0 ? 0 : rng.range(0.4, 0.85);
      bushes.push({
        position: new Vector3(
          x + Math.cos(offset) * spread,
          y + radius * 0.72,
          z + Math.sin(offset) * spread,
        ),
        scale: new Vector3(radius, radius * rng.range(0.72, 0.9), radius),
        rotationY: rng.range(0, TAU),
        colour,
        shade: rng.range(0.9, 1.1),
      });
    }
    collision.addCircle(x, z, 0.85);
    bushCount += 1;
  }

  // --- flowers -------------------------------------------------------------
  // Purely decorative, no collision: you can trot straight through them.
  // Each is a squashed bloom sitting on a short stem — from the isometric
  // camera you mostly see them from above, so a flattened dome reads as a
  // flower head far better than a ball floating in the grass would.
  const stems: InstanceItem[] = [];
  let flowerCount = 0;
  attempts = 0;
  while (flowerCount < 340 && attempts < 6000) {
    attempts += 1;
    const angle = rng.range(0, TAU);
    const distance = Math.sqrt(rng.unit()) * 55;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (isOnPath(x, z, 0.5)) continue;
    if (insideAnyAnchor(x, z, 0.5)) continue;

    const ground = terrainHeight(x, z);
    const width = rng.range(0.16, 0.26);
    const stemHeight = rng.range(0.16, 0.3);
    const rotationY = rng.range(0, TAU);

    stems.push({
      position: new Vector3(x, ground + stemHeight / 2, z),
      scale: new Vector3(1, stemHeight, 1),
      rotationY,
      colour: PALETTE.leafDeep,
      shade: rng.range(0.9, 1.1),
    });
    flowers.push({
      position: new Vector3(x, ground + stemHeight, z),
      scale: new Vector3(width, width * 0.5, width),
      rotationY,
      colour: rng.pick(flowerColours),
      shade: 1,
    });
    flowerCount += 1;
  }

  const trunkGeometry = new CylinderGeometry(0.19, 0.3, 1, 8);
  const canopyGeometry = new IcosahedronGeometry(1, 2);
  const coneGeometry = new ConeGeometry(1, 1, 10);
  // Subdivision 2 rather than 1: still faceted enough to look hand-made, but
  // rounded rather than spiky — a bush, not a lump of quartz.
  const bushGeometry = new IcosahedronGeometry(1, 2);
  const flowerGeometry = new SphereGeometry(1, 7, 5);
  const stemGeometry = new CylinderGeometry(0.02, 0.028, 1, 4);

  group.add(
    makeInstanced('tree-trunks', trunkGeometry, foliageMaterial(0.95), trunks, true),
    makeInstanced('tree-canopies', canopyGeometry, foliageMaterial(0.85), roundCanopies, true),
    makeInstanced('tree-cones', coneGeometry, foliageMaterial(0.85), coneCanopies, true),
    makeInstanced('bushes', bushGeometry, foliageMaterial(0.9, true), bushes, true),
    makeInstanced('flower-stems', stemGeometry, foliageMaterial(0.9), stems, false),
    makeInstanced('flowers', flowerGeometry, foliageMaterial(0.7), flowers, false),
  );

  return group;
}

/**
 * A dense band of woodland outside the boundary wall.
 *
 * Its job is to hide the edge of the terrain disc (see `buildTerrain`) so that
 * the ground appears to disappear into trees rather than simply stopping in
 * mid-air. Nothing here is reachable, so none of it registers collision and the
 * trees are cheap: trunk plus one blob.
 */
function buildTreeline(): Group {
  const group = new Group();
  group.name = 'treeline';

  const rng = new Rng(0x7e3711);
  const trunks: InstanceItem[] = [];
  const canopies: InstanceItem[] = [];

  const bandInner = GARDEN_HALF_SIZE + 1;
  const bandOuter = TERRAIN_RADIUS - 1.5;
  const colours = [PALETTE.leafDeep, PALETTE.leafMid, PALETTE.leafBlue, PALETTE.leafLight];

  for (let i = 0; i < 340; i += 1) {
    const angle = rng.range(0, TAU);
    const distance = rng.range(bandInner, bandOuter);
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const ground = terrainHeight(x, z);

    // Slightly taller towards the rim so the band reads as depth, but kept low
    // enough that it screens the terrain edge without swallowing the sky.
    const rimness = (distance - bandInner) / (bandOuter - bandInner);
    const height = rng.range(2.8, 4.0) + rimness * 1.1;
    const radius = rng.range(1.7, 2.6) + rimness * 0.5;

    trunks.push({
      position: new Vector3(x, ground + height / 2, z),
      scale: new Vector3(1.1, height, 1.1),
      rotationY: rng.range(0, TAU),
      colour: PALETTE.barkDark,
      shade: rng.range(0.8, 1),
    });
    canopies.push({
      position: new Vector3(x, ground + height + radius * 0.35, z),
      scale: new Vector3(radius, radius * rng.range(0.85, 1.15), radius),
      rotationY: rng.range(0, TAU),
      colour: rng.pick(colours),
      shade: rng.range(0.82, 1.02),
    });
  }

  const trunkGeometry = new CylinderGeometry(0.2, 0.32, 1, 6);
  const canopyGeometry = new IcosahedronGeometry(1, 1);

  // No shadows out here: the treeline sits far outside the sun's shadow frustum
  // and adding it would only cost fill rate.
  group.add(
    makeInstanced('treeline-trunks', trunkGeometry, foliageMaterial(0.95), trunks, false),
    makeInstanced('treeline-canopies', canopyGeometry, foliageMaterial(0.9, true), canopies, false),
  );

  return group;
}

function pickTreeKind(rng: Rng): TreeKind {
  const roll = rng.unit();
  if (roll < 0.44) return 'lollipop';
  if (roll < 0.68) return 'stack';
  if (roll < 0.86) return 'blossom';
  return 'pine';
}

function foliageMaterial(roughness: number, flatShading = false): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: 0xffffff,
    roughness,
    metalness: 0,
    flatShading,
  });
}

/** Somewhere we are allowed to plant: not on paving, not in a reserved plot. */
function isPlantable(x: number, z: number, clearance: number): boolean {
  if (Math.hypot(x, z) > 55) return false;
  if (isOnPath(x, z, clearance)) return false;
  if (Math.hypot(x, z) < 11) return false; // keep the fountain plaza open
  if (insideAnyAnchor(x, z, clearance)) return false;
  return true;
}

function insideAnyAnchor(x: number, z: number, margin: number): boolean {
  for (const anchor of ANCHORS) {
    const dx = x - anchor.position[0];
    const dz = z - anchor.position[1];
    if (Math.hypot(dx, dz) < anchor.boundingRadius + margin) return true;
  }
  return false;
}

// -------------------------------------------------------------------- walls

/**
 * Wooden walls at various heights — the design doc asks for things "to run
 * around and hide behind", so these are laid out as a loose, open maze rather
 * than a fence line.
 */
function buildWoodenWalls(collision: CollisionWorld): Group {
  const group = new Group();
  group.name = 'wooden-walls';

  const runs: readonly {
    from: readonly [number, number];
    to: readonly [number, number];
    height: number;
  }[] = [
    { from: [8, -8], to: [17, -8], height: 1.5 },
    { from: [17, -8], to: [17, -2], height: 2.3 },
    { from: [11, -3], to: [11, 3], height: 0.95 },
    { from: [11, 3], to: [18, 4], height: 1.8 },
    { from: [-16, 2], to: [-16, 9], height: 2.6 },
    { from: [-16, 9], to: [-8, 10], height: 1.25 },
    { from: [-10, 2], to: [-4, 1], height: 1.75 },
    { from: [3, 13], to: [3, 19], height: 2.1 },
    { from: [3, 19], to: [-4, 20], height: 1.4 },
    { from: [-21, -8], to: [-15, -9], height: 1.15 },
  ];

  const boardMaterial = new MeshStandardMaterial({
    map: woodTexture(1, 1),
    roughness: 0.9,
    metalness: 0,
  });
  const postMaterial = new MeshStandardMaterial({
    color: PALETTE.woodDark,
    roughness: 0.9,
    metalness: 0,
  });
  const capMaterial = new MeshStandardMaterial({
    color: PALETTE.woodLight,
    roughness: 0.7,
    metalness: 0,
  });
  const postGeometry = new CylinderGeometry(0.19, 0.21, 1, 8);
  const capGeometry = new SphereGeometry(0.24, 10, 8);

  for (const run of runs) {
    const [x1, z1] = run.from;
    const [x2, z2] = run.to;
    const length = Math.hypot(x2 - x1, z2 - z1);
    const angle = Math.atan2(z2 - z1, x2 - x1);
    const midX = (x1 + x2) / 2;
    const midZ = (z1 + z2) / 2;
    const base = Math.min(terrainHeight(x1, z1), terrainHeight(x2, z2));

    const geometry = new BoxGeometry(length, run.height, 0.28);
    // Keep the plank scale constant regardless of how long the wall is.
    scaleUvs(geometry, length / 2.4, run.height / 2.4);
    const boards = new Mesh(geometry, boardMaterial);
    boards.position.set(midX, base + run.height / 2, midZ);
    boards.rotation.y = -angle;
    boards.castShadow = true;
    boards.receiveShadow = true;
    group.add(boards);

    for (const [px, pz] of [run.from, run.to]) {
      const postHeight = run.height + 0.32;
      const post = new Mesh(postGeometry, postMaterial);
      post.position.set(px, base + postHeight / 2, pz);
      post.scale.y = postHeight;
      post.castShadow = true;
      post.receiveShadow = true;
      group.add(post);

      const cap = new Mesh(capGeometry, capMaterial);
      cap.position.set(px, base + postHeight, pz);
      cap.scale.set(1, 0.8, 1);
      cap.castShadow = true;
      group.add(cap);
    }

    collision.addWall(x1, z1, x2, z2, 0.22);
  }

  return group;
}

/** Low pink stone walls: garden-bed edging around the plaza and a few benches
 *  of stonework out on the lawn. */
function buildStoneWalls(collision: CollisionWorld): Group {
  const group = new Group();
  group.name = 'stone-walls';

  const runs: readonly {
    from: readonly [number, number];
    to: readonly [number, number];
    height: number;
  }[] = [
    { from: [-13, -4], to: [-13, 4], height: 0.85 },
    { from: [13, -5], to: [13, 2], height: 0.85 },
    { from: [-7, 12], to: [7, 12], height: 0.7 },
    { from: [-6, -12], to: [6, -12], height: 0.7 },
    { from: [22, -6], to: [22, 4], height: 1.2 },
    { from: [-24, 4], to: [-24, 12], height: 1.2 },
    { from: [6, 26], to: [14, 24], height: 0.95 },
    { from: [-14, -22], to: [-6, -23], height: 0.95 },
  ];

  const wallMaterial = new MeshStandardMaterial({
    map: pinkStoneTexture(1, 1),
    roughness: 0.85,
    metalness: 0,
  });
  const copingMaterial = new MeshStandardMaterial({
    color: PALETTE.stonePinkLight,
    roughness: 0.6,
    metalness: 0,
  });

  for (const run of runs) {
    const [x1, z1] = run.from;
    const [x2, z2] = run.to;
    const length = Math.hypot(x2 - x1, z2 - z1);
    const angle = Math.atan2(z2 - z1, x2 - x1);
    const midX = (x1 + x2) / 2;
    const midZ = (z1 + z2) / 2;
    const base = Math.min(terrainHeight(x1, z1), terrainHeight(x2, z2));

    const geometry = new BoxGeometry(length, run.height, 0.55);
    scaleUvs(geometry, length / 3, run.height / 1.2);
    const wall = new Mesh(geometry, wallMaterial);
    wall.position.set(midX, base + run.height / 2, midZ);
    wall.rotation.y = -angle;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);

    // A rounded coping stone along the top — reads as "sit on me".
    const coping = new Mesh(new BoxGeometry(length + 0.2, 0.16, 0.72), copingMaterial);
    coping.position.set(midX, base + run.height + 0.08, midZ);
    coping.rotation.y = -angle;
    coping.castShadow = true;
    coping.receiveShadow = true;
    group.add(coping);

    collision.addWall(x1, z1, x2, z2, 0.34);
  }

  return group;
}

// ----------------------------------------------------------------- helpers

function makeInstanced(
  name: string,
  geometry: BufferGeometry,
  material: Material,
  items: readonly InstanceItem[],
  shadows: boolean,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, items.length));
  mesh.name = name;
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  mesh.count = items.length;

  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const colour = new Color();

  items.forEach((item, index) => {
    quaternion.setFromAxisAngle(UP, item.rotationY);
    matrix.compose(item.position, quaternion, item.scale);
    mesh.setMatrixAt(index, matrix);
    colour.setHex(item.colour).multiplyScalar(item.shade);
    mesh.setColorAt(index, colour);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

/** Multiplies a geometry's UVs so a tiling texture keeps a constant scale. */
function scaleUvs(geometry: BufferGeometry, sx: number, sy: number): void {
  const uv = geometry.getAttribute('uv');
  if (!uv) return;
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  }
  uv.needsUpdate = true;
}

const UP = new Vector3(0, 1, 0);
