/**
 * **Turns `src/art/assets/library.glb` into the module the game imports.**
 *
 * ```
 * pnpm run pack:library
 * ```
 *
 * The Library kit's counterpart to `pack-castle-asset.mts` (issue #715, part 1
 * of the Library epic #714): `art/blend/library_build.py` writes
 * `library.blend`, `library_export.py` writes the `.glb`, and
 * `pnpm run blend:library` runs the three steps in order. This is always the
 * last of them.
 *
 * See `pack-kid-asset.mts` for why an asset ships as an imported module rather
 * than a fetched file, and `scripts/lib/pack-glb-asset.mts` for the
 * file-writing and budget check every `pack:<asset>` script shares.
 *
 * **One thing this packer adds: `LIBRARY_FACES`.** The build measures the
 * figures a face painter needs on each faced head (`face_eyes_uv`,
 * `face_window_m`, the owl's `face_rim_uv`) and the export ships them as glTF
 * node `extras`. They are copied out of the `.glb` here, verbatim, into a typed
 * constant beside the bytes — so the Engineer imports them rather than typing
 * them, and nothing in the game's shared reader (`art/style/glb.ts`, inside the
 * prebuilt parks' source hash) had to change to carry them.
 * `check:library-glb` asserts the constant still equals the file's extras.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packGlbAsset } from './lib/pack-glb-asset.mts';

const here = dirname(fileURLToPath(import.meta.url));
const glbPath = resolve(here, '../src/art/assets/library.glb');
const modulePath = resolve(here, '../src/art/assets/libraryGlb.ts');

packGlbAsset({
  glbPath,
  modulePath,
  constantName: 'LIBRARY_GLB_BASE64',
  label: 'pack:library',
  /**
   * 450 KB: a whole building plus its furniture plus three creatures, against
   * the castle interior's 200 KB (ten pieces of furniture) and the hotel's
   * 640 KB (a tower and its rooms). The exterior is over a quarter of it — the
   * six turned columns alone are ~45 KB — and the six instancing books are 28
   * triangles each, because there will be hundreds of them.
   *
   * Worth knowing before spending it: a box-built part costs ~30–50 bytes a
   * triangle here (every sharp edge splits a vertex, and a plain box is 24
   * vertices for 12 triangles); a smooth creature part about 25. Plain boxes
   * for things nobody sees the edge of (the nest's page blocks and boards)
   * were the biggest saving found.
   */
  budgetBytes: 450 * 1024,
  docLines: [
    '**The Library kit, as authored geometry.** Do not edit — generated.',
    '',
    'Written by `pnpm run blend:library`, which runs `art/blend/library_build.py`',
    '(the authoring source), then `library_export.py`, then this packer.',
    '',
    // No count here: the list below is the enumeration, and a typed number
    // beside it was wrong on the day it was written ("Seventeen", of twenty).
    'Every asset of the kit in one file — the pillared exterior, a bookcase and',
    'its hinged secret twin, the desk, two lamps, an armchair and a floor',
    'cushion, six book blocks for instancing, a book pile, the open reader\'s',
    'cover, the owl librarian, the baby dragon and its nest of books, and the',
    'library cat. Each is its own asset with its own origin, so inside this file',
    'they all overlap at the world origin, which is expected and harmless.',
    '',
    'Shape only: no colour, no material, no texture. The owl, dragon and cat',
    'heads carry face UVs, painted through `planarUvCanvasTexture`.',
  ],
});

// ------------------------------------------------- the face figures, verbatim

const bytes = readFileSync(glbPath);
const jsonLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as {
  nodes?: { name?: string; extras?: Record<string, unknown> }[];
};
const faces = (json.nodes ?? [])
  .filter((node) => node.name && node.extras && 'face_eyes_uv' in node.extras)
  .map((node) => [node.name as string, node.extras as Record<string, unknown>] as const)
  .sort(([a], [b]) => a.localeCompare(b));
if (faces.length === 0) {
  console.error('\n✗ pack:library: no node in library.glb carries face_eyes_uv — was it exported with extras?\n');
  process.exit(1);
}
const keys = ['face_eyes_uv', 'face_window_m', 'face_rim_uv'] as const;
const entries = faces.map(([name, extras]) => {
  const fields = keys
    .filter((key) => key in extras)
    .map((key) => `${key}: ${JSON.stringify(extras[key]).replace(/,/g, ', ')}`)
    .join(', ');
  return `  '${name}': { ${fields} },`;
});
const block = [
  '',
  '/**',
  ' * The figures a face painter needs, per faced head — measured off the geometry',
  ' * by `art/blend/library_build.py` and copied verbatim out of the `.glb`\'s node',
  ' * `extras` by `pack:library`. Never typed; `check:library-glb` asserts they',
  ' * still equal the file\'s.',
  ' */',
  'export interface LibraryFaceFigures {',
  '  /** The two eye centres `[uL, vL, uR, vR]` as canvas fractions from the top-left; `L` is the creature\'s own left (+X). */',
  '  readonly face_eyes_uv: readonly [number, number, number, number];',
  '  /** The canvas\'s `[width, height]` in metres — to paint a round eye round. */',
  '  readonly face_window_m: readonly [number, number];',
  '  /** The owl only: her glasses rims\' inner radius as `[fraction of width, fraction of height]` — her eyes go inside it. */',
  '  readonly face_rim_uv?: readonly [number, number];',
  '}',
  '',
  `export const LIBRARY_FACES: Readonly<Record<${faces.map(([n]) => `'${n}'`).join(' | ')}, LibraryFaceFigures>> = {`,
  ...entries,
  '};',
  '',
].join('\n');
writeFileSync(modulePath, readFileSync(modulePath, 'utf8') + block);
console.log(`  LIBRARY_FACES: ${faces.map(([n]) => n).join(', ')} — copied from the .glb's extras\n`);
