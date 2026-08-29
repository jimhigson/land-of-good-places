/**
 * **Turns `src/art/assets/bridgeStones.glb` into the module the game imports.**
 *
 * ```
 * npm run pack:bridge-stones
 * ```
 *
 * The bridge's stone kit through the same pipeline as the kid, the cart, the
 * duck bar and the hotel. Its `.glb` is written by
 * `npm run blend:bridge-stones` (`art/blend/bridge_stones_build.py`, then
 * `bridge_stones_export.py`), and this is always the next step after it.
 *
 * See `pack-kid-asset.mts` for why the asset ships as an imported module
 * rather than a fetched file, and `scripts/lib/pack-glb-asset.mts` for the
 * file-writing and budget check every one of these scripts shares.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packGlbAsset } from './lib/pack-glb-asset.mts';

const here = dirname(fileURLToPath(import.meta.url));

packGlbAsset({
  glbPath: resolve(here, '../src/art/assets/bridgeStones.glb'),
  modulePath: resolve(here, '../src/art/assets/bridgeStonesGlb.ts'),
  constantName: 'BRIDGE_STONES_GLB_BASE64',
  label: 'pack:bridge-stones',
  // Three chamfered blocks. The ceiling is the same one every other asset
  // gets rather than a tighter one picked for this asset's own smallness —
  // a budget that has to be retuned every time a stone gains a chamfer is a
  // budget nobody will keep.
  budgetBytes: 150 * 1024,
  docLines: [
    "The bridge's modelled stonework, as authored geometry: one coping block,",
    'one voussoir and one keystone, repeated along a parapet and around a',
    'tunnel mouth by `src/world/train/bridges.ts`.',
    '',
    '**Generated — do not edit.** `npm run pack:bridge-stones` rebuilds it from',
    '`bridgeStones.glb`, which is itself written by `npm run blend:bridge-stones`',
    '(from `art/blend/bridge_stones_build.py`, the authoring source).',
    'See `scripts/pack-kid-asset.mts` for why the bytes are imported rather',
    'than fetched.',
  ],
});
