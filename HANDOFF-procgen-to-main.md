# Handoff — getting #667 (procgen on sphere) merged and to production

Worktree `.claude/worktrees/procgen-to-main`, local branch `fix/procgen-to-main`
pushed onto `feat/procgen-on-sphere` (the PR #667 head).

## Checks red on d2efafa
- `check:deck-fallthrough`'s indoor reach control: castle floors at y=NaN.
  Cause: #667 made `BUILDING_BASE_Y` live (bound by the plan driver), the
  script never solved the plan. Fix: `solveParkPlanNow()` before the probe,
  plus a loud FAIL on a non-finite floor (control: without the solve, the new
  guard fires on all three castle floors). Local run: exit 0, 18 s.

## Next
- Rerun CI; find any later Checks red; timeouts on Entrance road / Every seed builds.

## STOPPED (Jim halted all work)
Stopped after pushing 6ee0c95c to `feat/procgen-on-sphere`. Nothing merged.
Not yet done: confirm the rest of Checks on CI past deck-fallthrough; the
Entrance road / Every seed builds timeouts (seed 7 ~1003 s, railway dead-end
searches) untouched; procgen/coplanar name-diff not re-verified; #667 merge,
sphere-combined -> main PR, deploy, production verification all not started.
