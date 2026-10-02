# HANDOFF — sb-trainsearch2

Model: Claude Opus 5.5 (chosen by the structural-backtrack engineer; follow-on of sb-trainsearch).
Branch fix/sb-trainsearch2 off wip/sb-merge 48c8a7fd. Worktree .claude/worktrees/sb-trainsearch2.
Scratch: /private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/sb-trainsearch/ (sweep.sh, plan.mjs, table.js, tracecmp.sh)

Task (from #706 agent): (1) train refuses loops failing loopKeepsItsCrossing instead of the ladder
fallback (parks may change; re-record follows later, do NOT commit acceptedRestarts.ts);
(2) cruiser cost (604 s total; seed 5 castle-miss retries ~84 s): find identical re-searches /
cheaper exact tests. Measure plan CPU per seed before/after; `accept:parks -- 0-15 --fresh`
(no --write), attempts per seed. Kill only own PIDs after lsof cwd check; NEVER pkill -f.

## Status
- [x] (1) implemented in train/route.ts trainRouteSearch (throws TrainRouteUnsolvable)
- [x] (2) cruiser: generate.ts influences snapshot (lazyView proxy rebuilt per field read) +
  incremental reach counts; solverBoundary per-cell bracketed edge test. Seed 5: cruiser 79.2 -> 59.5 s,
  identical pieces (11457386) and decisions. Retries on castle-miss only reshuffle the same 308 poses
  (brief seed fixed), but the shared rng makes each a different search; history: 10 miss-runs, 4
  later succeeded (MP x3, MMMMMP x1), 6 MMMMMM -> cutting supply would change decisions; not done.
- base sweep (48c8a7fd): scratch b4-sweep.txt. Next: after sweep a5, then accept:parks --fresh.
