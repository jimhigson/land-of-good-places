/**
 * **Turns `src/art/assets/reptileCreatures.glb` into the module the game imports.**
 *
 * ```
 * pnpm run pack:reptile-creatures
 * ```
 *
 * The Reptile House creature kit's counterpart to `pack-castle-asset.mts`:
 * `art/blend/reptile_creatures_build.py` writes `reptile_creatures.blend`,
 * `reptile_creatures_export.py` writes the `.glb`, and
 * `pnpm run blend:reptile-creatures` runs the three steps in order. This is
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
  glbPath: resolve(here, '../src/art/assets/reptileCreatures.glb'),
  modulePath: resolve(here, '../src/art/assets/reptileCreaturesGlb.ts'),
  constantName: 'REPTILE_CREATURES_GLB_BASE64',
  label: 'pack:reptile-creatures',
  /**
   * 140 KB — the spec's figure for this kit (`docs/design/REPTILE-HOUSE.md`
   * §ASSET GROUPS 4), under the 150 KB a character gets. Thirteen sculpted
   * creature parts at ≤ 4 500 triangles; everything else about every animal
   * in the house is TypeScript primitives, which is why the kit is small.
   */
  budgetBytes: 140 * 1024,
  docLines: [
    '**The Reptile House creature kit, as authored geometry.** Do not edit — generated.',
    '',
    'Written by `pnpm run blend:reptile-creatures`, which runs',
    '`art/blend/reptile_creatures_build.py` (the authoring source), then',
    '`reptile_creatures_export.py`, then this packer.',
    '',
    'Thirteen nodes in one file — the snake head and tongue every snake wears,',
    "Snappy the crocodile's four parts, Grandpa Tock's shell and head, and one",
    'body each for the chameleon, frog, gecko, skink and iguana — because they',
    'share a build script, not because they are one object. Each is its own',
    '`AssetHandle` with its own origin, so inside this file they all overlap at',
    'the origin, which is expected and harmless. Four nodes (tongue, croc jaw,',
    'croc tail, tortoise head) carry a translation to their hinge; the rest are',
    'at the identity.',
    '',
    'Shape only: no colour, no material, no texture. `src/art/models/',
    'reptileCreaturesAssets.ts` owns the colour table, the outlines and the',
    'shadow flags, exactly as `castleAssets.ts` does for the castle.',
  ],
});
