import type { Group, Object3D } from 'three';
import type { CollisionWorld } from '../Collision';
import type { MovingPlatform, WalkSurfaces } from '../building/surfaces';
import { JUMP_APEX_HEIGHT } from '../../entities/Player';
import type { HotelRoom } from './layout';

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
 * A round prop's standing plate is this fraction of its collider radius, per
 * side — between the inscribed square (0.71, gaps at the compass points) and
 * the circumscribed one (1.0, floating corners). Slightly floaty corners on a
 * table read better than falling off a plate while visibly on the table.
 */
const ROUND_PLATE_FRACTION = 0.75;

/** A static walkable plate — a room floor, a mattress top, a sofa seat. */
export class Plate implements MovingPlatform {
  constructor(
    readonly surfaceY: number,
    private readonly minX: number,
    private readonly maxX: number,
    private readonly minZ: number,
    private readonly maxZ: number,
  ) {}

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

  constructor(
    private readonly collision: CollisionWorld,
    private readonly surfaces: WalkSurfaces,
  ) {}

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
    const worldTop = (plan.base ?? 0) + plan.top;

    if (plan.radius !== undefined) {
      if (solid) {
        this.collision.addCircle(worldX, worldZ, plan.radius, worldTop, false, true);
        this.standable(plan, worldX, worldZ, plan.radius * ROUND_PLATE_FRACTION, plan.radius * ROUND_PLATE_FRACTION, worldTop);
      }
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
        worldTop,
        false,
        true,
      );
      this.standable(plan, worldX, worldZ, halfX, halfZ, worldTop);
    }
    this.coverWithDiscs(room, plan.x, plan.z, halfX, halfZ);
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
