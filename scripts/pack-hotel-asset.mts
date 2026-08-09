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
   * 640 KB, against the 150 KB every other asset gets.
   *
   * The 150 KB figure is Jim's ruling of 31 July for **one character**. This
   * file is not one asset: it is nineteen factories' worth — a 28 m building,
   * plus the furniture of a hotel (bed, hanging disco ball, breakfast table,
   * three bowls of cereal, reception desk, suite door), plus the second batch
   * of 7 August (a four-poster pet bed and its bowl, the lift's doors, frame,
   * car and pointer dial, the tower's sliding front doors, the suite's
   * television and its Game Boy), plus the lobby's grand staircase in **both**
   * chiralities, the mezzanine bridge's balustrade tile and newel, and the
   * pendant-cluster chandelier. At 618 KB that is about **33 KB per factory**,
   * well inside the per-character figure, and 214 KB over the wire after gzip.
   * Raising a *shared* budget for one file would have been the wrong move;
   * raising this one, with the arithmetic written down, is the whole point of
   * the knob being per-asset.
   *
   * **8 August, 512 KB → 640 KB.** Measured, not estimated: 13,610 triangles
   * and 491,696 bytes before, 17,404 and 632,420 after — +3,794 triangles for
   * +140,724 bytes, which is 37 bytes a triangle and the same rate this file
   * has always run at. Where they went:
   *
   * | what | triangles | bytes |
   * | --- | --- | --- |
   * | the mirrored staircase | 2,304 | ~84 KB |
   * | the chandelier (12 drops, cords, rose) | 1,296 | ~47 KB |
   * | the balustrade tile + its newel | 194 | ~7 KB |
   *
   * The mirrored flight is the expensive one and it is worth saying what the
   * alternative was, because a second copy of a shipped mesh is a fair thing to
   * question. Mirroring the *node* with `scale.x = -1` costs nothing and does
   * not work: it flips triangle winding and `MeshToonMaterial` is `FrontSide`,
   * so the whole flight would be culled — invisible in the game while every
   * render of the original looked fine (CLAUDE.md's hood-face rule). Mirroring
   * the *geometry* in code (negate x, reverse the index order) would work and
   * would be free, and was not taken because the brief asked for an authored
   * mirror and because an authored one can be **asserted** — `hotel_build.py`
   * compares the two meshes vertex for vertex at build time, which no runtime
   * flip can be. 84 KB (29 KB gzipped) for a check that cannot lie is the trade
   * that was made; it is a cheap one to revisit if this file ever gets tight.
   *
   * Headroom at 640 KB is ~23 KB, which is about 630 triangles. That is
   * deliberately not much: the next thing that needs the budget raised should
   * have to say so out loud, here, with its own arithmetic.
   *
   * **8 August, later that day, 640 KB → 720 KB.** Saying so out loud, with the
   * arithmetic, because the paragraph above asked whoever came next to.
   *
   * Jim, on the imperial composition's renders: *"Raise both landing and
   * Mezzanine."* The reference photograph's subject is the see-through arch
   * under the landing, and a landing at 1.6 m has 1.6 m of headroom under it,
   * which is a shelf. The arch now has to clear the tallest child the park can
   * build (`kid.ts`'s `TALLEST_CHILD_HEIGHT`, 2.97 m) plus the 0.40 m her hat
   * transiently pops by (`train/clearance.ts`'s `RIDER_HEADROOM`), so the
   * landing goes to 3.84 m — twelve risers instead of five.
   *
   * **The cost is all in the two curves and it is a tread count, not a style.**
   * Measured, not estimated: 16,912 triangles and 619,536 bytes before, 19,464
   * and 713,212 after — +2,552 triangles for +93,676 bytes, which is 36.7 bytes
   * a triangle and the same rate this file has always run at.
   *
   * | what | triangles |
   * | --- | --- |
   * | each curved flight, 5 treads over 45° → 12 over 90° | 1,280 → 2,556 (×2) |
   * | the straight flight | 1,532, unchanged |
   *
   * A curve costs ~205 triangles a tread (its strings, rail, coping and
   * balusters are all sampled per metre of run, so the whole flight scales with
   * its length), and seven more treads twice over is the entire bill. Nothing
   * was made more detailed; the same joinery is simply longer.
   *
   * **What was not taken, and why.** The obvious 98 KB is the authored mirror —
   * `stair-left-*` is a full second copy of `stair-right-*`. The paragraph below
   * already calls it "a cheap one to revisit if this file ever gets tight", and
   * this is that moment; it is still not taken, because what it buys is
   * `assert_stairs_mirror` comparing two meshes vertex for vertex at build time,
   * and a runtime flip cannot be asserted at all. Culled-flight bugs of exactly
   * that kind have cost this project a fortnight before (CLAUDE.md's hood face).
   * The genuinely cheap 62 KB is still `tower-windows`, and it is still shipped,
   * QA'd art.
   *
   * 696.5 KB against 720 KB leaves ~23 KB of headroom — about 640 triangles,
   * the same deliberate tightness as before, and the same request to whoever
   * needs it next.
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
   * - ~50 KB is glTF JSON: one node, one mesh and three accessors per part.
   *   Merging parts would reclaim some of it and cost the game a colour per
   *   part, which is the trade the whole no-materials-in-the-glb design
   *   refuses.
   */
  budgetBytes: 720 * 1024,
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
