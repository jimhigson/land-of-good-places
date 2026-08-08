# HANDOFF — train solve cost: where the "1.4 s train stage" actually goes

Branch: `fix/train-solve-cost` · Worktree: `.claude/worktrees/train-solve-cost`
Base: `993dcf3` (main, the Land Hotel merge #236/#241)

## Findings so far (measured, 8 Aug)

**The headline "train/plan.ts costs 1.4–1.5 s" is a real number measuring the
wrong thing.** A bare timed import of `train/plan.ts` costs 1478–1569 ms on the
canonical seed, but decomposed (scratch script importing each dependency first,
same method as `measure-procgen.mts`):

```
three 15 · boundary 54 · layout 8 · cruiser 1264 · train's own 153   = 1479 ms
```

- The **cruiser stage (~1.26–1.35 s)** dominates the bare import: it is a
  dependency of the train plan (`COASTER_PLANS` for the low corridor + exit),
  already 3.1x-optimised by the hotel session, and out of scope here.
- The **train's own stage is ~153 ms** against the documented **~44 ms** — a
  ~3.5x regression from the hotel merge, and that is the fixable part.

**Where the lying comment actually lives:** NOT in `train/route.ts`/`plan.ts` —
it is `scripts/check-park-boot.mts` on the unmerged `e/cat-bus-stage-a` branch
(lines 65 and 177: "the train's is ~44 ms (measured 47 ms idle, 70 ms under
load)"). Grep proof: `git grep -n "44 ms" $(git for-each-ref --format='%(refname)'
refs/remotes/origin)`. Since that file is not on main, the fix on main is to
carry the measured number in the train solver's own header + the new check;
the cat-bus owner must re-measure when that branch merges (flagged in the PR).

**Where the train's own 153 ms goes** (node --cpu-prof, canonical seed,
inclusive): `train/plan.ts` module eval 135 ms → `TrainRoute` ctor 117 ms →
`solveProfile` 115 ms → **`repair()` 108 ms**. Everything else (stations,
curve build, crossings) is ~20 ms.

**Why repair is hot:** it is called `RELAX_PASSES(700) × BEARINGS(360) =
252,000` times, and each call scans **every** obstacle — canonical seed:
3 rects + 34 circles (7 layout entries + 24 cruiser low-corridor discs + ball
pit + ferris + cruiser exit) = 37 distance evaluations (`Math.hypot` /
`rectDistance`) per call ≈ **9.3M evaluations**. The hotel merge doubled the
park, which grew the layout census and the cruiser's low corridor — the scan
is O(passes × bearings × obstacles) and obstacles roughly doubled.

## The fix (in progress)

Per-bearing obstacle prefilter, byte-identical by construction:
- Precompute once per bearing the subset of obstacles whose inflated
  (by their own `keep` + margin) distance to that bearing's probe segment
  can ever be positive; `repair()` then scans only that subset.
- Identity argument: an excluded obstacle has `d = keep − dist ≤ 0` for every
  probe on that bearing, and `deficit` starts at 0 and is a strict max — an
  excluded obstacle can never change the max's value. Max is order-independent,
  no accumulation, `Math.hypot` retained (NOT `sqrt(x²+z²)`, different
  rounding).
- Probe-range bound: entry radius is a convex-ish blend of snapped values in
  [INNER_FLOOR, max wall] ± pull; each of ≤3 attempts moves ≤ keep(4.2) →
  drift ≤ 12.6 m; margin 16 m used.

## Fingerprints (BEFORE, HEAD untouched) — must be identical after

```
seed 20260728  c97d68e9e7b1e3cdfb920c35d04e943aa5c0e9d19865fecae33acb41f04394da
seed 2         20b6a8016e2a2123e13c1820492685a49f28371e5ae14b2078d1a484378fb161
seed 5         09b19156639d3818ab844dcf3a6bc035789513693ce60d1f056dba8ba1c088c8
seed 11        2b647dde0aa98b0f98f36b55c698e76d87e2332e2e40cb855c835f3c51391d08
seed 18        325a88f7b92c8093594632bf5383774b71159a8b0cb46fae3abd841a32f08bc8
```

Tool: `scripts/fingerprint-train.mts` (new, this branch) — full-double-precision
hash of route control points + 2000 samples + stations + crossings; fence spans
are a pure function of hashed inputs.

Repro commands:
```
env LGP_SEED=<seed> node --experimental-transform-types --no-warnings \
  --import ./scripts/ts-extension-resolver-register.mjs scripts/fingerprint-train.mts
node --experimental-transform-types --no-warnings \
  --import ./scripts/ts-extension-resolver-register.mjs scripts/measure-procgen.mts --no-world
```

## Coordinator addendum to carry into the PR body (Jim, via coordinator)

- `check:park-boot` on `e/cat-bus-stage-a` already catches this class of cost
  and went red the moment that branch merged main's hotel work; nothing ever
  pointed it at main — "the check isn't wrong, nobody asks it the question"
  (same shape as #231's five hollow gates).
- The new solve-cost check on main is a BRIDGE, not a rival owner. Mine owns:
  raw module-scope stage cost vs a regression budget, in Node, per stage.
  check:park-boot owns: whether generation fits the ride's frame slices
  (advance() budget + event-loop lag) under `ParkGeneration`. Reconciliation
  when both are on main: keep both if they measure different questions;
  if the cat-bus merge makes mine redundant for the train stage, fold my
  budgets into check-park-boot and delete mine — written answer in the check
  header.

## Still to do

- [ ] Baseline 60-seed sweep (running, background task bk0gm6rrz)
- [ ] Implement repair() prefilter in `src/world/train/route.ts`
- [ ] (maybe) cache cruiser low points for `nearCruiserLowCorridor` in plan.ts
- [ ] After-fingerprints ×5 must match; measure-procgen canonical + sweep after
- [ ] test:procgen 265/265
- [ ] New `scripts/check-solve-cost.mts` + package.json `check:solve-cost`,
      budgets as ~4x measured, red-proof via scratch mutation, wire into build
- [ ] Truthful cost note in train/route.ts header (number + command)
- [ ] PR with before/after + addendum flags; do NOT merge
