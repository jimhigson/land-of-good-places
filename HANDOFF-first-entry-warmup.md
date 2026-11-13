# HANDOFF — first-entry warm-up (perf/first-entry-warmup)

Plan items 14 (step 8, shader precompile for every space) and 19 (step 9, load
hitches), `docs/perf/FRAME-DROPS-2026-11.md`. Worktree
`.claude/worktrees/first-entry-warmup`, my port **6021** (preview or dev, one
at a time, killed by PID). No PR: a later stage opens it.

## Measured causes (baseline = main 34f20970, minified build, M4 Pro, Chrome for Testing 1234 headless/Metal, 1440×900@2, seed 5)

Harness lives in the session scratchpad (`measure.mjs`, `summarise.mjs`,
`tracetop.mjs`, a copy of the plan's `probe.js` renamed to `window.__glp` so it
does not clash with `?perf=1`). Frames are classified by the iris state
(MutationObserver on `.iris[data-closed]`).

| entry | worst visible frame | links on visible frames | cause (trace) |
|---|---|---|---|
| library door (`/library-door` + W) | 118.6 ms closing, 45 ms opening | 13 | `furnishLibraryRoom` built **in the door frame** (131 ms, before the iris moves) + 10 links on the opening frame |
| reptile door (`/reptile-house-door` + W) | 111.8 ms opening | 15 | 13 links (111 ms CPU) on the opening frame; hall build 34 ms in the door frame; then `ExhibitCamera.advanceWarm` 25–53 ms frames for ~0.8 s |
| rail race (E at stand 89.72,17.49) | 127 ms at the press, 97 ms opening | 32 | headlamps (8 SpotLights) switched on **at the press** → every park material relinks during the closing iris; 10 links + 16 tex at opening |
| ferris (E at -40.67,-40.85) | 108.6 ms closing | 40 | gondola/show built and shown at the press; 16 links while closing |
| sky cruiser (E at 35.69,-26.62) | 56 ms opening | 8 | 6 links + 12 tex on the opening frame |
| deep links (/castle, /hotel, /library, /reptile-house…) | 54–135 ms visible; 210–270 ms first frame | 3–40 | first frame links ~31 programs + 16 textures (40 MB); interior links on the iris-opening frame |
| NPC route plans | ~40 ms frames | 0 | `NavGrid.findRoute` A* — **not mine** (perf/nav-resumable) |

Program keys include the light counts for every material, and every interior
turns the sun's rig off (`DayNight.setIndoors`) — so nothing warmed against the
park's lights is ever the program an interior draws with.

## Design (committed)
- `src/core/viewWarmup.ts`: `drawnBy` (three's cull, no draw), `ViewWarmup`
  (compile the culled view in one `compile` call via an `ObjectList`, poll
  `isReady()` = KHR_parallel_shader_compile, upload textures ≤6 ms/frame),
  `RevealHold` (phases collect → wait → behind → settle; request(why) promise).
- `Transitions.irisWipe`: `ready` may be a function, called once the iris is
  shut; after the midpoint the iris waits for `setHoldOpen`'s promise.
- `SpaceManager.changeToFurnished`: `furnish()` called once the iris is shut
  (generic — covers the lazy castle when it lands; lazy-castle's HANDOFF lists
  the same fix as "Next", so that branch should drop it when it merges main).
- `Game.render` → `revealHold.frame(collect, draw)`; crowd cull moved before
  the hold; `holdFirstFrames()` for boots with no bus; background
  `ShaderWarmup` after such a boot (`warmTheRestInBackground`).
- `main.ts finishLaunch`: no-bus boots hold the first frames, HUD and splash
  revealed when warm.

## Next
- [ ] build + measure every scenario after; rides' press-time changes (rail race lamps, ferris build) → move to the cut
- [ ] exhibit camera warm frames (reptile) — decide
- [ ] check (served, counts) + GPU frame mode + control; prove red
- [ ] 4× throttle numbers
