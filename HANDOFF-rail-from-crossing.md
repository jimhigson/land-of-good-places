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
