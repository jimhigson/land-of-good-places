# HANDOFF: paving-drape (fix/paving-drape)

- Model: **Opus 5.5** (claude-opus-5-5), spawned by the Overseer as an Engineer. A replacement runs the same model.
- Branch stacked on `fix/procgen-last` (#698) per Overseer; rebase onto its head as it moves; PR targets
  `fix/procgen-last`, retarget to `feat/procgen-on-sphere` once #698 merges.

## Root cause
`drapePathsOverBridges` lifts every paving vertex inside any bridge's drawn stone, whichever route owns it.
That is only right if no other route stands on a bridge's ground; the router broke that promise in many
places, so paving hung as sheets up to 4.6 m tall. Base sweep (e982430b, seeds 0..199): 197 built,
170 with sheets, 965 sheet places. All five test seeds red on the new invariant at base.

## What the branch does
- Invariant `noDrawnPavingStandsUpAsASheet` (test/procgen/invariants.ts): edge rise > BUILDING_STEP_UP at
  grade > SPRINT_LOCAL_GRADE_CEILING, measured with altitudeAt.
- One owner of the question: `drawnBridgeTrespass` / `drawnMetresOnABridgeUncarried` (paths.ts).
- One owner of the repair: `keepRouteOffBridges`, applied to every route as it joins the graph (spurs,
  stations, connectors, gate approach, street taps) — cuts each trespassing stretch between clear anchors
  (widening up to 4 control points each way) and re-routes it by manhattanRoute, then by a street-grade
  gridDetour (real plot footprints, own rail side, bridges as obstacles).
- Producers still consult the same question when choosing between candidates (fallbackSpurRoute,
  spur lattice-vs-fallback, gate approach candidates, station tails, routeLeg site choice, connector
  refusal) — removing them was measured to regress canonical (the repair cannot invent a route out of a
  pocket sealed by a ramp + rainbow feet + rail; choosing another candidate can).
- Router geometry: exact ramp screen vs built stone width; elbow/gridDetour treat bridges as obstacles,
  gridDetour holds its rail side and straightens staircases; lattice nodes refused on stone; snap never
  moves a run onto a bridge; foot stubs prefer to leave the ramp; gate corridor keeps rail standoff and
  stays off bridges.
- Planner: shared deck sized to widest path (crossings.ts); proven sites keep a 3 m landing apart on their
  proven reach; sites whose ramps reach the ring are refused (crossingPlanSolve.ts).

## Status
- Sheets on the five test seeds at head: none.
- Running: test:procgen head (scratch head-procgen-2.log); then base (698 head) for the name+message diff.
- Still to run: check:park (affected seeds), check:coplanar, check:swept-bus, check:entrance-road,
  determinism, 0..199 head sweep, after frames, PR.

## Tools (scratch: /private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/paving-drape/)
sheet-measure.mts, classify.mts, diag5.mts, lattice-plot.mts, sweep.sh <worktree> <from> <to> <out>,
base-a/b.txt (base sweep), before-*.png / after-*.png (seed 131). `LGP_DEBUG_STREETS=1` prints
`[bridge-repair]` lines. Extra worktree: .claude/worktrees/paving-drape-base (at 698 head).
