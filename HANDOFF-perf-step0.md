# HANDOFF — 120 fps plan, step 0 (measurement)

Spec: docs/perf/FRAME-DROPS-2026-11.md on #746's branch, "Step 0a/0b".
Branch `perf-step0`, worktree `.claude/worktrees/perf-step0`.

## Done (all pushed)
- `src/core/perfProbe.ts` + `src/ui/PerfOverlay.ts`, wired in `Game.ts` only under `?perf=1`. `window.__perf` {frames, summary, reset, frameCount, context}.
- `scripts/check-render-budget.mts` → `check:served-render-budget` → `check:shard-10`; checks.yml matrix has 10; with-dev-server passes CHECK_RENDER_BUDGET_URL. chain-coverage green.
- Budgets measured (M4 Metal vs SwiftShader, max taken, +10%). Clock frozen (game.timeScale=0) before sampling — CI frames are slow so Rail Race would otherwise sample a different moment.
- Red proven: frustumCulled=false on everything → park 3063 draws vs ceiling 671, library 2168 vs 354, exit 1.
- Control finding: per-call (autoReset) vs per-frame summing differs by ~1 draw in the park (609 vs 610); matters only with book/mini-game up.
- docs/perf/REAL-PHONE-BASELINE.md.

## State (PR #752, head 81cf7877, main f3e0b6b8 merged)
- CI green on 81cf7877: Checks pass (shard 10 = render-budget, counts unchanged after #749), Procgen invariants pass, preview deployed.
- Shard 9 `check:book-reader` FAILED once on 81cf7877 (waitPainted 120 s timeout after isOpen at ~8 s), passed on rerun; passed on main f3e0b6b8. Not reachable from this diff (probe only under ?perf=1). Cold-dev-server SwiftShader repro: reader loaded 38 s after isOpen vs LazyPart's 20 s timeout, but no timeout error logged — root cause NOT confirmed. Needs an owner (LazyBookReader / check-book-reader, #749's area).

## Next
- Address review comments on #752 if any.
