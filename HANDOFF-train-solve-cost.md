# HANDOFF — train solve cost: where the "1.4 s train stage" actually goes

Branch: `fix/train-solve-cost` · Worktree: `.claude/worktrees/train-solve-cost`
Base: `993dcf3` (main, the Land Hotel merge #236/#241)

## The findings (all measured, 8 Aug)

**1. The headline "train/plan.ts costs 1.4–1.5 s" is a real number measuring
two things at once.** A bare timed import of `train/plan.ts` costs 1478–1569 ms
on the canonical seed, decomposed (scratch script importing each dependency
first, same billing as `measure-procgen.mts`):

```
three 15 · boundary 54 · layout 8 · cruiser 1264-1345 · train's own 153  ≈ 1480 ms
```

The cruiser stage is a *dependency* of the train plan (`COASTER_PLANS` for the
low corridor + exit) and owns ~1.3 s of the bare import. Out of scope here;
already 3.1x-optimised by the hotel session (3218 → 1291 ms canonical).

**2. The train's own stage regressed ~44 → ~153 ms (3.5x) at the hotel merge.**
CPU profile (canonical, inclusive): `train/plan.ts` eval 135 ms → `TrainRoute`
ctor 117 → `solveProfile` 115 → **`repair()` 108 ms**. repair ran
`RELAX_PASSES(700) × BEARINGS(360) = 252,000` times, each scanning **every**
obstacle: 3 rects + 34 circles on canonical (7 layout entries, 24 cruiser
low-corridor discs, ball pit, ferris, cruiser exit) ≈ 9.3M
`Math.hypot`/`rectDistance` calls. The hotel merge doubled the park, which
doubled the census; the scan is O(passes × bearings × obstacles).

**3. Where the lying "~44 ms" comment lives:** NOT in `train/route.ts`/`plan.ts`
on main — it is `scripts/check-park-boot.mts` on the unmerged
`e/cat-bus-stage-a` branch (lines 65 and 177: "the train's is ~44 ms (measured
47 ms idle, 70 ms under load)"). Proof:
`git grep -n "44 ms" $(git for-each-ref --format='%(refname)' refs/remotes/origin)`.
Main carries the measured truth in `train/route.ts`'s header now ("What it
costs — measured, not promised", with the re-measure commands); the cat-bus
owner must re-measure their prose when that branch merges.

## The fix (committed, 4d4d736)

`src/world/train/route.ts` — per-bearing obstacle shortlists for `repair()`:
- Once per solve, each bearing gets the subset of obstacles whose clearance
  disc its probe segment [INNER_FLOOR−16, maxWall+16]·dir can enter
  (`segmentReaches`, conservative by +1e-6).
- Identity: an excluded obstacle measures `d = keep − dist ≤ 0` at every probe
  on that bearing, and repair's `deficit` is a strict running max from 0 — a
  ≤ 0 term can never change the max's value; max is order-independent;
  `Math.hypot` kept (NOT `sqrt(x²+z²)`: different rounding).
- A probe pushed off the segment (deficits can exceed the margin only when a
  probe lands deep inside an obstacle) is caught in repair, which re-runs the
  full scan from the original arguments — replaying the identical in-range
  prefix, then continuing soundly.

`src/world/train/plan.ts` — `nearCruiserLowCorridor` walked the whole cruiser
curve per call (122 calls per solve × ~98 `pointAt` arc-length lookups);
the low points depend only on the solved cruiser, so they are walked once and
cached (same d sequence, same order, same comparisons → same booleans).

## Numbers

| | before | after |
|---|---|---|
| train stage, canonical | 152.3 ms | 40.4–41.3 ms (3 runs) |
| bare import of train/plan | ~1480 ms | ~1370 ms (cruiser dominates) |
| train sweep (60 seeds) median/p90/max | 202.8 / 255.9 / 294.3 | (after-sweep pending) |
| solve rate 60 seeds | 48/60 | (after-sweep pending) |

## Fingerprint proof — identical before/after

`scripts/fingerprint-train.mts` (new): full-double-precision SHA256 of route
control points + 2000 samples + stations (all fields) + crossings (all fields,
computed exactly as `ParkTrain` computes them); fence spans are a pure
function of hashed inputs (`fence.ts` step 1).

```
seed 20260728  c97d68e9e7b1e3cdfb920c35d04e943aa5c0e9d19865fecae33acb41f04394da
seed 2         20b6a8016e2a2123e13c1820492685a49f28371e5ae14b2078d1a484378fb161
seed 5         09b19156639d3818ab844dcf3a6bc035789513693ce60d1f056dba8ba1c088c8
seed 11        2b647dde0aa98b0f98f36b55c698e76d87e2332e2e40cb855c835f3c51391d08
seed 18        325a88f7b92c8093594632bf5383774b71159a8b0cb46fae3abd841a32f08bc8
```
Byte-for-byte the same hashes before and after the fix, all five CI seeds.

`npm run test:procgen`: **Test Files 10 passed (10) · Tests 265 passed (265)**
(after the fix; bare-exit-code re-run pending in background).

## The new check: `check:solve-cost` (bridge, not rival owner)

`scripts/check-solve-cost.mts`, wired into `npm run build` after `check:park`.
- Owns: raw module-scope cost of each solver stage (boundary, layout, cruiser,
  train, slide, railRace, paths), Node, canonical seed, vs regression budgets.
- Does NOT own: whether generation fits the ride's frame slices — that is
  `check:park-boot` (cat-bus branch), driven through `ParkGeneration.advance()`
  + event-loop lag. Both should exist on main when cat-bus lands; reconcile
  numbers, not ownership (details in the check's header).
- Budget = **8 × measured, floor 250 ms** (formula is one owner, `budgetMs`).
  8x absorbs CI hardware (~2-3x) and load (~2x); a 30x regression trips the
  stages that matter several times over; sub-20 ms stages sit on the floor and
  are guarded at ~15-30x — stated trade, it is a tripwire not a profiler.
- Measured medians recorded in the file: boundary 54, layout 9, cruiser 1274,
  train 41, slide 4609, railRace 13, paths 12 (canonical, idle, 3 runs).
- Red proof: pending (busy-wait scratch mutation in train/plan.ts, after the
  bare vitest re-run finishes — src must not move mid-suite).

## Coordinator addendum, to flag in the PR body (Jim, via coordinator)

- `check:park-boot` on `e/cat-bus-stage-a` already catches this class of cost
  and went red the moment that branch merged main's hotel work; nothing ever
  pointed it at main — "the check isn't wrong, nobody asks it the question"
  (the #231 five-hollow-gates shape).
- Other checks that exist but are never asked where the code changes
  (observations only, no fixes):
  - `check:wall-tunnelling` is defined in package.json but absent from
    `npm run build`; only `check:all` runs it, and **no workflow runs
    `check:all`** — CI runs `test:procgen` + `build` (procgen-invariants.yml)
    and `build` (deploy.yml). It never runs on CI.
  - `measure:solver-budget` / `probe-solve.mts` are measure-only by design
    (fine), but nothing asserts on what they measure.
  - `check:park-boot` / `check:frame-time` exist only on `e/cat-bus-stage-a`
    (the named gap this PR bridges).

## Still to do

- [ ] bare-exit-code `test:procgen` re-run (background task bxajb0gz0)
- [ ] red-proof the check (busy-wait mutation, record, restore), commit check
- [ ] after-fix 60-seed sweep (train medians + solve-rate for the PR table)
- [ ] `npm run build` full chain, exit code from the command
- [ ] PR (`gh pr create`), before/after + addendum; do NOT merge
