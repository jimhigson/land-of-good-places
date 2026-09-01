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

## The state of the search

**Everything vetted before the rebase was thrown away**: `fix/hop-penalty-detour`
(#460, hoppable-wall routing cost 6.4 → 2.65) merged mid-search and moves paths
across the whole park. The branch is rebased on that (101b5415) and the search
was restarted from scratch. Nothing in the numbers below predates it.

Live results: `seed-vetting.jsonl` (gitignored), logs `seed-vetting*.log`.
Ranges in flight: 1-200, 201-420, 421-700 (`--fast`).

**At 252 candidates: 10 passers — a 4.1% hit rate.** Passers so far:
5, 11, 24, 115, 128, 131, 208, 225, 428, 451. Plus the canonical 20260728 that
is 11 of 16; the pool in the code currently holds the first six.

Failure taxonomy (of the rejected): the railway loop failing to solve at all
(42), stranded waypoints (`poi.stranded`, 22), and on the invariant side the
Rail Race duck bar (69), the Rail Race camera running backwards (65) and the
Sky Cruiser flying through the castle (53).

**Finding worth keeping whatever happens to this branch:** sweep seed **18**,
which `test:procgen` runs on every PR, **fails `check:park` on current `main`**
— `route.crossesRail: 4`, four walks routed across the railway at grade 0.56 m
above the rail where the deck needs 4.06 m. Green in `test:procgen` (80/80).
Written up on **#437**.

## Browser QA is already done (port 5551, server killed)

- Fresh profiles drew 24, 208, 24, 24, 20260728 and remembered each.
- "Yes, start a new game" took a device 20260728 → 5, reloading exactly once
  (one console line on the new document, reading `(drawn)`).
- `?seed=208` pinned without persisting; 24 and 208 are visibly different,
  walkable parks.

## What is left

1. Top the pool up to 16 as the search finds more, then re-run
   `pnpm run vet:seeds -- --list <the whole pool>` as a final confirmation.
2. `pnpm run check` (exit 0), `pnpm run test:procgen` (**497**), `pnpm run build`.
   Run these when the vetting processes are finished — `check:park-boot` and
   `check:solve-cost` are load-sensitive.
3. PR body: pool, hit rate, failures, how to change 16, and #437's blind spot.
