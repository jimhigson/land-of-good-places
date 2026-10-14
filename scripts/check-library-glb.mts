/**
 * **`check:library-glb` — is the Library kit that ships the one the build
 * wrote, and does the game's reader read it the way three.js does?**
 *
 * ```
 * pnpm run check:library-glb
 * ```
 *
 * `art/blend/library_build.py` asserts its whole CONTRACT against the mesh it
 * builds — but on the Artist's machine, at export time. Nothing after that
 * looked at the bytes: a hand-edited `libraryGlb.ts`, a `.glb` re-exported
 * without re-packing, or a reader bug would all have passed CI green and been
 * found by whoever first loaded the kit. This reads the bytes the game
 * imports, every run, and asks four things of them:
 *
 * 1. **The module is the file.** `LIBRARY_GLB_BASE64` decodes to exactly
 *    `src/art/assets/library.glb`, byte for byte — the pack step was run on the
 *    export that is committed.
 * 2. **The export's own rules still hold in what shipped**: no material, no
 *    texture; every node named, and named without a full stop (`GLTFLoader`
 *    deletes them — ART-AGENT-NOTES §6a); every node at a pure translation
 *    (a hinge or a joint) and nothing else.
 * 3. **The painted faces are self-consistent.** A node carries texcoords if and
 *    only if it carries the face figures the build measured (`face_eyes_uv`,
 *    `face_window_m`, and on the owl `face_rim_uv`) — so the faced heads are
 *    found from the file, not from a list typed here. The figures are in
 *    range, and `v` climbs with height on every one of them, which is what
 *    makes `planarUvCanvasTexture` (flipY = true) the right way to paint them
 *    and `glbCanvasTexture` the wrong one (`art/style/glb.ts` says why).
 * 4. **Two readers, one answer.** `readGlbParts` (hand-rolled, synchronous,
 *    the one the game uses) and three.js's own `GLTFLoader` read every node,
 *    and must agree exactly on which nodes exist, every position, normal, uv
 *    and index, every node transform, and every node's `extras` — the second
 *    reader is the evidence that the first is right, which `glb.ts` claims.
 *
 * What it does **not** do: measure the CONTRACT (sizes, seat heights, shelf
 * rows). That is the build's job on every export, and the Engineer's
 * `check:library` (#716) re-measures the figures the game builds against with
 * `visibleBounds()`. Nothing here types a number the build owns.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mesh, type BufferAttribute, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LIBRARY_GLB_BASE64 } from '../src/art/assets/libraryGlb.ts';
import { base64ToArrayBuffer, readGlbParts, type GlbPart } from '../src/art/style/glb.ts';

const here = dirname(fileURLToPath(import.meta.url));
const GLB_PATH = resolve(here, '../src/art/assets/library.glb');

/**
 * Where every back-facing polygon of a faced head is parked, as read from the
 * `.glb`: library_build.py's `PARKED_UV` (0.02, 0.02) after the exporter's own
 * `v → 1 − v` — the canvas's top-left corner once painted through
 * `planarUvCanvasTexture`, which is why that corner must be plain fill.
 */
const PARKED_U = 0.02;
const PARKED_V = 0.98;

const failures: string[] = [];
const notes: string[] = [];

function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

// ------------------------------------------------- 1. the module is the file

const shipped = new Uint8Array(base64ToArrayBuffer(LIBRARY_GLB_BASE64));
const onDisk = new Uint8Array(readFileSync(GLB_PATH));
let firstDifference = -1;
for (let i = 0; i < Math.max(shipped.length, onDisk.length); i += 1) {
  if (shipped[i] !== onDisk[i]) {
    firstDifference = i;
    break;
  }
}
check(
  firstDifference < 0,
  `libraryGlb.ts (${shipped.length} B) is not library.glb (${onDisk.length} B) — they differ ` +
    `from byte ${firstDifference}. Run \`pnpm run pack:library\` on the committed export.`,
);
notes.push(`  libraryGlb.ts decodes to library.glb exactly (${shipped.length} bytes)`);

// --------------------------------------------------- 2. the export's own rules

interface GltfNode {
  name?: string;
  mesh?: number;
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
  extras?: unknown;
}
interface GltfJson {
  nodes?: GltfNode[];
  meshes?: { primitives: { attributes: Record<string, number> }[] }[];
  materials?: unknown[];
  textures?: unknown[];
  images?: unknown[];
}

function jsonChunk(bytes: Uint8Array): GltfJson {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('library.glb: no glTF magic');
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error('library.glb: first chunk is not JSON');
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as GltfJson;
}

const json = jsonChunk(shipped);
const nodes = json.nodes ?? [];
check(nodes.length > 0, 'library.glb has no nodes');
check(!json.materials?.length, `library.glb carries ${json.materials?.length} material(s); it is shape only`);
check(!json.textures?.length && !json.images?.length, 'library.glb carries a texture; it is shape only');

const faced: string[] = [];
for (const [index, node] of nodes.entries()) {
  const name = node.name ?? `#${index}`;
  check(node.name !== undefined && node.name.length > 0, `node ${index} has no name`);
  check(!name.includes('.'), `${name}: a full stop in a node name — GLTFLoader deletes it`);
  check(node.mesh !== undefined, `${name}: a node with no mesh`);
  check(
    node.rotation === undefined && node.scale === undefined && node.matrix === undefined,
    `${name}: carries a rotation, scale or matrix — only a translation (a joint) is allowed`,
  );

  const attributes = node.mesh === undefined ? {} : (json.meshes?.[node.mesh]?.primitives[0]?.attributes ?? {});
  const extras = (node.extras ?? {}) as Record<string, unknown>;
  const hasUv = 'TEXCOORD_0' in attributes;
  const hasFace = 'face_eyes_uv' in extras;
  check(
    hasUv === hasFace,
    `${name}: ${hasUv ? 'has' : 'lacks'} texcoords but ${hasFace ? 'carries' : 'lacks'} face_eyes_uv — ` +
      'only a faced head carries either, and it carries both',
  );
  if (!hasFace) {
    check(Object.keys(extras).length === 0, `${name}: extras ${JSON.stringify(extras)} on a node with no face`);
    continue;
  }
  faced.push(name);

  const numbers = (key: string, count: number): number[] | null => {
    const value = extras[key];
    const ok = Array.isArray(value) && value.length === count && value.every((n) => Number.isFinite(n));
    check(ok, `${name}: ${key} is ${JSON.stringify(value)}, not ${count} finite numbers`);
    return ok ? (value as number[]) : null;
  };
  const eyes = numbers('face_eyes_uv', 4);
  if (eyes) {
    check(
      eyes.every((c) => c > 0.05 && c < 0.95),
      `${name}: face_eyes_uv ${JSON.stringify(eyes)} is off the canvas`,
    );
    check(
      (eyes[0] as number) > 0.5 && (eyes[2] as number) < 0.5,
      `${name}: face_eyes_uv ${JSON.stringify(eyes)} — the left eye (+X, the creature's own left) ` +
        'belongs on the canvas\'s right half',
    );
  }
  const window = numbers('face_window_m', 2);
  if (window) check(window.every((c) => c > 0), `${name}: face_window_m ${JSON.stringify(window)}`);
  if ('face_rim_uv' in extras) {
    const rim = numbers('face_rim_uv', 2);
    if (rim) check(rim.every((c) => c > 0 && c < 0.5), `${name}: face_rim_uv ${JSON.stringify(rim)}`);
  }
}
check(faced.length > 0, 'no node carries a face — the check of the painted faces covered nothing');
notes.push(
  `  ${nodes.length} nodes, no material, no texture, names without full stops, translation-only`,
  `  ${faced.length} faced heads, found from the file: ${faced.join(', ')}`,
);

// --------------------------------------------- 3. v climbs with height on every face

const ours = readGlbParts(shipped.slice().buffer);
for (const name of faced) {
  const part = ours.get(name);
  if (!part) continue;
  const position = part.geometry.getAttribute('position') as BufferAttribute;
  const uv = part.geometry.getAttribute('uv') as BufferAttribute | undefined;
  if (!uv) {
    check(false, `${name}: our reader found no uv`);
    continue;
  }
  // Least-squares slope of v against height over the front-mapped vertices
  // (the parked back faces sit at one point and would only dilute it).
  let n = 0;
  let sy = 0;
  let sv = 0;
  let syy = 0;
  let syv = 0;
  let outside = 0;
  for (let i = 0; i < uv.count; i += 1) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (Math.abs(u - PARKED_U) < 1e-6 && Math.abs(v - PARKED_V) < 1e-6) continue;
    if (u < -1e-4 || u > 1 + 1e-4 || v < -1e-4 || v > 1 + 1e-4) outside += 1;
    const y = position.getY(i);
    n += 1;
    sy += y;
    sv += v;
    syy += y * y;
    syv += y * v;
  }
  const slope = n > 1 ? (n * syv - sy * sv) / (n * syy - sy * sy) : Number.NaN;
  check(n > 0, `${name}: no front-mapped vertex to measure`);
  check(
    slope > 0,
    `${name}: dv/dy is ${slope.toFixed(3)} over ${n} vertices — v must climb with height for ` +
      'planarUvCanvasTexture; this head would paint upside down',
  );
  check(outside === 0, `${name}: ${outside} front-mapped vertices have a uv off the canvas`);
  notes.push(`  ${name}: dv/dy +${slope.toFixed(3)} over ${n} front-mapped vertices, all on the canvas`);
}

// ------------------------------------------------------- 4. two readers, one answer

const gltf = await new Promise<{ scene: Object3D }>((ok, fail) => {
  new GLTFLoader().parse(
    shipped.slice().buffer,
    '',
    (result) => ok(result as unknown as { scene: Object3D }),
    fail,
  );
});
const theirs = new Map<string, Mesh>();
gltf.scene.traverse((object) => {
  if (object instanceof Mesh) theirs.set(object.name, object);
});

const ourNames = [...ours.keys()].sort();
const theirNames = [...theirs.keys()].sort();
check(
  JSON.stringify(ourNames) === JSON.stringify(theirNames),
  `the readers disagree on the nodes: only ours ${JSON.stringify(ourNames.filter((n) => !theirs.has(n)))}, ` +
    `only three.js's ${JSON.stringify(theirNames.filter((n) => !ours.has(n)))}`,
);
check(ourNames.length === nodes.length, `our reader found ${ourNames.length} of ${nodes.length} nodes`);

/** JSON with sorted keys, so two objects with the same content compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

let worst = 0;
let compared = 0;
for (const name of ourNames) {
  const mine: GlbPart | undefined = ours.get(name);
  const other = theirs.get(name);
  if (!mine || !other) continue;
  compared += 1;
  for (const attribute of ['position', 'normal', 'uv'] as const) {
    const a = mine.geometry.getAttribute(attribute) as BufferAttribute | undefined;
    const b = other.geometry.getAttribute(attribute) as BufferAttribute | undefined;
    if (!a || !b) {
      check(Boolean(a) === Boolean(b), `${name}: the readers disagree on whether '${attribute}' exists`);
      continue;
    }
    check(a.count === b.count, `${name}.${attribute}: ${a.count} against ${b.count}`);
    for (let i = 0; i < Math.min(a.array.length, b.array.length); i += 1) {
      worst = Math.max(worst, Math.abs((a.array[i] as number) - (b.array[i] as number)));
    }
  }
  const ia = mine.geometry.getIndex();
  const ib = other.geometry.getIndex();
  check(Boolean(ia) === Boolean(ib), `${name}: the readers disagree on whether there is an index`);
  if (ia && ib) {
    check(ia.count === ib.count, `${name}: index ${ia.count} against ${ib.count}`);
    for (let i = 0; i < Math.min(ia.count, ib.count); i += 1) {
      if (ia.getX(i) !== ib.getX(i)) {
        check(false, `${name}: index ${i} is ${ia.getX(i)} to us and ${ib.getX(i)} to three.js`);
        break;
      }
    }
  }
  check(mine.position.distanceTo(other.position) < 1e-9, `${name}: the readers disagree on the node position`);
  check(mine.scale.distanceTo(other.scale) < 1e-9, `${name}: the readers disagree on the node scale`);
  check(Math.abs(mine.quaternion.dot(other.quaternion)) > 1 - 1e-9, `${name}: the readers disagree on the rotation`);
  // GLTFLoader writes the node's raw glTF name into `userData.name` itself
  // (before merging the extras), so that key is the loader's, not the file's —
  // unless the extras carry a `name` of their own, which then wins on both
  // sides and is compared like any other key.
  const theirExtras: Record<string, unknown> = { ...other.userData };
  if (!(mine.extras && 'name' in mine.extras)) {
    check(theirExtras.name === name, `${name}: GLTFLoader recorded the raw name ${String(theirExtras.name)}`);
    delete theirExtras.name;
  }
  check(
    canonical(mine.extras ?? {}) === canonical(theirExtras),
    `${name}: extras ${canonical(mine.extras ?? {})} to us, ${canonical(theirExtras)} to three.js`,
  );
}
check(worst === 0, `our .glb reader and three.js's disagree on an attribute by up to ${worst}`);
check(compared > 0, 'no node was compared between the two readers');
notes.push(
  `  read twice — ours and three.js's GLTFLoader agree exactly on ${compared} nodes ` +
    '(attributes, indices, transforms, extras)',
);

// ------------------------------------------------------------------------ done

console.log('\ncheck:library-glb — the Library kit as it ships\n');
console.log(notes.join('\n'));
if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log('\nThe Library kit ships as built, and both readers read it the same.\n');
