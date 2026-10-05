import { BoxGeometry, CircleGeometry, Curve, EllipseCurve, Group, Mesh, TubeGeometry, Vector3 } from 'three';
import type { CollisionWorld, WallCollider } from '../Collision';
import type { MovingPlatform, WalkSurfaces } from '../building/surfaces';
import { interiorMaterial } from '../building/parts';
import { Plate } from '../hotel/place';
import { DOOR_HALF, WALL_HALF_DEPTH } from '../hotel/layout';
import { cornerClosedSpans, segmentsMinusGaps } from '../wallRuns';
import type { PortalBand } from '../tapSpacing';
import { PALETTE } from '../../core/palette';
import { solid, decal, softMaterial, toonMaterial } from '../../art/style/materials';
import {
  REPTILE_ARCH_WIDTH,
  REPTILE_BACK_WALL_ALONG,
  REPTILE_DOOR_BAND_OUTER,
  REPTILE_DOOR_X,
  REPTILE_EXIT_BAND_Z,
  REPTILE_FORECOURT_RADIUS,
  REPTILE_HALF_X,
  REPTILE_HALF_Z,
  REPTILE_HOUSE_FLOOR_Y,
  REPTILE_HOUSE_ORIGIN_X,
  REPTILE_HOUSE_ORIGIN_Z,
  REPTILE_SHELL_RADIUS,
  REPTILE_TAIL_BASE_RADIUS,
  REPTILE_TAIL_BEARING_OFFSET,
  REPTILE_TAIL_REACH,
  REPTILE_WALL_HEIGHT,
  type LocalPoint,
} from './layout';

/**
 * **The Reptile House's two shells.**
 *
 * The hall is a hotel room in shape — `Hotel.buildRoomShell`, copied with the
 * reptile house's own numbers: one floor `Plate` via `WalkSurfaces`, four
 * walls per `wallRuns.ts` minus the south doorway, each solid span drawn as
 * one box and registered as one `addWall`, the south and east walls hidden
 * (not shortened) so the fixed iso camera can see in. The exterior is a closed
 * 16-gon of chords at `REPTILE_SHELL_RADIUS` with one aperture, jambs and a
 * back wall — `registerTowerCollision`'s geometry-not-trimmed-angles rule.
 */

/** The hall's inner wall faces. */
export const REPTILE_INNER_X = REPTILE_HALF_X - WALL_HALF_DEPTH;
export const REPTILE_INNER_Z = REPTILE_HALF_Z - WALL_HALF_DEPTH;

/** The south doorway's clear gap along X. */
export function reptileDoorGap(): readonly [number, number] {
  return [REPTILE_DOOR_X - DOOR_HALF, REPTILE_DOOR_X + DOOR_HALF];
}

/** The exit band on the south wall — crossing it is leaving. World metres. */
export function reptileExitBand(): PortalBand {
  // `along` is the walk's own direction — out through the south wall, +Z —
  // so the band is 1.2 m deep and the doorway's width across.
  return {
    what: "the Reptile House's exit",
    centreX: REPTILE_HOUSE_ORIGIN_X + REPTILE_DOOR_X,
    centreZ: REPTILE_HOUSE_ORIGIN_Z + REPTILE_EXIT_BAND_Z,
    halfAlong: 0.6,
    halfAcross: DOOR_HALF + 0.4,
    yaw: 0,
    y: REPTILE_HOUSE_FLOOR_Y,
  };
}

/**
 * The facade's own frame, wherever it stands: `along` runs out through the
 * door, `across` it, with the building's centre at (x, z).
 */
export interface FacadeFrame {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

export function facadeToWorld(frame: FacadeFrame, along: number, across: number): { x: number; z: number } {
  return {
    x: frame.x + Math.sin(frame.yaw) * along + Math.sin(frame.yaw + Math.PI / 2) * across,
    z: frame.z + Math.cos(frame.yaw) * along + Math.cos(frame.yaw + Math.PI / 2) * across,
  };
}

/** The front door's walk-through band, from the back wall out to the doormat. */
export function reptileEntryBand(frame: FacadeFrame): PortalBand {
  const centreAlong = (REPTILE_BACK_WALL_ALONG + REPTILE_DOOR_BAND_OUTER) / 2;
  const centre = facadeToWorld(frame, centreAlong, 0);
  return {
    what: "the Reptile House's front door",
    centreX: centre.x,
    centreZ: centre.z,
    halfAlong: (REPTILE_DOOR_BAND_OUTER - REPTILE_BACK_WALL_ALONG) / 2,
    halfAcross: REPTILE_ARCH_WIDTH / 2,
    yaw: frame.yaw,
    y: 0,
    ownZoneId: 'reptile-entrance',
  };
}

/** Where the tail signpost's base stands, in the facade's frame. */
export function reptileTailBase(frame: FacadeFrame): { x: number; z: number } {
  const bearing = frame.yaw + (REPTILE_TAIL_BEARING_OFFSET * Math.PI) / 180;
  return { x: frame.x + Math.sin(bearing) * REPTILE_TAIL_REACH, z: frame.z + Math.cos(bearing) * REPTILE_TAIL_REACH };
}

const SHELL_SIDES = 16;
const SHELL_HALF_THICKNESS = 0.3;
const JAMB_HALF = 0.3;
/**
 * The jambs' centrelines: their inner faces lie **on** the bore's drawn walls
 * — `REPTILE_ARCH_WIDTH / 2` out, plus their own half-thickness. The first cut
 * put the centreline 0.05 past the bore, so the collider stood 0.25 m inside
 * the drawn opening on each side: a child walking the edge of the mouth
 * bumped air (the solidity review, 2 October 2026).
 */
const JAMB_ACROSS = REPTILE_ARCH_WIDTH / 2 + JAMB_HALF;
/**
 * The doorway strip the jambs own, `|across|` under this: the bore and the
 * lips either side of it. `reptileHouseLowDiscs` leaves the strip alone so no
 * mesh-derived disc lands in the doorway.
 */
export const REPTILE_JAMB_STRIP = JAMB_ACROSS + JAMB_HALF;

/**
 * **The exterior's collision: a closed ring with one hole in it.** Fifteen
 * chords of the 16-gon, two stubs of the sixteenth either side of the
 * doorway, two jambs running out from the back wall to where the mouth's lips
 * reach (`jambReach`, measured off the mesh — not a metre further onto the
 * paving), and the back wall two metres in so a sprinting child stops on
 * something while the iris closes. Plus whatever of the dressing stands low
 * enough to meet her: the discs the caller derived from the mesh
 * (`lowDiscs` — the head's cheeks, the tail, the sign) and the tail base.
 */
export function registerReptileShellCollision(
  collision: CollisionWorld,
  frame: FacadeFrame,
  lowDiscs: readonly { x: number; z: number; radius: number }[],
  jambReach: number,
): WallCollider[] {
  const R = REPTILE_SHELL_RADIUS;
  const sector = (Math.PI * 2) / SHELL_SIDES;
  const facadeAlong = R * Math.cos(sector / 2);
  const vertexAcross = R * Math.sin(sector / 2);
  // Every wall, in the order it is registered — the fifteen chords first
  // (`walls[face - 1]` is chord `face`), so `check:reptile-house` can take
  // one out by name (`REPTILE_CHECK_OPEN_SHELL=8`) and watch the facade
  // clause go red without anyone editing this file to prove it.
  const walls: WallCollider[] = [];

  const wall = (along1: number, across1: number, along2: number, across2: number, half: number): void => {
    const a = facadeToWorld(frame, along1, across1);
    const b = facadeToWorld(frame, along2, across2);
    walls.push(collision.addWall(a.x, a.z, b.x, b.z, half));
  };

  for (let face = 1; face < SHELL_SIDES; face += 1) {
    const a1 = frame.yaw + (face - 0.5) * sector;
    const a2 = frame.yaw + (face + 0.5) * sector;
    walls.push(
      collision.addWall(
        frame.x + Math.sin(a1) * R,
        frame.z + Math.cos(a1) * R,
        frame.x + Math.sin(a2) * R,
        frame.z + Math.cos(a2) * R,
        SHELL_HALF_THICKNESS,
      ),
    );
  }
  for (const side of [-1, 1]) {
    wall(facadeAlong, side * JAMB_ACROSS, facadeAlong, side * (vertexAcross + 0.3), SHELL_HALF_THICKNESS);
    wall(REPTILE_BACK_WALL_ALONG, side * JAMB_ACROSS, jambReach, side * JAMB_ACROSS, JAMB_HALF);
  }
  wall(REPTILE_BACK_WALL_ALONG, JAMB_ACROSS, REPTILE_BACK_WALL_ALONG, -JAMB_ACROSS, 0.35);

  const tail = reptileTailBase(frame);
  collision.addCircle(tail.x, tail.z, REPTILE_TAIL_BASE_RADIUS);
  for (const disc of lowDiscs) {
    const at = facadeToWorld(frame, disc.z, disc.x);
    collision.addCircle(at.x, at.z, disc.radius);
  }
  return walls;
}

/**
 * A walkable rectangle in the facade's own frame — the plinth's top inside the
 * arch, which the aperture lets her walk up onto. `Plate` is axis-aligned, and
 * a park plot's facade can face any way.
 */
class FacadePlate implements MovingPlatform {
  readonly surfaceY: number;
  private readonly frame: FacadeFrame;
  private readonly alongFrom: number;
  private readonly alongTo: number;
  private readonly halfAcross: number;

  constructor(frame: FacadeFrame, surfaceY: number, alongFrom: number, alongTo: number, halfAcross: number) {
    this.frame = frame;
    this.surfaceY = surfaceY;
    this.alongFrom = alongFrom;
    this.alongTo = alongTo;
    this.halfAcross = halfAcross;
  }

  covers(x: number, z: number): boolean {
    const dx = x - this.frame.x;
    const dz = z - this.frame.z;
    const along = dx * Math.sin(this.frame.yaw) + dz * Math.cos(this.frame.yaw);
    const across = dx * Math.sin(this.frame.yaw + Math.PI / 2) + dz * Math.cos(this.frame.yaw + Math.PI / 2);
    return along >= this.alongFrom && along <= this.alongTo && Math.abs(across) <= this.halfAcross;
  }
}

/** The plinth step inside the arch, so her feet stand on the stone she walks over. */
export function registerPlinthStep(surfaces: WalkSurfaces, frame: FacadeFrame, plinthTop: number): void {
  const facadeAlong = REPTILE_SHELL_RADIUS * Math.cos(Math.PI / SHELL_SIDES);
  surfaces.addPlatform(new FacadePlate(frame, plinthTop, REPTILE_BACK_WALL_ALONG - 0.5, facadeAlong, JAMB_ACROSS));
}

/**
 * **The forecourt lawn** — a flat disc the building stands on while the park
 * has no plot for it, with a paved spur from the door and the tongue doormat
 * on it. One `Plate` at floor height is what makes it walkable: off the park
 * the terrain sampler answers with the sphere's underside.
 */
export function buildForecourt(root: Group, surfaces: WalkSurfaces, originX: number, originZ: number, frame: FacadeFrame): void {
  const lawn = new Mesh(new CircleGeometry(REPTILE_FORECOURT_RADIUS, 48), softMaterial(PALETTE.grass));
  lawn.rotation.x = -Math.PI / 2; // flat-ok: the forecourt lawn on its flat plate; the reptile house is its own flat space at x 600, floor y 0, off the sphere
  lawn.receiveShadow = true;
  lawn.name = 'reptile-forecourt-lawn';
  root.add(lawn);
  surfaces.addPlatform(
    new Plate(
      REPTILE_HOUSE_FLOOR_Y,
      originX - REPTILE_FORECOURT_RADIUS,
      originX + REPTILE_FORECOURT_RADIUS,
      originZ - REPTILE_FORECOURT_RADIUS,
      originZ + REPTILE_FORECOURT_RADIUS,
    ),
  );

  // The spur: from under the mouth out to the lawn's edge, in the facade's frame.
  const spurFrom = REPTILE_DOOR_BAND_OUTER - 1;
  const spurTo = REPTILE_FORECOURT_RADIUS - 1;
  const spur = new Mesh(new BoxGeometry(3.4, 0.04, spurTo - spurFrom), toonMaterial(PALETTE.pathSand));
  spur.receiveShadow = true;
  const mid = facadeToWorld(frame, (spurFrom + spurTo) / 2, 0);
  spur.position.set(mid.x - originX, 0.02, mid.z - originZ);
  spur.rotation.y = frame.yaw;
  spur.name = 'reptile-forecourt-spur';
  root.add(spur);
  // The doormat is Sunny's tongue, part of the exterior kit (`rh-tongue`):
  // it lolls out of the mouth over the plinth's edge onto this paving.
}

/** The hall's floor plate, walls and rib arches, in `root` (at the hall origin). */
export function buildHallShell(root: Group, collision: CollisionWorld, surfaces: WalkSurfaces): void {
  const originX = REPTILE_HOUSE_ORIGIN_X;
  const originZ = REPTILE_HOUSE_ORIGIN_Z;

  const floor = solid(
    new Mesh(
      new BoxGeometry(REPTILE_HALF_X * 2 + 1.2, 0.5, REPTILE_HALF_Z * 2 + 1.2),
      interiorMaterial(PALETTE.pathSand, 0.72),
    ),
  );
  floor.position.set(0, -0.25, 0);
  floor.name = 'reptile.floor';
  root.add(floor);
  surfaces.addPlatform(
    new Plate(
      REPTILE_HOUSE_FLOOR_Y,
      originX - REPTILE_HALF_X - 0.6,
      originX + REPTILE_HALF_X + 0.6,
      originZ - REPTILE_HALF_Z - 0.6,
      originZ + REPTILE_HALF_Z + 0.6,
    ),
  );

  const sides = [
    { side: 'north', x1: -REPTILE_HALF_X, z1: -REPTILE_HALF_Z, x2: REPTILE_HALF_X, z2: -REPTILE_HALF_Z, hidden: false },
    { side: 'south', x1: -REPTILE_HALF_X, z1: REPTILE_HALF_Z, x2: REPTILE_HALF_X, z2: REPTILE_HALF_Z, hidden: true },
    { side: 'west', x1: -REPTILE_HALF_X, z1: -REPTILE_HALF_Z, x2: -REPTILE_HALF_X, z2: REPTILE_HALF_Z, hidden: false },
    { side: 'east', x1: REPTILE_HALF_X, z1: -REPTILE_HALF_Z, x2: REPTILE_HALF_X, z2: REPTILE_HALF_Z, hidden: true },
  ] as const;
  const wallMaterial = interiorMaterial(PALETTE.buildingWall, 0.7);
  const height = REPTILE_WALL_HEIGHT;
  for (const { side, x1, z1, x2, z2, hidden } of sides) {
    const along = side === 'north' || side === 'south' ? 'x' : 'z';
    const from = along === 'x' ? x1 : z1;
    const to = along === 'x' ? x2 : z2;
    const gaps: (readonly [number, number])[] = side === 'south' ? [reptileDoorGap()] : [];
    const spans = segmentsMinusGaps(from, to, gaps);
    // North and south take the corners; east and west stop short of them by
    // the same depth, so no two wall boxes share a corner column — the
    // hotel's butting walls run the full extent and their tops meet the
    // corner-closed walls' tops in one plane, which the coplanar sweep reports.
    const drawn =
      along === 'x'
        ? cornerClosedSpans(spans, from, to, WALL_HALF_DEPTH)
        : spans.map(([a, b]): [number, number] => [a <= from + 1e-6 ? a + WALL_HALF_DEPTH : a, b >= to - 1e-6 ? b - WALL_HALF_DEPTH : b]);
    for (const [index, [a, b]] of spans.entries()) {
      if (b - a < 0.05) continue;
      const [drawnA, drawnB] = drawn[index] ?? [a, b];
      const length = drawnB - drawnA;
      const mid = (drawnA + drawnB) / 2;
      const wall = solid(
        new Mesh(
          along === 'x'
            ? new BoxGeometry(length, height, WALL_HALF_DEPTH * 2)
            : new BoxGeometry(WALL_HALF_DEPTH * 2, height, length),
          wallMaterial,
        ),
      );
      wall.name = 'reptile.wall';
      wall.position.set(along === 'x' ? mid : x1, height / 2, along === 'x' ? z1 : mid);
      // Hidden, not shortened: the collider below is the same either way.
      if (hidden) wall.visible = false;
      root.add(wall);
      collision.addWall(
        originX + (along === 'x' ? a : x1),
        originZ + (along === 'x' ? z1 : a),
        originX + (along === 'x' ? b : x1),
        originZ + (along === 'x' ? z1 : b),
        0.3,
      );
    }
  }

  // Three greenhouse ribs overhead — scenery, no collider: their lowest points
  // are inside the walls and the arch itself clears the tallest hat twice over.
  for (const x of [-12, 0, 12]) {
    const curve = new EllipseCurve(0, 0, REPTILE_HALF_Z, 7, 0, Math.PI, false, 0);
    const points = curve.getPoints(24).map((p) => new Vector3(x, p.y, p.x));
    const rib = decal(new Mesh(new TubeGeometry(new RibCurve(points), 24, 0.12, 8, false), toonMaterial(PALETTE.liftFrame)));
    rib.name = 'reptile.rib';
    root.add(rib);
  }
}

/** A polyline the rib tube follows. */
class RibCurve extends Curve<Vector3> {
  private readonly points: readonly Vector3[];

  constructor(points: readonly Vector3[]) {
    super();
    this.points = points;
  }

  override getPoint(t: number, target = new Vector3()): Vector3 {
    const scaled = t * (this.points.length - 1);
    const index = Math.min(this.points.length - 2, Math.floor(scaled));
    const f = scaled - index;
    const a = this.points[index]!;
    const b = this.points[index + 1]!;
    return target.copy(a).lerp(b, f);
  }
}

/** Hall-local → world. */
export function hallToWorld(point: LocalPoint): { x: number; z: number } {
  return { x: REPTILE_HOUSE_ORIGIN_X + point.x, z: REPTILE_HOUSE_ORIGIN_Z + point.z };
}
