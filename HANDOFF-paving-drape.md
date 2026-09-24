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

## Status (STOPPED by Overseer, mid-work)
- Sheets: none on the five test seeds (invariant green on all five).
- Last full run (head before the last commit's siblings — see scratch head2-*.log):
  test:procgen 2 failed | 706 passed (lattice: seed 11 spur-building x=42; seed 131 gate-approach z=46.16),
  caused by relaxing gridDetour's rail clearance to side-only (commit "gridDetour holds only its rail side").
  Base (#698 head b1ea1f6a): 1 failed | 702 passed (bushes seed 11).
- check:park-pool PASS 10/10 (base FAILS seed 128); every-seed-builds 16/16; gateway, swept-bus,
  entrance-road, walk-reach exit 0.
- check:coplanar exit 1 on head AND base: head 10 new/worse vs base 10; head drops base's path-kerb|path-surface,
  adds entrance-gateway-path-kerb-left|path-kerb, and reports BASELINE LOOSE (bridge wallTop|terrain gone).
- Not yet done: fix the two lattice fails (idea: snap gate-approach gateway solvers / grid detours onto the
  lattice), determinism digest x2, head 0..199 sweep, planted control for the test diff, pnpm run check, PR.
- Site-level changes alter parks: seed 326 re-solves its train (ring/landing rules leave first loops no site);
  seed 11 re-plans crossings without the site at railD 236 (walled-in rule). Canonical: no unwinds.

## Tools (scratch: /private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/paving-drape/)
sheet-measure.mts, classify.mts, diag5.mts, lattice-plot.mts, sweep.sh <worktree> <from> <to> <out>,
base-a/b.txt (base sweep), before-*.png / after-*.png (seed 131). `LGP_DEBUG_STREETS=1` prints
`[bridge-repair]` lines. Extra worktree: .claude/worktrees/paving-drape-base (at 698 head).
