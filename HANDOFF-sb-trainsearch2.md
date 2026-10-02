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
