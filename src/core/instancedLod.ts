import { BufferAttribute, BufferGeometry, type Matrix4 } from 'three';

/**
 * **Level of detail for instanced things** — the shared half of step 16 of
 * docs/perf/FRAME-DROPS-2026-11.md. `InstancedCrowd` is the first user; nothing
 * here knows what a crowd or a child is.
 *
 * Two questions, one owner each:
 *
 * 1. **What does the cheap level look like?** {@link lowDetailGeometry} derives
 *    it from the geometry it replaces, at load, so there is no second authored
 *    model to keep in step with the first: retune the model and its far level
 *    follows on the next reload.
 * 2. **Which level does this instance want through this camera?**
 *    {@link projectedDiameterPx} and {@link nextLodLevel} — by how big it is
 *    **on screen**, never by raw distance. The park camera is a 9.5° lens
 *    ~120 m away, so everything is at the same distance and distance says
 *    nothing; what the camera does say is that everything is small.
 */

/** Full detail: the geometry as authored. */
export const LOD_FULL = 0;
/** The far level: {@link lowDetailGeometry}. */
export const LOD_LOW = 1;

/**
 * An instance goes to full detail once its bounding sphere is drawn wider than
 * this many device pixels, and back to the far level once it is narrower than
 * {@link LOD_LOW_BELOW_PX}. Between the two it keeps whatever it had, so nobody
 * flickers on the boundary.
 *
 * Measured on the crowd's children, the sphere `InstancedCrowd` keeps round a
 * child is about 1.8 × her height, so these are a child roughly 150 px tall,
 * ± 10 %. The ordinary camera draws her ~23 px tall: always the far level.
 */
export const LOD_FULL_ABOVE_PX = 300;
export const LOD_LOW_BELOW_PX = 245;

/** The far level's triangle budget, as a share of the geometry it stands in for. */
export const LOD_LOW_TRIANGLE_RATIO = 0.25;

/** Below this many triangles a geometry is its own far level: nothing to save. */
export const LOD_MIN_TRIANGLES = 48;

/**
 * The drawing-buffer height assumed when a caller cannot say (a headless
 * check, a preview with no renderer to ask). A real render passes its own.
 */
export const LOD_DEFAULT_VIEWPORT_HEIGHT_PX = 1080;

/**
 * How many device pixels wide a sphere of `radius` at world (x, y, z) is drawn.
 *
 * `viewProjection` is `projection × view`; `pixelsPerUnitAtW1` is
 * `projection.elements[5] × viewportHeightPx / 2`. Written against clip-space
 * `w` so the one formula serves a perspective lens (w is the depth) and an
 * orthographic one (w is 1), zoom included, with no camera type test.
 *
 * At or behind the lens the answer is `Infinity`: as close as a thing gets.
 */
export function projectedDiameterPx(
  viewProjection: Matrix4,
  pixelsPerUnitAtW1: number,
  x: number,
  y: number,
  z: number,
  radius: number,
): number {
  const e = viewProjection.elements;
  const w = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
  if (w <= 1e-6) return Infinity;
  return (2 * radius * pixelsPerUnitAtW1) / w;
}

/**
 * `?lod=off` on any URL draws everything at full detail — the same build with
 * the far level never chosen, so the two can be compared at one seed and one
 * spot (counts, and a screenshot of each). A URL a developer types, in the
 * spirit of `?perf=1`; a headless check has no `location` and is never off.
 */
let lodEnabled = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('lod') === 'off');

/**
 * Turns the far level off, or back on, for everything from the next draw —
 * what `?lod=off` sets at boot, for a harness that wants both from one frozen
 * frame. Nothing in the game calls it.
 */
export function setLodEnabled(enabled: boolean): void {
  lodEnabled = enabled;
}

/** The level an instance drawn `px` wide should use, given the one it has. */
export function nextLodLevel(current: number, px: number): number {
  if (!lodEnabled) return LOD_FULL;
  if (px > LOD_FULL_ABOVE_PX) return LOD_FULL;
  if (px < LOD_LOW_BELOW_PX) return LOD_LOW;
  return current;
}

const lowCache = new WeakMap<BufferGeometry, BufferGeometry>();

/**
 * The far level of `source`: at most {@link LOD_LOW_TRIANGLE_RATIO} of its
 * triangles. Computed once per geometry and shared by everything drawing it.
 *
 * Returns `source` itself when there is nothing to gain or it cannot be done
 * safely (tiny, morph targets) — so a caller can always draw what it gets
 * back, and compares with `===` to learn there is no second level.
 *
 * **For single-material draws only**: the far level has no `groups`, so a mesh
 * drawn with a material array must not use it.
 */
export function lowDetailGeometry(source: BufferGeometry): BufferGeometry {
  const cached = lowCache.get(source);
  if (cached) return cached;
  const triangles = triangleCount(source);
  const low =
    triangles < LOD_MIN_TRIANGLES
      ? source
      : (clusterSimplify(source, Math.max(LOD_MIN_TRIANGLES / 2, Math.floor(triangles * LOD_LOW_TRIANGLE_RATIO))) ?? source);
  lowCache.set(source, low);
  return low;
}

/** Triangles a geometry draws. */
export function triangleCount(geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position');
  if (!position) return 0;
  return Math.floor((geometry.index ? geometry.index.count : position.count) / 3);
}

/** The finest grid, in cells along the longest side, a simplification tries. */
const FINEST_GRID = 48;

/**
 * Simplifies by **vertex clustering**: lay a grid over the geometry, keep one
 * of its own vertices per occupied cell, re-point every triangle at the kept
 * vertices and drop the ones that collapse.
 *
 * Why this and not an edge-collapse simplifier: it is linear in the vertex
 * count (the whole crowd child, 40 k triangles, is a few milliseconds at load,
 * where three's `SimplifyModifier` is quadratic), it is deterministic, and it
 * has three properties culling and texturing depend on —
 *
 * - **Every kept vertex is one the source had**, chosen as the one farthest
 *   from the middle of its cell's geometry. So the result lies inside the
 *   source's convex hull — every bound that holds the source holds this, with
 *   no second set of bounds — and it keeps the outline's reach rather than
 *   shrinking toward cell centres as averaging does.
 * - **Its UVs, colours and every other attribute are that vertex's own**,
 *   never a blend across a seam: a face texture lands where it was painted.
 * - **Vertices that shared a position still share one**, so a closed surface
 *   stays closed: no cracks to see the sky through.
 *
 * Each side of the box that has any thickness gets at least two cells, so a
 * thin part (a bag strap) keeps a cross-section instead of flattening to a
 * line. The grid is the finest one that comes in at or under `maxTriangles`.
 *
 * Returns `null` if the geometry cannot be simplified to that budget.
 */
export function clusterSimplify(source: BufferGeometry, maxTriangles: number): BufferGeometry | null {
  const position = source.getAttribute('position');
  // `groups` are not carried over, and need not be: this is for instanced
  // draws with one material, which never read them. (Every box- and
  // extrude-derived geometry has groups whether or not anything uses them.)
  if (!position) return null;
  for (const targets of Object.values(source.morphAttributes)) {
    if ((targets?.length ?? 0) > 0) return null;
  }
  const index = source.index;
  const vertexTotal = position.count;
  const triangleTotal = triangleCount(source);
  if (triangleTotal === 0) return null;
  const corner = (i: number): number => (index ? index.getX(i) : i);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertexTotal; i += 1) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const sizeX = maxX - minX, sizeY = maxY - minY, sizeZ = maxZ - minZ;
  const longest = Math.max(sizeX, sizeY, sizeZ);
  if (!(longest > 0)) return null;
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2, midZ = (minZ + maxZ) / 2;

  /** Squared distance of each vertex from the middle of the box: who wins a cell. */
  const reach = new Float64Array(vertexTotal);
  for (let i = 0; i < vertexTotal; i += 1) {
    const dx = position.getX(i) - midX, dy = position.getY(i) - midY, dz = position.getZ(i) - midZ;
    reach[i] = dx * dx + dy * dy + dz * dz;
  }

  const cellOf = new Int32Array(vertexTotal);
  /** Vertex → the source vertex standing in for its cell. */
  const keptFor = new Int32Array(vertexTotal);
  const winner = new Map<number, number>();
  const cellsAlong = (size: number, cell: number): number =>
    size <= longest * 1e-6 ? 1 : Math.max(2, Math.ceil(size / cell - 1e-9));

  /** Clusters on a grid `n` cells along the longest side; returns the triangles that survive. */
  const cluster = (n: number): number => {
    const cell = longest / n;
    const nx = cellsAlong(sizeX, cell), ny = cellsAlong(sizeY, cell), nz = cellsAlong(sizeZ, cell);
    winner.clear();
    for (let i = 0; i < vertexTotal; i += 1) {
      const ix = nx === 1 ? 0 : Math.min(nx - 1, Math.floor(((position.getX(i) - minX) / sizeX) * nx));
      const iy = ny === 1 ? 0 : Math.min(ny - 1, Math.floor(((position.getY(i) - minY) / sizeY) * ny));
      const iz = nz === 1 ? 0 : Math.min(nz - 1, Math.floor(((position.getZ(i) - minZ) / sizeZ) * nz));
      const key = ix + nx * (iy + ny * iz);
      cellOf[i] = key;
      const held = winner.get(key);
      // Strictly farther wins, so a tie keeps the lower index: deterministic.
      if (held === undefined || reach[i]! > reach[held]!) winner.set(key, i);
    }
    for (let i = 0; i < vertexTotal; i += 1) keptFor[i] = winner.get(cellOf[i]!)!;
    let survive = 0;
    for (let t = 0; t < triangleTotal; t += 1) {
      const a = keptFor[corner(t * 3)]!, b = keptFor[corner(t * 3 + 1)]!, c = keptFor[corner(t * 3 + 2)]!;
      if (a !== b && b !== c && a !== c) survive += 1;
    }
    return survive;
  };

  // The finest grid at or under budget. Survivors are not strictly monotonic
  // in `n`, which can only cost a little detail: the grid taken is always one
  // that was measured under budget.
  let best = -1;
  for (let lo = 1, hi = FINEST_GRID; lo <= hi; ) {
    const mid = (lo + hi) >> 1;
    if (cluster(mid) <= maxTriangles) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best < 0) return null;
  cluster(best);

  // Number the kept vertices, and keep each surviving triangle once.
  const slotOf = new Int32Array(vertexTotal).fill(-1);
  const kept: number[] = [];
  for (let i = 0; i < vertexTotal; i += 1) {
    const k = keptFor[i]!;
    if (slotOf[k]! < 0) {
      slotOf[k] = kept.length;
      kept.push(k);
    }
  }
  const keptTotal = kept.length;
  const seen = new Set<number>();
  const faces: number[] = [];
  for (let t = 0; t < triangleTotal; t += 1) {
    let a = slotOf[keptFor[corner(t * 3)]!]!;
    let b = slotOf[keptFor[corner(t * 3 + 1)]!]!;
    let c = slotOf[keptFor[corner(t * 3 + 2)]!]!;
    if (a === b || b === c || a === c) continue;
    // Rotate the smallest corner to the front — same triangle, same winding.
    while (a > b || a > c) {
      const first = a;
      a = b;
      b = c;
      c = first;
    }
    const key = (a * keptTotal + b) * keptTotal + c;
    if (seen.has(key)) continue;
    seen.add(key);
    faces.push(a, b, c);
  }
  // A part must never simplify away to nothing.
  if (faces.length < 4 * 3) return null;

  const low = new BufferGeometry();
  low.name = source.name ? `${source.name}:low` : 'low';
  low.userData = { ...source.userData };
  for (const name in source.attributes) {
    const from = source.getAttribute(name);
    const size = from.itemSize;
    const values = new Float32Array(keptTotal * size);
    for (let k = 0; k < keptTotal; k += 1) {
      for (let c = 0; c < size; c += 1) values[k * size + c] = from.getComponent(kept[k]!, c);
    }
    low.setAttribute(name, new BufferAttribute(values, size));
  }

  // A kept vertex now stands for a whole cell of surface, so it is lit by the
  // mean of the normals it replaced — those facing its own way only, so the two
  // sides of a thin shell that share a cell do not cancel to nonsense.
  const normal = source.getAttribute('normal');
  const lowNormal = low.getAttribute('normal');
  if (normal && lowNormal) {
    const sum = new Float64Array(keptTotal * 3);
    for (let i = 0; i < vertexTotal; i += 1) {
      const k = keptFor[i]!;
      const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i);
      if (nx * normal.getX(k) + ny * normal.getY(k) + nz * normal.getZ(k) <= 0) continue;
      const s = slotOf[k]! * 3;
      sum[s] = sum[s]! + nx;
      sum[s + 1] = sum[s + 1]! + ny;
      sum[s + 2] = sum[s + 2]! + nz;
    }
    for (let k = 0; k < keptTotal; k += 1) {
      const x = sum[k * 3]!, y = sum[k * 3 + 1]!, z = sum[k * 3 + 2]!;
      const length = Math.sqrt(x * x + y * y + z * z);
      if (length > 1e-9) lowNormal.setXYZ(k, x / length, y / length, z / length);
    }
  }

  low.setIndex(new BufferAttribute(keptTotal > 65535 ? new Uint32Array(faces) : new Uint16Array(faces), 1));
  return low;
}
