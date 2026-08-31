# HANDOFF — #427, grow the railway from a chosen crossing

Branch `feat/railway-grown-from-a-crossing`, off `origin/main`.

Jim's design: choose where a path crosses the railway *first*, pseudo-randomly,
then grow the loop through that point at right angles to the path — so a
bridgeable, square crossing is true by construction rather than hoped for.

## Why it fits the existing machinery

- `rail/generate.ts` already **grows a track piece by piece** from a start
  pose, backtracking, closing analytically once the head is near home. Growing
  outward from a fixed point is its native mode, not a new one.
- **`startPoses` is the outermost level of the search** (`generate.ts:176`),
  and a closed loop begins *and ends* at one. A pose at the crossing point,
  perpendicular to the chosen path direction, therefore puts the loop through
  that point at that heading **by construction**.
- A **`satisfies` backstop** already exists (`generate.ts:268`) with
  `satisfyRejects` reported, plus `RouteInfluence` (a weighted nudge that
  "changes which routes are likely, never which are possible").

## MEASUREMENT 1 — the restart budget, and it changes the design

`scripts/measure-train-solve-budget.mts` (needs `TrainRoute.solveReport`,
exposed on this branch).

**Baseline, `origin/main`:**

| seed | poses offered | winning pose | restarts | backtracks | time |
|---|---|---|---|---|---|
| canonical | 96 | **#0** | 0 | 31 | 11 ms |
| 2 | 96 | **#53** | 53 | 10 220 | 2 083 ms |
| 5 | 96 | **#61** | 61 | 18 159 | 3 625 ms |
| 11 | 96 | **#18** | 18 | 4 312 | 822 ms |
| 18 | 96 | **#61** | 61 | 18 603 | 3 196 ms |

**Three of the five CI seeds needed 53–61 of the 96 rim start poses before one
solved.** Only the canonical seed solves on its first pose.

**So "pin the loop to one chosen crossing pose" would not solve on most seeds.**
The search genuinely consumes that freedom; `budgets.restarts` comes straight
from `startPoses.length`, and cutting 96 to 1 — or to "a handful" — starves it.

### What that means for the design

The crossing must not be **one** pseudo-random pose. It must be a **ranked list
of many candidate crossing poses**, offered best-first, and tried by the search
exactly as it tries rim bearings today. That keeps the budget intact *and*
makes every solved loop bridgeable by construction, because every candidate in
the list is a pose a bridge provably fits at.

This is a clean mapping onto what exists — `startPoses` is already documented as
"where the route may begin, best first… the outermost level of the search" — and
it is a smaller change than it first looked: **swap the generator of start poses,
not the search**.

`ringStartPoses()` (96 rim bearings, `RIM_STANDOFF` 3.35) is what gets replaced.

## MEASUREMENT 2 — the gating number, and it is emphatic

`scripts/measure-crossing-poses.mts`, asking `bridgeFit.ts` (the same probe the
real planner uses) over a 4 m grid at 8 headings:

| seed | bridgeable poses | distinct points | of points in bounds | sweep |
|---|---|---|---|---|
| canonical | **1112** | 396 | 1269 | 95 ms |
| 2 | **1183** | 372 | 1267 | 91 ms |
| 5 | **1288** | 407 | 1269 | 90 ms |
| 11 | **1268** | 413 | 1265 | 94 ms |
| 18 | **1137** | 399 | 1267 | 96 ms |

**Over a thousand bridgeable poses per seed, against the 96 rim bearings we
have to replace.** The search budget survives outright — there is more than an
order of magnitude of headroom, and the whole sweep costs ~95 ms.

### The finding that matters most

**Seed 2 offers 1183 bridgeable poses and its solved loop proves ZERO bridge
sites.** Its park is full of ground a bridge fits on; the loop simply never
goes through any of it. That is the entire defect, stated as a number — and it
is exactly what growing the loop *from* such a pose fixes. The 79% is not a
scarcity of bridgeable ground, it is a loop that never had a reason to visit
any.

## Still to measure (in order)

1. **Variety across seeds** — do parks start rhyming? Measure, do not assert.
3. **Does 79% become 100%?** 11 of 14 loops admit a bridge today
   (`scripts/measure-bridgeable-loops.mts`, on the #414 branch). By
   construction it should be all of them. If it is not, the construction is not
   doing what it claims — that is the headline, not a footnote.

## The one real refactor this needs

A **route-free** bridge-feasibility probe. `crossingPlanSolve.ts`'s `probeReach`
answers "does a deck plus both ramps fit here", but reads `TRAIN_PLAN.route`
for its rail-corridor and station tests — and the whole point here is to ask
the question *before* a route exists. Extract the geometry (boundary + plots +
reach) so it can be asked of a bare point and direction; the rail-corridor and
station tests do not apply when the rail is what is being placed through it.

## Status

- [x] worktree, baseline restart budget measured
- [ ] route-free feasibility probe
- [ ] candidate crossing pose generator replacing `ringStartPoses`
- [ ] the three measurements above

## MEASUREMENT 3 — the loop still solves, and mostly faster

`scripts/measure-train-solve-budget.mts`, before (rim bearings) vs after
(bridgeable crossing poses), both offering 96:

| seed | won before | won after | restarts before → after | time before → after |
|---|---|---|---|---|
| canonical | #0 | #5 | 0 → 5 | 11 → 53 ms |
| 2 | #53 | #44 | 53 → 44 | 2083 → 3543 ms |
| 5 | #61 | **#4** | 61 → **4** | 3625 → **454 ms** |
| 11 | #18 | #22 | 18 → 22 | 822 → 1432 ms |
| 18 | #61 | **#29** | 61 → **29** | 3196 → **1651 ms** |

**5/5 solve.** The budget concern is dead: seeds 5 and 18 — the two worst —
get *better*, and no seed comes close to exhausting the field.

## MEASUREMENT 4 — 79% → 93%, NOT 100%. The construction is incomplete.

I said in advance I expected 100% by construction. It is not:

`13/14 loops admit at least one bridge (93%)`, up from 11/14 (79%).

**And seed 2 still proves ZERO bridge sites — the very seed this was for.**

### Why, measured

Seed 2's loop is grown from a bridgeable crossing at rail distance 0, and then:

```
loop length 138.0 m
STATION_CLEARANCE = 13.5 m
  station "Sunny Side"    at d=136.3
  station "Bluebell Halt" at d=-2.0
station-blocked: 14/70 candidate distances (20%)
the start pose (d=0) is STATION-BLOCKED
```

**A station landed at d = -2.0 — on the chosen crossing itself**, and
`crossingPlanSolve`'s `stationBlocked` then refuses it. The construction did
put a bridgeable crossing on the loop; station placement took it away
afterwards.

**This is exactly the relaxation flagged in `bridgeFit.ts`'s header** — the
pose generator cannot see stations because stations do not exist when it runs.
It was named as the one genuine relaxation and as the first place to look if
loops still came out unbridgeable. It is the first place to look, and it is
what is wrong.

Checked whether it is systematic: it is **not** — on canonical, 5, 11 and 18
the start pose is not station-blocked. Seed 2 is unlucky *and* short: at 138 m
with two stations, 20% of its distances are station-blocked and there is no
room for an alternative site. Longer loops absorb it.

### The fix (NOT yet built)

**Station placement must keep clear of the chosen crossing.** `train/plan.ts`
slides stations along the solved route already (`clearStationDistance`); it
needs the crossing pose as a keep-out, the same way it avoids other things.
That closes the relaxation at its source rather than widening the probe, and
it should take 93% to 100% — which must then be *measured*, not assumed,
because that is the claim that failed this round.

Also worth noting for variety: seed 2's loop came out **138 m, down from
266 m**. Shorter loops are a real effect of starting inside the park rather
than on the rim, and measurement 3 (variety) is still outstanding.

## MEASUREMENT 4, SECOND ATTEMPT — 100%, re-measured not assumed

After the station keep-out: **14/14 loops admit at least one bridge (100%)**,
up from 13/14 and from 11/14 on `main`. **Seed 2 goes from 0 bridge sites to 1.**

The claim now holds by construction, and the mechanism that broke it the first
time is closed at its source: `CROSSING_STATION_CLEARANCE` lives in
`clearance.ts` and is read from both directions — `crossingPlanSolve.ts` will
not *plan* a crossing that close to a station, `plan.ts` will not *place* a
station that close to the crossing.

## MEASUREMENT 5 — loop length: NOT systematically shorter

Loops are not shrinking park-wide. One seed is an outlier and it is seed 2:

| seed | before (rim starts) | after (crossing starts) | delta |
|---|---|---|---|
| canonical | 356 m | 371 m | **+15** |
| 2 | 266 m | **138 m** | **−128** |
| 5 | 354 m | 294 m | −60 |
| 11 | 296 m | 285 m | −11 |
| 18 | 297 m | 313 m | **+16** |

Mean 313.8 → 280.2 m (−11%), but **almost all of that is seed 2 alone**.
Excluding it: 325.8 → 315.8 m, **−3%** — noise at this scale, and two of the
five seeds get *longer*.

So "starting inside the park shortens loops" is **not** supported. Seed 2's
loop halves, and seed 2 is the most constrained park we build — it is also the
seed that previously could not bridge at all. Worth Jim seeing as a specific
case, not as a trend.

Across all 14 solvable seeds the lengths run 138–400 m, so the population is
still varied.

## Budget, restated over 14 seeds

14/15 solve (seed 3 fails on `main` too — not a regression). Worst is seed 14
at **87 of 96** restarts, which is the only seed near the edge of the field and
is worth watching if the pose count is ever reduced.

## OPEN — `test:procgen` exit 1: 474 passed, 8 failed

Moving the railway moves the park, and eight invariants across five seeds
disagree with the new one:

```
seed 11: every street sits on the shared 12 m lattice
seed 11: the Sky Cruiser flies clear of the whole park
seed 11: the walk in from the gate crosses the railway ... on a bridge
seed 18: railway crossings are planned — station-clear, and mostly real bridges
seed 2:  every street sits on the shared 12 m lattice
seed 5:  the Rail Race finish rainbow stands on the ground
seed 5:  the walk in from the gate crosses the railway ... on a bridge
canonical: the Rail Race finish rainbow stands on the ground
```

None is investigated yet. They are the real remaining work on #427, and they
are not all the same kind of thing — "the finish rainbow stands on the ground"
and "the Sky Cruiser flies clear" are other rides reacting to a moved loop,
while the two gate-crossing ones are this feature's own territory.
