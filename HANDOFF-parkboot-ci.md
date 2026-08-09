# HANDOFF — fix/park-boot-ci

Task: `main` is red; `check:park-boot`'s `ADVANCE_CEILING_MS` (24 ms) fails on
GitHub runners at 27.6 ms. Deploys blocked since e932396.

## Facts established (read the real CI log, not the summary)

`gh run view 31288279104 --log-failed` (main @ a6761a2, Deploy):

```
generation finished in 1705 frames / 14.33 s wall clock, 13.74 s of it inside advance()
worst single advance() 27.6 ms against a 8 ms budget; 1693 frames did over a millisecond
worst the event loop was blocked: 107.7 ms, over one 60 Hz frame on 6 occasions
work units: brief 152, cruiser search 29142, cruiser finish 11, slide search 415337
steps begun after their slice's deadline: 6 (cruiserSearch 1, slideSearch 5)
509 ms of generation happened outside a budgeted slice
```

**The unit counts on CI are byte-identical to this laptop's** (152 / 29142 / 11
/ 415337). The brief I was given quoted 242899 / 3644905 / 27 late steps — those
numbers are not in any run on main and should be disregarded. The park CI builds
is the same park, sliced into the same pieces.

Laptop (M-series, idle): 719 frames / 5.82 s wall, worst advance 12.2 ms.
So the runner is **~2.4x slower** by frame count and wall clock.

## The profile — what the 27.6 ms actually was

Method: drive `ParkGeneration.advance(0)`. Every drive loop runs its first step
unconditionally and only then checks the clock, so a zero budget makes each
`advance()` do **exactly one step** and the slice time *is* the unit cost.
444,656 units timed individually (`scripts/tmp-profile-units.mts`, deleted
before the PR).

Worst indivisible unit, before the fix:

```
  phase             count       mean      p50      p99    p99.9      max
  brief               152      0.134    0.021    0.724    0.841    0.841
  cruiserSearch     29142      0.042    0.022    0.200    0.252    0.694
  cruiserFinish        11      1.302    0.631    6.659    6.659    6.659   <-- 
  slideSearch      415337      0.012    0.006    0.111    0.180    2.414
```

`cruiserFinish` step 1 = **`coasterProfileSearch`'s whole prologue**:
`yield pass` sits at the *top* of the repair loop, so everything before the
first pass — sampling the plan, finding the station on it, the hill profile,
both carves, the first curve build and its 1600-sample arc-length table — was
one un-interruptible step. 6.2-6.7 ms cold on an M4 Max against an 8 ms budget.
x2.4 (the runner) = ~16 ms, and 8 ms of budget already spent before it = 24 ms,
plus GC = the 27.6 ms.

Fix: yield at the six seams in the prologue and two in the tail. Worst unit
**6.66 -> 4.85 ms**; `cruiserFinish` units 11 -> 19.

The 4.85 ms residue is `terrainHeight` -> `PARK_BOUNDARY.distanceToEdge` run
~74 times *interpreted*, before V8 tiers it up: pre-warm it with 3000 calls and
the same step measures **0.27 ms**. Cold-start, not work. Unsliceable in any
useful sense — moving it only moves the hitch to another frame.

Next tier down is the slide search's route-closure steps at 2.2-2.7 ms
(`unrideableComplaint` rebuilding the whole chute inside `satisfies`).

## Slow-box reproduction (method, stated honestly)

20 competing `node` spinners on 14 cores -> the run takes 1788 slices instead of
771 (2.3x, matching CI's 2.4x). Under that the worst slices are **84.8 ms in 6
steps** and 54.5 ms in 2 steps — i.e. scheduler preemption, not unit cost. That
is why a *constant* wall-clock ceiling cannot be the guarantee.

## Status

- worktree `.claude/worktrees/parkboot-ci`, branch `fix/park-boot-ci`
- route.ts prologue/tail sliced (done)
- next: calibrated ceiling + raised `MIN_UNITS.cruiserFinish` in the check
