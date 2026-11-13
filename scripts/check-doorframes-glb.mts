/**
 * **`check:doorframes-glb` — is the doorway-frame kit that ships the one the
 * build wrote, and does the game's reader read it the way three.js does?**
 *
 * ```
 * pnpm run check:doorframes-glb
 * ```
 *
 * The questions are `scripts/lib/check-glb-kit.mts`'s, asked of
 * `art/blend/doorframes_build.py` → `doorframes.glb` → `pack:doorframes` →
 * `doorframesGlb.ts`. Nothing in this kit is painted, so it declares no faces
 * (and the shared check holds it to that). `check:doorframes` measures the
 * frames as the game builds them.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOORFRAMES_GLB_BASE64 } from '../src/art/assets/doorframesGlb.ts';
import { checkGlbKit } from './lib/check-glb-kit.mts';

const here = dirname(fileURLToPath(import.meta.url));

await checkGlbKit({
  label: 'check:doorframes-glb',
  title: 'the doorway-frame kit as it ships',
  glbPath: resolve(here, '../src/art/assets/doorframes.glb'),
  fileName: 'doorframes.glb',
  moduleName: 'doorframesGlb.ts',
  base64: DOORFRAMES_GLB_BASE64,
  faces: null,
  facesName: 'faces (none in this kit)',
  packScript: 'pnpm run pack:doorframes',
  closing: 'The doorway-frame kit ships as built, and both readers read it the same.',
});
