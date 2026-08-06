# HANDOFF — session-lessons (E5-statue)

Branch `docs/session-lessons`, worktree `.claude/worktrees/session-lessons`
(own `npm ci`). Board task #18. **Docs only — no code touched.**

**Status: done, build green, PR raised.**

**Rebased onto `origin/main` (`ff17910`) by E11, 5 Aug.** The old base
`6e7ae78` already carried the current 246-line `CLAUDE.md`, so nothing moved:
the diff is still purely additive, +39 lines, no deletions. Both placement
claims below were re-checked after the rebase and still hold.

## What was added

Two sections to `CLAUDE.md`, **+39 lines** on a 246-line file:

- **"A check can pass without checking anything"** — placed after *Expanding
  the procedural generation*, since it is about trusting verification.
  Leads with the framing rather than the incidents, because all four are one
  disease: *an assertion reporting success about something it is not
  describing.* Squash-merge silent reverts; 76 silent skips; a green invariant
  incapable of failing (`NaN < x` is always false); quoting the count off the
  screen.
- **"Two definitions of one thing, kept in step by hand"** — placed
  immediately before the worn-face section, **which is its worked example**.
  If either section moves, that last sentence needs re-checking.

## Why it is this short

`CLAUDE.md` opens with "It is short on purpose" and that is load-bearing — a
document nobody finishes reading protects nobody. Every war story is one
sentence; both sections match the density of *Committing* and *Expanding the
procedural generation*. **Resist expanding these into narratives.** If a future
incident needs recording, replace a bullet rather than appending one.

## Two details deliberately kept (they are the misleading parts)

- The squash-revert check **depends on whether you own the file**: dropping out
  of `git diff --name-only origin/main...HEAD` proves nothing for a file you
  did touch — there you must also confirm the other side's work is still
  present. Absence from a diff and presence in a file are different claims.
- **A clean rebase is not reassurance** — that is the exact shape of a silent
  revert.

## Deliberately NOT asserted

The `NaN` bullet does **not** say "`test/` is untypechecked", though that was
true when the bug happened. `fix/typecheck-tests` (#192) changes it, and a rule
file should not carry a fact that is about to become false.

## Verification (read off the terminal)

```
BUILD_EXIT=0
PROCGEN_EXIT=0
 Test Files  8 passed (8)
      Tests  127 passed (127)
```

Note the counts keep moving as `origin/main` grows: 5 files / 85 tests earlier
in the session, 112 on base `6e7ae78`, **127 on `ff17910`** after E11's rebase.
Quote whichever the terminal says at the time — that is the point of the fourth
bullet in the section this branch adds.

No dev server needed or started. If one is ever wanted:
`cd .claude/worktrees/session-lessons && npx vite --port 5323 --strictPort`
