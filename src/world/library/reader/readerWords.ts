/**
 * **The reader's own words** — the only copy in the book reader that is not
 * in a book (`books.ts`, `chapterBooks/`). One table, so `check:brevity` can
 * walk it (`scripts/check-copy-brevity.mts`) like every other line a child
 * reads.
 *
 * - `theEnd` is painted on every book's last page.
 * - `turnUpright` is shown over a chapter book on a screen too short to lay
 *   its pages out legibly — a phone held on its side (`BookReader`'s "A
 *   chapter book on a short screen"). Held upright, the page fits.
 */
export const READER_WORDS = {
  theEnd: 'The End',
  turnUpright: 'Turn your phone upright to read!',
} as const;
