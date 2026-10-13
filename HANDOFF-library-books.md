# HANDOFF — library books (#717, part 3 of epic #714)

Branch `feat/library-books-717`, worktree `.claude/worktrees/library-books`.
Node 26 via `fnm exec --using=26 -- <cmd>` (agent shells have no fnm hook).
My dev server: port 5471 (`vite --host 127.0.0.1 --port 5471 --strictPort`), kill by the
PID listening on 5471 (`lsof -nP -iTCP:5471 -sTCP:LISTEN`).

## What exists (all pushed)

- `src/world/library/books.ts` — the twelve books, one table; walked by `check:brevity`.
- `src/world/library/readBooks.ts` — `markBookRead` (a `book` CuteThing `book.<id>`), `booksRead`.
- `src/state/{types,save,flags}.ts` — `'book'` CuteCategory, `bookPrizeSeen` flag.
  (These three are in the park-source closure: editing them re-solves parks. Done once; leave them.)
- `src/art/models/libraryAssets.ts` — `createReaderCover` (primitive boards, until the
  Artist's `library.reader.cover` glb lands on `origin/art/library-715`; swap inside the
  factory and measure dims off the glb), `createStoryBook`, `createStoryDragon`.
- `src/world/library/reader/pageCurl.ts` — inextensible tangent-angle curl; tested in
  `test/library/pageCurl.test.ts` (proved red by CURL_BEND=2.6 + a 1% stretch: 4/4 fail).
- `pagePictures.ts` — picture spec → park models → WebGLRenderTarget → readback → sRGB canvas.
- `pageFaces.ts` — one canvas per face (paper + picture + sentence), text ≥ floor.
- `BookReader.ts` — the mode; `Game.bookReader`; `/book?id=` in `main.ts` (session unsavable).
- `CuteODex.ts` Books section (bookmarks reopen the book), `DexPrize` takes a `PrizeCopy`.
- `scripts/check-book-reader.mts` → `check:book-reader`, `check:served-book-reader` in shard 8.

## Decisions

- Faces F = [title, p1..pN, The End, (blank if odd)]; spread s = F[2s] | F[2s+1].
  Leaf j: front F[2j+1], back F[2j+2]. Left base F[0], right base F[last].
- `/book` calls `makeSessionUnsavable()` (a bookmark is a grant — the `?pets=` rule).
- Books count towards the Cute-o-dex total (consistent with every other section). Until the
  shelves PR lands, the only way to read one is `/book` — flag this in the PR for Jim.

## Status / next

- [ ] screenshots (park for seed 5 was still solving on my dev server — restart 3 is the
      accepted one, ~3 min per restart)
- [ ] `check:book-reader` run green + broken deliberately
- [ ] full `pnpm run check`, `test:procgen`, `build`; PR
