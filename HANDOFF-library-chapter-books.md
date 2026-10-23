# HANDOFF — the six chapter books, as-is, stacked on part 4 (#733)

Engineer, Claude Opus 5.5, 23 Oct 2026. Branch `feat/library-chapter-books` (worktree
`.claude/worktrees/library-chapter-books`), cut from `origin/feat/library-v2` @ 9a269a31.
PR head `feat/library-chapter-books-pr` (fast-forward pushes only), base `feat/library-v2-pr` (#733's head).
Scratch: `.claude/library-build-scratch/chapter-books/` (logs `runs/<tag>/<check>.log`, each ending `exit=N`).

**The ask (Jim, 23 Oct):** "let's just merge those books as-is now". As-is: the books exactly as
`origin/feat/library-v2-books` @ 9325e0f7 has them — **no face fixes** (Trilla's hidden eyes in *The
Loudest Shush* and *Catch That Chicken!*, Grandpa Tock's buried face on *The Giant Footprints* p6–p8
are known and accepted), **nothing new**. Only what the merge needs to be correct and green.

Never push to `feat/library-v2` or `feat/library-v2-pr` (the part-4 pipeline owns them).

## Status

- [x] worktree cut from origin/feat/library-v2 @ 9a269a31, pnpm 12.1.0 / node 26.5.0, branch pushed
- [ ] merge `origin/feat/library-v2-books` @ 9325e0f7 (rerere off)
- [ ] package.json step-set proof (parsed)
- [ ] parks hydrated for the merged source hash
- [ ] local checks (table below)
- [ ] the look (six chapter books at 1280x800 and 390x844; a picture book; the owl's desk)
- [ ] PR opened, stacked on #733
- [ ] CI green on the PR head
- [ ] preview deep links checked and in the PR body

## Taking over at zero notice

`cd .claude/worktrees/library-chapter-books && pnpm install --frozen-lockfile`. Read the Status
list above and carry on from the first unticked box.
