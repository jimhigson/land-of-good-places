# HANDOFF — library books (#717, part 3 of epic #714)

Branch `feat/library-books-717`, worktree `.claude/worktrees/library-books`.
Node 26 via `fnm exec --using=26 -- <cmd>` (agent shells have no fnm hook).
Dev server used for the finishing pass: port 5763, `vite --host 127.0.0.1 --port 5763 --strictPort`
(kill by the PID listening on 5763 — `lsof -nP -iTCP:5763 -sTCP:LISTEN`).
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
- [ ] portrait one-page framing (design call — see PR notes)
- [ ] screenshots in scratchpad `books/` (three books x cover/mid-turn/spread x landscape/portrait)
- [ ] full `pnpm run check`, `test:procgen`, `build`

## PR notes for whoever raises it

Preview deep link: `/book?id=ripikaBalloon` (any of the twelve ids). Flag for Jim: the endpaper
order; books in the dex total before the shelves exist; the portrait framing.
