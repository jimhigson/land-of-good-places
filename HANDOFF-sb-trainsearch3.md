# HANDOFF — sb-trainsearch3
Model: Claude Opus 5.5 (structural-backtrack engineer's choice). Branch fix/sb-trainsearch3 off wip/sb-merge 908e2f5a.
Scratch: .../scratchpad/sb-trainsearch/ (sweep.sh, table.js, tracecmp.sh, layouts.txt). Base worktree sb-ts3-base (remove at end).
Rules: no acceptedRestarts.ts commit; stay out of railRace/; kill own PIDs only after lsof cwd check; never pkill -f.
1. Done (commit "a failed loop search names the layout"): evidence in layouts.txt — first cruiser draw with 6/6 train
   failures never led to an accepted park on that layout (7 layouts); no accepted park ever used a cruiser re-draw for its train.
2. Next: baseline b7 sweep (908e2f5a) running, then after sweep, look at 6/9/15/1 for identical-search waste.
