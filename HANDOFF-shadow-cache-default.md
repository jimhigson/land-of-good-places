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

### Audit results (all seed 5, dev server, harness `sc/scenes.mjs`, `sc/scenes2.mjs`, `sc/changes.mjs`)
**0 differing texels in every audit** after the hardening commit 993c27cf:
park morning/noon/sunset standing, walking (16), rail race racing (40 consecutive
frames, cart 114,22 -> 66,-71), ferris (16), sky cruiser (16), slide (12), cat bus
/arrive (16), park train passing (36), trampoline bounce (30), library -> park and
reptile house -> park (24 consecutive frames from the first after the door each),
20 kinds of one-off static change with the sun held still.
Interiors (/hotel, /library, /reptile-house, /castle?deck=0): the sun is not drawn
(indoors) in either mode, so there is no sun map to differ.
Gap found and fixed (993c27cf): a swapped position attribute / index (fresh object,
same version 0) went unseen: 85,885 stale texels. Not hit by any game path today.

### What it does standing at `/spawn?pos=0,10` (t≈0.35)
~112 movers every frame (statue turntable 24 meshes, her 22, pet parade 21, an
NPC 28, face-paint stall 6, crowd face patches, ferris 3, fountain water);
~20 static redraws/s ("light moved" ~15/s, crowd face patch settle/change ~5/s).

### Timing (production build on :6041, headless Chromium channel, M4 Pro Metal, seed 5)
Harness `sc/perf2.mjs` + `sc/shadowprobe.js` (rAF intervals, CPU in rAF, GL draws and
tris, shadow-pass draws/tris/ms timed at the OUTERMOST shadowMap.render so the cache's
survey is included). **Do not time with `?perf=1`**: its overlay calls
`gl.getParameter(UNMASKED_RENDERER)` 4x/s, which waits on the GPU process; with the
cache on that wait measured ~10 ms a call (41.8 ms/s), making fake missed frames.
First pairs (before the single-pass change), 1440x900 DPR2, 15 s:
- standing: CPU mean 4.53/3.97 off vs 3.86 on; shadow ms mean 1.04/0.87 vs 0.65;
  shadow p99 1.5/1.2 vs 1.6; shadow tris p50 0.46M -> 0.13M (of 1.00M -> 0.69M)
- walking: CPU mean 3.91 vs 3.89 (no difference); shadow p99 1.2 -> 1.5
- rail race: shadow ms mean 0.546 vs 0.568 (no saving)
- phone stand-in 390x844 DPR3 4x CPU: shadow ms mean 4.80 -> 4.11, **p99 6.5 -> 8.6**,
  CPU p99 23.6 -> 25.4
CPU profile (on): survey 51 ms/s (0.43 ms/frame: visit 0.18, classify 0.12,
changed 0.08, snapshot 0.03), composite 44 ms/s, static 18 ms/s.
=> the survey eats most of the draw saving; redraw frames cost MORE than a cache-off
frame (static pass + separate composite + survey) so p99 rises.

### Sun steps are visible on tall casters (sc/steps.mjs: world frozen, only the sun moves)
Noon, /spawn?pos=20,-12, 1280x720: cache on steps 6x/s; each step changes ~16k px by
>8 levels (max 74-80); between steps 0. Cache off: every frame ~2k px change by >8
(max 60-98: the re-rasterisation crawl of a continuously moving light). Crop of the
ring's shadow: ~2 px jump per step at 720p (out/noon-on-step-crop.png).
Whole-day share of sunlit frames that redraw for sun steps alone: 33% at the current
5 m/3 cm; 54% at 15 m/1 texel (what invisible-on-tall-casters needs).

### Sun steps per second (computed from DayNight's formulas, 150 s day)
06:00 every frame · 07:12 49.5/s · 08:10 (start) 20/s · 09:00 12.5/s · noon 6.5/s
· 16:00 29/s · sunset (elev < ~8°) every frame. Each step = one full static redraw.
