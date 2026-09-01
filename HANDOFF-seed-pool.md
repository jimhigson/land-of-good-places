# HANDOFF — sixteen vetted park seeds (#426)

Branch `feat/sixteen-seeds`, worktree `.claude/worktrees/seed-pool`.

## What is already done and pushed

- **`scripts/vet-seed-pool.mts`** (`pnpm run vet:seeds -- <from> <to> [--jobs n]
  [--out file]`) — vets a candidate against **both** gates: `check:park` with
  the ratchet **enforced** (stricter than `sweep:seeds`, which turns it off),
  and the full procgen invariant suite via a throwaway per-seed test file.
  Appends one JSON verdict per line as it goes.
- **`src/world/parkSeedPool.ts`** — the pool and the single owner of "which
  park is this?". Resolution order: `LGP_SEED` → `?seed=` → the seed this
  profile remembered → a draw from the pool. Node with nothing pinned still
  gets `CANONICAL_PARK_SEED = 20260728`, so no check script changes behaviour.
- **`src/main.ts`** — `startFresh` forgets the remembered seed and reloads (a
  reload is required: `parkManifest.ts` is on `main.ts`'s *static* import graph
  via `world/entrance/BusJourney.ts`, so the page fixes its seed long before
  "start again" is pressed). Boot logs the seed and how to reproduce it.
- **`scripts/check-seed-pool.mts`**, in the `check` chain — pool well-formed +
  draw order, against a fake `localStorage`. Proved red twice (see the commit).
- **`package.json`** — also **de-duplicated the `"check"` key**. There were two;
  JSON takes the last, so `check:stall-shape` had silently not been running.

## The instrument was controlled before it was trusted

- seed **5**: PASS, both gates, 80 invariants.
- seed **2** (retired as pathological in #429): FAIL, both gates, and **for the
  right reasons** — `check:park` `poi.nospot: 2` (two waypoint seeds have
  nowhere a child fits) and exactly the three bridge invariants #429 names:
  *nothing a bridge builds hangs into its own tunnel*, *every modelled coping
  stone sits on the wall it caps*, *railway crossings are planned — station-
  clear, and mostly real bridges*. 77 passed, 3 failed.

## The state of the search — DONE

Pool is **sixteen**: `20260728, 5, 11, 24, 115, 128, 131, 208, 225, 267, 274,
288, 326, 346, 428, 451`. Confirmed 16/16 in one run at `8409724f`.

**515 candidates tried, 17 passed — one in thirty.** 1102 and 1104 are spares.
Raw verdicts in `seed-vetting.jsonl` (gitignored).

**Re-vetted twice against merges that landed mid-flight**: #460 (hop penalty —
first whole search discarded and redone) and #461 (long grass and solid
benches — pool re-vetted on top, 16/16 still pass).

**Finding worth keeping whatever happens to this branch:** sweep seed **18**,
which `test:procgen` runs on every PR, **fails `check:park` on `main`** —
`route.crossesRail: 4`, four walks routed across the railway at grade 0.56 m
above the rail where the deck needs 4.06 m. Green in `test:procgen` (80/80).
Written up on **#437**, along with the correction that 18 of the 19
park-building check steps are canonical-only — `check:fountain-hop` already
sweeps five seeds and is the pattern to copy.

## Browser QA is done (port 5551, server killed, pages closed)

- Fresh profiles drew 24, 208, 24, 24, 20260728, then 20260728, 131, 115.
- "Yes, start a new game" took a device 20260728 → 5, reloading exactly once
  (one console line on the new document, reading `(drawn)`).
- `?seed=208` pinned without persisting; 24, 208 and 115 are visibly
  different, walkable parks.

## Gates

`pnpm run check` exit 0, `test:procgen` 497 passed, `build` exit 0,
`vet:seeds --list <pool>` 16/16.
