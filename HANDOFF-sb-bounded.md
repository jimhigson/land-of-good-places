# HANDOFF — sb-bounded

- **Model:** Claude Opus (Opus 5.5), chosen by the #706 structural-backtrack agent. A replacement runs the same model.
- **Branch:** fix/sb-bounded (from origin/wip/sb-merge). Worktree .claude/worktrees/sb-bounded.
- **Task:** make the ParkSolve driver provably bounded; prove with the barSlotWithNoSupportRoom "never finds room" mutation (via the `setParkPlanSeams` seam in parkPlan.ts) plus a synthetic two-builder test.

## Findings
- (in progress) Repro: `MUTATE=1 LGP_SEED=15 LGP_PARK_RESTART=0 LGP_TRACE_LIVE=1 node ... scripts/probe-sb-bounded.mts` (probe is scratch, not committed).
- Seed 15 r0 already redraws decision zero repeatedly with no mutation (cruiser castle misses, train dead-ends, pathGraph under-booth) — decision zero is a normal rung; caps must not bite it.
- **Root cause (measured):** not a cycle and not a non-terminating builder. The road's refusal (consumed railRaceBars) unwinds railRaceBars ~10 stations, each replay re-solving slide+crossings+pathGraph; then other features unwind train/layout, and the road refuses identically on every new layout. The old bound was the product of all supplies, capped only by MAX_UNWINDS=4000 / 240 layouts: seed 15 r0 mutated did 38 layouts, 64 unwinds, 18 identical road refusals in 480 s and was nowhere near either cap (hours). Second, latent: a `supply()` of Infinity retried forever (old driver OOMs in the synthetic test).
- **Fix:** SolveBudget in parkSolve.ts (attemptsPerDecision 256, unwindsPerFeature 64 -> escalate to decision zero, decisionZeroPerFeature 16 -> fail, decisionZero 256 global, unwinds 4000, turns 200000; byFeature overrides for tests); exhaustion throws ParkSolveExhausted (plain Error => build failure, loop restarts), recorded as stats.exhausted and in park-attempt backtracking.exhausted.
- Decision zero is NOT tightly capped: unmutated seed 15 r0 redraws the layout 34 times before the road is asked; seed 5 r2 12 times.
- Mutation test: test/railRaceRoadBounded.test.ts (seed 12 r3, road-only budget 2 unwinds/0 escalations, 21 s). Red: without budgets 436 s and still solving (killed).
- Before/after summary lines seed 12 r0 and seed 5 r2: identical counts (scratchpad sb-bounded/{before,after}-*.log).
- **Tests:** test/parkSolveBounded.test.ts (synthetic). Red on base driver: case1 B advances=4001 (bound 81), runaway-supply case OOMs.
- Real-park caps from caches: worst plan unwinds 33, decisionZero 9, refusals 91; world never unwinds.
- Baseline summary lines: scratchpad sb-bounded/before-*.log; base worktree .claude/worktrees/sb-bounded-base (remove when done).
