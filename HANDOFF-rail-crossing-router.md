# HANDOFF — the path router and the railway (#427's `poi.stranded: 20`, #414)

Branch `feat/rail-crossing-router`, stacked on
`origin/feat/railway-grown-from-a-crossing` (#427). Worktree
`.claude/worktrees/rail-crossing-router`. Dev server port 5431 if needed.

## THE BRIEF WAS BASED ON A DIAGNOSIS THAT DOES NOT HOLD — measured

I was sent to build "a leg that crosses the railway must route through a
planned crossing", on the #427 engineer's closing finding that
`spur-dodgems`, `spur-stall.dodgems` and `spur-stall.waterFight` *"cross the
railway where no crossing was planned"* and are sealed by `fence.ts`.

**They do not. Every drawn ribbon already crosses at a planned site.**

`scripts/probe-unplanned-crossings.mts` (new) walks every drawn ribbon's
**swept curve** — not the control polyline — records each rail-side flip and
tests it against `CROSSING_SITES`/`LEVEL_CROSSING_SITES` at `crossings.ts`'s
own `SITE_SNAP_TOLERANCE`:

```
4 planned crossings, 0 UNPLANNED, over 22 drawn routes
```

That is the seventh explanation to expire on this ticket, and it expired the
same way the other six did — to an instrument, not to an argument.

Why the router is already right: `streetLattice()` links nodes only when
`side[a] === side[b]`, and registers each `CROSSING_SITES`/
`LEVEL_CROSSING_SITES` entry as an explicit lattice edge via its feet.
`routeLeg` routes a straddling pair through a site. Crossing the rail off-plan
is already impossible by construction. **Nothing in `paths.ts` needed
changing, and nothing in `paths.ts` was changed.**

## THE REAL CAUSE — named by collider geometry

`scripts/probe-blocked-ribbons.mts` (new) walks the same ribbons with
`poiGraph`'s own clearance test (`PAVED_CLEARANCE` on paving, probe standing
at `bridgeHeightAt`) and names what stops each one. **Ten blocked stretches,
and not one is a fence panel** (fence panels are 2.6 m, `halfThickness` 0.18,
`top=Infinity`):

```
spur-dodgems, spur-stall.dodgems   railD 302-308
spur-stall.waterFight              railD 200-204
  blocked by walls len=2.0 halfT=0.15 top=2.8 3.5 3.7 4.4 5.2 5.3
```

2 m panels with *climbing* tops is a bridge ramp parapet. And:

```
crossings at railD  202, 234, 306, 336 — a bridge on every one
proven bridge sites    0, 234, 336
```

**Bridges stand at 202 and 306 — two `LEVEL_CROSSING_SITES` entries, ground
`crossingPlanSolve.ts` measured and rejected.** `bridgeFootprint.ts`'s late
`planReal` pass searches every crossing for a deck regardless of what the
planner proved, and where it finds one on unproven ground it builds ramps
nothing reserved room for. Their parapets then stand across the path that
crosses there. That is what severs the three spurs and strands the twenty
waypoints.

This is #414's step 2 exactly, arrived at independently from the other end.

## THE FIX

`LevelCrossing.provenBridgeSite` travels with the crossing, set in
`crossings.ts` at the point it already snaps to a site (`site.bridge`). False
for the level tier and for an unsnapped crossing measured off the drawn
paths. `planReal`'s sweep searches for a deck only where it is true.

**One constant, one owner, read where the answer is known.** The builder
cannot re-derive it: by the time `planReal` runs, the two site lists have been
collapsed into one `crossings` array.

`LGP_ALLOW_UNPROVEN_BRIDGES=1` restores the old behaviour exactly.

## MEASUREMENTS

Canonical seed, same geometry, gate on vs the reversal flag:

| | gate on | reversal flag |
|---|---|---|
| `check:park` | **exit 0, 229/229 waypoints** | `poi.stranded: 20`, exit 1 |
| blocked drawn ribbons | **1 of 22** | 10 of 22 |

The remaining one is `spur-building`'s last metre against an 18 m park wall at
railGap 30.7 — not the railway, and it strands nothing.

### `check:park` across all five CI seeds

Gate on vs the reversal flag (which is this branch's behaviour before the fix,
same geometry, same run):

| seed | gate on | reversal flag |
|---|---|---|
| canonical | **exit 0**, 229/229 | `poi.stranded: 20` |
| 2 | **exit 0**, 230/230 | `poi.stranded: 26` |
| 5 | `poi.stranded: 15`, 245/260 | `poi.stranded: 25` |
| 11 | **exit 0**, 226/226 | `poi.stranded: 15` |
| 18 | `route.crossesRail: 4`, **poi.stranded gone**, 225/225 | `poi.stranded: 38` + `route.crossesRail: 6` |

**Three of five seeds now pass `check:park` outright; none was passing before.**
`pnpm run check` only gates the canonical seed, and that is exit 0.

### Measurements 1, 3, 5 — the railway is untouched, and measured to be

The gate lives in `planReal`, which runs after the loop is solved, so it
cannot move the railway. Verified rather than asserted —
`measure-train-solve-budget.mts` is byte-identical to the #427 handoff's own
final table:

```
canonical  won #3   restarts 3   362 m   satisfied=true
2          won #17  restarts 95  259 m   satisfied=false  satisfyRejects=1
5          won #1   restarts 1   330 m   satisfied=true
11         won #0   restarts 0   334 m   satisfied=true
18         won #9   restarts 9   318 m   satisfied=true
5/5 seeds solved a train loop.
```

Measurement 2 (bridgeable pose counts) and measurement 4 (loops admitting a
bridge) both ask `crossingPlanSolve`, upstream of the gate, so they are
unchanged for the same structural reason.

### The router really is right on every seed, not just canonical

`probe-unplanned-crossings.mts`:

```
canonical  4 planned, 0 UNPLANNED, 22 routes
2          6 planned, 0 UNPLANNED, 23 routes
5          5 planned, 0 UNPLANNED, 26 routes
11, 18     0 UNPLANNED
```

### #396 — level-crossing walkability, with the gate on

The gate turns unproven-site bridges into level crossings, so this becomes
load-bearing. `measure-level-crossing-walkability.mts` (ported from #414)
asks the real `NavGrid`, built with `PLAYER_RADIUS` and `JUMP_APEX_HEIGHT`
exactly as `check-park.mts` builds it, of every crossing WITHOUT a bridge:

| seed | bridgeless crossings | walkable *through* |
|---|---|---|
| canonical | 2 | **2** — 16 m walk for a 16 m gap, 0.0 m from centre |
| 2 | 3 | **3** |
| 5 | 1 | **1** |
| 11 | 3 | **3** |
| 18 | 4 | **2** |

**11 of 13, and both failures are on seed 18**, which is #427's own known bad
seed:

```
d=62.8  at (-36.3, 3.9)  reachable only the long way round (149 m for a 16 m gap)
d=299.9 at (-0.2, 57.4)  A SIDE IS NOT STANDABLE
```

`d=299.9` is the gate-corridor crossing that #427 already has red in
`test:procgen`; this is the same defect seen from the other side, not a new one.

## `test:procgen` — 6 failed, and the split matters

Three are **#427's**, unchanged by this branch: seed 11 Sky Cruiser through
flower heads, seed 18 gate corridor crossing off-plan, seed 5 `gate-approach`
1.94 m off the 12 m lattice.

Three are **new, all on seed 2, and all one thing**: seed 2 proves **zero**
bridge sites, so with the gate on it builds zero bridges.

```
seed 2 > nothing a bridge builds hangs into its own tunnel
         -- no bridge was tested ... this invariant proved nothing
seed 2 > every modelled coping stone sits on the wall it caps
         -- no bridge coping was tested ... proved nothing
seed 2 > railway crossings are planned -- station-clear, and mostly real bridges
         -- the park has 3 railway crossing(s) and not one real bridge
```

Two are anti-vacuity guards firing correctly. The third is a **design**
assertion, and it is the honest one: the family's ruling is that a path
crosses the railway on a bridge.

**The two bridges seed 2 used to have were standing on ground the planner had
measured and rejected.** They were not a park that worked; they were the
failure being hidden. #427's own last measurement already names seed 2 as the
single seed whose loop admits no bridge at all (12/13, 92%) and says so:
*"there is nothing for the backstop to reject to. This is a property of seed
2's park."* This change makes that visible instead of papering it.

CLAUDE.md's rule is *"never weaken an assertion to make a seed pass — swap the
seed and write down why"*, and #414 reached the same fork. **Either swapping
seed 2 or closing #427's seed-2 hole is a decision above an engineer**, and
this branch does neither.

## #392 — not touched

#392 is two crossings too close for both to carry a bridge. The gate strictly
*reduces* the number of bridges built, so it can only reduce the chance of two
adjacent bridges fighting over the same ground. Nothing here leans on
`CROSSING_SITES` harder than before — `paths.ts` is unchanged.

## Why I built on #414's idea rather than beside it

#414's branch has the same mechanism (`d07beb97` + `a56db1b5`) but is 15
commits off `main` on a different base, carries `ONLY_PROVEN_BRIDGES` plus a
routeCurve ownership move plus two open reds of its own, and its
`test:procgen` is red on seed 2 (a park with zero bridges). Cherry-picking
that whole branch onto #427's — which has itself re-solved every seed's
railway — would have imported its open questions along with its fix. So the
mechanism is rebuilt minimally here, on #427's geometry, with its own
measurement. Sequencing the two is the Overseer's call; they do not conflict
in file terms beyond `crossings.ts`'s one new field.

## The invariant

`noBridgeStandsWhereNoneWasProven` — the converse of
`everyProvenBridgeSiteKeepsItsBridge`, and the direction that was missing.
Announces its own cover on stderr every run, so a seed with no bridges cannot
read as "every bridge checked".

Proved red by mutation, against this branch's head geometry (canonical loop
361.8 m, proven sites 0/234/336, level sites 70/116/166/202/306):

```
LGP_ALLOW_UNPROVEN_BRIDGES=1 pnpm exec vitest run \
  test/procgen/seed-canonical.test.ts -t 'no bridge stands'

FAIL: a bridge deck stands over the crossing at (29.0, -32.6), railDistance
202.0, which is not one of the 3 site(s) the crossing planner proved a bridge
fits on (0.0, 234.0, 336.0)
```

Green without the flag.

## STATUS: `test:procgen` **487/487, 16/16 files — GREEN**. `build` exit 0.
## `pnpm run check` exit 0 across all 48 steps.

## The three inherited `test:procgen` failures — all cleared, all at the cause

Each was #427's own and predates this branch. None was fixed by weakening an
assertion, widening a probe, tuning a threshold or swapping a seed.

### 1. seed 5 — `every street sits on the shared 12 m lattice`

`gate-approach` ran 13.0 m east-west on z = 59.20, 1.94 m off the lattice.

`elbowLeg` turns a proven-clear diagonal into an L via one of two corners and
tested both with `segmentIsWalkable`, which asks `BLOCKERS` — the plots. It
does **not** know about the park boundary or the entrance arch's masonry. With
both corners "walkable" it fell through to its local `dz <= dx` rule and took
the blocked one. Measured with the generator's own screen:

```
north-then-east  (0,47.8)->(0,59.2)->(15.8,59.2)     clear=false, false  <- drawn
east-then-north  (0,47.8)->(15.8,47.8)->(15.8,59.2)  clear=true,  true
```

The drawn run passed 0.8 m from the arch's own pier (a 0.55 m collider at
(4.30, 60.00)), so a child could not walk it — one cause, two symptoms.

**Fix:** when both corners are walkable, prefer the one `streetSegmentClear`
also accepts — the generator's one owner of "may a street go here", and what
the lattice itself is built from. It can never reject a leg, so every route
that solved before still solves; where both elbows agree, `dz <= dx` decides
exactly as before and #269's lesson is untouched.

### 2. seed 11 — `the Sky Cruiser flies clear of the whole park`

The car passed through `living-flower-heads` at (-57.51, **0.70**, -20.16) —
the ride's own station approach, barely off the grass.

`Scenery.ts` already exports `clearOfCruiser(x, z, reach, topY)`, documented as
"one grid, one definition of the cruiser flies low here", asked by trees,
bushes, hiding walls and lamp posts. **`Flowers.pickSpawnPoint` was the one
scattered population in the park that never asked.**

**Fix:** it asks. `TALLEST_FLOWER`/`WIDEST_FLOWER` are derived from the same
two ranges `spawnAt` draws from and the same wiggle flare the update applies —
no second description of how big a flower gets.

### 3. seed 18 — `the walk in from the gate crosses the railway where the planner planned it to`

**Why the walk had no choice.** Seed 18's loop runs 2.5 m from the entrance
arch and seals the gate-side neck outright — swept about the arch there is
**0.0 m** of gate-side ground 2 m out and **0.9 m** at 4 m, against a 3.6 m
ribbon. A child stepping through the arch is across the track. The walk must
cross within a few metres of the arch, and nothing was planned within 90 m of
loop (railD 274 → 4).

**Why nothing was planned** — asked of the planner, via a new
`explainLevelRefusal` mirroring `explainBridgeRefusal`, after a
re-implementation of the tier's own tests had told me the opposite:

- railD 290–302, the arch's own stretch, is **genuinely refused by both
  tiers** — the loop hugs the rim and there is no room. The planner is right.
- but railD **306**, at (4.6, 53.6), **8.0 m from the arch**, *is* a level
  candidate (reach 4.0/3.5 against a 3.5 floor), as are 308–320 and 0–12.

They were selected out by **two rules in series**, and clearing the first only
revealed the second:

1. **Same-tier 24 m spacing.** Of 77 level candidates it kept 9, and near the
   gate it kept railD 8 — 25.3 m from the arch, *across the railway* — over
   railD 306 at 8.0 m, preferring it on ramp reach (4.0 vs 3.5). The ranking
   has no notion of where the park *needs* to cross.
2. **The cross-tier redundancy filter** — "a level crossing within a bridge
   site's own spacing is pure redundancy, the bridge is right there". It struck
   306 against the bridge at railD 4, 16.2 m along the loop. Across the ground
   that bridge is 21.9 m from the arch and **on the far side of the very
   railway the walk is trying to cross**.

Both rules measure separation *along the loop*; a walk measures it *across the
ground*. **Fix:** the entrance's own nearest candidate is kept first, and a
level site nearer the arch than the bridge that shadows it is not redundant.

**Two variations were tried first and reported before the next was attempted**,
neither shipped: pulling the gate corridor out to the arch (1 failure → 4), and
the cross-tier exemption on its own (no effect — the candidate it would have
saved was already gone at the same-tier rule).

## `pnpm run check` — and TWO more inherited reds it was hiding

The chain is `&&`, so `check:park` failing stopped it at step 26 of 48.
Fixing `check:park` made the chain run on, and it found two more. **Both
reproduce at #427's branch point `641573c7` in a detached worktree with its
own install; neither is caused by this change.**

### 1. An import cycle — FIXED HERE

```
ReferenceError: Cannot access 'TrainRoute' before initialization
  at src/world/train/plan.ts:346
```

`plan -> route -> {crossingKeepOut, bridgeFit} -> bridgeFootprint -> plan`.
Whichever module the entry point reaches first decides whether it blows up,
which is why the browser and 46 other checks were unaffected and one was not.
Two edges cut, neither by duplicating a number: `DECK_HALF_LENGTH` moves to
`clearance.ts` (the leaf that already owns the `FENCE_OFFSET` it is derived
from — exactly the fix `FENCE_OFFSET`'s own header describes), and
`distanceToRailCorridor` arrives on `RealWorldQuery` instead of being
imported. `bridgeFootprint.ts` re-exports `DECK_HALF_LENGTH`, so every
existing reader is unchanged.

### 2. `check:park-boot` — the #427 8x regression, ROOT-CAUSED AND FIXED

With the cycle gone, `check:park-boot` ran and failed on generation slice
time: `one advance() blocked for 104.0 ms against an 8 ms budget and a 20.0 ms
ceiling`. `origin/main` passes at 13.6 ms; #427's branch point plus only the
cycle fix fails at 105.4 ms. **One work unit had become ~8x dearer on #427**,
and the check that exists to catch it could not run.

`scripts/profile-park-boot-slice.mts` (new) drives a real `ParkGeneration` and
times every `advance()` with the phase read off the object's own letterboxes:

```
worst   100.1 ms   train search          <- the whole regression, one slice
worst    20.3 ms   path-graph search
worst     9.9 ms   slide search
worst     8.6 ms   cruiser search
worst     8.1 ms   crossing-sites search
every import phase <= 0.1 ms
```

**Two offenders, both the same defect: legitimate work that was never
yielded.**

1. **`bridgeableCrossingPoses(PARK_SEED)` — 102.1 ms**, not memoised, called
   from `buildTrainContext()` on `trainRouteSearch()`'s first line, *before*
   that generator's first `yield`. #427 replaced 96 rim bearings (arithmetic)
   with a probe of every 4 m point at 8 headings against real bridge-fit
   geometry, and left it un-sliced. Now `bridgeableCrossingPosesSearch`, one
   yield per x row (46 rows, ~2.2 ms each).
2. **`streetLattice()` — 15.7 ms first build**, memoised, so it landed on
   whoever asked first: `gateApproachSearch`'s first solver. **Pre-existing on
   `main`** (main peaks at 14.0 ms too) and marginal there; this branch's park
   tipped it over. Now `streetLatticeSearch`, one yield per lattice column,
   warmed by `pathGraphSearch` before anything asks. `pathGraphSearch` goes
   from 41 steps / worst 13.9 ms to **135 steps / worst 7.4 ms**.

Neither can move the result: both read static geometry only and draw no `Rng`
— the same argument `rail/generate.ts` makes for slicing its own search. Proved
rather than argued: `check:park` is byte-identical (229/229 waypoints), and
`measure-train-solve-budget` returns the same winning pose, restarts and loop
length on all five seeds.

**`check:park-boot`, five consecutive runs each:**

| | run 1 | 2 | 3 | 4 | 5 | verdict |
|---|---|---|---|---|---|---|
| before | 14.2 | 19.4 | 21.0 | 20.8 | 20.7 | **3 of 5 FAILED** |
| after | 12.0 | 12.0 | 11.1 | 11.7 | 11.6 | **5 of 5 passed** |

Against a 20.0 ms ceiling and an 8 ms budget, **neither touched**. Better than
`origin/main`'s own 14.0 ms worst.

**One thing for whoever owns `check:park-boot`:** its `PHASES` list counts only
`cruiserSearch`, `cruiserFinish`, `trainSearch` and `slideSearch`, so a slice in
the **path-graph** or **crossing-sites** phase is reported as `no generator step
at all, 0 work units` and cannot be attributed. That is what it said about the
15.7 ms lattice build, and it cost real time here.

## Seed 2 is swapped for seed 24 (#429)

Seed 2 proves **zero** bridge sites, so with the gate on it correctly builds
none and three invariants go red — two anti-vacuity guards firing as designed,
one design assertion. The code is right; the seed is pathological, and the
underlying hole is **#429**, untouched here.

Seed 2's coverage was its **36.7 m bridges** — PR #352 died having only ever
measured 22 m geometry, where the same paving error is 0.371 m instead of
0.513 m — so `scripts/probe-seed-bridges.mts`'s own header insists a
replacement be picked for comparable geometry, not for being green. Both were
measured per candidate:

| seed | longest bridge | invariant failures |
|---|---|---|
| 4 | 36.5 m | 2 |
| 29 | 36.5 m | 1 |
| 26 | 36.5 m | 3 |
| 22 | 36.0 m | 3 |
| 13 | 33.5 m | 2 |
| **24** | **32.5 m** | **0 — 78/78** |
| 3, 7, 12, 16, 20, 21 | 28.5–36.5 m | 3–5 |

**24 is the only green candidate**, 32.5 m is half as long again as the 22 m
that let #352 through, and its shape matches seed 2's (two crossings, one
bridged one level). It also *exercises* the rule it is here for: with
`LGP_ALLOW_UNPROVEN_BRIDGES=1` it goes red on exactly one invariant — mine — so
it is a park that would have built a bridge on rejected ground.

`test:procgen`: **6 failed / 481 passed → 3 failed / 484 passed.** The three
left are #427's own and unchanged (seed 11 Sky Cruiser, seed 18 gate corridor,
seed 5 lattice).

## FOR #414's OWNER — two defects measured here, precisely enough not to re-measure

Both found by `scripts/probe-blocked-ribbons.mts` (on this branch), which walks
every drawn ribbon with `poiGraph`'s own clearance test and names the collider.
Neither is touched here: each changes the path network on every seed and needs
all five #427 measurements re-run behind it.

### A. Foreign legs cut by a PROVEN bridge's ramp parapets — #414 step 1

**Seed 5, `LGP_SEED=5`.** Four blocked stretches, all against
`wall len=2.0 halfT=0.15 top=3.5–5.3` (ramp parapets), at rail distances that
sit inside proven bridge sites' ramps:

| ribbon | blocked at | railD | proven site |
|---|---|---|---|
| `spur-dodgems` | (14.3, 44.1) | 13.7 | 12 |
| `connector-dodgems-stall.dodgems` | (55.0, 21.4) | 53.5 | 56 |
| `spur-waterFight` | (14.3, −42.4) | 144.2 | 142 |
| `spur-waterFight` | (17.1, −40.7) | 139.6 | 142 |

Seed 5's proven bridge sites are 12, 56, 142, 308; level sites 100, 172, 220,
246. So these are **legitimate bridges on proven ground, cutting legs that are
not their own** — exactly #414's step 1, *"paths must keep off the ground a
bridge will stand on"*. That fix exists on this branch as
`segmentCutsABridgeRamp`, but it screens **lattice edges and branch points
only** — a spur's own drawn ribbon is not put through it. This is what keeps
seed 5 at `poi.stranded: 15` (down from 25).

### B. A ribbon drawn ALONG the fence, not across it

**Seed 5, `connector-stall.facePaint-station-0`**, blocked 7.0–14.0 m of its
20.5 m by a genuine railway fence panel (`len=2.6 halfT=0.18 top=Infinity`) at
**(51.1, 4.4), railD 68.7, railGap 2.1 m**. It does not *cross* the rail there
— `probe-unplanned-crossings` reports 0 unplanned crossings on seed 5 — it runs
**parallel to the fence, 2.1 m off it**, and the fence's own panels catch the
ribbon. A third, separate defect from either of the above, and the only case in
the whole sweep where a fence panel is the collider.

## Still open, for whoever is next

- **#429 — seed 2 admits no bridge anywhere.** Not touched, per instruction.
  The seed is out of the sweep (see above) and the ticket owns the hole.
- **#396.** The measurement is here and it is 11/13; the *invariant* is not.
  Overseer accepted this as a follow-up. The instrument
  (`measure-level-crossing-walkability.mts`) is on this branch to write it
  with. Its two failures are both seed 18's, already red for #427's reasons.
- **#427's own three `test:procgen` reds** — seed 11 Sky Cruiser, seed 18 gate
  corridor, seed 5 lattice. Unchanged by anything here.
