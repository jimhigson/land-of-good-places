import { discoverSecret, gameStore, type GameState } from '../../state';
import { BOOKS, CHAPTER_BOOKS, PICTURE_BOOKS, bookById, bookCollectionId, type BookKind, type LibraryBook } from './books';

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
 *
 * ## The two prizes for reading
 *
 * - **Every picture book read** — the library's own celebration (`CuteODex`,
 *   {@link everyPictureBookRead}). Tied to the picture books alone, so the
 *   littlest reader's road to it is exactly what it was before the chapter
 *   books arrived.
 * - **Every chapter book read** — the `secret.bigReader` card, **Big reader**,
 *   awarded here and only here ({@link markBookRead}, by
 *   {@link bigReaderEarned}): the moment the last chapter book is read to its
 *   end, whichever order she read them in.
 */

/** The Cute-o-dex secret for reading every chapter book — its row is `state/secrets.ts`'s. */
export const BIG_READER_SECRET_ID = 'secret.bigReader';

/**
 * Files `book` as read — the reader calls it the first time each opening
 * reaches the last page — and awards **Big reader** the moment that makes
 * every chapter book read.
 *
 * Only the library's own books are filed: a book object that is not the one
 * `BOOKS` holds under its id (a check's fixture, opened straight into the
 * reader) is ignored, so it can never leave a bookmark for a book that is not
 * on a shelf.
 */
export function markBookRead(book: LibraryBook): void {
  if (bookById(book.id) !== book) return;
  const id = bookCollectionId(book.id);
  if (gameStore.get().collection[id]?.discovered !== true) gameStore.collect(id, book.title, 'book', 'backpack');
  // Asked on every chapter book's finish, a re-read included, rather than only
  // on a first one: a card that was ever missed is handed over the next time
  // she finishes one, and `discoverSecret` is idempotent.
  if (book.kind === 'chapter' && bigReaderEarned(gameStore.get())) discoverSecret(BIG_READER_SECRET_ID);
}

/** True once `bookId` has been read to the end on this save. */
export function isBookRead(state: GameState, bookId: string): boolean {
  return state.collection[bookCollectionId(bookId)]?.discovered === true;
}

/** How many books she has read — of one kind, or of every kind. */
export function booksRead(state: GameState, kind?: BookKind): number {
  return BOOKS.filter((book) => (kind === undefined || book.kind === kind) && isBookRead(state, book.id)).length;
}

/** Every picture book read: the library's celebration (`CuteODex`). */
export function everyPictureBookRead(state: GameState): boolean {
  return PICTURE_BOOKS.length > 0 && PICTURE_BOOKS.every((book) => isBookRead(state, book.id));
}

/**
 * **The Big reader rule**: every chapter book on the shelf read to its end.
 * Never true of an empty shelf — with no chapter books there is nothing to
 * have read, and a card for it would be a card for nothing.
 */
export function bigReaderEarned(state: GameState, chapterBooks: readonly LibraryBook[] = CHAPTER_BOOKS): boolean {
  return chapterBooks.length > 0 && chapterBooks.every((book) => isBookRead(state, book.id));
}
