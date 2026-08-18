# Handoff — railway-bridges (issue #116)

**This file replaces an earlier handoff from #220's own author** (the
groundwork PR), which this commit overwrites rather than appends to — noted
here so that's not silent. Their one live concern was sequencing: land the
deck/ramp work only *after* `feat/park-spline-boundary`'s reshape, since
bridge placement is fully derived from the park boundary and would need
redoing otherwise. Checked before writing this: `GARDEN_PLAY_BOUNDARY`
already exists in `src/world/boundary.ts` on current `origin/main`, so that
reshape landed before this branch started — the sequencing concern is
already satisfied, not overlooked.

## State: feature complete, verification in progress

All code is written and committed. `tsc` clean (both main and test
tsconfig). `check:park` clean on canonical seed and sweep seeds 2, 5, 18.
`check:solve-cost` passes. Branch merged with `origin/main` (which had moved
significantly — other PRs landed mid-task) with no conflicts; my own hunks
verified intact post-merge via `git diff origin/main...HEAD`.

**Still running when this was written:** `npm run test:procgen` (full 5-seed
vitest suite, background task `byvicct1a`) and a follow-up `npm run build`.
An earlier run of both raced against the `git merge` and produced
contradictory output (files "1 failed" + "exited with code 0" in the same
run) — discarded, do not trust that result, re-run clean.

**If you're picking this up:** check `test:procgen`'s result. If clean,
open the PR (`gh pr create` or `mcp__github__create_pull_request`,
`railway-bridges` → `main`, body drafted at `.pr-body.md` in this worktree —
delete that file before/after opening the PR, it's scratch, not meant to be
committed). If seed 11 (the slow one, ~160s solve) shows a bridge-related
failure not seen on the other seeds, it's likely the same class of bug as
seeds 2/5/18 hit before the fixes in the second and third commits
(overlapping bridges at tight crossing spacing, or a scenery conflict) —
check `bridgeHeightAt`'s max-not-first fix and `bridgeKeepout.ts` are both
still wired in.

## What was built (see the two commits' own messages for full detail)

- `src/world/train/bridges.ts` — deck (flat `MovingPlatform`) + two ramps
  (stepped `MovingPlatform`s, `ArcTread`'s idiom) per crossing.
- `src/world/train/bridgeFootprint.ts` — pure ground-plane footprint math,
  shared by `bridges.ts` and the plan-time keep-out.
- `src/world/train/bridgeKeepout.ts` — plan-time (module-load) bridge
  footprints so `Scenery`/`LampPosts` can keep clear before any bridge is
  built, mirroring `distanceToRailCorridor`.
- `src/world/train/fence.ts` — fence stays continuous under a bridge
  (`topIsAbsolute` seam); a new centre-line collision wall closes the
  un-walled middle of the corridor that used to make the whole loop
  "reachable" once any bridge touched it.
- `src/world/train/clearance.ts` — `BRIDGE_RISE`/`BRIDGE_DECK_DEPTH`/
  `FENCE_OFFSET`/`FENCE_SEAM_MARGIN` moved here (single leaf owner, avoids a
  circular value-import between `bridges.ts` and `fence.ts`).
- `src/world/NavGrid.ts` — `bridgeCovers` param: exempts bridge cells from
  stamping, restricts them to one level (the bridge's own surface).
- `src/entities/npc/poiGraph.ts` — height-aware `isClear`/`lineIsClear` via
  a `bridgeHeightAt` param.
- `scripts/check-park.mts` — invariant 2's `atLevelCrossing` escape removed;
  deck sample now reads from `NavGrid.TOP_REFERENCE` (exported for this)
  instead of ground level; invariant 4's crossing exemption removed (fence
  is continuous now, nothing to exempt); both wired to the same
  `bridgeHeightAt`/`bridgeCovers` helpers `World.ts`/`Game.ts` use.
- `test/procgen/invariants.ts` + `parkFacts.ts` — extended
  `railwayClearanceCoversTheTrainAndItsRiders` (real deck soffit vs
  `TRAIN_CLEARANCE_Y`), new `everyBridgeIsWalkableAndReachable`. Both proven
  to fail (broken and restored locally) before trusting green.

## Known gap, flagged in the PR body, not fixed

No **visible** guard rail mesh on the deck's edge — only the collision
(banded, matches `hotel/place.ts`'s idiom). May read as an invisible wall in
play. Left for QA to judge/flag rather than guessing at an unverified visual
fix with no browser access this session.

## Open family question, untouched here

ARCHITECTURE-DECISIONS.md Decision 8: "should everyone on the train sit"
(would shorten `BRIDGE_RISE` and every ramp). Explicitly a family call, not
mine to make — noted in the PR body as the lever if the current ~17.6 m
ramp reads as too long in play.
