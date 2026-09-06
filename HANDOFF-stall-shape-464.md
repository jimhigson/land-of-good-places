# HANDOFF — #464, checks defined but never run

Model: **Claude Opus 5 (1M context)**, chosen by the Overseer (Engineer
default). Role: Engineer. Branch `fix/stall-shape-464`, worktree
`.claude/worktrees/stall-shape-464`, based on `origin/main` `61e95fe5`.

Measurements on Node **26.7.0** (`/opt/homebrew/opt/node@26/bin/node`;
`scripts/with-node` is broken, #506). Exit codes from each run's own file,
never through a pipe.

## The ticket's premise is stale — do not "restore" anything

`check:stall-shape` **is in the chain on `origin/main` today** and **passes**
(exit 0). Its life, from walking first-parent history and parsing the chain at
each commit: added in-chain by #446 (1 Sep), orphaned by #453 the same day (the
banquet swap CLAUDE.md describes), restored by #463 (2 Sep). Dark about a day.

**`git log -S` cannot answer this** — the script *definition* keeps the string
alive in the file, so the string never leaves the diff. The walk script is at
`scratchpad/walk.mjs`; it prints every transition per check.

## What is actually unrun — five checks

| check | orphaned at | how long | red because |
|---|---|---|---|
| `check:frame-time` | #246, 8 Aug | ~28 d | needs a built `dist/` |
| `check:arrival-starts` | #264, 9 Aug | ~27 d | needs a dev server on 5173 |
| `check:deep-links` | #314, 22 Aug | ~14 d | needs a dev server |
| `check:walking` | #342, 27 Aug | ~9 d | needs a dev server |
| `check:wall-tunnelling` | — | — | only in `check:all`, which no workflow runs |

Four were **born orphaned** — never in any chain, never run in CI once. All
four exit 1 by hand and **none fails on the game**; every one fails on its own
precondition, which is why nobody wired them in.

`check:wall-tunnelling` is worse than orphaned: `measure-wall-tunnelling.mts`
has **no `process.exit(1)` and no failure path** — 32 s, always exit 0. A
measurement tool named as a check. Needs assertions or renaming.

Also: **`check:all` omits `check:coplanar`**, one of CLAUDE.md's three
pre-push gates.

## What this branch adds

`scripts/check-chain-coverage.mts` + one chain step, placed **first** (~0.5 s,
so a broken chain is reported before 16 minutes of work).

Entry points come from **what the workflows invoke**, expanded transitively
through `package.json`. That is what makes a check with its own workflow
(`check:coplanar`, `check:gateway`, `check:live-version`,
`check:update-adoption`) correctly *not* an orphan — controlling for that
first cleared 3 of 7 candidates. **Aggregates are distinguished from leaves**:
reaching a leaf through an unreachable aggregate is how `check:wall-tunnelling`
hid, and my own first hand-rolled walk seeded `check:all` as an entry point and
so called it covered — a confident wrong answer of exactly the kind this check
exists to stop. Do not re-introduce that shortcut.

`KNOWN_ORPHANS` is a ratchet, printed every run: fails on any new orphan, and
**also** fails when a listed one becomes reachable, so the list cannot rot.

### Proved red (mutations on this tree, exit codes from files)

| mutation | exit |
|---|---|
| unmutated | 0 |
| new orphan script appears | 1 |
| `check:stall-shape` swapped out of chain (#453 case) | 1 |
| `KNOWN_ORPHANS` entry becomes reachable | 1 |
| restored | 0 |

Instrument controls fire too: breaking the entry-point regex reports "cannot
see CI" rather than passing quietly (67 problems, first one naming the regex).

**What would make these transcripts stale:** they are structural, not
geometric, so they rot only if `package.json`'s script names or the workflows'
`pnpm run` syntax change. Re-arm by re-running the mutations above.

## Left deliberately undone

- **Wiring the four server/build checks up for real** — needs a workflow that
  builds and serves on a **non-default port** (their hard-coded 5173 is against
  CLAUDE.md). Own issue; `KNOWN_ORPHANS` points at #464 until it exists.
- **#478** (`|| 1` guard) — same disease, different organ. This detector
  **cannot** see it: reachability is structural, "does this assertion lie" needs
  mutation of the check's own clauses. Said so in the issue and PR.

## State

Committed and pushed. Issue #464 updated with the full finding. Gates running;
results go in the PR body. PR not yet opened at time of writing.
