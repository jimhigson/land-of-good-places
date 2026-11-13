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

## State at hand-back (13 Nov, second engineer)
- **Off by default**: `SUN_SHADOW_CACHE_DEFAULT = false` in `sunShadowCache.ts`; `?shadowCache=1` turns it on, `=0` off.
  Off, `DayNight` is exactly as on main (three's own pass, continuous follow).
- Two bugs found by looking at screenshots, both fixed:
  1. the restore triangle's shader had no colour output (`glslVersion: GLSL3`) so WebGL 2 dropped the draw;
  2. three's `VSMPass` ends with `setRenderTarget(shadow.map); clear()` which clears the DEPTH of the map it
     just blurred, so the static target's depth was gone by the time `render` returned. Now a `tap` mesh, drawn
     last in the static pass, copies the depth to `keepTarget` in `onAfterShadow` (`copyTextureToTexture`).
- Measured, seed 5, 1280x720 headless Chromium, shadow-pass draw calls per frame (page-side wrapper around
  `renderer.shadowMap.render` diffing `renderer.info.render.calls`): standing at /spawn?pos=0,10 clock running
  557.2 -> 188; walking 493.7 -> 207.8; paused /view-style frames 269..671 -> 17..52.
- Stills (castle, stalls x noon/afternoon/dusk): mean abs pixel diff 0.15..0.25 of 255 against main.
- NOT done: caster budget (`TINY_CASTER_RADIUS` is 0 = off), fitted shadow camera, any look at it in motion.
- Cost to know about: two extra 2048x2048 targets (RG16F + D32F static, R8 + D32F keep), about 52 MB of GPU memory.
- Park cache gotcha: `.parks/dev/<hash>/5/` needs BOTH `5.json` and `manifest.json`; the predecessor's dirs had no manifest.
