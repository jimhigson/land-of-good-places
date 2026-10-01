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
