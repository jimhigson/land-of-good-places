import { BoxGeometry, Group, Matrix4, Mesh, Quaternion, Vector3, type MeshToonMaterial } from 'three';
import { JUMP_CLEARANCE_GRACE, type CollisionWorld, type WallCollider } from '../Collision';
import type { MovingPlatform, WalkSurfaces } from '../building/surfaces';
import { Plate } from '../hotel/place';
import { segmentsMinusGaps, cornerClosedSpans } from '../wallRuns';
import type { PortalBand } from '../tapSpacing';
import { placeOnSphere, planetRadiusAt, yAtRadius } from '../terrain';
import { PALETTE } from '../../core/palette';
import { solid, toonMaterial } from '../../art/style/materials';
import { libraryBookcaseSize } from '../../art/models/libraryAssets';
import { LIBRARY_INTERIOR_LIFT } from './lighting';
import { END_HALF, type LibraryProps } from './props';
import { libraryTopOver } from '../../art/models/libraryKit';
import {
  LIBRARY_DEN_DOOR_HALF,
  LIBRARY_DEN_INNER,
  LIBRARY_DOOR_HALF,
  LIBRARY_DOOR_X,
  LIBRARY_ENTRY_BAND_INNER_INSET,
  LIBRARY_ENTRY_BAND_OUTER_REACH,
  LIBRARY_EXIT_BAND_HALF_ALONG,
  LIBRARY_FLOOR_Y,
  LIBRARY_HALF_X,
  LIBRARY_HALF_Z,
  LIBRARY_INNER_X,
  LIBRARY_ORIGIN_X,
  LIBRARY_ORIGIN_Z,
  LIBRARY_SECRET_BOOKCASE,
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
   * **A building-local height as a solid's real top, in world column
   * `(x, z)`** — the drawn point's own radius from the planet's centre, read
   * back in the collider's column, so a solid's top is where the leaning
   * stone's is.
   */
  topY(x: number, z: number, localX: number, localZ: number, height: number): number {
    const p = this.toWorld(localX, height, localZ, this.scratch);
    return yAtRadius(x, z, planetRadiusAt(p.x, p.y, p.z));
  }

  /**
   * **World `y` of a building-local surface over a world plan point**, or
   * `null` where it does not cover that column — `castleSurfaceY`'s Newton
   * on world `y`, then `covers` asked at the converged point.
   */
  surfaceY(x: number, z: number, heightAt: number, covers: (localX: number, localZ: number) => boolean): number | null {
    // flat-ok: WalkSurfaces asks a world y over a world (x, z), so the Newton step runs along the world column by the sampler's own contract (castleSurfaceY's)
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
 *   A thin wall on each drawn edge, back corner to front step, to the stone's
 *   own top: a step where the riser is one, a side to bump or jump where it
 *   is not. Nothing marks it otherwise (PR #722).
 */
export function registerLibraryShellCollision(collision: CollisionWorld, frame: LibraryFrame, plan: LibraryExteriorPlan): LibraryShellSolids {
  // Every solid to its real top, in the building's own leaning frame
  // (`LibraryFrame.topY`): the cella and its corners to the building's height,
  // the plinth's edges to the plinth's top — a step where its riser is one,
  // a side to bump where the ground falls away under it.
  // A top at each end, so a long edge's top runs with the drawn stone rather
  // than drifting off it along the sphere (`TopSlope`).
  const add = (list: WallCollider[], x1: number, z1: number, x2: number, z2: number, half: number, height = plan.height): void => {
    const a = frame.foot(x1, z1);
    const b = frame.foot(x2, z2);
    const topA = frame.topY(a.x, a.z, x1, z1, height);
    const topB = frame.topY(b.x, b.z, x2, z2, height);
    // An edge stands wholly on the stone (its outer face on the drawn edge)
    // and to the stone's own top where it runs (`edgeRun`): a top to stand on
    // like the plate beside it, and a riser to step up where it is a step
    // high — nothing marks it otherwise (PR #722). Run at the plinth's height
    // past the steps, it once stood her 0.18 m over the bottom tread.
    const edge = height !== plan.height;
    list.push(collision.kinded(edge ? 'library plinth edge' : 'library walls', () => collision.addWall(a.x, a.z, b.x, b.z, half, topA, false, true, -Infinity, false, Number.NaN, topB)));
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
  // In pieces no longer than `EDGE_PIECE`: a top runs straight between its
  // two ends, and the drawn stone is flat in the building's frame, which on
  // the sphere bows under that straight line — by L²/8R, 0.16 m along the
  // 17 m back edge, where she stood over the drawn plinth (seeds 2, 3, 7, 9, 13
  // and 14). Two metres is under 3 mm.
  const addPieces = (x1: number, z1: number, x2: number, z2: number, height: number): void => {
    const pieces = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / EDGE_PIECE));
    for (let i = 0; i < pieces; i += 1) {
      const u0 = i / pieces;
      const u1 = (i + 1) / pieces;
      add(edges, x1 + (x2 - x1) * u0, z1 + (z2 - z1) * u0, x1 + (x2 - x1) * u1, z1 + (z2 - z1) * u1, t, height);
    }
  };
  // Each side, back to front, in runs of one drawn height: the plinth, then
  // each tread of the steps down to the path (`edgeRun`).
  for (const x of [px, -px]) {
    for (const run of edgeRuns(x, plan.plinthBackZ + t, plan.stepFrontZ - t)) addPieces(x, run.fromZ, x, run.toZ, run.top);
  }
  addPieces(px, plan.plinthBackZ + t, -px, plan.plinthBackZ + t, plan.plinthTop);

  const columns = plan.columns.map((column) => {
    const at = frame.foot(column.x, column.z);
    const top = frame.topY(at.x, at.z, column.x, column.z, plan.height);
    return collision.kinded('library column', () => collision.addCircle(at.x, at.z, column.radius, top, false, true));
  });
  return { walls, corners, edges, columns };
}

/** How finely a plinth edge is walked to find where the drawn stone steps down. */
const EDGE_RUN_STEP = 0.02;
/** The longest piece a plinth edge is built of, so its straight top stays on the drawn stone (see `registerLibraryShellCollision`). */
const EDGE_PIECE = 2;

/**
 * **A plinth edge in runs of one drawn height** — along `x` from `fromZ` to
 * `toZ`, the stone's own top under it (`libraryTopOver`, a ray down the kit),
 * split at each riser: the plinth's top, then each tread of the steps.
 */
function edgeRuns(x: number, fromZ: number, toZ: number): { readonly fromZ: number; readonly toZ: number; readonly top: number }[] {
  const runs: { fromZ: number; toZ: number; top: number }[] = [];
  const count = Math.max(1, Math.ceil((toZ - fromZ) / EDGE_RUN_STEP));
  for (let i = 0; i <= count; i += 1) {
    const z = fromZ + ((toZ - fromZ) * i) / count;
    const top = libraryTopOver(['shell-plinth', 'shell-steps'], x, z);
    if (top === null) continue;
    const last = runs[runs.length - 1];
    if (last && Math.abs(last.top - top) < 0.005) last.toZ = z;
    else {
      // A riser: split halfway between the two heights' samples.
      if (last) last.toZ = (last.toZ + z) / 2;
      runs.push({ fromZ: last ? last.toZ : z, toZ: z, top });
    }
  }
  return runs.filter((run) => run.toZ - run.fromZ > 1e-3);
}

/** The library roof's strips: about this wide across the cella, and this long front to back, so each top lies on the roof's slope. */
const ROOF_STRIP = 1;
const ROOF_PIECE = 2;

/**
 * **The roof the park sees is somewhere to stand.**
 *
 * The cella's walls seal its inside, and once they stood to `Infinity`; with
 * real tops (17 Oct 2026) the jet pack flies over them — 9.5 m against its
 * 12 m — and the roof over the cella had no solid, so she fell through the
 * slates into a room walled in on every side. Strips across the cella, inside
 * its walls' inner faces, each banded from the walls' top to the roof drawn
 * over it (`libraryTopOver`, a ray down the kit's own geometry), one height
 * at each end of a piece: the attic between the walls and the roof is solid,
 * so the room under it is sealed from above, and she stands on the slates.
 * Banded, so no route lattice stamps them, and the door's recess keeps its
 * air: the strips start at the walls' top, nine metres over its floor.
 */
export function registerLibraryRoofCollision(collision: CollisionWorld, frame: LibraryFrame, plan: LibraryExteriorPlan): void {
  const H = SHELL_HALF;
  const minX = -plan.cellaHalfX + 2 * H;
  const maxX = plan.cellaHalfX - 2 * H;
  const minZ = plan.cellaBackZ + 2 * H;
  const maxZ = plan.cellaFrontZ - 2 * H;
  const strips = Math.max(1, Math.round((maxX - minX) / ROOF_STRIP));
  const half = (maxX - minX) / strips / 2;
  // A capsule's round ends inside the walls' inner faces.
  const z0 = minZ + half;
  const z1 = maxZ - half;
  const pieces = Math.max(1, Math.round((z1 - z0) / ROOF_PIECE));
  const roofOver = (x: number, z: number): number => Math.max(plan.height, libraryTopOver(['shell-roof'], x, z) ?? plan.height);
  collision.kinded('library roof', () => {
    for (let i = 0; i < strips; i += 1) {
      const x = minX + (2 * i + 1) * half;
      for (let k = 0; k < pieces; k += 1) {
        const za = z0 + ((z1 - z0) * k) / pieces;
        const zb = z0 + ((z1 - z0) * (k + 1)) / pieces;
        const a = frame.foot(x, za);
        const b = frame.foot(x, zb);
        const topA = frame.topY(a.x, a.z, x, za, roofOver(x, za));
        const topB = frame.topY(b.x, b.z, x, zb, roofOver(x, zb));
        const base = Math.min(frame.topY(a.x, a.z, x, za, plan.height), frame.topY(b.x, b.z, x, zb, plan.height));
        collision.addWall(a.x, a.z, b.x, b.z, half, topA, false, true, base, false, Number.NaN, topB);
      }
    }
  });
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
 * How far the reading room's floor slab runs on past each wall's centre line:
 * the wall's whole thickness, so the doorway's threshold has floor under it
 * and the slab's edge is the wall's outer face. The den's floor (#719) abuts
 * that edge, so the two slabs meet at a line and share no face.
 */
const FLOOR_APRON = LIBRARY_WALL_HALF * 2;
/** The floor slab's thickness, its top on the floor. */
const FLOOR_THICKNESS = 0.5;

/**
 * **How far the lintel's base sits below the height at which a flier clears
 * the shut shelf** (the shelf's top less `JUMP_CLEARANCE_GRACE`), so the band
 * the shelf holds and the band the lintel holds overlap: there is no height at
 * which she slips through between the two (`check:library`'s LINTEL sweeps
 * every height to prove it).
 */
const LINTEL_OVERLAP = 0.05;

/**
 * **The secret den's doorway** (#719): the gap in the reading room's west
 * wall, room-local z — the secret shelf's middle, half the drawn case's length
 * either way, so the shut shelf fills it exactly. Measured off the drawn case,
 * and held to `layout.ts`'s {@link LIBRARY_DEN_DOOR_HALF} — the figure the
 * den's walls are laid out from — within 2 cm: a case of another width throws
 * here rather than leaving a slit beside the shut shelf, or a shelf
 * overhanging the hole it is meant to fill.
 */
export function libraryDenGap(): readonly [number, number] {
  const half = libraryBookcaseSize(LIBRARY_SECRET_BOOKCASE.kind).length / 2;
  if (Math.abs(half - LIBRARY_DEN_DOOR_HALF) > 0.02) {
    throw new Error(
      `Library: the secret shelf measures ${(half * 2).toFixed(3)} m long, but the den's doorway is laid out for ` +
        `${(LIBRARY_DEN_DOOR_HALF * 2).toFixed(3)} m (layout.ts's LIBRARY_DEN_DOOR_HALF): move the den's walls with the shelf`,
    );
  }
  const z = LIBRARY_SECRET_BOOKCASE.at.z;
  return [z - half, z + half];
}

/** The reading room's own paint, for anything built of the same stuff — the secret den (#719). */
export interface ReadingRoomFabric {
  /** The floor's boards. */
  readonly floor: MeshToonMaterial;
  /** The walls' green — the north, south and east walls' own material (never the west wall's, which fades). */
  readonly wall: MeshToonMaterial;
}

/** What {@link buildReadingRoomShell} built. */
export interface ReadingRoomShell {
  /** Every room wall's collider, in registration order, the west wall's two spans either side of the den's doorway among them. */
  readonly walls: readonly WallCollider[];
  /**
   * **The west wall, as one group**: its two spans either side of the den's
   * doorway and the lintel over the doorway (#719). One group with one
   * material of its own ({@link westMaterial}), so it can fade while she is in
   * the den (plan Step 12) without fading the north wall.
   */
  readonly westWall: Group;
  /** The west wall's material: the walls' green, cloned, so fading it fades nothing else. */
  readonly westMaterial: MeshToonMaterial;
  /**
   * **The lintel's collider** — banded: absent to anything whose feet are
   * below its base (`baseHeight`), so a walker and a jump pass under it and the
   * ground fill sees a doorway, and solid above (a jet pack flies 12 m up
   * indoors). Registered raw, like the room's walls: `LibraryProps`' keep-out
   * test is two-dimensional and would misread a collider that is only there
   * above the case's top.
   */
  readonly lintel: WallCollider;
  readonly fabric: ReadingRoomFabric;
}

/**
 * The reading room's floor plate and walls, in `root` (which stands at the
 * room's origin), registered with the collision world in world metres.
 *
 * **The west wall has a doorway into the secret den** (#719,
 * {@link libraryDenGap}), so it is two spans, with a lintel from the secret
 * shelf's top to the wall's top over the gap. The shelf itself is still an
 * ordinary case with its own collider (`furnish.ts`), so the doorway is shut:
 * the den beyond is a sealed pocket until the shelf swings (plan Step 12).
 *
 * Returns the colliders and the west wall's group, for a check to open one
 * deliberately and for the west wall's fade.
 */
export function buildReadingRoomShell(root: Group, collision: CollisionWorld, surfaces: WalkSurfaces): ReadingRoomShell {
  const originX = LIBRARY_ORIGIN_X;
  const originZ = LIBRARY_ORIGIN_Z;

  // The floor: warm boards under the dim light, one slab with a little apron
  // past the walls so the doorway's threshold has floor under it.
  const floorMaterial = roomMaterial(PALETTE.wood);
  const floor = solid(
    new Mesh(new BoxGeometry(LIBRARY_HALF_X * 2 + FLOOR_APRON * 2, FLOOR_THICKNESS, LIBRARY_HALF_Z * 2 + FLOOR_APRON * 2), floorMaterial),
  );
  floor.position.set(0, -FLOOR_THICKNESS / 2, 0);
  floor.name = 'library.floor';
  root.add(floor);
  surfaces.addPlatform(
    new Plate(
      LIBRARY_FLOOR_Y,
      originX - LIBRARY_HALF_X - FLOOR_APRON,
      originX + LIBRARY_HALF_X + FLOOR_APRON,
      originZ - LIBRARY_HALF_Z - FLOOR_APRON,
      originZ + LIBRARY_HALF_Z + FLOOR_APRON,
    ),
  );

  // The walls: the classic reading-room green. The west wall's spans and its
  // lintel are one group in a material of their own, so they can fade together
  // while she is in the den behind them.
  const sides = [
    { side: 'north', x1: -LIBRARY_HALF_X, z1: -LIBRARY_HALF_Z, x2: LIBRARY_HALF_X, z2: -LIBRARY_HALF_Z, hidden: false },
    { side: 'south', x1: -LIBRARY_HALF_X, z1: LIBRARY_HALF_Z, x2: LIBRARY_HALF_X, z2: LIBRARY_HALF_Z, hidden: true },
    { side: 'west', x1: -LIBRARY_HALF_X, z1: -LIBRARY_HALF_Z, x2: -LIBRARY_HALF_X, z2: LIBRARY_HALF_Z, hidden: false },
    { side: 'east', x1: LIBRARY_HALF_X, z1: -LIBRARY_HALF_Z, x2: LIBRARY_HALF_X, z2: LIBRARY_HALF_Z, hidden: true },
  ] as const;
  const material = roomMaterial(PALETTE.buildingTrimDeep);
  const westMaterial = material.clone();
  const westWall = new Group();
  westWall.name = 'library.westWall';
  root.add(westWall);
  const denGap = libraryDenGap();
  const walls: WallCollider[] = [];
  for (const { side, x1, z1, x2, z2, hidden } of sides) {
    const along = side === 'north' || side === 'south' ? 'x' : 'z';
    const from = along === 'x' ? x1 : z1;
    const to = along === 'x' ? x2 : z2;
    const gaps: (readonly [number, number])[] = side === 'south' ? [libraryDoorGap()] : side === 'west' ? [denGap] : [];
    const spans = segmentsMinusGaps(from, to, gaps);
    // North and south take the corners; east and west stop short of them by
    // the wall's depth, so no two boxes share a corner column (the reptile
    // hall's rule, which `check:coplanar` taught it).
    const drawn =
      along === 'x'
        ? cornerClosedSpans(spans, from, to, LIBRARY_WALL_HALF)
        : spans.map(([a, b]): [number, number] => [a <= from + 1e-6 ? a + LIBRARY_WALL_HALF : a, b >= to - 1e-6 ? b - LIBRARY_WALL_HALF : b]);
    const west = side === 'west';
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
          west ? westMaterial : material,
        ),
      );
      box.name = `library.wall.${side}`;
      box.position.set(along === 'x' ? mid : x1, LIBRARY_WALL_HEIGHT / 2, along === 'x' ? z1 : mid);
      // Hidden, not shortened: the collider below is the same either way.
      if (hidden) box.visible = false;
      (west ? westWall : root).add(box);
      walls.push(
        collision.kinded('library room wall', () =>
          collision.addWall(
            originX + (along === 'x' ? a : x1),
            originZ + (along === 'x' ? z1 : a),
            originX + (along === 'x' ? b : x1),
            originZ + (along === 'x' ? z1 : b),
            LIBRARY_WALL_HALF,
            LIBRARY_WALL_HEIGHT,
            false,
            true,
          ),
        ),
      );
    }
  }

  // The lintel over the den's doorway: from the secret shelf's top (measured,
  // never typed) to the wall's top, the wall's own depth — so the shut shelf
  // and the lintel read as the wall. Its collider is the band above
  // `JUMP_CLEARANCE_GRACE` + `LINTEL_OVERLAP` under the shelf's top: a flier
  // high enough to clear the shut shelf meets it, a walker and a jump never do.
  const [gapNorth, gapSouth] = denGap;
  const shelfTop = libraryBookcaseSize(LIBRARY_SECRET_BOOKCASE.kind).height;
  const lintelMesh = solid(new Mesh(new BoxGeometry(LIBRARY_WALL_HALF * 2, LIBRARY_WALL_HEIGHT - shelfTop, gapSouth - gapNorth), westMaterial));
  lintelMesh.name = 'library.lintel';
  lintelMesh.position.set(-LIBRARY_HALF_X, (shelfTop + LIBRARY_WALL_HEIGHT) / 2, (gapNorth + gapSouth) / 2);
  westWall.add(lintelMesh);
  const lintel = collision.addWall(
    originX - LIBRARY_HALF_X,
    originZ + gapNorth,
    originX - LIBRARY_HALF_X,
    originZ + gapSouth,
    LIBRARY_WALL_HALF,
    Infinity,
    false,
    false,
    LIBRARY_FLOOR_Y + shelfTop - JUMP_CLEARANCE_GRACE - LINTEL_OVERLAP,
  );
  return { walls, westWall, westMaterial, lintel, fabric: { floor: floorMaterial, wall: material } };
}

/** What {@link buildLibraryDenShell} built. */
export interface LibraryDenShell {
  /** The den's three walls' colliders — west, north, south — registered through `LibraryProps` as `den wall (west|north|south)`. */
  readonly walls: readonly [west: WallCollider, north: WallCollider, south: WallCollider];
}

/**
 * **The secret den's floor and walls** (#719): a walled pocket of the reading
 * room behind its west wall — not a space of its own, so no iris, no
 * boundary and no save plumbing (plan Decision 20). Built in `denRoot`, which
 * stands at the room's origin, in the room's own paint ({@link ReadingRoomFabric}).
 *
 * - **The floor**: a slab of the room's boards from the den's west wall's
 *   outer face to the room floor's apron edge, which it abuts — so no top face
 *   of one lies over the other's — and a walkable plate from the den's west
 *   edge to the room's inner wall face, so the doorway has floor under it from
 *   both sides.
 * - **Three walls**, each one box and one capsule through `LibraryProps`, so
 *   each is held clear of every stand spot and a check can take one out by
 *   name. The west wall's box takes both corners; the north and south walls'
 *   run from it to the room's west wall's outer face, abutting it rather than
 *   buried in it, so no two top faces share a plane. The south wall is on the
 *   camera's near side, so it is hidden, not shortened — the room's own rule:
 *   its collider is the same either way.
 *
 * Their east side is the reading room's west wall, with the doorway in it.
 */
export function buildLibraryDenShell(denRoot: Group, props: LibraryProps, surfaces: WalkSurfaces, fabric: ReadingRoomFabric): LibraryDenShell {
  const t = LIBRARY_WALL_HALF;
  const inner = LIBRARY_DEN_INNER;
  // The walls' centre lines, and the room's west wall's centre line and outer face.
  const westX = inner.west - t;
  const northZ = inner.north - t;
  const southZ = inner.south + t;
  const roomWallX = -LIBRARY_HALF_X;
  const roomWallOuter = -LIBRARY_HALF_X - t;
  // The den's outer extent, walls included.
  const outerWest = westX - t;
  const outerNorth = northZ - t;
  const outerSouth = southZ + t;

  const floorEast = -LIBRARY_HALF_X - FLOOR_APRON;
  const floor = solid(new Mesh(new BoxGeometry(floorEast - outerWest, FLOOR_THICKNESS, outerSouth - outerNorth), fabric.floor));
  floor.name = 'library.den.floor';
  floor.position.set((outerWest + floorEast) / 2, -FLOOR_THICKNESS / 2, (outerNorth + outerSouth) / 2);
  denRoot.add(floor);
  surfaces.addPlatform(
    new Plate(LIBRARY_FLOOR_Y, LIBRARY_ORIGIN_X + outerWest, LIBRARY_ORIGIN_X - LIBRARY_INNER_X, LIBRARY_ORIGIN_Z + outerNorth, LIBRARY_ORIGIN_Z + outerSouth),
  );

  const wallBox = (name: string, minX: number, maxX: number, minZ: number, maxZ: number, hidden: boolean): void => {
    const box = solid(new Mesh(new BoxGeometry(maxX - minX, LIBRARY_WALL_HEIGHT, maxZ - minZ), fabric.wall));
    box.name = `library.den.wall.${name}`;
    box.position.set((minX + maxX) / 2, LIBRARY_WALL_HEIGHT / 2, (minZ + maxZ) / 2);
    // Hidden, not shortened: the collider is the same either way.
    if (hidden) box.visible = false;
    denRoot.add(box);
  };
  wallBox('west', outerWest, inner.west, outerNorth, outerSouth, false);
  wallBox('north', inner.west, roomWallOuter, outerNorth, inner.north, false);
  wallBox('south', inner.west, roomWallOuter, inner.south, outerSouth, true);
  const west = props.wall('den wall (west)', { x: westX, z: northZ }, { x: westX, z: southZ }, t, 'wall');
  const north = props.wall('den wall (north)', { x: westX, z: northZ }, { x: roomWallX, z: northZ }, t, 'wall');
  const south = props.wall('den wall (south)', { x: westX, z: southZ }, { x: roomWallX, z: southZ }, t, 'wall');
  return { walls: [west, north, south] };
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
