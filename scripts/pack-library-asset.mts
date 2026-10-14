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
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packGlbAsset } from './lib/pack-glb-asset.mts';

const here = dirname(fileURLToPath(import.meta.url));

packGlbAsset({
  glbPath: resolve(here, '../src/art/assets/library.glb'),
  modulePath: resolve(here, '../src/art/assets/libraryGlb.ts'),
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
