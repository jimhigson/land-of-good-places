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
import { Box3, InstancedMesh, Mesh, Quaternion, Vector3 } from 'three';
import { measureGateArch } from '../../scripts/gate-arch-measure.mts';
import { createKid } from '../../src/art/models/kid.ts';
import { HAIR_STYLES } from '../../src/state/types.ts';
import { createCatBus } from '../../src/world/entrance/catBus.ts';
import type { World } from '../../src/world/World.ts';
import type { HeadlessPark } from '../../scripts/park-harness.mts';
import type { RailRaceRoute } from '../../src/world/railRace/route.ts';
import type { ParkBoundary } from '../../src/world/boundary.ts';
import type { Claim } from '../../src/boot/groundClaims.ts';
import type { RoadSegment } from '../../src/world/entrance/roadCorridor.ts';
import { boothBoxFor, type BoothBox } from '../../src/minigames/boothFootprint.ts';

/**
 * One side of one ring of a bridge's drawn parapet. See
 * {@link ParkFacts.bridgeParapetRings}.
 */
export interface BridgeParapetRing {
  /** Which bridge group it came off, so a failure names it. */
  readonly bridge: string;
  /** The wall's outer face in plan, and the height it was drawn to. */
  readonly outer: readonly [number, number];
  /** The wall's inner face in plan, at the same height. */
  readonly inner: readonly [number, number];
  /** World height of the parapet's drawn top here. */
  readonly top: number;
  /** How far that top stands over the terrain beside it. */
  readonly hump: number;
  /**
   * Whether a parapet is *supposed* to be standing here at all.
   *
   * False below `bridges.ts`'s `PARAPET_GONE_HUMP`, where `parapetHeightFor`
   * deletes the wall on purpose — a wing wall at a ramp foot severs the path
   * junction the foot lands in. Its absence there is correct geometry, and an
   * invariant counting it would be failing on a bridge that is right.
   */
  readonly expected: boolean;
}

/** One planted thing found standing in front of the arriving cat bus. */
export interface HidingFact {
  readonly x: number;
  readonly z: number;
  /** Its highest point, in world metres — what the grazing ray is cast from. */
  readonly top: number;
  /** Which `InstancedMesh` it came out of, so a failure names the population. */
  readonly what: string;
}

/** One planted thing found standing in the road the cat bus drives. */
export interface TreeInTheRoadFact {
  readonly x: number;
  readonly z: number;
  /** How far it spreads on the ground, in metres — its own instance scale. */
  readonly reach: number;
  /** How far that reach comes inside the corridor the bus sweeps. */
  readonly inside: number;
  /** Which `InstancedMesh` it came out of, so a failure names the population. */
  readonly what: string;
}

/**
 * One thing found standing in the journey lane's carriageway — the road the cat
 * bus drives up to the park on.
 */
export interface LaneObstructionFact {
  /** The scene node it came out of, so a failure names the population. */
  readonly node: string;
  /** Which instance, or -1 for a plain `Mesh`. */
  readonly instance: number;
  /** The world-space vertex that reaches furthest in. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** How far inside the carriageway edge that vertex sits, in metres. */
  readonly reach: number;
}

/**
 * One drawn thing in the journey lane, and where its geometry came from.
 *
 * **Identity, not shape.** `parkTreeGeometry` is non-null only when the node
 * draws *the very same* `BufferGeometry` object the park's own lawn draws. A
 * pixel-perfect copy of a lollipop tree, constructed locally, reads as `null`
 * here — and is meant to. What is being prevented is a second definition of a
 * tree, not an ugly one.
 */
export interface LaneGreeneryFact {
  /** The node's own name, or `''` for the anonymous meshes inside a group. */
  readonly node: string;
  /** Nearest named ancestor including itself — the population it belongs to. */
  readonly population: string;
  /**
   * **Every** named ancestor, innermost first, including the node itself.
   *
   * `population` alone was enough while the lane's furniture was built from
   * anonymous meshes inside one named group: the nearest name *was* the
   * declared population. An authored `.glb` names each of its own parts, so
   * the gate arch's five nodes started answering `gate-arch-piers`,
   * `gate-arch-band` and so on — five undeclared populations where there had
   * been one declared `journey-park-gate`, and the no-mystery-items guard
   * fired on a thing that is declared, by the name it is declared under, one
   * level further out.
   *
   * So the guard asks whether *any* of these is declared. That is exactly the
   * strength it had before — an undeclared new population has no declared
   * ancestor either — and it lets one line of `LANE_FURNITURE` cover the thing
   * it actually names.
   */
  readonly populations: readonly string[];
  /** Instances drawn, or 1 for a plain `Mesh`. */
  readonly instances: number;
  /** Which park foliage shape this is, by object identity, or `null`. */
  readonly parkTreeGeometry: 'trunk' | 'round' | 'cone' | null;
  /** The geometry's own type name, so a failure can say what it found. */
  readonly geometryType: string;
}

/**
 * One run of the arrival, from the first frame of the bus ride to the moment
 * the park takes the screen.
 */
export interface ArrivalRunFact {
  /** What this run was set up to reproduce, for the failure message. */
  readonly what: string;
  /** Did it end? The whole point. */
  readonly handedOver: boolean;
  /** Ride seconds at hand-over, or -1 if it never came. */
  readonly handOverSeconds: number;
  /** Ride seconds when the skip became available, or -1 if it never did. */
  readonly skipOfferedSeconds: number;
  /** Frames the run took before it ended or the ceiling stopped it. */
  readonly frames: number;
  /** Ride seconds simulated. */
  readonly seconds: number;
  /** The ceiling it was stopped at, if it was. */
  readonly ceilingSeconds: number;
  /** `JOURNEY_SECONDS` — carried here so the invariant never static-imports it. */
  readonly rideSeconds: number;
  /** The director's own account of itself at the end. */
  readonly finalState: string;
}

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
  /** The tree's foot, in the flat frame: `FoliageOccluder.footX`, never its drawn canopy centre. */
  readonly x: number;
  /** See {@link x}. */
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
  /** The real footprint's half-extents (axis-aligned; a circle reports its
   * radius for both) — what actually stands on the ground, where
   * `boundingRadius` over-approximates a rectangle by its diagonal. */
  readonly halfX: number;
  readonly halfZ: number;
  /**
   * The yaw the solver gave this plot's sign — every plot's, camera-facing
   * or not (`anchors.ts`'s `AnchorDefinition.signYaw` doc). Issue #269:
   * should be exactly `CAMERA_FACING_YAW` on every plot, on every seed.
   */
  readonly signYaw: number;
}

/** A place a visitor must be able to stand: a doormat or a stall counter. */
export interface EntranceFact {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

/**
 * **A stall, as it actually ended up** — where its booth is *drawn*, where the
 * game sends a child to be served, and what the registry says it owns.
 *
 * All three are read off the built park, never asked of the placement table:
 * the drawn spot comes off the booth group's own world matrix, the stand point
 * off the built interact zone, and the claims out of the registry. That is the
 * whole point of the fact — a booth may **step aside** during the world phase
 * (`world/stallsFeature.ts`), and the failure that matters is the one where
 * only some of those three moved.
 */
export interface StallFact {
  readonly id: string;
  /** The booth group's world position, off `matrixWorld`. */
  readonly drawnX: number;
  readonly drawnZ: number;
  /** Its body, from `boothFootprint.ts` — the one owner of every booth's box. */
  readonly box: BoothBox;
  /** Where the built interact zone sends a child to be served. */
  readonly standX: number;
  readonly standZ: number;
  /** How far this booth stepped aside during the world phase, in metres. */
  readonly steppedAside: number;
}

/**
 * The cat bus, measured off the built scene graph rather than asked for.
 *
 * Every number here is read back from world matrices after
 * `scene.updateMatrixWorld(true)`, so it describes a bus that is genuinely in
 * the park at a genuine place — not one that a constructor returned.
 */
export interface CatBusFact {
  /** Where the bus root actually sits, in world space. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** How many meshes hang off it. A bus with no geometry is not a bus. */
  readonly meshCount: number;
  /** Its world-space bounding box height, in metres. */
  readonly height: number;
  /** True if a driver was found seated in the cabin. */
  readonly hasDriver: boolean;
  /** Seats actually built on it. */
  readonly seatCount: number;
  /**
   * How far the worst of twelve seated children sticks out through the cabin,
   * and how deeply the worst pair overlap each other — both in metres, both
   * measured on real models in the real seats. Zero or less is a bus that fits
   * its passengers.
   */
  readonly worstOccupantProtrusion: number;
  readonly worstOccupantOverlap: number;
  /** The widest bare-headed child the park can build, for `CHILD_FOOTPRINT`. */
  readonly widestRealChild: number;
  /** How many disembarking children were found in the arrival's group. */
  readonly kidCount: number;
  /**
   * Where on the entrance road the arrival starts the bus — `entranceRoadAt(
   * entranceBusArriveAt())`, the sequence's own answer, so a test cannot drift
   * from it.
   *
   * **A fact rather than an import**, for the reason this file's header gives
   * and which cost this branch a red suite: `invariants.ts` reached for
   * `roadRoute.ts` directly, that module imports `world/boundary.ts`, and the
   * whole seeded manifest loaded at the test file's own module load — before
   * `buildParkFacts` had set `LGP_SEED`. Every non-canonical seed then built the
   * canonical park and threw, which is 4 failures and **328 silently skipped
   * tests**. Seed-dependent geometry is read from here, where the park has
   * already been built for the right seed.
   */
  readonly startsAtX: number;
  readonly startsAtZ: number;
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
  /** False when the destination already stood on the network (`paths.ts`'s
   * own "connectivity fact, not a ribbon" edges) — no ribbon was drawn, but
   * the short walk it represents is real. Always `true` in {@link
   * ParkFacts.pathEdges}, which is paved-only; present so an invariant that
   * wants the *full* connectivity graph — {@link
   * ParkFacts.pathConnectivityEdges} — can tell the two kinds of edge apart. */
  readonly paved: boolean;
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
 * One straight leg carrying the finish rainbow down to the ground, as built.
 *
 * Jim, 7 August 2026: *"make the rainbow extend all the way to the floor with
 * straight sections, not just float in space"*. Everything here is read off the
 * leg's own world-space bounding box and the terrain function the game itself
 * uses, so the invariant measures the arch that was built rather than the
 * arithmetic that placed it.
 */
export interface ArchLegFact {
  readonly ring: string;
  readonly name: string;
  /** Which rainbow band this leg continues, inner band 0 outwards. */
  readonly band: number;
  /** Which side of the track it comes down: park side, or out on the rim. */
  readonly side: 'inner' | 'outer';
  readonly x: number;
  readonly z: number;
  /** Lowest vertex of the leg, world metres. */
  readonly bottomY: number;
  /** Highest vertex of the leg, world metres. */
  readonly topY: number;
  /** Lowest vertex of the arc band this leg belongs to, world metres. */
  readonly arcFootY: number;
  /** The **lowest** terrain anywhere under the leg's own footprint. */
  readonly groundY: number;
  readonly distanceToPath: number;
  readonly distanceToRail: number;
  readonly clearOfPlots: boolean;
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

/**
 * **Paving one bridge has lifted clear of the ground, measured against that
 * bridge's own built masonry** (issue #349).
 *
 * Measured here rather than in an invariant for the ordinary reason: deciding
 * whether a vertex was genuinely *lifted* needs `terrainHeight`, which reaches
 * `parkManifest` through `boundary.ts` and so can only be imported
 * dynamically, after the seed is fixed — an invariant is synchronous and a
 * static import of it there is the 76-silent-skips trap.
 *
 * **Why "lifted clear of the ground" and not "inside the plan footprint".**
 * `pavingHeightAt` pads its `covers()` test along the spine as well as across
 * it, so it legitimately claims paving a metre or so past the end of the
 * masonry at each ramp foot — where `heightAt` has already clamped the hump
 * back down to the terrain, so the paving is lying on the ground exactly as it
 * should. Judging every claimed vertex against the plan outline reports 1.27 m
 * of "overhang" there and would have to be fudged to go green. The defect
 * issue #349 is actually about is paving held up *in mid-air* with no stone
 * under it, so that is what this measures: a vertex counts only once it stands
 * clear of the ground beneath it.
 */
export interface BridgePavingFact {
  /** The built bridge group's own name, `bridge-<railDistance>`. */
  readonly name: string;
  /** Drawn-path vertices this bridge lifts clear of the ground under them. */
  readonly liftedClearOfGround: number;
  /** How many of those have no masonry beneath them in plan. */
  readonly unsupported: number;
  /**
   * How far the worst unsupported vertex lies outside this bridge's own
   * masonry outline, in metres of plan distance. Zero on a healthy park.
   */
  readonly worstOverhang: number;
  /** Where that vertex is, `[x, y, z]`. */
  readonly worstAt: readonly [number, number, number];
  /** How far it stands above the terrain beneath it, metres. */
  readonly worstAboveGround: number;
  /** Which drawn layer it belongs to — `path-surface` or `path-kerb`. */
  readonly worstLayer: string;
}

/**
 * **The entrance road, as claimed and as drawn** — see
 * `src/world/entrance/roadCorridor.ts`, which is the one owner of both.
 *
 * Gathered here rather than imported by `invariants.ts` because the owner
 * reaches `world/boundary.ts`, whose `PARK_BOUNDARY` is generated from
 * `PARK_SEED` at module scope. A static import of it into a test file would
 * load `parkManifest.ts` before the seed was set and pin every seed to the
 * canonical park — the 76-silent-skips disease this file's header warns
 * about. Read after `buildHeadlessPark()`, it is a fact about *this* seed.
 */
export interface RoadCorridorFacts {
  /** The feature name the road's ground is committed under. */
  readonly feature: string;
  /** What the built park's registry actually holds for it. */
  readonly claimed: readonly Claim[];
  /** What the owner returns, asked again right now. These must agree exactly. */
  readonly fromOwner: readonly Claim[];
  /** The runs of centreline, in the owner's own order — index-matched to both. */
  readonly segments: readonly RoadSegment[];
}

/**
 * **A castle corner turret, as the solid it publishes.** See
 * `src/world/building/layout.ts`'s `CASTLE_TOWERS`.
 *
 * Gathered here rather than imported by `invariants.ts` because the towers'
 * world position comes from `BUILDING_CENTRE_X/Z`, which is derived from
 * `placedEntry('building')` and so is a function of the seed. A static value
 * import of `layout.ts` into a test file would load `parkManifest.ts` before
 * the seed was set and pin every seed to the canonical park — the
 * 76-silent-skips disease this file's header warns about.
 */
export interface CastleTurretFact {
  readonly name: string;
  readonly x: number;
  readonly z: number;
  /** The drawn shaft's radius at its foot — the widest a child can reach. */
  readonly radiusBottom: number;
}

/**
 * The furthest drawn outdoor vertex from the park's centre, measured as chart
 * distance `hypot(x, z)` — the quantity `terrainHeight`'s cap runs out of at
 * `GROUND_SPHERE_RADIUS`.
 *
 * **What it covers**: every object in the built `scene` carrying a `position`
 * attribute (meshes, instanced meshes per instance, points, lines, sprites),
 * every vertex, transformed to world space. **What it does not**: the subtrees
 * named in {@link excludedRoots} (the castle's and hotel's interiors, which
 * stand hundreds of metres from the garden by design), and anything not in
 * this scene — the bus journey's own `lane.scene`, and whatever is only added
 * once a frame runs. The invariant prints this on every run.
 */
export interface DrawnReachFact {
  /** Chart distance of the furthest vertex, metres. */
  readonly radius: number;
  /** Scene path of the object that vertex belongs to, leaf first. */
  readonly furthest: string;
  readonly vertices: number;
  readonly objects: number;
  readonly excludedRoots: readonly string[];
}

/**
 * **One Rail Race ring's supports, as the registry holds them and as they were
 * drawn** — stage 3, step 2: the trestle legs are `footprint` claims.
 *
 * `fromDrawn` is rebuilt from the instance buffers of the three trestle meshes
 * (`railRace:trestle-legs`, `-branches-lower`, `-branches-upper`), pairing each
 * trunk with its two lower and four upper branches by the index order
 * `track.ts` draws them in, and run through `track.ts`'s own `trestleClaims` —
 * the one function the search asked with and the builder committed. Gathered
 * here, after the world is built, for the reason `RoadCorridorFacts` is:
 * `track.ts` reaches `parkLayout.ts`, and a static import of it into a test
 * file would pin every seed to the canonical park.
 */
export interface RailRaceSupportFacts {
  readonly label: 'walk-past' | 'race';
  /** The feature name the ring committed under — its group name. */
  readonly feature: string;
  /** What the built park's registry actually holds for it. */
  readonly claimed: readonly Claim[];
  /** The same claims, rebuilt from the drawn struts through the one owner. */
  readonly fromDrawn: readonly Claim[];
  /** How many drawn struts (trunks and branches) went into `fromDrawn`. */
  readonly struts: number;
  /** One entry per drawn trunk: how far its foot stands from under its top, and how tall it is. */
  readonly trees: readonly {
    readonly footX: number;
    readonly footZ: number;
    readonly lean: number;
    readonly trunkHeight: number;
  }[];
}

export interface ParkFacts {
  /** The seed asked for — the park's identity. */
  readonly seed: number;
  /** Which start-again of that seed this is (`src/world/parkRestart.ts`); 0 is the seed's own park. */
  readonly restart: number;
  readonly world: World;
  /** The harness's own handle on the park — what `check:park`'s measures take. */
  readonly headless: HeadlessPark;
  /** The entrance road's corridor, claimed and drawn — see {@link RoadCorridorFacts}. */
  readonly roadCorridor: RoadCorridorFacts;
  /** The castle's four corner turrets — see {@link CastleTurretFact}. */
  readonly castleTurrets: readonly CastleTurretFact[];
  /** Each Rail Race ring's supports, claimed and drawn — see {@link RailRaceSupportFacts}. */
  readonly railRaceSupports: readonly RailRaceSupportFacts[];
  /**
   * The run the cat bus actually drives, sampled: from where its body first
   * appears to where it vanishes along the road's own arc
   * (`entranceBusArriveAt()` to `entranceBusVanishAt()`, half a bus beyond
   * each), a point every `PLAYER_RADIUS` at the bus's centre line and both
   * sides, each with the road's facing there. Read from the arrival's own
   * owners (`entrance/roadRoute.ts`, `entrance/catBus.ts`), never restated, so
   * an invariant can ask whether the road's corridor claim covers every metre
   * of it. Chart coordinates, like the claims.
   */
  readonly busRun: {
    readonly samples: readonly { readonly x: number; readonly z: number }[];
    /** Metres of arc sampled, for the coverage line. */
    readonly length: number;
    readonly halfWidth: number;
  };
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
   * Every straight leg carrying the finish rainbow down to the ground — see
   * {@link ArchLegFact}. Empty means the rainbow is floating in the sky again,
   * which is the whole of what Jim asked to have fixed, so the invariant treats
   * an empty list as a failure rather than as nothing to check.
   */
  readonly archLegs: readonly ArchLegFact[];
  /**
   * Both Rail Race rings' finish-arch feet — every post the walk network
   * treats as a blocker (`paths.ts`'s `BLOCKERS`), including the walk-past
   * ring's, whose arch is not drawn (`showArch`, #299) and so never appears
   * in {@link archLegs}. Read off the ride's own solved rings via the same
   * `archFeet()` the game uses, so an invariant asking "could a street have
   * stood here?" sees the same ground the router did.
   */
  readonly railRaceArchFeet: readonly { x: number; z: number; radius: number }[];
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
  /**
   * How high the Sky Cruiser's rail stands above the terrain beneath it, in
   * metres, sampled every 1 m along the built loop — index `i` is the height
   * at route distance `i`. For `coaster/pylons.ts`'s own `skyCruiserStandsOnItsOwnSupports`
   * invariant: a stretch of track close enough to the ground needs no post
   * (`pylons.ts`'s `MIN_PYLON_HEIGHT` — "below this the track is close enough
   * to the ground that a post is clutter"), and that is exactly the shape of
   * the boarding dip at the station, where the loop closes. An invariant that
   * only excuses a gap for standing over a plot or near a path would
   * misread that dip as unexplained floating track.
   *
   * Sampled here, with the dynamic `terrainHeight` import every other
   * seed-dependent thing in this file already uses (see this interface's own
   * header) — a static import would pull in a second copy of the park at the
   * default seed.
   */
  readonly cruiserRouteGroundClearance: readonly number[];
  /**
   * **The top of every Sky Cruiser pylon as it is drawn, mapped back to the
   * flat frame the route was planned in.**
   *
   * `Coaster.ts` stands each pylon from the foot the planner found to the
   * track's *drawn* top — `placeOnSphere` of the flat top — so the post leans
   * with the planet, which is how it reaches the thing it carries. The route
   * an invariant compares it against (`coaster.route`) is the **flat** plan.
   * Read the drawn top straight against that plan and the lean itself reads as
   * error: `height · sin(tilt)`, which on the canonical seed is **2.94 m** of
   * pure bookkeeping on a pylon whose real gap to its track is **0.034 m**.
   *
   * So every top goes through `unplaceFromSphere` here — the exact inverse of
   * the lean, the same treatment {@link RailRaceSupportFacts} already gives the
   * Rail Race's drawn struts, and for the same reason. Measured off the built
   * instance buffer, never re-derived from `pylons.ts`: the whole point of
   * these two invariants is to catch a post that does not arrive.
   */
  readonly cruiserPylonTops: readonly { readonly x: number; readonly y: number; readonly z: number }[];
  readonly walls: readonly WallFact[];
  readonly trees: readonly TreeFact[];
  /** Every bush clump standing in the park. See {@link BushFact}. */
  readonly bushes: readonly BushFact[];
  /** The subset of {@link trees} a child is offered a climb on. */
  readonly climbableTrees: readonly ClimbableTreeFact[];
  readonly lamps: readonly (readonly [number, number])[];
  /**
   * The fairy-light rig round the plaza, **counted off the drawn scene** —
   * the `fairy-pole-*` and `fairy-string-*` meshes `FairyLights.ts` actually
   * put in the world, not the decision list the builder produced.
   *
   * It is counted rather than re-derived because the bug it exists for was
   * invisible to every other kind of check: the ring's radius had drifted onto
   * the main loop's paving, every pole was legitimately skipped for standing
   * on a path, and the park drew **none at all** — a correct generator
   * producing nothing, which no rule-reading assertion could have seen.
   *
   * `strings` matters on its own: a pole with no neighbour carries no cable
   * and no bulbs, so poles alone do not mean a child sees any lights.
   */
  readonly fairyLights: { readonly poles: number; readonly strings: number };
  /**
   * The early, conservative reservation `bridgeKeepout.ts` computes for
   * every railway crossing (`train/bridgeFootprint.ts`'s `planConservative`
   * — the same thing `Scenery.ts` and `LampPosts.ts` both ask
   * `isInBridgeFootprint` about before planting), re-derived here rather
   * than imported statically at this file's own top level for the same
   * seed-pinning reason `everyBridgeIsWalkableAndReachable` avoids a static
   * import of `bridgeFootprint.ts` (see that invariant's own header).
   *
   * Exists so `everyPathIsLit` can tell a genuinely explained dark stretch
   * — one standing inside ground a bridge's own ramp legitimately needs,
   * where nothing could ever have planted a lamp — from an ordinary gap a
   * scatter generator merely failed to fill. (Ported from the sibling
   * `bridge-backtrack` fix, commit 76285e3, whose reservation-based
   * reasoning is broader than "a built bridge covers it": the keepout
   * excludes lamp ground at level crossings too.)
   */
  readonly bridgeReservations: readonly (null | {
    covers(x: number, z: number, margin?: number): boolean;
  })[];
  /**
   * **Where `train/crossingPlanSolve.ts` proved, before a single path was
   * drawn, that a real bridge fits** — `CROSSING_SITES`, by rail distance.
   *
   * The plan is a *proof obligation*, not a placement rule, which is why
   * reading it here does not break this file's "measure the park, never the
   * rules that built it" law: the planner marched the built loop against the
   * built layout and asserted a bridge is buildable at each of these
   * distances. An invariant may therefore hold the built park to it — a
   * crossing standing on one of these and carrying no bridge is a promise
   * the park broke, not a rule it was merely supposed to follow.
   *
   * Dynamically imported with everything else here, after the seed is fixed.
   */
  readonly plannedBridgeSiteDistances: readonly number[];
  /**
   * One entry per built bridge: how far the paving it lifts hangs past its
   * own masonry. See {@link BridgePavingFact}.
   */
  readonly bridgePaving: readonly BridgePavingFact[];
  /**
   * **Every ring of every bridge's drawn parapet, as the sweep really laid it
   * out** — for the see-through probe behind issue #489.
   *
   * Read straight off the built `wallTop` mesh, which `buildShellGeometry`
   * writes four vertices per ring (`copingOuter[+], copingOuter[−],
   * copingInner[+], copingInner[−]`), so each entry is one side of one ring:
   * where the wall's outer face is in plan, where its inner face is, and the
   * height of the top it was actually drawn to.
   *
   * `hump` is the drawn top's height over the terrain beside it, and it is
   * sampled here rather than in the invariant because `terrainHeight` reaches
   * `parkManifest` through `boundary.ts` — a static import of it into the test
   * tree pins every seed to the default park, which is this file's own standing
   * trap. {@link BridgeParapetRing.expected} folds that into the one question
   * an invariant wants to ask, using `bridges.ts`'s own `PARAPET_GONE_HUMP`
   * rather than a threshold restated here.
   */
  readonly bridgeParapetRings: readonly BridgeParapetRing[];
  /**
   * **How tall a bridge parapet is at its very tallest**, metres —
   * `bridges.ts`'s own `PARAPET_HEIGHT + PARAPET_CROWN_LIFT`, carried here so
   * an invariant probing a parapet knows where the parapet *stops*.
   *
   * It exists because `noBridgeParapetCanBeSeenThrough` used to probe a
   * hand-typed 1.5 m below the wall top — **0.33 m below the bottom of a
   * 1.17 m wall**. Everything it found in that overshoot was the spandrel and
   * deck edge under the parapet, which is not what the clause is about, and
   * which the bend moved. Measured across the five failing seeds: every single
   * reported hole sat at drop 1.38-1.48 m and **every one was below the wall's
   * own height**, while at or above the wall bottom there were **0 misses in
   * 32,292 judged samples**. A datum standing in for a quantity it does not
   * describe, exactly as CLAUDE.md warns.
   */
  readonly maxParapetHeight: number;
  /**
   * **Drawn paths whose own END stands in the air on a bridge** — issue #414,
   * Jim's *"there is also a path that runs into the side of the bridge —
   * basically runs into a solid wall"*.
   *
   * A drawn route's centreline has two ends. One of them landing on a bridge's
   * paving, well above the terrain under it, means a path stops dead partway
   * up a ramp or on the deck: a child walking it arrives at masonry with
   * nowhere to go. It is *not* the same fact as
   * {@link BridgePavingFact} — that asks whether lifted paving has stone under
   * it (#349, paving in mid-air); this asks whether a path **terminates**
   * somewhere she cannot continue from, which is true even when the paving
   * beneath her is perfectly well supported.
   *
   * A path end at a ramp *foot* is entirely correct and must not be reported:
   * the hump has clamped back to the terrain there, so the lift is
   * essentially zero and the path simply joins the ground. The threshold is
   * therefore a real height, not a footprint test — see the invariant.
   *
   * Measured here rather than in the invariant for the usual reason: it needs
   * `terrainHeight`, which reaches `parkManifest` through `boundary.ts` and so
   * can only be imported dynamically, after the seed is fixed.
   */
  readonly strandedPathEnds: readonly {
    /** Which drawn route (`paths.ts`'s own route name, e.g. `spur-dodgems`). */
    readonly route: string;
    /** The end that is stranded, `[x, z]`. */
    readonly at: readonly [number, number];
    /** How far the bridge holds the paving above the terrain there, metres. */
    readonly aboveGround: number;
    /** The bridge group's own name, `bridge-<railDistance>`. */
    readonly bridge: string;
  }[];
  /** `crossings.ts`'s `SITE_SNAP_TOLERANCE` — how far a measured crossing may
   * sit from a planned site and still *be* that site. Carried rather than
   * restated: a hand-copied threshold whose comment promises it matches is
   * this repo's most-repeated bug. */
  readonly crossingSiteSnapTolerance: number;
  readonly plots: readonly PlotFact[];
  readonly entrances: readonly EntranceFact[];
  /** Every stall, as built — see {@link StallFact}. */
  readonly stalls: readonly StallFact[];
  /**
   * Stalls that could not be measured at all, with why. A booth with no group
   * in the scene or no interact zone cannot be held to anything below, so it
   * is named here rather than leaving a shorter list to imply cover it does
   * not give.
   */
  readonly stallsMissing: readonly string[];
  /**
   * The keychain rack's six keyring stand points, specifically — **not**
   * included in {@link entrances} above.
   *
   * `KeychainShop.interactZones()` returns *either* the cart's one entry zone
   * *or* the six per-keyring zones, never both (they sit on the same small
   * cart, and a snapshot holding both would fail `check:tap-spacing` outright
   * — see `world/KeychainShop.ts`'s own header). `entrances` is built from
   * `world.interactZones()` in the shop's ordinary, closed, default state, so
   * it only ever carries the one `stall:keychain` entry — same as every other
   * stall gets one `stall:` entrance. This field opens the view for one
   * extra read, the same way `scripts/check-tap-spacing.mts` moves its probe
   * player between hotel rooms to see each one's own zones in turn, so the
   * six real stand points a child reaches once inside stay checked.
   */
  readonly keychainKeyringEntrances: readonly EntranceFact[];
  /**
   * **The cat bus, as actually found in the built scene graph.** `null` if
   * there is no node named `cat-bus` anywhere in it.
   *
   * Read by traversing the real `Scene` rather than by asking the entrance
   * whether it made one, and that distinction is the entire point of this
   * field. The arrival shipped in PR #27 on 26 July 2026 and never once ran:
   * six new files, zero call sites, `Entrance` never constructed, and the
   * string `cat-bus` absent from the shipped bundle altogether. Every check in
   * the repo stayed green for twelve days because none of them looked at
   * whether the thing was *there*.
   *
   * So this looks. If the wiring from `World` to `Entrance` to
   * `ArrivalSequence` is broken anywhere along its length, or the bus is built
   * but never added to a group that reaches the scene, this goes `null` and
   * `theCatBusIsInThePark` fails.
   */
  readonly catBus: CatBusFact | null;
  /**
   * **Every planted thing standing between the camera and the arriving bus.**
   *
   * Gathered by walking the `foliage` and `treeline` groups' own
   * `InstancedMesh`es in the built scene and reading **instance matrices** —
   * not by re-running the scatter's own rules, and not from a list the
   * generator kept. The distinction earned its keep twice on this feature
   * already: a guard that asks the builder what it intended stays green while
   * the park shows something else, and a crowd child's rig is a detached proxy
   * so scene *attachment* proves nothing either. What reaches the screen is an
   * instance matrix, so an instance matrix is what is measured.
   *
   * Empty is the healthy state. Each entry is a thing a child would see the bus
   * from behind.
   */
  readonly hidingTheArrivingBus: readonly HidingFact[];
  /**
   * **Every planted thing standing in the road the cat bus drives**, measured
   * the same way and for the same reason as {@link hidingTheArrivingBus}: off
   * the built scene's instance matrices, never off the scatter's own rules.
   *
   * Empty is the healthy state. Before the keep-out went in this was 64 to 106
   * entries a seed.
   */
  readonly treesInTheBusRoad: readonly TreeInTheRoadFact[];
  /** How many treeline/foliage instances were examined to fill it. */
  readonly plantedInstancesSwept: number;
  /**
   * **Everything standing in the journey lane's carriageway**, measured off the
   * built `BusJourney` scene in world space.
   *
   * Real vertices through real instance matrices, never the scatter's own rules
   * — the whole bug was a scatter whose rules said one thing and whose output
   * did another.
   */
  readonly laneCarriageway: readonly LaneObstructionFact[];
  /**
   * **Everything the journey lane draws, and whose geometry it is** — the
   * measurement behind `nothing grows in the lane but the park's own trees`.
   */
  readonly laneGreenery: readonly LaneGreeneryFact[];
  /**
   * `road.ts`'s `ROAD_HALF_WIDTH`, carried on the facts for the same reason
   * every other number here is: an invariant that static-imports a `src/`
   * module pins every seed to the default park.
   */
  readonly laneRoadHalfWidth: number;
  /**
   * **The arrival, run to its end.** Twice: once with the park arriving on
   * time, once with it arriving long after the ride is over.
   */
  readonly arrivalRuns: {
    readonly onTime: ArrivalRunFact;
    readonly overrun: ArrivalRunFact;
  };
  readonly routes: readonly RouteFact[];
  readonly exits: readonly ExitFact[];
  /** The destination graph `paths.ts` grows the network from. */
  readonly pathNodes: readonly PathNodeFact[];
  /** Its paved edges, each with the ribbon that was drawn for it. */
  readonly pathEdges: readonly PathEdgeFact[];
  /** Every edge in the graph, paved or not — see {@link PathEdgeFact.paved}. */
  readonly pathConnectivityEdges: readonly PathEdgeFact[];
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
   * The **top of the castle's stonework, as a radius from the planet's
   * centre**: the highest point of the curtain wall and the battlements
   * standing on it, measured the way the world is actually shaped.
   *
   * Metres from the planet centre. Compare it only against another radius —
   * never against a world `y`, which is the very mix this field was created to
   * end. Subtract `geo.PLANET_RADIUS` if you want a number to *print*, and do
   * that only in a message.
   *
   * ## Why this is a radius and not a `max.y` (issue #625)
   *
   * It *was* an AABB's `max.y`, and that was wrong by **2.710 m** in the
   * dangerous direction. The world is a sphere of radius `GROUND_SPHERE_RADIUS`,
   * "up" is away from its centre, and the castle stands ~48 m out from the
   * park's origin — so the castle **leans**, and a plumb line dropped down world
   * `+Y` is not its own up. Measured on the canonical seed:
   *
   * | | |
   * |---|---|
   * | AABB `max.y` (what this used to report) | 8.040 m |
   * | highest stonework by radius, a merlon at world (35.52, 7.08, 20.40) | 10.750 m |
   * | under-report | **2.710 m** |
   *
   * That is `RADIAL-INVENTORY.md`'s first universal mistake exactly — *a `y`
   * difference standing in for a distance* — and it granted the ginormous
   * slide 2.71 m of clearance the battlements do not give it.
   *
   * **Issue #625 itself reports this as 1.730 m, and that figure is wrong.**
   * It was produced by a scratch instrument that walked vertices through
   * `node.matrixWorld` alone, so it had the `InstancedMesh` fault described
   * below and was reading 9.770 m — the lintel band — as the radial top. The
   * error was then independently "confirmed" by a second measurement made the
   * same way, which is worth remembering about independent confirmation: two
   * instruments sharing a method share its blind spot. The plumb figure 8.040
   * was always right, because `Box3.setFromObject` honours instance matrices.
   *
   * ## Measured off vertices, not off a box — and every instance of them
   *
   * The old form could use a `Box3` because `max.y` of an axis-aligned box *is*
   * the greatest `y` of the geometry inside it. No corner of that box is a
   * point of the mesh, though, so its **radius** is not any vertex's radius —
   * it is an over-estimate of unbounded size. So this walks the masonry's own
   * vertices through their world matrices and takes the greatest
   * `Geo.radius()`, which is a point that genuinely exists in the park.
   *
   * **A hand-rolled vertex walk has to be told about `InstancedMesh`, and this
   * one was not, for one review cycle.** `crenellations` is an `InstancedMesh`
   * of 40 merlons and `InstancedMesh extends Mesh`, so it passed the type test
   * and was then transformed by the container's matrix alone: all forty
   * collapsed onto the origin at **0.984 m**, the battlements dropped out of
   * the measurement, and the tallest surviving stone was the lintel band at
   * **9.770 m** against a true **10.750 m**. A **0.9806 m under-report, in the
   * dangerous direction** — the same disease as the plumb line it replaced,
   * one layer down, and invisible to the frame guard. `Box3.setFromObject`
   * honours instance matrices for free, which is exactly why replacing it with
   * a manual walk needed this care.
   *
   * `-Infinity` when no masonry mesh matched at all; see
   * `theGinormousSlideLeavesOverTheBattlements`, which treats that as a
   * failure rather than as limitless clearance.
   *
   * This replaced a `slideDoor` fact that reported where a hole in the south
   * wall was *planned*. No such hole is ever cut (see
   * `theGinormousSlideLeavesOverTheBattlements`), so the fact described nothing
   * in the park and the invariant reading it could not fail.
   */
  readonly castleMasonryTopRadius: number;
  /**
   * **Which named masonry object carries that maximum**, e.g. `crenellations`.
   *
   * It exists so an invariant can assert the answer is the merlons, which are
   * the top of the castle *by construction*. That is the one clause that would
   * have caught the `InstancedMesh` collapse described above on its first run:
   * with the forty merlons silently absent, the winner became
   * `castle-wall-lintel`, and every downstream number stayed plausible.
   *
   * Empty string when nothing matched, which pairs with `-Infinity` above.
   */
  readonly castleMasonryTopMesh: string;
  /**
   * The same top point's height **in the facade's own frame** (`building-facade`
   * local Y) — the frame `layout.ts`'s `CASTLE_MASONRY_TOP` is written in.
   *
   * This is the fact that proves the **value** rather than the frame. A radial
   * measurement that is simply wrong — wrong meshes, dropped instances, wrong
   * matrices — still looks like a radius and still passes a units check; what
   * it cannot do is land on 9.8500 in the facade's own coordinates. Measured
   * exactly that on the canonical seed, against `CASTLE_MASONRY_TOP` = 9.85.
   *
   * The collapsed walk gave **8.8** here (the lintel band's top, built to
   * `CASTLE_WALL_HEIGHT`), which is off by precisely `CASTLE_MERLON_HEIGHT` —
   * the missing metre *was* the merlons.
   *
   * `NaN` when nothing matched, or when no `building-facade` group was found.
   */
  readonly castleMasonryTopFacadeY: number;
  /**
   * What {@link castleMasonryTopFacadeY} is *supposed* to be — `layout.ts`'s
   * `CASTLE_MASONRY_TOP`, which is `CASTLE_WALL_HEIGHT + CASTLE_MERLON_HEIGHT`.
   *
   * It is carried here rather than imported by the invariant for a mechanical
   * reason, not a stylistic one: `building/layout.ts` reaches `parkLayout`, so
   * a **static** import of it into `test/` would load a seeded module before
   * the harness sets the seed and pin every seed to the default park — this
   * file's own header warns about exactly that, and the 76-silent-skips
   * incident is what it is warning about. `buildParkFacts` already imports
   * `layout.ts` dynamically, after the park is built, so the constant can come
   * across safely here and nowhere else.
   *
   * Pairing a measurement with the design figure it must match is deliberate:
   * a comparison of two facts is a comparison of two numbers **the invariant
   * did not choose**, which is what stops it drifting into rules-against-rules.
   */
  readonly castleMasonryDesignTopY: number;
  /**
   * **The top of everything standing on the castle's own roof** — the paving,
   * the pavilion and the ring of planters `Shell.ts`'s `buildCastleRoofGarden`
   * puts there (#462), measured in world space off the built group.
   *
   * `null` if the castle has no roof garden at all, which is a failure rather
   * than a pass: see `theCastleRoofStaysInsideItsBattlements`.
   *
   * It exists because the roof garden is the one thing on the castle that is
   * **not** matched by {@link castleMasonryTopRadius}'s name pattern and could still
   * reach into the ginormous slide's air. The pavilion is a scaled copy of a
   * building sized for a 42 m plate; put it on a 24 m castle with its mast and
   * bobble and it stands 4 m over the parapet.
   *
   * The **plan box** comes with the height deliberately: a clearance test needs
   * to know *where* the roof is as well as how high, and a lone scalar makes
   * the only available assertion "nothing on the roof is above the
   * battlements" — which is a proxy rather than the requirement, and one the
   * pavilion's own pyramid fails by 1.95 m while clearing the ride by metres.
   */
  readonly castleRoofGarden: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
    readonly topY: number;
  } | null;
  /**
   * {@link slideChute}, put through `worldToCastle` — the chute in the same
   * axes the castle and everything standing on it is drawn in, so a clearance
   * against the roof garden compares like with like.
   */
  readonly slideChuteInCastleFrame: readonly (readonly [number, number, number])[];
  /**
   * **The same box, in the castle's own axes, built from the drawn vertices.**
   *
   * A world-axis `Box3` round the roof garden is an axis-aligned box round a
   * body leaning **12.44 degrees**, so its `max.y` is the highest world `y` any
   * corner reaches and has nothing to do with the height of the roof where the
   * chute actually passes. Measured on seed 131 it read the roof at 8.06 m and
   * reported the ginormous slide 0.22 m *inside* it; asked in the castle's own
   * frame, with the chute taken there too, the same ride clears the same roof
   * by **5.02 m**.
   *
   * So this is the honest box, and {@link theSlideClearsTheCastleRoofGarden}
   * asks it. Built by putting every drawn vertex of the roof-garden group
   * through `worldToCastle`, not by rotating the world box's eight corners —
   * that would only be a bigger box round a wrong one.
   */
  readonly castleRoofGardenInCastleFrame: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
    readonly topY: number;
  } | null;
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
    /**
     * The two ends of the drawn part's **own axis**, in world space, foot
     * first.
     *
     * Not a world-Y window and a plan position: the castle is drawn leaning
     * **12.44 degrees** onto the planet, so a turret's axis is not world `+Y`
     * and `centre.y ± height/2` is not its extent. Measured on seed 24 the
     * four tower bodies' feet span 6 m of world `y` between them while every
     * one of them stands on the same plinth.
     */
    readonly footX: number;
    readonly footY: number;
    readonly footZ: number;
    readonly tipX: number;
    readonly tipY: number;
    readonly tipZ: number;
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
    /**
     * **The least of her this eye can show anywhere in its own beat**, as the
     * angular extent of her body: `sin(theta) / distance`, theta being between
     * the line of sight and the axis she lies along. Her length is left out —
     * it scales every beat equally and restating how big a child is would be a
     * second definition of her.
     *
     * Distance alone cannot see the failure this exists for. On
     * `feat/procgen-on-sphere`'s chute, beat 1's rider stayed 6.6–8.9 m from
     * her eye — inside every allowance the placement code had — while the shot
     * swung round to look straight down her, and her own head took her body
     * from 2.58% of the frame to **0.13%** against a 0.40% floor.
     */
    readonly worstExtent: number;
    /**
     * How nearly end-on that worst moment is: `|cos(theta)|`, 1 being straight
     * down her body and 0 square across it. Carried beside
     * {@link worstExtent} because it is the half of it a person can picture,
     * and a complaint that quotes both says which way a beat went wrong.
     */
    readonly worstEndOn: number;
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
  /**
   * **How far out the park is actually drawn** — every vertex of every
   * outdoor object in the built scene, see {@link DrawnReachFact}.
   *
   * {@link boundary} is the park's *outline*; the furthest things drawn — the
   * treeline, the Rail Race ring, the road kerb — stand well past it (126-135 m
   * against a 101-107 m outline on the five CI seeds when this was written).
   * A clause asking "is the park on its planet?" of the outline alone is asking
   * a smaller question than its name.
   */
  readonly drawnReach: DrawnReachFact;
  /**
   * What "twice the park" was asked to be, in square metres — the target
   * `generateParkBoundary` was handed (#115 asked for area-within-tolerance
   * and it was never checked until issue #241).
   */
  readonly boundaryTargetArea: number;
  /** Half the width the boundary masonry occupies, off `Garden.ts`. */
  readonly masonryHalfWidth: number;
  /** Half-thickness of the boundary wall as collision sees it, off `Garden.ts`. */
  readonly wallCollisionHalf: number;
  /**
   * How long one drawn block of the boundary wall is, off `Garden.ts`.
   *
   * A station is where a block's **middle** goes, so any clause asking "is this
   * block standing somewhere it should not?" needs half of this to ask about
   * the block rather than about its centre point.
   */
  readonly boundaryBlockWidth: number;
  /**
   * **The park's front gate, read off the built scene** — the crossbar mesh
   * `Entrance.ts` names `park-gate-arch`, and the ground it stands on.
   *
   * `null` if no such mesh is in the scene, which the invariant treats as a
   * failure rather than as nothing to check: a gate that was never built would
   * otherwise pass every clause below for free.
   *
   * Measured, never asked for. Issue #480 was two rotations on this mesh —
   * inverted, so it hung *down* from the posts and buried its apex 1.34 m
   * under the paving, and turned a quarter-turn, so it lay along the path
   * rather than across it. Every number the builder used still read
   * plausibly; only the mesh's own world box says which way it points.
   */
  readonly parkGateArch: {
    /** World bounding box of the crossbar. */
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
    readonly minZ: number;
    readonly maxZ: number;
    /** Where the crossbar's own origin sits — the middle of the opening. */
    readonly centreX: number;
    readonly centreZ: number;
    /** Terrain height under the middle of the opening. */
    readonly groundY: number;
    /**
     * Where the two gate posts stand, read off the same scene — the things the
     * arch's feet are supposed to be standing on, and the things a child
     * actually bumps into. Empty if the posts lost their names, which the
     * invariant reports rather than passing over.
     */
    readonly posts: readonly { readonly x: number; readonly z: number }[];
    /**
     * Air under the lowest thing over the *opening*, in metres above **the
     * terrain a child stands on** — raycast up from a child's toes, not read
     * off the bounding box.
     *
     * The distinction is the whole clause. While the gate was a half-torus
     * crossbar on two separate posts, `minY` happened to be the underside of
     * the span and the box answered correctly. The authored arch is one asset
     * whose piers come down to the paving, so `minY` is now the floor: the box
     * reports 0.00 m of headroom under a gate a child walks through every
     * time she arrives. See `scripts/gate-arch-measure.mts`.
     *
     * `Infinity` if nothing overhangs the gateway at all, which is a gate with
     * no arch on it and which the invariant treats as a failure rather than as
     * generous headroom.
     *
     * **Taken whole from `measureGateArch`, never recomputed here.** It used to
     * be `lowestOverheadY - terrainHeight(centreX, centreZ)` on this line and
     * the identical expression in `scripts/probe-gate-pool.mts` — one number
     * with two definitions, and a difference of world `y` is not a height on a
     * sphere.
     */
    readonly headroom: number;
    /** Where that lowest overhead thing is, so a failure names a place. */
    readonly lowestOverheadAt:
      | { readonly x: number; readonly y: number; readonly z: number }
      | null;
    /**
     * Which way the arch's lettered face looks, in world XZ. See
     * `scripts/gate-arch-measure.mts`: the gate's *shape* cannot answer this,
     * because an arch turned 180 degrees has an identical bounding box.
     */
    readonly forwardX: number;
    readonly forwardZ: number;
  } | null;
  readonly distanceToRail: (x: number, z: number) => number;
  /** Can a walker of `radius` stand here without being pushed out? */
  readonly isStandable: (x: number, z: number, radius?: number) => boolean;
  /**
   * Where a walker of `radius` standing here actually ends up after collision
   * resolves — not merely whether she moved.
   *
   * `isStandable` answers "was she pushed?", which cannot tell two blockers
   * apart, and that is how half the gate's solidity clause died: the boundary
   * wall and the gate pier both push a child at (-4.30, 59.00) in the same
   * direction, so deleting the pier's collider changed nothing `isStandable`
   * could see. *Where* she lands does tell them apart — the pier can only ever
   * hold her at exactly its own reach, and anything further is somebody else's
   * doing.
   */
  readonly pushedTo: (x: number, z: number, radius?: number) => { readonly x: number; readonly z: number };
  /**
   * Can the real nav lattice actually route a child here from where she
   * starts? The same question `scripts/check-park.mts` asks of every
   * attraction, asked here of every ride's exit. `goalY` defaults to ground
   * level; pass a bridge's own `heightAt(x, z)` to ask about its deck.
   */
  readonly reachableFromEntrance: (x: number, z: number, goalY?: number) => boolean;
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
/**
 * **Does the cat bus fit the children it carries?**
 *
 * Measured here rather than in `invariants.ts` for a reason worth keeping. The
 * first attempt put it in the invariant file, which meant statically importing
 * `catBus.ts` and `ArrivalSequence.ts` into `test/`. Those reach `layout.ts`
 * and then the seeded park manifest, so the manifest loaded **before the seed
 * was set**, every seed but the canonical one threw — *"asked for seed 11 but
 * the park built with 20260728"* — and 156 tests went down as silent skips.
 * That is precisely the failure CLAUDE.md documents (*"a skipped test is not a
 * passing test... the tell was the pass count, not the fail count"*), and the
 * repo's own seed guard caught it within a minute of it being written.
 *
 * `parkFacts.ts` is loaded after the seed is chosen, so it is the safe place to
 * touch seed-dependent modules. Invariants read these numbers from here.
 *
 * The measurement is seed-independent — the bus is the same on every seed — but
 * it costs a few milliseconds, so running it per seed is free.
 */
function measureCatBusFit(): {
  seatCount: number;
  worstProtrusion: number;
  worstOverlap: number;
  widestChild: number;
} {
  const size = new Vector3();
  let widestChild = 0;
  for (const style of HAIR_STYLES) {
    const bare = createKid({ hairStyle: style });
    bare.root.updateMatrixWorld(true);
    new Box3().setFromObject(bare.root).getSize(size);
    widestChild = Math.max(widestChild, size.x, size.z);
  }

  const bus = createCatBus();
  const shell = new Box3();
  shell.makeEmpty();
  let bands = 0;
  bus.root.traverse((object) => {
    if (object.name === 'cat-bus-shell-lower' || object.name === 'cat-bus-shell-upper') {
      shell.expandByObject(object);
      bands += 1;
    }
  });
  const seatCount = bus.seats.length;
  if (bands !== 2) {
    bus.dispose();
    // Reported as an impossible protrusion rather than silently as zero: a
    // measurement that cannot find its subject must not read as a pass.
    return { seatCount, worstProtrusion: Infinity, worstOverlap: Infinity, widestChild };
  }

  for (const seat of bus.seats) seat.add(createKid({ hairStyle: 'short' }).root);
  bus.root.updateMatrixWorld(true);
  const boxes = bus.seats.map((seat) =>
    new Box3().setFromObject(seat.children[seat.children.length - 1]!),
  );

  let worstProtrusion = -Infinity;
  for (const box of boxes) {
    worstProtrusion = Math.max(
      worstProtrusion,
      box.max.y - shell.max.y,
      shell.min.x - box.min.x,
      box.max.x - shell.max.x,
      box.max.z - shell.max.z,
      shell.min.z - box.min.z,
    );
  }

  let worstOverlap = 0;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (!a.intersectsBox(b)) continue;
      worstOverlap = Math.max(
        worstOverlap,
        Math.min(
          Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x),
          Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z),
        ),
      );
    }
  }

  bus.dispose();
  return { seatCount, worstProtrusion, worstOverlap, widestChild };
}

export async function buildParkFacts(seed: number, restart = 0): Promise<ParkFacts> {
  process.env['LGP_SEED'] = String(seed);
  process.env['LGP_PARK_RESTART'] = String(restart);

  const { buildHeadlessPark } = await import('../../scripts/park-harness.mts');
  const { PARK_SEED_ASKED, PARK_MANIFEST } = await import('../../src/world/parkManifest.ts');

  if (PARK_SEED_ASKED !== seed) {
    throw new Error(
      `parkFacts: asked for seed ${seed} but the park built with ${PARK_SEED_ASKED}. ` +
        'The module registry was reused across seeds — check that vitest is ' +
        'still isolating test files (vitest.config.ts) and that each seed has ' +
        'a file of its own.',
    );
  }

  const { PARK_RESTART } = await import('../../src/world/parkRestart.ts');
  if (PARK_RESTART !== restart) {
    throw new Error(`parkFacts: asked for restart ${restart} of seed ${seed} but the park built restart ${PARK_RESTART}.`);
  }

  const headless = buildHeadlessPark();
  const { world, scene, buildMs, sample } = headless;

  // Dynamically imported here, after `world` (and so `TRAIN_PLAN`) is
  // already built for this exact seed — never at this file's own top level,
  // the seed-pinning trap this file's header already warns about.
  const { planBridgeFootprints } = await import('../../src/world/train/bridgeFootprint.ts');
  const bridgeReservations = planBridgeFootprints(world.train.crossings);

  // Same rule, same reason: the road's owner reaches PARK_BOUNDARY, so it is
  // imported here — after the world for this seed is built — and never at the
  // top of a test file.
  const { ROAD_FEATURE, entranceRoadClaims, entranceRoadSegments } = await import(
    '../../src/world/entrance/roadCorridor.ts'
  );
  const roadCorridor: RoadCorridorFacts = {
    feature: ROAD_FEATURE,
    claimed: world.groundClaims.claimsOf(ROAD_FEATURE),
    fromOwner: entranceRoadClaims(),
    segments: entranceRoadSegments(),
  };
  // Same rule, same reason as above: the turrets' world position is a function
  // of the seed, so `layout.ts` is imported here rather than at a test file's
  // top level.
  const { CASTLE_TOWERS } = await import('../../src/world/building/layout.ts');
  const castleTurrets = CASTLE_TOWERS.filter((tower) =>
    tower.name.startsWith('tower-body-'),
  ).map((tower) => ({
    name: tower.name,
    x: tower.x,
    z: tower.z,
    radiusBottom: tower.radiusBottom,
  }));

  // The Rail Race's supports, as claimed and as drawn — see
  // {@link RailRaceSupportFacts}. `track.ts` reaches `parkLayout.ts`, so it is
  // imported here, after this seed's world exists, never at the top of a test.
  const { trestleClaims } = await import('../../src/world/railRace/track.ts');
  const railRaceSupports: RailRaceSupportFacts[] = [];
  {
    const railRace = world.railRace;
    // Aliased: a later block in this function destructures `Matrix4` from its
    // own dynamic import, which would shadow a top-level one into the TDZ here.
    const { Matrix4: StrutMatrix4 } = await import('three');
    const matrix = new StrutMatrix4();
    const centre = new Vector3();
    const axis = new Vector3();
    /**
     * Both ends of drawn strut `i` of an instanced cylinder stood by `track.ts`'s
     * `strut` — **mapped back to the flat frame the tree was solved in.** The
     * struts are drawn leant onto the sphere (`leanTrestleTree`); the claims
     * and the lean bound are made on the flat solve, in chart coordinates. So
     * each drawn end goes back through the ring's own `chartOf` — the exact
     * inverse of the one rigid turn it was drawn through — before it is
     * compared with anything the registry holds. Read straight as flat, a
     * rail-height point 100 m out is metres off its own plan: the lean itself,
     * not an error.
     *
     * **Not `unplaceFromSphere`, which this used to call.** That answers a
     * different question — where a plumb line from the point meets the ground —
     * and it was the exact inverse only while every node was leant at its own
     * column, which is the shear `route.ts`'s `lean` exists to undo. It now
     * differs by about 0.13 m out here, three times this clause's own
     * float32 slack.
     */
    const ends = (
      mesh: InstancedMesh,
      i: number,
      ring: RailRaceRoute,
      at: number,
    ): { from: Vector3; to: Vector3 } => {
      mesh.getMatrixAt(i, matrix);
      centre.setFromMatrixPosition(matrix);
      axis.setFromMatrixColumn(matrix, 1);
      return {
        from: ring.unlean(at, centre.clone().addScaledVector(axis, -0.5), new Vector3()),
        to: ring.unlean(at, centre.clone().addScaledVector(axis, 0.5), new Vector3()),
      };
    };
    /** Where a drawn trunk's top stands on the ring — the tree's one station. */
    const stationOfTrunk = (legs: InstancedMesh, i: number, ring: RailRaceRoute): number => {
      legs.getMatrixAt(i, matrix);
      centre.setFromMatrixPosition(matrix);
      axis.setFromMatrixColumn(matrix, 1);
      return ring.stationOf(centre.clone().addScaledVector(axis, 0.5));
    };
    for (const [label, feature, ringRoute] of [
      ['walk-past', 'railRace:walk-past-ring', railRace.walkPastRoute],
      ['race', 'railRace:race-ring', railRace.raceRoute],
    ] as const) {
      const scale = ringRoute.scale;
      const group = railRace.group.getObjectByName(feature);
      const legs = group?.getObjectByName('railRace:trestle-legs');
      const lower = group?.getObjectByName('railRace:trestle-branches-lower');
      const upper = group?.getObjectByName('railRace:trestle-branches-upper');
      if (
        !(legs instanceof InstancedMesh) ||
        !(lower instanceof InstancedMesh) ||
        !(upper instanceof InstancedMesh)
      ) {
        railRaceSupports.push({
          label,
          feature,
          claimed: label === 'walk-past' ? railRace.supportClaims.walkPast : railRace.supportClaims.race,
          fromDrawn: [],
          struts: 0,
          trees: [],
        });
        continue;
      }
      const fromDrawn: Claim[] = [];
      const trees: RailRaceSupportFacts['trees'][number][] = [];
      let struts = 0;
      // `track.ts` draws trestle `i`'s trunk as leg `i`, its two lower branches
      // as `2i, 2i+1` and its four upper ones as `4i..4i+3` — the tree is
      // rebuilt from the drawn struts by that order, then run through the one
      // owner of what a support claims.
      for (let i = 0; i < legs.count; i += 1) {
        // One station for the whole tree — see `RailRaceRoute.stationOf`. Per
        // node, each of the seven would find a station of its own and the
        // ring's curvature would read back as a bent tree.
        const at = stationOfTrunk(legs, i, ringRoute);
        const trunk = ends(legs, i, ringRoute, at);
        const forkNodes = [ends(lower, 2 * i, ringRoute, at).to, ends(lower, 2 * i + 1, ringRoute, at).to];
        const laneTops = [0, 1, 2, 3].map((lane) => ends(upper, 4 * i + lane, ringRoute, at).to);
        struts += 7;
        fromDrawn.push(
          ...trestleClaims(
            {
              laneTops,
              forkNodes,
              trunkTop: trunk.to,
              trunkFoot: trunk.from,
              ground: trunk.from.y,
            },
            scale / railRace.raceRoute.scale,
          ),
        );
        trees.push({
          footX: trunk.from.x,
          footZ: trunk.from.z,
          lean: Math.hypot(trunk.to.x - trunk.from.x, trunk.to.z - trunk.from.z),
          // flat-ok: both ends were mapped back to the chart by the ring's own chartOf above; y is chart height
          trunkHeight: trunk.to.y - trunk.from.y,
        });
      }
      railRaceSupports.push({
        label,
        feature,
        // The ring's own slice of the one `railRace` feature — see `RailRace.supportClaims`.
        claimed: label === 'walk-past' ? railRace.supportClaims.walkPast : railRace.supportClaims.race,
        fromDrawn,
        struts,
        trees,
      });
    }
  }

  const { CROSSING_SITES } = await import('../../src/world/train/crossingPlan.ts');
  const { SITE_SNAP_TOLERANCE } = await import('../../src/world/train/crossings.ts');
  const plannedBridgeSiteDistances = CROSSING_SITES.map((site) => site.railDistance);

  const { BOUNDARY_BLOCK_WIDTH, BOUNDARY_MASONRY_HALF_WIDTH, BOUNDARY_WALL_COLLISION_HALF } =
    await import('../../src/world/Garden.ts');
  const { CIRCULAR_PARK_AREA, PARK_AREA_MULTIPLIER } = await import('../../src/world/boundary.ts');
  const { PARK_LAYOUT } = await import('../../src/world/parkLayout.ts');
  const { ANCHORS } = await import('../../src/world/anchors.ts');
  const { PLAZA } = await import('../../src/world/paths.ts');
  const { PATH_GRAPH, routeCurve } = await import('../../src/world/pathGraph.ts');
  const { archFeet } = await import('../../src/world/railRace/arch.ts');
  const { RAIL_RACE_PLAN } = await import('../../src/world/railRace/plan.ts');
  const railRaceArchFeet = [RAIL_RACE_PLAN.walkPastRing, RAIL_RACE_PLAN.raceRing]
    .flatMap((ring) => archFeet(ring))
    .map((foot) => ({ x: foot.x, z: foot.z, radius: foot.radius }));
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

  // **Measured in the flat frame, about the foot** — issue #653. A tree's
  // `parts` are flat-frame authoring positions (`FoliageFade` puts them on the
  // sphere with `placeOnSphere`), while `tree.x`/`tree.z` is the canopy's
  // *drawn* centre, slid outward along the local up. Reading one against the
  // other inflated the footprint by that slide (1.69 m on the seed-131 tree
  // beside the railway) *and* moved the centre by it, so a tree whose trunk
  // stands 5.40 m off the rail, canopy reaching 2.25 m, was reported 0.20 m
  // past the rail's centre line. The rails, the walls, the bushes and the
  // paving are all placed through the same map from the same flat frame, so
  // the foot is the honest centre to measure them from: a rigid lean moves a
  // canopy and the carriage passing it by the same amount at the same height.
  // `FoliageOccluder.footX`/`footZ` is the one owner of where that foot is.
  const trees: TreeFact[] = world.scenery.foliageOccluders.map((tree) => {
    let footprint = 0;
    for (const part of tree.parts) {
      if (part.kind === 'trunk') continue;
      const offset = Math.hypot(part.position.x - tree.footX, part.position.z - tree.footZ);
      const reach = offset + Math.max(part.scale.x, part.scale.z);
      if (reach > footprint) footprint = reach;
    }
    return { x: tree.footX, z: tree.footZ, footprint };
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
    halfX: entry.footprint.kind === 'circle' ? entry.footprint.radius : entry.footprint.halfX,
    halfZ: entry.footprint.kind === 'circle' ? entry.footprint.radius : entry.footprint.halfZ,
    signYaw: entry.signYaw,
  }));

  // The ginormous slide's chute, sampled off the built curve and pushed out
  // through the scene graph into world space.
  //
  // `updateMatrixWorld(true)` is called deliberately and is not a formality: a
  // headless park is never rendered, so nothing has otherwise composed a single
  // world matrix and every one of them is still the identity. Sampling without
  // this yields the chute's *local* coordinates while looking exactly like
  // world ones, and every clearance test built on them would quietly pass.
  const { BUILDING_CENTRE_X, BUILDING_CENTRE_Z, CASTLE_MASONRY_TOP } = await import(
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

  // How far out the park is drawn. Walked by hand rather than with
  // `scene.traverse` so the two interior roots can be skipped whole: their
  // rooms stand hundreds of metres from the garden on purpose, and filtering
  // them by position (`spaceAt`) would also hide an outdoor object that had
  // wandered out to the same place — the exact thing this exists to see.
  //
  // Its three.js classes are bound under names of its own, from its own dynamic
  // import: later blocks of this same function destructure `Matrix4` and
  // `Mesh` out of `await import('three')`, which shadows the module-level
  // imports for the whole body and would put a bare `Matrix4` here in its
  // temporal dead zone (see the `MeshClass` note below).
  const reachThree = await import('three');
  const drawnReach = ((): DrawnReachFact => {
    const ReachInstancedMesh = reachThree.InstancedMesh;
    const excluded = [world.building.interiorRoot, world.hotel.hotelRoot];
    const instance = new reachThree.Matrix4();
    const toWorld = new reachThree.Matrix4();
    const vertex = new reachThree.Vector3();
    let radius = 0;
    const furthestNode: { node: import('three').Object3D | null } = { node: null };
    let vertices = 0;
    let objects = 0;
    const visit = (node: import('three').Object3D): void => {
      if (excluded.includes(node as never)) return;
      const geometry = (node as { geometry?: import('three').BufferGeometry }).geometry;
      const position = geometry?.getAttribute('position');
      if (position) {
        objects += 1;
        const copies = node instanceof ReachInstancedMesh ? node.count : 1;
        for (let copy = 0; copy < copies; copy += 1) {
          if (node instanceof ReachInstancedMesh) {
            node.getMatrixAt(copy, instance);
            toWorld.multiplyMatrices(node.matrixWorld, instance);
          } else {
            toWorld.copy(node.matrixWorld);
          }
          for (let i = 0; i < position.count; i += 1) {
            vertex.fromBufferAttribute(position, i).applyMatrix4(toWorld);
            vertices += 1;
            const d = Math.hypot(vertex.x, vertex.z);
            if (d > radius) {
              radius = d;
              furthestNode.node = node;
            }
          }
        }
      }
      for (const child of node.children) visit(child);
    };
    visit(scene);
    const path: string[] = [];
    for (let n: import('three').Object3D | null = furthestNode.node; n; n = n.parent) {
      path.push(n.name || n.type);
    }
    return {
      radius,
      furthest: path.join(' < '),
      vertices,
      objects,
      excludedRoots: excluded.map((root) => root.name || root.type),
    };
  })();

  // The top of the castle's stonework, read off the built meshes — as a
  // **radius from the planet's centre**, because the castle leans (#625). See
  // `ParkFacts.castleMasonryTopRadius` for the 2.710 m this was wrong by while
  // it was an AABB's `max.y`, and for why a box cannot answer a radius.
  const { Box3 } = await import('three');
  // Dynamic, like every other `src/` import in this function: a static one
  // would load at module-evaluation time, before the harness has set the seed.
  // `Geo` itself reads no seed, but the rule is cheaper to keep than to audit.
  const { Geo } = await import('../../src/world/geo/Geo.ts');
  // **`MeshClass`, not the `Mesh` imported at the top of this file.** A
  // `const { … Mesh … } = await import('three')` further down *this same
  // function* (the rail-race block) shadows the module-level import for the
  // whole body, so a bare `Mesh` up here is in its temporal dead zone: it
  // typechecks, and throws `Cannot access 'Mesh' before initialization` at
  // runtime. In vitest that kills the suite before any test runs and reports as
  // **93 skipped**, which reads nothing like a crash — the pass count is the
  // tell, exactly as CLAUDE.md's "a skipped test is not a passing test" says.
  // Measured here rather than guessed: it is how this block first failed.
  // Aliased `…ForMasonry` because `InstancedMeshClass` and `Matrix4` are both
  // already taken further down this same function (the arriving-bus block), and
  // in one function scope that is a redeclaration — which `tsc` catches, unlike
  // the `Mesh` shadow noted just above, which it does not. Renaming here rather
  // than there keeps the change inside the block that introduced the clash.
  const {
    Mesh: MeshClass,
    InstancedMesh: InstancedMeshForMasonry,
    Matrix4: MatrixForMasonry,
  } = await import('three');
  let castleMasonryTopRadius = -Infinity;
  let castleMasonryTopMesh = '';
  let castleMasonryTopFacadeY = Number.NaN;
  {
    const probe = new Vector3();
    const geo = new Geo();
    const instanceMatrix = new MatrixForMasonry();
    const composed = new MatrixForMasonry();
    const topAt = new Vector3();
    scene.traverse((object) => {
      if (!/^(castle-wall-|crenellations$)/.test(object.name)) return;
      object.traverse((node) => {
        if (!(node instanceof MeshClass)) return;
        const position = node.geometry.getAttribute('position');
        if (!position) return;
        node.updateWorldMatrix(true, false);
        // **`crenellations` is an `InstancedMesh` of 40 merlons, and
        // `InstancedMesh extends Mesh`** — so it passes the test above, and a
        // walk that then applies only `node.matrixWorld` collapses all forty
        // onto the container's origin. Measured: 0.984 m that way against
        // 10.750 m honouring the per-instance matrices, i.e. the battlements
        // dropped out of the measurement entirely and the tallest thing left
        // was the lintel band at 9.770 m.
        //
        // That is a 0.9806 m under-report in the *dangerous* direction — the
        // identical disease this fact was rewritten to cure, one layer down.
        // `Box3.setFromObject`, which this replaced, honours instance matrices
        // for free; a hand-rolled vertex walk has to be told.
        const matrices: InstanceType<typeof MatrixForMasonry>[] = [];
        if (node instanceof InstancedMeshForMasonry) {
          for (let k = 0; k < node.count; k += 1) {
            node.getMatrixAt(k, instanceMatrix);
            matrices.push(composed.multiplyMatrices(node.matrixWorld, instanceMatrix).clone());
          }
        } else {
          matrices.push(node.matrixWorld.clone());
        }
        for (const matrix of matrices) {
          for (let i = 0; i < position.count; i += 1) {
            probe.fromBufferAttribute(position, i).applyMatrix4(matrix);
            const radius = geo.setFromWorldVector(probe).radius();
            if (radius > castleMasonryTopRadius) {
              castleMasonryTopRadius = radius;
              castleMasonryTopMesh = object.name;
              topAt.copy(probe);
            }
          }
        }
      });
    });
    // The same point expressed in the facade's own frame, which is the frame
    // `layout.ts`'s `CASTLE_MASONRY_TOP` is written in. It is what lets an
    // invariant check the *value* rather than only the frame — see
    // `theGinormousSlideLeavesOverTheBattlements`.
    if (castleMasonryTopRadius > -Infinity) {
      let facade: import('three').Object3D | null = null;
      scene.traverse((object) => {
        if (object.name === 'building-facade') facade = object;
      });
      if (facade) {
        castleMasonryTopFacadeY = (facade as import('three').Object3D).worldToLocal(
          topAt.clone(),
        ).y;
      }
    }
  }

  // Everything standing on the castle's own roof (#462), as one box in world
  // space. Found by walking the scene for the group `Shell.ts` builds rather
  // than by asking the builder whether it built one — the same discipline the
  // cat bus below is found with, and for the same reason.
  let castleRoofGarden: ParkFacts['castleRoofGarden'] = null;
  let castleRoofGardenInCastleFrame: ParkFacts['castleRoofGardenInCastleFrame'] = null;
  {
    let roofRoot: import('three').Object3D | null = null;
    scene.traverse((object) => {
      if (object.name === 'castle-roof-garden') roofRoot = object;
    });
    if (roofRoot) {
      const box = new Box3().setFromObject(roofRoot as import('three').Object3D);
      castleRoofGarden = {
        minX: box.min.x,
        maxX: box.max.x,
        minZ: box.min.z,
        maxZ: box.max.z,
        topY: box.max.y,
      };
      // ...and the same thing in the castle's own axes. See the field's
      // docblock: an axis-aligned box round a leaning building is not the
      // building.
      const { worldToCastle } = await import('../../src/world/building/layout.ts');
      const local = new Box3();
      const corner = new Vector3();
      (roofRoot as import('three').Object3D).traverse((object) => {
        if (!(object instanceof MeshClass)) return;
        const attribute = object.geometry.getAttribute('position');
        if (!attribute) return;
        for (let i = 0; i < attribute.count; i += 1) {
          corner
            .set(attribute.getX(i), attribute.getY(i), attribute.getZ(i))
            .applyMatrix4(object.matrixWorld);
          worldToCastle(corner, corner);
          local.expandByPoint(corner);
        }
      });
      if (!local.isEmpty()) {
        castleRoofGardenInCastleFrame = {
          minX: local.min.x,
          maxX: local.max.x,
          minZ: local.min.z,
          maxZ: local.max.z,
          // `local` is a box in the CASTLE's own axes, built by putting every
          // drawn vertex through `worldToCastle` — so its `+Y` is the castle's
          // own up, and `max.y` is the top of the roof garden measured along
          // the direction the castle actually stands in. It is the fix for an
          // axis-aligned box round a leaning body, not an instance of one: the
          // world-axis version of this very number read 8.06 m where this reads
          // 11.80 m, and reported the ginormous slide 0.22 m inside a roof it
          // in fact clears by 5.02 m.
          // flat-ok: `local` is in the castle's own axes, so +Y is the castle's up
          topY: local.max.y,
        };
      }
    }
  }

  // --- the park's front gate -------------------------------------------------
  // Found by walking the scene for the crossbar's own name, the same way the
  // cat bus below is found, and for the same reason: asking `Entrance` whether
  // it built a gate cannot tell you which way the gate is pointing.
  let parkGateArch: ParkFacts['parkGateArch'] = null;
  {
    // `scripts/gate-arch-measure.mts` is the one owner of this traversal and
    // of the headroom raycast — `scripts/probe-gate-pool.mts` asks the same
    // questions of the sixteen pool seeds and must get its answers the same
    // way. It imports nothing but `three`, so it is safe here: nothing in it
    // reads the seed at module load.
    const { terrainHeight: groundAt } = await import('../../src/world/terrain.ts');
    const measured = measureGateArch(scene, groundAt);
    if (measured) {
      parkGateArch = {
        minX: measured.minX,
        maxX: measured.maxX,
        minY: measured.minY,
        maxY: measured.maxY,
        minZ: measured.minZ,
        maxZ: measured.maxZ,
        centreX: measured.centreX,
        centreZ: measured.centreZ,
        groundY: groundAt(measured.centreX, measured.centreZ),
        posts: measured.posts,
        // Against the terrain, never against the arch's own base: an arch
        // sunk into the paving takes its base down with it and a
        // base-relative number cannot see that. `measureGateArch` owns the
        // subtraction — see the field's docblock.
        headroom: measured.headroom,
        lowestOverheadAt: measured.lowestOverheadAt,
        forwardX: measured.forwardX,
        forwardZ: measured.forwardZ,
      };
    }
  }

/**
 * **How tall a thing is along ITS OWN up, not the world's.**
 *
 * `new Box3().setFromObject(root)` is axis-aligned, so `max.y - min.y` is the
 * object's extent *projected onto world +Y*. For anything standing level that
 * is its height. For the cat bus it is not: `ArrivalSequence.placeBus` calls
 * `faceOnGround`, deliberately, because the road runs far enough out that a
 * chassis held level to world +Y digs its downhill wheel into the hill. So the
 * bus is tilted, and an axis-aligned box round a tilted body grows with the
 * tilt while the body does not.
 *
 * Measured on the canonical seed at the park's authored scale:
 *
 *   bus lean off world +Y   21.31 deg
 *   AABB world-Y extent      9.43 m   <- reported as the bus's height, and failed
 *   along its own up         6.03 m   <- the bus
 *   along its own right      7.30 m
 *   along its own forward   14.54 m
 *   inflation                1.565x
 *
 * `TALLEST_CHILD_HEIGHT` is 2.97, so the invariant's band is 4.16-7.72 m: 9.43
 * is outside it and 6.03 is comfortably inside. The bus never grew; the ruler
 * was held vertically against a thing that is not.
 *
 * The 7.30 and 14.54 are worth keeping here, because they are **exactly** the
 * numbers `check-swept-bus.mts` collapsed to when it hit this same fault from
 * the other side — its per-seed boxes of 12.10/13.73/12.00 m became an
 * identical 14.54 x 7.30 once the yaw was taken out. Two independent
 * instruments agreeing on the bus's own dimensions is the control on this one.
 *
 * Every drawn vertex, in world space, projected onto the object's own axis —
 * so it is an oriented extent and not a second approximation of one.
 */
function heightAlongOwnUp(root: import('three').Object3D): number {
  const quaternion = new Quaternion();
  root.getWorldQuaternion(quaternion);
  // The canonical LOCAL +Y, rotated by the object's own quaternion: this
  // derives the local up rather than assuming it, the same shape as `Frame`'s
  // own `LOCAL_UP`. Marked so `check:flat-primitives` does not read it as a
  // world axis standing in for a local one, which is the opposite of what it is.
  const up = new Vector3(0, 1, 0).applyQuaternion(quaternion); // flat-ok: local axis, leaned by the object's own quaternion
  const vertex = new Vector3();
  let lowest = Infinity;
  let highest = -Infinity;
  root.updateWorldMatrix(true, true);
  root.traverse((object) => {
    // Duck-typed rather than `instanceof Mesh`, which is this file's own idiom
    // (see the mesh count just below) and is not a style choice: a static
    // `Mesh` binding is in a circular-import temporal dead zone at the point
    // this runs, and reaching for it throws
    // `Cannot access 'Mesh' before initialization` — which vitest reports as
    // **93 skipped, 0 failed**, the quietest way for a suite to stop checking.
    const mesh = object as unknown as {
      isMesh?: boolean;
      geometry?: { attributes?: Record<string, { count: number } | undefined> };
      matrixWorld: import('three').Matrix4;
    };
    if (!mesh.isMesh) return;
    const position = mesh.geometry?.attributes?.['position'];
    if (!position) return;
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position as never, index).applyMatrix4(mesh.matrixWorld);
      const along = vertex.dot(up);
      if (along < lowest) lowest = along;
      if (along > highest) highest = along;
    }
  });
  return highest > lowest ? highest - lowest : 0;
}

  // --- the cat bus -----------------------------------------------------------
  // Found by walking the scene, not by asking `world.entrance` whether it built
  // one. Asking the builder is how a feature stays green while being absent
  // from the game; this is the check that would have caught PR #27 on the day
  // it merged. See `ParkFacts.catBus`.
  let catBus: CatBusFact | null = null;
  {
    let busRoot: import('three').Object3D | null = null;
    scene.traverse((object) => {
      if (object.name === 'cat-bus') busRoot = object;
    });
    if (busRoot) {
      // Narrowed through a local: `scene.traverse`'s callback is not a closure
      // TypeScript can follow, so `busRoot` is still `null`-typed out here.
      const root = busRoot as import('three').Object3D;
      const where = new Vector3();
      const busHeight = heightAlongOwnUp(root);
      root.getWorldPosition(where);
      let meshCount = 0;
      let hasDriver = false;
      root.traverse((object) => {
        if ((object as { isMesh?: boolean }).isMesh) meshCount += 1;
        if (object.name === 'cat-bus-driver') hasDriver = true;
      });
      // **Counted off the crowd, not off the scene graph.** The children who
      // ride in are park NPCs now — instanced members of `KidCrowd`, drawn from
      // one `InstancedMesh` — so there are no per-child nodes named
      // `entrance-kid-N` to find any more, and looking for them would report
      // an empty bus for ever. "Who is aboard" is "who is under scripted
      // control", which is the thing the arrival actually asserts.
      const kidCount = world.npcs.all.filter((child) => child.scripted).length;
      const fit = measureCatBusFit();
      // Dynamically imported, for the reason `startsAtX` documents: statically
      // importing `roadRoute.ts` into `test/` loads the seeded manifest before
      // the seed is set.
      const { entranceBusArriveAt, entranceRoadAt } = await import(
        '../../src/world/entrance/roadRoute.ts'
      );
      const startsAt = entranceRoadAt(entranceBusArriveAt());
      catBus = {
        startsAtX: startsAt.x,
        startsAtZ: startsAt.z,
        seatCount: fit.seatCount,
        worstOccupantProtrusion: fit.worstProtrusion,
        worstOccupantOverlap: fit.worstOverlap,
        widestRealChild: fit.widestChild,
        x: where.x,
        y: where.y,
        z: where.z,
        meshCount,
        height: Number.isFinite(busHeight) ? busHeight : 0,
        hasDriver,
        kidCount,
      };
    }
  }

  const { InstancedMesh: InstancedMeshClass, Matrix4 } = await import('three');

  // --- what stands in front of the arriving bus ------------------------------
  // Dynamically imported for the reason this file's header gives: a *static*
  // import of anything under `src/world/` into `test/` reaches the seeded park
  // manifest and loads it before the seed is set, which silently skips 156
  // tests rather than failing one.
  const { hidesTheArrivingBus } = await import('../../src/world/entrance/arrivalSightline.ts');
  const { distanceToEntranceCorridor } = await import('../../src/world/entrance/roadRoute.ts');
  const hidingTheArrivingBus: HidingFact[] = [];
  const treesInTheBusRoad: TreeInTheRoadFact[] = [];
  let plantedInstancesSwept = 0;
  {
    // Only the two groups the scatter owns. The boundary wall and the Rail
    // Race's trestles also cross this corridor — 20 wall blocks and 40-odd
    // trestle parts, measured — but neither is scenery and neither can be
    // moved by refusing a spot, so sweeping them in here would make an
    // assertion that can never go green and therefore never means anything.
    // What this owns is *where things are planted*.
    const roots: import('three').Object3D[] = [];
    scene.traverse((object) => {
      if (object.name === 'foliage' || object.name === 'treeline') roots.push(object);
    });
    const matrix = new Matrix4();
    const at = new Vector3();
    const scale = new Vector3();
    for (const root of roots) {
      root.traverse((object) => {
        if (!(object instanceof InstancedMeshClass)) return;
        object.geometry.computeBoundingBox();
        const bounds = object.geometry.boundingBox;
        if (!bounds) return;
        for (let index = 0; index < object.count; index += 1) {
          object.getMatrixAt(index, matrix);
          matrix.premultiply(object.matrixWorld);
          at.setFromMatrixPosition(matrix);
          scale.setFromMatrixScale(matrix);
          const top = at.y + bounds.max.y * scale.y;
          plantedInstancesSwept += 1;
          // How far this instance spreads on the ground: its own horizontal
          // scale, read off the matrix that will be drawn, so a canopy is
          // measured by the canopy and a trunk by the trunk.
          const reach = Math.max(scale.x, scale.z) * Math.max(bounds.max.x, bounds.max.z);
          const outside = distanceToEntranceCorridor(at.x, at.z);
          if (outside < reach) {
            treesInTheBusRoad.push({
              x: at.x,
              z: at.z,
              reach,
              inside: reach - outside,
              what: object.name,
            });
          }
          if (!hidesTheArrivingBus(at.x, at.z, top)) continue;
          hidingTheArrivingBus.push({ x: at.x, z: at.z, top, what: object.name });
        }
      });
    }
  }

  const { CHUTE_ENVELOPE } = await import('../../src/world/building/SlideRide.ts');
  const castleTowers: {
    name: string;
    footX: number; footY: number; footZ: number;
    tipX: number; tipY: number; tipZ: number;
    radiusBottom: number; radiusTop: number;
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
    const axis = new Vector3();
    for (let i = 0; i < object.count; i += 1) {
      object.getMatrixAt(i, local);
      composed.multiplyMatrices(object.matrixWorld, local);
      centre.setFromMatrixPosition(composed);
      // The part's own axis, read off the composed matrix: its local `+Y`
      // column carries both the direction it stands in and its scale.
      axis.setFromMatrixColumn(composed, 1);
      const length = axis.length() * params.height;
      axis.normalize();
      castleTowers.push({
        name: `${object.name}[${i}]`,
        footX: centre.x - (axis.x * length) / 2,
        footY: centre.y - (axis.y * length) / 2,
        footZ: centre.z - (axis.z * length) / 2,
        tipX: centre.x + (axis.x * length) / 2,
        tipY: centre.y + (axis.y * length) / 2,
        tipZ: centre.z + (axis.z * length) / 2,
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

  // The same chute in the castle's own axes — see `slideChuteInCastleFrame`.
  const slideChuteInCastleFrame: (readonly [number, number, number])[] = [];
  {
    const { worldToCastle } = await import('../../src/world/building/layout.ts');
    const probe = new Vector3();
    for (const [x, y, z] of slideChute) {
      worldToCastle(probe.set(x, y, z), probe);
      slideChuteInCastleFrame.push([probe.x, probe.y, probe.z]);
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

  // --- every bridge's drawn parapet, ring by ring (issue #489) --------------
  // Read off the built `wallTop` mesh; `PARAPET_GONE_HUMP` comes from
  // `bridges.ts` so "is a parapet supposed to be here?" has one owner rather
  // than a threshold restated in a test. Both imports are dynamic for the usual
  // reason — `bridges.ts` reaches `paths.ts` and `terrain.ts` reaches
  // `parkManifest` through `boundary.ts`, and either would pin the seed.
  const { PARAPET_GONE_HUMP, PARAPET_HEIGHT, PARAPET_CROWN_LIFT } = await import(
    '../../src/world/train/bridges.ts'
  );
  /** The tallest a parapet is ever drawn — see {@link ParkFacts.maxParapetHeight}. */
  const maxParapetHeight = PARAPET_HEIGHT + PARAPET_CROWN_LIFT;
  const bridgeParapetRings: BridgeParapetRing[] = [];
  {
    // `Mesh` is shadowed later in this function by a destructured dynamic
    // import, so the static one is in its TDZ here; aliasing is the pattern
    // this file already uses (see `InstancedMeshClass` above).
    const { Mesh: MeshClass } = await import('three');
    const bridgeGroups: import('three').Object3D[] = [];
    world.train.group.traverse((node) => {
      if (node.name.startsWith('bridge-')) bridgeGroups.push(node);
    });
    for (const group of bridgeGroups) {
      const wallTop = group.getObjectByName('wallTop');
      if (!(wallTop instanceof MeshClass)) continue;
      const at = wallTop.geometry.getAttribute('position');
      if (!at || at.count % 4 !== 0) continue;
      for (let ring = 0; ring < at.count / 4; ring += 1) {
        for (const side of [0, 1] as const) {
          const outer = ring * 4 + side;
          const inner = ring * 4 + 2 + side;
          const top = at.getY(outer);
          const ox = at.getX(outer);
          const oz = at.getZ(outer);
          const hump = top - terrainHeight(ox, oz);
          bridgeParapetRings.push({
            bridge: group.name,
            outer: [ox, oz],
            inner: [at.getX(inner), at.getZ(inner)],
            top,
            hump,
            expected: hump > PARAPET_GONE_HUMP,
          });
        }
      }
    }
  }
  const slideCameras: {
    beat: number;
    eye: readonly [number, number, number];
    covers: readonly [number, number, number];
    groundY: number;
    blocked: number;
    samples: number;
    nearest: number;
    farthest: number;
    worstExtent: number;
    worstEndOn: number;
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
    // How a reclining rider lies along the chute, from the one owner of it —
    // `ridePose.ts`, the same angle `Building` poses her at and every pet
    // follows her down at. Needed because how much of her a camera can show
    // depends on the angle between its line of sight and the axis she is lying
    // along, not on distance alone.
    const { RIDE_RECLINE } = await import('../../src/entities/ridePose.ts');
    const LEAN = Math.abs(RIDE_RECLINE);
    const bodyAxis = new Vector3();
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
      let worstExtent = Infinity;
      let worstEndOn = 0;
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

        // **How much of her this eye can show here**, as the angular extent of
        // her body: `sin(theta) / distance`, where theta is between the line of
        // sight and the axis she lies along. Her length is deliberately left
        // out — it would be a second description of how big a child is, and it
        // scales every beat equally anyway. `toRider` is already normalised by
        // the raycast above.
        bodyAxis
          .copy(up)
          .multiplyScalar(Math.cos(LEAN))
          .addScaledVector(tangent.clone().normalize(), -Math.sin(LEAN))
          .normalize();
        const endOn = Math.abs(toRider.dot(bodyAxis));
        const sin = Math.sqrt(Math.max(0, 1 - endOn * endOn));
        worstExtent = Math.min(worstExtent, sin / reach);
        worstEndOn = Math.max(worstEndOn, endOn);
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
        worstExtent,
        worstEndOn,
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

  /**
   * **Every stall, measured off the built park.**
   *
   * The booth group's own world matrix for where it is *drawn*; the built
   * interact zone for where a child is sent; `boothFootprint.ts` for its body.
   * Nothing here is read from the placement table, because a booth that
   * stepped aside is exactly the case where the table and the scene could
   * disagree, and that disagreement is what the invariant is for.
   *
   * Group names are the booths' own: the six mini-game booths name their prop
   * `stall:<id>` (`minigames/stallProp.ts`), and the two one-off shops name
   * theirs after themselves. A stall whose group cannot be found is left out
   * of the list and the invariant fails on the count, rather than being
   * quietly unmeasured.
   */
  const STALL_GROUP_NAMES: Readonly<Record<string, string>> = {
    facePaint: 'facePaintStall',
    keychain: 'keychainShop',
  };
  // Seed-dependent (the placements are a view on the layout the driver
  // decided), so imported here after the world is built — never at this
  // file's top level. `boothFootprint.ts` is safe to import statically: every
  // one of its own imports is `import type`, so it pulls nothing in at runtime.
  const { STALL_PLACEMENTS, stallShift } = await import('../../src/minigames/stallPlacement.ts');
  const stallZones = new Map(
    world
      .interactZones()
      .filter((zone) => /^stall:[^:]+$/.test(zone.id))
      .map((zone) => [zone.id.slice('stall:'.length), zone]),
  );
  const stalls: StallFact[] = [];
  const stallsMissing: string[] = [];
  for (const id of Object.keys(STALL_PLACEMENTS)) {
    const groupName = STALL_GROUP_NAMES[id] ?? `stall:${id}`;
    const group = scene.getObjectByName(groupName);
    const zone = stallZones.get(id);
    if (!group || !zone) {
      // Named, never silently dropped: a booth with no group in the scene or
      // no interact zone is a booth nothing below could measure, and a shorter
      // list that says nothing is how a check stops covering something.
      stallsMissing.push(`${id} (${group ? '' : `no scene group '${groupName}'`}${group || zone ? '' : ', '}${zone ? '' : 'no interact zone'})`);
      continue;
    }
    group.updateMatrixWorld(true);
    const at = new Vector3().setFromMatrixPosition(group.matrixWorld);
    const [shiftX, shiftZ] = stallShift(id);
    stalls.push({
      id,
      drawnX: at.x,
      drawnZ: at.z,
      box: boothBoxFor(id),
      standX: zone.standX,
      standZ: zone.standZ,
      steppedAside: Math.hypot(shiftX, shiftZ),
    });
  }

  // The six keyring stand points, read with the rack's own zoomed view opened
  // — see {@link ParkFacts.keychainKeyringEntrances}'s own doc comment for why
  // `entrances` above cannot carry these. Closed again immediately after:
  // nothing later in this function should see the shop mid-browse.
  world.keychainShop.openView();
  const keychainKeyringEntrances: EntranceFact[] = world.keychainShop
    .interactZones()
    .filter((zone) => zone.id.startsWith('stall:keychain:'))
    .map((zone) => ({ id: zone.id, x: zone.standX, z: zone.standZ }));
  world.keychainShop.closeView();

  // The drawn ribbon, not the control points it was drawn from. `paths.ts`
  // sweeps a Catmull-Rom (tension 0.4) through those controls, and the curve
  // bows away from them — so where the paving actually runs, and where it
  // actually stops, is only visible on the sampled curve.
  const drawnCentreLine = (
    route: (typeof PATH_GRAPH.edges)[number]['route'],
  ): { length: number; points: [number, number][] } => {
    // `routeCurve` is the one owner of the drawn shape — the fillet pass in
    // `paths.ts` means the curve is more than the raw control points now,
    // and a second hand-rolled CatmullRom here would measure a path the
    // park no longer draws.
    const curve = routeCurve(route);
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
    paved: true,
  }));

  // Every edge in the graph, paved or not — an invariant asking "how far
  // does a child actually have to walk between these two destinations"
  // needs the unpaved "connectivity fact" edges too (`paths.ts`'s own
  // phrase): a destination that already stood within a few metres of the
  // network gets no drawn ribbon, but the short unpaved walk it represents
  // is exactly as real as a paved one, and dropping it from the graph would
  // strand that destination or force a wildly longer route through
  // whatever paving happens to also touch its coordinate.
  const allDrawn = PATH_GRAPH.edges.map((edge) => drawnCentreLine(edge.route));
  const pathConnectivityEdges: PathEdgeFact[] = PATH_GRAPH.edges.map((edge, index) => ({
    name: edge.route.name,
    from: edge.from,
    to: edge.to,
    backbone: edge.route.closed,
    halfWidth: edge.route.width / 2,
    points: allDrawn[index]!.points,
    paved: edge.paved,
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
  const pushedTo = (x: number, z: number, radius = 0.62): { x: number; z: number } => {
    probe.set(x, 0, z);
    world.collision.resolve(probe, radius);
    return { x: probe.x, z: probe.z };
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
  // one and as `Game` itself does — the walker's own radius and jump apex,
  // and every railway bridge's own covers() (issue #116, Decision 8), so
  // "reachable" here means what it means in play, deck included.
  const navGrid = new NavGrid(world.collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT, undefined, (x, z) =>
    world.train.bridges.some((bridge) => bridge.covers(x, z)),
  );
  const routeBuffer = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);
  // `goalY` defaults to ground level for every existing caller, which is
  // every ordinary stand point in the park; a bridge deck sits several
  // metres above the ground `sample(x, z, 0)` would otherwise find there
  // (the ceiling test in `WalkSurfaces.sample` excludes anything more than
  // a step above the `y` it was asked about), so a caller that wants the
  // deck has to say so.
  const reachableFromEntrance = (x: number, z: number, goalY = 0): boolean => {
    const count = navGrid.findRoute(
      ENTRANCE_PLAYER_X,
      ENTRANCE_PLAYER_Z,
      sample(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z, 0),
      x,
      z,
      goalY,
      sample,
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
   * A drawn thing's distance from the start/finish arch, in metres of the
   * shared arc length everything in this ride is addressed by.
   *
   * **Through the ring's own `stationOf`, not by nearest point in plan.** A
   * duck bar hangs ten metres above the rails and the whole ride is leant onto
   * the sphere, so the bar's plan position stands metres outside the centre
   * line — and on a spline whose bend varies, the nearest point of that line
   * can belong to a quite different part of the loop. Measured on the canonical
   * seed, that read a bar 12.8 m from where it is: the invariant below
   * faithfully reported the bonk landing "after the bar", and the bar was
   * exactly where it should be. `stationOf` refines in the chart, where the
   * projection is unambiguous.
   */
  const archRelative = (drawn: { x: number; y: number; z: number }): number =>
    raceRoute.wrap(raceRoute.stationOf(drawn) - raceRoute.startDistance);

  const raceRing = world.railRace.group.getObjectByName('railRace:race-ring');
  const barsMesh = raceRing?.getObjectByName('railRace:duck-bars');
  const builtBarDistances: number[] = [];
  if (barsMesh instanceof Instanced) {
    const matrix = new Mat4();
    const at = new Vec3();
    for (let i = 0; i < barsMesh.count; i += 1) {
      barsMesh.getMatrixAt(i, matrix);
      at.setFromMatrixPosition(matrix);
      // The bar's real arc position, read off its own matrix rather than off
      // the rule that placed it.
      const arch = archRelative(at);

      // **Which lane is it on?** Since 7 August a duck bar crosses one lane
      // rather than all four (`hazards.ts`'s `DuckBar.lane`), so the rider
      // simulated below — who runs in `PLAYER_LANE` — only ever meets a quarter
      // of the ring's bars. This used to dedupe by arc position instead, on the
      // reasoning that "all four lanes of one bar share it"; that was true then
      // and is false now, and left in place it made the invariant demand that a
      // rider be bonked by three other people's bars.
      //
      // **Asked in the chart, by lane offset.** It compared the bar's plan
      // position with each lane's plan position, and a bar hangs a rider's
      // height above the rails on a ride leant onto the sphere — so it stands
      // further out in plan than the rail it straddles and lands squarely over
      // the *next lane out*. Measured on the canonical seed: 34 of the ring's
      // 40 bars were filed one lane too far out, and the rider on lane 3 was
      // then held to bars belonging to lane 2. That is the whole of the "bonks
      // 12.5 m after the bar" failure — the bonk was the next real lane-3 bar
      // along, and the bar it was blamed on was somebody else's.
      //
      // Unleaning removes the height entirely: in the chart a bar sits at
      // exactly its own lane's offset from the centre line, whatever it does
      // in the air.
      const across = raceRoute.unlean(
        raceRoute.wrap(raceRoute.startDistance + arch),
        at,
        new Vec3(),
      );
      const station = raceRoute.path.sampleAt(raceRoute.wrap(raceRoute.startDistance + arch));
      const offset =
        (across.x - station.x) * station.normalX + (across.z - station.z) * station.normalZ;
      let onLane = 0;
      let nearest = Infinity;
      for (let lane = 0; lane < world.railRace.laneCount; lane += 1) {
        const d = Math.abs(offset - (raceRoute.laneOffsets[lane] ?? 0));
        if (d < nearest) {
          nearest = d;
          onLane = lane;
        }
      }
      if (onLane !== PLAYER) continue;
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
  // The park's own predicates for "is there anything under here", the same three
  // `railRace/track.ts`'s `groundIsClear` asks about a trestle foot. Dynamically
  // imported like everything else seed-dependent in this file.
  const { distanceToPath } = await import('../../src/world/pathGraph.ts');
  const { distanceToRailCorridor, clearOfPlots } = await import(
    '../../src/world/train/plan.ts'
  );
  const archClearance: ArchClearanceFact[] = [];
  const archLegs: ArchLegFact[] = [];
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
    //
    // **The arcs only, matched exactly.** `startsWith('railRace:finish-rainbow')`
    // also catches `…-leg-3-outer`, and a leg runs all the way down to the
    // terrain — so the moment one came within a child's width of a lane it would
    // silently become the lowest thing over that lane and this would report a
    // headroom of about zero for a reason that has nothing to do with headroom.
    // It cannot happen today (the nearest leg is 13 m outside the outermost
    // lane), which is exactly why it is worth pinning now rather than after
    // somebody narrows the span.
    const band: { across: number; y: number }[] = [];
    const vertex = new Vec3();
    group.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      if (!/^railRace:finish-rainbow-\d+$/.test(child.name)) return;
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

    // --- and where the rainbow's legs come down ----------------------------
    //
    // The feet of each arc, so a leg can be measured against the thing it is
    // meant to be holding up rather than against the rule that placed it.
    const arcFootY = new Map<string, number>();
    group.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      if (!/^railRace:finish-rainbow-\d+$/.test(child.name)) return;
      arcFootY.set(child.name, new Box3().setFromObject(child).min.y);
    });

    group.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const match = /^railRace:finish-rainbow-leg-(\d+)-(inner|outer)$/.exec(child.name);
      if (!match) return;
      const box = new Box3().setFromObject(child);
      const at = child.getWorldPosition(new Vec3());
      // **The lowest terrain under the leg's own footprint, not the terrain at
      // its centre.** The centre reading is `bottom = ground - tube` played
      // back — arithmetic this repo just wrote, identical on every seed, and a
      // check that reads back a constant is the failure this PR has hit five
      // times. Daylight appears at the *downhill* edge, so that is where it has
      // to be looked for, and these legs land on the rim, the steepest ground
      // in the park.
      const radius = (box.max.x - box.min.x) / 2;
      let groundY = terrainHeight(at.x, at.z);
      for (let k = 0; k < 16; k += 1) {
        const angle = (k / 16) * Math.PI * 2;
        const h = terrainHeight(at.x + Math.cos(angle) * radius, at.z + Math.sin(angle) * radius);
        if (h < groundY) groundY = h;
      }
      archLegs.push({
        ring: label,
        name: child.name,
        band: Number(match[1]),
        side: match[2] as 'inner' | 'outer',
        x: at.x,
        z: at.z,
        bottomY: box.min.y,
        topY: box.max.y,
        arcFootY: arcFootY.get(`railRace:finish-rainbow-${match[1]}`) ?? Number.NaN,
        groundY,
        distanceToPath: distanceToPath(at.x, at.z),
        distanceToRail: distanceToRailCorridor(at.x, at.z),
        clearOfPlots: clearOfPlots(at.x, at.z, radius),
      });
    });
  }

  // --- the journey lane, and whether the arrival ever finishes --------------
  //
  // Dynamically imported like everything else here, and now for the first-order
  // reason as well as the second-order one. `BusJourney`'s scatters used to take
  // *literal* seeds, which is why the cone in the road was identical on every
  // seed and no sweep could find it; they now draw from `PARK_SEED` like the
  // rest of the park, so this lane is a different lane on each of the five
  // seeds below and the guards over it are worth their runtime. The import has
  // to stay dynamic regardless: `BusJourney` reaches `parkManifest.ts` directly
  // now, and before that it already reached `art/style/materials.ts` and the
  // character models — a static import of any of it at the top of this file is
  // the documented way to pin every seed to the default park (CLAUDE.md's
  // 76-silent-skips trap).
  const { BusJourney, JOURNEY_SECONDS, laneHeight } = await import(
    '../../src/world/entrance/BusJourney.ts'
  );
  const { JourneyDirector } = await import('../../src/world/entrance/journeyDirector.ts');
  const { ShaderWarmup, WARMUP_BUDGET_MS } = await import('../../src/boot/shaderWarmup.ts');
  const { ROAD_HALF_WIDTH } = await import('../../src/world/entrance/road.ts');
  const { FOLIAGE_GEOMETRY } = await import('../../src/world/treeModel.ts');
  const { CROWD_HAIR_STYLES } = await import('../../src/art/models/hair.ts');
  // `Box3` is already bound further up this same function scope (the castle
  // tower block), so it is aliased here — the same move `Mat4`/`Vec3`/
  // `Instanced` already make a few hundred lines above.
  const { Box3: LaneBox3, PerspectiveCamera } = await import('three');

  const aRider = {
    skin: 0xffd9be,
    hair: 0x8b5a3c,
    outfit: 0xff9fc4,
    hairStyle: CROWD_HAIR_STYLES[0]!,
  };

  // --- what stands in the carriageway --------------------------------------
  //
  // Every renderable vertex in the lane, through its own instance matrix, in
  // world space. Not bounding boxes: a rotated box's AABB over-reports by up to
  // 41%, which would make the guard fire on things that are genuinely clear and
  // teach everyone to widen it. The road and the ground it is painted on are
  // exempt for the obvious reason, and so is the bus and everything hanging off
  // it — the bus is *supposed* to be on the road.
  const { laneCarriageway, laneGreenery } = ((): {
    laneCarriageway: LaneObstructionFact[];
    laneGreenery: LaneGreeneryFact[];
  } => {
    const lane = new BusJourney(aRider);
    lane.scene.updateMatrixWorld(true);

    // **The height that matters is the bus's own.** A branch overhanging the
    // road nine metres up is scenery; the same shape at wheel height is a
    // roadblock, and only one of those is worth a failing build. Taken off the
    // built bus rather than from a literal, so it stays true the next time
    // somebody resizes it — which has already happened once, from 11 m to
    // 18.2 m long (`layout.ts`).
    let busTop = 0;
    const busBox = new LaneBox3();
    lane.scene.traverse((node) => {
      if (node.name === 'cat-bus') busTop = busBox.setFromObject(node).max.y;
    });

    const exempt = new Set(['journey-road', 'journey-ground']);
    const worstPerNode = new Map<string, LaneObstructionFact>();
    const localVertex = new Vec3();
    const worldVertex = new Vec3();
    const instanceMatrix = new Mat4();

    const note = (node: string, instance: number, p: InstanceType<typeof Vec3>): void => {
      const reach = ROAD_HALF_WIDTH - Math.abs(p.x);
      if (reach <= 0) return;
      // Only what a bus would hit. The road rides the hills, so the ceiling is
      // measured from the lane surface under *this* point, not from y = 0.
      if (p.y > laneHeight(p.z) + busTop) return;
      const held = worstPerNode.get(node);
      if (held && held.reach >= reach) return;
      worstPerNode.set(node, { node, instance, x: p.x, y: p.y, z: p.z, reach });
    };

    lane.scene.traverse((node) => {
      if (exempt.has(node.name)) return;
      // **Only the bus and the gate.** `cat-bus-journey` is the name of the
      // *whole scene* (`BusJourney.ts`'s constructor), so exempting it here —
      // as the first draft of this did — walked every node's ancestry straight
      // up to the root and let everything through: zero fouls on a lane with a
      // cone standing in it. Found by reverting the fix and watching the guard
      // stay green, which is the only reason it is not still in here.
      //
      // The gate is exempt because a gate is a thing the road goes *through* by
      // design; whether its opening is passable is `theGateIsAHoleInTheWall`'s
      // question, and one owner per question.
      for (let up: typeof node | null = node; up; up = up.parent) {
        if (up.name === 'cat-bus' || up.name === 'journey-park-gate') return;
      }
      const drawn = node instanceof Instanced || node instanceof Mesh;
      if (!drawn) return;
      const position = (node as InstanceType<typeof Mesh>).geometry?.getAttribute('position');
      if (!position) return;
      const name = node.name || `(unnamed ${node.type})`;

      if (node instanceof Instanced) {
        for (let i = 0; i < node.count; i += 1) {
          node.getMatrixAt(i, instanceMatrix);
          for (let v = 0; v < position.count; v += 1) {
            localVertex.fromBufferAttribute(position, v);
            worldVertex
              .copy(localVertex)
              .applyMatrix4(instanceMatrix)
              .applyMatrix4(node.matrixWorld);
            note(name, i, worldVertex);
          }
        }
        return;
      }
      for (let v = 0; v < position.count; v += 1) {
        localVertex.fromBufferAttribute(position, v);
        worldVertex.copy(localVertex).applyMatrix4(node.matrixWorld);
        note(name, -1, worldVertex);
      }
    });

    // --- and what the lane is planted with -----------------------------------
    //
    // Jim, 9 August 2026: *"Use the actual tree models same as the game uses by
    // the side of the road but not on it."* Whether that stayed true is a
    // question about object identity, so identity is what is recorded: the
    // three shapes in `FOLIAGE_GEOMETRY` are looked up in a `Map` keyed by the
    // geometry *objects themselves*, which no copy can accidentally match.
    const parkShape = new Map<unknown, 'trunk' | 'round' | 'cone'>([
      [FOLIAGE_GEOMETRY.trunk, 'trunk'],
      [FOLIAGE_GEOMETRY.round, 'round'],
      [FOLIAGE_GEOMETRY.cone, 'cone'],
    ]);
    const laneGreenery: LaneGreeneryFact[] = [];
    lane.scene.traverse((node) => {
      // The bus and the children riding in it are not planting.
      for (let up: typeof node | null = node; up; up = up.parent) {
        if (up.name === 'cat-bus') return;
      }
      const drawn = node instanceof Instanced || node instanceof Mesh;
      if (!drawn) return;
      const geometry = (node as InstanceType<typeof Mesh>).geometry;
      if (!geometry?.getAttribute('position')) return;
      const populations: string[] = [];
      // Typed as the base class rather than `typeof node`: by here `node` has
      // been narrowed to `Mesh | InstancedMesh`, and a parent is neither.
      for (let up: import('three').Object3D | null = node; up; up = up.parent) {
        if (up.name) populations.push(up.name);
      }
      laneGreenery.push({
        node: node.name,
        population: populations[0] ?? '(unrooted)',
        populations,
        instances: node instanceof Instanced ? node.count : 1,
        parkTreeGeometry: parkShape.get(geometry) ?? null,
        geometryType: geometry.type,
      });
    });

    lane.dispose();
    return {
      laneCarriageway: [...worstPerNode.values()].sort((a, b) => b.reach - a.reach),
      laneGreenery,
    };
  })();

  // --- does the arrival reach its end? --------------------------------------
  //
  // **The assertion that was missing.** Everything already checked around this
  // sequence measured a property of it — the 45-degree pan, the floor
  // percentages, the glazing, twelve seated children, the skip in both
  // directions — and both existing director checks flip `readyToHandOver` true
  // by *hand-calling* `noteParkReady()` and `noteWarmupReady()` on a bare
  // `JourneyDirector` that is joined to no scene at all. That proves the
  // director's boolean algebra. It cannot prove the signals ever arrive, which
  // is the only thing a child cares about.
  //
  // So this drives the real `JourneyDirector` and the real `BusJourney` through
  // the same steps, in the same order, that `main.ts`'s ride loop does, and
  // nothing is set by fiat: `parkReady` is only ever noted after
  // `shouldBuildPark()` has asked for it, and `warmupReady` only ever from a
  // real `ShaderWarmup` draining a real queue built over this seed's real park
  // scene.
  //
  // **What is honestly not real here:** `renderer.compile()` needs a GPU, so the
  // renderer is inert and the queue drains faster than it would on a phone.
  // That makes this a guard on *termination*, not on warm-up cost — which is
  // `check:park-boot`'s job and is measured there. The failure it exists to
  // catch is a signal that never comes at all, and an inert compile cannot hide
  // one of those.
  const RIDE_STEP = 1 / 60;
  /**
   * Frames between `shouldBuildPark()` and the park being in hand.
   *
   * `main.ts` builds it inside `loadGame().then(...)`, so it settles on a later
   * frame rather than the same one. Two, because the module is already
   * evaluated by then and the promise is only waiting on a microtask turn.
   */
  const PARK_SETTLE_FRAMES = 2;

  const runTheArrival = (what: string, generationReadyAt: number): ArrivalRunFact => {
    const director = new JourneyDirector();
    const journey = new BusJourney(aRider);
    const inertRenderer = { compile: () => {} } as unknown as ConstructorParameters<
      typeof ShaderWarmup
    >[0];
    let warmup: InstanceType<typeof ShaderWarmup> | null = null;
    let parkDueOnFrame = -1;
    let skipOfferedSeconds = -1;
    let handOverSeconds = -1;
    let ridden = 0;
    let frames = 0;
    // Six rides' worth. Generous on purpose: a ceiling that a healthy run comes
    // anywhere near would go red for being slow rather than for being stuck.
    const ceilingSeconds = JOURNEY_SECONDS * 6;

    while (ridden < ceilingSeconds) {
      director.advance(RIDE_STEP);
      journey.update(RIDE_STEP, director.readyToArrive);

      if (director.shouldAdvanceGeneration() && ridden >= generationReadyAt) {
        director.noteGenerationReady();
      }
      if (director.shouldBuildPark()) {
        director.noteParkBuildStarted();
        parkDueOnFrame = director.frames + PARK_SETTLE_FRAMES;
      }
      if (parkDueOnFrame >= 0 && director.frames >= parkDueOnFrame && !director.parkReady) {
        director.noteParkReady();
        warmup = new ShaderWarmup(inertRenderer, scene, new PerspectiveCamera());
        skipOfferedSeconds = ridden;
      }
      if (warmup && director.shouldWarmShaders()) {
        warmup.advance(WARMUP_BUDGET_MS);
        if (warmup.ready) director.noteWarmupReady();
      }

      ridden += RIDE_STEP;
      frames += 1;

      if (director.readyToHandOver) {
        handOverSeconds = ridden;
        break;
      }
    }

    const finalState =
      `rideOver=${director.rideOver} generationReady=${director.generationReady} ` +
      `parkReady=${director.parkReady} warmupReady=${director.warmupReady} ` +
      `parkFitToPlay=${director.parkFitToPlay} overrunning=${director.overrunning} ` +
      `skipOffered=${director.skipOffered} parkBuildFrame=${director.parkBuildFrame}`;

    journey.dispose();
    return {
      what,
      handedOver: handOverSeconds >= 0,
      handOverSeconds,
      skipOfferedSeconds,
      frames,
      seconds: ridden,
      ceilingSeconds,
      rideSeconds: JOURNEY_SECONDS,
      finalState,
    };
  };

  const arrivalRuns = {
    onTime: runTheArrival('the park generated during the ride, as it normally does', 1),
    // The case `JourneyDirector.overrunning` exists for, and the one its own
    // doc calls "never true today" — which is exactly why it needs driving
    // rather than reasoning about. The bus pulls in to the gate and idles; the
    // question is whether it ever stops idling.
    overrun: runTheArrival(
      'the park generated long after the ride ran out (the overrun)',
      JOURNEY_SECONDS + 8,
    ),
  };

  // See `BridgePavingFact`: paving each bridge lifts clear of the ground,
  // against that bridge's own built masonry in plan (issue #349).
  const bridgePaving: BridgePavingFact[] = [];
  {
    const bridgesGroup = world.train.group.getObjectByName('railway-bridges');
    const layers: { name: string; mesh: Mesh }[] = [];
    world.garden.group.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      if (object.name === 'path-surface' || object.name === 'path-kerb') {
        layers.push({ name: object.name, mesh: object });
      }
    });

    if (bridgesGroup && layers.length > 0) {
      bridgesGroup.updateMatrixWorld(true);

      // The masonry outline, as flat triangles in the ground plane. The
      // invisible `deck` marker mesh is skipped: it is a clearance probe for
      // `railwayClearanceCoversTheTrainAndItsRiders` to measure the soffit
      // with, not stone anything could rest on.
      const corner = new Vector3();
      const planOf = (bridgeGroup: import('three').Object3D): number[][] => {
        const triangles: number[][] = [];
        bridgeGroup.traverse((object) => {
          if (!(object instanceof Mesh) || object.name === 'deck') return;
          const position = object.geometry.getAttribute('position');
          const index = object.geometry.getIndex();
          const count = index ? index.count : position.count;
          const planAt = (slot: number): [number, number] => {
            const v = index ? index.getX(slot) : slot;
            corner.set(position.getX(v), position.getY(v), position.getZ(v));
            corner.applyMatrix4(object.matrixWorld);
            return [corner.x, corner.z];
          };
          for (let i = 0; i + 2 < count; i += 3) {
            const [ax, az] = planAt(i);
            const [bx, bz] = planAt(i + 1);
            const [cx, cz] = planAt(i + 2);
            triangles.push([
              ax, az, bx, bz, cx, cz,
              Math.min(ax, bx, cx), Math.max(ax, bx, cx),
              Math.min(az, bz, cz), Math.max(az, bz, cz),
            ]);
          }
        });
        return triangles;
      };

      const inside = (px: number, pz: number, t: number[]): boolean => {
        const [ax, az, bx, bz, cx, cz] = t as [number, number, number, number, number, number];
        const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
        const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
        const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
        return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
      };
      const edge = (px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number => {
        const dx = x2 - x1;
        const dz = z2 - z1;
        const lenSq = dx * dx + dz * dz;
        let t = lenSq > 0 ? ((px - x1) * dx + (pz - z1) * dz) / lenSq : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
      };
      const outside = (px: number, pz: number, triangles: number[][]): number => {
        for (const t of triangles) {
          if (px >= t[6]! && px <= t[7]! && pz >= t[8]! && pz <= t[9]! && inside(px, pz, t)) return 0;
        }
        let best = Infinity;
        for (const t of triangles) {
          const dx = px < t[6]! ? t[6]! - px : px > t[7]! ? px - t[7]! : 0;
          const dz = pz < t[8]! ? t[8]! - pz : pz > t[9]! ? pz - t[9]! : 0;
          if (Math.hypot(dx, dz) >= best) continue;
          const d = Math.min(
            edge(px, pz, t[0]!, t[1]!, t[2]!, t[3]!),
            edge(px, pz, t[2]!, t[3]!, t[4]!, t[5]!),
            edge(px, pz, t[4]!, t[5]!, t[0]!, t[1]!),
          );
          if (d < best) best = d;
        }
        return best;
      };

      // A vertex counts as "lifted clear" once it stands this far above the
      // ground under it. Well over the drape's own lift (`PATH_SURFACE_LIFT`
      // is 0.055) so paving merely draped on the terrain never registers, and
      // far under anything a child could fall off.
      const CLEAR_OF_GROUND = 0.1;

      const bridges = world.train.bridges;
      const groups = bridgesGroup.children;
      for (let i = 0; i < bridges.length; i += 1) {
        const bridge = bridges[i]!;
        const bridgeGroup = groups[i];
        if (!bridgeGroup) continue;
        const triangles = planOf(bridgeGroup);
        let liftedClearOfGround = 0;
        let unsupported = 0;
        let worstOverhang = 0;
        let worstAt: readonly [number, number, number] = [0, 0, 0];
        let worstAboveGround = 0;
        let worstLayer = '';
        for (const { name, mesh } of layers) {
          const position = mesh.geometry.getAttribute('position');
          for (let v = 0; v < position.count; v += 1) {
            const x = position.getX(v);
            const z = position.getZ(v);
            if (bridge.pavingHeightAt(x, z) === null) continue;
            const y = position.getY(v);
            const aboveGround = y - terrainHeight(x, z);
            if (aboveGround <= CLEAR_OF_GROUND) continue;
            liftedClearOfGround += 1;
            const over = outside(x, z, triangles);
            if (over <= 1e-6) continue;
            unsupported += 1;
            if (over > worstOverhang) {
              worstOverhang = over;
              worstAt = [x, y, z];
              worstAboveGround = aboveGround;
              worstLayer = name;
            }
          }
        }
        bridgePaving.push({
          name: bridgeGroup.name,
          liftedClearOfGround,
          unsupported,
          worstOverhang,
          worstAt,
          worstAboveGround,
          worstLayer,
        });
      }
    }
  }

  // See `ParkFacts.strandedPathEnds`: a drawn route whose own end stands in
  // the air on a bridge (issue #414). Measured off the same `drawnCentreLine`
  // the rest of this file uses, so "where the path actually stops" is the
  // swept curve rather than the last control point — the two differ by up to
  // the fillet's own bow, which is metres on a turn.
  const strandedPathEnds: {
    route: string;
    at: readonly [number, number];
    aboveGround: number;
    bridge: string;
  }[] = [];
  {
    const bridgesGroup = world.train.group.getObjectByName('railway-bridges');
    for (const edge of PATH_GRAPH.edges) {
      if (!edge.paved) continue;
      const { points } = drawnCentreLine(edge.route);
      if (points.length < 2) continue;
      for (const end of [points[0] as [number, number], points[points.length - 1] as [number, number]]) {
        const [x, z] = end;
        for (const bridge of world.train.bridges) {
          const paving = bridge.pavingHeightAt(x, z);
          if (paving === null) continue;
          const aboveGround = paving - terrainHeight(x, z);
          if (aboveGround <= 0) continue;
          // Name the bridge the same way `bridgePaving` does, so a failure
          // message points at a group that exists in the built scene.
          let name = 'bridge';
          if (bridgesGroup) {
            for (const child of bridgesGroup.children) {
              if (bridge.deckCovers(child.position.x, child.position.z)) name = child.name;
            }
          }
          strandedPathEnds.push({ route: edge.route.name, at: [x, z], aboveGround, bridge: name });
          break;
        }
      }
    }
  }

  // See `ParkFacts.cruiserRouteGroundClearance`'s own comment: how high the
  // built loop stands above the terrain under it, sampled every metre, so an
  // invariant can tell a genuinely-low stretch (the station boarding dip)
  // from unexplained floating track without re-deriving `pylons.ts`'s own
  // placement rule.
  const cruiserRouteGroundClearance: number[] = [];
  {
    const point = new Vector3();
    const route = world.coaster.route;
    for (let d = 0; d < route.length; d += 1) {
      route.pointAt(d, point);
      cruiserRouteGroundClearance.push(point.y - terrainHeight(point.x, point.z));
    }
  }

  // See `ParkFacts.cruiserPylonTops`: the drawn top of each pylon, unleant back
  // into the flat frame `coaster.route` is solved in, so an invariant compares
  // like with like.
  //
  // **This block imports `unplaceFromSphere` itself, and must keep doing so.**
  // It used to lean on the binding the Rail Race's strut block destructured a
  // few hundred lines up, with a comment saying as much. #684 then stopped the
  // Rail Race needing it ("Not `unplaceFromSphere`, which this used to call"),
  // the binding went with it, and a rebase left this reaching for a name that
  // no longer existed. The tell was not a red test: every seed suite threw in
  // `buildParkFacts` and vitest reported **203 passed | 490 skipped**, zero
  // failures — CLAUDE.md's "a skipped test is not a passing test", where the
  // pass count is the only thing that gives it away. One block, one import, no
  // shared binding to lose.
  const cruiserPylonTops: { x: number; y: number; z: number }[] = [];
  {
    const pylons = world.coaster.group.getObjectByName('skyCruiser:pylons');
    if (pylons instanceof InstancedMesh) {
      const { unplaceFromSphere } = await import('../../src/world/terrain.ts');
      const { Matrix4: PylonMatrix4 } = await import('three');
      const matrix = new PylonMatrix4();
      const drawn = new Vector3();
      for (let i = 0; i < pylons.count; i += 1) {
        pylons.getMatrixAt(i, matrix);
        // The top of a unit-height cylinder, which is where the post ends.
        drawn.set(0, 0.5, 0).applyMatrix4(matrix);
        const flat = unplaceFromSphere(drawn, new Vector3());
        cruiserPylonTops.push({ x: flat.x, y: flat.y, z: flat.z });
      }
    }
  }

  // The fairy-light rig, counted off the scene it drew.
  //
  // **Poles and strings only, and both are meshes.** This used to carry a
  // `slots` field taken from `FAIRY_POLE_COUNT`, which was honest while the
  // plaza ring was the only chain and became a lie the moment the poles also
  // followed the paths: the coverage line read "fairy poles 105 (out of 10
  // slots offered)". A slot is a thing the *builder* planned and never draws,
  // so it cannot be measured off the built park at all — and a denominator
  // that cannot be measured has no business in a line that reports
  // measurements. It is gone rather than corrected.
  const fairyLightsDrawn = ((): ParkFacts['fairyLights'] => {
    let poles = 0;
    let strings = 0;
    world.fairyLights.group.traverse((object) => {
      if (object.name.startsWith('fairy-pole-')) poles += 1;
      else if (object.name.startsWith('fairy-string-')) strings += 1;
    });
    return { poles, strings };
  })();

  // The bus's run, from the same owners `ArrivalSequence.placeBus` and
  // `check:swept-bus` read: it drives the road's arc from `entranceBusArriveAt()`
  // to `entranceBusVanishAt()`, its body reaching half its own length beyond
  // each, as wide as the bus. Beyond the road's own ends a station is clamped,
  // so the overhang is carried on straight along the facing there.
  const { entranceBusArriveAt, entranceBusVanishAt, entranceRoadAt, entranceRoadFacing } =
    await import('../../src/world/entrance/roadRoute.ts');
  const { CAT_BUS_LENGTH, CAT_BUS_WIDTH } = await import('../../src/world/entrance/catBus.ts');
  const busRun = ((): ParkFacts['busRun'] => {
    const from = entranceBusArriveAt() + CAT_BUS_LENGTH / 2;
    const to = entranceBusVanishAt() - CAT_BUS_LENGTH / 2;
    const halfWidth = CAT_BUS_WIDTH / 2;
    const samples: { x: number; z: number }[] = [];
    for (let at = from; at >= to; at -= PLAYER_RADIUS) {
      const station = entranceRoadAt(at);
      const facing = entranceRoadFacing(at);
      // The bus's nose points down decreasing `at`: forward is (sin, cos) of
      // the facing, and its right-hand side is (cos, -sin).
      const forwardX = Math.sin(facing);
      const forwardZ = Math.cos(facing);
      const over = at - station.at;
      const cx = station.x - forwardX * over;
      const cz = station.z - forwardZ * over;
      for (const across of [-halfWidth, 0, halfWidth]) {
        samples.push({ x: cx + Math.cos(facing) * across, z: cz - Math.sin(facing) * across });
      }
    }
    return { samples, length: from - to, halfWidth };
  })();

  return {
    roadCorridor,
    castleTurrets,
    railRaceSupports,
    busRun,
    laneCarriageway,
    laneGreenery,
    laneRoadHalfWidth: ROAD_HALF_WIDTH,
    arrivalRuns,
    archClearance,
    archLegs,
    duckBars,
    cameraTracking,
    castlePass,
    cruiserStrikes: cruiserStrikes(world.coaster.route, world.coaster.group, [world.coaster.group]),
    cruiserRouteGroundClearance,
    cruiserPylonTops,
    seed,
    restart,
    headless,
    world,
    walls,
    trees,
    bushes,
    climbableTrees,
    lamps: world.lampPosts.positions.map((p) => [p.x, p.z] as const),
    fairyLights: fairyLightsDrawn,
    bridgeReservations,
    bridgeParapetRings,
    maxParapetHeight,
    plannedBridgeSiteDistances,
    bridgePaving,
    strandedPathEnds,
    crossingSiteSnapTolerance: SITE_SNAP_TOLERANCE,
    plots,
    railRaceArchFeet,
    entrances,
    stalls,
    stallsMissing,
    keychainKeyringEntrances,
    catBus,
    hidingTheArrivingBus,
    treesInTheBusRoad,
    plantedInstancesSwept,
    exits,
    pathNodes,
    pathEdges,
    pathConnectivityEdges,
    slideChute,
    slideChuteInCastleFrame,
    slideRiderFrame: { local: slideRiderLocal, world: slideRiderWorld },
    slideChuteBands,
    slideCameras,
    slideShotSpans,
    slideLanding,
    castleMasonryTopRadius,
    castleMasonryTopMesh,
    castleMasonryTopFacadeY,
    castleMasonryDesignTopY: CASTLE_MASONRY_TOP,
    castleRoofGarden,
    castleRoofGardenInCastleFrame,
    parkGateArch,
    castleTowers,
    chuteEnvelope: CHUTE_ENVELOPE,
    slideLegs: world.building.slideLegs,
    castleFootprint,
    reachableFromEntrance,
    routes,
    nearPairs,
    boundary: world.collision.playBounds,
    drawnReach,
    boundaryTargetArea: CIRCULAR_PARK_AREA * PARK_AREA_MULTIPLIER,
    masonryHalfWidth: BOUNDARY_MASONRY_HALF_WIDTH,
    boundaryBlockWidth: BOUNDARY_BLOCK_WIDTH,
    wallCollisionHalf: BOUNDARY_WALL_COLLISION_HALF,
    distanceToRail,
    isStandable,
    pushedTo,
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
