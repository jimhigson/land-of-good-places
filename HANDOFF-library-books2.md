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

- [ ] 1. book kind (`picture` | `chapter`), one file per chapter book + one index, BOOKS = picture then chapter
- [ ] 2. the reader's chapter page + check-book-reader clauses (both orientations), red proved
- [ ] 3. check:brevity chapter shape (20-40 words, sentences <= 120, titles <= 24), leak proved red
- [ ] 4. six big-reader LIBRARY_READABLE_SLOTS, stands are keep-outs, check:library green
- [ ] 5. Big reader secret (one owner of the rule) + vitest + red; picture-book prize unchanged
- [ ] 6. the story-time predicate
- [ ] final runs: tsc, typecheck:test, check:brevity, check:library, check:served-book-reader, vitests

## Parks, locally

`.parks` was copied from `.claude/worktrees/library-714/.parks` (source hash `d283ffaa…`, seed 5
restart 1, digest 9acd3a626f55d35c), which is this branch's hash at its base. Closure files this
track touches: `src/world/library/layout.ts`, `src/state/secrets.ts` (and the new
`src/world/library/bookKinds.ts`). `books.ts`, the chapter books, the reader, `readBooks.ts`,
`CuteODex.ts` and every check script are **outside** the park source closure today (measured
with `parkSourceClosure`), so editing them needs no park.

## Decisions (with reasons)

(filled in as they are made)

## Red transcripts (with the geometry or input each was proved against)

(filled in as they are proved)

## For the join

(filled in as found)
