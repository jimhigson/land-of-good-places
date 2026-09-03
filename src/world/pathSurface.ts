import { BufferAttribute, BufferGeometry, CatmullRomCurve3, MeshStandardMaterial, Vector3 } from 'three';
import { PATH_KERB_LIFT, PATH_SURFACE_LIFT } from '../core/constants';
import { PALETTE } from '../core/palette';
import { pathTexture } from '../core/textures';
import { terrainHeight, terrainNormal } from './terrain';

/**
 * **What a park path is made of — the one owner.**
 *
 * The two materials, the accumulator and the sweep that lays a ribbon on the
 * terrain. `pathGraph.ts` draws the whole solved network from these, and
 * `entrance/Entrance.ts` draws the short run in through the gate from the same
 * ones, so the spur at the gate is the *same surface* as the path it joins
 * rather than a second description of it.
 *
 * **Why it is here and not in `pathGraph.ts`, where it grew up.** Importing
 * `pathGraph.ts` *runs the whole path solve* — that module's own evaluation is
 * what builds the graph — so anything that only wants to know what paving looks
 * like cannot ask it without paying for, and re-ordering, the park's
 * generation. `Entrance.ts` is precisely such a caller and already avoids that
 * module by name (it reads `paving.ts` rather than `pathGraph.ts` for the same
 * reason). This file imports the terrain, the palette and a texture, and solves
 * nothing.
 *
 * The lifts themselves stay in `core/constants.ts`, which already owns them.
 */

/** The sandy walking surface. */
export function pathSurfaceMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    map: pathTexture(1),
    roughness: 0.95,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/** The cream border that frames it, drawn a touch lower and a touch wider. */
export function pathKerbMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: PALETTE.pathEdge,
    roughness: 0.9,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

/**
 * Minimal geometry accumulator so the whole path network collapses into a
 * single draw call per layer.
 */
export class GeometryBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];
  private readonly scratchNormal = new Vector3();

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  vertex(x: number, y: number, z: number, u: number, v: number): void {
    this.positions.push(x, y, z);
    // Normals come from the terrain function rather than computeVertexNormals():
    // the plaza fan has degenerate triangles at its centre, which would leave
    // those vertices with a zero-length normal and a black splodge in the middle
    // of the paving.
    const normal = terrainNormal(x, z, this.scratchNormal);
    this.normals.push(normal.x, normal.y, normal.z);
    this.uvs.push(u, v);
  }

  /** Two triangles for a quad given as (a, b) then (c, d) vertex pairs. */
  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, b, d, c);
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Sweeps a flat ribbon of `width` along the curve, draped onto the terrain. */
export function addPathRibbon(
  builder: GeometryBuilder,
  curve: CatmullRomCurve3,
  width: number,
  divisions: number,
  lift: number,
): void {
  const half = width / 2;
  const point = new Vector3();
  const tangent = new Vector3();
  let travelled = 0;
  let previousX = 0;
  let previousZ = 0;

  for (let i = 0; i <= divisions; i += 1) {
    const t = i / divisions;
    curve.getPoint(t, point);
    curve.getTangent(t, tangent);
    // Perpendicular on the ground plane.
    const nx = -tangent.z;
    const nz = tangent.x;
    const length = Math.hypot(nx, nz) || 1;

    if (i > 0) travelled += Math.hypot(point.x - previousX, point.z - previousZ);
    previousX = point.x;
    previousZ = point.z;

    const lx = point.x + (nx / length) * half;
    const lz = point.z + (nz / length) * half;
    const rx = point.x - (nx / length) * half;
    const rz = point.z - (nz / length) * half;

    // Right edge before left edge: that ordering makes the quads wind
    // anticlockwise seen from above, so the ribbon faces the sky.
    const v = pathRibbonV(travelled, width);
    builder.vertex(rx, terrainHeight(rx, rz) + lift, rz, 0, v);
    builder.vertex(lx, terrainHeight(lx, lz) + lift, lz, 1, v);

    if (i > 0) {
      const base = builder.vertexCount - 4;
      builder.quad(base, base + 1, base + 2, base + 3);
    }
  }
}

/**
 * How far the paving texture has run, in tiles, `travelled` metres along a
 * ribbon `width` metres across. The slab courses on a path are square, so the
 * two are the same divisor — which is the whole reason this is a function and
 * not a number written twice.
 */
export function pathRibbonV(travelled: number, width: number): number {
  return travelled / Math.max(1, width);
}

/** A point on the ground; `y` comes from the terrain wherever one is used. */
export interface PathEdgePoint {
  readonly x: number;
  readonly z: number;
}

/**
 * **A ribbon whose far edge is somebody else's boundary**, laid between two
 * matched lists of points: `from[i]` to `to[i]`, subdivided `rows` times along
 * and draped on the terrain exactly as {@link addPathRibbon} drapes a swept one.
 *
 * The gate's spur needs this and a swept curve cannot give it. A swept ribbon
 * has straight rows, and the spur's outer end has to land on the entrance
 * road's *curved* inner kerb: over the spur's own width that kerb wanders up to
 * 0.93 m in `z` (measured, `scripts/probe-spur-edge.mts`, seed 326), so a
 * straight edge can only lie across the road — a coplanar seam — or leave a
 * wedge of grass between the road and the path. Handing this the road's own
 * boundary points makes the join exact, with no resampling of the curve in
 * between: the earlier attempt to interpolate the kerb's shape per column left
 * the seam *and* added a second one, because interpolated points do not land on
 * the kerb's own triangle edges.
 *
 * `u` runs 0..1 across and `v` counts the same tiles {@link addPathRibbon}
 * counts, so the slabs come out the size they are everywhere else in the park.
 */
export function addPathQuilt(
  builder: GeometryBuilder,
  from: readonly PathEdgePoint[],
  to: readonly PathEdgePoint[],
  rows: number,
  lift: number,
): void {
  if (from.length !== to.length || from.length < 2 || rows < 1) return;
  const columns = from.length;
  const width = Math.hypot(
    (from[columns - 1] as PathEdgePoint).x - (from[0] as PathEdgePoint).x,
    (from[columns - 1] as PathEdgePoint).z - (from[0] as PathEdgePoint).z,
  );
  const first = builder.vertexCount;

  for (let row = 0; row <= rows; row += 1) {
    const t = row / rows;
    for (let column = 0; column < columns; column += 1) {
      const a = from[column] as PathEdgePoint;
      const b = to[column] as PathEdgePoint;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      // Travelled is measured down this column, so a quilt whose two ends are
      // different lengths still tiles evenly along each of them.
      const travelled = Math.hypot(b.x - a.x, b.z - a.z) * t;
      builder.vertex(
        x,
        terrainHeight(x, z) + lift,
        z,
        columns === 1 ? 0 : column / (columns - 1),
        pathRibbonV(travelled, width),
      );
    }
  }

  // **Which way round the triangles go is measured, not assumed.** The quilt's
  // winding depends on which way its columns and its rows happen to run, and
  // both are the caller's business — so the sign is taken from the geometry
  // itself: the y of (across × along) at the first corner. A ribbon that comes
  // out facing the ground is culled by every `FrontSide` material in the game
  // and is invisible while every position-reading check calls it perfect; the
  // entrance road lost a session to exactly that, so this decides rather than
  // hopes.
  const across = from[1] as PathEdgePoint;
  const along = to[0] as PathEdgePoint;
  const origin = from[0] as PathEdgePoint;
  const upwards =
    (across.z - origin.z) * (along.x - origin.x) - (across.x - origin.x) * (along.z - origin.z) > 0;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = first + row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      if (upwards) builder.quad(a, b, c, d);
      else builder.quad(a, c, b, d);
    }
  }
}

export { PATH_KERB_LIFT, PATH_SURFACE_LIFT };
