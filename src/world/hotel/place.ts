import type { Group, Object3D } from 'three';
import type { CollisionWorld } from '../Collision';
import type { HotelRoom } from './layout';

/**
 * **Putting a thing in a hotel room is one call, and that call decides both
 * whether you can walk through it and whether a guest may stand there.**
 *
 * Jim, having played it: *"the statues and chairs you can clip through are
 * weird."* The bug behind that was not a missing collider on a chair — it was
 * that a hotel prop was put down by *two* unrelated statements. One added a
 * model to the room; a second, optional, hand-written one told the guests to
 * keep away from it. Nothing at all registered it as solid, and nothing could
 * have noticed: the two facts were never the same fact.
 *
 * So every prop in this hotel now goes through {@link HotelProps.place}, which
 * takes **one** footprint and hands it to **two** consumers:
 *
 * 1. the shared {@link CollisionWorld}, so a child meets the statue rather
 *    than walking through it;
 * 2. the guest keep-out list, so nobody strolls into it either.
 *
 * They cannot disagree, because there is nothing to disagree *with*: forget to
 * describe a prop's footprint and it is invisible to both, which is a failure
 * a six-year-old finds in one visit rather than one that hides in a table of
 * numbers. This is CLAUDE.md's "one owner; everyone else asks", applied to the
 * thing that file names as the repo's most common bug.
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
 * **Anything you can stand on is placed soft.** The suite's beds are
 * `WalkSurfaces` platforms — Eleri's "sleep, or go jumpy jumpy!" — and
 * `Collision`'s height rule (`clearsTop`) is fed `Player.hopClearance`, which
 * is height above *the sampler's* ground. A child stood on a mattress is
 * therefore at clearance 0, so a wall round the bed's edge would shove her
 * straight back off it. A prop that is its own floor does not get a second
 * opinion about where its edges are: `solid: false`, and it keeps only its
 * keep-out.
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
  /** Height off the floor, for anything standing on something else. */
  readonly y?: number;
  /** Yaw, radians. The footprint stays axis-aligned — see {@link place}. */
  readonly spin?: number;
  /** Round footprint: the radius a child's body meets. */
  readonly radius?: number;
  /** Rectangular footprint: half-extents before {@link spin}. */
  readonly halfX?: number;
  readonly halfZ?: number;
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

  constructor(private readonly collision: CollisionWorld) {}

  /** The whole keep-out list, once the rooms are dressed. */
  get roomKeepOuts(): readonly RoomKeepOut[] {
    return this.keepOuts;
  }

  /**
   * Stands one prop in a room: parents it, positions it, makes it solid, and
   * tells the guests to walk round it. The single call the header is about.
   *
   * `spin` turns the model but **not** the footprint, which stays
   * axis-aligned. That is honest for everything in this hotel today — the
   * spun props are the breakfast tables, and a table is round — and a rotated
   * rectangle is a fifth shape for `CollisionWorld` to learn for one prop that
   * does not exist.
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

    if (plan.radius !== undefined) {
      if (solid) this.collision.addCircle(worldX, worldZ, plan.radius);
      this.keepOuts.push({ room, x: plan.x, z: plan.z, radius: plan.radius });
      return;
    }

    const halfX = plan.halfX ?? 0.5;
    const halfZ = plan.halfZ ?? 0.5;
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
      );
    }
    this.coverWithDiscs(room, plan.x, plan.z, halfX, halfZ);
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
