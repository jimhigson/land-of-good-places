import { BoxGeometry, Group, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import type { CollisionWorld, WallCollider } from '../Collision';
import type { MovingPlatform, WalkSurfaces } from '../building/surfaces';
import { Plate } from '../hotel/place';
import { segmentsMinusGaps, cornerClosedSpans } from '../wallRuns';
import type { PortalBand } from '../tapSpacing';
import { placeOnSphere } from '../terrain';
import { interiorMaterial } from '../building/parts';
import { PALETTE } from '../../core/palette';
import { solid } from '../../art/style/materials';
import type { LibraryExteriorPlan } from '../../art/models/libraryAssets';
import {
  LIBRARY_DOOR_HALF,
  LIBRARY_DOOR_X,
  LIBRARY_EXIT_BAND_HALF_ALONG,
  LIBRARY_FLOOR_Y,
  LIBRARY_HALF_X,
  LIBRARY_HALF_Z,
  LIBRARY_ORIGIN_X,
  LIBRARY_ORIGIN_Z,
  LIBRARY_WALL_HALF,
  LIBRARY_WALL_HEIGHT,
  type LocalPoint,
} from './layout';

/**
 * **The Library's two shells** — the pillared building in the park, and the
 * reading room behind its door.
 *
 * The reading room is a hotel room in shape (`reptileHouse/shell.ts` is the
 * nearest copy): one floor `Plate`, four walls per `wallRuns.ts` minus the
 * south doorway, each solid span one box and one `addWall`, the south and
 * east walls hidden — not shortened — so the fixed camera looks in.
 *
 * The exterior is the new part. The building leans with the planet like
 * everything else outdoors, so **everything about it is asked in its own
 * frame** ({@link LibraryFrame}): a collider is the world plan of a
 * building-local point at its foot, and the plinth's walkable top is found by
 * solving for the world height that lands on it — the castle's
 * `castleSurfaceY`, because a plumb sum once left the castle's walkable steps
 * hanging 1.5 m over its stone ones on seed 5.
 */

// ---------------------------------------------------------------------------
// The exterior's frame
// ---------------------------------------------------------------------------

/**
 * **Where the building stands, and the one map between its own metres and the
 * world's.** Built from the plot's centre and the door's bearing with
 * `placeOnSphere` — the same transform `standInPlot` gives the drawn root, so
 * the colliders, the walkable plinth and the mesh are three readings of one
 * placement.
 */
export class LibraryFrame {
  /** The plot centre and the door's bearing (`Player.facing` radians: 0 looks along +Z). */
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  private readonly matrix = new Matrix4();
  private readonly inverse = new Matrix4();
  private readonly scratch = new Vector3();

  constructor(x: number, z: number, yaw: number, groundY: number) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    const position = new Vector3();
    const quaternion = new Quaternion();
    placeOnSphere({ x, y: groundY, z }, yaw, position, quaternion);
    this.matrix.compose(position, quaternion, new Vector3(1, 1, 1));
    this.inverse.copy(this.matrix).invert();
  }

  /** Building-local metres -> world. */
  toWorld(localX: number, localY: number, localZ: number, target = new Vector3()): Vector3 {
    return target.set(localX, localY, localZ).applyMatrix4(this.matrix);
  }

  /** World -> building-local metres. */
  toLocal(worldX: number, worldY: number, worldZ: number, target = new Vector3()): Vector3 {
    return target.set(worldX, worldY, worldZ).applyMatrix4(this.inverse);
  }

  /** The world plan point at the foot of a building-local (x, z) — where a collider goes. */
  foot(localX: number, localZ: number): { x: number; z: number } {
    const p = this.toWorld(localX, 0, localZ, this.scratch);
    return { x: p.x, z: p.z };
  }

  /**
   * **World `y` of a building-local surface over a world plan point**, or
   * `null` where it does not cover that column — `castleSurfaceY`'s Newton
   * on world `y`, then `covers` asked at the converged point.
   */
  surfaceY(x: number, z: number, heightAt: number, covers: (localX: number, localZ: number) => boolean): number | null {
    const upY = this.toWorld(0, 1, 0, new Vector3()).y - this.toWorld(0, 0, 0, this.scratch).y;
    let y = this.toWorld(0, heightAt, 0, this.scratch).y;
    for (let i = 0; i < 8; i += 1) {
      const local = this.toLocal(x, y, z, this.scratch);
      const step = (heightAt - local.y) / upY;
      y += step;
      if (Math.abs(step) < 1e-7) break;
    }
    const local = this.toLocal(x, y, z, this.scratch);
    return covers(local.x, local.z) ? y : null;
  }
}

/**
 * A walkable rectangle of the building — the portico's floor, the step — in
 * the building's own leaning frame.
 */
class FramePlate implements MovingPlatform {
  readonly surfaceY: number;
  private readonly frame: LibraryFrame;
  private readonly top: number;
  private readonly halfX: number;
  private readonly fromZ: number;
  private readonly toZ: number;

  constructor(frame: LibraryFrame, top: number, halfX: number, fromZ: number, toZ: number) {
    this.frame = frame;
    this.top = top;
    this.halfX = halfX;
    this.fromZ = fromZ;
    this.toZ = toZ;
    this.surfaceY = frame.toWorld(0, top, (fromZ + toZ) / 2).y;
    this.reach = Math.hypot(halfX, Math.max(Math.abs(fromZ), Math.abs(toZ))) + 1;
  }

  private readonly reach: number;

  private inside = (localX: number, localZ: number): boolean => Math.abs(localX) <= this.halfX && localZ >= this.fromZ && localZ <= this.toZ;

  covers(x: number, z: number): boolean {
    // Every walker in the park samples every platform every frame: a plan
    // reject before the Newton solve, generous enough that the lean (well under
    // a metre across a 12 m building) can never reject a point that is on it.
    if (Math.hypot(x - this.frame.x, z - this.frame.z) > this.reach) return false;
    return this.frame.surfaceY(x, z, this.top, this.inside) !== null;
  }

  surfaceYAt(x: number, z: number): number {
    return this.frame.surfaceY(x, z, this.top, this.inside) ?? this.surfaceY;
  }
}

/**
 * **The plinth's top and the step, walkable.** Not colliders: a 0.18 m riser
 * with a `topIsAbsolute` collider is a wall to feet on the floor (`clearsTop`
 * forgives 0.15 m, not 0.18), so the steps are surfaces she walks up, each
 * riser well inside `BUILDING_STEP_UP`. The portico's floor runs from the
 * recess's back wall to the lower step; the cella's own walls keep her off
 * the rest of it.
 */
export function registerLibrarySteps(surfaces: WalkSurfaces, frame: LibraryFrame, plan: LibraryExteriorPlan): void {
  surfaces.addPlatform(new FramePlate(frame, plan.plinthTop, plan.plinthHalfX, plan.recessBackZ, plan.stepBackZ));
  surfaces.addPlatform(new FramePlate(frame, plan.stepTop, plan.plinthHalfX, plan.stepBackZ, plan.stepFrontZ));
}

/** The half-thickness of the exterior's own walls' colliders. */
const SHELL_HALF = 0.3;

/**
 * **The exterior's collision: a closed ring with one hole in it**, built from
 * the measured mesh. The cella's back and side walls, the front wall either
 * side of the doorway, the doorway's two jambs (their inner faces on the drawn
 * opening) and the recess's back wall that a sprinting child stops on while
 * the iris closes. Everything inside the ring but the recess is sealed, so
 * nobody can be in it; the recess is three walls round a doorway she walks
 * into and back out of. Then the six columns, each its drawn base.
 *
 * Returned in registration order, the ring's walls first, so a check can take
 * one out by index and watch the facade clause go red.
 */
export function registerLibraryShellCollision(collision: CollisionWorld, frame: LibraryFrame, plan: LibraryExteriorPlan): {
  readonly walls: WallCollider[];
  readonly columns: number[];
} {
  const walls: WallCollider[] = [];
  const wall = (x1: number, z1: number, x2: number, z2: number, half: number): void => {
    const a = frame.foot(x1, z1);
    const b = frame.foot(x2, z2);
    walls.push(collision.addWall(a.x, a.z, b.x, b.z, half));
  };
  const sideX = plan.cellaHalfX - SHELL_HALF;
  const backZ = plan.cellaBackZ + SHELL_HALF;
  // The front wall's collider runs from the wall's back face out to the drawn
  // front of the door frame, so the outer face is the drawn one.
  const frontHalf = (plan.cellaFrontZ - plan.frontWallBackZ) / 2;
  const frontZ = plan.frontWallBackZ + frontHalf;
  const jambX = plan.doorHalf + SHELL_HALF;
  const recessHalf = 0.35;
  const recessZ = plan.recessBackZ - recessHalf;

  wall(-sideX, backZ, sideX, backZ, SHELL_HALF);
  wall(-sideX, backZ, -sideX, frontZ, SHELL_HALF);
  wall(sideX, backZ, sideX, frontZ, SHELL_HALF);
  wall(-sideX, frontZ, -jambX, frontZ, frontHalf);
  wall(jambX, frontZ, sideX, frontZ, frontHalf);
  wall(-jambX, plan.recessBackZ, -jambX, frontZ, SHELL_HALF);
  wall(jambX, plan.recessBackZ, jambX, frontZ, SHELL_HALF);
  wall(-jambX, recessZ, jambX, recessZ, recessHalf);

  const columns = plan.columns.map((column) => {
    const at = frame.foot(column.x, column.z);
    return collision.addCircle(at.x, at.z, column.radius);
  });
  return { walls, columns };
}

/** The front door's walk-through band, from the recess's back wall out past the door's front. World metres. */
export function libraryEntryBand(frame: LibraryFrame, plan: LibraryExteriorPlan): PortalBand {
  const inner = plan.recessBackZ + 0.35;
  const outer = plan.cellaFrontZ + 0.2;
  const centre = frame.foot(0, (inner + outer) / 2);
  return {
    what: "the Library's front door",
    centreX: centre.x,
    centreZ: centre.z,
    halfAlong: (outer - inner) / 2,
    halfAcross: plan.doorHalf,
    yaw: frame.yaw,
    y: frame.toWorld(0, plan.plinthTop, 0).y,
    ownZoneId: 'library-entrance',
  };
}

// ---------------------------------------------------------------------------
// The reading room's shell
// ---------------------------------------------------------------------------

/** The south doorway's clear gap along X, room-local. */
export function libraryDoorGap(): readonly [number, number] {
  return [LIBRARY_DOOR_X - LIBRARY_DOOR_HALF, LIBRARY_DOOR_X + LIBRARY_DOOR_HALF];
}

/** The exit band on the south wall — crossing it is leaving. World metres. */
export function libraryExitBand(): PortalBand {
  return {
    what: "the Library's way out",
    centreX: LIBRARY_ORIGIN_X + LIBRARY_DOOR_X,
    centreZ: LIBRARY_ORIGIN_Z + LIBRARY_HALF_Z,
    halfAlong: LIBRARY_EXIT_BAND_HALF_ALONG,
    halfAcross: LIBRARY_DOOR_HALF + 0.3,
    yaw: 0,
    y: LIBRARY_FLOOR_Y,
  };
}

/**
 * The reading room's floor plate and walls, in `root` (which stands at the
 * room's origin), registered with the collision world in world metres.
 * Returns the wall colliders, for a check to open one deliberately.
 */
export function buildReadingRoomShell(root: Group, collision: CollisionWorld, surfaces: WalkSurfaces): WallCollider[] {
  const originX = LIBRARY_ORIGIN_X;
  const originZ = LIBRARY_ORIGIN_Z;

  // The floor: warm boards under the dim light, one slab with a little apron
  // past the walls so the doorway's threshold has floor under it.
  const floor = solid(
    new Mesh(new BoxGeometry(LIBRARY_HALF_X * 2 + 1.2, 0.5, LIBRARY_HALF_Z * 2 + 1.2), interiorMaterial(PALETTE.wood, 0.72)),
  );
  floor.position.set(0, -0.25, 0);
  floor.name = 'library.floor';
  root.add(floor);
  surfaces.addPlatform(
    new Plate(
      LIBRARY_FLOOR_Y,
      originX - LIBRARY_HALF_X - 0.6,
      originX + LIBRARY_HALF_X + 0.6,
      originZ - LIBRARY_HALF_Z - 0.6,
      originZ + LIBRARY_HALF_Z + 0.6,
    ),
  );

  // The walls: the classic reading-room green.
  const sides = [
    { side: 'north', x1: -LIBRARY_HALF_X, z1: -LIBRARY_HALF_Z, x2: LIBRARY_HALF_X, z2: -LIBRARY_HALF_Z, hidden: false },
    { side: 'south', x1: -LIBRARY_HALF_X, z1: LIBRARY_HALF_Z, x2: LIBRARY_HALF_X, z2: LIBRARY_HALF_Z, hidden: true },
    { side: 'west', x1: -LIBRARY_HALF_X, z1: -LIBRARY_HALF_Z, x2: -LIBRARY_HALF_X, z2: LIBRARY_HALF_Z, hidden: false },
    { side: 'east', x1: LIBRARY_HALF_X, z1: -LIBRARY_HALF_Z, x2: LIBRARY_HALF_X, z2: LIBRARY_HALF_Z, hidden: true },
  ] as const;
  const material = interiorMaterial(PALETTE.buildingTrimDeep, 0.7);
  const walls: WallCollider[] = [];
  for (const { side, x1, z1, x2, z2, hidden } of sides) {
    const along = side === 'north' || side === 'south' ? 'x' : 'z';
    const from = along === 'x' ? x1 : z1;
    const to = along === 'x' ? x2 : z2;
    const gaps: (readonly [number, number])[] = side === 'south' ? [libraryDoorGap()] : [];
    const spans = segmentsMinusGaps(from, to, gaps);
    // North and south take the corners; east and west stop short of them by
    // the wall's depth, so no two boxes share a corner column (the reptile
    // hall's rule, which `check:coplanar` taught it).
    const drawn =
      along === 'x'
        ? cornerClosedSpans(spans, from, to, LIBRARY_WALL_HALF)
        : spans.map(([a, b]): [number, number] => [a <= from + 1e-6 ? a + LIBRARY_WALL_HALF : a, b >= to - 1e-6 ? b - LIBRARY_WALL_HALF : b]);
    for (const [index, [a, b]] of spans.entries()) {
      if (b - a < 0.05) continue;
      const [drawnA, drawnB] = drawn[index] ?? [a, b];
      const length = drawnB - drawnA;
      const mid = (drawnA + drawnB) / 2;
      const box = solid(
        new Mesh(
          along === 'x'
            ? new BoxGeometry(length, LIBRARY_WALL_HEIGHT, LIBRARY_WALL_HALF * 2)
            : new BoxGeometry(LIBRARY_WALL_HALF * 2, LIBRARY_WALL_HEIGHT, length),
          material,
        ),
      );
      box.name = `library.wall.${side}`;
      box.position.set(along === 'x' ? mid : x1, LIBRARY_WALL_HEIGHT / 2, along === 'x' ? z1 : mid);
      // Hidden, not shortened: the collider below is the same either way.
      if (hidden) box.visible = false;
      root.add(box);
      walls.push(
        collision.addWall(
          originX + (along === 'x' ? a : x1),
          originZ + (along === 'x' ? z1 : a),
          originX + (along === 'x' ? b : x1),
          originZ + (along === 'x' ? z1 : b),
          LIBRARY_WALL_HALF,
        ),
      );
    }
  }
  return walls;
}

/** Room-local -> world plan. */
export function roomToWorld(point: LocalPoint): { x: number; z: number } {
  return { x: LIBRARY_ORIGIN_X + point.x, z: LIBRARY_ORIGIN_Z + point.z };
}
