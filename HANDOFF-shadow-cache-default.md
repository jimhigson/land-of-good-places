# HANDOFF — shadow-cache-default (120 fps plan item 7, step 12)

Branch `perf/shadow-cache-default` from origin/main 34f20970. Worktree
`.claude/worktrees/shadow-cache-default`. Dev server port **6041** (one server at a
time on it; the production preview for timings also goes on 6041).

## Brief
Prove `SunShadowCache` (src/world/sunShadowCache.ts) invisible, then turn it ON by
default with a URL switch to turn it off. Do NOT turn on the caster budget
(`TINY_CASTER_RADIUS` stays 0). No PR — a later stage opens it.

## State
- [ ] instruments: in-frame shadow-map equivalence (composite vs three's full pass), final-frame pixel diffs with a control
- [ ] scenes: noon / low morning / sunset; movers; a static caster changing once; walking re-centre; sun step; interiors + space changes
- [ ] timings: park standing + walking, rail race, 4x throttle — cache on vs off
- [ ] default flipped, `?shadowCache=0` off

## Findings (record as they land)

### The instrument: `SunShadowCache.audit()` (`dayNight.auditShadowCache()`)
After the cache draws its map, three's own pass draws the whole map again from
the same light pose into a spare VSM target; both blurred maps are read back
(RGBA/FLOAT) and compared texel by texel. Exact by construction: a correct cache
differs in 0 of 4,194,304 texels.
- Control (seed 5, `/spawn?pos=0,10`, t≈0.35, 1280x720 DPR1, headless Chromium,
  M4 Pro Metal), harness scratchpad `sc/control.mjs`:
  - `cache.changed = () => false` (survey blind): **59,018–89,635 differing**
    on skipped frames, 0 on the one frame with a fresh static redraw (correct).
  - composite drops its movers: **106,095–112,567 differing**.
- Baseline audit, same scene, cache as merged: 12/12 audits **0 differing**
  (10 composite frames, 2 static).

### What it does standing at `/spawn?pos=0,10` (t≈0.35)
~112 movers every frame (statue turntable 24 meshes, her 22, pet parade 21, an
NPC 28, face-paint stall 6, crowd face patches, ferris 3, fountain water);
~20 static redraws/s ("light moved" ~15/s, crowd face patch settle/change ~5/s).

### Sun steps per second (computed from DayNight's formulas, 150 s day)
06:00 every frame · 07:12 49.5/s · 08:10 (start) 20/s · 09:00 12.5/s · noon 6.5/s
· 16:00 29/s · sunset (elev < ~8°) every frame. Each step = one full static redraw.
