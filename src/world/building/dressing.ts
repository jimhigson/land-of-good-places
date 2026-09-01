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
  insideInterior,
  regionContains,
  GROWN_UP_X,
  GROWN_UP_Z,
  ROOF_PAVILION_X,
  ROOF_PAVILION_Z,
  SHOP_SCALE_XZ,
  SHOP_UNITS,
  MALL_DECK,
  TOILET_DECK,
  TOILET_ROOM,
  TOP_DECK,
  onPlate,
  shopHasForecourt,
  shopLocalToBuilding,
  type ShopUnitDefinition,
} from './layout';
import { CASTLE_GREAT_HALL_DECK, greatHallFootprint } from './castleFurniture';

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
 * The roundel sits in the southern half of the floor, between the market and
 * the door.
 *
 * It used to be pinned to the **south edge of the shaft band**, measured off
 * `BUILDING_SHAFTS`, and the note here recorded how tight that was: 12.3 m of
 * floor for a 12 m disc, because the shafts sat in a band across the middle of
 * the plate and had not shrunk with it. The band is gone with the shafts, so
 * the disc has room again and can simply be placed.
 *
 * South of the market's aisle rather than centred, so a child walks in through
 * the front door, across the roundel, and *into* the market — the rug leads her
 * to the stalls rather than sitting behind them.
 */
const ROUNDEL_Z = INTERIOR_HALF_Z - 0.8 - 6;
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

/**
 * **The great hall is furnished, so it gets none of this** (issue #449).
 *
 * Jim, looking at #453: *"Banquet tables have green bench things clipping into
 * them, and also the tables don't compose nicely into the space, they're kind
 * of shoved into one end of a mostly empty room. Clear out other 'stuff' from
 * the middle of the room so it focusses on the banquet only."*
 *
 * Both halves of that are this one line. The green benches were {@link
 * buildBenches}' seeded scatter, which rejects against {@link keepOutsFor} and
 * therefore knew nothing about a feast table — so benches landed in the middle
 * of the banquet, and would have gone on landing there however the tables were
 * arranged. And the roundel and its ring of planters are the *other* half of
 * what made the room read as a banquet in the corner of a lobby: a 12 m inlaid
 * disc with a ring of pots round it is a second, competing middle for a room
 * that has one already.
 *
 * The argument for not simply nudging them out of the way: this file's own
 * header says what this furniture is *for* — it is what stops a wide, bare
 * plate reading as a car park. **The great hall is not a bare plate.** It has a
 * throne, tapestries, a fireplace and a banquet down the middle of it, which is
 * a far better answer to the same problem, so the generic answer is not needed
 * and is only ever in the way.
 *
 * Everything the hall does have is `castleFurniture.ts`'s, placed rather than
 * scattered, and measured by `check:castle`.
 *
 * Exported because `castleDecor.ts` lays a **rug** on {@link DECK_ROUNDEL} —
 * dressing the disc this file draws. With no disc there is nothing for it to
 * dress, and it was found lying on bare flagstones under the banquet with a
 * dozen children standing on it. One question, one answer, asked by both.
 */
export function deckIsFurnished(deck: number): boolean {
  return deck === CASTLE_GREAT_HALL_DECK;
}

export function dressDeck(deck: number, floor: Group): void {
  if (deckIsFurnished(deck)) return;

  const isRoof = deck === TOP_DECK;

  if (!isRoof) {
    floor.add(buildRoundel(deck));
    floor.add(buildPlanterRing(deck));
  }
  floor.add(buildBenches(deck, benchesOn(deck)));
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

/** How many planters ring the roundel. */
const PLANTER_COUNT = 10;
/** How far out from the roundel's middle they stand. */
const PLANTER_RING_RADIUS = ROUNDEL_RADIUS - 0.9;
/** The pot's widest radius — its rim. It tapers to 0.36 at the foot, and the
 *  rim is what a child's shins actually meet. */
export const PLANTER_RADIUS = 0.44;
/** How tall the pot stands. The bush above it is another 0.8 m and is
 *  deliberately **not** part of the collider — see {@link planterRing}. */
export const PLANTER_TOP = 0.7;

/** Where one planter stands, in its deck's own local metres. */
export interface Planter {
  readonly x: number;
  readonly z: number;
}

/**
 * **Where the ten planters are** — the ring arithmetic, once (#459).
 *
 * Jim, straight after the pavilion: *"and also planters that you can run
 * through."* They are two `InstancedMesh`es, so unlike a bench there is no
 * list of transforms to walk; the honest way to give them colliders is to ask
 * the same function that places the instances, which is this. `buildPlanterRing`
 * draws these positions and `registerPlanterCollision` makes these positions
 * solid — there is no second copy of `cos(angle) * (ROUNDEL_RADIUS - 0.9)` to
 * drift.
 *
 * ## The pot is solid; the bush is not
 *
 * A planter is a stone pot with a shrub in it, and those are two different
 * things to a child running past. The pot is knee-high masonry and stops her.
 * The bush is foliage: brushing through leaves is what foliage is *for*, and a
 * 1.5 m invisible wall of hedge round the roundel would be both wrong and
 * unjumpable.
 *
 * `topIsAbsolute` is what lets that be one collider rather than an argument:
 * the pot is solid to feet on the floor and open to feet in a jump, so she can
 * hop the planter — bush and all — exactly as Jim's 7 August rule asks, and
 * the leaves she passes through on the way are leaves.
 *
 * ## Ten pots in a ring is not a fence
 *
 * The roundel is *the* meeting spot on a floor, and it is in
 * {@link keepOutsFor} for that reason — so enclosing it would be the precise
 * thing solidity must never cost. It does not: the ring's circumference is
 * `2π × 5.1` = 32.0 m over ten pots, so their centres are 3.20 m apart and
 * their rims 2.32 m apart, against a child 1.24 m across. She walks between
 * any two of them with half a metre either side. That is arithmetic, and
 * `check:benches` floods the floor and holds it to the result rather than to
 * this paragraph.
 */
export function planterRing(deck: number): Planter[] {
  // Only the decks that have a roundel to ring — `dressDeck`'s own two tests,
  // asked rather than copied. The roof garden has no roundel and the great
  // hall has a banquet where one would go.
  if (deck === TOP_DECK || deckIsFurnished(deck)) return [];
  const ring: Planter[] = [];
  for (let i = 0; i < PLANTER_COUNT; i += 1) {
    const angle = (i / PLANTER_COUNT) * TAU;
    ring.push({
      x: ROUNDEL_X + Math.cos(angle) * PLANTER_RING_RADIUS,
      z: ROUNDEL_Z + Math.sin(angle) * PLANTER_RING_RADIUS,
    });
  }
  return ring;
}

/** A ring of chunky planters round the roundel. One instanced mesh. */
function buildPlanterRing(deck: number): Group {
  const group = new Group();
  group.name = `deck-planters-${deck}`;

  const ring = planterRing(deck);
  const pots = new InstancedMesh(
    new CylinderGeometry(PLANTER_RADIUS, 0.36, PLANTER_TOP, 12),
    softMaterial(PALETTE.stonePinkLight, 0.8),
    ring.length,
  );
  const bushes = new InstancedMesh(
    new SphereGeometry(0.55, 12, 9),
    softMaterial(PALETTE.leafMid, 0.7),
    ring.length,
  );
  for (const mesh of [pots, bushes]) {
    mesh.castShadow = false;
    mesh.receiveShadow = true;
  }

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  ring.forEach((planter, i) => {
    // The group used to sit at the roundel and the instances used to be placed
    // relative to it. They are absolute now, because `planterRing` has to hand
    // the same coordinates to the collision world, which knows nothing about
    // this group's transform.
    position.set(planter.x, PLANTER_TOP / 2, planter.z);
    matrix.compose(position, rotation, scale);
    pots.setMatrixAt(i, matrix);
    position.set(planter.x, PLANTER_TOP + 0.25, planter.z);
    matrix.compose(position, rotation, scale);
    bushes.setMatrixAt(i, matrix);
  });
  pots.instanceMatrix.needsUpdate = true;
  bushes.instanceMatrix.needsUpdate = true;

  group.add(pots, bushes);
  return group;
}

// ---------------------------------------------------------------- benches

/** Where one bench stands, and which way it faces. */
export interface BenchSpot {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/**
 * Where this deck's benches stand — **one list, asked twice**.
 *
 * Scattered by a seeded rejection sample rather than a hand-placed list,
 * because the plan moves: anything hand-placed goes stale the first time a
 * keep-out shifts a metre. (It used to say "the first time a *shaft* shifts",
 * and that a bench floating in a stairwell is a bench a child falls through —
 * both true until #377/#380 deleted every shaft and every hole. The reason
 * survives the shafts; only the example needed replacing.)
 *
 * Exported for the same reason {@link keepOutsFor} is. The roof's long grass
 * (`roofMeadow.ts`) has to keep off the benches, and a bench is placed by a
 * seeded rejection sample rather than written down anywhere, so the only two
 * ways for the meadow to know where they are were to re-run the sample (a
 * second copy of the seed, the wanted count and every rejection rule, silently
 * wrong the first time any one of them changes) or to ask. It asks.
 *
 * Deterministic and cheap — a few hundred rejections against a handful of
 * discs — so it is called fresh at both sites rather than cached.
 */
export function deckBenchSpots(deck: number, blocked: readonly KeepOut[], isRoof: boolean): BenchSpot[] {
  const rng = new Rng(9100 + deck * 37);
  const wanted = isRoof ? 10 : 8;
  const spots: BenchSpot[] = [];

  for (let attempt = 0; attempt < 500 && spots.length < wanted; attempt += 1) {
    const x = rng.range(-INTERIOR_HALF_X + 3, INTERIOR_HALF_X - 3);
    const z = rng.range(-INTERIOR_HALF_Z + 3, INTERIOR_HALF_Z - 3);
    // Never over a hole, and never within one step of the lip of one either.
    if (!insideInterior(x, z)) continue;
    if (!insideInterior(x + 1.4, z) || !insideInterior(x - 1.4, z)) continue;
    if (!insideInterior(x, z + 1.4) || !insideInterior(x, z - 1.4)) continue;
    if (blocked.some((k) => Math.hypot(x - k.x, z - k.z) < k.radius)) continue;
    if (spots.some((s) => Math.hypot(x - s.x, z - s.z) < 5)) continue;
    spots.push({ x, z, yaw: rng.pick([0, Math.PI / 2]) });
  }
  return spots;
}

/**
 * **This deck's benches, asked with the deck's own keep-outs** — the single
 * call every consumer makes.
 *
 * {@link deckBenchSpots} takes its keep-out list as a parameter, which is what
 * lets the roof's meadow add the trampoline to the list it measures *grass*
 * against without also moving the benches. That flexibility is exactly what
 * makes it the wrong thing for a third and fourth caller to reach for: the
 * benches a child sees, the benches she bumps into and the benches she can
 * stand on must be the *same* benches, and three call sites each assembling
 * their own `blocked` array is three chances to differ. So the scatter takes
 * a list, and this — the one that says which list a bench is actually placed
 * against — takes only a deck.
 */
export function benchesOn(deck: number): BenchSpot[] {
  // **A furnished deck has none**, and this asks {@link deckIsFurnished}
  // rather than re-testing the great hall's number, because `dressDeck`
  // already returns early on exactly that test. A collider for a bench nobody
  // drew is an invisible wall in the middle of the banquet — and it is the
  // *cheapest* possible bug to introduce, since the scatter is perfectly happy
  // to hand out ten spots for a room it is not decorating.
  if (deckIsFurnished(deck)) return [];
  return deckBenchSpots(deck, keepOutsFor(deck), deck === TOP_DECK);
}

/** How far from a bench's centre nothing else may grow. Half its 2.2 m length,
 *  plus room to sit down without a face full of grass. */
export const BENCH_CLEAR_RADIUS = 2.2;

/**
 * How big a bench is, in metres — **the one description**, read by the box
 * that is drawn, by the collider that stops her, and by the plate she lands on
 * when she jumps up onto it.
 *
 * These were three literals inside `new BoxGeometry(2.2, 0.44, 0.72)` and
 * nothing else knew them, which was fine while a bench was scenery. It is not
 * fine now that a bench is solid: a collider sized from a second copy of these
 * numbers is CLAUDE.md's most common bug with a 2.2 m lever on it, and the
 * failure mode — a bench whose invisible edge is 20 cm off the wood — is
 * precisely the kind a child finds and a build cannot.
 */
export const BENCH_LENGTH = 2.2;
export const BENCH_HEIGHT = 0.44;
export const BENCH_DEPTH = 0.72;

/**
 * One bench's footprint, axis-aligned, as the collision world and the walk
 * surfaces want it.
 *
 * A bench's yaw is only ever `0` or `π / 2` ({@link deckBenchSpots} picks from
 * those two), so a quarter turn is a swap of half-extents rather than a
 * rotated box — which matters because `CollisionWorld.addRectangle` is
 * axis-aligned and has no way to express anything else. The `yaw > 0.1` test
 * is deliberately a test of the *spot*, not an assumption about it: if the
 * scatter ever rolls a free yaw, this rounds it to the nearer axis and
 * `check:benches`' footprint clause is what will say so.
 */
export interface BenchFootprint {
  readonly x: number;
  readonly z: number;
  readonly halfX: number;
  readonly halfZ: number;
  /** The bench's own top, above the floor it stands on. */
  readonly top: number;
}

export function benchFootprints(deck: number): BenchFootprint[] {
  return benchesOn(deck).map((spot) => {
    const turned = Math.abs(Math.sin(spot.yaw)) > Math.SQRT1_2;
    return {
      x: spot.x,
      z: spot.z,
      halfX: (turned ? BENCH_DEPTH : BENCH_LENGTH) / 2,
      halfZ: (turned ? BENCH_LENGTH : BENCH_DEPTH) / 2,
      top: BENCH_HEIGHT,
    };
  });
}

function buildBenches(deck: number, spots: readonly BenchSpot[]): InstancedMesh {
  const benches = new InstancedMesh(
    new BoxGeometry(BENCH_LENGTH, BENCH_HEIGHT, BENCH_DEPTH),
    softMaterial(deck === TOP_DECK ? PALETTE.woodLight : PALETTE.buildingTrimDeep, 0.78),
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
    position.set(spot.x, BENCH_HEIGHT / 2, spot.z);
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
 * ask this one list rather than growing their own.** See
 * `HANDOFF-castle-interior-363.md` §5.
 *
 * ## The rule that used to be written here, and why it is gone
 *
 * This said: *"Castle props get no colliders at all — indoor collision is
 * height-blind, so a collider on deck 0 would block that square metre on all
 * five storeys — which means placement is the only protection a prop gets."*
 *
 * **That is no longer true, and leaving it here is how the next person gets
 * talked out of the right fix.** It was one sentence carrying two facts, and
 * the prohibition only followed if both held: (A) the collision world is 2-D,
 * so a collider blocks at every height, and (B) two storeys share an (x, z),
 * so A reaches across them. `scripts/probe-height-blind.mts` measures each on
 * its own. **A still holds. B died with #377/#380.** There are three floors,
 * not five, they stand 300 m apart, and the great hall's plate is 279 m from
 * the nearest point of any other storey: of 21250 points swept on the mall and
 * 21250 on the roof, a collider in the middle of the hall blocks **none**.
 *
 * So the banquet's tables, benches and pets' table **are** solid — Jim, on
 * #453: *"you can walk straight through the tables — they should be solid"* —
 * and `castleFurniture.ts`'s `greatHallSolids` is where that lives.
 *
 * ## What this list is still for, which is not that
 *
 * Two different questions, and conflating them is a bug in each direction:
 *
 * - **"Where must a child be able to stand?"** — *this list*. It is what the
 *   seeded scatters (benches, braziers, corner clutter) reject against, so a
 *   walking route, a doorway or a ride's boarding spot never has furniture
 *   dropped into it. It is a **placement** rule and it stays one; adding a
 *   collider to a prop does not remove the need to keep the room walkable.
 * - **"Where is furniture already standing?"** — `greatHallFootprint`, next to
 *   the thing that puts it there. Do not merge it into this list: every table,
 *   bench and goblet at the feast is inside the banquet, so `check:castle`'s
 *   prop assertion would then fail on the banquet's own furniture.
 *
 * Since #459 the **deck benches, the roundel's planters and the roof
 * pavilion** carry colliders too — Jim, the same afternoon: *"the general rule
 * should be that nothing can be run through — the player is not a ghost."*
 * Anything that gains one takes an **absolute** top (`Collision.ts`'s
 * `topIsAbsolute`), never the default `Infinity`, or a 0.675 m table becomes an
 * invisible pillar to the ceiling. `world/hotel/place.ts` is the shipped
 * precedent, and `check:benches` is what holds this list to the result: it
 * floods the walkable floor from where the lift puts her down and requires
 * every disc here to still have somewhere to stand in it.
 *
 * Props that still carry none — the market stalls, the crates, the armour, the
 * lift car — do so for an ordinary reason rather than an architectural one:
 * nobody has got to them yet. That is a backlog, not a rule.
 */
export function keepOutsFor(deck: number): KeepOut[] {
  const blocked: KeepOut[] = [
    // The stairs pad and the lane in front of it.
    // The lift lobby, on the east wall. Every floor has one, because the lift
    // is the only way between them.
    { x: INTERIOR_HALF_X - 2, z: 5, radius: 4 },
  ];

  // **A disc for the roundel only on a floor that has a roundel, and one for
  // the front door only on the floor the front door is on** (issue #449).
  //
  // These two claimed 14 m and 15.2 m of floor on *every* storey, and on the
  // great hall both of them claimed floor that nothing whatsoever stands on:
  // {@link dressDeck} does not dress a furnished deck, and the way in and out
  // is on the mall — the floors are disjoint spaces reached only by the lift,
  // so there is no front door anywhere else to walk to.
  //
  // Between them they were most of Jim's *"shoved into one end of a mostly
  // empty room"*: the banquet had the north-east corner because two invisible
  // discs held the south and the middle of the hall against furniture that
  // was never built there. This is not a widened assertion — it is the list
  // catching up with what is actually on the floor. A keep-out exists to stop
  // a prop landing where a child must be able to stand; one guarding a
  // roundel that was never laid guards nothing.
  if (!deckIsFurnished(deck)) {
    blocked.push({ x: ROUNDEL_X, z: ROUNDEL_Z, radius: ROUNDEL_RADIUS + 1.6 });
  }
  if (deck === MALL_DECK) {
    blocked.push({ x: 0, z: INTERIOR_HALF_Z - 4, radius: 7 });
  }

  if (deck === TOP_DECK) {
    // The roof's own furniture: the pavilion, the slide you leave from, and the
    // grown-up who waits to come down it with you.
    blocked.push(
      { x: ROOF_PAVILION_X, z: ROOF_PAVILION_Z, radius: 8 },
      { x: SLIDE_PLAN.entryX, z: SLIDE_PLAN.entryZ, radius: 5 },
      { x: GROWN_UP_X, z: GROWN_UP_Z, radius: 4 },
    );
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
 * **Where a scattered prop may not land** — {@link keepOutsFor} plus whatever
 * furniture is already standing on this floor.
 *
 * The two are different questions and the difference matters. `keepOutsFor` is
 * *where a child has to be able to stand*, and `check:castle` fails any prop
 * that lands in one — so the great hall's banquet cannot go in it, because the
 * banquet's own tables and benches are inside the banquet. But a brazier
 * choosing a spot at random very much does need to know the tables are there:
 * with the hall filled (#449) two of the four landed inside benches, measured
 * in the running game.
 *
 * So: things that are *placed* ask `keepOutsFor`, and things that **scatter**
 * ask this. One extra call at each of the two scatter sites, and no list is
 * kept in step with another by hand.
 */
export function scatterKeepOutsFor(deck: number): KeepOut[] {
  return [...keepOutsFor(deck), ...greatHallFootprint(deck)];
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
