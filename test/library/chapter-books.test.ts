import { beforeEach, describe, expect, it } from 'vitest';
import { PALETTE } from '../../src/core/palette.ts';
import { gameStore, SECRETS } from '../../src/state/index.ts';
import { BOOK_PAGE_COUNTS, BOOKS, CHAPTER_BOOKS, PICTURE_BOOKS, storyTimeMayRead, type LibraryBook } from '../../src/world/library/books.ts';
import { BIG_READER_SECRET_ID, markBookRead } from '../../src/world/library/readBooks.ts';

/**
 * **The library's two kinds of book, on the real shelf** (track D of #714).
 *
 * Jim, 14 Oct 2026, asking for chapter books: *"these are ok for a 3 year old,
 * so keep them"* — the twelve picture books stay exactly as they are (case 1).
 * Story time reads picture books only, through one predicate (case 2). On the
 * shelf as it really is — the six chapter books stand on it since the two
 * book branches were joined — reading every picture book never hands over
 * the Big reader card, nor does every chapter book but one; the last one does
 * (case 3), through the real wiring. Every book wears a cover colour of its
 * own, on the shelf and as its bookmark in the Cute-o-dex (case 4). And the
 * card is listed in the Cute-o-dex only while there is a chapter book to earn
 * it with (case 5, browser QA round 1) — on this shelf, it is.
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

  /** Case 5 (browser QA round 1, 23 Oct 2026). */
  it('lists Big reader in the Cute-o-dex only while there is a chapter book to earn it with', () => {
    // A secret that can never be earned sits at "???" for good, and holds the dex under its own total.
    const listed = SECRETS.some((secret) => secret.id === BIG_READER_SECRET_ID);
    expect(listed, `Big reader listed: ${listed}, with ${CHAPTER_BOOKS.length} chapter book(s) on the shelf`).toBe(CHAPTER_BOOKS.length > 0);
  });

  /** Case 3. */
  it('hands over Big reader off the real shelf only when its last chapter book is read', () => {
    const bigReader = (): boolean => gameStore.get().collection[BIG_READER_SECRET_ID]?.discovered ?? false;
    const last = CHAPTER_BOOKS.at(-1);
    expect(last, 'the real shelf holds no chapter book, so this case would assert nothing').toBeDefined();
    for (const book of PICTURE_BOOKS) markBookRead(book);
    expect(bigReader(), 'Big reader for the picture books alone').toBe(false);
    for (const book of CHAPTER_BOOKS.slice(0, -1)) markBookRead(book);
    expect(bigReader(), `Big reader with '${last?.id}' still unread`).toBe(false);
    if (last) markBookRead(last);
    expect(bigReader(), 'every real chapter book read, and no Big reader').toBe(true);
  });

  /** Case 4. */
  it('gives every book a cover colour of its own, on the shelf and in the Cute-o-dex', () => {
    // By colour, not by palette key: two keys can name one colour
    // (`markerSky` and `ballPitD` are both #87c9ff).
    const byColour = new Map<number, string[]>();
    for (const book of BOOKS) byColour.set(PALETTE[book.cover], [...(byColour.get(PALETTE[book.cover]) ?? []), `${book.id} (${book.cover})`]);
    const shared = [...byColour.entries()]
      .filter(([, books]) => books.length > 1)
      .map(([colour, books]) => `#${colour.toString(16).padStart(6, '0')}: ${books.join(' and ')}`);
    expect(shared, `books sharing a cover colour, of the ${BOOKS.length} on the shelf`).toEqual([]);
  });
});
