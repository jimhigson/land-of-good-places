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

## Done (pushed)

- 57b51869: check:fountain-hop clause 2b, taps on 4 rings (46 goals) across the basin,
  each must end within 10 mm of the water under the tap. Makes the check independent
  of lattice phase.
- 4e838d98: NavGrid.findRoute, reached => routeEndY = sample(goalX, goalZ, nodeY).
- Verdict: instrument/geometry, NOT a decision. No acceptance measure added.
- Baseline sweep (old NavGrid + new clause) running from detached worktree
  `.claude/worktrees/sb-fountain-base` -> scratchpad before.txt. Then sweep fixed
  code -> after.txt; then check:nav-routes, park:attempt canonical + seed 2 r0.
  Remove sb-fountain-base worktree at the end.

Baseline (old NavGrid, 57b51869) at recorded restarts: centre clause green 16/16;
basin clause red 10/16 (s0 13.2, s2 12.9, s7 13.8, s8 14.0, s9 12.4, s10 12.6,
s11 16.2, s12 14.2, s14 10.4, s15 10.3 mm), green s1 9.1 s3 8.3 s4 4.6 s5 7.4 s6 5.4 s13 7.1.

Sweep script and logs: scratchpad `sb-fountain/sweep.sh`, `sweep.txt`.
