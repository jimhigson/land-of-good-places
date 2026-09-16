# HANDOFF — seed 24 unbridged rail crossing

Branch `eng/seed24-rail-crossing`, cut from `origin/eng/sphere-six-reds` (where it
fires); fix is in files six-reds does not touch, so it moves onto
`feat/sphere-combined` by cherry-pick. PR target `feat/sphere-combined`.
Model: Opus 5. Worktree `.claude/worktrees/seed24-rail-crossing`.

## Verdict: SITING, not routing (measured)

Offending edge: `spur-stall.spookyHouse` (edge 11). It crosses bridge site
railD 0 into the loop, then zigzags across a **neck** of the loop between
railD ~33-39 and ~149-154, where the two limbs' centre lines are **4.0 m apart**
((23.9,-29.6) vs (26.0,-33.0)) — the fences (2.0 m each side) overlap.

Flood fill of ground clear of rail by FENCE_OFFSET + PLAYER_RADIUS (2.62 m),
scratch `scripts/zz-seed24-regions.mts`:
- 3 regions: outside 65100 m2, lobe A 702 m2, lobe B 545 m2.
- both CROSSING_SITES (railD 0, 180) join outside <-> lobe A.
- `stall.spookyHouse` (10.6,-53.6) is alone in lobe B. No bridge candidate fits
  anywhere on lobe B's rail (explainBridgeRefusal over the whole loop, 2 m
  steps: only railD 0-20, 180, 226-228, 238-240 have an OK fit).
- CONTROL: same instrument at clearance 0.3 m opens the neck -> 2 regions, lobe
  B merges with lobe A. So the instrument can see connectivity.

No legal leg to the stall exists; the router was handed an impossible target
and its rail-side clamping (local side, ambiguous in a 4 m neck) drew one.

## Cure (in progress)
`loopKeepsItsCrossing` (train/route.ts) gains a clause: every plot (PARK_LAYOUT
entry), the gate walk, lie in the two regions the start-pose bridge joins. A
loop that walls a destination off in an enclave is rejected; the search moves
to the next pose (same mechanism as the gate and station clauses).
