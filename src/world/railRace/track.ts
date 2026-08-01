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

/** Rail centre-to-centre within one lane. Narrow: it is a one-child cart. */
export const RAIL_GAUGE = 0.62 * RIDE_SCALE;

/** How far a duck bar reaches either side of its lane's centre. */
const BAR_HALF_SPAN = 1.15 * RIDE_SCALE;

/**
 * A bay of deck — cross-beam and droppers — this far apart around the ring.
 *
 * The family, having ridden it (1 August 2026): *"the rails have no visible
 * supports — put them at regular distances of a few metres"*. It was 12 m,
 * which at racing pace is a bay every four fifths of a second. Five is "a few
 * metres", and the ring is 336 m round, so this is 67 bays rather than 28 —
 * still three `InstancedMesh`es and so still three draw calls.
 *
 * Note this is now the spacing of a bay of *deck*, which is unconditional, and
 * no longer the spacing of a ground leg, which is not. That split is the real
 * fix — see {@link deckSpots}.
 */
const TRESTLE_SPACING = 5;

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
  const one = new Vector3(1, 1, 1);
  const scale = new Vector3();
  const outward = new Vector3();
  const point = new Vector3();
  const ACROSS = new Vector3(1, 0, 0);

  const INK = new Color(PALETTE.ink);

  /**
   * Every span of vertices that belongs to one zone×lane — both of that lane's
   * rails, plus its plate on the ground — keyed the way `setSparking` is asked
   * about them. Filled in as each piece of geometry is built below.
   */
  const zonePaint = new Map<string, PaintSpan[]>();
  const addSpan = (zoneIndex: number, lane: number, span: PaintSpan): void => {
    const key = segmentKey(zoneIndex, lane);
    const existing = zonePaint.get(key);
    if (existing) existing.push(span);
    else zonePaint.set(key, [span]);
  };

  // --- the rails -------------------------------------------------------------
  //
  // **One white material for all eight rails, with the lane's colour carried in
  // the geometry's own vertex colours instead of the material's.** That is what
  // lets a rail *itself* go black over a spark stretch (family, 1 August 2026:
  // the whole rail should go black, not just the strip between the rails) — the
  // exact trick the ground plate below already used, moved onto the thing a
  // child actually reads as "the track".
  //
  // The alternative — a separate material, and so a separate mesh, per zone per
  // lane — would have turned eight draw calls into eight plus two a lane, and
  // left a seam at every zone boundary for the swept tube to not quite close.
  const railMaterial = toonMaterial(0xffffff);
  railMaterial.vertexColors = true;
  keep(railMaterial);
  const laneColour = new Color();
  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    // The adapter that makes a lane of this ring look like any other route in
    // the park to the shared sweeper.
    const sampler: RailSampler = {
      length: route.length,
      pointAt: (distance, target) => route.pointAt(lane, distance, target),
      tangentAt: (distance, target) => route.tangentAt(lane, distance, target),
    };
    laneColour.set(LANE_COLOURS[lane % LANE_COLOURS.length] ?? PALETTE.markerPink);
    for (const geometry of sweptRails(sampler, {
      gauge: RAIL_GAUGE,
      radius: 0.075 * RIDE_SCALE,
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
      for (const [zoneIndex, span] of paintRail(geometry, route, layout, laneColour, INK)) {
        addSpan(zoneIndex, lane, span);
      }
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
  for (let i = 0; i < sparkVertexCount; i += 1) {
    sparkColours[i * 3] = INK.r;
    sparkColours[i * 3 + 1] = INK.g;
    sparkColours[i * 3 + 2] = INK.b;
  }
  const sparkColourAttribute = new BufferAttribute(sparkColours, 3);
  sparkGeometry.setAttribute('color', sparkColourAttribute);
  // Keyed the same way `active` segments arrive from `RailRace.ts`, so
  // `setSparking` is an O(active carts) lookup rather than a scan of every
  // zone×lane every frame — and into the *same* map the rails registered
  // themselves in, so lighting a stretch lights its rails and its plate
  // together with no second code path to fall out of step.
  for (const segment of sparkSegments) {
    addSpan(segment.zoneIndex, segment.lane, {
      attribute: sparkColourAttribute,
      vertices: rangeIndices(segment.vertexStart, segment.vertexCount),
    });
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

  const postGeometry = new CylinderGeometry(
    0.07 * RIDE_SCALE,
    0.09 * RIDE_SCALE,
    DUCK_CLEARANCE + 0.3 * RIDE_SCALE,
    6,
  );
  const barGeometry = new BoxGeometry(BAR_HALF_SPAN * 2, 0.22 * RIDE_SCALE, 0.26 * RIDE_SCALE);
  // The bar itself is the warning light. Lamps on the posts were legible at a
  // standstill and invisible at fourteen metres a second; a stripe of amber
  // right where the thing you must duck under is cannot be missed. A sleeve
  // around the bar rather than the bar's own material, so the toon shading
  // underneath still shapes it.
  const sleeveGeometry = new BoxGeometry(
    BAR_HALF_SPAN * 2 - 0.04 * RIDE_SCALE,
    0.28 * RIDE_SCALE,
    0.32 * RIDE_SCALE,
  );
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
          point.y + (DUCK_CLEARANCE + 0.3 * RIDE_SCALE) / 2 - 0.15 * RIDE_SCALE,
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

  // The droppers get a white material of their own rather than the trestle's
  // stone: their per-instance colour *multiplies* the material's, so a lane's
  // pink read as a stone-tinted pink against the pink rail above it.
  const dropperMaterial = toonMaterial(0xffffff);
  keep(dropperMaterial);

  const spots = deckSpots(route);
  const legGeometry = new CylinderGeometry(0.26, 0.34, 1, 8);
  const beamGeometry = new BoxGeometry(1, 0.26, 0.42);
  // Thicker than the 0.08 it was: RIDE_SCALE took the rail tube up to 0.19 m
  // radius and a dropper thinner than the rail it holds reads as a wire.
  const dropperGeometry = new CylinderGeometry(0.11, 0.13, 1, 6);
  keep(legGeometry);
  keep(beamGeometry);
  keep(dropperGeometry);

  const legs = new InstancedMesh(legGeometry, trestleMaterial, Math.max(1, spots.length));
  const beams = new InstancedMesh(beamGeometry, timberMaterial, Math.max(1, spots.length));
  // Two per lane, not one: see the loop below.
  const droppers = new InstancedMesh(
    dropperGeometry,
    dropperMaterial,
    Math.max(1, spots.length * LANE_COUNT * 2),
  );
  let dropperIndex = 0;
  let legIndex = 0;
  const dropperColour = new Color();
  const upright = new Quaternion();
  // Wide enough to carry the outer rail of the outer lane and the inner rail of
  // the inner lane, with a little overhang so the beam reads as holding them up.
  const beamSpan = LANE_SPAN + RAIL_GAUGE + 0.8;

  spots.forEach((spot, index) => {
    route.outwardAt(spot.at, outward);
    rotation.setFromUnitVectors(ACROSS, outward);

    // A ground leg, wherever the ground under this stretch of deck can take one
    // — which is nothing like everywhere. See {@link footUnder}. Legs go on a
    // coarser grid than the deck: a pier every five metres is a fence, and at
    // eight metres tall they would be the park's dominant feature.
    if (index % LEG_EVERY === 0) {
      const foot = footUnder(spot, outward, collision);
      if (foot) {
        const ground = terrainHeight(foot.x, foot.z);
        const legHeight = beamY - ground;
        position.set(foot.x, ground + legHeight / 2, foot.z);
        scale.set(1, legHeight, 1);
        matrix.compose(position, upright, scale);
        legs.setMatrixAt(legIndex, matrix);
        legIndex += 1;
        // A post is a thing a child can walk into.
        collision.addCircle(foot.x, foot.z, 0.36);
      }
    }

    position.set(spot.x, beamY, spot.z);
    scale.set(beamSpan, 1, 1);
    matrix.compose(position, rotation, scale);
    beams.setMatrixAt(index, matrix);

    // **One dropper under each actual rail, in that lane's own colour.**
    //
    // There used to be a single dropper per lane, standing on the lane's centre
    // line — which was fine while `RAIL_GAUGE` was 0.62 m and the two rails were
    // near enough one thing. `RIDE_SCALE` took the gauge to 1.55 m, and a lone
    // post three quarters of a metre in from either rail holds up nothing you
    // can see: that, as much as the spacing, is why the family reported the
    // rails as having no supports at all.
    //
    // The colour is `LANE_COLOURS` again — the same array that paints the rails
    // and the carts — so "my colour" stays one fact across the whole ride. The
    // legs and cross-beam below stay structural stone and timber: everything in
    // lane colour and the colour stops meaning "mine".
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      route.pointAt(lane, spot.at, point);
      const length = point.y - beamY;
      dropperColour.set(LANE_COLOURS[lane % LANE_COLOURS.length] ?? PALETTE.markerPink);
      for (const side of [-1, 1] as const) {
        position.set(
          point.x + outward.x * side * RAIL_GAUGE * 0.5,
          beamY + length / 2,
          point.z + outward.z * side * RAIL_GAUGE * 0.5,
        );
        scale.set(1, length, 1);
        matrix.compose(position, rotation, scale);
        droppers.setMatrixAt(dropperIndex, matrix);
        droppers.setColorAt(dropperIndex, dropperColour);
        dropperIndex += 1;
      }
    }
  });

  legs.count = legIndex;
  beams.count = spots.length;
  droppers.count = dropperIndex;
  if (droppers.instanceColor) droppers.instanceColor.needsUpdate = true;
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
  const FLASH = new Color(PALETTE.fairyWarm);
  /**
   * Which zone×lane keys were lit last frame.
   *
   * Only these are painted back to ink, rather than resetting every black
   * stretch on the ring every frame. That mattered once the rails joined in:
   * the plate was a few hundred vertices, the eight rail tubes are twenty-odd
   * thousand, and almost none of them change from one frame to the next.
   */
  let litKeys: string[] = [];
  const nextLitKeys: string[] = [];
  const touched = new Set<BufferAttribute>();

  const paintSpans = (key: string, colour: Color): void => {
    for (const span of zonePaint.get(key) ?? []) {
      const array = span.attribute.array as Float32Array;
      for (const vertex of span.vertices) {
        array[vertex * 3] = colour.r;
        array[vertex * 3 + 1] = colour.g;
        array[vertex * 3 + 2] = colour.b;
      }
      touched.add(span.attribute);
    }
  };

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

      nextLitKeys.length = 0;
      for (const { zoneIndex, lane } of active) nextLitKeys.push(segmentKey(zoneIndex, lane));

      // A stretch that stopped sparking since last frame goes back to plain
      // black — not back to its lane colour: a black stretch is black whether
      // anyone is on it or not, and that is how a child knows where it is
      // before she gets there.
      for (const key of litKeys) {
        if (!nextLitKeys.includes(key)) paintSpans(key, INK);
      }
      for (const key of nextLitKeys) paintSpans(key, sparkColour);

      for (const attribute of touched) attribute.needsUpdate = true;
      touched.clear();
      litKeys = nextLitKeys.slice();
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
 * A run of vertices `setSparking` can recolour: which buffer, and which of its
 * vertices.
 *
 * Deliberately an index list rather than a start/count range. The ground plate
 * *is* contiguous, but a rail tube's vertices are laid out ring by ring along
 * the curve and there is no promise anywhere that a zone's rings stay in one
 * block once the curve wraps — an explicit list costs four bytes a vertex and
 * removes the assumption entirely.
 */
interface PaintSpan {
  readonly attribute: BufferAttribute;
  readonly vertices: Uint32Array;
}

function rangeIndices(start: number, count: number): Uint32Array {
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) indices[i] = start + i;
  return indices;
}

/**
 * Gives one swept rail its lane's colour, and its black stretches ink.
 *
 * Returns which of its vertices belong to which zone, so `setSparking` can
 * flash exactly those and nothing else.
 *
 * **How a vertex knows where it is on the route.** Not from the tube's own `u`
 * parameter — that is the *rail's* arc-length fraction, and a rail swept at an
 * offset from the centre line is a slightly different length from the route it
 * follows. It is read straight back out of the vertex's world position
 * instead, which the ring's shape makes exact: the lanes are concentric
 * circles about the origin, and `route.angleAt(d) = -d / NOMINAL_RADIUS`, so
 * the arc length at `(x, z)` is `-atan2(z, x) * NOMINAL_RADIUS`. The tube's own
 * radius perturbs that by at most 0.19 m, against stretches 15–23 m long.
 */
function paintRail(
  geometry: BufferGeometry,
  route: RailRaceRoute,
  layout: HazardLayout,
  base: Color,
  ink: Color,
): Map<number, PaintSpan> {
  const position = geometry.attributes.position as BufferAttribute;
  const count = position.count;
  const colours = new Float32Array(count * 3);
  const buckets = new Map<number, number[]>();

  for (let i = 0; i < count; i += 1) {
    const distance = route.wrap(-Math.atan2(position.getZ(i), position.getX(i)) * NOMINAL_RADIUS);
    // `layout.zones` are measured from the start/finish arch, which stands at
    // `route.startDistance` rather than at the route's raw zero — the same
    // correction `buildSparkRibbons` makes in the other direction.
    const lapOffset = route.wrap(distance - route.startDistance);
    let zoneIndex = -1;
    for (let k = 0; k < layout.zones.length; k += 1) {
      const zone = layout.zones[k]!;
      if (lapOffset >= zone.from && lapOffset <= zone.to) {
        zoneIndex = k;
        break;
      }
    }
    const colour = zoneIndex >= 0 ? ink : base;
    colours[i * 3] = colour.r;
    colours[i * 3 + 1] = colour.g;
    colours[i * 3 + 2] = colour.b;
    if (zoneIndex >= 0) {
      const bucket = buckets.get(zoneIndex);
      if (bucket) bucket.push(i);
      else buckets.set(zoneIndex, [i]);
    }
  }

  const attribute = new BufferAttribute(colours, 3);
  geometry.setAttribute('color', attribute);
  return new Map(
    [...buckets].map(([zoneIndex, vertices]) => [
      zoneIndex,
      { attribute, vertices: Uint32Array.from(vertices) },
    ]),
  );
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
 * Where a bay of deck goes: **every {@link TRESTLE_SPACING} metres, without
 * exception**.
 *
 * This is the half of the old `trestleSpots` that had no business being
 * conditional, and making it so is what actually answered the family's "the
 * rails have no visible supports". The old function decided the cross-beam,
 * the droppers *and* the ground leg together, on whether the ground 8 m below
 * could take a post. Measured in the built canonical park, that threw away 63
 * of 67 candidate bays — and, tellingly, only 7 of those to the railway and 4
 * to a path. **52 went to `collision.isClearCircle`**: the park's rim at
 * r=53.5 m is simply full of trees, fences and plots. So the ring flew with
 * four supports in 336 m, one every 84 m, which is indistinguishable from
 * none. It was never the spacing constant.
 *
 * A bay of deck needs no ground: it hangs at `beamY`, six-odd metres up, well
 * over the train's canopy and everybody's head. Only the leg needs clear
 * ground, and that is now asked separately — see {@link footUnder}.
 */
function deckSpots(route: RailRaceRoute): TrestleSpot[] {
  const spots: TrestleSpot[] = [];
  const count = Math.floor(route.length / TRESTLE_SPACING);
  for (let i = 0; i < count; i += 1) {
    const at = (i / count) * route.length;
    const theta = route.angleAt(at);
    spots.push({ at, x: Math.cos(theta) * NOMINAL_RADIUS, z: Math.sin(theta) * NOMINAL_RADIUS });
  }
  return spots;
}

/**
 * How far in or out of the ring a leg may stand to find clear ground.
 *
 * The cross-beam is `beamSpan` (10.15 m) wide, so anywhere within about 4.6 m
 * of the centre line is still *under the deck* and reads as holding it up.
 * Tried nearest-first, so a leg only wanders when it has to.
 *
 * This is most of where the extra supports come from. The rim is crowded, but
 * it is crowded in patches — a leg that may shuffle three metres in from a
 * tree finds ground where a leg pinned to r=53.5 m simply gives up.
 */
const FOOT_OFFSETS: readonly number[] = [0, -1.6, 1.6, -3.2, 3.2, -4.6, 4.6];

/** One ground leg per this many bays of deck. */
const LEG_EVERY = 2;

/**
 * Where a bay's leg can actually be stood up, or `null` for a bay that spans
 * without one.
 *
 * The same predicate set the coaster's pylons use, plus one this ride needs and
 * the coaster does not: the ring runs *inside the railway's own band*, so a leg
 * has to clear the train's corridor as well as the walking network. Where it
 * cannot — over the railway, over a path, in the gap between two plots — the
 * leg is simply skipped, and the deck above it carries on regardless. The track
 * shrugs off a missing leg; the walk network cannot shrug off a misplaced one.
 */
function footUnder(
  spot: TrestleSpot,
  outward: Vector3,
  collision: CollisionWorld,
): { readonly x: number; readonly z: number } | null {
  for (const offset of FOOT_OFFSETS) {
    const x = spot.x + outward.x * offset;
    const z = spot.z + outward.z * offset;
    if (!collision.isClearCircle(x, z, 1.1)) continue;
    if (distanceToPath(x, z) < 2.8) continue;
    if (distanceToRailCorridor(x, z) < 2.4) continue;
    const pinchesCorridor = [...PARK_LAYOUT.entries.values()].some(
      (entry) => Math.hypot(x - entry.x, z - entry.z) < entry.boundingRadius + 2.4,
    );
    if (pinchesCorridor) continue;
    return { x, z };
  }
  return null;
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
