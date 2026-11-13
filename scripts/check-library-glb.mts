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
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BufferAttribute } from 'three';
import { LIBRARY_DEN_GLB_BASE64 } from '../src/art/assets/libraryDenGlb.ts';
import { LIBRARY_GLB_BASE64 } from '../src/art/assets/libraryGlb.ts';
import { LIBRARY_FACES, LIBRARY_ROOM_GLB_BASE64 } from '../src/art/assets/libraryRoomGlb.ts';
import { isLibraryBootNode, LIBRARY_BOOT_NODES } from '../src/art/models/libraryKitSplit.ts';
import { base64ToArrayBuffer, readGlbParts } from '../src/art/style/glb.ts';
import { checkGlbKit } from './lib/check-glb-kit.mts';
import { glbNodeNames, glbSubset } from './lib/splitGlb.mts';

const here = dirname(fileURLToPath(import.meta.url));
const libraryGlbPath = resolve(here, '../src/art/assets/library.glb');
const whole = new Uint8Array(readFileSync(libraryGlbPath));

// ---------------------------------------------------------------------------
// library.glb ships in two pieces (`libraryKitSplit.ts`): the building with the
// park, the reading room when she goes in. Each module must be exactly its
// piece of the committed file, cut again here the way `pack:library` cut it;
// and the two pieces together must be every node of the file, each read back
// with the same geometry as from the whole file — a split that lost or bent a
// part would otherwise pass every per-piece check.
// ---------------------------------------------------------------------------
{
  const failures: string[] = [];
  const fileNames = glbNodeNames(whole);
  const bootNames = glbNodeNames(new Uint8Array(base64ToArrayBuffer(LIBRARY_GLB_BASE64)));
  const roomNames = glbNodeNames(new Uint8Array(base64ToArrayBuffer(LIBRARY_ROOM_GLB_BASE64)));
  const missingBoot = LIBRARY_BOOT_NODES.filter((name) => !fileNames.includes(name));
  if (missingBoot.length > 0) failures.push(`LIBRARY_BOOT_NODES names ${missingBoot.join(', ')}, which library.glb does not have`);
  const both = bootNames.filter((name) => roomNames.includes(name));
  if (both.length > 0) failures.push(`${both.join(', ')} ship in both pieces`);
  const lost = fileNames.filter((name) => !bootNames.includes(name) && !roomNames.includes(name));
  if (lost.length > 0) failures.push(`${lost.join(', ')} ship in neither piece`);
  const misplaced = [...bootNames.filter((name) => !isLibraryBootNode(name)), ...roomNames.filter(isLibraryBootNode)];
  if (misplaced.length > 0) failures.push(`${misplaced.join(', ')} ship in the wrong piece`);
  const original = readGlbParts(whole.slice().buffer);
  const pieces = new Map([
    ...readGlbParts(base64ToArrayBuffer(LIBRARY_GLB_BASE64)),
    ...readGlbParts(base64ToArrayBuffer(LIBRARY_ROOM_GLB_BASE64)),
  ]);
  let compared = 0;
  for (const [name, part] of original) {
    const piece = pieces.get(name);
    if (!piece) continue;
    if (!part.position.equals(piece.position)) failures.push(`${name}: its translation changed in the split`);
    const attributes = Object.keys(part.geometry.attributes);
    if (attributes.join() !== Object.keys(piece.geometry.attributes).join()) failures.push(`${name}: its attributes changed in the split`);
    for (const key of attributes) {
      const a = (part.geometry.getAttribute(key) as BufferAttribute).array;
      const b = (piece.geometry.getAttribute(key) as BufferAttribute | undefined)?.array;
      if (!b || a.length !== b.length || a.some((value, i) => value !== b[i])) failures.push(`${name}: ${key} changed in the split`);
    }
    const ia = part.geometry.getIndex()?.array;
    const ib = piece.geometry.getIndex()?.array;
    if (!ia !== !ib || (ia && ib && (ia.length !== ib.length || ia.some((value, i) => value !== ib[i])))) failures.push(`${name}: its index changed in the split`);
    compared += 1;
  }
  console.log(
    `check:library-glb: library.glb splits into ${bootNames.length} boot nodes (libraryGlb.ts) + ${roomNames.length} room nodes ` +
      `(libraryRoomGlb.ts) = ${fileNames.length}; ${compared} read back identical to the whole file`,
  );
  if (failures.length > 0) {
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    console.error('check:library-glb: the split is wrong — run `pnpm run pack:library`.');
    process.exit(1);
  }
}

await checkGlbKit({
  label: 'check:library-glb',
  title: 'the Library kit\'s boot piece (the building) as it ships',
  glbPath: libraryGlbPath,
  expected: glbSubset(whole, isLibraryBootNode),
  fileName: 'library.glb',
  moduleName: 'libraryGlb.ts',
  base64: LIBRARY_GLB_BASE64,
  faces: null,
  facesName: '(none: the faced heads are all in the room piece)',
  packScript: 'pnpm run pack:library',
  closing: 'The building ships as built, and both readers read it the same.',
});

await checkGlbKit({
  label: 'check:library-glb',
  title: 'the Library kit\'s reading-room piece as it ships',
  glbPath: libraryGlbPath,
  expected: glbSubset(whole, (name) => !isLibraryBootNode(name)),
  fileName: 'library.glb',
  moduleName: 'libraryRoomGlb.ts',
  base64: LIBRARY_ROOM_GLB_BASE64,
  faces: LIBRARY_FACES,
  facesName: 'LIBRARY_FACES',
  packScript: 'pnpm run pack:library',
  closing: 'The reading room ships as built, and both readers read it the same.',
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
