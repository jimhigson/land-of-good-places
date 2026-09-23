# HANDOFF: paving-drape (fix/paving-drape, base feat/procgen-on-sphere @ e982430b)

Task: paving draped onto a bridge a path only crosses (seed 131, bridge at (-2.2,40.3)) → 4.4 m sheets.

## Root cause
- `drapePathsOverBridges` lifts every paving vertex inside ANY bridge's drawn stone, whatever route it
  belongs to. Correct only if no other route enters a bridge's ground — the router's promise, broken in
  many places. The drape is left as is; the router is fixed.
- It is park-wide, not seed 131: at base the new invariant is red on ALL FIVE test seeds (canonical 7
  places up to 4.27 m, 326 4.44 m, 11 4.32 m, 24 4.23 m, 131 4.48 m) and most of seeds 0..199.

## Causes found and fixed (src/world/paths.ts unless noted)
1. Gate corridor (authored x=0 run) never screened for rail standoff or bridges unless the loop crossed
   x=0 → seed 131 corridor ran 0.65 m from the rail through a bridge. `gateCorridorClearAt`.
2. `segmentCutsABridgeRamp` sampled at 1.5 m against a 0.5 m band → exact clip in site frame; and
   measured against the BUILT stone (<= 2.33 m half) not site.halfWidth (4-5 m): only along-axis
   on-axis entry allowed.
3. elbowLeg/gridDetour (same-side legs) treat bridges as obstacles (`segmentEntersABridge`).
4. Shared deck sized for widest path through it (crossings.ts `spineThrough`).
5. `drawnMetresOnABridgeUncarried` (drawn curve, ribbon reach) screens: connectors (refused),
   fallbackSpurRoute (passed over, least-bad kept), street spurs (lattice plan vs fallback, less wins),
   gate approach candidates (lexicographic price), station tails, routeLeg site choice.
6. Lattice nodes refused on bridge stone; snapRunsToLattice never moves a run onto a bridge;
   crossing-tap foot stubs prefer ones that keep off bridges.

7. gridDetour straightens its staircase (fewest walkable elbows) — staircases broke the lattice invariant.
8. crossingPlanSolve footprintsOverlap uses proven ramp reach + 3 m landing (131 had two sites end to end).

## test:procgen
- base e982430b: 5 failed | 693 passed (bushes 11, coping 11, coping 131, detour 131, rainbow 326).
- head @ dc567ccf^ (before 7/8): 12 failed | 687 — new: lattice (11 gate, 131 gate, 24 stall.dodgems),
  rainbow canonical, cruiser supports 326, sheets (24, 131, canonical), scatterDecoupling crash (fixed).

## Status (sheet places on test seeds, head)
- after 8: 326 clean; 131 main-loop x2 (ring passes a ramp end, 1.0 m); canonical station-1 tail 0.81 m;
  24 spur-stall.dodgems (fence-follow / double crossing of one bridge, up to 4.23 m);
  11 spur-building + gate-approach near (-21,46) (fence-follow garbage, up to 4.16 m).
- Remaining causes: fenceFollowRoute / doubleCrossingLeg are not bridge-aware; ring vs ramp end is a
  site-planner question (ramps reaching the ring).
- Idea not yet built: one repair pass per route (replace any stretch standing on a bridge with a
  bridge-avoiding axis detour) instead of screening each router.
- Invariant `noDrawnPavingStandsUpAsASheet` in test/procgen/invariants.ts.

## Tools (scratch: /private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/paving-drape/)
- sheet-measure.mts (mirror of the invariant), classify.mts (owner route per sheet), diag5.mts
  (runs inside each bridge; RUNS=… prints routes), sweep.sh <worktree> <from> <to> <out>.
- Base sweep running: base-a.txt (0..99), base-b.txt (100..199) from worktree paving-drape-base.
- before-0.png / before-1.png: seed 131 frames at base.

## Next
- test:procgen diff vs base; check:park/coplanar/swept-bus/entrance-road; head sweep; after frames; PR.
- #698 (fix/procgen-last) touches connectors + fallbackSpurRoute: expect conflicts there.
