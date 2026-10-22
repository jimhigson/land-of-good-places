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
- [x] 2. the reader's chapter page + check-book-reader clauses (both orientations), red proved (f5ff7b1a, 6ba4e62a)
- [x] 3. check:brevity chapter shape (20-40 words, sentences <= 120, titles <= 24), leak proved red (36fbb978)
- [x] 4. six big-reader LIBRARY_READABLE_SLOTS, stands are keep-outs, check:library green (bb1fab30, 93c01cf5)
- [x] 5. Big reader secret (one owner of the rule) + vitest + red; picture-book prize unchanged (f5ff7b1a, a4af2310)
- [x] 6. the story-time predicate (`storyTimeMayRead`, 5a06ab85; vitest a4af2310)
- [ ] 7. the picture vocabulary the editor's six books name (see "The picture vocabulary" below)
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
10. **The reader's chapter page** (`pageFaces.ts` `chapterLayout`, numbers in `pageGeometry.ts`):
   the picture over a left-aligned paragraph. **Text size: the TEXT RULE's floor itself**, i.e.
   `minTextPx()` (1rem = clamp(20px, 0.62vw + 0.55vh + 8px, 38px)) turned into canvas pixels
   through the page's measured on-screen height, exactly as the picture books' floor is; a
   paragraph starts at 1.2x that floor (`CHAPTER_DESIGN_SCALE`) and comes down to it before the
   picture yields, down to 0.3 of full size (`CHAPTER_MIN_PICTURE_SCALE`). Why: the rule says
   nothing below the shared minimum, and the minimum is already "generously large" (20 CSS px on
   a phone); a paragraph at the picture books' 1.55x would cost three or four lines a page and
   the picture with them. Leading 1.2, the picture books' own (1.25 was tried and measured out).
   Measured in the real reader (Trebuchet bold here, 0.488 em a character), fixture pages of
   20-40 words: laptop 1280x800 floor 32 canvas px = 20.3 CSS px, every page at 32-38 px with a
   full-size picture; phone upright 375x667 floor 48 = 20 CSS px, pages at 48-52 px, pictures
   63-100%; 390x844 floor 45; tablet 1024x768 floor 40; phone on its side 812x375 floor 64:
   pages from 25 words on cannot hold a picture, and 40 words cannot fit at all.
11. **A phone held on its side shows a card**, "Turn your phone upright to read!" (📱, rotating;
   `readerWords.ts`, brevity-walked), over a dimmed chapter book whose pages do not all fit at
   the floor, and stops its pages turning; the next layout (turning the phone is a resize) takes
   it away. Per book, not per page (a card appearing mid-book would confuse). Why not reflow or
   split pages: forty words at the floor need more paper than a 320-CSS-px-tall page has even
   with no picture, so any layout there either breaks the TEXT RULE or hides words; turning the
   phone gives her the real page, picture and all. Visible: name it in the PR body, with the
   screenshot `chapter-checkChapterFixture-phone-landscape.png`.
12. **check:book-reader item 9** measures every worded face of every book it opens from outside
   the painter (words all there, lines re-measured within their box, block inside its box and
   clear of the picture, no ink pixels in the margins), and every chapter page at three
   viewports; the card is allowed only on the landscape phone. Its fixtures (a 20-40-word chapter
   book and a 152-word page) live in the check; `markBookRead` files nothing for them.
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

**check:book-reader item 9, the over-long page** (fixture page 9, 152 words, at the laptop
1280x800 and the phone 375x667, Trebuchet bold, seed 5), mutation
`CHECK_BOOK_READER_CHAPTER=overlong`, against a dev server at 6ba4e62a's source → exit 1:
```
FAIL laptop checkChapterFixture only a phone held on its side may be asked to turn — here every page must fit — legible in a landscape spread is the brief, and the reader asked her to turn the phone upright here
FAIL laptop checkChapterFixture face 10 (story page 9) the words stay inside their box — block [48,263–711,1184] in box [48,263–720,972], 24 line(s) of 38.4 px
FAIL laptop checkChapterFixture face 10 (story page 9) no ink in the margins — 1757 ink pixel(s), the first at (51, 976) below the words
FAIL phone-portrait checkChapterFixture only a phone held on its side may be asked to turn — here every page must fit — legible on a phone held upright is the brief, and the reader asked her to turn the phone upright here
FAIL phone-portrait checkChapterFixture face 10 (story page 9) the words stay inside their box — block [48,263–719,2394] in box [48,263–720,972], 37 line(s) of 57.6 px
FAIL phone-portrait checkChapterFixture face 10 (story page 9) no ink in the margins — 5249 ink pixel(s), the first at (51, 976) below the words
check:book-reader FAILED — 6 problem(s)
```
Unmutated → exit 0, `check:book-reader passed` (1045 ok lines, 0 FAIL).

**item 9, words under the floor** (by hand: `chapterLayout`'s floor `Math.ceil(minFontPx) - 8`) →
exit 1, 18 FAILs, e.g. `FAIL laptop checkChapterFixture face 1 (story) text size — 16.19 CSS px on
screen against the 20.336 px minimum (drawn at 24.0 canvas px)`. Reverted.

**item 9, lines wider than their box** (by hand: `chapterLayout`'s maxWidth + 80) → exit 1, 48
FAILs, e.g. `FAIL laptop checkChapterFixture face 1 (story page 1) every line fits across its box —
widest line 712.0 of 672.0 canvas px` and `no ink in the margins — 148 ink pixel(s), the first at
(732, 756) in the right margin`. Reverted.

**check:library, the big readers' stands are measured** (seed 5 restart 1 at source 6d758660,
check-side: a 0.5 m disc dropped on big reader 1's stand before the fill) → exit 1:
`✗ big reader 1's stand (west-4) at (-16.10, 5.50) is not reachable from the arrival`, `✗ big
reader 2's stand (west-4) at (-16.10, 4.90) …`, `✗ every keep-out is reachable: 68 of 70`.
Reverted → 70 of 70. And `LIBRARY_CHECK_REMOVE='bookcase west-4'` → exit 1, `✗ bookcase west-4: a
body's edge got 0.600 m into it (allowance 0.071)` (MARCHED; the wall case's middle is behind the
room wall, so REACHABILITY cannot see it — MARCHED does).

**vitest big-reader** (`pnpm exec vitest run test/library/big-reader.test.ts
test/library/chapter-books.test.ts`): `every` → `some` in `bigReaderEarned` → `Tests 2 failed | 10
passed (12)`: `Big reader with a chapter book still unread: expected true to be false` and `Big
reader for picture books: expected true to be false`. The award line removed from `markBookRead`
→ `Tests 2 failed | 10 passed (12)`: `every chapter book read, and no Big reader card: expected
false to be true`. A picture book's text changed (ripikaBalloon p2 "away" → "off") → `a picture
book's words or pictures changed: expected '89573c6b' to be '1f8eb01e'`. `storyTimeMayRead`
returning true → `story time would read a chapter page aloud: expected true to be false`. All
reverted → `Tests 12 passed (12)`.

## For the join

1. **Track A's `SHELF_BOOKS` length throw** needs `BOOKS.length === LIBRARY_READABLE_SLOTS.length`.
   On this branch it is 12 vs 18 until the six chapter books land (check:library says so on
   stderr every run). Merge track D into the integration only once all six are in.
2. **check-library's READABLE clause** was rewritten here (kind-wise, counted from BOOKS); track A
   extends READABLE too (Step 5): keep both, and every count from BOOKS.
3. **Story time (Step 9) must pick through `storyTimeMayRead`**: the plan's
   `recommended ?? ORDER[storiesTold % 12]` becomes "the recommended book if story time may read
   it, else the next of `ORDER.filter(storyTimeMayRead)`", modulo that list's length — the owl's
   recommendation ORDER is over all of BOOKS and may name a chapter book (fine for the glow).
4. **RECOMMEND (Step 6)**: "the other eleven read 0" is BOOKS.length - 1.
5. **Tap spacing (Step 10)**: 6 more Read zones on west-4, 0.6 m apart (same verb: warnings, not
   failures); the "15 new zones" count becomes Talk + BOOKS.length Read + 2 Sit.
6. **books.ts joins the parks' source closure** once `furnish.ts` imports `SHELF_BOOKS` (Step 5):
   every chapter-book edit re-solves parks from then on.
7. **check-book-reader.mts**: track A adds item 6 (a shelf chip opens its book); this branch adds
   item 9 and rewords 5 and 8. Expect a header conflict; keep both.
8. **Preview paths**: add the big readers' shelf, `/library?at=-16.1,4&facing=270` — "Walk to the
   end of the entrance hall: six chapter books lean out of the shelf under the lamp; press Read it!"
9. **Visible decisions for the PR body**: the library prize now says "every picture book"; a phone
   held on its side gets the turn-upright card for chapter books.
