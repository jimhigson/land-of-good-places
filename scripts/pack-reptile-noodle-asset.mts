/**
 * **Turns `src/art/assets/reptileNoodle.glb` into the module the game imports.**
 *
 * ```
 * pnpm run pack:reptile-noodle
 * ```
 *
 * The Reptile House's centrepiece python, Noodle, and her rock — one of the
 * six Reptile House kits (`docs/design/REPTILE-HOUSE.md` §ASSET GROUPS 5),
 * and another whose Blender source is itself a script:
 * `art/blend/reptile_noodle_build.py` writes `reptile_noodle.blend`,
 * `reptile_noodle_export.py` writes the `.glb`, and
 * `pnpm run blend:reptile-noodle` runs the three steps in order. This is
 * always the last of them.
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
  glbPath: resolve(here, '../src/art/assets/reptileNoodle.glb'),
  modulePath: resolve(here, '../src/art/assets/reptileNoodleGlb.ts'),
  constantName: 'REPTILE_NOODLE_GLB_BASE64',
  label: 'pack:reptile-noodle',
  /**
   * 160 KB — the kit's own ceiling from the Reptile House spec, against the
   * 150 KB every single character gets. Eight nodes and ~4 900 triangles at
   * the pipeline's usual ~30 bytes a triangle; nearly all of it is the
   * 15 m of swept body (`rn-coil` + its belly) that a 2.5 m-wide spiral
   * three turns high simply costs.
   */
  budgetBytes: 160 * 1024,
  docLines: [
    'Noodle, the Reptile House’s python, as authored geometry: her rock,',
    'her coiled body, belly and spots, her painted head and tongue, the',
    'burrow she goes down, and the nursery mound her tail comes up from.',
    '',
    '**Generated — do not edit.** `pnpm run pack:reptile-noodle` rebuilds it',
    'from `reptileNoodle.glb`, which is itself written by',
    '`pnpm run blend:reptile-noodle` (from `art/blend/reptile_noodle.blend`,',
    'which is in turn *generated* by `art/blend/reptile_noodle_build.py` —',
    'that script is the authoring source, not the .blend). See',
    '`scripts/pack-kid-asset.mts` for why the bytes are imported rather than',
    'fetched.',
  ],
});
