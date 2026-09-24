import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Mesh,
  SphereGeometry,
  Vector3,
} from 'three';
import { STONE_WALL_COLLIDER_HALF, WOOD_WALL_COLLIDER_HALF } from '../core/constants';
import { edgeRadiusAt, PARK_BOUNDARY, TERRAIN_APRON } from './boundary';
/** Where the screening woodland starts, beyond the edge. Was 71.5 against a 60 m wall. */
const TREELINE_OUTSET_INNER = 11.5;
import { PALETTE } from '../core/palette';
import { Rng, TAU } from '../core/mathUtils';
import { pinkStoneTexture, woodTexture } from '../core/textures';
import { toonMaterial } from '../art/style/materials';
import { SKULL_RADIUS } from '../art/models/kid';
import { TRAIN_PLAN } from './train/plan';
import { isInBridgeFootprint } from './train/bridgeKeepout';
import { placeOnSphere, standOnSphere, terrainHeight } from './terrain';
import { COASTER_PLANS } from './coaster/plan';
import { hidesTheArrivingBus } from './entrance/arrivalSightline';
import { distanceToEntranceCorridor } from './entrance/roadRoute';
import { CART_ENVELOPE } from './coaster/cart';
import type { CollisionWorld } from './Collision';
// **The trees are not this file's to define.** See `world/treeModel.ts`: the
// lane the cat bus drives up plants the same trees from the same rolls, so
// they live in a module neither scene owns and both ask.
import { CANOPY_GREENS, FOLIAGE_GEOMETRY, fileTreeParts, foliageMaterial, makeInstanced, type InstanceItem, type RolledTree, type TreeKind, type TreePart } from './treeModel';
import { type Claim } from '../boot/groundClaims';

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

/** Which palette a run is built from — and how thick it therefore is. */
type WallKind = 'wood' | 'stone';

/** One straight length of wall, in world metres. */
export interface WallRun {
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
export const WALL_HALF_WIDTH: Record<WallKind, number> = { wood: 0.24, stone: 0.36 };

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
 *
 * The park's name for `treeModel.ts`'s {@link TreePart}: same thing, and the
 * alias exists only so the fade machinery keeps reading in the vocabulary of
 * the file it was written against.
 */
export type FoliagePart = TreePart;

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
  /**
   * **The flat-frame column this tree stands in** — the very `(x, z)` its trunk
   * collider was registered at, and the one {@link ClimbableTreeSeed} records.
   *
   * {@link x}/{@link z} are *not* that, and have not been since the trees
   * started leaning: they are the **drawn** centre of the widest canopy blob,
   * which `placeOnSphere` slides outward along the local up. Measured on the
   * canonical seed, the two are **1.67 m apart at a radius of 80 m and 2.94 m
   * at 176 m** — so any code that used `x`/`z` as "where this tree is on the
   * ground" silently stopped finding it.
   *
   * Two live bugs came from exactly that, both found by `check:climb-wave`
   * going red on the sphere branch: {@link Scenery.clearTreesNear} matched a
   * felled tree against {@link climbableTrees} by `x`/`z` and so **never**
   * matched — a felled tree stayed climbable — and the fell search itself
   * probed the canopy's slid centre against the trunk's own radius. Both ask
   * about the foot, so both ask this.
   */
  readonly footX: number;
  /** See {@link footX}. */
  readonly footZ: number;
  /** Vertical centre of the tree's widest canopy blob — the occlusion test's reference point. */
  readonly centreY: number;
  /** Radius of that widest blob. */
  readonly radius: number;
  /**
   * Trunk plus every canopy/cone blob, for a matching stand-in — **in the flat
   * frame, not in world space.** Each `position` is an `(x, z)` and a height
   * above the ground in that column, exactly as the tree was rolled; the drawn
   * instance is that part put through `placeOnSphere` (`makeInstanced`,
   * `FoliageFade`), which lifts it along the leaning local up and so slides it
   * outward. Anything that measures these against drawn geometry must map them
   * the same way first, or it counts the lean zero times or twice — `TreeFact`
   * did the latter and reported a tree standing on the railway (#653, #661).
   * For where the tree itself stands, use {@link footX}/{@link footZ}.
   */
  readonly parts: readonly FoliagePart[];
}

/** One instance inside one of the foliage `InstancedMesh`es, hideable on demand. */
interface HideableInstance {
  readonly mesh: InstancedMesh;
  readonly index: number;
  /** The instance's real transform, to restore when it stops being hidden. */
  readonly matrix: Matrix4;
}

/**
 * One tree's own collision registration, indexed exactly as
 * {@link FoliageOccluder} — see {@link Scenery.clearTreesNear}.
 */
interface TreeCollider {
  /** The id `collision.addCircle` handed back, so it can be taken out again. */
  readonly id: number;
  /** The trunk collider's own radius — what "does this tree block that spot" asks against. */
  readonly radius: number;
}

/**
 * One bush clump's own collision registration, indexed exactly as the
 * `bushes` array {@link Scenery} publishes — the bush equivalent of
 * {@link TreeCollider}. A clump is two or three blob *instances* in the one
 * shared `bushes` `InstancedMesh` rather than a single instance, so felling
 * one has to hide a contiguous run rather than one index.
 */
interface BushCollider {
  /** The id `collision.addCircle` handed back, so it can be taken out again. */
  readonly id: number;
  /** First instance index in the shared `bushes` mesh this clump's blobs occupy. */
  readonly instanceStart: number;
  /** How many consecutive instances, starting there, belong to this clump. */
  readonly instanceCount: number;
}

/** Degenerate matrix that renders an instance as nothing — cheaper than touching instance count. */
const HIDDEN_MATRIX = new Matrix4().makeScale(0, 0, 0);

/** Scratch for leaning a tree's sightline sphere onto the sphere. */
const occluderFlat = new Vector3();
const occluderCentre = new Vector3();
const occluderSpin = new Quaternion();
/** Scratches for testing the treeline's corridor gate where the canopy is *drawn*. */
const canopyFlat = new Vector3();
const canopyDrawn = new Vector3();
const canopySpin = new Quaternion();

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

/**
 * One planted bush clump — where it stands and how far it spreads.
 *
 * Published for exactly the reason {@link PlacedWallRun} is: the scatter had no
 * observable output at all for bushes, so nothing in the test suite could see
 * one move. That is not a hypothetical gap — bushes shared a generator with the
 * trees, so every tree gained or lost anywhere in the park silently re-rolled
 * all 108 clumps, and no check could have noticed.
 *
 * The clump, not its individual blobs: the blobs are a rendering detail, while
 * the clump is the thing that occupies ground and takes a collider.
 */
export interface PlacedBush {
  readonly x: number;
  readonly z: number;
  /** Radius of the collider the clump registers. */
  readonly radius: number;
}

export class Scenery {
  readonly group = new Group();
  /** Every wall run standing in the park. See {@link PlacedWallRun}. */
  readonly wallRuns: readonly PlacedWallRun[];
  /**
   * The subset of trees big enough to climb. See {@link ClimbableTreeSeed}.
   * Mutable internally — {@link clearTreesNear} strikes a felled tree out —
   * exposed read-only because nothing outside this file plants or fells one.
   */
  private readonly climbableTreesMutable: ClimbableTreeSeed[];
  get climbableTrees(): readonly ClimbableTreeSeed[] {
    return this.climbableTreesMutable;
  }
  /**
   * Every tree big enough to hide the player. See {@link FoliageOccluder}.
   * Indexed exactly as {@link hideableInstances} and {@link treeColliders} —
   * the three are filled by the same loop, one push apiece, per tree — so
   * {@link clearTreesNear} can remove all three at once by index.
   */
  private readonly occludersMutable: FoliageOccluder[];
  get foliageOccluders(): readonly FoliageOccluder[] {
    return this.occludersMutable;
  }
  /**
   * Every bush clump standing in the park. See {@link PlacedBush}. Mutable
   * internally for the same reason {@link occludersMutable} is — a felled
   * clump comes out of this list too.
   */
  private readonly bushesMutable: PlacedBush[];
  get bushes(): readonly PlacedBush[] {
    return this.bushesMutable;
  }
  private readonly hideableInstances: HideableInstance[][];
  private readonly treeColliders: TreeCollider[];
  private readonly bushColliders: BushCollider[];
  private readonly bushMesh: InstancedMesh;
  private readonly collision: CollisionWorld;

  /**
   * Draws the decisions the world phase made (`worldPhase.ts`): every tree,
   * bush and wall run here was placed by its own {@link FeatureBuilder}
   * against the claims registry, and nothing is decided in this constructor.
   */
  constructor(collision: CollisionWorld, decisions: SceneryDecisions) {
    this.group.name = 'scenery';
    this.collision = collision;
    const foliage = buildFoliage(collision, decisions);
    this.group.add(foliage.group);
    this.climbableTreesMutable = foliage.climbableTrees;
    this.occludersMutable = foliage.occluders;
    this.bushesMutable = foliage.bushes;
    this.hideableInstances = foliage.hideableInstances;
    this.treeColliders = foliage.treeColliders;
    this.bushColliders = foliage.bushColliders;
    this.bushMesh = foliage.bushMesh;
    this.group.add(buildTreeline());
    const built: PlacedWallRun[] = [];
    const runs = decisions.walls.filter((run): run is WallRun => run !== null);
    this.group.add(buildWoodenWalls(collision, built, runs.filter((run) => run.kind === 'wood')));
    this.group.add(buildStoneWalls(collision, built, runs.filter((run) => run.kind === 'stone')));
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

  /**
   * **Fells every tree and bush clump standing in a disc at (x, z, radius).**
   *
   * The mechanism a park already has for making a tree disappear
   * ({@link setTreeHidden}'s swap to {@link HIDDEN_MATRIX}) — a permanent
   * felling is the same swap, just never swapped back — plus taking the
   * plant's own collision circle back out with
   * {@link CollisionWorld.removeCircle}, so the ground it stood on genuinely
   * reads as clear afterwards rather than looking clear while still refusing
   * anything that asks. A bush clump gets the identical treatment: its blob
   * instances are a contiguous run in the shared `bushes` mesh rather than a
   * `hideableInstances` entry, so they are hidden by index range instead, but
   * the swap and the collision removal are the same two moves.
   *
   * This is for `coaster/pylons.ts`: a support spot that is otherwise good
   * but has foliage standing on it should get that foliage cleared rather
   * than be skipped, the way a real park would clear ground to hold its own
   * ride up (issue #301) — Jim's own example was a dense tree-and-bush
   * cluster, not trees alone. It is **not** a general "remove any collider"
   * escape hatch — only this file's own trees and bush clumps are
   * candidates, found by walking the same lists {@link foliageOccluders} and
   * {@link bushes} publish, so nothing outside a plant's own footprint is
   * ever at risk of being cleared by a support search.
   *
   * Trees are removed from {@link occludersMutable}, {@link hideableInstances}
   * and {@link treeColliders} by splicing every index that matched; bushes
   * from {@link bushesMutable} and {@link bushColliders} the same way. Both
   * loops walk from the end backwards so an earlier splice never invalidates
   * a later index still to be checked. A felled tree that happened to be
   * climbable also comes out of {@link climbableTreesMutable} (matched by
   * `footX`/`footZ`, since that list is a *subset* of the trees and does not
   * share their indices — and **not** by `x`/`z`, which is the canopy's drawn
   * centre and is metres away from the foot on the sphere; see
   * {@link FoliageOccluder.footX}).
   *
   * Must run before anything reads these lists and keeps its own copy of an
   * index into them — `World.ts` builds the Sky Cruiser (and so calls this)
   * before `TreeLights` strings a garland between trees or `NpcSystem` hands
   * climbable trees to its wander drivers, which is what makes felling here
   * safe rather than merely convenient.
   *
   * Returns how many plants were actually felled in total, so a caller can
   * tell "the spot is clear now" from "there was nothing here to clear".
   */
  /**
   * Non-mutating twin of {@link clearTreesNear} — "would felling here find
   * anything", not "fell it now". Same matching rule (a tree or bush clump
   * whose own radius brings it within `radius` of `(x, z)`), zero side
   * effects.
   *
   * Exists for `train/bridgeFootprint.ts`'s search (issues #317, #319,
   * scatterDecoupling regression found reviewing PR #330): the width/shift
   * backtracking loop tries many candidates before settling on one, and only
   * the *winning* candidate should ever actually fell a tree — a rejected
   * candidate that happened to probe a point near a tree must not remove it,
   * or which trees end up standing becomes a function of every candidate the
   * search happened to *consider*, not just the one it *kept*. The search
   * uses this to ask "is this candidate viable, felling included" without
   * committing to the fell; the one, final commit for whichever candidate is
   * actually kept calls {@link clearTreesNear} for real.
   */
  hasFellableTreeNear(x: number, z: number, radius: number): boolean {
    for (let i = 0; i < this.occludersMutable.length; i += 1) {
      const tree = this.occludersMutable[i]!;
      const trunk = this.treeColliders[i]!;
      // The **foot**, not the canopy's drawn centre: `trunk.radius` is the
      // radius of the collider standing at `(footX, footZ)`. See `footX`.
      if (Math.hypot(tree.footX - x, tree.footZ - z) < radius + trunk.radius) return true;
    }
    for (let i = 0; i < this.bushesMutable.length; i += 1) {
      const bush = this.bushesMutable[i]!;
      if (Math.hypot(bush.x - x, bush.z - z) < radius + bush.radius) return true;
    }
    return false;
  }

  clearTreesNear(x: number, z: number, radius: number): number {
    let felled = 0;
    for (let i = this.occludersMutable.length - 1; i >= 0; i -= 1) {
      const tree = this.occludersMutable[i]!;
      const trunk = this.treeColliders[i]!;
      if (Math.hypot(tree.footX - x, tree.footZ - z) >= radius + trunk.radius) continue;
      this.setTreeHidden(i, true);
      this.collision.removeCircle(trunk.id);
      const climbableIndex = this.climbableTreesMutable.findIndex(
        (seed) => seed.x === tree.footX && seed.z === tree.footZ,
      );
      if (climbableIndex !== -1) this.climbableTreesMutable.splice(climbableIndex, 1);
      this.occludersMutable.splice(i, 1);
      this.hideableInstances.splice(i, 1);
      this.treeColliders.splice(i, 1);
      felled += 1;
    }
    for (let i = this.bushesMutable.length - 1; i >= 0; i -= 1) {
      const bush = this.bushesMutable[i]!;
      const clump = this.bushColliders[i]!;
      if (Math.hypot(bush.x - x, bush.z - z) >= radius + bush.radius) continue;
      for (let b = 0; b < clump.instanceCount; b += 1) {
        this.bushMesh.setMatrixAt(clump.instanceStart + b, HIDDEN_MATRIX);
      }
      this.bushMesh.instanceMatrix.needsUpdate = true;
      this.collision.removeCircle(clump.id);
      this.bushesMutable.splice(i, 1);
      this.bushColliders.splice(i, 1);
      felled += 1;
    }
    return felled;
  }
}

// ------------------------------------------------------------------ foliage

/**
 * **How big the ball at the top of a tree must be for a child to climb it.**
 *
 * Taken from the head that has to come out of it, not from the range the
 * scatter happens to roll. A climbing child sits down in the canopy with her
 * head clear of it (`world/TreeClimbing.ts`), and that head is a deliberately
 * enormous cartoon one — `SKULL_RADIUS`, 0.66 m. The ball she comes out of is
 * asked to be **twice** it, so she reads as emerging *from* foliage rather than
 * balancing on top of a pea.
 *
 * Expressed against `SKULL_RADIUS` rather than as the 1.32 it currently works
 * out at, because the two are only meaningful together: shrink the kid's head
 * and a smaller ball would do; grow it and this must follow. It is the same
 * rule ART-AGENT-NOTES §2 keeps asking for — one owner, everybody else asks.
 *
 * ## What it actually admits, measured
 *
 * Every `lollipop` and every `blossom` — their main ball rolls 1.75–2.5, always
 * clear. No `pine`, which has cones and no ball for {@link noteBall} to record.
 * And, **contrary to what this comment claimed until it was checked, some
 * `stack` trees**: 4 / 3 / 3 / 5 / 3 of them across the five CI seeds.
 *
 * The reason is that a stack's three layers roll their radii *independently* —
 * `rng.range(1.6, 2.05) * (1 - i * 0.22)`, so layer 0 spans 1.600–2.050,
 * layer 1 spans **1.248–1.599** and layer 2 spans 0.896–1.148 — and each
 * layer's height offset is scaled by **its own** radius. A fat layer 1 under a
 * thin layer 2 therefore tops the tree. Measured on the built park, the topmost
 * ball of every climbable stack is layer 1, radius 1.381–1.593: layer 1's range
 * straddles this 1.32 bar, which is exactly why a few stacks qualify and most
 * do not. Layer 0 never tops out on any of them.
 *
 * **The geometry is right, and only the old comment was wrong**: those climbers
 * still sit on a ball of at least 1.32 with nothing above it, which is all this
 * constant asks, and `check:climb-wave` passes on those trees like any other.
 * The old wording was written from the *intent* of the kind list it replaced
 * rather than from what the arithmetic does — which is the same fault as the
 * `2.05` bar this rule supersedes, and the reason `climbableTrees` is asked of
 * the finished tree a few hundred lines below instead of guessed at per kind.
 */
export const CLIMBABLE_MIN_CANOPY_RADIUS = 2 * SKULL_RADIUS;

/** One tree the world phase decided. */
export interface TreeDecision {
  readonly x: number;
  readonly z: number;
  readonly kind: TreeKind;
  readonly tree: RolledTree;
  /** Planted by the climb-cover pass, so it must stay climbable if it is ever moved. */
  readonly climbable: boolean;
  /** The scatter's state before this tree's search — `back()` restores it exactly. */
  readonly resume: { readonly attempts: number; readonly phase: 'scatter' | 'cover'; readonly cell: number };
}

/**
 * One clump's blobs, rolled from `rng` — the one owner of a bush's shape, so a
 * clump re-rolled from its recorded {@link BushDecision.rollState} (a prebuilt
 * park) is the clump the scatter rolled.
 */
export function rollBush(rng: Rng, x: number, z: number): InstanceItem[] {
  const blobs = rng.int(2, 3);
  const colour = rng.pick(CANOPY_GREENS);
  const y = terrainHeight(x, z);
  const items: InstanceItem[] = [];
  for (let i = 0; i < blobs; i += 1) {
    const radius = rng.range(0.7, 1.3);
    const offset = rng.range(0, TAU);
    const spread = i === 0 ? 0 : rng.range(0.4, 0.85);
    items.push({
      position: new Vector3(x + Math.cos(offset) * spread, y + radius * 0.72, z + Math.sin(offset) * spread),
      scale: new Vector3(radius, radius * rng.range(0.72, 0.9), radius),
      rotationY: rng.range(0, TAU),
      colour,
      shade: rng.range(0.9, 1.1),
    });
  }
  return items;
}

/** One bush clump the world phase decided: its blobs, rolled once, drawn later. */
export interface BushDecision {
  readonly x: number;
  readonly z: number;
  /** The stream's {@link Rng.state} the clump was rolled from — {@link rollBush} rolls it again. */
  readonly rollState: number;
  readonly blobs: readonly InstanceItem[];
  readonly resume: number;
}

export interface SceneryDecisions {
  readonly trees: readonly TreeDecision[];
  readonly bushes: readonly BushDecision[];
  /** A run the walls builder placed, or `null` where one stepped aside for a later feature. */
  readonly walls: readonly (WallRun | null)[];
}

/** The ground a tree claims: its trunk, which is what a child walks into. */
export const TREE_TRUNK_CLAIM = 0.6;
/** Radius of the collider a clump registers, and so the ground it occupies. */
export const BUSH_COLLIDER = 0.85;

/** The ground a tree claims — its trunk. One owner for the builder and a prebuilt park. */
export function treeClaim(x: number, z: number): Claim {
  return disc(x, z, TREE_TRUNK_CLAIM);
}

/** The ground a bush clump claims — its collider. One owner for the builder and a prebuilt park. */
export function bushClaim(x: number, z: number): Claim {
  return disc(x, z, BUSH_COLLIDER);
}

export function disc(x: number, z: number, radius: number): Claim {
  return { kind: 'footprint', shape: { shape: 'disc', x, z, radius } };
}

/** Draw the decided foliage: instanced meshes, colliders, occluders and climbable seeds. */
function buildFoliage(
  collision: CollisionWorld,
  decisions: SceneryDecisions,
): {
  group: Group;
  climbableTrees: ClimbableTreeSeed[];
  occluders: FoliageOccluder[];
  bushes: PlacedBush[];
  hideableInstances: HideableInstance[][];
  treeColliders: TreeCollider[];
  bushColliders: BushCollider[];
  bushMesh: InstancedMesh;
} {
  const group = new Group();
  group.name = 'foliage';

  const trunks: InstanceItem[] = [];
  const roundCanopies: InstanceItem[] = [];
  const coneCanopies: InstanceItem[] = [];
  const bushes: InstanceItem[] = [];
  const climbableTrees: ClimbableTreeSeed[] = [];
  const occluders: FoliageOccluder[] = [];
  const occluderRefs: { kind: 'trunk' | 'round' | 'cone'; index: number }[][] = [];
  const treeColliders: TreeCollider[] = [];

  for (const { x, z, tree } of decisions.trees) {
    const lean = tree.lean;
    const parts = tree.parts;
    const refs = fileTreeParts(parts, { trunk: trunks, round: roundCanopies, cone: coneCanopies });
    if (tree.topBallRadius >= CLIMBABLE_MIN_CANOPY_RADIUS) {
      climbableTrees.push({ x, z, canopyTopY: tree.topBallTopY, trunkRadius: 0.55 * lean });
    }
    occluderFlat.set(x, tree.wideCentreY, z);
    placeOnSphere(occluderFlat, 0, occluderCentre, occluderSpin);
    occluders.push({
      x: occluderCentre.x,
      z: occluderCentre.z,
      footX: x,
      footZ: z,
      centreY: occluderCentre.y,
      radius: tree.wideRadius,
      parts,
    });
    occluderRefs.push(refs);
    const trunkRadius = 0.55 * lean;
    const colliderId = collision.addCircle(x, z, trunkRadius);
    treeColliders.push({ id: colliderId, radius: trunkRadius });
  }

  const bushClumps: PlacedBush[] = [];
  const bushColliders: BushCollider[] = [];
  for (const clump of decisions.bushes) {
    const instanceStart = bushes.length;
    for (const blob of clump.blobs) bushes.push(blob);
    const bushColliderId = collision.addCircle(clump.x, clump.z, BUSH_COLLIDER);
    bushColliders.push({ id: bushColliderId, instanceStart, instanceCount: clump.blobs.length });
    bushClumps.push({ x: clump.x, z: clump.z, radius: BUSH_COLLIDER });
  }

  const bushGeometry = facetted(new IcosahedronGeometry(1, 2));
  const trunkMesh = makeInstanced('tree-trunks', FOLIAGE_GEOMETRY.trunk, foliageMaterial(0.95), trunks, true);
  const canopyMesh = makeInstanced('tree-canopies', FOLIAGE_GEOMETRY.round, foliageMaterial(0.85), roundCanopies, true);
  const coneMesh = makeInstanced('tree-cones', FOLIAGE_GEOMETRY.cone, foliageMaterial(0.85), coneCanopies, true);
  const bushMesh = makeInstanced('bushes', bushGeometry, foliageMaterial(0.9), bushes, true);
  group.add(trunkMesh, canopyMesh, coneMesh, bushMesh);

  const scratchMatrix = new Matrix4();
  const hideableInstances: HideableInstance[][] = occluderRefs.map((refs) =>
    refs.map(({ kind, index }) => {
      const mesh = kind === 'trunk' ? trunkMesh : kind === 'round' ? canopyMesh : coneMesh;
      mesh.getMatrixAt(index, scratchMatrix);
      return { mesh, index, matrix: scratchMatrix.clone() };
    }),
  );

  return { group, climbableTrees, occluders, bushes: bushClumps, hideableInstances, treeColliders, bushColliders, bushMesh };
}

/**
 * A dense band of woodland outside the boundary wall.
 *
 * Its job is to hide the edge of the terrain disc (see `buildTerrain`) so that
 * the ground appears to disappear into trees rather than simply stopping in
 * mid-air. Nothing here is reachable, so none of it registers collision and the
 * trees are cheap: trunk plus one blob.
 *
 * The band starts at {@link TREELINE_INNER_RADIUS} rather than a metre outside
 * the park, because the apron outside the wall is no longer empty — the Rail
 * Race's two rings stand on it (2 August 2026). The count went up with the band:
 * the annulus is about 60% larger in area than the one 340 trees used to fill,
 * and a treeline that thins out is a treeline you can see the edge of the world
 * through, which is the one thing it exists to prevent.
 */
function buildTreeline(): Group {
  const group = new Group();
  group.name = 'treeline';

  const rng = new Rng(0x7e3711);
  const trunks: InstanceItem[] = [];
  const canopies: InstanceItem[] = [];

  // The band is a distance *beyond the park's edge*, not a pair of radii. It
  // has to sit the same way relative to the cut on every bearing, or it screens
  // the terrain edge on one side of the park and stands out on bare hillside on
  // the other. These are the old numbers restated: the treeline used to begin
  // 11.5 m outside the masonry and finish 22 m outside it.
  const bandInner = TREELINE_OUTSET_INNER;
  const bandOuter = TERRAIN_APRON - 1.5;
  const colours = [PALETTE.leafDeep, PALETTE.leafMid, PALETTE.leafBlue, PALETTE.leafLight];

  for (let i = 0; i < 540; i += 1) {
    const angle = rng.range(0, TAU);
    const outset = rng.range(bandInner, bandOuter);
    const distance = edgeRadiusAt(PARK_BOUNDARY, angle) + outset;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const ground = terrainHeight(x, z);

    // Slightly taller towards the rim so the band reads as depth, but kept low
    // enough that it screens the terrain edge without swallowing the sky.
    const rimness = (outset - bandInner) / (bandOuter - bandInner);
    const height = rng.range(2.8, 4.0) + rimness * 1.1;
    const radius = rng.range(1.7, 2.6) + rimness * 0.5;

    // **The band starts 11.5 m outside the park, and the cat bus stops 9 m
    // outside it.** So on the gate's bearing this woodland begins two and a half
    // metres behind the kerb, squarely between the camera and the bus — and
    // because it is scattered here rather than through `isPlantable`, it has
    // never asked the entrance keep-out anything. That is what put trees across
    // the lower-left of the bus in every captured frame from t = 3 to t = 6.
    //
    // Refused rather than moved: an outset nudged along the same bearing is
    // still on the same bearing, and the whole point is to be off it.
    //
    // **This does shift the RNG stream, and an earlier version of this comment
    // claimed it did not.** The `continue` sits above the draws that finish a
    // tree, so a refused one leaves them untaken and every tree after it reads
    // the stream one tree out of step. Measured on the sibling clause below:
    // 436 trunks against 494, and only 115 of the 436 survivors stand where
    // they did — they diverge from the second tree onward. That is cosmetic
    // rather than a fault (the woodland is scattered either way, and the seed
    // still determines it exactly), but it is not what the old sentence
    // promised, and a promise about determinism is worth more than the
    // convenience of leaving it unread.
    //
    // The canopy's own top, not the trunk's: `top = ground + height + radius *
    // 0.35` is where the blob's centre goes and it stands `radius * 1.15` up
    // from there at its tallest roll.
    if (hidesTheArrivingBus(x, z, ground + height + radius * 1.5, radius)) continue;

    // **And nothing stands in the road.** Jim, 3 September 2026: the bus drives
    // through trees on its final approach. It does, and structurally rather
    // than by bad luck on one seed — measured on the built park
    // (`scripts/probe-road-trees.mts`), **64 to 106 of these instances per seed
    // reach into the corridor the bus sweeps**, standing at outsets of 13.7 to
    // 21.1 m. That is not a coincidence: this band runs from 11.5 m out to
    // `TERRAIN_APRON - 1.5`, and the road's tails climb from the kerb to
    // `ENTRANCE_ROAD_TAIL_OUTSET` right through it, so the road and the
    // woodland occupy the same annulus by construction.
    //
    // **The trees give way, not the road**, and which way round that goes is a
    // measurement rather than a preference: `roadRoute.ts` derives the corridor
    // from `PARK_BOUNDARY` alone — no scenery, no rides, nothing built — so it
    // is a pure pre-scene plan in exactly the sense {@link onRailway} describes
    // for the train's route, and at the moment it solves, not one tree exists to
    // avoid. The road also has nowhere to go: `check:entrance-road`'s own
    // impossibility proof pins its outset between the bus door's pavement and
    // the rim, with the two bounds crossing by 0.15 m. So the road claims its
    // corridor and the woodland respects it, which is the same move pylon
    // placement makes when it fells foliage.
    //
    // Refused rather than moved, for the reason above. **It shifts the RNG
    // stream**, though — the `continue` is above the draws that finish a tree,
    // so every tree after a refused one reads the stream one tree out of step.
    // Measured: 436 trunks against 494 (so 58 felled is right), and only 115 of
    // the 436 survivors stand where they did, diverging from the second tree.
    // Cosmetic — the woodland is still exactly determined by the seed — but the
    // old sentence here claimed the opposite and was simply false.
    // What a player sees is a cleared run through the woodland where the road
    // comes over the brow, which is what a road through woodland looks like.
    // **One owner for where this canopy's centre sits.** It is used twice — to
    // ask the corridor about the canopy's drawn position, and to place the
    // canopy itself six lines below — and two copies of one expression kept in
    // step by hand is this repo's commonest bug by a distance. It was two
    // copies in the very commit that fixed a variant of the same disease.
    const canopyCentreY = ground + height + radius * 0.35;

    // **Tested where the canopy is DRAWN, not where its trunk stands.**
    //
    // `makeInstanced` puts every instance through `placeOnSphere`, which
    // re-measures a part's authored height along the *local* up — so a canopy,
    // being metres above the ground, is drawn further out than the trunk it
    // grew from. Gating on the trunk's `(x, z)` therefore asks the corridor
    // about a patch of ground the canopy does not occupy.
    //
    // Measured on the canonical seed at the park's authored scale: every one of
    // the 460 surviving treeline instances is displaced outward between plant
    // time and draw time — **median 1.80 m, worst 3.21 m** — and 18 canopies
    // landed in the bus's corridor with the gate reporting them clear. The
    // worst sat 0.49 m from the corridor while reaching 2.86 m, so it was
    // 2.37 m into a road the bus drives down.
    //
    // This is the same correction the occluder above already makes, for the
    // same reason and with the same call; its comment has said "at the park's
    // edge that is over a metre sideways" all along. The gate simply never had
    // it.
    canopyFlat.set(x, canopyCentreY, z);
    placeOnSphere(canopyFlat, 0, canopyDrawn, canopySpin);
    if (distanceToEntranceCorridor(canopyDrawn.x, canopyDrawn.z) < radius) continue;

    trunks.push({
      position: new Vector3(x, ground + height / 2, z),
      scale: new Vector3(1.1, height, 1.1),
      rotationY: rng.range(0, TAU),
      colour: PALETTE.barkDark,
      shade: rng.range(0.8, 1),
    });
    canopies.push({
      position: new Vector3(x, canopyCentreY, z),
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

/**
 * The rail corridor, the platforms, and every bridge's deck and ramps. The
 * dependency used to point the other way — the route was solved against the
 * finished collision world and bent around trees — but the route is a pure
 * pre-scene plan now (`train/plan.ts`), so the trees are the ones that give
 * way. The bridge check is the same trick one step further: issue #116's
 * bridges are pure geometry off that same plan, not yet built either, so
 * asking `isInBridgeFootprint` costs nothing that was not already being
 * spent — see that module's own header for why a plant needs to know at all
 * (a lamp planted well clear of the *old*, narrow corridor still landed on
 * a ramp's own low end).
 */
export function onRailway(x: number, z: number, clearance: number): boolean {
  const route = TRAIN_PLAN.route;
  const near = route.pointAt(route.distanceNear(x, z), railProbe);
  // Fence at 2.0 m either side, plus the plant's own clearance.
  if (Math.hypot(near.x - x, near.z - z) < 2.6 + clearance) return true;
  for (const station of TRAIN_PLAN.stations) {
    if (Math.hypot(station.standX - x, station.standZ - z) < 5.2 + clearance) return true;
  }
  if (isInBridgeFootprint(x, z)) return true;
  return false;
}
const railProbe = new Vector3();

/**
 * **Somewhere the railway does not already own** — the corridor, its
 * platforms, and every bridge's deck and ramps.
 *
 * The public face of {@link onRailway}, and it exists for the same reason
 * {@link clearOfCruiser} does: a scatter that is not routed through
 * {@link isPlantable} still has to ask *the* owner of "is this the railway",
 * rather than growing a second idea of where the track is.
 *
 * The meadow is that scatter (`world/Flowers.ts`). It asked about paths,
 * plots, tap zones and the Sky Cruiser and never about the train, so a flower
 * could sprout between the rails: found on 3 September 2026 by
 * `check:coplanar`, as `living-flower-stems` sharing a plane with
 * `track-ballast` on pool seed 225. The seam was the symptom; a flower growing
 * out of the ballast, inside a fence a child cannot cross, was the defect.
 */
export function clearOfRailway(x: number, z: number, clearance: number): boolean {
  return !onRailway(x, z, clearance);
}

/**
 * **Where the Sky Cruiser flies too low for this plant to stand under it.**
 *
 * Issue #198: the ride flew through a tree canopy and a bush beside its station
 * on every one of the five CI seeds, and through a wooden wall run on seed 5.
 *
 * The dependency has to point this way round, and not because it is tidier —
 * because the other way is impossible. `COASTER_PLANS` is a module-load
 * constant (`coaster/plan.ts`), so the loop is fully solved before `new World()`
 * runs, while the scatter below happens inside that constructor. **At the moment
 * the route solves, not one tree exists to avoid.** That is the same inversion
 * {@link onRailway} describes for the train, for the same reason, and it is why
 * the fix #198 originally proposed — widening the solver's station window —
 * could not have worked: `groundClearOfPlots` reads `PARK_LAYOUT`, which holds
 * twelve plots and no foliage whatsoever. The bush the canonical seed struck
 * was 3.5 m from the platform, already inside the window that was there.
 *
 * ### Why it asks the plant's own height instead of keeping a flat corridor
 *
 * The cruise floor's comment used to claim 6.2 m "clears the trees". Measured,
 * a canopy reaches **6.68 m** above its own ground and the car's underside at
 * cruise is 6.04 m, so a tall tree under the cruise line is a strike waiting for
 * a seed to place one. But a flat keep-out sized for the tallest possible tree
 * would then apply along most of the loop and take a wide swathe out of a lawn
 * that is already tight enough that the scatter runs out of attempts before it
 * runs out of targets.
 *
 * So the test is the real one: is the car's underside, anywhere it passes near
 * enough, **below this plant's own top**. A bush lives happily under track a
 * lollipop tree cannot, which is both true and cheap.
 *
 * Thresholds come from the ride ({@link CART_ENVELOPE} in `coaster/cart.ts`),
 * never from the generator's `CORRIDOR_RADIUS` — asserting a solver's own target
 * proves only that it can do arithmetic.
 */
interface CruiserSample {
  readonly x: number;
  readonly z: number;
  /** World height of the underside of the car's envelope here. */
  readonly underY: number;
}

/**
 * Grid cell for {@link cruiserGrid}, in metres.
 *
 * Comfortably wider than the widest question anything asks of it (a lollipop's
 * 3.55 m reach plus the car's 0.75 m half-width), so a lookup never has to walk
 * more than a 2x2 block of cells.
 */
const CRUISER_CELL = 8;

let cachedCruiserGrid: Map<string, CruiserSample[]> | null = null;

/**
 * The loop, once, bucketed by ground position.
 *
 * Memoised like {@link wallPlan}: every candidate plant asks the same question
 * of the same solved route. Sampled at half-metre steps, so nothing thin is
 * stepped over — the same spacing `coaster/clearance.ts` sweeps its rays at.
 *
 * Bucketed rather than kept as one list because this is asked a *lot*: the tree
 * scatter alone rejection-samples a quarter of a million candidates, and
 * scanning all ~370 samples for each of them doubled the headless park build
 * from 0.9 s to 1.8 s. Against the grid it is four cells and a handful of
 * distances.
 */
function cruiserGrid(): Map<string, CruiserSample[]> {
  if (cachedCruiserGrid) return cachedCruiserGrid;
  const route = COASTER_PLANS.cruiser.route;
  const grid = new Map<string, CruiserSample[]>();
  const point = new Vector3();
  for (let d = 0; d < route.length; d += 0.5) {
    route.pointAt(d, point);
    const sample: CruiserSample = {
      x: point.x,
      z: point.z,
      underY: point.y - CART_ENVELOPE.below,
    };
    const key = `${Math.floor(sample.x / CRUISER_CELL)},${Math.floor(sample.z / CRUISER_CELL)}`;
    const cell = grid.get(key);
    if (cell) cell.push(sample);
    else grid.set(key, [sample]);
  }
  cachedCruiserGrid = grid;
  return grid;
}

/**
 * Is there room here for something `reach` wide and `topY` tall, clear of the
 * Sky Cruiser?
 *
 * `topY` is metres above this spot's own ground, so it is compared against the
 * car in world height — the track and the plant stand on different terrain.
 */
/** Exported for `LampPosts`, which keeps its poles out from under the same
 * low stretches — one grid, one definition of "the cruiser flies low here". */
export function clearOfCruiser(x: number, z: number, reach: number, topY: number): boolean {
  const plantTop = terrainHeight(x, z) + topY;
  const needed = reach + CART_ENVELOPE.halfWidth;
  const grid = cruiserGrid();
  const minCellX = Math.floor((x - needed) / CRUISER_CELL);
  const maxCellX = Math.floor((x + needed) / CRUISER_CELL);
  const minCellZ = Math.floor((z - needed) / CRUISER_CELL);
  const maxCellZ = Math.floor((z + needed) / CRUISER_CELL);
  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      const cell = grid.get(`${cellX},${cellZ}`);
      if (!cell) continue;
      for (const sample of cell) {
        // The car is over the top of this plant here, so it may stand under it.
        if (sample.underY >= plantTop) continue;
        if (Math.hypot(sample.x - x, sample.z - z) < needed) return false;
      }
    }
  }
  return true;
}


/**
 * Wooden walls at various heights — the design doc asks for things "to run
 * around and hide behind", so these are laid out as a loose, open maze rather
 * than a fence line.
 */
function buildWoodenWalls(collision: CollisionWorld, built: PlacedWallRun[], runs: readonly WallRun[]): Group {
  const group = new Group();
  group.name = 'wooden-walls';

  // Generated, not authored (Decision 5): five L-shaped pieces of hiding
  // maze, seeded off PARK_SEED, each validated against the generated paths
  // and plots. Heights come from a palette that deliberately skips the
  // 1.0-1.5 m band: `checkHoppableColliders` proved the jump clears 1.0 m
  // and strands on anything up to ~1.43 m, so a wall is either honestly
  // hoppable or honestly solid, never in the trap between.

  const boardMaterial = toonMaterial(0xffffff, { map: woodTexture(1, 1) });
  const postMaterial = toonMaterial(PALETTE.woodDark);
  const capMaterial = toonMaterial(PALETTE.woodLight);
  const postGeometry = new CylinderGeometry(0.19, 0.21, 1, 8);
  const capGeometry = new SphereGeometry(0.24, 10, 8);

  /**
   * **One post per corner, however many runs end there.**
   *
   * The maze is L-shaped pieces, so an L's two arms share an endpoint — and
   * each arm used to stand its own post and its own ball cap at it. Two
   * eight-sided posts on the same spot put every one of their facets in one
   * plane: nine coplanar seams and 3.13 m² of it, at 1.3 m from a child who is
   * hiding behind that exact corner (#472). The shorter post is entirely
   * inside the taller one, so per `ART_DIRECTION.md` §7 it should not be drawn
   * at all rather than held off by anything.
   *
   * Collected across every run first, then built once each below. A corner
   * takes the **lowest** base and the **highest** top of the runs meeting
   * there, so the surviving post still reaches from the ground each arm stands
   * on to the top of the taller arm — exactly what the pair of them covered
   * between them, in one mesh.
   */
  interface Corner {
    x: number;
    z: number;
    base: number;
    top: number;
  }
  const corners: Corner[] = [];
  /** Same corner, allowing for the endpoints being written twice over. */
  const cornerAt = (x: number, z: number): Corner | undefined =>
    corners.find((corner) => Math.hypot(corner.x - x, corner.z - z) < 0.05);

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
    // Leant at the run's midpoint, while its two corner posts below lean at
    // their own feet. Over a fence run that is metres rather than tens of
    // metres the two tilts differ by well under a degree, which is cheaper
    // than bending the boards.
    standOnSphere(boards);
    boards.castShadow = true;
    boards.receiveShadow = true;
    group.add(boards);

    for (const [px, pz] of [run.from, run.to]) {
      const top = base + run.height + 0.32;
      const existing = cornerAt(px, pz);
      if (existing) {
        existing.base = Math.min(existing.base, base);
        existing.top = Math.max(existing.top, top);
      } else {
        corners.push({ x: px, z: pz, base, top });
      }
    }

    // Real wall height, not the `Infinity` default — this is what lets a jump
    // clear a low or mid wall while a tall one still stops you (Collision.ts).
    // `autoHoppable: true` is what lets `Player` clear one on its own, with no
    // button press, the moment walking (or tap-to-move) runs into one it
    // could jump anyway (design feedback #30e).
    collision.addWall(x1, z1, x2, z2, WOOD_WALL_COLLIDER_HALF, run.height, true);
    built.push({ ...run, halfWidth: WALL_HALF_WIDTH[run.kind] });
  }

  for (const corner of corners) {
    const postHeight = corner.top - corner.base;
    const post = new Mesh(postGeometry, postMaterial);
    post.position.set(corner.x, corner.base + postHeight / 2, corner.z);
    standOnSphere(post);
    post.scale.y = postHeight;
    post.castShadow = true;
    post.receiveShadow = true;
    group.add(post);

    const cap = new Mesh(capGeometry, capMaterial);
    cap.position.set(corner.x, corner.top, corner.z);
    standOnSphere(cap);
    cap.scale.set(1, 0.8, 1);
    cap.castShadow = true;
    group.add(cap);
  }

  return group;
}

/** Low pink stone walls: garden-bed edging around the plaza and a few benches
 *  of stonework out on the lawn. */
function buildStoneWalls(collision: CollisionWorld, built: PlacedWallRun[], runs: readonly WallRun[]): Group {
  const group = new Group();
  group.name = 'stone-walls';

  // Four tangent-aligned beds around the plaza plus four lawn benches,
  // generated from the layout (Decision 5). Every stone height is honestly
  // hoppable (<= 1.0 m): the first generated roll put 1.2 m benches in the
  // 1.0-1.43 m trap band and the boot assert refused the park, which is
  // that assert doing exactly its job.

  const wallMaterial = toonMaterial(0xffffff, { map: pinkStoneTexture(1, 1) });
  const copingMaterial = toonMaterial(PALETTE.stonePinkLight);
  const finialMaterial = toonMaterial(PALETTE.stonePink);

  // Ball finial + collar at each end of every run — the one detail that makes a
  // wall look cared for rather than extruded. Instanced, because two extra draw
  // calls for the whole park is affordable and thirty-two is not.
  const placed = runs;
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
    // **Wall and coping lean as one piece: both measured up from the same
    // foot, along the same up** — `placeOnSphere`, the way every tree's trunk
    // and canopy are placed. They used to be leant each about its own centre
    // (`standOnSphere`), and those centres are at different heights, so the
    // lean slid the coping sideways off the wall by its height times the tilt:
    // about 9 cm on the canonical seed, which ate its 8.5 cm overhang on one
    // side and put its face 8 mm from the wall's, same way round —
    // `check:coplanar` `stone-walls` Box|Box, 0.152 m². Measured from one foot
    // the coping sits centred on its wall wherever the park leans.
    const wall = new Mesh(geometry, wallMaterial);
    placeOnSphere(new Vector3(midX, base + run.height / 2, midZ), -angle, wall.position, wall.quaternion);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);

    // A rounded coping stone along the top — reads as "sit on me".
    const coping = new Mesh(new BoxGeometry(length + 0.2, 0.16, 0.72), copingMaterial);
    placeOnSphere(new Vector3(midX, base + run.height + 0.08, midZ), -angle, coping.position, coping.quaternion);
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
    collision.addWall(x1, z1, x2, z2, STONE_WALL_COLLIDER_HALF, run.height, true);
    built.push({ ...run, halfWidth: WALL_HALF_WIDTH[run.kind] });
  }

  group.add(
    makeInstanced('wall-collars', new SphereGeometry(0.13, 12, 9), copingMaterial, collars, false),
    makeInstanced('wall-finials', new SphereGeometry(0.19, 14, 11), finialMaterial, finials, true),
  );

  return group;
}

// ----------------------------------------------------------------- helpers

/** Multiplies a geometry's UVs so a tiling texture keeps a constant scale. */
function scaleUvs(geometry: BufferGeometry, sx: number, sy: number): void {
  const uv = geometry.getAttribute('uv');
  if (!uv) return;
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  }
  uv.needsUpdate = true;
}

