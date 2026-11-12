import { LazyPart } from './LazyPart';
import type * as ReptileHallModule from './reptileHouse/hall';

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
export const REPTILE_HALL = new LazyPart<typeof ReptileHallModule>('the Reptile House hall', () => import('./reptileHouse/hall'));

/** Every lazy room, for the boot's preloading and Node's providing. */
export const LAZY_INTERIORS: readonly LazyPart<unknown>[] = [REPTILE_HALL];

/**
 * The rooms a boot must load before the game is built: the one a restored save
 * stands in (`SavedPlace.space`, a `world/spaces.ts` id) and the one a deep link
 * opens in. Every other road in goes through a door, which loads its own room
 * behind its iris; these two cannot, because the building adopts her where she
 * already is, in its constructor, and a room with no floor yet would be a shell
 * with no solids in it.
 */
export function interiorsToPreload(space: string | undefined, pathname: string): LazyPart<unknown>[] {
  const parts = new Set<LazyPart<unknown>>();
  if (space === 'reptileHouse') parts.add(REPTILE_HALL);
  if (pathname === '/reptile-house' || pathname === '/tortoise-ride') parts.add(REPTILE_HALL);
  return [...parts];
}
