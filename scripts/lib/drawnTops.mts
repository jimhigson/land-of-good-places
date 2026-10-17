/**
 * **How tall is a solid as drawn?** — downward rays against the real scene's
 * meshes, over a solid's own footprint, from just above anything a child could
 * stand on down to its base. The oracle `check:solids` holds every collider's
 * top against: a top must be the drawn top (Jim, 17 Oct 2026: "no Infinity
 * top on a thing that has a drawn top"), and this is what was drawn.
 *
 * Built on the investigation of 17 Oct 2026 (`/tmp/jump-investigation-…/
 * inventory.mts`): one stand-in mesh per instance, so a park-wide instanced
 * mesh (trees, bushes) is measured per tree; meshes bucketed on a 4 m grid;
 * people, light glows, decals and the like ignored by name, because a solid's
 * top is its own and not a child's hair or a lamp's halo above it.
 */
import { Box3, type InstancedMesh, Matrix4, Mesh, type Object3D, Raycaster, Vector3, DoubleSide, type Material } from 'three';

/** What is never part of a solid's own top: people, light, paint, plants that bend. */
export const DRAWN_IGNORE =
  /^(crowd|hair|bakedFace|kid|npc|player|food-|lamp-ground-glow|fairy-|tree-light|ties|.*glow|.*halo|.*shadow|.*decal|flowers?|bloom|petal|grass|tuft|fireflies|label|bubble|.*outline)/i;

interface Entry {
  readonly mesh: Mesh;
  readonly box: Box3;
  readonly name: string;
}

export interface DrawnTopIndex {
  /** The highest drawn surface over `(x, z)` between `floor` and `floor + span`, ignoring anything starting above `floor + startAbove`. */
  topAt(x: number, z: number, floor: number, span?: number, startAbove?: number): { y: number; name: string } | null;
  readonly meshes: number;
}

const CELL = 4;

export function indexDrawnTops(scene: Object3D): DrawnTopIndex {
  scene.updateMatrixWorld(true);
  const entries: Entry[] = [];
  const local = new Matrix4();
  scene.traverse((object) => {
    const mesh = object as Mesh;
    if (!(mesh as { isMesh?: boolean }).isMesh) return;
    if (!mesh.visible) return;
    const geometry = mesh.geometry;
    if (!geometry?.attributes['position']) return;
    const path: string[] = [];
    for (let at: Object3D | null = mesh; at && path.length < 4; at = at.parent) if (at.name) path.push(at.name);
    const name = path.join('<') || mesh.type;
    if (DRAWN_IGNORE.test(mesh.name || '') || DRAWN_IGNORE.test(mesh.parent?.name ?? '')) return;
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as (Material & { side: number; transparent?: boolean; opacity?: number })[];
    if (materials.every((m) => m.transparent && (m.opacity ?? 1) < 0.5)) return;
    for (const material of materials) material.side = DoubleSide;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const instanced = (mesh as unknown as InstancedMesh).isInstancedMesh ? (mesh as unknown as InstancedMesh) : null;
    if (instanced) {
      for (let i = 0; i < instanced.count; i += 1) {
        instanced.getMatrixAt(i, local);
        const world = new Matrix4().multiplyMatrices(instanced.matrixWorld, local);
        const stand = new Mesh(geometry, instanced.material);
        stand.matrixAutoUpdate = false;
        stand.matrixWorld.copy(world);
        const box = geometry.boundingBox!.clone().applyMatrix4(world);
        if (!Number.isFinite(box.min.x)) continue;
        entries.push({ mesh: stand, box, name: `${name}[${i}]` });
      }
      return;
    }
    const box = geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
    const area = (box.max.x - box.min.x) * (box.max.z - box.min.z);
    // Ground-sized things (terrain, the plaza, a room's floor) are floors, not tops.
    if (!Number.isFinite(area) || area > 900) return;
    entries.push({ mesh, box, name });
  });
  const grid = new Map<string, Entry[]>();
  for (const entry of entries) {
    for (let i = Math.floor(entry.box.min.x / CELL); i <= Math.floor(entry.box.max.x / CELL); i += 1) {
      for (let j = Math.floor(entry.box.min.z / CELL); j <= Math.floor(entry.box.max.z / CELL); j += 1) {
        const key = `${i},${j}`;
        let cell = grid.get(key);
        if (!cell) grid.set(key, (cell = []));
        cell.push(entry);
      }
    }
  }
  const ray = new Raycaster();
  const down = new Vector3(0, -1, 0); // flat-ok: a solid's top is asked per world column (`CollisionWorld`'s tops are), so the oracle looks straight down that column
  const origin = new Vector3();
  return {
    meshes: entries.length,
    topAt(x, z, floor, span = 40, startAbove = Infinity) {
      const cell = grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
      if (!cell) return null;
      origin.set(x, floor + span, z);
      ray.set(origin, down); // flat-ok: down the column the collider's top is read in — see `down`
      ray.far = span - 0.02;
      let best: { y: number; name: string } | null = null;
      for (const entry of cell) {
        if (x < entry.box.min.x - 0.01 || x > entry.box.max.x + 0.01 || z < entry.box.min.z - 0.01 || z > entry.box.max.z + 0.01) continue;
        if (entry.box.max.y < floor + 0.02) continue; // flat-ok: a world-box cull before the exact ray, conservative in both directions
        if (entry.box.min.y > floor + startAbove) continue; // flat-ok: the same world-box cull
        for (const hit of ray.intersectObject(entry.mesh, false)) {
          if (hit.point.y > floor + 0.02 && (!best || hit.point.y > best.y)) best = { y: hit.point.y, name: entry.name };
        }
      }
      return best;
    },
  };
}
