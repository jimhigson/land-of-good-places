# HANDOFF: sb-trees

Model: Claude Opus 5.5 (chosen by the structural-backtrack engineer). Branch fix/sb-trees off origin/wip/sb-merge @ 47fe3f80.

Task: the tree scatter's global TARGET_TREES=72 count is non-local (seed 12: 3 trees lost near a bowed spur
-> candidates #70-72 planted 31-44 m away). Make it local by construction, no re-record (the requester re-records).
Then: scatterDecoupling on seeds 5, 12, 3 (12 must pass); park:attempt at each seed's recorded restart (all 16;
report failures, they are information); trees + climbable per seed before/after.

## Steps
1. Instrument: `treeScatterLedger` in Scenery.ts + scripts/measure-tree-scatter.mts. Measure BEFORE on 16 seeds.
2. Choose: fixed candidate budget by density (N = density x sampling area) vs per-cell quota. Leaning density:
   it is what bushes already do (BUSH_BUDGET), and the planted set is a prefix-or-extension of today's stream.
