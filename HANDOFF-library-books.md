# HANDOFF — library books (#717, part 3 of epic #714)

Branch `feat/library-books-717`, worktree `.claude/worktrees/library-books`.
Node 26 via `fnm exec --using=26 -- <cmd>` (agent shells have no fnm hook).
Dev server used for the finishing pass: port 5763, `vite --host 127.0.0.1 --port 5763 --strictPort`
(kill by the PID listening on 5763 — `lsof -nP -iTCP:5763 -sTCP:LISTEN`; none is running now).
Check against it: `CHECK_BOOK_READER_URL=http://127.0.0.1:5763 pnpm run check:book-reader`.

**Park re-solves.** `src/state/{types,save,flags}.ts`, `src/art/style/materials.ts`,
`src/ui/characterCreationPreview.ts`, `src/world/FacePaintStall.ts` and the new
`src/entities/kidDressing.ts` are in the park-source closure (`scripts/lib/park-source-hash.mjs`).
Any edit to a closure file makes the dev server re-solve seed 5 (~21 min, restart 3 accepted,
digest ea17dc22afe69179 — the park itself never changed). A build is thrown away if the source
changes while it runs. For local runs the proven seed-5 park was copied into the current hash's
`.parks/dev/<hash>/5/` (untracked); CI solves for real.

## What exists (all pushed)

- `src/world/library/books.ts` — twelve books, one table; `PICTURE_MODELS` (runtime list) incl.
  `raceCart` (reader riding a Rail Race cart, park scale) and the rider-only `duck` pose.
- `src/world/library/readBooks.ts` — `markBookRead`, `booksRead`.
- `src/world/library/reader/readerAssets.ts` — `createReaderCover` (primitive boards until the
  Artist's `library.reader.cover` glb lands on `origin/art/library-715`: swap inside the factory,
  measure dims off the glb with `visibleBounds`), `createStoryBook`, `createStoryDragon`.
  Moved here from `art/models/libraryAssets.ts`, which belongs to #716 (merge-tree is clean now).
- `pageCurl.ts` (tested), `pagePictures.ts` (pictures; `pictureWarmSteps`/`pinPrograms`),
  `pageFaces.ts` (faces; endpaper first when the count is odd), `BookReader.ts` (the mode).
- `src/entities/kidDressing.ts` — `dressKid` (face paint, hat, glasses, keyring), shared by the
  character creator preview and the books; `isFacePaintDesign` (the stall asks it too).
- `CuteODex.ts`: `dexEntries()` is the one owner of what counts towards 100%; Books section;
  `refresh()`; neither prize shows over an open book or alongside the other.
- `scripts/check-book-reader.mts` → `check:book-reader`, `check:served-book-reader` (shard 8).

## Decisions

- Faces: [endpaper | title] [p1 | p2] [p3 | p4] [p5 | The End] for odd counts (all twelve);
  even counts have no endpaper. Leaf j: front F[2j+1], back F[2j+2]. Flagged for Jim.
- `/book` calls `makeSessionUnsavable()`.
- Books count towards the Cute-o-dex total. Until the shelves PR (#714 part 4) the only way to
  read one is `/book` — under the 13 Oct single-PR ruling the Library ships as one PR, so this
  never reaches a child alone. If #717 is ever merged to main on its own, gate the total first.
- Page buttons are laid from the visible face's own mesh (`screenRect`), re-laid after every turn.
- Page turning: tap, swipe (tapGesture slop), stick/d-pad/arrows/A-D via `InputSystem.moveX` →
  `steer`, A/Space (tick) and E/Enter/X (InteractRouter claim) → `pressFocused`; PageUp/Down.
  `data-pad-focus` is a term of the shared HIGHLIGHT selector.
- Shader programs: `BookReader.warmStep` (book under its lamp + every picture model/variant under
  both rigs into a bound render target), run behind the bus ride after the park's warm-up
  (`main.ts`); `openBook` runs what is left. One material per program is pinned for good.
- Outline clones no longer inherit `lgpShared` (`materials.ts ownedClone`) — a game-wide leak of
  six outline hulls per `createKid`, found by the new GPU-count clause.
- **Portrait = one page at a time** (`framing: 'page'` when the canvas is taller than wide): the
  page fills 94% of a 375x667 screen, words 32 px (were 20), pictures full size. A tap pans to the
  facing page; on the right-hand page it turns the leaf and pans with it. The page is the forward
  button; the back button is a round arrow under the page's other corner. Landscape unchanged.
  A design call made for the six-year-old — flag it for Jim with the before/after screenshots.

## Found, not fixed (needs its own ticket)

- **Trilla (the puff pet) shows no face from the front.** `art/models/pets.ts`: the face patch is
  built at `radius * 1.012` (`sharedFace.ts`) but the ball is scaled `[1, 0.92, 1.04]`, so the
  ball's front bulges 4% past the patch and buries it — only the patch's upper corners poke out
  (a 'surprised' brow shows; 'happy'/'blink' eyes never do). Rendered at 10°, 24°, 45° and 63°
  above: faceless at all four (scratchpad `books/compose/steep-sheet.png`). The books draw the
  real model, so six pictures show a faceless Trilla; the park's own Trilla is very likely the
  same. `pets.ts` is in the park-source closure and the fix changes the park's look, so it is
  not done here. The puff's face is also a second mesh positioned by a formula — the exact
  disease `src/art/models/CLAUDE.md` warns about; the cure there is a baked face in the ball's UVs.

## Fixed outside the feature, because the gate was red

- **`check:served-deep-links` (shard 5) failed on this machine on `origin/main` too** (d2cdb1f2,
  run from a scratch worktree): `/reptile-house?at=-13,0&facing=90 (continueGame): asked to stand
  at hall (-13, 0) = world (587, -600), but the player is at (606.0, -584.2) — 24.7 m off`. The
  game is right; the assert raced it. On a returning save she is restored into the hall at the
  primer's arrival spot, so `playerIsInside` is true from the first frame while the link's own
  iris is still running (probed: first frame (606.0, -584.2) with `spaces.isChanging` true, half
  a second later (587.0, -600.0) with it false). `scripts/check-deep-links.mts` now waits for the
  change of space to finish (and insists `isChanging` is a real boolean). Green after; restoring
  the old wait → the same FAIL. Worth telling the Overseer: main's gate depends on autosave timing.

## Proof (red runs, laptop 1280x800, seed 5, ripikaBalloon unless named)

- placeButton: button 3 px narrow → `laptop next-page button covers its page — button
  [640,67–1188,756] page [640,67–1191,756]` FAIL (all three viewports).
- arrow `pointer-events: none` restored → outer-half taps `spread 0 → 0` FAIL.
- `fontPx: 0` for every face → `reports its words` FAIL per face and `the text floor measured
  something — 0 worded face(s) measured, the smallest Infinity CSS px` FAIL.
- dex guards removed → `C does not open the Cute-o-dex over the book — dex open=true` FAIL.
- prize gates removed → `no celebration bursts out over the open book — showing ["You found
  every cute thing!"]` and `... on its own — showing [both]` FAIL.
- no pinning → `opens without linking a shader program — 4..23 program link(s)` FAIL per book.
- hill not disposed → `opening and closing bookDragon leaves nothing on the GPU — geometries
  425 → 431` FAIL.
- steer never disarmed → `holding → turns exactly one page — spread 1 → 3` FAIL; ring CSS term
  removed → `the rainbow ring (its ::after) is not drawn` FAIL.
- swipe click guard removed → `a swipe leftwards turns exactly one page — spread 1 → 3` FAIL.

## Status / next

- [x] review findings: flat-ok, placeButton, arrows, prize order, C guard, hill + outline leak,
      cache clear + manifest row, bookmark CSS, stale comments, endpaper order, page texts, duck
      pose, reader look dressing, warm-up/pins, controller + swipe, textFloor, prev turn.
- [x] portrait one-page framing (red runs: pan broken → `the camera follows her` FAIL, page at
      [360–724] in a 375 px window; framing forced to spread → `frames one page at a time` FAIL)
- [x] screenshots: scratchpad `books/final/` (four books, landscape cover/mid-turn/spreads and
      portrait sequences with mid-move frames), `books/sheets/` (every face of all twelve books),
      Cute-o-dex Books section, both prizes. All looked at; fixes made for what looked wrong.
- [x] full gates, exit codes read from files: `pnpm run check` — shards 1-4 green at 89a0e12c,
      shard 5 red at check:served-deep-links (the race above), fixed in 9083ecd4 (that script
      only), then shards 5-8 green at 9083ecd4 (`check:book-reader passed`, `check:walking
      passed`, `check:deep-links passed`); check:brevity `283 pieces of copy are short enough`.
      `pnpm run test:procgen` — 45 files, 2134 tests passed, none skipped (58 min). `pnpm run
      build` — exit 0 (warns locally that no prebuilt parks ship; the deploy builds them).
- [ ] PR not raised here — notes below.
- [ ] not measured: the first open's frame time on a real GPU. The deterministic proxy is
      asserted instead (0 program links on every open after the warm-up; 4-23 a book without
      the pins); a `gpu:frame-time`-style capture around the first open after a bus ride is the
      remaining measurement.

## PR notes for whoever raises it

**Preview:** the PR's deploy preview + `/book?id=ripikaBalloon` (any of the twelve ids:
ripikaBalloon, biscuitBreakfast, trillaHigh, catBusDay, duckBars, bookDragon, foreverSlide,
fireflies, fountainWish, keychainStall, bigParade, goodnightPark). One sentence for Jim: *open the
link and tap the right-hand page — the paper curls over like a real page; on a phone held upright
it shows one big page at a time.*

**Flag for Jim (his yes/no):**
- Portrait shows one page at a time: words 20 px → 32 px, pictures ~140x115 → full width
  (before: scratchpad `books/qa1/ripikaBalloon-portrait-spread1.png`, the whole spread as a strip;
  after: `books/final/ripikaBalloon-375x667-*.png`).
- Every book opens on [endpaper | title] and ends on [page 5 | The End], like a printed book.
- The twelve bookmarks count towards the Cute-o-dex 100% from this PR; only `/book` opens a book
  until the shelves PR (#714 part 4).
- Trilla is faceless in six pictures — the pre-existing `pets.ts` defect above, for its own ticket.
- `check:deep-links` was fixed here (above): main's own run of it fails on this machine.
