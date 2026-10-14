import { BOOKS } from './books';
import { LIBRARY_CARD } from './libraryCard';

/**
 * **Every word the Library says to her, in one table** (#718, #719) — the
 * owl's, the story's, the baby dragon's, the cat's, and every chip she
 * presses. Both parts of the build read their words from here and nowhere
 * else, so `check:brevity` can walk all of it ({@link libraryCopyForBrevity})
 * and a line can never be written twice, once short and once long.
 *
 * GAME_DESIGN.md's BREVITY RULE holds every entry: a line is **one sentence
 * of at most 50 characters**, a chip **at most 24**. A template is held to it
 * with **every** book's title rendered in, and each title it carries is
 * wrapped in “ ” — so a title's own "!" ("Duck, Duck, Duck!") is never read
 * as the end of a sentence: the brevity check ends a sentence only at a mark
 * followed by a space or the end of the line.
 *
 * `owl.cardCheerAt` is not words: it is which of the four card lines is the
 * hand-over (the flash, the chime and the sparkles fire on it), so it lives
 * beside the lines it counts.
 */
export const LIBRARY_LINES = {
  owl: {
    welcome: 'Come to my desk for your library card!',
    shush: 'Shhh!',
    card: [
      'Hello, little reader!',
      'Walk softly and treat the books kindly.',
      'Here is your very own library card!',
      'Every book here is yours to read.',
    ],
    cardCheerAt: 2,
    helloAgain: 'Hello again, little reader!',
    recommendLead: 'Looking for a story?',
    recommend: (title: string) => `Try “${title}” next!`,
    recommendGlow: 'It is glowing on its shelf!',
    allRead: ['You have read every book here!', 'Come back for story time!'],
    storyCall: 'Come and sit on the rug for story time!',
    storyBegin: (title: string) => `Today's story is “${title}”.`,
    storyEnd: ['The end!', 'Off you go, little bookworms!'],
  },
  dragon: {
    firstHello: 'Oh, a visitor for me!',
    hello: 'Hello again, friend!',
    hi: ['I love my books!', 'I keep books, not gold!', 'Do you like stories too?'],
  },
  cat: { purr: ['Prrrrr…', 'Mrrrp!'] },
} as const;

/** The words on every chip the Library offers her — each a title, at most 24 characters. */
export const LIBRARY_CHIPS = {
  getCard: 'Get a library card!',
  hello: 'Say hello!',
  read: 'Read it!',
  readGlowing: 'Read me!',
  sit: 'Sit down',
  getUp: 'Get up',
  pull: 'Pull the book!',
  sayHi: 'Say hi!',
  pet: 'Pet the cat!',
} as const;

/** One piece of the Library's copy, as `check:brevity` measures it. */
interface LibraryCopy {
  key: string;
  shape: 'title' | 'line';
  text: string;
}

/**
 * **All of the Library's copy, for `check:brevity`** — walked out of the
 * tables above, never re-listed, so a line added to them is measured the day
 * it is written:
 *
 * - every fixed line as a `line`: `libraryLine:owl.welcome`, and an entry of
 *   a list by its place in it, `libraryLine:owl.card#3`;
 * - every template **rendered with every book's title** (`BOOKS`), each a
 *   `line`: `libraryLine:owl.recommend:<bookId>` — every template here takes
 *   a book's title, so the longest title is in there somewhere;
 * - every chip as a `title`: `libraryChip:getCard`;
 * - the card's name, as the inventory shows it, as a `title`:
 *   `libraryCard:displayName` (`libraryCard.ts`).
 *
 * The story itself is the books' own pages, which the check already walks.
 * A number (`cardCheerAt`) is skipped; anything that is neither words, a
 * template, a list of words nor a table of them throws, so a new kind of
 * entry cannot slip past unmeasured.
 */
export function libraryCopyForBrevity(): LibraryCopy[] {
  const copy: LibraryCopy[] = [];
  const walk = (path: string, value: unknown): void => {
    if (typeof value === 'string') {
      copy.push({ key: `libraryLine:${path}`, shape: 'line', text: value });
    } else if (typeof value === 'number') {
      // An index into the lines beside it (`cardCheerAt`), not words.
    } else if (typeof value === 'function') {
      for (const book of BOOKS) {
        copy.push({ key: `libraryLine:${path}:${book.id}`, shape: 'line', text: (value as (title: string) => string)(book.title) });
      }
    } else if (Array.isArray(value)) {
      value.forEach((entry: unknown, index) => {
        if (typeof entry !== 'string') throw new Error(`libraryCopyForBrevity: ${path}#${index + 1} is not a line of words`);
        copy.push({ key: `libraryLine:${path}#${index + 1}`, shape: 'line', text: entry });
      });
    } else if (value !== null && typeof value === 'object') {
      for (const [name, entry] of Object.entries(value)) walk(path === '' ? name : `${path}.${name}`, entry);
    } else {
      throw new Error(`libraryCopyForBrevity: ${path} is neither words, a template, a list nor a table`);
    }
  };
  walk('', LIBRARY_LINES);
  for (const [name, text] of Object.entries(LIBRARY_CHIPS)) copy.push({ key: `libraryChip:${name}`, shape: 'title', text });
  copy.push({ key: 'libraryCard:displayName', shape: 'title', text: LIBRARY_CARD.displayName });
  return copy;
}
