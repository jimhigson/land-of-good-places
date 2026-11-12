# HANDOFF — 120 fps plan, step 0 (measurement)

Spec: docs/perf/FRAME-DROPS-2026-11.md on #746's branch (`perf/frame-drops-2026-11`), "Step 0a/0b".
Branch `perf-step0`, worktree `.claude/worktrees/perf-step0`.

## Done
- `src/core/perfProbe.ts` — per-frame interval/cpu/draws/tris/heap ring; `window.__perf`; renderer.info summed per frame (autoReset off only under ?perf=1).
- `src/ui/PerfOverlay.ts` — overlay + copy-JSON; wired in `Game.ts` constructor (Loop wrapper only when `?perf=1`).

## Next
- `scripts/check-render-budget.mts` served check (draws/tris per space ≤ budget), `check:served-render-budget`, new shard, checks.yml matrix, with-dev-server env var.
- Prove red (mutation), measure baseline numbers, docs/perf/REAL-PHONE-BASELINE.md, PR.
