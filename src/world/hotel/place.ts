import type { Group, Object3D } from 'three';
import type { CollisionWorld } from '../Collision';
import type { MovingPlatform, WalkSurfaces } from '../building/surfaces';
import { JUMP_APEX_HEIGHT } from '../../entities/Player';
import { PLAYER_RADIUS } from '../../core/constants';
import { doorwayClearanceZones, type DoorwayZone, type HotelRoom } from './layout';

/**
 * **Putting a thing in a hotel room is one call, and that call decides
 * whether you can walk through it, whether a guest may stand there, and
 * whether a jump can land you on top of it.**
 *
 * Jim, having played it: *"the statues and chairs you can clip through are
 * weird."* The bug behind that was not a missing collider on a chair — it was
 * that a hotel prop was put down by *two* unrelated statements. One added a
 * model to the room; a second, optional, hand-written one told the guests to
 * keep away from it. Nothing at all registered it as solid, and nothing could
 * have noticed: the two facts were never the same fact.
 *
 * So every prop in this hotel now goes through {@link HotelProps.place}, which
 * takes **one** footprint and hands it to **three** consumers:
 *
 * 1. the shared {@link CollisionWorld}, so a child meets the statue rather
 *    than walking through it;
 * 2. the guest keep-out list, so nobody strolls into it either;
 * 3. the shared {@link WalkSurfaces}, so a prop with a flat top a jump can
 *    reach is somewhere she can *land* — see the next section.
 *
 * They cannot disagree, because there is nothing to disagree *with*: forget to
 * describe a prop's footprint and it is invisible to all three, which is a
 * failure a six-year-old finds in one visit rather than one that hides in a
 * table of numbers. This is CLAUDE.md's "one owner; everyone else asks",
 * applied to the thing that file names as the repo's most common bug.
 *
 * ## Solid AND standable — the rule Jim asked for
 *
 * Live play, 7 Aug 2026: *"I can't even jump onto a sofa that's much less
 * tall than my jump — I should be able to jump onto any solid item that's not
 * too high, here and elsewhere in the game."* The old registration made every
 * prop an infinitely tall pillar (the `topHeight = Infinity` default), and
 * the relative height scheme could not have fixed it: a collider's relative
 * top is compared against clearance above *the sampler's* ground, so a child
 * already stood on a sofa is at clearance 0 and its own edge would shove her
 * off — the law that forced the beds to be registered soft.
 *
 * So a prop's collider is registered with an **absolute** top
 * (`Collision.ts`'s `topIsAbsolute`): solid to feet below it, air to feet
 * above it, and still beneath the feet standing on it. Every {@link PropPlan}
 * must therefore say how tall its prop really is (`top` — required, so the
 * pillar bug cannot come back by omission), and anything whose flat top is
 * within {@link JUMP_APEX_HEIGHT} of its base gets a walkable plate at
 * exactly that height. A crystal or a hedge opts out with `stand: false` —
 * its *collider* still has the real top, there is simply no floor up there.
 *
 * ## Two rules the footprints obey
 *
 * **Generous-light, never generous-heavy.** A footprint is the prop's *visual*
 * size and never a metre more. The cost of brushing through the corner of a
 * planter is nothing; the cost of a child wedged between a table and a wall is
 * the game. Where a prop is long — a counter, a desk, a sofa — the rectangle
 * is registered *inset* by its own half-thickness (see
 * {@link WALL_HALF_THICKNESS}) so the collider lands exactly on the visual
 * edge rather than a fifth of a metre outside it.
 *
 * **A prop that is its own floor is placed soft.** The suite's beds are pure
 * `WalkSurfaces` platforms — Eleri's "sleep, or go jumpy jumpy!" — with
 * `solid: false` and no collider at all, because a bed is for bouncing across
 * and even an absolute-top wall at its edge would catch her mid-bounce at the
 * mattress rim. `solid: false` keeps only the keep-out (and whatever platform
 * its own dressing code registers).
 */

/**
 * Half-thickness of the walls a rectangular footprint is built from.
 *
 * Kept at 0.2 rather than something hair-thin for one measured reason:
 * `CollisionWorld.maxSafeStep` divides the *thinnest* collider in the whole
 * world into sub-steps for every mover in it, so a 5 cm hotel sofa would make
 * the park's collision loop run more sub-steps per frame for ever. 0.2 m is
 * already the park's own thinnest (the entrance's rope posts), so nothing here
 * lowers it. The half-extents are inset by exactly this, so the *effective*
 * footprint is still the visual one.
 */
const WALL_HALF_THICKNESS = 0.2;

/**
 * How far a solid footprint must stay clear of a doorway, on every side —
 * {@link PLAYER_RADIUS} itself, because the question a doorway clearance
 * check is answering is exactly "can her body still fit through here",
 * never a number the furniture layout invented for itself.
 */
const DOORWAY_CLEARANCE = PLAYER_RADIUS;

/**
 * A footprint to test against a room's doorways — the same two shapes
 * {@link PropPlan} offers (round or rectangular), in the room's own local
 * metres, matching {@link PropPlan.x}/{@link PropPlan.z}.
 */
export type FurnitureBounds =
  | { readonly x: number; readonly z: number; readonly radius: number }
  | { readonly x: number; readonly z: number; readonly halfX: number; readonly halfZ: number };

/**
 * **Does this footprint keep clear of every doorway in `doors`?**
 *
 * The general form of the rule issue #273 asked for, sitting beside CLAUDE.md's
 * "anything that looks solid must be solid" — aimed at the doorway instead of
 * the wall: a doorway a child can *see* has to be a doorway she can *use*, and
 * a sofa that merely looks like it fits beside a door is the same silent hole
 * as a wall with a gap in its collider. Pure geometry, with no idea what a
 * "room" or a "hotel" is: `doors` is expected to already carry its own
 * clearance margin (see {@link doorwayClearanceZones}), so any furniture
 * placer that can produce a room's doorway zones and a candidate footprint
 * calls this once — round or rectangular alike, a sofa today, a pet bed or a
 * resized bedroom's furniture tomorrow.
 */
export function isClearOfDoorways(
  bounds: FurnitureBounds,
  doors: readonly DoorwayZone[],
): boolean {
  return doors.every((door) => !overlapsDoorway(bounds, door));
}

function overlapsDoorway(bounds: FurnitureBounds, door: DoorwayZone): boolean {
  if ('radius' in bounds) {
    const nearestX = Math.max(door.minX, Math.min(bounds.x, door.maxX));
    const nearestZ = Math.max(door.minZ, Math.min(bounds.z, door.maxZ));
    return Math.hypot(bounds.x - nearestX, bounds.z - nearestZ) < bounds.radius;
  }
  return (
    bounds.x - bounds.halfX < door.maxX &&
    bounds.x + bounds.halfX > door.minX &&
    bounds.z - bounds.halfZ < door.maxZ &&
    bounds.z + bounds.halfZ > door.minZ
  );
}

/**
 * The axis-aligned box a `halfX`×`halfZ` rectangle actually sweeps once it is
 * turned by `spin` radians about its own centre — or the plain box back,
 * unrotated, when `spin` is absent or zero.
 *
 * A rotated rectangle's own AABB is the standard trig identity (each new
 * half-extent is the sum of the old two projected onto that axis): it is a
 * **superset** of the true rotated shape (a conservative box round a
 * diamond), which is exactly what a collider and a doorway check both want —
 * neither can leave a corner uncovered.
 *
 * Every caller in this file that builds a rectangular footprint routes
 * `halfX`/`halfZ` through this first (see {@link HotelProps.footprint}'s own
 * header for why it did not, once). A round footprint never needs it — a
 * circle looks the same from every angle — which is the whole reason this
 * bug stayed invisible until the day a *rectangular* prop finally got a
 * `spin` of its own.
 */
function effectiveHalfExtents(
  halfX: number,
  halfZ: number,
  spin: number | undefined,
): { halfX: number; halfZ: number } {
  if (!spin) return { halfX, halfZ };
  const c = Math.abs(Math.cos(spin));
  const s = Math.abs(Math.sin(spin));
  return { halfX: halfX * c + halfZ * s, halfZ: halfX * s + halfZ * c };
}

/**
 * A round prop's standing plate is this fraction of its collider radius, per
 * side — between the inscribed square (0.71, gaps at the compass points) and
 * the circumscribed one (1.0, floating corners). Slightly floaty corners on a
 * table read better than falling off a plate while visibly on the table.
 */
const ROUND_PLATE_FRACTION = 0.75;

/** A static walkable plate — a room floor, a mattress top, a sofa seat. */
export class Plate implements MovingPlatform {
  readonly surfaceY: number;
  private readonly minX: number;
  private readonly maxX: number;
  private readonly minZ: number;
  private readonly maxZ: number;

  constructor(
    surfaceY: number,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
  ) {
    this.surfaceY = surfaceY;
    this.minX = minX;
    this.maxX = maxX;
    this.minZ = minZ;
    this.maxZ = maxZ;
  }

  covers(x: number, z: number): boolean {
    return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ;
  }
}

/**
 * Somewhere in a room a strolling guest must not stand, in that room's own
 * local metres. Built as the furniture goes down — see {@link HotelProps}.
 *
 * Read by `HotelGuests`' waypoint sampler, which adds the guest's own body
 * radius on top: this is where the *furniture* is, not where a guest's centre
 * may not be.
 */
export interface RoomKeepOut {
  readonly room: HotelRoom;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/**
 * Where a prop goes and how much floor it takes up, in its room's own local
 * metres.
 *
 * Give **either** `radius` (round: a column, a plinth, a table, a chair) or
 * `halfX`/`halfZ` (a run of something: a counter, a desk, a sofa). A round
 * footprint is preferred wherever it is honest — it costs one collider instead
 * of four, it has no corners to catch on, and it is what most of this hotel
 * actually looks like from above.
 */
export interface PropPlan {
  readonly x: number;
  readonly z: number;
  /** Height off the floor for the *model* — purely visual (a centred mesh). */
  readonly y?: number;
  /** Yaw, radians. The footprint stays axis-aligned — see {@link place}. */
  readonly spin?: number;
  /** Round footprint: the radius a child's body meets. */
  readonly radius?: number;
  /** Rectangular footprint: half-extents before {@link spin}. */
  readonly halfX?: number;
  readonly halfZ?: number;
  /**
   * The prop's top, metres above its own base — **required**, because the
   * default that let a sofa be an infinitely tall pillar is exactly the bug
   * this file exists to prevent (see the header). For a standable prop this
   * is the surface her feet occupy (a sofa's seat, not its backrest); for
   * anything pointy it is the honest overall height, with {@link stand}
   * false.
   */
  readonly top: number;
  /**
   * Height of the floor this prop stands on — the mezzanine deck for the
   * gallery's furniture. Both the collider top and the standing plate are at
   * `base + top`; the jump-reachability test uses `top` alone, because she
   * jumps from the same floor the prop stands on.
   */
  readonly base?: number;
  /**
   * `false` for a prop whose top is real but is not a floor — crystals,
   * hedges, seaweed, a lamp-topped table. The collider keeps the honest
   * height; there is simply no plate to land on, so a jump that clears the
   * top slides off rather than standing in the foliage.
   */
  readonly stand?: false;
  /**
   * `false` for anything that is also a floor — see the header. Everything
   * else is solid, because that is the rule Jim asked for.
   */
  readonly solid?: boolean;
}

/**
 * The hotel's one placement helper. Built by `Hotel` in its constructor and
 * used by every `dress*` method; the finished keep-out list is then handed
 * whole to the guests.
 */
export class HotelProps {
  private readonly keepOuts: RoomKeepOut[] = [];

  private readonly collision: CollisionWorld;
  private readonly surfaces: WalkSurfaces;

  /**
   * Every solid footprint {@link footprint} found sitting in a doorway's
   * clearance zone, collected rather than thrown as it is found — so one
   * broken build reports every offending prop in one run instead of stopping
   * at the first, the same reason `assertStairMatches`'s `problems` array
   * exists. {@link assertDoorwaysClear} is the one place they turn into a
   * thrown error.
   */
  private readonly doorwayViolations: string[] = [];

  /** {@link doorwayClearanceZones} is pure, but a room's doorways never
   *  change mid-build — computed once per room the first time it is asked
   *  for, rather than once per prop placed in it. */
  private readonly doorwayZonesByRoom = new Map<HotelRoom, readonly DoorwayZone[]>();

  constructor(
    collision: CollisionWorld,
    surfaces: WalkSurfaces,
  ) {
    this.collision = collision;
    this.surfaces = surfaces;
  }

  /** The whole keep-out list, once the rooms are dressed. */
  get roomKeepOuts(): readonly RoomKeepOut[] {
    return this.keepOuts;
  }

  /**
   * Throws with every prop {@link footprint} found blocking a doorway,
   * named and located — call once, after every `dress*` method has run.
   * Nothing about this repo's philosophy is served by a placement rule that
   * is only checked when somebody remembers to; a rule with a hole in it
   * reads correctly, renders correctly, and is wrong only when a child tries
   * the door (CLAUDE.md, "anything that looks solid must be solid"), so this
   * is a hard failure rather than a console warning nobody reads.
   */
  assertDoorwaysClear(): void {
    if (this.doorwayViolations.length === 0) return;
    throw new Error(
      `${this.doorwayViolations.length} prop(s) block a doorway's clearance zone:\n` +
        this.doorwayViolations.map((line) => `  - ${line}`).join('\n'),
    );
  }

  /**
   * Stands one prop in a room: parents it, positions it, makes it solid, and
   * tells the guests to walk round it. The single call the header is about.
   *
   * `spin` turns the model, and — for a rectangular footprint — the
   * axis-aligned box {@link effectiveHalfExtents} conservatively bounds it in
   * too, so the collider, the doorway check and the keep-out all agree with
   * what a rotated model actually occupies. This used to be honest without
   * the extra step, on the theory that the only spun props were round
   * breakfast tables; it stopped being true the day the suite's lounge sofa
   * (`Hotel.dressSuite`) got a `spin` of its own to face both the telly and
   * the camera, and nothing here noticed — `isClearOfDoorways` kept measuring
   * the *unrotated* box, so the sofa's true, rotated silhouette could (and
   * did) reach further into a doorway than the check ever saw (18 Aug 2026,
   * alongside the `DOORWAY_THROUGH_DEPTH` fix in `layout.ts`).
   */
  place(shell: Group, room: HotelRoom, prop: Object3D, plan: PropPlan): void {
    prop.position.set(plan.x, plan.y ?? 0, plan.z);
    if (plan.spin !== undefined) prop.rotation.y = plan.spin;
    shell.add(prop);
    this.footprint(room, plan);
  }

  /**
   * The same registration without a model — for a footprint that belongs to
   * something built elsewhere.
   *
   * Two callers, both honest: an asset whose own factory positions it (the
   * lobby's RiPika, which arrives already stood on its plinth), and a patch of
   * floor that is nobody's prop but is still somewhere a guest must not be —
   * the spot a child stands on to check in. Not an escape hatch: it registers
   * exactly what {@link place} registers.
   */
  footprint(room: HotelRoom, plan: PropPlan): void {
    const worldX = room.originX + plan.x;
    const worldZ = room.originZ + plan.z;
    const solid = plan.solid ?? true;
    const worldTop = (plan.base ?? 0) + plan.top;

    if (solid) this.checkDoorwayClearance(room, plan);

    if (plan.radius !== undefined) {
      if (solid) {
        this.collision.addCircle(worldX, worldZ, plan.radius, worldTop, false, true);
        this.standable(plan, worldX, worldZ, plan.radius * ROUND_PLATE_FRACTION, plan.radius * ROUND_PLATE_FRACTION, worldTop);
      }
      this.keepOuts.push({ room, x: plan.x, z: plan.z, radius: plan.radius });
      return;
    }

    // {@link effectiveHalfExtents} — the box a rotated rectangle actually
    // occupies, or the plain box unrotated. Every consumer below (the
    // collider, the standing plate, the guest keep-out) uses this, not the
    // raw `plan.halfX`/`plan.halfZ`, so a `spin` can never make one of them
    // disagree with what the model visually covers.
    const { halfX, halfZ } = effectiveHalfExtents(
      plan.halfX ?? 0.5,
      plan.halfZ ?? 0.5,
      plan.spin,
    );
    if (solid) {
      // Inset by the wall's own half-thickness, so the four walls' outer faces
      // land on the visual edge rather than {@link WALL_HALF_THICKNESS} beyond
      // it. Floored well above zero so a shallow prop still makes a rectangle
      // rather than a degenerate one.
      this.collision.addRectangle(
        worldX,
        worldZ,
        Math.max(0.05, halfX - WALL_HALF_THICKNESS),
        Math.max(0.05, halfZ - WALL_HALF_THICKNESS),
        WALL_HALF_THICKNESS,
        worldTop,
        false,
        true,
      );
      this.standable(plan, worldX, worldZ, halfX, halfZ, worldTop);
    }
    this.coverWithDiscs(room, plan.x, plan.z, halfX, halfZ);
  }

  /**
   * Checks one solid footprint against its room's doorways and records a
   * violation rather than throwing — see {@link assertDoorwaysClear}.
   */
  private checkDoorwayClearance(room: HotelRoom, plan: PropPlan): void {
    let zones = this.doorwayZonesByRoom.get(room);
    if (!zones) {
      zones = doorwayClearanceZones(room, DOORWAY_CLEARANCE);
      this.doorwayZonesByRoom.set(room, zones);
    }
    const { halfX, halfZ } = effectiveHalfExtents(
      plan.halfX ?? 0.5,
      plan.halfZ ?? 0.5,
      plan.spin,
    );
    const bounds: FurnitureBounds =
      plan.radius !== undefined
        ? { x: plan.x, z: plan.z, radius: plan.radius }
        : { x: plan.x, z: plan.z, halfX, halfZ };
    if (!isClearOfDoorways(bounds, zones)) {
      this.doorwayViolations.push(
        `${room.space} prop at local (${plan.x}, ${plan.z}) — ` +
          (plan.radius !== undefined
            ? `radius ${plan.radius}`
            : `${halfX * 2}×${halfZ * 2} m footprint${plan.spin ? ' (rotated)' : ''}`),
      );
    }
  }

  /**
   * The standing plate on top of a mountable prop — the third consumer of the
   * one footprint (see the header). Nothing is added for a prop that opted
   * out (`stand: false`) or whose top the jump cannot reach from the floor it
   * shares with her; the threshold is the game's own {@link JUMP_APEX_HEIGHT}
   * rather than a number invented here.
   */
  private standable(
    plan: PropPlan,
    worldX: number,
    worldZ: number,
    halfX: number,
    halfZ: number,
    worldTop: number,
  ): void {
    if (plan.stand === false) return;
    if (plan.top > JUMP_APEX_HEIGHT) return;
    this.surfaces.addPlatform(
      new Plate(worldTop, worldX - halfX, worldX + halfX, worldZ - halfZ, worldZ + halfZ),
    );
  }

  /**
   * Reserves a patch of floor a guest must never stand on, with nothing built
   * there — a doorway's apron, the lift's mouth, the spot in front of
   * reception.
   *
   * Deliberately named for what it is rather than folded into
   * {@link footprint}: this is the one kind of keep-out that is *not* a prop,
   * so it is also the one kind that could go stale without anybody noticing,
   * and a reader should see that difference at the call site.
   */
  reserve(room: HotelRoom, x: number, z: number, radius: number): void {
    this.keepOuts.push({ room, x, z, radius });
  }

  /**
   * Covers a rectangle with a chain of keep-out discs along its longer axis.
   *
   * One disc round a fourteen-metre buffet would be a seven-metre hole in the
   * breakfast room; the point of a counter is that you walk *along* it. This
   * is that idea, derived from the footprint instead of the three discs
   * somebody used to type out beside it.
   */
  private coverWithDiscs(
    room: HotelRoom,
    x: number,
    z: number,
    halfX: number,
    halfZ: number,
  ): void {
    const alongX = halfX >= halfZ;
    const longHalf = alongX ? halfX : halfZ;
    const shortHalf = alongX ? halfZ : halfX;
    const count = Math.max(1, Math.ceil(longHalf / Math.max(shortHalf, 0.05)));
    const radius = longHalf / count;
    for (let i = 0; i < count; i += 1) {
      const offset = -longHalf + radius * (2 * i + 1);
      this.keepOuts.push({
        room,
        x: alongX ? x + offset : x,
        z: alongX ? z : z + offset,
        radius: Math.max(radius, shortHalf),
      });
    }
  }
}
