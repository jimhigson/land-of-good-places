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

**Everything vetted before ~17:20 was thrown away**: `fix/hop-penalty-detour`
(#460, hoppable-wall routing cost 6.4 → 2.65) merged mid-search and moves paths
across the whole park. The branch is rebased on that and the search restarted
from scratch.

Live results are in `seed-vetting.jsonl` (gitignored) and `seed-vetting.log`.
At 40/200 candidates: **3 passers (5, 11, 24) — a ~7.5% hit rate.** All three
are seeds the repo had already vetted as sweep seeds, which is itself a
finding. If 1–200 does not yield 16, extend the range (`vet:seeds -- 201 500`)
rather than lowering the bar.

## What is left

1. Put the passers into `PARK_SEED_POOL` (keep `CANONICAL_PARK_SEED` first).
2. `pnpm run check` (exit 0), `pnpm run test:procgen` (**497**), `pnpm run build`.
3. Play it on port **5551** `--strictPort`: new game twice, confirm different
   parks, each walkable. Close the page immediately; kill the server by PID.
4. PR body: the pool, the hit rate, the failure reasons, how to change 16, and
   the canonical-only checks (#437) that stop describing the real park.
