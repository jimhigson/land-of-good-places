import { BackSide, Matrix4, type Material, type Mesh, type Object3D } from 'three';
import { CREST_DEPTH, geometryTriangles, type TriangleSet } from '../measuredTop';

/**
 * **A car's solids, shaped from what the car draws** — never typed beside it.
 *
 * Jim, 17 Oct 2026: *"anything should be jumpable with no special 'floor'
 * being marked"*. The train's pieces used to be a hand-written table of
 * fifteen boxes beside `createLocomotive` and `createCarriage`, each flagged
 * `narrow` or not — the chassis, the boiler, the funnel, the dome and the beam
 * marked as never stood on whatever their drawn width (the funnel's top is
 * 0.54 m across), and the carriage's side 2 cm narrower than its drawn rubbing
 * strip. Review of PR #722: a ruling break, and a collider narrower than the
 * drawn train invisible to every check.
 *
 * Here every child of a car's root is one thing (`trainModel.ts`'s `thing`),
 * and each thing becomes a few boxes measured off its own triangles, in the
 * car's frame:
 *
 * - **Terraced from the top down.** Sliced {@link TERRACE_DEPTHS} under its
 *   highest point, each slice's plan extent is a box, standing to the height
 *   the thing is drawn at round that box's edge — the lowest of its upper
 *   surface there, so no box stands proud of what is drawn. Last, the whole
 *   thing's plan extent, to the height drawn round its edge. A box-shaped
 *   thing gives the same extent at every depth and is one box; a round boiler
 *   is a crown on shoulders on a body, each a little wider and lower, its
 *   steps at most 0.15 m off the curve.
 * - **The width rule decides the rest** (`toppedNarrow`, `FOOT_HALF_WIDTH`):
 *   every box's top is as wide as the box — a backrest 0.1 m deep holds
 *   nobody, the funnel's rim does, the boiler's crown does.
 * - **A thing inside another is no extra body**: a carriage's wheels under its
 *   tub, its benches inside it.
 */
export interface CarPiece {
  /** Middle, car-local metres. */
  readonly x: number;
  readonly z: number;
  /** Half its extent across (car-local X) and along (car-local Z). */
  readonly halfX: number;
  readonly halfZ: number;
  /** Its top, car-local metres above the car's datum (the sleepers). */
  readonly top: number;
  /** How wide the top is either side of its middle — the box's own narrower half (`CollisionWorld.toppedNarrow`). */
  readonly topHalf: number;
}

/** How far under a thing's top each terrace is sliced, metres — the crest first, as `measuredTop.ts` cuts a top. */
export const TERRACE_DEPTHS: readonly number[] = [CREST_DEPTH, 0.1, 0.25, 0.4];

/**
 * Two extents this close are the same, metres — and a terrace that reaches
 * no further than this past the one over it is that one, to the wider extent:
 * a carriage's end walls stand 3 cm past its rubbing strips, and as a terrace
 * of their own they made a face at the same place as the rim's, a step under
 * it, so walking at its side she met a step and a wall at once and was pushed
 * into the tub.
 */
const SAME = 0.035;
/** A thing whose box sits inside another's footprint, and no higher than its top by more than this, is inside it. */
const INSIDE_TOP = SAME;
/** Samples along each side of a box's edge when its drawn height is read there. */
const EDGE_SAMPLES = 12;

interface Extent {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Every visible, solid mesh under `thing` (outlines are ink, not body), in `toCar`'s frame. */
function thingTriangles(thing: Object3D, toCar: Matrix4): TriangleSet[] {
  const sets: TriangleSet[] = [];
  thing.traverse((object) => {
    const mesh = object as Mesh;
    if (!(mesh as { isMesh?: boolean }).isMesh) return;
    for (let at: Object3D | null = mesh; at && at !== thing.parent; at = at.parent) if (!at.visible) return;
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[];
    if (materials.every((material) => material.side === BackSide)) return;
    sets.push(geometryTriangles(mesh.geometry, new Matrix4().multiplyMatrices(toCar, mesh.matrixWorld)));
  });
  return sets;
}

/** The plan extent of what is drawn at or above `cut`: every corner over it, and every edge crossing it. */
function extentAbove(sets: readonly TriangleSet[], cut: number): Extent | null {
  const e: Extent = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const take = (x: number, z: number): void => {
    e.minX = Math.min(e.minX, x);
    e.maxX = Math.max(e.maxX, x);
    e.minZ = Math.min(e.minZ, z);
    e.maxZ = Math.max(e.maxZ, z);
  };
  for (const set of sets) {
    set((a, b, c) => {
      for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
        // flat-ok: the car's own frame, level by construction
        if (p.y >= cut) take(p.x, p.z);
        const dp = p.y - cut; // flat-ok: the same frame
        const dq = q.y - cut; // flat-ok: the same frame
        if (dp >= 0 === dq >= 0) continue;
        const t = dp / (dp - dq);
        take(p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t);
      }
    });
  }
  return Number.isFinite(e.minX) ? e : null;
}

/** The highest point drawn straight over `(x, z)`, or `-Infinity` where nothing is drawn over it. */
function drawnHeightAt(sets: readonly TriangleSet[], x: number, z: number): number {
  let best = -Infinity;
  for (const set of sets) {
    set((a, b, c) => {
      const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(d) < 1e-12) return;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
      const w = 1 - u - v;
      if (u < -1e-9 || v < -1e-9 || w < -1e-9) return;
      best = Math.max(best, a.y * u + b.y * v + c.y * w);
    });
  }
  return best;
}

/** The lowest the thing is drawn round the edge of `e` (just inside it), or `fallback` where nothing is drawn there. */
function heightRound(sets: readonly TriangleSet[], e: Extent, fallback: number): number {
  const inset = 0.002;
  const x0 = e.minX + inset;
  const x1 = e.maxX - inset;
  const z0 = e.minZ + inset;
  const z1 = e.maxZ - inset;
  let lowest = Infinity;
  const ask = (x: number, z: number): void => {
    const y = drawnHeightAt(sets, x, z);
    if (Number.isFinite(y)) lowest = Math.min(lowest, y);
  };
  for (let i = 0; i <= EDGE_SAMPLES; i += 1) {
    const t = i / EDGE_SAMPLES;
    ask(x0 + (x1 - x0) * t, z0);
    ask(x0 + (x1 - x0) * t, z1);
    ask(x0, z0 + (z1 - z0) * t);
    ask(x1, z0 + (z1 - z0) * t);
  }
  return Number.isFinite(lowest) ? lowest : fallback;
}

const sameExtent = (a: Extent, b: Extent): boolean =>
  Math.abs(a.minX - b.minX) < SAME && Math.abs(a.maxX - b.maxX) < SAME && Math.abs(a.minZ - b.minZ) < SAME && Math.abs(a.maxZ - b.maxZ) < SAME;

/** **Every solid piece of the car `root` draws** — see the header. */
export function carPieces(root: Object3D): CarPiece[] {
  root.updateMatrixWorld(true);
  const toCar = new Matrix4().copy(root.matrixWorld).invert();
  const pieces: CarPiece[] = [];
  /** Which thing each piece is of: a thing's own terraces are never inside one another. */
  const of: number[] = [];
  for (const [index, thing] of root.children.entries()) {
    const sets = thingTriangles(thing, toCar);
    if (sets.length === 0) continue;
    let top = -Infinity;
    let bottom = Infinity;
    for (const set of sets) {
      set((a, b, c) => {
        top = Math.max(top, a.y, b.y, c.y);
        bottom = Math.min(bottom, a.y, b.y, c.y);
      });
    }
    const whole = extentAbove(sets, -Infinity);
    if (!whole || !Number.isFinite(top)) continue;
    const terraces: { extent: Extent; top: number }[] = [];
    let above = top;
    for (const depth of [...TERRACE_DEPTHS, Infinity]) {
      const extent = depth === Infinity ? whole : extentAbove(sets, top - depth);
      if (!extent) continue;
      const last = terraces[terraces.length - 1];
      if (last && sameExtent(last.extent, extent)) {
        last.extent = { minX: Math.min(last.extent.minX, extent.minX), maxX: Math.max(last.extent.maxX, extent.maxX), minZ: Math.min(last.extent.minZ, extent.minZ), maxZ: Math.max(last.extent.maxZ, extent.maxZ) };
        continue;
      }
      // The crest's own terrace stands to the top; each wider one to what is drawn round its edge.
      const height = last ? Math.min(above, heightRound(sets, extent, Math.max(bottom, top - depth))) : top;
      terraces.push({ extent, top: height });
      above = height;
    }
    for (const { extent, top: height } of terraces) {
      const halfX = (extent.maxX - extent.minX) / 2;
      const halfZ = (extent.maxZ - extent.minZ) / 2;
      pieces.push({ x: (extent.minX + extent.maxX) / 2, z: (extent.minZ + extent.maxZ) / 2, halfX, halfZ, top: height, topHalf: Math.min(halfX, halfZ) });
      of.push(index);
    }
  }
  // A thing inside another (a wheel under the chassis, a bench in the tub) is no extra body.
  return pieces.filter(
    (piece, i) =>
      !pieces.some(
        (other, j) =>
          of[j] !== of[i] &&
          other.top >= piece.top - INSIDE_TOP &&
          Math.abs(other.x - piece.x) + piece.halfX <= other.halfX + SAME &&
          Math.abs(other.z - piece.z) + piece.halfZ <= other.halfZ + SAME &&
          // Two things each inside the other: keep the first.
          !(j > i && Math.abs(other.top - piece.top) < INSIDE_TOP && Math.abs(other.halfX - piece.halfX) < SAME && Math.abs(other.halfZ - piece.halfZ) < SAME),
      ),
  );
}

/** The highest any piece stands, car-local metres. */
export function highestTop(pieces: readonly CarPiece[]): number {
  return pieces.reduce((top, piece) => Math.max(top, piece.top), -Infinity);
}

/** The widest any piece reaches either side of the car's middle, metres. */
export function widestHalf(pieces: readonly CarPiece[]): number {
  return pieces.reduce((half, piece) => Math.max(half, Math.abs(piece.x) + piece.halfX), 0);
}

