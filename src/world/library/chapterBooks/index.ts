import type { LibraryBook } from '../books';
// Shelf places 1–3: one import a book, in shelf order, below this line.
import { sirHopsalot } from './sirHopsalot';
import { detectiveBiscuit } from './detectiveBiscuit';
import { loudestShush } from './loudestShush';
// Shelf places 4–6: one import a book, in shelf order, below this line.

/**
 * **The chapter books, in shelf order** — the big readers' shelf (track D of
 * #714). Jim, 14 October 2026: *"add more that have ~30 words per page and
 * more involved story lines with jokes, adventure, adversaries, conflict, but
 * resolve well. A 6 year old advanced reader needs a bit more."*
 *
 * **This list is the one place two people adding chapter books meet.** Each
 * book lives in its own file beside this one, `chapterBooks/<id>.ts`, holding
 * its words and its picture compositions and nothing else, and joins the
 * shelf by **one import and one entry here**, in its shelf place's block.
 * The six, in the editor's shelf order:
 *
 * | place | file (and its export)  | title                 | readable slot |
 * |-------|------------------------|-----------------------|---------------|
 * | 1     | `sirHopsalot.ts`       | Duck, Sir Hopsalot!   | 13            |
 * | 2     | `detectiveBiscuit.ts`  | Detective Biscuit     | 14            |
 * | 3     | `loudestShush.ts`      | The Loudest Shush     | 15            |
 * | 4     | `giantFootprints.ts`   | The Giant Footprints  | 16            |
 * | 5     | `biscuitStorm.ts`      | Biscuit and the Storm | 17            |
 * | 6     | `catchThatChicken.ts`  | Catch That Chicken!   | 18            |
 *
 * (Slots counted from 1, as `shelfBooks.ts` and `check:library` print them:
 * the twelve picture books stand in 1–12.)
 *
 * Places 1–3 and 4–6 each have their own block, in the imports above and in
 * the list below, so a branch adding the first three and a branch adding the
 * last three merge without a conflict (each inserts under its own block's
 * comment line). Order matters: book `j` stands on the big readers' slot `j`
 * (`layout.ts`'s `LIBRARY_READABLE_SLOTS`, after the twelve picture books'),
 * left to right, paired by index in `shelfBooks.ts`. `books.ts` puts these
 * after the picture books in `BOOKS` and throws at load for a book that is
 * not `kind: 'chapter'` or an id another book has.
 *
 * ```ts
 * import type { LibraryBook } from '../books';
 *
 * export const sirHopsalot: LibraryBook = {
 *   id: 'sirHopsalot',            // final.json's id; the file's name and the export's
 *   kind: 'chapter',
 *   title: 'Duck, Sir Hopsalot!', // final.json's, at most 24 characters
 *   cover: 'markerSky',           // a PaletteKey: the boards and the bookmark
 *   titlePicture: { cast: [ … ], sky: 'skyDayBottom', ground: 'grassLight' },
 *   pages: [                      // 8 to 10 (BOOK_PAGE_COUNTS.chapter)
 *     { text: '…final.json's text, verbatim…', picture: { cast: [ … ], … } },
 *   ],
 * };
 * ```
 *
 * **The words are final**: `docs/library-build/chapter-books/final.json`,
 * `books[0]` to `books[5]` in the order above — each page's `text` and the
 * book's `title` taken verbatim. `check:brevity` holds every page to 20–40
 * words with no sentence over 120 characters, and the title to 24.
 *
 * **The pictures name models, never shapes.** Each page's `picture.models`
 * lines in `final.json` name one of the park's models (`bunny`, `ripika`,
 * `cart`, …) or say "prop: …", and `books.ts`'s `PICTURE_MODELS` doc says
 * which model each "prop" line is: the Artist's story-props kit
 * (`reader/storyProps.ts`) or the library's own desk, lamp and bookcase. A
 * `PictureActor` takes `at`, `turn`, `size`, `mood`, `pose`, `variant`,
 * `colour` and `accent` exactly as the picture books use them, and for these
 * books also `grab` (the mini's arms), `keyring: false` (the reader's bag),
 * `jetpack: 'on' | 'off'` (the reader or a pet), `nibbled: true` (a flower)
 * and `lit: true` (the story wheel); the editor's confetti, raindrops and
 * drips are the 2D decor `confetti`, `rain` and `splash`. Nothing in a
 * picture may be a three.js primitive (Jim, 22 October 2026); a thing no
 * model covers is a request to the Artist, never a shape typed into a page.
 * `check:book-reader`'s model sheet (item 9b) draws every model there is.
 *
 * **These files are inside the prebuilt parks' source closure**
 * (`parkFacts.ts` → `World.ts` → `Library.ts` → `libraryLines.ts` →
 * `books.ts` → this index), so every edit to a book moves the park hash.
 *
 * **When the sixth book is in**: `check-library.mts`'s READABLE clause
 * `CHAPTER_BOOKS.length <= chapter slots` becomes `===` and its "slot(s) WAIT
 * for their books" note goes (`shelfBooks.ts`'s `WAITING_SLOTS` is empty
 * then) — never the other way round.
 *
 * Empty until the real books land: the checks measure fixtures of their own
 * meanwhile, and the game ships no placeholder book.
 */
export const CHAPTER_BOOKS: readonly LibraryBook[] = [
  // Shelf places 1–3, in shelf order, below this line.
  sirHopsalot,
  detectiveBiscuit,
  loudestShush,
  // Shelf places 4–6, in shelf order, below this line.
];
