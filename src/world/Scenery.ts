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
import { PLAYER_RADIUS } from '../core/constants';
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
import { terrainHeight } from './terrain';
import { isOnPath, PLAZA } from './paths';
import { ANCHORS } from './anchors';
import { COASTER_PLANS } from './coaster/plan';
import { CART_ENVELOPE } from './coaster/cart';
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
  /** The subset of trees big enough to climb. See {@link ClimbableTreeSeed}. */
  readonly climbableTrees: readonly ClimbableTreeSeed[];
  /** Every tree big enough to hide the player. See {@link FoliageOccluder}. */
  readonly foliageOccluders: readonly FoliageOccluder[];
  /** Every bush clump standing in the park. See {@link PlacedBush}. */
  readonly bushes: readonly PlacedBush[];
  private readonly hideableInstances: readonly (readonly HideableInstance[])[];

  constructor(collision: CollisionWorld) {
    this.group.name = 'scenery';
    const foliage = buildFoliage(collision);
    this.group.add(foliage.group);
    this.climbableTrees = foliage.climbableTrees;
    this.foliageOccluders = foliage.occluders;
    this.bushes = foliage.bushes;
    this.hideableInstances = foliage.hideableInstances;
    this.group.add(buildTreeline());
    // Collected as they are built, from the already-trimmed `wallPlan`, so
    // what is published is what is standing — and is what `buildFoliage`
    // above has just planted its trees around.
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

/**
 * **How big the ball at the top of a tree must be for a child to climb it.**
 *
 * Taken from the head that has to come out of it, not from the range the
 * scatter happens to roll. A climbing child is hidden outright except for her
 * head and her waving arm (`world/TreeClimbing.ts`), and that head is a
 * deliberately enormous cartoon one — `SKULL_RADIUS`, 0.66 m. The canopy is
 * asked to be **twice** it, so she reads as coming *out of* foliage rather than
 * balancing on top of a pea.
 *
 * Expressed against `SKULL_RADIUS` rather than as the 1.32 it currently works
 * out at, because the two are only meaningful together: shrink the kid's head
 * and a smaller ball would do; grow it and this must follow. It is the same
 * rule ART-AGENT-NOTES §2 keeps asking for — one owner, everybody else asks.
 *
 * Against the ranges actually rolled below, this admits **every lollipop and
 * every blossom** (main ball 1.75–2.5) and refuses **every stack** (its top
 * blob narrows to 0.90–1.15) and every pine (cones, not balls) — which is the
 * same set the old hand-written kind list was reaching for, minus the blossom
 * it excluded on taste and the 2.05 bar that had no owner.
 */
const CLIMBABLE_MIN_CANOPY_RADIUS = 2 * SKULL_RADIUS;

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

/**
 * How high each kind of tree can reach above its own ground, in metres.
 *
 * {@link TREE_REACH}'s vertical twin, reserved the same way and for the same
 * reason: a candidate is refused for the height it *could* take rather than the
 * height it happens to roll, because {@link clearOfCruiser} is asked before the
 * tree is rolled in detail. Ceilings, from the same literals the scatter below
 * draws from — trunk `rng.range(2.3, 3.7)`, so 3.7 of trunk in every case, plus:
 *
 * - `pine` — the top cone sits at most `1.5 * 2/3 - 0.6` above the trunk and is
 *   at most `2.2` tall on a `ConeGeometry(1, 1)`, so half of it clears the
 *   centre. Ceiling 3.7 + 1.36, rounded to 5.2.
 * - `stack` — the third blob rides `2 * radius * 0.92` up and adds its own
 *   radius on an `IcosahedronGeometry(1, …)`, which spans ±1. Ceiling 6.6.
 * - `lollipop` / `blossom` — a ball of up to 2.5 centred `radius * 0.42` above
 *   the trunk and standing `radius * 1.0` above that: `2.5 * 1.42` = 3.55, so
 *   7.25. These are the tallest thing on the lawn as well as the widest, and
 *   they are the reason this is a table rather than one number.
 *
 * The measured tallest canopy in the canonical park is 6.68 m, which sits
 * between the `stack` and `lollipop` ceilings exactly as it should.
 */
const TREE_TOP: Record<TreeKind, number> = {
  pine: 5.2,
  stack: 6.6,
  lollipop: 7.25,
  blossom: 7.25,
};

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

function buildFoliage(collision: CollisionWorld): {
  group: Group;
  climbableTrees: ClimbableTreeSeed[];
  occluders: FoliageOccluder[];
  bushes: PlacedBush[];
  hideableInstances: HideableInstance[][];
} {
  const group = new Group();
  group.name = 'foliage';

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
  // Attempts raised with each new refusal: the original budget was sized for a
  // test that almost never said no.
  //
  // `targetTrees` has not actually been reachable for some time — the lawn is
  // tight enough that the budget runs out first, and the canonical seed was
  // already settling for 30 before the wall refusal was added. Adding it took
  // that to 19 at the old 26 000, which is a visibly thinner park, so the
  // budget goes up to buy the trees back: 26 on the canonical seed and 26-30
  // across the sweep seeds, for about 400 ms of extra headless build.
  //
  // Raised again to 180 000 for the castle pass (#113), and the reason is a
  // knock-on rather than anything this branch plants: the Sky Cruiser now
  // threads the castle, which moves its station exit, and `paths.ts` routes the
  // walk network to that exit. #196 separately lengthened every stall spur. Two
  // independently-green changes each took a bite out of the same lawn, and seed
  // 5 came out at exactly 24 against a floor of `> 24`.
  //
  // The budget is bounded on *both* sides, and both bounds were measured. Below
  // it the tree floor reds; at 150 000 `check:park` reds instead, because the
  // scatter's arrangement at that density walls in a waypoint nothing can then
  // walk to (`poi.stranded`, no allowance). Trees across the five CI seeds:
  //
  //   120 000 -> 29 / 29 / 24 / 27 / 26   tree floor red (seed 5 at 24)
  //   150 000 -> 29 / 30 / 25 / 27 / 26   check:park red (waypoint walled in)
  //   180 000 -> 29 / 30 / 26 / 28 / 27   both green
  //   210 000 -> 31 / 31 / 28 / 30 / 29   both green, +0.3 s for trees nobody
  //                                       counts — and red on the stacked #198
  //                                       branch, whose scatter arranges
  //                                       differently and strands a waypoint
  //
  // So this is the *smallest* budget at which both guards pass, which is the
  // rule worth keeping: the extra attempts are load time a child waits through.
  // The honest fix for the shortfall is still a scatter that does not
  // rejection-sample a tight lawn at all, which is a bigger job than this one.
  //
  // `clearOfCruiser` below then costs **one more tree on seed 5** — 26 becomes
  // 25 — which still clears the floor but leaves only one tree of slack. That
  // is thin, and the slack is not this refusal's to give back: two of seed 5's
  // three lost trees are the castle-and-#196 knock-on above. Note also that
  // 210 000 is *not* available as headroom here even though it is on the castle
  // branch alone: this scatter arranges differently and strands a waypoint at
  // (-13.8, 15.6), which `check:park` refuses with no allowance. Isolated
  // rather than guessed — trees and walls use separate RNG streams, and
  // disabling the wall keep-out left the stranding in place while reverting the
  // budget alone cleared it.
  while (treeCount < targetTrees && attempts < 180000) {
    attempts += 1;
    // This candidate's own stream. Everything below draws from it and nothing
    // else, so what this attempt proposes depends on `attempts` and the seed —
    // never on how many earlier candidates happened to be accepted.
    const rng = candidateRng(TREE_SALT, attempts);
    const angle = rng.range(0, TAU);
    // Scaled to the park's reach on the bearing picked, so the lawn is seeded
    // evenly whether that bearing runs 57 m to the edge or 110 m. A fixed
    // radius would crowd every tree into the middle of a park this shape.
    const distance = Math.sqrt(rng.unit()) * (edgeRadiusAt(PARK_BOUNDARY, angle) - 6);
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (!isPlantable(x, z, 2.6)) continue;

    const kind = pickTreeKind(rng);
    const reach = TREE_REACH[kind];
    if (planted.some((tree) => Math.hypot(x - tree.x, z - tree.z) < tree.reach + reach)) continue;
    // The walls are decided before any of this runs, so a tree that would grow
    // into one is simply refused the spot. See `clearOfWalls`/`TREE_WALL_GAP`.
    if (!clearOfWalls(x, z, reach)) continue;
    // ...and so is the Sky Cruiser's loop, which dips to boarding height beside
    // its station and would otherwise fly straight through this canopy (#198).
    // Asked here rather than in `isPlantable` because it wants the kind, which
    // is already picked above — so no RNG draw moves to make room for it.
    if (!clearOfCruiser(x, z, reach, TREE_TOP[kind])) continue;
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
    // The highest *ball* on this tree, and how big it is — what decides whether
    // a child can climb it. Tracked here, across all three canopy branches,
    // rather than asked inside one of them: see `climbableTrees` below.
    let topBallTopY = -Infinity;
    let topBallRadius = 0;
    const noteBall = (centreY: number, radius: number, halfHeight: number): void => {
      const top = centreY + halfHeight;
      if (top > topBallTopY) {
        topBallTopY = top;
        topBallRadius = radius;
      }
    };

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
        noteBall(canopyItem.position.y, radius, canopyItem.scale.y);
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
      noteBall(canopyCentreY, radius, canopyItem.scale.y);
      roundCanopies.push(canopyItem);
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
        noteBall(smallItem.position.y, small, smallItem.scale.y);
        roundCanopies.push(smallItem);
      }
    }

    // **Climbable: any tree whose topmost canopy is a ball big enough to come
    // out of.** Asked here, of the finished tree, rather than inside one
    // branch of the three above — which is how the old rule
    // (`kind === 'lollipop' && radius >= 2.05`) came to be answering a
    // question about *kinds* when the thing that matters is *geometry*. A new
    // tree kind now inherits the right answer instead of silently inheriting
    // "no".
    //
    // Jim, 6 August: *"we need more climbable trees, it takes a long time to
    // find one."* He was right, and the measured park was worse than it
    // sounds: **2 climbable trees on the canonical seed, and 1, 2, 2, 3 and 5
    // across the five CI seeds** — a whole park with a single climbable tree
    // in it. Half the median walk to the nearest one, and the far corners of
    // the park had none within 68 m.
    //
    // The old rule cost trees twice over. The kind test threw away `blossom`,
    // which is *the same branch of this very function* as `lollipop` and
    // differs from it only in the colour of the ball; and the 2.05 bar then
    // took two thirds of what survived, guarding "plenty of canopy to hide a
    // body in" — a body that `TreeClimbing.hidePlayerBody` does not hide in
    // the canopy at all, but makes **invisible outright**. There was nothing
    // left for the margin to protect.
    //
    // What is actually required is that her *head* reads as coming out of
    // foliage rather than balancing on a pea, so the bar is set against the
    // head — see {@link CLIMBABLE_MIN_CANOPY_RADIUS}.
    if (topBallRadius >= CLIMBABLE_MIN_CANOPY_RADIUS) {
      climbableTrees.push({ x, z, canopyTopY: topBallTopY, trunkRadius: 0.55 * lean });
    }

    occluders.push({ x, z, centreY: wideCentreY, radius: wideRadius, parts });
    occluderRefs.push(refs);

    collision.addCircle(x, z, 0.55 * lean);
    treeCount += 1;
  }

  // --- bushes --------------------------------------------------------------
  /** Where each clump stands, published as {@link PlacedBush}. */
  const bushClumps: PlacedBush[] = [];
  /** Radius of the collider a clump registers, and so the ground it occupies. */
  const BUSH_COLLIDER = 0.85;
  attempts = 0;
  // **A fixed budget, and no target count — the two are not compatible.**
  //
  // This loop used to run `while (bushCount < 108 && attempts < 5200)`, and a
  // "keep going until you have 108" loop is a coupling all of its own, quite
  // separate from the shared-generator one. Refuse one clump because a path
  // grew under it and the loop simply runs one attempt longer, admitting a
  // candidate at the tail that was never in the park before. Measured on this
  // branch before the change: bowing one spur by 2 m refused 4 clumps near the
  // bow and conjured 4 unrelated ones at the far end of the sequence.
  //
  // So the count is now whatever passes. Wanting *exactly* N and wanting a
  // change here to leave things over there alone are genuinely incompatible
  // aims, and locality is the one that unblocks moving a booth (#216, #117).
  //
  // **The budget is set by the worst seed, not by the canonical one.** That
  // distinction was got wrong once and is the whole reason this paragraph is
  // here. The first value tried, 1050, was tuned until the canonical seed
  // landed on exactly the 108 clumps it had before — which looked like a
  // perfect no-change result and hid the fact that seed 2 came out at 86, a
  // fifth of its ground cover gone. A single seed standing in for five will
  // always flatter whichever seed it is.
  //
  // Every seed used to get 108, because the old fill-to-N loop had 4-5x the
  // candidates it needed on all of them. So the bar is: **no seed plants fewer
  // than the 108 it used to.** Measured across the five CI seeds:
  //
  //   budget   canonical   s2    s5   s11   s18   worst
  //     1050        108    86   103   106   102      86   <- seed 2 stripped
  //     1200        131   105   118   119   116     105   <- still under
  //     1300        138   118   126   129   127     118
  //     1400        149   128   137   142   140     128   <- chosen
  //     1500        164   138   151   157   151     138
  //
  // 1400 is the first value with real headroom over the 108 floor on the
  // *worst* seed (128, so 20 clumps of slack) rather than merely clearing it,
  // which matters because the count moves whenever the geometry does — a park
  // change that paves more lawn takes a bite out of every seed at once.
  //
  // Locality is unaffected by the number: candidate k is evaluated if and only
  // if k < budget, whatever the budget is.
  const BUSH_BUDGET = 1400;
  while (attempts < BUSH_BUDGET) {
    attempts += 1;
    const rng = candidateRng(BUSH_SALT, attempts);
    const angle = rng.range(0, TAU);
    const distance = Math.sqrt(rng.unit()) * (edgeRadiusAt(PARK_BOUNDARY, angle) - 5);
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (!isPlantable(x, z, 1.6)) continue;
    if (!clearOfCruiser(x, z, BUSH_REACH, BUSH_TOP)) continue;

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
    collision.addCircle(x, z, BUSH_COLLIDER);
    bushClumps.push({ x, z, radius: BUSH_COLLIDER });
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

  return { group, climbableTrees, occluders, bushes: bushClumps, hideableInstances };
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
function onRideExit(x: number, z: number, clearance: number): boolean {
  const cruiser = COASTER_PLANS.cruiser;
  return Math.hypot(x - cruiser.exitX, z - cruiser.exitZ) < RIDE_EXIT_CLEAR + clearance;
}

/** Somewhere we are allowed to plant: not on paving, not in a reserved plot,
 * not on the railway, not where a ride sets a child down. */
function isPlantable(x: number, z: number, clearance: number): boolean {
  // Five metres inside the park's own edge — the same margin the old `> 55`
  // kept from the masonry at 60, now measured from an edge that moves.
  if (PARK_BOUNDARY.distanceToEdge(x, z) < PLANTABLE_MARGIN) return false;
  if (isOnPath(x, z, clearance)) return false;
  // Keep the fountain plaza open — wherever the layout put it (Decision 5).
  if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.radius + 1.6) return false;
  if (insideAnyAnchor(x, z, clearance)) return false;
  if (onRailway(x, z, clearance)) return false;
  if (onRideExit(x, z, clearance)) return false;
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
function clearOfCruiser(x: number, z: number, reach: number, topY: number): boolean {
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
    if (!isPlantable(x, z, 3.2)) return false;
    if (distanceToRailCorridor(x, z) < RAIL_CORRIDOR_CLEARANCE) return false;
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
  const wood = clearOfAnchors(generateWallMaze(placed));
  const stone = clearOfAnchors(generateStoneRuns(placed));
  cachedWallPlan = { wood, stone, all: [...wood, ...stone] };
  return cachedWallPlan;
}

/**
 * Is there room for a tree of `reach` here, clear of every wall the park is
 * about to stand up?
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
function clearOfWalls(x: number, z: number, reach: number): boolean {
  for (const run of wallPlan().all) {
    const needed = WALL_HALF_WIDTH[run.kind] + reach + TREE_WALL_GAP;
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

function generateWallMaze(placed: WallRun[]): WallRun[] {
  // Exactly 1.00 m sits ON the measured flight ceiling and fails the boot
  // assert by a float hair - honest heights only.
  const heights = [0.8, 0.95, 1.5, 1.8, 2.1, 2.6];
  const runs: WallRun[] = [];
  const cornerPoints: [number, number][] = [];
  let attempts = 0;
  let piece = 0;
  while (runs.length < 10 && attempts < 4000) {
    attempts += 1;
    // Per-candidate stream: this loop bailed out after 2, 6 or 8 draws
    // depending on which test refused it, which is precisely how a longer path
    // spur used to relocate a garden wall onto an unrelated kiosk's doorstep.
    const rng = candidateRng(MAZE_SALT, attempts);
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
