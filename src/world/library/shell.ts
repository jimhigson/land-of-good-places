import { BoxGeometry, Group, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import type { CollisionWorld, WallCollider } from '../Collision';
import type { MovingPlatform, WalkSurfaces } from '../building/surfaces';
import { Plate } from '../hotel/place';
import { segmentsMinusGaps, cornerClosedSpans } from '../wallRuns';
import type { PortalBand } from '../tapSpacing';
import { placeOnSphere } from '../terrain';
import { PALETTE } from '../../core/palette';
import { solid, toonMaterial } from '../../art/style/materials';
import { LIBRARY_INTERIOR_LIFT } from './lighting';
import { END_HALF } from './props';
import {
  LIBRARY_DOOR_HALF,
  LIBRARY_DOOR_X,
  LIBRARY_ENTRY_BAND_INNER_INSET,
  LIBRARY_ENTRY_BAND_OUTER_REACH,
  LIBRARY_EXIT_BAND_HALF_ALONG,
  LIBRARY_FLOOR_Y,
  LIBRARY_HALF_X,
  LIBRARY_HALF_Z,
  LIBRARY_ORIGIN_X,
  LIBRARY_ORIGIN_Z,
  LIBRARY_WALL_HALF,
  LIBRARY_WALL_HEIGHT,
  type LibraryExteriorPlan,
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

  /**
   * The tangent of the building's lean — how far a vertical world line drifts
   * across the building's own floor per metre it climbs. Zero at the park's
   * middle, ~0.4 out by the boundary.
   */
  leanTangent(): number {
    const up = this.toWorld(0, 1, 0, new Vector3()).sub(this.toWorld(0, 0, 0, this.scratch));
    return Math.hypot(up.x, up.z) / up.y;
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
 * **The plinth's top and the bottom step, walkable** — the whole plinth, the
 * top step included (its tread is the plinth's own height), and the bottom
 * step in front of it. Not colliders: a 0.18 m riser with a `topIsAbsolute`
 * collider is a wall to feet on the floor (`clearsTop` forgives 0.15 m, not
 * 0.18), so the steps are surfaces she walks up, each riser well inside
 * `BUILDING_STEP_UP`. The cella's ring and the plinth's own edges keep her to
 * the portico and the steps.
 *
 * **The bottom step runs on in under the plinth.** Each plate asks whether it
 * covers a world column at its own height, and the building leans: a vertical
 * line meets the step's top and the plinth's top at local z values
 * `(plinthTop − stepTop) · tan(lean)` apart, so two plates that only meet at
 * the riser leave a sliver of ground under one lean and none under the other
 * (seed 1's library dropped a walker 0.34 m into the stone through 1.4 cm of
 * it). Overlapped by more than that sliver, the higher plate wins wherever it
 * covers (`WalkSurfaces.sample` takes the highest surface within a step) and
 * no column is left uncovered at any lean.
 */
export function registerLibrarySteps(surfaces: WalkSurfaces, frame: LibraryFrame, plan: LibraryExteriorPlan): void {
  const sliver = (plan.plinthTop - plan.stepTop) * frame.leanTangent();
  surfaces.addPlatform(new FramePlate(frame, plan.plinthTop, plan.plinthHalfX, plan.plinthBackZ, plan.stepBackZ));
  surfaces.addPlatform(new FramePlate(frame, plan.stepTop, plan.plinthHalfX, plan.stepBackZ - sliver - STEP_UNDERLAP_MARGIN, plan.stepFrontZ));
}

/** How much further than the lean's sliver the bottom step runs on under the plinth. */
const STEP_UNDERLAP_MARGIN = 0.05;

/** The half-thickness of the cella's ring colliders. */
const SHELL_HALF = 0.3;
/**
 * The half-thickness of the thin capsules that square the ring's corners and
 * trace the plinth's edges — `props.ts`'s `END_HALF`, the park's own thinnest
 * collider's figure, so nothing here makes every mover sub-step finer.
 */
const EDGE_HALF = END_HALF;

/** What the exterior registered, in order — so a check can take one out and watch a clause go red. */
export interface LibraryShellSolids {
  /** The cella's ring: back, west, east, front west, front east, west jamb, east jamb, recess back. */
  readonly walls: readonly WallCollider[];
  /** The thin capsules squaring the ring's six outside corners (two each). */
  readonly corners: readonly WallCollider[];
  /** The plinth's own edges: east, back, west. */
  readonly edges: readonly WallCollider[];
  /** The six columns' feet. */
  readonly columns: readonly number[];
}

/**
 * **The exterior's collision**, every collider built from the measured shell
 * (`libraryKit.ts`'s plan):
 *
 * - **The cella: a closed ring with one hole in it.** The masonry's whole
 *   drawn extent — the side and front window sills stand proud of the wall
 *   faces at a child's chest, so the ring holds them too — as eight fat
 *   capsules whose outer faces are the drawn faces, the doorway's two jambs on
 *   its drawn opening and the recess's back wall on the door leaves' front
 *   (where a sprinting child stops while the iris closes). Everything inside
 *   the ring but the recess is sealed, so nobody can be in it; the recess is
 *   three walls round a doorway she walks into and back out of.
 * - **Its outside corners squared.** Capsules whose ends meet at a corner
 *   round it off by `half · (√2 − 1)` — 12 cm of drawn stone she could lean
 *   into at the back corners. A thin capsule along each face's last stretch,
 *   its outer face on the drawn face, leaves `EDGE_HALF · (√2 − 1)` (4 cm).
 * - **The six columns**, each its drawn round foot — the widest a column is
 *   anywhere a child can reach.
 * - **The plinth's sides and back.** The portico's open sides and the ledge
 *   round the cella stand 0.36 m of stone over ground the planet curves away
 *   from (and the waves rise and fall under), so a riser there can be more
 *   than she can step up — and the plate does not lift her past
 *   `BUILDING_STEP_UP`, so without a collider she walked on into the slab.
 *   A thin wall on each drawn edge, back corner to front step, keeps her to
 *   the full-width steps: the one way up, the way the paths arrive.
 */
export function registerLibraryShellCollision(collision: CollisionWorld, frame: LibraryFrame, plan: LibraryExteriorPlan): LibraryShellSolids {
  const add = (list: WallCollider[], x1: number, z1: number, x2: number, z2: number, half: number): void => {
    const a = frame.foot(x1, z1);
    const b = frame.foot(x2, z2);
    list.push(collision.addWall(a.x, a.z, b.x, b.z, half));
  };
  const H = SHELL_HALF;
  const t = EDGE_HALF;
  const cx = plan.cellaHalfX;
  const bz = plan.cellaBackZ;
  const fz = plan.cellaFrontZ;
  const dh = plan.doorHalf;
  const rz = plan.recessBackZ;

  const walls: WallCollider[] = [];
  add(walls, -cx + H, bz + H, cx - H, bz + H, H);
  add(walls, -cx + H, bz + H, -cx + H, fz - H, H);
  add(walls, cx - H, bz + H, cx - H, fz - H, H);
  add(walls, -cx + H, fz - H, -dh - H, fz - H, H);
  add(walls, dh + H, fz - H, cx - H, fz - H, H);
  add(walls, -dh - H, rz, -dh - H, fz - H, H);
  add(walls, dh + H, rz, dh + H, fz - H, H);
  add(walls, -dh - H, rz - H, dh + H, rz - H, H);

  // The outside corners: each drawn corner (x, z) with the directions its two
  // faces run back along, into the masonry.
  const corners: WallCollider[] = [];
  const outside: readonly (readonly [number, number, number, number])[] = [
    [-cx, bz, 1, 1],
    [cx, bz, -1, 1],
    [-cx, fz, 1, -1],
    [cx, fz, -1, -1],
    // The doorway's mouth: the wings' corners either side of the recess.
    [-dh, fz, -1, -1],
    [dh, fz, 1, -1],
  ];
  for (const [x, z, inX, inZ] of outside) {
    const ix = x + inX * t;
    const iz = z + inZ * t;
    add(corners, ix, iz, ix + inX * H, iz, t);
    add(corners, ix, iz, ix, iz + inZ * H, t);
  }

  const edges: WallCollider[] = [];
  const px = plan.plinthHalfX - t;
  add(edges, px, plan.stepFrontZ - t, px, plan.plinthBackZ + t, t);
  add(edges, px, plan.plinthBackZ + t, -px, plan.plinthBackZ + t, t);
  add(edges, -px, plan.plinthBackZ + t, -px, plan.stepFrontZ - t, t);

  const columns = plan.columns.map((column) => {
    const at = frame.foot(column.x, column.z);
    return collision.addCircle(at.x, at.z, column.radius);
  });
  return { walls, corners, edges, columns };
}

/**
 * The front door's walk-through band, from just out of the door leaves to past
 * the cella's front (`layout.ts`'s offsets on the measured doorway). World metres.
 */
export function libraryEntryBand(frame: LibraryFrame, plan: LibraryExteriorPlan): PortalBand {
  const inner = plan.recessBackZ + LIBRARY_ENTRY_BAND_INNER_INSET;
  const outer = plan.cellaFrontZ + LIBRARY_ENTRY_BAND_OUTER_REACH;
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
    new Mesh(new BoxGeometry(LIBRARY_HALF_X * 2 + 1.2, 0.5, LIBRARY_HALF_Z * 2 + 1.2), roomMaterial(PALETTE.wood)),
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
  const material = roomMaterial(PALETTE.buildingTrimDeep);
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

/**
 * The reading room's own fabric — floor and walls: toon-shaded like every
 * interior, with the room's own small lift (`lighting.ts`'s
 * `LIBRARY_INTERIOR_LIFT`) so the lamps, not the paint, light it.
 */
function roomMaterial(colour: number) {
  return toonMaterial(colour, { emissive: colour, emissiveIntensity: LIBRARY_INTERIOR_LIFT });
}

/** Room-local -> world plan. */
export function roomToWorld(point: LocalPoint): { x: number; z: number } {
  return { x: LIBRARY_ORIGIN_X + point.x, z: LIBRARY_ORIGIN_Z + point.z };
}
