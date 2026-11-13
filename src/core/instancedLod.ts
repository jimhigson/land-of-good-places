import { BufferAttribute, BufferGeometry, type InterleavedBufferAttribute, type Matrix4 } from 'three';

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
 *    **on screen, in CSS pixels**, never by raw distance and never in device
 *    pixels. The park camera is a 9.5° lens ~120 m away, so everything is at
 *    the same distance and distance says nothing. And a device pixel is not a
 *    size: the same child on the same window is twice as many of them on a
 *    retina panel, and a different number again whenever the resolution
 *    governor (`core/adaptiveResolution.ts`) steps — a rule in device pixels
 *    put every child at full detail on exactly the screens that can least
 *    afford it.
 */

/** Full detail: the geometry as authored. */
export const LOD_FULL = 0;
/** The far level: {@link lowDetailGeometry} at {@link LOD_LOW_TOLERANCE_M}. */
export const LOD_LOW = 1;

/**
 * An instance goes to full detail once its bounding sphere is drawn taller
 * than this **share of the picture's height**, and back to the far level once
 * it is shorter than {@link LOD_LOW_BELOW_SHARE}. Between the two it keeps
 * whatever it had, so nobody flickers on the boundary.
 *
 * A share of the picture, not a count of pixels, so the choice is the same at
 * device pixel ratio 1, 2 and 3, under every step of the resolution governor
 * (`core/adaptiveResolution.ts`) and on a canvas of any size: the camera
 * frames a fixed height of world (`CAMERA_VIEW_HEIGHT` at zoom 1), so the same
 * child at the same zoom is the same share of every screen, and it is the
 * zoom — her pinch, a ride, a cut-scene — that brings her close. In CSS
 * pixels on a 900-pixel-tall window the switch is at 900 × this.
 *
 * The values, and the evidence for them, are with {@link LOD_LOW_TOLERANCE_M}.
 */
export const LOD_FULL_ABOVE_SHARE = 0.25;
export const LOD_LOW_BELOW_SHARE = 0.2;

/**
 * How far the far level may stand from the authored surface, in metres of
 * world: see {@link simplifyWithin} for exactly what is bounded.
 */
export const LOD_LOW_TOLERANCE_M = 0.006;

/** Below this many triangles a geometry is its own far level: nothing to save. */
export const LOD_MIN_TRIANGLES = 48;

/**
 * A far level that saves less than this share of its source's triangles is
 * not worth a second mesh (a second buffer, and a second draw call whenever
 * both levels are on screen), and the part keeps its source.
 */
export const LOD_MIN_SAVING = 0.1;

/**
 * How tall a sphere of `radius` at world (x, y, z) is drawn, as a share of
 * the picture's height (1 = the whole height).
 *
 * `viewProjection` is `projection × view` and `lensScale` is
 * `projection.elements[5]`. Written against clip-space `w` so the one formula
 * serves a perspective lens (w is the depth) and an orthographic one (w is
 * 1), zoom included, with no camera type test: clip-space y spans 2 across
 * the picture, and a sphere's half-height there is `radius × lensScale / w`.
 *
 * At or behind the lens the answer is `Infinity`: as close as a thing gets.
 */
export function projectedShare(
  viewProjection: Matrix4,
  lensScale: number,
  x: number,
  y: number,
  z: number,
  radius: number,
): number {
  const e = viewProjection.elements;
  const w = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
  if (w <= 1e-6) return Infinity;
  return (radius * lensScale) / w;
}

/**
 * How the level is chosen: `auto` by size on screen (the game), `off` for
 * full detail everywhere, `low` for the far level everywhere — the last two so
 * the same frame can be drawn both ways and compared.
 */
export type LodMode = 'auto' | 'off' | 'low';

/**
 * `?crowdLod=off` (or `low`, or `auto`) on any URL sets the mode at boot: the
 * same build, the same seed, the same spot, with the far level never or
 * always chosen. A URL a developer types, in the spirit of `?perf=1`; a
 * headless check has no `location` and is always `auto`.
 */
function modeFromUrl(): LodMode {
  if (typeof location === 'undefined') return 'auto';
  const asked = new URLSearchParams(location.search).get('crowdLod');
  return asked === 'off' || asked === 'low' ? asked : 'auto';
}
let lodMode: LodMode = modeFromUrl();

/**
 * The mode in force. `off` is the engine as it was before levels of detail:
 * full detail everywhere, shadows included.
 */
export function getLodMode(): LodMode {
  return lodMode;
}

/**
 * Changes the mode for everything from the next draw — what `?crowdLod=` sets
 * at boot, for a harness that wants every mode from one frozen frame. Nothing
 * in the game calls it.
 */
export function setLodMode(mode: LodMode): void {
  lodMode = mode;
}

/**
 * The level an instance drawn `share` of the picture tall (see
 * {@link projectedShare}) should use, given the one it has.
 */
export function nextLodLevel(current: number, share: number): number {
  if (lodMode !== 'auto') return lodMode === 'off' ? LOD_FULL : LOD_LOW;
  if (share > LOD_FULL_ABOVE_SHARE) return LOD_FULL;
  if (share < LOD_LOW_BELOW_SHARE) return LOD_LOW;
  return current;
}

/** Far levels already derived, per source geometry and then per {@link levelKey}. */
const lowCache = new WeakMap<BufferGeometry, Map<string, BufferGeometry>>();

/**
 * The cheaper drawing of `source` that stays within `tolerance` of it — in
 * the geometry's own units, so a caller drawing it scaled divides the world
 * tolerance by that scale. Computed once per geometry and tolerance, and
 * shared by everything drawing it.
 *
 * `textured` says whether anything drawn with it reads its UVs. Where nothing
 * does (a part tinted by `instanceColor` and lit by a ramp), a UV seam is not
 * a feature worth keeping and the simplifier may work across it.
 *
 * Returns `source` itself when there is nothing to gain or it cannot be done
 * safely (tiny, morph targets, or less than {@link LOD_MIN_SAVING} saved) — so
 * a caller can always draw what it gets back, and compares with `===` to
 * learn there is no second level.
 *
 * **For single-material draws only**: the far level has no `groups`, so a mesh
 * drawn with a material array must not use it.
 */
export function lowDetailGeometry(source: BufferGeometry, tolerance: number, textured = true): BufferGeometry {
  let levels = lowCache.get(source);
  if (!levels) lowCache.set(source, (levels = new Map()));
  const key = `${tolerance}:${textured ? 1 : 0}`;
  const cached = levels.get(key);
  if (cached) return cached;
  const triangles = triangleCount(source);
  const simplified = triangles < LOD_MIN_TRIANGLES ? null : simplifyWithin(source, tolerance, textured);
  const low = simplified && triangleCount(simplified) <= triangles * (1 - LOD_MIN_SAVING) ? simplified : source;
  levels.set(key, low);
  return low;
}

/** Triangles a geometry draws. */
export function triangleCount(geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position');
  if (!position) return 0;
  return Math.floor((geometry.index ? geometry.index.count : position.count) / 3);
}

/**
 * Two corners at one place belong to different smoothing groups when their
 * normals are further apart than this (a cosine: ~45°). A box's edge is; two
 * facets of a faceted curve are not.
 */
const CREASE_COS = 0.7;

/**
 * A corner whose normal is further than this from its own face's (a cosine:
 * ~35°) sits on a fold its normals were smoothed round — see `pinned` in
 * {@link simplifyWithin}.
 */
const FOLD_COS = 0.82;

/** A collapse may turn a face by this much and no further (a cosine: ~78°). */
const FLIP_COS = 0.2;

/**
 * Simplifies by **edge collapse under a distance bound**: repeatedly merges a
 * vertex into a neighbour, cheapest first, for as long as the vertex that is
 * kept stays within `tolerance` of every face it now stands in for.
 *
 * The bound is the classic quadric one (Garland & Heckbert), kept honest: each
 * vertex carries the planes of the source faces it has absorbed, unweighted,
 * and a collapse is allowed only while the root of the summed squared
 * distances from the kept vertex to all of them is under `tolerance`. A sum
 * is never less than its largest term, so no kept vertex is further than
 * `tolerance` from any plane it replaced — and the more a vertex has
 * absorbed, the less room it has left, so error cannot creep.
 *
 * That one rule is what protects fine features without a list of them. A
 * spike's tip is a long way from the planes of its own sides as seen from any
 * neighbour, so it stays; a flat panel cut into forty triangles is no
 * distance from anything, so it goes. Nothing here knows which is hair.
 *
 * Properties culling, texturing and lighting depend on:
 *
 * - **Every kept vertex is one the source had**, at the source's position.
 *   So the result lies inside the source's convex hull — every bound that
 *   holds the source holds this — and nothing is averaged toward the inside.
 * - **Its normal, UV and every other attribute are that vertex's own**, never
 *   a blend: a face texture lands where it was painted and a ramp-lit surface
 *   is lit as it was.
 * - **Edges that mean something are kept as edges.** An open border, a hard
 *   crease (normals {@link CREASE_COS} apart) and — when `textured` — a UV
 *   seam: a vertex on one may only slide along it, and one where they meet or
 *   end does not move. Borders also carry a plane of their own, so an open
 *   shell cannot shrink back from its rim.
 * - **The surface stays a surface**: a collapse that would pinch it (the link
 *   condition) or fold a face over ({@link FLIP_COS}) is refused, and vertices
 *   that shared a position still share one, so a closed part stays closed.
 *
 * Linear-ish in practice (a heap of candidate collapses); the crowd child's
 * forty thousand triangles are tens of milliseconds at load.
 *
 * Returns `null` if the geometry cannot be simplified at all.
 */
export function simplifyWithin(source: BufferGeometry, tolerance: number, textured = true): BufferGeometry | null {
  const position = source.getAttribute('position');
  // `groups` are not carried over, and need not be: this is for instanced
  // draws with one material, which never read them.
  if (!position || !(tolerance > 0)) return null;
  for (const targets of Object.values(source.morphAttributes)) {
    if ((targets?.length ?? 0) > 0) return null;
  }
  const index = source.index;
  const vertexTotal = position.count;
  const sourceTriangles = triangleCount(source);
  if (sourceTriangles === 0) return null;
  const corner = (i: number): number => (index ? index.getX(i) : i);

  // ---- Places: vertices that share a position are one point of the surface.
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
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  if (!(diagonal > 0)) return null;
  // A seam's two sides are computed separately (cos 0 against cos 2π) and can
  // differ in the last bit; a millionth of the part is far below any feature.
  const weld = diagonal * 1e-6;
  const placeOf = new Int32Array(vertexTotal);
  const xs: number[] = [], ys: number[] = [], zs: number[] = [];
  const places = new Map<string, number>();
  for (let i = 0; i < vertexTotal; i += 1) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const key = `${Math.round(x / weld)},${Math.round(y / weld)},${Math.round(z / weld)}`;
    let place = places.get(key);
    if (place === undefined) {
      place = xs.length;
      places.set(key, place);
      xs.push(x);
      ys.push(y);
      zs.push(z);
    }
    placeOf[i] = place;
  }
  const placeTotal = xs.length;

  // ---- Wedges: what a corner looks like there. Two corners at one place
  // agree when one smooth, unseamed surface passes through both.
  const normal = source.getAttribute('normal');
  const compared: (BufferAttribute | InterleavedBufferAttribute)[] = [];
  if (textured) {
    for (const name in source.attributes) {
      if (name !== 'position' && name !== 'normal') compared.push(source.getAttribute(name));
    }
  }
  const agree = (a: number, b: number): boolean => {
    if (a === b) return true;
    if (normal) {
      const dot = normal.getX(a) * normal.getX(b) + normal.getY(a) * normal.getY(b) + normal.getZ(a) * normal.getZ(b);
      if (dot < CREASE_COS) return false;
    }
    for (const attribute of compared) {
      for (let c = 0; c < attribute.itemSize; c += 1) {
        if (Math.abs(attribute.getComponent(a, c) - attribute.getComponent(b, c)) > 1e-5) return false;
      }
    }
    return true;
  };
  /** How unlike two corners are: 0 for the same wedge, growing with the turn between their normals. */
  const unlike = (a: number, b: number): number => {
    if (a === b) return 0;
    let d = agree(a, b) ? 0 : 4;
    if (normal) d += 1 - (normal.getX(a) * normal.getX(b) + normal.getY(a) * normal.getY(b) + normal.getZ(a) * normal.getZ(b));
    return d;
  };

  // ---- Triangles, as places (the shape) and as source vertices (the look).
  const tp = new Int32Array(sourceTriangles * 3);
  const tw = new Int32Array(sourceTriangles * 3);
  const live = new Uint8Array(sourceTriangles);
  const around: number[][] = [];
  for (let p = 0; p < placeTotal; p += 1) around.push([]);
  for (let t = 0; t < sourceTriangles; t += 1) {
    const a = corner(t * 3), b = corner(t * 3 + 1), c = corner(t * 3 + 2);
    const pa = placeOf[a]!, pb = placeOf[b]!, pc = placeOf[c]!;
    tw[t * 3] = a;
    tw[t * 3 + 1] = b;
    tw[t * 3 + 2] = c;
    tp[t * 3] = pa;
    tp[t * 3 + 1] = pb;
    tp[t * 3 + 2] = pc;
    if (pa === pb || pb === pc || pa === pc) continue;
    live[t] = 1;
    around[pa]!.push(t);
    around[pb]!.push(t);
    around[pc]!.push(t);
  }

  // ---- Each place's quadric: the planes it must stay close to.
  const quadric = new Float64Array(placeTotal * 10);
  const addPlane = (place: number, a: number, b: number, c: number, d: number): void => {
    const o = place * 10;
    quadric[o] = quadric[o]! + a * a;
    quadric[o + 1] = quadric[o + 1]! + a * b;
    quadric[o + 2] = quadric[o + 2]! + a * c;
    quadric[o + 3] = quadric[o + 3]! + a * d;
    quadric[o + 4] = quadric[o + 4]! + b * b;
    quadric[o + 5] = quadric[o + 5]! + b * c;
    quadric[o + 6] = quadric[o + 6]! + b * d;
    quadric[o + 7] = quadric[o + 7]! + c * c;
    quadric[o + 8] = quadric[o + 8]! + c * d;
    quadric[o + 9] = quadric[o + 9]! + d * d;
  };
  /** Edge → how many triangles use it, to find the open borders. */
  const edgeUse = new Map<number, number>();
  const edgeKey = (a: number, b: number): number => (a < b ? a * placeTotal + b : b * placeTotal + a);
  for (let t = 0; t < sourceTriangles; t += 1) {
    if (!live[t]) continue;
    for (let k = 0; k < 3; k += 1) {
      const key = edgeKey(tp[t * 3 + k]!, tp[t * 3 + ((k + 1) % 3)]!);
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
    }
  }
  for (let t = 0; t < sourceTriangles; t += 1) {
    if (!live[t]) continue;
    const a = tp[t * 3]!, b = tp[t * 3 + 1]!, c = tp[t * 3 + 2]!;
    const ux = xs[b]! - xs[a]!, uy = ys[b]! - ys[a]!, uz = zs[b]! - zs[a]!;
    const vx = xs[c]! - xs[a]!, vy = ys[c]! - ys[a]!, vz = zs[c]! - zs[a]!;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (!(length > 0)) continue;
    nx /= length;
    ny /= length;
    nz /= length;
    const d = -(nx * xs[a]! + ny * ys[a]! + nz * zs[a]!);
    addPlane(a, nx, ny, nz, d);
    addPlane(b, nx, ny, nz, d);
    addPlane(c, nx, ny, nz, d);
    // An open border gets a plane standing on it, square to the face, so the
    // rim is held in place sideways as well as in depth.
    for (let k = 0; k < 3; k += 1) {
      const p = tp[t * 3 + k]!, q = tp[t * 3 + ((k + 1) % 3)]!;
      if (edgeUse.get(edgeKey(p, q)) !== 1) continue;
      const ex = xs[q]! - xs[p]!, ey = ys[q]! - ys[p]!, ez = zs[q]! - zs[p]!;
      let mx = ey * nz - ez * ny, my = ez * nx - ex * nz, mz = ex * ny - ey * nx;
      const m = Math.hypot(mx, my, mz);
      if (!(m > 0)) continue;
      mx /= m;
      my /= m;
      mz /= m;
      const md = -(mx * xs[p]! + my * ys[p]! + mz * zs[p]!);
      addPlane(p, mx, my, mz, md);
      addPlane(q, mx, my, mz, md);
    }
  }

  // ---- Folds: places whose own normal disagrees with their own faces. A
  // smooth normal averaged round a sharp turn (a hem joining a shell's outer
  // skin to its inner one, by `computeVertexNormals`) is not the surface's
  // normal at all, and the ramp draws a band wherever it is interpolated: how
  // wide that band is depends on exactly which triangles carry it. So such a
  // place, and every place one edge from it, keeps its triangles as they are.
  const pinned = new Uint8Array(placeTotal);
  if (normal) {
    const foldPlace = new Uint8Array(placeTotal);
    for (let t = 0; t < sourceTriangles; t += 1) {
      if (!live[t]) continue;
      const a = tp[t * 3]!, b = tp[t * 3 + 1]!, c = tp[t * 3 + 2]!;
      const ux = xs[b]! - xs[a]!, uy = ys[b]! - ys[a]!, uz = zs[b]! - zs[a]!;
      const vx = xs[c]! - xs[a]!, vy = ys[c]! - ys[a]!, vz = zs[c]! - zs[a]!;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      if (!(length > 0)) continue;
      for (let k = 0; k < 3; k += 1) {
        const w = tw[t * 3 + k]!;
        const wx = normal.getX(w), wy = normal.getY(w), wz = normal.getZ(w);
        const dot = (wx * nx + wy * ny + wz * nz) / (length * (Math.hypot(wx, wy, wz) || 1));
        if (dot < FOLD_COS) foldPlace[tp[t * 3 + k]!] = 1;
      }
    }
    for (let t = 0; t < sourceTriangles; t += 1) {
      if (!live[t]) continue;
      const a = tp[t * 3]!, b = tp[t * 3 + 1]!, c = tp[t * 3 + 2]!;
      if (foldPlace[a] || foldPlace[b] || foldPlace[c]) pinned[a] = pinned[b] = pinned[c] = 1;
    }
  }

  /** Summed squared distance from where `v` stands to every plane `u` and `v` carry. */
  const costOf = (u: number, v: number): number => {
    const x = xs[v]!, y = ys[v]!, z = zs[v]!;
    const a = u * 10, b = v * 10;
    return (
      (quadric[a]! + quadric[b]!) * x * x +
      2 * (quadric[a + 1]! + quadric[b + 1]!) * x * y +
      2 * (quadric[a + 2]! + quadric[b + 2]!) * x * z +
      2 * (quadric[a + 3]! + quadric[b + 3]!) * x +
      (quadric[a + 4]! + quadric[b + 4]!) * y * y +
      2 * (quadric[a + 5]! + quadric[b + 5]!) * y * z +
      2 * (quadric[a + 6]! + quadric[b + 6]!) * y +
      (quadric[a + 7]! + quadric[b + 7]!) * z * z +
      2 * (quadric[a + 8]! + quadric[b + 8]!) * z +
      (quadric[a + 9]! + quadric[b + 9]!)
    );
  };
  const limit = tolerance * tolerance;

  // ---- The queue: candidate collapses, cheapest first. An entry is stale
  // once either end has absorbed something since it was priced.
  const stamp = new Int32Array(placeTotal);
  const gone = new Uint8Array(placeTotal);
  const entryCost: number[] = [], entryFrom: number[] = [], entryTo: number[] = [];
  const entryFromStamp: number[] = [], entryToStamp: number[] = [];
  const heap: number[] = [];
  const push = (u: number, v: number): void => {
    const cost = costOf(u, v);
    if (!(cost <= limit)) return;
    const e = entryCost.length;
    entryCost.push(cost);
    entryFrom.push(u);
    entryTo.push(v);
    entryFromStamp.push(stamp[u]!);
    entryToStamp.push(stamp[v]!);
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (entryCost[heap[parent]!]! <= cost) break;
      heap[i] = heap[parent]!;
      i = parent;
    }
    heap[i] = e;
  };
  const pop = (): number => {
    const top = heap[0]!;
    const last = heap.pop()!;
    const size = heap.length;
    if (size > 0) {
      const cost = entryCost[last]!;
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= size) break;
        if (child + 1 < size && entryCost[heap[child + 1]!]! < entryCost[heap[child]!]!) child += 1;
        if (entryCost[heap[child]!]! >= cost) break;
        heap[i] = heap[child]!;
        i = child;
      }
      heap[i] = last;
    }
    return top;
  };

  const mark = new Int32Array(placeTotal);
  let tick = 0;
  const neighbours: number[] = [];
  /** Fills {@link neighbours} with the places sharing an edge with `u`. */
  const neighboursOf = (u: number): void => {
    neighbours.length = 0;
    tick += 1;
    for (const t of around[u]!) {
      for (let k = 0; k < 3; k += 1) {
        const p = tp[t * 3 + k]!;
        if (p !== u && mark[p] !== tick) {
          mark[p] = tick;
          neighbours.push(p);
        }
      }
    }
  };
  const wedgeAt = (t: number, place: number): number =>
    tp[t * 3] === place ? tw[t * 3]! : tp[t * 3 + 1] === place ? tw[t * 3 + 1]! : tw[t * 3 + 2]!;
  const uses = (t: number, place: number): boolean =>
    tp[t * 3] === place || tp[t * 3 + 1] === place || tp[t * 3 + 2] === place;
  /** Whether the edge u–v is one to keep: a border, a pinch, a crease or a seam. */
  const kept = (u: number, v: number): boolean => {
    let first = -1, second = -1, shared = 0;
    for (const t of around[u]!) {
      if (!uses(t, v)) continue;
      shared += 1;
      if (first < 0) first = t;
      else second = t;
    }
    if (shared !== 2) return true;
    return !agree(wedgeAt(first, u), wedgeAt(second, u)) || !agree(wedgeAt(first, v), wedgeAt(second, v));
  };

  for (let u = 0; u < placeTotal; u += 1) {
    neighboursOf(u);
    for (const v of neighbours) push(u, v);
  }

  const ring: number[] = [];
  /** Merges `u` into `v` if that is allowed as the surface stands now. */
  const collapse = (u: number, v: number): boolean => {
    const fan = around[u]!;
    let first = -1, second = -1, shared = 0;
    for (const t of fan) {
      if (!uses(t, v)) continue;
      shared += 1;
      if (first < 0) first = t;
      else second = t;
    }
    if (shared === 0 || shared > 2) return false;
    // A fold's triangles stay as they are (see `pinned`).
    if (pinned[u]) return false;

    // A vertex on no kept edge is free; on exactly two, it slides along them;
    // anything else is a corner or an end, and stays.
    neighboursOf(u);
    ring.length = 0;
    for (const p of neighbours) ring.push(p);
    let keptEdges = 0;
    let along = false;
    for (const p of ring) {
      if (!kept(u, p)) continue;
      keptEdges += 1;
      if (p === v) along = true;
    }
    if (keptEdges !== 0 && !(keptEdges === 2 && along)) return false;

    // The link condition: u and v may share only the corners of the faces
    // between them, or the surface is pinched into a fin.
    neighboursOf(v);
    let common = 0;
    for (const p of ring) {
      if (mark[p] === tick) common += 1;
    }
    if (common !== shared) return false;

    // No face may fold over or flatten to nothing.
    const vx = xs[v]!, vy = ys[v]!, vz = zs[v]!;
    for (const t of fan) {
      if (uses(t, v)) continue;
      const a = tp[t * 3]!, b = tp[t * 3 + 1]!, c = tp[t * 3 + 2]!;
      const ax = xs[a]!, ay = ys[a]!, az = zs[a]!;
      const bx = xs[b]!, by = ys[b]!, bz = zs[b]!;
      const cx = xs[c]!, cy = ys[c]!, cz = zs[c]!;
      const ox = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      const oy = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      const oz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const a2x = a === u ? vx : ax, a2y = a === u ? vy : ay, a2z = a === u ? vz : az;
      const b2x = b === u ? vx : bx, b2y = b === u ? vy : by, b2z = b === u ? vz : bz;
      const c2x = c === u ? vx : cx, c2y = c === u ? vy : cy, c2z = c === u ? vz : cz;
      const nx = (b2y - a2y) * (c2z - a2z) - (b2z - a2z) * (c2y - a2y);
      const ny = (b2z - a2z) * (c2x - a2x) - (b2x - a2x) * (c2z - a2z);
      const nz = (b2x - a2x) * (c2y - a2y) - (b2y - a2y) * (c2x - a2x);
      const was = Math.hypot(ox, oy, oz), now = Math.hypot(nx, ny, nz);
      if (!(now > was * 1e-6) || ox * nx + oy * ny + oz * nz < FLIP_COS * was * now) return false;
    }

    // Every face that keeps going takes, at `v`, the look of the side of the
    // edge it was on.
    const firstFrom = wedgeAt(first, u), firstTo = wedgeAt(first, v);
    const secondFrom = second < 0 ? firstFrom : wedgeAt(second, u);
    const secondTo = second < 0 ? firstTo : wedgeAt(second, v);
    const takes = (from: number): number => (unlike(from, firstFrom) <= unlike(from, secondFrom) ? firstTo : secondTo);

    // Allowed.
    const into = around[v]!;
    for (const t of fan) {
      if (uses(t, v)) {
        live[t] = 0;
        continue;
      }
      for (let k = 0; k < 3; k += 1) {
        if (tp[t * 3 + k] !== u) continue;
        tw[t * 3 + k] = takes(tw[t * 3 + k]!);
        tp[t * 3 + k] = v;
      }
      into.push(t);
    }
    // Drop the faces that closed up from everyone who listed them.
    for (const dead of shared === 2 ? [first, second] : [first]) {
      for (let k = 0; k < 3; k += 1) {
        const p = tp[dead * 3 + k]!;
        if (p === u) continue;
        const list = around[p]!;
        const at = list.indexOf(dead);
        if (at >= 0) list.splice(at, 1);
      }
    }
    fan.length = 0;
    for (let k = 0; k < 10; k += 1) quadric[v * 10 + k] = quadric[v * 10 + k]! + quadric[u * 10 + k]!;
    gone[u] = 1;
    stamp[v] = stamp[v]! + 1;
    return true;
  };

  const touched: number[] = [];
  while (heap.length > 0) {
    const e = pop();
    const u = entryFrom[e]!, v = entryTo[e]!;
    if (gone[u] || gone[v] || stamp[u] !== entryFromStamp[e] || stamp[v] !== entryToStamp[e]) continue;
    if (!collapse(u, v)) continue;
    // Everything about `v` is new, and its neighbours' surroundings changed
    // too: a collapse refused a moment ago for folding a face may now be fine.
    neighboursOf(v);
    touched.length = 0;
    for (const p of neighbours) touched.push(p);
    for (const w of touched) {
      push(v, w);
      neighboursOf(w);
      for (const x of neighbours) push(w, x);
    }
  }

  // ---- Write what is left, indexed, each kept corner with its own attributes.
  const slotOf = new Int32Array(vertexTotal).fill(-1);
  const keptVertices: number[] = [];
  const faces: number[] = [];
  for (let t = 0; t < sourceTriangles; t += 1) {
    if (!live[t]) continue;
    for (let k = 0; k < 3; k += 1) {
      const w = tw[t * 3 + k]!;
      if (slotOf[w]! < 0) {
        slotOf[w] = keptVertices.length;
        keptVertices.push(w);
      }
      faces.push(slotOf[w]!);
    }
  }
  // A part must never simplify away to nothing.
  if (faces.length < 4 * 3) return null;

  const keptTotal = keptVertices.length;
  const low = new BufferGeometry();
  low.name = source.name ? `${source.name}:low` : 'low';
  low.userData = { ...source.userData };
  for (const name in source.attributes) {
    const from = source.getAttribute(name);
    const size = from.itemSize;
    const values = new Float32Array(keptTotal * size);
    for (let k = 0; k < keptTotal; k += 1) {
      for (let c = 0; c < size; c += 1) values[k * size + c] = from.getComponent(keptVertices[k]!, c);
    }
    low.setAttribute(name, new BufferAttribute(values, size));
  }
  low.setIndex(new BufferAttribute(keptTotal > 65535 ? new Uint32Array(faces) : new Uint16Array(faces), 1));
  return low;
}
