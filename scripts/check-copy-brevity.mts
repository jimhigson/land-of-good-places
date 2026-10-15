/**
 * **Every line the game writes at a child must be short.**
 *
 * ```
 * npm run check:brevity            # or --verbose for the full table
 * ```
 *
 * GAME_DESIGN.md's BREVITY RULE, added 28 July 2026 after a photo of the real
 * phone showed the what's-new panel carrying roughly twice the text it should
 * ("this screen needs less text by about half, and clear guidelines to not
 * write this much"). The rule is absolute and it is arithmetic, which means it
 * can be measured:
 *
 *  - a **title** — a what's-new heading, a shop item's name, a sign's title —
 *    at most {@link TITLE_LIMIT} characters;
 *  - a **line** — a what's-new line, a shop blurb, a sign's subtitle — **one
 *    sentence**, at most {@link LINE_LIMIT} characters.
 *
 * And one written exception, Jim's own (14 October 2026: *"add more that have
 * ~30 words per page and more involved story lines … A 6 year old advanced
 * reader needs a bit more"*):
 *
 *  - a **chapter page** — a page of a chapter book (`LibraryBook.kind`
 *    `'chapter'`) — a paragraph of {@link CHAPTER_WORDS} words, each sentence
 *    at most {@link CHAPTER_SENTENCE_LIMIT} characters. **Keyed by the book's
 *    kind and nothing else**: a picture book's page is a `line` whatever it
 *    says, and the CONTROL below proves a two-sentence picture-book page still
 *    goes red, so the carve-out cannot leak into the little books.
 *
 * It is checked, and the check runs in `npm run build`, because this codebase
 * has been bitten four separate times by a rule that lived only in prose. Copy
 * is the easiest thing in a repo to grow by accident: nobody reviews a string
 * as closely as they review a function, and every individual sentence looks
 * reasonable on its own. Only the total is unreasonable, and only a machine
 * counts the total on every commit.
 *
 * ## What it covers, and what it cannot
 *
 * The three sources named in the rule that are *data* rather than prose woven
 * into a builder: `whatsnew.json`, the shop catalogue (`displayName`, `blurb`)
 * the anchor signs (`signTitle`, `signSubtitle`) and the library's picture
 * books (`world/library/books.ts`: every title and every page). And beside
 * them the Library's own words — the owl's, the story's, the dragon's, the
 * cat's and every chip (`world/library/libraryLines.ts`, each template held
 * to the rule with every book's title rendered in) — and the Cute-o-dex's
 * secrets (`state/secrets.ts`: each card's name and what it says once found).
 * Those are enumerated from the real modules the game imports, so a new shop
 * item, a new what's-new entry or a new line for the owl is covered the day
 * it is added, with no list to keep in step.
 *
 * Not covered: sign text written inline at a builder call site (`Entrance.ts`,
 * `FacePaintStall.ts`, the mini-game plots), and the shopkeepers' `SKINS`
 * table in `Shops.ts`, which is module-private. Every one of those is inside
 * the limits today; if a future one grows, moving it into a table this script
 * already walks is the fix, rather than teaching the script to read source.
 *
 * ## Why some copy fails and the build is still green
 *
 * Seven shop blurbs are two sentences where the second sentence is the joke —
 * "One scoop. It wobbles when you walk." is 36 characters and would be worse
 * as one clause. Rewriting them is a *voice* decision for the family, not an
 * engineer's, and the rule's own words are "never two sentences where one will
 * do", which is a judgement this script cannot make. So, exactly as
 * `check-asset-contract.mts` does with height drift, each is written down in
 * {@link KNOWN_LONG} with what it measured on the day the check landed, and
 * the rule is a **ratchet**: recorded copy may not get longer or gain another
 * sentence, and new copy gets no allowance at all.
 *
 * A ratchet only ratchets if it is tightened. An entry whose copy now passes
 * is a **failure** here, not a shrug — a stale allowance is an unguarded
 * string. Delete it when you shorten the line.
 */
import { readFileSync } from 'node:fs';
import '../scripts/headless-canvas.mjs';
import { SHOP_ITEMS, EGG_PRIZES } from '../src/world/building/shops/catalogue.ts';
import { ANCHORS } from '../src/world/anchors.ts';
import { EXHIBITS } from '../src/world/reptileHouse/exhibits.ts';
import { BOOKS, type LibraryBook } from '../src/world/library/books.ts';
import { libraryCopyForBrevity } from '../src/world/library/libraryLines.ts';
import { READER_WORDS } from '../src/world/library/reader/readerWords.ts';
import { SECRETS } from '../src/state/secrets.ts';

/**
 * The longest a title may be, in characters.
 *
 * Two lines of a `.shop-title` on a 390px phone, near enough — anything longer
 * wraps to three and starts pushing the thing it names off the screen.
 */
const TITLE_LIMIT = 24;

/** The longest a single line of copy may be, in characters. */
const LINE_LIMIT = 50;

/** How many sentences a line may be. The rule's answer is one. */
const SENTENCE_LIMIT = 1;

/** A chapter page's paragraph: about thirty words, never fewer than twenty or more than forty. */
const CHAPTER_WORDS = { min: 20, max: 40 } as const;

/** The longest one sentence of a chapter page may be, in characters. */
const CHAPTER_SENTENCE_LIMIT = 120;

/** Copy that was already over the line when this check landed. */
interface Recorded {
  /** Its length in characters on the day the check landed. */
  readonly length?: number;
  /** Its sentence count on the day the check landed. */
  readonly sentences?: number;
  /** What is actually going on. Every entry needs one. */
  readonly why: string;
}

/**
 * Copy the park was already carrying. **Recorded, not accepted.**
 *
 * Do not add to this table to make a build pass. Every entry here is a second
 * sentence carrying the joke in a blurb that is already comfortably inside the
 * character limit — the length rule is not bent anywhere in the park, and it
 * must not start being. If you shorten one of these, delete its line: an
 * allowance left behind guards nothing.
 */
const KNOWN_LONG: Readonly<Record<string, Recorded>> = {
  'blurb:balloon.corgi': {
    sentences: 2,
    why: '"Pink flying glasses. Hold on tight and float!" — 45 characters. The second sentence is the instruction, and a corgi in flying goggles needs one.',
  },
  'blurb:balloon.chicken': {
    sentences: 2,
    why: '"A white and red chicken. Watch your snacks!" — 43 characters. The second sentence is the joke.',
  },
  'blurb:ice.bubblegum': {
    sentences: 2,
    why: '"One scoop. It wobbles when you walk." — 36 characters, and the wobble is the whole point of the item.',
  },
  'blurb:ice.rainbowTriple': {
    sentences: 2,
    why: '"Three whole scoops. The famous one." — 35 characters.',
  },
  'blurb:pet.bunny': {
    sentences: 2,
    why: '"Hops. Will follow you about." — 28 characters, two sentences of three words.',
  },
  'blurb:egg.surprise': {
    sentences: 2,
    why: '"Nobody knows what is inside. Not even the shop." — 47 characters. The second sentence is the joke, and this one is quoted back at us by a six-year-old.',
  },
};

type Shape = 'title' | 'line' | 'chapterPage';

interface Copy {
  /** Stable key, and the {@link KNOWN_LONG} key: `<field>:<id>`. */
  readonly key: string;
  /** Where a reader should go to fix it. */
  readonly where: string;
  readonly shape: Shape;
  readonly text: string;
}

interface WhatsNewFile {
  readonly entries: readonly { id: number; title: string; line: string }[];
}

/**
 * Everything this script measures.
 *
 * Read from the same modules the game imports, never re-listed: the catalogue
 * is walked whole, so anything that goes on sale is covered the day it is
 * added.
 */
function collect(): Copy[] {
  const copy: Copy[] = [];

  const whatsnewPath = new URL('../whatsnew.json', import.meta.url);
  const whatsnew = JSON.parse(readFileSync(whatsnewPath, 'utf8')) as WhatsNewFile;
  for (const entry of whatsnew.entries) {
    copy.push({
      key: `whatsnew.title:${entry.id}`,
      where: 'whatsnew.json',
      shape: 'title',
      text: entry.title,
    });
    copy.push({
      key: `whatsnew.line:${entry.id}`,
      where: 'whatsnew.json',
      shape: 'line',
      text: entry.line,
    });
  }

  for (const item of [...SHOP_ITEMS, ...EGG_PRIZES]) {
    copy.push({
      key: `displayName:${item.id}`,
      where: 'src/world/building/shops/catalogue.ts',
      shape: 'title',
      text: item.displayName,
    });
    copy.push({
      key: `blurb:${item.id}`,
      where: 'src/world/building/shops/catalogue.ts',
      shape: 'line',
      text: item.blurb,
    });
  }

  // The Reptile House's nameplates and chips — fifteen exhibits, one table.
  for (const exhibit of EXHIBITS) {
    copy.push({
      key: `exhibitTitle:${exhibit.id}`,
      where: 'src/world/reptileHouse/exhibits.ts',
      shape: 'title',
      text: exhibit.title,
    });
    copy.push({
      key: `exhibitBlurb:${exhibit.id}`,
      where: 'src/world/reptileHouse/exhibits.ts',
      shape: 'line',
      text: exhibit.blurb,
    });
    copy.push({
      key: `exhibitChip:${exhibit.id}`,
      where: 'src/world/reptileHouse/exhibits.ts',
      shape: 'title',
      text: exhibit.chip,
    });
  }

  // The library's books (#717 and track D): every title and every page. A
  // picture book's page is the whole of what a child reads at once, so it is
  // a `line` — one sentence, at most fifty characters, the same as a shop
  // blurb; a chapter book's page is a `chapterPage` ({@link bookCopy}).
  for (const book of BOOKS) copy.push(...bookCopy(book));
  const chapterBooks = BOOKS.filter((book) => book.kind === 'chapter');
  process.stderr.write(
    `check:brevity: the library's books — ${BOOKS.length - chapterBooks.length} picture books, ` +
      `${chapterBooks.length} chapter books (${chapterBooks.reduce((pages, book) => pages + book.pages.length, 0)} chapter pages)` +
      (chapterBooks.length === 0 ? ' — no chapter book is on the shelf yet, so the chapter-page shape is held to its CONTROL fixtures only' : '') +
      '\n',
  );

  // The reader's own words: "The End" on every last page, and the card over a
  // chapter book on a screen too short for it.
  copy.push({ key: 'readerWords:theEnd', where: 'src/world/library/reader/readerWords.ts', shape: 'title', text: READER_WORDS.theEnd });
  copy.push({ key: 'readerWords:turnUpright', where: 'src/world/library/reader/readerWords.ts', shape: 'line', text: READER_WORDS.turnUpright });

  // The Library's own words (#718, #719): every line the owl, the story, the
  // dragon and the cat say, every template rendered with every book's title,
  // every chip, and the card's name — walked out of `libraryLines.ts`.
  const library = libraryCopyForBrevity();
  for (const entry of library) {
    copy.push({
      key: entry.key,
      where: entry.key.startsWith('libraryCard:') ? 'src/world/library/libraryCard.ts' : 'src/world/library/libraryLines.ts',
      shape: entry.shape,
      text: entry.text,
    });
  }
  // A template held to the rule must have met every title: one book whose
  // title was never rendered into a template is a book nobody measured.
  const unrendered = BOOKS.filter((book) => !library.some((entry) => entry.key.endsWith(`:${book.id}`)));
  if (library.length === 0 || unrendered.length > 0) {
    throw new Error(
      `check:brevity: libraryCopyForBrevity() measured ${library.length} pieces and rendered no template with ` +
        `${unrendered.map((book) => book.id).join(', ') || 'every title'} — the walk over libraryLines.ts is broken ` +
        '(or the Library has no templates any more, and this guard should go with them)',
    );
  }
  const rendered = library.filter((entry) => BOOKS.some((book) => entry.key.endsWith(`:${book.id}`))).length;
  process.stderr.write(
    `check:brevity: the Library — ${library.filter((entry) => entry.shape === 'line').length} lines ` +
      `(${rendered} of them templates rendered with each of the ${BOOKS.length} titles), ` +
      `${library.filter((entry) => entry.shape === 'title').length} titles (the chips and the card)\n`,
  );

  // The Cute-o-dex's secrets: a found card shows its name and what she did.
  for (const secret of SECRETS) {
    copy.push({ key: `secretName:${secret.id}`, where: 'src/state/secrets.ts', shape: 'title', text: secret.name });
    copy.push({ key: `secretDone:${secret.id}`, where: 'src/state/secrets.ts', shape: 'line', text: secret.done });
  }
  if (SECRETS.length === 0) throw new Error('check:brevity: SECRETS is empty — the secrets loop measured nothing');
  process.stderr.write(`check:brevity: the secrets — ${SECRETS.length} names and ${SECRETS.length} lines\n`);

  for (const anchor of ANCHORS) {
    copy.push({
      key: `signTitle:${anchor.id}`,
      where: 'src/world/anchors.ts',
      shape: 'title',
      text: anchor.signTitle,
    });
    copy.push({
      key: `signSubtitle:${anchor.id}`,
      where: 'src/world/anchors.ts',
      shape: 'line',
      text: anchor.signSubtitle,
    });
  }

  return copy;
}

/**
 * **A book's copy, and the shape each piece is held to** — the title a
 * `title`; every page a `line` for a picture book and a `chapterPage` for a
 * chapter book. The page's shape is chosen by `book.kind` and by nothing
 * else (not its id, not its length, not a list of names), which is what keeps
 * the chapter books' allowance out of the little books — proved by the
 * CONTROL below, which runs a picture-book fixture through this very function.
 */
function bookCopy(book: LibraryBook): Copy[] {
  const where = book.kind === 'chapter' ? `src/world/library/chapterBooks/${book.id}.ts` : 'src/world/library/books.ts';
  return [
    { key: `bookTitle:${book.id}`, where, shape: 'title', text: book.title },
    ...book.pages.map(
      (page, index): Copy => ({
        key: `bookPage:${book.id}#${index + 1}`,
        where,
        shape: book.kind === 'chapter' ? 'chapterPage' : 'line',
        text: page.text,
      }),
    ),
  ];
}

/**
 * Length in characters as a reader counts them.
 *
 * Spread, not `.length`: an emoji is one thing on the screen and several UTF-16
 * code units, and `"🛍️".length` is 3. Counting a shopping bag as three
 * characters would spend an eighth of a title's budget on one glyph.
 */
function characters(text: string): number {
  return [...text].length;
}

/**
 * How many sentences the line is.
 *
 * Terminal punctuation followed by a space or the end of the string, so "Not
 * even me!" is one, "One scoop. It wobbles." is two, and a full stop inside
 * something like "3.5" is not a sentence break. An em dash or a comma is not a
 * sentence break either, which is the point — the rule is about how many
 * complete thoughts a child has to hold, not about punctuation.
 */
function sentences(text: string): number {
  return sentenceTexts(text).length;
}

/** The sentences themselves, split exactly as {@link sentences} counts them. */
function sentenceTexts(text: string): string[] {
  return text
    .split(/[.!?…]+(?=\s|$)/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Words as a reader counts them: runs of characters between spaces. */
function words(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * Everything wrong with one piece of copy, ignoring `KNOWN_LONG` — the pure
 * half of {@link check}, which the CONTROL below also asks of its fixtures.
 */
function problemsOf(copy: Copy): string[] {
  const { shape, text } = copy;
  const problems: string[] = [];
  if (shape === 'chapterPage') {
    const count = words(text);
    if (count < CHAPTER_WORDS.min || count > CHAPTER_WORDS.max) {
      problems.push(`${count} words; a chapter page is ${CHAPTER_WORDS.min}-${CHAPTER_WORDS.max}`);
    }
    for (const sentence of sentenceTexts(text)) {
      const length = characters(sentence);
      if (length > CHAPTER_SENTENCE_LIMIT) {
        problems.push(`a ${length}-character sentence, ${length - CHAPTER_SENTENCE_LIMIT} over the chapter page's ${CHAPTER_SENTENCE_LIMIT}: "${sentence.slice(0, 60)}…"`);
      }
    }
    return problems;
  }
  const limit = shape === 'title' ? TITLE_LIMIT : LINE_LIMIT;
  const length = characters(text);
  if (length > limit) problems.push(`${length} characters, ${length - limit} over the ${shape} limit of ${limit}`);
  if (shape === 'line' && sentences(text) > SENTENCE_LIMIT) problems.push(`${sentences(text)} sentences; a line is one`);
  return problems;
}

interface Failure {
  readonly key: string;
  readonly where: string;
  readonly problem: string;
}

const failures: Failure[] = [];
const rows: string[] = [];
let recordedStillLong = 0;
const seenRecords = new Set<string>();

function check(copy: Copy): void {
  const { key, where, shape, text } = copy;
  const recorded = KNOWN_LONG[key];
  if (recorded) seenRecords.add(key);

  if (shape === 'chapterPage') {
    // A chapter page has no recorded allowance to apply: it is held to its
    // own limits, whole.
    const problems = problemsOf(copy);
    for (const problem of problems) failures.push({ key, where, problem });
    rows.push(
      [key.padEnd(38), 'chap.', String(words(text)).padStart(3) + 'w', String(sentences(text)).padStart(2), problems.length > 0 ? 'CHAPTER' : ''].join('  '),
    );
    return;
  }

  const limit = shape === 'title' ? TITLE_LIMIT : LINE_LIMIT;
  const length = characters(text);
  const count = shape === 'title' ? 1 : sentences(text);
  const flags: string[] = [];
  let recordApplied = false;

  if (length > limit) {
    if (recorded?.length !== undefined && length <= recorded.length) {
      flags.push('recorded');
      recordApplied = true;
    } else {
      flags.push('LENGTH');
      failures.push({
        key,
        where,
        problem:
          `${length} characters, ${length - limit} over the ${shape} limit of ${limit}` +
          (recorded?.length === undefined ? '' : ` — longer than the recorded ${recorded.length}`),
      });
    }
  }

  if (count > SENTENCE_LIMIT) {
    if (recorded?.sentences !== undefined && count <= recorded.sentences) {
      flags.push('recorded');
      recordApplied = true;
    } else {
      flags.push('SENTENCES');
      failures.push({
        key,
        where,
        problem:
          `${count} sentences; a line is one` +
          (recorded?.sentences === undefined ? '' : ` — more than the recorded ${recorded.sentences}`),
      });
    }
  }

  if (recordApplied) recordedStillLong += 1;

  rows.push(
    [
      key.padEnd(38),
      shape.padEnd(5),
      String(length).padStart(3),
      String(count).padStart(2),
      flags.join(' '),
    ].join('  '),
  );
}

// CONTROL — the instrument can say no, and the chapter books' allowance stays
// theirs. Fixtures that live here and nowhere in the game, run through the
// same `bookCopy` and `problemsOf` the real books go through.
{
  const picture = (id: string, pageText: string, title = 'A Fixture'): LibraryBook => ({
    id,
    kind: 'picture',
    title,
    cover: 'markerPink',
    titlePicture: { cast: [], sky: 'skyDayBottom' },
    pages: [{ text: pageText, picture: { cast: [], sky: 'skyDayBottom' } }],
  });
  const chapter = (id: string, pageText: string, title = 'A Fixture'): LibraryBook => ({ ...picture(id, pageText, title), kind: 'chapter' });
  // Thirty words in two sentences; the others are cut from it or added to it,
  // and every count is asserted below rather than trusted.
  const thirtyWords =
    'Biscuit packed a picnic for everybody in the park. Then the wind blew his hat away, so RiPika ran after it all the way to the fountain and back again.';
  const nineteenWords = 'Biscuit packed a picnic for everybody in the park. Then the wind blew his hat away, so RiPika ran.';
  const twentyWords = 'Biscuit packed a picnic for everybody in the park. Then the wind blew his hat away, so RiPika ran fast.';
  const fortyWords = `${thirtyWords} RiPika laughed until her ears flapped like two big flags.`;
  const fortyOneWords = `${thirtyWords} RiPika laughed and laughed until her ears flapped like two flags.`;
  /** One sentence of exactly `n` characters, ending on a letter. */
  const sentenceOf = (n: number): string => 'hopped '.repeat(40).slice(0, n);
  const withSentence = (n: number): string => `${sentenceOf(n)}. RiPika waved and waved at him.`;
  const sizes: [string, number, number][] = [
    ['thirtyWords', words(thirtyWords), 30],
    ['nineteenWords', words(nineteenWords), 19],
    ['twentyWords', words(twentyWords), 20],
    ['fortyWords', words(fortyWords), 40],
    ['fortyOneWords', words(fortyOneWords), 41],
    ['sentenceOf(120)', characters(sentenceOf(120)), 120],
    ['sentenceOf(121)', characters(sentenceOf(121)), 121],
  ];
  // `because`: the problem a red case must be red FOR — a fixture that goes
  // red for some other reason has not shown what it is here to show.
  const cases: { what: string; book: LibraryBook; pieces: 'title' | 'page'; because?: string }[] = [
    { what: 'a picture-book page with two sentences goes red (the carve-out does not leak)', book: picture('fixturePictureTwo', 'RiPika has a balloon. It floats away.'), pieces: 'page', because: 'sentences; a line is one' },
    { what: "a picture-book page of a chapter page's thirty words goes red", book: picture('fixturePictureLong', thirtyWords), pieces: 'page', because: 'over the line limit of 50' },
    { what: 'a chapter page of thirty words in two sentences passes', book: chapter('fixtureChapterGood', thirtyWords), pieces: 'page' },
    { what: 'a chapter page of exactly twenty words passes', book: chapter('fixtureChapterTwenty', twentyWords), pieces: 'page' },
    { what: 'a chapter page of exactly forty words passes', book: chapter('fixtureChapterForty', fortyWords), pieces: 'page' },
    { what: 'a chapter page of nineteen words goes red', book: chapter('fixtureChapterShort', nineteenWords), pieces: 'page', because: '19 words; a chapter page is' },
    { what: 'a chapter page of forty-one words goes red', book: chapter('fixtureChapterLong', fortyOneWords), pieces: 'page', because: '41 words; a chapter page is' },
    { what: `a chapter sentence of exactly ${CHAPTER_SENTENCE_LIMIT} characters passes`, book: chapter('fixtureChapterSentenceOk', withSentence(CHAPTER_SENTENCE_LIMIT)), pieces: 'page' },
    { what: `a chapter sentence of ${CHAPTER_SENTENCE_LIMIT + 1} characters goes red`, book: chapter('fixtureChapterSentence', withSentence(CHAPTER_SENTENCE_LIMIT + 1)), pieces: 'page', because: `a ${CHAPTER_SENTENCE_LIMIT + 1}-character sentence` },
    { what: 'a chapter book title over 24 characters goes red', book: chapter('fixtureChapterTitle', thirtyWords, 'The Very Long Fixture Book'), pieces: 'title', because: 'over the title limit of 24' },
  ];
  const controlFailures: string[] = [];
  for (const control of cases) {
    const [title, ...pages] = bookCopy(control.book);
    const pieces = control.pieces === 'title' ? [title!] : pages;
    const problems = pieces.flatMap((piece) => problemsOf(piece));
    const because = control.because;
    const right = because === undefined ? problems.length === 0 : problems.some((problem) => problem.includes(because));
    process.stderr.write(`check:brevity CONTROL ${right ? 'ok  ' : 'FAIL'} ${control.what}${problems.length > 0 ? ` — ${problems.join('; ')}` : ''}\n`);
    if (!right) controlFailures.push(because === undefined ? control.what : `${control.what} (wanted "${because}")`);
  }
  for (const [name, measured, meant] of sizes) {
    if (measured !== meant) controlFailures.push(`the fixture ${name} measures ${measured}, not the ${meant} it is meant to`);
  }
  for (const what of controlFailures) failures.push({ key: 'CONTROL', where: 'scripts/check-copy-brevity.mts', problem: `the instrument got its own fixture wrong: ${what}` });
}

const everything = collect();
for (const copy of everything) check(copy);

// A recorded entry whose copy now passes is a stale allowance — the ratchet
// stops guarding that string the moment its record is wider than the truth.
for (const key of Object.keys(KNOWN_LONG)) {
  if (!seenRecords.has(key)) {
    failures.push({
      key,
      where: 'scripts/check-copy-brevity.mts',
      problem: 'recorded in KNOWN_LONG but no such copy exists any more — delete the entry',
    });
  }
}
for (const [key, record] of Object.entries(KNOWN_LONG)) {
  const copy = everything.find((entry) => entry.key === key);
  if (!copy) continue;
  const length = characters(copy.text);
  const count = copy.shape === 'title' ? 1 : sentences(copy.text);
  const limit = copy.shape === 'title' ? TITLE_LIMIT : LINE_LIMIT;
  const stillLong = record.length !== undefined && length > limit;
  const stillWordy = record.sentences !== undefined && count > SENTENCE_LIMIT;
  if (!stillLong && !stillWordy) {
    failures.push({
      key,
      where: 'scripts/check-copy-brevity.mts',
      problem: 'now within the rule — delete its KNOWN_LONG entry so the ratchet keeps guarding it',
    });
  }
}

if (process.argv.includes('--verbose') || failures.length > 0) {
  console.log(['copy'.padEnd(38), 'shape', 'len', 'st', 'flags'].join('  '));
  for (const row of rows) console.log(row);
  console.log('');
}

if (failures.length > 0) {
  console.error(
    `\nBREVITY RULE (GAME_DESIGN.md): ${failures.length} problem${failures.length === 1 ? '' : 's'} ` +
      `across ${everything.length} pieces of copy.\n`,
  );
  for (const failure of failures) console.error(`  ${failure.key}  (${failure.where})\n    ${failure.problem}\n`);
  console.error(
    'A title is at most ' +
      `${TITLE_LIMIT} characters; a line is ONE sentence of at most ${LINE_LIMIT};\n` +
      `a chapter book's page is ${CHAPTER_WORDS.min}-${CHAPTER_WORDS.max} words, each sentence at most ${CHAPTER_SENTENCE_LIMIT} characters.\n` +
      'Say what the child can now do, never how it works. Cut the words rather\n' +
      'than growing the panel. Do not silence this by adding to KNOWN_LONG.\n',
  );
  process.exit(1);
}

const summary = `BREVITY RULE: ${everything.length} pieces of copy are short enough`;
if (recordedStillLong === 0) {
  console.log(`${summary}. ✓`);
} else {
  console.log(
    `${summary}; ${recordedStillLong} still carry a recorded exception. ` +
      'See KNOWN_LONG in scripts/check-copy-brevity.mts. ✓',
  );
}
