# HANDOFF — Library v2, book engineer b: chapter books 4–6 (words and pictures)

Branch `feat/library-v2-books-b`, worktree `.claude/worktrees/library-v2-books-b`, cut from
`feat/library-v2-books` @ 3188e56d (the chapter books' engineering base: item 7, the story-props
kit, the file layout). Engineer, Claude Opus 5.5, 23 Oct 2026. Book engineer a does places 1–3 on
its own branch in parallel; this branch touches only places 4–6.

The task: put chapter books 4–6 into the game — `giantFootprints` (The Giant Footprints),
`biscuitStorm` (Biscuit and the Storm), `catchThatChicken` (Catch That Chicken!) — words verbatim
from `docs/library-build/chapter-books/final.json` (`books[3]`–`books[5]`), a picture for every page
composed from the story-props kit and the game's own models (never a three.js primitive), then look
at every spread through the served reader in headless Chrome (1280×800 and 390×844), fix, and run
tsc, typecheck:test, check:brevity, check:served-book-reader with exit codes read.

## Status

- [x] worktree cut at 3188e56d, `pnpm install --frozen-lockfile` (pnpm 12.1.0, node 26.5.0), pushed
- [x] `.parks/` hydrated from `../library-v2-books/.parks` (seed 5, restart 1, digest d6721090fb3f1d3a);
      the tree's park hash at the base is `fb2690b5…`, the same as that worktree's, so no restamp was
      needed for the base. **Every book edit moves the hash**: run
      `.claude/library-build-scratch/books-v2/b/restamp.sh` after every src edit, before any
      World-building check or a dev-server page load.
- [ ] `chapterBooks/giantFootprints.ts`
- [ ] `chapterBooks/biscuitStorm.ts`
- [ ] `chapterBooks/catchThatChicken.ts`
- [ ] index.ts: three imports and three entries under the `// Shelf places 4–6` comment lines only
- [ ] every spread looked at, 1280×800 and 390×844 (screenshots in
      `.claude/library-build-scratch/books-v2/b/`)
- [ ] tsc, typecheck:test, check:brevity, check:served-book-reader — exit codes read

## Decisions (with reasons) — Jim is away; each is also for the PR body

(none yet)

## Word changes (typos fixed or pages trimmed for check:brevity)

(none yet)

## For the join

(none yet)

## Questions for Jim

(none yet)
