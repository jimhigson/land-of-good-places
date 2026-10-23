import type { LibraryBook } from '../books';

/**
 * **The chapter books, in shelf order** — the big readers' shelf (track D of
 * #714). Jim, 14 October 2026: *"add more that have ~30 words per page and
 * more involved story lines with jokes, adventure, adversaries, conflict, but
 * resolve well. A 6 year old advanced reader needs a bit more."*
 *
 * **This list is the one place two people adding chapter books meet.** Each
 * book lives in its own file beside this one, `chapterBooks/<id>.ts`, holding
 * its words and its picture compositions and nothing else:
 *
 * ```ts
 * import type { LibraryBook } from '../books';
 *
 * export const sirHopsalot: LibraryBook = {
 *   id: 'sirHopsalot',          // camelCase, unique; also the file's name and the export's
 *   kind: 'chapter',
 *   title: 'Duck, Sir Hopsalot!', // at most 24 characters
 *   cover: 'markerSky',          // a PaletteKey
 *   titlePicture: { cast: [ … ], sky: 'skyDayBottom', ground: 'grassLight' },
 *   pages: [                     // 8 to 10 (BOOK_PAGE_COUNTS.chapter)
 *     { text: '…20 to 40 words, every sentence at most 120 characters…', picture: { … } },
 *   ],
 * };
 * ```
 *
 * and joins the shelf by **one import and one entry here**, at its shelf
 * place. Order matters: book `j` stands on the big readers' slot `j`
 * (`layout.ts`'s `LIBRARY_READABLE_SLOTS`, after the twelve picture books'),
 * left to right. `books.ts` puts these after the picture books in `BOOKS` and
 * throws at load if one is not `kind: 'chapter'`.
 *
 * Empty until the real books land: the checks measure fixtures of their own
 * meanwhile, and the game ships no placeholder book.
 */
export const CHAPTER_BOOKS: readonly LibraryBook[] = [];
