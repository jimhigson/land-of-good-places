import {
  TorusGeometry,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { clamp01, lerp } from '../../core/mathUtils';
import { hazardTapeTexture } from '../../core/textures';
import { addOutline, decal, solid, toonMaterial } from '../../art/style/materials';
import { ART } from '../../art/style/artPalette';
import { duckBarAssetGeometry } from '../../art/models/duckBarAsset';
import { terrainHeight } from '../terrain';
import { distanceToPath } from '../pathGraph';
import { archFeet } from './arch';
import { PARK_LAYOUT } from '../parkLayout';
import { distanceToRailCorridor } from '../train/plan';
import type { CollisionWorld } from '../Collision';
import { railFrameAt, sweptRails, type RailFrame, type RailSampler } from '../rail/sweptRail';
import {
  ALERT_RANGE,
  BARS_FROM_LEVEL,
  DUCK_CLEARANCE_AT_PARK_SCALE,
  RIDER_HEAD_TOP_AT_PARK_SCALE,
  TRESTLE_SPACING,
  trestleGridIndex,
  ZONES_FROM_LEVEL,
  type HazardLayout,
  type RaceLevel,
} from './hazards';
import {
  BAR_HALF_SPAN_AT_PARK_SCALE,
  BEAM_DROP,
  forkPlan,
  maxTrunkLean,
  POST_FOOT_RADIUS,
  STRUT_RADII,
  RAIL_GAUGE_AT_PARK_SCALE,
  RAIL_RADIUS_AT_PARK_SCALE,
  SLEEPER_ALONG_TRACK,
  SLEEPER_OVERHANG,
  SLEEPER_SPACING,
  SLEEPER_THICKNESS,
} from './trestleGeometry';
import { shapesOverlap, type Claim, type GroundClaims } from '../../boot/groundClaims';
import { TALLEST_CHILD_HEIGHT } from '../../art/models/kid';
import { RAIL_RACE_FEATURE } from './feature';
import { ROAD_FEATURE } from '../entrance/roadCorridor';
// Re-exported: these used to be defined here, and `cart.ts` and
// `scripts/check-rail-race.mts` import them from this module.
export { BAR_HALF_SPAN_AT_PARK_SCALE, RAIL_GAUGE_AT_PARK_SCALE } from './trestleGeometry';
import {
  LANE_COUNT,
  PLAYER_LANE,
  RIDE_SCALE,
  UNDULATION_REACH,
  type RailRaceRoute,
} from './route';

/**
 * **Everything the Rail Race runs through**: four rails, the trestles holding
 * them up, the bars you duck and the black stretches you must not power over.
 *
 * The rails come from `world/rail/sweptRail.ts`, the park's one way of turning a
 * route into rail geometry — the same swept tubes the coaster is built from, fed
 * a lane of this ring instead of a solved loop. Nothing here draws a rail by
 * hand.
 *
 * Everything else is instanced. There are four lanes and about eight hazards a
 * lap, and a hoop of two posts and a bar per lane per hazard is over a hundred
 * little meshes before a single trestle is counted — which as five
 * `InstancedMesh`es is five draw calls, whatever the layout turns out to be.
 */


/**
 * The gauge on the ring a child actually races on — the number `cart.ts` builds
 * its wheelbase against (see that file's header, which asserts the two agree).
 */
export const RAIL_GAUGE = RAIL_GAUGE_AT_PARK_SCALE * RIDE_SCALE;

/**
 * Tube/cross-section resolution for the rails' own `sweptRails` call, pulled
 * out to constants (rather than left inline in the options object below) so
 * `buildRailZoneVertexRanges` can compute exactly which vertex ring of the
 * built tube each hazard zone falls in *before* any lane's geometry actually
 * exists — see that function's own doc comment for why the mapping is the
 * same for every lane and rail, and so only needs building once.
 */
const RAIL_TUBULAR_PER_METRE = 1.2;
const RAIL_RADIAL_SEGMENTS = 6;

/**
 * Room over a standing rider's head for the finish rainbow to clear her by, in
 * metres. Not a clearance in its own right — {@link RIDER_HEAD_TOP_AT_PARK_SCALE}
 * owns how tall she is; this is only the gap on top of it, so that raising her
 * raises the arch rather than eating this.
 */
const ARCH_HEADROOM = 1.2;

/**
 * How far past the outermost lane's centre the finish rainbow must still be at
 * full height, in metres — a rider is not a line, and a semicircle is at its
 * lowest exactly where the outermost lane runs.
 */
const ARCH_SHOULDER_ROOM = 2.4;


/**
 * Every named part `art/blend/duckbar.blend` exports. Geometry only — see
 * `duckBarAsset.ts`'s own doc comment for why this asset has no per-part
 * transform the way the cart's does.
 */
export const DUCKBAR_PARTS = ['post', 'bar'] as const;
export type DuckBarPart = (typeof DUCKBAR_PARTS)[number];


export interface RailRaceTrack {
  readonly group: Group;
  /**
   * The ground this ring's supports claim — the very claims its search was
   * answered with, one per strut below the headroom, from the tree as drawn.
   * `RailRace.ts` commits both rings' together under {@link RAIL_RACE_FEATURE}.
   */
  readonly claims: readonly Claim[];
  /**
   * Makes this ring's trestle posts things a child can walk into.
   *
   * **Only the walk-past ring is ever asked, and only after both rings have
   * found their ground.** `CollisionWorld` has no per-collider removal — only
   * `clear()` — so a ring that registered colliders and was then hidden would
   * leave invisible solid posts in the park forever; the race ring only exists
   * while a child is strapped into a cart, and nobody is walking then. And a
   * collider registered before the race ring searched would be an obstacle to
   * it through the unmigrated `legacy:collision` predicate — a second
   * definition of the walk-past ring's ground, which the registry (one feature
   * for both rings) says is no obstacle at all. Measured before this order was
   * fixed: 100 of the canonical race ring's candidates refused by exactly that.
   */
  registerCollision(): void;
  /**
   * Drives the warning lamps.
   *
   * `lapOffset` is how far round the current lap the player is; `safe` is
   * whether they are currently off the button. Colour says *what to do* and size
   * says *how soon* — two channels for one idea, so it still reads for a child
   * who cannot tell amber from mint. Inherited wholesale from the retired 2D
   * game, where it taught the rule in about two hazards without a word.
   */
  setAlerts(lapOffset: number, safe: boolean, elapsed: number): void;
  /**
   * Brightens only the black stretches somebody is actually sparking on —
   * this zone, this lane — never the whole ring at once.
   *
   * `active` is every (zone, lane) currently sparking this frame, found by
   * `RailRace.ts` from each cart's own `rider.zoneCursor`. A rival sparking on
   * the far side of the loop still lights up on their own rail (that is
   * intentional — see `RailRace.ts`'s header), it just no longer lights up
   * every other black stretch in the park along with it.
   */
  setSparking(active: readonly SparkingSegment[], elapsed: number): void;
  /**
   * Shows or hides the hazard geometry for the level chosen this race — see
   * `hazards.ts`'s header and `ZONES_FROM_LEVEL`/`BARS_FROM_LEVEL`. The ring
   * is one physical structure whatever level is chosen, so there is no
   * separate geometry to build per level; this toggles `.visible` on
   * the black-stretch plate and the duck-bar meshes, and repaints the rails'
   * own resting vertex colours (black over every live zone — see
   * `paintRestingRailColours`), once, when
   * `RailRace.chooseLevel` fires. The trestle legs and branches are
   * never touched here — they carry the rails at every level, not just the
   * ones with hazards on them.
   */
  setHazardLevel(level: RaceLevel): void;
  dispose(): void;
}

/** One (zone, lane) pair currently sparking, for {@link RailRaceTrack.setSparking}. */
export interface SparkingSegment {
  /** Index into the lap's `HazardLayout.zones`, not the multi-lap schedule. */
  readonly zoneIndex: number;
  readonly lane: number;
}

/** The colours a warning runs through: calm cream, amber warning, mint safe. */
const CALM = new Color(PALETTE.signBoard);
const WARN = new Color(PALETTE.fairyWarm);
const SAFE = new Color(PALETTE.markerMint);

/**
 * One colour per lane, not one shared pink for the whole ring: with four
 * racers on four separate rails, colour is how a child tells "my lane" from
 * "their lane" at a glance, the same job livery plays on real racing lanes.
 * Same bright, high-saturation family the character creator's own swatches
 * use (`markerPink` etc in `core/palette.ts`) rather than inventing a new set.
 *
 * Exported and indexed by lane so `RailRace.ts` can paint each cart to match
 * its own rail exactly — the single source of truth for "my colour", so a cart
 * can never drift out of sync with the rail underneath it the way it once did
 * (see the header of `cart.ts`).
 */
export const LANE_COLOURS: readonly number[] = [
  PALETTE.markerPink,
  PALETTE.markerSky,
  PALETTE.markerLemon,
  PALETTE.markerMint,
];

/** How a ring is built, beyond its route. */
export interface RailRaceTrackOptions {
  /**
   * A name for the built group, so the two rings can be told apart in the
   * scene graph (and by `test/procgen/invariants.ts`, which measures them
   * separately). Not a feature name: both rings claim ground as
   * {@link RAIL_RACE_FEATURE}.
   */
  readonly ringName: string;
  /**
   * **The park's one claims registry**, which this ring's supports ask before
   * they stand (stage 3, step 2 of `docs/DESIGN-round-robin-generation.md`).
   * They ask as {@link RAIL_RACE_FEATURE} — one feature for both rings, so
   * the other ring's supports are never an obstacle (there is one rail race,
   * shown at one scale at a time) — and they do **not** commit here: the
   * built track returns its {@link RailRaceTrack.claims} and `RailRace.ts`
   * commits both rings' claims as one contribution once both are placed.
   */
  readonly groundClaims: GroundClaims;
  /**
   * Whether this ring builds the finish-line rainbow arch at all.
   *
   * **Only the race ring says yes.** `buildArch`'s own solve is deliberately
   * *not* scaled by `ringSizeVsRace` — its clear height and half-width come
   * off a standing rider's own head height, absolute, so a park-scale child
   * needs exactly as much headroom on the toy-sized walk-past ring as a rider
   * does on the full-sized race ring. That is correct for a rider mid-race,
   * and exactly wrong for a rainbow left standing over the everyday walk-past
   * ring at that same full size, permanently, whether a race is on or not —
   * Jim, playing, 18 August 2026, issue #299: it dwarfs the path, the nearby
   * trees and the lamppost every single time he walks past.
   *
   * `setActiveRing` in `RailRace.ts` already toggles the whole ring group's
   * `.visible` on the actual race-active signal — the race ring is shown only
   * from `board()` through `arrive()`, the walk-past ring the rest of the
   * time. So the simplest fix (Jim's own suggestion — "it can go away
   * entirely when a race isn't on") is to never build the arch on the
   * walk-past ring in the first place, rather than maintain a second,
   * correctly-scaled-down rainbow for it: one arch, shown exactly when the
   * ring that carries it is shown.
   *
   * The arch has no collision role to worry about either way — see
   * `buildArch`'s own "Nothing here is solid" note — so there is no stale
   * collider to leave behind by not building it here.
   */
  readonly showArch: boolean;
}

export function buildRailRaceTrack(
  route: RailRaceRoute,
  layout: HazardLayout,
  collision: CollisionWorld,
  options: RailRaceTrackOptions,
): RailRaceTrack {
  // Everything with a real width on this ring comes off its own scale — there
  // is no `RIDE_SCALE` below this line.
  const ringScale = route.scale;
  const railGauge = RAIL_GAUGE_AT_PARK_SCALE * ringScale;
  const barHalfSpan = BAR_HALF_SPAN_AT_PARK_SCALE * ringScale;
  const duckClearance = DUCK_CLEARANCE_AT_PARK_SCALE * ringScale;
  /**
   * How big this ring is **relative to the race ring** — 1 on the race ring,
   * 0.4 on the walk-past one.
   *
   * Everything in this file that is written as a bare number (a leg's radius, a
   * flag's width, the duck-bar asset's own authored size) was authored looking
   * at the race ring, so that is the size it means; multiplying by this gives
   * the same thing on a smaller ring and leaves the race ring untouched to the
   * bit. Vertical *clearances* deliberately do not take it: a park-scale child
   * riding the walk-past ring still needs her head-height under the arch,
   * whatever size the ring she is on.
   */
  const ringSizeVsRace = ringScale / RIDE_SCALE;

  const group = new Group();
  group.name = options.ringName;
  const disposables: { dispose(): void }[] = [];
  const keep = (item: { dispose(): void }): void => {
    disposables.push(item);
  };

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const position = new Vector3();
  const one = new Vector3(1, 1, 1);
  /** The duck-bar asset's own size on this ring — see {@link ringSizeVsRace}. */
  const assetScale = new Vector3(ringSizeVsRace, ringSizeVsRace, ringSizeVsRace);
  const scale = new Vector3();
  const outward = new Vector3();
  const point = new Vector3();
  const ACROSS = new Vector3(1, 0, 0);
  const UP = new Vector3(0, 1, 0);

  // --- the rails -------------------------------------------------------------
  //
  // Vertex-coloured, not a flat per-lane material colour: Jim, 1 August 2026,
  // after the spark-zone plate shipped — "make the actual track back[sic,
  // black] as well" — the pink/sky/lemon/mint rail was still visibly its own
  // colour under and beside the black plate, especially from the side-on race
  // camera. `setSparking` below repaints the same zone×lane's own rail
  // vertices, exactly the way it already repaints the plate.
  const railMaterials = LANE_COLOURS.map(() => {
    const material = toonMaterial(0xffffff);
    material.vertexColors = true;
    return material;
  });
  for (const material of railMaterials) keep(material);
  // Every lane's rail tube has the same `tubularSegments` — same `route.length`,
  // same `RAIL_TUBULAR_PER_METRE` for every lane's `sweptRails` call below — so
  // the mapping from a ring of the tube to which hazard zone it falls in is
  // identical for every lane and every rail. Built once, ahead of the lane
  // loop, rather than once per lane×rail.
  const railTubularSegments = Math.ceil(route.length * RAIL_TUBULAR_PER_METRE);
  const railZoneVertexRanges = buildRailZoneVertexRanges(
    route,
    layout,
    railTubularSegments,
    RAIL_RADIAL_SEGMENTS,
  );
  // Per lane: every rail vertex's own lane colour, the "nothing is black at
  // all" state a hazard-free level shows. `paintRestingRailColours` below
  // derives the actual resting buffer from this — with the spark zones inked
  // over it whenever the chosen level has them live.
  const railBaseColoursByLane: Float32Array[] = [];
  const railColourAttributesByLane: BufferAttribute[][] = [];

  // --- the sleepers ----------------------------------------------------------
  //
  // Wooden, like the Sky Cruiser's ties and like a real sleeper — the one part
  // of a support structure that is *not* the grey the trestles below are, so the
  // ring reads as timber laid on stone rather than as one grey mass.
  const timberMaterial = toonMaterial(PALETTE.woodLight);
  keep(timberMaterial);
  //
  // Built inside the lane loop below, off the very same `sampler` the rails are
  // swept from, and oriented by `railFrameAt` — the same horizontal side/up/
  // forward frame `sweptRail.ts` offsets the rails with. That is the whole
  // argument for their landing on the rails: shared construction, not a second
  // formula that agrees today. `scripts/check-tie-frame.mts` exists because the
  // Sky Cruiser once used a *minimal* rotation onto the tangent here and its
  // sleepers rolled off the rails on every climb (#112).
  const sleeperGeometry = new BoxGeometry(1, 1, 1);
  keep(sleeperGeometry);
  const sleepersPerLane = Math.floor(route.length / SLEEPER_SPACING);
  const sleepers = new InstancedMesh(
    sleeperGeometry,
    timberMaterial,
    Math.max(1, sleepersPerLane * LANE_COUNT),
  );
  let sleeperIndex = 0;
  const sleeperBasis = new Matrix4();
  const sleeperMid = new Vector3();
  const sleeperFrame: RailFrame = {
    position: sleeperMid,
    forward: new Vector3(),
    side: new Vector3(),
    up: new Vector3(),
  };
  const sleeperRotation = new Quaternion();
  const sleeperScale = new Vector3(
    railGauge + SLEEPER_OVERHANG * 2 * ringSizeVsRace,
    SLEEPER_THICKNESS * ringSizeVsRace,
    SLEEPER_ALONG_TRACK * ringSizeVsRace,
  );
  // Sunk so the rail rests **on** the sleeper rather than through it: the rail's
  // own radius plus half the sleeper's thickness, both taken from the numbers
  // the two are actually built from, so neither can drift from the other.
  const railRadius = RAIL_RADIUS_AT_PARK_SCALE * ringSizeVsRace * RIDE_SCALE;
  const sleeperDrop = railRadius + (SLEEPER_THICKNESS * ringSizeVsRace) / 2;

  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    // The adapter that makes a lane of this ring look like any other route in
    // the park to the shared sweeper.
    const sampler: RailSampler = {
      length: route.length,
      pointAt: (distance, target) => route.pointAt(lane, distance, target),
      tangentAt: (distance, target) => route.tangentAt(lane, distance, target),
    };
    for (let i = 0; i < sleepersPerLane; i += 1) {
      railFrameAt(sampler, i * SLEEPER_SPACING, sleeperFrame);
      sleeperBasis.makeBasis(sleeperFrame.side, sleeperFrame.up, sleeperFrame.forward);
      sleeperRotation.setFromRotationMatrix(sleeperBasis);
      matrix.compose(
        point.copy(sleeperMid).setY(sleeperMid.y - sleeperDrop),
        sleeperRotation,
        sleeperScale,
      );
      sleepers.setMatrixAt(sleeperIndex, matrix);
      sleeperIndex += 1;
    }
    const railMaterial = railMaterials[lane % railMaterials.length]!;
    const laneColour = new Color(LANE_COLOURS[lane % LANE_COLOURS.length]!);
    let baseColours: Float32Array | null = null;
    const attributes: BufferAttribute[] = [];
    for (const geometry of sweptRails(sampler, {
      gauge: railGauge,
      radius: 0.075 * ringSizeVsRace * RIDE_SCALE,
      // The ring bends at a constant, gentle 1/53.5 per metre; it does not need
      // the coaster's two segments a metre, and this is paid eight times over.
      tubularPerMetre: RAIL_TUBULAR_PER_METRE,
      step: 2.2,
      radialSegments: RAIL_RADIAL_SEGMENTS,
    })) {
      const rail = new Mesh(geometry, railMaterial);
      rail.name = `railRace:rail-${lane}`;
      // The shadow on the lawn is the only thing that tells a child how high up
      // this is, which is most of the feeling of the ride.
      rail.castShadow = true;
      group.add(rail);
      keep(geometry);

      // Both rails of a lane (`sweptRails` returns `[left, right]`) share the
      // same tube topology — only their sideways offset differs — so one base
      // colour buffer built from the first is valid for the second too.
      const vertexCount = geometry.attributes.position!.count;
      if (!baseColours) {
        baseColours = new Float32Array(vertexCount * 3);
        for (let i = 0; i < vertexCount; i += 1) {
          baseColours[i * 3] = laneColour.r;
          baseColours[i * 3 + 1] = laneColour.g;
          baseColours[i * 3 + 2] = laneColour.b;
        }
      }
      const attribute = new BufferAttribute(baseColours.slice(), 3);
      geometry.setAttribute('color', attribute);
      attributes.push(attribute);
    }
    railBaseColoursByLane[lane] = baseColours!;
    railColourAttributesByLane[lane] = attributes;
  }

  sleepers.count = sleeperIndex;
  sleepers.instanceMatrix.needsUpdate = true;
  // Named so `test/procgen/invariants.ts` can measure the real instance buffer.
  sleepers.name = 'railRace:sleepers';
  // Not casters, and that is a judgement rather than a saving — the same one
  // `coaster/Coaster.ts` writes down for its ties. At this spacing a sleeper's
  // shadow is a fine stripey comb that `VSMShadowMap`'s soft edges turn to mush,
  // and the eight rail tubes above already cast the shadow that tells a child
  // how high the ring is. 4800 extra casters would be drawn twice each.
  sleepers.frustumCulled = false;
  group.add(sleepers);

  // --- the black stretches ---------------------------------------------------
  //
  // One ribbon geometry across every zone of every lane: a plate laid between
  // the two rails, dark instead of pink, which is the "black part of the track"
  // in the brief. One geometry and one material, so the whole set is one draw
  // call however many stretches the layout produces — per-vertex colour (like
  // the duck-bar sleeves' per-instance colour below) is what lets that one draw
  // call still light up just the zone×lane actually sparking, rather than
  // needing a material — and therefore a draw call — per stretch.
  const sparkMaterial = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  keep(sparkMaterial);
  const { geometry: sparkGeometry, segments: sparkSegments } = buildSparkRibbons(route, layout);
  keep(sparkGeometry);
  const sparkVertexCount = sparkGeometry.attributes.position!.count;
  const sparkColours = new Float32Array(sparkVertexCount * 3);
  const inkFill = new Color(PALETTE.ink);
  for (let i = 0; i < sparkVertexCount; i += 1) {
    sparkColours[i * 3] = inkFill.r;
    sparkColours[i * 3 + 1] = inkFill.g;
    sparkColours[i * 3 + 2] = inkFill.b;
  }
  const sparkColourAttribute = new BufferAttribute(sparkColours, 3);
  sparkGeometry.setAttribute('color', sparkColourAttribute);
  // Keyed the same way `active` segments arrive from `RailRace.ts`, so
  // `setSparking` is an O(active carts) lookup rather than a scan of every
  // zone×lane every frame.
  const sparkSegmentsByKey = new Map<string, { vertexStart: number; vertexCount: number }>();
  for (const segment of sparkSegments) {
    sparkSegmentsByKey.set(segmentKey(segment.zoneIndex, segment.lane), segment);
  }
  const sparkRibbons = decal(new Mesh(sparkGeometry, sparkMaterial));
  sparkRibbons.name = 'railRace:spark-zones';
  sparkRibbons.frustumCulled = false;
  group.add(sparkRibbons);

  // The rails' *resting* colours — what `setSparking` resets every rail to
  // each frame before painting the actively-sparking stretches. Not the same
  // thing as `railBaseColoursByLane`: whenever the chosen level has live
  // spark zones, the zone stretches of every rail are ink *at rest*. "Make
  // the tracks black" (Jim, 1–2 August 2026, twice) means the bit the wheels
  // run on, not just the plate laid between the rails — the first pass at
  // this (PR #164) only ever inked the rail *while a rider was actively
  // sparking on it*, a transient flicker, so in every calm frame the zone
  // read as a black plate under proudly pink rails. Sparking now flashes
  // over rail that is already black, exactly as it does over the plate.
  const railRestingColoursByLane: Float32Array[] = railBaseColoursByLane.map((base) =>
    base.slice(),
  );
  const paintRestingRailColours = (zonesLive: boolean): void => {
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const resting = railRestingColoursByLane[lane];
      const base = railBaseColoursByLane[lane];
      if (!resting || !base) continue;
      resting.set(base);
      if (zonesLive) {
        for (const ranges of railZoneVertexRanges) {
          for (const { vertexStart, vertexCount } of ranges) {
            const end = vertexStart + vertexCount;
            for (let v = vertexStart; v < end; v += 1) {
              resting[v * 3] = inkFill.r;
              resting[v * 3 + 1] = inkFill.g;
              resting[v * 3 + 2] = inkFill.b;
            }
          }
        }
      }
      // Stamped straight into the live attributes too, not left for the next
      // `setSparking` to pick up — a headless park never calls `setSparking`
      // at all, and the level choice should show the moment it is made.
      for (const attribute of railColourAttributesByLane[lane] ?? []) {
        (attribute.array as Float32Array).set(resting);
        attribute.needsUpdate = true;
      }
    }
    // This has just overwritten the very buffers `setSparking` caches against,
    // so its "nothing has changed" answer is no longer true. The one other
    // writer telling the cache it is stale is what stops the guard below from
    // pinning a stale paint on screen — see issue #190.
    sparkPaintDirty = true;
  };

  /**
   * Whether {@link setSparking}'s last painted state still stands.
   *
   * `setSparking` reuploads eight rail colour buffers — about 473 KB — and
   * before this it did so on **every frame**, including every frame of ordinary
   * walking-about play, because `RailRace.update` runs `animate()` in its
   * `'waiting'` phase too. The output only depends on two things (the flash
   * phase and which zone×lane pairs are sparking), so when neither has moved
   * the buffers already hold the right bytes and the whole thing is skippable.
   */
  let sparkPaintDirty = true;
  let lastFlash = -1;
  const sparkSlots = railZoneVertexRanges.length * LANE_COUNT;
  // Two reused masks, never reallocated: this is called every frame, and the
  // guard existing to save bandwidth must not spend garbage collection instead.
  const activeMask = new Uint8Array(sparkSlots);
  const lastActiveMask = new Uint8Array(sparkSlots);

  // --- where the trestles actually stand, computed before the duck bars ------
  // A duck bar's own visible support comes from here — see `hazards.ts`'s
  // `snapToTrestleGrid` and `trestleSpots`'s own doc comment for why bars and
  // trestles now share one grid index rather than being placed independently.
  const mandatoryTrestleIndices = new Set(
    layout.bars.map((bar) => trestleGridIndex(bar.at, route.length)),
  );
  const spots = trestleSpots(
    route,
    collision,
    options.groundClaims,
    RAIL_RACE_FEATURE,
    options.ringName,
    ringSizeVsRace,
    mandatoryTrestleIndices,
  );
  const spotByIndex = new Map(spots.map((spot) => [spot.index, spot]));
  // **The supports' claims** — the very claims the search was answered with,
  // returned on the track for `RailRace.ts` to commit with the other ring's as
  // one feature. A ring's legs never collide with each other through the
  // registry (a feature is its own business), and the arc bound in
  // `trestleSpots` is what keeps two neighbouring slots off the same ground.
  const claims: readonly Claim[] = spots.flatMap((spot) => spot.claims);

  // --- the duck bars ---------------------------------------------------------
  //
  // One bar object, one bar — not one object drawn once per lane. See
  // `hazards.ts`'s `DuckBar.lane`: four bars at one arc distance overlapped by
  // 3.00 m because a bar is 5.75 m wide and the lanes are 2.75 m apart.
  const barCount = layout.bars.length;
  const frameMaterial = toonMaterial(PALETTE.buildingTrim);
  // Diagonal yellow-and-black hazard tape (Jim, 1 August 2026) — a canvas
  // texture, not baked into the asset; see `hazardTapeTexture`'s own doc
  // comment for why, and why the base colour is white (the texture already
  // carries both stripe colours — a tinted base would recolour the black
  // stripes too).
  const barMaterial = toonMaterial(0xffffff, { map: hazardTapeTexture() });
  keep(frameMaterial);
  keep(barMaterial);

  // Shape from the asset (`art/blend/duckbar.blend`), not procedural
  // primitives — see `HANDOFF-duck-bar-blender-asset.md` for why: Jim, after
  // a numbers-only height fix still wasn't right, "sizing is a Blender asset
  // issue not a game engine issue." Shared, `markShared` geometry (the whole
  // ring's worth of posts and bars all point at these same two buffers), so
  // — unlike `sleeveGeometry` below — these must never be pushed to
  // `disposables`: see `dispose()`'s own note.
  const postGeometry = duckBarAssetGeometry('post');
  const barGeometry = duckBarAssetGeometry('bar');
  /**
   * **How much the posts have to be stretched to reach the bar they hold up.**
   *
   * The post is authored 4.70 m tall, and 4.70 is exactly the (mistaken) crown
   * height `DUCK_CLEARANCE_AT_PARK_SCALE`'s old value was derived from — so
   * the post only ever reached its bar by coincidence of the two having been
   * sized against the same wrong number on the same day. Correcting the
   * clearance would have left every bar in the ring floating three quarters of
   * a metre above its own posts.
   *
   * So the reach is *derived* from the clearance rather than left to agree with
   * it: measured off the asset's own bounding box, never a written-down 4.70,
   * and applied on Y alone. A vertical post made taller is the one case where
   * stretching an authored asset costs nothing — nothing about its shape reads
   * differently, unlike the bar, which keeps its authored proportions exactly.
   */
  postGeometry.computeBoundingBox();
  const postBox = postGeometry.boundingBox;
  const postHeight = postBox ? postBox.max.y - postBox.min.y : 1;
  /** Where the foot of a post sits above the rail head. */
  const postFootY = 0.15 * ringScale;
  const postStretch = (duckClearance - postFootY) / (postHeight * ringSizeVsRace);
  const postScale = new Vector3(
    ringSizeVsRace,
    ringSizeVsRace * postStretch,
    ringSizeVsRace,
  );
  // The bar itself is the warning light. Lamps on the posts were legible at a
  // standstill and invisible at fourteen metres a second; a stripe of amber
  // right where the thing you must duck under is cannot be missed. A sleeve
  // around the bar rather than the bar's own material, so the toon shading
  // underneath still shapes it. Kept procedural (not part of the asset): its
  // whole job is to be resized and recoloured every frame by `setAlerts`,
  // which is exactly the "appearance from code" half of the split — a fixed
  // authored shape has nothing to offer a part that never looks the same way
  // twice.
  const sleeveGeometry = new BoxGeometry(
    barHalfSpan * 2 - 0.04 * ringScale,
    0.28 * ringScale,
    0.32 * ringScale,
  );
  keep(sleeveGeometry);

  const posts = new InstancedMesh(postGeometry, frameMaterial, Math.max(1, barCount * 2));
  const bars = new InstancedMesh(barGeometry, barMaterial, Math.max(1, barCount));
  const sleeveMaterial = new MeshBasicMaterial({
    color: PALETTE.signBoard,
    toneMapped: false,
    transparent: true,
    opacity: 0.92,
  });
  keep(sleeveMaterial);
  const sleeves = new InstancedMesh(sleeveGeometry, sleeveMaterial, Math.max(1, barCount));

  let postIndex = 0;
  let barIndex = 0;
  // Where each bar's sleeve instance lives, so `setAlerts` can find them again:
  // `barSlots[b]` holds the instance id of bar `b`. A list per bar rather than a
  // bare number because a bar whose trestle was never placed contributes no
  // instance at all, and `setAlerts` must skip it rather than shift every id
  // after it by one.
  const barSlots: number[][] = [];
  /**
   * Every post takes **its own lane's** colour — the same `LANE_COLOURS` entry
   * as that lane's rails and cart, read from the one owner rather than a second
   * palette. Jim, 7 August 2026: "make their legs the colour of the track they
   * apply to."
   *
   * **This is deliberately the opposite decision from the trestles below**, and
   * the two are not in tension. A trestle carries all four lanes at once, so it
   * cannot belong to any one of them and Jim asked for it in a single neutral
   * grey. A duck bar belongs to exactly one lane, and now that bars are spread
   * around the lap instead of stacked four abreast, its colour is the only thing
   * that answers "is that one mine?" at fourteen metres a second.
   *
   * Per-instance colour on one shared `InstancedMesh`, the same trick `sleeves`
   * uses for its alert state — one draw call for every post in the ring, four
   * lane colours and all.
   */
  const postLaneColour = new Color();

  for (const bar of layout.bars) {
    const slots: number[] = [];
    // The bar's own visible support — see the block above. Every bar's grid
    // index is mandatory, so this should always be found; the fallback below
    // (dropping the bar's geometry rather than rendering it with no support)
    // is defence in depth for the `console.warn`-logged edge case in
    // `trestleSpots`, not the expected path.
    const index = trestleGridIndex(bar.at, route.length);
    const spot = spotByIndex.get(index);
    if (!spot) {
      barSlots.push(slots);
      continue;
    }
    // **The bar hangs at the position it is scored at, full stop.**
    //
    // This used to be `spot.at` — its supporting trestle's position, including
    // that trestle's own collision-avoidance nudge along the loop — so that bar
    // and leg stayed exactly coincident, on the argument that an arc nudge
    // therefore "costs nothing". It costs the hazard its correctness:
    // `simulate.ts` bonks at `bar.at`, knows nothing of
    // any nudge, and on the canonical seed every one of the seven bars was
    // being drawn 2.00 m before the point that actually bonked you. A rider
    // flew clean through the bar and lost her speed a cart's length later —
    // Jim, riding it, 5 August 2026.
    //
    // Drawn here at `bar.at` instead, the two are the same number by
    // construction rather than by two systems agreeing to keep in step. The
    // trestle keeps its nudge; a bar's own posts stand on the rails, not on the
    // trestle, so what the nudge now costs is only that the leg far below may
    // sit a couple of metres along from the bar — well inside the
    // `DUCK_BAR_SUPPORT_TOLERANCE` the invariant already allows for the radial
    // nudge, which always moved the leg out from under the bar anyway.
    const at = route.wrap(route.startDistance + bar.at);
    route.outwardAt(at, outward);
    rotation.setFromUnitVectors(ACROSS, outward);
    route.pointAt(bar.lane, at, point);
    const barY = point.y + duckClearance;
    postLaneColour.set(LANE_COLOURS[bar.lane % LANE_COLOURS.length]!);

    for (const side of [-1, 1] as const) {
      position.set(
        point.x + outward.x * side * barHalfSpan,
        point.y + postFootY + (postHeight * postStretch) / 2,
        point.z + outward.z * side * barHalfSpan,
      );
      matrix.compose(position, rotation, postScale);
      posts.setMatrixAt(postIndex, matrix);
      posts.setColorAt(postIndex, postLaneColour);
      postIndex += 1;
    }

    position.set(point.x, barY, point.z);
    matrix.compose(position, rotation, assetScale);
    bars.setMatrixAt(barIndex, matrix);
    // The sleeve's own geometry is already built at this ring's size (see
    // `sleeveGeometry`), so it must not take the asset scale on top — and
    // `setAlerts` below decomposes this matrix and re-composes it with
    // `(1, size, size)`, which assumes exactly that.
    matrix.compose(position, rotation, one);
    sleeves.setMatrixAt(barIndex, matrix);
    slots.push(barIndex);
    barIndex += 1;
    barSlots.push(slots);
  }

  posts.count = postIndex;
  bars.count = barIndex;
  sleeves.count = barIndex;
  // Named so `test/procgen/invariants.ts` can find the bars in the built
  // scene and measure them against the trestle legs directly, the same
  // reason the trestle meshes below are named.
  posts.name = 'railRace:duck-bar-posts';
  bars.name = 'railRace:duck-bars';
  for (const mesh of [posts, bars, sleeves]) {
    mesh.instanceMatrix.needsUpdate = true;
    // The bars stand nine metres up on a ring that is mostly out of shot; per
    // instance culling is not worth the bounds maths.
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  // Every post's colour was set as it was placed above; flip the attribute
  // live once, the same way the matrix update above is one flip after every
  // instance is written rather than one per instance.
  posts.instanceColor!.needsUpdate = true;
  // Per-instance colour is what lets one draw call hold four lanes' worth of
  // warning lamps at four different states of alarm.
  sleeves.setColorAt(0, CALM);
  sleeves.instanceColor!.needsUpdate = true;

  // --- the trestles ----------------------------------------------------------

  // One colour for the whole support tree — trunk and both generations of
  // branch — which is Jim's "the supports can all be one colour that
  // doesn't clash with the track itself, such as grey".
  //
  // Grey, but **not** a neutral one. `ART.statueStone`'s own doc comment is the
  // park's ruling on this: a genuinely desaturated grey next to this palette
  // "reads as a hole punched in the picture", so the sanctioned grey carries a
  // nine-point red lift and a whisper of rose. It is comfortably clear of all
  // four {@link LANE_COLOURS} (pink, sky, lemon, mint), which is the actual
  // requirement — the old `stonePinkLight` was a pale pink standing under a
  // pink rail. Light rather than dark for the reason that file gives too: the
  // toon ramp's darkest band is ~68% brightness, so dark stone goes muddy in
  // shade and vanishes at night, and these are nine metres up under the deck.
  const trestleMaterial = toonMaterial(ART.statueStone);
  keep(trestleMaterial);

  // `spots` was already computed above, before the duck bars, so their
  // supports could be looked up by grid index.
  //
  // Three unit-height cylinders rather than one: a branch is thinner than the
  // trunk it grew from, and a taper baked into the geometry costs nothing,
  // where faking it with a non-uniform instance scale would squash the
  // cross-section into an ellipse.
  //
  // Radii from `STRUT_RADII`, the same table `trestleClaims` reads: a
  // `CylinderGeometry` takes its top radius first, and `strut` stands the
  // cylinder from `from` (its bottom) to `to` (its top).
  const legGeometry = new CylinderGeometry(STRUT_RADII.legs.to, STRUT_RADII.legs.from, 1, 8);
  const lowerBranchGeometry = new CylinderGeometry(
    STRUT_RADII['branches-lower'].to,
    STRUT_RADII['branches-lower'].from,
    1,
    8,
  );
  const upperBranchGeometry = new CylinderGeometry(
    STRUT_RADII['branches-upper'].to,
    STRUT_RADII['branches-upper'].from,
    1,
    8,
  );
  keep(legGeometry);
  keep(lowerBranchGeometry);
  keep(upperBranchGeometry);

  const legs = new InstancedMesh(legGeometry, trestleMaterial, Math.max(1, spots.length));
  // Two lower branches and four upper ones per trestle. Two meshes rather than
  // one because the two generations are different thicknesses.
  const lowerBranches = new InstancedMesh(
    lowerBranchGeometry,
    trestleMaterial,
    Math.max(1, spots.length * 2),
  );
  const upperBranches = new InstancedMesh(
    upperBranchGeometry,
    trestleMaterial,
    Math.max(1, spots.length * LANE_COUNT),
  );
  let lowerIndex = 0;
  let upperIndex = 0;

  /**
   * Stands one unit-height cylinder between two world points.
   *
   * Every part of the tree — trunk, both generations of branch — is placed
   * through here, so a branch cannot end up somewhere its own endpoints do not
   * say it is. The one formula, used seven times per trestle.
   */
  const strut = (mesh: InstancedMesh, index: number, from: Vector3, to: Vector3): void => {
    const span = to.clone().sub(from);
    const length = span.length();
    if (length < 1e-6) return;
    rotation.setFromUnitVectors(UP, span.divideScalar(length));
    position.copy(from).lerp(to, 0.5);
    scale.set(ringSizeVsRace, length, ringSizeVsRace);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
  };

  spots.forEach((spot, index) => {
    // **Drawn from the tree the search solved, allowed and claimed** — not
    // re-solved here. `trestleTreeAt` is the one owner of the shape (a branch
    // top is the middle of the lane it carries; a fork node sits under the
    // midpoint of its pair; heights measured down from the lowest lane, never
    // the mean — see its doc comment), and `trestleStruts` the one owner of
    // which points make which strut. The foot stands exactly where the search
    // found clear ground, so a moved foot is a lean, not a moved support.
    const meshes = {
      legs,
      'branches-lower': lowerBranches,
      'branches-upper': upperBranches,
    } as const;
    for (const piece of trestleStruts(spot.tree)) {
      const mesh = meshes[piece.part];
      const slot = piece.part === 'legs' ? index : piece.part === 'branches-lower' ? lowerIndex++ : upperIndex++;
      strut(mesh, slot, piece.from, piece.to);
    }

  });

  legs.count = spots.length;
  lowerBranches.count = lowerIndex;
  upperBranches.count = upperIndex;
  // Named so `test/procgen/invariants.ts` can find the legs in the built scene
  // and measure where they actually landed, rather than re-deriving the rules
  // that placed them.
  legs.name = 'railRace:trestle-legs';
  lowerBranches.name = 'railRace:trestle-branches-lower';
  upperBranches.name = 'railRace:trestle-branches-upper';
  for (const mesh of [legs, lowerBranches, upperBranches]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    group.add(mesh);
  }

  // --- the start/finish arch -------------------------------------------------
  // See `RailRaceTrackOptions.showArch` — only the race ring gets one.
  if (options.showArch) {
    group.add(buildArch(route, ringSizeVsRace, keep));
  }

  // --- the live bits ---------------------------------------------------------
  const tint = new Color();
  const sparkColour = new Color();
  const INK = new Color(PALETTE.ink);
  const FLASH = new Color(PALETTE.fairyWarm);

  // A post is a thing a child can walk into — on the ring that is actually
  // there while she is on foot, and only once both rings have found their
  // ground. See `RailRaceTrack.registerCollision`. Taken from the post's own
  // foot radius: the collider and the thing you can see are the same claim
  // about the same post.
  const registerCollision = (): void => {
    for (const spot of spots) collision.addCircle(spot.x, spot.z, POST_FOOT_RADIUS * ringSizeVsRace);
  };

  return {
    claims,
    registerCollision,
    group,

    setAlerts(lapOffset: number, safe: boolean, elapsed: number): void {
      const colour = sleeves.instanceColor;
      if (!colour) return;
      layout.bars.forEach((bar, index) => {
        // How close the player is to this bar, going forwards. Bars behind are
        // calm; the one coming up swells and colours.
        //
        // **Only her own lane's bars ever alarm.** Since 7 August a bar crosses
        // one lane (`hazards.ts`'s `DuckBar.lane`) and `simulate.ts` only bonks
        // her on her own, so a rival's bar swelling amber as she passes it would
        // be teaching her to duck for something that cannot touch her — and with
        // forty bars a lap instead of ten, it would be most of what she sees.
        // The bar's posts still carry its lane colour, which is what makes the
        // other three legible as somebody else's.
        let ahead = bar.at - lapOffset;
        if (ahead < -6) ahead += route.length;
        const mine = bar.lane === PLAYER_LANE;
        const closeness = ahead < 0 || !mine ? 0 : clamp01(1 - ahead / ALERT_RANGE);
        tint.copy(CALM).lerp(safe ? SAFE : WARN, closeness);
        const pulse = 1 + Math.sin(elapsed * (safe ? 7 : 13)) * 0.16 * closeness;
        const size = lerp(0.9, 1.3, closeness) * pulse;
        for (const slot of barSlots[index] ?? []) {
          colour.setXYZ(slot, tint.r, tint.g, tint.b);
          // Size is the second channel. Scaling the sleeve rather than the bar
          // keeps the thing you actually collide with a fixed size — the alert
          // must never change the hitbox, only how loudly it shouts.
          sleeves.getMatrixAt(slot, matrix);
          matrix.decompose(position, rotation, scale);
          matrix.compose(position, rotation, scale.set(1, size, size));
          sleeves.setMatrixAt(slot, matrix);
        }
      });
      colour.needsUpdate = true;
      sleeves.instanceMatrix.needsUpdate = true;
    },

    setSparking(active: readonly SparkingSegment[], elapsed: number): void {
      // A hard flicker rather than a smooth pulse: sparks are not a mood light.
      // One shared clock for every active zone — they don't need independent
      // phases to read as "sparking", only as not-a-smooth-pulse.
      const flash = Math.sin(elapsed * 47) > 0 ? 1 : 0.35;

      // **Nothing to do if nothing has changed.** The painted result is a pure
      // function of `flash` and the active zone×lane set, so when both match the
      // last call the buffers already say exactly this and there is no reason to
      // rewrite 473 KB and mark eight attributes for re-upload. Issue #190.
      activeMask.fill(0);
      for (const { zoneIndex, lane } of active) {
        const slot = zoneIndex * LANE_COUNT + lane;
        if (slot >= 0 && slot < sparkSlots) activeMask[slot] = 1;
      }
      let sameAsLast = !sparkPaintDirty && flash === lastFlash;
      if (sameAsLast) {
        for (let i = 0; i < sparkSlots; i += 1) {
          if (activeMask[i] !== lastActiveMask[i]) {
            sameAsLast = false;
            break;
          }
        }
      }
      if (sameAsLast) return;
      lastFlash = flash;
      lastActiveMask.set(activeMask);
      sparkPaintDirty = false;

      sparkColour.copy(INK).lerp(FLASH, flash);
      const array = sparkColourAttribute.array as Float32Array;
      // Every vertex starts each frame calm, so a zone that stopped sparking
      // since last frame goes dark again rather than sticking lit.
      for (let i = 0; i < array.length; i += 3) {
        array[i] = INK.r;
        array[i + 1] = INK.g;
        array[i + 2] = INK.b;
      }
      for (const { zoneIndex, lane } of active) {
        const segment = sparkSegmentsByKey.get(segmentKey(zoneIndex, lane));
        if (!segment) continue;
        const end = segment.vertexStart + segment.vertexCount;
        for (let v = segment.vertexStart; v < end; v += 1) {
          array[v * 3] = sparkColour.r;
          array[v * 3 + 1] = sparkColour.g;
          array[v * 3 + 2] = sparkColour.b;
        }
      }
      sparkColourAttribute.needsUpdate = true;

      // The rails themselves — same reset-then-repaint shape as the ribbons
      // above, same `sparkColour` (one shared flash for the plate and the
      // rail underneath it, so they never go out of phase with each other).
      // Reset to the *resting* buffer, not the bright lane base: at any level
      // with live zones the zone stretches are black at rest, and resetting
      // to the base here was exactly how the first pass lost the static
      // marking — see `paintRestingRailColours`'s own comment.
      for (let lane = 0; lane < LANE_COUNT; lane += 1) {
        const resting = railRestingColoursByLane[lane];
        if (!resting) continue;
        for (const attribute of railColourAttributesByLane[lane] ?? []) {
          (attribute.array as Float32Array).set(resting);
        }
      }
      for (const { zoneIndex, lane } of active) {
        const ranges = railZoneVertexRanges[zoneIndex];
        if (!ranges) continue;
        for (const attribute of railColourAttributesByLane[lane] ?? []) {
          const railArray = attribute.array as Float32Array;
          for (const { vertexStart, vertexCount } of ranges) {
            const end = vertexStart + vertexCount;
            for (let v = vertexStart; v < end; v += 1) {
              railArray[v * 3] = sparkColour.r;
              railArray[v * 3 + 1] = sparkColour.g;
              railArray[v * 3 + 2] = sparkColour.b;
            }
          }
        }
      }
      for (const attributes of railColourAttributesByLane) {
        for (const attribute of attributes) attribute.needsUpdate = true;
      }
    },

    setHazardLevel(level: RaceLevel): void {
      const zonesLive = level >= ZONES_FROM_LEVEL;
      sparkRibbons.visible = zonesLive;
      // The rails' own black stretches follow the same switch as the plate:
      // ink at rest wherever a zone is live, bright lane colour end to end on
      // the hazard-free level.
      paintRestingRailColours(zonesLive);
      const barsLive = level >= BARS_FROM_LEVEL;
      posts.visible = barsLive;
      bars.visible = barsLive;
      sleeves.visible = barsLive;
    },

    dispose(): void {
      // `postGeometry`/`barGeometry` are deliberately never in `disposables`
      // — they come from `duckBarAsset.ts`'s shared, `markShared` cache, the
      // same one every other trestle span's posts and bars point at, so
      // freeing them here would corrupt the rest of the ring. Everything
      // else this track built for itself (rails, spark ribbons, the sleeve
      // geometry, every material) is.
      for (const item of disposables) item.dispose();
    },
  };
}

// ---------------------------------------------------------------- internals

/** Where one zone×lane's vertices live in the combined spark-ribbon geometry. */
interface SparkRibbonSegment extends SparkingSegment {
  readonly vertexStart: number;
  readonly vertexCount: number;
}

/** The lookup key `setSparking` and `buildSparkRibbons` agree on. */
function segmentKey(zoneIndex: number, lane: number): string {
  return `${zoneIndex}:${lane}`;
}

/**
 * The dark plates laid between the rails wherever the track goes black.
 *
 * Built by hand as one indexed mesh rather than as a tube per zone: there are
 * `zones × lanes` of them, they are flat, and a strip of quads is both cheaper
 * to build and cheaper to draw than a dozen short tubes with their own
 * materials. Same idea as `train/track.ts`'s ballast ribbon.
 *
 * Also returns, per zone×lane, which vertices of the one combined buffer are
 * theirs — `setSparking` writes a `color` attribute over just that range, so
 * one draw call can still show one zone lit and its neighbours dark.
 */
function buildSparkRibbons(
  route: RailRaceRoute,
  layout: HazardLayout,
): { geometry: BufferGeometry; segments: readonly SparkRibbonSegment[] } {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const segments: SparkRibbonSegment[] = [];
  const point = new Vector3();
  const outward = new Vector3();
  // This ring's own gauge, not the race ring's: the plate has to lie between
  // the rails of the track it is actually painted on.
  const half = RAIL_GAUGE_AT_PARK_SCALE * route.scale * 0.5;
  const lift = 0.055 * (route.scale / RIDE_SCALE);

  layout.zones.forEach((zone, zoneIndex) => {
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const divisions = Math.max(4, Math.ceil((zone.to - zone.from) / 1.2));
      const base = positions.length / 3;
      const vertexStart = base;
      for (let i = 0; i <= divisions; i += 1) {
        // `zone.from`/`zone.to` are measured from the start/finish arch (see
        // `hazards.ts`), but `route.pointAt`/`outwardAt` measure from the
        // route's own raw zero — the arch sits at `route.startDistance`, not
        // at 0. A rider at `travelled` renders at
        // `route.wrap(route.startDistance + travelled)` (see `placeCarts` in
        // `RailRace.ts`); the geometry has to land on that same point.
        const distance = route.wrap(route.startDistance + zone.from + ((zone.to - zone.from) * i) / divisions);
        route.pointAt(lane, distance, point);
        route.outwardAt(distance, outward);
        // A whisker above the rail heads, so it reads as a plate on the track
        // rather than a stripe buried in it.
        const y = point.y + lift;
        positions.push(
          point.x - outward.x * half,
          y,
          point.z - outward.z * half,
          point.x + outward.x * half,
          y,
          point.z + outward.z * half,
        );
        normals.push(0, 1, 0, 0, 1, 0);
        if (i > 0) {
          const a = base + (i - 1) * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      segments.push({ zoneIndex, lane, vertexStart, vertexCount: positions.length / 3 - vertexStart });
    }
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return { geometry, segments };
}

/**
 * Which vertex ranges of a lane's `sweptRails` tube fall inside each hazard
 * zone — the rail's own analogue of {@link buildSparkRibbons}'s `segments`,
 * used by `setSparking` to blacken the actual rail, not just the plate laid
 * over it. Indexed by `HazardLayout.zones`' own index, one array of ranges
 * per zone (almost always one range; two only if a zone straddles the route's
 * own `0`/`length` seam).
 *
 * **Why an approximation, and why it is a safe one.** `three`'s `TubeGeometry`
 * places ring `i`'s vertices at `path.getPointAt(i / tubularSegments)` (see
 * its own `generateSegment`) — arc length along the *fitted* Catmull-Rom curve
 * `sweptRail` builds through evenly-spaced samples of the route, not the
 * route's own `distance` parameter directly. Treating ring `i` as sitting at
 * route distance `(i / tubularSegments) * route.length` is therefore not
 * exact. But `RailRaceRoute`'s horizontal shape is a plain circle (only
 * height varies — see that file's own header) sampled every 2.2 m, so the
 * fitted curve's arc length tracks `route.length` to within centimetres —
 * orders of magnitude under a zone's 15–23 m length (`ZONE_MIN`/`ZONE_MAX`,
 * `hazards.ts`). Good enough to blacken the same stretch the plate above it
 * already blackens, without this file duplicating `sweptRail.ts`'s own
 * cross-section maths to get an exact one.
 *
 * `rawFrom`/`rawTo` (built from `route.startDistance + zone.from/to`, never
 * wrapped) are compared against each ring's distance offset by
 * `-route.length`/`0`/`+route.length` rather than wrapping the zone bounds
 * themselves — the same "does any copy of this point, one lap either way,
 * land in the interval" test, just phrased so a zone that straddles the
 * route's own coordinate seam does not need special-casing.
 */
function buildRailZoneVertexRanges(
  route: RailRaceRoute,
  layout: HazardLayout,
  tubularSegments: number,
  radialSegments: number,
): readonly (readonly { vertexStart: number; vertexCount: number }[])[] {
  const verticesPerRing = radialSegments + 1;
  return layout.zones.map((zone) => {
    const rawFrom = route.startDistance + zone.from;
    const rawTo = route.startDistance + zone.to;
    const ranges: { vertexStart: number; vertexCount: number }[] = [];
    // Ring `tubularSegments` duplicates ring `0` (the tube is closed — see
    // `generateSegment`'s own comment on why), so `ring % tubularSegments`
    // gives it ring 0's distance rather than treating it as one step further
    // round than the loop actually goes.
    let runStart = -1;
    for (let ring = 0; ring <= tubularSegments; ring += 1) {
      const distance = ((ring % tubularSegments) / tubularSegments) * route.length;
      const inZone = [distance - route.length, distance, distance + route.length].some(
        (d) => d >= rawFrom && d <= rawTo,
      );
      if (inZone) {
        if (runStart === -1) runStart = ring;
      } else if (runStart !== -1) {
        ranges.push({
          vertexStart: runStart * verticesPerRing,
          vertexCount: (ring - runStart) * verticesPerRing,
        });
        runStart = -1;
      }
    }
    if (runStart !== -1) {
      ranges.push({
        vertexStart: runStart * verticesPerRing,
        vertexCount: (tubularSegments + 1 - runStart) * verticesPerRing,
      });
    }
    return ranges;
  });
}

/**
 * **One trestle, as the seven struts it is drawn from** — the trunk, the two
 * lower branches, the four upper ones — solved for one slot and one foot.
 *
 * This is the one owner of a support's shape. `buildRailRaceTrack` draws
 * exactly these points, `trestleSpots`'s search asks the registry with the plan
 * projection of exactly these points, and `test/procgen/invariants.ts` decodes
 * the drawn struts back into the same points to check the registry against
 * them. A search that pre-filtered with one geometry and committed with another
 * — a foot disc for the query, a leaning trunk for the drawing — is the fault
 * `docs/DESIGN-round-robin-generation.md` calls the #504 variant, and it is
 * unconstructible while there is only this.
 */
export interface TrestleTree {
  /** Where each lane's rails pass overhead — the four tips of the tree. */
  readonly laneTops: readonly Vector3[];
  /** The two nodes where the trunk's fork splits again to reach a pair of lanes. */
  readonly forkNodes: readonly Vector3[];
  /** Where the trunk stops and the first fork begins. **Not** the lane tops. */
  readonly trunkTop: Vector3;
  /** Where the trunk stands: the found foot, on the ground under it. */
  readonly trunkFoot: Vector3;
  /** The terrain height under the foot this tree was solved for. */
  ground: number;
}

function newTrestleTree(): TrestleTree {
  return {
    laneTops: Array.from({ length: LANE_COUNT }, () => new Vector3()),
    forkNodes: [new Vector3(), new Vector3()],
    trunkTop: new Vector3(),
    trunkFoot: new Vector3(),
    ground: 0,
  };
}

function cloneTrestleTree(tree: TrestleTree): TrestleTree {
  return {
    laneTops: tree.laneTops.map((p) => p.clone()),
    forkNodes: tree.forkNodes.map((p) => p.clone()),
    trunkTop: tree.trunkTop.clone(),
    trunkFoot: tree.trunkFoot.clone(),
    ground: tree.ground,
  };
}

/** Scratch for {@link trestleTreeAt}; it is called once per candidate in a search loop. */
const treeScratch = new Vector3();

/**
 * Solves the tree for a foot at `(footX, footZ)` under the ring at `at` (a raw
 * route distance). Writes into `into` and returns it.
 *
 * **A branch top is the middle of the lane it carries** — Jim's 7 August ruling,
 * and `route.pointAt` in full, height included. A fork node sits under the
 * midpoint of the pair it carries and the trunk under the midpoint of the two
 * fork nodes — horizontally derived from the *tops*, never from the foot, which
 * is what makes a moved foot a lean rather than a moved support. The height of
 * each is measured down from the *lowest* of what it carries, never the mean,
 * so the solved angle is the widest a fork ever opens (see `trestleGeometry.ts`
 * for the measured lane spread that makes that necessary).
 */
function trestleTreeAt(
  route: RailRaceRoute,
  at: number,
  footX: number,
  footZ: number,
  into: TrestleTree,
): TrestleTree {
  const ground = terrainHeight(footX, footZ);
  // The notional deck the fork is solved against — `BEAM_DROP` under the lowest
  // the rails ever get. Nothing is built on it; it fixes the post height the
  // angle is solved from, and so the angle (`trestleGeometry.ts`, `BEAM_DROP`).
  const beamY = route.base - UNDULATION_REACH - BEAM_DROP;
  const plan = forkPlan(beamY - ground, route.laneSpacing);
  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    into.laneTops[lane]!.copy(route.pointAt(lane, at, treeScratch));
  }
  for (let half = 0; half < 2; half += 1) {
    const a = into.laneTops[half * 2]!;
    const b = into.laneTops[half * 2 + 1]!;
    into.forkNodes[half]!.copy(a).lerp(b, 0.5).setY(Math.min(a.y, b.y) - plan.upper);
  }
  into.trunkTop
    .copy(into.forkNodes[0]!)
    .lerp(into.forkNodes[1]!, 0.5)
    .setY(Math.min(into.forkNodes[0]!.y, into.forkNodes[1]!.y) - plan.lower);
  into.trunkFoot.set(footX, ground, footZ);
  into.ground = ground;
  return into;
}

/** One drawn strut of a tree: its two ends and the radii of the cylinder it is drawn as, at race-ring size. */
export interface TrestleStrut {
  readonly from: Vector3;
  readonly to: Vector3;
  readonly radiusFrom: number;
  readonly radiusTo: number;
  readonly part: 'legs' | 'branches-lower' | 'branches-upper';
}

/**
 * The seven struts of a tree, in the order they are drawn. The radii are the
 * ones `buildRailRaceTrack` bakes into its three cylinder geometries — stated
 * here once, and the geometries below read the same expressions.
 */
export function trestleStruts(tree: TrestleTree): readonly TrestleStrut[] {
  const one = (part: TrestleStrut['part'], from: Vector3, to: Vector3): TrestleStrut => ({
    from,
    to,
    radiusFrom: STRUT_RADII[part].from,
    radiusTo: STRUT_RADII[part].to,
    part,
  });
  const struts: TrestleStrut[] = [one('legs', tree.trunkFoot, tree.trunkTop)];
  for (let half = 0; half < 2; half += 1) {
    struts.push(one('branches-lower', tree.trunkTop, tree.forkNodes[half]!));
  }
  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    struts.push(one('branches-upper', tree.forkNodes[Math.floor(lane / 2)]!, tree.laneTops[lane]!));
  }
  return struts;
}

/**
 * **What a trestle claims: the plan projection of everything it draws below
 * a walker's height above its own ground** — the leaning trunk, and whichever
 * branches dip under {@link TALLEST_CHILD_HEIGHT} — as `footprint` capsules,
 * one per strut, each as wide as the thickest end of the strut it covers.
 *
 * Not a foot disc. `check:swept-bus` measured 364 drawn posts inside the bus
 * across the pool while every foot was clear of the road, because a nudged
 * trunk leans and a fork opens below bus-roof height. The claim is the drawn
 * geometry (design: the #504 variant), so what a walker meets near the ground
 * is exactly what is claimed. The bus is not the claim's business any more:
 * Jim's rule (7 Sep 2026) skips every slot over the road outright — see
 * `trestleSpots` — and `check:swept-bus` guards the rest.
 *
 * Exported so the invariant can rebuild the very same claims from the drawn
 * struts and compare them with what the registry holds.
 */
export function trestleClaims(tree: TrestleTree, ringSizeVsRace: number): readonly Claim[] {
  const ceiling = tree.ground + TALLEST_CHILD_HEIGHT;
  const claims: Claim[] = [];
  for (const strut of trestleStruts(tree)) {
    const { from, to } = strut;
    const low = from.y <= to.y ? from : to;
    const high = from.y <= to.y ? to : from;
    if (low.y >= ceiling) continue;
    // Clip the strut where it crosses the ceiling, so a branch that only dips
    // its root under a walker's height claims only that root.
    const t = high.y <= ceiling ? 1 : (ceiling - low.y) / (high.y - low.y);
    claims.push({
      kind: 'footprint',
      shape: {
        shape: 'capsule',
        x1: low.x,
        z1: low.z,
        x2: low.x + (high.x - low.x) * t,
        z2: low.z + (high.z - low.z) * t,
        halfWidth: Math.max(strut.radiusFrom, strut.radiusTo) * ringSizeVsRace,
      },
    });
  }
  return claims;
}

/**
 * Does any strut of `tree`, as it would be drawn — trunk and every branch, the
 * whole plan projection, no height clip — share ground with any of `claims`?
 * The road rule's question (see `trestleSpots`): a trestle is the thing that
 * gets drawn, not the disc under it.
 */
function treeStandsOn(tree: TrestleTree, ringSizeVsRace: number, claims: readonly Claim[]): boolean {
  for (const strut of trestleStruts(tree)) {
    const capsule = {
      shape: 'capsule' as const,
      x1: strut.from.x,
      z1: strut.from.z,
      x2: strut.to.x,
      z2: strut.to.z,
      halfWidth: Math.max(strut.radiusFrom, strut.radiusTo) * ringSizeVsRace,
    };
    if (claims.some((claim) => shapesOverlap(capsule, claim.shape))) return true;
  }
  return false;
}

interface TrestleSpot {
  readonly at: number;
  readonly x: number;
  readonly z: number;
  /** Which of `trestleSpots`'s `TRESTLE_SPACING` grid slots this is — see `planHazards`'s `snapToTrestleGrid`. */
  readonly index: number;
  /** The tree that was searched, allowed and claimed — and is now drawn. One computation, three uses. */
  readonly tree: TrestleTree;
  /** Exactly what was asked of the registry for this tree, and what is committed for it. */
  readonly claims: readonly Claim[];
}

/**
 * **The ground predicates the registry does not own yet.**
 *
 * Trees, walls and plots (`collision`), the walking network
 * (`distanceToPath`), the railway's band (`distanceToRailCorridor`) and the
 * park's entries are not claims — they are the private obstacle lists stage 5
 * of `docs/DESIGN-round-robin-generation.md` migrates ("The migration
 * checklist"). Until they are, a support has to ask them by name, here, behind
 * the one predicate `trestleSpots` uses for both its search and its commit.
 * Each line that leaves this function is a feature that has become a claim.
 *
 * Asked at the foot, as they always were; the road and the other ring — the two
 * things a leaning trunk actually met — are claims now and are asked with the
 * drawn geometry.
 */
/**
 * Which unmigrated predicate refuses `(x, z)`, by its own name — or `null` if
 * none does. Named so a refusal can say *which* one (ruling 4, 6 Sep 2026):
 * stage 5 reads what is left to migrate off the traces, not off this file.
 */
function legacyRefuser(x: number, z: number, collision: CollisionWorld): LegacyPredicate | null {
  if (!collision.isClearCircle(x, z, 1.1)) return 'legacy:collision';
  if (distanceToPath(x, z) < 2.8) return 'legacy:distanceToPath';
  if (distanceToRailCorridor(x, z) < 2.4) return 'legacy:distanceToRailCorridor';
  const pinchesCorridor = [...PARK_LAYOUT.entries.values()].some(
    (entry) => Math.hypot(x - entry.x, z - entry.z) < entry.boundingRadius + 2.4,
  );
  return pinchesCorridor ? 'legacy:parkLayoutEntries' : null;
}

/** The four predicates the registry does not own yet, as a refusal names them. */
type LegacyPredicate =
  | 'legacy:collision'
  | 'legacy:distanceToPath'
  | 'legacy:distanceToRailCorridor'
  | 'legacy:parkLayoutEntries';

/**
 * Says, once per ring per seed, how much the unmigrated predicates still
 * decide — a coverage line, so the day the registry decides every slot is
 * announced rather than inferred. Node only: a browser has no `process`, and
 * the read is optional-chained, exactly as `parkLayout.ts`'s hooks.
 */
function reportLegacyRefusals(
  feature: string,
  tally: ReadonlyMap<LegacyPredicate, number>,
  overRoad: number,
  roadRefused: number,
): void {
  try {
    const nodeProcess = (globalThis as { process?: { stderr?: { write: (s: string) => unknown } } }).process;
    if (!nodeProcess?.stderr) return;
    let total = 0;
    const parts: string[] = [];
    for (const [name, count] of tally) {
      total += count;
      parts.push(`${name} ${count}`);
    }
    nodeProcess.stderr.write(
      `  ${feature}: candidates refused by legacy predicates: ` +
        (total === 0 ? '0 — the registry decided every slot' : `${total} (${parts.join(', ')})`) +
        `; slots over the road not built: ${overRoad}; candidates refused by the road: ${roadRefused}\n`,
    );
  } catch {
    // A runtime with a `process` that is not Node's — say nothing rather than fail a park.
  }
}

/**
 * The resolution of the outward march, in metres of lean and metres of arc.
 * A resolution, not a reach: the march stops where the support's own geometry
 * or the registry says, however many steps that takes. One metre is the
 * spacing the old nudge lists had, kept so a slot nothing refuses stands
 * exactly where it did.
 */
const SEARCH_STEP = 1;

/** `0, -1, 1, -2, 2, …` up to `reach` — nearest first, inward before outward. */
function* nearestFirst(reach: number): Generator<number, void, void> {
  yield 0;
  for (let k = SEARCH_STEP; k <= reach; k += SEARCH_STEP) {
    yield -k;
    yield k;
  }
}

/**
 * **Where the ring can actually be stood up — one outward march per slot,
 * asking the registry.**
 *
 * Every `TRESTLE_SPACING` metres round the loop is a slot. For each, the search
 * tries the ring's own centre line first and then marches the foot away from
 * it — *leaning* the support, because its top stays under the rails — asking
 * two things of every candidate, in this order:
 *
 * 1. **Can the support still be a trunk here?** The foot may stand no further
 *    from the point under its trunk's top than `maxTrunkLean` allows for the
 *    trunk the slot actually gets (`trestleGeometry.ts`: no steeper than its
 *    own branches). This is the bound of the march. It is derived from the
 *    support's geometry and varies round the ring with the lanes' height —
 *    never a typed reach, and never "where the ground ends", which on the
 *    sphere world (#511) it does not.
 * 2. **May it stand here?** The registry is asked with the plan projection of
 *    the tree as it would be drawn, below a walker's height, that anything
 *    claimed needs ({@link trestleClaims}); then the predicates nothing has
 *    migrated yet ({@link legacyRefuser}). The claims that answer the
 *    search are the claims that are committed — one function, one object.
 *
 * Along the ring, a slot may also slide by up to `arcReach` either way. That
 * costs the support nothing (the top follows), and is bounded so two
 * neighbouring slots can never share ground: half the spacing, less a foot.
 * Lean is the outer loop and arc the inner one, as before — arc room is free
 * and lean is not, so the whole arc range is tried at each lean before the
 * lean grows.
 *
 * **What replaced the three-tier ladder.** `RADIAL_NUDGES` ±5, then for a slot
 * with a duck bar `WIDE_ARC_NUDGES` × `MANDATORY_RADIAL_NUDGES` ±4, then
 * `WIDE_RADIAL_NUDGES` ±8 with a warning — three typed reaches deciding where a
 * support may stand, none of them derived from the support. Ruled out in
 * `docs/DESIGN-round-robin-generation.md` ("Ruling on `RADIAL_NUDGES`"): one
 * search, one predicate, one ordering. A bar's slot is no longer searched
 * *harder*; it is searched the same and, if nothing serves, **refused loudly**
 * rather than shrugged off — a duck bar scored at a point with nothing under it
 * is a hazard the rider hits with no support in sight, the bug this whole
 * grid exists to prevent. A slot with nothing scheduled on it may still go
 * missing (over a path, over the railway); `test:procgen`'s widest-run
 * invariant bounds how many.
 *
 * `atArch` is arch-relative — the same convention `hazards.ts`'s `DuckBar.at`
 * uses — and is converted to the raw route coordinate here, the same way the
 * duck-bar loop always has, so a trestle grid index and a hazard-schedule grid
 * index agree on which physical point on the ring they mean.
 */
function trestleSpots(
  route: RailRaceRoute,
  collision: CollisionWorld,
  groundClaims: GroundClaims,
  feature: string,
  /** The ring's own name, for the trace and the coverage line — never the feature asked as. */
  ringName: string,
  ringSizeVsRace: number,
  mandatoryIndices: ReadonlySet<number>,
): TrestleSpot[] {
  const spots: TrestleSpot[] = [];
  const count = Math.floor(route.length / TRESTLE_SPACING);
  const footRadius = POST_FOOT_RADIUS * ringSizeVsRace;
  const arcReach = TRESTLE_SPACING / 2 - footRadius;
  // **Jim's road rule (7 Sep 2026): "just skip all the legs over the road,
  // otherwise keep them."** Stated properly: **nothing of a trestle stands
  // over the road.** A slot whose drawn tree, solved at its nominal place on
  // the ring (`trestleTreeAt` — trunk and every branch, the whole plan
  // projection, unclipped), touches the road's corridor claim — the drawn
  // carriageway, one number, `ROAD_HALF_WIDTH` — is not built: no search, no
  // lean, no shape, on either ring. Every other slot is placed exactly as
  // before, and a march candidate that lands on the road is refused like any
  // other claim. A mandatory slot over the road is not pre-solved: it takes
  // the duck-bar invariant red, which is the alarm.
  //
  // The foot alone was the first cut, and it was a measurement taken on a
  // convenient origin rather than on the thing drawn: on the hill, where the
  // road runs through the ring's band, `check:swept-bus` found a KEPT
  // neighbour's branches (4.1–6.7 m up, a 5.75 m span) over the carriageway
  // and inside the driven bus on 7 of 14 seeds (5: 8 posts, 11: 10, 346: 6,
  // 451: 7, 326: 4, 24: 1, 128: 1). The guard stays armed; the rule now says
  // what he said.
  const road = groundClaims.claimsOf(ROAD_FEATURE).filter((claim) => claim.kind === 'corridor');
  let overRoad = 0;
  /** March candidates refused for standing over the road, for the coverage line. */
  let roadRefused = 0;
  // The furthest any trunk on this ring could lean — a loop guard, from the
  // same owner as the per-candidate bound below, never the bound itself.
  const leanGuard = maxTrunkLean(route.base);
  const tree = newTrestleTree();
  /** Candidates each unmigrated predicate refused on this ring — reported once, below. */
  const legacyTally = new Map<LegacyPredicate, number>();

  for (let i = 0; i < count; i += 1) {
    const atArch0 = (i / count) * route.length;
    {
      const nominalAt = route.wrap(route.startDistance + atArch0);
      const nominal = route.path.sampleAt(nominalAt);
      trestleTreeAt(route, nominalAt, nominal.x, nominal.z, tree);
      if (treeStandsOn(tree, ringSizeVsRace, road)) {
        overRoad += 1;
        continue;
      }
    }
    let placed: TrestleSpot | null = null;
    let leanExhausted = false;
    /** The registry's refusers, for the message if nothing serves. */
    const refusedBy = new Set<string>();

    search: for (const lean of nearestFirst(leanGuard)) {
      let admissible = false;
      for (const along of nearestFirst(arcReach)) {
        const at = route.wrap(route.startDistance + atArch0 + along);
        // Nudged along the centre line's own outward normal, not out from the
        // origin: on a ring that follows the park's edge the two differ.
        const sample = route.path.sampleAt(at);
        const x = sample.x + sample.normalX * lean;
        const z = sample.z + sample.normalZ * lean;
        trestleTreeAt(route, at, x, z, tree);
        // 1. Still a trunk? The lean is the horizontal run from foot to top.
        const run = Math.hypot(tree.trunkTop.x - x, tree.trunkTop.z - z);
        if (run > maxTrunkLean(tree.trunkTop.y - tree.ground)) continue;
        admissible = true;
        // 2. Nothing of a trestle stands over the road — asked of every
        //    candidate with the whole drawn tree, unclipped, because a claim
        //    stops at a walker's height and a branch over the carriageway
        //    does not (measured: the guard found kept branches 4–6.7 m up in
        //    the driven bus when only the nominal slot was asked).
        if (treeStandsOn(tree, ringSizeVsRace, road)) {
          refusedBy.add(ROAD_FEATURE);
          roadRefused += 1;
          continue;
        }
        // 3. May it stand? The registry first, with the drawn geometry.
        const claims = trestleClaims(tree, ringSizeVsRace);
        const blockers = groundClaims.blockers(feature, claims);
        if (blockers.length > 0) {
          for (const blocker of blockers) refusedBy.add(blocker.feature);
          continue;
        }
        const legacy = legacyRefuser(x, z, collision);
        if (legacy !== null) {
          refusedBy.add(legacy);
          legacyTally.set(legacy, (legacyTally.get(legacy) ?? 0) + 1);
          continue;
        }
        placed = { at, x, z, index: i, tree: cloneTrestleTree(tree), claims };
        break search;
      }
      // No arc offset at this lean can still be a trunk: the march is over.
      if (!admissible && lean !== 0) {
        leanExhausted = true;
        break;
      }
    }

    if (placed) {
      spots.push(placed);
      continue;
    }
    if (mandatoryIndices.has(i)) {
      // The refusal propagates. There is no wider list to reach for: the
      // support's next decision would be a different *shape* (a trunk rising
      // vertically to the headroom before it forks — design ruling point 3),
      // which does not exist yet. Say exactly what refused it.
      throw new Error(
        `railRace/track.ts: no support can stand for the duck bar at slot ${i} of ` +
          `${ringName} (arch-relative at=${atArch0.toFixed(1)}): ` +
          (leanExhausted
            ? `the trunk's lean limit was reached (maxTrunkLean, trestleGeometry.ts) `
            : `the ring's whole lean range was tried `) +
          `with arc room ±${arcReach.toFixed(2)} m` +
          (refusedBy.size > 0
            ? `, refused by ${[...refusedBy].sort().join(', ')}`
            : ', refused by nothing named — every candidate failed the lean bound') +
          '. A bar with no support is not built; the placer needs a second support shape or the blocker must move.',
      );
    }
  }
  reportLegacyRefusals(ringName, legacyTally, overRoad, roadRefused);
  return spots;
}

/**
 * **The finish line: a huge rainbow arcing over all four tracks.**
 *
 * Jim, 6 August 2026: *"the finish line looks like an obstacle. Make it more
 * like a huge rainbow that arcs over all 4 tracks."* He is right twice over.
 *
 * **Why it read as an obstacle.** This ride's hazards *are* bars across the
 * track — the duck bars. A finish line that is also a straight beam across the
 * track is, to a child who has just been taught to duck under exactly that
 * shape, the same object: she flinches at the line she is meant to enjoy
 * crossing. An arch fixes that by *shape*, not by colour — you pass through a
 * gateway and you hit a bar — which is why this is a real semicircle springing
 * from beside the rails rather than a low hoop or a straight top with rounded
 * corners, both of which would fail for the same reason the beam did.
 *
 * **And it was an obstacle, literally.** The old beam sat at
 * `base + UNDULATION_REACH + 2.2`, an invented 2.2 m of clearance, while a
 * standing rider's head reaches {@link RIDER_HEAD_TOP_AT_PARK_SCALE} × 2.5 =
 * 7.67 m over the rail. It passed straight through every rider, every lap, and
 * the chequered flags hung *below* it hung lower still. Exactly the defect
 * found in the duck bars the day before, in a second place, for the same
 * reason: a height somebody wrote down instead of deriving.
 *
 * So nothing here invents a height. The radius is *solved* from the two things
 * that actually have to be true, and the apex falls out of them:
 *
 * ```
 * R = hypot(halfWidth, clearHeight)
 * ```
 *
 * — the smallest semicircle that is still `clearHeight` above the rails
 * directly over the *outermost* lane (the tightest point, since a semicircle
 * is lowest at its feet), where `clearHeight` comes from
 * {@link RIDER_HEAD_TOP_AT_PARK_SCALE} plus {@link ARCH_HEADROOM}. Raise a
 * rider's height and the rainbow grows; it cannot fall out of step.
 *
 * Six bands in `ART.rainbow`, the park's own rainbow, inner band first — the
 * same array the hop ring and the rainbow cheeks use, so this belongs to the
 * one visual language GAME_DESIGN.md's HIGHLIGHT rule established rather than
 * being a second, differently-coloured rainbow.
 *
 * **Nothing here is solid.** `solid()` in this park only sets shadow flags, and
 * colliders are registered for trestle legs alone — but it is worth saying out
 * loud, because the whole complaint was that the finish behaved like something
 * you could hit.
 */
function buildArch(
  route: RailRaceRoute,
  ringSizeVsRace: number,
  keep: (item: { dispose(): void }) => void,
): Group {
  const group = new Group();
  group.name = 'railRace:arch';

  const at = route.startDistance;
  const outward = route.outwardAt(at, new Vector3());
  const archSample = route.path.sampleAt(at);
  const centre = new Vector3(archSample.x, 0, archSample.z);
  const yaw = Math.atan2(outward.x, outward.z);

  // The feet spring from just below the lowest rail, so the arch reads as
  // growing out of the track rather than out of the ground far below it.
  const footY = route.base - UNDULATION_REACH - 1.4;
  // The highest the rails ever get, which is the one a rider has least room
  // over. Vertical clearances are deliberately *not* scaled by the ring: a
  // park-scale child on the walk-past ring needs her head height under this
  // just as much as a toy-scale one does on the race ring, and the race ring's
  // riders are the taller of the two, so one absolute height serves both.
  const clearHeight =
    route.base + UNDULATION_REACH + RIDER_HEAD_TOP_AT_PARK_SCALE * RIDE_SCALE + ARCH_HEADROOM - footY;
  // Half the width the arc must still be that high at: the outermost lane's
  // centre, plus room for a rider who is not a line.
  const halfWidth = route.laneSpan / 2 + ARCH_SHOULDER_ROOM;
  const innerRadius = Math.hypot(halfWidth, clearHeight);

  const band = 0.55 * ringSizeVsRace;
  const tube = band * 0.5;
  // Inner then outer, per band — the same order this loop consumes them in.
  const feet = archFeet(route);
  for (let i = 0; i < ART.rainbow.length; i += 1) {
    const material = toonMaterial(ART.rainbow[i]!);
    keep(material);
    const radius = innerRadius + i * band;
    // A half torus: `TorusGeometry` sweeps from +X anticlockwise, so an arc of
    // π is exactly the upper half, with its feet on the ground either side.
    const geometry = new TorusGeometry(radius, tube, 8, 96, Math.PI);
    keep(geometry);
    const arc = solid(new Mesh(geometry, material));
    arc.position.set(centre.x, footY, centre.z);
    // Stand it across the track, the same way the old beam was turned.
    arc.rotation.y = yaw + Math.PI / 2;
    arc.name = `railRace:finish-rainbow-${i}`;
    // It is enormous and mostly sky; per-instance culling is not worth it.
    arc.frustumCulled = false;
    group.add(arc);
    // Outlined like everything else solid in the park — the storybook ink line
    // is what stops six bright bands reading as a gradient rather than as six
    // painted stripes.
    addOutline(arc, 0.02);

    // **The legs.** Jim, 7 August 2026: *"make the rainbow extend all the way to
    // the floor with straight sections, not just float in space"*.
    //
    // The arc alone ends at `footY`, which is just under the lowest rail — so on
    // the race ring its feet stopped 6.0 m above the lawn on the inner side and
    // 22.6 m above the hillside on the outer, and it read as a decal hung in the
    // sky rather than a thing standing on the park.
    //
    // **The solve above is untouched.** `innerRadius` still comes from
    // `hypot(halfWidth, clearHeight)` and the span and apex are exactly what they
    // were; these are added *beneath* the existing feet, not a resize. Each leg
    // is the band's own tube continued straight down at the band's own radius, in
    // the band's own colour, so the arch reads as one object rather than an arc
    // sitting on a trestle.
    //
    // Down to `terrainHeight`, which is the same idiom — and the same function —
    // the ring's own trestle legs use (`legHeight = beamY - ground`, see
    // `trestles` above). The two sides come out very different lengths, and that
    // is the park being honest rather than a bug: the ring runs `NOMINAL_OUTSET`
    // outside the park edge and the arch is wider than the ring, so the inner
    // feet land on the lawn while the outer ones land out on the rim, past
    // `RIM_OUTSET_END`, where the terrain has already fallen the full `RIM_DROP`.
    // The trestles carrying the track next to it are just as lopsided.
    for (const side of [-1, 1] as const) {
      // Not recomputed here: `archFeet` is the one owner of where a foot comes
      // down, because `paths.ts` has to keep the paving out from under these
      // and cannot import this file. Two copies of this formula is exactly how
      // the legs ended up standing on the path on seeds 5 and 11.
      const foot = feet[i * 2 + (side < 0 ? 0 : 1)]!;
      const footX = foot.x;
      const footZ = foot.z;
      const ground = terrainHeight(footX, footZ);
      // Sunk by the leg's own radius rather than stopped dead on the terrain
      // height, because a flat-bottomed cylinder standing exactly on a *slope*
      // shows daylight under its downhill edge — and the rim these outer feet
      // land on is the steepest ground in the park. One tube radius buries the
      // bottom face for any slope up to 45° across the leg's own width, and it
      // is taken from the leg rather than invented so a fatter band cannot grow
      // a gap. Nothing here is solid, so burying it costs nothing.
      const bottom = ground - tube;
      const height = footY - bottom;
      // A rainbow whose foot is already above its own arc would be inside-out.
      // Cannot happen with the park's terrain under today's `BASE_HEIGHT`, but
      // the geometry would silently invert rather than fail, and
      // `finishRainbowStandsOnTheGround` in the procgen invariants is what says
      // so out loud on every seed.
      if (height <= 0) continue;
      const legGeometry = new CylinderGeometry(tube, tube, height, 8);
      keep(legGeometry);
      const leg = solid(new Mesh(legGeometry, material));
      leg.position.set(footX, bottom + height / 2, footZ);
      leg.name = `railRace:finish-rainbow-leg-${i}-${side < 0 ? 'inner' : 'outer'}`;
      leg.frustumCulled = false;
      group.add(leg);
      addOutline(leg, 0.02);
    }
  }

  return group;
}
