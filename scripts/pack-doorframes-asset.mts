/**
 * **Turns `src/art/assets/doorframes.glb` into the module the game imports.**
 *
 * ```
 * pnpm run pack:doorframes
 * ```
 *
 * The doorway-frame kit's counterpart to `pack-story-props-asset.mts`:
 * `art/blend/doorframes_build.py` writes `doorframes.blend`,
 * `doorframes_export.py` writes the `.glb`, and `pnpm run blend:doorframes`
 * runs the three steps in order. This is always the last of them. Nothing in
 * this kit is painted, so unlike the story props there are no face figures to
 * copy out.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packGlbAsset } from './lib/pack-glb-asset.mts';

const here = dirname(fileURLToPath(import.meta.url));

packGlbAsset({
  glbPath: resolve(here, '../src/art/assets/doorframes.glb'),
  modulePath: resolve(here, '../src/art/assets/doorframesGlb.ts'),
  constantName: 'DOORFRAMES_GLB_BASE64',
  label: 'pack:doorframes',
  /**
   * 400 KB: four frames, about 5 400 triangles on the day it landed. Boxes cost
   * ~25 B a triangle in this pipeline, so the kit is well under; the budget is
   * there to catch a subdivision slip, not to be grown into.
   */
  budgetBytes: 400 * 1024,
  docLines: [
    '**The doorway-frame kit, as authored geometry.** Do not edit — generated.',
    '',
    'Written by `pnpm run blend:doorframes`, which runs',
    '`art/blend/doorframes_build.py` (the authoring source), then',
    '`doorframes_export.py`, then this packer.',
    '',
    "One frame per interior's way out — the hotel lobby's painted wood, the",
    "library's books, the Reptile House's mossy stone and snake, the castle's",
    'stone — as parts (`doorframe-<style>-post|lintel|crest[-variant]`) that',
    '`src/art/models/doorFrames.ts` fits to each room\'s own gap.',
    '',
    'Shape only: no colour, no material, no texture.',
  ],
});
