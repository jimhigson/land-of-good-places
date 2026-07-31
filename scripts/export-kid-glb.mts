/**
 * **Writes the player kid's body and head out as a `.glb`.**
 *
 * ```
 * npm run export:kid
 * ```
 *
 * This is Stage A of the authored-character work (HANDOFF-character-modelling.md):
 * take *today's* geometry — the exact spheres, capsules and tori
 * `createKid` builds — and move it out of the code and into an asset, with its
 * UVs, so that
 *
 * - the face's UV map stops being a formula that has to agree with a second
 *   formula and becomes **data**, which is the bug class the whole exercise is
 *   about (three incidents, one shape — see the handoff's §2); and
 * - Stage B, the real re-topology, is a change to a `.blend` rather than a
 *   change to the game.
 *
 * Because the geometry is *the same code's output*, parity at this stage is
 * exact by construction rather than by judgement, and
 * `scripts/check-character-parity.mts` asserts it vertex for vertex.
 *
 * ## What goes in, and what deliberately does not
 *
 * **In:** every mesh in {@link KID_BODY_PARTS} — its geometry, its UVs, and its
 * own local position/rotation/scale. Nothing else.
 *
 * **Out:**
 *
 * - *Materials and textures.* They stay in code (`toonMaterial`, the shared
 *   ramp, `paintFace`'s canvases) so per-child skin, outfit, shoe and eye
 *   colour keep working exactly as now. This is also forced: `GLTFExporter`
 *   cannot write textures headlessly — it needs a real canvas to encode an
 *   image and throws in `processImage`.
 * - *The rig.* `body`, `head`, `crown`, the four limb pivots and the four
 *   anchors are made by `createKid` and driven by constants (`KID_HEAD_HEIGHT`,
 *   `SKULL_RADIUS`, `KID_HEAD_SCALE`) that hats, hair and the checks all import.
 *   Baking those into the asset would create a *second* description of them,
 *   which is the thing being removed, not added to.
 * - *The outline meshes.* `addOutline` derives them from the part's own
 *   geometry at build time, so they follow the asset for free.
 * - *Hair, backpacks, hats and shoes.* Separate rigs, chosen per child, staying
 *   procedural for now by Jim's ruling of 31 July 2026.
 */
import '../scripts/headless-canvas.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { Group, Mesh, MeshBasicMaterial, Object3D, type BufferGeometry } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { createKid, KID_BODY_PARTS, type KidBodyPart } from '../src/art/models/kid.ts';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../src/art/assets/kid.glb');
const OUT_TS = resolve(here, '../src/art/assets/kidGlb.ts');

/**
 * `GLTFExporter`'s binary path reads its own `Blob` back through a `FileReader`,
 * which Node has no global for. Ten lines rather than a dependency, and only
 * this offline tool needs it — the game only ever *loads* a `.glb`.
 */
class NodeFileReader {
  onloadend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: ArrayBuffer | string | null = null;

  readAsArrayBuffer(blob: Blob): void {
    void blob
      .arrayBuffer()
      .then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      })
      .catch(() => this.onerror?.());
  }

  readAsDataURL(blob: Blob): void {
    void blob
      .arrayBuffer()
      .then((buffer) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
        this.onloadend?.();
      })
      .catch(() => this.onerror?.());
  }
}

(globalThis as { FileReader?: unknown }).FileReader ??= NodeFileReader;

function findPart(root: Object3D, name: KidBodyPart): Mesh {
  let found: Mesh | null = null;
  root.traverse((node) => {
    if (node instanceof Mesh && node.name === name) found = node;
  });
  if (!found) throw new Error(`export-kid-glb: no mesh named '${name}' on a freshly built kid.`);
  return found;
}

/**
 * A geometry's full contents as a comparable string.
 *
 * Used to find parts that are the *same shape* so the asset stores one copy —
 * and it compares the actual buffers rather than trusting that two calls to
 * `blob()` with the same arguments produce the same mesh. Measure the thing
 * that was built, never the rules that built it (ART-AGENT-NOTES.md §7).
 */
function fingerprint(geometry: BufferGeometry): string {
  const bits: string[] = [];
  for (const name of Object.keys(geometry.attributes).sort()) {
    const attribute = geometry.attributes[name] as { array: ArrayLike<number>; itemSize: number };
    bits.push(`${name}:${attribute.itemSize}:${Array.from(attribute.array).join(',')}`);
  }
  const index = geometry.getIndex();
  if (index) bits.push(`index:${Array.from(index.array).join(',')}`);
  return bits.join('|');
}

/**
 * Every part, flattened to one level and stripped of everything but shape.
 *
 * Flat rather than nested because the rig stays in code: the loader hangs each
 * part back on the group `createKid` nominates for it. What the asset owns is
 * the *shape* and *where that shape sits in its own parent* — which is exactly
 * what Stage B will change and nothing else.
 *
 * **Mirrored parts share one geometry.** The kid's left and right hands are not
 * merely similar, they are the same buffer contents — the sides differ only in
 * where the mesh is placed, and a squashed sphere is symmetric about the plane
 * it is mirrored in. Six pairs do this (arms, hands, legs, feet, ears, and
 * nothing else), which is 28% of the vertices; storing each twice put the file
 * over its budget for no information. The pairing is *discovered* by comparing
 * buffers, not declared, so a Stage B hand that genuinely differs left from
 * right will simply stop being deduplicated instead of silently losing a side.
 */
function exportScene(kid: Object3D): { scene: Group; shared: number } {
  const scene = new Group();
  scene.name = 'kid';
  // One shared throwaway material. glTF wants a material per primitive and the
  // game replaces it on load; keeping it single stops the exporter writing
  // fourteen identical ones.
  const placeholder = new MeshBasicMaterial();

  const byShape = new Map<string, BufferGeometry>();
  let shared = 0;

  for (const name of KID_BODY_PARTS) {
    const part = findPart(kid, name);
    const key = fingerprint(part.geometry);
    const existing = byShape.get(key);
    if (existing) shared += 1;
    else byShape.set(key, part.geometry);

    const out = new Mesh(existing ?? part.geometry, placeholder);
    out.name = name;
    out.position.copy(part.position);
    out.quaternion.copy(part.quaternion);
    out.scale.copy(part.scale);
    scene.add(out);
  }
  return { scene, shared };
}

/** Vertex and triangle counts, so the run prints what it actually wrote. */
function tally(geometry: BufferGeometry): { verts: number; tris: number; attrs: string } {
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  return {
    verts: position.count,
    tris: (index ? index.count : position.count) / 3,
    attrs: Object.keys(geometry.attributes).join('+'),
  };
}

// `geometry: 'procedural'` explicitly: `createKid` now defaults to the authored
// asset, and an exporter that read the asset back out would only ever be able
// to copy the file it was meant to be producing.
const kid = createKid({ geometry: 'procedural' });
const { scene, shared } = exportScene(kid.root);

let verts = 0;
let tris = 0;
const counted = new Set<BufferGeometry>();
const rows: string[] = [];
for (const child of scene.children) {
  const geometry = (child as Mesh).geometry;
  const { verts: v, tris: t, attrs } = tally(geometry);
  const first = !counted.has(geometry);
  counted.add(geometry);
  if (first) {
    verts += v;
    tris += t;
  }
  rows.push(
    `  ${child.name.padEnd(12)} ${String(v).padStart(5)} verts ${String(t).padStart(5)} tris  ${attrs}` +
      (first ? '' : '  (shares its mirror twin’s geometry)'),
  );
}

const exporter = new GLTFExporter();
const glb = (await exporter.parseAsync(scene, { binary: true })) as ArrayBuffer;
const bytes = Buffer.from(glb);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, bytes);

/**
 * The same bytes again, as a TypeScript module.
 *
 * **Why the asset is imported rather than fetched.** `createKid` is synchronous
 * and has fifteen callers, five of them Node check scripts and one of them the
 * character creator rebuilding on every tap. A fetched asset would make the
 * model's arrival asynchronous for all of them, and this is a PWA whose service
 * worker has already cost hours by serving a stale copy of a file (CLAUDE.md).
 * An imported module is the same in Node, in Vitest and in the browser, arrives
 * with the code that uses it, and cannot go stale independently of it.
 *
 * It costs about 15 KB gzipped over fetching the `.glb` directly (60 KB against
 * 45 KB). **That trade stops being right at the second authored character** —
 * six of these in the JS bundle is not the same decision as one. When that day
 * comes, only `art/models/kidAsset.ts` changes: it becomes a lookup in a
 * registry that a preload step fills before the game boots.
 *
 * The `.glb` next to it is the real artefact — what Blender reads and writes,
 * and what `check:character-parity` puts through three.js's own `GLTFLoader`.
 * This file is generated from it and must never be hand-edited.
 */
writeFileSync(
  OUT_TS,
  `/**\n` +
    ` * The player kid's body and head, as authored geometry.\n` +
    ` *\n` +
    ` * **Generated — do not edit.** Run \`npm run export:kid\` to rebuild this from\n` +
    ` * \`kid.glb\`, and see \`scripts/export-kid-glb.mts\` for what is in it, what is\n` +
    ` * deliberately not, and why the bytes are imported rather than fetched.\n` +
    ` *\n` +
    ` * ${scene.children.length} parts, ${verts} vertices, ${tris} triangles, ${bytes.length} bytes.\n` +
    ` */\n` +
    `export const KID_GLB_BASE64 =\n  '${bytes.toString('base64')}';\n`,
);

const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;

console.log(`\nexport:kid — the player kid's body and head\n`);
console.log(rows.join('\n'));
console.log(
  `\n  ${scene.children.length} parts sharing ${scene.children.length - shared} geometries` +
    ` — ${verts} verts, ${tris} tris stored`,
);
console.log(`  wrote ${OUT}`);
console.log(`  wrote ${OUT_TS}`);
console.log(`  ${kb(bytes.length)} on disk, ${kb(gzipSync(bytes).length)} gzipped`);
console.log(
  `  ${kb(bytes.toString('base64').length)} as a module, ` +
    `${kb(gzipSync(Buffer.from(bytes.toString('base64'))).length)} gzipped\n`,
);
