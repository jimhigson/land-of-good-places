/**
 * **Turns `src/art/assets/libraryDen.glb` into the module the game imports.**
 *
 * ```
 * pnpm run pack:library-den
 * ```
 *
 * The Library's secret den kit (Library v2, epic #714 part 5, #719): the
 * sibling of `pack-library-asset.mts`. `art/blend/library_den_build.py` writes
 * `libraryDen.blend`, `library_den_export.py` writes the `.glb`, and
 * `pnpm run blend:library-den` runs the three steps in order. This is always
 * the last of them.
 *
 * A kit of its own rather than more nodes in `library.glb`: that file ships
 * 11 KB under its 450 KB budget, and the den's walls, niches, boards, stars and
 * lanterns are tens of KB. See `pack-kid-asset.mts` for why an asset ships as
 * an imported module, and `scripts/lib/pack-glb-asset.mts` for the writing and
 * the budget check every `pack:<asset>` script shares. No face figures here:
 * nothing in the den kit is painted.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packGlbAsset } from './lib/pack-glb-asset.mts';

const here = dirname(fileURLToPath(import.meta.url));

packGlbAsset({
  glbPath: resolve(here, '../src/art/assets/libraryDen.glb'),
  modulePath: resolve(here, '../src/art/assets/libraryDenGlb.ts'),
  constantName: 'LIBRARY_DEN_GLB_BASE64',
  label: 'pack:library-den',
  /**
   * 100 KB, against 80.2 KB on the day: a room of three walls (two cut with
   * book niches), a floor and a lintel, thirty niche boards, nine stars and a
   * moon, a lantern and the pull book — 2 748 triangles at the ~30 bytes a
   * triangle a box-built part costs here (the castle interior's 128 KB holds
   * 4 342). The boards are the biggest line, 1 320 of the triangles: a
   * one-segment bevel keeps a board at 24 shared vertices, the figure
   * `library_build.lying_book` records. Nothing here is instanced, because
   * the books that fill the niches are the library kit's own blocks.
   */
  budgetBytes: 100 * 1024,
  docLines: [
    "**The Library's secret den kit, as authored geometry.** Do not edit — generated.",
    '',
    'Written by `pnpm run blend:library-den`, which runs `art/blend/library_den_build.py`',
    '(the authoring source), then `library_den_export.py`, then this packer.',
    '',
    'Three assets in one file: `den` (the room behind the reading room\'s west',
    'wall — its floor slab, three walls, the lintel over its doorway, the book',
    'niches cut into its far walls with their boards and backs, the stars and',
    'the moon on the walls), `denLantern` (a glowing paper lantern on a wall',
    'bracket) and `secretBook` (the pull book on the secret shelf, with a star',
    'on its spine). Each is its own asset with its own origin, so inside this',
    'file they overlap at the world origin, which is expected and harmless.',
    '',
    'Shape only: no colour, no material, no texture, no UV — nothing here is',
    'painted. Sizes are read from their owners at build time (`layout.ts`,',
    '`library_build.py`) and measured back by `libraryDenKit.ts`.',
  ],
});
