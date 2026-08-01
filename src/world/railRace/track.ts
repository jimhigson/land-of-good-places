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
import { clamp01, lerp } from '../../core/mathUtils';
import { addOutline, decal, solid, toonMaterial } from '../../art/style/materials';
import { terrainHeight } from '../terrain';
import { distanceToPath } from '../paths';
import { PARK_LAYOUT } from '../parkLayout';
import { distanceToRailCorridor } from '../train/plan';
import type { CollisionWorld } from '../Collision';
import { sweptRails, type RailSampler } from '../rail/sweptRail';
import { ALERT_RANGE, DUCK_CLEARANCE, type HazardLayout } from './hazards';
import {
  LANE_COUNT,
  LANE_SPAN,
  NOMINAL_RADIUS,
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

/** Rail centre-to-centre within one lane. Narrow: it is a one-child cart. */
export const RAIL_GAUGE = 0.62;

/** How far a duck bar reaches either side of its lane's centre. */
const BAR_HALF_SPAN = 1.15;

/** Trestles this far apart around the ring. */
const TRESTLE_SPACING = 12;

/** How far under the lowest a rail ever gets the cross-beam sits. */
const BEAM_DROP = 0.45;

export interface RailRaceTrack {
  readonly group: Group;
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
  const one = new Vector3(1, 1, 1);
  const scale = new Vector3();
  const outward = new Vector3();
  const point = new Vector3();
  const ACROSS = new Vector3(1, 0, 0);
  const UP = new Vector3(0, 1, 0);

  // --- the rails -------------------------------------------------------------
  // One colour per lane, not one shared pink for the whole ring: with four
  // racers on four separate rails, colour is how a child tells "my lane" from
  // "their lane" at a glance, the same job livery plays on real racing lanes.
  // Same bright, high-saturation family the character creator's own swatches
  // use (`markerPink` etc in `core/palette.ts`) rather than inventing a new set.
  const LANE_COLOURS: readonly number[] = [
    PALETTE.markerPink,
    PALETTE.markerSky,
    PALETTE.markerLemon,
    PALETTE.markerMint,
  ];
  const railMaterials = LANE_COLOURS.map((colour) => toonMaterial(colour));
  for (const material of railMaterials) keep(material);
  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    // The adapter that makes a lane of this ring look like any other route in
    // the park to the shared sweeper.
    const sampler: RailSampler = {
      length: route.length,
      pointAt: (distance, target) => route.pointAt(lane, distance, target),
      tangentAt: (distance, target) => route.tangentAt(lane, distance, target),
    };
    const railMaterial = railMaterials[lane % railMaterials.length]!;
    for (const geometry of sweptRails(sampler, {
      gauge: RAIL_GAUGE,
      radius: 0.075,
      // The ring bends at a constant, gentle 1/53.5 per metre; it does not need
      // the coaster's two segments a metre, and this is paid eight times over.
      tubularPerMetre: 1.2,
      step: 2.2,
    })) {
      const rail = new Mesh(geometry, railMaterial);
      rail.name = `railRace:rail-${lane}`;
      // The shadow on the lawn is the only thing that tells a child how high up
      // this is, which is most of the feeling of the ride.
      rail.castShadow = true;
      group.add(rail);
      keep(geometry);
    }
  }

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

  // --- the duck bars ---------------------------------------------------------
  const barCount = layout.bars.length * LANE_COUNT;
  const frameMaterial = toonMaterial(PALETTE.buildingTrim);
  const barMaterial = toonMaterial(PALETTE.slideRail);
  keep(frameMaterial);
  keep(barMaterial);

  const postGeometry = new CylinderGeometry(0.07, 0.09, DUCK_CLEARANCE + 0.3, 6);
  const barGeometry = new BoxGeometry(BAR_HALF_SPAN * 2, 0.22, 0.26);
  // The bar itself is the warning light. Lamps on the posts were legible at a
  // standstill and invisible at fourteen metres a second; a stripe of amber
  // right where the thing you must duck under is cannot be missed. A sleeve
  // around the bar rather than the bar's own material, so the toon shading
  // underneath still shapes it.
  const sleeveGeometry = new BoxGeometry(BAR_HALF_SPAN * 2 - 0.04, 0.28, 0.32);
  keep(postGeometry);
  keep(barGeometry);
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
  // `barSlots[b]` holds the instance ids of that bar across all four lanes.
  const barSlots: number[][] = [];

  for (const bar of layout.bars) {
    const slots: number[] = [];
    // `bar.at` is measured from the start/finish arch (`hazards.ts`), which
    // sits at `route.startDistance`, not at the route's own raw zero — see
    // the matching note in `buildSparkRibbons` below.
    const at = route.wrap(route.startDistance + bar.at);
    route.outwardAt(at, outward);
    rotation.setFromUnitVectors(ACROSS, outward);
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      route.pointAt(lane, at, point);
      const barY = point.y + DUCK_CLEARANCE;

      for (const side of [-1, 1] as const) {
        position.set(
          point.x + outward.x * side * BAR_HALF_SPAN,
          point.y + (DUCK_CLEARANCE + 0.3) / 2 - 0.15,
          point.z + outward.z * side * BAR_HALF_SPAN,
        );
        matrix.compose(position, rotation, one);
        posts.setMatrixAt(postIndex, matrix);
        postIndex += 1;
      }

      position.set(point.x, barY, point.z);
      matrix.compose(position, rotation, one);
      bars.setMatrixAt(barIndex, matrix);
      sleeves.setMatrixAt(barIndex, matrix);
      slots.push(barIndex);
      barIndex += 1;
    }
    barSlots.push(slots);
  }

  posts.count = postIndex;
  bars.count = barIndex;
  sleeves.count = barIndex;
  for (const mesh of [posts, bars, sleeves]) {
    mesh.instanceMatrix.needsUpdate = true;
    // The bars stand nine metres up on a ring that is mostly out of shot; per
    // instance culling is not worth the bounds maths.
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  // Per-instance colour is what lets one draw call hold four lanes' worth of
  // warning lamps at four different states of alarm.
  sleeves.setColorAt(0, CALM);
  sleeves.instanceColor!.needsUpdate = true;

  // --- the trestles ----------------------------------------------------------
  const beamY = route.base - UNDULATION_REACH - BEAM_DROP;

  const timberMaterial = toonMaterial(PALETTE.woodLight);
  const trestleMaterial = toonMaterial(PALETTE.stonePinkLight);
  keep(timberMaterial);
  keep(trestleMaterial);

  const spots = trestleSpots(route, collision);
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
  const tint = new Color();
  const sparkColour = new Color();
  const INK = new Color(PALETTE.ink);
  const FLASH = new Color(PALETTE.fairyWarm);

  return {
    group,

    setAlerts(lapOffset: number, safe: boolean, elapsed: number): void {
      const colour = sleeves.instanceColor;
      if (!colour) return;
      layout.bars.forEach((bar, index) => {
        // How close the player is to this bar, going forwards. Bars behind are
        // calm; the one coming up swells and colours.
        let ahead = bar.at - lapOffset;
        if (ahead < -6) ahead += route.length;
        const closeness = ahead < 0 ? 0 : clamp01(1 - ahead / ALERT_RANGE);
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

interface TrestleSpot {
  readonly at: number;
  readonly x: number;
  readonly z: number;
}

/**
 * Where the ring can actually be stood up.
 *
 * The same predicate set the coaster's pylons use, plus one this ride needs and
 * the coaster does not: the ring runs *inside the railway's own band*, so a leg
 * has to clear the train's corridor as well as the walking network. Where it
 * cannot — over the railway, over a path, in the gap between two plots — the
 * trestle is simply skipped. The track shrugs off a missing support; the walk
 * network cannot shrug off a misplaced one.
 */
function trestleSpots(route: RailRaceRoute, collision: CollisionWorld): TrestleSpot[] {
  const spots: TrestleSpot[] = [];
  const count = Math.floor(route.length / TRESTLE_SPACING);
  for (let i = 0; i < count; i += 1) {
    const at = (i / count) * route.length;
    const theta = route.angleAt(at);
    const x = Math.cos(theta) * NOMINAL_RADIUS;
    const z = Math.sin(theta) * NOMINAL_RADIUS;

    if (!collision.isClearCircle(x, z, 1.1)) continue;
    if (distanceToPath(x, z) < 2.8) continue;
    if (distanceToRailCorridor(x, z) < 2.4) continue;
    const pinchesCorridor = [...PARK_LAYOUT.entries.values()].some(
      (entry) => Math.hypot(x - entry.x, z - entry.z) < entry.boundingRadius + 2.4,
    );
    if (pinchesCorridor) continue;

    spots.push({ at, x, z });
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
