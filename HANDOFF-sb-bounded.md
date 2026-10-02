# HANDOFF — sb-bounded

- **Model:** Claude Opus (Opus 5.5), chosen by the #706 structural-backtrack agent. A replacement runs the same model.
- **Branch:** fix/sb-bounded (from origin/wip/sb-merge). Worktree .claude/worktrees/sb-bounded.
- **Task:** make the ParkSolve driver provably bounded; prove with the barSlotWithNoSupportRoom "never finds room" mutation (via the `setParkPlanSeams` seam in parkPlan.ts) plus a synthetic two-builder test.

## Findings
- (in progress) Repro: `MUTATE=1 LGP_SEED=15 LGP_PARK_RESTART=0 LGP_TRACE_LIVE=1 node ... scripts/probe-sb-bounded.mts` (probe is scratch, not committed).
- Seed 15 r0 already redraws decision zero repeatedly with no mutation (cruiser castle misses, train dead-ends, pathGraph under-booth) — decision zero is a normal rung; caps must not bite it.
