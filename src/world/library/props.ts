import type { CollisionWorld, WallCollider } from '../Collision';
import type { MovingPlatform, WalkSurfaces } from '../building/surfaces';
import { Plate } from '../hotel/place';
import { JUMP_APEX_HEIGHT } from '../../entities/Player';
import { LIBRARY_ARRIVAL, LIBRARY_STAND_KEEP_OUT, libraryStandSpots, type LocalPoint } from './layout';

/**
 * **Putting a thing in the Library is one call, and that call decides whether
 * a child can walk through it, whether she may stand there, and whether a
 * jump can land on it** — `hotel/place.ts`'s rule, by way of the Reptile
 * House's `props.ts`, whose one change this keeps: **no rectangles.** A
 * `CollisionWorld` rectangle is four walls round a hollow middle a mover is
 * never pushed out of (CLAUDE.md); a wall is a *filled* capsule and a circle a
 * filled disc, so every solid here is discs and capsules, and nothing has an
 * inside to be stuck in. A box — a bookcase, the desk, an armchair — is
 * {@link LibraryProps.box}: one capsule down its length and two thin ones
 * across its ends, so it is solid to within a few centimetres of its drawn
 * corners rather than rounded off a third of a metre short of them.
 *
 * ## The keep-outs are the other half
 *
 * {@link libraryKeepOuts} is the single owner of where a child has to be able
 * to stand — the arrival, the doorway, the desk's front, the librarian's spot,
 * the story rug, every seat's front, the secret shelf, the twelve readable
 * books' stands and every aisle node — read from `layout.ts`'s
 * `libraryStandSpots`. Every placement is asserted clear of all of them as it
 * goes down, and {@link LibraryProps.assertClear} throws once at the end with
 * every violation named: a collider that walls off a stand spot is a hard
 * build failure, not something a six-year-old finds by walking up to a shelf
 * and bouncing off thin air.
 */
export interface KeepOut {
  readonly what: string;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  /**
   * **A spot inside the secret den** (#719), copied from its `layout.ts`
   * `StandSpot`'s own tag. Its floor is kept clear like any other, but
   * she reaches it only through the swung-open secret shelf: while the shelf
   * is shut it must be *unreachable* (the den is the one intended pocket),
   * and while it is open, reachable and leavable. Omitted everywhere else.
   */
  readonly den?: true;
}

/**
 * How much clear floor a stand spot keeps round it: `layout.ts`'s
 * {@link LIBRARY_STAND_KEEP_OUT} (her radius and a hand's breadth). The
 * arrival and the doorway keep more — she arrives mid-stride and the doorway
 * is where everyone comes and goes.
 */
export { LIBRARY_STAND_KEEP_OUT };
export const LIBRARY_ARRIVAL_KEEP_OUT = 1.4;
export const LIBRARY_DOORWAY_KEEP_OUT = 1.5;

/**
 * Every spot she must be able to stand on, room-local, with the clear floor it
 * keeps — and, for a spot in the secret den, its `den` tag, so a check can
 * hold the den's floor to the shelf's state without a second list of it.
 */
export function libraryKeepOuts(): KeepOut[] {
  return libraryStandSpots().map((spot) => ({
    what: spot.what,
    x: spot.x,
    z: spot.z,
    radius:
      spot === LIBRARY_ARRIVAL ? LIBRARY_ARRIVAL_KEEP_OUT : spot.what === 'the doorway' ? LIBRARY_DOORWAY_KEEP_OUT : LIBRARY_STAND_KEEP_OUT,
    ...(spot.den ? { den: true as const } : {}),
  }));
}

/** A solid's top: an absolute height (room floor 0) feet below meet and feet above clear, or `'wall'`. */
export type PropTop = number | 'wall';

export interface PropOptions {
  /** `false` for a top a jump can clear that is not a floor — a lamp, a table with a lamp on it. */
  readonly stand?: false;
}

/** A registered solid, room-local, with the collision world's handle — so a check can remove it and go red. */
export interface LibrarySolid {
  readonly what: string;
  readonly shape: 'disc' | 'wall';
  readonly top: PropTop;
  readonly points: readonly LocalPoint[];
  readonly radius: number;
  readonly handle: number | WallCollider;
}

/**
 * A top she can stand on, room-local, as it was registered — so a check can
 * drop a jump onto every one of them and see it hold her.
 */
export interface LibraryStandable {
  readonly what: string;
  /** The surface's height above the room's floor. */
  readonly top: number;
  /** The drawn footprint the plate covers: a turned box, or a disc. */
  readonly footprint: BoxFootprint | { readonly x: number; readonly z: number; readonly radius: number };
}

/** A box's footprint, room-local: centre, half-length along its yaw, half-depth across it. */
export interface BoxFootprint {
  readonly x: number;
  readonly z: number;
  /** `Player.facing` degrees the box's front faces; its length runs across that. */
  readonly facing: number;
  readonly halfLength: number;
  readonly halfDepth: number;
}

/**
 * **A box's three colliders**, in the order {@link LibraryProps.box}
 * registers them: the capsule down its length, then the thin capsules across
 * its left and right ends. Handed back so a box that must come and go — the
 * secret shelf's closed and open sets (#719) — can be taken out and put back
 * whole with {@link LibraryProps.detach} and {@link LibraryProps.attach}.
 */
export type BoxWalls = readonly [body: WallCollider, leftEnd: WallCollider, rightEnd: WallCollider];

/**
 * The thin capsules across a box's two ends. 0.1, not thinner:
 * `CollisionWorld.maxSafeStep` sub-steps every mover by the thinnest collider
 * in the world, and the park's own thinnest is the entrance's 0.2 m rope
 * posts, so a 0.1 half-thickness costs nothing it does not already pay.
 */
export const END_HALF = 0.1;

/**
 * How much of a round thing's radius its square plate covers: the square
 * inscribed in the disc is `1/√2` of it, and a little under that keeps every
 * corner of the plate on the drawn top — never a corner of air.
 */
const SOFT_PLATE_FRACTION = 0.7;

export class LibraryProps {
  readonly violations: string[] = [];
  readonly solids: LibrarySolid[] = [];
  readonly standables: LibraryStandable[] = [];

  private readonly collision: CollisionWorld;
  private readonly surfaces: WalkSurfaces;
  private readonly originX: number;
  private readonly originZ: number;
  private readonly keepOuts: readonly KeepOut[];

  constructor(collision: CollisionWorld, surfaces: WalkSurfaces, originX: number, originZ: number) {
    this.collision = collision;
    this.surfaces = surfaces;
    this.originX = originX;
    this.originZ = originZ;
    this.keepOuts = libraryKeepOuts();
  }

  /** A solid disc, room-local. */
  disc(what: string, x: number, z: number, radius: number, top: PropTop, options: PropOptions = {}): void {
    this.checkKeepOuts(what, [{ x, z }], radius);
    const worldX = this.originX + x;
    const worldZ = this.originZ + z;
    const handle =
      top === 'wall'
        ? this.collision.addCircle(worldX, worldZ, radius)
        : this.collision.addCircle(worldX, worldZ, radius, top, false, true);
    if (top !== 'wall' && options.stand !== false && top <= JUMP_APEX_HEIGHT) {
      // The square inside the disc, so no corner of the plate is air.
      const r = radius * SOFT_PLATE_FRACTION;
      this.surfaces.addPlatform(new Plate(top, worldX - r, worldX + r, worldZ - r, worldZ + r));
      this.standables.push({ what, top, footprint: { x, z, radius: r } });
    }
    this.solids.push({ what, shape: 'disc', top, points: [{ x, z }], radius, handle });
  }

  /**
   * A filled capsule between two room-local points, `half` its half-thickness.
   *
   * **With `a` and `b` the same point it is a zero-length capsule: a filled
   * disc of radius `half`** — how a round solid that must come and go is
   * registered (the owl at her desk, #718: taken out while she flies, put
   * back as she lands). A disc from {@link disc} cannot be put back, because
   * `CollisionWorld` restores only walls; a wall comes back as the same
   * object ({@link attach}). Every query reads a zero-length wall as the disc
   * it is — the mover, the planner and the route lattice alike
   * (`WallCollider`'s doc in `Collision.ts`) — and so does the keep-out test
   * here (`segmentDistance` of a zero-length segment is the distance to its
   * one point).
   */
  wall(what: string, a: LocalPoint, b: LocalPoint, half: number, top: PropTop): WallCollider {
    this.checkKeepOuts(what, [a, b], half);
    const handle =
      top === 'wall'
        ? this.collision.addWall(this.originX + a.x, this.originZ + a.z, this.originX + b.x, this.originZ + b.z, half)
        : this.collision.addWall(this.originX + a.x, this.originZ + a.z, this.originX + b.x, this.originZ + b.z, half, top, false, true);
    this.solids.push({ what, shape: 'wall', top, points: [a, b], radius: half, handle });
    return handle;
  }

  /**
   * **A filled box** — one capsule down its length, inset by its own half-depth
   * so its round ends land on the drawn ends, and a thin capsule across each
   * end to square them off. With a top a jump can reach, a walkable plate at
   * that height **turned with the box** ({@link OrientedPlate}): two of the
   * room's chairs stand at 45 degrees, and an axis-aligned `Plate` built from
   * two of a turned box's corners is a strip through its middle (a 1.4 m chair
   * got a 10 cm plate that way, and a child who jumped onto it fell through
   * her own seat), while one built from all four is a square of air round it
   * she could stand on beside the chair. The turned plate is the drawn seat.
   *
   * Returns the box's three colliders ({@link BoxWalls}), so a box that must
   * come and go can be {@link detach}ed and {@link attach}ed whole.
   */
  box(what: string, footprint: BoxFootprint, top: PropTop, options: PropOptions = {}): BoxWalls {
    const yaw = (footprint.facing * Math.PI) / 180;
    // The box's length runs across its facing: `(cos, -sin)` is local +X.
    const ax = Math.cos(yaw);
    const az = -Math.sin(yaw);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const at = (along: number, out: number): LocalPoint => ({ x: footprint.x + ax * along + fx * out, z: footprint.z + az * along + fz * out });
    const { halfLength, halfDepth } = footprint;
    const spine = Math.max(0, halfLength - halfDepth);
    const body = this.wall(`${what} (body)`, at(-spine, 0), at(spine, 0), halfDepth, top);
    const endAt = halfLength - END_HALF;
    const endAcross = Math.max(0, halfDepth - END_HALF);
    const end = (side: -1 | 1): WallCollider =>
      this.wall(`${what} (${side < 0 ? 'left' : 'right'} end)`, at(side * endAt, -endAcross), at(side * endAt, endAcross), END_HALF, top);
    const leftEnd = end(-1);
    const rightEnd = end(1);
    if (top !== 'wall' && options.stand !== false && top <= JUMP_APEX_HEIGHT) {
      this.surfaces.addPlatform(
        new OrientedPlate(top, this.originX + footprint.x, this.originZ + footprint.z, footprint.facing, halfLength, halfDepth),
      );
      this.standables.push({ what, top, footprint });
    }
    return [body, leftEnd, rightEnd];
  }

  /**
   * **Takes these colliders out of the collision world** (`removeWall` on
   * each) — the owl's capsule as she takes off (#718), the secret shelf's open
   * set at construction and its closed set as it lands open (#719). They stay
   * in {@link solids} under their names, and their keep-out test was passed
   * when they were placed, so {@link attach} can put them back without
   * re-asking either.
   *
   * Colliders only: a walkable plate a box laid stays where it is. Nothing
   * that is toggled has one (a wall case's top and the owl are out of a
   * jump's reach), and a box that does must not be toggled this way.
   */
  detach(walls: readonly WallCollider[]): void {
    for (const wall of walls) this.collision.removeWall(wall);
  }

  /**
   * **Puts colliders {@link detach} took out back** (`restoreWall` on each):
   * the same objects, owner tag and all, so a check that names a solid still
   * holds the live collider. Idempotent — one already present is left alone.
   */
  attach(walls: readonly WallCollider[]): void {
    for (const wall of walls) this.collision.restoreWall(wall);
  }

  /**
   * A soft thing that is its own floor — a cushion: no collider, a plate she
   * steps up onto (well inside `BUILDING_STEP_UP`). The hotel beds' rule: an
   * absolute-top wall at its edge would catch her at the rim of something
   * meant to be walked and sat on.
   */
  soft(what: string, top: number, x: number, z: number, radius: number): void {
    const worldX = this.originX + x;
    const worldZ = this.originZ + z;
    const r = radius * SOFT_PLATE_FRACTION;
    this.surfaces.addPlatform(new Plate(top, worldX - r, worldX + r, worldZ - r, worldZ + r));
    this.standables.push({ what, top, footprint: { x, z, radius: r } });
  }

  /** Throws with every solid found inside a keep-out — call once, after everything is placed. */
  assertClear(): void {
    if (this.violations.length === 0) return;
    throw new Error(
      `${this.violations.length} Library solid(s) block a spot a child must be able to stand on:\n` +
        this.violations.map((line) => `  - ${line}`).join('\n'),
    );
  }

  private checkKeepOuts(what: string, points: readonly LocalPoint[], radius: number): void {
    for (const keepOut of this.keepOuts) {
      const distance =
        points.length === 1 ? Math.hypot(keepOut.x - points[0]!.x, keepOut.z - points[0]!.z) : segmentDistance(points[0]!, points[1]!, keepOut);
      const clearance = distance - radius - keepOut.radius;
      if (clearance < 0) {
        this.violations.push(`${what} comes ${(-clearance).toFixed(2)} m into ${keepOut.what} at (${keepOut.x}, ${keepOut.z}) r ${keepOut.radius.toFixed(2)}`);
      }
    }
  }
}

/**
 * **A walkable top turned with its box** — the box's own footprint, in the
 * box's own frame, so a chair at 45 degrees is stood on exactly where it is
 * drawn: not through a strip of it, and not on a square of air beside it.
 * World metres; `facing` is the box's front, `Player.facing` degrees, its
 * length running across that (`LibraryProps.box`'s frame).
 */
export class OrientedPlate implements MovingPlatform {
  readonly surfaceY: number;
  private readonly x: number;
  private readonly z: number;
  private readonly cos: number;
  private readonly sin: number;
  private readonly halfLength: number;
  private readonly halfDepth: number;

  constructor(surfaceY: number, x: number, z: number, facing: number, halfLength: number, halfDepth: number) {
    this.surfaceY = surfaceY;
    this.x = x;
    this.z = z;
    const yaw = (facing * Math.PI) / 180;
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
    this.halfLength = halfLength;
    this.halfDepth = halfDepth;
  }

  covers(x: number, z: number): boolean {
    const dx = x - this.x;
    const dz = z - this.z;
    // Along the box's length is (cos, -sin); out of its front is (sin, cos).
    const along = dx * this.cos - dz * this.sin;
    const out = dx * this.sin + dz * this.cos;
    return Math.abs(along) <= this.halfLength && Math.abs(out) <= this.halfDepth;
  }
}

/** XZ distance from `p` to the segment `a`-`b`. */
export function segmentDistance(a: LocalPoint, b: LocalPoint, p: LocalPoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length2 = dx * dx + dz * dz;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}
