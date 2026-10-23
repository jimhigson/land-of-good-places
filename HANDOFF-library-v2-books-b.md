# HANDOFF — Library v2, book engineer b: chapter books 4–6 (words and pictures)

Branch `feat/library-v2-books-b`, worktree `.claude/worktrees/library-v2-books-b`, cut from
`feat/library-v2-books` @ 3188e56d (the chapter books' engineering base: item 7, the story-props
kit, the file layout). Engineer, Claude Opus 5.5, 23 Oct 2026. Book engineer a does places 1–3 on
its own branch (`feat/library-v2-books-a`) in parallel; this branch touches only places 4–6.

The task: put chapter books 4–6 into the game — `giantFootprints` (The Giant Footprints),
`biscuitStorm` (Biscuit and the Storm), `catchThatChicken` (Catch That Chicken!) — words verbatim
from `docs/library-build/chapter-books/final.json` (`books[3]`–`books[5]`), a picture for every page
composed from the story-props kit and the game's own models (never a three.js primitive), then look
at every spread through the served reader in headless Chrome (1280×800 and 390×844), fix, and run
tsc, typecheck:test, check:brevity, check:served-book-reader with exit codes read.

## Status

- [x] worktree cut at 3188e56d, `pnpm install --frozen-lockfile` (pnpm 12.1.0, node 26.5.0), pushed
- [x] `.parks/` hydrated from `../library-v2-books/.parks` (seed 5, restart 1, digest d6721090fb3f1d3a).
      **Every book edit moves the park hash** (the books are in the parks' source closure): run
      `.claude/library-build-scratch/books-v2/b/restamp.sh` after EVERY src edit, before any
      World-building check or page load — a stale manifest makes the dev server start a 10+ minute
      seed-5 solve (it happened twice here: the scratch harness timed out at 240 s; I killed only my
      own server's `build-parks` child, by PID, checked against its parent pid).
- [x] `src/world/library/chapterBooks/giantFootprints.ts`, `biscuitStorm.ts`, `catchThatChicken.ts`
- [x] `chapterBooks/index.ts`: three imports and three list entries, each under its
      `// Shelf places 4–6` comment line and nowhere else
- [x] words verbatim — `verbatim.mts` (scratch) compares every id, title and page with final.json
      character for character: `VERBATIM: every id, title and page matches final.json`; its CONTROL
      (one `inside out` → `inside-out` in the expected text) goes red: `biscuitStorm p7: differs at
      char 115`, exit 1
- [x] every picture looked at, four rounds, in the served reader (see "Looking")
- [x] tsc 0, typecheck:test 0, check:brevity 0 (`12 picture books, 3 chapter books (30 chapter
      pages)`, `393 pieces of copy are short enough; 6 still carry a recorded exception`)
- [ ] check:served-book-reader (running)
- [ ] final screenshots (landscape and portrait) of the final pictures

## Word changes (typos fixed or pages trimmed for check:brevity)

**None.** All thirty pages and three titles are final.json's, verbatim. Measured before writing
anything: every page 29–35 words, the longest sentence 115 characters (Storm p7), titles 19–21
characters — all inside check:brevity's chapter shape (20–40 words, ≤ 120 a sentence, ≤ 24 a title),
which then passed on the real pages.

## Looking (headless Chrome, Jim's installed Chrome, throwaway profile; my own dev server on 6481)

Scratch instruments in `.claude/library-build-scratch/books-v2/b/`: `looks.mjs` (contact sheet of
every picture straight off the painted page canvases; every page canvas at full size; every spread at
1280×800; every page at 390×844 one page at a time) and `try.mjs` (renders candidate compositions
as a scratch book through `bookReader.openLibraryBook`, so a picture can be tried without editing the
repo). Rounds: `looks-1` (first drafts), `try-1`…`try-24` (candidates), `looks-2`/`looks-3` (after
the recomposition: all spreads and portrait pages), `looks-4` (after the second fixes).

All 36 faces of the three books fit at both sizes (`pagesFit` true on every spread and every
portrait page); every picture's coverage 12–69 %.

What the first look found and what was done about it:

- **Characters too small in the frame** (the camera frames the whole cast, so one far prop shrinks
  everyone): every page's cast tightened; far scenery (the fountain statue, trees, the cat bus)
  scaled down rather than pushed back.
- **Grandpa Tock** read as a small green rock: drawn big (1.5–1.8, he is the giant), face-on
  (`turn` −6), so his face shows; his `blink`/`neutral` faces read asleep / drowsy.
- **The petal on his nose** lying on top of his head was a sliver: stood across the front of his
  head (size 6, turned 84°), where the camera sees it.
- **The cat bus's roof**: measured, the roof tops out at 5.24 of the bus's metres (`cat-bus-roof`
  y 4.50–5.24), so Tock rides at 2.1 at size 0.4.
- **Biscuit "from under a bench"**: a bench big enough that he sits wholly under its seat (the kit's
  seat underside is 0.246 of the bench's size; Biscuit sitting is 0.98 of his) — no ears through
  the plank.
- **The race cart page**: cart, Tock and duck bar doubled together (the bar is hung at the race's
  own clearance for its cart's scale), turned 55° so they fill the page.
- **The burp's rainbow** first arched over Nimbus's face: now it arches away from her side.
- **The last picnic's statue** read as a grey RiPika among the picnickers: dropped from p10 (p1
  and p3 keep the fountain, where the words put Biscuit in it).
- **Chicken-looter in the cloud**: his head inside the faceless `fluffyCloud`, his feathery bottom
  and his string hanging out of it.
- **The hoard on the hotel roof**: one helper places every shiny thing against the nest, so the
  nest and its spoons, keyrings, disco ball and biscuit scale together (the nest drawn at 2).
- **Trilla's face** — see Decision 3; a model finding for the join.

## Decisions (with reasons) — Jim is away; each is also for the PR body

1. **Covers**: The Giant Footprints `leafBlue` (the Tortoise Garden's green), Biscuit and the Storm
   `grownUpCoat` (a rain-cloud blue), Catch That Chicken! `trampolinePad` (an evening violet). One
   palette key each; the bookmark in the Cute-o-dex takes the same colour.
2. **Grandpa Tock is drawn big** (1.5–1.8 beside friends at 1): he is the giant the footprints
   belong to, and the Reptile House tortoise at park size is a small rock beside RiPika.
3. **Trilla wears `surprised` on every page of Catch That Chicken!.** Measured in the served
   reader (`try-19`, five moods side by side at turns 0, 35 and 70; `try-20` from a steeper angle):
   the puff's tummy patch covers her face from the picture camera — `happy`, `sad` and `blink` draw
   no eye at all, `neutral` two faint lines, and only `surprised` (and `frown`) show the tops of
   her eyes over the patch. The geometry says why (`art/models/pets.ts`): her eyes are painted at
   the ball's equator (canvas eyeY 0.46 of a 1.9 rad window from 0.67 rad → about 0.03 R up, ±0.37 R
   across), and the tummy patch spans y −0.68 R…+0.38 R and protrudes to 1.14 R, so the eyes lie
   inside the patch's volume, hidden from every angle. The existing picture book *Trilla Goes Up
   High* draws her faceless the same way (`books/book-reader-shots-4/book-trillaHigh.png`). A Trilla
   with wide eyes beats one with no face, and wide eyes fit each of her beats (the gasp, singing bad
   news, the chase, the hideout, the hoard, "not the biscuit", the lights, the surprise egg).
4. **Mrs Crumpet's pile on Storm p4** is the picture books' pile: three closed books at size 3,
   mint, lilac and pink from the bottom, the kitten asleep on top — as final.json asks ("drawn
   exactly as in The Loudest Shush"). Book engineer a draws *Shush*; if its pile differs, the join
   should make one of them match the other.
5. **Nimbus fed is `blossomWhite`** (Storm p9, p10), per the base's Decision 5.
6. **The jam tarts are nine** (Storm p1), a 3 × 3 tray; the sandwich tower is the kit's sixteen, the
   heap Nimbus's forty-one, exactly.

## For the join

- **Trilla's face is under her tummy patch** (Decision 3) — `art/models/pets.ts`, a park model and
  a visible change, so not this branch's to touch. Probably true in the park too (the eyes are
  inside the patch's volume). Whoever owns the puff should move her eyes up (or shrink/lower the
  patch) and re-look at *Trilla Goes Up High* and *Catch That Chicken!*; then the Chicken pages can
  take `happy` where the story is happy (p4, p8, p9, p10).
- When all six are in: `check-library.mts` READABLE's `CHAPTER_BOOKS.length <= chapter slots` →
  `===`, and the "slot(s) WAIT for their books" note goes (base handoff). On this branch alone the
  three books stand on the big readers' slots 13–15; after the join they stand on 16–18.
- Mrs Crumpet's pile (Decision 4) against book engineer a's *The Loudest Shush*.

## Questions for Jim

- Trilla has no face in the book pictures (her tummy patch covers it; Decision 3). Should the puff
  pet's face move up so she can smile in the books?
