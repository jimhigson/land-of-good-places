# HANDOFF — #518, the chase camera's near bound measures a seat, not a body

**Model: Claude Opus 5 (1M context)** — chosen by the Overseer, matching the
agent it continues from (#519). Role: **Engineer**.

Branch `fix/seat-not-body-518`, worktree `.claude/worktrees/seat-not-body-518`.

## BASE IS NOT `main`, and that was a deliberate, flagged decision

The brief said to branch off `origin/main`. **That is not possible for this
ticket:** `origin/main` contains neither `src/world/slide/chaseEye.ts` nor
`src/world/slide/petFraming.ts` — **#519 creates both**, and #519 is still
open. There is no near bound on `main` to prove dead and no module to fix.

So this branch is **stacked on `origin/fix/slide-chase-camera`** (#519's head).
Raised with the Overseer rather than done silently. Consequences whoever picks
this up must know:

- This branch's diff against `main` **contains #519's diff too** until #519
  merges. Review it against `fix/slide-chase-camera`, not `main`.
- If #519's re-review changes `chaseEye.ts`, **this base moves** and this
  branch must be rebased onto the new #519 head.
- Once #519 merges, rebase onto `origin/main` and the stack disappears.

## Step 1 done — the guard is PROVED DEAD, from a run rather than by reading

Added permanent counters to `chaseEye.ts` (`chaseCeilingRejections`,
`chaseCeilingCalls`, `chaseCeilingWorstShare`, `CEILING_REJECT_ABOVE`), zeroed
per descent from `startRide`, printed by `check:pet-slide` every run. They are
deliberately **kept after the fix**: "it fires now" is exactly as much a
measurement as "it never fired".

**Before transcript, canonical seed 20260728, `check:pet-slide` exit 0:**

```
near bound 0 rejections in 623 calls (worst estimate 6.6% against 15.0% to reject) — NEVER FIRED
```

**Geometry it was proved against:** canonical seed 20260728, 624 ridden frames,
312 chase frames, three companions (`pet.kitten`, `pet.bunny`, `pet.mouse`),
seats at `PET_SLIDE_LEAD` 2.73 / `PET_SLIDE_GAP` 1.98 → 2.73/4.71/6.69 m, lens
`BASE_BACK` 4.35 / `BASE_UP` 1.62, fov 60 (half-fov 30°), `PET_FRAME_CEILING`
0.25 × `CEILING_SAFETY` 0.6 = **15.0%** to reject, `PET_SCREEN_RADIUS` 0.41.

This matches the issue's claim exactly and quantifies it: the guard's worst
estimate over a whole descent is **6.6%**, against **15.0%** needed to reject,
while `check:pet-slide` rasters the same animal at **21%**. It is not close to
firing — it is off by a factor of ~2.3 on its own scale.

The control run reads `0 rejections in 0 calls`, which is correct and worth
noting: with the ride unwired there is no companion, so the near bound is never
asked. A reader must not take that 0 for the same 0 as the wired run's.

## Still to do

- The fix: give the solve the **drawn** body, per the issue (a design gap, not
  a constant — `chaseEye` is handed seats, not bodies). One owner for "where is
  this companion actually drawn", reusing #519's `Box3.setFromObject` template.
- **Do not change the aim.** The aim currently targets midpoint(rider, seat)
  and that is what #519 proved at 17-21% across 16 seeds and 17.4-23.6° off
  axis. Fixing the near bound must not silently re-open those numbers; if the
  guard starts firing the lens steps back and every one of them moves. Measure
  before/after on the pool.
- Answer the Overseer's question: was the dead guard **protecting nothing**, or
  **silently permitting something**? 16/16 seeds raster 17-21% against a 25%
  ceiling, so nothing is over today — but the estimate says 6.6% where the
  truth is 21%, so the guard would not have caught a park that did go over.
- #513 and #516 are siblings; note findings, fix neither here.

## Inherited, unexplained, not folklore

The seed-131 flake from #519's sweep: one silent process death mid-control,
not reproducible in three standalone re-runs, all printing byte-identical
wired lines. Cause unproven. Recorded as unexplained, not diagnosed.
