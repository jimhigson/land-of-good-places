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

## Resumed 14-15 Nov (process: verify yourself, open the PR, merge on green)

- Merged origin/main bfdebfe6 (TS 7.1, Vite 8.3.8, checked-in parks, ?clock,
  #778, #781 garden roots, #783 warm-up, #759 lazy castle) as 63a167e8. One
  conflict (Game.ts imports), both kept. tsc green on the merge.
- Main worktree for A/B: `.claude/worktrees/rsm-main` (detached at bfdebfe6).
  Servers via scratchpad `rsm/srv.sh`: 6071 branch dev, 6072 main dev, 6073
  branch preview, 6074 main preview. `srv.sh stopall` kills only those.
- Rail Race at `?clock=2`, merged head: 1540 draws. Biggest remaining: race
  carts+riders 305 (live), anchor-plot facades ~130 (one material per mesh),
  park train 114 (moves; stations static), keychain cart 87 + face-paint 59
  (outline targets as a whole), fountain 54 (statue turns), entrance 42,
  stall leftovers ~50, stall flags 54 (live). Need < 1200.

## 15 Nov: what was added (all pushed)

- `foldColours`: colour per vertex, white vertex-coloured copy of the first
  material; audit holds folded sources' materials and the copy. Sources are
  ordered like three's opaque sort (material id, object id). Walls NOT folded
  (1,930 px on the Sky Cruiser for 4 draws).
- Batches may hang inside a selectable thing: `isStaticBatch` /
  `boxWithoutBatches` used by `rainbowOutline.ts` and `Selection.boundsFor`.
- New areas: hotel/library/reptile fronts (plot roots), ferris legs (prop
  root, hidden with it during the ride), keychain cart, face paint, entrance,
  park train (stations) + each train car and race cart in its own frame.
- Handles (`userData`): sign bulbs, arrival, hotel door leaves, reptile
  head/tongue/windows, ferris wheel, painter + NPC decals, rival riders, cart
  wheels, train cars/axles/lamps. Statue NOT batched (fades); castle front not.
- `stand(false)` restores matrix-update flags (movers' sources drew at boot
  position in the A/B otherwise).
- check:cull-audit tests each batch source by its own sphere; control 2 uses
  a subset index. check:static-freeze: MUTATE=recolour, MIN_MERGED 1000.

## Measured (dev server, seed 5, 1280x800, Metal)

- Rail Race draws at ?clock=2: 1540 -> 1105 (tris identical 1,976,082).
- Pixels (in-page A/B = main vs branch in every scene; controls 0/0):
  rail 94 (floor 190), slide 0, ferris 0, park day 2401 (floor 4303),
  sky 1977 (floor 957; 1930 from folded walls -> walls unfolded, re-run
  pending), park night 3410 (floor 1777), rail night 24, /view 676.

## Next

- Extend `check:static-freeze` with `auditBatched` (+ floor, red proof).
- Lower `check:render-budget` ceilings; extend `check:cull-audit` to see
  per-source off-screen triangles inside a batch.
- More areas? (train stations, entrance shelter) — see census in scratchpad.
- Prod-build timing A/B, render-budget measurement, screenshots, QA notes.
