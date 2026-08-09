# HANDOFF — cruiser solve cost + the two-authorities pose filter

Branch: `fix/cruiser-solve-cost` · Worktree: `.claude/worktrees/cruiser-cost`
Base: e932396 (origin/main, 8 Aug)

## The commission

The Sky Cruiser is the park's dominant solve cost (canonical 1.26-1.70 s,
sweep median 3.3 s, p90 17.4 s, worst 58.2 s) and the cause of 11 of the 12
sweep failures — `stationPoses` proposes ~1,408 start poses,
`stationWindowIsClear` throws away ~1,400 of them, because the window tests
**bounding circles at 1.2 m** while the search tests **footprints at 3.6 m**
(corridor 3 + 0.6). Decision 10 part 4 names this: two authorities for one
question. Seeds 4/29/30 die after 8/14/10 poses. Seed 5's CI hook timeout
(stopgap: 120→300 s, PR #257) is the same disease.

Constraints (from the brief, verbatim intent):
- Every seed that currently SOLVES must produce a **byte-identical** cruiser
  route (fingerprint-cruiser.mts before/after, all solving seeds).
- Seeds that currently FAIL flipping to solving is a WIN. Solve-rate must not
  drop below 48/60.
- Re-derive check:solve-cost budgets from fresh medians (8x rule).
- test:procgen + full npm run build green. PR, no self-merge.

## Design (decided up front, before code)

Byte-identity forbids touching the pose list on seeds where the search
succeeds — any change to the filter changes which poses draw `rng.unit()`,
which scrambles the shuffle and re-rolls every park. So the fix has two
independent parts:

1. **Hot paths**: exact identity transforms only (Decision 10 part 3's rule),
   verified by fingerprints + unchanged solve-report counters.
2. **The two-authorities fix as a rescue tier**: the existing pose pipeline
   runs byte-identically first; only when the search EXHAUSTS it (today: park
   fails to build) does a second brief run with poses constructed against the
   search's own truth — `clear`-predicate-qualified windows (footprints at
   corridor radius), per Decision 10 part 4. Solving seeds never reach it;
   failing seeds get a real outermost level.

## State

- [x] Worktree, npm ci, all required reading done
- [x] Canonical baseline measured (below)
- [x] 60-seed sweep baseline (48/60; failures 4,8,9,10,21,25,29,30,37,48,56
      cruiser + 53 slide; cruiser median 2834 / p90 14551 / max 51950 ms)
- [x] Per-seed fingerprint baseline: scratchpad/fp-base (50 solving files)
- [x] CPU profile (canonical + seed 55): selfClear 19-23%,
      minCurvatureRadius 14-18%, clearOfFootprints 12-14%, clear 7-9%,
      boundary ~8%. KEY FINDING: sampled-curvature rejections are only 13k
      of the 1M "curvature" rejections (rest are analytic biarc); validate
      full-scanned 5.3M pieces at 65 samples each, 2.1M of which the world
      checks reject anyway → curvature moved LAST + bailBelow.
- [x] Hot-path fixes (commit 28300da): canonical 1245 → 812 ms; seed 55
      ~18 s → 10.6 s. Fingerprints identical on all 5 CI seeds. NOTE:
      rejected-cause ATTRIBUTION redistributes (total per piece unchanged,
      route bytes + structural counters identical) — documented in validate.
- [x] Rescue tier (commit 7d1d2d3): one policy generator cruiserRouteSearch
      (route.ts), both cadences drive it. Seed 4 flips (94 poses, was 8),
      seed 29 flips (274, was 14), seed 30 honestly unsolvable (268 poses,
      1M pieces, cannot close).
- [ ] After-sweep running (btw9wrl7k) → flip list + after-numbers
- [ ] 60-seed fingerprint re-run (must equal fp-base on all 50 solving)
- [ ] check:solve-cost budget re-derive (8x fresh median), stale prose
- [ ] test:procgen + npm run build + PR

## Baseline (this machine, M-series, idle)

Canonical seed 20260728, `measure:procgen --no-world`, median of 3:
cruiser 1244.9 ms · slide 4635.6 · boundary 50.3 · layout 8.8 · train 42.2
· railRace 12.2 · paths 11.9. After hot paths: cruiser ~812 ms.

## Key file map (for a replacement)

- `src/world/coaster/route.ts` — stationPoseSearch (rings, the 1.2 m filter
  `stationWindowIsClear`), coasterRouteBriefSearch (builds `clear`), the
  profile pipeline.
- `src/world/coaster/solve.ts` — CRUISER_SEED, planCruiser, brief drivers.
- `src/world/rail/generate.ts` — railRouteSearch (the search; throws
  RailRouteUnsolvable on exhaustion), solveRailRoute.
- `CoasterRoute` constructor: `first` brief, then `escalated` (2x castle
  weight) only if `!satisfied`. RailRouteUnsolvable from either kills the
  park today — that is where the rescue tier hooks in.
- Fingerprint: `scripts/fingerprint-cruiser.mts` (LGP_SEED=n selects seed).
- CI seeds: canonical(20260728), 2, 5, 11, 18 (test/procgen/seed-*.test.ts).
