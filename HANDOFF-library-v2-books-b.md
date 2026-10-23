# HANDOFF — Library v2, book engineer b: chapter books 4–6 (words and pictures)

Branch `feat/library-v2-books-b`, worktree `.claude/worktrees/library-v2-books-b`, cut from
`feat/library-v2-books` @ 3188e56d (the chapter books' engineering base: item 7, the story-props
kit, the file layout). Engineer, Claude Opus 5.5, 23 Oct 2026. Book engineer a did places 1–3 on
`feat/library-v2-books-a` in parallel; this branch touches only places 4–6 (plus one check line, below).

The task: put chapter books 4–6 into the game — `giantFootprints` (The Giant Footprints),
`biscuitStorm` (Biscuit and the Storm), `catchThatChicken` (Catch That Chicken!) — words verbatim
from `docs/library-build/chapter-books/final.json` (`books[3]`–`books[5]`), a picture for every page
composed from the story-props kit and the game's own models (never a three.js primitive), then look
at every spread through the served reader in headless Chrome (1280×800 and 390×844), fix, and run
tsc, typecheck:test, check:brevity, check:served-book-reader with exit codes read.

## Status — done

- [x] worktree cut at 3188e56d, `pnpm install --frozen-lockfile` (pnpm 12.1.0, node 26.5.0), pushed
- [x] `.parks/` hydrated from `../library-v2-books/.parks` (seed 5, restart 1, digest d6721090fb3f1d3a).
      **Every book edit moves the park hash** (the books are in the parks' source closure): run
      `.claude/library-build-scratch/books-v2/b/restamp.sh` after EVERY src edit, before any
      World-building check or page load. A stale manifest makes the dev server start a 10+ minute
      seed-5 solve; it happened twice here (the scratch harness timed out at 240 s), and each time I
      killed only my own server's `build-parks` child, by PID, after checking its parent was my vite.
- [x] `src/world/library/chapterBooks/giantFootprints.ts`, `biscuitStorm.ts`, `catchThatChicken.ts`
- [x] `chapterBooks/index.ts`: three imports and three list entries, each under its
      `// Shelf places 4–6` comment line and nowhere else. `git merge-tree` of this branch with
      `origin/feat/library-v2-books-a` (68b593f2): clean (exit 0), the index lists all six in shelf
      order, the imports likewise.
- [x] words verbatim: `verbatim.mts` (scratch) compares every id, title and page with final.json
      character for character: `VERBATIM: every id, title and page matches final.json`. Its CONTROL
      (one `inside out` → `inside-out` in the expected text) goes red with `biscuitStorm p7: differs at
      char 115` and exit 1.
- [x] every picture looked at in the served reader (contact sheets, every spread at 1280×800, every
      page at 390×844), fixed over four rounds; final screenshots in
      `.claude/library-build-scratch/books-v2/b/final/`
- [x] `scripts/check-book-reader.mts`: section 8's `LAST` is the last **picture** book. This is
      cherry-picked from book engineer a's d0f3f282 (identical change, `-x`), because the first
      served run here went red on exactly that (see the red transcripts)
- [x] final runs at the final source (below), every exit code read

## Final runs (source at 182c29f7; park hash 3f3a66d8…, seed 5 restart 1 hydrated)

| check | exit | what it said |
|---|---|---|
| `pnpm exec tsc --noEmit` | 0 | 0 errors |
| `pnpm run typecheck:test` | 0 | 0 errors |
| `pnpm run check:brevity` | 0 | `the library's books — 12 picture books, 3 chapter books (30 chapter pages)`; `BREVITY RULE: 393 pieces of copy are short enough; 6 still carry a recorded exception`; 10 CONTROLs ok |
| `SERVED_CHECKS_PORT=6482 pnpm run check:served-book-reader` | 0 | `check:book-reader passed`, 1930 ok, 0 FAIL. `giantFootprints every picture drew its models — 11 pictures, the thinnest covering 54.0%`; biscuitStorm 51.0 %; catchThatChicken 18.0 %. Each of the three `opens without linking a shader program — 0 program link(s)`. `chapter pages — 3 real chapter book(s) measured, 92 worded chapter face(s) held to their boxes`. `every picture model is drawn … all 63`. Section 8: `goodnightPark completes the dex … showing []`. The harness stopped its server by PID 50926; port free after |
| `pnpm run check:library` (not required; run because the books now stand on the shelf) | 0 | `101 ✓`, 0 ✗, `All clauses passed.`; READABLE: `6 big readers' slots for the 3 chapter books`, `3 slot(s) WAIT for their books … slot 16, 17, 18 (west-4)`, `15 books (BOOKS.length), 18 slots, 15 zones pressed through a stub opener` |
| `pnpm exec vitest run test/library test/store` | 0 | `Test Files 9 passed (9)`, `Tests 62 passed (62)` |

In the served run, chapter pages on the phone held upright keep a picture of at least `73% of full
size`; on the laptop they are 100 %. Section 8 shows no celebration over the open book, then the dex
prize, then the library prize, one at a time. A phone held on its side shows the "Turn your phone
upright to read!" card for all three books, as for the fixture (allowed and announced on stderr). The
run before it (at 0d37d16b, which differs only in Trilla's moods, a texture swap) gave the same
figures: exit 0, 1930 ok.

## Word changes (typos fixed or pages trimmed for check:brevity)

**None.** All thirty pages and three titles are final.json's, verbatim. I measured before writing
anything: every page is 29–35 words, the longest sentence is 115 characters (Storm p7), and the titles
are 19–21 characters. All of that is inside check:brevity's chapter shape (20–40 words, at most 120
characters a sentence, at most 24 a title), which then passed on the real pages.

## Looking (headless Chrome, Jim's installed Chrome, throwaway profile; my own dev server on 6481)

Scratch instruments in `.claude/library-build-scratch/books-v2/b/`:
- `looks.mjs` writes a contact sheet of every picture straight off the painted page canvases, every
  page canvas at full size, every spread at 1280×800, and every page at 390×844, one page at a time.
- `try.mjs` renders candidate compositions as a scratch book through `bookReader.openLibraryBook`, so
  a picture can be tried without editing the repo.

Rounds:
- `looks-1`: the first drafts.
- `try-1` … `try-24`: candidate compositions.
- `looks-2` and `looks-3`: after the recomposition, every spread and every portrait page.
- `looks-4`: after the second fixes.
- `final/`: 3 contact sheets, 18 spreads and 36 portrait pages.

Every one of the 36 faces fits at both sizes (`pagesFit` true on every spread and every portrait
page).

What the looks found, and what I did about each:

- **Characters too small in the frame.** The camera frames the whole cast, so one far prop shrinks
  everyone. I tightened every page's cast, and scaled far scenery down rather than pushing it back
  (the fountain statue, trees, the cat bus).
- **Grandpa Tock** read as a small green rock. He is drawn big now (1.5–1.8; he is the giant) and
  face-on (`turn` −6), so his face shows. His `blink` and `neutral` faces read as asleep and drowsy.
- **The petal on his nose** was a sliver while it lay on top of his head. It now stands across the
  front of his head (size 6, turned 84°), where the camera sees it.
- **Tock on the cat bus's roof.** Measured: the roof tops out at 5.24 of the bus's metres
  (`cat-bus-roof` y 4.50–5.24), so at size 0.4 Tock rides at 2.1.
- **Biscuit "from under a bench".** The bench (size 3) is now big enough that he sits wholly under
  its seat. The kit's seat underside is 0.246 of the bench's size; Biscuit sitting is 0.98 of his own
  height, drawn at 0.72. No ears come through the plank.
- **The race cart page.** Cart, Tock and duck bar are doubled together, because the bar hangs at the
  race's own clearance for its cart's scale. They are turned 55° so they fill the page.
- **The burp's rainbow** first arched over Nimbus's face. It now arches away from her side.
- **The last picnic's statue** read as a grey RiPika among the picnickers, so I dropped it from p10.
  p1 and p3 keep the fountain, where the words put Biscuit in it.
- **Chicken-looter in the cloud.** His head is inside the faceless `fluffyCloud`, and his feathery
  bottom and his string hang out of it.
- **The hoard on the hotel roof.** One helper places every shiny thing against the nest, so the nest
  (drawn at 2) and its spoons, keyrings, disco ball and biscuit scale together.
- **Trilla has no face** unless she is `surprised`: see Decision 3.

## Decisions (with reasons) — Jim is away; each is also for the PR body

1. **Covers.** The Giant Footprints is `leafBlue` (the Tortoise Garden's green), Biscuit and the Storm
   is `grownUpCoat` (a rain-cloud blue), and Catch That Chicken! is `trampolinePad` (an evening
   violet). One palette key each; the bookmark in the Cute-o-dex takes the same colour.
2. **Grandpa Tock is drawn big** (1.5–1.8, beside friends at 1). He is the giant the footprints
   belong to, and the Reptile House tortoise at park size is a small rock beside RiPika.
3. **Trilla wears `surprised` on every page of Catch That Chicken!, for now.**
   - Measured in the served reader. `try-19` shows five moods side by side at turns 0, 35 and 70, and
     `try-20` shows her from a steeper angle. The puff's tummy patch covers her face from the picture
     camera: `happy`, `sad` and `blink` draw no eye at all, and `neutral` draws two faint lines. Only
     `surprised` (and `frown`) show her eyes over the patch.
   - The geometry says why (`art/models/pets.ts`). Her eyes are painted at about the ball's equator,
     and the tummy patch spans y −0.68 R to +0.38 R and protrudes to about 1.1 R. So the eyes lie
     inside the patch's volume and are hidden from every angle.
   - The picture book *Trilla Goes Up High* draws her faceless the same way.
   - My task says to fix faceless characters, and `pets.ts` is not this branch's to touch. So the
     nearest honest picture is the one mood that shows her eyes.
   - When the puff model is fixed, the editor's moods go back (For the join).
   - *For one commit (0d37d16b) I had followed book engineer a's choice instead: the editor's moods,
     faceless. The final look showed a Trilla with no face on six pages, and I reverted it (182c29f7).*
     Book engineer a's *The Loudest Shush* keeps the editor's moods, so the shelf disagrees (For the join).
4. **Mrs Crumpet's pile on Storm p4** is the picture books' pile: three closed books at size 3, mint,
   lilac and pink from the bottom, with the kitten asleep on top. That is what final.json asks for
   ("drawn exactly as in The Loudest Shush"). It is worth one look against book engineer a's *Shush*
   at the join.
5. **Nimbus fed is `blossomWhite`** (Storm p9, p10), per the base's Decision 5.
6. **The counts are the story's**: nine jam tarts (Storm p1, a 3 × 3 tray), the kit's sixteen-sandwich
   tower, and the heap with Nimbus's forty-one exactly.
7. **The check fix is taken from book engineer a as-is** (`git cherry-pick -x d0f3f282`), not
   rewritten. The two branches then carry the identical hunk and merge clean (proved with
   `git merge-tree`).

## Red transcripts (with the input each was proved against)

- **check:book-reader section 8 measured the wrong book once chapter books stood on the shelf.**
  This was found red, not planted.
  - Input: the source at cf5df436 (this branch's three books, and the check as the base left it:
    `LAST = BOOKS[BOOKS.length - 1]`). That makes BOOKS 12 picture books then 3 chapter books, so
    `LAST` = `catchThatChicken`. Seed 5, port 6482.
  - Command: `SERVED_CHECKS_PORT=6482 pnpm run check:served-book-reader` → **exit 1**,
    `check:book-reader FAILED — 3 problem(s)`:
    ```
    FAIL no celebration bursts out over the open book — on the last page of catchThatChicken (spread 5 of 6): showing ["You read every picture book!"]
    FAIL closing the book lets the Cute-o-dex celebration out, on its own — showing ["You found every cute thing!","You read every picture book!"]
    - threw — page.click: Timeout 30000ms exceeded. … locator resolved to 2 elements
    ```
  - Why: the section files every dex entry but `LAST`. With a chapter book last, every picture book
    was filed first, so the library's prize was already up before any book opened.
  - The fix (d0f3f282, cherry-picked as baeb3299) makes `LAST` the last picture book. Then **exit 0**,
    `goodnightPark completes the dex … showing []`, and the two prizes come one at a time.
  - Book engineer a found and fixed the same thing independently. Log:
    `.claude/library-build-scratch/books-v2/b/served-1.log`.
- **The verbatim instrument** (scratch) goes red on one changed hyphen in the expected text:
  `biscuitStorm p7: differs at char 115: got " out, but on they went…" want "-out, but on they went…"`,
  exit 1. Unmutated: exit 0.
- **check:brevity holds the real chapter pages, not only its fixtures.**
  - Input: the source at 182c29f7. *The Giant Footprints* p1 had ` And then they went on and on and on.`
    appended, which takes it from 32 to 41 words. The manifest was restamped to the mutated tree
    (1044c6a9…) and back afterwards.
  - Command: `pnpm run check:brevity` → **exit 1**: `bookPage:giantFootprints#1 chap. 41w 5 CHAPTER`,
    `BREVITY RULE (GAME_DESIGN.md): 1 problem across 393 pieces of copy.`, `41 words; a chapter page is
    20-40`.
  - Reverted with `git checkout`: exit 0, `393 pieces of copy are short enough`. Log:
    `red-brevity-real.log`.

## For the join

1. **Trilla's face is under her tummy patch** (Decision 3). The fix is in `art/models/pets.ts`
   `createPuffCreature` (lift the eye row, or shrink or lower the patch). That is a park model and a
   visible change, so Jim judges it. When it lands:
   - restore the editor's moods in `catchThatChicken.ts`: `happy` on pages 4, 5, 8, 9 and 10, `sad`
     on page 7 (pages 1–3 and 6 are `surprised` in final.json already);
   - look again at *Trilla Goes Up High*, *RiPika's Balloon* p4–5 and book engineer a's
     *The Loudest Shush*. Shush keeps the editor's moods today, so it is faceless until then, and the
     shelf disagrees with this book until the model is fixed.
2. When all six are in, two changes in `check-library.mts`: READABLE's
   `CHAPTER_BOOKS.length <= chapter slots` becomes `===`, and the "slot(s) WAIT for their books"
   note goes (base handoff). On this branch alone the three books stand on the big readers' slots
   13–15; after the join they stand on 16–18.
3. Mrs Crumpet's pile (Decision 4), against *The Loudest Shush*.
4. `scripts/check-book-reader.mts` carries the same section-8 hunk as branch a (cherry-picked), so
   the join sees it once.

## Questions for Jim

- Trilla has no face in the book pictures (her tummy patch covers it; Decision 3). Should the puff
  pet's face move up, so she can smile in the books and in the park?
