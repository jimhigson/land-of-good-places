import type { CollisionWorld, WallCollider } from '../Collision';
import type { WalkSurfaces } from '../building/surfaces';
import { Plate } from '../hotel/place';
import { JUMP_APEX_HEIGHT } from '../../entities/Player';
import {
  EXHIBIT_PLACEMENTS,
  HIDDEN_BABY_SPOTS,
  METER_STAND,
  PATHS,
  REPTILE_ARRIVAL_KEEP_OUT,
  REPTILE_ARRIVAL_X,
  REPTILE_ARRIVAL_Z,
  REPTILE_DOOR_X,
  REPTILE_DOORWAY_KEEP_OUT,
  REPTILE_HALF_Z,
  REPTILE_STAND_KEEP_OUT,
  STALL_STAND,
  type LocalPoint,
} from './layout';

/**
 * **Putting a thing in the Reptile House is one call, and that call decides
 * whether a child can walk through it, whether she may stand there, and
 * whether a jump can land on it** — `hotel/place.ts`'s rule, carried over
 * with the one change the spec makes: **no rectangles**. A `CollisionWorld`
 * rectangle is four walls round a hollow middle a mover is never pushed out
 * of (CLAUDE.md); a wall is a *filled* capsule and a circle a filled disc, so
 * every solid here is one {@link ReptileProps.disc} or one
 * {@link ReptileProps.wall}, and nothing has an inside to be stuck in.
 *
 * ## The keep-outs are the other half
 *
 * {@link reptileKeepOuts} is the single owner of where a child has to be able
 * to stand — the arrival, the doorway, every exhibit's stand spot, the stall's,
 * the meter's, the three hidden-baby spots, every node of the `PATHS` graph.
 * Every placement is asserted clear of all of them as it goes down, and
 * {@link ReptileProps.assertClear} throws once at the end with every violation
 * named, exactly as `HotelProps.assertDoorwaysClear` does — a collider that
 * walls off a stand spot is a hard build failure, not something a six-year-old
 * finds by walking up to a glass case and bouncing off thin air.
 */
export interface KeepOut {
  readonly what: string;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** Every spot she must be able to stand on, hall-local. */
export function reptileKeepOuts(): KeepOut[] {
  const out: KeepOut[] = [
    { what: 'the arrival', x: REPTILE_ARRIVAL_X, z: REPTILE_ARRIVAL_Z, radius: REPTILE_ARRIVAL_KEEP_OUT },
    { what: 'the doorway', x: REPTILE_DOOR_X, z: REPTILE_HALF_Z - 1, radius: REPTILE_DOORWAY_KEEP_OUT },
    { what: 'the stall stand', x: STALL_STAND.x, z: STALL_STAND.z, radius: REPTILE_STAND_KEEP_OUT },
    { what: 'the meter stand', x: METER_STAND.x, z: METER_STAND.z, radius: REPTILE_STAND_KEEP_OUT },
  ];
  for (const exhibit of EXHIBIT_PLACEMENTS) {
    out.push({ what: `${exhibit.id}'s stand`, x: exhibit.stand.x, z: exhibit.stand.z, radius: REPTILE_STAND_KEEP_OUT });
  }
  HIDDEN_BABY_SPOTS.forEach((spot, index) => {
    out.push({ what: `hidden baby ${index + 1}'s stand`, x: spot.x, z: spot.z, radius: REPTILE_STAND_KEEP_OUT });
  });
  for (const path of PATHS) {
    for (const point of path.points) {
      out.push({ what: `path '${path.id}' node (${point.x}, ${point.z})`, x: point.x, z: point.z, radius: REPTILE_STAND_KEEP_OUT });
    }
  }
  return out;
}

/** A solid's top: a world height feet below it meet and feet above it clear, or `'wall'` for always solid. */
export type PropTop = number | 'wall';

export interface PropOptions {
  /** `false` for a top a jump can clear that is nonetheless not a floor (foliage). */
  readonly stand?: false;
}

export class ReptileProps {
  readonly violations: string[] = [];
  /**
   * Every registered solid, local, for the checks to walk — with the
   * collision world's own handle, so a check can take one out deliberately
   * and watch itself go red.
   */
  readonly solids: {
    what: string;
    shape: 'disc' | 'wall';
    top: PropTop;
    points: LocalPoint[];
    radius: number;
    handle: number | WallCollider;
  }[] = [];

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
    this.keepOuts = reptileKeepOuts();
  }

  /** A solid disc, hall-local. `top` absolute, or `'wall'`. */
  disc(what: string, x: number, z: number, radius: number, top: PropTop, options: PropOptions = {}): void {
    this.checkKeepOuts(what, [{ x, z }], radius);
    const worldX = this.originX + x;
    const worldZ = this.originZ + z;
    let handle: number;
    if (top === 'wall') {
      handle = this.collision.addCircle(worldX, worldZ, radius);
    } else {
      handle = this.collision.addCircle(worldX, worldZ, radius, top, false, true);
      this.standable(top, worldX - radius * 0.75, worldX + radius * 0.75, worldZ - radius * 0.75, worldZ + radius * 0.75, options);
    }
    this.solids.push({ what, shape: 'disc', top, points: [{ x, z }], radius, handle });
  }

  /** A filled capsule between two hall-local points. `half` is the half-thickness. */
  wall(what: string, a: LocalPoint, b: LocalPoint, half: number, top: PropTop, options: PropOptions = {}): void {
    this.checkKeepOuts(what, [a, b], half);
    const ax = this.originX + a.x;
    const az = this.originZ + a.z;
    const bx = this.originX + b.x;
    const bz = this.originZ + b.z;
    let handle: WallCollider;
    if (top === 'wall') {
      handle = this.collision.addWall(ax, az, bx, bz, half);
    } else {
      handle = this.collision.addWall(ax, az, bx, bz, half, top, false, true);
      // The plate is the capsule's axis-aligned box — right for the axis-aligned
      // logs this building has, conservative otherwise.
      this.standable(
        top,
        Math.min(ax, bx) - half,
        Math.max(ax, bx) + half,
        Math.min(az, bz) - half,
        Math.max(az, bz) + half,
        options,
      );
    }
    this.solids.push({ what, shape: 'wall', top, points: [a, b], radius: half, handle });
  }

  /** Throws with every solid found inside a keep-out — call once, after everything is placed. */
  assertClear(): void {
    if (this.violations.length === 0) return;
    throw new Error(
      `${this.violations.length} Reptile House solid(s) block a spot a child must be able to stand on:\n` +
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
      const distance = points.length === 1 ? Math.hypot(keepOut.x - points[0]!.x, keepOut.z - points[0]!.z) : segmentDistance(points[0]!, points[1]!, keepOut);
      const clearance = distance - radius - keepOut.radius;
      if (clearance < 0) {
        this.violations.push(
          `${what} comes ${(-clearance).toFixed(2)} m into ${keepOut.what} at (${keepOut.x}, ${keepOut.z}) r ${keepOut.radius}`,
        );
      }
    }
  }
}

/** XZ distance from `p` to the segment `a`–`b`. */
export function segmentDistance(a: LocalPoint, b: LocalPoint, p: LocalPoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length2 = dx * dx + dz * dz;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}
