import { Mesh, MeshBasicMaterial, Raycaster, Vector3, type BufferAttribute, type BufferGeometry } from 'three';
import type { GlbPart } from './glb';

/**
 * **Measuring a kit's bare geometry**: the three questions every authored kit
 * asks of its own `.glb` — how far do these nodes reach, where are their flat
 * treads, and what does a ray meet — answered over `GlbPart`s in the asset's
 * own frame (game axes: +Y up, the front on +Z), with each node's own
 * translation applied.
 *
 * Lifted out of `libraryKit.ts` when the Library's second kit
 * (`libraryDenKit.ts`, the secret den) needed the same answers of a different
 * file. One reader for both, rather than the arithmetic copied: a kit module
 * holds its decoded parts and hands them here.
 */

/** An axis-aligned extent, in the asset's own frame. */
export interface KitBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Every vertex of a part, in its asset's frame (the node's own transform applied). */
export function eachGlbVertex(part: GlbPart, visit: (x: number, y: number, z: number) => void): void {
  const position = part.geometry.getAttribute('position') as BufferAttribute;
  const p = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    p.fromBufferAttribute(position, i).multiply(part.scale).applyQuaternion(part.quaternion).add(part.position);
    visit(p.x, p.y, p.z);
  }
}

/** Every triangle of a part, its corners in the asset's frame. The vectors are reused between calls: copy what you keep. */
export function eachGlbTriangle(part: GlbPart, visit: (a: Vector3, b: Vector3, c: Vector3) => void): void {
  const geometry: BufferGeometry = part.geometry;
  const position = geometry.getAttribute('position') as BufferAttribute;
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const at = (i: number, target: Vector3): Vector3 =>
    target
      .fromBufferAttribute(position, index ? index.getX(i) : i)
      .multiply(part.scale)
      .applyQuaternion(part.quaternion)
      .add(part.position);
  for (let i = 0; i + 2 < count; i += 3) {
    at(i, a);
    at(i + 1, b);
    at(i + 2, c);
    visit(a, b, c);
  }
}

/** The extent of the parts' vertices — never a bounding box of a bounding box. Throws if `keep` admits nothing. */
export function glbBounds(parts: readonly GlbPart[], keep?: (x: number, y: number, z: number) => boolean): KitBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const part of parts) {
    eachGlbVertex(part, (x, y, z) => {
      if (keep && !keep(x, y, z)) return;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    });
  }
  if (!Number.isFinite(minX)) throw new Error(`glbMeasure: nothing to measure in ${parts.map((part) => part.name).join(', ')}`);
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

/** One flat, up-facing tread of a part: its height and the plan it runs over. */
export interface GlbTread {
  readonly y: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * The flat, up-facing treads of a part: every horizontal triangle's height and
 * the plan it runs over, merged by height (to the millimetre). Lowest first.
 */
export function glbTreads(part: GlbPart): GlbTread[] {
  const ab = new Vector3();
  const ac = new Vector3();
  const byHeight = new Map<number, { y: number; minX: number; maxX: number; minZ: number; maxZ: number }>();
  eachGlbTriangle(part, (a, b, c) => {
    const normal = ab.subVectors(b, a).cross(ac.subVectors(c, a));
    const length = normal.length();
    if (length < 1e-9 || normal.y / length < 0.999) return;
    const y = (a.y + b.y + c.y) / 3;
    const key = Math.round(y * 1000);
    const tread = byHeight.get(key) ?? { y, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    tread.minX = Math.min(tread.minX, a.x, b.x, c.x);
    tread.maxX = Math.max(tread.maxX, a.x, b.x, c.x);
    tread.minZ = Math.min(tread.minZ, a.z, b.z, c.z);
    tread.maxZ = Math.max(tread.maxZ, a.z, b.z, c.z);
    byHeight.set(key, tread);
  });
  return [...byHeight.values()].sort((p, q) => p.y - q.y); // flat-ok: tread heights in the glb's own asset frame, unplaced
}

/**
 * The first hit of a ray against the parts, or `null` — for clear openings and
 * inner faces, measured the Artist's way. Front faces only: a ray meets the
 * outside of the masonry, as a child would.
 */
export function glbFirstHit(parts: readonly GlbPart[], origin: Vector3, direction: Vector3): number | null {
  const ray = new Raycaster(origin, direction.clone().normalize());
  const material = new MeshBasicMaterial();
  let best: number | null = null;
  for (const part of parts) {
    const mesh = new Mesh(part.geometry, material);
    mesh.position.copy(part.position);
    mesh.quaternion.copy(part.quaternion);
    mesh.scale.copy(part.scale);
    mesh.updateMatrixWorld(true);
    for (const hit of ray.intersectObject(mesh, false)) best = best === null ? hit.distance : Math.min(best, hit.distance);
  }
  material.dispose();
  return best;
}
