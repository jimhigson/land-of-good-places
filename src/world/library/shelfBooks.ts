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
 * **Every book has a slot of its own kind, or the build throws at load** —
 * both counts named. A book with no slot would be a story she can never find
 * on a shelf; a picture book on the big readers' shelf, or a chapter book among
 * the picture books, a shelf that lies about what is on it.
 *
 * **A slot may wait for its book, the other way round.** The big readers'
 * shelf (`layout.ts`'s six chapter-book slots on `west-4`) is laid out whole
 * while its chapter books land a few at a time (`chapterBooks/index.ts`, track
 * D of #714): a waiting slot is a gap in the row with its stand kept clear,
 * exactly as every slot stood before the twelve picture books landed (#720),
 * and `check:library`'s READABLE says how many wait on every run. Only the
 * last slots may wait — a gap *between* books would be a book missing.
 */
export interface ShelfBook {
  readonly book: LibraryBook;
  readonly slot: ReadableSlot;
}

if (BOOKS.length > LIBRARY_READABLE_SLOTS.length) {
  throw new Error(
    `Library: ${BOOKS.length} readable books (books.ts's BOOKS) but only ${LIBRARY_READABLE_SLOTS.length} readable slots ` +
      "(layout.ts's LIBRARY_READABLE_SLOTS) — every book stands in exactly one slot, paired by index, so the slots must grow with the books",
  );
}
for (const [i, book] of BOOKS.entries()) {
  const slot = LIBRARY_READABLE_SLOTS[i]!;
  if (slot.kind !== book.kind) {
    throw new Error(
      `Library: '${book.id}' is a ${book.kind} book, but readable slot ${i + 1} (${slot.bookcase}, shelf ${slot.shelf}, ${slot.along} m along) ` +
        `is for a ${slot.kind} book — the slots are paired with BOOKS by index, the picture books' first and then the big readers' shelf`,
    );
  }
}

export const SHELF_BOOKS: readonly ShelfBook[] = BOOKS.map((book, i) => ({ book, slot: LIBRARY_READABLE_SLOTS[i]! }));

/**
 * **The slots still waiting for their books** — the big readers' shelf's, until
 * the chapter books land. Empty once `BOOKS` and `LIBRARY_READABLE_SLOTS` are
 * the same length; never a picture book's slot (the twelve are shipped).
 */
export const WAITING_SLOTS: readonly ReadableSlot[] = LIBRARY_READABLE_SLOTS.slice(BOOKS.length);
if (WAITING_SLOTS.some((slot) => slot.kind !== 'chapter')) {
  throw new Error(
    `Library: a picture book's slot has no book — slot(s) ${WAITING_SLOTS.filter((slot) => slot.kind !== 'chapter')
      .map((slot) => slot.index + 1)
      .join(', ')} wait, and only the big readers' shelf may wait for its chapter books`,
  );
}

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
