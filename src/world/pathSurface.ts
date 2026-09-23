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

  /**
   * One triangle — unless two of its corners were laid on the same point in
   * plan, when it has no area, no facing and nothing to draw.
   */
  triangle(a: number, b: number, c: number): void {
    const same = (i: number, j: number): boolean =>
      this.positions[i * 3] === this.positions[j * 3] && this.positions[i * 3 + 2] === this.positions[j * 3 + 2];
    if (same(a, b) || same(b, c) || same(a, c)) return;
    this.indices.push(a, b, c);
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
  addRibbonStrip(builder, ribbonStations(curve, divisions), -half, half, lift, (travelled) =>
    pathRibbonV(travelled, width),
  );
}

/**
 * **One cross-section of a swept ribbon**: where the centreline is, which way
 * is across it, and how far along it has run.
 */
export interface RibbonStation {
  readonly x: number;
  readonly z: number;
  /** Unit vector across the ribbon, to its left, in plan. */
  readonly acrossX: number;
  readonly acrossZ: number;
  /** Metres of centreline walked to get here. */
  readonly travelled: number;
}

/**
 * **Half the chord that decides which way is "across" at a station**, metres
 * of centreline either side.
 *
 * Not the curve's own tangent. `routeCurve` is a uniform Catmull-Rom through
 * control points that sometimes carry a jog of a few centimetres (a lattice
 * snap: seed 20260728 route 23 steps 6 cm sideways at (-34.5, -46.0)), and
 * through a jog like that the tangent **reverses** — measured, consecutive
 * tangents at -0.999 — so a ribbon swept along it swaps its left and right
 * edges there and the whole cross-section folds face-down. The chord across
 * half a metre either side cannot flip on a wiggle smaller than itself, and on
 * a circular arc — every filleted corner — it is exactly parallel to the
 * tangent at its middle, so a well-behaved curve comes out the same.
 */
const ACROSS_CHORD_HALF = 0.5;

/**
 * The stations a curve is swept at: the same `divisions + 1` points
 * `curvePoints` samples (so the drawn ribbon and the recorded centreline are
 * one set of points), each with its across direction from
 * {@link ACROSS_CHORD_HALF}.
 */
export function ribbonStations(curve: CatmullRomCurve3, divisions: number): RibbonStation[] {
  const point = new Vector3();
  const xs: number[] = [];
  const zs: number[] = [];
  const along: number[] = [];
  for (let i = 0; i <= divisions; i += 1) {
    curve.getPoint(i / divisions, point);
    const x = point.x;
    const z = point.z;
    along.push(i === 0 ? 0 : (along[i - 1] as number) + Math.hypot(x - (xs[i - 1] as number), z - (zs[i - 1] as number)));
    xs.push(x);
    zs.push(z);
  }
  const total = along[divisions] as number;
  const closed = curve.closed;

  /** The centreline polyline at `s` metres along it — wrapped on a closed loop, clamped on an open one. */
  const at = (s: number): [number, number] => {
    let t = s;
    if (closed && total > 0) t = ((t % total) + total) % total;
    else t = Math.max(0, Math.min(total, t));
    let lo = 0;
    let hi = divisions;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((along[mid] as number) <= t) lo = mid;
      else hi = mid;
    }
    const span = (along[hi] as number) - (along[lo] as number);
    const f = span > 0 ? (t - (along[lo] as number)) / span : 0;
    return [
      (xs[lo] as number) + ((xs[hi] as number) - (xs[lo] as number)) * f,
      (zs[lo] as number) + ((zs[hi] as number) - (zs[lo] as number)) * f,
    ];
  };

  const tangent = new Vector3();
  const stations: RibbonStation[] = [];
  for (let i = 0; i <= divisions; i += 1) {
    const s = along[i] as number;
    const [bx, bz] = at(s - ACROSS_CHORD_HALF);
    const [fx, fz] = at(s + ACROSS_CHORD_HALF);
    let dx = fx - bx;
    let dz = fz - bz;
    let length = Math.hypot(dx, dz);
    if (length < 1e-9) {
      // A curve shorter than nothing: nothing to take a chord of.
      curve.getTangent(i / divisions, tangent);
      dx = tangent.x;
      dz = tangent.z;
      length = Math.hypot(dx, dz) || 1;
    }
    // Perpendicular on the ground plane, to the left of travel.
    stations.push({
      x: xs[i] as number,
      z: zs[i] as number,
      acrossX: -dz / length,
      acrossZ: dx / length,
      travelled: s,
    });
  }
  return stations;
}

/**
 * **One edge of a swept ribbon, `offset` metres to the left of the centreline
 * (negative: to the right) — as an edge, not as a fold.**
 *
 * Offsetting every station along its across direction is exact on a straight
 * and wrong wherever the ribbon turns tighter than `offset`: past that radius
 * the offset curve runs *backwards* between two cusps (a swallowtail), and the
 * quads laid between those stations are wound face-down — culled, so a hole
 * in the path. Every filleted corner in the park is ~1 m in radius against a
 * path half-width of 1.3-1.6 m, so this is the ordinary case, not a corner
 * case: 189 face-down paving triangles on the canonical seed.
 *
 * The true edge of the swept band there is the offset curve with its
 * swallowtail cut off at the point where it crosses itself. So each run of
 * backward segments is found, the forward segment before it and the forward
 * segment after it are intersected, and every station in between takes that
 * one point: the inside of the corner becomes a fan about the corner of the
 * paving, which is what a paved corner is. Where the two do not cross (a
 * backtrack that is collinear, or runs off the end of the route) the edge
 * holds at the cusp until the curve comes out ahead of it again.
 *
 * Both the paving and the kerb ask this for their shared edge, with the same
 * stations and the same offset, so they still share it exactly.
 */
export function ribbonEdge(stations: readonly RibbonStation[], offset: number): [number, number][] {
  const edge = stations.map((s): [number, number] => [s.x + s.acrossX * offset, s.z + s.acrossZ * offset]);
  const last = edge.length - 1;
  /** Forward progress of the segment from `a` to `b`, judged by the travel direction at stations `i` and `j`. */
  const progress = (a: readonly [number, number], b: readonly [number, number], i: number, j: number): number => {
    const si = stations[i] as RibbonStation;
    const sj = stations[j] as RibbonStation;
    // Travel direction is the across direction turned back a quarter.
    const fx = si.acrossZ + sj.acrossZ;
    const fz = -si.acrossX - sj.acrossX;
    return (b[0] - a[0]) * fx + (b[1] - a[1]) * fz;
  };
  const moves = (i: number): boolean => {
    const a = edge[i] as [number, number];
    const b = edge[i + 1] as [number, number];
    return Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) > 1e-12;
  };
  const backward = (i: number): boolean => moves(i) && progress(edge[i]!, edge[i + 1]!, i, i + 1) <= 0;

  let i = 0;
  while (i < last) {
    if (!backward(i)) {
      i += 1;
      continue;
    }
    const start = i;
    let end = i;
    while (end + 1 < last && (backward(end + 1) || !moves(end + 1))) end += 1;

    // The swallowtail's own crossing: the nearest pair of segments, one
    // before the run and one after it, that intersect.
    let cut: { before: number; after: number; at: [number, number] } | null = null;
    for (let after = end + 1; after < last && after <= end + EDGE_SEARCH; after += 1) {
      for (let before = start - 1; before >= 0 && before >= start - EDGE_SEARCH; before -= 1) {
        if (cut && after - before >= cut.after - cut.before) break;
        const at = segmentCrossing(edge[before]!, edge[before + 1]!, edge[after]!, edge[after + 1]!);
        if (at) cut = { before, after, at };
      }
    }
    if (cut) {
      for (let k = cut.before + 1; k <= cut.after; k += 1) edge[k] = [cut.at[0], cut.at[1]];
      i = cut.after;
      continue;
    }

    // No crossing: hold at the cusp until the edge is ahead of it again.
    const cusp = edge[start] as [number, number];
    let release = end + 1;
    while (release <= last && progress(cusp, edge[release]!, release - 1, release) <= 0) release += 1;
    for (let k = start + 1; k < release && k <= last; k += 1) edge[k] = [cusp[0], cusp[1]];
    i = Math.max(start + 1, release - 1);
  }
  return edge;
}

/** How many segments either side of a backward run are searched for its crossing. */
const EDGE_SEARCH = 48;

/** Where segment `a0-a1` properly crosses segment `b0-b1` in plan, or `null`. */
function segmentCrossing(
  a0: readonly [number, number],
  a1: readonly [number, number],
  b0: readonly [number, number],
  b1: readonly [number, number],
): [number, number] | null {
  const rx = a1[0] - a0[0];
  const rz = a1[1] - a0[1];
  const sx = b1[0] - b0[0];
  const sz = b1[1] - b0[1];
  const denominator = rx * sz - rz * sx;
  if (Math.abs(denominator) < 1e-12) return null;
  const qx = b0[0] - a0[0];
  const qz = b0[1] - a0[1];
  const t = (qx * sz - qz * sx) / denominator;
  const u = (qx * rz - qz * rx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a0[0] + rx * t, a0[1] + rz * t];
}

/**
 * **A strip of ribbon between two signed offsets from the centreline**, draped
 * on the terrain `lift` above it — the paving (`-half` to `half`) and each band
 * of the kerb are all one of these.
 *
 * Both edges come from {@link ribbonEdge}, so neither folds. The lower offset
 * is laid first in each cross-section, which winds the quads anticlockwise seen
 * from above so the strip faces the sky. A triangle two of whose corners
 * collapsed onto one point (the fan at a tight corner) has no area and is not
 * emitted.
 */
export function addRibbonStrip(
  builder: GeometryBuilder,
  stations: readonly RibbonStation[],
  fromOffset: number,
  toOffset: number,
  lift: number,
  vAt: (travelled: number) => number,
): void {
  const low = ribbonEdge(stations, fromOffset);
  const high = ribbonEdge(stations, toOffset);
  for (let i = 0; i < stations.length; i += 1) {
    const v = vAt((stations[i] as RibbonStation).travelled);
    const [ax, az] = low[i] as [number, number];
    const [bx, bz] = high[i] as [number, number];
    builder.vertex(ax, terrainHeight(ax, az) + lift, az, 0, v);
    builder.vertex(bx, terrainHeight(bx, bz) + lift, bz, 1, v);
    if (i > 0) {
      const base = builder.vertexCount - 4;
      builder.triangle(base, base + 1, base + 2);
      builder.triangle(base + 1, base + 3, base + 2);
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
