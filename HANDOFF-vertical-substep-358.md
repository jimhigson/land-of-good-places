# #358 — the ground sample did not sub-step

Branch `fix/vertical-substep-358`, worktree `.claude/worktrees/eng-358`.

## Root cause, and it was two things

`CollisionWorld.resolveMovement` cut a frame's **lateral** movement into pieces
short enough that no wall could be crossed without being overlapped (#80). The
**vertical** ground sample got neither half of that treatment:

1. `Player` sampled `WalkSurfaces` **once per frame**, at the position the whole
   frame's movement ended at.
2. It asked from `this.position.y` — the **damped** height she is *drawn* at,
   which on a steady climb lags `0.309x` the per-frame rise behind her.

`WalkSurfaces.sample` refuses any surface more than `BUILDING_STEP_UP` above
what it is asked from, so the whole of one clamped frame's climb had to fit
inside `0.62` **minus** the lag. Steeper than `0.62 / 1.309 / 0.925` = **0.512**
and the deck she was running across simply stopped being found: she got the
terrain metres below and fell through.

## The fix

- `resolveMovement` takes an optional `onStep(position)`, called after each
  sub-step's `resolve`. The decomposition stays in **one** place, so the
  vertical question cannot be asked at a different granularity from the lateral
  one. Callers that pass nothing (every NPC, `nudge`) take exactly the path they
  took before.
- `Player` carries `groundHeight` — the surface she is actually standing on —
  and asks the sampler from that. `position.y` stays damped, and is once again
  only what it says it is: how smoothly she is *drawn*.

The step-up rule is applied **more often and at a finer grain, never relaxed**.
A deck edge is still one sub-step's discontinuity and is still rejected, which
is what stops her climbing things she should not. `FALL_THRESHOLD` and
`BUILDING_STEP_UP` are untouched.

## Measured — and which half mattered

`npm run check:deck-fallthrough` (10 s, in the build chain). Real
`WalkSurfaces.sample`, real `CollisionWorld`, the shared `playerSim.mts`
integration. 27 gradients x 5 frame rates x 64 start phases x walk/sprint x
up/down, x4 variants.

```
  neither (as shipped before #358)   0.512
  sub-stepping only                  0.512
  true-surface reference only        0.670
  both (what ships now)              1.670
```

**Sub-stepping alone buys exactly nothing.** Asked from the damped height every
sub-step asks from the *same frozen number*, so the last one lands where the
single end-of-frame sample landed and answers identically. Cutting the movement
finer cannot help when the thing being measured from never moves. The two fixes
are **interdependent, not additive** — which is precisely what makes one of them
look revertible. Do not.

1.670 matches the derived prediction of **1.676** = `BUILDING_STEP_UP` over the
worst sub-step. Note the worst sub-step is **not** the longest frame: the count
is a `ceil`, so 15 fps (0.740 m in 2 sub-steps of 0.370) is coarser than the
12 fps clamp (0.925 m in 3 of 0.308). Sweeping the clamp alone would have
measured the wrong ceiling and called it the answer.

The control's ceiling of 0.512 independently reproduces
`SPRINT_PEAK_GRADE_BUDGET`'s documented value, which is a useful sign the rig
describes the shipping player.

## Proved red

The control column is pre-fix behaviour and runs on every invocation:

> a sprinting child up a gradient-0.550 deck at 12 fps (phase 0.0000) lost the
> surface at x=-37.19: the deck is at y=7.376 but the sampler returned -0.159,
> 7.535 m below her own feet — she falls through it.

The check itself was also run against **pre-fix source** (`origin/main` in a
detached worktree, harness + sim copied in, `src/` untouched): **exit 1**, all
three assertions firing, ending

> FAIL: the measured ceiling 0.000 does not bracket the predicted 1.676 (next
> gradient tried: 0.100). The ground sample is no longer following the movement
> sub-steps.
> FAIL: sub-stepping the ground sample bought nothing — the ceiling went
> 0.512 -> 0.000.

## What was deliberately NOT changed

`SPRINT_PEAK_GRADE_BUDGET` keeps its value of 0.512, because
`MAX_RAMP_GRADIENT = SPRINT_PEAK_GRADE_BUDGET * (1 - HUMP_BLEND)` and raising it
**re-plans every bridge on every seed** (#349 measured crossing counts moving on
four of five seeds). That is separately measured gameplay work, not a side
effect of a physics fix. Its comment now records the measurement and the
available headroom instead of describing #358 as unfixed.

**The old model is written down in two places.** Whoever raises the budget must
also relax `CLIMB_BUDGET` in `test/procgen/invariants.ts` (~line 5079) in the
same PR — it still models one sample per frame from the damped height, is now
conservative, and would otherwise keep refusing exactly the steeper ramps the
change is meant to allow. Both sites are commented to say so.

## On the rigs

`scripts/playerSim.mts` is **neither** of the two bridge-work fall rigs. It
predates them (PR #80, the no-tunnelling work) and had no ground, no fall check
and no descents at all — it could not over-count on descents because it had no
descents. Sound, and extended here rather than replaced.

The over-counting rig's failure mode is designed around: it never simulated the
**landing**, so a legitimate brief hop on a descent (the damped height lags
*above* ground going downhill) was scored as a fall. This harness integrates
through the landing, and judges safety by **losing the surface** — the deck
exists under her feet and the sampler returned something below it, against the
deck the harness itself built — not by whether she ever left the ground.

## State

- `npx tsc --noEmit` clean.
- `check:hop-clearance` and `check:wall-tunnelling` (350k runs) byte-identical
  to `origin/main`, PIDs and timings aside — the sim extension is
  behaviour-preserving for its existing callers.
- `npm run build`, `npm run test:procgen`: see the PR.
- `check:wall-tunnelling` is **not** in the build chain (it lives in `check:all`,
  which CI does not run), so the lateral half of this bug class is currently
  proved only by hand. Not changed here; worth someone's ticket.
