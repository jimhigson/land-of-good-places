# HANDOFF — prebuilt parks (feat/prebuilt-parks)

Model: Claude Opus 5.5 (1M), chosen by the Overseer (Architect role, then implement).

Design: `docs/design/PREBUILT-PARKS.md` (PR #704, draft, branch design/prebuilt-parks).
Base: origin/feat/procgen-on-sphere. PR target: feat/procgen-on-sphere.

## Done
- Format 1 codec: `src/world/prebuilt/parkFile.ts` (+ `parkFileName.ts`, `parkFileStore.ts`).
- `parkPlan.ts`: coarse builders take `hydrate(file)` for attempt 0; `parkPlanFile()` encodes; `parkPlanHydrated()`.
- Shared owners: `buildRoute` exported (rail/generate.ts), `coasterCurve` (coaster/route.ts),
  `cruiserPlanFromDecisions` (coaster/solve.ts), `TrainRoute.solvedRoute` getter.

- scripts/lib/parkDigest.mts, scripts/park-file-probe.mts (solve|hydrate|perturb), scripts/lib/parkFiles.mts,
  scripts/build-parks.mts (.parks/ + manifest with sourceHash), check:prebuilt-park (shard 6).
- vite plugin prebuiltParksPlugin (emits dist/parks/<seed>.json, stamps build, refuses stale sourceHash,
  LGP_REQUIRE_PARKS=1 fails); workbox glob parks/*.json.
- client: src/boot/prebuiltPark.ts (3 s timeout) -> offerParkFile; ParkGeneration first rung; finishLaunch awaits.
- CI: deploy.yml / pr-preview.yml: actions/cache .parks + build:parks, LGP_REQUIRE_PARKS=1 on build.

## Proved red (canonical seed, file 24596 B, digest 1279d5dcd2ad01a1)
1. layout decoder drops signYaw -> digest b4bbcbcba7a18981, 155 mesh names differ, exit 1.
2. driver ignores file (`attempt === 0 && false`) -> digests equal but "hydrated features still searched:
   layout=768, cruiser=771062, train=302918, slide=3008025, crossings=101 pieces", exit 1.
3. perturb no-op -> "CONTROL FAILED ... 1279d5dcd2ad01a1 same", exit 1. Unmutated: exit 0, perturbed 3846707368ab1919.

## Next
- run check:park-boot (ParkGeneration got a rung), tsc, test:procgen, check; vite build + preview in browser.
- PR against feat/procgen-on-sphere; preview URL with `/`.

## Measurements (canonical, M-series)
- plan search 7.8 s CPU (cruiser 2975, train 1266, slide 3428 ms); world ctor 1.6 s (world-phase ~0.4 s).
- decisions JSON ~25 KB raw / ~10 KB brotli; geometry 49 MB raw / 5.1 MB brotli.
