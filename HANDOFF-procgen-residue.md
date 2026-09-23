# Handoff — residual invariant failures (stacked on fix/procgen-last)

Branch `fix/procgen-residue` (worktree `.claude/worktrees/procgen-residue`), off
`fix/procgen-last` + base `c190ba58` merged (merge `7b535ad9`). Model: Opus 5.5
(1M), Overseer-dispatched Engineer. Stopped mid-task on Jim's instruction.

Scope given: fix #2–#6 of the triage (in order 4, 3, 5, 6, 2). #1 (seed 3
sleepers) is #702's. #7/#8 (seed 128 pocket) and #9/#10 (rail-race camera, duck
bar) went to another engineer. Bush counts are Jim's call — leave.

## Done (committed + pushed, each proved red with the fix disabled)
- **#4 seed 428 stations** (`93a6d019`): crowding is a hard refusal in
  `rankedStationDistances`; `planStations` backtracks (DFS over ranked stands).
- **#3 seed 208 arch vs railway** (`3e82e971`): `archFeet(route, at)`;
  `RailRaceRoute` takes `archStandsAt`; `plan.ts` asks the real foot positions
  against `distanceToRailCorridor` at `RAIL_RACE_FOOT_RAIL_CLEARANCE` (2.4, now
  shared with trestle `legacyRefuser` in `dimensions.ts`). The rail corridor is
  not a ground claim yet (stage 5), so no registry exists to query — tell the
  Overseer this is why it is the railway's published distance, not a claim.
- **#5 seed 274 spur off centreline** (`e2df3f65`): `nearestPointOnRoute`
  offers a fillet sample as its corner (a later route ending on the corner had
  squared it away from under the spur).

## Sweep after those three (full invariants, 5 test seeds + 128/208/274/428/451/3/6/15)
base `7b535ad9`: 12 failed | 1504 passed; head `e2df3f65`: 10 failed | 1506 passed.
Fixed: 208 rainbow, 274 spur, 428 stations. **NEW on head (must fix):**
- seed 128 `spur-stall.dodgems` start 0.66 m off centreline — likely the #5
  corner snap: snapping to a corner that then does NOT square (check whether
  the junction test in `squareJunctionCorners` sees it — JUNCTION_SNAP 0.05 —
  or whether the corner is skipped by BLOCKERS/bridge rules after substitution).
- seed 208 kerb ratio moved (220/401) — still the ratio instrument (#2).
- seed 451 bushes 153 -> 157 (Jim's; not a regression).

## Remaining
- **#6 seed 15** off-lattice connector: planned fix = drop the disproportion
  escape from the off-lattice screen in `addInterconnects` (`!plan &&
  !detourIsDisproportionate && carriesAnOffLatticeStreetRun`), since the
  invariant grants no such escape and the alternatives loop now tries other
  decisions; seed 15's pair is only 8.1x (under the 15x detour bar). Verify seed
  11 ballPit/slide-exit detour does not regress.
- **#2 seed 208 kerb**: replace the vertex-count ratio in
  `theDrawnPathRidesOverEveryBridge` with a per-station paired test: every
  carried surface edge vertex has a kerb vertex at the same (x,z) (identical
  floats — see `addPathRibbon` / `addRibbonKerb`), carried; every kerb vertex
  inside any bridge's `covers` is carried; kerb pairs (2k, 2k+1) straddling a
  footprint may leave the outer vertex uncarried only if it is outside every
  bridge. Prove red by deleting kerb on one bridge and by lifting it off the deck.
  Measured on 208: no kerb vertex inside a footprint is uncarried; the ratio
  shortfall is oblique footprint edges at ramp ends.
- Then: full sweep head vs base, check:park 0..15, coplanar, digests, PR.

Tools: `scratchpad/sweep.sh <worktree> <log>` writes temp `_sweep-N.test.ts`
files for seeds 128 208 274 428 451 3 6 15 and runs test:procgen; `names.sh`
extracts name+message for diffing. Base worktree `.claude/worktrees/residue-base`
at `7b535ad9` (remove when done).
