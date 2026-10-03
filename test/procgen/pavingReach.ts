/**
 * **The drawn paving as a walkable surface: where it is, and what of it joins
 * up** — measured off the built `path-surface` and `path-kerb` meshes' own
 * triangles, never off the route objects that drew them.
 *
 * A route object says where a ribbon was *meant* to go; a gap of lawn between
 * a spur's square-cut end and a doormat, or a ribbon that stops a metre short
 * of a door, is only visible in the triangles that were actually laid. So this
 * rasterises those triangles in plan onto a fine grid and floods it.
 *
 * Leaf module: imports `three` types and `terrain.ts`'s pure helpers only, so a
 * static import from `invariants.ts` cannot fix the park's seed early.
 */
import type { Mesh } from 'three';
import { altitudeAt } from '../../src/world/terrain.ts';

/**
 * Raster pitch, metres. A quarter of a child's own radius (`PLAYER_RADIUS`,
 * 0.62 m), so a gap of lawn a child could put a foot in is several cells
 * wide; fine enough that rasterising cannot itself bridge or open a gap of
 * that size.
 */
export const PAVING_CELL = 0.15;

/** One rasterised sheet of paving — the union of every drawn paving triangle. */
export interface PavingRaster {
  readonly cell: number;
  readonly minX: number;
  readonly minZ: number;
  readonly cols: number;
  readonly rows: number;
  /** Lowest/highest altitude of paving in the cell (NaN where unpaved). */
  readonly lo: Float32Array;
  readonly hi: Float32Array;
  /** How many triangles were rasterised, so an empty raster cannot pass for a measured one. */
  readonly triangles: number;
}

/**
 * Rasterises every triangle of the given meshes (in their current, draped
 * state, through the live index) in plan. A cell is paved when its centre
 * lies inside a triangle; its altitude is that triangle's, interpolated, above
 * the planet's own ground (`altitudeAt`), so paving on a bridge deck and the
 * lawn under it are told apart.
 */
export function rasterisePaving(
  meshes: readonly Mesh[],
  cell = PAVING_CELL,
  /** Leave out a triangle whose first corner is this vertex of this mesh. */
  skip: (mesh: Mesh, vertex: number) => boolean = () => false,
): PavingRaster {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  minX -= 2 * cell;
  minZ -= 2 * cell;
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell) + 4);
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 4);
  const lo = new Float32Array(cols * rows).fill(Number.NaN);
  const hi = new Float32Array(cols * rows).fill(Number.NaN);
  let triangles = 0;

  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : position.count;
    const at = (slot: number): number => (index ? index.getX(slot) : slot);
    for (let slot = 0; slot + 2 < count; slot += 3) {
      const ia = at(slot);
      const ib = at(slot + 1);
      const ic = at(slot + 2);
      if (skip(mesh, ia)) continue;
      const ax = position.getX(ia);
      const az = position.getZ(ia);
      const bx = position.getX(ib);
      const bz = position.getZ(ib);
      const cx = position.getX(ic);
      const cz = position.getZ(ic);
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-10) continue;
      triangles += 1;
      const ay = position.getY(ia);
      const by = position.getY(ib);
      const cy = position.getY(ic);
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) / cell));
      const c1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx, cx) - minX) / cell));
      const r0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - minZ) / cell));
      const r1 = Math.min(rows - 1, Math.floor((Math.max(az, bz, cz) - minZ) / cell));
      for (let r = r0; r <= r1; r += 1) {
        const pz = minZ + (r + 0.5) * cell;
        for (let c = c0; c <= c1; c += 1) {
          const px = minX + (c + 0.5) * cell;
          const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
          const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
          const y = l1 * ay + l2 * by + l3 * cy;
          const alt = altitudeAt(px, y, pz);
          const k = r * cols + c;
          const was = lo[k] as number;
          if (Number.isNaN(was) || alt < was) lo[k] = alt;
          const top = hi[k] as number;
          if (Number.isNaN(top) || alt > top) hi[k] = alt;
        }
      }
    }
  }
  return { cell, minX, minZ, cols, rows, lo, hi, triangles };
}

export function cellOf(raster: PavingRaster, x: number, z: number): number {
  const c = Math.floor((x - raster.minX) / raster.cell);
  const r = Math.floor((z - raster.minZ) / raster.cell);
  if (c < 0 || r < 0 || c >= raster.cols || r >= raster.rows) return -1;
  return r * raster.cols + c;
}

export function cellCentre(raster: PavingRaster, k: number): readonly [number, number] {
  const c = k % raster.cols;
  const r = (k - c) / raster.cols;
  return [raster.minX + (c + 0.5) * raster.cell, raster.minZ + (r + 0.5) * raster.cell];
}

export const isPaved = (raster: PavingRaster, k: number): boolean => k >= 0 && !Number.isNaN(raster.lo[k] as number);

/**
 * Floods the paving from one cell: 4-neighbours, joined only where the two
 * cells' paving lies within `stepUp` of each other in altitude — so paving on
 * a bridge deck does not join the lawn-level paving under it in plan, and a
 * ribbon standing up as a sheet is a cliff rather than a join.
 */
export function floodPaving(
  raster: PavingRaster,
  start: number,
  stepUp: number,
  /** Cells the flood may enter at all, beyond being paved. */
  allowed: (k: number) => boolean = () => true,
): Uint8Array {
  const seen = new Uint8Array(raster.cols * raster.rows);
  if (!isPaved(raster, start) || !allowed(start)) return seen;
  const queue = new Int32Array(raster.cols * raster.rows);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  seen[start] = 1;
  const { cols, rows, lo, hi } = raster;
  while (head < tail) {
    const k = queue[head++] as number;
    const c = k % cols;
    const r = (k - c) / cols;
    const klo = lo[k] as number;
    const khi = hi[k] as number;
    const visit = (n: number): void => {
      if (seen[n] === 1) return;
      const nlo = lo[n] as number;
      if (Number.isNaN(nlo)) return;
      const nhi = hi[n] as number;
      // Intervals within a step of each other.
      if (nlo > khi + stepUp || klo > nhi + stepUp) return;
      if (!allowed(n)) return;
      seen[n] = 1;
      queue[tail++] = n;
    };
    if (c > 0) visit(k - 1);
    if (c < cols - 1) visit(k + 1);
    if (r > 0) visit(k - cols);
    if (r < rows - 1) visit(k + cols);
  }
  return seen;
}

/**
 * The plan distance from `(x, z)` to the nearest cell passing `accept`,
 * searched out to `limit` metres (`Infinity` past it), measured to the cell's
 * nearest edge rather than its centre — so a point standing on a paved cell
 * reads 0.
 */
export function distanceToCell(
  raster: PavingRaster,
  x: number,
  z: number,
  limit: number,
  accept: (k: number) => boolean,
): { distance: number; at: readonly [number, number] | null } {
  const { cell, minX, minZ, cols, rows } = raster;
  const c0 = Math.floor((x - minX) / cell);
  const r0 = Math.floor((z - minZ) / cell);
  const reach = Math.ceil(limit / cell) + 1;
  let best = Infinity;
  let bestAt: readonly [number, number] | null = null;
  for (let dr = -reach; dr <= reach; dr += 1) {
    const r = r0 + dr;
    if (r < 0 || r >= rows) continue;
    for (let dc = -reach; dc <= reach; dc += 1) {
      const c = c0 + dc;
      if (c < 0 || c >= cols) continue;
      const k = r * cols + c;
      if (!accept(k)) continue;
      const cx0 = minX + c * cell;
      const cz0 = minZ + r * cell;
      const dx = Math.max(cx0 - x, 0, x - (cx0 + cell));
      const dz = Math.max(cz0 - z, 0, z - (cz0 + cell));
      const d = Math.hypot(dx, dz);
      if (d < best) {
        best = d;
        bestAt = [cx0 + cell / 2, cz0 + cell / 2];
      }
    }
  }
  return best <= limit ? { distance: best, at: bestAt } : { distance: Infinity, at: null };
}
