# HANDOFF: sb-fountain

Model: Claude Opus 5.5, chosen by the structural-backtrack engineer.
Branch `fix/sb-fountain` (from origin/wip/sb-merge). Scope: seeds 0..15 at recorded restarts.

Task: `check:fountain-hop` failed in another branch's CI on seed 10 r0
("route ends at 0.307 m against 0.295 m water", tolerance 0.01 m).

## Findings so far

- On this branch seed 10 passes at r0 (0.544 vs 0.544) and r1 (0.572 vs 0.564, 8 mm).
- Hypothesis (instrument/geometry, not a decision): `NavGrid.findRoute` sets
  `routeEndY = nodeHeight[endNode]`, the level sampled at the goal *cell centre*,
  not at the goal point, although its doc says "the goal's own level when it was
  reached". The wading surface is a tilted plane (Fountain.waterSurfaceY, ~0.35 m
  across 7.8 m), so the error is slope x offset-from-cell-centre, up to ~16 mm
  on a 0.5 m cell. The check's 0.01 m tolerance sees it on some parks only.
- Fix planned: when reached, report the goal node's level sampled at the exact
  goal point (`sample(goalX, goalZ, nodeHeight[goalNode])`).

Sweep script and logs: scratchpad `sb-fountain/sweep.sh`, `sweep.txt`.
