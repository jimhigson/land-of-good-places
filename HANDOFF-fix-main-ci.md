# HANDOFF — fix main's CI after the library merge (#733 + #734 pushed red)

Engineer, Claude Opus 5.5, 23 Oct 2026. Branch `fix/main-ci-after-library` (worktree
`.claude/worktrees/fix-main-ci`), cut from origin/main @ 49e1351e.

**The ask (Jim, 23 Oct ~22:05): "fix the ci issues".** #733 and #734 were pushed straight to main
without a green CI. Fix every red at its root, each fix with a check proved red without it and green
with it (geometry pasted). PR to main, every CI job green, beacon fix seen on the PR's newest preview.
Do NOT merge. Do not touch the den/part-5 or engine-follow-up work.

## Status

- [x] worktree + `pnpm install --frozen-lockfile` (pnpm 12.1.0, node 26.5.0)
- [ ] main's CI run 40024042181 (and Update adoption 40024042300) on 49e1351e finished; every failed
      job's log read
- [ ] each failure: root, fix, red-without / green-with
- [ ] local checks with exit codes (tsc, typecheck:test, library, labels, tap-spacing, exits, jitter,
      whatever CI showed red), then full `check` and `test:procgen`
- [ ] PR opened; every CI job green on its head
- [ ] beacon seen on the newest preview (headless Chrome, throwaway profile)

## Known failure going in

check:library RECOMMEND "found from the desk": 0 sparkles seen from the desk, 80% wanted. The owl's
pick is a seeded shuffle of ALL 18 books; first pick catBusDay on north-8; only 3 of 18 books'
beacons are on screen from the desk (diagnosis: HANDOFF-library-chapter-books.md).

## Findings

(none yet)
