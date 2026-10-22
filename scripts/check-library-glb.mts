/**
 * **`check:library-glb` — are the Library kits that ship the ones the build
 * wrote, and does the game's reader read them the way three.js does?**
 *
 * ```
 * pnpm run check:library-glb
 * ```
 *
 * Two kits, one check: `library.glb` (#715, the building, furniture, books
 * and creatures) and `libraryDen.glb` (#719, the secret den's room, lantern
 * and pull book — a kit of its own because the first ships 11 KB under its
 * budget). Each build script asserts its whole CONTRACT against the mesh it
 * builds — but on the Artist's machine, at export time. Nothing after that
 * looked at the bytes: a hand-edited `libraryGlb.ts`, a `.glb` re-exported
 * without re-packing, or a reader bug would all have passed CI green and been
 * found by whoever first loaded the kit. This reads the bytes the game
 * imports, every run, and asks four things of each kit:
 *
 * 1. **The module is the file.** The packed constant decodes to exactly the
 *    committed `.glb`, byte for byte — the pack step was run on the export
 *    that is committed.
 * 2. **The export's own rules still hold in what shipped**: no material, no
 *    texture; every node named, and named without a full stop (`GLTFLoader`
 *    deletes them — ART-AGENT-NOTES §6a); every node at a pure translation
 *    (a hinge or a joint) and nothing else.
 * 3. **The painted faces are self-consistent.** A node carries texcoords if and
 *    only if it carries the face figures the build measured (`face_eyes_uv`,
 *    `face_window_m`, and on the owl `face_rim_uv`) — so the faced heads are
 *    found from the file, not from a list typed here. The figures are in
 *    range; `LIBRARY_FACES` (what the Engineer imports) is exactly the file's
 *    extras, and `GLTFLoader` reads the same; and `v` climbs with height on
 *    every face, which is what makes `planarUvCanvasTexture` (flipY = true)
 *    the right way to paint them and `glbCanvasTexture` the wrong one
 *    (`art/style/glb.ts` says why). The den kit paints nothing, and says so:
 *    for it this clause asserts that **no** node carries texcoords or extras,
 *    rather than passing vacuously over an empty list.
 * 4. **Two readers, one answer.** `readGlbParts` (hand-rolled, synchronous,
 *    the one the game uses) and three.js's own `GLTFLoader` read every node,
 *    and must agree exactly on which nodes exist, every position, normal, uv
 *    and index, and every node transform — the second reader is the evidence
 *    that the first is right, which `glb.ts` claims.
 *
 * What it does **not** do: measure a CONTRACT (sizes, seat heights, shelf
 * rows). That is each build's job on every export, and the Engineer's
 * `check:library` (#716) re-measures the figures the game builds against with
 * `visibleBounds()`. Nothing here types a number the builds own.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mesh, type BufferAttribute, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LIBRARY_DEN_GLB_BASE64 } from '../src/art/assets/libraryDenGlb.ts';
import { LIBRARY_FACES, LIBRARY_GLB_BASE64, type LibraryFaceFigures } from '../src/art/assets/libraryGlb.ts';
import { base64ToArrayBuffer, readGlbParts } from '../src/art/style/glb.ts';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Where every back-facing polygon of a faced head is parked, as read from the
 * `.glb`: library_build.py's `PARKED_UV` (0.02, 0.02) after the exporter's own
 * `v → 1 − v` — the canvas's top-left corner once painted through
 * `planarUvCanvasTexture`, which is why that corner must be plain fill.
 */
const PARKED_U = 0.02;
const PARKED_V = 0.98;

interface Kit {
  /** The kit's name in messages, and the module and file it ships as. */
  readonly label: string;
  readonly glbPath: string;
  readonly base64: string;
  readonly moduleName: string;
  readonly packScript: string;
  /**
   * The face figures the Engineer imports, for a kit that paints heads — or
   * `null` for one that paints nothing, which then has to prove it carries no
   * texcoords and no extras at all.
   */
  readonly faces: Readonly<Record<string, LibraryFaceFigures>> | null;
}

const KITS: readonly Kit[] = [
  {
    label: 'library.glb',
    glbPath: resolve(here, '../src/art/assets/library.glb'),
    base64: LIBRARY_GLB_BASE64,
    moduleName: 'libraryGlb.ts',
    packScript: 'pnpm run pack:library',
    faces: LIBRARY_FACES,
  },
  {
    label: 'libraryDen.glb',
    glbPath: resolve(here, '../src/art/assets/libraryDen.glb'),
    base64: LIBRARY_DEN_GLB_BASE64,
    moduleName: 'libraryDenGlb.ts',
    packScript: 'pnpm run pack:library-den',
    faces: null,
  },
];

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

function jsonChunk(label: string, bytes: Uint8Array): GltfJson {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error(`${label}: no glTF magic`);
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error(`${label}: first chunk is not JSON`);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as GltfJson;
}

/** JSON with sorted keys, so two objects with the same content compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

const failures: string[] = [];
const notes: string[] = [];

async function checkKit(kit: Kit): Promise<void> {
  const { label } = kit;
  const check = (ok: boolean, message: string): void => {
    if (!ok) failures.push(`${label}: ${message}`);
  };
  notes.push(`${label}:`);

  // ----------------------------------------------- 1. the module is the file

  const shipped = new Uint8Array(base64ToArrayBuffer(kit.base64));
  const onDisk = new Uint8Array(readFileSync(kit.glbPath));
  let firstDifference = -1;
  for (let i = 0; i < Math.max(shipped.length, onDisk.length); i += 1) {
    if (shipped[i] !== onDisk[i]) {
      firstDifference = i;
      break;
    }
  }
  check(
    firstDifference < 0,
    `${kit.moduleName} (${shipped.length} B) is not ${label} (${onDisk.length} B) — they differ ` +
      `from byte ${firstDifference}. Run \`${kit.packScript}\` on the committed export.`,
  );
  notes.push(`  ${kit.moduleName} decodes to ${label} exactly (${shipped.length} bytes)`);

  // ------------------------------------------------- 2. the export's own rules

  const json = jsonChunk(label, shipped);
  const nodes = json.nodes ?? [];
  check(nodes.length > 0, 'has no nodes');
  check(!json.materials?.length, `carries ${json.materials?.length} material(s); it is shape only`);
  check(!json.textures?.length && !json.images?.length, 'carries a texture; it is shape only');

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
    if (kit.faces === null) {
      // A kit that paints nothing: no node may carry texcoords or any extra.
      check(!hasUv, `${name}: carries texcoords, and nothing in this kit is painted`);
      check(Object.keys(extras).length === 0, `${name}: extras ${JSON.stringify(extras)} on a kit that ships none`);
      continue;
    }
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
          "belongs on the canvas's right half",
      );
    }
    const window = numbers('face_window_m', 2);
    if (window) check(window.every((c) => c > 0), `${name}: face_window_m ${JSON.stringify(window)}`);
    if ('face_rim_uv' in extras) {
      const rim = numbers('face_rim_uv', 2);
      if (rim) check(rim.every((c) => c > 0 && c < 0.5), `${name}: face_rim_uv ${JSON.stringify(rim)}`);
    }
  }
  notes.push(`  ${nodes.length} nodes, no material, no texture, names without full stops, translation-only`);

  const ours = readGlbParts(shipped.slice().buffer);

  if (kit.faces === null) {
    // The absence is the assertion here, and it covered every node: say so.
    let withUv = 0;
    for (const part of ours.values()) if (part.geometry.getAttribute('uv')) withUv += 1;
    check(withUv === 0, `${withUv} node(s) read back with a uv attribute on a kit that paints nothing`);
    notes.push(`  paints nothing: all ${nodes.length} nodes checked for texcoords and extras, none found`);
  } else {
    check(faced.length > 0, 'no node carries a face — the check of the painted faces covered nothing');
    notes.push(`  ${faced.length} faced heads, found from the file: ${faced.join(', ')}`);

    // The face constant is what the Engineer imports: it must be the file's
    // extras, verbatim, for exactly the faced heads the file has.
    const fileFaces = Object.fromEntries(
      nodes.filter((node) => faced.includes(node.name ?? '')).map((node) => [node.name, node.extras]),
    );
    check(
      canonical(kit.faces) === canonical(fileFaces),
      `LIBRARY_FACES is not the .glb's face extras — run \`${kit.packScript}\`.\n` +
        `      module: ${canonical(kit.faces)}\n      file:   ${canonical(fileFaces)}`,
    );
    notes.push(`  LIBRARY_FACES equals the file's face extras for all ${Object.keys(kit.faces).length} heads`);

    // ------------------------------------- 3. v climbs with height on every face

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
  }

  // ----------------------------------------------- 4. two readers, one answer

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

  let worst = 0;
  let compared = 0;
  const extrasOf = new Map(nodes.map((node) => [node.name ?? '', node.extras ?? {}]));
  for (const name of ourNames) {
    const mine = ours.get(name);
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
    // The file's extras, as three.js hands them to a game that loads with it.
    // GLTFLoader writes the node's raw glTF name into `userData.name` itself
    // (before merging the extras), so that key is the loader's, not the file's —
    // unless the extras carry a `name` of their own, which then wins.
    const fileExtras = (extrasOf.get(name) ?? {}) as Record<string, unknown>;
    const theirExtras: Record<string, unknown> = { ...other.userData };
    if (!('name' in fileExtras)) {
      check(theirExtras.name === name, `${name}: GLTFLoader recorded the raw name ${String(theirExtras.name)}`);
      delete theirExtras.name;
    }
    check(
      canonical(fileExtras) === canonical(theirExtras),
      `${name}: extras ${canonical(fileExtras)} in the file, ${canonical(theirExtras)} to three.js`,
    );
  }
  check(worst === 0, `our .glb reader and three.js's disagree on an attribute by up to ${worst}`);
  check(compared > 0, 'no node was compared between the two readers');
  notes.push(
    `  read twice — ours and three.js's GLTFLoader agree exactly on ${compared} nodes ` +
      "(attributes, indices, transforms); GLTFLoader's userData is the file's extras",
  );
}

// -------------------------------------------------------------------------- run

for (const kit of KITS) await checkKit(kit);

console.log('\ncheck:library-glb — the Library kits as they ship\n');
console.log(notes.join('\n'));
if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`\nBoth Library kits (${KITS.map((kit) => kit.label).join(', ')}) ship as built, and both readers read them the same.\n`);
