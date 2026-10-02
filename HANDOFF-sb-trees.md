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

## BEFORE (base a2c88976 + ledger, each seed at recorded restart): seed restart trees climbable candidates-to-72
0/8 72 37 1763 | 1/2 72 36 4165 | 2/5 72 48 1560 | 3/2 72 36 1468 | 4/7 72 28 2019 | 5/0 72 31 1761
6/5 73 41 1265 (1 cover) | 7/3 73 36 1311 (1 cover) | 8/4 72 32 6362 | 9/3 72 41 1495 | 10/3 72 42 4201
11/4 72 34 932 | 12/0 72 40 1600 | 13/2 72 34 1428 | 14/6 72 35 3484 | 15/5 72 40 2794
Sampling area ~18185 m2 on every seed (boundary area ~constant), so "density x area" = a constant budget.
Next: curve run (cap removed, budget 8000, uncommitted) to get trees(N)/climbable(N) per seed.

## Curve (cap removed, budget 8000): trees/climbable at N candidates, per seed
Sum |trees-72|: 1200->210, 1400->167, 1600->143, 1800->143, 2000->162, 2500->189. min climbable at 1800: 27 (seed 4).
Seed 8 accepts only 76 trees in 8000 candidates (lawn-limited); seed 11 accepts 125.
Decision: fixed candidate density TREE_CANDIDATES_PER_M2 = 0.1 (~1819 candidates). Committed. Reason in the constant's doc.
Test: scatterDecoupling now loops PARKS = canonical + seed 12. Running default + LGP_SEED=3.
TODO: control (old cap code + new test -> seed 12 red), after-measure 16 seeds, park:attempt x16 at recorded restarts,
update the doc numbers in Scenery.ts with the measured after table.

## Results so far
- Control (old 72-cap Scenery.ts + new test): seed 12 red, 14 strays 30.1-45.8 m (2 trees, 12 bushes). Fixed: 9/9 green
  default (5 + 12) and LGP_SEED=3 (3 + 12).
- AFTER trees/climbable: 72/37 50/33 77/48 75/37 68/27 73/31 79/42 77/39 47/29 79/44 55/35 86/40 73/40 76/36 59/29 56/33
  (seeds 0..15). Min climbable 27 (seed 4) > 24. Cover pass planted 1 on seed 6 only.
- park:attempt x16 at recorded restarts: running -> scratchpad sb-trees/attempts.txt
- park:attempt at each recorded restart: all 16 seeds built and accepted (109 measures each). DONE.
