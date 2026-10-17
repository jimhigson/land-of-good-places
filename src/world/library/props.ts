import type { BoxCollider, CollisionWorld, WallCollider } from '../Collision';
import { BUILDING_STEP_UP } from '../../core/constants';
import { LIBRARY_ARRIVAL, LIBRARY_STAND_KEEP_OUT, libraryStandSpots, type LocalPoint } from './layout';

/**
 * **Putting a thing in the Library is one call, and that call decides whether
 * a child can walk through it, whether she may stand there, and whether a
 * jump can land on it** — `hotel/place.ts`'s rule, by way of the Reptile
 * House's `props.ts`. Every solid here is a disc, a capsule or a box, filled,
 * so nothing has an inside to be stuck in. A box — a bookcase, the desk, an
 * armchair — is {@link LibraryProps.box}: one filled box turned with the
 * model, crisp-cornered on its drawn footprint (`CollisionWorld.addBox`). It
 * used to be a capsule down its length and two thin ones across its ends, solid
 * to within a few centimetres of its drawn corners; the corners are solid now,
 * and so is the top over them.
 *
 * **A solid's top is where a jump lands, and nothing else says so.** There
 * used to be a walkable plate laid on every top a jump could reach, a
 * `stand: false` to leave one off a lamp, and a "soft" cushion that was a
 * plate with no body at all. All three are gone (Jim, 17 Oct 2026: *"anything
 * should be jumpable with no special 'floor' being marked to make it so"*):
 * every numeric top is the top of a solid, and `world/standing.ts` puts her
 * feet on it if her jump reaches it — a reading lamp's shade included, which
 * is physics rather than a decision made here.
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

/**
 * A solid's top: an absolute height (room floor 0) feet below meet and feet
 * above clear. Always a real height — the `'wall'` (to-the-ceiling) option went
 * with Jim's ruling of 17 Oct 2026 that nothing drawn has a flag for a top.
 */
export type PropTop = number;

/** A registered solid, room-local, with the collision world's handle — so a check can remove it and go red. */
export interface LibrarySolid {
  readonly what: string;
  readonly shape: 'disc' | 'wall' | 'box';
  readonly top: PropTop;
  readonly points: readonly LocalPoint[];
  readonly radius: number;
  readonly handle: number | WallCollider | BoxCollider;
}

/**
 * A solid's top and the drawn footprint it covers, room-local, as it was
 * registered — so a check can land on every one of them and see it hold her.
 * Not a floor: a record of a solid's shape, made by the same call that
 * registered the solid.
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
 * **A box's collider**, as {@link LibraryProps.box} registers it — handed back
 * so a box that must come and go (the secret shelf's closed and open sets,
 * #719) can be taken out and put back whole with {@link LibraryProps.detach}
 * and {@link LibraryProps.attach}.
 */
export type BoxWalls = readonly [body: BoxCollider];

/**
 * The half-thickness of the room's thinnest walls — the plinth's traced edges
 * (`shell.ts`). It was the thin capsule across each end of a box, before a box
 * was one filled solid. 0.1, not thinner: `CollisionWorld.maxSafeStep`
 * sub-steps every mover by the thinnest collider in the world, and this is
 * already that thinnest, so it costs nothing it does not already pay.
 */
export const END_HALF = 0.1;

export class LibraryProps {
  readonly violations: string[] = [];
  readonly solids: LibrarySolid[] = [];
  readonly standables: LibraryStandable[] = [];

  private readonly collision: CollisionWorld;
  private readonly originX: number;
  private readonly originZ: number;
  private readonly keepOuts: readonly KeepOut[];

  constructor(collision: CollisionWorld, originX: number, originZ: number) {
    this.collision = collision;
    this.originX = originX;
    this.originZ = originZ;
    this.keepOuts = libraryKeepOuts();
  }

  /** A solid disc, room-local — a lamp, a side table, a cushion. */
  disc(what: string, x: number, z: number, radius: number, top: PropTop): void {
    this.checkKeepOuts(what, [{ x, z }], radius, top);
    const worldX = this.originX + x;
    const worldZ = this.originZ + z;
    const handle = this.collision.addCircle(worldX, worldZ, radius, top, false, true);
    this.standables.push({ what, top, footprint: { x, z, radius } });
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
    this.checkKeepOuts(what, [a, b], half, top);
    const handle = this.collision.addWall(this.originX + a.x, this.originZ + a.z, this.originX + b.x, this.originZ + b.z, half, top, false, true);
    this.solids.push({ what, shape: 'wall', top, points: [a, b], radius: half, handle });
    return handle;
  }

  /**
   * **A filled box**, turned with its model and crisp-cornered on its drawn
   * footprint — one `CollisionWorld` box (`addBox`), so the face she meets is
   * the face she sees right into the corners. Its top is where a jump onto it
   * lands: the seat of a chair, the desk's writing surface, the top of a
   * bookcase.
   *
   * Returns the box's collider ({@link BoxWalls}), so a box that must come and
   * go can be {@link detach}ed and {@link attach}ed whole.
   */
  box(what: string, footprint: BoxFootprint, top: PropTop): BoxWalls {
    const yaw = (footprint.facing * Math.PI) / 180;
    // The box's length runs across its facing: `(cos, -sin)` is local +X, so
    // the collider's own yaw (local +X onto `(cos θ, sin θ)`) is `-yaw`.
    const { halfLength, halfDepth } = footprint;
    const corners: LocalPoint[] = [];
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      corners.push({
        x: footprint.x + Math.cos(yaw) * sx * halfLength + Math.sin(yaw) * sz * halfDepth,
        z: footprint.z - Math.sin(yaw) * sx * halfLength + Math.cos(yaw) * sz * halfDepth,
      });
    }
    this.checkBoxKeepOuts(what, footprint, top);
    const worldX = this.originX + footprint.x;
    const worldZ = this.originZ + footprint.z;
    const handle = this.collision.addBox(worldX, worldZ, halfLength, halfDepth, -yaw, 0, top, false, true);
    this.standables.push({ what, top, footprint });
    this.solids.push({ what, shape: 'box', top, points: corners, radius: 0, handle });
    return [handle];
  }

  /**
   * **Takes these colliders out of the collision world** (`removeWall` on
   * each) — the owl's capsule as she takes off (#718), the secret shelf's open
   * set at construction and its closed set as it lands open (#719). They stay
   * in {@link solids} under their names, and their keep-out test was passed
   * when they were placed, so {@link attach} can put them back without
   * re-asking either.
   *
   * Its top goes with it: a solid's top is only somewhere to land while the
   * solid is there.
   */
  detach(solids: readonly (WallCollider | BoxCollider)[]): void {
    for (const solid of solids) {
      if ('halfX' in solid) this.collision.removeBox(solid);
      else this.collision.removeWall(solid);
    }
  }

  /**
   * **Puts colliders {@link detach} took out back** (`restoreWall` on each):
   * the same objects, owner tag and all, so a check that names a solid still
   * holds the live collider. Idempotent — one already present is left alone.
   */
  attach(solids: readonly (WallCollider | BoxCollider)[]): void {
    for (const solid of solids) {
      if ('halfX' in solid) this.collision.restoreBox(solid);
      else this.collision.restoreWall(solid);
    }
  }

  /** Throws with every solid found inside a keep-out — call once, after everything is placed. */
  assertClear(): void {
    if (this.violations.length === 0) return;
    throw new Error(
      `${this.violations.length} Library solid(s) block a spot a child must be able to stand on:\n` +
        this.violations.map((line) => `  - ${line}`).join('\n'),
    );
  }

  /**
   * Records every keep-out a solid comes into. **A solid she steps onto takes
   * no spot away**: a top within one step of the floor (`BUILDING_STEP_UP`,
   * the cushions on the story rug) is somewhere she stands, on top, exactly as
   * a deck of that height would be — so only a solid taller than a step can
   * block a spot she must be able to stand on.
   */
  /** {@link checkKeepOuts} for a turned box: how far each keep-out's centre is outside the drawn box. */
  private checkBoxKeepOuts(what: string, footprint: BoxFootprint, top: PropTop): void {
    if (top <= BUILDING_STEP_UP) return;
    const yaw = (footprint.facing * Math.PI) / 180;
    for (const keepOut of this.keepOuts) {
      const dx = keepOut.x - footprint.x;
      const dz = keepOut.z - footprint.z;
      const along = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const out = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      const ox = Math.max(Math.abs(along) - footprint.halfLength, 0);
      const oz = Math.max(Math.abs(out) - footprint.halfDepth, 0);
      const clearance = Math.hypot(ox, oz) - keepOut.radius;
      if (clearance < 0) {
        this.violations.push(`${what} comes ${(-clearance).toFixed(2)} m into ${keepOut.what} at (${keepOut.x}, ${keepOut.z}) r ${keepOut.radius.toFixed(2)}`);
      }
    }
  }

  private checkKeepOuts(what: string, points: readonly LocalPoint[], radius: number, top: PropTop): void {
    if (top <= BUILDING_STEP_UP) return;
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
