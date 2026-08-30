import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { INTERIOR_HALF_X, INTERIOR_HALF_Z } from '../../core/constants';
import { PALETTE } from '../../core/palette';
import { Rng, TAU } from '../../core/mathUtils';
import { SLIDE_PLAN } from '../slide/plan';
import { interiorMaterial, softMaterial } from './parts';
import {
  deckIsSolid,
  regionContains,
  GROWN_UP_X,
  GROWN_UP_Z,
  HELTER_DECK,
  HELTER_ENTRY_X,
  HELTER_ENTRY_Z,
  ROOF_PAVILION_X,
  ROOF_PAVILION_Z,
  SHOP_SCALE_XZ,
  SHOP_UNITS,
  STAIR_STAND_X,
  STAIR_STAND_Z,
  TOILET_DECK,
  TOILET_ROOM,
  TOP_DECK,
  BUILDING_SHAFTS,
  onPlate,
  shopHasForecourt,
  shopLocalToBuilding,
  type ShopUnitDefinition,
} from './layout';

/**
 * What makes a roomy floor read as a *place* rather than as a plain.
 *
 * The family asked for two things that pull against each other: floors two to
 * three times wider (note 4), and a world that feels *closer* and fuller rather
 * than a small figure in a big empty space (note 2). Widening the plate on its
 * own delivers the first and breaks the second — sixty metres of one flat pink
 * colour is not roominess, it is an empty car park.
 *
 * So every deck gets a middle: an inlaid roundel on the floor, a ring of
 * planters round it, and benches scattered over the rest of the plate. Four
 * draw calls a deck, all of them instanced or single meshes, and only the deck
 * you are standing on is ever drawn (the cutaway hides the ones above, and the
 * ones below are behind you).
 *
 * Everything is placed by a **seeded** scatter with rejection, so the furniture
 * is identical on every reload and can never end up in a stairwell, on a shop's
 * serving spot, inside the toilets, or floating over a hole.
 *
 * ## What #403 changed, and what it did not
 *
 * The diagnosis above stands and is not being retracted: a wide plate of one
 * flat colour is an empty car park, and giving each deck a middle is what
 * stopped it reading as a warehouse. What changed is that decorating the plate
 * turned out not to be *enough* on its own. Jim asked for more density three
 * times — issue #376, the roof-garden QA, and finally #403 — and the first two
 * answers were both "add more things". The third answer is to halve the floor
 * **area** instead, so the same furniture reads twice as close together.
 *
 * So nothing here was deleted to make room. The roundel, its planters and the
 * benches are all still the size they were: only the plate under them came in,
 * and the counts below (eight benches a deck, ten on the roof) now cover half
 * the floor they used to. If a later change makes the room bigger again, this
 * file's original reasoning applies again unaltered.
 */

/**
 * Middle of the roundel.
 *
 * South of the shafts, which all sit in a band across the middle of the plate,
 * and west of the way in — so it is the first thing you see on the ground floor
 * without being the thing you are standing on when you arrive.
 */
const ROUNDEL_X = onPlate(-6);
/**
 * Far enough south that the whole disc clears the shaft band (#403).
 *
 * `onPlate(12)` would have been 8.49, and at radius 6 that put the roundel's
 * north edge 0.27 m inside the escalator well — `check:castle`'s shaft
 * assertion caught the rug there on all four lower decks. The shafts sit in a
 * band across the middle of the plate and they did **not** shrink, so on a
 * 31 m-deep floor the roundel no longer has a scaled position available: it
 * has to be placed against the band's own south edge instead.
 *
 * `BUILDING_SHAFTS` is measured rather than a number typed here, so a shaft
 * moving pushes the roundel rather than silently overlapping it. There is
 * 12.3 m between the band and the south wall and the disc is 12 m across, so
 * this is a genuinely tight fit — see HANDOFF-castle-shrink.md.
 */
const ROUNDEL_Z = (() => {
  const bandSouthEdge = Math.max(
    ...BUILDING_SHAFTS.map(({ region }) =>
      region.kind === 'rect' ? region.maxZ : region.z + region.radius,
    ),
  );
  return bandSouthEdge + 0.7 + 6;
})();
/**
 * Authored size, deliberately **not** scaled with the plate (#403).
 *
 * A 12 m disc on a 42 m floor is a bigger share of the room than it was on a
 * 60 m one, and that is the intended direction: the roundel is furniture, and
 * halving the area is about the same furniture covering more of the floor.
 */
const ROUNDEL_RADIUS = 6;

/** Nothing is placed within this of something a child needs to walk to. */
const KEEP_OUT = 2.6;

export interface KeepOut {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export function dressDeck(deck: number, floor: Group): void {
  const isRoof = deck === TOP_DECK;
  const blocked = keepOutsFor(deck);

  if (!isRoof) {
    floor.add(buildRoundel(deck));
    floor.add(buildPlanterRing(deck));
  }
  floor.add(buildBenches(deck, blocked, isRoof));
}

// ------------------------------------------------------------- the middle

/**
 * A big inlaid roundel, in the storey's own accent.
 *
 * Two flat discs a couple of centimetres proud of the slab. It costs two draw
 * calls and it is the single biggest reason a sixty-metre floor stops looking
 * like a warehouse: it gives the eye a middle, and it gives a child somewhere
 * that is obviously *the* place to meet.
 */
function buildRoundel(deck: number): Group {
  const group = new Group();
  group.name = `deck-roundel-${deck}`;
  group.position.set(ROUNDEL_X, 0, ROUNDEL_Z);

  const outer = new Mesh(
    new CylinderGeometry(ROUNDEL_RADIUS, ROUNDEL_RADIUS, 0.04, 40),
    interiorMaterial(deck % 2 === 0 ? PALETTE.buildingFloorAlt : PALETTE.buildingFloor, 0.7),
  );
  outer.position.y = 0.02;
  outer.receiveShadow = true;
  group.add(outer);

  const inner = new Mesh(
    new CylinderGeometry(ROUNDEL_RADIUS * 0.52, ROUNDEL_RADIUS * 0.52, 0.05, 32),
    interiorMaterial(PALETTE.blossomWhite, 0.55),
  );
  inner.position.y = 0.035;
  inner.receiveShadow = true;
  group.add(inner);

  return group;
}

/** A ring of chunky planters round the roundel. One instanced mesh. */
function buildPlanterRing(deck: number): Group {
  const group = new Group();
  group.name = `deck-planters-${deck}`;
  group.position.set(ROUNDEL_X, 0, ROUNDEL_Z);

  const count = 10;
  const pots = new InstancedMesh(
    new CylinderGeometry(0.44, 0.36, 0.7, 12),
    softMaterial(PALETTE.stonePinkLight, 0.8),
    count,
  );
  const bushes = new InstancedMesh(
    new SphereGeometry(0.55, 12, 9),
    softMaterial(PALETTE.leafMid, 0.7),
    count,
  );
  for (const mesh of [pots, bushes]) {
    mesh.castShadow = false;
    mesh.receiveShadow = true;
  }

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * TAU;
    const x = Math.cos(angle) * (ROUNDEL_RADIUS - 0.9);
    const z = Math.sin(angle) * (ROUNDEL_RADIUS - 0.9);
    position.set(x, 0.35, z);
    matrix.compose(position, rotation, scale);
    pots.setMatrixAt(i, matrix);
    position.set(x, 0.95, z);
    matrix.compose(position, rotation, scale);
    bushes.setMatrixAt(i, matrix);
  }
  pots.instanceMatrix.needsUpdate = true;
  bushes.instanceMatrix.needsUpdate = true;

  group.add(pots, bushes);
  return group;
}

// ---------------------------------------------------------------- benches

/**
 * Benches, scattered by a seeded rejection sample.
 *
 * Rejection rather than a hand-placed list because there are five decks and the
 * plan moves: anything hand-placed goes stale the first time a shaft shifts a
 * metre, and a bench floating in a stairwell is a bench a child falls through.
 */
function buildBenches(deck: number, blocked: readonly KeepOut[], isRoof: boolean): InstancedMesh {
  const rng = new Rng(9100 + deck * 37);
  const wanted = isRoof ? 10 : 8;
  const spots: { x: number; z: number; yaw: number }[] = [];

  for (let attempt = 0; attempt < 500 && spots.length < wanted; attempt += 1) {
    const x = rng.range(-INTERIOR_HALF_X + 3, INTERIOR_HALF_X - 3);
    const z = rng.range(-INTERIOR_HALF_Z + 3, INTERIOR_HALF_Z - 3);
    // Never over a hole, and never within one step of the lip of one either.
    if (!deckIsSolid(deck, x, z)) continue;
    if (!deckIsSolid(deck, x + 1.4, z) || !deckIsSolid(deck, x - 1.4, z)) continue;
    if (!deckIsSolid(deck, x, z + 1.4) || !deckIsSolid(deck, x, z - 1.4)) continue;
    if (blocked.some((k) => Math.hypot(x - k.x, z - k.z) < k.radius)) continue;
    if (spots.some((s) => Math.hypot(x - s.x, z - s.z) < 5)) continue;
    spots.push({ x, z, yaw: rng.pick([0, Math.PI / 2]) });
  }

  const benches = new InstancedMesh(
    new BoxGeometry(2.2, 0.44, 0.72),
    softMaterial(isRoof ? PALETTE.woodLight : PALETTE.buildingTrimDeep, 0.78),
    Math.max(1, spots.length),
  );
  benches.name = `deck-benches-${deck}`;
  benches.castShadow = false;
  benches.receiveShadow = true;
  benches.count = spots.length;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3(0, 1, 0);
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  spots.forEach((spot, index) => {
    rotation.setFromAxisAngle(axis, spot.yaw);
    position.set(spot.x, 0.22, spot.z);
    matrix.compose(position, rotation, scale);
    benches.setMatrixAt(index, matrix);
  });
  benches.instanceMatrix.needsUpdate = true;
  return benches;
}

// --------------------------------------------------------------- keep-outs

/**
 * Everywhere a child has to be able to stand, walk to, or ride from.
 *
 * **Exported (issue #376) so the castle's decoration and `check:castle` both
 * ask this one list rather than growing their own.** Castle props get no
 * colliders at all — indoor collision is height-blind, so a collider on deck 0
 * would block that square metre on all five storeys — which means placement is
 * the only protection a prop gets and a second copy of these discs is the whole
 * ballgame. See `HANDOFF-castle-interior-363.md` §5.
 */
export function keepOutsFor(deck: number): KeepOut[] {
  const blocked: KeepOut[] = [
    // The stairs pad and the lane in front of it.
    { x: STAIR_STAND_X, z: STAIR_STAND_Z, radius: 4.4 },
    // The lift lobby, on the east wall.
    { x: INTERIOR_HALF_X - 2, z: 5, radius: 4 },
    // The roundel and its planters.
    { x: ROUNDEL_X, z: ROUNDEL_Z, radius: ROUNDEL_RADIUS + 1.6 },
    // The way in and out, on the ground floor's south wall.
    { x: 0, z: INTERIOR_HALF_Z - 4, radius: 7 },
  ];

  if (deck === TOP_DECK) {
    // The roof's own furniture: the pavilion, the slide you leave from, and the
    // grown-up who waits to come down it with you.
    blocked.push(
      { x: ROOF_PAVILION_X, z: ROOF_PAVILION_Z, radius: 8 },
      { x: SLIDE_PLAN.entryX, z: SLIDE_PLAN.entryZ, radius: 5 },
      { x: GROWN_UP_X, z: GROWN_UP_Z, radius: 4 },
    );
  }

  if (deck === HELTER_DECK) {
    blocked.push({ x: HELTER_ENTRY_X, z: HELTER_ENTRY_Z, radius: 4 });
  }

  if (deck === TOILET_DECK) {
    blocked.push({
      x: (TOILET_ROOM.minX + TOILET_ROOM.maxX) / 2,
      z: (TOILET_ROOM.minZ + TOILET_ROOM.maxZ) / 2,
      radius: 7,
    });
  }

  for (const unit of SHOP_UNITS) {
    if (unit.deck !== deck) continue;
    blocked.push(...shopKeepOut(unit));
  }

  return blocked;
}

/**
 * The counter, the serving spot, and enough room to queue.
 *
 * Scaled by `SHOP_SCALE_XZ` to match the now-bigger shop, with extra radius on
 * top for shops with a sunken forecourt: a bench cannot be placed a step away
 * from a 30 cm drop it cannot see coming.
 */
function shopKeepOut(unit: ShopUnitDefinition): KeepOut[] {
  const spots: KeepOut[] = [];
  const radius = KEEP_OUT + 1.4 + (shopHasForecourt(unit) ? 2 : 0);
  for (const along of [-1.8, 0, 1.8]) {
    const [x, z] = shopLocalToBuilding(unit, along * SHOP_SCALE_XZ, 2 * SHOP_SCALE_XZ);
    spots.push({ x, z, radius });
  }
  return spots;
}

/** Exported for tests and for anything else that wants the roundel's middle. */
export const DECK_ROUNDEL = { x: ROUNDEL_X, z: ROUNDEL_Z, radius: ROUNDEL_RADIUS } as const;

/** True if a point sits on the roundel — handy for placing things on it. */
export function onRoundel(x: number, z: number): boolean {
  return regionContains(
    { kind: 'circle', x: ROUNDEL_X, z: ROUNDEL_Z, radius: ROUNDEL_RADIUS },
    x,
    z,
  );
}
