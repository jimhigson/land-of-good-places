/**
 * **A `.glb` cut down to some of its nodes** — for a kit that ships in two
 * pieces (`pack:library`: the building with the park, the reading room when she
 * goes in; `src/art/models/libraryKitSplit.ts` owns which node goes where —
 * and `pack:hotel`: the tower with the park, the furniture when she walks in;
 * `src/art/models/hotelKitSplit.ts`). **The one cutter**: two were written the
 * same day (#760 and #762) and this is the one kept.
 *
 * Every node kept carries its mesh, and every mesh its accessors and their
 * buffer views, copied byte for byte into a fresh binary chunk and renumbered;
 * nothing else changes — names, translations and `extras` (a faced head's
 * figures) go across as they are. Deterministic, so `check:library-glb` can cut
 * the committed file again and compare the shipped modules to it byte for byte.
 *
 * Only the shape of glTF the Artist's exports have is accepted — root nodes,
 * each a mesh at a translation, no materials, textures, skins, animations or
 * cameras — and anything else throws, so a richer export is a loud failure here
 * rather than a quietly dropped part.
 */

interface GltfJson {
  asset: unknown;
  scene?: number;
  scenes: { name?: string; nodes: number[] }[];
  nodes: { name?: string; mesh?: number; children?: number[]; [key: string]: unknown }[];
  meshes: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; [key: string]: unknown }[] }[];
  accessors: { bufferView?: number; [key: string]: unknown }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; [key: string]: unknown }[];
  buffers: { byteLength: number }[];
  [key: string]: unknown;
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const KNOWN_KEYS = new Set(['asset', 'scene', 'scenes', 'nodes', 'meshes', 'accessors', 'bufferViews', 'buffers']);

function readGlb(bytes: Uint8Array): { json: GltfJson; bin: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('splitGlb: no glTF magic');
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON) throw new Error('splitGlb: first chunk is not JSON');
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as GltfJson;
  const binStart = 20 + jsonLength;
  const binLength = view.getUint32(binStart, true);
  if (view.getUint32(binStart + 4, true) !== CHUNK_BIN) throw new Error('splitGlb: second chunk is not BIN');
  return { json, bin: bytes.subarray(binStart + 8, binStart + 8 + binLength) };
}

const pad4 = (n: number): number => (n + 3) & ~3;

/** The nodes of `bytes` that `keep` admits, as a `.glb` of their own. */
export function glbSubset(bytes: Uint8Array, keep: (name: string) => boolean): Uint8Array {
  const { json, bin } = readGlb(bytes);
  const unknown = Object.keys(json).filter((key) => !KNOWN_KEYS.has(key));
  if (unknown.length > 0) throw new Error(`splitGlb: the file carries ${unknown.join(', ')}, which this splitter does not copy`);
  if (json.buffers.length !== 1) throw new Error(`splitGlb: ${json.buffers.length} buffers, wanted one`);
  const scene = json.scenes[json.scene ?? 0];
  if (!scene || json.scenes.length !== 1) throw new Error('splitGlb: wanted exactly one scene');
  for (const node of json.nodes) {
    if (node.children?.length) throw new Error(`splitGlb: node ${node.name} has children; only root nodes are split`);
  }

  const nodeMap = new Map<number, number>();
  const meshMap = new Map<number, number>();
  const accessorMap = new Map<number, number>();
  const viewMap = new Map<number, number>();
  const nodes: GltfJson['nodes'] = [];
  const meshes: GltfJson['meshes'] = [];
  const accessors: GltfJson['accessors'] = [];
  const bufferViews: GltfJson['bufferViews'] = [];
  const chunks: Uint8Array[] = [];
  let binLength = 0;

  const viewIndex = (old: number): number => {
    const known = viewMap.get(old);
    if (known !== undefined) return known;
    const source = json.bufferViews[old];
    if (!source) throw new Error(`splitGlb: no buffer view ${old}`);
    const offset = binLength;
    const start = source.byteOffset ?? 0;
    chunks.push(bin.subarray(start, start + source.byteLength));
    const padded = pad4(source.byteLength);
    if (padded > source.byteLength) chunks.push(new Uint8Array(padded - source.byteLength));
    binLength += padded;
    const index = bufferViews.length;
    bufferViews.push({ ...source, buffer: 0, byteOffset: offset });
    viewMap.set(old, index);
    return index;
  };
  const accessorIndex = (old: number): number => {
    const known = accessorMap.get(old);
    if (known !== undefined) return known;
    const source = json.accessors[old];
    if (!source) throw new Error(`splitGlb: no accessor ${old}`);
    const copy = { ...source };
    if (source.bufferView !== undefined) copy.bufferView = viewIndex(source.bufferView);
    const index = accessors.length;
    accessors.push(copy);
    accessorMap.set(old, index);
    return index;
  };
  const meshIndex = (old: number): number => {
    const known = meshMap.get(old);
    if (known !== undefined) return known;
    const source = json.meshes[old];
    if (!source) throw new Error(`splitGlb: no mesh ${old}`);
    const copy = {
      ...source,
      primitives: source.primitives.map((primitive) => {
        if ('material' in primitive || 'targets' in primitive) throw new Error(`splitGlb: mesh ${source.name} has a material or morph targets`);
        const attributes = Object.fromEntries(Object.entries(primitive.attributes).map(([key, accessor]) => [key, accessorIndex(accessor)]));
        return primitive.indices === undefined ? { ...primitive, attributes } : { ...primitive, attributes, indices: accessorIndex(primitive.indices) };
      }),
    };
    const index = meshes.length;
    meshes.push(copy);
    meshMap.set(old, index);
    return index;
  };

  for (const old of scene.nodes) {
    const source = json.nodes[old];
    if (!source) throw new Error(`splitGlb: the scene names node ${old}, which is not there`);
    if (!keep(source.name ?? '')) continue;
    const copy = { ...source };
    if (source.mesh !== undefined) copy.mesh = meshIndex(source.mesh);
    nodeMap.set(old, nodes.length);
    nodes.push(copy);
  }

  const out: GltfJson = {
    asset: json.asset,
    scene: 0,
    scenes: [{ ...scene, nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(out));
  const jsonPadded = pad4(jsonBytes.length);
  const total = 12 + 8 + jsonPadded + 8 + binLength;
  const result = new Uint8Array(total);
  const view = new DataView(result.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, CHUNK_JSON, true);
  result.set(jsonBytes, 20);
  result.fill(0x20, 20 + jsonBytes.length, 20 + jsonPadded);
  const binStart = 20 + jsonPadded;
  view.setUint32(binStart, binLength, true);
  view.setUint32(binStart + 4, CHUNK_BIN, true);
  let at = binStart + 8;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return result;
}

/** Every root node's name in `bytes`, in file order. */
export function glbNodeNames(bytes: Uint8Array): string[] {
  const { json } = readGlb(bytes);
  const scene = json.scenes[json.scene ?? 0];
  return (scene?.nodes ?? []).map((index) => json.nodes[index]?.name ?? `#${index}`);
}
