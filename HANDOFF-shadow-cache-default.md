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
