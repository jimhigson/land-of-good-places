import type { CollisionWorld, WallCollider } from '../Collision';
import type { WalkSurfaces } from '../building/surfaces';
import { Plate } from '../hotel/place';
import { JUMP_APEX_HEIGHT } from '../../entities/Player';
import { PLAYER_RADIUS } from '../../core/constants';
import { LIBRARY_ARRIVAL, libraryStandSpots, type LocalPoint } from './layout';

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
}

/**
 * How much clear floor a stand spot keeps round it: her own radius and a
 * hand's breadth more. The arrival and the doorway keep more — she arrives
 * mid-stride and the doorway is where everyone comes and goes.
 */
export const LIBRARY_STAND_KEEP_OUT = PLAYER_RADIUS + 0.28;
export const LIBRARY_ARRIVAL_KEEP_OUT = 1.4;
export const LIBRARY_DOORWAY_KEEP_OUT = 1.5;

/** Every spot she must be able to stand on, room-local, with the clear floor it keeps. */
export function libraryKeepOuts(): KeepOut[] {
  return libraryStandSpots().map((spot) => ({
    what: spot.what,
    x: spot.x,
    z: spot.z,
    radius:
      spot === LIBRARY_ARRIVAL ? LIBRARY_ARRIVAL_KEEP_OUT : spot.what === 'the doorway' ? LIBRARY_DOORWAY_KEEP_OUT : LIBRARY_STAND_KEEP_OUT,
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
 * The thin capsules across a box's two ends. 0.1, not thinner:
 * `CollisionWorld.maxSafeStep` sub-steps every mover by the thinnest collider
 * in the world, and the park's own thinnest is the entrance's 0.2 m rope
 * posts, so a 0.1 half-thickness costs nothing it does not already pay.
 */
const END_HALF = 0.1;

export class LibraryProps {
  readonly violations: string[] = [];
  readonly solids: LibrarySolid[] = [];

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
    if (top !== 'wall') this.standable(top, worldX - radius * 0.75, worldX + radius * 0.75, worldZ - radius * 0.75, worldZ + radius * 0.75, options);
    this.solids.push({ what, shape: 'disc', top, points: [{ x, z }], radius, handle });
  }

  /** A filled capsule between two room-local points, `half` its half-thickness. */
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
   * that height (the plate is the box's axis-aligned extent: right for the
   * room's boxes, which all stand square to the walls).
   */
  box(what: string, footprint: BoxFootprint, top: PropTop, options: PropOptions = {}): void {
    const yaw = (footprint.facing * Math.PI) / 180;
    // The box's length runs across its facing: `(cos, -sin)` is local +X.
    const ax = Math.cos(yaw);
    const az = -Math.sin(yaw);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const at = (along: number, out: number): LocalPoint => ({ x: footprint.x + ax * along + fx * out, z: footprint.z + az * along + fz * out });
    const { halfLength, halfDepth } = footprint;
    const spine = Math.max(0, halfLength - halfDepth);
    this.wall(`${what} (body)`, at(-spine, 0), at(spine, 0), halfDepth, top);
    const endAt = halfLength - END_HALF;
    const endAcross = Math.max(0, halfDepth - END_HALF);
    for (const side of [-1, 1]) {
      this.wall(`${what} (${side < 0 ? 'left' : 'right'} end)`, at(side * endAt, -endAcross), at(side * endAt, endAcross), END_HALF, top);
    }
    if (top !== 'wall') {
      const corners = [at(-halfLength, -halfDepth), at(halfLength, halfDepth)];
      const minX = Math.min(...corners.map((c) => c.x));
      const maxX = Math.max(...corners.map((c) => c.x));
      const minZ = Math.min(...corners.map((c) => c.z));
      const maxZ = Math.max(...corners.map((c) => c.z));
      this.standable(top, this.originX + minX, this.originX + maxX, this.originZ + minZ, this.originZ + maxZ, options);
    }
  }

  /**
   * A soft thing that is its own floor — a cushion: no collider, a plate she
   * steps up onto (well inside `BUILDING_STEP_UP`). The hotel beds' rule: an
   * absolute-top wall at its edge would catch her at the rim of something
   * meant to be walked and sat on.
   */
  soft(top: number, x: number, z: number, radius: number): void {
    const worldX = this.originX + x;
    const worldZ = this.originZ + z;
    const r = radius * 0.75;
    this.surfaces.addPlatform(new Plate(top, worldX - r, worldX + r, worldZ - r, worldZ + r));
  }

  /** Throws with every solid found inside a keep-out — call once, after everything is placed. */
  assertClear(): void {
    if (this.violations.length === 0) return;
    throw new Error(
      `${this.violations.length} Library solid(s) block a spot a child must be able to stand on:\n` +
        this.violations.map((line) => `  - ${line}`).join('\n'),
    );
  }

  private standable(top: number, minX: number, maxX: number, minZ: number, maxZ: number, options: PropOptions): void {
    if (options.stand === false) return;
    if (top > JUMP_APEX_HEIGHT) return;
    this.surfaces.addPlatform(new Plate(top, minX, maxX, minZ, maxZ));
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

/** XZ distance from `p` to the segment `a`-`b`. */
export function segmentDistance(a: LocalPoint, b: LocalPoint, p: LocalPoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length2 = dx * dx + dz * dz;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}
