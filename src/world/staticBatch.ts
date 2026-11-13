import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix3,
  Matrix4,
  DoubleSide,
  Mesh,
  NormalBlending,
  Object3D,
  Sphere,
  Vector3,
  type Material,
} from 'three';
import { isLeftLive } from './staticFreeze';

/**
 * **Props that never move are drawn a tile at a time, not a mesh at a time**
 * (120 fps plan, step 14; `docs/perf/FRAME-DROPS-2026-11.md` item 12).
 *
 * Every mesh three.js draws costs a draw call and, before it, a program bind
 * and a round of uniform uploads — about 1.7 µs of the main thread each on an
 * M4 Pro, measured by drawing the same frame both ways. The Rail Race's camera
 * looks right across the park, so it paid that for every candy-striped ring on
 * every booth post, every fence board and every fairy-light knob: 2,307 draw
 * calls a frame on seed 5, the heaviest scene in the game. Almost all of it is
 * furniture that has not moved since the park was built.
 *
 * So, once the park is placed, the meshes of an area that share a material,
 * the same shadow flags and the same vertex layout are **merged into one mesh
 * per ground tile**: their triangles, carried into the tile's frame, in one
 * vertex buffer. One draw where there were dozens, and the tile is still small
 * enough for three's own frustum test to skip it when it is off the screen.
 *
 * ## Why the picture is the same
 *
 * The batch draws with **the very same material object** its sources drew with
 * — so it compiles to the same program, and anything that later changes that
 * material (a window's glow at dusk) changes the batch with it. An area may
 * also merge meshes whose materials are separate objects with equal values
 * (`toonMaterial()` makes a new one per call, so a booth has three identical
 * creams); the batch then draws with the first of them, and the audit below
 * holds every one of them to the values it had.
 *
 * Only the transform moves: from the GPU's `modelMatrix × position` into the
 * vertex data, computed once here in double precision. Normals go through the
 * same inverse-transpose three uses, a mirrored source has its winding turned
 * so its front faces stay front, and opaque draws resolve by the depth test
 * whatever their order. What could differ is float rounding — a pixel on an
 * edge — which `scripts/static-batch-diff.mts` measures rather than assumes.
 *
 * ## What is never merged
 *
 * A mesh is merged only when nothing can ever want it on its own:
 *
 * - it is **static** — not instanced, skinned or carrying `userData`, and no
 *   node between it and the area root is either ({@link isLeftLive}, the same
 *   rule `staticFreeze.ts` freezes by: a handle on a node means somebody may
 *   drive it). The stall flags flutter through `userData`, so they stay.
 * - it is **opaque and order-free** — transparent, depth-test-off,
 *   depth-write-off or custom-blended materials are drawn back to front or
 *   in order, and a merge would reorder them.
 * - it is **ordinary to three** — one material, culled, on layer 0, with no
 *   `onBeforeRender`-style hooks, custom depth materials, morph targets, a
 *   partial draw range, interleaved, quantised or tangent attributes, a group
 *   `renderOrder` above it, or a matrix written by hand.
 *
 * The caller names the areas, and leaves out anything driven without a
 * `userData` handle (`world/parkStatics.ts` says which, and why).
 *
 * ## Where the sources go
 *
 * A merged mesh stops being drawn by itself in one of two ways:
 *
 * - **Out of the graph.** Taken off its parent, so the renderer, the shadow
 *   pass and `updateMatrixWorld` no longer walk it at all — measured at 0.2 ms
 *   a frame for the first 543 sources, on top of the draw calls.
 * - **Off layer 0**, onto {@link BATCHED_AWAY_LAYER}, which no camera draws —
 *   for a mesh inside something a child can select. The rainbow outline builds
 *   its shell by walking the selected object (`art/effects/rainbowOutline.ts`
 *   tests `visible`, not layers) and `Selection` picks it by
 *   `Box3.setFromObject`, which reads every descendant; both must keep finding
 *   exactly the meshes they always found, so those stay where they were.
 *
 * Nothing in the park raycasts these props, and collision never came from
 * meshes, so neither is touched.
 *
 * ## The silent failure, and its guard
 *
 * The same one `staticFreeze.ts` has, one step on: somebody later animates a
 * merged prop — moves it, hides it, swaps its material — and the screen does
 * not follow, because the batch drew a copy of where it was. Nothing throws.
 * Every batch therefore keeps a record of what it baked, and
 * {@link auditBatched} holds each source to it: the transform up to the area
 * root, `visible` all the way up, where it hangs, the material and geometry
 * objects, every attribute's `version`, a shared material's values, the shadow
 * flags. `check:static-freeze` runs it against a played park.
 *
 * Render-only, like `staticFreeze.ts`: nothing procgen imports reaches this
 * file, so the park-source hash does not move for it.
 */

/**
 * The layer a merged source inside a selectable thing is moved to: one no
 * camera renders. Not 1 (the viewmodel layer, `core/constants.ts`) and not 31
 * (`check:cull-audit`'s spare layer for its pixel control).
 */
export const BATCHED_AWAY_LAYER = 30;

/** Marks a batch mesh this module made, carrying the record of what it baked. */
const BATCH = Symbol.for('lgp.staticBatch');

/**
 * `?staticBatch=0` turns batching off at boot, so a page can be compared with
 * the unbatched park; anything else (or nothing) leaves it on. A developer
 * flag, like `?shadowCache=` — nothing a child presses reaches it.
 */
export function staticBatchRequested(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get('staticBatch') !== '0';
}

export interface BatchAreaOptions {
  /** Names the batch meshes (`<label>:batch`) and their group (`<label>:batches`). */
  readonly label: string;
  /**
   * Ground tile edge, metres. A batch is culled as one object, so this is the
   * trade between draw calls (one per material per tile on screen) and
   * triangles drawn off the screen inside a tile that is partly on it.
   */
  readonly tileSize: number;
  /**
   * How far below the root the node is that decides a mesh's tile — 1 for the
   * root's children (a booth, a pole), 2 for theirs (one wall in the
   * `wooden-walls` group). Everything under one such node lands in one tile,
   * so a booth is never cut in two by a tile edge.
   */
  readonly unitDepth: number;
  /**
   * Objects something measures **whole** — a rainbow-outline target, whose
   * shell and pick box are built by walking it. A source inside one stays in
   * the graph, off layer 0; every other source is taken out of it. None of
   * these may be `root` or above it: the batches are added to `root`, and must
   * not be measured as part of anything.
   */
  readonly measuredWhole: ReadonlySet<Object3D>;
  /**
   * Merge meshes whose materials are equal in value though separate objects.
   * For areas built with a fresh material per part; never for one whose
   * materials are changed after building (the audit would catch it, but only
   * on the frames it looks).
   */
  readonly shareEqualMaterials?: boolean;
  /**
   * Subtrees left entirely alone: something under them moves without a
   * `userData` handle to say so (an arrival that drives past, a wheel that
   * turns), and the caller knows it.
   */
  readonly skip?: ReadonlySet<Object3D>;
  /**
   * Merge see-through meshes too — for an area whose see-through parts are
   * one material and do not cross each other or anything else see-through
   * (a park's worth of fairy cables, the glitter on one rink floor). three
   * sorts see-through draws back to front by object, so merged they sort as
   * one: measured on seed 5 to change no more pixels than moving the camera
   * ten micrometres does (`scripts/static-batch-diff.mts`). Never with
   * {@link shareEqualMaterials}'s sharing, and never a double-sided material,
   * which three draws in two passes per object.
   */
  readonly transparentToo?: boolean;
}

/** What batching one area did. */
export interface BatchCount {
  readonly label: string;
  /** Meshes now drawn by a batch instead of by themselves. */
  merged: number;
  /** Of those, the ones left in the graph because something measures them whole. */
  keptInGraph: number;
  /** Batch meshes made. */
  batches: number;
  /** Visible plain meshes left to draw themselves, by the first reason found. */
  kept: Record<string, number>;
}

/** One merged mesh, as baked — what {@link auditBatched} holds it to. */
interface SourceRecord {
  readonly mesh: Mesh;
  /** The parent it hung from when baked — and still hangs from, unless {@link detached}. */
  readonly parent: Object3D;
  /** Taken out of the graph (true), or left in it off layer 0 (false). */
  readonly detached: boolean;
  /** The source's world matrix relative to the area root, when baked. */
  readonly relative: Matrix4;
  readonly material: Material;
  /** The material's values when baked, if the batch draws with another material object equal to it. */
  readonly materialValues: string | null;
  readonly geometry: BufferGeometry;
  /** `version` of every attribute (in `attributeNames` order), then the index's. */
  readonly versions: readonly number[];
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  readonly renderOrder: number;
  /** Its bounding sphere in the batch's own frame: centre x, y, z and radius. */
  readonly sphere: readonly [number, number, number, number];
  /** Its triangles in the batch's index, as [first index, index count]. */
  readonly triangles: readonly [number, number];
}

export interface BatchRecord {
  readonly label: string;
  readonly root: Object3D;
  readonly attributeNames: readonly string[];
  readonly sources: readonly SourceRecord[];
  /** False while {@link setStaticBatchesDrawn} has handed drawing back to the sources. */
  drawn: boolean;
}

type BatchMesh = Mesh & { [BATCH]?: BatchRecord };

/** The record a batch mesh carries, or `undefined` for any other object. */
export function batchRecordOf(object: Object3D): BatchRecord | undefined {
  return (object as BatchMesh)[BATCH];
}

const defaultHooks = Object3D.prototype;

/**
 * Why `mesh` must keep drawing itself, or `null` if it can be merged. The
 * render-state half of the rules above; the static half (live nodes between it
 * and the root) is asked by the caller, which walks that chain anyway.
 */
function cannotMerge(mesh: Mesh, transparentToo = false): string | null {
  const kind = mesh as Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean; isBatchedMesh?: boolean };
  if (kind.isInstancedMesh || kind.isSkinnedMesh || kind.isBatchedMesh) return 'instanced or skinned';
  const material = mesh.material;
  if (Array.isArray(material)) return 'several materials';
  if (!material.visible) return 'material hidden';
  if (material.transparent && (!transparentToo || (material.side === DoubleSide && !material.forceSinglePass))) return 'transparent';
  if (!material.depthTest || (!material.depthWrite && !material.transparent)) return 'depth-order dependent';
  if (material.blending !== NormalBlending) return 'blending';
  if ((material as Material & { wireframe?: boolean }).wireframe) return 'wireframe';
  if (!mesh.frustumCulled) return 'not culled';
  if (mesh.layers.mask !== 1) return 'layers';
  if (
    mesh.onBeforeRender !== defaultHooks.onBeforeRender ||
    mesh.onAfterRender !== defaultHooks.onAfterRender ||
    mesh.onBeforeShadow !== defaultHooks.onBeforeShadow ||
    mesh.onAfterShadow !== defaultHooks.onAfterShadow
  ) {
    return 'render hooks';
  }
  if (mesh.customDepthMaterial || mesh.customDistanceMaterial) return 'custom depth material';
  if (mesh.morphTargetInfluences && mesh.morphTargetInfluences.length > 0) return 'morph targets';
  const geometry = mesh.geometry;
  if (Object.keys(geometry.morphAttributes).length > 0) return 'morph targets';
  const position = geometry.getAttribute('position');
  if (!position) return 'no positions';
  const indexCount = geometry.index ? geometry.index.count : position.count;
  if (geometry.drawRange.start !== 0 || geometry.drawRange.count < indexCount) return 'draw range';
  if (geometry.index && (geometry.index as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) return 'attributes';
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.attributes[name] as BufferAttribute & { isInterleavedBufferAttribute?: boolean; isInstancedBufferAttribute?: boolean };
    if (attribute.isInterleavedBufferAttribute || attribute.isInstancedBufferAttribute) return 'attributes';
    if (name === 'tangent') return 'attributes';
    if ((name === 'position' || name === 'normal') && (!(attribute.array instanceof Float32Array) || attribute.itemSize !== 3 || attribute.normalized)) {
      return 'attributes';
    }
  }
  return null;
}

/** The renderOrder three sorts this mesh's group by: its nearest `Group` ancestor's (`projectObject`). */
function groupOrderOf(mesh: Object3D): number {
  for (let at = mesh.parent; at; at = at.parent) {
    if ((at as Group).isGroup) return at.renderOrder;
  }
  return 0;
}

/** Name, item size, normalisation and array type of every attribute: meshes merge only with their own kind. */
function layoutOf(geometry: BufferGeometry): string {
  return Object.keys(geometry.attributes)
    .sort()
    .map((name) => {
      const attribute = geometry.attributes[name] as BufferAttribute;
      return `${name}:${attribute.itemSize}:${attribute.normalized ? 'n' : ''}:${attribute.array.constructor.name}`;
    })
    .join(',');
}

/**
 * A material's values, as one string: equal strings draw identically. Every
 * own property three reads is in it — colours to the bit, textures by
 * identity, numbers and flags as they are. `null` when the material carries
 * anything this cannot compare (its own `onBeforeCompile`, clipping planes,
 * an unknown object), which keeps it from being shared.
 */
export function materialValues(material: Material): string | null {
  const parts: string[] = [material.type];
  const record = material as unknown as Record<string, unknown>;
  for (const key of Object.keys(record).sort()) {
    // `_alphaTest` and its kind hold values behind three's own setters, so
    // only the listener table (functions, from `EventDispatcher`) is skipped.
    if (key === 'uuid' || key === 'name' || key === 'userData' || key === 'version' || key === '_listeners') continue;
    const value = record[key];
    if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
      parts.push(`${key}=${String(value)}`);
      continue;
    }
    if (typeof value === 'function') return null;
    const object = value as { isColor?: boolean; isTexture?: boolean; isVector2?: boolean; isVector3?: boolean; isEuler?: boolean; uuid?: string; r?: number; g?: number; b?: number; toArray?: () => number[] };
    if (object.isColor) parts.push(`${key}=${object.r},${object.g},${object.b}`);
    else if (object.isTexture) parts.push(`${key}=texture:${object.uuid}`);
    else if ((object.isVector2 || object.isVector3 || object.isEuler) && object.toArray) parts.push(`${key}=${object.toArray().join(',')}`);
    else if (key === 'defines') parts.push(`${key}=${JSON.stringify(value)}`);
    else return null;
  }
  return parts.join('|');
}

const scratchMatrix = new Matrix4();
const scratchNormal = new Matrix3();
const scratchVector = new Vector3();
const scratchSphere = new Sphere();

/**
 * Concatenates `sources` into one geometry in the frame `frameInverse` undoes.
 * Positions and normals are carried through each source's own transform;
 * every other attribute is copied as it is. Returns, per source, where its
 * triangles went.
 */
function mergeInto(
  sources: readonly Mesh[],
  frameInverse: Matrix4,
  attributeNames: readonly string[],
): { geometry: BufferGeometry; triangles: [number, number][] } {
  let vertexCount = 0;
  let indexCount = 0;
  for (const source of sources) {
    const geometry = source.geometry;
    const count = (geometry.getAttribute('position') as BufferAttribute).count;
    vertexCount += count;
    indexCount += geometry.index ? geometry.index.count : count;
  }
  const first = sources[0] as Mesh;
  const arrays = attributeNames.map((name) => {
    const attribute = first.geometry.getAttribute(name) as BufferAttribute;
    const Ctor = attribute.array.constructor as new (length: number) => BufferAttribute['array'];
    return new Ctor(vertexCount * attribute.itemSize);
  });
  const index = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  const triangles: [number, number][] = [];

  let vertexBase = 0;
  let indexAt = 0;
  for (const source of sources) {
    const geometry = source.geometry;
    const position = geometry.getAttribute('position') as BufferAttribute;
    const count = position.count;
    scratchMatrix.multiplyMatrices(frameInverse, source.matrixWorld);
    scratchNormal.getNormalMatrix(scratchMatrix);
    const mirrored = scratchMatrix.determinant() < 0;

    attributeNames.forEach((name, slot) => {
      const attribute = geometry.getAttribute(name) as BufferAttribute;
      const target = arrays[slot] as BufferAttribute['array'];
      const size = attribute.itemSize;
      const offset = vertexBase * size;
      if (name === 'position') {
        for (let i = 0; i < count; i += 1) {
          scratchVector.fromBufferAttribute(attribute, i).applyMatrix4(scratchMatrix);
          target[offset + i * 3] = scratchVector.x;
          target[offset + i * 3 + 1] = scratchVector.y;
          target[offset + i * 3 + 2] = scratchVector.z;
        }
      } else if (name === 'normal') {
        for (let i = 0; i < count; i += 1) {
          scratchVector.fromBufferAttribute(attribute, i).applyMatrix3(scratchNormal).normalize();
          target[offset + i * 3] = scratchVector.x;
          target[offset + i * 3 + 1] = scratchVector.y;
          target[offset + i * 3 + 2] = scratchVector.z;
        }
      } else {
        const from = attribute.array;
        for (let i = 0, n = count * size; i < n; i += 1) target[offset + i] = from[i] as number;
      }
    });

    const start = indexAt;
    const sourceIndex = geometry.index;
    const corners = sourceIndex ? sourceIndex.count : count;
    for (let i = 0; i + 2 < corners; i += 3) {
      const a = sourceIndex ? sourceIndex.getX(i) : i;
      const b = sourceIndex ? sourceIndex.getX(i + 1) : i + 1;
      const c = sourceIndex ? sourceIndex.getX(i + 2) : i + 2;
      // A mirrored source is drawn by three with the front face flipped
      // (`frontFaceCW`); baked, it is drawn unflipped, so its winding turns.
      index[indexAt++] = vertexBase + a;
      index[indexAt++] = vertexBase + (mirrored ? c : b);
      index[indexAt++] = vertexBase + (mirrored ? b : c);
    }
    triangles.push([start, indexAt - start]);
    vertexBase += count;
  }

  const geometry = new BufferGeometry();
  attributeNames.forEach((name, slot) => {
    const attribute = first.geometry.getAttribute(name) as BufferAttribute;
    geometry.setAttribute(name, new BufferAttribute(arrays[slot] as BufferAttribute['array'], attribute.itemSize, attribute.normalized));
  });
  geometry.setIndex(new BufferAttribute(indexAt === index.length ? index : index.slice(0, indexAt), 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, triangles };
}

const composeScratch = new Matrix4();

/**
 * The transform of `mesh` relative to `root`, composed from `position`,
 * `quaternion` and `scale` of it and of every node from `parent` up — never
 * from the stored matrices, which a frozen node stops updating. `null` if
 * `root` is not above it.
 */
function relativeFromTransforms(mesh: Object3D, parent: Object3D | null, root: Object3D, target: Matrix4): Matrix4 | null {
  target.compose(mesh.position, mesh.quaternion, mesh.scale);
  let at: Object3D | null = parent;
  while (at && at !== root) {
    target.premultiply(composeScratch.compose(at.position, at.quaternion, at.scale));
    at = at.parent;
  }
  return at === root ? target : null;
}

function maxDelta(a: Matrix4, b: Matrix4): number {
  let delta = 0;
  for (let i = 0; i < 16; i += 1) delta = Math.max(delta, Math.abs((a.elements[i] ?? Number.NaN) - (b.elements[i] ?? Number.NaN)));
  return delta;
}

function attributeVersions(geometry: BufferGeometry, names: readonly string[]): number[] {
  const versions = names.map((name) => (geometry.getAttribute(name) as BufferAttribute | undefined)?.version ?? Number.NaN);
  versions.push(geometry.index ? geometry.index.version : -1);
  return versions;
}

/** Takes a source out of drawing: out of the graph, or off layer 0. */
function stand(source: SourceRecord, drawnByBatch: boolean): void {
  if (drawnByBatch) {
    source.mesh.layers.set(BATCHED_AWAY_LAYER);
    if (source.detached) source.parent.remove(source.mesh);
  } else {
    source.mesh.layers.set(0);
    if (source.detached && source.mesh.parent !== source.parent) source.parent.add(source.mesh);
  }
}

/**
 * Merges the static, ordinary meshes under `root` into batches, one per tile
 * and draw state, and hands drawing over to them. Call it **after** placement;
 * the batch is baked from the world matrices as they stand.
 *
 * The batches go in a `<label>:batches` group added to `root`, so they come and
 * go with it — `World.setParkVisible` hides the park's groups whole.
 */
export function batchStatic(root: Object3D, options: BatchAreaOptions): BatchCount {
  for (let at: Object3D | null = root; at; at = at.parent) {
    if (options.measuredWhole.has(at)) throw new Error(`batchStatic(${options.label}): the area root is inside something measured whole; its batches would be measured with it`);
  }
  root.updateWorldMatrix(true, true);
  const count: BatchCount = { label: options.label, merged: 0, keptInGraph: 0, batches: 0, kept: {} };
  const keep = (reason: string): void => {
    count.kept[reason] = (count.kept[reason] ?? 0) + 1;
  };

  // Collect, walking down from the root and carrying "is everything above me
  // static?" so a live node's whole subtree is left to its owner, and "is
  // anything above me measured whole?" for where the source goes.
  interface Candidate {
    readonly mesh: Mesh;
    readonly inMeasured: boolean;
    readonly values: string | null;
    readonly tile: string;
  }
  const buckets = new Map<string, Candidate[]>();
  /**
   * Each tile's one origin, in the root's frame, shared by every batch in it.
   * An ink outline is a second mesh hugging its object at a few millimetres;
   * drawn, the two used to share one model matrix, so their depths rounded
   * together. Baked into batches with origins of their own they round apart,
   * and silhouette pixels flip between line and object — measured, 1,659
   * pixels beside the dodgems. One origin per tile keeps them rounding alike.
   */
  const tileOrigins = new Map<string, Vector3>();
  // Where a unit is, for its tile: the middle of what it draws, not its
  // origin — a fairy cable's tube is built in world coordinates on a mesh at
  // (0, 0, 0), and by its origin every cable in the park is in one tile.
  const middles = new Map<Object3D, Vector3>();
  const middleOf = (unit: Object3D): Vector3 => {
    let middle = middles.get(unit);
    if (!middle) {
      middle = new Box3().setFromObject(unit).getCenter(new Vector3());
      middles.set(unit, middle);
    }
    return middle;
  };
  const rootInverse = root.matrixWorld.clone().invert();
  const fromTransforms = new Matrix4();
  const fromMatrices = new Matrix4();
  const visit = (node: Object3D, depth: number, unit: Object3D, chainStatic: boolean, inMeasured: boolean): void => {
    if (!node.visible || options.skip?.has(node)) return;
    const here = depth === options.unitDepth ? node : unit;
    const staticHere = chainStatic && (node === root || !isLeftLive(node));
    const measuredHere = inMeasured || options.measuredWhole.has(node);
    const mesh = node as Mesh;
    if (mesh.isMesh) {
      let reason: string | null = staticHere ? cannotMerge(mesh, options.transparentToo === true) : 'live';
      if (reason === null && groupOrderOf(mesh) !== 0) reason = 'group renderOrder';
      if (reason === null) {
        // The audit holds a source to its transforms (position, quaternion,
        // scale), so a matrix somebody wrote by hand could never be audited:
        // such a mesh draws itself.
        const composed = relativeFromTransforms(mesh, mesh.parent, root, fromTransforms);
        fromMatrices.multiplyMatrices(rootInverse, mesh.matrixWorld);
        if (!composed || !(maxDelta(composed, fromMatrices) <= 1e-5)) reason = 'matrix not from its transform';
      }
      const material = mesh.material as Material;
      // A see-through material is only ever merged with itself: its draws are
      // ordered per object, so two equal ones are not interchangeable.
      const values = reason === null && options.shareEqualMaterials && !material.transparent ? materialValues(material) : null;
      if (reason !== null) {
        keep(reason);
      } else {
        const middle = middleOf(here);
        const tileX = Math.floor(middle.x / options.tileSize);
        const tileZ = Math.floor(middle.z / options.tileSize);
        const tile = `${tileX},${tileZ}`;
        if (!tileOrigins.has(tile)) tileOrigins.set(tile, middle.clone().applyMatrix4(rootInverse));
        const key = [
          tile,
          values ?? material.uuid,
          mesh.castShadow ? 1 : 0,
          mesh.receiveShadow ? 1 : 0,
          mesh.renderOrder,
          layoutOf(mesh.geometry),
        ].join('|');
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = [];
          buckets.set(key, bucket);
        }
        bucket.push({ mesh, inMeasured: measuredHere, values, tile });
      }
    }
    for (const child of node.children) visit(child, depth + 1, here, staticHere, measuredHere);
  };
  visit(root, 0, root, true, false);

  const group = new Group();
  group.name = `${options.label}:batches`;
  const frame = new Matrix4();
  const frameInverse = new Matrix4();
  const centre = new Vector3();

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) {
      // Merging one mesh draws exactly as many calls; leave it be.
      keep('alone in its tile');
      continue;
    }
    const sources = bucket.map((candidate) => candidate.mesh);
    const first = sources[0] as Mesh;
    // The batch's origin: its tile's, in the root's frame — near its contents,
    // so the baked coordinates stay small (float32 is kindest near zero), and
    // the same for every batch of the tile (see `tileOrigins`).
    for (const source of sources) if (source.geometry.boundingSphere === null) source.geometry.computeBoundingSphere();
    centre.copy(tileOrigins.get((bucket[0] as Candidate).tile) as Vector3);
    frame.copy(root.matrixWorld).multiply(scratchMatrix.makeTranslation(centre.x, centre.y, centre.z));
    frameInverse.copy(frame).invert();

    const attributeNames = Object.keys(first.geometry.attributes).sort();
    const { geometry, triangles } = mergeInto(sources, frameInverse, attributeNames);
    const batchMaterial = first.material as Material;
    const batch = new Mesh(geometry, batchMaterial) as BatchMesh;
    batch.name = `${options.label}:batch`;
    batch.position.copy(centre);
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    batch.renderOrder = first.renderOrder;
    batch.updateMatrix();
    batch.matrixAutoUpdate = false;

    // When the batch draws for meshes whose materials are separate (equal)
    // objects, every one of them — the batch's own included — is held to its
    // values: a change to any of them would show on some meshes and not others.
    const mixed = bucket.some((candidate) => candidate.mesh.material !== batchMaterial);
    const records: SourceRecord[] = bucket.map((candidate, i) => {
      const source = candidate.mesh;
      const geometryOfSource = source.geometry;
      scratchSphere.copy(geometryOfSource.boundingSphere as Sphere).applyMatrix4(source.matrixWorld).applyMatrix4(frameInverse);
      return {
        mesh: source,
        parent: source.parent as Object3D,
        // Only a leaf leaves the graph: a mesh with children (an ink outline
        // hangs off its mesh) would take them with it, merged or not.
        detached: !candidate.inMeasured && source.children.length === 0,
        relative: rootInverse.clone().multiply(source.matrixWorld),
        material: source.material as Material,
        materialValues: mixed ? candidate.values : null,
        geometry: geometryOfSource,
        versions: attributeVersions(geometryOfSource, attributeNames),
        castShadow: source.castShadow,
        receiveShadow: source.receiveShadow,
        renderOrder: source.renderOrder,
        sphere: [scratchSphere.center.x, scratchSphere.center.y, scratchSphere.center.z, scratchSphere.radius],
        triangles: triangles[i] as [number, number],
      };
    });
    batch[BATCH] = { label: options.label, root, attributeNames, sources: records, drawn: true };
    group.add(batch);
    for (const record of records) {
      stand(record, true);
      // Nothing draws it now, so nothing needs its matrices re-derived every
      // frame: they stay as baked, for the outline and `Selection`, which read
      // them. A move is the audit's to catch, from the transforms.
      record.mesh.matrixAutoUpdate = false;
      record.mesh.matrixWorldAutoUpdate = false;
      if (!record.detached) count.keptInGraph += 1;
    }
    count.merged += records.length;
    count.batches += 1;
  }

  if (count.batches > 0) {
    group.updateMatrix();
    group.matrixAutoUpdate = false;
    root.add(group);
    group.updateMatrixWorld(true);
  }
  return count;
}

/** Every batch mesh under `scene`. */
function batchesUnder(scene: Object3D): BatchMesh[] {
  const found: BatchMesh[] = [];
  scene.traverse((node) => {
    if ((node as BatchMesh)[BATCH]) found.push(node as BatchMesh);
  });
  return found;
}

/**
 * Hands drawing back to the sources (`false`) or to the batches (`true`), for
 * every batch under `scene`. For comparing the two pictures in one page — the
 * frame is otherwise identical, which is the only honest A/B for "pixel-
 * identical" — and for a person who suspects a batch. The game never calls it.
 */
export function setStaticBatchesDrawn(scene: Object3D, drawn: boolean): number {
  let sources = 0;
  for (const batch of batchesUnder(scene)) {
    const record = batch[BATCH] as BatchRecord;
    record.drawn = drawn;
    batch.visible = drawn;
    for (const source of record.sources) {
      stand(source, drawn);
      sources += 1;
    }
  }
  return sources;
}

/** One merged source that no longer matches what its batch baked. */
export interface BatchDrift {
  /** Names from the scene root down (through the parent it was baked under, if it is out of the graph). */
  readonly path: string;
  readonly what: string;
}

export interface BatchAudit {
  /** Batch meshes found. */
  readonly batches: number;
  /** Merged sources measured. Zero means the audit covered nothing. */
  readonly sources: number;
  /** Of those, the ones out of the graph. */
  readonly detached: number;
  readonly drifted: BatchDrift[];
}

function pathOf(node: Object3D, parent: Object3D | null): string {
  const names: string[] = [node.name || node.type];
  for (let at: Object3D | null = parent; at; at = at.parent) names.unshift(at.name || at.type);
  return names.join(' > ');
}

const composed = new Matrix4();

/**
 * Holds every merged source under `scene` to what its batch baked, and reports
 * each one that has changed in a way the batch cannot show:
 *
 * - **moved** — its transform, recomposed from `position`/`quaternion`/`scale`
 *   of itself and every node up to the area root (never from the stored
 *   matrices, which a frozen node stops updating), differs from the baked one;
 * - **hidden** — it, or a node between it and the root, is no longer `visible`;
 * - **re-hung** — it is under another parent than it was baked under, or, if
 *   it was taken out of the graph, somebody has put it back in;
 * - **restyled** — another material or geometry object, an attribute or index
 *   rewritten (`version`), a shared material's values changed, or a changed
 *   shadow flag or `renderOrder`;
 * - **drawn twice** — it is on a layer a camera draws while its batch still
 *   draws it.
 *
 * A `NaN` anywhere counts as drift: a comparison that cannot be made fails.
 */
export function auditBatched(scene: Object3D, tolerance = 1e-5): BatchAudit {
  const drifted: BatchDrift[] = [];
  let sources = 0;
  let detached = 0;
  const batches = batchesUnder(scene);
  for (const batch of batches) {
    const record = batch[BATCH] as BatchRecord;
    if (record.drawn && (!batch.visible || batch.layers.mask !== 1)) drifted.push({ path: pathOf(batch, batch.parent), what: 'the batch itself is hidden or off layer 0' });
    for (const source of record.sources) {
      sources += 1;
      const mesh = source.mesh;
      const say = (what: string): void => {
        drifted.push({ path: pathOf(mesh, source.parent), what });
      };
      const outOfGraph = record.drawn && source.detached;
      if (outOfGraph) detached += 1;
      if (outOfGraph ? mesh.parent !== null : mesh.parent !== source.parent) {
        say(outOfGraph ? 'put back into the graph while its batch still draws it' : 'moved to another parent than it was baked under');
        continue;
      }
      const relative = relativeFromTransforms(mesh, source.parent, record.root, composed);
      if (!relative) {
        say('no longer under its area root');
        continue;
      }
      let hidden = !mesh.visible;
      for (let at: Object3D | null = source.parent; at && at !== record.root; at = at.parent) if (!at.visible) hidden = true;
      if (hidden) say('hidden (itself or a parent below the area root), but its batch still draws it');
      const delta = maxDelta(relative, source.relative);
      if (!(delta <= tolerance)) say(`moved by up to ${delta.toFixed(5)} since it was baked`);
      if (mesh.material !== source.material) say('material swapped');
      else if (source.materialValues !== null && materialValues(source.material) !== source.materialValues) {
        say('its material changed value, but its batch draws with another material object that was equal to it');
      }
      if (mesh.geometry !== source.geometry) say('geometry swapped');
      else {
        const now = attributeVersions(mesh.geometry, record.attributeNames);
        if (now.some((version, i) => version !== source.versions[i])) say('geometry rewritten (an attribute or the index changed version)');
      }
      if (mesh.castShadow !== source.castShadow || mesh.receiveShadow !== source.receiveShadow) say('shadow flags changed');
      if (mesh.renderOrder !== source.renderOrder) say('renderOrder changed');
      const expected = record.drawn ? 1 << BATCHED_AWAY_LAYER : 1;
      if (mesh.layers.mask !== expected) say(`on layer mask ${mesh.layers.mask}, expected ${expected} — drawn twice, or not at all`);
    }
  }
  return { batches: batches.length, sources, detached, drifted };
}
