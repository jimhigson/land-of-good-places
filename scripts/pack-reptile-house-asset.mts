/**
 * **Turns `src/art/assets/reptileHouse.glb` into the module the game imports.**
 *
 * ```
 * pnpm run pack:reptile-house
 * ```
 *
 * The Reptile House exterior's counterpart to `pack-gate-arch-asset.mts`: the
 * last step of `pnpm run blend:reptile-house`, after
 * `art/blend/reptile_house_build.py` (the authoring source) and
 * `reptile_house_export.py`. See `scripts/lib/pack-glb-asset.mts` for the
 * file-writing and budget check every `pack:<asset>` script shares.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packGlbAsset } from './lib/pack-glb-asset.mts';

const here = dirname(fileURLToPath(import.meta.url));

packGlbAsset({
  glbPath: resolve(here, '../src/art/assets/reptileHouse.glb'),
  modulePath: resolve(here, '../src/art/assets/reptileHouseGlb.ts'),
  constantName: 'REPTILE_HOUSE_GLB_BASE64',
  label: 'pack:reptile-house',
  /**
   * 360 KB, against the 150 KB every character gets — the figure
   * `docs/design/REPTILE-HOUSE.md` §ASSET GROUPS sets for this kit (≤ 11 000
   * triangles). This file is one 19 m building with a 4 m painted head and a
   * continuous swept body, not one character: a helix cannot be instanced,
   * and the body is where nearly every triangle goes. Measured: 10 680
   * triangles in 255 872 bytes, ~24 bytes a triangle (the tubes are smooth,
   * so vertices are shared rather than split at every edge as the hotel's
   * are), which leaves ~100 KB of headroom under the budget.
   */
  budgetBytes: 360 * 1024,
  docLines: [
    'The Reptile House exterior, as authored geometry: Sunny, the mint snake',
    'coiled three times round a cream greenhouse, head on the roof, tail as',
    'the signpost, with the snake-hole arch and its leaf awning.',
    '',
    '**Generated — do not edit.** `pnpm run pack:reptile-house` rebuilds it',
    'from `reptileHouse.glb`, which is itself written by',
    '`pnpm run blend:reptile-house` (from `art/blend/reptile_house.blend`,',
    'which is in turn *generated* by `art/blend/reptile_house_build.py` —',
    'that script is the authoring source, not the .blend). See',
    '`scripts/pack-kid-asset.mts` for why the bytes are imported rather than',
    'fetched.',
  ],
});
