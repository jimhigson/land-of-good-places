import { PLAYER_MAX_SPEED, PLAYER_RADIUS } from '../../src/core/constants';
import { PARK_SEED } from '../../src/world/parkManifest';
import { shapesOverlap, type Claim, type GroundClaims } from '../../src/boot/groundClaims';
import { type CollisionWorld } from '../../src/world/Collision';
import { refusal, type FeatureBuilder, type Increment, type Refusal } from '../boot/featureBuilder';
import { Rng, TAU, candidateRng } from '../../src/core/mathUtils';
import { TREE_REACH, TREE_TOP, pickTreeKind, rollTree, type RolledTree, type TreeKind } from '../../src/world/treeModel';
import { hidesTheArrivingBus } from '../../src/world/entrance/arrivalSightline';
import { terrainHeight } from '../../src/world/terrain';
import { distanceToPath, isOnPath, pathBorderSegments, pathCentreline, type PathBorderSegment } from '../../src/world/pathGraph';
import { PARK_BOUNDARY, edgeRadiusAt } from '../../src/world/boundary';
import { COASTER_PLANS } from '../../src/world/coaster/plan';
import { RAIL_RACE_PLAN } from '../../src/world/railRace/plan';
import { SLIDE_PLAN } from '../../src/world/slide/plan';
import { FERRIS_WHEEL_EXIT } from '../../src/minigames/ferrisWheel/exit';
import { ENTRANCE_CLEAR_RADIUS, ENTRANCE_CLEAR_X, ENTRANCE_CLEAR_Z } from '../../src/world/entrance/layout';
import { PLAZA } from '../../src/world/paths';
import { PARK_LAYOUT } from '../../src/world/parkLayout';
import { RAIL_CORRIDOR_CLEARANCE, distanceToRailCorridor } from '../../src/world/train/plan';
import { isInBridgeFootprint } from '../../src/world/train/bridgeKeepout';
import { ANCHORS } from '../../src/world/anchors';
import { BUSH_COLLIDER, CLIMBABLE_MIN_CANOPY_RADIUS, TREE_TRUNK_CLAIM, WALL_HALF_WIDTH, clearOfCruiser, disc, onRailway, rollBush, type BushDecision, type TreeDecision, type WallRun } from '../../src/world/Scenery';
/**
 * **The trees', bushes' and walls' builders** — the world phase's scatter
 * and placement search. Moved verbatim from `src/world/Scenery.ts`, which
 * keeps the decisions' types and draws them. Build-time only
 * (`docs/design/PREBUILT-PARKS.md`).
 */

/** How far inside the park's edge anything may be planted. Was `> 55` against a 60 m wall. */
const PLANTABLE_MARGIN = 5;


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
        const decision: BushDecision = { x, z, rollState: rng.state, blobs: rollBush(rng, x, z), resume };
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
        const moved: BushDecision = { ...old, x, z, rollState: rng.state, blobs: rollBush(rng, x, z) };
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
    deps: ['stalls'],
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
