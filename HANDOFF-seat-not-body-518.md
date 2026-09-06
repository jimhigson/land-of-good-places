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

---

## The fix, as shipped — and the wrong turn on the way, which is the useful part

### Attempt 1, abandoned: derive the body centre from the seat

`petBodyCentreOnSlide(seat, upSlope, out)` = `seat + upSlope × PET_RECLINED_LENGTH/2`,
in `petRiders.ts`. It looked right and it followed a documented precedent —
`PET_RECLINED_LENGTH`'s own doc says it is *"written down rather than measured
at run time on purpose"*, with a check that re-measures the drawn meshes as the
guard against drift.

**So I wrote that drift check, and it failed my own fix: 0.70 m out** from
`Box3.setFromObject` of the real animal. That is most of the ~0.95 m error the
fix existed to remove. The guard's estimate went 6.6% → 10.3% against a 15%
threshold — still could not fire.

**This is the lesson of the ticket, one level in.** #518 is "a measurement taken
on a convenient origin rather than on the thing that gets drawn". A formula
derived from the pose *is another convenient origin*, dressed up as a principled
one. The check caught it; reasoning did not.

### Attempt 2, shipped: ask the system that owns the bodies

`PetSlideLink.nearestRiderBodyCentre(out): boolean`, implemented by `Parade`
with `Box3.setFromObject` on the real member, `updateWorldMatrix(true, true)`
first. Exactly the precedent `petsOnSlide` and `companionAt` set on either side
of it: *"answered by the system that owns those bodies"*, observing rather than
recomputing. Only a **point** crosses back, so the interface's "nothing crosses
back" rule is intact.

`solveChaseEye` now takes `petBodyCentre` as a parameter and derives nothing.

### Numbers, canonical park

| | seat (#518 defect) | derived | measured (shipped) |
|---|---|---|---|
| solved centre vs drawn | — | 0.70 m out | **0.12 m out** |
| worst near-bound estimate | 6.6% | 10.3% | **20.1%** |
| rejections | 0 / 623 | 0 / 623 | **760 / 1383** |
| biggest pet in frame | 21% | 21% | **15%** |

The drift clause stays armed and goes red at ~0.95 m if anyone passes the seat
again. **A check that caught its author is the one to leave in.**

## The 16-seed sweep — 16/16 pass, and the guard fires on every park

| seed | biggest | smallest | off-axis | in shot | rejections |
|---|---|---|---|---|---|
| 20260728 | 15% | 11.8% | 23.7° | 100% | 760 |
| 5 | 18% | 12.6% | 23.5° | 100% | 687 |
| 11 | 18% | 12.7% | 21.2° | 100% | 862 |
| 24 | 18% | 12.0% | 24.1° | 100% | 556 |
| 115 | 19% | 13.2% | 17.4° | 100% | 319 |
| 128 | 18% | 13.0% | 22.8° | 100% | 579 |
| 131 | 14% | 12.5% | 23.4° | 100% | 871 |
| 208 | 17% | 11.7% | 21.1° | 100% | 859 |
| 225 | 15% | 13.2% | 22.6° | 100% | 725 |
| 267 | 17% | 11.8% | 21.5° | 100% | 791 |
| 274 | 17% | 11.8% | 20.7° | 100% | 628 |
| 288 | 17% | 11.8% | 23.4° | 100% | 601 |
| 326 | 18% | 16.3% | 19.6° | 100% | 424 |
| 346 | 17% | 13.1% | 19.7° | 100% | 364 |
| 428 | 14% | 12.0% | 23.1° | 100% | 651 |
| 451 | 18% | 12.2% | 24.4° | 100% | 652 |

- **Biggest raster 17-21% → 14-19%.** Every park keeps more ceiling headroom
  than before; worst margin against the 25% ceiling goes from 4 points to 6.
- **Nothing is lost from the shot**: in-shot 100% on all sixteen, smallest
  raster 11.7-16.3% against a 1% floor, off-axis 17.4-24.4° against 30°.
- **The guard fires on all sixteen** (319-871 rejections), where it had never
  fired on any.

## Cost — re-taken, not the stale "1.0 candidates per call"

| | before #518 | after |
|---|---|---|
| candidates per call, mean | 1.0 | **2.2** |
| worst candidates in one call | 1 | **4** (of 600 possible) |

The search is exercised at last — #519's header calls it "unexercised and
therefore unproven", and that is now out of date in the good direction — and
nowhere near its stop.

**A timing trap worth recording.** Wall-clock timing of the solve reported a
**20.6 ms** single call on seed 5, over a 16.67 ms frame budget. It examined
**4** candidates — identical work to calls costing 0.03 ms on other parks. It
was a GC pause caught inside the `performance.now()` window, not the solve. The
timing was removed and the **work** is counted instead: counting the work is the
honest instrument, timing it measures the machine. `worstCandidates` is the
number to watch, and it is 4.

## This is a VISIBLE change — it does not take the invisible-merge route

`biggest pet 21% → 15% of frame` is a child seeing a different chase shot. The
brief scoped this as invisible ("the guard firing changes no frame today");
that was wrong and the Overseer has corrected it. **It goes to Jim.**

It also supersedes numbers #519 published: #519's "biggest pet 21%, 17-21%
across the pool" becomes **15% / 14-19%** with this branch on top.
