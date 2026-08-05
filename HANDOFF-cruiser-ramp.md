# HANDOFF — E6-ramp, issue #198 (Sky Cruiser flies through foliage)

**Branch `feat/cruiser-ramp-clearance`, worktree `.claude/worktrees/cruiser-ramp`,
port 5326 if a dev server is ever needed.** Rebased onto `origin/main` (b0cfcd5)
on 5 Aug — see "Rebase" below, it matters.

## State

**DONE and green.** `npm run build` exit 0, `npm run test:procgen` 122 passed.
Rebased onto `origin/main` 6e7ae78. No PR raised (waiting on the Overseer).

Five commits, `09500c3..4ebc963`. Strikes go **2/3/4/2/1 -> 0/0/0/0/0** across
the five CI seeds.

## The finding that changes the fix

Issue #198 says: extend `stationWindowIsClear` along the real ramp and let the
solver reject those start poses. **That cannot work, for two independent
reasons, and both are facts about the code rather than opinions.**

1. **The route is solved before any tree exists.** `COASTER_PLANS` is a
   module-load constant (`coaster/plan.ts:104` calls `new CoasterRoute(...)` at
   top level), and `World.ts:17` imports it — so the loop is fully solved before
   `new World()` runs. The trees and bushes are scattered later, inside the
   constructor at `World.ts:77`. At the moment `stationWindowIsClear` runs there
   is no foliage to avoid.
2. **Even with infinite reach it would still miss.** `groundClearOfPlots`
   iterates `PARK_LAYOUT.entries`, which holds **12 plots and no foliage at
   all** (`parkManifest.ts:103`). The bush struck on the canonical seed is 3.5 m
   from the platform — already *inside* the old ±6 m window. Reach was never the
   whole bug.

So the dependency has to point the other way: **`Scenery` gives way to the Sky
Cruiser**, exactly as it already gives way to the train. That precedent is
already written down in this very file, at `Scenery.ts:685-690`:

> The dependency used to point the other way — the route was solved against the
> finished collision world and bent around trees — but the route is a pure
> pre-scene plan now (`train/plan.ts`), so the trees are the ones that give way.

The Sky Cruiser is a pure pre-scene plan in exactly the same sense.

## What is actually struck, measured on all five CI seeds

| seed | strikes | what |
| --- | --- | --- |
| 20260728 | 2 | tree-canopies, bushes |
| 2 | 3 | bushes, tree-canopies, tree-trunks |
| 5 | 4 | **wooden wall run**, bushes, tree-cones, tree-canopies |
| 11 | 2 | bushes, tree-cones |
| 18 | 1 | bushes |

**Every seed strikes something**, and it is not only foliage: seed 5 flies
through a `scenery / wooden-walls` run (it reports as `'Mesh'` because the wall
meshes are unnamed — worth fixing in the complaint text). All of it is
`Scenery`, all of it in the station region, which is why one fix covers it.

## Two numbers that kill the "cruise floor clears the trees" premise

Measured, canonical seed:

- **`tree-canopies` reach 6.68 m** above their own terrain. The cruise floor is
  6.2 m and the car's underside is 6.04 m. A tall tree under the cruise line is
  a strike waiting for a seed to place one — it just has not happened yet on
  these five.
- **83 m of the 185 m loop has the car's underside below 6 m** — the station
  carve *and* the castle window carve with its ramps. The low stretch is not a
  station detail.

This is why the fix must be **height-aware** rather than a flat corridor: a flat
keep-out sized for the tallest possible tree would apply along most of the loop
and strip a wide swathe of lawn (the scatter is already budget-limited, 26-30
trees against an anti-vacuity floor of 24). Short plants must still be allowed
to live under the high parts of the loop.

## Design being implemented

A `clearOfCruiser(x, z, reach, topY)` in `Scenery.ts`, mirroring the existing
`clearOfWalls(x, z, reach)` — a separate explicit call at each scatter site, not
folded into `isPlantable`:

- refuses a spot when any sample of the loop within `reach + CART_ENVELOPE.halfWidth`
  horizontally has the car's **underside below the plant's own top**;
- called in the tree loop after `kind`/`reach` are known (so **no RNG draw is
  reordered** — `pickTreeKind` already runs before `clearOfWalls`), in the bush
  loop, and inside `runIsClear` for wall runs.

Thresholds come from the game (`CART_ENVELOPE` in `coaster/cart.ts`), never from
the generator's `CORRIDOR_RADIUS`.

**Expect the tree count to drop and the attempt budget to need raising** — there
is direct precedent at `Scenery.ts:330-342`, where adding the wall refusal took
the canonical seed from 30 trees to 19 until the budget went up.

## Rebase — read this before merging anything in this lineage

PR #196 merged to `main` **squashed**, so `git merge-base --is-ancestor` gives no
warning and a stale `test/procgen/parkFacts.ts` would silently revert part of
#114. This branch has been rebased with
`git rebase --onto origin/main e3de651`, which drops the two
`chore/invariant-return-complaints` commits whose content is already in main.

Proof it is clean: `git diff origin/main...HEAD -- test/procgen/parkFacts.ts` is
purely additive (the castle `castlePass` block), and `everyDestinationIsANode`
still exists in `invariants.ts`.

`main` already has `type Invariant = (facts: ParkFacts) => readonly string[]`;
write new invariants in the return form.

## What landed

1. `clearOfCruiser` in `Scenery.ts` — height-aware keep-out, called by the tree
   scatter (after the kind is picked, so **no RNG draw moves**), the bush
   scatter, and `runIsClear` for wall runs.
2. Strikes are named by nearest named ancestor, so seed 5's unnamed wall reads
   `wooden-walls / Mesh` rather than `Mesh`.
3. `measure:cruiser-clearance` -> `check:cruiser-clearance`, wired into `build`.
4. `TOO_TALL_TO_FLY_OVER` retired from `invariants.ts`, replaced by the swept
   measurement. The false "cruise floor clears the trees" claim is corrected in
   all three places it was stated.
5. New invariant `the Sky Cruiser flies clear of the whole park`, **proven red**
   on all five seeds against the pre-fix scatter, with real coordinates in the
   messages (no NaN/Infinity). Test count 117 -> 122, the +5 confirming no seed
   silently skips it.

### The one thing a reviewer should push on

**The tree budget is pinned between two failures with one tree of headroom.**
Below 180 000 the anti-vacuity tree floor goes red on seed 5; at 210 000
`check:park` goes red because the extra colliders wall in a waypoint at
(-13.8, 15.6). Isolated properly rather than guessed — trees and walls use
separate RNG streams, so disabling the wall keep-out left the stranding while
reverting the budget alone cleared it.

Two of the three trees seed 5 lost are **not** this branch's: the castle pass
moves the cruiser's exit, `paths.ts` routes to that exit, and #196 lengthened
every stall spur. Recovering those at source gives the headroom back.

### Retired from the invariant, kept in the solver — deliberately

`tallObstacles()` in `route.ts` survives, because it is an **input** to the
plan-view search, which must be told where not to go before there is a route to
measure. Replacing it with a measurement taken afterwards would let the loop
grow through the big wheel and then complain about it. Its comment now says so.

## PR #203 — fixed there, on the Overseer's ruling

The tree-budget bump was **lifted into #203** (commit 608970c) where the
regression originates, and this branch was restacked on top. #203 is now green
standalone: build exit 0, `test:procgen` 117 passed. This branch's `Scenery.ts`
diff against #203 is now **189 insertions and no deletions** — pure addition,
with the budget owned entirely by #203.

`main` 26 trees on seed 5, #203 at 180 000 gives 26, this branch 25.

## What the tree floor actually is — the answer to "which was it written to be"

**Neither.** It is a *thinning-regression detector*, and its calibration is now
stale. Traced through `git log -L` on the assertion:

- `7f2e81e` introduced it (#107).
- `562ee8e` set it to **20**, calling it "an anti-vacuity guard, not a
  placement threshold", reasoning "every seed plants 26-30, so 20 is a floor
  that a genuinely thinned park trips and ordinary seed-to-seed variation does
  not".
- `901895d` — **a review — found that claim false and raised it to 24.** The
  reviewer reverted the attempt-budget fix while keeping the wall-clearance
  fix and got 19/23/23/27/23. Only the 19 tripped `> 20`: "four of five seeds
  thinned by 21-28% and sailed straight through, so the guard did not catch the
  one regression it exists to catch".

So 24 was chosen to **catch a specific historical thinning**, measured both
ways round (healthy 26/27/26/30/28 vs thinned 19/23/23/27/23) — distributions
that *overlap*, so the commit explicitly records that no global floor can
separate them and that the number is not watertight.

**The decisive detail: that commit rejected 25 for exactly the reason we are
now living with.** "24 is the best a global floor does: catches 4 of the 5
seeds, keeps two trees of headroom under the lowest healthy seed. 25 catches no
more and leaves one." One tree of headroom was already ruled insufficient.

The calibration assumed **lowest-healthy = 26**. It is now 25 on this branch,
so the floor's own stated premise — two trees under the lowest healthy seed —
no longer holds. The number did not drift; the park moved underneath it.

**Recommendation, for the Overseer to rule on.** Do *not* lower the floor to
23 to restore the premise — that is weakening an assertion to make a seed pass.
Restore the headroom at source instead: seed 5's losses are the castle exit
moving `paths.ts`'s routing plus #196's longer spurs, and 210 000 is unavailable
here only because the scatter at that density strands a waypoint. Fixing *that*
(a scatter that will not wall in a POI) unlocks 210 000, which gives seed 5
27-28 and restores three trees of slack without touching the assertion.

## Queued behind this (from the Overseer)

- **Castle crossing must always happen.** Jim's direction: weight the
  generator's decisions toward it via a *general, named influence* mechanism any
  ride can declare (not a castle special case), plus a validity backstop that
  re-solves a route that still misses. Must be opt-in and **absent-by-default
  byte-identical** — `generate.ts` is shared with the ginormous slide, which
  another engineer is mid-flight on. Record in `ARCHITECTURE-DECISIONS.md`.
- **#197** — typecheck `scripts/`. Try `@types/node` with `"types": []` first:
  module declarations resolve while globals stay out. #192 rejected
  `"types": ["node"]`, which is a different thing.

## BLOCKING (5 Aug, late): #203's route flies through the RiPika statue's head

Found by this branch's own sweep, immediately after restacking onto the #203
that is rebased on the main which took **#200 (the statue)**.

```
the Sky Cruiser's car passes through 'bakedFace'        at 123.0 m, world (6.94, 7.13, 7.42)
the Sky Cruiser's car passes through 'ripikaHead / Mesh' at 123.0 m, world (6.54, 8.84, 7.62)
```

Fails on **four of five seeds** (canonical, 5, 11, 18) — seed 2's loop happens
to miss.

**It is #203's route, not inherited.** Ran the identical sweep against plain
`origin/main` (copying in only `clearance.ts` and the dependency-free
`cart.ts`, which cannot move the route): main strikes bushes, tree-canopies and
`fairy-lights` — **and not the statue**. Main's loop is 216 m; #203's is 185 m
and threads the castle, and that loop goes through the statue.

Neither author could have seen it: #203 predates #200's merge, and #200 had no
cruiser sweep to run.

**Why it matters:** the Sky Cruiser is `camera: 'firstPerson'`, so this is not
a mesh brushing past out of sight — the screen fills with the inside of a giant
stone head. Same failure `cart.ts` describes for the castle lintel.

**Not to be confused with the 2.01 m near miss** that is deliberately allowed.
That is a *miss*. This is an intersection.

**Proposed fix:** the statue belongs in `tallObstacles()` in `coaster/route.ts`
— the one hard-coded list deliberately kept, precisely because it is the
*input* telling the plan-view search where not to go. It reaches **10.6 m**
against a 6.2 m cruise floor, so it is exactly "a thing the loop cannot fly
over and must go around", the same category as the ferris wheel. It is built by
`Fountain.ts` at `PLAZA` and nothing currently keeps the loop off the plaza at
all.

Cost: re-solves the loop, so the castle span and windows need re-verifying on
all five seeds.

**Also newly visible on main and not yet handled by `clearOfCruiser`:**
`fairy-lights` are struck on main's route. They are not part of the `Scenery`
scatter, so the #198 keep-out does not cover them. Not currently failing on
#203's route, but it will need an owner.

## RESOLVED — the statue, and two bugs it flushed out

Fixed in **#203** on the Overseer's ruling (the PR that creates the collision
fixes it), commit `c988368`. #203 green standalone: build exit 0, procgen
117/117. This branch restacked on it: build exit 0, procgen **122/122**.

1. **Statue.** Added to `tallObstacles()` — the input list, not a measurement.
   Radius is the *statue* (3.47 m measured: every mesh under the fountain root
   topping above the car's underside at cruise), **not** the fountain's 10.5 m
   plot: the ride is allowed to fly over the plaza, just not through the statue.
   Now a **2.83 m miss**, reported, failing nothing.
2. **Ride exit (older bug, exposed by the re-solve).** `planExit` searches with
   `clearOfPlots`, which knows twelve plots and nothing about the scatter, so
   seed 2's exit landed 1.2 m from a bush — ground `rideExitsAreUsable`
   correctly refused. #198's category error one level along. Fixed on the
   scatter side (`onRideExit` in `Scenery.ts`), because `planExit` runs before
   any foliage exists while the scatter can trivially see the exit.
3. **Fairy-light wires (this branch).** Keeping the *trees* clear was not
   enough — a wire between two clear trees still spans the gap, and seed 5's
   struck the car 3 m up on the station approach. Added as a rule in
   `spanIsClear`, vertically honest so it only refuses wires where the car
   really passes through their height.

**Verified on all five seeds:** no statue strike; castle windows still cut, two
openings each on canonical/2/5/11 at 3.21-3.42 m, sill 3.94, head 7.65.

**Seed 18 now routes around the castle** instead of through it — a legitimate
pass (`castleSpan` null, castle intact) but a reduction from 5/5 to 4/5, and a
direct argument for the queued work making the crossing a solve requirement.

**Tree lights:** `main` builds 0 tree-light bulbs on canonical *and* seed 5, so
the wire rule costs nothing against main. They are absent in this park
configuration generally (canopies below `MIN_POST_RADIUS`), which predates all
of this.

**Still filed elsewhere:** `fairy-lights` (the plaza ring, not tree wires) are
struck on main's own route. Not caused by either branch; Overseer is filing it.

## The pattern behind three of today's fixes: invert the dependency

Three separate bugs today had the same shape, and the same wrong first answer
("widen the check"). Worth naming once rather than rediscovering a fourth time.

In each, a **pre-scene planner** consulted a list that could not contain the
thing in its way, because the thing did not exist yet:

| planner | consulted | what was actually in the way |
| --- | --- | --- |
| `stationWindowIsClear` | `PARK_LAYOUT` (12 plots) | a tree canopy and a bush (#198) |
| `planExit` | `clearOfPlots` | a bush 1.2 m from a ride exit |
| `TreeLights.spanIsClear` | paths, railway | the Sky Cruiser itself |

**The fix is never to widen the planner's list**, because the planner runs
before the thing exists and no amount of reach reaches backwards in time. It is
to notice which way the dependency *can* point and put the rule there: the
route, the exit and the ride are all pure pre-scene plans, so the **scatter is
what gives way**. `Scenery.ts`'s own `onRailway` comment had already written
this down for the train; it just had not been generalised.

The tell is a check that "should obviously" have caught something and did not.
Ask what existed when it ran, not how wide it looked.

## Branch layout (5 Aug, after the Overseer's split ruling)

Two branches, stacked, because they differ in kind:

- **`feat/cruiser-ramp-clearance`** — issue #198, a **live bug on main**. The
  ride flies through foliage today.
- **`feat/cruiser-castle-always`** — the castle-crossing guarantee, a **new
  capability** in a generator two rides share (Decision 7). Based on the above.

Both are green on their own: #198 is build exit 0 / procgen 122, the guarantee
build exit 0 / procgen 127.

## Castle crossing guarantee — DONE (Decision 7)

Weighted influences in `rail/generate.ts`, general and opt-in. All five CI seeds
now cross (seed 18 previously did not). **The backstop fires twice in five
seeds**, so the weighting carries the feature. Absent-by-default proven
byte-identical on all five seeds — matching length, pieces, candidates,
backtracks and start-pose index — which is what the slide engineer needs.

`build` exit 0, `test:procgen` **127 passed** (+5, the new invariant on five
seeds). New invariant proven red: without the influence, seed 18 fails.
