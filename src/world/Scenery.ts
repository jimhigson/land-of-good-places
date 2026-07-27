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
  MeshToonMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { GARDEN_HALF_SIZE, TERRAIN_RADIUS } from '../core/constants';
import { PALETTE } from '../core/palette';
import { Rng, TAU } from '../core/mathUtils';
import { pinkStoneTexture, woodTexture } from '../core/textures';
import { toonMaterial } from '../art/style/materials';
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

/** One straight length of wall, in world metres. */
interface WallRun {
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly height: number;
}

interface InstanceItem {
  readonly position: Vector3;
  readonly scale: Vector3;
  readonly rotationY: number;
  readonly colour: number;
  /** Optional per-instance brightness multiplier, 1 = unchanged. */
  readonly shade: number;
}

/**
 * The three unit shapes every tree is built from — a `1`-scaled cylinder,
 * icosahedron and cone, stretched per-instance by the matrices in `trunks` /
 * `roundCanopies` / `coneCanopies` below.
 *
 * Hoisted to module scope (rather than local to `buildFoliage`) so that
 * `world/FoliageFade.ts` can build a stand-in `Mesh` for a fading tree out of
 * the exact same geometry the instanced original uses — sharing one
 * `BufferGeometry` across many meshes (instanced or not) is ordinary
 * three.js, and it is what guarantees the stand-in is pixel-identical rather
 * than a hand-tuned approximation.
 */
export const FOLIAGE_GEOMETRY = {
  trunk: new CylinderGeometry(0.19, 0.3, 1, 8),
  round: new IcosahedronGeometry(1, 2),
  cone: new ConeGeometry(1, 1, 10),
};

/**
 * A lollipop tree with a generous enough canopy to climb (see
 * `world/TreeClimbing.ts`). Read-only geometry facts only — Scenery has no
 * opinion about climbing itself, it just tells the truth about where its own
 * trees are.
 */
export interface ClimbableTreeSeed {
  readonly x: number;
  readonly z: number;
  /** World-space height of the top of the canopy — where a head pops out. */
  readonly canopyTopY: number;
  /** Trunk collider radius, so a caller can stand a character just outside it. */
  readonly trunkRadius: number;
}

/**
 * One trunk, canopy blob or cone layer belonging to a {@link FoliageOccluder}
 * — everything a stand-in needs to look exactly like the instanced original
 * it is briefly replacing. See `world/FoliageFade.ts`.
 */
export interface FoliagePart extends InstanceItem {
  readonly kind: 'trunk' | 'round' | 'cone';
}

/**
 * A whole tree, as far as `world/FoliageFade.ts` is concerned: enough to test
 * "does this sit between the camera and the player" cheaply (a bounding
 * sphere, not the real silhouette) and enough to stand a translucent
 * look-alike in its place the moment it does. Read-only geometry facts only —
 * Scenery has no opinion about fading itself, exactly as it has none about
 * climbing (see {@link ClimbableTreeSeed} above).
 */
export interface FoliageOccluder {
  readonly x: number;
  readonly z: number;
  /** Vertical centre of the tree's widest canopy blob — the occlusion test's reference point. */
  readonly centreY: number;
  /** Radius of that widest blob. */
  readonly radius: number;
  /** Trunk plus every canopy/cone blob, in world space, for a matching stand-in. */
  readonly parts: readonly FoliagePart[];
}

/** One instance inside one of the foliage `InstancedMesh`es, hideable on demand. */
interface HideableInstance {
  readonly mesh: InstancedMesh;
  readonly index: number;
  /** The instance's real transform, to restore when it stops being hidden. */
  readonly matrix: Matrix4;
}

/** Degenerate matrix that renders an instance as nothing — cheaper than touching instance count. */
const HIDDEN_MATRIX = new Matrix4().makeScale(0, 0, 0);

export class Scenery {
  readonly group = new Group();
  /** The subset of trees big enough to climb. See {@link ClimbableTreeSeed}. */
  readonly climbableTrees: readonly ClimbableTreeSeed[];
  /** Every tree big enough to hide the player. See {@link FoliageOccluder}. */
  readonly foliageOccluders: readonly FoliageOccluder[];
  private readonly hideableInstances: readonly (readonly HideableInstance[])[];

  constructor(collision: CollisionWorld) {
    this.group.name = 'scenery';
    const foliage = buildFoliage(collision);
    this.group.add(foliage.group);
    this.climbableTrees = foliage.climbableTrees;
    this.foliageOccluders = foliage.occluders;
    this.hideableInstances = foliage.hideableInstances;
    this.group.add(buildTreeline());
    this.group.add(buildWoodenWalls(collision));
    this.group.add(buildStoneWalls(collision));
  }

  /**
   * Swaps one tree (indexed exactly as {@link foliageOccluders}) between its
   * ordinary instanced rendering and invisible.
   *
   * `world/FoliageFade.ts` calls this the instant a tree starts (or stops)
   * standing between the camera and the player, so it can put a translucent
   * look-alike in its place instead — an `InstancedMesh` has no per-instance
   * opacity to animate directly. Always flipped at full opacity on both
   * sides (the look-alike starts solid and only fades after the swap), so
   * there is nothing to see at the moment it happens.
   */
  setTreeHidden(occluderIndex: number, hidden: boolean): void {
    const instances = this.hideableInstances[occluderIndex];
    if (!instances) return;
    for (const { mesh, index, matrix } of instances) {
      mesh.setMatrixAt(index, hidden ? HIDDEN_MATRIX : matrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------ foliage

/** Canopy radius (of the 1.75–2.5 range rolled below) worth climbing. */
const CLIMBABLE_MIN_RADIUS = 2.05;

function buildFoliage(collision: CollisionWorld): {
  group: Group;
  climbableTrees: ClimbableTreeSeed[];
  occluders: FoliageOccluder[];
  hideableInstances: HideableInstance[][];
} {
  const group = new Group();
  group.name = 'foliage';

  const rng = new Rng(0xc0ffee);

  const trunks: InstanceItem[] = [];
  const roundCanopies: InstanceItem[] = [];
  const coneCanopies: InstanceItem[] = [];
  const bushes: InstanceItem[] = [];
  const climbableTrees: ClimbableTreeSeed[] = [];
  const occluders: FoliageOccluder[] = [];
  // Parallel to `occluders`: which (kind, index-into-that-kind's-array) pairs
  // make up each tree. Resolved into real `HideableInstance`s once the
  // `InstancedMesh`es below exist — kept as plain indices until then because
  // the meshes don't exist yet while this loop is still filling the arrays.
  const occluderRefs: { kind: 'trunk' | 'round' | 'cone'; index: number }[][] = [];

  const canopyGreens = [PALETTE.leafMid, PALETTE.leafLight, PALETTE.leafDeep, PALETTE.leafBlue];

  // --- trees ---------------------------------------------------------------
  let attempts = 0;
  let treeCount = 0;
  // Counts went up with the cartoon pass: the camera now shows about half the
  // ground it used to, so the old scatter left the near view looking bare. These
  // are all InstancedMesh, so the extra plants cost vertices and nothing else.
  const targetTrees = 72;
  while (treeCount < targetTrees && attempts < 5200) {
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

    // Occlusion bookkeeping for this tree (see `FoliageOccluder`/
    // `world/FoliageFade.ts`): every part that makes it up, in world space,
    // plus a rough bounding sphere (the widest blob's centre and radius) —
    // good enough for a cheap "does the sightline pass near here" test
    // without needing the real silhouette.
    const refs: { kind: 'trunk' | 'round' | 'cone'; index: number }[] = [];
    const parts: FoliagePart[] = [];
    let wideRadius = 0;
    let wideCentreY = y + height;

    const trunkColour = rng.chance(0.4) ? PALETTE.barkDark : PALETTE.bark;
    const trunkShade = rng.range(0.92, 1.08);
    const trunkItem: InstanceItem = {
      position: new Vector3(x, y + height / 2, z),
      scale: new Vector3(lean, height, lean),
      rotationY,
      colour: trunkColour,
      shade: trunkShade,
    };
    refs.push({ kind: 'trunk', index: trunks.length });
    parts.push({ ...trunkItem, kind: 'trunk' });
    trunks.push(trunkItem);

    const canopyBase = y + height;
    if (kind === 'pine') {
      const layers = rng.int(2, 3);
      for (let i = 0; i < layers; i += 1) {
        const t = i / layers;
        const width = rng.range(1.7, 2.3) * (1 - t * 0.42);
        const coneItem: InstanceItem = {
          position: new Vector3(x, canopyBase - 0.6 + t * 1.5, z),
          scale: new Vector3(width, rng.range(1.6, 2.2) * (1 - t * 0.2), width),
          rotationY,
          colour: rng.chance(0.5) ? PALETTE.leafDeep : PALETTE.leafMid,
          shade: rng.range(0.94, 1.06),
        };
        refs.push({ kind: 'cone', index: coneCanopies.length });
        parts.push({ ...coneItem, kind: 'cone' });
        if (width > wideRadius) {
          wideRadius = width;
          wideCentreY = coneItem.position.y;
        }
        coneCanopies.push(coneItem);
      }
    } else if (kind === 'stack') {
      const layers = 3;
      for (let i = 0; i < layers; i += 1) {
        const radius = rng.range(1.6, 2.05) * (1 - i * 0.22);
        const canopyItem: InstanceItem = {
          position: new Vector3(x, canopyBase - 0.3 + i * radius * 0.92, z),
          scale: new Vector3(radius, radius * rng.range(0.8, 0.95), radius),
          rotationY: rotationY + i,
          colour: rng.pick(canopyGreens),
          shade: rng.range(0.95, 1.08),
        };
        refs.push({ kind: 'round', index: roundCanopies.length });
        parts.push({ ...canopyItem, kind: 'round' });
        if (radius > wideRadius) {
          wideRadius = radius;
          wideCentreY = canopyItem.position.y;
        }
        roundCanopies.push(canopyItem);
      }
    } else {
      // Lollipop and blossom: one big friendly ball, sometimes with a smaller
      // one tucked beside it so the silhouette isn't a perfect circle.
      const radius = rng.range(1.75, 2.5);
      const colour = kind === 'blossom' ? PALETTE.blossomPink : rng.pick(canopyGreens);
      const canopyVScale = rng.range(0.82, 1.0);
      const canopyCentreY = canopyBase + radius * 0.42;
      const canopyItem: InstanceItem = {
        position: new Vector3(x, canopyCentreY, z),
        scale: new Vector3(radius, radius * canopyVScale, radius),
        rotationY,
        colour,
        shade: rng.range(0.95, 1.06),
      };
      refs.push({ kind: 'round', index: roundCanopies.length });
      parts.push({ ...canopyItem, kind: 'round' });
      wideRadius = radius;
      wideCentreY = canopyCentreY;
      roundCanopies.push(canopyItem);
      // Climbable: a plain lollipop with plenty of canopy to hide a body in.
      // Blossom trees are excluded — a face poking out of cherry-blossom
      // fluff reads oddly, and the stacked/pine kinds have no one big canopy
      // to disappear into.
      if (kind === 'lollipop' && radius >= CLIMBABLE_MIN_RADIUS) {
        climbableTrees.push({
          x,
          z,
          canopyTopY: canopyCentreY + radius * canopyVScale,
          trunkRadius: 0.55 * lean,
        });
      }
      if (rng.chance(0.55)) {
        const small = radius * rng.range(0.5, 0.72);
        const offset = rng.range(0, TAU);
        const smallItem: InstanceItem = {
          position: new Vector3(
            x + Math.cos(offset) * radius * 0.7,
            canopyBase + radius * rng.range(0.1, 0.5),
            z + Math.sin(offset) * radius * 0.7,
          ),
          scale: new Vector3(small, small * 0.9, small),
          rotationY: rotationY + 1.3,
          colour: kind === 'blossom' ? PALETTE.blossomWhite : colour,
          shade: rng.range(0.92, 1.04),
        };
        refs.push({ kind: 'round', index: roundCanopies.length });
        parts.push({ ...smallItem, kind: 'round' });
        roundCanopies.push(smallItem);
      }
    }

    occluders.push({ x, z, centreY: wideCentreY, radius: wideRadius, parts });
    occluderRefs.push(refs);

    collision.addCircle(x, z, 0.55 * lean);
    treeCount += 1;
  }

  // --- bushes --------------------------------------------------------------
  let bushCount = 0;
  attempts = 0;
  while (bushCount < 108 && attempts < 5200) {
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
      const radius = rng.range(0.7, 1.3);
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

  // Flowers used to be scattered here too, as static decoration. They are now
  // a living, pickable population — see `world/Flowers.ts` — built and owned
  // separately so this file stays about the things that never move.

  // Subdivision 2 rather than 1: still faceted enough to look hand-made, but
  // rounded rather than spiky — a bush, not a lump of quartz.
  const bushGeometry = facetted(new IcosahedronGeometry(1, 2));

  const trunkMesh = makeInstanced(
    'tree-trunks',
    FOLIAGE_GEOMETRY.trunk,
    foliageMaterial(0.95),
    trunks,
    true,
  );
  const canopyMesh = makeInstanced(
    'tree-canopies',
    FOLIAGE_GEOMETRY.round,
    foliageMaterial(0.85),
    roundCanopies,
    true,
  );
  const coneMesh = makeInstanced(
    'tree-cones',
    FOLIAGE_GEOMETRY.cone,
    foliageMaterial(0.85),
    coneCanopies,
    true,
  );
  group.add(
    trunkMesh,
    canopyMesh,
    coneMesh,
    makeInstanced('bushes', bushGeometry, foliageMaterial(0.9), bushes, true),
  );

  // Resolve every tree's `occluderRefs` into real `HideableInstance`s now
  // that the meshes they point into actually exist. `getMatrixAt` reads back
  // exactly the matrix `makeInstanced` just composed, so there is no second
  // place that has to agree with its position/rotation/scale maths.
  const scratchMatrix = new Matrix4();
  const hideableInstances: HideableInstance[][] = occluderRefs.map((refs) =>
    refs.map(({ kind, index }) => {
      const mesh = kind === 'trunk' ? trunkMesh : kind === 'round' ? canopyMesh : coneMesh;
      mesh.getMatrixAt(index, scratchMatrix);
      return { mesh, index, matrix: scratchMatrix.clone() };
    }),
  );

  return { group, climbableTrees, occluders, hideableInstances };
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
  const canopyGeometry = facetted(new IcosahedronGeometry(1, 1));

  // No shadows out here: the treeline sits far outside the sun's shadow frustum
  // and adding it would only cost fill rate.
  group.add(
    makeInstanced('treeline-trunks', trunkGeometry, foliageMaterial(0.95), trunks, false),
    makeInstanced('treeline-canopies', canopyGeometry, foliageMaterial(0.9), canopies, false),
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

/**
 * Foliage is toon-shaded like every other toy object in the park.
 *
 * `roughness` is retained in the signature for call-site compatibility and is
 * deliberately ignored — under toon shading it is the ramp, not a roughness
 * value, that decides how leaves shade. (Dead parameter; delete it once nothing
 * passes one.)
 */
function foliageMaterial(_roughness: number): MeshToonMaterial {
  return toonMaterial(0xffffff);
}

/**
 * Recomputes flat, per-face normals so a blob reads as hand-carved.
 *
 * `MeshToonMaterial` has no `flatShading` flag, so the facets have to come from
 * the geometry. These are non-indexed polyhedra, which means
 * `computeVertexNormals()` gives exactly the face normals we want — and it works
 * for every material, not just the ones that happen to expose the flag.
 */
function facetted<T extends BufferGeometry>(geometry: T): T {
  geometry.computeVertexNormals();
  return geometry;
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

  const runs: readonly WallRun[] = [
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

  const boardMaterial = toonMaterial(0xffffff, { map: woodTexture(1, 1) });
  const postMaterial = toonMaterial(PALETTE.woodDark);
  const capMaterial = toonMaterial(PALETTE.woodLight);
  const postGeometry = new CylinderGeometry(0.19, 0.21, 1, 8);
  const capGeometry = new SphereGeometry(0.24, 10, 8);

  for (const run of clearOfAnchors(runs)) {
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

    // Real wall height, not the `Infinity` default — this is what lets a jump
    // clear a low or mid wall while a tall one still stops you (Collision.ts).
    // `autoHoppable: true` is what lets `Player` clear one on its own, with no
    // button press, the moment walking (or tap-to-move) runs into one it
    // could jump anyway (design feedback #30e).
    collision.addWall(x1, z1, x2, z2, 0.22, run.height, true);
  }

  return group;
}

/** Low pink stone walls: garden-bed edging around the plaza and a few benches
 *  of stonework out on the lawn. */
function buildStoneWalls(collision: CollisionWorld): Group {
  const group = new Group();
  group.name = 'stone-walls';

  const runs: readonly WallRun[] = [
    { from: [-13, -4], to: [-13, 4], height: 0.85 },
    { from: [13, -5], to: [13, 2], height: 0.85 },
    { from: [-7, 12], to: [7, 12], height: 0.7 },
    { from: [-6, -12], to: [6, -12], height: 0.7 },
    { from: [22, -6], to: [22, 4], height: 1.2 },
    { from: [-24, 4], to: [-24, 12], height: 1.2 },
    { from: [6, 26], to: [14, 24], height: 0.95 },
    { from: [-14, -22], to: [-6, -23], height: 0.95 },
  ];

  const wallMaterial = toonMaterial(0xffffff, { map: pinkStoneTexture(1, 1) });
  const copingMaterial = toonMaterial(PALETTE.stonePinkLight);
  const finialMaterial = toonMaterial(PALETTE.stonePink);

  // Ball finial + collar at each end of every run — the one detail that makes a
  // wall look cared for rather than extruded. Instanced, because two extra draw
  // calls for the whole park is affordable and thirty-two is not.
  const placed = clearOfAnchors(runs);
  const finials: InstanceItem[] = [];
  const collars: InstanceItem[] = [];

  for (const run of placed) {
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

    // Seated so the ball OVERLAPS its collar and the collar overlaps the
    // coping. Floating them clear leaves a visible gap between ball and wall.
    const copingTop = base + run.height + 0.16;
    for (const [px, pz] of [run.from, run.to]) {
      collars.push({
        position: new Vector3(px, copingTop + 0.02, pz),
        scale: new Vector3(1.45, 0.55, 1.45),
        rotationY: -angle,
        colour: PALETTE.stonePinkLight,
        shade: 1,
      });
      finials.push({
        position: new Vector3(px, copingTop + 0.16, pz),
        scale: new Vector3(1, 1.15, 1),
        rotationY: -angle,
        colour: PALETTE.stonePink,
        shade: 1,
      });
    }

    // Real wall height, not the `Infinity` default — see the wooden walls
    // above, including why `autoHoppable` is `true` here too.
    collision.addWall(x1, z1, x2, z2, 0.34, run.height, true);
  }

  group.add(
    makeInstanced('wall-collars', new SphereGeometry(0.13, 12, 9), copingMaterial, collars, false),
    makeInstanced('wall-finials', new SphereGeometry(0.19, 14, 11), finialMaterial, finials, true),
  );

  return group;
}

/**
 * Trims wall runs back to the parts that clear every anchor plot.
 *
 * The tree and bush scatter has always honoured `anchor.boundingRadius`; the
 * wall tables were hand-authored before the plots were built out and did not,
 * which is how a hiding wall ended up sliced through the ball pit. A run is
 * clipped to the parameter spans that lie outside every plot, so a wall now
 * stops at the edge of a ride's plot instead of crossing it. Anything left
 * shorter than {@link MIN_WALL_LENGTH} is dropped: a two-post stub reads as a
 * mistake, not as scenery.
 */
function clearOfAnchors(runs: readonly WallRun[], margin = 0.6): WallRun[] {
  const kept: WallRun[] = [];
  for (const run of runs) {
    const [x1, z1] = run.from;
    const [x2, z2] = run.to;
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;

    // Spans of the run, in 0..1 parameter space, still outside every plot.
    let spans: [number, number][] = [[0, 1]];
    for (const anchor of ANCHORS) {
      const radius = anchor.boundingRadius + margin;
      const ox = x1 - anchor.position[0];
      const oz = z1 - anchor.position[1];
      const a = dx * dx + dz * dz;
      const b = 2 * (ox * dx + oz * dz);
      const c = ox * ox + oz * oz - radius * radius;
      const discriminant = b * b - 4 * a * c;
      if (discriminant <= 0) continue; // the run's line misses this plot entirely

      const root = Math.sqrt(discriminant);
      const enter = (-b - root) / (2 * a);
      const exit = (-b + root) / (2 * a);
      const next: [number, number][] = [];
      for (const [start, end] of spans) {
        if (exit <= start || enter >= end) {
          next.push([start, end]);
          continue;
        }
        if (enter > start) next.push([start, enter]);
        if (exit < end) next.push([exit, end]);
      }
      spans = next;
    }

    for (const [start, end] of spans) {
      if ((end - start) * length < MIN_WALL_LENGTH) continue;
      kept.push({
        from: [x1 + dx * start, z1 + dz * start],
        to: [x1 + dx * end, z1 + dz * end],
        height: run.height,
      });
    }
  }
  return kept;
}

/** Shorter than this and a trimmed run is dropped rather than built. */
const MIN_WALL_LENGTH = 1.8;

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
