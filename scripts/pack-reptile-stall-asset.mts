/**
 * **Turns `src/art/assets/reptileStall.glb` into the module the game imports.**
 *
 * ```
 * pnpm run pack:reptile-stall
 * ```
 *
 * The Reptile House's stall kit — Scales & Tails's awning, eave snake, finial
 * and sign, and the Noodle-o-meter. `art/blend/reptile_stall_build.py` writes
 * `reptile_stall.blend`, `reptile_stall_export.py` writes the `.glb`, and
 * `pnpm run blend:reptile-stall` runs the three steps in order. This is
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
  glbPath: resolve(here, '../src/art/assets/reptileStall.glb'),
  modulePath: resolve(here, '../src/art/assets/reptileStallGlb.ts'),
  constantName: 'REPTILE_STALL_GLB_BASE64',
  label: 'pack:reptile-stall',
  /**
   * 80 KB, the spec's ceiling for this kit (REPTILE-HOUSE.md, asset group 6).
   *
   * The kit is about 2 400 triangles across seventeen nodes at roughly 30
   * bytes a triangle — the same cost as the castle and the gate, because
   * nearly every edge on the swept snake bodies and the scalloped awning is
   * over `Part.emit`'s split-normal threshold and a split normal is a whole
   * duplicated vertex. The honest figure is around 70 KB, so this leaves
   * room for a second thought about a head without room for a fourth snake.
   */
  budgetBytes: 80 * 1024,
  docLines: [
    '**The Reptile House stall kit, as authored geometry.** Do not edit — generated.',
    '',
    'Written by `pnpm run blend:reptile-stall`, which runs',
    '`art/blend/reptile_stall_build.py` (the authoring source), then',
    '`reptile_stall_export.py`, then this packer.',
    '',
    'Seventeen nodes in two frames, told apart by prefix. `rs-awning`,',
    '`rs-awning-posts`, `rs-awning-snake`, `rs-finial`, `rs-sign` and the',
    '`rs-stall-snake-*` face parts dress a `kiosk.ts` counter and are authored',
    'in its frame (origin at the stall base, counter toward +Z). `rs-meter-*`',
    'is the Noodle-o-meter, a free-standing post authored about its own base.',
    '',
    'Shape only: no colour, no material, no texture. `src/art/models/',
    'reptileStallAssets.ts` owns the colour table. `rs-sign` and',
    '`rs-meter-board` are the only nodes carrying UVs, for the sign atlas.',
  ],
});
