# HANDOFF — first-entry warm-up (perf/first-entry-warmup)

Plan items 14 (step 8, shader precompile for every space) and 19 (step 9, load
hitches), `docs/perf/FRAME-DROPS-2026-11.md`. Resumed 14 Nov by a second
engineer; worktree `.claude/worktrees/first-entry-warmup-r2` (local branch
`perf/first-entry-warmup-r2`, pushed to `origin perf/first-entry-warmup`;
the first engineer's worktree `.claude/worktrees/first-entry-warmup` still
holds their two uncommitted files, committed here as d7dd433e — leave it).

Process (Jim, 14 Nov): no QA, no reviewer; I verify in a browser, open the PR,
CI runs. Coordinator: perf PRs merge on green CI + my own browser proof (no
preview for Jim). #759 (lazy castle) is held to land with this; the key proof
is "with #759 merged locally, the castle's build runs with the iris shut".

## Design (what is on the branch)
- `src/core/viewWarmup.ts`: `drawnBy`, `ViewWarmup` (compile the view in one
  `compile`, poll `isReady()` = KHR_parallel_shader_compile, upload textures
  ≤ 6 ms/frame; `add(scene, camera, 'whole')` for a curtain game's world),
  `RevealHold` (collect → wait → behind → settle; `request(why)`).
- Covers that hold: the iris (`Transitions.setHoldOpen`), the curtain
  (`MiniGameHost.setHoldOpen`, game not played while held), the boot
  (`Game.holdFirstFrames`, no-bus boots). `?clock=` waits on a hold.
- `Transitions.irisWipe`: `ready` may be a function, called once the iris is
  really shut (`whenShut`, polls the eye's width).
- `SpaceManager.changeToFurnished`: `furnish()` called once shut — the generic
  hook every lazy room uses (library, reptile house, hotel, and #759's castle).
- Rides: rail race lamps on at the cut; ferris car + show **built** at the cut
  (visit serial guards a cancel before the cut); `Game.rideCamera` reads the
  camera after the cut.
- Shader warm-ups (bus, no-bus background) compile the park only: rooms were
  compiled against the park's lights, never used (light counts are in every
  program key; rooms hide the sun rig, #781 detaches the park's lamps).
- Exhibit solver: `isClearCircle` asked once per (bearing, distance), not per
  height — same candidates chosen (transcript diff vs main, with a main-vs-main
  control showing the same noise lines).
- `gpu:first-entry` (`scripts/check-first-entry.mts` + `first-entry-probe.js`):
  the instrument, GPU-only, named in `check:chain-coverage`'s GPU_ONLY.

## Measurements (M4 Pro, Chrome for Testing 1234 headless/Metal + WebKit 2336, seed 5, 1280×800@2, load 25–80 from a VM; harness in scratchpad `fe-warmup/`)
Lazy castle A/B (main d2ebb4c1 + lazy-castle vs branch + lazy-castle, 4 runs each):
- WebKit: main+lc build freeze 80–89 ms with iris 0.54–0.61 of the diagonal
  open, 2/4 runs drew the new room through an open iris (32 px, 916 px); worst
  visible 80–102 ms. Branch+lc: freeze 83–105 ms with iris shut 4/4, worst
  visible 19–34 ms, first new-room frame shut 4/4.
- Chromium: main+lc 59–63 ms at 0.20–0.32 open (3/4), worst visible 61–71;
  branch+lc 66–69 ms shut 4/4, worst visible 10.3 ms 4/4.
- Cost: close→open 331–351 ms (main) → 474–595 ms (branch) on that first entry.

## Next
- [ ] Chromium batch main vs branch (cr-r2), WebKit doors/rides, screenshot pairs
- [ ] prove gpu:first-entry red on main's build, green on branch
- [ ] check:exits, check:render-budget, lazy tests; PR
