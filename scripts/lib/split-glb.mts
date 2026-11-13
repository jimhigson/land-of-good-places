/**
 * **Cuts a `.glb` into a smaller one holding only some of its nodes.**
 *
 * For an asset whose parts load at different times — the hotel's tower is in
 * the park at boot, its furniture only once she walks in (`pack:hotel`,
 * `src/art/models/hotelKitSplit.ts`). The Blender build stays one file; the cut
 * happens here, at pack time, so nothing about authoring changes.
 *
 * Handles exactly the subset of glTF this repo authors and `art/style/glb.ts`
 * reads: one level of named nodes, each with a mesh, whose primitives point at
 * accessors in one embedded BIN buffer. Anything else (children, skins,
 * materials, images, a second buffer) throws rather than being dropped
 * silently. Every kept node, mesh, accessor and bufferView is carried over
 * byte for byte and renumbered; nothing is re-encoded.
 */

interface Json {
  asset: unknown;
  scene?: number;
  scenes?: { name?: string; nodes: number[] }[];
  nodes: { name?: string; mesh?: number; children?: number[] }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[];
  accessors: { bufferView?: number }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; target?: number }[];
  buffers: { byteLength: number; uri?: string }[];
  [key: string]: unknown;
}

const MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

function read(glb: Buffer): { json: Json; bin: Buffer } {
  if (glb.readUInt32LE(0) !== MAGIC) throw new Error('split-glb: not a .glb');
  let json: Json | null = null;
  let bin: Buffer | null = null;
  let at = 12;
  while (at + 8 <= glb.length) {
    const length = glb.readUInt32LE(at);
    const type = glb.readUInt32LE(at + 4);
    const body = glb.subarray(at + 8, at + 8 + length);
    if (type === JSON_CHUNK) json = JSON.parse(body.toString('utf8')) as Json;
    else if (type === BIN_CHUNK) bin = body;
    at += 8 + length;
  }
  if (!json || !bin) throw new Error('split-glb: missing JSON or BIN chunk');
  for (const key of ['skins', 'materials', 'images', 'textures', 'animations', 'cameras']) {
    if (Array.isArray(json[key]) && (json[key] as unknown[]).length > 0) {
      throw new Error(`split-glb: the file has ${key}, which this cutter does not carry over`);
    }
  }
  if (json.buffers.length !== 1 || json.buffers[0]?.uri !== undefined) {
    throw new Error('split-glb: expected exactly one embedded buffer');
  }
  return { json, bin };
}

const pad4 = (n: number): number => (4 - (n % 4)) % 4;

/** The node names in `glb`, in file order. */
export function glbNodeNames(glb: Buffer): string[] {
  return read(glb).json.nodes.map((node, index) => {
    if (!node.name) throw new Error(`split-glb: node ${index} has no name`);
    return node.name;
  });
}

/** A new `.glb` holding only the nodes `keep` says yes to, with their meshes and data. */
export function cutGlb(glb: Buffer, keep: (name: string) => boolean): Buffer {
  const { json, bin } = read(glb);
  const meshMap = new Map<number, number>();
  const accessorMap = new Map<number, number>();
  const viewMap = new Map<number, number>();
  const out: Json = {
    asset: json.asset,
    scene: 0,
    scenes: [{ name: json.scenes?.[json.scene ?? 0]?.name ?? 'Scene', nodes: [] }],
    nodes: [],
    meshes: [],
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }],
  };
  const pieces: Buffer[] = [];
  let binLength = 0;

  const view = (index: number): number => {
    const known = viewMap.get(index);
    if (known !== undefined) return known;
    const source = json.bufferViews[index];
    if (!source) throw new Error(`split-glb: no bufferView ${index}`);
    const bytes = bin.subarray(source.byteOffset ?? 0, (source.byteOffset ?? 0) + source.byteLength);
    const offset = binLength;
    pieces.push(bytes);
    binLength += bytes.length;
    const padding = pad4(binLength);
    if (padding > 0) {
      pieces.push(Buffer.alloc(padding));
      binLength += padding;
    }
    const copy = { ...source, buffer: 0, byteOffset: offset };
    out.bufferViews.push(copy);
    const mapped = out.bufferViews.length - 1;
    viewMap.set(index, mapped);
    return mapped;
  };
  const accessor = (index: number): number => {
    const known = accessorMap.get(index);
    if (known !== undefined) return known;
    const source = json.accessors[index];
    if (!source) throw new Error(`split-glb: no accessor ${index}`);
    const copy = { ...source };
    if (source.bufferView !== undefined) copy.bufferView = view(source.bufferView);
    out.accessors.push(copy);
    const mapped = out.accessors.length - 1;
    accessorMap.set(index, mapped);
    return mapped;
  };
  const mesh = (index: number): number => {
    const known = meshMap.get(index);
    if (known !== undefined) return known;
    const source = json.meshes[index];
    if (!source) throw new Error(`split-glb: no mesh ${index}`);
    const copy = {
      ...source,
      primitives: source.primitives.map((primitive) => {
        if (primitive.material !== undefined) throw new Error('split-glb: a primitive has a material');
        const attributes: Record<string, number> = {};
        for (const [name, index] of Object.entries(primitive.attributes)) attributes[name] = accessor(index);
        return {
          ...primitive,
          attributes,
          ...(primitive.indices !== undefined ? { indices: accessor(primitive.indices) } : {}),
        };
      }),
    };
    out.meshes.push(copy);
    const mapped = out.meshes.length - 1;
    meshMap.set(index, mapped);
    return mapped;
  };

  json.nodes.forEach((node, index) => {
    if (!node.name) throw new Error(`split-glb: node ${index} has no name`);
    if (node.children && node.children.length > 0) throw new Error(`split-glb: node '${node.name}' has children`);
    if (!keep(node.name)) return;
    const copy = { ...node };
    if (node.mesh !== undefined) copy.mesh = mesh(node.mesh);
    out.nodes.push(copy);
    out.scenes?.[0]?.nodes.push(out.nodes.length - 1);
  });

  const binChunk = Buffer.concat(pieces, binLength);
  (out.buffers[0] as { byteLength: number }).byteLength = binChunk.length;
  let jsonBytes = Buffer.from(JSON.stringify(out), 'utf8');
  jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(pad4(jsonBytes.length), 0x20)]);

  const header = Buffer.alloc(12);
  const total = 12 + 8 + jsonBytes.length + 8 + binChunk.length;
  header.writeUInt32LE(MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonBytes.length, 0);
  jsonHead.writeUInt32LE(JSON_CHUNK, 4);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(binChunk.length, 0);
  binHead.writeUInt32LE(BIN_CHUNK, 4);
  return Buffer.concat([header, jsonHead, jsonBytes, binHead, binChunk]);
}
