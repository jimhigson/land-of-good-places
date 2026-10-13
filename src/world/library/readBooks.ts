import { gameStore, type GameState } from '../../state';
import { BOOKS, bookCollectionId, type LibraryBook } from './books';

/**
 * **Which library books she has read** — `state/secrets.ts`'s `discoverSecret`,
 * for books (#717).
 *
 * A book read to its last page is a Cute-o-dex entry, `book.<id>`, recorded
 * through the ordinary `gameStore.collect` path with the `book` category. That
 * is the whole of its persistence: the collection is already saved, restored,
 * and read back tolerantly by `state/save.ts`, so a save from before the
 * library loads exactly as it did (no `book.` entries, nothing read), and the
 * bookmark is counted towards the book's total like every other entry.
 *
 * `placement` must be one of the `CUTE_PLACEMENTS`; `backpack` is the inert
 * one, as it is for a secret — nothing about a bookmark walks in the parade.
 */
export function markBookRead(book: LibraryBook): void {
  const id = bookCollectionId(book.id);
  if (gameStore.get().collection[id]?.discovered === true) return;
  gameStore.collect(id, book.title, 'book', 'backpack');
}

/** True once `bookId` has been read to the end on this save. */
export function isBookRead(state: GameState, bookId: string): boolean {
  return state.collection[bookCollectionId(bookId)]?.discovered === true;
}

/** How many of the twelve she has read. */
export function booksRead(state: GameState): number {
  return BOOKS.filter((book) => isBookRead(state, book.id)).length;
}
