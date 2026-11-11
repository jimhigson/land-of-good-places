/**
 * **`check:library-glb` — is the Library kit that ships the one the build
 * wrote, and does the game's reader read it the way three.js does?**
 *
 * ```
 * pnpm run check:library-glb
 * ```
 *
 * The four questions, and why they are asked of the bytes rather than trusted,
 * are `scripts/lib/check-glb-kit.mts`'s — the body this check was, until the
 * story-props kit became the second kit through it. This file only names the
 * kit: `art/blend/library_build.py` → `library.glb` → `pack:library` →
 * `libraryGlb.ts` (`LIBRARY_FACES`). The Engineer's `check:library` (#716)
 * re-measures the figures the game builds against with `visibleBounds()`.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBRARY_FACES, LIBRARY_GLB_BASE64 } from '../src/art/assets/libraryGlb.ts';
import { checkGlbKit } from './lib/check-glb-kit.mts';

const here = dirname(fileURLToPath(import.meta.url));

await checkGlbKit({
  label: 'check:library-glb',
  title: 'the Library kit as it ships',
  glbPath: resolve(here, '../src/art/assets/library.glb'),
  fileName: 'library.glb',
  moduleName: 'libraryGlb.ts',
  base64: LIBRARY_GLB_BASE64,
  faces: LIBRARY_FACES,
  facesName: 'LIBRARY_FACES',
  packScript: 'pnpm run pack:library',
  closing: 'The Library kit ships as built, and both readers read it the same.',
});
