# HANDOFF — nav-resumable (120 fps plan, step 1b second half)

Branch `perf/nav-resumable`, worktree `.claude/worktrees/nav-resumable`, from origin/main 34f20970 (main had not
moved at 17:00 13 Nov). Dev server: my own on 6031; a main baseline worktree `nav-resumable-baseline` on 6032 —
both to be killed by PID and the baseline worktree removed when done. No PR (a later stage opens it).

## What changed
- `src/world/routeScheduler.ts` (new): `RouteRequest`, `RouteScheduler`. One budget a frame (`NAV_WARM_BUDGET_MS`,
  2 ms) for lattice warming AND search together; her grid kept warm first; requests by priority
  (player < companion < crowd), oldest first. `beginFrame`/`endFrame` (Game.tick start/end): an ask made between
  frames (a DOM tap) is answered at the next frame's start, out of that frame's budget, still before
  `TapNavigator.update` — without this a tap spent a second 2 ms budget in the same display interval (measured 4.0 ms).
- `NavGrid.ts`: search scratch in `SearchContext` (sync `findRoute` and the sliced request each have one);
  `beginSearch`/`stepSearch` = the old `search` split at its loop top; `advanceRequest(request, deadline)` lays the
  lattice if needed (sliced `warm`), runs A* to the deadline (clock checked every 256 expansions), finishes with the
  same reconstruct+smooth. `generation` bumps on every build start/end/patch/shelve; a paused search on an old
  generation is begun again. Lattice pieces finer (solid rows 48→12, level cells 128→64) since warm shares the 2 ms.
  **Shelf**: a grid that follows her (playBounds) shelves the lattice she leaves and takes it back (then patches)
  when she returns — the park's lattice is no longer re-laid on every way out of every room.
- `TapNavigator`: asks the scheduler; short routes answered before the tap's frame steers; long ones leave the route
  empty, so she walks straight at the target (the old unrouted seek) and turns onto the route when it lands. No dash
  until the route has landed (judged on the route). A pending walk is held to the target's level for arrival.
- `journey.ts`: `JourneyPlanner.useScheduler`; `plan` returns -1 while a child's plan is in flight (the old
  "ask again next frame"); `forget` when a trip is dropped. PLANS_PER_FRAME kept (caps new asks per frame).
- `petRoute.ts`/`Parade.ts`: a companion keeps walking its route while a new one is found, holds still if it has
  none, never re-asks over a question still being answered.
- `NpcSystem.useRouteScheduler`, `Game` wiring (`routes`, keepWarm her grid, `warmNavigation` = beginFrame + run).
- **No scheduler = no change**: every Node check that builds a navigator/planner/parade itself plans synchronously,
  exactly the old code.
- `scripts/check-nav-frame.mts` + `check:nav-frame`, chained behind `check:nav-spaces` (shard 6), like nav-warm.

## Measured — before (main 34f20970) vs after (this branch), M4 Pro, Chrome for Testing 151 headless, real GPU, dev
Instrument: scratch `nav-frames.mjs` (wraps NavGrid/RouteScheduler methods, attributes each call to its rAF interval).
Timer quantised to 0.1 ms. Machine loaded (other agents + my full check), so interval tails are noisy; nav ms is not.
| scene | worst nav ms in one frame, before → after | worst frame interval, before → after |
|---|---|---|
| park, 16 taps 3–80 m (`/spawn?pos=2,6&facing=180&seed=5`) | **33.5 → 2.1** (3 frames > 8.3 ms → 0) | 39.8 → 21.3 |
| castle mall, 60 s standing (`/castle?deck=0&seed=5`) | **55.2 → 2.3** (mall grid built in a child's plan → sliced) | 73.2 → 28.9 |
| first tap after boot (`/spawn`, tap at frame ~4) | **256.9 → 2.7** | 268.9 → 26.0 |
| walk in by the front door, walk out, tap at once | **313.0 → 2.1** (route landed in 1–2 frames: the shelf) | 319.3 → 25.6 |
| `/castle?deck=0` deep link, walk out, tap at once | **274.4 → 2.6** (no park lattice was ever laid: walks straight ~0.6 s) | 282.2 → 39.3 |
Taps: she moves on frame 1 (once 2–3) after every tap; far/flood taps get their route after 16–22 frames
(~150 ms at 120 Hz on the M4; ~4× that on a phone) and walk straight until then.
Filmstrip (phone viewport, far tap onto the castle's back wall): scratch `filmstrip/far-tap-filmstrip-small.jpg` —
main: 44 ms A* in the tap, dash at once; branch: 0.2 ms, walks straight 166 ms, then the same route and dash.

Node, `check:nav-frame` (seed 5 restart 1, thread CPU): worst frame 3.13 ms (cold JIT warm slice), p99 2.23 ms,
84/84 answers equal to a whole search float for float, 0 lattices laid in one task, set off ≤ 1 frame of every tap.
Equality vs main's own NavGrid (scratch `compare-routes.mts`, main's file copied in, since deleted): 750 questions,
her park lattice, children's park grid, her three castle floors, sliced at 0.05 ms/frame: **0 mismatches**.

## The 505 ms freeze from #759's QA — answer
It was the **park's** pinned grid rebuilt whole when the castle's colliders bumped the revision: gone on main since
#764 (a change off a lattice is a no-op patch; check:nav-spaces). On main's eager castle the smaller sibling still
existed: a castle floor's children's grid laid whole in the first child's plan — 55 ms / 73 ms frame, measured above.
Fixed here: every lattice a route needs is laid by `warm`, sliced under the 2 ms budget.
**For the lazy castle (#759) nothing needs calling.** Register the castle's colliders in the iris midpoint before or
alongside `setPlayBounds` (as #759 does): her floor lattice starts laying on the next frame (RouteScheduler.keepWarm,
~50 ms of work in Chrome → ~25 frames, done behind a 280 ms iris), and the children's floor grid is laid the same
way on the first child's plan. Do NOT call `findRoute`/`canStandAt`/`nearestStandable`/`reachableFrom` on a castle
grid from the furnish: those still lay a lattice whole, in one task.

## Not done / found, for whoever is next
- **Patches are still one task** inside `warm` (a collider came or went). Small in play (0 in the check's session);
  a burst of 24 colliders dropped at once in the park cost ~17 ms (Node). If a feature ever registers a big burst in
  a lattice's area at runtime, slice `patch` (idea: batch the change log by revision prefix, builtRevision = the
  last revision patched).
- **The put-down rule's windows** (`world/dismount.ts`, `NavGrid.around`) are laid whole when she is set down (each
  door, a wedge rescue): 10 calls in the check's session, worst 7.6–10.7 ms (Node). Not route search; reported by
  check:nav-frame every run, not asserted. Cost is `stampSolids` offering every collider in the world to a 27² window
  — a spatial query in CollisionWorld would make it ~free. Owner: the put-down rule.
- **Moving colliders and her lattice**: a never-shelved lattice differs from a whole rebuild after ~10 s of
  world.update (cell 127,221 on seed 5; a moving collider's top never bumps the revision). Step 1's rule, pre-existing.
- A far route on a slow phone may take ~60 frames; she walks straight meanwhile. A faster A* (precomputed per-node
  radial heights would remove `riseBetween`/`spaceAt` — 40% of A* self time) would shorten that without changing
  routes; not done.
- Docs: docs/perf/FRAME-DROPS-2026-11.md not edited (shared with five parallel items).

## Checks run on this branch (exit codes read directly)
tsc 0; typecheck:test 0; check:chain-coverage 0 (119 leaves); check:nav-spaces + nav-warm 0; check:nav-frame 0;
NAV_FRAME_MUTATE=sync → 1 (worst 491.66 ms); NAV_FRAME_MUTATE=deadline → 1 (worst 112.89 ms).
Full `pnpm run check` and `test:procgen`: see below when finished.
