# HANDOFF — prebuilt parks (feat/prebuilt-parks)

Design: `docs/design/PREBUILT-PARKS.md` (PR #704, draft, branch design/prebuilt-parks).
Base: origin/feat/procgen-on-sphere. PR target: feat/procgen-on-sphere.

## Done
- Format 1 codec: `src/world/prebuilt/parkFile.ts` (+ `parkFileName.ts`, `parkFileStore.ts`).
- `parkPlan.ts`: coarse builders take `hydrate(file)` for attempt 0; `parkPlanFile()` encodes; `parkPlanHydrated()`.
- Shared owners: `buildRoute` exported (rail/generate.ts), `coasterCurve` (coaster/route.ts),
  `cruiserPlanFromDecisions` (coaster/solve.ts), `TrainRoute.solvedRoute` getter.

## Next
- scripts/lib/parkDigest.mts (factor out of park-digest.mts), scripts/park-file-probe.mts (solve|hydrate|perturb),
  scripts/build-parks.mts (pool, lanes, A/B verify, .parks/ + manifest with sourceHash), check:prebuilt-park.
- vite plugin emitting .parks -> dist/parks, sourceHash check, LGP_REQUIRE_PARKS; workbox glob parks/*.json.
- client: src/boot/prebuiltPark.ts fetch (3 s timeout) -> offerParkFile; ParkGeneration rung; finishLaunch await.
- CI: deploy.yml / pr-preview.yml build:parks + cache.

## Measurements (canonical, M-series)
- plan search 7.8 s CPU (cruiser 2975, train 1266, slide 3428 ms); world ctor 1.6 s (world-phase ~0.4 s).
- decisions JSON ~25 KB raw / ~10 KB brotli; geometry 49 MB raw / 5.1 MB brotli.
