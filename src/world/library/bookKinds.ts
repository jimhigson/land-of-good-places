/**
 * **The two kinds of library book** — the one owner of the list, so the books
 * (`books.ts`) and the shelves they stand on (`layout.ts`'s readable slots)
 * name a kind from the same union and can never disagree about it.
 *
 * - `picture` — the twelve short picture books for the littlest readers
 *   (#717): one sentence and one big picture a page, 4–6 pages.
 * - `chapter` — the chapter books for an advanced six-year-old (Jim, 14 Oct
 *   2026: *"add more that have ~30 words per page and more involved story
 *   lines"*): a picture and a paragraph of about thirty words a page, 8–10
 *   pages, on the big readers' shelf.
 *
 * Its own tiny file so that `layout.ts` can name a slot's kind without
 * importing the books. (It was also meant to keep the books' words out of the
 * prebuilt parks' source closure; that no longer holds — the library's lines
 * and its shelf books import `books.ts` from inside the closure, through
 * `parkFacts.ts` → `World.ts` → `Library.ts`, so a story edit moves the park
 * hash like any other library edit.)
 */
export const BOOK_KINDS = ['picture', 'chapter'] as const;

/** A library book's kind — see {@link BOOK_KINDS}. */
export type BookKind = (typeof BOOK_KINDS)[number];
