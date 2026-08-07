/**
 * **A built park, reduced to the facts an invariant can be stated about.**
 *
 * This is the vitest side of the philosophy `scripts/check-park.mts` is built
 * on: *a number an author writes down is a claim; a number derived from the
 * built object is a fact*. Nothing here describes what the generators are
 * supposed to do. Every field below is read back off a real `World` — the wall
 * runs `Scenery` actually stood up, the trees it actually planted, the curve
 * the train actually solved — so an invariant that passes has been proved
 * against the park, not against the rules that were meant to produce it.
 *
 * It complements `check:park` rather than replacing it. That script owns the
 * six invariants about whether the park *works* — routing, the waypoint graph,
 * rail exclusion — and holds them to a ratchet on one canonical seed. This
 * suite owns the invariants about whether the park's scattered furniture is
 * *placed sanely*, and holds them across many seeds with no allowances at all.
 */
import { Vector3 } from 'three';
import type { World } from '../../src/world/World.ts';
import type { ParkBoundary } from '../../src/world/boundary.ts';

/** A wall run flattened to what a clearance test needs. */
export interface WallFact {
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly halfWidth: number;
  /** Runs sharing this are one deliberately-joined structure (an L-piece). */
  readonly piece: number;
  readonly kind: string;
}

/**
 * A tree's true planar footprint.
 *
 * `FoliageOccluder.radius` is only the *widest single blob*, which for a
 * lollipop understates the tree: the small ball tucked beside the main canopy
 * sits `0.7 × radius` off the trunk and carries its own radius on top of that.
 * So the footprint is derived by walking every part the tree is actually built
 * from and taking the furthest that any of them reaches.
 */
export interface TreeFact {
  readonly x: number;
  readonly z: number;
  readonly footprint: number;
}

/**
 * One bush clump, as planted.
 *
 * New in the RNG-decoupling work, and the reason it is new is worth keeping:
 * the bush scatter had **no observable output at all**. `Scenery` published
 * trees and walls but nothing for bushes, so no check in this suite could see a
 * bush anywhere — which is how 108 clumps re-rolling on every tree gained or
 * lost went unnoticed for as long as it did. A subsystem nothing can measure is
 * a subsystem nothing can hold to a standard.
 */
export interface BushFact {
  readonly x: number;
  readonly z: number;
  /** Radius of the collider the clump puts in the walker's way. */
  readonly radius: number;
}

/**
 * One tree a child can actually climb, as published to the game.
 *
 * New for the same reason {@link BushFact} was, and it went wrong the same way:
 * `climbableTrees` was reachable by `TreeClimbing` and by every NPC's wander
 * driver, and by **nothing that could measure it**. So a rule that admitted
 * only large lollipops quietly left the canonical park with **two** climbable
 * trees, and one CI seed with **one**, until Jim went looking for a tree to
 * climb and could not find one. Trees were counted; climbable trees were not.
 */
export interface ClimbableTreeFact {
  readonly x: number;
  readonly z: number;
  /** Where a head pops out — the top of the ball she comes out of. */
  readonly canopyTopY: number;
}

export interface PlotFact {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly boundingRadius: number;
}

/** A place a visitor must be able to stand: a doormat or a stall counter. */
export interface EntranceFact {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

/** One drawn path, sampled along its centre line. */
export interface RouteFact {
  readonly name: string;
  readonly length: number;
  /** Points every ~0.5 m along the centre line. */
  readonly points: readonly (readonly [number, number])[];
}

/** A ride's dismount point (GAME_DESIGN.md's EXIT rule) — a node in `PATH_GRAPH`. */
export interface ExitFact {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

/**
 * One node of the destination graph the network is grown from: somewhere a
 * child might actually be going.
 */
export interface PathNodeFact {
  readonly id: string;
  readonly kind: string;
  readonly x: number;
  readonly z: number;
  /**
   * How far the destination's own paving reaches out from that point. Zero for
   * every node but the plaza, which is a paved disc rather than a doorway, so
   * a ribbon arrives at it by touching its rim rather than its centre.
   */
  readonly reach: number;
}

/**
 * One edge of that graph, paired with the ribbon actually drawn for it.
 *
 * `from` and `to` are node ids, except for `'ring'`, which is `paths.ts`'s name
 * for the paved network itself: a spur branches off wherever the paving already
 * runs, which may be the backbone or an earlier spur.
 */
export interface PathEdgeFact {
  readonly name: string;
  readonly from: string;
  readonly to: string;
  /** The closed backbone loop, which has no ends to arrive anywhere. */
  readonly backbone: boolean;
  readonly halfWidth: number;
  /** The drawn centre line, every ~0.5 m. */
  readonly points: readonly (readonly [number, number])[];
}

/**
 * One duck bar on the race ring, and **what the race actually does at it.**
 *
 * Measured, never re-derived, and the two sides come from genuinely different
 * places — which is the whole point. `builtAt` is read off the bar's own
 * instance matrix **in the built scene**; `bonkAt`/`speedBefore`/`speedAt` come
 * from driving `stepRider` — the very function the browser calls sixty times a
 * second — against `scheduleForLevel`, the very call `RailRace.chooseLevel`
 * makes. Neither can be quietly satisfied by the other.
 *
 * It exists because the two used to disagree and nothing noticed. A bar renders
 * over its supporting trestle, which may have been nudged along the loop to
 * find clear ground; the physics bonked at the *unnudged* position it was
 * planned for. On the canonical seed that was 2.00 m on every bar, and Jim,
 * riding it: *"they slow down only after passing through it"*.
 */
export interface DuckBarFact {
  /** Metres from the arch, off the bar's own instance matrix. */
  readonly builtAt: number;
  /** Metres from the arch where the bonk actually fires, or null if it never does. */
  readonly bonkAt: number | null;
  /** Her speed entering the frame in which she first reaches `builtAt`. */
  readonly speedBefore: number;
  /** ...and leaving it. Equal to `speedBefore` means nothing happened at the bar. */
  readonly speedAt: number;
  /**
   * Her speed once she is {@link BAR_SPEED_SAMPLE} past the bar.
   *
   * The honest place to ask "has this bar cost her anything yet". Sampling
   * exactly *at* `builtAt` is a frame too early: `builtAt` is measured off an
   * instance matrix and can land a hair before the scheduled crossing, so a
   * correct ride is still at full speed on that one frame. A sample just past
   * the bar cannot be fooled that way, and is still nowhere near the 2.5 m of
   * lateness the original defect had.
   */
  readonly speedAfter: number;
  /** How far she travels during that frame — the finest resolution available. */
  readonly frameTravel: number;
}

/**
 * How far past a duck bar {@link DuckBarFact.speedAfter} is sampled, in metres.
 *
 * A shade over one frame's travel at the ride's top speed (33 m/s at 60 Hz is
 * 0.55 m), so the sample is never taken before the crossing it is asking about
 * — and a quarter of the 2.5 m by which the bonk used to land late, so a return
 * of that defect still reads as full speed here.
 */
const BAR_SPEED_SAMPLE = 0.6;


/** One lane's headroom under the finish rainbow, on one ring. */
export interface ArchClearanceFact {
  readonly ring: string;
  readonly lane: number;
  /** Top of a standing rider's head at the arch, in world metres. */
  readonly crownY: number;
  /** The lowest the rainbow gets directly over that lane, in world metres. */
  readonly rainbowY: number;
}

/**
 * How the race camera moves as a rider runs the built ring.
 *
 * **Measured by driving the real `RaceCamera`**, not by re-deriving where it
 * ought to stand: the rig is reset to each arc distance in turn and its world
 * position read off the camera object, which is the same object the renderer
 * draws through.
 *
 * The defect this exists to catch is geometric and was found on 6 August 2026.
 * The rig stands ~27.5 m out along the ring's normal; the ring's tightest bend
 * has a radius near 20 m. A point held a fixed distance out along a curve's
 * normal traces an offset curve of radius `R - offset`, so wherever the ring
 * bends towards the camera tighter than the rig stands out, that offset curve
 * **runs backwards** — the picture lurches the wrong way while the rider is
 * still going forwards. It is not damping-shaped and no half-life hides it.
 */
export interface CameraTrackingFact {
  /**
   * The least the camera moves *along the rider's direction of travel*, in
   * metres of camera per metre of rider. Negative means it went backwards.
   */
  readonly leastForwardProgress: number;
  /** Arc distance at which that happened, metres from the arch. */
  readonly worstAt: number;
  /**
   * The rider speed the worst reading was taken at, m/s.
   *
   * The ring is walked twice — at a standstill and at the speed the zoom stops
   * growing — because the rig's stand-off scales with the zoom and the zoom
   * scales with speed. Probing only the resting rig is what let this whole
   * invariant pass while the racing one ran backwards.
   */
  readonly worstSpeed: number;
  /** How many probes of {@link probes} ran backwards at all. */
  readonly backwardsProbes: number;
  /**
   * Probes at which the rig put the camera somewhere that is not a number.
   *
   * Always 0 in a healthy park, and separate from {@link backwardsProbes} on
   * purpose: a NaN loses every comparison it is asked, so it is *skipped* by a
   * running minimum rather than caught by one, and leaves a clean-looking
   * reading taken over however many probes survived.
   */
  readonly nonFiniteProbes: number;
  readonly probes: number;
  /** Greatest horizontal distance from camera to rider, metres. */
  readonly standOff: number;
}

export interface ParkFacts {
  readonly seed: number;
  readonly world: World;
  /**
   * Headroom under the finish rainbow, per ring per lane — see
   * {@link ArchClearanceFact}.
   *
   * Measured off the built arc's own vertices against a rider's real height,
   * because the thing it replaced was not measured at all: the old straight
   * finish beam used an invented 2.2 m of clearance and passed through every
   * rider on the ride, every lap, with nothing complaining.
   */
  readonly archClearance: readonly ArchClearanceFact[];
  /**
   * Every duck bar on the race ring, with what the race does at it — see
   * {@link DuckBarFact}. Empty is not a healthy answer: the ring always
   * schedules bars, and none in the built scene would itself be a bug.
   */
  readonly duckBars: readonly DuckBarFact[];
  /**
   * How smoothly the race camera actually tracks a rider round the built ring —
   * see {@link CameraTrackingFact}.
   */
  readonly cameraTracking: CameraTrackingFact;
  /**
   * The Sky Cruiser's pass through the castle (#113), measured by the *same*
   * functions the boot assert and `check:castle-window` use.
   *
   * Measured here rather than in the invariant because those functions live in
   * `src/` and read the castle's own placement, which is seed-dependent: a
   * static import from the test file would pull in a second copy of the park at
   * the default seed and quietly measure this seed's coaster against that one's
   * castle. Everything in this suite goes through the dynamic imports below for
   * exactly that reason.
   *
   * `windows` is empty on a seed whose loop went round the castle, which is a
   * healthy park and not a skipped test.
   */
  readonly castlePass: {
    readonly windows: readonly { readonly wall: string }[];
    readonly complaints: readonly string[];
  };
  /**
   * Everything the Sky Cruiser's car actually strikes, swept along the whole
   * loop against the whole park (#198).
   *
   * Measured here, with the same dynamic import every other seed-dependent
   * thing in this file uses: a static import would pull in a second copy of the
   * park at the default seed, and the four sweep seeds would then quietly
   * measure the canonical park instead of their own.
   *
   * **Empty is the healthy answer.** This is the same `cruiserStrikes` the
   * `check:cruiser-clearance` build gate runs, so there is one definition of
   * "does the ride hit anything" and it cannot drift between them.
   */
  readonly cruiserStrikes: readonly string[];
  readonly walls: readonly WallFact[];
  readonly trees: readonly TreeFact[];
  /** Every bush clump standing in the park. See {@link BushFact}. */
  readonly bushes: readonly BushFact[];
  /** The subset of {@link trees} a child is offered a climb on. */
  readonly climbableTrees: readonly ClimbableTreeFact[];
  readonly lamps: readonly (readonly [number, number])[];
  readonly plots: readonly PlotFact[];
  readonly entrances: readonly EntranceFact[];
  readonly routes: readonly RouteFact[];
  readonly exits: readonly ExitFact[];
  /** The destination graph `paths.ts` grows the network from. */
  readonly pathNodes: readonly PathNodeFact[];
  /** Its paved edges, each with the ribbon that was drawn for it. */
  readonly pathEdges: readonly PathEdgeFact[];
  /**
   * The ginormous slide's chute, in **world space**, sampled along what was
   * actually built — not the plan it was built from.
   *
   * Read through the scene graph rather than by adding the building's origin
   * back on by hand, so a slide parented to the wrong thing shows up here as a
   * slide in the wrong place, which is the class of bug #118 turned out to be.
   */
  readonly slideChute: readonly (readonly [number, number, number])[];
  /**
   * The castle facade's own footprint rectangle.
   *
   * Emphatically **not** the `building` plot's position: the facade is nudged
   * off its plot anchor by `BUILDING_CENTRE_NUDGE`, about 3.5 m, so the two
   * centres are metres apart. Measuring the tower at its plot's anchor puts the
   * walls in the wrong place and duly accuses an innocent slide of flying
   * through them — which is exactly what the first draft of this did.
   */
  /**
   * Where the ginormous slide's legs stand, and how tall each one is.
   *
   * A support plan that quietly places *nothing* is the failure mode worth
   * testing for here: it looks exactly like a healthy one from every angle
   * except the park's.
   */
  readonly slideLegs: readonly {
    readonly x: number;
    readonly z: number;
    readonly ground: number;
    readonly top: number;
  }[];
  readonly castleFootprint: {
    readonly x: number;
    readonly z: number;
    readonly halfX: number;
    readonly halfZ: number;
  };
  /**
   * The **top of the castle's stonework**, in world Y: the highest point of the
   * curtain wall and the battlements standing on it.
   *
   * Measured off the built meshes' world bounding boxes, not off
   * `CASTLE_WALL_HEIGHT + CASTLE_MERLON_HEIGHT`. Only the Y component of an
   * AABB is used, and for "how tall is the tallest stone" that component is
   * exact — the box's x/z extent is a gross over-approximation of a hollow ring
   * of wall and is deliberately not read.
   *
   * This replaced a `slideDoor` fact that reported where a hole in the south
   * wall was *planned*. No such hole is ever cut (see
   * `theGinormousSlideLeavesOverTheBattlements`), so the fact described nothing
   * in the park and the invariant reading it could not fail.
   */
  readonly castleMasonryTopY: number;
  /**
   * The castle's four corner towers, as the solids of revolution they were
   * actually built as, in **world space**.
   *
   * These are the piece of the castle a footprint rectangle does not contain:
   * they stand at `(±outerX, ±outerZ)` — outside the rectangle — and bulge a
   * further ~2.45 m past it. `slide/plan.ts` re-imposes the castle as that
   * rectangle, so the towers were the one solid nothing checked, which is
   * exactly where Jim found the slide clipping through.
   *
   * Read per instance via `getMatrixAt`: `Box3.setFromObject` on an
   * `InstancedMesh` returns the union of every instance — a single park-sized
   * box that any test passes trivially.
   *
   * Bodies and roofs only. The masts and finials above them start at 15.24 m,
   * higher than the chute's own 14.84 m start, and are a 0.09 m pole and a
   * 0.26 m ball — decoration rather than mass.
   */
  readonly castleTowers: readonly {
    readonly name: string;
    readonly x: number;
    readonly z: number;
    readonly bottomY: number;
    readonly topY: number;
    readonly radiusBottom: number;
    readonly radiusTop: number;
  }[];
  /** The space the built chute occupies around its centre line. */
  readonly chuteEnvelope: {
    readonly halfWidth: number;
    readonly above: number;
    readonly below: number;
  };
  /**
   * The chute sampled **without** the scene graph, beside the same points with
   * it — `pointAt` as the ride itself reads it, and where that lands in the
   * world.
   *
   * Everything that travels along the slide — the rider's seat, the grown-up,
   * and the teleport that puts a child on it — positions itself from
   * `pointAt` and is parented alongside the chute so that the two are the same
   * coordinates. If the chute is ever reparented without converting its points,
   * every one of those lands a castle's width away from the trough while the
   * chute itself still looks perfect. These two lists are what makes that
   * visible: at park level they are identical.
   */
  readonly slideRiderFrame: {
    readonly local: readonly (readonly [number, number, number])[];
    readonly world: readonly (readonly [number, number, number])[];
  };
  /**
   * **Where the ginormous slide actually puts a child down, and the pit that is
   * supposed to catch her.**
   *
   * Produced by calling the game's own `slideLandingSpot` on the **built**
   * chute's mouth and world tangent, then sampling the **built** walk surface
   * under the answer — so this is the runtime result reproduced, not a
   * paraphrase of it. The same tactic `railRaceExitFitsTheParty` uses when it
   * calls the real `resolveDismount` rather than modelling one.
   *
   * `groundY` comes from `WalkSurfaces.sample`, the sampler her own feet use,
   * and not from `terrainHeight`: the pit is scooped out of the hills and
   * `terrainHeight` is deliberately a pure function of the hills. A landing
   * measured against the wrong one of those two is out by `BALL_PIT_DEPTH`,
   * which is most of the headroom this is checking for.
   */
  /**
   * How much of the built chute is see-through, and how much solid, as vertex
   * counts off the two meshes actually in the scene (#228).
   *
   * A count rather than a flag: the failure worth catching is not "the feature
   * was removed", which a reviewer would see, but "the feature is silently
   * absent on one seed" — a chute shorter than a band period would build an
   * empty see-through mesh and look, from every angle except that seed's, like
   * a slide someone had simply decided to make opaque.
   */
  readonly slideChuteBands: { readonly solid: number; readonly clear: number };
  /**
   * **Where the ginormous slide's trackside cameras ended up on this seed, and
   * whether each can actually see the chute it was placed against.**
   *
   * `slide/cameras.ts` places them from the solved route, so on a procgen ride
   * they land somewhere different on every seed — which is exactly why this is
   * a fact rather than a constant somebody wrote down.
   *
   * **Not a copy of `check:slide-rider`, and the difference is the point.** That
   * check rides the canonical seed with a real `Player` and asks whether the
   * *rider* is visible and legible; this measures the *placement* on five seeds
   * against a point on the chute, with no rider in the park at all. One
   * observes a ride, the other measures where the cameras stand — different
   * questions, so two measurements rather than one asked to cover both.
   */
  readonly slideCameras: readonly {
    readonly beat: number;
    readonly eye: readonly [number, number, number];
    /** The point on the chute the eye was placed against. */
    readonly covers: readonly [number, number, number];
    /** The ground under the eye, so a camera buried in a hill is visible here. */
    readonly groundY: number;
    /** Sight-line samples across this beat, and how many were blocked. */
    readonly blocked: number;
    readonly samples: number;
    /** How near and far the chute gets from this eye across its own beat. */
    readonly nearest: number;
    readonly farthest: number;
  }[];
  /**
   * The shot plan as spans of the ride, in order — so "every part of the ride is
   * covered by some camera" is measurable as arithmetic on the built plan rather
   * than trusted to the loop that produced it.
   */
  readonly slideShotSpans: readonly {
    readonly kind: string;
    readonly from: number;
    readonly to: number;
  }[];
  readonly slideLanding: {
    readonly x: number;
    readonly z: number;
    readonly groundY: number;
    readonly pitX: number;
    readonly pitZ: number;
    readonly pitRadius: number;
  };
  /**
   * Pairs of plot ids the manifest deliberately puts close together, so the
   * overlap invariant can exempt exactly those and nothing else. See
   * `ManifestEntry.near` — "relations exist precisely to put things
   * deliberately close".
   */
  readonly nearPairs: ReadonlySet<string>;
  /** Distance from a point to the solved rail centre line. */
  /**
   * The park's own edge, off the **built** world (`collision.playBounds`).
   *
   * Not `boundary.ts`'s `PARK_BOUNDARY`. Importing that statically anywhere in
   * this test tree loads `parkManifest.ts` before `LGP_SEED` is set, pinning
   * every seed to the default park — the exact silent failure the seed guard
   * above exists to catch, and it does catch it. Anything seed-dependent
   * reaches an invariant through `ParkFacts`, never through a static import.
   */
  readonly boundary: ParkBoundary;
  /** Half the width the boundary masonry occupies, off `Garden.ts`. */
  readonly masonryHalfWidth: number;
  /** Half-thickness of the boundary wall as collision sees it, off `Garden.ts`. */
  readonly wallCollisionHalf: number;
  readonly distanceToRail: (x: number, z: number) => number;
  /** Can a walker of `radius` stand here without being pushed out? */
  readonly isStandable: (x: number, z: number, radius?: number) => boolean;
  /**
   * Can the real nav lattice actually route a child here from where she
   * starts? The same question `scripts/check-park.mts` asks of every
   * attraction, asked here of every ride's exit.
   */
  readonly reachableFromEntrance: (x: number, z: number) => boolean;
  readonly buildMs: number;
}

/** Key for {@link ParkFacts.nearPairs}, order-independent. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Builds the park for `seed` and reads the facts back off it.
 *
 * The seed reaches `parkManifest.ts` the only way it can — through
 * `LGP_SEED`, which that file reads once at module load — so everything below
 * is imported *dynamically*, after the variable is set. That in turn means
 * **each seed needs its own module registry**, which is why the seeds are one
 * test file each and why `vitest.config.ts` keeps `isolate` on. The guard
 * below exists because getting that wrong is silent: a stale module cache
 * would hand every seed the same park and six green suites would be measuring
 * one park six times.
 */
export async function buildParkFacts(seed: number): Promise<ParkFacts> {
  process.env['LGP_SEED'] = String(seed);

  const { buildHeadlessPark } = await import('../../scripts/park-harness.mts');
  const { PARK_SEED, PARK_MANIFEST } = await import('../../src/world/parkManifest.ts');

  if (PARK_SEED !== seed) {
    throw new Error(
      `parkFacts: asked for seed ${seed} but the park built with ${PARK_SEED}. ` +
        'The module registry was reused across seeds — check that vitest is ' +
        'still isolating test files (vitest.config.ts) and that each seed has ' +
        'a file of its own.',
    );
  }

  const { world, scene, buildMs, sample } = buildHeadlessPark();

  const { BOUNDARY_MASONRY_HALF_WIDTH, BOUNDARY_WALL_COLLISION_HALF } = await import(
    '../../src/world/Garden.ts'
  );
  const { PARK_LAYOUT } = await import('../../src/world/parkLayout.ts');
  const { ANCHORS } = await import('../../src/world/anchors.ts');
  const { PATH_GRAPH, PLAZA } = await import('../../src/world/paths.ts');
  const { CatmullRomCurve3 } = await import('three');
  const { NavGrid, MAX_ROUTE_WAYPOINTS } = await import('../../src/world/NavGrid.ts');
  const { PLAYER_RADIUS } = await import('../../src/core/constants.ts');
  const { CASTLE_WINDOWS, checkCastleWindows, sweptCartHits } = await import(
    '../../src/world/coaster/castleWindows.ts'
  );
  const { cruiserStrikes } = await import('../../src/world/coaster/clearance.ts');
  const { JUMP_APEX_HEIGHT } = await import('../../src/entities/Player.ts');
  const { ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z } = await import(
    '../../src/world/entrance/layout.ts'
  );

  const walls: WallFact[] = world.scenery.wallRuns.map((run) => ({
    from: run.from,
    to: run.to,
    halfWidth: run.halfWidth,
    piece: run.piece,
    kind: run.kind,
  }));

  const trees: TreeFact[] = world.scenery.foliageOccluders.map((tree) => {
    let footprint = 0;
    for (const part of tree.parts) {
      if (part.kind === 'trunk') continue;
      const offset = Math.hypot(part.position.x - tree.x, part.position.z - tree.z);
      const reach = offset + Math.max(part.scale.x, part.scale.z);
      if (reach > footprint) footprint = reach;
    }
    return { x: tree.x, z: tree.z, footprint };
  });

  const bushes: BushFact[] = world.scenery.bushes.map((bush) => ({
    x: bush.x,
    z: bush.z,
    radius: bush.radius,
  }));

  // Read off the same array `TreeClimbing` and every wander driver read, so
  // what the tests measure is what the game offers, not a re-derivation of the
  // rule that filled it.
  const climbableTrees: ClimbableTreeFact[] = world.scenery.climbableTrees.map((tree) => ({
    x: tree.x,
    z: tree.z,
    canopyTopY: tree.canopyTopY,
  }));

  const plots: PlotFact[] = [...PARK_LAYOUT.entries.values()].map((entry) => ({
    id: entry.id,
    x: entry.x,
    z: entry.z,
    boundingRadius: entry.boundingRadius,
  }));

  // The ginormous slide's chute, sampled off the built curve and pushed out
  // through the scene graph into world space.
  //
  // `updateMatrixWorld(true)` is called deliberately and is not a formality: a
  // headless park is never rendered, so nothing has otherwise composed a single
  // world matrix and every one of them is still the identity. Sampling without
  // this yields the chute's *local* coordinates while looking exactly like
  // world ones, and every clearance test built on them would quietly pass.
  const { BUILDING_CENTRE_X, BUILDING_CENTRE_Z } = await import(
    '../../src/world/building/layout.ts'
  );
  const { BUILDING_HALF_X, BUILDING_HALF_Z } = await import('../../src/core/constants.ts');
  const castleFootprint = {
    x: BUILDING_CENTRE_X,
    z: BUILDING_CENTRE_Z,
    halfX: BUILDING_HALF_X,
    halfZ: BUILDING_HALF_Z,
  };

  // Every world matrix must be composed before a single one is read: a headless
  // park is never rendered, so they are all still the identity otherwise, and a
  // clearance check built on them passes for free.
  scene.updateMatrixWorld(true);

  // The top of the castle's stonework, read off the built meshes.
  const { Box3 } = await import('three');
  let castleMasonryTopY = -Infinity;
  {
    const box = new Box3();
    scene.traverse((object) => {
      if (!/^(castle-wall-|crenellations$)/.test(object.name)) return;
      box.setFromObject(object);
      if (box.max.y > castleMasonryTopY) castleMasonryTopY = box.max.y;
    });
  }

  const { InstancedMesh: InstancedMeshClass, Matrix4 } = await import('three');
  const { CHUTE_ENVELOPE } = await import('../../src/world/building/SlideRide.ts');
  const castleTowers: {
    name: string; x: number; z: number;
    bottomY: number; topY: number; radiusBottom: number; radiusTop: number;
  }[] = [];
  scene.traverse((object) => {
    if (!(object instanceof InstancedMeshClass)) return;
    if (!/^tower-(bodies|roofs)$/.test(object.name)) return;
    const params = object.geometry.parameters as {
      radiusTop?: number; radiusBottom?: number; radius?: number; height: number;
    };
    // A cone reports `radius` (its base) and tapers to a point; a cylinder
    // reports both ends. Read whichever the built geometry carries.
    const radiusBottom = params.radiusBottom ?? params.radius ?? 0;
    const radiusTop = params.radiusTop ?? 0;
    const local = new Matrix4();
    const composed = new Matrix4();
    const centre = new Vector3();
    for (let i = 0; i < object.count; i += 1) {
      object.getMatrixAt(i, local);
      composed.multiplyMatrices(object.matrixWorld, local);
      centre.setFromMatrixPosition(composed);
      castleTowers.push({
        name: `${object.name}[${i}]`,
        x: centre.x,
        z: centre.z,
        bottomY: centre.y - params.height / 2,
        topY: centre.y + params.height / 2,
        radiusBottom,
        radiusTop,
      });
    }
  });

  const slide = world.building.ginormousSlide;
  slide.group.updateMatrixWorld(true);
  if (slide.group.parent) slide.group.parent.updateMatrixWorld(true);
  const slideChute: (readonly [number, number, number])[] = [];
  {
    const probe = new Vector3();
    const steps = Math.max(96, Math.round(slide.length / 0.4));
    for (let i = 0; i <= steps; i += 1) {
      slide.pointAt(i / steps, probe);
      slide.group.localToWorld(probe);
      slideChute.push([probe.x, probe.y, probe.z]);
    }
  }

  // The trackside cameras, and whether each can see the stretch of chute it was
  // stood beside. Measured with rays against the **built** chute and the built
  // castle, so a route that comes out a different shape on another seed cannot
  // quietly leave a camera looking at the back of a tower.
  const { Raycaster: RaycasterClass } = await import('three');
  // Dynamic, like everything else seed-dependent here: a static import would
  // pull in a second copy of the park at the default seed.
  const { terrainHeight } = await import('../../src/world/terrain.ts');
  const slideCameras: {
    beat: number;
    eye: readonly [number, number, number];
    covers: readonly [number, number, number];
    groundY: number;
    blocked: number;
    samples: number;
    nearest: number;
    farthest: number;
  }[] = [];
  const slideShotSpans = world.building.slideShots.shots.map((shot) => ({
    kind: shot.kind,
    from: shot.from,
    to: shot.to,
  }));
  {
    // Where a reclining rider's middle sits above the chute floor. Two numbers
    // from `Building` (`RIDER_LIFT` + `RECLINED_LIFT`); a sight line to the
    // trough floor itself would be a harder test than the game ever asks for.
    const RIDER_ABOVE_FLOOR = 0.24;
    const SAMPLES = 40;
    const caster = new RaycasterClass();
    const occluders = [slide.group, world.building.gardenRoot];
    const eye = new Vector3();
    const point = new Vector3();
    const tangent = new Vector3();
    const rider = new Vector3();
    const toRider = new Vector3();
    const up = new Vector3();
    const right = new Vector3();

    for (const [beat, shot] of world.building.slideShots.shots.entries()) {
      if (shot.kind !== 'trackside' || !shot.eye || !shot.covers) continue;
      eye.copy(shot.eye);
      let blocked = 0;
      let nearest = Infinity;
      let farthest = 0;
      for (let i = 0; i <= SAMPLES; i += 1) {
        const t = shot.from + ((shot.to - shot.from) * i) / SAMPLES;
        slide.pointAt(t, point);
        slide.tangentAt(t, tangent);
        // The chute's own frame, so "above the trough floor" leans with the
        // chute the way the trough itself does.
        right.crossVectors(tangent, new Vector3(0, 1, 0));
        if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
        right.normalize();
        up.crossVectors(right, tangent).normalize();
        rider.copy(point).addScaledVector(up, RIDER_ABOVE_FLOOR);

        toRider.copy(rider).sub(eye);
        const reach = toRider.length();
        nearest = Math.min(nearest, reach);
        farthest = Math.max(farthest, reach);
        if (reach < 1e-4) continue;
        caster.set(eye, toRider.normalize());
        // Stop short of the rider, so grazing the chute floor she lies on is
        // not counted as something standing in the way.
        caster.far = reach - 0.12;
        if (caster.intersectObjects(occluders, true).length > 0) blocked += 1;
      }
      slideCameras.push({
        beat,
        eye: [eye.x, eye.y, eye.z],
        covers: [shot.covers.x, shot.covers.y, shot.covers.z],
        groundY: terrainHeight(eye.x, eye.z),
        blocked,
        samples: SAMPLES + 1,
        nearest,
        farthest,
      });
    }
  }

  const slideRiderLocal: (readonly [number, number, number])[] = [];
  const slideRiderWorld: (readonly [number, number, number])[] = [];
  {
    const probe = new Vector3();
    for (let i = 0; i <= 12; i += 1) {
      slide.pointAt(i / 12, probe);
      slideRiderLocal.push([probe.x, probe.y, probe.z]);
      slide.group.localToWorld(probe);
      slideRiderWorld.push([probe.x, probe.y, probe.z]);
    }
  }

  // The two halves of the chute, off the built meshes rather than off the
  // constants that decided them.
  const slideChuteBands = (() => {
    const count = (name: string): number => {
      const mesh = slide.group.getObjectByName(name);
      const attribute =
        mesh && (mesh as { geometry?: { getAttribute(n: string): { count: number } | undefined } })
          .geometry;
      return attribute?.getAttribute('position')?.count ?? 0;
    };
    return { solid: count('ginormous-slide-chute'), clear: count('ginormous-slide-chute-clear') };
  })();

  // The landing, reproduced exactly as `Building.finishRide` computes it: the
  // built chute's mouth, the built chute's world tangent there, through the
  // game's own `slideLandingSpot`. Dynamic imports for the usual reason — a
  // static one of anything reaching `parkManifest` fixes the seed before the
  // harness has set `LGP_SEED`.
  const { slideLandingSpot } = await import('../../src/world/slide/landing.ts');
  // Dynamic because *this* one is seeded — `layout.ts` resolves a placement out
  // of the manifest at module load. `slide/landing.ts` above is not, on purpose.
  const { BALL_PIT_RADIUS, BALL_PIT_X, BALL_PIT_Z } = await import(
    '../../src/world/building/layout.ts'
  );
  const slideLanding = (() => {
    const mouth = slide.pointAt(1, new Vector3());
    slide.group.localToWorld(mouth);
    const heading = slide.tangentAt(1, new Vector3());
    slide.group.updateMatrixWorld(true);
    heading.transformDirection(slide.group.matrixWorld);
    const spot = slideLandingSpot(mouth.x, mouth.z, heading.x, heading.z, {
      x: BALL_PIT_X,
      z: BALL_PIT_Z,
      radius: BALL_PIT_RADIUS,
    });
    return {
      x: spot.x,
      z: spot.z,
      groundY: world.building.surfaces.sample(spot.x, spot.z, mouth.y),
      pitX: BALL_PIT_X,
      pitZ: BALL_PIT_Z,
      pitRadius: BALL_PIT_RADIUS,
    };
  })();

  const nearPairs = new Set<string>();
  for (const entry of PARK_MANIFEST) {
    if (entry.near) nearPairs.add(pairKey(entry.id, entry.near.id));
  }

  // Stall counters are read off the **built world's interact zones** — the
  // coordinates the game actually sends a child to, computed by the booths
  // themselves — rather than off `STALL_STANDS`.
  //
  // That distinction is the whole value of the fact, and it is measured, not
  // assumed. `paths.ts` now builds its stall nodes *from* `STALL_STANDS`, so an
  // invariant comparing the graph against that same table compares a source
  // with itself. Injecting a booth into the built world that never reaches the
  // table — the exact ferris-kiosk defect — the table-based form reported 19
  // passed and saw nothing; this form fails with the booth named. The interact
  // zones are also what `MiniGameStalls` and `FacePaintStall` each compute for
  // themselves, so this polices those two against the table as well.
  const entrances: EntranceFact[] = [
    ...ANCHORS.map((anchor) => ({
      id: `anchor:${anchor.id}`,
      x: anchor.entrance[0],
      z: anchor.entrance[1],
    })),
    ...world
      .interactZones()
      .filter((zone) => zone.id.startsWith('stall:'))
      .map((zone) => ({ id: zone.id, x: zone.standX, z: zone.standZ })),
  ];

  // The drawn ribbon, not the control points it was drawn from. `paths.ts`
  // sweeps a Catmull-Rom (tension 0.4) through those controls, and the curve
  // bows away from them — so where the paving actually runs, and where it
  // actually stops, is only visible on the sampled curve.
  const drawnCentreLine = (
    route: (typeof PATH_GRAPH.edges)[number]['route'],
  ): { length: number; points: [number, number][] } => {
    const curve = new CatmullRomCurve3(
      route.points.map(([x, z]) => new Vector3(x, 0, z)),
      route.closed,
      'catmullrom',
      0.4,
    );
    const length = curve.getLength();
    const steps = Math.max(8, Math.ceil(length / 0.5));
    const points: [number, number][] = [];
    for (let i = 0; i <= steps; i += 1) {
      const point = curve.getPointAt(i / steps);
      points.push([point.x, point.z]);
    }
    return { length, points };
  };

  // Read straight off the graph's paved edges rather than off `ROUTES`, which
  // is that same filter with the node ids thrown away: keeping them is what
  // lets an invariant ask whether a ribbon reached the destination it names.
  const paved = PATH_GRAPH.edges.filter((edge) => edge.paved);
  const drawn = paved.map((edge) => drawnCentreLine(edge.route));

  const pathEdges: PathEdgeFact[] = paved.map((edge, index) => ({
    name: edge.route.name,
    from: edge.from,
    to: edge.to,
    backbone: edge.route.closed,
    halfWidth: edge.route.width / 2,
    points: drawn[index]!.points,
  }));

  const pathNodes: PathNodeFact[] = PATH_GRAPH.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    x: node.x,
    z: node.z,
    reach: node.kind === 'plaza' ? PLAZA.radius : 0,
  }));

  const routes: RouteFact[] = paved.map((edge, index) => ({
    name: edge.route.name,
    length: drawn[index]!.length,
    points: drawn[index]!.points,
  }));

  // The *solved* curve, not the control points and not the corridor Scenery
  // planned against — those are what the fix used, so measuring them would
  // only restate the fix. `world.train.route` is what the train runs on, and
  // it exists whether the route is solved inside `ParkTrain` or handed to it
  // by a plan module.
  const route = world.train.route;
  const scratch = new Vector3();
  const distanceToRail = (x: number, z: number): number => {
    const point = route.pointAt(route.distanceNear(x, z), scratch);
    return Math.hypot(point.x - x, point.z - z);
  };

  const probe = new Vector3();
  const isStandable = (x: number, z: number, radius = 0.62): boolean => {
    probe.set(x, 0, z);
    world.collision.resolve(probe, radius);
    return Math.hypot(probe.x - x, probe.z - z) < 1e-3;
  };

  // Every ride's exit, straight off `PATH_GRAPH` — the same nodes `paths.ts`
  // gives a station or a stall's doormat, read back off the built graph
  // rather than off `coaster/plan.ts`/`ferrisWheel/exit.ts` directly, so this
  // measures what the graph actually contains rather than restating the plan
  // that was meant to produce it.
  const exits: ExitFact[] = pathNodes
    .filter((node) => node.kind === 'exit')
    .map((node) => ({ id: node.id, x: node.x, z: node.z }));

  // The real nav lattice, built exactly as `scripts/check-park.mts` builds
  // one and as `Game` itself does — the walker's own radius and jump apex —
  // so "reachable" here means what it means in play.
  const navGrid = new NavGrid(world.collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT);
  const routeBuffer = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);
  const reachableFromEntrance = (x: number, z: number): boolean => {
    const count = navGrid.findRoute(
      ENTRANCE_PLAYER_X,
      ENTRANCE_PLAYER_Z,
      x,
      z,
      sample,
      0,
      routeBuffer,
    );
    if (count === 0) return false;
    const endX = routeBuffer[(count - 1) * 2] ?? Infinity;
    const endZ = routeBuffer[(count - 1) * 2 + 1] ?? Infinity;
    return Math.hypot(endX - x, endZ - z) < 1.5;
  };

  const castlePass = {
    windows: CASTLE_WINDOWS,
    complaints: [
      ...checkCastleWindows(world.coaster.route, CASTLE_WINDOWS),
      ...sweptCartHits(world.coaster.route, world.building.gardenRoot),
    ],
  };

  // --- what the race really does at each duck bar --------------------------
  //
  // Dynamically imported like everything else seed-dependent here: `simulate.ts`
  // pulls in `railRace/plan.ts` at module scope, which reads the stall's own
  // placement out of `parkManifest.ts`, so a static import at the top of this
  // file would race this seed's rider against the default seed's ring.
  // `Matrix4` is aliased because the castle-tower block above this one already
  // holds that name in this same function scope. Aliased here rather than there
  // so the rename stays inside the rail-race block that introduced the clash.
  const { InstancedMesh: Instanced, Matrix4: Mat4, Mesh, Vector3: Vec3 } = await import('three');
  const { createRider, scheduleForLevel, stepRider } = await import(
    '../../src/world/railRace/simulate.ts'
  );
  const { BARS_FROM_LEVEL } = await import('../../src/world/railRace/hazards.ts');
  const { PLAYER_LANE: PLAYER } = await import('../../src/world/railRace/route.ts');

  const raceRoute = world.railRace.raceRoute;

  /**
   * Arc distance from the arch of the ring point nearest `(x, z)`.
   *
   * **Inverted against the path itself, not against a formula for it.** This
   * used to invert `angleAt(s) = -s / NOMINAL_RADIUS` in closed form, which was
   * exact while the ring was a circle and became meaningless the moment #216
   * made it follow the park boundary — `NOMINAL_RADIUS` is not even exported
   * any more, so the closed form silently produced `NaN` and every bar deduped
   * to a single phantom. Walking `route.path`'s own samples works for whatever
   * shape the ring is next, which is the point.
   *
   * The samples sit ~0.25 m apart, which is half the distance a rider covers in
   * a frame — too coarse to compare against on its own — so the nearest one is
   * refined by projecting onto the polyline either side of it. That lands well
   * inside a centimetre.
   */
  const archRelative = (x: number, z: number): number => {
    const samples = raceRoute.path.samples;
    let nearest = 0;
    let nearestD2 = Infinity;
    for (let i = 0; i < samples.length; i += 1) {
      const s = samples[i]!;
      const d2 = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
      if (d2 < nearestD2) {
        nearestD2 = d2;
        nearest = i;
      }
    }
    let bestAt = samples[nearest]!.at;
    let bestD2 = nearestD2;
    for (const step of [-1, 1]) {
      const a = samples[nearest]!;
      const b = samples[(nearest + step + samples.length) % samples.length]!;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const len2 = ex * ex + ez * ez;
      if (len2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / len2));
      const px = a.x + ex * t;
      const pz = a.z + ez * t;
      const d2 = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (d2 < bestD2) {
        bestD2 = d2;
        // `samples` are evenly spaced in arc length, so `t` interpolates it.
        bestAt = raceRoute.wrap(a.at + step * t * (raceRoute.length / samples.length));
      }
    }
    return raceRoute.wrap(bestAt - raceRoute.startDistance);
  };
  const raceRing = world.railRace.group.getObjectByName('railRace:race-ring');
  const barsMesh = raceRing?.getObjectByName('railRace:duck-bars');
  const builtBarDistances: number[] = [];
  if (barsMesh instanceof Instanced) {
    const matrix = new Mat4();
    const at = new Vec3();
    const seen = new Set<string>();
    for (let i = 0; i < barsMesh.count; i += 1) {
      barsMesh.getMatrixAt(i, matrix);
      at.setFromMatrixPosition(matrix);
      // The bar's real arc position, read off its own matrix rather than off
      // the rule that placed it. All four lanes of one bar share it, hence the
      // dedupe.
      const arch = archRelative(at.x, at.z);
      const key = arch.toFixed(2);
      if (seen.has(key)) continue;
      seen.add(key);
      builtBarDistances.push(arch);
    }
    builtBarDistances.sort((a, b) => a - b);
  }

  const duckBars: DuckBarFact[] = [];
  if (builtBarDistances.length > 0) {
    // A rider who mashes flat out and never ducks: the one who meets every bar.
    // `scheduleForLevel` is the very call `RailRace.chooseLevel` makes, so this
    // races the schedule the game races, not a second opinion about it.
    const schedule = scheduleForLevel(BARS_FROM_LEVEL);
    const rider = createRider(PLAYER);
    const dt = 1 / 60;
    const pending = new Map(
      builtBarDistances.map((builtAt) => [builtAt, { builtAt } as { builtAt: number } & Partial<DuckBarFact>]),
    );
    const bonks: number[] = [];
    let steps = 0;
    while (rider.travelled < raceRoute.length && steps < 60 * 400) {
      const before = rider.travelled;
      const speedBefore = rider.speed;
      const events = stepRider(raceRoute, rider, schedule, { pressed: true, ducking: false }, dt);
      if (events.bonked) bonks.push(rider.travelled);
      for (const [builtAt, row] of pending) {
        if (before <= builtAt && rider.travelled >= builtAt && row.speedAt === undefined) {
          Object.assign(row, {
            speedBefore,
            speedAt: rider.speed,
            frameTravel: rider.travelled - before,
          });
        }
        const sample = builtAt + BAR_SPEED_SAMPLE;
        if (before <= sample && rider.travelled >= sample && row.speedAfter === undefined) {
          Object.assign(row, { speedAfter: rider.speed });
        }
      }
      steps += 1;
    }
    for (const builtAt of builtBarDistances) {
      const row = pending.get(builtAt);
      // The bonk nearest this bar, whichever side of it it landed.
      let bonkAt: number | null = null;
      let nearest = Infinity;
      for (const bonk of bonks) {
        const d = Math.abs(bonk - builtAt);
        if (d < nearest) {
          nearest = d;
          bonkAt = bonk;
        }
      }
      duckBars.push({
        builtAt,
        bonkAt,
        speedBefore: row?.speedBefore ?? 0,
        speedAt: row?.speedAt ?? 0,
        speedAfter: row?.speedAfter ?? 0,
        frameTravel: row?.frameTravel ?? 0,
      });
    }
  }

  // --- how smoothly the camera tracks a rider round this ring ---------------
  //
  // Drives the real rig. `reset` is the ride's own "snap to this rider" call and
  // it runs the same private placement the per-frame `update` does, so this
  // measures the camera the renderer draws through rather than a model of it.
  //
  // **At the speed a child actually rides at, and that took three days to
  // matter.** This walked the ring through `reset(travelled)`, which pinned the
  // rig's zoom to 1 — its value on the start line and nowhere else. The shipping
  // camera reaches 1.34 within a second of the lights going out and holds it for
  // the rest of the race, and the zoom scales the stand-off, which is the exact
  // quantity a reversal is decided by. So the invariant passed at 0.094 while
  // the rig a child rides ran backwards over 2.67% of the lap: a guard measuring
  // a crawl-speed rig nobody is ever on.
  //
  // Both speeds are swept and the worse is kept, so neither the resting framing
  // nor the racing one can hide behind the other, and the ceiling that fixed
  // this (`RaceCamera.measureZoomCeiling`) cannot pass by simply refusing to
  // pull back at all — the resting rig would still have to clear the floor.
  const { RaceCamera, FULL_PULL_BACK_SPEED } = await import(
    '../../src/world/railRace/camera.ts'
  );
  const raceCamera = new RaceCamera(raceRoute);
  raceCamera.resize(1600, 900);
  // 0.25 m: the reversal is a sustained geometric effect spanning metres of
  // track, so this resolves it comfortably without walking the ring 12000 times
  // on each of five seeds.
  const CAMERA_PROBE_STEP = 0.25;
  const cameraProbes = Math.floor(raceRoute.length / CAMERA_PROBE_STEP);
  let leastForwardProgress = Infinity;
  let worstAt = 0;
  let worstSpeed = 0;
  let backwardsProbes = 0;
  let standOff = 0;
  // Probes the rig placed somewhere that is not a number. Counted rather than
  // folded into the reading below, because a NaN loses every `<` it is asked and
  // would otherwise be *skipped* — leaving a pristine-looking minimum taken over
  // whichever probes happened to survive. Not hypothetical: an
  // `Infinity - Infinity` in the zoom ceiling did exactly this while it was being
  // written, and silently dropped 1763 of 2400 probes.
  let nonFiniteProbes = 0;
  for (const probeSpeed of [0, FULL_PULL_BACK_SPEED]) {
    const cameraAt: { x: number; z: number }[] = [];
    for (let i = 0; i < cameraProbes; i += 1) {
      raceCamera.reset(i * CAMERA_PROBE_STEP, probeSpeed);
      const { x, z } = raceCamera.camera.position;
      cameraAt.push({ x, z });
      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        nonFiniteProbes += 1;
        continue;
      }
      const here = raceRoute.path.sampleAt(raceRoute.startDistance + i * CAMERA_PROBE_STEP);
      standOff = Math.max(standOff, Math.hypot(here.x - x, here.z - z));
    }
    for (let i = 0; i < cameraProbes; i += 1) {
      const s = i * CAMERA_PROBE_STEP;
      const here = raceRoute.path.sampleAt(raceRoute.startDistance + s);
      const a = cameraAt[i]!;
      const b = cameraAt[(i + 1) % cameraProbes]!;
      // The camera's own motion, projected on the way the rider is going.
      const forward =
        ((b.x - a.x) * here.tangentX + (b.z - a.z) * here.tangentZ) / CAMERA_PROBE_STEP;
      if (!Number.isFinite(forward)) continue;
      if (forward < 0) backwardsProbes += 1;
      if (forward < leastForwardProgress) {
        leastForwardProgress = forward;
        worstAt = s;
        worstSpeed = probeSpeed;
      }
    }
  }
  const cameraTracking: CameraTrackingFact = {
    leastForwardProgress: leastForwardProgress === Infinity ? 0 : leastForwardProgress,
    worstAt,
    worstSpeed,
    backwardsProbes,
    nonFiniteProbes,
    probes: cameraProbes * 2,
    standOff,
  };

  // --- headroom under the finish rainbow -----------------------------------
  const { RIDER_HEAD_TOP_AT_PARK_SCALE } = await import('../../src/world/railRace/hazards.ts');
  const archClearance: ArchClearanceFact[] = [];
  for (const [label, groupName, ringRoute] of [
    ['race', 'railRace:race-ring', world.railRace.raceRoute],
    ['walk-past', 'railRace:walk-past-ring', world.railRace.walkPastRoute],
  ] as const) {
    const group = world.railRace.group.getObjectByName(groupName);
    if (!group) continue;
    const start = ringRoute.startDistance;
    const sample = ringRoute.path.sampleAt(start);
    const outward = ringRoute.outwardAt(start, new Vec3());

    // Every rainbow vertex, reduced to (across the track, height).
    const band: { across: number; y: number }[] = [];
    const vertex = new Vec3();
    group.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      if (!child.name.startsWith('railRace:finish-rainbow')) return;
      const position = child.geometry.getAttribute('position');
      if (!position) return;
      child.updateWorldMatrix(true, false);
      for (let i = 0; i < position.count; i += 1) {
        vertex
          .set(position.getX(i), position.getY(i), position.getZ(i))
          .applyMatrix4(child.matrixWorld);
        band.push({
          across: (vertex.x - sample.x) * outward.x + (vertex.z - sample.z) * outward.z,
          y: vertex.y,
        });
      }
    });
    if (band.length === 0) continue;

    for (let lane = 0; lane < world.railRace.laneCount; lane += 1) {
      const laneAcross = ringRoute.laneOffsets[lane] ?? 0;
      const rail = ringRoute.pointAt(lane, start, new Vec3());
      let rainbowY = Infinity;
      for (const point of band) {
        // Directly over this lane, give or take the width of a child.
        if (Math.abs(point.across - laneAcross) > 1) continue;
        if (point.y < rainbowY) rainbowY = point.y;
      }
      archClearance.push({
        ring: label,
        lane,
        crownY: rail.y + RIDER_HEAD_TOP_AT_PARK_SCALE * ringRoute.scale,
        rainbowY,
      });
    }
  }

  return {
    archClearance,
    duckBars,
    cameraTracking,
    castlePass,
    cruiserStrikes: cruiserStrikes(world.coaster.route, world.coaster.group, [world.coaster.group]),
    seed,
    world,
    walls,
    trees,
    bushes,
    climbableTrees,
    lamps: world.lampPosts.positions.map((p) => [p.x, p.z] as const),
    plots,
    entrances,
    exits,
    pathNodes,
    pathEdges,
    slideChute,
    slideRiderFrame: { local: slideRiderLocal, world: slideRiderWorld },
    slideChuteBands,
    slideCameras,
    slideShotSpans,
    slideLanding,
    castleMasonryTopY,
    castleTowers,
    chuteEnvelope: CHUTE_ENVELOPE,
    slideLegs: world.building.slideLegs,
    castleFootprint,
    reachableFromEntrance,
    routes,
    nearPairs,
    boundary: world.collision.playBounds,
    masonryHalfWidth: BOUNDARY_MASONRY_HALF_WIDTH,
    wallCollisionHalf: BOUNDARY_WALL_COLLISION_HALF,
    distanceToRail,
    isStandable,
    buildMs,
  };
}

// ------------------------------------------------------------------ geometry

/** Closest approach between two segments. Zero if they cross. */
export function segmentDistance(
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
  return (
    side(b1, b2, a1) !== side(b1, b2, a2) && side(a1, a2, b1) !== side(a1, a2, b2)
  );
}

export function pointToSegment(
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

/** Samples along a run, for tests that need distance-to-a-curve. */
export function alongRun(
  from: readonly [number, number],
  to: readonly [number, number],
  spacing = 0.4,
): (readonly [number, number])[] {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(2, Math.ceil(length / spacing));
  const points: (readonly [number, number])[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
  }
  return points;
}
