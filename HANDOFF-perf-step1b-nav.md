# HANDOFF — perf-step1b-nav (120 fps plan steps 1b + 7; one of 12 packages, no PR of its own)

Start ref: origin/perf/navgrid-other-space (#751 + the other-space follow-up). Integrator merges this branch.

## Done
- `NavGrid.warm(sample, budgetMs)`: a whole lattice laid in resumable passes (boundary rows, solid rows,
  bridge rows, paving, level cells), stamped with the revision it BEGAN at so mid-build collider changes
  are a patch's. `ensureLattice` finishes a pending build's remainder for a question that cannot wait.
- `Game.warmNavigation()` each tick, and each cat-bus ride frame from `main.ts` (one hunk).
- `check:nav-warm`: its own script entry, run in CI BEHIND `check:nav-spaces` (shard 6) — that entry ends
  `&& pnpm run check:nav-warm`, as `check:crowd` carries the npc checks. Do NOT also add it to a shard (it
  would run twice). Review fix, 13 Nov: unwired, `check:chain-coverage` was red on e427f160 ("check:nav-warm
  is defined in package.json but no workflow can reach it"); wired, it is green, 110 of 110 leaves reachable.
  `LGP_PARK_RESTART=1 pnpm run check:nav-spaces` on 759039b4 (AFTER the base merge; seed 5, Node) ran both
  and exited 0: nav-spaces 295 room solids, 0 whole park rebuilds, 0.3 ms; nav-warm her lattice 182 slices,
  longest 4.33 ms; children's 146 slices, longest 2.57 ms; mid-build colliders 169 slices, 1 patch, 40 of 40
  dropped; every sliced lattice equals a whole rebuild. No mutation was re-run on the merged head.
  Mutations: `NAV_WARM_MUTATE=sync`, `NAV_WARM_MUTATE=short`.
- Node checks here were run with `LGP_PARK_RESTART=1` (seed 5's accepted restart at four sibling source
  hashes): the acceptance loop at this hash costs ~7 min per restart on the shared Mac.

## Measured (seed 5 restart 1, Node, commit 051415e6 — before the base merge; the merge changed no nav file)
- check:nav-warm green: her lattice 304 slices, longest 14.6 ms (lone run; 39–75 ms when four runs shared
  the Mac), 0 built as one task, equals a whole rebuild. `sync` mutation red (10 failures). `short` mutation
  stayed GREEN — the equality clause has no red proof (see the check's header).
- check:nav-spaces green (0 whole park rebuilds, 0.5 ms) and red with NAV_SPACES_MUTATE=whole (1 whole, 1740 ms).
- NOT run after merging origin/perf/120fps-base: any check. tsc + typecheck:test only.
- `Hotel` ramp `covers()` (now in hotel/interior.ts): squared-distance far-reject; unmeasured.

## Not done (see the workflow result for detail)
- Resumable A* (`findRoute` still one task per tap / NPC plan). Design: begin/advance/finish on NavGrid with
  `findRoute` = all three; `TapNavigator.planRoute` leaves the route empty while pending (it already steers
  straight at the target with no route); the parade shares her grid, so a pending search must not share
  the scratch buffers with a synchronous `findRoute`.
- The park children's grid (`JourneyPlanner`) is not warmed: first plan still builds it in one task.
- `surfaces.ts` has no `Math.hypot`/`sqrt` at this ref: nothing changed there, allocation rate unmeasured.
- Which pass the longest slice is in (48 solid rows, paving and the finish are one piece each) is unmeasured.
- `warm` patches as soon as the revision moves: colliders registered over many frames in HER space are a
  patch a frame (was one at the next question). A one-frame debounce was considered and not written.
- Inherited: `check:nav-spaces` sits in `check:shard-6` from the predecessor's commit 40bdf7d0.
