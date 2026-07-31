import { BufferAttribute, BufferGeometry, Matrix4, Quaternion, Vector3 } from 'three';

/**
 * A **synchronous** reader for the `.glb` files this repo authors.
 *
 * ## Why not `GLTFLoader`
 *
 * `GLTFLoader.parse()` is promise-based — it resolves on a microtask even for a
 * self-contained binary with no images and no external buffers. Every caller of
 * `createKid()` is synchronous, and there are fifteen of them: the character
 * creator (which rebuilds on every tap), the NPC crowd, four mini-games, the
 * coaster, the cat-bus arrival, and five Node check scripts. Threading a promise
 * through all of that to read a file that is already in memory would be a large
 * change with an initialisation-order bug in it, and none of it would make the
 * park better.
 *
 * So the game reads the subset of glTF it actually authors, itself, in one pass.
 * That subset is small on purpose: **meshes, their vertex attributes, and the
 * local transform of the node each one hangs off.** No materials, no textures,
 * no skins, no animations, no cameras, no scene graph deeper than one level —
 * all of which stay in code by design (see `scripts/export-kid-glb.mts`).
 *
 * ## Why this is safe to hand-roll
 *
 * Because it is checked against the real thing rather than trusted.
 * `check:character-parity` reads every authored asset **twice** — once with this
 * and once with three.js's own `GLTFLoader` — and asserts the two agree vertex
 * for vertex, and that both agree with the procedural build. A bug in here is
 * not a bug that can reach the park quietly; it is a build failure. Two
 * independent readers agreeing is the evidence, not this file looking correct.
 */

/** One mesh out of a `.glb`: its shape, and where its node sits. */
export interface GlbPart {
  readonly name: string;
  readonly geometry: BufferGeometry;
  /** The node's own local transform, decomposed. */
  readonly position: Vector3;
  readonly quaternion: Quaternion;
  readonly scale: Vector3;
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

const COMPONENT_ARRAYS = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
} as const;

const ITEM_SIZE: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};

/** glTF attribute name → the name three.js wants on a `BufferGeometry`. */
const ATTRIBUTE_NAMES: Record<string, string> = {
  POSITION: 'position',
  NORMAL: 'normal',
  TANGENT: 'tangent',
  TEXCOORD_0: 'uv',
  TEXCOORD_1: 'uv1',
  COLOR_0: 'color',
};

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: keyof typeof COMPONENT_ARRAYS;
  count: number;
  type: string;
  normalized?: boolean;
}

interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
}

interface GltfJson {
  meshes?: { name?: string; primitives: GltfPrimitive[] }[];
  nodes?: {
    name?: string;
    mesh?: number;
    children?: number[];
    translation?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
    matrix?: number[];
  }[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: { byteLength: number; uri?: string }[];
}

/** Splits a `.glb` container into its JSON manifest and its binary chunk. */
function splitChunks(data: ArrayBuffer): { json: GltfJson; bin: Uint8Array } {
  const view = new DataView(data);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error('glb: not a .glb — the file does not start with the glTF magic number.');
  }
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`glb: unsupported glTF container version ${version}.`);

  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;

  let at = 12;
  while (at + 8 <= data.byteLength) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const body = new Uint8Array(data, at + 8, length);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body)) as GltfJson;
    else if (type === CHUNK_BIN) bin = body;
    at += 8 + length + ((4 - (length % 4)) % 4);
  }

  if (!json) throw new Error('glb: no JSON chunk.');
  return { json, bin: bin ?? new Uint8Array(0) };
}

/**
 * Reads one accessor out of the binary chunk.
 *
 * Handles `byteStride`, which is how an exporter interleaves attributes: the
 * elements are then not adjacent, and reading them as a flat typed array
 * silently produces garbage rather than an error. `GLTFExporter` does not
 * currently interleave, but Blender's exporter is the one that will be writing
 * these files from Stage B onwards, so the stride is honoured rather than
 * assumed away.
 */
function readAccessor(json: GltfJson, bin: Uint8Array, index: number): BufferAttribute {
  const accessor = json.accessors?.[index];
  if (!accessor) throw new Error(`glb: no accessor ${index}.`);

  const itemSize = ITEM_SIZE[accessor.type];
  if (!itemSize) throw new Error(`glb: unsupported accessor type '${accessor.type}'.`);

  const Ctor = COMPONENT_ARRAYS[accessor.componentType];
  if (!Ctor) throw new Error(`glb: unsupported componentType ${accessor.componentType}.`);

  const out = new Ctor(accessor.count * itemSize);

  if (accessor.bufferView !== undefined) {
    const bufferView = json.bufferViews?.[accessor.bufferView];
    if (!bufferView) throw new Error(`glb: no bufferView ${accessor.bufferView}.`);
    if ((bufferView.buffer ?? 0) !== 0) {
      throw new Error('glb: this reader only handles the single embedded BIN buffer.');
    }

    const buffer = bin.buffer as ArrayBuffer;
    const base = bin.byteOffset + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const elementBytes = Ctor.BYTES_PER_ELEMENT;
    const stride = bufferView.byteStride ?? itemSize * elementBytes;

    if (stride === itemSize * elementBytes) {
      out.set(new Ctor(buffer, base, accessor.count * itemSize));
    } else {
      for (let i = 0; i < accessor.count; i += 1) {
        const element = new Ctor(buffer, base + i * stride, itemSize);
        out.set(element, i * itemSize);
      }
    }
  }

  const attribute = new BufferAttribute(out, itemSize, accessor.normalized === true);
  return attribute;
}

/**
 * Every mesh in a `.glb`, keyed by its **node** name.
 *
 * Node name rather than mesh name: two nodes may point at one mesh — which is
 * exactly what the kid's mirrored parts do, five pairs of them sharing one
 * geometry — and it is the node that carries the transform and the name a
 * caller asks for. An unnamed node is an error rather than a silent `mesh_1`,
 * because something the game looks up by name having lost its name is a whole
 * class of bug this pipeline is meant to make impossible.
 */
export function readGlbParts(data: ArrayBuffer): Map<string, GlbPart> {
  const { json, bin } = splitChunks(data);
  const parts = new Map<string, GlbPart>();

  // One `BufferGeometry` per glTF mesh, so nodes sharing a mesh share it here
  // too — the file's own deduplication survives the read.
  const geometries = new Map<number, BufferGeometry>();

  const geometryFor = (meshIndex: number): BufferGeometry => {
    const cached = geometries.get(meshIndex);
    if (cached) return cached;

    const mesh = json.meshes?.[meshIndex];
    if (!mesh) throw new Error(`glb: no mesh ${meshIndex}.`);
    if (mesh.primitives.length !== 1) {
      throw new Error(
        `glb: mesh ${meshIndex} has ${mesh.primitives.length} primitives; this reader ` +
          `expects exactly one, because every part in this repo is one material.`,
      );
    }
    const primitive = mesh.primitives[0] as GltfPrimitive;
    if (primitive.mode !== undefined && primitive.mode !== 4) {
      throw new Error(`glb: mesh ${meshIndex} is not TRIANGLES (mode ${primitive.mode}).`);
    }

    const geometry = new BufferGeometry();
    for (const [gltfName, accessor] of Object.entries(primitive.attributes)) {
      const name = ATTRIBUTE_NAMES[gltfName];
      if (!name) continue;
      geometry.setAttribute(name, readAccessor(json, bin, accessor));
    }
    if (primitive.indices !== undefined) {
      geometry.setIndex(readAccessor(json, bin, primitive.indices));
    }
    geometry.computeBoundingSphere();
    geometries.set(meshIndex, geometry);
    return geometry;
  };

  const matrix = new Matrix4();
  json.nodes?.forEach((node, index) => {
    if (node.mesh === undefined) return;
    const name = node.name;
    if (!name) {
      throw new Error(
        `glb: node ${index} carries a mesh but has no name. Every part has to be named ` +
          `in the modelling package — an anonymous node comes back as 'mesh_1'.`,
      );
    }

    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3(1, 1, 1);

    if (node.matrix) {
      matrix.fromArray(node.matrix).decompose(position, quaternion, scale);
    } else {
      if (node.translation) position.fromArray(node.translation);
      if (node.rotation) quaternion.fromArray(node.rotation);
      if (node.scale) scale.fromArray(node.scale);
    }

    parts.set(name, { name, geometry: geometryFor(node.mesh), position, quaternion, scale });
  });

  return parts;
}

/** Decodes a base64 asset module back into the bytes {@link readGlbParts} wants. */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // `atob` in the browser, `Buffer` in Node — both are always present in their
  // own environment, and neither needs a polyfill or a bundler plugin.
  const binary =
    typeof atob === 'function'
      ? atob(base64)
      : (globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } })
          .Buffer!.from(base64, 'base64')
          .toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
