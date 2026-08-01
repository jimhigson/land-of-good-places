/**
 * **Turns `src/art/assets/cart.glb` into the module the game imports.**
 *
 * ```
 * npm run pack:cart
 * ```
 *
 * The Rail Race cart's counterpart to `pack-kid-asset.mts` — the **second**
 * asset through the `.glb` pipeline (`ART-AGENT-NOTES.md` §6a). Unlike the
 * kid, the cart has no procedural Stage A: it was modelled directly in
 * Blender against the reference numbers already in `cart.ts`
 * (`WHEEL_RADIUS`, the rail gauge, `SEAT_HEIGHT`), so `npm run blend:cart`
 * (`art/blend/cart_export.py`) is the only producer of `cart.glb`, and this
 * is always the next step after it.
 *
 * See `pack-kid-asset.mts` for why the asset ships as an imported module
 * rather than a fetched file, and `scripts/lib/pack-glb-asset.mts` for the
 * file-writing and budget check both scripts share.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packGlbAsset } from './lib/pack-glb-asset.mts';

const here = dirname(fileURLToPath(import.meta.url));

packGlbAsset({
  glbPath: resolve(here, '../src/art/assets/cart.glb'),
  modulePath: resolve(here, '../src/art/assets/cartGlb.ts'),
  constantName: 'CART_GLB_BASE64',
  label: 'pack:cart',
  // Same per-asset ceiling as the kid (Jim's 31 July ruling) — this cart is
  // a fraction of it in practice (see the printed size below).
  budgetBytes: 150 * 1024,
  docLines: [
    "The Rail Race cart, as authored geometry: tub, nose, seat, pet perch,",
    'four wheels and two headlamps.',
    '',
    '**Generated — do not edit.** `npm run pack:cart` rebuilds it from',
    '`cart.glb`, which is itself written by `npm run blend:cart` (from',
    '`art/blend/cart.blend`, the authoring source — see `art/blend/cart_export.py`).',
    'See `scripts/pack-kid-asset.mts` for why the bytes are imported rather',
    'than fetched.',
  ],
});
