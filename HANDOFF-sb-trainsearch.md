# HANDOFF — sb-trainsearch: why seed 6 re-runs the train search 34 times

Model: Claude Opus 5.5 (chosen by the structural-backtrack engineer).
Branch: fix/sb-trainsearch (from origin/wip/sb-merge). Worktree: .claude/worktrees/sb-trainsearch.
Scratch: /private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/sb-trainsearch/

## Task
Seed 6 restart 5: plan 650 s CPU, train 507 s (48.7M pieces, 34 unwinds). Root-cause
which refusals unwind into the train, fix at cause (builder alternatives > accurate
`consumed` > cheaper train search). Measure plan CPU for seeds 0..15 before/after;
confirm park:attempt accepts at recorded restarts.

## Status
- [ ] baseline trace seed 6

## Findings (measured, seed 6 restart 5, base 3eeacba7)
- Baseline: plan thread CPU 481 s; wall per feature train 703 s / cruiser 188 / pathGraph 36 / slide 12.
  89 refusals, 34 unwinds. (scratch s6-before-keep.log)
- Refusal mix (unique): train "rail route did not solve" x67 (consumed cruiser,layout); pathGraph off-site
  crossings x12; cruiser x6; pathGraph pinch x2, gate-approach legibility x1, diagonal x1.
- Train searches: 75 total, 67 failed. Every failure is exhaustive: 4 rungs x 96 poses, ~300k pieces, ~9 s.
  Re-seeded train attempts close NO loop ~85% of the time on restarts 5/6. Layout attempt 1 (restart 6):
  36 train failures across all 6 cruisers.
- First trigger: train attempt 0 placed an UNSATISFIED loop (report.satisfied=false: its own
  loopKeepsItsCrossing rejected it). Loop has a fenced neck (limbs at railD ~80 and ~265 3.3 m apart),
  spur-ferrisWheel (328 m long, 101 pts) weaves along the rail centreline -> pinch screen. So the pinch
  correctly blames the train; the train knew.
- crossings attempt n>0 is byte-identical to n-1 unless a site was banned (refuseBridgeSiteForPaths);
  off-site-crossing refusals re-drew identical crossings 3x each (9 unwinds wasted on seed 6).
- Cruiser does take part in train failures: 4-8k cruiser-only sample rejections per failed search
  (of ~200k collision rejections). So naming cruiser is "participating", not provably causal.
- Profile (failing train search): boundary distanceToEdge+nearestVertex ~22%, train clear() 13%,
  selfClear 9%, GC 15%.

## Changes so far (uncommitted DIAG lines must be stripped before commit)
- crossings supply = min(4, 1 + refusedBridgeSiteCount()) — no identical re-draws.
- TrainRouteUnsolvable carries cruiserRejections; train refusal names cruiser only if >0.

## Baseline sweep (base worktree .claude/worktrees/sb-trainsearch-base = origin/wip/sb-merge b128937f,
## scratch base-sweep.txt + base/seedN.log; plan thread-CPU s per seed)
0:41 1:282 2:3 3:132 4:11 5:92 6:472 7:11 8:81 9:106 10:31 11:10 12:6 13:265 14:185 15:283
Train-failure cascades (train re-seeds failing ~85%, x6 per cruiser) dominate 6, 9, 13, 14, 15;
crossings identical replays inflate pathGraph on 1, 3, 15; cruiser search itself big on 1, 5, 8.

## Commits
- 218a1f17 crossings supply = min(4, 1 + refused sites) (no identical re-draws)
- dd652e6f rail search speedups (train clear grid, boundary edgeCloserThan) + cruiser-attribution
Next: after1 sweep (scratch after1-sweep.txt) with DIAG train satisfied/cruiserRejections prints.

## After commits 218a1f17+dd652e6f: seed 6 plan CPU 472 -> 267 s (train 362 -> 186 s, identical
48654299 pieces; decision trace identical to base minus crossings replays - scratch tracecmp.sh).
Sweep for other seeds runs on snapshot worktree .claude/worktrees/sb-ts-snap (remove at end).
Seed 6 trains: 4 of 8 placed were UNSATISFIED (all refused by pathGraph); satisfied ones were also
refused (8 off-site crossings, legibility). Next: is the crossing planner dropping the train's own
proven start site (railD 0)? DIAG offsite line added in main worktree (uncommitted).

## after1 sweep (commits 218a1f17+dd652e6f), plan thread-CPU s, all 16 decision traces identical to base
seed | before s (train) | after s (train) | unwinds
0 | 41.3 (12.6) | 25.4 (5.7) | 6 -> 3
1 | 281.9 (41.8) | 192.2 (23.0) | 32 -> 20
2 | 3.1 (1.8) | 2.3 (1.1) | 0 -> 0
3 | 131.9 (50.3) | 58.6 (27.6) | 28 -> 13
4 | 11.5 (9.6) | 7.3 (5.8) | 1 -> 1
5 | 92.2 (2.4) | 81.9 (1.5) | 2 -> 2
6 | 471.5 (361.9) | 267.3 (186.4) | 34 -> 25
7 | 11.1 (2.7) | 8.9 (1.7) | 0 -> 0
8 | 80.9 (9.4) | 63.9 (5.5) | 6 -> 6
9 | 106.1 (78.9) | 59.2 (39.5) | 13 -> 7
10 | 31.5 (2.1) | 24.4 (1.1) | 3 -> 3
11 | 10.1 (3.2) | 7.0 (1.8) | 0 -> 0
12 | 5.8 (3.5) | 3.7 (1.9) | 0 -> 0
13 | 264.9 (181.2) | 146.2 (87.7) | 28 -> 16
14 | 184.8 (122.5) | 99.5 (54.4) | 12 -> 9
15 | 283.0 (149.0) | 134.0 (71.7) | 29 -> 14
total | 2012 | 1182
cruiserRejections was never 0 on any seed: the attribution change never fired.
Unsatisfied trains (ladder fallback) were refused downstream 16/16 on seeds 0,1,3,6.
