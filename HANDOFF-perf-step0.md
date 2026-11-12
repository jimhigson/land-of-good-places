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

## Next
- `pnpm run check` + `test:procgen` locally; PR; merge main once #749 lands; CI green.
