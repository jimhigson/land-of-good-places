# Handoff — `check:entrance-road` times out in CI

Branch `fix/entrance-road` off `feat/procgen-on-sphere`, worktree
`.claude/worktrees/entrance-road`. PR against `feat/procgen-on-sphere`. Do not
merge.

## The report

PR #667 head `ae20b9fc`: workflow `Entrance road` (`timeout-minutes: 15`)
CANCELLED = timed out. Step "Entrance road sweep" ran 14m56s and produced
**zero output** before the kill.

## What the workflow history says (measured, `gh run list`)

Durations of whole runs on `feat/procgen-on-sphere` (short ones are
`cancel-in-progress` supersessions, ignore those):

| commit | dur | conclusion |
|---|---|---|
| ebaafe86 | 246 s | success |
| 6d2cecd1 | 274 s | success |
| e292f5c6 | 324 s | success |
| 4a824c75 | 303 s | success |
| af63abee | 353 s | failure (assertion) |
| **3d797f67** | **919 s** | **cancelled (timeout)** |
| b449fcd3 | 920 s | cancelled |
| 5c510148 | 917 s | cancelled |
| 6f191a30 | 901 s | success (squeaked in) |
| accd2054 | 918 s | cancelled |
| 9a4fcb09 | 934 s | cancelled |
| d2efafa3 | 939 s | cancelled |
| ae20b9fc | 922 s | cancelled |

**The step goes from ~5 min to ~15 min at `3d797f67`** — "parkPlan: plan-time
crossing screen marches the esplanade too; boundary screen at the wall itself"
(touches `parkPlan.ts`, `train/crossingPredicate.ts`, `train/crossings.ts`).

## The shape of the check (why zero output)

`scripts/check-entrance-road.mts` `sweepThePool()` forks **one child process per
(seed, real|control)** — 10 pool seeds × 2 = **20 children** — and launches them
through `Promise.all` over `PARK_SEED_POOL`, i.e. **10 concurrent lanes**, each
lane doing `real` then `control`. Every line of output (the per-seed table, the
stderr notes, the verdict) is printed only *after* `Promise.all` resolves. So a
sweep that is merely slow is indistinguishable from a hang: it prints nothing
until it prints everything. That is not the cause, but it is why CI showed
nothing for 15 minutes.

## Local timings (this Mac, one child at a time)

(in progress — see below)

## Status

- [x] worktree, install
- [x] located the regression commit from CI history
- [ ] local per-seed timings
- [ ] root cause
- [ ] fix
