# HANDOFF — Library track D: the chapter books' engineering base

Branch `feat/library-714-books2`, worktree `.claude/worktrees/library-714-books2`, cut from the
foundation head `5d524193` (feat/library-714). Plan: `docs/library-build/PLAN-parts-4-5.md`;
the task text is `infraTask` in `docs/library-build/workflows/library-build.js`.

Jim, 14 Oct 2026: *"we also need some more grown-up books, these are ok for a 3 year old, so keep
them, but add more that have ~30 words per page and more involved story lines with jokes,
adventure, adversaries, conflict, but resolve well. A 6 year old advanced reader needs a bit
more."*

This branch builds everything the six chapter books need **except their words and pictures**
(a writing panel produces those; two book engineers then add three books each). It ships **no
placeholder book**: until the real ones land, the checks use fixtures that live in the checks.

## Status

- [x] 1. book kind (`picture` | `chapter`), one file per chapter book + one index, BOOKS = picture then chapter (5a06ab85)
- [ ] 2. the reader's chapter page + check-book-reader clauses (both orientations), red proved
- [x] 3. check:brevity chapter shape (20-40 words, sentences <= 120, titles <= 24), leak proved red (36fbb978)
- [ ] 4. six big-reader LIBRARY_READABLE_SLOTS, stands are keep-outs, check:library green
- [ ] 5. Big reader secret (one owner of the rule) + vitest + red; picture-book prize unchanged
- [x] 6. the story-time predicate (`storyTimeMayRead`, 5a06ab85; vitest pending)
- [ ] final runs: tsc, typecheck:test, check:brevity, check:library, check:served-book-reader, vitests

## Parks, locally

**Now:** `.parks` holds seed 5 for source `6d758660…` (built here: `LGP_SEEDS=5 LGP_RESTART_LANES=4
pnpm run build:parks`, 500 s, restart 1 accepted, digest 584c14bcf75d83f7). The base park
(d283ffaa…) is kept in `.claude/library-build-scratch/books2/parks-d283ffaa/`.

`.parks` was copied from `.claude/worktrees/library-714/.parks` (source hash `d283ffaa…`, seed 5
restart 1, digest 9acd3a626f55d35c), which is this branch's hash at its base. Closure files this
track touches: `src/world/library/layout.ts`, `src/state/secrets.ts` (and the new
`src/world/library/bookKinds.ts`). `books.ts`, the chapter books, the reader, `readBooks.ts`,
`CuteODex.ts` and every check script are **outside** the park source closure today (measured
with `parkSourceClosure`), so editing them needs no park.

## Decisions (with reasons)

1. **A `kind` on every book** (`'picture' | 'chapter'`, owned by `src/world/library/bookKinds.ts`).
   The twelve stay in `books.ts` as `PICTURE_BOOKS`, each gaining only `kind: 'picture'`: their
   text and pictures are byte-identical (JSON of the twelve, kind stripped, digest
   `221fd33b588486e1` at 5d524193 and after). Chapter books are one file each under
   `src/world/library/chapterBooks/<id>.ts`, listed in shelf order by
   `chapterBooks/index.ts` (`CHAPTER_BOOKS`, empty until the real books land); `BOOKS =
   [...PICTURE_BOOKS, ...CHAPTER_BOOKS]`, and `books.ts` throws at load for a book in the wrong
   list or a shared id. Two book engineers therefore meet only in the index's list.
2. **`bookKinds.ts` is its own tiny file** because `layout.ts` is inside the parks' source
   closure and `books.ts` is not (measured): the layout names a slot's kind from it, so the books'
   words never join the closure (a story edit never re-solves a park). Note: track A's Step 5 will
   pull `books.ts` into the closure anyway once `furnish.ts` imports `SHELF_BOOKS`.
3. **Page counts per kind**: `BOOK_PAGE_COUNTS` picture 4-6, chapter 8-10; `BOOK_MOST_PAGES` (10)
   sizes the reader's picture cache (title + 10).
4. **The big readers' shelf is `west-4`** (west wall, z 2..6, facing east), six slots zig-zagging
   shelf 1/0 at along -1.5, -0.9, -0.3, 0.3, 0.9, 1.5 (stands at x -16.1, z 5.5 … 2.5, facing 270),
   each with its own stand. Why there: the quiet end of the room (no other zone near), at the end
   of the entrance-hall aisle and under `sconce-west-2`'s pool; no child's route (Juno west-aisle-1,
   Lark north, Fenn east-aisle-2 + the east side) passes; 4 m south of the secret shelf `west-2`
   and the den gap (z -6..-2) with `west-3` between; far from the desk/owl (6, 5.3), the cat pile
   (9.6, 7.2) and every cushion. A wall case also never fades, so track A's shelf books there need
   no stack fader. Rejected: stack rows 1-2 (their south-face stands sit on Juno's and Fenn's
   circuits), north-4/5 (the story corner), north-7/8 (the story lamp and the east table block it),
   stack-3-2/3-5 (fine, but dimmer and nearer the desk traffic).
5. **Each slot names its kind** (`ReadableSlot.kind`), so a check holds every book to a slot of
   its own kind. `LIBRARY_READABLE_SLOTS` is 18 on this branch while `BOOKS` is 12 (no placeholder
   books): the intermediate state, announced on every check:library run. See "For the join".
6. **The library's prize stays the picture books'** (`everyPictureBookRead`): the celebration, its
   star in the Cute-o-dex heading and its parade. **Its words now say "picture book"** ("You read
   every picture book!"): with chapter books on the shelf, "every book" would be a fib a
   six-year-old catches. A visible change: name it in the PR body.
7. **Big reader has one owner**: `readBooks.ts`'s `markBookRead` (the only road a book is read)
   asks `bigReaderEarned` (every chapter book read; never true of an empty shelf) after filing the
   bookmark, on every chapter book's finish, re-reads included (idempotent). `markBookRead` now
   files only the library's own book objects, so a check's fixture can never leave a bookmark.
   `BIG_READER_SECRET_ID` lives in `readBooks.ts` beside the rule; the row is in `secrets.ts`;
   the vitest proves they agree end to end (a mismatch would make `discoverSecret` a silent no-op).
8. **Story time's predicate**: `storyTimeMayRead(book)` in `books.ts` — picture books only.
9. **check:brevity's chapter page** is its own shape (`chapterPage`: 20-40 words, each sentence
   <= 120 characters; the title is still a 24-character title), chosen in `bookCopy` by
   `book.kind` alone. Same sentence splitter as a line's (terminal punctuation then a space), so a
   quoted "DUCK!" called RiPika stays one sentence.

## Red transcripts (with the geometry or input each was proved against)

**check:brevity, the carve-out does not leak (real data).** Mutation: `ripikaBalloon` page 1
`'RiPika has a spotty balloon.'` → `'RiPika has a balloon. It is spotty.'` (books.ts), at 36fbb978's
script. `pnpm run check:brevity` → exit 1:
```
bookPage:ripikaBalloon#1                line    35   2  SENTENCES
BREVITY RULE (GAME_DESIGN.md): 1 problem across 354 pieces of copy.
  bookPage:ripikaBalloon#1  (src/world/library/books.ts)
    2 sentences; a line is one
```
Reverted → exit 0, `BREVITY RULE: 354 pieces of copy are short enough`.

**check:brevity, the keying.** Mutation: in `bookCopy`, every page's shape `'chapterPage'` (the
carve-out keyed by nothing). → exit 1, both leak CONTROLs red for the right reason:
```
check:brevity CONTROL FAIL a picture-book page with two sentences goes red (the carve-out does not leak) — 7 words; a chapter page is 20-40
check:brevity CONTROL FAIL a picture-book page of a chapter page's thirty words goes red
BREVITY RULE (GAME_DESIGN.md): 62 problems across 354 pieces of copy.
    the instrument got its own fixture wrong: a picture-book page with two sentences goes red (the carve-out does not leak) (wanted "sentences; a line is one")
    the instrument got its own fixture wrong: a picture-book page of a chapter page's thirty words goes red (wanted "over the line limit of 50")
```
(Before the controls named their reason, the first one passed under this mutation for the wrong
reason, "7 words"; only the thirty-word one caught it. Each red control now names the problem it
must be red for.) Reverted → exit 0.

## For the join

(filled in as found)
