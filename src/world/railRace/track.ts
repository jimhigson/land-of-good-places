import {
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
import { addOutline, decal, solid, toonMaterial } from '../../art/style/materials';
import { terrainHeight } from '../terrain';
import { distanceToPath } from '../paths';
import { PARK_LAYOUT } from '../parkLayout';
import { distanceToRailCorridor } from '../train/plan';
import type { CollisionWorld } from '../Collision';
import { sweptRails, type RailSampler } from '../rail/sweptRail';
import type { HazardLayout } from './hazards';
import { LANE_COUNT, LANE_SPAN, NOMINAL_RADIUS, RIDE_SCALE, UNDULATION_REACH, type RailRaceRoute } from './route';

/**
 * **Everything the Rail Race runs through**: four rails, the trestles holding
 * them up, and the black stretches you must not power over.
 *
 * The rails come from `world/rail/sweptRail.ts`, the park's one way of turning a
 * route into rail geometry — the same swept tubes the coaster is built from, fed
 * a lane of this ring instead of a solved loop. Nothing here draws a rail by
 * hand.
 *
 * The trestles are instanced: four lanes and legs roughly every `TRESTLE_SPACING`
 * metres is a lot of little meshes, which as three `InstancedMesh`es (legs,
 * beams, droppers) is three draw calls, whatever the layout turns out to be.
 *
 * **1 August 2026 — the duck bar retired.** This file used to also build a
 * hoop of posts and a bar per lane per hazard, snapped onto whichever trestle
 * leg stood at the same point on the ring, plus the warning-lamp animation
 * that lit them up on approach. All of that is gone with the mechanic — see
 * `hazards.ts`'s header. The trestle legs/beams/droppers below are unrelated
 * infrastructure (every lane needs holding up regardless of what hazard rides
 * on it) and are untouched; only the code that positioned a bar *relative to*
 * a leg, and required a leg to exist wherever a bar was scheduled, is gone.
 */

/** Rail centre-to-centre within one lane. Narrow: it is a one-child cart. */
export const RAIL_GAUGE = 0.62 * RIDE_SCALE;

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

/** How far under the lowest a rail ever gets the cross-beam sits. */
const BEAM_DROP = 0.45;

/**
 * Trestles this far apart around the ring.
 *
 * Lived in `hazards.ts` until 1 August 2026, because `planHazards` needed it
 * too — a duck bar had to snap onto the same grid `trestleSpots` places
 * supports on. With the duck bar gone, this file is the constant's only
 * consumer, so it lives where it is used.
 */
const TRESTLE_SPACING = 12;

export interface RailRaceTrack {
  readonly group: Group;
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
  dispose(): void;
}

/** One (zone, lane) pair currently sparking, for {@link RailRaceTrack.setSparking}. */
export interface SparkingSegment {
  /** Index into the lap's `HazardLayout.zones`, not the multi-lap schedule. */
  readonly zoneIndex: number;
  readonly lane: number;
}

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

export function buildRailRaceTrack(
  route: RailRaceRoute,
  layout: HazardLayout,
  collision: CollisionWorld,
): RailRaceTrack {
  const group = new Group();
  group.name = 'railRace:track';
  const disposables: { dispose(): void }[] = [];
  const keep = (item: { dispose(): void }): void => {
    disposables.push(item);
  };

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const position = new Vector3();
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
  // Per lane: every rail vertex's resting colour (the lane's own
  // `LANE_COLOURS` entry), kept around so `setSparking` can cheaply copy it
  // back over a zone that has stopped sparking — the rail's analogue of the
  // spark ribbons resetting their whole buffer to ink before repainting the
  // active ones each frame.
  const railBaseColoursByLane: Float32Array[] = [];
  const railColourAttributesByLane: BufferAttribute[][] = [];
  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    // The adapter that makes a lane of this ring look like any other route in
    // the park to the shared sweeper.
    const sampler: RailSampler = {
      length: route.length,
      pointAt: (distance, target) => route.pointAt(lane, distance, target),
      tangentAt: (distance, target) => route.tangentAt(lane, distance, target),
    };
    const railMaterial = railMaterials[lane % railMaterials.length]!;
    const laneColour = new Color(LANE_COLOURS[lane % LANE_COLOURS.length]!);
    let baseColours: Float32Array | null = null;
    const attributes: BufferAttribute[] = [];
    for (const geometry of sweptRails(sampler, {
      gauge: RAIL_GAUGE,
      radius: 0.075 * RIDE_SCALE,
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

  // --- the black stretches ---------------------------------------------------
  //
  // One ribbon geometry across every zone of every lane: a plate laid between
  // the two rails, dark instead of pink, which is the "black part of the track"
  // in the brief. One geometry and one material, so the whole set is one draw
  // call however many stretches the layout produces — per-vertex colour is
  // what lets that one draw call still light up just the zone×lane actually
  // sparking, rather than needing a material — and therefore a draw call —
  // per stretch.
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

  // --- where the trestles stand ------------------------------------------
  //
  // Independent infrastructure: every lane needs holding up regardless of
  // what hazard (if any) rides over a given span, so this no longer takes any
  // input from `layout` — until 1 August 2026 a duck bar's own visible
  // support came from here too, and a grid slot with a bar scheduled on it
  // was treated as mandatory rather than something the ring could shrug off.
  // See `hazards.ts`'s header for why the bar is gone; `trestleSpots` below
  // is back to the plain "try a small neighbourhood, shrug off a rare true
  // gap" search that predates that mechanism.
  const spots = trestleSpots(route, collision);

  // --- the trestles ----------------------------------------------------------
  const beamY = route.base - UNDULATION_REACH - BEAM_DROP;

  const timberMaterial = toonMaterial(PALETTE.woodLight);
  const trestleMaterial = toonMaterial(PALETTE.stonePinkLight);
  keep(timberMaterial);
  keep(trestleMaterial);

  // `spots` was already computed above, before the duck bars, so their
  // supports could be looked up by grid index.
  const legGeometry = new CylinderGeometry(0.26, 0.34, 1, 8);
  const beamGeometry = new BoxGeometry(1, 0.26, 0.42);
  const dropperGeometry = new CylinderGeometry(0.08, 0.08, 1, 6);
  keep(legGeometry);
  keep(beamGeometry);
  keep(dropperGeometry);

  const legs = new InstancedMesh(legGeometry, trestleMaterial, Math.max(1, spots.length));
  const beams = new InstancedMesh(beamGeometry, timberMaterial, Math.max(1, spots.length));
  const droppers = new InstancedMesh(
    dropperGeometry,
    trestleMaterial,
    Math.max(1, spots.length * LANE_COUNT),
  );
  let dropperIndex = 0;
  // Wide enough to carry the outer rail of the outer lane and the inner rail of
  // the inner lane, with a little overhang so the beam reads as holding them up.
  const beamSpan = LANE_SPAN + RAIL_GAUGE + 0.8;

  spots.forEach((spot, index) => {
    route.outwardAt(spot.at, outward);
    rotation.setFromUnitVectors(ACROSS, outward);

    const ground = terrainHeight(spot.x, spot.z);
    const legHeight = beamY - ground;
    position.set(spot.x, ground + legHeight / 2, spot.z);
    scale.set(1, legHeight, 1);
    matrix.compose(position, rotation.clone().setFromAxisAngle(UP, 0), scale);
    legs.setMatrixAt(index, matrix);

    route.outwardAt(spot.at, outward);
    rotation.setFromUnitVectors(ACROSS, outward);
    position.set(spot.x, beamY, spot.z);
    scale.set(beamSpan, 1, 1);
    matrix.compose(position, rotation, scale);
    beams.setMatrixAt(index, matrix);

    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      route.pointAt(lane, spot.at, point);
      const length = point.y - beamY;
      position.set(point.x, beamY + length / 2, point.z);
      scale.set(1, length, 1);
      matrix.compose(position, rotation, scale);
      droppers.setMatrixAt(dropperIndex, matrix);
      dropperIndex += 1;
    }

    // A post is a thing a child can walk into.
    collision.addCircle(spot.x, spot.z, 0.36);
  });

  legs.count = spots.length;
  beams.count = spots.length;
  droppers.count = dropperIndex;
  // Named so `test/procgen/invariants.ts` can find the legs in the built scene
  // and measure where they actually landed, rather than re-deriving the rules
  // that placed them.
  legs.name = 'railRace:trestle-legs';
  beams.name = 'railRace:trestle-beams';
  droppers.name = 'railRace:trestle-droppers';
  for (const mesh of [legs, beams, droppers]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    group.add(mesh);
  }

  // --- the start/finish arch -------------------------------------------------
  group.add(buildArch(route, keep));

  // --- the live bits ---------------------------------------------------------
  const sparkColour = new Color();
  const INK = new Color(PALETTE.ink);
  const FLASH = new Color(PALETTE.fairyWarm);

  return {
    group,

    setSparking(active: readonly SparkingSegment[], elapsed: number): void {
      // A hard flicker rather than a smooth pulse: sparks are not a mood light.
      // One shared clock for every active zone — they don't need independent
      // phases to read as "sparking", only as not-a-smooth-pulse.
      const flash = Math.sin(elapsed * 47) > 0 ? 1 : 0.35;
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
      for (let lane = 0; lane < LANE_COUNT; lane += 1) {
        const base = railBaseColoursByLane[lane];
        if (!base) continue;
        for (const attribute of railColourAttributesByLane[lane] ?? []) {
          (attribute.array as Float32Array).set(base);
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

    dispose(): void {
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
  const half = RAIL_GAUGE * 0.5;

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
        const y = point.y + 0.055;
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

interface TrestleSpot {
  readonly at: number;
  readonly x: number;
  readonly z: number;
}

/** Every one of `trestleSpots`'s four ground-clearance predicates, together. */
function groundIsClear(x: number, z: number, collision: CollisionWorld): boolean {
  if (!collision.isClearCircle(x, z, 1.1)) return false;
  if (distanceToPath(x, z) < 2.8) return false;
  if (distanceToRailCorridor(x, z) < 2.4) return false;
  const pinchesCorridor = [...PARK_LAYOUT.entries.values()].some(
    (entry) => Math.hypot(x - entry.x, z - entry.z) < entry.boundingRadius + 2.4,
  );
  return !pinchesCorridor;
}

/**
 * How far `trestleSpots` will nudge a candidate before giving up on it — along
 * the route (metres of arc) and across it (metres off `NOMINAL_RADIUS`).
 * Kept well inside half of `TRESTLE_SPACING` (12 m) so two neighbouring
 * slots' searches can never land on the same ground.
 *
 * Ordering within each array no longer matters (`searchForClearGround` tries
 * every arc offset before growing the radial one — see that function's doc
 * comment); kept closest-to-zero-first anyway because it reads as "the
 * nudge, ranked."
 *
 * **1 August 2026 — the duck bar retired.** Until then a grid slot a duck bar
 * was scheduled on got a second, wider search (`WIDE_ARC_NUDGES` paired with
 * a capped radial range) rather than being allowed to go missing, because a
 * bar with no visible support under it was the exact bug that mechanism
 * existed to fix. With the bar gone, every slot is back to one ordinary
 * search and one shrug if it fails — see this function's own doc comment.
 */
const ARC_NUDGES = [0, -1, 1, -2, 2, -3, 3];
const RADIAL_NUDGES = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5];

/**
 * Tries each (radial, arc) nudge in order and returns the first clear ground
 * it finds.
 *
 * Radial-outer, arc-inner: tries every arc offset at the smallest radial
 * deviation first, and only grows the radial nudge once the whole arc range
 * has failed to turn up clear ground that close in — a trestle looking a
 * little closer to its nominal radius is no worse than one that doesn't, so
 * there is no reason to prefer a big arc nudge over a small radial one.
 *
 * `atArch` is arch-relative ("metres along the loop, measured from the
 * start/finish arch", the same convention `hazards.ts`'s `SparkZone` uses) —
 * **not** the raw route coordinate `route.angleAt`/`pointAt` actually want.
 * Converted here (`route.wrap(route.startDistance + at)`).
 */
function searchForClearGround(
  route: RailRaceRoute,
  collision: CollisionWorld,
  atArch0: number,
  arcNudges: readonly number[],
  radialNudges: readonly number[],
): { at: number; x: number; z: number } | null {
  for (const dr of radialNudges) {
    const radius = NOMINAL_RADIUS + dr;
    for (const da of arcNudges) {
      const at = route.wrap(route.startDistance + atArch0 + da);
      const theta = route.angleAt(at);
      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;
      if (groundIsClear(x, z, collision)) return { at, x, z };
    }
  }
  return null;
}

/**
 * Where the ring can actually be stood up.
 *
 * The same predicate set the coaster's pylons use, plus one this ride needs and
 * the coaster does not: the ring runs *inside the railway's own band*, so a leg
 * has to clear the train's corridor as well as the walking network.
 *
 * **A rigid, one-shot candidate grid found almost nowhere to stand.** The first
 * version of this function tried exactly one point per slot — `NOMINAL_RADIUS`
 * at the slot's own arc position — and gave up outright if that one point was
 * blocked. Measured against the real, built park (1 August 2026): **1 of 28**
 * candidates survived. The ride's own docs already say it "runs through a band
 * of the park that is already full" — garden planting, the walking network, the
 * railway corridor — and that density is exactly what a single fixed point
 * cannot route around. The result was not "a few trestles skipped here and
 * there", which the docs' "shrugs off a missing support" language anticipates;
 * it was a 336 m elevated loop standing on one leg.
 *
 * So each slot now searches a small, bounded neighbourhood — a handful of
 * along-the-route and across-the-ring nudges, closest first — before it is
 * actually given up on. Against the same real park this finds a clear spot for
 * **25 of 28**. The remaining few are still allowed to go missing, on purpose:
 * over the railway, over a path, in the gap between two plots, no amount of
 * local nudging *should* find a leg — the walk network cannot shrug off a
 * misplaced one, and a rare true gap is what "the track shrugs off a missing
 * support" was always meant to cover. This survival rate — real infrastructure,
 * independent of any hazard — is exactly what the duck bar's removal must not
 * regress; see `test/procgen/invariants.ts`'s `railRaceFliesClear`.
 */
function trestleSpots(route: RailRaceRoute, collision: CollisionWorld): TrestleSpot[] {
  const spots: TrestleSpot[] = [];
  const count = Math.floor(route.length / TRESTLE_SPACING);
  for (let i = 0; i < count; i += 1) {
    const atArch0 = (i / count) * route.length;
    const placed = searchForClearGround(route, collision, atArch0, ARC_NUDGES, RADIAL_NUDGES);
    if (placed) spots.push(placed);
  }
  return spots;
}

/** A striped arch over all four lanes, where the race starts and ends. */
function buildArch(route: RailRaceRoute, keep: (item: { dispose(): void }) => void): Group {
  const group = new Group();
  group.name = 'railRace:arch';

  const accent = toonMaterial(PALETTE.markerMint);
  const cream = toonMaterial(PALETTE.buildingWall);
  const dark = toonMaterial(PALETTE.ink);
  keep(accent);
  keep(cream);
  keep(dark);

  const at = route.startDistance;
  const outward = route.outwardAt(at, new Vector3());
  const centre = new Vector3(
    Math.cos(route.angleAt(at)) * NOMINAL_RADIUS,
    0,
    Math.sin(route.angleAt(at)) * NOMINAL_RADIUS,
  );
  const yaw = Math.atan2(outward.x, outward.z);
  const span = LANE_SPAN / 2 + 1.6;
  const beamY = route.base + UNDULATION_REACH + 2.2;
  const footY = route.base - UNDULATION_REACH - 1.4;

  const legGeometry = new CylinderGeometry(0.24, 0.3, beamY - footY, 10);
  keep(legGeometry);
  for (const side of [-1, 1] as const) {
    const leg = solid(new Mesh(legGeometry, cream));
    leg.position.set(
      centre.x + outward.x * side * span,
      (beamY + footY) / 2,
      centre.z + outward.z * side * span,
    );
    group.add(leg);
    addOutline(leg, 0.024);
  }

  const beamGeometry = new BoxGeometry(span * 2 + 0.6, 0.55, 0.55);
  keep(beamGeometry);
  const beam = solid(new Mesh(beamGeometry, accent));
  beam.position.set(centre.x, beamY, centre.z);
  beam.rotation.y = yaw + Math.PI / 2;
  group.add(beam);
  addOutline(beam, 0.024);

  // Chequered flags hanging off the beam: the finish line, unmistakably.
  const flagGeometry = new BoxGeometry(0.72, 0.72, 0.08);
  keep(flagGeometry);
  const flags = 13;
  for (let i = 0; i < flags; i += 1) {
    const t = i / (flags - 1) - 0.5;
    const flag = decal(new Mesh(flagGeometry, i % 2 === 0 ? cream : dark));
    flag.position.set(
      centre.x + outward.x * t * span * 2,
      beamY - 0.66,
      centre.z + outward.z * t * span * 2,
    );
    flag.rotation.y = yaw + Math.PI / 2;
    group.add(flag);
  }

  return group;
}
