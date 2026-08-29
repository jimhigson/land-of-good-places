/**
 * **Turns `src/art/assets/castle.glb` into the module the game imports.**
 *
 * ```
 * npm run pack:castle
 * ```
 *
 * The castle interior's counterpart to `pack-hotel-asset.mts` — the **sixth**
 * asset through the `.glb` pipeline (kid → cart → duck bar → hotel → bridge
 * stones → this), and the second whose Blender source is itself a script:
 * `art/blend/castle_build.py` writes `castle.blend`, `castle_export.py` writes
 * the `.glb`, and `npm run blend:castle` runs the three steps in order. This is
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
  glbPath: resolve(here, '../src/art/assets/castle.glb'),
  modulePath: resolve(here, '../src/art/assets/castleGlb.ts'),
  constantName: 'CASTLE_GLB_BASE64',
  label: 'pack:castle',
  /**
   * 200 KB, against the 150 KB a character gets and the 640 KB the hotel took.
   *
   * **This is the Engineer's figure, from `HANDOFF-castle-interior-363.md`
   * §4.2, and it is deliberately tight:** this is set dressing, not a hero
   * asset, and unlike the hotel it is base64'd into a bundle that also has to
   * carry the hotel. Ten factories at 200 KB is 20 KB each, against the
   * hotel's 33 KB — affordable because a castle's furniture is chunky
   * primitives with a one-segment bevel, where a crystal tower is not.
   *
   * Worth knowing before spending it: this asset costs roughly **30 bytes per
   * triangle**, because almost every edge in it is over `Part.emit`'s 46°
   * split-normal threshold and a split normal is a whole duplicated vertex.
   * Shaving triangles is therefore linear and slow going; the step change is
   * a coarser revolution or a plain `box()` instead of a `rounded_box()`, not
   * a smaller bevel.
   */
  budgetBytes: 200 * 1024,
  docLines: [
    '**The castle interior, as authored geometry.** Do not edit — generated.',
    '',
    'Written by `npm run blend:castle`, which runs `art/blend/castle_build.py`',
    '(the authoring source), then `castle_export.py`, then this packer.',
    '',
    'Ten assets in one file — a suit of armour and its plinth, a tapestry and',
    'its rail, a wall-torch sconce, a throne, a banqueting table, a bench, four',
    'feast props and a treasure chest — because they share a build script and',
    'are used together, not because they are one object. Each is its own',
    '`AssetHandle` with its own origin, so inside this file they all overlap at',
    'the world origin, which is expected and harmless.',
    '',
    'Shape only: no colour, no material, no texture. `src/art/models/',
    "castleAssets.ts` owns the colour table, the outlines and the shadow flags,",
    'exactly as `hotelAssets.ts` does for the hotel.',
  ],
});
