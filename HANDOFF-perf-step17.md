# HANDOFF perf-step17 — adaptive DPR (120 fps plan step 17)
- Controller: src/core/adaptiveResolution.ts (pure); Engine.frameTimed applies; Game loop feeds (start, cpu).
- Overlay line: PerfOverlay.formatPixelRatio. `?adaptiveDpr=0` pins DPR for A/B.
- Test: test/adaptiveResolution.test.ts (shard 5 in test/procgenShards.ts).
- TODO: measure reptile house GPU-throttled A/B on headless Chromium; tune DOWN_WINDOW/MISSES; screenshots; check + procgen; PR.
