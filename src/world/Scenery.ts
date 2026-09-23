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
import {
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  STONE_WALL_COLLIDER_HALF,
  WOOD_WALL_COLLIDER_HALF,
} from '../core/constants';
import { edgeRadiusAt, PARK_BOUNDARY, TERRAIN_APRON } from './boundary';

/** How far inside the park's edge anything may be planted. Was `> 55` against a 60 m wall. */
const PLANTABLE_MARGIN = 5;
/** Where the screening woodland starts, beyond the edge. Was 71.5 against a 60 m wall. */
const TREELINE_OUTSET_INNER = 11.5;
import { PALETTE } from '../core/palette';
import { Rng, TAU, candidateRng } from '../core/mathUtils';
import { pinkStoneTexture, woodTexture } from '../core/textures';
import { toonMaterial } from '../art/style/materials';
import { SKULL_RADIUS } from '../art/models/kid';
import { PARK_SEED } from './parkManifest';
import { PARK_LAYOUT } from './parkLayout';
import {
  TRAIN_PLAN,
  distanceToRailCorridor,
  RAIL_CORRIDOR_CLEARANCE,
} from './train/plan';
import { isInBridgeFootprint } from './train/bridgeKeepout';
import { placeOnSphere, standOnSphere, terrainHeight } from './terrain';
import { PLAZA } from './paths';
import {
  distanceToPath,
  isOnPath,
  pathBorderSegments,
  pathCentreline,
  type PathBorderSegment,
} from './pathGraph';
import { ANCHORS } from './anchors';
import { COASTER_PLANS } from './coaster/plan';
import {
  ENTRANCE_CLEAR_RADIUS,
  ENTRANCE_CLEAR_X,
  ENTRANCE_CLEAR_Z,
} from './entrance/layout';
import { hidesTheArrivingBus } from './entrance/arrivalSightline';
import { distanceToEntranceCorridor } from './entrance/roadRoute';
import { RAIL_RACE_PLAN } from './railRace/plan';
import { SLIDE_PLAN } from './slide/plan';
import { FERRIS_WHEEL_EXIT } from '../minigames/ferrisWheel/exit';
import { STALL_STANDS } from '../minigames/stallPlacement';
import { CART_ENVELOPE } from './coaster/cart';
import type { CollisionWorld } from './Collision';
// **The trees are not this file's to define.** See `world/treeModel.ts`: the
// lane the cat bus drives up plants the same trees from the same rolls, so
// they live in a module neither scene owns and both ask.
import {
  CANOPY_GREENS,
  FOLIAGE_GEOMETRY,
  TREE_REACH,
  TREE_TOP,
  fileTreeParts,
  foliageMaterial,
  makeInstanced,
  pickTreeKind,
  rollTree,
  type InstanceItem,
  type RolledTree,
  type TreeKind,
  type TreePart,
} from './treeModel';
import { shapesOverlap, type Claim, type GroundClaims } from '../boot/groundClaims';
import { refusal, type FeatureBuilder, type Increment, type Refusal } from '../boot/featureBuilder';

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

/**
 * Lawn kept between a tree's widest possible reach and a wall's face.
 *
 * The trees and the walls used to know nothing whatever about each other. The
 * scatter honoured the paths, the plots and the railway; the wall runs honoured
 * the paths, the plots and the railway; neither honoured the other, so on every
 * seed a dozen or more canopies grew through a wall — the worst of them on the
 * canonical seed overlapping a stone run by **2.43 m**, which at a 3.24 m
 * canopy is a wall buried in a tree.
 *
 * Two player radii is the floor, and it is the same number {@link WALL_RUN_GAP}
 * is argued from: `NavGrid` fattens every collider by `PLAYER_RADIUS` before it
 * decides a cell is walkable, and every tree carries a collider of its own, so
 * a slot narrower than this between a trunk and a wall is not a way through —
 * it is a dead end that looks like a way through.
 *
 * The extra 0.2 m is slack rather than rule. This is measured against
 * {@link TREE_REACH}'s pessimistic ceiling, so the built park lands comfortably
 * clear of the line the invariant checks rather than balanced on it.
 */
const TREE_WALL_GAP = PLAYER_RADIUS * 2 + 0.2;

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
const CLIMBABLE_MIN_CANOPY_RADIUS = 2 * SKULL_RADIUS;

/**
 * A bush clump's reach and height ceilings.
 *
 * Blobs roll `rng.range(0.7, 1.3)` and are nudged up to `0.85` off centre, so
 * 2.15 across; each stands `radius * (0.72 + 0.9)` tall, so 2.11 up. The tallest
 * measured in the canonical park is 2.07 m.
 */
const BUSH_REACH = 2.15;
const BUSH_TOP = 2.15;

/**
 * The tallest a wall run stands, in metres.
 *
 * Wooden hiding walls roll from `[0.8, 0.95, 1.5, 1.8, 2.1, 2.6]` and the stone
 * runs top out at 0.95, so 2.6 covers both. A wall is short enough that it only
 * ever meets the ride right at the station — which is exactly where seed 5 flew
 * through one.
 */
const WALL_TOP = 2.6;

/**
 * One salt per scattered subsystem, so no two of them share a draw counter.
 *
 * Each is combined with the candidate's own index by {@link candidateRng} —
 * read the note there for why a rejection sampler must never draw from one
 * long-lived generator. The short version: trees and bushes used to share a
 * single `new Rng(0xc0ffee)`, with the bush loop running second, so one tree
 * gained or lost anywhere re-rolled all 108 bush clumps.
 *
 * They are xor'd with {@link PARK_SEED} the way the wall salts always have
 * been. Without that the foliage draw sequence was *identical* on all five CI
 * seeds — the sweep only ever varied which candidates the geometry refused, so
 * five seeds were really one scatter measured five times.
 */
const TREE_SALT = 0xc0ffee ^ PARK_SEED;
const BUSH_SALT = 0xb115e5 ^ PARK_SEED;
const MAZE_SALT = 0x77a115 ^ PARK_SEED;

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

/** One bush clump the world phase decided: its blobs, rolled once, drawn later. */
export interface BushDecision {
  readonly x: number;
  readonly z: number;
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
const TREE_TRUNK_CLAIM = 0.6;
/** Radius of the collider a clump registers, and so the ground it occupies. */
const BUSH_COLLIDER = 0.85;
/**
 * How many spots a tree or bush tries when asked to step aside. The scatter
 * itself needs ~2500 attempts per accepted tree on a tight lawn (180 000 for
 * 72), so 48 was no budget at all: on seed 11 both trees asked to move
 * "found nowhere in 48 tries" and two lamp slots were forgone instead.
 * Every try is a handful of distance checks; 4000 is a few milliseconds.
 */
const RELOCATE_TRIES = 4000;
/**
 * A tree or bush steps aside only within this of where it stood — a small
 * movement (Jim, 16 Sep 2026: *"accommodate small movements if required"*),
 * never a jump across the park. `test/procgen/scatterDecoupling` bows one
 * spur by 2 m and holds every tree, bush and wall more than 30 m from it
 * exactly where it was; the lamp slot the longer spur gained asked a tree to
 * move and the old anywhere-fallback sent it 56 m away. If no spot within
 * reach passes, the builder refuses and the optional asker is forgone.
 */
const RELOCATE_REACH = { tree: 24, bush: 20 } as const;
const TREE_MOVE_SALT = 0x7e3e0e ^ PARK_SEED;
const BUSH_MOVE_SALT = 0xb0511e ^ PARK_SEED;
const TARGET_TREES = 72;
const TREE_BUDGET = 180000;
const BUSH_BUDGET = 4200;

function disc(x: number, z: number, radius: number): Claim {
  return { kind: 'footprint', shape: { shape: 'disc', x, z, radius } };
}

function clearOfClaims(claim: Claim, keepClearOf: readonly Claim[]): boolean {
  return !keepClearOf.some((other) => shapesOverlap(claim.shape, other.shape));
}

/**
 * **Trees, as a feature builder** (Jim, 16 Sep 2026: every park feature goes
 * through the generic interface). One increment is one tree. The scatter is the
 * one the park always made — same salts, same candidate order, same budget —
 * then the climb-cover pass, cell by cell; each accepted tree is an increment
 * claiming its trunk. The builder never refuses: a spot that fails is simply
 * the next candidate, exactly as before.
 *
 * **Correction**: when a later feature (a lamp, a fairy pole, a trestle) is
 * refused by a tree, the driver asks this builder to `accommodate`, and the
 * tree is moved — near its old spot first, anywhere plantable after — through
 * the same acceptance every tree goes through, clear of the asker's refused
 * claims. A cover-pass tree stays climbable when it moves.
 */
export function treeBuilder(
  collision: CollisionWorld,
  claims: GroundClaims,
  walls: () => readonly (WallRun | null)[],
  bushes: () => readonly BushDecision[],
  out: TreeDecision[],
): FeatureBuilder {
  let attempts = 0;
  let phase: 'scatter' | 'cover' = 'scatter';
  let cell = 0;
  let cells: { key: number; x: number; z: number }[] | null = null;
  const CLIMB_COVER_TARGET = PLAYER_MAX_SPEED * 7;
  const CLIMB_COVER_SALT = 0xc11f0b ^ PARK_SEED;
  const CLIMB_COVER_CELL = 8;
  const runs = (): readonly WallRun[] => walls().filter((run): run is WallRun => run !== null);
  const claimOf = (tree: TreeDecision): Claim => disc(tree.x, tree.z, TREE_TRUNK_CLAIM);

  /**
   * Every check one accepted tree needs — the scatter, the cover pass and a
   * relocation all plant through this one gate. `exclude` is the tree being
   * moved, which must not refuse its own new spot.
   */
  const accept = (
    rng: Rng,
    kind: TreeKind,
    x: number,
    z: number,
    requireClimbable: boolean,
    exclude: number,
    keepClearOf: readonly Claim[],
  ): RolledTree | null => {
    const reach = TREE_REACH[kind];
    for (let i = 0; i < out.length; i += 1) {
      if (i === exclude) continue;
      const tree = out[i] as TreeDecision;
      if (Math.hypot(x - tree.x, z - tree.z) < TREE_REACH[tree.kind] + reach) return null;
    }
    if (!clearOfWalls(x, z, reach, TREE_WALL_GAP, runs())) return null;
    // The bushes decide after the trees and keep their footprint out of every
    // canopy's reach; a tree moved later must keep the same distance from
    // them, by reach, which the registry (trunk claims) cannot see. Seed 11:
    // a tree moved for a lamp landed 0.40 m over a clump, and the invariant
    // "no bush grows out of a tree" caught it.
    for (const bush of bushes()) {
      if (Math.hypot(x - bush.x, z - bush.z) < reach + BUSH_COLLIDER) return null;
    }
    if (!clearOfCruiser(x, z, reach, TREE_TOP[kind])) return null;
    if (hidesTheArrivingBus(x, z, terrainHeight(x, z) + TREE_TOP[kind], reach)) return null;
    // The real world as it stands: fixed structures' colliders (a bridge ramp,
    // a stall) and every claim any feature has committed.
    if (!collision.isClearCircle(x, z, TREE_TRUNK_CLAIM)) return null;
    const claim = disc(x, z, TREE_TRUNK_CLAIM);
    if (claims.blockers('trees', [claim]).length > 0) return null;
    if (!clearOfClaims(claim, keepClearOf)) return null;
    const tree = rollTree(rng, kind, x, terrainHeight(x, z), z);
    if (requireClimbable && tree.topBallRadius < CLIMBABLE_MIN_CANOPY_RADIUS) return null;
    return tree;
  };

  const coverCells = (): { key: number; x: number; z: number }[] => {
    const found = new Map<number, { x: number; z: number }>();
    for (const sample of pathCentreline()) {
      const cellX = Math.round(sample.x / CLIMB_COVER_CELL);
      const cellZ = Math.round(sample.z / CLIMB_COVER_CELL);
      const cellKey = (cellX + 512) * 4096 + (cellZ + 512);
      if (!found.has(cellKey)) found.set(cellKey, { x: cellX * CLIMB_COVER_CELL, z: cellZ * CLIMB_COVER_CELL });
    }
    return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([key, at]) => ({ key, ...at }));
  };

  const increment = (tree: TreeDecision, verb: string): Increment => ({
    claims: [claimOf(tree)],
    label: `${tree.kind} ${verb} (${tree.x.toFixed(1)}, ${tree.z.toFixed(1)})`,
  });

  return {
    name: 'trees',
    deps: ['walls'],
    movable: true,
    *advance() {
      if (phase === 'scatter') {
        while (out.length < TARGET_TREES && attempts < TREE_BUDGET) {
          const resume = { attempts, phase, cell };
          attempts += 1;
          const rng = candidateRng(TREE_SALT, attempts);
          const angle = rng.range(0, TAU);
          const distance = Math.sqrt(rng.unit()) * (edgeRadiusAt(PARK_BOUNDARY, angle) - 6);
          const x = Math.cos(angle) * distance;
          const z = Math.sin(angle) * distance;
          if (!isPlantable(x, z, 2.6)) continue;
          const kind = pickTreeKind(rng);
          const tree = accept(rng, kind, x, z, false, -1, []);
          if (!tree) continue;
          const decision: TreeDecision = { x, z, kind, tree, climbable: false, resume };
          out.push(decision);
          return increment(decision, 'at');
        }
        phase = 'cover';
        cell = 0;
      }
      cells ??= coverCells();
      while (cell < cells.length) {
        const at = cells[cell] as { key: number; x: number; z: number };
        const resume = { attempts, phase, cell };
        cell += 1;
        const covered = out.some(
          (tree) =>
            tree.tree.topBallRadius >= CLIMBABLE_MIN_CANOPY_RADIUS &&
            Math.hypot(tree.x - at.x, tree.z - at.z) < CLIMB_COVER_TARGET,
        );
        if (covered) continue;
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const rng = candidateRng(CLIMB_COVER_SALT ^ at.key, attempt);
          const angle = rng.range(0, TAU);
          const radius = rng.range(6, CLIMB_COVER_TARGET * 0.55);
          const x = at.x + Math.cos(angle) * radius;
          const z = at.z + Math.sin(angle) * radius;
          if (!isPlantable(x, z, 2.6)) continue;
          const tree = accept(rng, 'lollipop', x, z, true, -1, []);
          if (!tree) continue;
          const decision: TreeDecision = { x, z, kind: 'lollipop', tree, climbable: true, resume };
          out.push(decision);
          return increment(decision, 'for climb cover at');
        }
      }
      return 'done';
    },
    back() {
      const tree = out.pop();
      if (!tree) return;
      attempts = tree.resume.attempts;
      phase = tree.resume.phase;
      cell = tree.resume.cell;
    },
    supply: () => 1,
    accommodate(claimIndex: number, attempt: number, keepClearOf: readonly Claim[]): Increment | Refusal {
      const section = claims.sectionOfClaim('trees', claimIndex);
      const old = out[section];
      if (!old) return refusal(`trees: no tree owns claim ${claimIndex}`);
      for (let k = 0; k < RELOCATE_TRIES; k += 1) {
        const rng = candidateRng(TREE_MOVE_SALT ^ section, attempt * RELOCATE_TRIES + k);
        const angle = rng.range(0, TAU);
        const r = 4 + Math.sqrt(rng.unit()) * (RELOCATE_REACH.tree - 4);
        const x = old.x + Math.cos(angle) * r;
        const z = old.z + Math.sin(angle) * r;
        if (!isPlantable(x, z, 2.6)) continue;
        const tree = accept(rng, old.kind, x, z, old.climbable, section, keepClearOf);
        if (!tree) continue;
        const moved: TreeDecision = { ...old, x, z, tree };
        out[section] = moved;
        return increment(moved, `moved from (${old.x.toFixed(1)}, ${old.z.toFixed(1)}) to`);
      }
      return refusal(`trees: tree ${section} at (${old.x.toFixed(1)}, ${old.z.toFixed(1)}) found nowhere to move within ${RELOCATE_REACH.tree} m in ${RELOCATE_TRIES} tries`);
    },
    reset() {
      out.length = 0;
      attempts = 0;
      phase = 'scatter';
      cell = 0;
      cells = null;
    },
  };
}

/**
 * **Bushes, as a feature builder.** One increment is one clump, claiming the
 * ground its collider occupies ({@link BUSH_COLLIDER}). Same salt, same
 * candidate order, same budget as the scatter always had. A clump does not see
 * its siblings as obstacles (a run of touching clumps is a hedge — the
 * registry never refuses a feature by its own claims); it does see every tree
 * and every wall, and the real collision world. Correction: a clump asked to
 * step aside is re-placed through the same gate, clear of the asker.
 */
export function bushBuilder(
  collision: CollisionWorld,
  claims: GroundClaims,
  walls: () => readonly (WallRun | null)[],
  trees: () => readonly TreeDecision[],
  out: BushDecision[],
): FeatureBuilder {
  let attempts = 0;
  const runs = (): readonly WallRun[] => walls().filter((run): run is WallRun => run !== null);

  const accept = (x: number, z: number, keepClearOf: readonly Claim[]): boolean => {
    if (!isPlantable(x, z, BUSH_REACH)) return false;
    if (!clearOfCruiser(x, z, BUSH_REACH, BUSH_TOP)) return false;
    if (hidesTheArrivingBus(x, z, terrainHeight(x, z) + BUSH_TOP, BUSH_REACH)) return false;
    if (!collision.isClearCircle(x, z, BUSH_COLLIDER)) return false;
    if (!clearOfWalls(x, z, BUSH_COLLIDER, 0, runs())) return false;
    for (const tree of trees()) {
      if (Math.hypot(x - tree.x, z - tree.z) < TREE_REACH[tree.kind] + BUSH_COLLIDER) return false;
    }
    const claim = disc(x, z, BUSH_COLLIDER);
    if (claims.blockers('bushes', [claim]).length > 0) return false;
    return clearOfClaims(claim, keepClearOf);
  };

  const roll = (rng: Rng, x: number, z: number): InstanceItem[] => {
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
  };

  const increment = (bush: BushDecision, verb: string): Increment => ({
    claims: [disc(bush.x, bush.z, BUSH_COLLIDER)],
    label: `clump ${verb} (${bush.x.toFixed(1)}, ${bush.z.toFixed(1)})`,
  });

  return {
    name: 'bushes',
    deps: ['walls', 'trees'],
    movable: true,
    *advance() {
      while (attempts < BUSH_BUDGET) {
        const resume = attempts;
        attempts += 1;
        const rng = candidateRng(BUSH_SALT, attempts);
        const angle = rng.range(0, TAU);
        const distance = Math.sqrt(rng.unit()) * (edgeRadiusAt(PARK_BOUNDARY, angle) - 5);
        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;
        if (!accept(x, z, [])) continue;
        const decision: BushDecision = { x, z, blobs: roll(rng, x, z), resume };
        out.push(decision);
        return increment(decision, 'at');
      }
      return 'done';
    },
    back() {
      const bush = out.pop();
      if (bush) attempts = bush.resume;
    },
    supply: () => 1,
    accommodate(claimIndex: number, attempt: number, keepClearOf: readonly Claim[]): Increment | Refusal {
      const section = claims.sectionOfClaim('bushes', claimIndex);
      const old = out[section];
      if (!old) return refusal(`bushes: no clump owns claim ${claimIndex}`);
      for (let k = 0; k < RELOCATE_TRIES; k += 1) {
        const rng = candidateRng(BUSH_MOVE_SALT ^ section, attempt * RELOCATE_TRIES + k);
        const angle = rng.range(0, TAU);
        const r = 3 + Math.sqrt(rng.unit()) * (RELOCATE_REACH.bush - 3);
        const x = old.x + Math.cos(angle) * r;
        const z = old.z + Math.sin(angle) * r;
        if (!accept(x, z, keepClearOf)) continue;
        const moved: BushDecision = { ...old, x, z, blobs: roll(rng, x, z) };
        out[section] = moved;
        return increment(moved, `moved from (${old.x.toFixed(1)}, ${old.z.toFixed(1)}) to`);
      }
      return refusal(`bushes: clump ${section} found nowhere to move within ${RELOCATE_REACH.bush} m in ${RELOCATE_TRIES} tries`);
    },
    reset() {
      out.length = 0;
      attempts = 0;
    },
  };
}

/**
 * **Walls, as a feature builder.** The maze arms and stone bench runs are
 * planned as they always were (`wallPlan`: pure, seeded); this builder commits
 * them one run per increment, each claiming its own capsule, skipping a run the
 * registry already refuses (a fixed structure stands there). Correction: a run
 * asked to step aside for a later feature is taken out — its slot stays as
 * `null` so `back()` restores exactly — because a maze arm re-placed elsewhere
 * would no longer be an arm of its piece.
 */
export function wallBuilder(claims: GroundClaims, out: (WallRun | null)[]): FeatureBuilder {
  let next = 0;
  const planIndex: number[] = [];
  const capsuleOf = (run: WallRun): Claim => ({
    kind: 'footprint',
    shape: {
      shape: 'capsule',
      x1: run.from[0],
      z1: run.from[1],
      x2: run.to[0],
      z2: run.to[1],
      halfWidth: WALL_HALF_WIDTH[run.kind],
    },
  });
  return {
    name: 'walls',
    deps: [],
    movable: true,
    *advance() {
      const plan = wallPlan().all;
      while (next < plan.length) {
        const index = next;
        const run = plan[index] as WallRun;
        next += 1;
        const claim = capsuleOf(run);
        if (claims.blockers('walls', [claim]).length > 0) continue;
        out.push(run);
        planIndex.push(index);
        return { claims: [claim], label: `${run.kind} piece ${run.piece}` };
      }
      return 'done';
    },
    back() {
      out.pop();
      const index = planIndex.pop();
      if (index !== undefined) next = index;
    },
    supply: () => 1,
    accommodate(claimIndex: number): Increment | Refusal {
      const section = claims.sectionOfClaim('walls', claimIndex);
      const run = out[section];
      if (!run) return refusal(`walls: no run owns claim ${claimIndex}`);
      out[section] = null;
      return { claims: [], label: `${run.kind} piece ${run.piece} stepped aside` };
    },
    reset() {
      out.length = 0;
      planIndex.length = 0;
      next = 0;
    },
  };
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
 * How much standing room a ride's exit keeps to itself, in metres.
 *
 * A dismount needs `isStandable`'s 0.62 m of body, and the widest collider this
 * file plants is a bush clump's 0.85 m, so 1.5 m clears the pair with room for
 * the exit to be approached from any side rather than merely stood on.
 */
const RIDE_EXIT_CLEAR = 1.5;

/**
 * Is this spot where a ride puts a child down?
 *
 * The exits are pure pre-scene plans, solved at module load from the layout —
 * the same property that makes the train's route and the Sky Cruiser's loop
 * things the scatter gives way to rather than bends around.
 *
 * This exists because `planExit` searches with `clearOfPlots`, which knows
 * about the twelve plots and **nothing about the scatter**, so it can hand back
 * a point that is clear of every plot and still has a bush standing in it. That
 * is the same category error as #198 one level along: a pre-scene planner
 * reading a list that does not contain the thing in its way. It bit seed 2 the
 * moment the statue obstacle re-solved the loop and moved the station — the
 * exit landed 1.2 m from a bush and `rideExitsAreUsable` called it, correctly,
 * ground a child cannot stand on.
 *
 * Fixing it here rather than in `planExit` is deliberate: `planExit` cannot see
 * the scatter (it runs before any of it exists, and reaching the other way
 * would make `Scenery` and `coaster/plan` import each other), whereas the
 * scatter can trivially see the exit. The dependency only points one way.
 */
/**
 * EVERY ride's dismount point, not one of them. This guarded only the
 * cruiser's for a while, and on a spread park (issue #241) a tree duly
 * grew over the ferris wheel's exit — the invariant that proves every exit
 * is clear ground caught it on seed 2. The list is the same one `paths.ts`
 * grows exit spurs from, so a ride added there gains its scenery clearance
 * the same day.
 */
/** Exported for `LampPosts`, which found the OTHER way to stand on a
 * dismount point — one list of exits, two keep-off customers. */
export function onRideExit(x: number, z: number, clearance: number): boolean {
  const exits: readonly { readonly exitX: number; readonly exitZ: number }[] = [
    COASTER_PLANS.cruiser,
    RAIL_RACE_PLAN,
    SLIDE_PLAN,
    { exitX: FERRIS_WHEEL_EXIT.x, exitZ: FERRIS_WHEEL_EXIT.z },
  ];
  for (const exit of exits) {
    if (Math.hypot(x - exit.exitX, z - exit.exitZ) < RIDE_EXIT_CLEAR + clearance) return true;
  }
  return false;
}

/**
 * Doormats and stand points are sacred.
 *
 * A waypoint at a stall counter or an anchor's entrance has to stay reachable,
 * and a lamp standing in front of one pockets it exactly the way the dodgems
 * arch did. Generous on purpose: there is always another lamp 10 m along, and
 * skipping one costs nothing. Moved here from `LampPosts.ts` so the fairy poles
 * ask the same owner rather than keeping a copy — a pole slid along its run
 * onto seed 428's rail-race exit once poles began to slide.
 */
export const DOORMAT_CLEARANCE = 2.6;

/** Is (x, z) within `clearance` of an anchor's doorway or a stall's stand point? */
export function nearADoormat(x: number, z: number, clearance = DOORMAT_CLEARANCE): boolean {
  for (const anchor of ANCHORS) {
    const [ex, ez] = anchor.entrance;
    if (Math.hypot(x - ex, z - ez) < clearance) return true;
  }
  for (const stand of STALL_STANDS) {
    if (Math.hypot(x - stand.x, z - stand.z) < clearance) return true;
  }
  return false;
}

/**
 * Is this spot on the gate plaza or the bus stop?
 *
 * `entrance/layout.ts` has carried `ENTRANCE_CLEAR_X/Z/RADIUS` since the
 * entrance was written, under a comment reading *"Keeps the tree/bush scatter
 * (`Scenery.ts`) off the stop and the gate plaza"* — and **nothing had ever
 * imported them**. The comment described an intention; no code implemented it,
 * so trees and bushes were free to grow in the road the cat bus parks in and on
 * the ground the player is set down on. A comment asserting that two things
 * agree is not a mechanism, and this is that failure in its plainest form: the
 * constants were right, they were simply never asked.
 *
 * Now they are, at the one choke point every scatter goes through.
 */
function onEntrancePlaza(x: number, z: number, clearance: number): boolean {
  return Math.hypot(x - ENTRANCE_CLEAR_X, z - ENTRANCE_CLEAR_Z) < ENTRANCE_CLEAR_RADIUS + clearance;
}

/** Somewhere we are allowed to plant: not on paving, not in a reserved plot,
 * not on the railway, not where a ride sets a child down, not on the gate
 * plaza the cat bus drives through.
 *
 * `pathClearance` defaults to `clearance` — for a tree or a bush the two are
 * the same question. The walls are the one caller that wants them apart, and
 * the reason is issue #417. A wall run is *meant* to stand at the kerb, and
 * folding its path gap in with everything else made that impossible: every
 * wall sample had to clear the paving by the same 3.2 m it kept from a plot,
 * so across all five CI seeds the closest any wall ever came to paving was
 * 3.34 m — over five player-radii of grass, on every single run, for ever.
 * Jim, 31 August 2026: *"They should be alongside the paths and flush with it
 * at various places."* Splitting the parameter is what lets a wall be flush
 * while it still keeps its full distance from plots, the railway, ride exits
 * and the gate plaza — none of which it is decorating.
 */
function isPlantable(
  x: number,
  z: number,
  clearance: number,
  pathClearance: number = clearance,
): boolean {
  // Five metres inside the park's own edge — the same margin the old `> 55`
  // kept from the masonry at 60, now measured from an edge that moves.
  if (PARK_BOUNDARY.distanceToEdge(x, z) < PLANTABLE_MARGIN) return false;
  if (isOnPath(x, z, pathClearance)) return false;
  // Keep the fountain plaza open — wherever the layout put it (Decision 5).
  if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.radius + 1.6) return false;
  if (insideAnyAnchor(x, z, clearance)) return false;
  if (onRailway(x, z, clearance)) return false;
  if (onRideExit(x, z, clearance)) return false;
  if (onEntrancePlaza(x, z, clearance)) return false;
  return true;
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
function onRailway(x: number, z: number, clearance: number): boolean {
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
    // 3.2 m from every plot, the railway, a ride exit and the gate plaza — but
    // only its own half-thickness from the paving, which is what lets a run
    // stand at the kerb instead of 3.2 m out in the lawn. See #417 and
    // {@link WALL_PAVING_CLEARANCE}.
    if (!isPlantable(x, z, 3.2, WALL_PAVING_CLEARANCE)) return false;
    if (distanceToRailCorridor(x, z) < RAIL_CORRIDOR_CLEARANCE) return false;
    if (isInBridgeFootprint(x, z)) return false;
    // Seed 5 built a hiding wall across the cruiser's station approach and the
    // ride flew through it (#198). Safe to ask here, unlike `clearOfWalls`:
    // the coaster is solved at module load and knows nothing of this file.
    // The wider of the two kinds: this gate serves both generators.
    if (!clearOfCruiser(x, z, WALL_HALF_WIDTH.stone, WALL_TOP)) return false;
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
 *
 * {@link clearOfAnchors} is applied **here**, not in the two builders, so that
 * what this returns is exactly what ends up standing in the park. The foliage
 * scatter now asks this the same question the builders do, and there is only
 * one answer for it to get: a plan that had to be trimmed identically in three
 * places would be three places for the trimming to fall out of step.
 */
interface WallPlan {
  readonly wood: readonly WallRun[];
  readonly stone: readonly WallRun[];
  /** Every run that will stand, of either kind. See {@link clearOfWalls}. */
  readonly all: readonly WallRun[];
}

let cachedWallPlan: WallPlan | null = null;

function wallPlan(): WallPlan {
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
  //
  // `runHugsPaving` is applied **after** `clearOfAnchors`, on the trimmed runs,
  // because trimming is itself a way to strand a wall: `clearOfAnchors` cuts
  // out whatever span of a run crosses a plot, and the span it keeps can be
  // the far half — the half that was never near the path. Filtering the
  // candidates before the trim would miss exactly that, and it is the built
  // park `wallsRunAlongsideAPath` measures. See {@link wallAlongsideMax}.
  const wood = clearOfAnchors(generateWallMaze(placed)).filter(runHugsPaving);
  const stone = clearOfAnchors(generateStoneRuns(placed)).filter(runHugsPaving);
  cachedWallPlan = { wood, stone, all: [...wood, ...stone] };
  return cachedWallPlan;
}

/**
 * Is there room for a plant of `reach` here, clear of every wall the park is
 * about to stand up?
 *
 * `gap` is the breathing space *on top of* the two half-widths, and it
 * defaults to {@link TREE_WALL_GAP} because a tree is what asked first. The
 * bush scatter passes **0**, deliberately: `TREE_WALL_GAP` is two player radii
 * and exists so a canopy does not lean out over a wall a child then has to
 * squeeze past, and a bush has no canopy to lean. A clump standing *against* a
 * fence is a good look and is legal — it is a clump standing *inside* one that
 * issue #500 is about. Passing the reach and the gap separately, rather than
 * folding the gap into the reach at the call site, keeps one owner for "how
 * wide is this wall" and lets each caller state its own reason.
 *
 * Deliberately **not** folded into {@link isPlantable}, tempting though that
 * is: the wall generator's own {@link runIsClear} calls `isPlantable` for every
 * candidate run, so a wall test living in there would ask {@link wallPlan} for
 * an answer while `wallPlan` was still busy computing it — infinite recursion,
 * on the first tree of the first park.
 *
 * That the trees are the ones to give way is settled precedent in this file:
 * the rail route stopped bending around foliage when it became a pure
 * pre-scene plan, and the walls are a pure pre-scene plan too. Neither needs
 * the collision world, so both are known before a single tree is planted.
 */
function clearOfWalls(
  x: number,
  z: number,
  reach: number,
  gap: number = TREE_WALL_GAP,
  runs: readonly WallRun[] = wallPlan().all,
): boolean {
  for (const run of runs) {
    const needed = WALL_HALF_WIDTH[run.kind] + reach + gap;
    if (pointToSegment([x, z], run.from, run.to) < needed) return false;
  }
  return true;
}

/**
 * The hiding maze: L-shaped pieces scattered on the lawn. Two segments can
 * never close a region, and pieces keep {@link MAZE_PIECE_GAP} apart, so the
 * maze stays open however the seed falls — `check:park`'s routing invariant
 * then proves it, rather than trusting this comment.
 */
const MAZE_PIECE_GAP = 7;

/**
 * How much further apart than {@link MAZE_PIECE_GAP} two L-pieces' **corners**
 * must sit. A pure density knob — the separation that keeps the maze open is
 * `MAZE_PIECE_GAP` via `runsClash`/`fitsAmong`, and this only decides how many
 * pieces the lawn carries.
 *
 * **Was 12 (a 19 m corner spacing) and had to come down to hold the count when
 * walls moved onto the paths (#417).** Nothing about the maze got looser; the
 * space it is packed into changed shape. Corners used to be drawn from the
 * whole lawn *disc* — two dimensions — so a 19 m exclusion round each one still
 * left room for the next almost anywhere. Anchored to paving, corners lie on
 * what is effectively a one-dimensional network, where the same 19 m eats a
 * 38 m stretch of every kerb it lands on. Measured: the wooden count across the
 * five CI seeds fell 92 → 70 on the move alone, and 7 restores it to 88 without
 * touching a single clearance. `wallsDoNotClash` stays green throughout — it
 * measures faces, not corners, and `WALL_RUN_GAP` is untouched.
 */
const MAZE_CORNER_SPREAD = 7;

/**
 * The same thing for benches: how far apart two stone runs' centres must sit.
 *
 * New with #417, and needed for the mirror-image reason. A bench used to have
 * to find a clear patch of open lawn; now it needs a clear stretch of kerb, and
 * kerb is exactly what the park has miles of — so the same candidate budget
 * that produced 63 benches across the five seeds produced 85, a park visibly
 * busier with stonework than the one Jim is looking at. The budget is not the
 * lever it looks like: dropping `BENCH_CANDIDATES` from 4200 to 1300 moved the
 * canonical seed only 26 → 22, because acceptance is limited by how tightly
 * runs pack rather than by how many are offered. Spacing is the honest knob,
 * and the maze has had one all along.
 */
const BENCH_SPREAD = 9;

/** Fixed candidate budgets. Calibrated across the five CI seeds so the parks
 * carry roughly the counts the old count-targets produced (~10 hiding walls,
 * ~8 benches); the exact number now breathes with the seed. */
const MAZE_CANDIDATES = 2600;
const BENCH_CANDIDATES = 4200;
const BENCH_SALT = 0xbe7c4;

/**
 * **Where a decorative wall may stand: bordering a path edge or a plot
 * boundary, on the same grid axis it borders — never freestanding in open
 * lawn.** (Issue #300, Jim, playing: *"here we see 3 walls placed at
 * nonsensical locations that make no sense. On the grid layout, the walls
 * should be at the same orthogonal axes as the path and also be around the
 * edges of the path where there is nothing else they would collide with —
 * the point of walls isn't to scatter them at random!"*)
 *
 * Before this, both wall generators drew a fully free `(angle, radius)` from
 * the whole lawn disc and only *afterwards* asked whether the result was
 * clear of everything — so a run's existence never depended on anything it
 * was actually next to. The maze's yaw was `rng.pick([0, PI/2]) +
 * rng.range(-0.12, 0.12)`, so even its own grid intent was jittered off axis
 * by up to ~6.9 degrees, and the lawn benches picked their yaw fully at
 * random (`rng.range(0, Math.PI)`) with no grid consideration whatsoever.
 * Both drew their centre point from the whole disc with no reference to a
 * path or a plot at all — "clear of everything" is not the same claim as
 * "next to something", and Jim's three walls satisfied the first while
 * failing the second.
 *
 * A wall picked here instead starts from something real: a straight,
 * grid-axis stretch of the paved network ({@link pathBorderSegments}) or a
 * plot's own bounding circle ({@link ANCHORS}), snapped to a cardinal
 * bearing. Its yaw is read straight off that anchor's own axis — never
 * jittered — and its centre sits a fixed offset outside the thing it
 * borders, clear of the isPlantable margin that thing already keeps. The
 * *safety* checks below (`runIsClear`, `fitsAmong`, `clearOfAnchors`) are
 * unchanged: this only changes where a candidate's centre and yaw come from,
 * not what makes one acceptable once proposed.
 */
interface BorderAnchor {
  readonly x: number;
  readonly z: number;
  /** 0 or PI/2 — the grid axis the bordered thing itself runs along. */
  readonly axisYaw: number;
  /** Direction pointing away from the thing being bordered, so an arm that
   * extends this way only ever moves further from it, never back across it. */
  readonly outward: number;
}

/**
 * **Flush.** The gap a wall keeps from the paved surface itself.
 *
 * Not a tuned number: a wall's face touches the kerb exactly when its centre
 * line stands its own half-thickness back from the paving, so the widest run
 * the park builds ({@link WALL_HALF_WIDTH}`.stone`) *is* the clearance. The
 * extra 4 cm is a rendering fact rather than a spacing one — the kerb and the
 * wall's base are both drawn at ground level, and two coplanar faces z-fight.
 *
 * This is the number that makes "flush" possible at all. Before #417 the wall
 * generator asked `isPlantable(x, z, 3.2)`, so the paving gap was the same
 * 3.2 m it kept from a plot and no wall in any park could come nearer than
 * that. See {@link isPlantable}'s own `pathClearance` parameter.
 */
const WALL_PAVING_CLEARANCE = WALL_HALF_WIDTH.stone + 0.04;

/**
 * **Alongside.** How far out from the kerb a wall's anchor may be drawn,
 * as a multiple of the half-width of the path it is bordering.
 *
 * Expressed against the path rather than as metres on purpose. Jim asked for
 * walls "alongside the paths and flush with it at various places" — so the
 * range has to start at zero (genuinely flush; see
 * {@link WALL_PAVING_CLEARANCE}) and stop before the verge becomes a lawn. A
 * strip of grass as wide as the path beside it still reads as that path's
 * verge; twice the path's width reads as a field with a wall in it. The park's
 * routes are 2.6-3.6 m wide, so this is 0-2.6 m of grass on the narrowest and
 * 0-3.6 m on the widest, and a wall's offset varies with the path it follows
 * instead of every wall in the park standing off by the same typed constant —
 * which is exactly what the old fixed 3.6-6.5 m band did.
 */
const PATH_BORDER_OFFSET_PATH_WIDTHS = 2;

/**
 * **No wall stranded in open grass**: every run that stands must come at least
 * this close to real paving somewhere along its length.
 *
 * The bound is the widest verge {@link PATH_BORDER_OFFSET_PATH_WIDTHS} can
 * produce, plus one {@link PLAYER_RADIUS} of slack — and the slack is needed
 * for a real reason, not for comfort. A candidate is positioned against a
 * route's *control polygon* (`pathBorderSegments`), while the paving that gets
 * drawn is the Catmull-Rom curve through those points, which bows away from
 * the polygon between them. One player-radius is the smallest unit this game
 * measures anything in that covers that bow.
 *
 * Checked on the runs that actually stand, **after** `clearOfAnchors` has
 * trimmed them: trimming can cut away the very end that was hugging the path
 * and leave the far half stranded, which is precisely the shape of the bug
 * Jim reported. `wallsRunAlongsideAPath` (`test/procgen/invariants.ts`) then
 * proves it again off the built park.
 *
 * Read off the network this park actually built rather than off the widest
 * width `paths.ts` happens to declare today, so a new route type cannot widen
 * the verge the placer allows while leaving this bound behind — the invariant
 * derives its own copy the same way, from `ParkFacts.pathEdges`.
 */
function wallAlongsideMax(): number {
  let widest = 0;
  for (const seg of pathBorderSegments()) widest = Math.max(widest, seg.halfWidth);
  return widest * PATH_BORDER_OFFSET_PATH_WIDTHS + PLAYER_RADIUS;
}

/**
 * Does this run come near enough to real paving, anywhere along its length, to
 * read as belonging to a path? See {@link wallAlongsideMax}.
 *
 * Deliberately "anywhere along its length" and not "everywhere": an L-shaped
 * hiding piece has one arm hugging the kerb and one reaching out into the lawn
 * behind it, and that second arm is the whole point of somewhere to hide. What
 * the park may not have is a run with *no* part of it near a path.
 */
function runHugsPaving(run: WallRun): boolean {
  const limit = wallAlongsideMax();
  const [x1, z1] = run.from;
  const [x2, z2] = run.to;
  const steps = Math.max(4, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 0.5));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    if (distanceToPath(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t) <= limit) return true;
  }
  return false;
}

/**
 * Draws one candidate anchor from this attempt's own RNG stream — a point and
 * grid axis taken from a **real stretch of paving**, never from open lawn.
 * `null` only if the park has no on-grid paving at all (never true in
 * practice; kept honest rather than assuming the network is non-empty).
 *
 * ### Why plots stopped being anchors (#417)
 *
 * Until now 35 % of candidates anchored to a plot's bounding circle instead,
 * `PLOT_BORDER_OFFSET_MIN..MAX` = 6.2-9.5 m outside it, with no reference to a
 * path anywhere in the draw. Those produced the walls Jim actually saw: on the
 * built park, seed 11 stood one at (-89.7, 41.5), **37.5 m from the nearest
 * paving**; seed 2 one at (74.8, 57.4) at 34.8 m; seed 5 one at (-84.6, 5.4)
 * at 27.4 m. A plot out near the park edge has lawn all round it, so "6 m
 * outside this building's circle" and "in the middle of a field" are the same
 * place, and nothing in the draw could tell them apart.
 *
 * Dropping the branch costs nothing a player would miss, because **every plot
 * already has its own approach spur** — a building's corner still gets its
 * garden wall, anchored to the path that serves that building rather than to
 * an abstract circle round it. What it does cost is *candidates*: a third of
 * them used to come from here, so {@link MAZE_CANDIDATES} and
 * {@link BENCH_CANDIDATES} are raised to match, because Jim asked for the same
 * number of walls in better places, not for fewer walls.
 */
function pickBorderAnchor(rng: Rng): BorderAnchor | null {
  const segments = pathBorderSegments();
  if (segments.length === 0) return null;

  // The segment is found by drawing a random point on the lawn and taking
  // the border segment nearest it — never `rng.pick(segments)`. Picking by
  // index looked equivalent and was a park-wide coupling in disguise: any
  // change that split or merged one straight run anywhere renumbered the
  // whole list, and every candidate's pick shifted one entry over — so a
  // 2 m bow on one spur nudged garden walls on the far side of the park
  // (`test/procgen/scatterDecoupling.test.ts`). A nearest-segment lookup
  // only changes for candidates whose drawn point lands near the paving
  // that actually changed.
  const probeAngle = rng.range(0, TAU);
  const probeDistance = Math.sqrt(rng.unit()) * (edgeRadiusAt(PARK_BOUNDARY, probeAngle) - 4);
  const probeX = Math.cos(probeAngle) * probeDistance;
  const probeZ = Math.sin(probeAngle) * probeDistance;
  let seg = segments[0] as PathBorderSegment;
  let segDistance = Infinity;
  for (const candidate of segments) {
    const d = pointToSegment([probeX, probeZ], candidate.a, candidate.b);
    if (d < segDistance) {
      segDistance = d;
      seg = candidate;
    }
  }
  const t = rng.range(0.15, 0.85);
  const px = seg.a[0] + (seg.b[0] - seg.a[0]) * t;
  const pz = seg.a[1] + (seg.b[1] - seg.a[1]) * t;
  const side = rng.pick([1, -1] as const);
  const perp = seg.axisYaw + Math.PI / 2;
  // From flush against the kerb to a verge as wide as the path itself. The
  // bottom of the range is the point of it: `rng.range` is closed at the low
  // end, so a real share of candidates come out at or within centimetres of
  // zero and their walls stand *on* the path edge — "flush with it at various
  // places". The top scales with `seg.halfWidth`, so a wall beside the 3.6 m
  // main loop may sit further out than one beside a 2.6 m spur, and no two
  // walls in the park share one typed stand-off distance.
  const offset = rng.range(0, seg.halfWidth * PATH_BORDER_OFFSET_PATH_WIDTHS);
  const distance = seg.halfWidth + WALL_PAVING_CLEARANCE + offset;
  const x = px + Math.cos(perp) * side * distance;
  const z = pz + Math.sin(perp) * side * distance;
  const outward = side > 0 ? perp : perp + Math.PI;
  return { x, z, axisYaw: seg.axisYaw, outward };
}

/**
 * How far (x, z) is from the nearest thing a wall may legitimately border: a
 * paved edge, or a plot's own bounding circle. Negative inside either.
 *
 * This is the general-purpose backstop {@link pickBorderAnchor} alone cannot
 * be: an anchor's *corner* is placed a known offset from the border it was
 * drawn from, but an arm's far *tip* can walk past the end of a short border
 * segment (see {@link MIN_BORDER_SEGMENT_LENGTH} in `paths.ts` — a segment
 * only has to clear 4 m, and a maze arm can reach 8.5) and land somewhere no
 * longer close to that segment, or to anything else. Checking every arm tip
 * against every border, not just the one it was drawn from, is what catches
 * that the same way {@link runIsClear} checks a candidate against the whole
 * park rather than trusting the anchor it started from.
 */
function distanceToBorderedThing(x: number, z: number): number {
  let best = Infinity;
  for (const seg of pathBorderSegments()) {
    const d = pointToSegment([x, z], seg.a, seg.b) - seg.halfWidth;
    if (d < best) best = d;
  }
  for (const anchor of ANCHORS) {
    const d = Math.hypot(x - anchor.position[0], z - anchor.position[1]) - anchor.boundingRadius;
    if (d < best) best = d;
  }
  return best;
}

/**
 * No point of a decorative wall may end up further than this from the
 * nearest path edge or plot boundary — the actual bound {@link
 * distanceToBorderedThing} is checked against, and the number
 * `wallsBorderSomethingReal` (`test/procgen/invariants.ts`) proves the built
 * park never exceeds.
 *
 * Generous above the anchor offsets above (path: up to 6.5 m; plot: up to
 * 9.5 m) so a maze piece's own arms — up to 8.5 m of tangent reach plus 5 m of
 * outward reach — are not refused for merely being a real L-shape, but tight
 * enough that "close to a path or a plot", not "somewhere on the lawn", is
 * what every accepted candidate actually is.
 */
const WALL_BORDER_MAX_DISTANCE = 11;

function generateWallMaze(placed: WallRun[]): WallRun[] {
  // Exactly 1.00 m sits ON the measured flight ceiling and fails the boot
  // assert by a float hair - honest heights only.
  const heights = [0.8, 0.95, 1.5, 1.8, 2.1, 2.6];
  const runs: WallRun[] = [];
  const cornerPoints: [number, number][] = [];
  let piece = 0;
  // Fixed candidate set, every fitting L accepted — same reasoning as the
  // benches (see generateStoneRuns): a count target turns any local refusal
  // into a distant promotion, which is exactly the coupling the
  // scatter-decoupling invariant forbids. Density is capped by the corner
  // spacing rule, so the budget below is what sets the EXPECTED count.
  for (let attempts = 1; attempts <= MAZE_CANDIDATES; attempts += 1) {
    // Per-candidate stream: this loop bailed out after 2, 6 or 8 draws
    // depending on which test refused it, which is precisely how a longer path
    // spur used to relocate a garden wall onto an unrelated kiosk's doorstep.
    const rng = candidateRng(MAZE_SALT, attempts);
    const anchor = pickBorderAnchor(rng);
    if (!anchor) continue;
    const { x: cx, z: cz, axisYaw, outward } = anchor;
    if (cornerPoints.some(([px, pz]) => Math.hypot(cx - px, cz - pz) < MAZE_PIECE_GAP + MAZE_CORNER_SPREAD)) {
      continue;
    }
    // One arm hugs the bordered edge (either direction along it); the other
    // extends outward, away from what it borders, so it only ever opens
    // further into the lawn and never doubles back across the thing it
    // anchors to.
    const armATowards = rng.pick([axisYaw, axisYaw + Math.PI] as const);
    const armA = rng.range(5.5, 8.5);
    const armB = rng.range(3.5, 5.5);
    const a2: [number, number] = [cx + Math.cos(armATowards) * armA, cz + Math.sin(armATowards) * armA];
    const b2: [number, number] = [cx + Math.cos(outward) * armB, cz + Math.sin(outward) * armB];
    // Both tips, not just the anchored corner — see `distanceToBorderedThing`.
    if (
      distanceToBorderedThing(a2[0], a2[1]) > WALL_BORDER_MAX_DISTANCE ||
      distanceToBorderedThing(b2[0], b2[1]) > WALL_BORDER_MAX_DISTANCE
    ) {
      continue;
    }
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
  // Centres of the lawn benches that stand, for {@link BENCH_SPREAD}. Only
  // recorded on acceptance: a candidate refused for crossing a path must not
  // reserve the space it was refused from.
  const benchCentres: [number, number][] = [];
  const consider = (run: WallRun): boolean => {
    if (!runIsClear(run.from[0], run.from[1], run.to[0], run.to[1])) return false;
    if (!fitsAmong(run, placed)) return false;
    runs.push(run);
    placed.push(run);
    return true;
  };

  // Beds: short tangent walls just off the plaza kerb, on the plaza's own
  // cardinal bearings — exactly on grid axis, not jittered off it, for the
  // same reason the lawn benches below no longer roll a free yaw (issue #300).
  // Against the plaza's own kerb, not 3.2 m out on the grass round it. The
  // plaza is paving like any other, so a bed borders it the way a wall borders
  // a path (#417): flush plus a verge drawn from the same range, which is what
  // stops these four reading as a ring of walls marooned around the fountain.
  const bedVerge = rng.range(0, wallAlongsideMax() - PLAYER_RADIUS);
  const bedDistance = PLAZA.radius + WALL_PAVING_CLEARANCE + bedVerge;
  for (let i = 0; i < 4; i += 1) {
    const bearing = (i / 4) * Math.PI * 2;
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
  //
  // A FIXED number of index-seeded candidates, every fitting one accepted —
  // not "keep drawing until 8 stand" (issue #241). A count target makes the
  // scatter global: refusing one candidate promotes a later one somewhere
  // else entirely, so bowing a path spur two metres moved stonework across
  // the park and the scatter-decoupling invariant caught it. With fixed
  // indices a refusal only ever removes THAT bench; the count breathes a
  // little per seed instead, which "every park is unique" is happy with.
  for (let attempt = 0; attempt < BENCH_CANDIDATES; attempt += 1) {
    const bench = candidateRng(BENCH_SALT ^ PARK_SEED, attempt);
    // Anchored to a real path edge or plot boundary, on that thing's own grid
    // axis (issue #300) — not the free `(angle, radius)` position and fully
    // random `rng.range(0, Math.PI)` yaw this used to roll, which is exactly
    // what put stonework at nonsensical diagonal angles out among the bushes
    // with nothing to do with anything nearby.
    const anchor = pickBorderAnchor(bench);
    if (!anchor) continue;
    const { x: cx, z: cz, axisYaw } = anchor;
    // Density, the same way the maze does it — see {@link BENCH_SPREAD}. Only
    // the lawn benches, not the four plaza beds above, which are placed on the
    // plaza's own cardinal bearings and are meant to be a set of four.
    if (benchCentres.some(([px, pz]) => Math.hypot(cx - px, cz - pz) < BENCH_SPREAD)) {
      continue;
    }
    // Shorter than the 7-9 m these used to roll. A run that long is a garden
    // wall, and the lawn has very few 9 m stretches that clear every path,
    // plot and now the railway along their whole length — the old length only
    // ever fitted because `runIsClear` sampled five points and stepped over
    // what lay between them. 4.4-6.4 m still reads as stonework to sit on.
    const half = bench.range(2.2, 3.2);
    const from: [number, number] = [cx - Math.cos(axisYaw) * half, cz - Math.sin(axisYaw) * half];
    const to: [number, number] = [cx + Math.cos(axisYaw) * half, cz + Math.sin(axisYaw) * half];
    // Same backstop as the maze arms: a short border segment can still let a
    // tangent run walk past its end into open lawn.
    if (
      distanceToBorderedThing(from[0], from[1]) > WALL_BORDER_MAX_DISTANCE ||
      distanceToBorderedThing(to[0], to[1]) > WALL_BORDER_MAX_DISTANCE
    ) {
      continue;
    }
    piece += 1;
    if (consider({ from, to, height: bench.pick([0.8, 0.95] as const), kind: 'stone', piece })) {
      benchCentres.push([cx, cz]);
    }
  }
  return runs;
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
    const wall = new Mesh(geometry, wallMaterial);
    wall.position.set(midX, base + run.height / 2, midZ);
    wall.rotation.y = -angle;
    standOnSphere(wall);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);

    // A rounded coping stone along the top — reads as "sit on me".
    const coping = new Mesh(new BoxGeometry(length + 0.2, 0.16, 0.72), copingMaterial);
    coping.position.set(midX, base + run.height + 0.08, midZ);
    coping.rotation.y = -angle;
    standOnSphere(coping);
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

/** Multiplies a geometry's UVs so a tiling texture keeps a constant scale. */
function scaleUvs(geometry: BufferGeometry, sx: number, sy: number): void {
  const uv = geometry.getAttribute('uv');
  if (!uv) return;
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  }
  uv.needsUpdate = true;
}

