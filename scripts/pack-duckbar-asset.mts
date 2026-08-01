/**
 * **Turns `src/art/assets/duckbar.glb` into the module the game imports.**
 *
 * ```
 * npm run pack:duckbar
 * ```
 *
 * The Rail Race duck bar's counterpart to `pack-cart-asset.mts` — the
 * **third** asset through the `.glb` pipeline (`ART-AGENT-NOTES.md` §6a).
 * Modelled directly in Blender against the reference numbers already in
 * `track.ts`/`hazards.ts` (`DUCK_CLEARANCE`, `BAR_HALF_SPAN`), so
 * `npm run blend:duckbar` (`art/blend/duckbar_export.py`) is the only
 * producer of `duckbar.glb`, and this is always the next step after it.
 *
 * See `pack-kid-asset.mts` for why the asset ships as an imported module
 * rather than a fetched file, and `scripts/lib/pack-glb-asset.mts` for the
 * file-writing and budget check every `pack:<asset>` script shares.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packGlbAsset } from './lib/pack-glb-asset.mts';

const here = dirname(fileURLToPath(import.meta.url));

packGlbAsset({
  glbPath: resolve(here, '../src/art/assets/duckbar.glb'),
  modulePath: resolve(here, '../src/art/assets/duckbarGlb.ts'),
  constantName: 'DUCKBAR_GLB_BASE64',
  label: 'pack:duckbar',
  budgetBytes: 150 * 1024,
  docLines: [
    'The Rail Race duck bar, as authored geometry: a post and a bar.',
    '',
    '**Generated — do not edit.** `npm run pack:duckbar` rebuilds it from',
    '`duckbar.glb`, which is itself written by `npm run blend:duckbar` (from',
    '`art/blend/duckbar.blend`, the authoring source — see',
    '`art/blend/duckbar_export.py`). See `scripts/pack-kid-asset.mts` for why',
    'the bytes are imported rather than fetched.',
  ],
});
