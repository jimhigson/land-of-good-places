import { beforeEach, describe, expect, it } from 'vitest';
import { gameStore } from '../../src/state/index.ts';
import { BOOK_PAGE_COUNTS, BOOKS, CHAPTER_BOOKS, PICTURE_BOOKS, storyTimeMayRead, type LibraryBook } from '../../src/world/library/books.ts';
import { BIG_READER_SECRET_ID, markBookRead } from '../../src/world/library/readBooks.ts';

/**
 * **The library's two kinds of book, on the real shelf** (track D of #714).
 *
 * Jim, 14 Oct 2026, asking for chapter books: *"these are ok for a 3 year old,
 * so keep them"* — the twelve picture books stay exactly as they are (case 1).
 * Story time reads picture books only, through one predicate (case 2). And on
 * the shelf as it really is — no chapter book yet, because the game ships no
 * placeholder — reading every picture book must never hand over the Big
 * reader card (case 3): the vacuity guard, through the real wiring.
 * `big-reader.test.ts` drives the card with fixtures.
 */

beforeEach(() => {
  gameStore.hydrate({ v: 2, at: 0, purchases: 0, game: {}, flags: {} });
});

/**
 * A small stable hash (FNV-1a, 32-bit, as hex) of the picture books' words
 * and pictures — everything but the `kind` tag they gained with the chapter
 * books. Written out here so the test needs nothing of Node's.
 */
function pictureBooksDigest(books: readonly LibraryBook[]): string {
  const text = JSON.stringify(
    books.map((book) => {
      const { kind: _kind, ...rest } = book;
      return rest;
    }),
  );
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * The twelve as #717 wrote them, taken at 5d524193 (the foundation head) and
 * unchanged since. If the family changes a picture book on purpose, take the
 * new digest from this test's failure message and put it here, saying so.
 */
const PICTURE_BOOKS_DIGEST = '1f8eb01e';

describe("the library's books", () => {
  /** Case 1. */
  it('keeps the twelve picture books exactly as they were written', () => {
    expect(PICTURE_BOOKS).toHaveLength(12);
    expect(PICTURE_BOOKS.every((book) => book.kind === 'picture')).toBe(true);
    expect(pictureBooksDigest(PICTURE_BOOKS), 'a picture book\'s words or pictures changed').toBe(PICTURE_BOOKS_DIGEST);
  });

  it('shelves the picture books first, then the chapter books, each within its page count', () => {
    expect(BOOKS).toEqual([...PICTURE_BOOKS, ...CHAPTER_BOOKS]);
    for (const book of BOOKS) {
      const { min, max } = BOOK_PAGE_COUNTS[book.kind];
      expect(book.pages.length, `${book.id} (${book.kind}) has ${book.pages.length} pages`).toBeGreaterThanOrEqual(min);
      expect(book.pages.length, `${book.id} (${book.kind}) has ${book.pages.length} pages`).toBeLessThanOrEqual(max);
    }
  });

  /** Case 2. */
  it('lets story time read picture books, and never a chapter book', () => {
    expect(BOOKS.filter(storyTimeMayRead).map((book) => book.id)).toEqual(PICTURE_BOOKS.map((book) => book.id));
    const chapter: LibraryBook = { ...PICTURE_BOOKS[0]!, id: 'aChapterBook', kind: 'chapter' };
    expect(storyTimeMayRead(chapter), 'story time would read a chapter page aloud').toBe(false);
    for (const book of CHAPTER_BOOKS) expect(storyTimeMayRead(book), `${book.id}`).toBe(false);
  });

  /** Case 3. */
  it('never hands over Big reader off the real shelf while it holds no chapter book', () => {
    for (const book of PICTURE_BOOKS) markBookRead(book);
    if (CHAPTER_BOOKS.length === 0) {
      expect(gameStore.get().collection[BIG_READER_SECRET_ID]?.discovered ?? false, 'Big reader with no chapter book on the shelf').toBe(false);
    } else {
      for (const book of CHAPTER_BOOKS) markBookRead(book);
      expect(gameStore.get().collection[BIG_READER_SECRET_ID]?.discovered, 'every real chapter book read, and no Big reader').toBe(true);
    }
  });
});
