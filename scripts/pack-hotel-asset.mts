/**
 * **Turns `src/art/assets/hotel.glb` into the module the game imports.**
 *
 * ```
 * npm run pack:hotel
 * ```
 *
 * The Land Hotel's counterpart to `pack-duckbar-asset.mts` — the **fourth**
 * asset through the `.glb` pipeline (`ART-AGENT-NOTES.md` §6a), and the first
 * whose Blender source is itself a script: `art/blend/hotel_build.py` writes
 * `hotel.blend`, `hotel_export.py` writes the `.glb`, and `npm run blend:hotel`
 * runs the three steps in order. This is always the last of them.
 *
 * See `pack-kid-asset.mts` for why the asset ships as an imported module rather
 * than a fetched file, and `scripts/lib/pack-glb-asset.mts` for the
 * file-writing and budget check every `pack:<asset>` script shares.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packGlbAsset } from './lib/pack-glb-asset.mts';

const here = dirname(fileURLToPath(import.meta.url));

packGlbAsset({
  glbPath: resolve(here, '../src/art/assets/hotel.glb'),
  modulePath: resolve(here, '../src/art/assets/hotelGlb.ts'),
  constantName: 'HOTEL_GLB_BASE64',
  label: 'pack:hotel',
  /**
   * 288 KB, against the 150 KB every other asset gets.
   *
   * The 150 KB figure is Jim's ruling of 31 July for **one character**. This
   * file is not one asset: it is six — a 28 m building plus a bed, a hanging
   * disco ball, a breakfast table with three bowls of cereal, a reception desk
   * and a door — so the comparable per-asset figure is about 41 KB, well
   * inside it. Raising a shared budget for one file would have been the wrong
   * move; raising this one, with the arithmetic written down, is the point of
   * the knob being per-asset.
   *
   * Where the bytes are, so a future change knows what it is trading: about
   * 30% of the file is `tower-windows` alone — 640-odd little quads whose only
   * job is to say "fifty storeys" from across the park. If this ever needs to
   * shrink, that is the one lever worth pulling (a painted window texture on
   * six tall quads would cost a few hundred bytes), and everything else in
   * here is already down to the vertex.
   */
  budgetBytes: 288 * 1024,
  docLines: [
    'The Land Hotel, as authored geometry: the crystal tower and the five',
    'pieces of furniture that go inside it.',
    '',
    '**Generated — do not edit.** `npm run pack:hotel` rebuilds it from',
    '`hotel.glb`, which is itself written by `npm run blend:hotel` (from',
    '`art/blend/hotel.blend`, which is in turn *generated* by',
    '`art/blend/hotel_build.py` — that script is the authoring source, not',
    'the .blend). See `scripts/pack-kid-asset.mts` for why the bytes are',
    'imported rather than fetched.',
  ],
});
