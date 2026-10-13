# HANDOFF — library books (#717, part 3 of epic #714)

Branch `feat/library-books-717`, worktree `.claude/worktrees/library-books`.
Node 26 via `fnm exec --using=26 -- <cmd>` (agent shells have no fnm hook).

## Plan (in order)

1. `src/world/library/books.ts` — the twelve books, one table. Walked by `check:brevity`.
2. `CuteCategory 'book'` — a read book is a `CuteThing` (`book.<id>`) collected like a
   secret, so it rides the save's existing collection with no new save field.
   `saveFlags.bookPrizeSeen` for the one-time all-twelve prize.
3. `src/world/library/reader/` — `pageCurl.ts` (pure, inextensible tangent-angle curl),
   `pagePictures.ts` (render a picture spec to a WebGLRenderTarget, read back, cache),
   `pageFaces.ts` (one canvas per page face: paper + picture + sentence),
   `BookReader.ts` (the mode: pause, HUD hidden, vignette, book, DOM close/turn buttons).
4. `src/art/models/libraryAssets.ts` — `createReaderCover()` primitive boards until the
   Artist's `library.reader.cover` glb lands on `origin/art/library-715`.
5. Cute-o-dex Books section (bookmarks), book prize (DexPrize with copy), `/book?id=`.
6. `scripts/check-book-reader.mts` (`check:book-reader`, served via `with-dev-server`).

## Decisions

- Spread layout: faces F = [title, p1..pN, The End, (blank if odd)]. Spread s shows
  F[2s] | F[2s+1]. Leaf j has front F[2j+1], back F[2j+2]. Left base = F[0], right base = last.
- `/book` calls `makeSessionUnsavable()` — a debug link leaves no durable mark (a read
  bookmark is a grant).

## Status

- [ ] everything above
