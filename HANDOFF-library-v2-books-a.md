# HANDOFF — Library v2, book engineer a: chapter books 1–3, words and pictures

Branch `feat/library-v2-books-a`, worktree `.claude/worktrees/library-v2-books-a`, cut from
`feat/library-v2-books` @ 3188e56d (the chapter books' engineering base, item 7 done; its record is
`HANDOFF-library-v2-books.md`). Engineer, Claude Opus 5.5, 23 Oct 2026. Scratch (logs, screenshots,
scripts): `.claude/library-build-scratch/books-v2/a/`.

The task: put chapter books 1 to 3 into the game, words and pictures —
`sirHopsalot` (Duck, Sir Hopsalot!), `detectiveBiscuit` (Detective Biscuit), `loudestShush` (The Loudest
Shush), `final.json` `books[0..2]`. Book engineer b does places 4–6 in parallel on its own branch.
Touch only these three files and this block's lines in `chapterBooks/index.ts`.

## Status

- [x] worktree cut at 3188e56d, `pnpm install --frozen-lockfile` (pnpm 12.1.0, node 26.5.0), branch pushed
- [x] `.parks/` hydrated from `../library-v2-books/.parks` (seed 5, restart 1, digest d6721090fb3f1d3a),
      manifest on this tree's hash fb2690b5… (same source as the base); restamp after every src edit:
      `.claude/library-build-scratch/books-v2/a/restamp.sh`
- [ ] `sirHopsalot.ts`
- [ ] `detectiveBiscuit.ts`
- [ ] `loudestShush.ts`
- [ ] every spread looked at, 1280×800 and 390×844, headless Chrome; pages fixed
- [ ] tsc, typecheck:test, check:brevity, check:served-book-reader — exit codes read

## Decisions (with reasons) — Jim is away; each is also for the PR body

(none yet)

## Words changed (each typo fix or brevity trim, recorded)

(none yet)

## For the join

(none yet)

## Questions for Jim

(none yet)
