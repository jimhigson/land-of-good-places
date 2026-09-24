# HANDOFF — prebuilt parks (feat/prebuilt-parks, PR #705)

Model: Claude Opus 5.5 (1M), chosen by the Overseer (Architect role, then implement). Keep the same model.
Design: `docs/design/PREBUILT-PARKS.md` (also PR #704, draft). Base: origin/feat/procgen-on-sphere.

## Jim's rulings driving this (24 Sep)
- "no ability to build built into the game as delivered — seeds not downloadable is an error."
- "we only support seeds 0..15, no others."
- Retire checks that only existed because the client solved; move procgen out of the engine; enforce boundary.
- If any of 0..15 fails an invariant: do NOT work around (no swaps/skips/baselines) — #705 waits on
  feat/structural-backtrack (another agent). Base today: only seeds 2 and 5 of 0..15 pass all invariants
  (vet:seeds, see below). So #705 IS BLOCKED on that branch; rebase onto it when it lands.

## Architecture now
- `src/world/prebuilt/`: parkFile.ts (format + READER), parkFileName.ts, parkFileStore.ts (letterbox),
  parkUnavailable.ts (error), solverPort.ts (the only way src reaches a solver; the client never installs one).
- `procgen/`: every search + both backtracking drivers + park-file WRITER. install.ts installs the solver.
  Node scripts get it lazily via `scripts/ts-extension-resolver-register.mjs` (sync registerHooks + require(esm));
  vitest via `test/procgen/parkFacts.ts` importing procgen/install.ts after pinning the seed.
- Hydrated in the client: plan (layout, cruiser, train, slide, crossings, pathGraph+lattice, road),
  world phase (stall moves, walls, trees/bushes as Rng state, fairy poles, lamps, trestles, claims), bridge footprints.
- Still computed on the client (deterministic candidate loops, asked Overseer whether Jim wants them moved):
  cruiser pylons, slide legs, rail-race plan (exit/arch), boundary radii, ferris exit.
- Checks: check:prebuilt-park (shard 6; A/B digest + no driver/world-search in hydrate + perturb control),
  check:procgen-boundary (shard 1), check:client-no-solver (shard 6). All proved red (see commits).
- Tools used for the split (scratchpad, not committed): reach.cjs (declaration reachability from src/main.ts),
  movedecls.cjs (move declarations + wire imports), prune.cjs.

## Measurements
- Canonical: digest 1279d5dcd2ad01a1 solved == hydrated; hydrated plan ~7 ms; file 119.9 KB raw.
- Bundle JS before/after: 3,430,754 -> 3,304,071 B raw; 783,721 -> 744,315 B brotli (Garden chunk gone).

## Done since (24 Sep)
- Error screen (ui/ParkUnavailableScreen.ts), no timeout, retry = reload; dev park middleware (scripts/lib/dev-parks.mjs).
- Retired check:solve-cost, check:park-boot, check:arrival-completes (+ slice scripts, SolveScheduler, CLIENT_BUNDLE).
- Seeds 0..15 (SUPPORTED_PARK_SEEDS owner), default seed 5, seed-0..15 invariant files, save migration
  (retired seed -> seed 5, position dropped: parkChangedUnderSave()).
- CLAUDE.md + design doc "As built" (sizes, bundle, retired checks, seed coverage ledger).
- build:parks 0..15: 1819 KB raw / 513 KB brotli total; every seed boots in headless Chromium from vite preview.
- PR #705 is DRAFT, titled "[waiting on structural-backtrack]".

## Open
- #705 blocked: only seeds 2 and 5 of 0..15 pass all invariants at base. Rebase onto feat/structural-backtrack
  when it lands; re-run build:parks, check, test:procgen, coplanar, swept-bus; reload the preview.
- Asked Overseer: do pylons / slide legs / rail-race plan / boundary radii / ferris exit count as building?
- Coplanar/swept-bus results on 0..15: see PR / Overseer report.
