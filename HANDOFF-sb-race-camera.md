# HANDOFF: sb-race-camera

Model: Claude Opus 5.5 (chosen by the structural-backtrack engineer). Branch `fix/sb-race-camera`
off `origin/feat/structural-backtrack`.

Task: `raceCameraNeverRunsBackwards` fails on seeds 0,1,3,8,9. Fix in the camera
(`src/world/railRace/camera.ts`, `measureZoomCeiling`), never by weakening the invariant.

## Status
- Complete. Base worktree removed; diagnostic script (scratch, never committed) deleted.

## Findings
- Diagnosis CONFIRMED on all five seeds: every failure is the resting rig (speed 0) with the
  ceiling pinned at exactly 1.000 over the reversal (seed 1 -0.085 @495 m, 9 -0.082 @560.8,
  3 -0.067 @334, 0 -0.005 @275.5, 8 +0.001 @494.5; floor is 0.05).
- Solved without the floor-of-1, minimum ceilings are 0.725 / 0.724 / 0.738 / 0.800 / 0.796;
  canonical 0.912 (66/1024 stations below 1). With it, least forward progress 0.164-0.174 on all.
- Fix committed: CEILING_FLOOR = 0.6 replaces the clamp's lower bound of 1 in measureZoomCeiling.
- tsc exit 0, check:rail-race exit 0 after fix (zoom line identical to base: 27.8 m crawl,
  36.5 m racing, mark 0.3395/0.3333).
- park:attempt before/after, diffed by measure name: the camera measure is gone on 0,1,3,8,9;
  no measure added on any seed; canonical accepted before and after.
- Canonical zoom change: ceiling min 0.912 (8.8% closer than resting at the tightest hairpin),
  66/1024 stations (~39 m of 600 m) below 1; resting least-forward 0.108 -> 0.174.
- DONE. Visual QA still needed (no headless screenshots taken): /rail-race on seeds 1, 9, 3 at
  the hairpins listed above, and canonical at ~433 m / ~241 m from the arch.
