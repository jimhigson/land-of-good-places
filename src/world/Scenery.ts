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
import { PARK_SEED } from './parkManifest';
import { PARK_LAYOUT } from './parkLayout';
import {
  TRAIN_PLAN,
  distanceToRailCorridor,
  RAIL_CORRIDOR_CLEARANCE,
} from './train/plan';
import { terrainHeight } from './terrain';
import { isOnPath, PLAZA } from './paths';
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

/** Which palette a run is built from — and how thick it therefore is. */
type WallKind = 'wood' | 'stone';

/** One straight length of wall, in world metres. */
interface WallRun {
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly height: number;
  readonly kind: WallKind;
  /**
   * Runs belonging to one deliberately-joined structure — the two arms of an
   * L-shaped maze piece, which meet at a shared corner on purpose. Distinct
   * pieces must keep {@link WALL_RUN_GAP} apart; arms of the same piece are
   * exempt, because "these two touch" is the whole point of an L.
   */
  readonly piece: number;
}

/**
 * Half the thickness of a run, for clearance maths.
 *
 * Taken from what is actually built, not from the collider: the stone runs'
 * coping stone is the widest part of them at 0.72 m (`buildStoneWalls`), wider
 * than both the 0.55 m wall below it and the 0.34 m half-width the collider
 * gets. Measuring the collider would let two copings touch while the colliders
 * still read as clear.
 */
const WALL_HALF_WIDTH: Record<WallKind, number> = { wood: 0.24, stone: 0.36 };

/**
 * Gap kept between the faces of any two wall runs.
 *
 * Wide enough to walk down: `PLAYER_RADIUS` is 0.62, so a 2 m lane leaves a
 * child three-quarters of a metre of daylight either shoulder. The narrower
 * alternative is worse than it sounds — a 40 cm slot between two walls is not
 * a passage, it is a place to get stuck, and `NavGrid` (which fattens every
 * collider by the walker's radius before it decides a cell is walkable) would
 * classify it as solid anyway, leaving a visible gap the map says is a wall.
 */
const WALL_RUN_GAP = 2;

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

/**
 * A wall run as actually built — the run plus the half-width it occupies.
 *
 * Published for the same reason {@link FoliageOccluder} is: a check that wants
 * to prove no two walls cross should measure the walls that exist, not
 * re-derive them from the rules that made them. Re-deriving would only ever
 * prove the rules agree with themselves.
 */
export interface PlacedWallRun {
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly height: number;
  readonly kind: WallKind;
  /** Runs sharing this are one structure and may touch. See {@link WallRun}. */
  readonly piece: number;
  /** Half the widest part of it, in metres. See {@link WALL_HALF_WIDTH}. */
  readonly halfWidth: number;
}

export class Scenery {
  readonly group = new Group();
  /** Every wall run standing in the park. See {@link PlacedWallRun}. */
  readonly wallRuns: readonly PlacedWallRun[];
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
    // Collected as they are built, after `clearOfAnchors` has trimmed them,
    // so what is published is what is standing.
    const built: PlacedWallRun[] = [];
    this.group.add(buildWoodenWalls(collision, built));
    this.group.add(buildStoneWalls(collision, built));
    this.wallRuns = built;
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

/**
 * How far each kind of tree can possibly reach sideways from its trunk.
 *
 * These are the **ceilings of the rolls below**, not tuned spacing numbers, and
 * they have to be read off the rolls whenever those change:
 *
 * - `pine` — cone widths roll `rng.range(1.7, 2.3)`, narrowing with height, all
 *   centred on the trunk. Ceiling 2.3.
 * - `stack` — canopy radii roll `rng.range(1.6, 2.05)`, narrowing per layer,
 *   centred. Ceiling 2.05.
 * - `lollipop` / `blossom` — a main ball of up to 2.5, plus the optional small
 *   ball tucked beside it at `radius * 0.7` carrying its own `radius * 0.72`.
 *   Ceiling `2.5 * (0.7 + 0.72)` = 3.55, and it is the side ball that makes
 *   these the widest thing on the lawn.
 *
 * Reserved before a tree is rolled in detail, so a candidate is refused for
 * the space it *could* take rather than the space it happens to take. That
 * over-reserves a little; two canopies growing through each other is the thing
 * being prevented, and 53 pairs of them were doing exactly that.
 */
const TREE_REACH: Record<TreeKind, number> = {
  pine: 2.3,
  stack: 2.05,
  lollipop: 3.55,
  blossom: 3.55,
};

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
  // Where the trees already are, and how far each reaches — the scatter used
  // to keep no such record, and so planted 72 trees that knew about the paths
  // and the plots and nothing whatever about each other. Fifty-three pairs of
  // canopies grew through one another on the canonical seed, the worst by
  // 4.32 m, which at a 2.5 m canopy is one tree standing inside another.
  const planted: { x: number; z: number; reach: number }[] = [];
  // Attempts raised with the new refusal: the old budget was sized for a test
  // that almost never said no.
  while (treeCount < targetTrees && attempts < 26000) {
    attempts += 1;
    const angle = rng.range(0, TAU);
    const distance = Math.sqrt(rng.unit()) * 54;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (!isPlantable(x, z, 2.6)) continue;

    const kind = pickTreeKind(rng);
    const reach = TREE_REACH[kind];
    if (planted.some((tree) => Math.hypot(x - tree.x, z - tree.z) < tree.reach + reach)) continue;
    planted.push({ x, z, reach });
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

/** Somewhere we are allowed to plant: not on paving, not in a reserved plot,
 * not on the railway. */
function isPlantable(x: number, z: number, clearance: number): boolean {
  if (Math.hypot(x, z) > 55) return false;
  if (isOnPath(x, z, clearance)) return false;
  // Keep the fountain plaza open — wherever the layout put it (Decision 5).
  if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.radius + 1.6) return false;
  if (insideAnyAnchor(x, z, clearance)) return false;
  if (onRailway(x, z, clearance)) return false;
  return true;
}

/**
 * The rail corridor and the platforms. The dependency used to point the
 * other way — the route was solved against the finished collision world and
 * bent around trees — but the route is a pure pre-scene plan now
 * (`train/plan.ts`), so the trees are the ones that give way.
 */
function onRailway(x: number, z: number, clearance: number): boolean {
  const route = TRAIN_PLAN.route;
  const near = route.pointAt(route.distanceNear(x, z), railProbe);
  // Fence at 2.0 m either side, plus the plant's own clearance.
  if (Math.hypot(near.x - x, near.z - z) < 2.6 + clearance) return true;
  for (const station of TRAIN_PLAN.stations) {
    if (Math.hypot(station.standX - x, station.standZ - z) < 5.2 + clearance) return true;
  }
  return false;
}
const railProbe = new Vector3();

function insideAnyAnchor(x: number, z: number, margin: number): boolean {
  // Every placed entry, not just the five big anchors: the stalls and their
  // stand points are in the layout too, and a maze wall built beside a booth
  // pockets the booth's doormat — three waypoints were walled in exactly
  // that way the first time the generated park rolled.
  for (const entry of PARK_LAYOUT.entries.values()) {
    const dx = x - entry.x;
    const dz = z - entry.z;
    if (Math.hypot(dx, dz) < entry.boundingRadius + margin + 2.5) return true;
  }
  return false;
}

// -------------------------------------------------------------------- walls

/**
 * The whole run sits on open plantable lawn, and off the railway.
 *
 * Sampled every half metre rather than at five fixed fractions: a run is up to
 * 8.5 m long, and quarter-points 2 m apart step straight over a path corner or
 * a dip in the rail corridor. The rail test is the one this file did not used
 * to make at all — `Scenery` runs long before the train does (see `World`) and
 * so had no idea where the rails were going. It does now, because
 * {@link distanceToRailCorridor} is decided by the layout rather than by the
 * built park; on the canonical seed the nearest pink wall stood **0.14 m** from
 * the centre line, which is a wall through the train.
 */
function runIsClear(x1: number, z1: number, x2: number, z2: number): boolean {
  const steps = Math.max(4, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 0.5));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const z = z1 + (z2 - z1) * t;
    if (!isPlantable(x, z, 3.2)) return false;
    if (distanceToRailCorridor(x, z) < RAIL_CORRIDOR_CLEARANCE) return false;
  }
  return true;
}

/** Do these two runs come within {@link WALL_RUN_GAP} of one another? */
function runsClash(a: WallRun, b: WallRun): boolean {
  if (a.piece === b.piece) return false;
  const needed = WALL_HALF_WIDTH[a.kind] + WALL_HALF_WIDTH[b.kind] + WALL_RUN_GAP;
  return segmentDistance(a.from, a.to, b.from, b.to) < needed;
}

/** True if `candidate` may be built alongside everything in `placed`. */
function fitsAmong(candidate: WallRun, placed: readonly WallRun[]): boolean {
  return !placed.some((run) => runsClash(candidate, run));
}

/**
 * The park's whole wall layout, wooden and stone together, solved once.
 *
 * Together is the point. The two builders used to generate independently and
 * neither could see the other's runs, so a hiding wall and a garden bed could
 * be laid across each other — measured on the canonical seed at **-0.5 m**,
 * i.e. properly interpenetrating, and on six other pairs besides. The maze's
 * own {@link MAZE_PIECE_GAP} only ever separated maze *corners* from each
 * other, and the stone benches had no separation rule at all.
 *
 * Memoised because both builders need the same answer and the generation is
 * pure: same {@link PARK_SEED}, same park.
 */
let cachedWallPlan: { readonly wood: readonly WallRun[]; readonly stone: readonly WallRun[] } | null =
  null;

function wallPlan(): { readonly wood: readonly WallRun[]; readonly stone: readonly WallRun[] } {
  if (cachedWallPlan) return cachedWallPlan;
  // One growing list of everything accepted so far, shared by both generators.
  const placed: WallRun[] = [];
  // The maze goes down first, and the order is worth keeping. It is the more
  // constrained of the two — an L-piece needs two clear arms *and* 19 m of
  // separation from every other corner — and it is the thing the design doc
  // asks for by name, somewhere "to run around and hide behind". The stone
  // runs are short enough to slot into whatever it leaves.
  //
  // This is a genuinely tight lawn: every plot excludes its bounding radius
  // plus 5.7 m, so the two structures really do compete. Measured on the
  // canonical seed — maze first gives 4 wooden and 6 stone segments; stone
  // first gives 8 stone and no hiding maze at all.
  const wood = generateWallMaze(placed);
  const stone = generateStoneRuns(placed);
  cachedWallPlan = { wood, stone };
  return cachedWallPlan;
}

/**
 * The hiding maze: L-shaped pieces scattered on the lawn. Two segments can
 * never close a region, and pieces keep {@link MAZE_PIECE_GAP} apart, so the
 * maze stays open however the seed falls — `check:park`'s routing invariant
 * then proves it, rather than trusting this comment.
 */
const MAZE_PIECE_GAP = 7;

function generateWallMaze(placed: WallRun[]): WallRun[] {
  const rng = new Rng(0x77a115 ^ PARK_SEED);
  // Exactly 1.00 m sits ON the measured flight ceiling and fails the boot
  // assert by a float hair - honest heights only.
  const heights = [0.8, 0.95, 1.5, 1.8, 2.1, 2.6];
  const runs: WallRun[] = [];
  const cornerPoints: [number, number][] = [];
  let attempts = 0;
  let piece = 0;
  while (runs.length < 10 && attempts < 4000) {
    attempts += 1;
    const angle = rng.range(0, Math.PI * 2);
    const radius = Math.sqrt(rng.range(13 * 13, 42 * 42));
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    if (cornerPoints.some(([px, pz]) => Math.hypot(cx - px, cz - pz) < MAZE_PIECE_GAP + 12)) {
      continue;
    }
    const yaw = rng.pick([0, Math.PI / 2] as const) + rng.range(-0.12, 0.12);
    const armA = rng.range(5.5, 8.5);
    const armB = rng.range(4.5, 7.5);
    const a2: [number, number] = [cx + Math.cos(yaw) * armA, cz + Math.sin(yaw) * armA];
    const b2: [number, number] = [
      cx + Math.cos(yaw + Math.PI / 2) * armB,
      cz + Math.sin(yaw + Math.PI / 2) * armB,
    ];
    if (!runIsClear(cx, cz, a2[0], a2[1]) || !runIsClear(cx, cz, b2[0], b2[1])) continue;

    // The L goes down whole or not at all: half a hiding piece is a stub.
    piece += 1;
    const armOne: WallRun = {
      from: [cx, cz],
      to: a2,
      height: rng.pick(heights),
      kind: 'wood',
      piece,
    };
    const armTwo: WallRun = {
      from: [cx, cz],
      to: b2,
      height: rng.pick(heights),
      kind: 'wood',
      piece,
    };
    if (!fitsAmong(armOne, placed) || !fitsAmong(armTwo, placed)) continue;

    runs.push(armOne, armTwo);
    placed.push(armOne, armTwo);
    cornerPoints.push([cx, cz]);
  }
  return runs;
}

/** Plaza garden beds on four tangents, plus benches out on the lawn. */
function generateStoneRuns(placed: WallRun[]): WallRun[] {
  const rng = new Rng(0x57013e ^ PARK_SEED);
  const runs: WallRun[] = [];
  let piece = 1000;
  const consider = (run: WallRun): void => {
    if (!runIsClear(run.from[0], run.from[1], run.to[0], run.to[1])) return;
    if (!fitsAmong(run, placed)) return;
    runs.push(run);
    placed.push(run);
  };

  // Beds: short tangent walls just off the plaza kerb, at seeded bearings.
  const bedDistance = PLAZA.radius + 3.2;
  for (let i = 0; i < 4; i += 1) {
    const bearing = (i / 4) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const cx = PLAZA.x + Math.cos(bearing) * bedDistance;
    const cz = PLAZA.z + Math.sin(bearing) * bedDistance;
    const tangent = bearing + Math.PI / 2;
    const half = rng.range(3, 4.5);
    const from: [number, number] = [cx - Math.cos(tangent) * half, cz - Math.sin(tangent) * half];
    const to: [number, number] = [cx + Math.cos(tangent) * half, cz + Math.sin(tangent) * half];
    piece += 1;
    consider({ from, to, height: rng.pick([0.7, 0.85] as const), kind: 'stone', piece });
  }
  // Benches: low stonework on open lawn, honestly hoppable heights only.
  // The attempt budget is generous because most candidates are now refused —
  // a bench crossing another bench used to be accepted without a murmur.
  let attempts = 0;
  while (runs.length < 8 && attempts < 6000) {
    attempts += 1;
    const angle = rng.range(0, Math.PI * 2);
    const radius = Math.sqrt(rng.range(16 * 16, 44 * 44));
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    const yaw = rng.range(0, Math.PI);
    // Shorter than the 7-9 m these used to roll. A run that long is a garden
    // wall, and the lawn has very few 9 m stretches that clear every path,
    // plot and now the railway along their whole length — the old length only
    // ever fitted because `runIsClear` sampled five points and stepped over
    // what lay between them. 4.4-6.4 m still reads as stonework to sit on.
    const half = rng.range(2.2, 3.2);
    const from: [number, number] = [cx - Math.cos(yaw) * half, cz - Math.sin(yaw) * half];
    const to: [number, number] = [cx + Math.cos(yaw) * half, cz + Math.sin(yaw) * half];
    piece += 1;
    consider({ from, to, height: rng.pick([0.8, 0.95] as const), kind: 'stone', piece });
  }
  return runs;
}


/**
 * Wooden walls at various heights — the design doc asks for things "to run
 * around and hide behind", so these are laid out as a loose, open maze rather
 * than a fence line.
 */
function buildWoodenWalls(collision: CollisionWorld, built: PlacedWallRun[]): Group {
  const group = new Group();
  group.name = 'wooden-walls';

  // Generated, not authored (Decision 5): five L-shaped pieces of hiding
  // maze, seeded off PARK_SEED, each validated against the generated paths
  // and plots. Heights come from a palette that deliberately skips the
  // 1.0-1.5 m band: `checkHoppableColliders` proved the jump clears 1.0 m
  // and strands on anything up to ~1.43 m, so a wall is either honestly
  // hoppable or honestly solid, never in the trap between.
  const runs: readonly WallRun[] = wallPlan().wood;

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
    built.push({ ...run, halfWidth: WALL_HALF_WIDTH[run.kind] });
  }

  return group;
}

/** Low pink stone walls: garden-bed edging around the plaza and a few benches
 *  of stonework out on the lawn. */
function buildStoneWalls(collision: CollisionWorld, built: PlacedWallRun[]): Group {
  const group = new Group();
  group.name = 'stone-walls';

  // Four tangent-aligned beds around the plaza plus four lawn benches,
  // generated from the layout (Decision 5). Every stone height is honestly
  // hoppable (<= 1.0 m): the first generated roll put 1.2 m benches in the
  // 1.0-1.43 m trap band and the boot assert refused the park, which is
  // that assert doing exactly its job.
  const runs: readonly WallRun[] = wallPlan().stone;

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
    built.push({ ...run, halfWidth: WALL_HALF_WIDTH[run.kind] });
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
        kind: run.kind,
        // Sub-spans of one run keep its piece id. They are collinear parts of
        // the same wall, so exempting them from each other's clearance is
        // right — and they could not clash if they tried.
        piece: run.piece,
      });
    }
  }
  return kept;
}

/** Shorter than this and a trimmed run is dropped rather than built. */
const MIN_WALL_LENGTH = 1.8;

/**
 * Closest approach between two line segments, in metres. Zero if they cross.
 *
 * Exact rather than sampled: two walls laid across each other in an X touch at
 * exactly one point, and a sampler stepping along both of them can step over
 * it and report a comfortable gap where there is a crossing.
 */
function segmentDistance(
  a1: readonly [number, number],
  a2: readonly [number, number],
  b1: readonly [number, number],
  b2: readonly [number, number],
): number {
  if (segmentsCross(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointToSegment(a1, b1, b2),
    pointToSegment(a2, b1, b2),
    pointToSegment(b1, a1, a2),
    pointToSegment(b2, a1, a2),
  );
}

function segmentsCross(
  a1: readonly [number, number],
  a2: readonly [number, number],
  b1: readonly [number, number],
  b2: readonly [number, number],
): boolean {
  const side = (
    p: readonly [number, number],
    q: readonly [number, number],
    r: readonly [number, number],
  ): number => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const d1 = side(b1, b2, a1);
  const d2 = side(b1, b2, a2);
  const d3 = side(a1, a2, b1);
  const d4 = side(a1, a2, b2);
  return d1 !== d2 && d3 !== d4;
}

function pointToSegment(
  p: readonly [number, number],
  s1: readonly [number, number],
  s2: readonly [number, number],
): number {
  const dx = s2[0] - s1[0];
  const dz = s2[1] - s1[1];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-12) return Math.hypot(p[0] - s1[0], p[1] - s1[1]);
  let t = ((p[0] - s1[0]) * dx + (p[1] - s1[1]) * dz) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - (s1[0] + dx * t), p[1] - (s1[1] + dz * t));
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
