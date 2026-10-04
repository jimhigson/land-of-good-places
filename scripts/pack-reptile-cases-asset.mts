/**
 * **Turns `src/art/assets/reptileCases.glb` into the module the game imports.**
 *
 * ```
 * pnpm run pack:reptile-cases
 * ```
 *
 * The Reptile House's enclosure masonry — the `cases` kit of
 * `docs/design/REPTILE-HOUSE.md` ("ASSET GROUPS" §2). Its Blender source is a
 * script: `art/blend/reptile_cases_build.py` writes `reptile_cases.blend`,
 * `reptile_cases_export.py` writes the `.glb`, and `pnpm run blend:reptile-cases`
 * runs the three steps in order. This is always the last of them.
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
  glbPath: resolve(here, '../src/art/assets/reptileCases.glb'),
  modulePath: resolve(here, '../src/art/assets/reptileCasesGlb.ts'),
  constantName: 'REPTILE_CASES_GLB_BASE64',
  label: 'pack:reptile-cases',
  /**
   * 180 KB, the spec's figure for this kit, against the gate arch's 120 and
   * the castle's 200.
   *
   * The kit is 16 nodes and ~5 200 triangles at roughly 30 bytes a triangle
   * (nearly every edge is over `Part.emit`'s 46° split-normal threshold, and
   * a split normal is a whole duplicated vertex), so the honest figure is
   * around 150 KB. Where the triangles are, if this ever needs trimming: the
   * island kerb (560, a 40-segment ring) and the pier vine (518, a swept
   * helix with leaves) are the fat ones; coarsening either is the step
   * change, shaving a wall's coping is not.
   */
  budgetBytes: 180 * 1024,
  docLines: [
    '**The Reptile House’s enclosure masonry, as authored geometry.** Do not edit — generated.',
    '',
    'Written by `pnpm run blend:reptile-cases`, which runs',
    '`art/blend/reptile_cases_build.py` (the authoring source), then',
    '`reptile_cases_export.py`, then this packer.',
    '',
    'Sixteen nodes, each authored about its own footprint centre on the floor',
    'and sunk 0.05 m into it: the glass wall case’s plinth, frame rim, backboard',
    'and leaf relief; the vine-wrapped pier post (post + vine); the Frog Jar’s',
    'drum and rim; the scalloped round enclosure wall; the lagoon and tortoise',
    'stadium walls; the nursery kerb and its gold glass rail; Noodle’s island',
    'kerb; and the Grotto’s rock face (with pool basin and waterfall lip) and',
    'its moss. Every footprint is built to the constants in',
    '`src/world/reptileHouse/layout.ts` that the colliders are registered from.',
    '',
    'Shape only: no colour, no material, no texture, no UVs. `src/art/models/',
    'reptileCasesAssets.ts` owns the colour table. The glass panes and the',
    'nameplates are TypeScript, not in this kit.',
  ],
});
