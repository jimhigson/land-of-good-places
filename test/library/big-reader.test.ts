import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gameStore, SECRETS } from '../../src/state/index.ts';
import { BOOKS, CHAPTER_BOOKS, PICTURE_BOOKS, type LibraryBook } from '../../src/world/library/books.ts';
import {
  BIG_READER_SECRET_ID,
  bigReaderEarned,
  everyPictureBookRead,
  isBookRead,
  markBookRead,
} from '../../src/world/library/readBooks.ts';

/**
 * **Big reader: the card for reading every chapter book, from one owner.**
 *
 * Track D of the Library (#714) adds chapter books for an advanced six-year-old
 * (Jim, 14 Oct 2026: *"A 6 year old advanced reader needs a bit more"*), and a
 * Cute-o-dex secret, `secret.bigReader`, for reading every one. The rule has one
 * owner — `world/library/readBooks.ts`'s `markBookRead`, the only road a book
 * is read by — and these cases drive it through the **real** store and the real
 * `discoverSecret`, with three chapter books that live here and nowhere else:
 * the real shelf list is swapped for them by `vi.mock`, because the game ships
 * no placeholder book while the real ones are being written.
 *
 * What a child must never see: the card before the last chapter book (case 1),
 * the card for picture books (case 2), the card twice or never (cases 3, 4),
 * and the picture books' own prize moved by any of it (case 5).
 */

const { FIXTURES } = vi.hoisted(() => {
  const page = (text: string) => ({ text, picture: { cast: [{ model: 'ripika' as const }], sky: 'skyDayBottom' as const } });
  const book = (id: string, title: string) => ({
    id,
    kind: 'chapter' as const,
    title,
    cover: 'markerSky' as const,
    titlePicture: { cast: [{ model: 'biscuit' as const }], sky: 'skyDayBottom' as const },
    pages: Array.from({ length: 8 }, (_, index) =>
      page(`Page ${index + 1} of a fixture chapter book that lives in this test and nowhere else, with enough words to be a real page.`),
    ),
  });
  return { FIXTURES: [book('fixtureChapterOne', 'Fixture One'), book('fixtureChapterTwo', 'Fixture Two'), book('fixtureChapterThree', 'Fixture Three')] };
});

vi.mock('../../src/world/library/chapterBooks/index.ts', () => ({ CHAPTER_BOOKS: FIXTURES }));

beforeEach(() => {
  // A brand-new park: an empty collection, whatever the test before it read.
  gameStore.hydrate({ v: 2, at: 0, purchases: 0, game: {}, flags: {} });
});

/** The library's own copy of a fixture (the object `BOOKS` holds), as the reader hands it to `markBookRead`. */
function shelved(id: string): LibraryBook {
  const book = BOOKS.find((candidate) => candidate.id === id);
  if (!book) throw new Error(`no book '${id}' on the shelf`);
  return book;
}

function bigReader(): boolean {
  return gameStore.get().collection[BIG_READER_SECRET_ID]?.discovered === true;
}

describe('Big reader', () => {
  it('is a Cute-o-dex secret with the words the brief gave it', () => {
    const row = SECRETS.find((secret) => secret.id === BIG_READER_SECRET_ID);
    expect(row, `SECRETS has no '${BIG_READER_SECRET_ID}' row — discoverSecret would silently do nothing`).toBeDefined();
    expect(row).toEqual({ id: 'secret.bigReader', name: 'Big reader', icon: '📚', done: 'You read every chapter book!' });
  });

  it('reads three fixture chapter books after the twelve picture books (the mock took)', () => {
    expect(CHAPTER_BOOKS.map((book) => book.id)).toEqual(FIXTURES.map((book) => book.id));
    expect(BOOKS.map((book) => book.id)).toEqual([...PICTURE_BOOKS, ...FIXTURES].map((book) => book.id));
  });

  /** Case 1. */
  it('is not discovered until the last chapter book is read, in any order', () => {
    markBookRead(shelved('fixtureChapterThree'));
    markBookRead(shelved('fixtureChapterOne'));
    expect(isBookRead(gameStore.get(), 'fixtureChapterOne')).toBe(true);
    expect(bigReader(), 'Big reader with a chapter book still unread').toBe(false);
    markBookRead(shelved('fixtureChapterTwo'));
    expect(bigReader(), 'every chapter book read, and no Big reader card').toBe(true);
  });

  /** Case 2. */
  it('is never earned by picture books, however many', () => {
    for (const book of PICTURE_BOOKS) markBookRead(book);
    markBookRead(shelved('fixtureChapterOne'));
    expect(bigReader(), 'Big reader for picture books').toBe(false);
  });

  /** Case 3. */
  it('is filed once, and a re-read neither files it again nor takes it away', () => {
    for (const book of FIXTURES) markBookRead(shelved(book.id));
    const first = gameStore.get().collection[BIG_READER_SECRET_ID];
    markBookRead(shelved('fixtureChapterTwo'));
    expect(gameStore.get().collection[BIG_READER_SECRET_ID]).toEqual(first);
    expect(Object.keys(gameStore.get().collection).filter((id) => id === BIG_READER_SECRET_ID)).toHaveLength(1);
  });

  /** Case 4: the rule itself, and its vacuity guard. */
  it('is never earned off an empty shelf, and is earned off a full one', () => {
    expect(bigReaderEarned(gameStore.get(), []), 'an empty shelf earned the card').toBe(false);
    for (const book of FIXTURES) markBookRead(shelved(book.id));
    expect(bigReaderEarned(gameStore.get())).toBe(true);
    expect(bigReaderEarned(gameStore.get(), FIXTURES)).toBe(true);
  });

  it("files nothing for a book that is not the shelf's own (a check's fixture opened straight into the reader)", () => {
    const before = Object.keys(gameStore.get().collection);
    const stranger: LibraryBook = { ...shelved('fixtureChapterOne'), id: 'notOnAnyShelf' };
    markBookRead(stranger);
    const lookalike: LibraryBook = { ...shelved('fixtureChapterOne') };
    markBookRead(lookalike);
    expect(Object.keys(gameStore.get().collection), 'a book that is on no shelf left a bookmark').toEqual(before);
    expect(isBookRead(gameStore.get(), 'fixtureChapterOne')).toBe(false);
  });

  /** Case 5. */
  it("leaves the picture books' prize to the picture books", () => {
    for (const book of FIXTURES) markBookRead(shelved(book.id));
    expect(everyPictureBookRead(gameStore.get()), 'the picture-book prize for chapter books').toBe(false);
    for (const book of PICTURE_BOOKS.slice(0, -1)) markBookRead(book);
    expect(everyPictureBookRead(gameStore.get()), 'the picture-book prize with one picture book unread').toBe(false);
    markBookRead(PICTURE_BOOKS[PICTURE_BOOKS.length - 1]!);
    expect(everyPictureBookRead(gameStore.get())).toBe(true);
  });
});
