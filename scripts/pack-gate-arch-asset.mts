/**
 * **Turns `src/art/assets/gateArch.glb` into the module the game imports.**
 *
 * ```
 * pnpm run pack:gate-arch
 * ```
 *
 * The park's entrance arch — the **seventh** asset through the `.glb` pipeline
 * (kid → cart → duck bar → hotel → bridge stones → castle → this), and the
 * third whose Blender source is itself a script: `art/blend/gate_arch_build.py`
 * writes `gateArch.blend`, `gate_arch_export.py` writes the `.glb`, and
 * `pnpm run blend:gate-arch` runs the three steps in order. This is always the
 * last of them.
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
  glbPath: resolve(here, '../src/art/assets/gateArch.glb'),
  modulePath: resolve(here, '../src/art/assets/gateArchGlb.ts'),
  constantName: 'GATE_ARCH_GLB_BASE64',
  label: 'pack:gate-arch',
  /**
   * 120 KB, against the castle's 200 and the hotel's 640.
   *
   * The arch is 2 400 triangles across five nodes and costs roughly 30 bytes a
   * triangle, the same as the castle kit does and for the same reason: nearly
   * every edge here is over `Part.emit`'s 46° split-normal threshold, and a
   * split normal is a whole duplicated vertex. So the honest figure is around
   * 75 KB and this leaves room for a second thought about the roundel without
   * leaving room for the arch to double in cost unnoticed.
   *
   * Where the triangles actually are, if this ever needs trimming: the two
   * piers are 800 between them (a 20-segment revolve each) and the nine
   * bobbles another 720. Coarsening either is the step change; shaving the
   * band is not.
   */
  budgetBytes: 120 * 1024,
  docLines: [
    '**The park entrance arch, as authored geometry.** Do not edit — generated.',
    '',
    'Written by `pnpm run blend:gate-arch`, which runs',
    '`art/blend/gate_arch_build.py` (the authoring source), then',
    '`gate_arch_export.py`, then this packer.',
    '',
    'Five nodes of one object: both piers, the arch band with its hangers and',
    'the roundel collar, nine bobbles along the top, the lettered sign plank,',
    'and the ferris-wheel roundel. Every one is authored in the arch’s own',
    'frame — origin at the middle of the gateway, on the ground — so they are',
    'all added at the same point and none needs a placement offset.',
    '',
    'Shape only: no colour, no material, no texture. `src/art/models/',
    'gateArch.ts` owns the colour table and paints both canvases. The sign and',
    'the roundel are the only nodes carrying UVs, because they are the only',
    'two a picture is painted into.',
  ],
});
