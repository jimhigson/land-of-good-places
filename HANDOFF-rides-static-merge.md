# Handoff: rides-static-merge (120 fps plan item 12 / step 14)

Branch `perf/rides-static-merge`, worktree `.claude/worktrees/rides-static-merge`,
dev server port 6051 (vite, pid in scratchpad `vite-6051.pid`), previews 6151
(main build) and 6152 (branch build). Engineer, 13 Nov 2026. Do NOT open a PR.

## Brief

Merge static geometry into per-area batched meshes, tiled so culling works.
Rail Race target CPU p50 <= 5 ms and < 1200 draws; pixel-identical within
noise; highlight/animated/interactable things separate; collision untouched;
lower `check:render-budget`; keep `check:static-freeze`/`check:cull-audit`
meaningful. Don't touch the shadow cache. Merge `fix/cull-audit-ci` if it lands.

## Design (done, pushed)

- `src/world/staticBatch.ts` (render-only, outside the park-source closure):
  `batchStatic(root, opts)` merges static plain meshes per (tile, material,
  shadow flags, renderOrder, vertex layout) into one Mesh with the SAME
  material object; `auditBatched(scene)`; `setStaticBatchesDrawn(scene, on)`
  (A/B toggle, used by the diff harness); `?staticBatch=0` disables at boot.
- Sources: leaves outside rainbow-outline targets are removed from the graph;
  sources inside a target (stall booths) stay, moved to layer 30 (no camera
  draws it). Outline shells and `Selection` Box3 walk the target, so they are
  unchanged. Sources get matrixAutoUpdate/matrixWorldAutoUpdate false.
- Static = no `userData`/instanced/skinned node between mesh and area root
  (staticFreeze's `isLeftLive`). Dodgems bulbs got `userData.twinkles`.
- `src/world/parkStatics.ts` `batchParkStatics(world)`: stalls (shared equal
  materials), scenery walls, fairy lights (cables merged although
  transparent), dodgems plot, water-fight plot. Called from `Game.ts` after
  `freezeParkStatics`.

## Measured (seed 5, M4 Pro, headless chromium, Metal)

- Draws, Rail Race frozen at the start: 2307 (main 2056 + shadow 251) ->
  1539 (main 1324 + shadow 216).
- In-page render-cost A/B (same page, same frozen frame, 800x500 DPR 1):
  Rail Race render 7.09 -> 6.24 ms median at the first pass (-505 draws),
  ~1.7 us per draw; taking sources out of the graph is another ~0.2 ms.
- Pixel A/B (harness `diff.mjs`, in page, world frozen, game's own render):
  controls repeat 0 px / restore 0 px; batched vs sources 18 (rail race),
  52 (park), 1720 (dodgems close), 123 (sky cruiser), 118 (slide) px; noise
  floor (unbatched, camera moved 10 um) 209 / 12474 / 2335 / 640 / 1920 px.
- Machine is loaded by other agents (load avg 8-12): wall-clock timing is
  noisy; use interleaved A/B on one build (`?staticBatch=0`).

## Findings

- A bare `renderer.render` repeats differ (autoClear is off): use
  `game.render()` for pixel A/B.
- Motion census (what changes while playing): dodgems bulbs (scale),
  welcome-sign bulbs (scale), reptile-house head (rotation), fountain jets +
  statue turntable, ferris wheel, trains (wheels rotate), stall flags. Fairy
  cables' material opacity changes at dusk (material shared, fine).

## Next

- Extend `check:static-freeze` with `auditBatched` (+ floor, red proof).
- Lower `check:render-budget` ceilings; extend `check:cull-audit` to see
  per-source off-screen triangles inside a batch.
- More areas? (train stations, entrance shelter) — see census in scratchpad.
- Prod-build timing A/B, render-budget measurement, screenshots, QA notes.
