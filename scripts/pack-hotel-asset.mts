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
   * 512 KB, against the 150 KB every other asset gets.
   *
   * The 150 KB figure is Jim's ruling of 31 July for **one character**. This
   * file is not one asset: it is sixteen factories' worth — a 28 m building,
   * plus the furniture of a hotel (bed, hanging disco ball, breakfast table,
   * three bowls of cereal, reception desk, suite door), plus the second batch
   * of 7 August (a four-poster pet bed and its bowl, the lift's doors, frame,
   * car and pointer dial, the tower's sliding front doors, the suite's
   * television and its Game Boy), plus the lobby's grand staircase. At 480 KB
   * that is about **30 KB per factory**, well inside the per-character figure,
   * and 172 KB over the wire after gzip. Raising a *shared* budget for one
   * file would have been the wrong move; raising this one, with the arithmetic
   * written down, is the whole point of the knob being per-asset.
   *
   * The staircase (7 August) is what took it past 432 KB: 2,300 triangles and
   * 89 KB for the flight, its two closed strings, thirteen balusters, the
   * swept handrail and two newels. It is worth saying what that bought,
   * because "the model got bigger" is not on its own a reason. It **replaced**
   * ten `BoxGeometry` treads built in `Hotel.ts` that Jim, playing on 7 August,
   * called *"a random stack of boxes"* — so the game draws fewer meshes than
   * before, and the bytes bought a staircase with a rail on it rather than a
   * second version of something that already existed.
   *
   * Where the bytes are, so a future change knows what it is trading:
   *
   * - The file costs a flat **~36 bytes per triangle** and always has. Nearly
   *   every edge in it is over `hotel_build.py`'s 46° split-normal threshold,
   *   and a split normal is a duplicated vertex, so triangles and bytes track
   *   each other almost exactly. Trimming is therefore linear: a 10% cut in
   *   geometry buys a 10% cut in bytes and no more.
   * - `tower-windows` is still the single largest node — 570 loose quads,
   *   ~62 KB, whose only job is to say "fifty storeys" from across the park.
   *   It is the one place a *step* change is available (a painted window
   *   texture on six tall quads would cost a few hundred bytes) and it is
   *   deliberately untouched, because it is shipped, QA'd art.
   * - 43 KB is glTF JSON: 66 nodes × 66 meshes × 195 accessors. Merging parts
   *   would reclaim some of it and cost the game a colour per part, which is
   *   the trade the whole no-materials-in-the-glb design refuses.
   */
  budgetBytes: 512 * 1024,
  docLines: [
    'The Land Hotel, as authored geometry: the crystal tower, the furniture',
    'that goes inside it, the lift, the suite’s television, and the lobby’s',
    'grand staircase.',
    '',
    '**Generated — do not edit.** `npm run pack:hotel` rebuilds it from',
    '`hotel.glb`, which is itself written by `npm run blend:hotel` (from',
    '`art/blend/hotel.blend`, which is in turn *generated* by',
    '`art/blend/hotel_build.py` — that script is the authoring source, not',
    'the .blend). See `scripts/pack-kid-asset.mts` for why the bytes are',
    'imported rather than fetched.',
  ],
});
