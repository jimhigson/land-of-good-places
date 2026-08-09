# HANDOFF — cruiser solve cost + the two-authorities pose filter

Branch: `fix/cruiser-solve-cost` · Worktree: `.claude/worktrees/cruiser-cost`
Base: e932396 (origin/main, 8 Aug)

## The commission

The Sky Cruiser was the park's dominant solve cost and the cause of 11 of the
12 sweep failures: `stationWindowIsClear` qualifies start poses with bounding
circles at 1.2 m while the search tests footprints at 3.6 m — Decision 10
part 4's "two authorities for one question". Constraints: byte-identical
routes on every currently-solving seed (fingerprint proof); failed seeds
flipping to solving is a win; solve-rate ≥ 48/60; budgets re-derived; tests
and build green; PR, no self-merge.

## RESULTS (all measured this machine, M-series, idle, 8 Aug 2026)

### Speed — canonical seed, median of 3, `measure:procgen --no-world`
| stage | before | after |
|---|---|---|
| cruiser | 1244.9 ms | **788 ms** (1.58x) |
| slide | 4635.6 ms | **4070 ms** (1.14x, same shared generator) |
| TOTAL | ~6000 ms | ~4990 ms |

### Sweep, seeds 1-60, 8-wide, `--no-world`
| | before | after |
|---|---|---|
| SOLVE RATE | 48/60 (80%) | **56/60 (93%)** |
| cruiser median | 2834 | **1849** |
| cruiser p90 | 14551 | **8427** |
| cruiser max | 51950 | **30108** |
| TOTAL median | 6719 | **4728** |
| sweep wall | 170.0 s | 150.7 s (with 8 more seeds actually solving) |

### Byte-identity proof
- Cruiser fingerprints (curve SHA256 + counters): **50/50 solving seeds
  identical** (49 sweep + canonical) — scratchpad fp-base vs fp-after.
- Train fingerprints vs a `git archive e932396` snapshot: **5/5 CI seeds
  identical**. Slide: **5/5 CI seeds identical** (both ride the same
  generator I touched).

### Flipped seeds (failed → solving)
4, 9, 10, 21, 29, 37, 48, 56. Of these, **21 and 37 fully satisfied**
(castle crossing); 4, 9, 10, 29, 48, 56 build WITHOUT the castle crossing
(the search's own "a park with no coaster is far worse" fallback).
Still failing: 8, 25, 30 (cruiser — rescue also exhausts; seed 30's error
message now carries both tiers' reports), 53 (slide, out of scope).

### Known quality gaps on rescued parks (measured, seed 4, not committed)
Ran the full invariant suite against seed 4's new park: 52/55 pass. The 3
reds: castle crossing absent; a 97.4 m unsupported track span (pylon
placement can't support part of the rescued loop); a Rail Race duck bar
that doesn't slow riders (unrelated to the cruiser). So a rescued park is
*playable but imperfect* — where yesterday it did not exist at all. This is
why no sixth suite seed was added; proposed as follow-up in the PR.

## What shipped (commits)

1. `28300da` hot paths, all exact identity transforms: curvature check moved
   LAST in validate + bailBelow (the 65-sample scan ran on 5.3M pieces and
   rejected 13k — the 1M "curvature" rejections are the cheap analytic biarc
   check); dense self-clear grid over the brief's extent (Map→flat array,
   buckets reused across attempts, axis prefilter); plot-grid shortlists in
   parkLayout (12 m cells, 8 m margin ceiling, full-scan fallback); tall-
   obstacle axis prefilter; solverBoundary single-derivation lookup.
   NOTE: rejected-cause ATTRIBUTION redistributes (one increment per
   rejected piece either way; routes + structural counters identical).
2. `7d1d2d3` the rescue tier: `stationWindowHasLegalTrack` asks the brief's
   own `clear` at CORRIDOR_RADIUS (one truth); `rescueStationPoses` rebuilds
   the rings over it, lazily (`CoasterBriefs.rescue()` thunk — solving seeds
   never build it, so cannot be perturbed); the whole retry ladder is now
   ONE generator `cruiserRouteSearch` in coaster/route.ts, driven by both
   the constructor and boot/parkGeneration (ends the hand-mirrored policy).
   Two lesser rungs, reachable only on previously-dead parks: escalated
   throwing returns tier-1's plan; rescue throwing reports both failures.
3. Budgets: check-solve-cost cruiser 1274→788, slide 4609→4070 (8x rule,
   fresh medians, noted in its header). Stale "~1.3 s" prose updated in
   plan.ts, prewarm.ts, parkGeneration.ts, check-park-boot.mts (incl. the
   honest 3x-separation note), train/route.ts, coaster/route.ts.

## FINAL STATE — PR #258 raised, not merged (per policy)

- `npm run test:procgen`: **Test Files 11 passed (11), Tests 306 passed
  (306)**, EXIT 0 — quoted off the screen.
- `npm run build`: **EXIT 0** (whole gate chain + vite; log in scratchpad).
- `check:solve-cost` green against re-derived budgets (in-build and alone).
- PR: https://github.com/jimhigson/land-of-good-places/pull/258
- Worktree left in place for review follow-ups.

## Still open / follow-ups proposed
- Rescued parks and the castle: a third rescue rung at 4x influence might
  buy crossings on 4/9/10/29/48/56; Decision 7's cost argument says only
  those seeds would pay. Not attempted (scope/time).
- Pylon support gaps on rescued loops (seed 4: 97.4 m span) — pylons
  module can't stand under crowded ground; same crowding that starved the
  poses.
- Seed 5's park build is now slide-dominated (40 s of 40.4 s locally) —
  the CI hook pressure is the SLIDE's now, not the cruiser's.
