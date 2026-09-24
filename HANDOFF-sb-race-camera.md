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
(pending)
