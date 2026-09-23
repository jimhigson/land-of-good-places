# HANDOFF — coplanar-clear (PR #701), stopped on Jim's halt

Branch `fix/coplanar-clear`, rebased onto c190ba58. No uncommitted work.

## State
- 9 of 10 coplanar findings fixed; remaining NEW path-kerb|path-surface (bridge-ramp junctions, cause in
  drapePathsOverBridges vertex-by-vertex lifting) is stated in the PR, not baselined, handed to a new engineer.
- Kerb review fix done (0 eye-visible drops on 10 seeds, reviewer probe at 0.05 m ray step).
- Duck bar alert painted on the bar (sleeve deleted); stone walls placeOnSphere. `pnpm run check` exit 0 (pre-rebase to c190ba58).
- PR body is current except it does not yet mention the collider task below.

## Next step (not started): stone-wall collider covers the drawn wall
- Collider is a capsule (segment + halfThickness, Collision.ts). Drawn wall+coping in plan: half-width 0.36
  (coping depth 0.72), ends 0.10 past the run ends (coping length+0.2). Plan: constants.ts owns
  STONE_WALL_DEPTH 0.55, STONE_COPING_DEPTH 0.72, STONE_COPING_END_OVERHANG 0.1 and
  STONE_WALL_COLLIDER_HALF = hypot(0.1, 0.36) = 0.3736 (capsule then contains the coping rectangle);
  Scenery.buildStoneWalls builds from them; WALL_HALF_WIDTH.stone = STONE_COPING_DEPTH/2.
- Re-march (scratchpad/probes/_wallmarch.mts, leaning-frame hull) target ~0 cm; currently 6.8 cm reachable / 8.3 all.
- Then prove nothing newly blocked: check:park LGP_SEED 0..15 (before logs already in
  scratchpad/coplanar-clear/park/before-*.log, runner park/run.sh <tag> <seed>), check:walk-reach,
  check:hop-clearance (thickness is in HOPPABLE_WALL_HALF_THICKNESSES), keepOutsFor reachability with a control.
- Rebase onto newest base, re-run check:coplanar, test:procgen diff, check.
- Remove this file before merge.
