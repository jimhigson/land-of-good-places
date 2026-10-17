# HANDOFF — engine rework: anything solid is landable (feat/engine-solids)

Owner: Engineer (Opus 5.5). Started 17 Oct 2026 from origin/main 58165723.
Jim's ruling (17 Oct): one 3D solid per object; sides bump, top lands; gravity
drops her on the highest thing beneath her; NO floor registry, NO floor/stand
marking; guards stop her by real height, never a flag.

## Branches
- `feat/engine-solids` — work branch, push every commit.
- `feat/engine-solids-pr` — DRAFT PR head, moved only at milestones (fast-forward).
  Every push to a PR head re-solves 16 parks in CI (30-45 min) and cancels the last run.

## Local setup that saves hours
- Baseline worktree (pristine origin/main, detached): `.claude/worktrees/engine-solids-base`.
- Main's 16 park files (source hash c6596b45…) downloaded from CI run 38828139475,
  artifact `parks-c6596b45d7f1…`, copied to `/tmp/engine-solids-baseline/parks-main-all/`
  and into both worktrees' `.parks/`. Without `.parks` for the current source hash a
  headless park build silently solves (minutes) — see scripts/lib/builtParks.mts.
- Main's accepted restarts: 0:3 1:1 2:3 3:7 4:1 5:1 6:1 7:5 8:1 9:5 10:9 11:4 12:0 13:6 14:8 15:4.
- Seed 5 hydrated digest on main: park=2ee2b3fc87c6b269 (`/tmp/engine-solids-baseline/digest-5-main.txt`).

## Plan / milestones
- (a) switch-over: CollisionWorld owns solids (footprint, base, real top per point);
  ground sampling asks it; delete the four hand-kept "absolute top + plate" copies
  (hotel place.ts, library props.ts, reptileHouse props.ts, Building banquetTables/benchTops);
  parks identical; precedents behave as before.
- (b) real heights everywhere + census of newly reachable tops (deep link per kind).
- (c) guards made tall (visible changes for Jim).

## Findings / decisions (append as they land)
- (pending)

## Status
- [ ] (a) switch-over
- [ ] (b) real heights + census
- [ ] (c) guards tall
