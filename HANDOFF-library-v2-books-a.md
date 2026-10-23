# HANDOFF — Library v2, book engineer a: chapter books 1–3, words and pictures

Branch `feat/library-v2-books-a`, worktree `.claude/worktrees/library-v2-books-a`, cut from
`feat/library-v2-books` @ 3188e56d (the chapter books' engineering base, item 7 done; its record is
`HANDOFF-library-v2-books.md`). Engineer, Claude Opus 5.5, 23 Oct 2026. Scratch (logs, screenshots,
scripts): `.claude/library-build-scratch/books-v2/a/`.

The task: put chapter books 1 to 3 into the game, words and pictures —
`sirHopsalot` (Duck, Sir Hopsalot!), `detectiveBiscuit` (Detective Biscuit), `loudestShush` (The Loudest
Shush), `final.json` `books[0..2]`. Book engineer b does places 4–6 in parallel on its own branch.
Touch only these three files and this block's lines in `chapterBooks/index.ts`.

## Status — done

- [x] worktree cut at 3188e56d, `pnpm install --frozen-lockfile` (pnpm 12.1.0, node 26.5.0), branch pushed
- [x] `.parks/` hydrated from `../library-v2-books/.parks` (seed 5, restart 1, digest d6721090fb3f1d3a),
      manifest restamped to this tree's hash after every src edit
      (`.claude/library-build-scratch/books-v2/a/restamp.sh`; last hash b0c42bf9…)
- [x] `sirHopsalot.ts`, `detectiveBiscuit.ts`, `loudestShush.ts`: every page's text and every title
      verbatim from `final.json` — `tools/verify-words.mjs` (scratch): `30 page(s) compared with
      final.json, 0 difference(s)`; ids and titles equal too. No typo fixed, no page trimmed.
- [x] `chapterBooks/index.ts`: three imports and three entries, under the "Shelf places 1–3" lines only
- [x] every spread looked at in headless Chrome (Jim's installed Chrome, `channel: 'chrome'`,
      throwaway profile) through the served reader's own `/book?id=` link, turning with real clicks
      on the reader's page buttons: landscape 1280×800 (6 spreads a book) and phone upright 390×844
      (12 pages a book), 54 screenshots a round, every one opened with Read. Round 1
      (`look1/`) found eight pictures to fix (below); round 2 (`look2/`) is the final state.
- [x] tsc, typecheck:test, check:brevity, check:served-book-reader — and check:library and the
      library/store vitests besides — all exit 0 (table below)
- [x] my own dev server (port 6517, pid 29372) stopped by PID; the served check's own server
      (port 6519) stopped by its harness, port free after

## Final runs (at d0f3f282's tree, park hash b0c42bf9…, seed 5 restart 1 hydrated; exit codes read)

| check | exit | what it said |
|---|---|---|
| `pnpm exec tsc --noEmit` | 0 | 0 errors |
| `pnpm run typecheck:test` | 0 | 0 errors |
| `pnpm run check:brevity` | 0 | `the library's books — 12 picture books, 3 chapter books (30 chapter pages)`; `BREVITY RULE: 393 pieces of copy are short enough; 6 still carry a recorded exception`; 10 CONTROLs ok |
| `SERVED_CHECKS_PORT=6519 pnpm run check:served-book-reader` | 0 | `check:book-reader passed`, 1930 ok, 0 FAIL; `3 real chapter book(s) measured, 92 worded chapter face(s) held to their boxes`; each book `0 program link(s)` and `11 pictures`, the thinnest 53.5% (Hopsalot), 52.2% (Detective), 51.6% (Shush); phone upright 375×667 smallest picture 63% / 73% / 63%; phone on its side: the turn-upright card, allowed; `every picture model is drawn … all 63` |
| `pnpm run check:library` | 0 | 101 ✓ 0 ✗, `All clauses passed.`; `6 big readers' slots for the 3 chapter books`; `3 slot(s) WAIT` (16–18) |
| `pnpm exec vitest run test/library test/store` | 0 | `Test Files 9 passed (9)`, `Tests 62 passed (62)` |

Logs: `tsc-1.log`, `typecheck-test-1.log`, `brevity-1.log`, `book-reader-2.log` (+ its shots in
`reader-shots-2/`), `library-1.log`, `vitest-1.log`.

## Red transcript (with the input it was proved against)

**check:served-book-reader section 8 with a chapter book last on the shelf** — found red, not
planted, then fixed (`d0f3f282`). Input: BOOKS = the twelve picture books then `sirHopsalot`,
`detectiveBiscuit`, `loudestShush` (tree b7542bb4, books identical to the final head), seed 5,
`SERVED_CHECKS_PORT=6519`; `LAST = BOOKS[BOOKS.length - 1]` = `loudestShush`. Exit 1, 1921 ok:
```
FAIL no celebration bursts out over the open book — on the last page of loudestShush (spread 5 of 6): showing ["You read every picture book!"]
FAIL closing the book lets the Cute-o-dex celebration out, on its own — showing ["You found every cute thing!","You read every picture book!"]
check:book-reader FAILED — 3 problem(s)
  - threw — page.click: Timeout 30000ms exceeded. (locator resolved to 2 elements: two prizes open)
```
Cause: section 8 files every Cute-o-dex entry but `LAST`, then reads `LAST` to complete the dex and
the picture books. With a chapter book last, all twelve picture books were among the entries filed
first, so the library's celebration came up during the filing, before any book opened — a check
assumption, not a game fault (in play, that prize waits for the book that completes the picture
books, and is closed before another book is opened). Fix: `LAST` is the last **picture** book. Same
input after the fix → exit 0, `the celebrations wait for the book (goodnightPark completes the dex)`,
`showing []`, then `["You found every cute thing!"]`, then `["You read every picture book!"]`. The
red above is the line restored: the clause is armed.

## Decisions (with reasons) — Jim is away; each is also for the PR body

1. **A pet riding a cart sits at `ON_SEAT` (0.96), a stage direction in the book**, not an import of
   `railRace/cart.ts`'s `SEAT_HEIGHT` (0.958). Tried first: importing it made loading the book file
   start a park acceptance run (cart.ts → route.ts → ringPath.ts reads `PARK_BOUNDARY`, which builds
   the seed's park at import; it was `accept-parks.mts 5`, killed by PID). A book is data that Node
   checks and vitest load, and must never build a park. Join item 2 offers the one-owner fix.
2. **Ducking pets sink into the tub** (the pets have no limbs, and their ears cannot fold): RiPika
   `DUCKED` = seat − 0.3 (her eyes just over the rim, ear tips 0.21 m under the bar); Sir Hopsalot
   ducking at last (p8) `BUNNY_DUCKED` = seat − 0.19 (his face sits lower; ear tips 0.10 m under);
   RiPika showing him how (p7) `HALF_DUCKED` = seat − 0.12. Seat − 0.5 was tried first and hid
   RiPika's face entirely on pages 7–8 (round 1).
3. **One duck bar gate spans both lanes**, at the race's own height (`DUCK_CLEARANCE_AT_PARK_SCALE`,
   2.703 m; the bar's underside 2.328 m). The editor's note asked for bars "brought down about 0.3 m"
   because a sitting pet would pass under a bar hung for the kid; measured, it does not — a pet on
   the seat reaches 0.96 + 1.46 = 2.42 m, into the bar — so the bar is the race's own, unmoved.
4. **Hopsalot p7 is seen from behind the carts**, racing towards the biggest bar with the finish
   rainbow beyond, the two turned to each other. From the front, a bar ahead of them stands between
   them and the reader and hides them (tried twice in round 1).
5. **Detective's pink wall is drawn at size 0.6 on every page** (`WALL`): 0.96 m tall, still taller
   than the 0.70 m mini, which the story needs; at full size its 5.1 m length shrinks the cast to a
   strip.
6. **Footprints on grass, at size 2.0–2.2**: the kit's `pancakeFootprint` is `pathSandDark`, which
   vanished on a sand path, and the picture camera looks from about 10° above level, so a flat print
   shows as a thin oval; bigger, on grass and in a short trail, they read as footprints.
7. **The library pages use the moonlight rig (`night`)**, as the editor asked: over the library's warm
   floor colours it renders plum and amber, dim and cosy, nothing black.
8. **Detective p1: you are turned 60°, not 150°.** The editor wanted her "looking back over her
   shoulder" at her bare bag; the kid model cannot turn its head, so at 150° only the back of her
   head shows. At 60° her face and her keyring-less bag both show.
9. **Shush p2: Trilla on the floor**, not mid-bounce at 0.4 m: in a hushed library with no speed lines
   a raised puff read as floating (round 1). Hopsalot p2's mid-hop bunny keeps its 0.3 m lift, because
   that page's speed lines make it a hop.
10. **The stars in the mini's hands are 0.9 (p6) and 0.7 (p7), held beside and in front of it**: at
    the editor's 1.2 the star covered the mini's face — its naughty eyebrows are the joke.
11. **Covers**: `markerSky` (Hopsalot), `wood` (Detective), `trampolinePad` (Shush) — none is a
    picture book's.
12. **Deviation from "touch only your books' files": `scripts/check-book-reader.mts`, one line and
    its comment** (`LAST` is the last picture book; red transcript above). The check went red because
    of these books, and a red check is fixed, not handed on; no file of mine could change which book
    ends `BOOKS`.

## Words changed (each typo fix or brevity trim, recorded)

None. All 30 pages and the three titles are `final.json`'s, byte for byte.

## For the join

1. **Trilla (the puff pet) has no face — in every picture and in the park.** Root cause, measured in
   `pets.ts` `createPuffCreature`: the ball is `blob(R, …, [1, 0.92, 1.04])`, so its front surface is
   at z = 1.04R, but the face patch (`sharedFacePatch`, `facePatchGeometry(radius * 1.012, …)`) is a
   sphere of 1.012R — 0.028R (5.6 mm) **inside the ball's own front surface**; and the tummy decal
   (blob 0.62R, scale [1, 0.85, 0.45], at y −0.15R, z 0.86R) covers the lower face too. Evidence
   (scratch `puff/`): `trilla-moods-front-10deg.png` — happy, neutral, sad and blink show no eyes;
   surprised and frown only their brows; `trilla-happy-10-30-50-70deg.png` — no eyes from any height.
   An in-page experiment (no file changed) scaling the face patch by the ball's own [1, 0.92, 1.04]
   and moving the tummy down to (0, −0.46R, 0.76R) at 0.85 scale shows every mood's face:
   `trilla-face-on-ball-proposal.png`. Faceless today: all eleven Shush pictures, and the picture
   books' Trilla pages (Trilla Goes Up High, RiPika's Balloon p4–5). The fix is `pets.ts`, outside
   this branch's files and visible in the park, so it is not made here; the book data already asks
   for the right moods, so the pictures gain their faces with no edit to them.
2. **One owner for "a pet on a cart's seat"**: a `cart` actor option in `pagePictures.ts` that seats a
   named pet at `SEAT_HEIGHT` (as `raceCart` seats the reader) would replace this book's `ON_SEAT`
   stage direction (Decision 1).
3. **`scripts/check-book-reader.mts` `LAST`** (Decision 12): book engineer b's branch will hit the same
   red (its `BOOKS` ends with `catchThatChicken`). At 5e7a0b3e b had not touched the check, and
   `git merge-tree --write-tree HEAD origin/feat/library-v2-books-b` is clean (exit 0). If b fixes it
   too, keep one copy of the line; with all six books merged, `LAST` stays `goodnightPark`.
4. When all six books are in (the base's item): `check-library.mts` READABLE
   `CHAPTER_BOOKS.length <= chapter slots` becomes `===`, and the "slot(s) WAIT" note goes.

## Questions for Jim

1. Trilla's face (join item 1): the fix changes how the puff pet looks in the park, so it is his
   call; until it lands, every picture of Trilla — and Trilla herself — is faceless.
