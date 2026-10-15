import { BOOKS, type LibraryBook } from './books';
import { LIBRARY_READABLE_SLOTS, type ReadableSlot } from './layout';

/**
 * **Which readable book stands in which slot** (#718, part 4 of the Library
 * epic #714) — decided here and nowhere else: **by index**, `BOOKS[i]` in
 * `LIBRARY_READABLE_SLOTS[i]`.
 *
 * `books.ts` owns the books (their words, titles and covers) and `layout.ts`
 * owns the slots (which case, which shelf, how far along, where she stands to
 * take one down); this file is the one place the two meet. `furnish.ts` draws
 * each book in its slot, `Library.ts` offers its "Read it!" chip there, and the
 * checks read the same pairing back — so nothing anywhere keeps a second list
 * of which book is where, and nothing counts the books but `BOOKS.length`.
 *
 * **One book per slot, one slot per book, or the build throws at load** — both
 * counts named. A book with no slot would be a story she can never find on a
 * shelf; a slot with no book, a gap the room leaves for nothing.
 */
export interface ShelfBook {
  readonly book: LibraryBook;
  readonly slot: ReadableSlot;
}

if (BOOKS.length !== LIBRARY_READABLE_SLOTS.length) {
  throw new Error(
    `Library: ${BOOKS.length} readable books (books.ts's BOOKS) but ${LIBRARY_READABLE_SLOTS.length} readable slots ` +
      "(layout.ts's LIBRARY_READABLE_SLOTS) — every book stands in exactly one slot, paired by index, so the two lists must grow together",
  );
}

export const SHELF_BOOKS: readonly ShelfBook[] = BOOKS.map((book, i) => ({ book, slot: LIBRARY_READABLE_SLOTS[i]! }));

/** Every readable book's zone id starts with this — so a check can pick the books' zones out of the room's. */
export const SHELF_BOOK_ZONE_PREFIX = 'library-book:';

/**
 * A readable book's interact zone's id, `library-book:<bookId>` — the one
 * owner of its shape, for `Library.ts`, which offers the zone, and the checks
 * that press it (`check:library`, `check:book-reader`). Light on purpose, like
 * this whole file: a Node check can import it without building the park.
 */
export function shelfBookZoneId(bookId: string): string {
  return `${SHELF_BOOK_ZONE_PREFIX}${bookId}`;
}
