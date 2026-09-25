import { BufferAttribute, BufferGeometry, CatmullRomCurve3, MeshStandardMaterial, Vector3 } from 'three';
import { PATH_KERB_LIFT, PATH_KERB_OVERHANG, PATH_SURFACE_LIFT } from '../core/constants';
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

/** Narrower than this in plan, metres, a triangle is a hairline nobody can see — see `GeometryBuilder.triangle`. */
const SLIVER_WIDTH = 1e-3;

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

  /** How many triangles have been indexed so far. */
  get triangleCount(): number {
    return this.indices.length / 3;
  }

  /** The three vertex indices of triangle `triangle`. */
  triangleAt(triangle: number): [number, number, number] {
    return [
      this.indices[triangle * 3] as number,
      this.indices[triangle * 3 + 1] as number,
      this.indices[triangle * 3 + 2] as number,
    ];
  }

  /** Where vertex `index` was laid, in plan. */
  planAt(index: number): [number, number] {
    return [this.positions[index * 3] as number, this.positions[index * 3 + 2] as number];
  }

  /**
   * One triangle — unless it is **narrower in plan than {@link SLIVER_WIDTH}**:
   * two corners laid on one point (a fan at a tight corner), or three laid on
   * one line. Such a triangle has no area anyone can see from above, and no
   * facing either: its plan area is below what `Float32Array` keeps of these
   * coordinates, so the sign that decides whether it is culled is rounding,
   * and a sliver standing on a sloping line comes out a vertical wall whose
   * normal is sideways. Measured, before this: 11 such slivers on the canonical
   * seed, none wider than a hair, every one read as face-down by the facing
   * invariant.
   */
  triangle(a: number, b: number, c: number): void {
    const x = (i: number): number => this.positions[i * 3] as number;
    const z = (i: number): number => this.positions[i * 3 + 2] as number;
    const twiceArea = Math.abs((z(b) - z(a)) * (x(c) - x(a)) - (x(b) - x(a)) * (z(c) - z(a)));
    const longest = Math.max(
      Math.hypot(x(b) - x(a), z(b) - z(a)),
      Math.hypot(x(c) - x(b), z(c) - z(b)),
      Math.hypot(x(a) - x(c), z(a) - z(c)),
    );
    if (longest === 0 || twiceArea / longest < SLIVER_WIDTH) return;
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
  const stations = ribbonStations(curve, divisions);
  const repaired = new Set<number>();
  const edges = ribbonEdges(stations, pathCrossSection(width), repaired);
  addRibbonStrip(builder, stations, edges[1]!, edges[2]!, lift, (travelled) => pathRibbonV(travelled, width));
  // Where the ribbon could not be swept as drawn, the paving is laid as what
  // it stands for: every point within half the path's width of the
  // centreline (`isOnPath`'s own discs). See `REPAIR_DISC_SEGMENTS`.
  for (const j of repaired) {
    const station = stations[j] as RibbonStation;
    addPavingDisc(builder, station.x, station.z, width / 2, lift);
  }
}

/**
 * **Segments round a disc of paving laid where `ribbonEdges` had to repair a
 * cross-section.**
 *
 * Drawing the inside of a turn in towards the centreline keeps every triangle
 * facing the sky, but the strip it leaves is narrower than the path: a route
 * that loops round inside its own width (seed 15's building-to-skyCruiser
 * connector circles 3.7 m across at (23.5, -24.8)) came out with a triangle of
 * lawn in the middle of its paving, 0.06 m², and a route retracing its own
 * last leg (seed 11 at (-21.0, 54.2)) with a slot of it. A disc of half-width
 * round each repaired station is exactly the ground the path claims there,
 * lies under the same material at the same lift, and is inside the kerb's
 * outer line everywhere, so the only thing it can change on screen is lawn
 * that should have been paving.
 */
const REPAIR_DISC_SEGMENTS = 24;

/** A flat fan of paving round `(cx, cz)`, draped on the terrain `lift` above it. */
function addPavingDisc(builder: GeometryBuilder, cx: number, cz: number, radius: number, lift: number): void {
  const centre = builder.vertexCount;
  builder.vertex(cx, terrainHeight(cx, cz) + lift, cz, cx / 6, cz / 6);
  for (let s = 0; s <= REPAIR_DISC_SEGMENTS; s += 1) {
    const angle = (s / REPAIR_DISC_SEGMENTS) * Math.PI * 2;
    const x = cx + Math.cos(angle) * radius;
    const z = cz + Math.sin(angle) * radius;
    // Textured by world position, as the plaza's disc is (`pathGraph.ts`).
    builder.vertex(x, terrainHeight(x, z) + lift, z, x / 6, z / 6);
  }
  // Anticlockwise seen from above (+Y), which `facesSky` calls face-up.
  for (let s = 0; s < REPAIR_DISC_SEGMENTS; s += 1) builder.triangle(centre, centre + s + 2, centre + s + 1);
}

/**
 * **Where a path's four edges run, as signed offsets from its centreline** —
 * outer kerb, paving, paving, outer kerb, left to right ascending. The one
 * owner of a path's cross-section: the paving is the middle strip and the
 * kerb the two outer ones, and all three are swept from these four edges
 * together by {@link ribbonEdges}, so the kerb's inner edge *is* the paving's
 * edge wherever a corner has trimmed it.
 */
export function pathCrossSection(width: number): readonly number[] {
  const half = width / 2;
  return [-half - PATH_KERB_OVERHANG, -half, half, half + PATH_KERB_OVERHANG];
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
 * **The edges of a swept ribbon, one per offset (ascending), as edges — not
 * as folds.**
 *
 * Offsetting every station along its across direction is exact on a straight
 * and wrong wherever the ribbon turns tighter than the offset: past that
 * radius the offset curve runs *backwards* between two cusps (a swallowtail),
 * and the quads laid between those stations are wound face-down — culled, so
 * a hole in the path. Every filleted corner in the park is ~1 m in radius
 * against a path half-width of 1.3-1.6 m, so this is the ordinary case, not a
 * corner case: 189 face-down paving triangles on the canonical seed, 243 on
 * seed 24.
 *
 * Two passes:
 *
 * 1. **Each edge is cut at its own swallowtail.** The true edge of a swept
 *    band round a tight corner is the offset curve with the loop cut off where
 *    it crosses itself. Each run of backward segments is found, the forward
 *    segment before it and the forward segment after it are intersected, and
 *    every station in between takes that one point: the inside of the corner
 *    becomes a fan about the paving's own corner, which is what a paved corner
 *    is.
 * 2. **Then every strip between neighbouring edges is made to face the sky,
 *    station by station.** A cut is not always available — a backtrack that is
 *    collinear, or one that runs off the end of a route — and two edges cut
 *    independently can still disagree about which cross-section is ahead. So
 *    wherever a triangle of any strip would be wound face-down, the **inside
 *    half** of the cross-section at that quad (both of its edges together, so
 *    the kerb band shrinks with the paving) is drawn in towards the centreline
 *    only as far as it must be for that triangle to face up — bisected, at the
 *    far station and then the near one. Failing that the inside kerb alone
 *    folds onto the paving edge it borders, then the outside half gives, and
 *    as a last resort the station is pinched to its centreline point. Every
 *    move is decided across **all** the edges at once, which is why this takes
 *    the whole cross-section: an edge two strips share moves for both or for
 *    neither, so the paving and its kerb still meet on one line.
 */
export function ribbonEdges(
  stations: readonly RibbonStation[],
  offsets: readonly number[],
  repaired?: Set<number>,
): [number, number][][] {
  const edges = offsets.map((offset) => cutSwallowtails(stations, offset));
  const last = stations.length - 1;

  /** The first triangle of quad `i`, in any strip, that would be wound face-down. */
  const firstInverted = (i: number): { low: number; high: number; which: 1 | 2 } | null => {
    for (let s = 0; s + 1 < edges.length; s += 1) {
      const low = edges[s] as [number, number][];
      const high = edges[s + 1] as [number, number][];
      if (facesSky(low[i]!, high[i]!, low[i + 1]!) < -FACING_NOISE) return { low: s, high: s + 1, which: 1 };
      if (facesSky(high[i]!, high[i + 1]!, low[i + 1]!) < -FACING_NOISE) return { low: s, high: s + 1, which: 2 };
    }
    return null;
  };
  /** Whether triangle `which` of the strip `low..high` in quad `i` is wound face-down. */
  const inverted = (i: number, low: number, high: number, which: 1 | 2): boolean => {
    const l = edges[low] as [number, number][];
    const h = edges[high] as [number, number][];
    return which === 1
      ? facesSky(l[i]!, h[i]!, l[i + 1]!) < -FACING_NOISE
      : facesSky(h[i]!, h[i + 1]!, l[i + 1]!) < -FACING_NOISE;
  };
  /**
   * Draws the vertices of edges `which` at station `j` in towards the
   * centreline (or `towards`) together, as far out as they can stay while
   * `ok()` holds. False, untouched, if not even the centreline itself will do.
   */
  const drawIn = (
    which: readonly number[],
    j: number,
    ok: () => boolean,
    towards: readonly [number, number] = [(stations[j] as RibbonStation).x, (stations[j] as RibbonStation).z],
  ): boolean => {
    const station = { x: towards[0], z: towards[1] };
    const was = which.map((e) => (edges[e] as [number, number][])[j] as [number, number]);
    const place = (t: number): void => {
      which.forEach((e, k) => {
        const [ox, oz] = was[k] as [number, number];
        (edges[e] as [number, number][])[j] = [station.x + (ox - station.x) * t, station.z + (oz - station.z) * t];
      });
    };
    place(0);
    if (!ok()) {
      which.forEach((e, k) => {
        (edges[e] as [number, number][])[j] = was[k] as [number, number];
      });
      return false;
    }
    let good = 0;
    let bad = 1;
    for (let step = 0; step < DRAW_IN_STEPS; step += 1) {
      const t = (good + bad) / 2;
      place(t);
      if (ok()) good = t;
      else bad = t;
    }
    place(good);
    if (good < 1 - 1e-3) repaired?.add(j);
    return true;
  };

  /** Every edge at station `j` drawn all the way in to the centreline. */
  const pinch = (j: number): void => {
    repaired?.add(j);
    const station = stations[j] as RibbonStation;
    for (const edge of edges) edge[j] = [station.x, station.z];
  };

  /** How many triangles of quads `from..to` are wound face-down. */
  const invertedIn = (from: number, to: number): number => {
    let count = 0;
    for (let i = Math.max(0, from); i <= Math.min(last - 1, to); i += 1) {
      for (let s = 0; s + 1 < edges.length; s += 1) {
        if (inverted(i, s, s + 1, 1)) count += 1;
        if (inverted(i, s, s + 1, 2)) count += 1;
      }
    }
    return count;
  };

  // Swept until a whole pass finds nothing to mend: drawing a corner in at
  // one station can disturb the quad before it, so a mend is allowed to reach
  // back one station and the sweep then comes round again.
  for (let pass = 0; pass < REPAIR_PASSES; pass += 1) {
    let mended = false;
    for (let i = 0; i < last; i += 1) {
      for (let attempt = 0; attempt < 4 * edges.length; attempt += 1) {
        const wrong = firstInverted(i);
        if (!wrong) break;
        mended = true;
        const { low, high, which } = wrong;
        const before = invertedIn(i - 1, i);
        const ok = (): boolean => !inverted(i, low, high, which) && invertedIn(i - 1, i) < before;
        // Which side is the inside of this turn: the one the next station's
        // travel leans towards.
        const here = stations[i] as RibbonStation;
        const next = stations[i + 1] as RibbonStation;
        const leftTurn = next.acrossZ * here.acrossX - next.acrossX * here.acrossZ > 0;
        const inside = (e: number): boolean => ((offsets[e] as number) > 0) === leftTurn;
        // The inside half of the cross-section gives first — both of its
        // edges together, so the kerb band on that side shrinks with the
        // paving rather than folding against it — at the far station, then
        // the near one, then both. The inside of a turn tighter than the path
        // is wide is the part that cannot be where the offset puts it, and the
        // centreline is the last point on it that still advances.
        const insideEdges = offsets.map((_, e) => e).filter(inside);
        const outsideEdges = offsets.map((_, e) => e).filter((e) => !inside(e));
        const groups: [readonly number[], number][] = [
          [insideEdges, i + 1],
          [insideEdges, i],
        ];
        let fixed = false;
        for (const [group, j] of groups) {
          if (drawIn(group, j, ok)) {
            fixed = true;
            break;
          }
        }
        // The inside kerb alone, folded onto the paving edge it borders: on
        // the inside of a hairpin the two are cut at different corners, and
        // a kerb band of no width there is one nobody could have seen.
        for (const j of [i + 1, i]) {
          if (fixed) break;
          for (const e of [0, edges.length - 1]) {
            if (!inside(e) || edges.length < 2) continue;
            const neighbour = (edges[e === 0 ? 1 : edges.length - 2] as [number, number][])[j] as [number, number];
            if (drawIn([e], j, ok, neighbour)) {
              fixed = true;
              break;
            }
          }
        }
        for (const [group, j] of [
          [outsideEdges, i + 1],
          [outsideEdges, i],
        ] as [readonly number[], number][]) {
          if (fixed) break;
          if (drawIn(group, j, ok)) {
            fixed = true;
          }
        }
        if (!fixed) {
          // The inside half at the near station all the way in to the
          // centreline, and the far one as far out as will then do.
          const near = stations[i] as RibbonStation;
          const was = insideEdges.map((e) => (edges[e] as [number, number][])[i] as [number, number]);
          for (const e of insideEdges) (edges[e] as [number, number][])[i] = [near.x, near.z];
          if (drawIn(insideEdges, i + 1, ok)) {
            repaired?.add(i);
            fixed = true;
          } else {
            insideEdges.forEach((e, k) => {
              (edges[e] as [number, number][])[i] = was[k] as [number, number];
            });
          }
        }
        if (fixed) continue;
        // Nothing short of the centreline will do: pinch this cross-section
        // to its centreline point, and the one before it too if the
        // centreline itself steps backwards here (a jog in the control
        // points). A pinched station is a point, so every triangle it makes
        // with its neighbours is either empty or faces the way the
        // centreline goes — and the next station is its own cross-section
        // again, so the pinch is one station long rather than a hold that
        // goes stale as the route turns.
        pinch(i + 1);
        if (firstInverted(i)) pinch(i);
        break;
      }
    }
    if (!mended) break;
  }
  // Whatever the sweeps left, pinched away. Every pinch empties the quads
  // either side of it and a pinched station stays pinched, so this ends.
  for (let i = 0; i < last; i += 1) {
    if (!firstInverted(i)) continue;
    pinch(i);
    pinch(i + 1);
    i = Math.max(-1, i - 2);
  }
  return edges;
}

/** Most sweeps of {@link ribbonEdges}' repair; one or two is the ordinary case. */
const REPAIR_PASSES = 16;

/** Bisection steps when drawing an edge vertex in — 2^-24 of a path's half-width is far below anything drawn. */
const DRAW_IN_STEPS = 24;

/** Twice the signed plan area below which a triangle's facing is float noise, m². */
const FACING_NOISE = 1e-12;

/**
 * Positive when the plan triangle `a, b, c`, in that order, is wound to face
 * the sky under the winding this builder emits (see {@link addRibbonStrip}).
 */
function facesSky(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): number {
  return (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
}

/** One edge, `offset` to the left of the centreline, with each swallowtail cut at its crossing. */
function cutSwallowtails(stations: readonly RibbonStation[], offset: number): [number, number][] {
  const edge = stations.map((s): [number, number] => [s.x + s.acrossX * offset, s.z + s.acrossZ * offset]);
  const last = edge.length - 1;
  const moves = (i: number): boolean => {
    const a = edge[i] as [number, number];
    const b = edge[i + 1] as [number, number];
    return Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) > 1e-12;
  };
  const backward = (i: number): boolean => {
    if (!moves(i)) return false;
    const si = stations[i] as RibbonStation;
    const sj = stations[i + 1] as RibbonStation;
    // Travel direction is the across direction turned back a quarter.
    const fx = si.acrossZ + sj.acrossZ;
    const fz = -si.acrossX - sj.acrossX;
    return (edge[i + 1]![0] - edge[i]![0]) * fx + (edge[i + 1]![1] - edge[i]![1]) * fz <= 0;
  };

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
    //
    // Only a swallowtail's own reach is searched: a turn of the offset curve
    // folds back over at most about twice the offset of centreline either side
    // of where it runs backwards. Past that, a crossing is not this corner's
    // loop but the route coming back past itself — a spur that doubles back
    // (seed 20260728 route 17 turns through 180° and returns along its own
    // outbound leg) — and cutting there would delete everything in between.
    const reach = 2 * Math.abs(offset) + EDGE_REACH_SLACK;
    const from = (stations[start] as RibbonStation).travelled - reach;
    const to = (stations[end + 1] as RibbonStation).travelled + reach;
    let cut: { before: number; after: number; at: [number, number] } | null = null;
    for (let after = end + 1; after < last && (stations[after] as RibbonStation).travelled <= to; after += 1) {
      for (let before = start - 1; before >= 0 && (stations[before + 1] as RibbonStation).travelled >= from; before -= 1) {
        if (cut && after - before >= cut.after - cut.before) break;
        const at = segmentCrossing(edge[before]!, edge[before + 1]!, edge[after]!, edge[after + 1]!);
        if (at) cut = { before, after, at };
      }
    }
    if (!cut) {
      // Nothing to cut against: `ribbonEdges`' second pass holds this one.
      i = end + 1;
      continue;
    }
    for (let k = cut.before + 1; k <= cut.after; k += 1) edge[k] = [cut.at[0], cut.at[1]];
    i = cut.after;
  }
  return edge;
}

/** Centreline, metres, searched for a swallowtail's crossing beyond twice its offset. */
const EDGE_REACH_SLACK = 0.5;

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
 * **A strip of ribbon between two of {@link ribbonEdges}' edges**, draped on
 * the terrain `lift` above it — the paving and each band of the kerb are all
 * one of these.
 *
 * The lower offset's edge is laid first in each cross-section, which winds the
 * quads anticlockwise seen from above so the strip faces the sky. A triangle
 * two of whose corners were held onto one point (a fan at a tight corner) has
 * no area and is not emitted.
 */
export function addRibbonStrip(
  builder: GeometryBuilder,
  stations: readonly RibbonStation[],
  low: readonly (readonly [number, number])[],
  high: readonly (readonly [number, number])[],
  lift: number,
  vAt: (travelled: number) => number,
): void {
  for (let i = 0; i < stations.length; i += 1) {
    const v = vAt((stations[i] as RibbonStation).travelled);
    const [ax, az] = low[i] as readonly [number, number];
    const [bx, bz] = high[i] as readonly [number, number];
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

/**
 * A point on the ground; `y` comes from the terrain wherever one is used —
 * unless the point carries its own. An edge that is **somebody else's
 * boundary** (the gateway path's road end) hands over that surface's own
 * height there, so the two meshes meet on one line in space rather than on
 * one line in plan with a step between them.
 */
export interface PathEdgePoint {
  readonly x: number;
  readonly z: number;
  readonly y?: number;
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
      // The two edge rows take a height they were handed, if they were.
      const given = row === 0 ? a.y : row === rows ? b.y : undefined;
      builder.vertex(
        x,
        given ?? terrainHeight(x, z) + lift,
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
