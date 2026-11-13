import type { LazyPart } from './LazyPart';
import { chunkPart } from './lazyChunks';
import { SPACE_LIBRARY, SPACE_REPTILE_HOUSE, type SpaceId } from './spaces';
import type * as ReptileHallModule from './reptileHouse/hall';
import type * as FerrisShowModule from './ferrisWheel/show';
import type * as LibraryRoomModule from './library/room';

/**
 * **Every room that is fetched when she goes into it** — the one list.
 *
 * Each entry is a lazy chunk (`LazyPart`): a building keeps its outside, its
 * doors and its shell in the boot, and furnishes the inside from one of these
 * the first time she walks in. `main.ts` loads the ones a restored save or a
 * deep link starts inside before the game is built; `scripts/lib/eagerInteriors.mts`
 * provides every one of them to Node, which builds the whole park up front;
 * `check:boot-chunk` fails if any of them is reachable from the boot without
 * going through its `import()` here.
 *
 * Deliberately tiny and free of the buildings themselves: `main.ts` imports
 * it, and the boot must not pay for a building to ask whether a room is in.
 */

/** The Reptile House's hall floor: cases, enclosures, planting, the stall and the tortoise. */
export const REPTILE_HALL = chunkPart<typeof ReptileHallModule>('the Reptile House hall', 'src/world/reptileHouse/hall.ts', () => import('./reptileHouse/hall'));

/** The Space Ferris Wheel's sky show: clouds, space, the four friends and the sparks — built on boarding. */
export const FERRIS_SHOW = chunkPart<typeof FerrisShowModule>('the ferris wheel sky show', 'src/world/ferrisWheel/show.ts', () => import('./ferrisWheel/show'));

/** The Library's reading room and secret den: shell, furniture, books, the owl, the dragon, the cat. */
export const LIBRARY_ROOM = chunkPart<typeof LibraryRoomModule>('the Library reading room', 'src/world/library/room.ts', () => import('./library/room'));

/** Every lazy room, for the boot's preloading and Node's providing. */
export const LAZY_INTERIORS: readonly LazyPart<unknown>[] = [REPTILE_HALL, FERRIS_SHOW, LIBRARY_ROOM];

/**
 * The rooms a boot must load before the game is built: the one a restored save
 * stands in (`SavedPlace.space`, a `world/spaces.ts` id) and the one a deep link
 * opens in. Every other road in goes through a door, which loads its own room
 * behind its iris; these two cannot, because the building adopts her where she
 * already is, in its constructor, and a room with no floor yet would be a shell
 * with no solids in it.
 */
export function interiorsToPreload(space: SpaceId | undefined, pathname: string): LazyPart<unknown>[] {
  const parts = new Set<LazyPart<unknown>>();
  if (space === SPACE_REPTILE_HOUSE) parts.add(REPTILE_HALL);
  if (pathname === '/reptile-house' || pathname === '/tortoise-ride') parts.add(REPTILE_HALL);
  if (pathname === '/ferris') parts.add(FERRIS_SHOW);
  if (space === SPACE_LIBRARY) parts.add(LIBRARY_ROOM);
  // `/book?id=` too: a page that pictures the library draws the room's own
  // owl and shelves (`LazyBookReader` loads the room with the reader).
  if (pathname === '/library' || pathname === '/library-den' || pathname === '/book') parts.add(LIBRARY_ROOM);
  return [...parts];
}
