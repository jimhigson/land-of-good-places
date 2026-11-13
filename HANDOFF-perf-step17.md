# HANDOFF perf-step17 — quality governor / adaptive DPR (120 fps plan step 17)

Integrated by the perf/120fps integrator: no PR of its own. origin/perf/120fps-base is merged in.

- Governor (pure): `src/core/adaptiveResolution.ts`. One owner of the quality level: `.quality`, `.subscribe()`, `.state()` (phase).
- `Engine.beginFrame(busy, scene)` feeds it and applies the DPR **before** the frame is drawn; `Engine.endFrame()` closes the CPU
  measurement. `Engine.onDrawingBufferResize` is for render targets sized in device pixels (none exist today).
- `Game.beginEngineFrame` is the only wiring: `transitions.wiping` + `spaceAt(player)` pause adaptation.
- Overlay line: `PerfOverlay.formatPixelRatio`. `?adaptiveDpr=0` pins the DPR for A/B.
- Test: `test/adaptiveResolution.test.ts`, 24 tests, shard 5 in `test/procgenShards.ts`. Proved red by six mutations of the controller.

## Not proven — do not read the green tests as covering these
- **No step down or recovery has been seen in a real browser.** Software GL drew this park at ~3.4 s a frame (every frame is a
  "hidden tab" gap, so the governor rightly ignores it); on the real GPU at 7680x4320 the frames were CPU-bound on a shared Mac
  (cpu p50 12 ms of a 13-17 ms frame), which the governor rightly ignores too. Needs a GPU-bound scene with an idle main thread:
  the reptile house at DPR 2 on a quiet machine, or a phone.
- **No flash on a step** is by construction (resize before the draw) and unobserved for the same reason. The instrument exists and
  its control reads red (resize after the draws: drawsBefore 836, drawsAfter 0).
- Known limit: a scene GPU-bound at exactly two refresh periods for more than ~5 s is re-learnt as a slower display, and the DPR
  climbs back. Regret backoff then spaces the retries out. There is no browser API for the display's real refresh rate.
- `Engine.ts` and this module are inside the park source hash closure, so CI re-solves the parks for this branch.
