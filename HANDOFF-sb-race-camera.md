# HANDOFF: sb-race-camera

Model: Claude Opus 5.5 (chosen by the structural-backtrack engineer). Branch `fix/sb-race-camera`
off `origin/feat/structural-backtrack`.

Task: `raceCameraNeverRunsBackwards` fails on seeds 0,1,3,8,9. Fix in the camera
(`src/world/railRace/camera.ts`, `measureZoomCeiling`), never by weakening the invariant.

## Status
- Baseline park:attempt runs (seeds 0 1 3 8 9 20260728) at base worktree
  `.claude/worktrees/sb-race-camera-base` -> scratchpad runs/before-<seed>.log.
- Diagnostic script: `scripts/tmp-race-camera/ceil.mts` (not committed; uncommitted scratch).

## Findings
- Diagnosis CONFIRMED on all five seeds: every failure is the resting rig (speed 0) with the
  ceiling pinned at exactly 1.000 over the reversal (seed 1 -0.085 @495 m, 9 -0.082 @560.8,
  3 -0.067 @334, 0 -0.005 @275.5, 8 +0.001 @494.5; floor is 0.05).
- Solved without the floor-of-1, minimum ceilings are 0.725 / 0.724 / 0.738 / 0.800 / 0.796;
  canonical 0.912 (66/1024 stations below 1). With it, least forward progress 0.164-0.174 on all.
- Fix committed: CEILING_FLOOR = 0.6 replaces the clamp's lower bound of 1 in measureZoomCeiling.
- tsc exit 0, check:rail-race exit 0 after fix. After-runs of park:attempt in progress
  (scratchpad/sb-race-camera/runs/after-*.log).
