# HANDOFF — nav-resumable (120 fps plan, step 1b second half)

Branch `perf/nav-resumable`, worktree `.claude/worktrees/nav-resumable`, from origin/main 34f20970.
Dev server: my own, port 6031 (`pnpm exec vite --port 6031 --strictPort`), kill by PID when done.

## Brief
A* resumable across frames (≤ ~2 ms of route-finding a frame), taps still instant, routes identical,
doorway taps still work, NPC plans under a per-frame budget; the ~505 ms castle-entry lattice freeze
from #759's QA checked on main; a check measuring max search ms per frame across a scripted session,
with a control. No PR (a later stage opens it).

## Baseline, measured before any change (M4 Pro, Chrome for Testing 151 headless, real GPU, dev build, seed 5)
Instrument: scratch `nav-frames.mjs` wraps NavGrid.prototype.{findRoute,warm,canStandAt}, attributes
each call to the rAF interval it ran in.
- Park (`/spawn?pos=2,6&facing=180&seed=5&perf=1`, 16 taps 4–80 m): worst nav frame **33.5 ms**
  (her far tap; interval 39.8 ms), 33.4 ms (37.9 ms frame); children's plans 16.0 ms, 5.1 ms.
  3 frames with > 8.3 ms of nav in 12.8 s.
- Castle mall, 60 s standing (`/castle?deck=0&seed=5&perf=1`): the children's mall grid is built
  whole on the first child's plan inside (~t+25 s): **55.2 ms** of `findRoute` → a **73.2 ms** frame.
  Children's far plans 34.9–36.9 ms (43–45 ms frames). 8 frames > 8.3 ms of nav in 60 s.
- Node (seed 5, loaded Mac): her park lattice 379² cells, 72,441 nodes, warm 187 slices / 426 ms,
  worst slice 5.77 ms. A* ≈ 2,000–2,100 expansions/ms; unreachable/blocked goals flood ~66k nodes
  (34 ms); median far tap 12k expansions. Smoothing ≤ 0.5 ms, reconstruct ≤ 0.02 ms.
  Children's castle grids: mall 114 ms, hall 100 ms, roof 18 ms whole builds.

## The 505 ms freeze from #759's QA
It was the **park's** pinned grid rebuilt whole when the castle's colliders bumped the revision —
already gone on main (#764's patching: a change off the lattice is a no-op patch; check:nav-spaces).
What **does** still exist on main's eager castle is the smaller sibling above: a castle floor's
children's grid built whole inside the first child's plan (55 ms / 73 ms frame). Fixed here: every
lattice a route needs is laid by `NavGrid.warm` in slices under the frame budget, never inside a plan.

## Design (done so far)
- `NavGrid`: search scratch moved into `SearchContext` (one for sync `findRoute`, one for the request
  being answered in slices). `beginSearch`/`stepSearch` are the old `search` split at the loop top;
  `advanceRequest(request, deadline)` warms the lattice if needed (sliced), begins/continues the A*,
  finishes with the same reconstruct+smooth. `generation` bumps on every build start/end and patch;
  a paused search on an old generation is begun again.
- `src/world/routeScheduler.ts`: `RouteRequest`, `RouteScheduler` (budget = NAV_WARM_BUDGET_MS = 2 ms
  for warm + search together), priorities player < companion < crowd.
- Equality proved (scratch `compare-routes.mts`, untracked `src/world/NavGridMainCopy.ts` = main's
  file — DELETE before the final push): 750 questions over her park lattice, the children's park
  grid and her three castle floors — main's findRoute vs the refactored findRoute vs sliced answers at
  0.05 ms/frame: **0 mismatches** (every float, reachedGoal, endY).

## Next
Wire TapNavigator (walk straight while pending, no dash until the route lands), JourneyPlanner/Journey
(-1 while pending), PetRoute/Parade (keep walking the old route, hold if none), Game (scheduler,
keepWarm her grid, warmNavigation = beginFrame + run). Then check:nav-frame, then browser after-numbers.
