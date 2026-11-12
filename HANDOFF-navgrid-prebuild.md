# HANDOFF — perf/navgrid-prebuild (step 1b of the 120 fps plan, #746)

Branched from perf/navgrid-incremental (#751, step 1). Rebase onto main once #751 merges.

## Problem (measured on the shipped build, M4 Pro, docs/perf/FRAME-DROPS-2026-11.md)
- First tap of a session: 526 ms frame — `onTap → handleTap → planRoute → findRoute →
  ensureLattice → rebuild` (her lattice built lazily; 78 % ground sampler, `Hotel.covers` 24 %).
- Every tap: 37–42 ms of A* (`search`/`forEachStep`) in one frame.
- NPC route plans at start: 41–51 ms each (`journey.plan → findRoute`), several in the first 2 s.
- Boundary change (entering a space) still rebuilds her lattice whole — step 1 only patches collider changes.

## Plan
1. **Sliced lattice build**: make `NavGrid.rebuild` resumable (phases: boundary rows, outline,
   circles/walls/boxes by index range, bridges rows, paving, levels rows, finish), with
   `advanceBuild(budgetMs)`. Same passes as step 1's factored `stampBoundary/stampSolids/
   exemptBridges/levelCell` — slice those by row/collider range. `NAV_GRID_BUILDS.verify`-style
   equality with a one-shot rebuild is the proof.
2. **Warm during the bus ride**: main.ts already runs `ShaderWarmup.advance(budget)` per ride frame
   (lines ~1220–1265, `director.shouldWarmShaders()`); add the player's grid (`playerNavGrid`,
   Game.ts) and `JourneyPlanner`'s garden grid, sharing the same `WARMUP_BUDGET_MS`, and fold
   "lattices built" into `JourneyDirector.parkFitToPlay` (the one owner of hand-over).
   Deep links (`/spawn`, no bus): build sliced over the first frames before control.
3. **A* budget**: per-tap/plan search 37–51 ms. Either make `findRoute` resumable (callers
   `TapNavigator`, `journey.plan` hold a pending plan and follow on completion) or cut the search
   (it is ~360k cells for the park). Measure node expansions per plan first.
4. **Check** (count-based): in `check:tap-dash` or a new clause — 0 whole lattice builds after
   hand-over; max A* expansions per frame ≤ budget. Prove red first.

## State
- Nothing implemented yet. Worktree `.claude/worktrees/navgrid-prebuild`.
