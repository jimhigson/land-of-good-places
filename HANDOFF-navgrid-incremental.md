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

## State (12 Nov)
- PR #751 open. Green + both mutations red, outputs in the PR body.
- Before/after (Node, check:library): 5 whole rebuilds 1,522 ms (worst 482) -> 5 patches 3.0 ms (worst 1.9).
- Local `check` fails only on the main-wide precache limit (#747); `test:procgen` seeds 3/10/14 timed out
  solving locally. When #747 merges: merge main, re-run CI, add browser after-number from the preview.
