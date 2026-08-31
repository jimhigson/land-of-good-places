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

## TRIAGE OF THE EIGHT — all read, none dismissed

### 1-2. GENUINE, and this feature's own territory: the loop crosses the front door

```
seed 11: the walk in from the gate crosses the railway at (0.0, 55.3),
         railDistance 264.9, 5.0 m in from the arch, and the crossing planner
         planned no crossing there at all
seed 5:  ... at (0.0, 54.8), railDistance 51.9, 5.5 m in from the arch ...
```

The new loops **pass across the park's own entrance**, and the authored gate
corridor (`x = 0`, from `z = 54` inward) meets the track at a rail distance the
planner never offered. So the one leg of the network that is not routed through
a planned site meets the rail anyway — precisely what `crossingPlanSolve.ts`
exists to prevent.

This is a **known hazard, previously measured**: see
`HANDOFF-bridge-at-the-front-door.md`, which records seed 11 solving "a loop
across the park's own front door: it cuts `x = 0` at `z = 54.5`, 5.5 m inside
the arch", and records that a keep-out in `train/route.ts`'s obstacles **was
built and measured** — and reverted because it "re-solves *every* seed's loop"
and belonged in its own issue.

It is now in scope, because growing the loop from interior crossing poses lets
it start anywhere, including beside the gate. **This is the next thing to
build**, and it is not small: it changes every seed's loop again, so all five
measurements have to be re-run after it.

### 3. GENUINE, and adjacent to the clearance just changed

```
seed 18: the crossing at (-24.5, 0.5) opens its fence gap 5.7 m along the loop
         from a station platform — its 4.5 m half-gap overlaps the station's
         sealed ±6.5 m window, so the far side of this crossing is a fenced wall
```

Note what this is **not**: the new keep-out protects the loop's *own chosen*
crossing (rail distance 0) from stations. This is a **different** crossing —
one *measured* from the drawn paths — landing near a station. Same family, one
step further out. `CROSSING_STATION_CLEARANCE` is the right number; the
question is whether the station placer should keep clear of every planned site
rather than only the chosen one.

### 4-5. Downstream: streets pushed off the 12 m lattice

```
seed 11: spur-exit-ginormousSlide runs north-south 27.8 m on x = -10.00,
         4.76 m off the nearest lattice line
seed 2:  spur-hotel runs east-west 10.0 m on z = -33.91, 0.95 m off
```

Paths reacting to a moved railway. Seed 2's is 0.95 m off — marginal; seed 11's
is 4.76 m and is a genuinely private line. Not investigated further.

### 6-7. Downstream: the Rail Race finish rainbow

```
canonical: finish-rainbow-leg-0-inner comes down 0.37 m from a path
           (needs 1.24 m, two player radii)
seed 5:    ... 1.20 m from a path (needs 1.24 m)
```

Seed 5's is 0.04 m short — a hair. **The canonical one, at 0.37 m against
1.24 m, is a real clash a child would walk into.** Another ride reacting to
moved paths, but this one matters and must not be waved through.

### 8. Downstream: the Sky Cruiser through the scenery

```
seed 11: the Sky Cruiser's car passes through 'living-flower-heads'
         at 4.0 m along the loop, world (-57.51, 0.70, -20.16)
```

The cruiser solves *before* the train, so the cruiser has not moved — the
**scatter** has, because it plants around the railway. Flower heads have landed
under the cruiser's car.

### Ruling

**Three of the eight are this feature's own** (1, 2, 3) and one of those — the
front-door crossing — is the substantial one. **Five are the park reacting to a
moved railway**, and at least one of those (the canonical rainbow at 0.37 m) is
a real defect rather than a tolerance.

**No threshold has been adjusted and none should be.** If a ride cannot cope
with the loop shapes this construction produces, that is a finding about the
trade, for Jim.

## THE FRONT-DOOR KEEP-OUT FAILS MEASUREMENT 1 — DO NOT SHIP IT AS WRITTEN

Commit "Keep the railway off the walk in from the gate". Solve rate:

| | before keep-out | after keep-out |
|---|---|---|
| seeds solving a loop | **14/15** | **9/15** |

Newly unsolvable: **5, 11**, 3 (already failing), 4, 9, 13. **Two of the five CI
seeds no longer build a park at all.**

| seed | before | after |
|---|---|---|
| canonical | #5, 55 ms, 371 m | #86, 4474 ms, 245 m |
| 2 | #44, 3601 ms, 138 m | #44, 1486 ms, 262 m |
| 5 | #4, 456 ms, 294 m | **UNSOLVABLE** |
| 11 | #22, 1460 ms, 285 m | **UNSOLVABLE** |
| 18 | #29, 1698 ms, 313 m | #49, 2265 ms, 320 m |

Canonical survives but goes from restart #5 to **#86 of 96** — one pose from
exhausting the field.

### Why, and it is structural

`GATE_CORRIDOR_KEEPOUT_RADIUS` is 4.9 m over `GATE_CORRIDOR_KEEPOUT_REACH`
30 m — a ~10 m wide, 30 m long bar driven into the park **from the rim, at the
gate**. The loop is a closed circuit that wants to use the rim; the bar cuts
the rim at one point and forces every candidate loop to detour inward around a
30 m spike. That is not a tunable radius, it is the shape of the obstacle.

Narrowing it only narrows the spike; the rim is still severed.

### The better idea, NOT built — for the Overseer to rule on

**Make the entrance crossing the chosen one.** Rather than keeping the railway
*off* the walk in, put the chosen crossing pose *on* it: the gate corridor is
the park's most important path and the one leg not routed through a planned
site, so choosing the crossing there makes the entrance crossing bridgeable and
planned **by construction** — which is exactly Jim's design applied to the path
that matters most ("choose where a path crosses the railway first").

The invariant `theWalkInFromTheGateCrossesWhereItWasPlannedTo` would then pass
because the crossing *is* the planned site, rather than because the railway was
pushed away. And it costs the search nothing: it constrains which pose is
picked, not where the loop may run.

Prior art agrees this direction is the sound one: `HANDOFF-bridge-at-the-front-door.md`
already made the entrance cross on a bridge by *routing the path*, not by moving
the railway.

## THE ENTRANCE-POSE VERSION — measurement 1 fixed, measurement 4 regressed

Keep-out **reverted** (commit "Revert ..."). The gate corridor's own bridgeable
crossings now go to the **head** of the ranked field instead
(`gateCorridorPoses`), so the search tries the park's front door first and
falls back to the general field.

### Measurement 1 + 3 — solving restored, and much cheaper

| seed | keep-out | entrance-pose |
|---|---|---|
| seeds solving | **9/15** | **14/15** |
| canonical | #86, 4474 ms | **#3**, 274 ms |
| 2 | #44 | #17 |
| 5 | UNSOLVABLE | **#1**, 96 ms |
| 11 | UNSOLVABLE | **#0**, 17 ms |
| 18 | #49 | **#9**, 161 ms |

Back to the 14/15 baseline and far cheaper than *either* previous version —
seed 11 solves on its first pose. Seed 3 now solves for the first time
(it failed on `main` too); seed 9 no longer does.

### Measurement 4 — 100% → **86%**. Regressed.

`12/14 loops admit at least one bridge`. **Seeds 2 and 15 prove zero.**

### Why — measured, not reasoned

On both failing seeds the winning start pose is **not** an entrance pose:
seed 2's `d=0` is at (-34.0, -34.0), seed 15's at (-18.0, 42.0). Neither is on
the corridor, so the entrance poses did not close a loop and the search fell
through to the general field — which is fine and expected.

The planner's own account at that chosen crossing (`explainBridgeRefusal`,
added here, reusing the real `probeReach`):

```
seed 2,  railD=0.0 at (-34.0, -34.0): DECK BLOCKED at all ten width/angle pairs
seed 15, railD=0.0 at (-18.0, 42.0):  DECK BLOCKED at all ten
```

**DECK BLOCKED**, not "ramp short" — the deck itself, which the pose generator
had proven clear before the rail existed. The rail-corridor test cannot cause
this (it only applies past the deck) and `stationBlocked` is false on both. By
elimination the cause is **`nearStationStructure`** — the *spatial* 8 m station
clearance, as distinct from the along-the-loop `stationBlocked` already fixed.

**This is exactly the relaxation named in `bridgeFit.ts`'s header** — "dropped:
the station-structure test… this one genuinely is a relaxation, and it is the
one to watch". It has now bitten twice, in two different forms:

1. **Along the loop** (`stationBlocked`) — fixed by `CROSSING_STATION_CLEARANCE`
   in `plan.ts`. That fix stands and is why seed 2's *previous* loop worked.
2. **In space** (`nearStationStructure`) — **still open**. A station 104 m away
   along a winding loop can stand a few metres from the crossing in space, and
   its canopy posts block the deck.

### The fix, not built

`plan.ts`'s station placer already keeps clear of the chosen crossing *along
the loop*. It must also keep the station's **structures spatially** clear of it
— the same `STATION_STRUCTURE_CLEARANCE` the planner uses, applied in the other
direction. Same shape as the fix that worked: one constant, both directions.

And per the Overseer's ruling, both directions should apply to **every planned
crossing site**, not only the loop's own.

## SPATIAL STATION CLEARANCE BUILT — still 86%, and now the causes are DIFFERENT

`CROSSING_STATION_STRUCTURE_CLEARANCE` (8 m) moved to `clearance.ts` and read
from both directions: the planner refuses to *plan* a crossing that close to
station structures; `plan.ts` refuses to *place* a station that close to the
chosen crossing's whole corridor (deck **and both ramps**, since
`nearStationStructure` is asked about every probe point).

Measurement 4 is still `12/14 (86%)`. **But seeds 2 and 15 now fail for two
different reasons, and only one of them is the station.**

### Seed 2 — the station fix WORKED; the loop's own shape is the problem

Deck samples at the chosen crossing: `boundary 0, plots 0, station 0, ok 15` —
completely clear, where before it was blocked. The planner now says:

```
railD=0.0 at (-34.0, -34.0):
  halfW=5.0 angle=0deg: reach 1.5/10.8 vs floor 12.1 -- SHORT
  halfW=4.0 angle=0deg: reach 1.0/12.7 vs floor 12.1 -- SHORT
```

**Not the deck — the ramp.** 1.5 m of run on the plus side against a 12.1 m
floor. The cause is the **rail-corridor test**, the *other* test `bridgeFit.ts`
drops: past the deck a ramp may not run inside the rail's own corridor, and
here the loop **curves back on itself** near its own chosen crossing and eats
the ramp room.

**This is the real limit of "choose the crossing first".** The pose generator
cannot know the loop's shape, because the loop does not exist yet. No amount of
pre-probing fixes it: the crossing was genuinely bridgeable when chosen and was
made unusable by the railway that grew from it.

### Seed 15 — still the station, and the placer could not satisfy it

```
railD=0.0 at (-18.0, 42.0): DECK BLOCKED at all ten
```
Deck samples: `station 4` of 15 still blocked. The placer's ±60 m window
evidently had no candidate that cleared the crossing, so it took the least-bad
one — a 5000 penalty does not help when every candidate carries it.

### THE FIX, and it is machinery that already exists

**`RouteBrief.satisfies`** — `rail/generate.ts`'s own documented backstop, *"the
one that can actually say no"*, with `satisfyRejects` already in the solve
report. Give the train brief a `satisfies` that re-asks the real planner
whether the solved loop still admits a bridge at its own start pose; a loop
that curved back and ate its own ramp room is rejected and the search moves to
the next pose.

That closes **both** seeds by construction rather than by tuning either
clearance further, and it is what the hook is for. It is also the only
mechanism that can see the finished loop, which is precisely what both failures
need.

Not built — reported first, per the standing instruction not to try a third
variation before reporting.

---

# NEXT ACTION, ACTIONABLE WITHOUT ME

## Use `RouteBrief.satisfies` — the only hook that sees the finished loop

**Where.** `src/world/rail/generate.ts:268` — `readonly satisfies?: (route:
SolvedRailRoute) => boolean` on `RouteBriefBase`. Supplied from
`briefForLength()` in `src/world/train/route.ts` (the object that already sets
`seed`, `startPoses`, `budgets`).

**Why it is the only mechanism that can work here.** Both remaining failures
are properties of the *solved* loop, not of the pose:

- the loop's shape near its own crossing (seed 2), and
- whether station placement could clear the crossing (seed 15).

Neither is knowable when the pose is chosen, because neither the loop nor the
stations exist yet. `crossingPoses.ts` cannot be made smarter about them at any
price. `satisfies` runs *after* a candidate route closes, which is exactly the
moment both questions become answerable — and the search then simply moves to
the next of ~1200 poses.

**What the predicate should ask.** Whether the finished loop still admits a
bridge at its own start pose — i.e. the same question
`crossingPlanSolve.bridgeCandidateAt(0)` answers. Beware the import cycle:
`crossingPlanSolve` imports `TRAIN_PLAN`, so `route.ts` cannot import it at
module scope. The probe geometry is already cycle-free in `bridgeFit.ts`; what
is *not* there is the rail-corridor and station-structure tests, which need the
solved route — and inside `satisfies` you HAVE the solved route as the
argument. So build those two tests against `route` locally rather than reaching
for `crossingPlanSolve`.

**The cost is already measurable.** `SolveReport.satisfyRejects` counts whole
routes thrown away by the predicate, and `satisfied` records whether the
returned route passed. `scripts/measure-train-solve-budget.mts` prints the
report; add those two fields to it. `generate.ts:356` warns that a *large*
`satisfyRejects` means the search is repeatedly solving routes it must discard
and the influence wants strengthening rather than the backstop working harder —
if that happens, `RouteInfluence` (`generate.ts:105`) is the paired lever.

**Then re-run, in this order:** measurement 4 (must be 100%), then 1/3
(solve rate and restarts — `satisfies` can only reduce the former), then 2 and
5, then `test:procgen`'s eight.

## THE TWO ROOT CAUSES ARE DIFFERENT PROBLEMS THAT SHARE ONE FIX

1. **Seed 2 — the loop eats its own ramp room.** Deck clear, ramp reach 1.5 m
   against a 12.1 m floor, because the loop curves back near its own crossing
   and the rail-corridor test then refuses the ramp. Nothing about stations.
2. **Seed 15 — station placement could not clear the crossing.** 4 of 15 deck
   samples still station-blocked; the placer's ±60 m window had no candidate
   that cleared it, and a 5000 penalty does not discriminate when every
   candidate carries it.

Do not fix them as one thing; verify each separately after `satisfies` lands.

---

# A CORRECTION ABOUT MY OWN DIAGNOSES — READ THIS FIRST

I told the Overseer the rail-corridor test **could not** be the cause of seed
2's failure. That was **true while the deck was blocked** (the corridor test
only applies past the deck) and **stopped being true the moment the station fix
cleared the deck**. The elimination was sound when made and stale a commit
later — and the stale version is what I would have kept reasoning from.

**A diagnosis in this area has a shelf life.** Four separate explanations have
now expired on this ticket:

- seed 5's phantom node: control-polyline-vs-swept-curve (wrong), then
  `spur()`'s `paved: !already` (wrong), then — from instrumentation, in one
  run — `commitStreetPlan` marking a search path rather than a drawn ribbon
  (right);
- seed 2's zero sites: `nearStationStructure` by elimination (right at the
  time, superseded by the rail corridor once the deck cleared).

**The ones that survived came from instrumentation; the ones that expired came
from reasoning.** When something here fails, log what actually happened before
theorising — and re-measure a cause after any fix that touches the same probe,
because clearing one gate reveals the next one behind it.

---

# SECOND ENGINEER — `satisfies` BUILT. 85% -> 92%, NOT 100%.

Picked up at the handover point above. **Every number below is measured on this
branch, not predicted.** Baseline re-established first, because the previous
engineer's "12/14" counted a seed list in which seed 8 solved and it no longer
does — on pristine `cc9d5e73` the honest baseline is **11/13 (85%)**, seeds 8
and 9 unsolvable, seeds 2 and 15 bridgeless. Confirmed by stashing.

## MEASUREMENT 4 — 11/13 (85%) -> **12/13 (92%)**. Seed 15 fixed, seed 2 not.

```
canonical 3   seed 3  2   seed 8  UNSOLVABLE   seed 13 2
seed 2    0   seed 4  2   seed 9  UNSOLVABLE   seed 14 2
seed 5    4   seed 6  1   seed 12 3            seed 15 1  (was 0)
seed 11   3   seed 7  3
seed 18   1
```

**Seed 15: 0 -> 1 bridge site. Seed 2: still 0.** Reported before trying
anything further, per the standing instruction.

## What was built

`RouteBrief.satisfies`, from `briefForLength()` — `loopKeepsItsCrossing` in
`route.ts`. Two questions of the *solved* loop, neither written out there:

1. `bridgeFit.ts`'s `fitBridgeAcross` with `railCorridorBlocked`, against a 720-
   sample polyline of the candidate route (the same sampling and the same
   nearest-sample answer `TrainRoute.distanceNear` gives, memoised on a 1 m
   grid). **Not** the station-structure test: there are no stations yet.
2. `crossingKeepOut.ts`'s `crossingSurvivesStationAt`, over each station seed's
   own `STATION_SEARCH_WINDOW` — "is there anywhere in this window the placer
   could put the station that clears the crossing?", which is the question a
   5000 penalty cannot answer when every candidate carries it.

**Three new single-owner modules, because `satisfies` needed rules the planner
already held.** `bridgeFit.fitBridgeAcross` + `railCorridorBlocked`;
`crossingKeepOut.ts` (the station-vs-crossing rule, both senses);
`stationSeeds.ts` (the bearings — `plan.ts` imports `route.ts`, so they could
not be read back the other way). Each replaced an inline copy at its original
caller; none is a second definition.

## THE TWO CAUSES WERE BOTH REAL AND BOTH DIFFERENT FROM THE FIRST GUESS

`satisfies` alone changed **nothing** — still 0/2 on seeds 2 and 15. Both
reasons came from instrumentation (`scripts/probe427.mts`, which prints the
solve report, each station's conflict, and which gate blocks each deck sample):

### Seed 15 — my own keep-out disagreed with the planner by a half-width

`crossingKeepOut` reported **both stations clear** while the planner reported
**4 of 15 deck samples station-blocked**. The keep-out measured the station
window against the crossing's centre *axis*; `nearStationStructure` is asked
about every probe point, and `bridgeFit`'s `ACROSS_SAMPLES` spread those across
the full corridor **width**. A line where the planner has a rectangle.

`CrossingCorridor` now carries `halfWidth` (`SITE_HALF_WIDTH`, the widest the
planner ever probes) and the test is point-to-rectangle. Deck samples at the
chosen crossing: **4 blocked -> 0 blocked**, and seed 15 gets its bridge.

Note this made the keep-out **stricter**, not the probe wider — the disagreement
was resolved toward the prover, which is the direction this ticket exists to
enforce.

### Seed 2 — an unsatisfied rung was silently ending the length ladder

`railRouteSearch` deliberately never throws once any pose closed a loop; if
every pose failed `satisfies` it returns the first route anyway with
`report.satisfied` false. Correct at its level. But `trainRouteSearch` treated
that as success and **returned**, so the shorter, slacker rungs — which exist
precisely for the pinched seeds — were never walked.

Measured: seed 2's longest rung closes **exactly one loop in 96 poses**
(`satisfyRejects=1, restarts=95`), and that one loop was it. The ladder now
keeps an unsatisfied route aside and walks on, returning it only after every
rung. `railRouteSearch`'s "a park always gets its railway" guarantee is
untouched.

**This did not fix seed 2.** All rungs walked, none satisfied. Seed 2's honest
position: of ~1200 ranked bridgeable poses across the whole ladder, **one** loop
closes, and that loop curves back beside its own crossing and leaves 1.5 m of
ramp run against a 12.1 m floor. There is nothing for the backstop to reject
*to*. This is a property of seed 2's park, not of the mechanism.

## MEASUREMENTS 1, 3, 5 — the backstop is nearly free

`scripts/measure-train-solve-budget.mts`, now printing `satisfyRejects` and
`satisfied` (added per the previous engineer's note).

```
seed        won   restarts  length   time    satisfyRejects  satisfied
canonical   #3    3         362 m    277ms   0               true
2           #17   95        259 m    5762ms  1               FALSE
5           #1    1         330 m    111ms   0               true
11          #0    0         334 m    16ms    0               true
18          #9    9         318 m    156ms   0               true
3           #73   73        154 m    4712ms  0               true
4           #3    3         366 m    220ms   0               true
6           #31   31        274 m    1169ms  0               true
7           #34   34        437 m    1787ms  0               true
8, 9        UNSOLVABLE (also unsolvable on the pristine branch point)
12          #73   73        169 m    3708ms  0               true
13          #0    0         408 m    36ms    0               true
14          #71   95        231 m    6004ms  1               FALSE
15          #31   31        301 m    1448ms  0               true
```

- **Solve rate 13/15 — identical to the pre-change baseline.** `satisfies`
  costs no seed its railway, as its contract promises.
- **`satisfyRejects` is 0 on 11 of the 13 solving seeds, and 1 on the other
  two.** So `generate.ts:356`'s warning does not apply and **`RouteInfluence`
  is not wanted**: the search is not repeatedly solving routes it must discard.
  On most seeds the first loop that closes already keeps its crossing.
- Canonical is unchanged from the pre-`satisfies` entrance-pose version
  (#3, ~275 ms) — the backstop is invisible where it does not fire.
- **Measurement 5, lengths: 154-437 m across the 13 solving seeds.** Still a
  varied population; no systematic shortening.
- Seed 14 is `satisfied=false` yet has **2 bridge sites** — a loop can fail the
  backstop (no bridge at rail distance 0 specifically) and still admit bridges
  elsewhere. Only seed 2 is bridgeless.

## STILL OPEN

- **Seed 2, and it may not be fixable at this level.** See above: one closing
  loop in the entire field. The remaining levers are the pose *ranking*
  (`crossingPoses.ts`) or the vocabulary, not the backstop.
- **`test:procgen`'s eight failures** — triaged in this file above, not yet
  worked. The canonical Rail Race finish rainbow at 0.37 m against a 1.24 m
  requirement is a real clash and must not be waved through.
- `scripts/probe427.mts` is a scratch instrument, committed deliberately so the
  next person can re-run it. Delete it before the PR if it is not wanted.

## `test:procgen` — the eight are now **three**. 479 passed, 3 failed.

```
seed 18: the walk in from the gate crosses the railway where the planner
         planned it to, on a bridge
seed 5:  every street sits on the shared 12 m lattice
seed 11: the Sky Cruiser flies clear of the whole park
```

**Five of the eight are gone, including the one that mattered most.** The
canonical Rail Race finish rainbow — 0.37 m from a path against a 1.24 m
requirement, the one the Overseer named as a real clash a child would walk
into — **passes**, as does seed 5's 1.20 m near-miss. Both went away with the
loops, not with a threshold: **no assertion, probe or threshold has been
touched anywhere in this work.**

Also gone: seed 11's lattice failure, seed 2's lattice failure, and seed 18's
"crossings are planned — station-clear, and mostly real bridges" (that one is
the direct result of the rectangle keep-out).

### The three that remain

**1. seed 18 — the gate corridor meets the track at an unplanned point.** This
feature's own territory, and the same defect the previous engineer triaged as
items 1-2; it has moved seeds (was 5 and 11, now 18) and is now **one instance
rather than two**.

```
the walk in from the gate crosses the railway at (0.0, 57.3), railDistance
300.1, 3.0 m in from the arch, and the crossing planner planned no crossing
there at all — bridge sites at 4.0, level sites at 46.0 ... 274.0
```

Seed 18's winning pose is **#9, not an entrance pose**, so `gateCorridorPoses`
did not close a loop and the search fell through to the general field — which
may then run anywhere, including across the front door. Expected and
documented behaviour of the shipped design, not a new fault.

**Do not reach for the keep-out again.** It is written up above with numbers:
`GATE_CORRIDOR_KEEPOUT_*` severs the rim and took solving from 14/15 to 9/15.
The remaining honest options are (a) rank the entrance poses harder so they win
on more seeds, or (b) route the path rather than the railway, as
`HANDOFF-bridge-at-the-front-door.md` did. Either changes every seed's loop
again and needs all five measurements re-run — this is its own piece of work,
which is what the previous engineer concluded too.

**2. seed 5 — `gate-approach` 1.94 m off the 12 m lattice.** Paths reacting to
a moved railway. Downstream, not investigated.

**3. seed 11 — flower heads under the Sky Cruiser's car** at 4.0 m along the
loop, world (-57.51, 0.70, -20.16). The cruiser solves *before* the train so it
has not moved; the **scatter** has, because it plants around the railway.
Downstream, not investigated.

## `pnpm run check` — one failure, and it is **inherited, not new**

`check:park` on seed 3: `poi.stranded: 20 (no allowance — this is new)`, twenty
waypoints in an unreachable pocket of the 'garden' graph, in two clusters around
(-44, 24) and (46, -41). It is the only failing step in the whole 47-step chain;
everything else, `tsc` included, is green.

**Measured at the branch point (`cc9d5e73`, detached worktree): identical —
same step, same count of 20.** So it is not caused by the backstop, the
rectangle keep-out or the ladder change; it arrived with the crossing-pose
generator earlier on this branch and was never triaged. It belongs to the same
family as the three remaining `test:procgen` failures — the park reacting to a
railway that now starts inside it — and it is the largest of them, because
twenty dropped waypoints is a district a child cannot reach.

**It must be fixed before this merges** (CLAUDE.md's zero-tolerance rule), and
it is now the biggest single open item on #427, ahead of seed 2.

---

# `check:park` `poi.stranded: 20` — TRIAGED, NOT FIXED. Measurements below.

## It IS a regression of this branch. `origin/main` is green.

Ran `scripts/check-park.mts` on a detached `origin/main` worktree with its own
real install: **exit 0, no `poi.stranded` at all.** At this branch's handover
point `cc9d5e73`: **20**. So it came in with the crossing-pose generator earlier
on this branch and was never triaged — it is not inherited from `main`, and my
earlier note in this file calling it "inherited" was right only about the branch
point and is corrected here.

**Correction to my own first reading:** the `[3]` prefix in the check output is
the **invariant number**, not a seed. `check:park` runs the **canonical** seed.
I reported "seed 3" to the Overseer; that was wrong and cost a probe run.

## Where the pockets are

`scripts/probe427-poi.mts` (committed). Canonical seed, loop 361.8 m, bridge
sites at railD 0 / 234 / 336, level sites at 70 / 116 / 166 / 202 / 306.

**All 20 stranded nodes lie OUTSIDE the loop, in exactly two strips:**

| pocket | rail distances | nodes | nearest crossings |
|---|---|---|---|
| north-west | 309-325 | 13 | level 306, bridge 336 |
| south-east | 191-197 | 6 | level 166, level 202 |

For contrast, **78 reachable nodes also lie outside the loop** — the outside is
not cut off in general, only these two strips.

## What blocks them — named by collider geometry, not guessed

For every stranded node, the nearest main-component node and what stops the line:

- **North-west: the railway fence.** Every blocked line fails at railGap
  **2.5 m** against walls of length 2.6 m, halfThickness 0.18, `top=Infinity` —
  `train/fence.ts`'s panels. The closest case is brutal: (-44.0, 14.9) is
  **2.7 m** from the reachable (-42.9, 12.5), with a fence panel between them.
- **South-east: a bridge ramp's parapet.** Walls of length 2.0,
  halfThickness 0.15, tops **2.7 / 3.7 / 5.5 m** — climbing, i.e. a ramp flank —
  at railGap 3.6-9.1 m.

Every line that is *not* blocked is longer than `poiGraph`'s `MAX_EDGE` of 13 m
(measured 13.4-25.9 m). So each pocket is sealed by geometry on its short side
and by the edge limit on its long side.

## WHAT I COULD NOT ESTABLISH — and the probe that lied

I flood-filled the walkable plane on a 0.5 m grid from the main component and
got "0/20 reachable — genuinely sealed off". **That result is invalid and I
have thrown it away.** The control I ran next: the same fill reaches only
**2 of the 78 reachable nodes that are outside the loop**. A ground-level 2-D
fill cannot climb a bridge deck, which is precisely how children get outside the
loop, so the fill was only ever measuring "inside the loop" and could not
distinguish a sealed strip from a normal one.

**So it is still open whether these two strips are ground a child genuinely
cannot reach, or ground she can reach over a bridge that merely has too few
waypoints to chain along at 13 m.** That distinction decides the fix and must
be settled first:

- *genuinely sealed* -> the park needs a way in (a crossing serving the strip);
  a real layout defect.
- *reachable but under-seeded* -> the waypoints are right and the graph cannot
  chain along a thin strip; the fix is in seeding or in how a strip is served.

The right instrument is `PoiGraph`'s own model, which already takes
`bridgeHeightAt` and therefore *can* climb a deck — not a hand-rolled fill.
Ask it whether a chain exists from the main component out through the level
crossing at railD 306 (or the bridge at 336) and along the strip, and where the
chain breaks.

**Do not fix this by relaxing `MAX_EDGE` or by adding to `RATCHET`.** 13 m is
the edge limit the whole graph is built on, and the count must reach 0 by the
ground becoming reachable.

## Why it is plausibly the same family as the other three

The loop now starts inside the park rather than on the rim, so it can leave wide
strips of ground between itself and the boundary. `main`'s rim-hugging loops
left almost none. That is a coherent story and it fits all four remaining
failures — but it is **a story, not a measurement**, and on this ticket four
stories have already expired. Measure it before acting on it.

## THE OPEN QUESTION IS ANSWERED: the ground is REACHABLE. 20/20.

`scripts/probe427-fill.mts`, using `poiGraph.ts`'s **own** walkability test
(`isClear` reproduced exactly: the probe stands at `bridgeHeightAt(x, z)`, and
narrows to `PAVED_CLEARANCE` on paving) rather than a hand-rolled ground-level
one. Standing the probe on the deck is the whole difference — it is what lets a
fill climb a bridge, which is how a child gets outside the loop at all.

```
CONTROL: reaches 78/78 reachable nodes OUTSIDE the loop   (the old fill: 2/78)
CONTROL: misses 0 reachable garden nodes INSIDE the loop
CONTROL: instrument VALID

20/20 stranded waypoints stand on ground a child can reach.
```

**So this is not a sealed-off district. It is the other case: the ground is
walkable and the waypoint graph cannot chain along it.** Every short line into
the strips crosses the railway fence or a bridge ramp parapet, and every
unblocked line is 13.4-25.9 m — beyond `MAX_EDGE`'s 13 m. The waypoints out
there are too sparse to hop between.

**The fix is therefore more waypoints, not a bigger hop.** `MAX_EDGE` is a claim
about how far apart waypoints may sit before the graph is lying about
connectivity; raising it would make the check agree with the park by making the
check weaker, which is the exact trade this ticket exists to remove. Not to be
touched.

### Two controls worth keeping, because both nearly cost a wrong answer

1. **The old ground-level fill said "0/20, genuinely sealed off"** — a clean,
   confident, investigation-ending answer. Its control killed it: it reached
   2 of the 78 reachable nodes outside the loop, so it was only ever measuring
   "inside the loop". Kept in this file above, verbatim, on the Overseer's
   instruction.
2. **The new fill's first control run said INVALID**, on 2 missed inside-nodes.
   Examined rather than waved through: both nodes' own points are clear, both
   their rounded 0.5 m cells are not, and 10 and 16 of the 25 cells within a
   metre had been filled. Grid quantisation beside a clear node, not a
   disconnection. The `hit` test now accepts any filled cell within 1 m and
   says in its own comment why that is a measurement and not a fudge —
   an exact-cell test would have condemned a sound instrument.

### What is still not established

**Why** the strips have too few waypoints. The likely mechanism is that
`poiGraph`'s seeds are sampled densely along paved lanes and sparsely
elsewhere, so a strip no path serves gets only scatter seeds — and these two
strips are ground the path network does not route into. **That is a story, not
a measurement.** Check whether any stranded node carries a `lane` identity, and
whether a ribbon runs into either strip, before acting on it.

## CORRECTION — "the fix is more waypoints" WAS WRONG. It is severed spurs.

I wrote, one measurement ago, that the ground is reachable and the waypoints are
"too sparse to chain". **That is the sixth expired explanation on this ticket,
and measurement killed it too.** `buildSeeds()` has **no general scatter**:
every seed is a plaza kerb point, an attraction entrance, a stall stand, a
station, or a sample every `ROUTE_SPACING` along a **drawn path route**. So I
asked which lane each stranded node belongs to:

```
7 on spur-dodgems
7 on spur-stall.waterFight
6 on spur-stall.dodgems
all 20, every one, carrying a lane identity
```

**All twenty are paving.** Not sparse scatter in an unserved strip — three
*drawn spurs*, sampled at their normal 4 m pitch, running out into those strips
and severed. The park drew a path to the dodgems and to the water fight stall,
and the railway fence cuts it: every blocked edge fails at railGap 2.5 m against
`fence.ts` panels, and `laneIsClear` cannot rescue it because the ribbon it
walks crosses the same fence.

### So the real defect

**Three spurs cross the railway where no crossing was planned**, and `fence.ts`
seals them. That is **the same defect as the seed-18 `test:procgen` failure**
("the walk in from the gate crosses the railway ... and the crossing planner
planned no crossing there at all"), and it is exactly #414's subject: *"`paths.ts`
knows only a crossing point, never a bridge's ground"*. Not a waypoint problem
at any level.

What it costs a child: the **dodgems** and the **water fight stall** each have a
spur drawn to them that is cut in half by a fence. Three of the twenty nodes are
`interesting` — they are destinations, not filler.

### The fix, and why I did not make it

It belongs in the path router: a leg that crosses the railway must be routed
through a planned `CROSSING_SITES` entry, which is precisely what
`crossingPlanSolve.ts` exists to guarantee and precisely what #414 is open
about. It is not a waypoint change, not a `MAX_EDGE` change, and not something
to fix inside `poiGraph.ts` — the graph is reporting the park accurately.

**This is the same root cause as the remaining seed-18 procgen failure**, so the
two should be fixed together, and that fix changes the path network on every
seed and needs all five measurements re-run behind it. It is a real piece of
work and it is #414's, not a loose end of this one.

**Recommend to the Overseer: this is the design question, and Jim should see
it.** #427 has done what it set out to do — 92% of loops admit a bridge, up from
79% at the ticket's opening — but growing the loop from an interior crossing
lets the loop run between an attraction and the path that serves it, and the
path router has no answer for that yet. That is a genuine consequence of the
trade, not a bug in the mechanism, and it is the thing that should decide
whether #414 lands on top of this branch or beside it.
