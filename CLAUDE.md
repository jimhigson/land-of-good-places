# Working on this repo

Read this before you touch anything. It is short on purpose.

## The one rule that keeps costing us work

**Never work in the shared checkout at `/Users/jim/dev/landOfGoodPlaces`.**

Many agents run at once on this project. On 27 July two agents wrote to that
directory at the same time: one left half-finished edits across five files,
which broke `tsc` for the other, who had to move its work out and restore the
tree by hand. Separately, an over-broad `git add -A` there swept an agent's
unfinished CSS onto `main`.

So, always:

```
git worktree add .claude/worktrees/<your-task-name> -b <your-branch> origin/main
```

Work there. Remove the worktree when you are done. If you find the shared
checkout on someone else's branch or carrying someone else's uncommitted
edits, **leave it exactly as you found it** — that is somebody's live work.

## Committing

- Commit as soon as a coherent chunk compiles. Do not save one big commit for
  the end — the API drops connections and an uncommitted branch dies with you.
- Never `git add -A` or `git add .`. Name the files you mean.
- `.claude/` is gitignored; worktree gitlinks must never reach `main`.

## Building

`npm run build` must pass. **Run it and check the exit code.** Never pipe a
build through `tail` or `head` — that masks the exit code, and we shipped a
non-compiling branch to `main` that way once.

TypeScript is strict with `exactOptionalPropertyTypes: true`: optional
properties must be **omitted**, never assigned `undefined`.

## The browser

The chrome-devtools MCP uses a **single shared Chrome profile** — only one
agent can drive it at a time, and the Overseer says who. If you have not been
told you own it, do not use it: build-verify instead and list in your PR
exactly what needs visual QA.

If you do own it: **always pass `background: true` to `new_page`.** A
foreground page steals the user's focus and switches macOS Spaces, which is
horrible when they are doing something else. Close every page you open and
kill your dev server when you finish. See QA-PLAYBOOK.md.

## Handoff files

You can be pulled at zero warning. Keep a short `HANDOFF-<your-task>.md` on
your branch, updated at checkpoints — enough that a replacement can take over,
but never so much that writing it costs more than recovery would. Record
findings (a root cause, a decision, a formula) as soon as you have them, not
at the end.

## Before you design anything

- **GAME_DESIGN.md** is the canonical record of what the family asked for. Its
  absolute rules — HIGHLIGHT (rainbow outlines), TEXT/UI-SCALE, CONTROL (never
  tank controls) — apply everywhere, always.
- **ORDER-OF-WORK.md** is the authoritative order. It exists because a good
  half of the backlog invalidates other parts if taken in the wrong order.
- **ARCHITECTURE.md**, **ARCHITECTURE-DECISIONS.md**, **ART_DIRECTION.md**.

This is a game a father is building with his six-year-old daughter. When a
trade-off is close, pick the one a six-year-old will enjoy more.

## PRs

Raise with `gh pr create`. **Do not merge your own work** — every PR gets two
peer reviews plus QA, and the Overseer merges.
