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
- [ ] 60-seed sweep baseline + per-seed fingerprint baseline
- [ ] CPU profile of a slow seed
- [ ] Hot-path fixes
- [ ] Rescue-tier constructive poses
- [ ] After-numbers, budget update, PR

## Baseline (this machine, M-series, idle)

Canonical seed 20260728, `measure:procgen --no-world`, runs so far:
cruiser 1223 / 1245 ms · slide 4650 / 4615 ms · train 42 · boundary 48-50.

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
