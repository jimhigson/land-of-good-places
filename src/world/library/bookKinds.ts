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
 * Its own tiny file because `layout.ts` is inside the prebuilt parks' source
 * closure and `books.ts` is not: the layout importing the kind from here keeps
 * every book's words out of the closure, so editing a story never re-solves a
 * park.
 */
export const BOOK_KINDS = ['picture', 'chapter'] as const;

/** A library book's kind — see {@link BOOK_KINDS}. */
export type BookKind = (typeof BOOK_KINDS)[number];
