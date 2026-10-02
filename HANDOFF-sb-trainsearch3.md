# HANDOFF — sb-trainsearch3
Model: Claude Opus 5.5 (structural-backtrack engineer's choice). Branch fix/sb-trainsearch3 off wip/sb-merge 908e2f5a.
Scratch: .../scratchpad/sb-trainsearch/ (sweep.sh, table.js, tracecmp.sh, layouts.txt). Base worktree sb-ts3-base (remove at end).
Rules: no acceptedRestarts.ts commit; stay out of railRace/; kill own PIDs only after lsof cwd check; never pkill -f.
1. Done (commit "a failed loop search names the layout"): evidence in layouts.txt — first cruiser draw with 6/6 train
   failures never led to an accepted park on that layout (7 layouts); no accepted park ever used a cruiser re-draw for its train.
2. Next: baseline b7 sweep (908e2f5a) running, then after sweep, look at 6/9/15/1 for identical-search waste.
- Base 908e2f5a re-measured (b7): parks changed with paths-to-doors; total 519 s; slowest now 7 (192, train), 3 (63, cruiser
  castle misses), 15 (51), 6 (43, cruiser), 8 (40). Seed 9 is 3.9 s at base already.
- a7 (layout-not-cruiser): 519 -> 406, seed 7 192 -> 41, all final decisions identical (5/8 differ only in message text).
- Commit "a refusal the train's re-draw did not change names the layout": seed 7 -> 21.8 s, same final park. a8 sweep running.
- a8 sweep: 519 -> 370 s, final placements identical on all 16 seeds.
- Commit "rescue tier searched once per layout" (memo, registerPlanCache): seed 3 identical trace; 13/14 also repeat rescue tiers.
- Running (one job): a9 sweep then accept:parks -- 0-15 --fresh (scratch a9-sweep.txt, accept3.txt).
- Remaining big costs are single searches (seed 8 cruiser 32 s + train 30 s, 0 unwinds) and castle-unreachable layouts (seed 6).
