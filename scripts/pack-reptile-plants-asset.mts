/**
 * **Turns `src/art/assets/reptilePlants.glb` into the module the game imports.**
 *
 * ```
 * pnpm run pack:reptile-plants
 * ```
 *
 * The Reptile House's plant kit: `art/blend/reptile_plants_build.py` writes
 * `reptile_plants.blend`, `reptile_plants_export.py` writes the `.glb`, and
 * `pnpm run blend:reptile-plants` runs the three steps in order. This is
 * always the last of them. See `scripts/lib/pack-glb-asset.mts` for the
 * file-writing and budget check every `pack:<asset>` script shares.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packGlbAsset } from './lib/pack-glb-asset.mts';

const here = dirname(fileURLToPath(import.meta.url));

packGlbAsset({
  glbPath: resolve(here, '../src/art/assets/reptilePlants.glb'),
  modulePath: resolve(here, '../src/art/assets/reptilePlantsGlb.ts'),
  constantName: 'REPTILE_PLANTS_GLB_BASE64',
  label: 'pack:reptile-plants',
  /**
   * 180 KB — the spec's figure for this kit (docs/design/REPTILE-HOUSE.md,
   * asset group 3), beside its 6 000-triangle ceiling. Every node here is
   * instanced, so the bytes are paid once for a whole jungle.
   */
  budgetBytes: 180 * 1024,
  docLines: [
    "**The Reptile House's plants, as authored geometry.** Do not edit — generated.",
    '',
    'Written by `pnpm run blend:reptile-plants`, which runs',
    '`art/blend/reptile_plants_build.py` (the authoring source), then',
    '`reptile_plants_export.py`, then this packer.',
    '',
    'A kit of instancing units — palm trunk and frond, banana, monstera, fern,',
    'heliconia, vine, lily pad, three rocks, two logs, the banyan and a case',
    'branch — each its own named node about the kit origin, so inside this',
    'file they all overlap at the world origin, which is expected and harmless.',
    '',
    'Shape only: no colour, no material, no texture. `src/art/models/',
    'reptilePlantsAssets.ts` owns the colour table, the outlines and the',
    'instancing, exactly as `castleAssets.ts` does for the castle.',
  ],
});
