# HANDOFF — perf/frame-drops-2026-11 (investigation, no shipped code changes)

Task: Jim 11 Nov — "lots of dropped frames, GC or rendering?" Measure, attribute,
write `docs/perf/FRAME-DROPS-2026-11.md`, PR "Frame drops: what causes them and the plan".

## State
- Worktree `.claude/worktrees/perf-frame-drops`, branch `perf/frame-drops-2026-11`.
- `.parks` copied from `../story-camera/.parks` (same park source hash) so `dist/` boots.
- `dist/` = shipped build; `dist-perf/` = `vite build --minify false --sourcemap --outDir dist-perf`
  (fails at the PWA step, bundle is fine) for function names.
- Harness lives in the session scratchpad `h/` (probe.js, run.mjs, analyse.mjs, callers.mjs, summ.mjs).
  Headless Chrome for Testing 1234 = real Metal GPU (ANGLE Apple M4 Pro).

## Findings so far
- Controls pass: 30 ms busy every 60th frame -> 38/38 attributed INJECTED; 10 MB/s nominal garbage
  (~5.6 MB/s real, 36 B objects) -> heap profiler shows 5.76 MB/s at the probe line.
- Desktop: main thread ~90% busy in rAF (7.4 ms of 8.3 ms at 120 Hz). GC cheap (1.9 ms/s).
- Phone 4x: 30 fps, every frame >16.7 ms, CPU in rAF p50 31 ms. CPU-bound.
- Top CPU: scene.updateMatrixWorld 24% (8.9k objects all matrixAutoUpdate), banquet animating
  24 diners every frame while outdoors (~8%), shadow pass 12%, projectObject 10%.
- Alloc 130-150 MB/s; ~30% from deterministic Math (remPio2 module-level doubles box).
- Library story start: 483 ms JS + 141 ms + 150 ms shader link (desktop); 2.0 s twice on phone.
- Reptile house: GPU-bound (36/38 drops main-thread idle).
- Rail race: CPU 9.1 ms p50 > 8.3 budget -> 6.9% frames dropped; 1328 draws.

## Done (11 Nov)
- Doc: `docs/perf/FRAME-DROPS-2026-11.md`; harness: `docs/perf/frame-drops-2026-11-harness/`.
- PR #746 "Frame drops: what causes them and the plan". Not merged (needs review; nothing visible).
- Local gates on the PR head: `pnpm run check` exit 0, `pnpm run test:procgen` exit 0 (48 files, 2168 tests).
- Preview servers (5741/5742) killed by PID; no browsers left open.
