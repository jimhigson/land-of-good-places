import { Box3, Color as ThreeColor, Group, InstancedMesh, Matrix4, Sphere, Vector3, type BufferGeometry, type Color, type Material } from 'three';

/**
 * **Instanced meshes three.js can actually cull** (120 fps plan, step 10;
 * `docs/perf/FRAME-DROPS-2026-11.md`, "Per-object frustum culling that
 * actually works").
 *
 * Jim, November 2026: *"we shouldn't draw anything off the screen, not just
 * crowds — can this be generalised better?"* three.js culls per **object**, by
 * one bounding sphere. An `InstancedMesh` holding every bush in the park has a
 * sphere the size of the park, so whenever she can see one bush all 1,093 are
 * submitted — measured, 10,771 off-screen instances and 2.2 M triangles in the
 * park view. Two helpers, one for each way an instanced mesh goes wrong:
 *
 * - {@link TiledInstances} — **static** scatter (bushes, bulbs, trees). The
 *   instances are split into square ground tiles, one `InstancedMesh` per
 *   occupied tile, each with a bound that contains exactly what it draws. The
 *   camera's frustum *and the shadow camera's* then skip whole tiles for free:
 *   no per-frame code runs here at all.
 * - {@link refreshInstanceBounds} / {@link LiveInstanceBounds} — **dynamic**
 *   meshes with few members (a crowd part, a flock). They opted out with
 *   `frustumCulled = false` because the sphere three caches goes stale the
 *   moment a member walks. Recomputing it from the live matrices is a few
 *   dozen multiply-adds, and turns culling back on.
 *
 * ## The two rules a bound must keep
 *
 * 1. **It contains everything the mesh draws, every frame** — or something on
 *    screen pops out at an edge. Both helpers build the bound from the
 *    geometry's own sphere put through each instance's matrix, never from
 *    instance origins alone. `check:cull-audit` fails outright on a bound that
 *    misses its contents.
 * 2. **A hidden instance does not widen it.** three's own
 *    `InstancedMesh.computeBoundingSphere` unions in a zero-scale instance as a
 *    point at the mesh's origin, so one felled bush would stretch its tile's
 *    sphere to the middle of the park. Degenerate matrices are skipped here.
 *
 * ## Indices stay stable
 *
 * Callers address instances by the index they had in the list they passed in
 * (felling a bush clump by `instanceStart`, twinkling bulb `i`). A tile and a
 * row are fixed at construction and never change, so {@link TiledInstances.locate}
 * is a lookup that can be cached, and `setMatrixAt` / `setColorAt` here take the
 * original index.
 */

/**
 * Tile edge, metres. The plan measured 24 m; at the iso camera's footprint
 * (about 60 × 40 m of ground) that is 6–12 tiles on screen out of a park
 * ~190 m across, and a tile's sphere (~17 m + the geometry) stays well under
 * the audit's 40 m "one sphere for most of the park" line.
 */
export const DEFAULT_TILE_SIZE_M = 24;

const scratchSphere = new Sphere();
const scratchBox = new Box3();
const scratchMatrix = new Matrix4();
const scratchCentre = new Vector3();

/** A matrix that draws nothing: every basis vector is zero (a hidden instance). */
function drawsNothing(elements: ArrayLike<number>, offset: number): boolean {
  return (
    elements[offset] === 0 &&
    elements[offset + 1] === 0 &&
    elements[offset + 2] === 0 &&
    elements[offset + 4] === 0 &&
    elements[offset + 5] === 0 &&
    elements[offset + 6] === 0 &&
    elements[offset + 8] === 0 &&
    elements[offset + 9] === 0 &&
    elements[offset + 10] === 0
  );
}

export interface InstanceBoundsOptions {
  /** Instances to read; defaults to `mesh.count`. */
  readonly count?: number;
  /**
   * Metres added to the radius and every box face, for anything the vertex
   * shader moves outside the geometry's rest bound (wind sway, a wave, limbs
   * animated in the shader). Zero for rigid instances.
   */
  readonly margin?: number;
}

/**
 * Sets `mesh.boundingBox` and `mesh.boundingSphere` — the bounds three culls
 * and raycasts an `InstancedMesh` by — from its **live** instance matrices,
 * skipping instances scaled to nothing. A mesh with no drawn instance gets an
 * empty box and a zero sphere at its origin (three then culls it whenever the
 * origin is off-screen; it draws nothing either way).
 *
 * Call it after the matrices change. It allocates nothing after the first call
 * on a mesh.
 */
export function refreshInstanceBounds(mesh: InstancedMesh, options: InstanceBoundsOptions = {}): void {
  const geometry = mesh.geometry;
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  if (geometry.boundingBox === null) geometry.computeBoundingBox();
  const geometrySphere = geometry.boundingSphere as Sphere;
  const geometryBox = geometry.boundingBox as Box3;
  const count = Math.min(options.count ?? mesh.count, mesh.count);
  const margin = options.margin ?? 0;
  const elements = mesh.instanceMatrix.array;

  const box = mesh.boundingBox ?? (mesh.boundingBox = new Box3());
  const sphere = mesh.boundingSphere ?? (mesh.boundingSphere = new Sphere());
  box.makeEmpty();
  for (let i = 0; i < count; i += 1) {
    if (drawsNothing(elements, i * 16)) continue;
    scratchMatrix.fromArray(elements, i * 16);
    box.union(scratchBox.copy(geometryBox).applyMatrix4(scratchMatrix));
  }
  if (box.isEmpty()) {
    sphere.center.set(0, 0, 0);
    sphere.radius = 0;
    return;
  }
  // Centre on the box, then reach to the farthest instance sphere: tighter
  // than unioning spheres one by one, and still a superset of every instance.
  box.getCenter(scratchCentre);
  let radius = 0;
  for (let i = 0; i < count; i += 1) {
    if (drawsNothing(elements, i * 16)) continue;
    scratchMatrix.fromArray(elements, i * 16);
    scratchSphere.copy(geometrySphere).applyMatrix4(scratchMatrix);
    radius = Math.max(radius, scratchCentre.distanceTo(scratchSphere.center) + scratchSphere.radius);
  }
  sphere.center.copy(scratchCentre);
  sphere.radius = radius + margin;
  if (margin > 0) box.expandByScalar(margin);
}

/**
 * Culling for a **dynamic** instanced mesh with few members: owns the "are the
 * bounds stale?" question so the mesh's owner only has to say when it wrote.
 *
 * ```
 * const bounds = new LiveInstanceBounds(mesh, { margin: 0.4 }); // turns frustumCulled on
 * // …each frame, after writing instance matrices:
 * bounds.markDirty();
 * bounds.refresh();          // no-op when nothing was written
 * ```
 *
 * Written so `InstancedCrowd` can adopt it (its parts opt out of culling today
 * because their spheres go stale as children walk): one instance per part mesh,
 * `markDirty()` where it sets `instanceMatrix.needsUpdate`, `refresh()` once
 * at the end of its update, `setCount()` when the drawn member count changes.
 */
export class LiveInstanceBounds {
  readonly mesh: InstancedMesh;
  private readonly margin: number;
  private dirty = true;

  constructor(mesh: InstancedMesh, options: { readonly margin?: number } = {}) {
    this.mesh = mesh;
    this.margin = options.margin ?? 0;
    mesh.frustumCulled = true;
    this.refresh();
  }

  /** The instance matrices (or `mesh.count`) changed since the last {@link refresh}. */
  markDirty(): void {
    this.dirty = true;
  }

  /** Changes how many instances are drawn, and marks the bound stale. */
  setCount(count: number): void {
    if (this.mesh.count === count) return;
    this.mesh.count = count;
    this.dirty = true;
  }

  /** Recomputes the bound if anything was written. Returns whether it did. */
  refresh(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;
    refreshInstanceBounds(this.mesh, { margin: this.margin });
    return true;
  }
}

export interface TiledInstancesOptions {
  /** Each tile mesh is named `${name}@${tileX},${tileZ}`; the group is `name`. */
  readonly name: string;
  readonly geometry: BufferGeometry;
  readonly material: Material | Material[];
  /** One matrix per instance, in the parent's frame, in the caller's index order. */
  readonly matrices: readonly Matrix4[];
  /** Per-instance colours, same order. Omit for none (no `instanceColor` is made). */
  readonly colors?: readonly Color[];
  readonly tileSize?: number;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  /** See {@link InstanceBoundsOptions.margin}. */
  readonly boundsMargin?: number;
}

/** Where one of the caller's instances lives: fixed for the life of the object. */
export interface TileSlot {
  readonly mesh: InstancedMesh;
  readonly row: number;
}

/**
 * Static instances split into ground tiles, one `InstancedMesh` each, so that
 * off-screen tiles are culled by three's own per-object test — in the camera
 * pass and in the shadow pass alike.
 *
 * Draws exactly what one `InstancedMesh` over the same list would: same
 * geometry, material, matrices and per-instance colours; only the grouping
 * differs. When every tile is on screen it costs one draw call per occupied
 * tile instead of one.
 */
export class TiledInstances {
  /** Add this to the scene where the single mesh would have gone. */
  readonly group = new Group();
  readonly tiles: readonly InstancedMesh[];
  /** How many instances the caller passed in. */
  readonly count: number;
  private readonly slotTile: Uint16Array;
  private readonly slotRow: Uint32Array;
  private readonly boundsMargin: number;
  private readonly matrixDirty: boolean[];
  private readonly colorDirty: boolean[];

  constructor(options: TiledInstancesOptions) {
    const { name, geometry, material, matrices, colors } = options;
    const tileSize = options.tileSize ?? DEFAULT_TILE_SIZE_M;
    this.group.name = name;
    this.count = matrices.length;
    this.boundsMargin = options.boundsMargin ?? 0;
    this.slotTile = new Uint16Array(matrices.length);
    this.slotRow = new Uint32Array(matrices.length);

    // Bucket by the instance's own origin on the ground plane. Insertion order
    // of the map is the order tiles are first met, so the build is deterministic.
    const buckets = new Map<string, { tileX: number; tileZ: number; members: number[] }>();
    for (let i = 0; i < matrices.length; i += 1) {
      const e = (matrices[i] as Matrix4).elements;
      const tileX = Math.floor((e[12] ?? 0) / tileSize);
      const tileZ = Math.floor((e[14] ?? 0) / tileSize);
      const key = `${tileX},${tileZ}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tileX, tileZ, members: [] };
        buckets.set(key, bucket);
      }
      bucket.members.push(i);
    }

    const tiles: InstancedMesh[] = [];
    for (const [key, bucket] of buckets) {
      const mesh = new InstancedMesh(geometry, material, bucket.members.length);
      mesh.name = `${name}@${key}`;
      mesh.castShadow = options.castShadow ?? false;
      mesh.receiveShadow = options.receiveShadow ?? false;
      const tileIndex = tiles.length;
      bucket.members.forEach((index, row) => {
        mesh.setMatrixAt(row, matrices[index] as Matrix4);
        if (colors) mesh.setColorAt(row, colors[index] as Color);
        this.slotTile[index] = tileIndex;
        this.slotRow[index] = row;
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      refreshInstanceBounds(mesh, { margin: this.boundsMargin });
      tiles.push(mesh);
      this.group.add(mesh);
    }
    this.tiles = tiles;
    this.matrixDirty = tiles.map(() => false);
    this.colorDirty = tiles.map(() => false);
  }

  /**
   * Re-tiles a mesh somebody else composed (`treeModel.makeInstanced`), so the
   * owner of *how an instance is placed* stays the one function it already is:
   * same matrices, same per-instance colours, same name and shadow flags, read
   * back off the mesh. The source's instance buffers are released.
   */
  static fromInstancedMesh(source: InstancedMesh, options: { readonly tileSize?: number; readonly boundsMargin?: number } = {}): TiledInstances {
    const matrices: Matrix4[] = [];
    const colors: Color[] = [];
    const tint = source.instanceColor ? new ThreeColor() : null;
    for (let i = 0; i < source.count; i += 1) {
      const matrix = new Matrix4();
      source.getMatrixAt(i, matrix);
      matrices.push(matrix);
      if (tint) {
        source.getColorAt(i, tint);
        colors.push(tint.clone());
      }
    }
    const tiled = new TiledInstances({
      name: source.name,
      geometry: source.geometry,
      material: source.material,
      matrices,
      ...(tint ? { colors } : {}),
      castShadow: source.castShadow,
      receiveShadow: source.receiveShadow,
      ...(options.tileSize === undefined ? {} : { tileSize: options.tileSize }),
      ...(options.boundsMargin === undefined ? {} : { boundsMargin: options.boundsMargin }),
    });
    source.dispose();
    return tiled;
  }

  /** The tile mesh and row that hold the caller's instance `index`. Safe to cache. */
  locate(index: number): TileSlot {
    if (!(index >= 0 && index < this.count)) throw new RangeError(`${this.group.name}: no instance ${index} of ${this.count}`);
    return { mesh: this.tiles[this.slotTile[index] as number] as InstancedMesh, row: this.slotRow[index] as number };
  }

  getMatrixAt(index: number, target: Matrix4): Matrix4 {
    (this.tiles[this.slotTile[index] as number] as InstancedMesh).getMatrixAt(this.slotRow[index] as number, target);
    return target;
  }

  /**
   * Writes one instance's matrix. The instance stays in the tile it was built
   * in — this is for hiding, restoring and nudging, not for moving an instance
   * across the park — and the tile's bound is recomputed at {@link commit}, so
   * a moved instance can never leave its bound.
   */
  setMatrixAt(index: number, matrix: Matrix4): void {
    const tile = this.slotTile[index] as number;
    (this.tiles[tile] as InstancedMesh).setMatrixAt(this.slotRow[index] as number, matrix);
    this.matrixDirty[tile] = true;
  }

  setColorAt(index: number, color: Color): void {
    const tile = this.slotTile[index] as number;
    (this.tiles[tile] as InstancedMesh).setColorAt(this.slotRow[index] as number, color);
    this.colorDirty[tile] = true;
  }

  /** Uploads what {@link setMatrixAt} / {@link setColorAt} wrote, and refreshes the bounds of tiles whose matrices changed. */
  commit(): void {
    for (let tile = 0; tile < this.tiles.length; tile += 1) {
      const mesh = this.tiles[tile] as InstancedMesh;
      if (this.matrixDirty[tile]) {
        this.matrixDirty[tile] = false;
        mesh.instanceMatrix.needsUpdate = true;
        refreshInstanceBounds(mesh, { margin: this.boundsMargin });
      }
      if (this.colorDirty[tile]) {
        this.colorDirty[tile] = false;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}
