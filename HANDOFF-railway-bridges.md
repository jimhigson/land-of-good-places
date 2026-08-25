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

## State: feature complete, fully verified, ready for PR

`tsc` clean. `test:procgen` clean across all five seeds (canonical, 2, 5,
11, 18) — 353/356 tests pass; the only 3 failures are `test/input/
wheel-zoom.test.ts` (`window is not defined`), pre-existing and unrelated
to bridges, already fixed on `origin/main` (#296) but not yet in this
branch. `check:park` clean (16/16 attractions, 0 rail crossings, 166/166
waypoints, all six invariants). `npm run build` runs every check clean
**except** `check:park-boot`, which is a wall-clock/frame-budget check that
also fails on an unmodified `origin/main` checkout in this sandbox — see
"Known non-issue" below, this is not a regression.

## Three real bugs found and fixed after the first "feature complete" pass

The earlier state of this handoff (superseded) believed the feature was
done pending a clean `test:procgen` run. It wasn't — three real, separate
bugs surfaced under full verification, all now fixed:

1. **`bridgeKeepout.ts` computed its crossings at module-load time**, before
   `Garden`'s `buildPaths()` ever runs — `pathCentreline()` was reliably
   empty at that point, so the plan-time footprint used to keep scenery off
   a bridge silently disagreed with the real, built bridge. Fixed by making
   the computation lazy (first real call, which happens during `Scenery`'s
   own construction — always after `Garden`). Also gave `BridgeFootprint
   .covers()` and `Bridge.deckCovers()` an optional padding margin (default
   `0`, exact, for every runtime consumer) so a caller with real physical
   thickness — a garden wall, a lamp base — can ask for a bit of clearance
   past the bridge's own exact edge without that padding leaking into
   `NavGrid`/`fence.ts`/`poiGraph`'s own exact boundary.
2. **A single, shared `rampRun`** forced a boundary-constrained crossing's
   short side onto the roomy side too, and — worse — a boundary truncation
   that re-applied `MAX_RAMP_GRADIENT`'s own floor could snap straight back
   up past the truncation it just found, on the hand-added "gate walk"
   crossing (issue #116 seeds 11/18: the ramp reached ~8 m past the map's
   edge). Fixed with per-side `rampRunPos`/`rampRunNeg`, and the boundary
   truncation now floors at a small physical minimum instead of the grade
   floor — `everyBridgeIsWalkableAndReachable`'s own "a maximally cramped
   bridge; nothing to probe this far out" already anticipated this case.
   Also: `fence.ts`'s deck-seam height picked the *tallest* of two
   overlapping decks, which is right for "where does a walker stand"
   (`bridgeHeightAt`) but wrong for "where does the fence open" — it
   stranded a walker on the *shorter* deck below the taller seam. Now picks
   the lowest.
3. **`check:jitter` failed** (children moving at up to 216 m/s) — pre-dated
   this session's own fixes, bisected to commit `248b339`'s new fence
   centre-line collider landing under a couple of existing NPC routes.
   Root cause: `NpcCharacter.move()`'s "trust the resolved position"
   formula divides *any* one-time `collision.resolve()` escape by `dt`, so
   an unrelated large correction (not this frame's own small step) reads
   back as a burst of speed, and bounded deceleration then takes many
   frames to bleed it off — the same feedback loop `endScripted()`'s own
   comment already names once, for a different trigger. Fixed with a shared
   `boundEscape()` helper, used by both `move()` and `endScripted()`, that
   caps how far one `resolve()` call may be trusted per frame and lets a
   genuinely embedded child walk free over a few frames instead of being
   launched. Verified against `origin/main` directly (`check:jitter` passes
   clean there) to confirm this was a real regression on this branch, not a
   pre-existing, unrelated issue.

## Known non-issue: `check:park-boot` in this sandbox

Fails with a different phase reported "0 pieces" and different overrun
timings on every run — the signature of CPU-contention noise, not a
deterministic bug. Confirmed by running it against a clean `origin/main`
worktree in the same sandbox: fails there too, exit 1. This sandbox runs
many concurrent agent sessions; `check:park-boot` measures real wall-clock
frame budgets and is not resilient to that contention. Not something this
PR introduced or can fix from inside the PR.

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
