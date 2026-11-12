# HANDOFF — perf/navgrid-incremental (step 1 of the 120 fps plan, #746)

Goal: the owl's moving collider (story time) must never trigger a whole NavGrid
rebuild (measured 483–649 ms M4 Pro, ~2 s phone stand-in, twice per story).

## Done
- `Collision.ts`: a 256-entry ring logs each revision's plan footprint
  (`forEachChangeSince`); clear/retopCircles/demote log "everywhere".
- `NavGrid.ts`: `patch()` redoes boundary/solids/bridges/levels only in cells
  within walker radius + 2 cells of each change, copies the rest; >25 % of the
  lattice or an uncovered change -> whole rebuild. `NAV_GRID_BUILDS` counts and
  times builds; `verify` compares every patch to a whole rebuild.
- `check:library` STORY: NAV REBUILDS clause (0 whole, ≥1 patch, all verified).
  Mutations: `nav-whole-rebuilds` (patching off) and `nav-short-patch` (no margin).

## Todo
- Green run, then both mutations red (paste output in PR).
- check, test:procgen; PR with before/after ms vs 8.3 ms.
- check:library solves a park on first run at a new source hash (~10–20 min).
