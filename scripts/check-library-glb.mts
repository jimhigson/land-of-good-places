/**
 * **`check:library-glb` — are the Library kits that ship the ones the build
 * wrote, and does the game's reader read them the way three.js does?**
 *
 * ```
 * pnpm run check:library-glb
 * ```
 *
 * The four questions, and why they are asked of the bytes rather than trusted,
 * are `scripts/lib/check-glb-kit.mts`'s. This file names two kits:
 * `art/blend/library_build.py` → `library.glb` → `pack:library` →
 * `libraryGlb.ts` (`LIBRARY_FACES`), and the secret den's own kit (#719)
 * `art/blend/library_den_build.py` → `libraryDen.glb` → `pack:library-den` →
 * `libraryDenGlb.ts` — a kit of its own because the first ships 11 KB under
 * its budget. The den kit paints nothing, and is checked as one that paints
 * nothing: no node may carry texcoords or extras. The Engineer's
 * `check:library` (#716) re-measures the figures the game builds against with
 * `visibleBounds()`.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBRARY_DEN_GLB_BASE64 } from '../src/art/assets/libraryDenGlb.ts';
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

await checkGlbKit({
  label: 'check:library-glb',
  title: "the Library's secret den kit as it ships",
  glbPath: resolve(here, '../src/art/assets/libraryDen.glb'),
  fileName: 'libraryDen.glb',
  moduleName: 'libraryDenGlb.ts',
  base64: LIBRARY_DEN_GLB_BASE64,
  faces: null,
  facesName: '(none: the den kit paints nothing)',
  packScript: 'pnpm run pack:library-den',
  closing: 'The den kit ships as built, and both readers read it the same.',
});
