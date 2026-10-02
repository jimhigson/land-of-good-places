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
- [x] 050c334a cruiser castle-miss supply 2 (CruiserMissedTheCastle). Seed 5: cruiser 79.2 s/11.46M ->
  15.3 s/4.02M, plan 94.8 -> 26.9 s, final decisions identical. Changes seed 1 (MMMMMP history).
  Root cause seed 5: layout draw 2 castle 24.9 m from boundary, window axis at it.
- a5 sweep (part1 + identity speedups): total 1330 -> 1287 s; part 1 makes 9 (56->148 s), 3, 1, 15 trains costlier.
- Running: a6 sweep (all), then accept:parks -- 0-15 --fresh (no --write).

## a6 sweep (head 050c334a) vs base 48c8a7fd, plan thread-CPU s at recorded restarts:
seed | before s (train) | after s (train) | unwinds
0 | 34.2 (7.5) | 15.4 (8.1) | 3 -> 3
1 | 188.3 (21.3) | 100.2 (31.2) | 20 -> 15
2 | 2.0 (0.9) | 1.7 (1.0) | 0 -> 0
3 | 54.0 (25.3) | 53.6 (38.3) | 13 -> 7
4 | 6.5 (5.1) | 6.6 (5.4) | 1 -> 1
5 | 94.8 (1.5) | 27.2 (1.3) | 2 -> 2
6 | 315.8 (217.5) | 219.6 (179.8) | 25 -> 19
7 | 9.1 (1.7) | 9.4 (2.3) | 0 -> 0
8 | 62.7 (5.1) | 52.4 (23.0) | 6 -> 0
9 | 56.7 (37.6) | 176.4 (155.3) | 7 -> 8
10 | 24.2 (1.1) | 22.1 (1.3) | 3 -> 3
11 | 7.2 (1.8) | 5.9 (2.0) | 0 -> 0
12 | 3.5 (1.8) | 3.8 (2.0) | 0 -> 0
13 | 165.4 (101.3) | 114.9 (95.7) | 16 -> 8
14 | 132.9 (70.2) | 34.3 (16.8) | 9 -> 3
15 | 172.6 (92.5) | 160.1 (118.5) | 14 -> 7
total | 1330 | 1004
cruiser total 537 -> 232 s. accept:parks --fresh running -> scratch accept.txt/accept.json
