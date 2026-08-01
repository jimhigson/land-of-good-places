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

| seed | worst gap | fouling pairs | trees |
| --- | --- | --- | --- |
| canonical 20260728 | −2.65 m | 18 | 30 |
| 2 | **−2.97 m** | 13 | 29 |
| 5 | −2.73 m | 17 | 30 |
| 11 | −2.80 m | 15 | 30 |
| 18 | −2.31 m | 17 | 32 |

Negative means properly interpenetrating. −2.65 m at a 3.24 m canopy is a wall
buried inside a tree.

**Measure these with a script, not from the test output.** My first pass read
the worst gaps off the vitest failure message, which prints only
`fouls.slice(0, 8)` — so the figure was the worst of the first eight pairs, not
the worst overall. It was wrong for seed 2 (reported −2.52, actually −2.97) and
right elsewhere only by luck. Review caught it. The table above is recomputed
over every tree/wall pair.

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
  trees across all seeds. **Cost: the headless park build roughly doubles, from
  ~370 ms to ~750-800 ms** (i.e. about +400 ms). State it as the total, not
  just the delta — quoting only "+400 ms" understated it in review. 260 000
  would give 28 on canonical and is deliberately not taken: half a second more
  load for two trees nobody can count.
- The suite's anti-vacuity guard was strengthened from `trees > 0` to
  `trees > 24`, with the reasoning written down next to it.

### The guard needed a second pass — read before touching the number

It was first set at `> 24`'s predecessor, **`> 20`, and that did not work**.
Review reverted the budget with the wall fix still in place and got
19/23/23/27/23; only the 19 tripped. Four of five seeds thinned by 21-28% and
sailed straight through. The comment beside it claimed "20 is a floor that a
genuinely thinned park trips", which was simply false.

Measured properly, both ways round:

| | canonical | 2 | 5 | 11 | 18 |
| --- | --- | --- | --- | --- | --- |
| healthy (120 000) | 26 | 27 | 26 | 30 | 28 |
| thinned (26 000) | 19 | 23 | 23 | **27** | 23 |

**The two sets overlap** — seed 11 thinned (27) plants more than the canonical
seed healthy (26). So no single global floor can separate them everywhere, and
any threshold low enough to keep a real park green must let seed 11's thinning
through. `> 24` is the best a global floor does: catches 4 of 5, keeps two
trees of headroom under the lowest healthy seed. `> 25` catches no more and
leaves one tree of headroom, so it is not worth the false alarms.

Verified both directions: real park 50/50 green; budget reverted, 4 suites go
red on this guard.

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
