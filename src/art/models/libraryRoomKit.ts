import { LIBRARY_ROOM_GLB_BASE64 } from '../assets/libraryRoomGlb';
import { base64ToArrayBuffer, readGlbParts } from '../style/glb';
import { registerLibraryRoomParts } from './libraryKit';

/**
 * **The reading room's piece of the Library kit, read** — every node of
 * `library.glb` drawn only inside (the furniture, the books, the owl, the
 * dragon, the cat; `libraryKitSplit.ts` owns the split), decoded once and handed
 * to `libraryKit.ts`, whose measures then reach them as they reach the
 * building's.
 *
 * In the reading room's lazy chunk (`world/interiors.ts`'s `LIBRARY_ROOM`): a
 * module that draws or measures a room node imports this, so the chunk that
 * carries the module carries the bytes, and nothing in the boot can.
 */
export const LIBRARY_ROOM_PART_NAMES: readonly string[] = (() => {
  const parts = readGlbParts(base64ToArrayBuffer(LIBRARY_ROOM_GLB_BASE64));
  registerLibraryRoomParts(parts);
  return [...parts.keys()];
})();
