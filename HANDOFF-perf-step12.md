# HANDOFF — perf step 12 (sun shadow cache)

Branch `perf-step12-shadows`. Plan: `docs/perf/FRAME-DROPS-2026-11.md` on #746, item 7.

## Design (implemented)
- `src/world/sunShadowCache.ts`: wraps `renderer.shadowMap.render`. Sun shadow `autoUpdate=false`;
  wrapper draws it on the world pass (camera sees layer 0).
  - static cache = depth RT of all casters unchanged for 750 ms (auto-detected by matrixWorld /
    geometry / instanceMatrix / material comparison each frame); redrawn when light moves or a
    cached caster changes/disappears or a new one settles.
  - composite = clear, sentinel full-screen tri writes cache depth (gl_FragDepth), then movers,
    then three's VSM blur.
- `DayNight.followPlayer` now steps the light: re-centre after 2 m, or when a 5 m-tall shadow tip
  moved 3 cm; centre snapped to texel grid.
- `Game` calls `world.dayNight.installShadowCache(renderer)`.

## Local measurement gotcha
Dev server solves the park per *source hash*; editing DayNight changes the hash → ~10 min re-solve.
Copy a solved `.parks/dev/<hash>/5` dir to the new hash dir to skip (park content is unaffected).
Baseline worktree: `.claude/worktrees/perf-step12-base` (detached origin/main).
My dev server: port 5793 (pids in scratchpad/step12/vite.pid).
