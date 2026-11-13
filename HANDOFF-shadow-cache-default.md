# HANDOFF — shadow-cache-default (120 fps plan item 7, step 12)

Branch `perf/shadow-cache-default` from origin/main 34f20970. Worktree
`.claude/worktrees/shadow-cache-default`. Dev server / preview port **6041** (one at a time).

## Outcome: the cache is exact, NOT invisible, NOT a clear win -> left OFF
`SUN_SHADOW_CACHE_DEFAULT = false` with the evidence in its comment;
`?shadowCache=1` turns it on, `?shadowCache=0` (or nothing) leaves three's own pass.
Full numbers: `docs/perf/FRAME-DROPS-2026-11.md` item 7, "Outcome, 13 Nov 2026".
Harness: `docs/perf/shadow-cache-2026-11-harness/` (dev server for audits; production
build + `vite preview` for timing; `BASE=http://127.0.0.1:<port>`).

## What landed on the branch
1. `SunShadowCache.audit()` / `dayNight.auditShadowCache()`: three's own full pass from
   the same light pose into a spare target, both blurred maps read back, compared texel by
   texel. Control: blinded survey 59–96 k differing, movers dropped 106–113 k; clean 0.
2. Survey hardening (993c27cf): buffers compared by identity as well as version (a swapped
   position attribute/index went unseen: 85,885 stale texels), per-group material
   visibility, depth-material fields (side, shadowSide, alphaTest, wireframe, alpha maps),
   skinned/morph meshes always movers; honours three's global shadowMap switch.
3. Single-pass redraw (399a684f): cached casters, tap copies depth, movers on top, one blur,
   straight into the real map; the 32 MB static target is gone. The audit's control caught
   the first version: copyTextureToTexture's depth blit leaves NO framebuffer bound, so
   movers drawn after the tap went to the canvas (~110 k texels on every redraw). Fixed by
   rebinding the map in the tap.
4. `?perf=1` overlay asks for the GPU name once (39882591): it was a GPU-process round trip
   4x/s, ~10 ms each with the cache's passes queued, inventing 1–7 % missed frames.

## Audits (all 0 differing on the final code)
park morning/noon/sunset, walking, rail race, ferris, sky cruiser, slide, cat bus /arrive,
park train, trampoline, library and reptile-house round trips (24 consecutive frames from
the door), 20 kinds of one-off change with the sun held, forced redraws 8/8.
Interiors: the sun is not drawn indoors in either mode.

## Visibility
- Sun step (`steps.mjs`, noon, /spawn?pos=20,-12, 1280x720): 6 steps/s; each changes
  ~16 k px by > 8 levels (max 74–80) and nothing between; cache off changes ~2 k px a frame
  (max 60–98). The ring's shadow jumps ~2 px per step.
- Re-centre (`recentre.mjs`, 2.6 m teleport, world frozen): outside her figure 4,654 px
  > 8 levels on vs 4,608 off, max 94 both: no worse than three's own light-follow.
- Invisible steps on tall casters (1 texel at 15 m) = redraw on 54 % of sunlit frames
  (`dayrate.mjs`; 31 % with a 600 s day).

## Timing (clean pairs only; the machine hit load ~37–40 later and those runs are noise)
Shadow-pass CPU off -> on: standing mean 0.76–1.04 -> 0.64–0.81 ms, p99 1.1–1.5 -> 1.4–1.9;
walking 0.82–0.88 -> 0.63–0.67; rail race 0.53–0.55 -> 0.57–0.61; phone stand-in (390x844
DPR3, 4x CPU) mean 4.3–4.8 -> 3.6–4.1, p99 6.0–6.5 -> 7.9–8.6. Shadow tris 0.46 M -> 0.13 M.
Never time with `?perf=1` on main before 39882591 (overlay stall).

## Not done / open
- Caster budget (`TINY_CASTER_RADIUS`) untouched, per the brief.
- No CI check for the cache: it is off by default; the audit is the instrument if it is
  ever turned on (a served check would audit /spawn, /rail-race, /arrive with
  ?shadowCache=1 and must be proved red with the controls in `control.mjs`).
