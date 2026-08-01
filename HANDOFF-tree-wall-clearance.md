# HANDOFF — tree/wall clearance

Branch `tree-wall-clearance`, worktree `.claude/worktrees/tree-wall-clearance`.

**Task.** Jim reported procgen letting a wall and a tree overlap. Fix the
placement; add a permanent invariant so it cannot silently come back.

## Status

Both commits are in. Build and the procgen suite are green. See the bottom of
this file for what is left.

- `2f8ad8b` — the invariant, committed **deliberately red**.
- `562ee8e` — the placement fix.

## Root cause

Two isolated placement systems, each blind to the other. `buildFoliage`
gates every tree through `isPlantable`, which tests the park edge, the paths,
the plaza, the anchors and the railway — and **no walls at all**.
`clearOfAnchors` trims wall runs against anchor plots and **not** against
trees. So nothing anywhere related a tree to a wall.

Measured before the fix, worst tree-to-wall gap (canopy edge to wall face):

| seed | worst gap | fouling pairs |
| --- | --- | --- |
| canonical 20260728 | **−2.65 m** | 18 |
| 2 | −2.52 m | 13 |
| 5 | −2.73 m | 17 |
| 11 | −2.80 m | 15 |
| 18 | −2.31 m | 17 |

Negative means properly interpenetrating. −2.43 m at a 3.24 m canopy is a wall
buried inside a tree.

## The fix, and why this shape

Approach (a) from the brief — refuse the spot, do not clean up afterwards —
which is the pattern every other conflict in `Scenery.ts` already uses.

**Reordering the constructor turned out to be unnecessary**, which removes the
whole risk the brief asked me to check. `wallPlan()` is a *pure, memoised
pre-scene plan*: it depends only on `PARK_SEED`, `PARK_LAYOUT`, `TRAIN_PLAN`
and `ANCHORS`, and never touches the `CollisionWorld`. So the walls are
already knowable at the moment the first tree is placed, with `buildFoliage`
left exactly where it is. This is the same precedent the file already set for
the railway: once the rail route became a pure plan, the trees became the ones
to give way. They now give way to the walls for the same reason.

### Two traps worth knowing about

1. **The wall test must not go inside `isPlantable`.** The wall generator's own
   `runIsClear` calls `isPlantable` for every candidate run, so a wall test in
   there would ask `wallPlan()` for an answer while `wallPlan()` was still
   computing it — unbounded recursion on the first tree of the first park. The
   check lives in `clearOfWalls`, called from the tree loop only.
2. **`clearOfAnchors` moved into `wallPlan()`.** It used to be applied
   separately by `buildWoodenWalls` and `buildStoneWalls`. With the scatter
   needing the same list, that would have been three places obliged to trim
   identically. Now the plan *is* what gets built and there is one list.
   Output is unchanged — `clearOfAnchors` is pure and was already being
   applied with the same default margin in both builders.

### Threshold

`TREE_WALL_GAP = PLAYER_RADIUS * 2 + 0.2`. Two player radii is the floor, the
same number `WALL_RUN_GAP` argues from: `NavGrid` fattens every collider by
`PLAYER_RADIUS` before calling a cell walkable, and every tree has a collider,
so a narrower slot is a dead end that looks like a way through. The 0.2 m is
slack, not rule — the generator reserves `TREE_REACH`'s pessimistic ceiling
while the invariant measures the canopy actually built.

`TREE_REACH` is a genuine ceiling on the measured footprint, which is what
makes the generator provably satisfy the invariant rather than coincidentally:
tree lean scales only the *trunk*, and `parkFacts` skips trunk parts when it
computes `footprint`.

## The invariant

`treesKeepOffWalls` in `test/procgen/invariants.ts`, plus one line in
`INVARIANTS`. Canopy edge to wall face, held to the existing `WALKABLE_GAP`.

**Proved it is a real regression guard, not a check that happens to pass.**
Committed red first (`2f8ad8b`), on purpose, so the history shows it: it failed
on **all five seeds**, 13-18 fouling pairs each, with the negative gaps in the
table above. Then the fix (`562ee8e`) turned it green. The red commit is the
receipt — reverting `562ee8e` reproduces the failure.

After the fix the worst gap is **1.49-1.74 m** across the seeds, so the park
sits clear of the 1.24 m line rather than balanced on it.

## The thing that nearly went wrong — read this

The fix passed the invariant immediately **and quietly cost the park a third of
its trees**: the canonical seed fell from 30 to 19. Planting fewer trees is the
cheapest possible way to make a clearance invariant go green, and it is not
hypothetical — it happened here, on the first green run.

Two consequences:

- The scatter's attempt budget went from 26 000 to 120 000, restoring 26-30
  trees across all seeds for about 400 ms of extra headless build. 260 000
  would give 28 on canonical and is deliberately not taken: half a second of
  load for two trees nobody can count.
- The suite's anti-vacuity guard was strengthened from `trees > 0` to
  `trees > 20`, with the reasoning written down next to it.

Also worth knowing: **`targetTrees = 72` has not been reachable for some time.**
The lawn is tight enough that the attempt budget runs out first — the canonical
seed was already settling for 30 *before* this change. That is pre-existing and
deliberately not fixed here; the honest fix is a scatter that does not
rejection-sample a tight lawn at all, which is a bigger job than this bug.

## Deliberately not done

**Bushes.** `buildFoliage`'s bush loop has the same blindness and I left it
alone. Bushes are not in `foliageOccluders`, so `ParkFacts` cannot see them and
no invariant could cover the fix — and fixing what the suite cannot watch is
how the next regression gets in unnoticed. A bush merging into the foot of a
wall also reads as planting rather than as a fault, which a tree trunk through
a wall never does. Covering it properly means exposing bushes on `Scenery` and
adding bush facts; worth a follow-up, not worth smuggling into this PR.

## Verification

- `npm run build` — exit 0 (checked as a real exit code, not through `tail`).
- `npm run test:procgen` — 50 passed across 5 seed files.
- No browser QA done: I was not given the shared Chrome. **Worth a look:** the
  lawn near the wall runs, which is where trees have moved and thinned.

## Left to do

- PR review and merge are the Overseer's. Do not self-merge.
