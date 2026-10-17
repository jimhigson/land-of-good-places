import { Vector3 } from 'three';
import { GARDEN_PLAY_BOUNDARY, type ParkBoundary } from './boundary';
import { riseBetween } from './building/stepReach';
import { GROUND_SPHERE_RADIUS } from '../core/constants';
import { SPACE_GARDEN, spaceAt } from './spaces';

/**
 * Deliberately simple solid-object handling.
 *
 * There is no physics engine and there shouldn't be one: this is a cosy walking
 * game. Everything solid registers itself as either a circle (tree trunks, the
 * fountain, sign posts) or a thick line segment (walls and fences), and moving
 * characters get pushed back out of anything they end up inside.
 *
 * Register colliders while building scenery:
 * ```ts
 * collision.addCircle(x, z, 0.5);
 * collision.addWall(x1, z1, x2, z2, 0.35);
 * ```
 *
 * Colliders also carry a `topHeight` — how tall they are above their *own*
 * local ground, in metres. It defaults to `Infinity`, meaning "always solid,
 * however high you jump", which is exactly the old behaviour and is what every
 * caller gets for free by not passing one. Only the wooden and stone garden
 * walls pass a real number (their actual visual height), which is what lets a
 * jump clear a low wall but not a tall one — see `resolve`'s `clearance`
 * parameter.
 *
 * A collider may also opt into `autoHoppable` — see {@link
 * CollisionWorld.wouldAutoHopClear}, design feedback #30e. It defaults to
 * `false`, so every existing caller keeps its current behaviour for free:
 * only `Scenery`'s wooden and stone garden walls pass `true`. The fountain
 * rim has a finite `topHeight` too (its own jump is a deliberate feature —
 * design feedback #12), but is deliberately never `autoHoppable`, and nor is
 * anything the building registers — auto-hop must never fire for something a
 * child did not choose to jump into, which the fountain's water and a stair's
 * side rail both are.
 *
 * ## `topIsAbsolute` — a top you can stand on, not just jump over
 *
 * The relative scheme above compares a collider's `topHeight` against the
 * mover's clearance above *the sampler's* ground, which makes it impossible
 * for one collider to be both solid and standable: a child stood on top of a
 * sofa is at clearance 0, so the sofa's own wall shoves her straight back
 * off it — the law that forced the suite's beds to be registered soft, and
 * the reason every piece of hotel furniture used to be an infinitely tall
 * pillar (Jim, live play, 7 Aug 2026: *"I can't even jump onto a sofa that's
 * much less tall than my jump"*).
 *
 * A collider with `topIsAbsolute` instead states its top as a **world-space
 * Y** and is compared against the mover's actual `position.y` — which for
 * the player is genuinely absolute, ground plus jump. Walking into it from
 * the floor blocks (feet at 0 against a 0.5 m top); a jump whose flight
 * carries her feet above the top sails on; and once she is *stood* on the
 * prop (a `WalkSurfaces` plate at exactly that top), her feet equal the top
 * and it holds still beneath her instead of ejecting her. One collider,
 * three honest answers, no second registration to fall out of step.
 *
 * Not combinable with `autoHoppable`: the auto-hop planner reasons in
 * relative clearances, and nothing a child did not choose to jump onto
 * should auto-fire anyway. `world/hotel/place.ts` is the caller this exists
 * for.
 *
 * ## `baseHeight` — a collider that exists only above its own base
 *
 * The mirror of `topIsAbsolute`, for the opposite problem: a balustrade on
 * the edge of an **overhanging** deck. The imperial lobby's landing hangs
 * 3.84 m over an open, walk-through arch (its whole design — Jim's reference
 * photograph is the see-through), so the rail that stops a child walking off
 * the landing stands directly above floor a child on the ground must walk
 * under freely. A height-agnostic collider there is an invisible wall across
 * the archway; no collider at all is a six-year-old walking off a 3.84 m
 * drop. `baseHeight` is the third answer: a **world-space Y** below which the
 * collider simply does not exist. The landing's rails carry
 * `baseHeight = landingY − 0.5` — active for anyone stood on the landing
 * (feet at landingY, damp-lag included), inert for anyone on the floor below,
 * unreachable by a ground jump (apex 1.28 m, far under the base).
 *
 * Absolute-only, deliberately, for exactly the reason `topIsAbsolute` exists:
 * `clearance` is measured above the mover's *own* ground, so every walker on
 * every level reads 0 and a relative base could never tell a deck walker from
 * a floor walker. Defaults to `-Infinity` — every existing caller keeps
 * today's behaviour for free. Not combinable with `autoHoppable` (the hop
 * planner reasons in relative clearances; `checkHoppableColliders` demotes
 * offenders).
 *
 * `NavGrid` does **not** stamp a banded collider into its lattice by default:
 * stamping one would wall off the walkable floor beneath it at every level —
 * the exact disease the band cures in the resolver — and for an *edge* rail
 * (a balustrade on a drop) the lattice's own level rule already refuses every
 * route the rail refuses, because nothing walkable sits within a step across
 * it. `navStamped` is for the one banded collider that rule cannot cover: the
 * **flank of a ramp** whose edge levels run within a step of the floor beside
 * it. The imperial lobby's grand flight stands on its landing, and its lowest
 * treads are half a riser above it — so the lattice happily connected the
 * landing to the flight *sideways through the flank*, and the walk wedged
 * against a rail the router could not see (found live, 9 Aug 2026, and held
 * red by check:nav-routes' walked-legs probe). A `navStamped` banded collider
 * is stamped like any wall — ground routes detour around its shadow, which is
 * the honest price of the lattice staying two-dimensional.
 */

/**
 * **A solid's heights** — what every collider kind carries beyond its shape.
 *
 * A solid is a 3-D body: a footprint, a bottom and a top. The top is where her
 * feet come to rest when she is over it (`highestTopAt`), and the sides are
 * what she bumps into below it; the bottom is where it begins, so she walks
 * under a canopy and her head meets its underside (`ceilingAt`).
 *
 * **Heights are taken where they are asked.** Indoors up is `+Y` and a height
 * is a world `y`. Out in the park the ground is a sphere and up is away from
 * its centre, so a top given as a world `y` at the solid's own reference point
 * is held as a **radius** from the planet's centre (`topRadius`) and read back
 * as the world `y` of that sphere over whatever column is asked — the leaned,
 * flat top the solid is drawn with, to a few centimetres over a 6 m wall —
 * rather than one number that is right at the solid's centre and a third of a
 * metre wrong at its ends on the park's steep far side.
 */
interface SolidHeights {
  topHeight: number;
  autoHoppable: boolean;
  topIsAbsolute: boolean;
  /** World Y below which this collider does not exist. See the header. */
  baseHeight: number;
  /** Banded, yet stamped into route maps — a ramp's flank. See the header. */
  navStamped: boolean;
  /** What registered it, where the registration was scoped ({@link CollisionWorld.ownedBy}); `''` otherwise. */
  owner: string;
  /** What kind of thing it is — "garden wall", "lamp post" — where the registration was scoped ({@link CollisionWorld.kinded}); `''` otherwise. */
  kind: string;
  /**
   * The absolute top as a distance from the planet's centre, for a solid out in
   * the park (see the interface doc); `NaN` indoors, for a relative top, or for
   * one with no top at all.
   */
  topRadius: number;
  /** The base the same way: a radius in the park, `NaN` otherwise. */
  baseRadius: number;
  /**
   * How tall the solid is above the ground it stands on, for the one question
   * asked in those terms: whether a hop is *planned* over it
   * ({@link autoHopClears}, `NavGrid`'s hop band, the auto-hop lookahead). A
   * relative top is its own; an absolute one says it when registered as
   * hoppable, and is `NaN` otherwise (nothing plans a hop over it).
   */
  hopHeight: number;
  /**
   * A wall whose top **runs straight from one end's to the other's** — given
   * when it is registered with a top at each end ({@link CollisionWorld.addWall}'s
   * `topHeightEnd`) — and absent for a solid with one top everywhere. See
   * {@link TopSlope}.
   */
  topSlope?: TopSlope;
  /**
   * **How wide the top she can stand on is**, as a half-width from the solid's
   * axis (a wall) or centre (a circle) — `NaN` when it is the whole footprint.
   * A rail's or a post's solid is fattened past what is drawn so she bumps it
   * square, and its drawn top is a few centimetres; given here, she stands
   * only on what is drawn, and a top narrower than her feet
   * ({@link FOOT_HALF_WIDTH}) is an edge, not a ledge — jumped over, never
   * landed on or stepped onto. See {@link CollisionWorld.toppedNarrow}.
   */
  topHalf: number;
}

/**
 * **A top narrower than this either side of its line holds nobody** — her
 * feet need 20 cm of it. A fence's rail, a post's cap, a panel's edge: she
 * can jump over them, not stand on them, which is the difference between a
 * wall and a ledge (17 Oct 2026: the census stood her on 9 cm rails and 6 cm
 * panel edges and used them as launch pads onto roofs).
 */
export const FOOT_HALF_WIDTH = 0.1;

/**
 * **The part of something round in section she could stand on** — a tube, a
 * torus, a rolled rim: its crown, the middle 60 % of its width, where the
 * surface is within a fifth of its radius of the crest. A round rail under
 * a sixth of a metre thick is therefore no ledge at all.
 */
export function roundTopHalf(radius: number): number {
  return radius * 0.6;
}

/** Wide enough for her feet: `FOOT_HALF_WIDTH` or more, a top computed as exactly that (0.15 − 0.05) included. */
function wideEnough(half: number): boolean {
  return half >= FOOT_HALF_WIDTH - 1e-9;
}

/** Can she stand on `solid`'s top at `distance` from its axis (a wall) or centre (a circle)? */
function standsWithin(solid: Readonly<SolidHeights>, distance: number): boolean {
  if (Number.isNaN(solid.topHalf)) return true;
  return wideEnough(solid.topHalf) && distance <= solid.topHalf + 1e-9;
}

/** Is any of `solid`'s top wide enough to stand on? */
function standableTop(solid: Readonly<SolidHeights>): boolean {
  return Number.isNaN(solid.topHalf) || wideEnough(solid.topHalf);
}

/**
 * **A top that runs from one end of a wall to the other** — `top1` over
 * `(x1, z1)`, `top2` over the far end, and a straight line between them along
 * the wall, each a radius in the park (`radial`) or a world `y` indoors.
 *
 * Why a wall needs it: a top held as one number is right at the one point it
 * was taken and drifts along the wall's length. A garden wall stepping down a
 * slope, a stair's handrail, a long plinth edge on the sphere — measured on
 * the library's back edge, 18 m long, a single top sat 0.18 m under the drawn
 * stone at the wall's ends, which is a body walking into stone it could see.
 * Two ends, interpolated, are exact at both and a few millimetres out between
 * them for any wall a few metres long.
 */
export interface TopSlope {
  readonly x1: number;
  readonly z1: number;
  readonly dx: number;
  readonly dz: number;
  readonly lengthSquared: number;
  readonly top1: number;
  readonly top2: number;
  readonly radial: boolean;
}

interface CircleCollider extends SolidHeights {
  /** Assigned by {@link CollisionWorld.addCircle}, so a caller can name this
   * exact registration again later — see {@link CollisionWorld.removeCircle}. */
  id: number;
  x: number;
  z: number;
  radius: number;
}

/**
 * A filled capsule: the segment `(x1, z1)`-`(x2, z2)` thickened by
 * `halfThickness` either side and round each end.
 *
 * **A zero-length wall — both ends on one point — is a filled disc of radius
 * `halfThickness`, to every query alike**: the mover ({@link
 * CollisionWorld.resolve}, {@link CollisionWorld.deepestSolidOverlap}, {@link
 * CollisionWorld.wouldAutoHopClear}), the planner (`isClearCircle`,
 * `solidDepthAt`) and the route lattice (`NavGrid`). It is how a solid that
 * must come and go is registered round (the library owl's capsule, #718,
 * taken out while she flies and put back as she lands): a wall can be handed
 * back with {@link CollisionWorld.restoreWall}, the same object, and a circle
 * cannot. Until 14 Oct 2026 the mover skipped a zero-length wall while the
 * planner counted it, so a child walked straight through a disc the flood fill
 * called solid — measured: a march at one stopped at -1.270 m with the fix and
 * walked on to +3.000 m without it.
 */
export interface WallCollider extends SolidHeights {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  halfThickness: number;
  /**
   * **How far past each end its top runs, square** — `NaN` when the top is
   * the whole capsule, round ends and all. A capsule is round-ended so she
   * slides round its end rather than snagging on a corner; a garden wall is
   * drawn square-ended, and the round end's top past the drawn coping was
   * somewhere she could stand on air. See {@link CollisionWorld.toppedSquare}.
   */
  topEnds: number;
}

/**
 * **Does a wall's top reach over `(x, z)` along its length?** — always, for a
 * round-ended top; for a square one ({@link WallCollider.topEnds}), only up to
 * `topEnds` past either end. The across-the-wall reach is the footprint's and
 * {@link standsWithin}'s question.
 */
function wallTopReaches(wall: Readonly<WallCollider>, x: number, z: number): boolean {
  if (Number.isNaN(wall.topEnds)) return true;
  const ax = wall.x2 - wall.x1;
  const az = wall.z2 - wall.z1;
  const length = Math.hypot(ax, az);
  if (length < 1e-6) return Math.hypot(x - wall.x1, z - wall.z1) <= wall.topEnds + 1e-9;
  const along = ((x - wall.x1) * ax + (z - wall.z1) * az) / length;
  return along >= -wall.topEnds - 1e-9 && along <= length + wall.topEnds + 1e-9;
}

/**
 * **A filled box**: the rectangle `±halfX` by `±halfZ` about `(cx, cz)`,
 * turned by the yaw whose cosine and sine are `cos`/`sin`, thickened by
 * `rounding` on every side and round every corner — the rectangle ⊕ a disc,
 * exactly as a {@link WallCollider} is a segment ⊕ a disc.
 *
 * **Filled, never four walls round a hollow.** `addRectangle` used to register
 * the four sides as walls, and a mover inside one was pushed by opposite walls
 * that cancelled: a body dropped on a banquet run's axis had not moved after
 * eleven seconds (#453), and the castle, the hotel and the reptile house each
 * had to argue in prose why their interiors could never be reached. A box has
 * no inside to be stuck in: a mover anywhere in its core is pushed out through
 * the nearest face, however deep, so the question cannot arise.
 *
 * The outline is the old four walls' outline to the millimetre — their outer
 * faces at `half + rounding`, their corners quarter-circles of `rounding` — so
 * nothing a child walks *round* moved; only the inside stopped being hollow.
 */
export interface BoxCollider extends SolidHeights {
  cx: number;
  cz: number;
  halfX: number;
  halfZ: number;
  /** The box's yaw, as the cosine and sine that take its local X onto the world. */
  cos: number;
  sin: number;
  rounding: number;
}

/**
 * **A world `y` at the solid's reference point, held as its distance from the
 * planet's centre** — or `NaN` where heights are plain `y` (indoors, or a
 * height that is not a place: relative, infinite). See {@link SolidHeights}.
 */
function radiusFor(x: number, z: number, y: number): number {
  if (!Number.isFinite(y) || spaceAt(x, z) !== SPACE_GARDEN) return Number.NaN;
  const cy = y + GROUND_SPHERE_RADIUS;
  if (cy <= 0) return Number.NaN;
  return Math.hypot(x, cy, z);
}

/** The world `y` of the sphere of `radius` over column `(x, z)`, the inverse of {@link radiusFor}. */
function yOnRadius(radius: number, x: number, z: number): number {
  const above = radius * radius - x * x - z * z;
  return above > 0 ? Math.sqrt(above) - GROUND_SPHERE_RADIUS : -Infinity;
}

/**
 * **A solid's absolute top over column `(x, z)`, world `y`** — the one place a
 * top is read, by the mover, the ground sampler and every measure. `NaN` for a
 * relative top (a height above whoever asks, so no place at all) and
 * `Infinity` for a solid that has no top.
 */
export function solidTopAt(solid: Readonly<SolidHeights>, x: number, z: number): number {
  if (!solid.topIsAbsolute) return Number.NaN;
  const slope = solid.topSlope;
  if (slope) {
    let t = slope.lengthSquared < 1e-8 ? 0 : ((x - slope.x1) * slope.dx + (z - slope.z1) * slope.dz) / slope.lengthSquared;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const top = slope.top1 + (slope.top2 - slope.top1) * t;
    return slope.radial ? yOnRadius(top, x, z) : top;
  }
  return Number.isNaN(solid.topRadius) ? solid.topHeight : yOnRadius(solid.topRadius, x, z);
}

/** A solid's base over column `(x, z)`, world `y` — `-Infinity` for one that stands on the ground. */
export function solidBaseAt(solid: Readonly<SolidHeights>, x: number, z: number): number {
  return Number.isNaN(solid.baseRadius) ? solid.baseHeight : yOnRadius(solid.baseRadius, x, z);
}

/**
 * Is this solid **banded** — does it begin above the ground, a rail on an
 * overhanging deck or a canopy over a bench? A planning query about the ground
 * (`isClearCircle`, `solidDepthAt`) does not count one, and the route lattice
 * does not stamp one unless told to (`navStamped`).
 */
function banded(solid: Readonly<SolidHeights>): boolean {
  return Number.isFinite(solid.baseHeight);
}

/**
 * Where a point stands against a box's **core** (its rectangle, before the
 * rounding): the local offset of the point from the nearest core point, or —
 * inside the core — the way out through the nearest face. Shared by every
 * query that asks about a box, so the mover, the planner, the route lattice and
 * the ground sampler measure one shape.
 *
 * `distance` is how far outside the core the point is (0 inside), and `outX`
 * /`outZ` the **world** direction a body there is pushed: away from the
 * nearest core point outside, through the nearest face inside. `inside` is the
 * depth inside the core (the distance to that face), 0 outside.
 */
interface BoxReading {
  distance: number;
  inside: number;
  outX: number;
  outZ: number;
}

const boxReading: BoxReading = { distance: 0, inside: 0, outX: 0, outZ: 0 };

function readBox(box: BoxCollider, x: number, z: number): BoxReading {
  const dx = x - box.cx;
  const dz = z - box.cz;
  const lx = dx * box.cos + dz * box.sin;
  const lz = -dx * box.sin + dz * box.cos;
  const qx = lx < -box.halfX ? -box.halfX : lx > box.halfX ? box.halfX : lx;
  const qz = lz < -box.halfZ ? -box.halfZ : lz > box.halfZ ? box.halfZ : lz;
  const ox = lx - qx;
  const oz = lz - qz;
  const outsideSquared = ox * ox + oz * oz;
  let localX: number;
  let localZ: number;
  if (outsideSquared > 1e-12) {
    const distance = Math.sqrt(outsideSquared);
    boxReading.distance = distance;
    boxReading.inside = 0;
    localX = ox / distance;
    localZ = oz / distance;
  } else {
    const faceX = box.halfX - Math.abs(lx);
    const faceZ = box.halfZ - Math.abs(lz);
    boxReading.distance = 0;
    if (faceX <= faceZ) {
      boxReading.inside = faceX;
      localX = lx < 0 ? -1 : 1;
      localZ = 0;
    } else {
      boxReading.inside = faceZ;
      localX = 0;
      localZ = lz < 0 ? -1 : 1;
    }
  }
  boxReading.outX = localX * box.cos - localZ * box.sin;
  boxReading.outZ = localX * box.sin + localZ * box.cos;
  return boxReading;
}

/**
 * **How far a mover's centre at `(x, z)` must move for a body of `radius` to
 * stop overlapping `box`**, or a value ≤ 0 when it does not overlap — the box's
 * depth, the number every other collider kind gets from `minimum − distance`.
 */
function boxDepth(box: BoxCollider, x: number, z: number, radius: number): number {
  const reading = readBox(box, x, z);
  return box.rounding + radius - reading.distance + reading.inside;
}

/**
 * A box's core corners, in the order the old `addRectangle` walls ran:
 * (−X, −Z) → (+X, −Z) → (+X, +Z) → (−X, +Z). Axis-aligned, they are
 * `cx ± halfX, cz ± halfZ` by exactly that arithmetic, so a lattice stamping
 * these edges stamps what it stamped for the four walls.
 */
function boxCorners(box: BoxCollider): readonly (readonly [number, number])[] {
  if (box.cos === 1 && box.sin === 0) {
    return [
      [box.cx - box.halfX, box.cz - box.halfZ],
      [box.cx + box.halfX, box.cz - box.halfZ],
      [box.cx + box.halfX, box.cz + box.halfZ],
      [box.cx - box.halfX, box.cz + box.halfZ],
    ];
  }
  const corner = (sx: number, sz: number): readonly [number, number] => {
    const lx = sx * box.halfX;
    const lz = sz * box.halfZ;
    return [box.cx + lx * box.cos - lz * box.sin, box.cz + lx * box.sin + lz * box.cos];
  };
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
}

/**
 * A solid as {@link CollisionWorld.forEachSolid} shows it to a measure.
 * `depthAt` is how far inside the footprint a point is (negative outside),
 * `reach` the furthest the footprint gets from its centre, `halfWidth` its
 * thinnest half-width (a capsule's half-thickness, a box's short half).
 */
export interface SolidView {
  readonly shape: 'circle' | 'capsule' | 'box';
  readonly kind: string;
  readonly owner: string;
  readonly centreX: number;
  readonly centreZ: number;
  readonly halfWidth: number;
  readonly reach: number;
  depthAt(x: number, z: number): number;
  /** Can she stand on its top at `(x, z)` — inside its footprint, on a top wide enough for her feet ({@link FOOT_HALF_WIDTH})? */
  standsAt(x: number, z: number): boolean;
  topAt(x: number, z: number): number;
  baseAt(x: number, z: number): number;
  readonly topIsAbsolute: boolean;
  readonly topHeight: number;
  readonly hopHeight: number;
  readonly autoHoppable: boolean;
  readonly banded: boolean;
}

/**
 * How far below a collider's top the mover's feet may still be and count as
 * "cleared it". Without this a jump that just grazes the top of a wall would
 * still be caught by the collider, which reads as snagging rather than
 * hopping over — a little forgiveness here is what makes the jump feel good.
 *
 * **Exported so that nothing has to copy it.** The library's lintel over the
 * secret den's doorway (#719) is a banded collider whose base must sit under
 * the bookcase top by *more* than this grace, or a flier could slip between
 * case and lintel: its base is computed from this constant, never from a
 * retyped 0.15.
 */
export const JUMP_CLEARANCE_GRACE = 0.15;

/**
 * "Are a mover's feet, right now at `clearance`, above something this tall?"
 *
 * A pure question about *this instant*, asked every frame by `resolve` for a
 * jump already in flight. It says nothing whatever about whether the jump will
 * get across — see {@link autoHopClears} for that, and read on, because
 * conflating the two is what caused design feedback #30h.
 */
export function clearsTop(topHeight: number, clearance: number): boolean {
  return clearance + JUMP_CLEARANCE_GRACE >= topHeight;
}

/**
 * The wall top the jump's flight is *measured* to carry a mover across, in
 * metres — the number {@link autoHopClears} enforces.
 *
 * ### Why this is measured and not derived
 *
 * `JUMP_APEX_HEIGHT` is 1.2812 m, so it is tempting (and it was, until design
 * feedback #30h) to say "the hop clears anything up to the apex, plus a little
 * grace" — 1.4312 m. Every step of that is wrong:
 *
 * 1. **The apex is never reached.** Integration is a fixed number of discrete
 *    steps, so the sampled peak is below the algebraic one, and by a
 *    frame-rate-dependent amount: 1.2538 m at 120 fps, 1.2267 at 60, 1.1733 at
 *    30, and only 1.0195 at `MAX_FRAME_DELTA`.
 * 2. **Being briefly above the top is not crossing.** `AUTO_HOP_LOOKAHEAD` is
 *    0.5 m, so the hop fires half a metre before the blocking face and she
 *    reaches that face only 0.41 m up. She is then *pinned against the near
 *    face and rises in place* — the resolver holds her there and its own
 *    velocity read-back zeroes her speed every frame — and is released only
 *    once she is above the top. She must then cross the collider's whole
 *    footprint, `2·(halfThickness + moverRadius)`, **from a standing start**,
 *    before falling back below it.
 * 3. **So the honest limit depends on the footprint**, and is far below the
 *    apex. Measured (`scripts/measure-hop-clearance.mts`, worst case over
 *    20–120 fps, walk and sprint, approach angles 0–40°, every phase of the
 *    frame clock): 1.057 m across the 0.22 m-thick wooden walls, 1.028 m
 *    across the 0.34 m stone ones, 0.833 m across a 0.60 m one (re-measured
 *    17 Oct 2026, after a jump's flight began carrying her height over the
 *    planet's curve and taking off from the ground under her — the corners
 *    at 20–30 fps came down by up to 5 cm). Square-on at 60 fps the stone
 *    figure is 1.176 m — the low numbers are the corners, and the corners are
 *    what a route has to be planned for.
 *
 * A wall above this but below the old 1.4312 m did not merely feel bad. Either
 * the wall went solid again underneath her mid-footprint and *ejected* her out
 * the far side (up to 0.59 m in a single frame — the very shove
 * `Player.update`'s escort latch exists to refuse to bank as velocity), or,
 * from 1.34 m up, she was **never released at all**: pinned at the face,
 * landing, auto-hopping, landing, forever. The park's 1.4 m wall at
 * `[3,19]→[-4,20]` was exactly that, and `NavGrid` had started routing over it.
 *
 * 1.00 m sits below the measured limit for every wall thickness the park
 * actually uses (the worst, 1.028 m, across the stone walls). It keeps every low garden wall hoppable — 0.7, 0.85 and 0.95 m,
 * both materials, eight walls — and drops the four the flight never honestly
 * managed: 1.15, 1.2, 1.2 and 1.25 m. {@link
 * CollisionWorld.checkHoppableColliders} enforces at boot that no registered
 * collider escapes the margin — including one too *fat* for it, which a bare
 * height ceiling cannot see.
 */
export const MAX_AUTO_HOP_HEIGHT = 1.0;

/**
 * The apex {@link MAX_AUTO_HOP_HEIGHT} and {@link measuredHopCeiling} were
 * measured against. If `JUMP_SPEED` or `GRAVITY` ever move, the measurement is
 * stale and the numbers above are fiction — which
 * {@link CollisionWorld.checkHoppableColliders} says out loud at boot rather
 * than leaving as a comment nobody re-reads.
 */
export const MEASURED_HOP_APEX = 1.2812;

/**
 * How far the live jump apex may drift from {@link MEASURED_HOP_APEX} before
 * the measurement behind {@link MAX_AUTO_HOP_HEIGHT} and
 * {@link measuredHopCeiling} is treated as stale.
 *
 * Exported because two places must agree on it and neither should own a copy:
 * {@link CollisionWorld.checkHoppableColliders} enforces it at boot, and
 * `scripts/measure-hop-clearance.mts` enforces the same thing in CI. It was
 * inline here and hand-copied there until #539 — a comment asserting the two
 * numbers matched, which is exactly the thing this codebase keeps being bitten
 * by.
 */
export const HOP_APEX_TOLERANCE = 0.001;

/**
 * The measured ceiling as a function of how far a mover must travel to cross a
 * collider — `2·(halfThickness + moverRadius)`, its full footprint plus her own
 * width on both sides.
 *
 * A straight line fitted *underneath* every measured point (see the table in
 * {@link MAX_AUTO_HOP_HEIGHT}), so it is a lower bound on the truth everywhere,
 * not a best fit through it: at 1.54 m of crossing it reads 1.058 against a
 * measured 1.062, at 1.92 m it reads 0.962 against a measured 1.028, at 2.44 m
 * it reads 0.831 against a measured 0.833 (re-measured 17 Oct 2026, see
 * {@link MAX_AUTO_HOP_HEIGHT}; the old line, 1.574 − 0.3·crossing, stood up to
 * 5 cm over the new corners at 20 fps).
 *
 * Used only by the boot check. The predicate itself stays a flat ceiling,
 * because a route's idea of what is hoppable should not quietly change with the
 * thickness of the wall it is looking at — but that flat ceiling is blind to a
 * collider fat enough to fall below it, which is precisely what this catches.
 */
export function measuredHopCeiling(crossing: number): number {
  return 1.446 - 0.252 * crossing;
}

/**
 * "Can a hop actually *carry* a mover over something this tall?"
 *
 * The one expression, used by the two places that plan around the answer:
 * {@link CollisionWorld.wouldAutoHopClear} (for a hop about to be fired) and
 * `world/NavGrid.ts` (which leaves a wall the walker hops out of the map
 * entirely, because a route that detoured round one would be worse than the
 * straight line). They used to be able to drift apart; now they are the same
 * call, so "a wall the auto-hop fires at is exactly a wall the route hops" is
 * true by construction rather than by comment.
 *
 * Deliberately *not* the question `resolve` asks — that one is {@link
 * clearsTop}, and a jump in flight is still governed by nothing but how high
 * her feet actually are. So the manual jump button is completely untouched by
 * this ceiling: press it at a 1.25 m wall and you get exactly the behaviour you
 * got before. What changes is only that nothing *plans* on getting over one.
 *
 * Both terms matter. The apex term means weakening the jump automatically
 * makes things stop being hoppable; the measured term means strengthening it
 * does not automatically make more things hoppable, because the measurement
 * would no longer apply — and {@link CollisionWorld.checkHoppableColliders}
 * will say so.
 */
export function autoHopClears(topHeight: number, apexClearance: number): boolean {
  return clearsTop(topHeight, apexClearance) && topHeight <= MAX_AUTO_HOP_HEIGHT;
}

/**
 * Overlaps up to this deep are ordinary contact — the everyday case of
 * walking (even sprinting) straight into a wall, tree or fountain rim — and
 * get corrected fully and instantly, exactly as before. That is what keeps
 * blocking crisp.
 *
 * Set comfortably above the deepest a full-sprint step can bury a mover in a
 * single frame (well under half a metre even at 60 fps), so ordinary
 * collision never takes the gentle path below. Anything deeper than this can
 * only really happen from spawning, teleporting or stepping *inside*
 * geometry — being already-embedded, not freshly walking into something.
 */
const SHALLOW_OVERLAP = 0.5;

/**
 * **Whether one collider pushes back on a mover at `position`, right now** —
 * the one owner of that rule, asked by {@link CollisionWorld.resolve} and by
 * {@link CollisionWorld.deepestSolidOverlap}, so the step guard in
 * `resolveMovement` measures exactly the solidity `resolve` enforces.
 *
 * - `'absent'`: a banded collider does not exist for a mover below its base —
 *   the landing rail over the open archway. See the header.
 * - `'cleared'`: over its footprint but jumped clear above it. Absolute tops
 *   compare against the mover's real feet height, so a prop she is stood on
 *   holds still under her — see the header. `feetY` is that height: her own
 *   `y`, unless the mover says otherwise (the crowd — see `resolve`).
 * - `'stepped'`: a top she is stepping up onto — no higher than
 *   `stepCeiling`, the one-step reach her ground sampler spends at this point
 *   (see {@link StepCeiling}). Not jumped over and not pushed: she is
 *   climbing onto it, exactly as onto a deck of the same height.
 * - `'solid'`: it pushes.
 */
function contactWith(
  collider: Readonly<SolidHeights>,
  position: Vector3,
  clearance: number,
  stepCeiling = -Infinity,
  moverHeight = 0,
  feetY = position.y,
): 'absent' | 'cleared' | 'stepped' | 'solid' {
  // Below its base — her head under a canopy's underside, under the landing's
  // rail — it is not there at all. A mover with no height (a planning probe)
  // is a point at its feet, as every collider used to see every mover.
  if (banded(collider) && position.y + moverHeight <= solidBaseAt(collider, position.x, position.z)) return 'absent';
  if (!collider.topIsAbsolute) return clearsTop(collider.topHeight, clearance) ? 'cleared' : 'solid';
  const top = solidTopAt(collider, position.x, position.z);
  if (feetY + JUMP_CLEARANCE_GRACE >= top) return 'cleared';
  // A top too narrow for her feet is never stepped onto: she would pass into
  // its fattened footprint with nothing to stand on.
  if (top <= stepCeiling && standableTop(collider)) return 'stepped';
  return 'solid';
}

/**
 * **The highest top a grounded mover may step up onto at `(x, z)`**, world Y —
 * or nothing, for a mover that is not stepping (in the air, standing still,
 * brushing past rather than walking into something, or a member of the crowd,
 * which never climbs).
 *
 * A step onto a solid's top is the same step as onto a deck of the same
 * height: `Player` hands in `stepCeilingAt` from the very reference its ground
 * sampler is asked from, carried to the point asked, so a top the lateral rule
 * lets her climb onto is a top the sampler then stands her on — the two can
 * never disagree about which heights are within a step (see `Player.update`).
 */
export type StepCeiling = (x: number, z: number) => number;

/**
 * How much deeper into something solid a single movement sub-step may leave a
 * mover than she was before it, in metres, before the step is refused — see
 * `resolveMovement`'s pinch guard. Float noise only: an ordinary resolve ends
 * in exact contact.
 */
const PINCH_TOLERANCE = 1e-4;

/**
 * The speed, in metres per second, at which a *deep* overlap (see
 * {@link SHALLOW_OVERLAP}) is allowed to resolve.
 *
 * This is the fix for design feedback #17 — "the fling": previously a deep
 * overlap (e.g. spawning inside the fountain's collider) was corrected in a
 * single frame, however large the overlap. `Player`/`NpcCharacter` derive
 * their velocity from how far `resolve` just moved them, so a multi-metre
 * one-frame correction read back as a multi-metre-per-second velocity spike
 * that barely decelerated — a launch, not a nudge. Capping the correction
 * speed here caps that derived velocity at the source, and spreads a deep
 * escort out over the handful of frames it actually takes, however deep the
 * overlap. Chosen well below the player's own walking pace so being
 * depenetrated never feels like it could be mistaken for a shove *by* the
 * game — it reads as being calmly walked back out.
 *
 * Exported so that a second, smaller piece of depenetration (see
 * {@link circleSeparation}, below — the player↔NPC push-apart) can cap
 * itself at the exact same gentle speed rather than inventing its own number.
 */
export const MAX_DEPENETRATION_SPEED = 3;

/**
 * How far outside the soft play boundary that boundary still has an opinion,
 * in metres.
 *
 * The play bounds are the leash for **the space you are in** — `setPlayBounds`
 * is called on every change of space, and the garden, the castle interior and
 * each hotel room take it in turn. Nothing in the world says so, though, and
 * `resolve` below happily applied whichever leash was currently fitted to
 * *anybody* who asked, however far away they were: signed distance is negative
 * outside, so a character standing in a hotel room six hundred metres from the
 * park read as "outside the park by 754 m" and was pushed the whole way in.
 * Not gradually, either — `NpcCharacter` calls `resolve` with the default
 * `dt = Infinity`, so the escort budget is infinite and the correction lands
 * in a single frame. Measured on 7 August 2026: a body at the hotel lobby's
 * origin, with the garden bounds set, arrives at (−75, 57) after **one** call.
 *
 * That was a live bug before any of this: every park child was teleported into
 * the castle interior's own bounds circle the instant the player stepped
 * indoors, and teleported back out to the park's rim when she left. It became
 * unignorable when the hotel's guests became real NPC bodies (Jim's "they
 * should be the same code"), because they would have been dragged out of the
 * hotel and into the park the moment the player left.
 *
 * So: **something this far outside the current boundary is not outside the
 * park, it is somewhere else, and the park's edge has nothing to say about
 * it.** 100 m is chosen to be far larger than any overshoot a walker can
 * legitimately produce against a boundary they are actually stood next to (the
 * whole garden is ~110 m across, and a leashed walker is only ever their own
 * radius past the line), and far smaller than the gap between two spaces — the
 * hotel's rooms are 260 m apart and the castle interior is 848 m from the park.
 * Inside the garden, nothing about the leash changes.
 */
const BOUNDARY_LEASH_REACH = 100;

/**
 * How much of a collider's own half-footprint a single movement sub-step is
 * allowed to cover — see {@link CollisionWorld.resolveMovement}.
 *
 * `resolve` is a *point test*: it looks at where a mover has ended up, never
 * at the line she took to get there. A step longer than the thing she is
 * walking into simply lands on the far side of it, and then the resolver —
 * which pushes out of the *nearest* face, because that is the right answer
 * every other time — helpfully finishes the job and shoves her out the back.
 * That is the tunnel, and it is at any height, because a collider she is not
 * overlapping at either end of the step is a collider that never gets asked
 * about her height at all.
 *
 * Half is the margin over the number that would only just do. The step cannot
 * cross the mid-plane of the thinnest registered collider (its half-thickness
 * plus the mover's own radius) without a sample landing inside, so half of
 * that leaves a whole step's worth of slack for the case where a correction
 * has left her *already* part-way in — the tail of an escort, most of all.
 *
 * This is perpendicular-distance reasoning, so it holds at every approach
 * angle, glancing included: crossing a band of width `w` means covering `w` of
 * perpendicular distance, which needs a step of at least `w` however it is
 * pointed. It is exactly the property a swept test against a wall's centre
 * line does *not* have.
 */
const SUBSTEP_FOOTPRINT_FRACTION = 0.5;

/**
 * A ceiling on sub-steps per movement, purely as a guard against a degenerate
 * collider (a zero-radius circle registered by accident, say) turning the
 * substep count into an unbounded loop and hanging the game.
 *
 * It is not reached in play and is not meant to be: `MAX_FRAME_DELTA` (1/12 s)
 * times a full sprint (11.1 m/s) is 0.93 m, and against the park's thinnest
 * collider that is three sub-steps.
 */
export const MAX_SUBSTEPS = 16;

/** Bucket size of {@link CollisionWorld.solidDepthAt}'s grid, metres. */
const SOLID_GRID = 4;

/** One cell of that grid: every collider whose bound reaches into it. */
interface SolidBucket {
  readonly circles: CircleCollider[];
  readonly walls: WallCollider[];
  readonly boxes: BoxCollider[];
}

export class CollisionWorld {
  private readonly circles: CircleCollider[] = [];
  private readonly walls: WallCollider[] = [];
  private readonly boxes: BoxCollider[] = [];
  /** Source of {@link CircleCollider.id} — see {@link addCircle}. */
  private nextCircleId = 0;

  /**
   * True if a disc at (x, z) touches nothing registered so far. A *planning*
   * query — the layout generator and the station placer ask it before
   * building somewhere — so it reads whatever has been registered at the
   * time it is called, exactly like the boot asserts do.
   */
  /**
   * **Name what is near a point** — every collider within `reach` of a probe
   * of `radius` at `(x, z)`, as text. A diagnostic, for a placer that was
   * refused and wants to say by what (the bridge search's `LGP_DEBUG_BRIDGE`
   * line said "collider" and nothing else). Colliders carry no names, so
   * this describes their shape: a circle's radius says tree trunk (0.3–0.5)
   * from lamp post (0.2) from stall (metres); a wall its length and height.
   */
  describeNear(x: number, z: number, radius: number, reach = 1): string[] {
    const out: string[] = [];
    for (const circle of this.circles) {
      const gap = Math.hypot(circle.x - x, circle.z - z) - circle.radius - radius;
      if (gap <= reach) {
        out.push(
          `circle#${circle.id} at (${circle.x.toFixed(1)}, ${circle.z.toFixed(1)}) r=${circle.radius.toFixed(2)} gap=${gap.toFixed(2)}`,
        );
      }
    }
    for (const wall of this.walls) {
      const dx = wall.x2 - wall.x1;
      const dz = wall.z2 - wall.z1;
      const lengthSq = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - wall.x1) * dx + (z - wall.z1) * dz) / lengthSq));
      const gap = Math.hypot(wall.x1 + t * dx - x, wall.z1 + t * dz - z) - wall.halfThickness - radius;
      if (gap <= reach) {
        out.push(
          `wall (${wall.x1.toFixed(1)}, ${wall.z1.toFixed(1)})-(${wall.x2.toFixed(1)}, ${wall.z2.toFixed(1)}) ` +
            `half=${wall.halfThickness.toFixed(2)} top=${wall.topHeight.toFixed(1)} gap=${gap.toFixed(2)}`,
        );
      }
    }
    for (const box of this.boxes) {
      const gap = -boxDepth(box, x, z, radius);
      if (gap <= reach) {
        out.push(
          `box at (${box.cx.toFixed(1)}, ${box.cz.toFixed(1)}) ${(2 * box.halfX).toFixed(2)}x${(2 * box.halfZ).toFixed(2)} ` +
            `round=${box.rounding.toFixed(2)} top=${box.topHeight.toFixed(1)} gap=${gap.toFixed(2)}`,
        );
      }
    }
    return out;
  }

  /** The owner every collider registered now is filed under — see {@link ownedBy}. */
  private currentOwner = '';

  /**
   * **Files every collider `build` registers under `owner`** — `'castle'`,
   * `'hotel'`, `'booth'`, `'boundary wall'` — so a measure can ask what a solid
   * *is* (`test/procgen`'s `noDrawnPavingUnderASolid` holds paving off
   * buildings and booths). Nests: the innermost owner wins. Changes nothing
   * about how anything collides.
   */
  ownedBy<T>(owner: string, build: () => T): T {
    const outer = this.currentOwner;
    this.currentOwner = owner;
    try {
      return build();
    } finally {
      this.currentOwner = outer;
    }
  }

  /** The kind every collider registered now is filed under — see {@link kinded}. */
  private currentKind = '';
  private currentTopHalf = Number.NaN;
  private currentTopEnds = Number.NaN;

  /**
   * **Every solid `build` registers has a top `half` either side of its line**
   * (a wall) or round its centre (a circle) — narrower than its footprint,
   * which stays what she bumps. For a rail, a post, a panel: drawn a few
   * centimetres wide and fattened to be met square, and stood on only where
   * drawn — not at all when under {@link FOOT_HALF_WIDTH}. Nests like
   * {@link kinded}.
   */
  toppedNarrow<T>(half: number, build: () => T): T {
    const outer = this.currentTopHalf;
    this.currentTopHalf = half;
    try {
      return build();
    } finally {
      this.currentTopHalf = outer;
    }
  }

  /**
   * **Every wall `build` registers has a square-ended top, running `beyond`
   * metres past each end** — what a square-ended thing is drawn with, where
   * the capsule's round ends, kept for her to bump and slide round, would be a
   * top over nothing drawn. Changes nothing she bumps, nothing a planner or a
   * lattice reads: only where she can stand. Nests like {@link kinded}.
   */
  toppedSquare<T>(beyond: number, build: () => T): T {
    const outer = this.currentTopEnds;
    this.currentTopEnds = beyond;
    try {
      return build();
    } finally {
      this.currentTopEnds = outer;
    }
  }


  /**
   * **Files every collider `build` registers as one kind of thing** — "garden
   * wall", "lamp post", "castle bench" — so a measure can say what a solid is
   * when it reports one (`check:solids`' census groups by it). Nests: the
   * innermost kind wins. Changes nothing about how anything collides.
   */
  kinded<T>(kind: string, build: () => T): T {
    const outer = this.currentKind;
    this.currentKind = kind;
    try {
      return build();
    } finally {
      this.currentKind = outer;
    }
  }

  /**
   * The heights record every registration shares — {@link SolidHeights}.
   * `(x, z)` is the solid's reference point, where its top and base were
   * measured; out in the park both are held as radii from there.
   */
  private heights(
    x: number,
    z: number,
    topHeight: number,
    autoHoppable: boolean,
    topIsAbsolute: boolean,
    baseHeight: number,
    navStamped: boolean,
    hopHeight: number,
  ): SolidHeights {
    return {
      topHeight,
      autoHoppable,
      topIsAbsolute,
      baseHeight,
      navStamped,
      owner: this.currentOwner,
      kind: this.currentKind,
      topRadius: topIsAbsolute ? radiusFor(x, z, topHeight) : Number.NaN,
      baseRadius: radiusFor(x, z, baseHeight),
      // A relative top is its own hop height; an absolute one plans no hop
      // unless it says how tall it stands.
      hopHeight: !topIsAbsolute ? topHeight : hopHeight,
      topHalf: this.currentTopHalf,
    };
  }

  /**
   * **How deep (x, z) stands inside the deepest ground-standing solid** —
   * metres inside a circle's rim or a wall's band, the larger of the two;
   * negative where the point is clear of everything, by how much. Banded
   * colliders (a `baseHeight` above the ground) are not solid here, the same
   * reading {@link isClearCircle} gives. A planning and measuring query: what
   * the drawn paving is laid over is asked of the colliders, the one owner of
   * every footprint (`test/procgen`'s `noDrawnPavingUnderASolid`).
   */
  solidDepthAt(x: number, z: number, owners?: ReadonlySet<string>): { depth: number; what: string; owner: string } {
    let depth = -Infinity;
    let what = '';
    let owner = '';
    const grid = this.solidGrid();
    const bucket = grid.cells.get(`${Math.floor(x / SOLID_GRID)},${Math.floor(z / SOLID_GRID)}`);
    if (!bucket) return { depth, what, owner };
    for (const circle of bucket.circles) {
      if (banded(circle)) continue;
      if (owners && !owners.has(circle.owner)) continue;
      const here = circle.radius - Math.hypot(x - circle.x, z - circle.z);
      if (here > depth) {
        depth = here;
        owner = circle.owner;
        what = `circle#${circle.id} at (${circle.x.toFixed(1)}, ${circle.z.toFixed(1)}) r=${circle.radius.toFixed(2)} top=${circle.topHeight.toFixed(2)}`;
      }
    }
    for (const wall of bucket.walls) {
      if (banded(wall)) continue;
      if (owners && !owners.has(wall.owner)) continue;
      const abx = wall.x2 - wall.x1;
      const abz = wall.z2 - wall.z1;
      const lengthSq = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((x - wall.x1) * abx + (z - wall.z1) * abz) / lengthSq));
      const here = wall.halfThickness - Math.hypot(x - (wall.x1 + abx * t), z - (wall.z1 + abz * t));
      if (here > depth) {
        depth = here;
        owner = wall.owner;
        what =
          `wall (${wall.x1.toFixed(1)}, ${wall.z1.toFixed(1)})-(${wall.x2.toFixed(1)}, ${wall.z2.toFixed(1)}) ` +
          `half=${wall.halfThickness.toFixed(2)} top=${wall.topHeight.toFixed(2)}${wall.topIsAbsolute ? ' abs' : ''}${wall.autoHoppable ? ' hoppable' : ''}`;
      }
    }
    for (const box of bucket.boxes) {
      if (banded(box)) continue;
      if (owners && !owners.has(box.owner)) continue;
      const here = boxDepth(box, x, z, 0);
      if (here > depth) {
        depth = here;
        owner = box.owner;
        what =
          `box at (${box.cx.toFixed(1)}, ${box.cz.toFixed(1)}) ${(2 * box.halfX).toFixed(2)}x${(2 * box.halfZ).toFixed(2)} ` +
          `round=${box.rounding.toFixed(2)} top=${box.topHeight.toFixed(2)}${box.topIsAbsolute ? ' abs' : ''}`;
      }
    }
    return { depth, what: owner ? `${owner} ${what}` : what, owner };
  }

  /**
   * **The top of the highest solid under `(x, z)` that is no higher than
   * `ceiling`** — world Y, or `-Infinity` where no solid's footprint covers the
   * point or every one that does is out of reach.
   *
   * This is the half of "gravity drops her onto whatever is highest beneath
   * her" that the solids own: a jump that carries her over a bench lands her
   * on the bench because the bench is solid, not because something else was
   * told there is floor up there. The ground sampler (`standing.ts`) asks this
   * beside the terrain, the decks and the ramps, with the same step reach it
   * spends on them, and takes the higher answer.
   *
   * Only a top that is a height in the world can be stood on. A collider with
   * no top at all (`topHeight` Infinity — nothing should be, once every solid
   * says how tall it is) is never offered, and nor is a relative top, which is
   * a height above *whoever is asking* and so is no place at all.
   *
   * A point test at her centre, on the solid's own footprint — the shape her
   * body is pushed out of — so the edge she slides off and the edge she is
   * stopped by are one edge. Bucketed: a few colliders per call, not thousands.
   */
  highestTopAt(x: number, z: number, ceiling: number): number {
    let best = -Infinity;
    const grid = this.solidGrid();
    const bucket = grid.cells.get(`${Math.floor(x / SOLID_GRID)},${Math.floor(z / SOLID_GRID)}`);
    if (!bucket) return best;
    for (const circle of bucket.circles) {
      if (!circle.topIsAbsolute) continue;
      const dx = x - circle.x;
      const dz = z - circle.z;
      if (dx * dx + dz * dz > circle.radius * circle.radius) continue;
      if (!standsWithin(circle, Math.hypot(dx, dz))) continue;
      const top = solidTopAt(circle, x, z);
      if (!Number.isFinite(top) || top > ceiling || top <= best) continue;
      best = top;
    }
    for (const wall of bucket.walls) {
      if (!wall.topIsAbsolute) continue;
      const ax = wall.x2 - wall.x1;
      const az = wall.z2 - wall.z1;
      const lengthSquared = ax * ax + az * az;
      let t = lengthSquared < 1e-8 ? 0 : ((x - wall.x1) * ax + (z - wall.z1) * az) / lengthSquared;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (wall.x1 + ax * t);
      const dz = z - (wall.z1 + az * t);
      if (dx * dx + dz * dz > wall.halfThickness * wall.halfThickness) continue;
      if (!standsWithin(wall, Math.hypot(dx, dz))) continue;
      if (!wallTopReaches(wall, x, z)) continue;
      const top = solidTopAt(wall, x, z);
      if (!Number.isFinite(top) || top > ceiling || top <= best) continue;
      best = top;
    }
    for (const box of bucket.boxes) {
      if (!box.topIsAbsolute) continue;
      if (boxDepth(box, x, z, 0) < 0) continue;
      if (!standableTop(box)) continue;
      const top = solidTopAt(box, x, z);
      if (!Number.isFinite(top) || top > ceiling || top <= best) continue;
      best = top;
    }
    return best;
  }

  /**
   * **The lowest underside over `(x, z)` at or above `fromY`** — world `y`, or
   * `Infinity` where nothing hangs over the point. Where a rising head stops:
   * `Player` asks it from the top of her head as she jumps, so a canopy over a
   * bench is a ceiling she bumps rather than a slab her head passes through.
   * Only banded solids have an underside; everything else stands on the
   * ground and is met side-on.
   */
  ceilingAt(x: number, z: number, fromY: number): number {
    let best = Infinity;
    const grid = this.solidGrid();
    const bucket = grid.cells.get(`${Math.floor(x / SOLID_GRID)},${Math.floor(z / SOLID_GRID)}`);
    if (!bucket) return best;
    const consider = (solid: SolidHeights): void => {
      if (!banded(solid)) return;
      const base = solidBaseAt(solid, x, z);
      if (base >= fromY && base < best) best = base;
    };
    for (const circle of bucket.circles) {
      const dx = x - circle.x;
      const dz = z - circle.z;
      if (dx * dx + dz * dz <= circle.radius * circle.radius) consider(circle);
    }
    for (const wall of bucket.walls) {
      const ax = wall.x2 - wall.x1;
      const az = wall.z2 - wall.z1;
      const lengthSquared = ax * ax + az * az;
      let t = lengthSquared < 1e-8 ? 0 : ((x - wall.x1) * ax + (z - wall.z1) * az) / lengthSquared;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (wall.x1 + ax * t);
      const dz = z - (wall.z1 + az * t);
      if (dx * dx + dz * dz <= wall.halfThickness * wall.halfThickness) consider(wall);
    }
    for (const box of bucket.boxes) {
      if (boxDepth(box, x, z, 0) >= 0) consider(box);
    }
    return best;
  }

  /** {@link solidDepthAt}'s bucket grid, rebuilt whenever the world's revision moves. */
  private solidGridMemo: { revision: number; cells: Map<string, SolidBucket> } | null = null;
  private solidGrid(): { revision: number; cells: Map<string, SolidBucket> } {
    if (this.solidGridMemo && this.solidGridMemo.revision === this.revisionCounter) return this.solidGridMemo;
    const cells = new Map<string, SolidBucket>();
    const stamp = (minX: number, minZ: number, maxX: number, maxZ: number, add: (cell: SolidBucket) => void): void => {
      for (let i = Math.floor(minX / SOLID_GRID); i <= Math.floor(maxX / SOLID_GRID); i += 1) {
        for (let j = Math.floor(minZ / SOLID_GRID); j <= Math.floor(maxZ / SOLID_GRID); j += 1) {
          const key = `${i},${j}`;
          let cell = cells.get(key);
          if (!cell) cells.set(key, (cell = { circles: [], walls: [], boxes: [] }));
          add(cell);
        }
      }
    };
    for (const c of this.circles) stamp(c.x - c.radius, c.z - c.radius, c.x + c.radius, c.z + c.radius, (cell) => cell.circles.push(c));
    for (const w of this.walls) {
      const h = w.halfThickness;
      stamp(Math.min(w.x1, w.x2) - h, Math.min(w.z1, w.z2) - h, Math.max(w.x1, w.x2) + h, Math.max(w.z1, w.z2) + h, (cell) => cell.walls.push(w));
    }
    for (const b of this.boxes) {
      // The turned box's own axis-aligned bound: each half-extent projected onto each axis.
      const reachX = Math.abs(b.cos) * b.halfX + Math.abs(b.sin) * b.halfZ + b.rounding;
      const reachZ = Math.abs(b.sin) * b.halfX + Math.abs(b.cos) * b.halfZ + b.rounding;
      stamp(b.cx - reachX, b.cz - reachZ, b.cx + reachX, b.cz + reachZ, (cell) => cell.boxes.push(b));
    }
    this.solidGridMemo = { revision: this.revisionCounter, cells };
    return this.solidGridMemo;
  }

  isClearCircle(x: number, z: number, radius: number): boolean {
    for (const circle of this.circles) {
      // A ground-plane planning query: a banded collider (baseHeight above the
      // ground) is not solid to anything standing here.
      if (banded(circle)) continue;
      if (Math.hypot(x - circle.x, z - circle.z) < radius + circle.radius) return false;
    }
    for (const wall of this.walls) {
      if (banded(wall)) continue;
      const abx = wall.x2 - wall.x1;
      const abz = wall.z2 - wall.z1;
      const lengthSq = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((x - wall.x1) * abx + (z - wall.z1) * abz) / lengthSq));
      const cx = wall.x1 + abx * t;
      const cz = wall.z1 + abz * t;
      if (Math.hypot(x - cx, z - cz) < radius + wall.halfThickness) return false;
    }
    for (const box of this.boxes) {
      if (banded(box)) continue;
      if (boxDepth(box, x, z, radius) > 0) return false;
    }
    return true;
  }

  /**
   * The half-footprint of the *thinnest* thing registered — the narrowest band
   * a mover could hope to skip over in one frame, and therefore what sets the
   * sub-step length in {@link resolveMovement}.
   *
   * Tracked as things are added rather than scanned for per frame: it is one
   * `Math.min` per collider at build time against a scan of hundreds of
   * colliders per movement, and, more to the point, it cannot go stale. Add a
   * thinner wall to the park a year from now and the sub-step gets shorter by
   * itself, with nobody needing to remember that this number existed.
   */
  private thinnestHalfWidth = Infinity;

  /**
   * The soft boundary you can never walk out of.
   *
   * It used to be a constant round the origin, which was fine while the park was
   * the only place there was. The building is bigger on the inside now and lives
   * six hundred metres away in its own space, so whoever moves the player
   * between the two moves the boundary with them — otherwise stepping through
   * the front door drops a child outside their own park boundary and the
   * resolver drags them back across half a kilometre of nothing.
   */
  private bounds: ParkBoundary = GARDEN_PLAY_BOUNDARY;

  /**
   * Bumped whenever the set of solid things changes.
   *
   * `world/NavGrid.ts` bakes this world into a lattice and caches it. Today
   * every collider is registered while the park is being built and none is ever
   * added afterwards, so the cache would in practice never be wrong — but "in
   * practice never" is exactly the kind of invariant that quietly stops being
   * true (the railway of Decision 4 registers a great deal of exclusion wall).
   * A counter the mutators cannot avoid bumping makes the cache correct by
   * construction instead of by convention.
   */
  private revisionCounter = 0;

  get revision(): number {
    return this.revisionCounter;
  }

  /**
   * Swaps the soft boundary. Used on every change of space.
   *
   * A whole {@link ParkBoundary} rather than a centre and a radius, because the
   * garden's edge stopped being a circle (issue #115) while the castle
   * interior's genuinely still is one — `circleBoundary` says so exactly, and
   * both then answer the same question the same way.
   */
  setPlayBounds(boundary: ParkBoundary): void {
    this.bounds = boundary;
  }

  /** The soft boundary, for anything that has to map the space inside it. */
  get playBounds(): ParkBoundary {
    return this.bounds;
  }

  /**
   * Registers a circular collider and hands back its id, so a caller that
   * might later need to take this exact registration back out again — see
   * {@link removeCircle} — has something to name it by. Every existing call
   * site simply drops the return value, which costs nothing.
   */
  addCircle(
    x: number,
    z: number,
    radius: number,
    topHeight = Infinity,
    autoHoppable = false,
    topIsAbsolute = false,
    baseHeight = -Infinity,
    navStamped = false,
    hopHeight = Number.NaN,
  ): number {
    const id = this.nextCircleId;
    this.nextCircleId += 1;
    this.circles.push({
      id,
      x,
      z,
      radius,
      ...this.heights(x, z, topHeight, autoHoppable, topIsAbsolute, baseHeight, navStamped, hopHeight),
    });
    this.thinnestHalfWidth = Math.min(this.thinnestHalfWidth, radius);
    this.revisionCounter += 1;
    return id;
  }

  /**
   * Takes a circular collider back out, by the id {@link addCircle} handed
   * back when it was registered. Returns whether anything was actually
   * removed, so a caller asking "is this still here" gets a real answer
   * rather than having to track it separately.
   *
   * Exists for `Scenery`'s tree-felling (see `pylons.ts`'s pylon search):
   * a support that would otherwise be skipped because a tree stands on its
   * spot removes that one tree's collider instead of giving up the spot.
   * It is the only removal of a *circle*, and not a general licence to
   * reshuffle the world at will. Walls have their own named toggles —
   * {@link removeWall} and {@link restoreWall}: the hotel suite's lock, and
   * the library's two (#718, #719), the owl's capsule while she flies and the
   * secret leaf's closed and open collider sets. None of those goes through
   * here.
   *
   * `thinnestHalfWidth` is deliberately left alone: if the collider removed
   * happened to be the thinnest one registered, the cached value is now a
   * hair more conservative than it needs to be — sub-stepping the mover's
   * movement a little finer than strictly required — never the other way
   * round, so it stays safe to leave stale rather than rescanning every
   * collider on every removal.
   */
  removeCircle(id: number): boolean {
    const index = this.circles.findIndex((circle) => circle.id === id);
    if (index === -1) return false;
    this.circles.splice(index, 1);
    this.revisionCounter += 1;
    return true;
  }

  addWall(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    halfThickness = 0.35,
    topHeight = Infinity,
    autoHoppable = false,
    topIsAbsolute = false,
    baseHeight = -Infinity,
    navStamped = false,
    hopHeight = Number.NaN,
    topHeightEnd = Number.NaN,
  ): WallCollider {
    // A top at each end (`topHeight` over (x1, z1), `topHeightEnd` over
    // (x2, z2)) runs straight between them — see {@link TopSlope}. The solid's
    // one-number `topHeight` is then the middle's, for every reader that asks
    // a single figure of it.
    const sloped = topIsAbsolute && Number.isFinite(topHeight) && Number.isFinite(topHeightEnd);
    const middleTop = sloped ? (topHeight + topHeightEnd) / 2 : topHeight;
    const wall: WallCollider = {
      x1,
      z1,
      x2,
      z2,
      halfThickness,
      ...this.heights((x1 + x2) / 2, (z1 + z2) / 2, middleTop, autoHoppable, topIsAbsolute, baseHeight, navStamped, hopHeight),
      topEnds: this.currentTopEnds,
    };
    if (sloped) {
      const r1 = radiusFor(x1, z1, topHeight);
      const r2 = radiusFor(x2, z2, topHeightEnd);
      const radial = !Number.isNaN(r1) && !Number.isNaN(r2);
      wall.topSlope = {
        x1,
        z1,
        dx: x2 - x1,
        dz: z2 - z1,
        lengthSquared: (x2 - x1) ** 2 + (z2 - z1) ** 2,
        top1: radial ? r1 : topHeight,
        top2: radial ? r2 : topHeightEnd,
        radial,
      };
    }
    this.walls.push(wall);
    this.thinnestHalfWidth = Math.min(this.thinnestHalfWidth, halfThickness);
    this.revisionCounter += 1;
    return wall;
  }

  /**
   * Takes back a wall {@link addWall} returned — a locked door opening.
   * `thinnestHalfWidth` is left as the running minimum it was; it can only be
   * conservative after a removal, never wrong.
   *
   * The named toggles that use it: the hotel suite's lock, and the library's
   * two (#718, #719) — **the owl's zero-length capsule while she flies** (she
   * is not at her desk, so her desk must not be solid) and **the secret leaf**
   * (its closed collider set comes out as it lands open, its open set as it
   * shuts). Both of the library's are put back with {@link restoreWall}, the
   * same objects, so a check that names a solid still finds it afterwards.
   */
  removeWall(wall: WallCollider): void {
    const at = this.walls.indexOf(wall);
    if (at === -1) return;
    this.walls.splice(at, 1);
    this.revisionCounter += 1;
  }

  /**
   * Puts back a wall {@link removeWall} took out — **the same object**, not a
   * fresh registration.
   *
   * The same object is the point: its `owner` tag (what `ownedBy` scoped it
   * to) and every field come back exactly as they were, and anything holding
   * the reference — a toggle about to remove it again, a check asking "is this
   * solid present" — is still holding the live collider. Re-adding through
   * {@link addWall} would mint a twin that the holder's reference no longer
   * names, and the next `removeWall` would quietly remove nothing.
   *
   * Idempotent: a wall already present is left alone (no duplicate, no
   * revision bump), so a toggle can restore without first asking. Otherwise
   * the revision moves, exactly as {@link addWall}'s does, so a cached route
   * lattice (`NavGrid`) sees the change. `thinnestHalfWidth` takes the wall
   * back into its running minimum, as `addWall` would — after a `clear()` that
   * minimum restarted, and a restored wall must still sub-step the mover.
   */
  restoreWall(wall: WallCollider): void {
    if (this.walls.includes(wall)) return;
    this.walls.push(wall);
    this.thinnestHalfWidth = Math.min(this.thinnestHalfWidth, wall.halfThickness);
    this.revisionCounter += 1;
  }

  /**
   * Registers an axis-aligned rectangle as **one filled box** — see
   * {@link BoxCollider}. `halfX`/`halfZ` are where the old four walls' centre
   * lines stood and `halfThickness` their half-thickness, so the outline is
   * unchanged: outer faces at `half + halfThickness`, quarter-circle corners.
   * Only the hollow middle is gone.
   */
  addRectangle(
    cx: number,
    cz: number,
    halfX: number,
    halfZ: number,
    halfThickness = 0.35,
    topHeight = Infinity,
    autoHoppable = false,
    topIsAbsolute = false,
  ): BoxCollider {
    return this.addBox(cx, cz, halfX, halfZ, 0, halfThickness, topHeight, autoHoppable, topIsAbsolute);
  }

  /**
   * Registers a filled box turned by `yaw` radians (the angle from world +X to
   * the box's local +X, counter-clockwise looking down +Y the way `atan2(z, x)`
   * measures it) — see {@link BoxCollider}. `rounding` thickens the rectangle
   * on every side; a crisp-cornered crate is `rounding` 0 with its drawn
   * half-extents, a bench inset by its rounding keeps the outline it had.
   */
  addBox(
    cx: number,
    cz: number,
    halfX: number,
    halfZ: number,
    yaw = 0,
    rounding = 0,
    topHeight = Infinity,
    autoHoppable = false,
    topIsAbsolute = false,
    baseHeight = -Infinity,
    hopHeight = Number.NaN,
  ): BoxCollider {
    const box: BoxCollider = {
      cx,
      cz,
      halfX: Math.max(0, halfX),
      halfZ: Math.max(0, halfZ),
      cos: yaw === 0 ? 1 : Math.cos(yaw),
      sin: yaw === 0 ? 0 : Math.sin(yaw),
      rounding,
      ...this.heights(cx, cz, topHeight, autoHoppable, topIsAbsolute, baseHeight, false, hopHeight),
    };
    this.boxes.push(box);
    // The narrowest band a mover could hope to skip in one frame: its thin
    // axis, rounding and all.
    this.thinnestHalfWidth = Math.min(this.thinnestHalfWidth, Math.min(box.halfX, box.halfZ) + rounding);
    this.revisionCounter += 1;
    return box;
  }

  /**
   * Takes back a box {@link addBox} or {@link addRectangle} returned — the
   * same toggle {@link removeWall} is for walls (a library box that must come
   * and go: the secret shelf's closed and open sets).
   */
  removeBox(box: BoxCollider): void {
    const at = this.boxes.indexOf(box);
    if (at === -1) return;
    this.boxes.splice(at, 1);
    this.revisionCounter += 1;
  }

  /** Takes back a wall or a box — whichever it is. See {@link removeWall}, {@link removeBox}. */
  removeSolid(solid: WallCollider | BoxCollider): void {
    if ('halfX' in solid) this.removeBox(solid);
    else this.removeWall(solid);
  }

  /**
   * Puts back a box {@link removeBox} took out — **the same object**, for
   * {@link restoreWall}'s reasons. Idempotent.
   */
  restoreBox(box: BoxCollider): void {
    if (this.boxes.includes(box)) return;
    this.boxes.push(box);
    this.thinnestHalfWidth = Math.min(this.thinnestHalfWidth, Math.min(box.halfX, box.halfZ) + box.rounding);
    this.revisionCounter += 1;
  }

  get colliderCount(): number {
    return this.circles.length + this.walls.length + this.boxes.length;
  }

  clear(): void {
    this.circles.length = 0;
    this.walls.length = 0;
    this.boxes.length = 0;
    this.thinnestHalfWidth = Infinity;
    this.revisionCounter += 1;
  }

  /**
   * Read-only walks over everything solid, for whoever needs to *map* the world
   * rather than be pushed around by it — `world/NavGrid.ts`, so far.
   *
   * Deliberately a visitor rather than an exposed array: the colliders are
   * mutable objects and handing them out would let a consumer move a tree by
   * accident. Called once per lattice build, never per frame, so the closure
   * costs nothing worth counting.
   */
  forEachCircle(
    visit: (
      x: number,
      z: number,
      radius: number,
      topHeight: number,
      autoHoppable: boolean,
      baseHeight: number,
      navStamped: boolean,
      topIsAbsolute: boolean,
      hopHeight: number,
      /** Is its top wide enough to stand on ({@link FOOT_HALF_WIDTH})? */
      standable: boolean,
    ) => void,
  ): void {
    for (const circle of this.circles) {
      visit(
        circle.x,
        circle.z,
        circle.radius,
        circle.topHeight,
        circle.autoHoppable,
        circle.baseHeight,
        circle.navStamped,
        circle.topIsAbsolute,
        circle.hopHeight,
        standableTop(circle),
      );
    }
  }

  forEachWall(
    visit: (
      x1: number,
      z1: number,
      x2: number,
      z2: number,
      halfThickness: number,
      topHeight: number,
      autoHoppable: boolean,
      baseHeight: number,
      navStamped: boolean,
      topIsAbsolute: boolean,
      hopHeight: number,
      /** Is its top wide enough to stand on ({@link FOOT_HALF_WIDTH})? */
      standable: boolean,
    ) => void,
  ): void {
    for (const wall of this.walls) {
      visit(
        wall.x1,
        wall.z1,
        wall.x2,
        wall.z2,
        wall.halfThickness,
        wall.topHeight,
        wall.autoHoppable,
        wall.baseHeight,
        wall.navStamped,
        wall.topIsAbsolute,
        wall.hopHeight,
        standableTop(wall),
      );
    }
  }

  /**
   * Every filled box, read-only, for the route lattice — see
   * {@link forEachCircle}. `corners` walk the core rectangle's outline in the
   * order the old `addRectangle` walls ran (for an axis-aligned box, exactly
   * their endpoints, by the same arithmetic), `rounding` is how far the solid
   * reaches past that outline, and `inCore(x, z)` says whether a point is
   * inside the rectangle itself — so a lattice can stamp the outline the way
   * it always stamped those walls and then fill the middle, which is all that
   * changed.
   */
  forEachBox(
    visit: (
      corners: readonly (readonly [number, number])[],
      rounding: number,
      inCore: (x: number, z: number) => boolean,
      topHeight: number,
      autoHoppable: boolean,
      baseHeight: number,
      navStamped: boolean,
      topIsAbsolute: boolean,
      centre: readonly [number, number],
      hopHeight: number,
      /** Is its top wide enough to stand on ({@link FOOT_HALF_WIDTH})? */
      standable: boolean,
    ) => void,
  ): void {
    for (const box of this.boxes) {
      visit(
        boxCorners(box),
        box.rounding,
        (x, z) => {
          const reading = readBox(box, x, z);
          return reading.distance === 0;
        },
        box.topHeight,
        box.autoHoppable,
        box.baseHeight,
        box.navStamped,
        box.topIsAbsolute,
        [box.cx, box.cz],
        box.hopHeight,
        standableTop(box),
      );
    }
  }

  /**
   * **Every solid, as a read-only view** — what it is, where its footprint is,
   * and its top and base at any column — for a measure that has to ask about
   * solids as solids rather than as three collider kinds (`check:solids`, the
   * census). A view, not the collider: nothing a measure holds can move a tree.
   */
  forEachSolid(visit: (solid: SolidView) => void): void {
    for (const circle of this.circles) {
      visit({
        shape: 'circle',
        kind: circle.kind,
        owner: circle.owner,
        centreX: circle.x,
        centreZ: circle.z,
        halfWidth: circle.radius,
        reach: circle.radius,
        depthAt: (x, z) => circle.radius - Math.hypot(x - circle.x, z - circle.z),
        standsAt: (x, z) => {
          const d = Math.hypot(x - circle.x, z - circle.z);
          return d <= circle.radius && standsWithin(circle, d);
        },
        topAt: (x, z) => solidTopAt(circle, x, z),
        baseAt: (x, z) => solidBaseAt(circle, x, z),
        topIsAbsolute: circle.topIsAbsolute,
        topHeight: circle.topHeight,
        hopHeight: circle.hopHeight,
        autoHoppable: circle.autoHoppable,
        banded: banded(circle),
      });
    }
    for (const wall of this.walls) {
      const ax = wall.x2 - wall.x1;
      const az = wall.z2 - wall.z1;
      const lengthSquared = ax * ax + az * az;
      visit({
        shape: 'capsule',
        kind: wall.kind,
        owner: wall.owner,
        centreX: (wall.x1 + wall.x2) / 2,
        centreZ: (wall.z1 + wall.z2) / 2,
        halfWidth: wall.halfThickness,
        reach: Math.sqrt(lengthSquared) / 2 + wall.halfThickness,
        depthAt: (x, z) => {
          let t = lengthSquared < 1e-8 ? 0 : ((x - wall.x1) * ax + (z - wall.z1) * az) / lengthSquared;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          return wall.halfThickness - Math.hypot(x - (wall.x1 + ax * t), z - (wall.z1 + az * t));
        },
        standsAt: (x, z) => {
          let t = lengthSquared < 1e-8 ? 0 : ((x - wall.x1) * ax + (z - wall.z1) * az) / lengthSquared;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(x - (wall.x1 + ax * t), z - (wall.z1 + az * t));
          return d <= wall.halfThickness && standsWithin(wall, d) && wallTopReaches(wall, x, z);
        },
        topAt: (x, z) => solidTopAt(wall, x, z),
        baseAt: (x, z) => solidBaseAt(wall, x, z),
        topIsAbsolute: wall.topIsAbsolute,
        topHeight: wall.topHeight,
        hopHeight: wall.hopHeight,
        autoHoppable: wall.autoHoppable,
        banded: banded(wall),
      });
    }
    for (const box of this.boxes) {
      visit({
        shape: 'box',
        kind: box.kind,
        owner: box.owner,
        centreX: box.cx,
        centreZ: box.cz,
        halfWidth: Math.min(box.halfX, box.halfZ) + box.rounding,
        reach: Math.hypot(box.halfX, box.halfZ) + box.rounding,
        depthAt: (x, z) => boxDepth(box, x, z, 0),
        standsAt: (x, z) => boxDepth(box, x, z, 0) >= 0 && standableTop(box),
        topAt: (x, z) => solidTopAt(box, x, z),
        baseAt: (x, z) => solidBaseAt(box, x, z),
        topIsAbsolute: box.topIsAbsolute,
        topHeight: box.topHeight,
        hopHeight: box.hopHeight,
        autoHoppable: box.autoHoppable,
        banded: banded(box),
      });
    }
  }

  /**
   * The longest a single movement sub-step may be for a mover of this width,
   * in metres — see {@link SUBSTEP_FOOTPRINT_FRACTION}. `Infinity` while
   * nothing solid is registered, which is the honest answer: there is nothing
   * to tunnel through.
   */
  maxSafeStep(moverRadius: number): number {
    return SUBSTEP_FOOTPRINT_FRACTION * (this.thinnestHalfWidth + moverRadius);
  }

  /**
   * **Move, then resolve — in sub-steps short enough that nothing solid can be
   * stepped clean over.** This is what a mover's per-frame movement should go
   * through; {@link resolve} on its own is the point test underneath it.
   *
   * ### The bug this exists for
   *
   * `resolve` asks "where is she *now*?", never "what did she cross getting
   * here?". At `MAX_FRAME_DELTA` — 1/12 s, the clamp a phone hitting a hitch
   * actually gets — a full sprint covers 0.93 m in one frame. Step that far
   * from just outside a garden wall and you land past its middle, at which
   * point the resolver does the worst possible right thing: it pushes out of
   * the *nearest* face, which is now the far one, and walks a six-year-old
   * through a wall she cannot see how she got past. It happens **at any
   * height**, because a collider she overlaps at neither end of the step is
   * never asked about her height at all — the whole `clearsTop` /
   * `MAX_AUTO_HOP_HEIGHT` apparatus is simply skipped. A 2 m wall goes through
   * exactly as easily as a 0.7 m one.
   *
   * ### Why sub-steps and not a swept test
   *
   * A swept test would have to be a second collision routine standing beside
   * `resolve`, and would have to independently reproduce all of it: the height
   * rule, the two-pass corner handling, the shallow/deep split, the capped
   * escort, the soft boundary. Two routines that must agree about what "solid"
   * means are two routines that will one day disagree — and the measured hop
   * clearances (`scripts/measure-hop-clearance.mts`) were measured against
   * *this* resolver's exact behaviour, so any second answer would quietly
   * invalidate them. Sub-stepping calls the one resolver more often and
   * changes nothing about what it does.
   *
   * The other reason is the glancing approach. The obvious swept test — is the
   * movement segment within `halfThickness + radius` of the wall's centre line
   * — is not conservative near a wall's ends, and a fence in this park is a
   * chain of segments, so its ends are everywhere. Sub-stepping asks the real
   * point test at points along the way and inherits its geometry exactly.
   *
   * ### Cost
   *
   * One sub-step — i.e. literally the old code path, `resolve` called once —
   * at any frame rate a player normally sees: 60 fps at a full sprint is a
   * 0.185 m step against a 0.40 m limit, and even 24 fps stays inside it. The
   * count only rises on the stuttering frames, where the extra work is two
   * more collider scans on a frame that was already long, and where the
   * alternative is walking through a wall.
   *
   * `dt` is divided among the sub-steps, which is what keeps a deep overlap's
   * escort (see {@link MAX_DEPENETRATION_SPEED}) moving at the same metres per
   * *second* however many sub-steps a frame is cut into — the correction stays
   * a property of elapsed time, not of frame count, and the fling latch in
   * `Player.update` sees exactly the escort it saw before.
   *
   * The returned flags are the union over the sub-steps, which is the same
   * question asked of the whole frame: `clearedWall` if she was over something
   * she had jumped clear of at any point in it, `escorting`/`corrected` if she
   * was pushed at all. `Player`'s escort latch reads them exactly as it did
   * when there was only ever one sub-step.
   *
   * ### `onStep` — the vertical half of the same idea (#358)
   *
   * Walls were sub-stepped; the **ground sample was not**, and that asymmetry
   * was its own tunnel, pointed downwards. `Player` samples the walking
   * surface once per frame, at the end of the whole movement, so a deck that
   * rises faster than one sample can follow is simply not found and she drops
   * through it — the same "a collider she overlaps at neither end of the step
   * is never asked about" failure, with `WalkSurfaces` in the role of the
   * resolver.
   *
   * `onStep` is called with `position` after each sub-step's `resolve` — so at
   * the mover's real, corrected location — which lets the caller walk its own
   * per-point query along the very same pieces this already cuts the movement
   * into. **That is the point of putting it here**: the decomposition stays in
   * one place, so the vertical question can never be asked at a different
   * granularity from the lateral one, or quietly stop being asked at all. A
   * caller that passes nothing (every NPC, `nudge`) takes exactly the code
   * path it took before, including the single-`resolve` fast path.
   */
  resolveMovement(
    position: Vector3,
    deltaX: number,
    deltaZ: number,
    radius: number,
    clearance = 0,
    dt = Infinity,
    onStep?: (position: Vector3) => void,
    stepCeiling?: StepCeiling,
    moverHeight = 0,
  ): { clearedWall: boolean; escorting: boolean; corrected: boolean } {
    const distance = Math.hypot(deltaX, deltaZ);
    const limit = this.maxSafeStep(radius);
    const steps = distance > limit ? Math.min(Math.ceil(distance / limit), MAX_SUBSTEPS) : 1;
    const stepX = deltaX / steps;
    const stepZ = deltaZ / steps;
    const stepDt = dt / steps;

    let clearedWall = false;
    let escorting = false;
    let corrected = false;
    let depthBefore = this.deepestSolidOverlap(position, radius, clearance, stepCeiling, moverHeight);
    for (let step = 0; step < steps; step += 1) {
      const fromX = position.x;
      const fromZ = position.z;
      position.x += stepX;
      position.z += stepZ;
      let result = this.resolve(position, radius, clearance, stepDt, stepCeiling, moverHeight);
      // **The pinch guard: a step may not leave her deeper in stone than it
      // found her.** `resolve` pushes out of each collider in turn, twice.
      // Between two colliders closer together than she is wide — a lamp post
      // 1.13 m from a castle turret (seed 4, restart 2) — each push lands her
      // in the other, and the last one wins: she ended 0.11 m inside the
      // turret's drawn stone, walking in from 11 of 96 approaches. More passes
      // only creep towards the answer (sixteen passes still left 4 cm);
      // the answer is that she does not fit, so the step is not taken. She
      // stays where she was — in contact at the mouth of the gap, as a child
      // who cannot squeeze through would — and `resolve` is asked there with
      // no movement, so an escort already under way still progresses.
      // `check:castle-towers` marches 48 bearings at every turret.
      const depthAfter = this.deepestSolidOverlap(position, radius, clearance, stepCeiling, moverHeight);
      if (depthAfter > Math.max(depthBefore, 0) + PINCH_TOLERANCE) {
        position.x = fromX;
        position.z = fromZ;
        result = this.resolve(position, radius, clearance, stepDt, stepCeiling, moverHeight);
        depthBefore = this.deepestSolidOverlap(position, radius, clearance, stepCeiling, moverHeight);
      } else {
        depthBefore = depthAfter;
      }
      onStep?.(position);
      clearedWall = clearedWall || result.clearedWall;
      escorting = escorting || result.escorting;
      corrected = corrected || result.corrected;
    }
    return { clearedWall, escorting, corrected };
  }

  /**
   * Pushes `position` (mutated in place) out of every collider it overlaps and
   * keeps it inside the garden boundary. `radius` is the mover's own width.
   *
   * **A point test.** It knows where a mover is, not how she got there, so
   * anything moving under its own steam should go through
   * {@link resolveMovement} instead — which is this, in sub-steps short enough
   * that a long frame cannot carry her over a wall without ever overlapping
   * it. Calling `resolve` directly is right for a one-shot placement query
   * (where a body is *put*, not moved) and for the small externally-applied
   * shoves that never approach a collider's own width.
   *
   * `clearance` is how high the mover's feet currently are above their own
   * local ground — 0 while walking, positive mid-jump. A collider whose
   * `topHeight` the clearance reaches (within `JUMP_CLEARANCE_GRACE`) does not
   * push back while the mover is actually over its footprint, which is what
   * lets a jump sail over a low wall: the wall simply stops being solid for
   * the moment the jumper is above it. Leaving `clearance` at its default of 0
   * reproduces the old always-solid behaviour exactly, which is why NPCs and
   * the player's grounded movement don't need to change anything to keep
   * working.
   *
   * `feetY` is the height a solid with a real (absolute) top is cleared from:
   * the mover's own `y` unless it says otherwise. **The crowd says otherwise.**
   * Only she and her parade stand on tops; an NPC walks the ground layer and
   * nothing else, so a giggle-hop that carried one over a bench or a fence rail
   * would put it down *inside* that footprint, to be shoved back out — a jolt
   * `check:jitter` exists to catch. So an NPC clears from the ground it hopped
   * off, and a top it could not have stepped over standing there stays a wall
   * to it at any height of its hop. With every outdoor top Infinity or relative,
   * as it was before solids had real tops, this changed nothing; it is what
   * keeps the crowd walking exactly as it did once they have them.
   *
   * Resolving in a couple of passes stops the player squeezing through corners
   * where two colliders meet. Returns `true` if at least one collider was
   * skipped this call purely because the mover jumped clear over it — Player
   * uses this to know when to pop a little effect at the moment of clearing.
   *
   * `dt` is this frame's time step. It is what lets a *deep* overlap (see
   * {@link SHALLOW_OVERLAP}) be escorted out gently across several frames
   * instead of corrected in one — see {@link MAX_DEPENETRATION_SPEED}. It
   * defaults to `Infinity`, i.e. "resolve fully, right now, in one call",
   * which is exactly the old behaviour and is what one-shot placement queries
   * (parade formation, NPC waypoint clearance) want and get for free by not
   * passing it: they don't have a meaningful frame time to speak of, and
   * their overlaps are corner-cutting-small anyway, so the shallow/deep
   * distinction never bites for them either way.
   *
   * Returns `clearedWall` (`true` if at least one collider was skipped this
   * call purely because the mover jumped clear over it — Player uses this to
   * know when to pop a little effect at the moment of clearing), `escorting`
   * (`true` if a deep overlap was corrected this call, however little of it —
   * a mover already embedded in something, being nudged back out) and
   * `corrected` (`true` if the position was moved at all, by any amount, deep
   * or shallow).
   *
   * `escorting` matters to callers that derive their own velocity from how
   * far `resolve` just moved them (Player, NpcCharacter): a deep-overlap
   * correction is an *external* nudge, not something the mover did under
   * their own power, and must never be read back as velocity. Reading it
   * back as velocity is exactly how design feedback #17's "fling" happened —
   * the escort distance got banked as speed, which then carried the mover
   * further into (or through) the same overlap next frame under ordinary
   * movement integration, which escorted them again, banking still more
   * speed — a feedback loop that only stopped when something finally blocked
   * it outright. Capping the correction speed alone (this constant) slows
   * that loop down but doesn't break it; only refusing to treat escort
   * distance as velocity does.
   *
   * ### Why `corrected` exists too
   *
   * `escorting` answers "is *this frame's* correction deeper than ordinary
   * contact?", but an escort is a *process*, several frames long, and its
   * last frame or two are always shallow — the overlap is nearly gone by
   * then, which is the whole point. So a caller watching `escorting` alone
   * sees the guard switch off partway through the very escort it is there to
   * protect, and banks that final correction as velocity after all. Against
   * a wall the jump *just* clears (design feedback: "jumping over walls the
   * player sometimes gets a burst of extreme speed") the tail of the escort
   * is still ~0.4 m, which at 60 fps reads back as ~25 m/s — a fling, from
   * the guarded path, by the guarded mechanism.
   *
   * `corrected` is what lets a caller tell where the escort actually ends:
   * not when the correction goes quiet, but when it stops entirely. See
   * `Player.update`, which holds the guard on until then.
   */
  /**
   * The deepest a mover of `radius` at `position` overlaps anything solid to
   * her, in metres (0 when clear). Solid by exactly `resolve`'s rule
   * ({@link contactWith}); the soft park boundary is not stone and is not
   * counted. Read-only — the measuring half of `resolveMovement`'s pinch guard.
   */
  deepestSolidOverlap(position: Vector3, radius: number, clearance = 0, stepCeiling?: StepCeiling, moverHeight = 0): number {
    let deepest = 0;
    const stepHere = stepCeiling ? stepCeiling(position.x, position.z) : -Infinity;
    for (const circle of this.circles) {
      const minimum = circle.radius + radius;
      const depth = minimum - Math.hypot(position.x - circle.x, position.z - circle.z);
      if (depth <= deepest) continue;
      if (contactWith(circle, position, clearance, stepHere, moverHeight) !== 'solid') continue;
      deepest = depth;
    }
    for (const wall of this.walls) {
      const ax = wall.x2 - wall.x1;
      const az = wall.z2 - wall.z1;
      const lengthSquared = ax * ax + az * az;
      // A zero-length wall is a disc: its nearest point is its one end (see WallCollider).
      let t = lengthSquared < 1e-8 ? 0 : ((position.x - wall.x1) * ax + (position.z - wall.z1) * az) / lengthSquared;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const depth =
        wall.halfThickness + radius -
        Math.hypot(position.x - (wall.x1 + ax * t), position.z - (wall.z1 + az * t));
      if (depth <= deepest) continue;
      if (contactWith(wall, position, clearance, stepHere, moverHeight) !== 'solid') continue;
      deepest = depth;
    }
    for (const box of this.boxes) {
      const depth = boxDepth(box, position.x, position.z, radius);
      if (depth <= deepest) continue;
      if (contactWith(box, position, clearance, stepHere, moverHeight) !== 'solid') continue;
      deepest = depth;
    }
    return deepest;
  }

  resolve(
    position: Vector3,
    radius: number,
    clearance = 0,
    dt = Infinity,
    stepCeiling?: StepCeiling,
    moverHeight = 0,
    feetY = position.y,
  ): { clearedWall: boolean; escorting: boolean; corrected: boolean } {
    let clearedAny = false;
    // Asked once, where she is as this call begins: a push moves her by her
    // overlap at most, over which a step's reach does not change.
    const stepHere = stepCeiling ? stepCeiling(position.x, position.z) : -Infinity;
    let escorting = false;
    let corrected = false;
    // Shared across every collider and both passes below, so a mover pinned
    // between two deep overlaps at once still escorts at a combined
    // MAX_DEPENETRATION_SPEED overall, rather than that much again per
    // collider that happens to touch them.
    let depenetrationBudget = MAX_DEPENETRATION_SPEED * dt;

    const applyCorrection = (correctionX: number, correctionZ: number): void => {
      const magnitude = Math.hypot(correctionX, correctionZ);
      if (magnitude < 1e-9) return;
      corrected = true;
      if (magnitude <= SHALLOW_OVERLAP) {
        // Ordinary contact — walked straight into a wall, tree or rim.
        // Correct it fully and instantly: this is what keeps blocking crisp.
        position.x += correctionX;
        position.z += correctionZ;
        return;
      }
      escorting = true;
      const allowed = Math.min(magnitude, depenetrationBudget);
      depenetrationBudget -= allowed;
      const scale = allowed / magnitude;
      position.x += correctionX * scale;
      position.z += correctionZ * scale;
    };

    for (let pass = 0; pass < 2; pass += 1) {
      let moved = false;

      for (const circle of this.circles) {
        const dx = position.x - circle.x;
        const dz = position.z - circle.z;
        const minimum = circle.radius + radius;
        const distanceSquared = dx * dx + dz * dz;
        if (distanceSquared >= minimum * minimum) continue; // not overlapping at all
        const contact = contactWith(circle, position, clearance, stepHere, moverHeight, feetY);
        if (contact === 'absent' || contact === 'stepped') continue;
        if (contact === 'cleared') {
          clearedAny = true; // over its footprint, but jumped clear above it
          continue;
        }
        const distance = Math.sqrt(distanceSquared);
        if (distance < 1e-5) {
          // Exactly on the centre: shove in an arbitrary but stable direction.
          applyCorrection(minimum, 0);
          moved = true;
          continue;
        }
        const push = (minimum - distance) / distance;
        applyCorrection(dx * push, dz * push);
        moved = true;
      }

      for (const wall of this.walls) {
        const ax = wall.x2 - wall.x1;
        const az = wall.z2 - wall.z1;
        const lengthSquared = ax * ax + az * az;
        // A zero-length wall is a disc: its nearest point is its one end (see WallCollider).
        const degenerate = lengthSquared < 1e-8;
        let t = degenerate ? 0 : ((position.x - wall.x1) * ax + (position.z - wall.z1) * az) / lengthSquared;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const closestX = wall.x1 + ax * t;
        const closestZ = wall.z1 + az * t;
        const dx = position.x - closestX;
        const dz = position.z - closestZ;
        const minimum = wall.halfThickness + radius;
        const distanceSquared = dx * dx + dz * dz;
        if (distanceSquared >= minimum * minimum) continue; // not overlapping at all
        const contact = contactWith(wall, position, clearance, stepHere, moverHeight, feetY);
        if (contact === 'absent' || contact === 'stepped') continue;
        if (contact === 'cleared') {
          clearedAny = true; // over its footprint, but jumped clear above it
          continue;
        }
        const distance = Math.sqrt(distanceSquared);
        if (distance < 1e-5) {
          if (degenerate) {
            // Exactly on a disc's centre: the circles' arbitrary but stable direction.
            applyCorrection(minimum, 0);
          } else {
            const invLength = 1 / Math.sqrt(lengthSquared);
            applyCorrection(-az * invLength * minimum, ax * invLength * minimum);
          }
          moved = true;
          continue;
        }
        const push = (minimum - distance) / distance;
        applyCorrection(dx * push, dz * push);
        moved = true;
      }

      // Filled boxes: out through the nearest face from anywhere inside, away
      // from the nearest core point from outside. One shape, no hollow middle
      // for opposite pushes to cancel in — see {@link BoxCollider}.
      for (const box of this.boxes) {
        const reading = readBox(box, position.x, position.z);
        const depth = box.rounding + radius - reading.distance + reading.inside;
        if (depth <= 0) continue; // not overlapping at all
        const contact = contactWith(box, position, clearance, stepHere, moverHeight, feetY);
        if (contact === 'absent' || contact === 'stepped') continue;
        if (contact === 'cleared') {
          clearedAny = true; // over its footprint, but jumped clear above it
          continue;
        }
        applyCorrection(reading.outX * depth, reading.outZ * depth);
        moved = true;
      }

      // Soft boundary — you can never walk out of the park, nor off the edge of
      // the building's own space. Only for movers actually near it, though:
      // see {@link BOUNDARY_LEASH_REACH} for why somebody in another space
      // entirely is not "outside the park".
      //
      // Pushed along the boundary's own gradient rather than straight at a
      // centre, because the park's edge is no longer a circle and "towards the
      // middle" is not the way out of it. The gradient of a signed distance
      // field points at the nearest edge, so stepping *up* it by the shortfall
      // lands exactly on the clearance line, whatever shape that line is. The
      // four extra queries only happen when the walker is actually within her
      // own radius of the edge, which is rare — everywhere else this is the one
      // `distanceToEdge` call it always was.
      const edgeGap = this.bounds.distanceToEdge(position.x, position.z);
      if (edgeGap < radius && edgeGap > -BOUNDARY_LEASH_REACH) {
        const e = 0.25;
        const gradientX =
          this.bounds.distanceToEdge(position.x + e, position.z) -
          this.bounds.distanceToEdge(position.x - e, position.z);
        const gradientZ =
          this.bounds.distanceToEdge(position.x, position.z + e) -
          this.bounds.distanceToEdge(position.x, position.z - e);
        const length = Math.hypot(gradientX, gradientZ);
        if (length > 1e-9) {
          const step = radius - edgeGap;
          applyCorrection((gradientX / length) * step, (gradientZ / length) * step);
          moved = true;
        }
      }

      if (!moved) break;
    }

    return { clearedWall: clearedAny, escorting, corrected };
  }

  /**
   * A read-only probe for the auto-hop feature (design feedback #30e — hop
   * over a low wall with no button press, especially useful for tap-to-move).
   *
   * Answers "if `position` (at `radius`) sits inside an `autoHoppable`
   * collider right now, would a jump reaching `apexClearance` above the
   * ground clear it?" — the same question `resolve`'s own `clearance`
   * parameter answers for a jump already in flight, with the same
   * {@link JUMP_CLEARANCE_GRACE}, so "would clear" means the same thing in
   * both places and a wall the manual jump clears is exactly a wall this
   * clears too.
   *
   * Deliberately separate from `resolve()`, never mutates `position`, and
   * never even looks at the soft park boundary — there is nothing to jump
   * over there. `Player` calls this with a point a little ahead of its own
   * feet, in the direction it is actually trying to go, so the hop can fire a
   * moment before contact rather than after stopping dead against the wall.
   */
  wouldAutoHopClear(position: Vector3, radius: number, apexClearance: number): boolean {
    for (const circle of this.circles) {
      if (!circle.autoHoppable || !autoHopClears(circle.hopHeight, apexClearance)) continue;
      const dx = position.x - circle.x;
      const dz = position.z - circle.z;
      const minimum = circle.radius + radius;
      if (dx * dx + dz * dz < minimum * minimum) return true;
    }

    for (const wall of this.walls) {
      if (!wall.autoHoppable || !autoHopClears(wall.hopHeight, apexClearance)) continue;
      const ax = wall.x2 - wall.x1;
      const az = wall.z2 - wall.z1;
      const lengthSquared = ax * ax + az * az;
      // A zero-length wall is a disc: its nearest point is its one end (see WallCollider).
      let t = lengthSquared < 1e-8 ? 0 : ((position.x - wall.x1) * ax + (position.z - wall.z1) * az) / lengthSquared;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = position.x - (wall.x1 + ax * t);
      const dz = position.z - (wall.z1 + az * t);
      const minimum = wall.halfThickness + radius;
      if (dx * dx + dz * dz < minimum * minimum) return true;
    }

    for (const box of this.boxes) {
      if (!box.autoHoppable || !autoHopClears(box.hopHeight, apexClearance)) continue;
      if (boxDepth(box, position.x, position.z, radius) > 0) return true;
    }

    return false;
  }

  /**
   * Boot-time check: **the sub-step budget must actually cover the longest
   * step anything can take.** Call it once, beside
   * {@link checkHoppableColliders}, after the world has finished registering
   * scenery.
   *
   * {@link resolveMovement} cuts a movement into pieces no longer than
   * {@link maxSafeStep}, but caps the count at {@link MAX_SUBSTEPS} so a
   * degenerate collider cannot hang the game. If that cap ever *binds*, the
   * pieces are silently too long again and the tunnel is back — quietly, and
   * only on stuttering frames, which is the hardest possible way to notice.
   * So: say it out loud at boot instead.
   *
   * Today the park's thinnest collider is a 0.18 m sign post, giving a 0.40 m
   * sub-step and three of them for the worst frame there is. It would take a
   * collider under 3 cm across before the cap came anywhere near binding.
   */
  checkSubstepBudget(moverRadius: number, longestStep: number): string[] {
    const limit = this.maxSafeStep(moverRadius);
    const needed = Math.ceil(longestStep / limit);
    if (needed <= MAX_SUBSTEPS) return [];
    const problem =
      `the thinnest collider is ${this.thinnestHalfWidth.toFixed(3)} m across, so a mover of ` +
      `radius ${moverRadius.toFixed(2)} m needs ${needed} sub-steps to cross ` +
      `${longestStep.toFixed(2)} m safely, but only ${MAX_SUBSTEPS} are taken — she could be ` +
      `carried straight through something on a stuttering frame`;
    console.error(`Land of Good Places: ${problem}`);
    return [problem];
  }

  /**
   * Boot-time check: **no registered collider may sit in the gap between "the
   * predicate calls this hoppable" and "the flight actually carries her over
   * it"**. Call it once, after the world has finished registering scenery.
   *
   * This is the point of the whole exercise. Fixing the park's 1.4 m wall fixes
   * one wall; this makes the *class* of bug impossible, and the codebase has
   * twice recorded (ARCHITECTURE-REVIEW.md, reviews 3 and 4) that it wants
   * invariants the code enforces over invariants a comment claims.
   *
   * It catches three distinct ways in:
   *
   * - **Too tall for its width.** {@link autoHopClears} is a flat ceiling, but
   *   the truth is a function of footprint — see {@link measuredHopCeiling}. A
   *   1.0 m wall 0.4 m thick passes the predicate and strands her.
   * - **Hoppable but endless.** An `autoHoppable` collider left at the default
   *   `Infinity` `topHeight` is a contradiction in terms; today none exists,
   *   but nothing stopped one.
   * - **A stale measurement.** Change `JUMP_SPEED` or `GRAVITY` and every
   *   number here silently becomes fiction. Compared against
   *   {@link MEASURED_HOP_APEX} so it cannot pass unnoticed.
   *
   * Offenders are reported by name and position, and then **demoted to
   * non-hoppable**, which is the one repair that cannot make things worse: a
   * wall that is merely solid is a wall the router goes round, and going round
   * is exactly what it did before hoppable walls were planned over. It does not
   * move anybody's level design — a wall in the gap may well be deliberate, and
   * the report is there to be read and decided on, not acted on automatically.
   *
   * Returns the human-readable complaints, so a caller (or a test) can assert
   * on them rather than scraping the console.
   */
  checkHoppableColliders(moverRadius: number, apexClearance: number): string[] {
    const problems: string[] = [];

    if (Math.abs(apexClearance - MEASURED_HOP_APEX) > HOP_APEX_TOLERANCE) {
      problems.push(
        `the jump apex is now ${apexClearance.toFixed(4)} m but MAX_AUTO_HOP_HEIGHT ` +
          `and measuredHopCeiling() were measured at ${MEASURED_HOP_APEX.toFixed(4)} m — ` +
          `re-run scripts/measure-hop-clearance.mts and update Collision.ts`,
      );
    }

    const inspect = (topHeight: number, halfWidth: number, what: string): boolean => {
      if (!autoHopClears(topHeight, apexClearance)) return false;
      if (!Number.isFinite(topHeight)) {
        problems.push(`${what} is autoHoppable but has no top at all (topHeight Infinity)`);
        return true;
      }
      const crossing = 2 * (halfWidth + moverRadius);
      const ceiling = measuredHopCeiling(crossing);
      if (topHeight <= ceiling) return false;
      problems.push(
        `${what} is ${topHeight.toFixed(2)} m tall and the predicate calls it hoppable, but a ` +
          `${crossing.toFixed(2)} m crossing is only flown reliably up to ${ceiling.toFixed(2)} m — ` +
          `she would be stranded against it`,
      );
      return true;
    };

    let demoted = 0;
    // **A hop is planned on the solid's own height above its ground** (its
    // `hopHeight`), never on its top: an absolute top is a height in the world,
    // which says nothing about how tall a wall is to a child standing beside it.
    // A hoppable solid with no hop height, or with a banded base the planner
    // cannot see, is demoted — the one repair that cannot make anything worse.
    const demote = (solid: SolidHeights, where: string, halfWidth: number): void => {
      if (!Number.isFinite(solid.hopHeight) && Number.isFinite(solid.topHeight) && solid.topIsAbsolute) {
        problems.push(`${where} is autoHoppable with an absolute top and no hop height, which is unsupported`);
      } else if (banded(solid)) {
        problems.push(`${where} is autoHoppable with a banded base, which is unsupported`);
      } else if (!inspect(solid.hopHeight, halfWidth, where)) {
        return;
      }
      solid.autoHoppable = false;
      demoted += 1;
    };
    for (const circle of this.circles) {
      if (!circle.autoHoppable) continue;
      demote(circle, `the hoppable circle at [${circle.x.toFixed(1)}, ${circle.z.toFixed(1)}]`, circle.radius);
    }
    for (const wall of this.walls) {
      if (!wall.autoHoppable) continue;
      demote(
        wall,
        `the hoppable wall [${wall.x1.toFixed(1)}, ${wall.z1.toFixed(1)}] → [${wall.x2.toFixed(1)}, ${wall.z2.toFixed(1)}]`,
        wall.halfThickness,
      );
    }
    for (const box of this.boxes) {
      if (!box.autoHoppable) continue;
      demote(box, `the hoppable box at [${box.cx.toFixed(1)}, ${box.cz.toFixed(1)}]`, Math.min(box.halfX, box.halfZ) + box.rounding);
    }

    // A demotion changes the map `NavGrid` bakes, so it has to invalidate the
    // cached lattice exactly as any other mutation would.
    if (demoted > 0) this.revisionCounter += 1;

    if (problems.length > 0) {
      console.error(
        `Land of Good Places: ${problems.length} collider problem(s) — these have been made ` +
          `solid so nobody gets stranded, but the level design wants a look:\n  ` +
          problems.join('\n  '),
      );
    }

    return problems;
  }
}

/**
 * The push-apart for two moving circles that must not overlap — the player
 * standing on a child, or a child standing on another child — as opposed to a
 * mover and a piece of static scenery (see {@link CollisionWorld.resolve} for
 * that). Deliberately outside `CollisionWorld`: neither side here is one of
 * its registered colliders, and there is nothing to register them as without
 * turning every child into a wall the others grind against (see
 * `NpcCharacter.separateFrom`, which already does exactly this for child↔child
 * and is the pattern this mirrors for player↔child).
 *
 * Splits the correction evenly and returns it rather than applying it, so the
 * caller decides how to move each side — `Player.nudge` for the player half,
 * a direct position write for an NPC, same as its own neighbours already get.
 * Returns `null` when the circles do not overlap at all.
 *
 * This never needs `SHALLOW_OVERLAP`'s instant/escorted split the way
 * `resolve` does: it is driven every frame while two circles overlap, so it
 * never has the chance to build up the kind of deep, spawned-inside overlap
 * that caused design feedback #17's fling in the first place. The caller
 * still caps how far it is willing to move something in one frame — see
 * `NpcSystem.separateFromPlayer`'s use of {@link MAX_DEPENETRATION_SPEED} —
 * as a second line of defence should two characters ever end up teleported
 * on top of each other.
 */
/**
 * **How far apart in height two bodies can stand and still be pushed apart**,
 * metres along the local up — about half a metre.
 *
 * The push-apart is two circles in plan, so before solids had tops to stand on
 * a child walking past a bench shoved the girl standing on it, and a guest on
 * the hotel landing shoved one walking under it, through the floor between
 * them. Within this gap they are close enough in height to bump (she is up a
 * kerb, or on a low bench beside you); past it one is above the other, and
 * nothing is pushed.
 */
export const SEPARATION_HEIGHT_GAP = 0.5;

/**
 * Are two bodies, feet at `a` and `b`, too far apart in height to push each
 * other — one above the other rather than side by side? Measured along the
 * local up (`riseBetween`: radial out in the park, plain `y` indoors), so two
 * children on the same hillside 1.3 m apart are side by side however the
 * planet leans under them.
 */
export function separatedByHeight(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  return Math.abs(riseBetween(ax, ay, az, bx, by, bz)) > SEPARATION_HEIGHT_GAP;
}

export function circleSeparation(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  minimum: number,
): { readonly dx: number; readonly dz: number } | null {
  const dx = bx - ax;
  const dz = bz - az;
  const distanceSquared = dx * dx + dz * dz;
  if (distanceSquared >= minimum * minimum || distanceSquared < 1e-8) return null;
  const distance = Math.sqrt(distanceSquared);
  const push = (minimum - distance) * 0.5;
  return { dx: (dx / distance) * push, dz: (dz / distance) * push };
}
