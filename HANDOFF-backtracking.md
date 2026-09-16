# Handoff — backtracking round-robin procgen (every seed builds)

**Model: Fable (`claude-fable-5-1`), Jim's standing ruling for the procgen
rework; a replacement runs Fable.** Branch `feat/procgen-on-sphere` (PR #667
against `feat/sphere-combined`, do not merge — Jim signs off), worktree
`.claude/worktrees/procgen-on-sphere`. One heavy suite at a time; one seed at
a time; kill node processes by working directory when done; never the shared
checkout; never `git stash`.

## The goal (Jim, 16 Sep 2026, overrides every design markdown)

Every park feature through one generic builder interface (advance / back /
retry); the round-robin backtracks on a refusal, to an empty park if it
must; cheap local corrections (move the tree, the lamp) and graduated
accommodation (a stall shifts for a feature that needs the space more,
decided by the stall's own builder) before backtracking; **all of seeds
0..15 build a working park** meeting every existing invariant, no threshold
loosened; deterministic; different parks than today are fine.

## What is built (commits 6d2cecd1, 196c17d0)

- `src/boot/featureBuilder.ts` — `FeatureBuilder { advance*(attempt), back,
  supply, accommodate?, reset }`, `Increment`, `Refusal { blockers,
  consumed, claims?, reason }`, `decisionStream/decisionSeed`.
- `src/boot/parkSolve.ts` — the driver: fixed order, ledger of
  `(feature, section, attempt)`, ladder retry → accommodate (bounded 8 per
  increment, one ask per blocker per refusal, never recursive; precedence:
  earlier in the build order needs the space more, `movable` builders
  always accommodate) → unwind (conflict-directed: to the most recent
  decision among the refusal's `blockers ∪ consumed`; when it is exhausted,
  the next most recent *named* one; only when none remain, the
  chronologically previous — which is what reaches decision zero) →
  decision zero (the layout's restart, counted). `back()` in reverse ledger
  order, `withdrawSection` per increment, `resetPlanCaches()` after every
  unwind. Termination: the attempt vector is lexicographically increasing
  over a finite space (each `supply()` finite; coarse solvers
  `COARSE_ATTEMPT_CAP` = 6; layout `PARK_RESTARTS` = 240); `MAX_UNWINDS`
  4000 is the bug-catcher.
- `src/boot/groundClaims.ts` — sections per feature (`commitSection`,
  `withdrawSection`, `sectionOfClaim`, `refusingClaimIndices`).
- `src/boot/planCaches.ts` — memos derived from a decision register a reset.
- `src/world/parkPlan.ts` — the seven coarse builders (layout → cruiser →
  train(+stations) → slide → crossings → pathGraph → road), the state,
  `planPart(key)`, `solveParkPlanNow()` (headless) / `parkPlanSearch()`
  (browser slices), the trace to stderr on every build (`park-solve:` lines).
  Attempt 0 of every solver is the search the park always made; attempt n
  folds n into the seed. The paths refuse on the drawn-curve crossing screen
  (`train/crossingPredicate.ts`, taken from `feat/crossing-refusal-288`) —
  `computeCrossings` cannot be asked at plan time (it reads the centreline
  `buildPaths` publishes at World time) and fouls falsely.
- Views: `PARK_LAYOUT`, `COASTER_PLANS`, `TRAIN_PLAN`, `SLIDE_PLAN`,
  `CROSSING_SITES`, `PATH_GRAPH`, `ROUTES`, `RAIL_RACE_PLAN`, `STALL_*`,
  `STALLS`, `CASTLE_TOWERS`, `CASTLE_WINDOWS`, `CASTLE_FRAME`,
  `HAZARD_LAYOUT`, `ANCHORS(_BY_ID)`, `SEEDS`, `PLAZA`, `BLOCKERS`,
  `RING_COMPASS_POINTS`, `FERRIS_WHEEL_EXIT`, `ROOF_SLIDE_GAPS`
  (`boot/lazyView.ts`: a Proxy forwarding to the decision as it stands).
  Live `let`s rebound by `bindCastlePlacement`: `BUILDING_CENTRE_X/Z`,
  `BALL_PIT_X/Z`, `BALL_PIT_FLOOR_Y`, `BUILDING_BASE_Y`, `INTERIOR_GROUND_Y`.
- `boot/parkGeneration.ts` drives `parkPlanSearch` a slice per frame; the
  five prewarm letterboxes are deleted. `World` adopts `parkPlanClaims()`.

## The two import-order rules (both cost hours; both instrumented)

1. **Nothing may read a plan view at module scope** in any module the solver
   graph imports — it would force the driver while a solver module is
   mid-evaluation (TDZ), or bake NaN (`BUILDING_CENTRE_X` before the layout).
   `scripts/_scan-plan-reads.mts` (untracked, in the worktree) lists every
   such site in one run under `LGP_PLAN_NO_FORCE=1` (planPart records the
   reader and returns an inert stub). `scripts/_scan-nan.mts` lists NaN
   numeric exports after a forced solve. Run both after touching a
   generator module.
2. `parkPlan.ts`'s own state is `var`: it is evaluated in the middle of
   `parkLayout.ts`'s evaluation, and `planPart` is reached before its
   `let`s would exist.

## Measured so far

- Canonical seed: 0 refusals, 0 unwinds, `check:park` 248/248 waypoints —
  the same park as before.
- Seed 1 (not built on the base: spur crossing the rail off every site):
  builds and passes `check:park` after unwinding (slide ×5 then the train's
  next attempt, before the conflict set was trimmed to
  `crossings, train, cruiser, layout`).
- **Seeds 0..15, first sweep (196c17d0), each `LGP_SEED=n pnpm run check:park` alone:**

  | seed | plan | check:park | driver |
  |---|---|---|---|
  | 0 | built 35 s | green 260/260 | cruiser refused ×6 → decision zero (layout attempt 1) |
  | 1 | built 36 s | green 257/257 | paths refused (off-site crossing) → train attempt 1 |
  | 2, 5, 7, 11, 13, 14, 15 | built | green, same parks | 0 refusals |
  | 3 | built 48 s | green 248/248 | train refused → train attempt 1 |
  | 4 | built 6 s | **red** poi.nospot 2, rail.walkable 1 | 0 refusals |
  | 6 | built 8 s | **red** rail.walkable 1, anchor.reach:waterFight 0.1 | 0 refusals |
  | 8 | plan built 330 s, **World threw** at buildBridges (railD 20: ramp blocked by a collider) | — | 48 refusals, 45 unwinds, decision zero ×3 |
  | 9 | built 45 s | **red** rail.walkable 1 | train refused → attempt 1 |
  | 10 | built 20 s | green 203/203 | cruiser ×6 → decision zero |
  | 12 | built 44 s | **red** anchor.reach:waterFight 0.3 | paths refused ×2 → train attempts 1, 2 |

  11/16 green (base: 7/16); every seed makes a plan (base: 9/16). Residue,
  by class: `rail.walkable: 1` (4, 6, 9 — one standable centre-line sample;
  9's is at the gate (−1.1, 50.3)); `anchor.reach:waterFight` (6, 12 — built
  lumps 0.1–0.3 m past the declared radius, the base fails the same);
  `poi.nospot` (4 — waypoint seeds at (−16.3, 58.3), (−20.3, 58.7));
  seed 8's real bridge search refusing a site the planner proved (build-order
  drift #414: the real search sees World colliders). Probing each
  (`scripts/_probe-residue.mts`, untracked).

## Not yet built (in order)

- Accommodation levels only as the sweep demands them (trees/lamps/walls as
  movable builders; stalls' `accommodate`).
- The post-build `check:park` residue (seeds 4, 6: `poi.nospot`,
  `rail.walkable`, `anchor.reach`) as plan-time refusals if the sweep still
  shows them.
- Wider sweep (0..199), determinism by two-process digest, `check:park-boot`
  on the new boot path, `check:every-seed-builds` with an empty baseline.
