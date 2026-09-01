# HANDOFF — issue #416, pathfinding gives no weighting to paths

Branch `feat/prefer-walking-on-paths`, worktree `.claude/worktrees/path-weighting`, port **5419**.

Jim, 31 Aug: *"the pathfinding seemingly gives no weighting to paths (for player
and NPC) - make it prefer walking on paths, but off them is possible too if you
with some reasonable weighting penalty"*

## Status

- [x] Survey — both routers already share one class
- [x] `src/world/paving.ts` — the one penalty, and the paving registry
- [x] `NavGrid` — weighted A*, and weight-aware string-pulling
- [x] `check:path-preference`, in the `pnpm run check` chain
- [x] Tuning sweep, and route traces drawn and looked at
- [x] **Both mutations proven red** (transcripts below)
- [x] Full `pnpm run check` + `build` + `test:procgen`
- [x] Browser QA on 5419, player and NPC, before *and* after
- [x] `origin/main` is still 6d475dab — nothing to rebase onto yet
- [x] PR **#421**, all four CI checks green

## CI

All four required checks pass on #421 — **`Checks` (the full 47) green in
16m30s**, Procgen invariants green, PR preview deployed. `check:park-boot`
passes on CI's quieter box, which settles the local red as #324 load flake.

**Preview, checked:**
<https://pr-421-834b9ca-land-of-good-places.blockstack.workers.dev/spawn?pos=-46,-8>
— lands her on the western junction; tap up-and-right and she walks the street.
Verified headless by tapping the canvas (`window.game` is DEV-only), 0 console
errors, screenshot shows her mid-paving.

## The gate

| | result |
| --- | --- |
| `check:waypoints` | green — 240 waypoints, every one somewhere a child could stand |
| `check:park` | green — **19/19 attractions route from the entrance, 240/240 waypoints connected, all six invariants hold** |
| `check:nav-routes` | green |
| `check:path-preference` (new) | green — mean 79.8% paved, was 55.0% |
| `pnpm run build` | exit 0 |
| `pnpm run test:procgen` | 482/482, 16 files |
| `check:park-boot` | **red, and red on `origin/main` too** — see below |

`check:park-boot` is #324, the known load-dependent flake, and it was measured
on both columns on this box with nine agents running:

- branch: worst advance 24.2 ms, `cruiserSearch, 2 work units`
- `origin/main` (6d475dab, its own clean worktree): worst advance **25.3 ms**,
  `cruiserSearch, 137 work units`, 6 steps begun after their deadline

`origin/main` is *worse*. Not attributable to this change. Nothing in this
branch runs during generation — the paving stamp happens on the first route
asked for, long after boot.

## Watched running (port 5419, headless Chrome, zero console errors)

The honest before/after: **the same build, the same seed, the same spawn, the
same destination — one variable**, the multiplier flipped to 1 and back. A pair
taken from two different builds would prove much less.

Measured on the **bodies as they actually walked**, not on the routes:

| | on paving, before | after |
| --- | --- | --- |
| player tap-to-walk, one 98 m walk | **20.0%** | **63.8%** |
| the children, 21 kids in the garden, 60 s | **38.8%** | **60.1%** |

And it is not just a number — plotted over the park's own paving
(`qa-trails-before.png` / `qa-trails-after.png`, side by side in
`qa-before-after.png`), *before* is one long straight diagonal for the player
and a spider's web of diagonals for the children, cutting clean across the
middle of the park. *After*, the player's walk runs along the top street and
down the left, and the children's trails largely trace the beige. Nothing in
the after picture reads as "why did she go that way?" — which is the whole
test.

## What was built

**One definition, and it genuinely is one.** Both movers already plan on the
same class: the player's tap-to-walk grid (`src/Game.ts:388` → `TapNavigator`)
and the children's per-space grids (`src/entities/npc/journey.ts`,
`JourneyPlanner.gridFor`) are both `src/world/NavGrid.ts`, both calling
`findRoute`. So the penalty lives once, in `src/world/paving.ts`, read once, by
`NavGrid.costOf`. There is no second router to keep in step. The check asserts
this rather than trusting it: it puts the same probes through a real
`JourneyPlanner` and a player grid and requires the paved fractions to agree to
within 0.001 — worst measured disagreement **0.000%**.

**`OFF_PATH_COST_MULTIPLIER = 1.6`** — a metre of grass costs 1.6 metres of
paving. A multiplier, never a wall.

**Why NavGrid does not just import `isOnPath`:** `pathGraph.ts`'s module body
runs the whole path solve, and `NavGrid` is imported by interiors and by checks
that must not generate a park. So the direction is inverted — `buildPaths()`
**publishes** where it drew the ribbons (the same `samples[]` + `PLAZA` disc
`distanceToPath` answers from), and the router reads it. Nothing published ⇒
flat cost ⇒ interiors bit-for-bit as before.

**The trap that would have shipped this inert:** `NavGrid.smooth()` string-pulls
whenever the chord is walkable. A weighted route that went round the lawn would
be straightened right back across it. `lineIsWalkable` is now `lineCost`, and a
chord is taken only when it is no dearer than the legs it replaces (plus
`SMOOTH_CORNER_TOLERANCE = 0.08`, so a chord across the inside of the ring road
is still allowed). On uniform ground chord ≤ polyline by the triangle
inequality, so the unpaved case is unchanged.

## The tuning, measured not asserted

87 junction-to-junction routes and 109 short hops onto the grass, canonical park:

| multiplier | on paving | worst detour | worst short hop |
| ---------- | --------- | ------------ | --------------- |
| 1 (before) | 55.0%     | —            | —               |
| 1.2        | 63.6%     | +7.7%        | —               |
| 1.414 (√2) | 71.9%     | +12.3%       | —               |
| **1.6**    | **79.8%** | **+19.0%**   | **+0.2%**       |
| 1.8        | 85.9%     | +25.4%       | —               |
| 2.0        | 92.3%     | +33.8%       | +4.6%           |
| 2.5        | 94.1%     | +34.5%       | +21.5%          |

√2 ≈ 1.414 is the hard floor: below it the diagonal always beats the
right-angled walk round a grid-laid network, and *nothing changes*. Measured —
at 1.414 the paved fraction barely moves.

**1.6 was chosen on a picture, not on the table.** Routes were drawn over the
park's paving at 1.6 and 2.0 (`routes-1.6.png` / `routes-2.0.png` in the
scratchpad). At 2.0 the gate → far-ride walk runs along the top street, **dips
off it and comes back up** — a visible U, exactly *"why did she go that way?"*.
At 1.6 the same walk is clean. 2.0 is the better park numerically and the worse
one to a watching adult, and Jim's test is the adult.

**Eccentricity is bounded by arithmetic, not by hope:** on-path cost is exactly
distance walked, so an optimal weighted route can never exceed 1.6× the direct
one. Worst measured: **+19.0%**. The short hop onto grass — Jim's named failure
— costs **−0.01 m on average, +0.2% at worst**.

## Proven red by mutation

```
==================== MUTATION 1: OFF_PATH_COST_MULTIPLIER = 1 ====================
— 87 junction-to-junction routes across the built park —
FAIL  routes stay on the paving: mean 55.8% of route length is paved (floor 75%; unweighted, the same routes manage 55.8%)
FAIL  even the worst route uses the paving: 14.8% on dodgems → waterFight (floor 45%)

check:path-preference — 2 failure(s):
exit=1

==================== MUTATION 2: smoother ignores the weighting ====================
(the `chordCost > (polyCost + legCost) * (1 + SMOOTH_CORNER_TOLERANCE)` line deleted —
 i.e. the feature shipped with only half of it, which is the subtle way to get this wrong)
— 87 junction-to-junction routes across the built park —
FAIL  routes stay on the paving: mean 68.6% of route length is paved (floor 75%; unweighted, the same routes manage 55.0%)
FAIL  even the worst route uses the paving: 36.4% on stall.spaceFerrisWheel → waterFight (floor 45%)

check:path-preference — 2 failure(s):
exit=1
```

Both restored; `git status --porcelain` empty, `tsc --noEmit` exit 0, check
green again at 79.8%.

## Reachability did not shrink

The check builds a **second lattice with the paving forgotten** and compares
like for like: of 269 destinations spread over the whole park, **200 reachable
unweighted, 200 reachable weighted** — the same 200, asserted per destination,
not just by count. Grass, meadow and the gaps between attractions all keep their
routes; they cost more, they are not excluded.

## Moving under us

- **#414 step 1 has landed on its branch**: `paths.ts` now reserves the bridge
  ramp corridor at layout time, and canonical / seed 5 / seed 18 each **gained a
  bridge**. The network near bridges therefore moves. **This work needs no
  re-tuning for that** — paving is read live from `buildPaths()`'s own samples,
  so wherever the ribbons end up, that is what the router prefers — but the
  measured numbers above must be re-taken after rebasing, and the bridge decks
  are now paved cells the router will want to use.
- Files owned by others and untouched here: `src/world/paths.ts`,
  `src/world/train/*` (#414), wall placement (#417), `IsoCamera` (#420).
  This branch touches only `src/world/NavGrid.ts`, `src/world/paving.ts` (new),
  two lines of `src/world/pathGraph.ts` (the publish call), and the new check.

## Re-measured on `origin/main` a6e50ede (31 Aug, after #441's 2.5 cap)

Rebased clean onto a6e50ede. The branch's own diff is **byte-identical** to
before the rebase (checked by diffing the two three-dot diffs; only context
line numbers moved). `OFF_PATH_COST_MULTIPLIER` is untouched at 1.6. The
`package.json` conflict was rerere-replayed, so the resolution was read back
against `main`'s own chain and the parsed `scripts` object — it adds only
`check:path-preference`, in the chain and as a script, and drops nothing.

**Gates:** `build` exit 0. `test:procgen` **497 passed / 16 files**. Every
step of `pnpm run check` passes **except** the one assertion below (the chain
stops there, so the 16 steps after it were run separately — all green).

### `check:path-preference`, measured

| assertion | result |
|---|---|
| mean paved ≥ 75% | **ok — 81.4%** (unweighted the same routes get 54.3%) |
| worst route ≥ 45% | **FAIL — 6.9%**, `dodgems → stall.railRacer` |
| no comic detour ≤ 73% | ok — worst 21.7% |
| kerb step ≤ 73% | ok — worst 12.5%, mean +0.10 m |
| reachability | ok — 202 of 269 both ways, unchanged |
| children route as the player | ok — 0.000% disagreement |

The mean came in at **81.4%, not the predicted 75.7%** — 6.4 points above the
prediction and 6.4 above the floor.

### The worst-route failure is geometry, and it is wider than #443 as filed

**Four** of the 100 probe pairs are under the 45% floor, not one:

| pair | now | unweighted | straight-line |
|---|---|---|---|
| `dodgems → stall.railRacer` | 7% | 7% | **36.0 m** |
| `dodgems → exit-railRace` | 9% | 9% | **38.8 m** |
| `dodgems → gate` | 16% | 14% | **46.2 m** |
| `exit-railRace → stall.facePaint` | 43% | 23% | **69.0 m** |

`addInterconnects` caps connector candidates on **straight-line** distance at
`medianNearestNeighbourSpacing × CONNECTOR_SPACING_CAP_MULTIPLE` = **30.18 m**
(that is the 2.5 #441 moved). **All four pairs are beyond that cap**, so none
of them can be given a connector at 2.5 — there is no paving between them to
prefer. The first three are inert to this feature (7→7, 9→9, 14→16), which is
the signature of "no paving exists", not of a weighting that is too weak. The
fourth moved 23%→43%: the feature nearly rescued it and geometry capped it.

**So: the remainder is entirely the #443 *class* — beyond-cap pairs the park's
geometry cannot serve — but it is three pairs wider than #443 as written.**
Fixing only the pair #443 names would not turn this check green: raise
`dodgems → stall.railRacer` past 45% and `dodgems → exit-railRace` at 9%
becomes the new worst. Note also that #443's other named pair (spooky house →
sky cruiser) is **not** in this probe set at all — that came from a different
instrument.

Nothing here is new since #431/#441; no assertion was weakened and no probe
dropped.

## Option 2 (exclude beyond-cap pairs) is not implementable — measured, 31 Aug

**Stopped before writing any code.** The exclusion would empty the probe set,
and my own rationale for proposing it was wrong. Numbers first.

### The cap is 32.67 m on this park, not 30.18 m

Recomputed from the generator's own definition (20 destinations of kind
`anchor|stall|station|exit`, median nearest-neighbour spacing **13.070 m**):

| multiple | cap | probes surviving |
|---|---|---|
| 2.0x | 26.14 m | **0 of 100** |
| **2.5x (today)** | **32.67 m** | **5 of 100** |
| 3.0x | 39.21 m | 11 of 100 |
| 3.5x | 45.75 m | 22 of 100 |

The probe set spans **31.01–107.4 m** — `MIN_PROBE_SEPARATION` is 30 m and the
cap is 32.67 m, so the two windows barely overlap. Excluding beyond-cap pairs
leaves **5 probes, under the check's own `probes.length < 8` guard**: the check
would not go green, it would hard-error with *"the network has changed shape;
re-derive the probes rather than lowering the bar."* At a 2.0 cap it leaves
**zero**. An exclusion whose survivors are a generator constant away from
nothing is not a probe re-derivation; it makes the check's existence contingent
on a number it does not own.

### And the cap was never the reason those four pairs are unpaved

**All 100 probes are beyond the cap**, yet 96 of them are 43–100% paved. They
route via the ring backbone; a direct connector was never what paved them. So
"beyond the cap" does not separate the four failures from the 96 passes, and my
earlier report drew that line wrongly. The park has 27 edges, of which only 4
are direct interconnects — this is a ring-and-spurs network, and every junction
is connected through it.

### What actually separates them: the floor contradicts the multiplier

The weighted A* is optimal under its own cost function, and as the check's
header states, *"paving costs exactly the distance walked, so an optimal
weighted route can never exceed the multiplier times the direct one"*. For
`dodgems → stall.railRacer` that router chose a **38.0 m route that is 7%
paved** — barely longer than the 37.8 m unweighted line. By optimality, any
paved alternative must therefore cost **more than 1.6 × 38 ≈ 61 m**. Same for
the other two inert pairs.

So these routes are unpaved because **the paved way round is more than 1.6x the
direct line**, and `OFF_PATH_COST_MULTIPLIER = 1.6` is *designed* to refuse
that detour — and the `no comic detour` assertion, at 21.7% against a 73%
ceiling, positively *forbids* it. **The 45% worst-route floor and the 1.6
multiplier cannot both be satisfied on these pairs.** Cutting the corner is the
correct behaviour; a watching adult would not ask why she went that way.

This is a genuine contradiction inside the check, not a park defect and not a
feature defect. It needs Jim's call, not a patch from here.

## STOP — 22 of the 100 probes never reach their goal, and are counted anyway

Found while building the servability exclusion. **This is bigger than the
ticket and it invalidates the 81.4% headline I reported earlier.**

`trace()` records `reachedGoal` on every probe run, but that field is **only
ever asserted on the reachability lattice** (line ~645). For the 100
junction-to-junction probes it is recorded and **never read**. So a route that
gave up partway is measured and averaged exactly like one that arrived.

Measured on the rebased branch:

- **22 of 100 probes never reached the goal.** Both routers fail on all 22 —
  the unweighted one too, so this is not caused by this feature.
- **0 of them are at the `MAX_ROUTE_WAYPOINTS` (128) cap** — waypoint counts
  are 1 to 13. They genuinely gave up; this is not truncation.
- **Six are 1-waypoint stubs of ~3 m counted as 100% paved**, e.g.
  `plaza → stall.facePaint`: separation 39.8 m, route **3.2 m**, scored
  **100%**. A failure to route scores better than most real routes.

**Every one of the 22 has `plaza` or `station-1` as an endpoint, and every
probe involving those two nodes is among them** — 12 with `plaza`, 10 with
`station-1`, 22 exactly. Those two junctions are unroutable from anywhere.
They pass `isOnPath`, so they are on the paving; the router cannot work
from them. That is a park or lattice defect, not a paving-preference one.

### What it does to the numbers

| | mean paved |
|---|---|
| over all 100 probes (what the check reports today) | **81.4%** |
| over the 78 that actually arrived | **79.5%** |

The floor is 75%, so **the mean assertion still passes honestly at 79.5%** —
the feature is not in question. But 81.4% is inflated by counting 22 failures,
six of them as perfect scores, and that is the exact disease CLAUDE.md names:
*"an assertion reporting success about something it is not describing."*

### Why this blocks the servability work

The exclusion predicate compares the shortest all-paved walk against
`OFF_PATH_COST_MULTIPLIER × the unweighted route length`. For a stub that
length is ~3 m, so the budget is ~5 m and the pair is excluded as "not
servable" — for entirely the wrong reason. The predicate is contaminated by
the same defect. Implemented as-is it reports **85 of 100 servable** and the
worst route becomes `exit-railRace → stall.facePaint` at 43.2%, still under
the 45% floor — but I do not trust that 85, because 22 of its inputs are
garbage.

**Not proceeding to the red-at-cap-2.0 proof until this is settled**, because
that proof would be run against a probe set a fifth of which does not route.
The servability code is committed but its verdict should not be relied on yet.

## #448 diagnosed — two *different* park defects, neither in the graph

Step 1 landed first: **a probe that never arrives is now a failure**, not a
100% score (`every probe arrives`). The check now reports 2 failures, and
everything below was measured with that assertion in place.

The Overseer's steer was to check whether the two nodes are isolated in the
graph the router walks. **They are not, and the graph is not involved.** Both
nodes have their spur edge (`ring->plaza`, `ring->station-1`), the same as
healthy junctions. The router does not walk `PATH_GRAPH` at all — it walks
`NavGrid`'s collision lattice, and that is where both fail. They fail for
**two unrelated reasons**, so #448 is really two tickets.

### 1. `plaza` sits dead centre in the fountain (12 probes)

| | |
|---|---|
| fountain centre | **(-9.07, 7.38)**, rimRadius 4.20 |
| `plaza` node | **(-9.07, 7.38)** |

Exactly coincident. `Fountain.ts` builds its rim as **28 short wall segments**
approximating a circle, deliberately *hollow* — its own class doc: *"a jump
that clears one segment's `topHeight` finds nothing left to push it back out
once it lands inside."* The rim is meant to be jumped into.

So the plaza junction is on ground reachable only by jumping, and A* has no
jump-the-rim move. Measured: from `plaza` the router reaches **1 of 201**
sample points across the park (itself); every healthy junction reaches 192.
Free movement out to 3 m, nothing at 6 m or beyond in any of 16 bearings.

**The path network placed a junction inside the fountain.** That is the defect.

### 2. `station-1` is unreachable *as a goal* only (10 probes)

Asymmetric, which is why it looked healthy at first: as a **source** it reaches
192/201, same as everything else. As a **destination** every one of its 10
partners fails. Routing `gate → station-1`:

| offset from the node | +x | -x | +z | -z |
|---|---|---|---|---|
| **0.00 m (the node itself)** | **FAIL** | **FAIL** | **FAIL** | **FAIL** |
| 0.50 m | solid | ok | ok | ok |
| 2.00 m | ok | ok | ok | ok |

A knife-edge. A circle collider of r=0.22 sits **0.97 m** from the node;
fattened by `PLAYER_RADIUS` (0.62) that reaches 0.84 m, and once quantised to
`NavGrid`'s 0.5 m lattice it closes the last 13 cm and blocks the node's own
cell. The walker can stand *beside* station-1 but can never arrive *at* it.

### Both are park defects, and neither is this feature's

The **unweighted router fails identically on all 22** — this predates #416 and
is not caused by the paving preference. Nothing here argues against #421.

**Not fixed, per instruction.** Note one hypothesis worth testing in step 3
rather than assuming: the fountain sits in the middle of the plaza, so routes
crossing it must detour round the rim and off the paving. That may be feeding
the worst-route number too — but it is a hypothesis, and the last two I formed
without an instrument were both wrong.

## #448 sweep — 21-22 junctions x 5 procgen seeds, source and destination apart

107 junction-seed pairs. Canonical (20260728) + sweep seeds 2, 5, 11, 18, each
in its own process (module caches make in-process re-seeding impossible).
"Reachable" = routes to/from >= 50% of 67-86 clear sample points spread over
the park. `margin` = distance to the nearest collider surface **minus**
`PLAYER_RADIUS`; `hair` = half a `NavGrid` cell diagonal, **0.354 m**, which is
how far a node can sit from its own cell centre.

### The margins fall into two groups with nothing in between

| margin | pairs |
|---|---|
| **< 0 (node inside a collider)** | **3** |
| **0.00 – 0.15 m** | **13** |
| 0.15 – 0.354 m (under a hair) | **0** |
| 0.354 – 1.0 m | 35 |
| > 1.0 m | 56 |

The only values under a hair are **-0.62, 0.02, 0.06 and 0.13 m**. The next
margin up is **0.43 m**. **Nobody has to pick a threshold — anything between
0.15 and 0.43 separates the two groups**, and the lattice's own 0.354 m sits in
the empty gap. That is the number to write a rule against, and it is derived
from `NavGrid`'s `CELL`, not invented.

### 14 of 107 pairs are broken, and the asymmetry holds everywhere

| node | reachable as destination |
|---|---|
| `plaza` | **0 of 5 seeds** |
| `building` | 2 of 5 |
| `station-0` | 2 of 5 |
| `station-1` | 2 of 5 |

**Source-side failures: 5, every one of them `plaza`.** Destination-side: 14.
The asymmetry survives the sweep — routing *to* a junction is what breaks, and
`src 96% / dst 0%` is the signature across every seed.

- **`plaza` fails on all five seeds, both directions.** The fountain swallows
  it every time; this is systematic, not seed luck.
- **`building` has margin -0.62 m on seeds 5, 11 and 18** — the junction is
  *inside* a collider, not near one.
- **Same margin, different outcome**: `station-0` sits at +0.13 m on all five
  seeds and is reachable on two of them. So the margin does not decide it on
  its own — **sub-cell alignment does**, which is exactly why this is flaky and
  has stayed invisible. A junction at 0.13 m is a coin toss.

### The canonical seed is the *mildest* of the five

Broken destinations per seed: **canonical 2**, seed 2 **1**, seed 11 **3**,
seed 5 **4**, seed 18 **4**. `check:park` runs the canonical seed only (#437),
so `building` sitting inside a collider on three of five seeds is **invisible
to every check we have today**.

### Scoping this suggests

Two rules, not one, because the two defects have different shapes:

1. **No junction inside a collider ring** — catches `plaza` on 5/5. A procgen
   invariant, shipping with the placement change per CLAUDE.md.
2. **Every junction keeps a clear margin of at least one lattice hair
   (0.354 m) beyond `PLAYER_RADIUS`** — catches the other three on every seed
   they fail, and would have caught them on the seeds where they happen to
   pass, which is the point: they pass there by alignment, not by design.

Both want measuring across all five seeds, so `test/procgen/invariants.ts` is
the natural home rather than a canonical-seed-only check.

**Nothing fixed.** Sweep instrument was temporary and is deleted.

## 1 Sep — both paving thresholds re-derived from all five seeds, and landed

Jim's ruling, relayed by the Overseer: replace the worst-route assertion with
**"at least 85% of routes are at least 60% paved"** (his first form was 90/60;
he took the safer variant when the seed-11 margin came back at +1.8). Done, and
`MEAN_PAVED_FLOOR` re-derived alongside it because it had the same disease.

### The distribution, measured (reached **and** servable, all five seeds)

| seed | n | mean W | mean U | ≥60% paved, W | ≥60% paved, U |
|---|---|---|---|---|---|
| canonical | 71 | 83.0% | 52.5% | 68/71 = 95.8% | 27/71 = 38.0% |
| 5 | 52 | 82.3% | 51.1% | 50/52 = 96.2% | 14/52 = 26.9% |
| **11 (binds)** | 49 | **74.3%** | 45.2% | **45/49 = 91.8%** | 10/49 = 20.4% |
| 18 | 43 | 79.1% | 41.8% | 41/43 = 95.3% | 5/43 = 11.6% |
| 24 | 47 | 80.1% | 51.8% | 45/47 = 95.7% | 17/47 = 36.2% |

`MEAN_PAVED_FLOOR` **0.75 → 0.70**: 0.75 was canonical-only and failed on seeds
11 (71.0%) and 18 (73.1%). 0.70 is the highest round figure all five clear
(binding margin +4.3) and clears the best unweighted mean (52.5%) by 17.5.

`WORST_PAVED_FLOOR = 0.45` **deleted**. It was red on three of five seeds, and
two of those three failures were fake: the worst-route loop skipped
non-servable probes but not *abandoned* ones, so seed 11's 29.9% and seed 18's
27.1% were routes that never arrived being scored.

**One population for both statements** — arrived, and servable. Seed 18's 43
probes move in 2.3-point steps, so 85 and 86 are the same rule there; noted in
the code so nobody reads a one-point edit as a one-point change of strictness.

### Anti-vacuity: the mutation now runs on every invocation

New assertion `the bar is a real bar` puts the same bar to the **unweighted**
lattice (the same park with the paving forgotten) and requires it to fail.
Fails by **47.0** points canonical, 47–73 across the seeds.

**Mutation re-run, 1 Sep, and one correction worth having:**

- **Smoother mutation** (drop the weighted-chord test) is the honest proof —
  it leaves `OFF_PATH_COST_MULTIPLIER` alone, so the population stays at 71 and
  only the routes move: mean **83.0 → 67.8%** (floor 70), share **95.8 →
  73.2%** (bar 85). Both new assertions red. exit=1.
- **`OFF_PATH_COST_MULTIPLIER = 1`** exits 1 too, **but not by failing the
  paving assertions** — the servable predicate is defined in terms of that same
  multiplier, so setting it to 1 collapses the population to 2 probes and the
  run stops at the `< 8` guard. Recorded as the guard talking, not as a paving
  measurement, because quoting it as the latter would be the stale-transcript
  trap CLAUDE.md names.

### Gates

| gate | result |
|---|---|
| `pnpm run build` | **exit 0** |
| `pnpm run test:procgen` | **497 passed / 16 files** |
| `tsc --noEmit` | exit 0 |
| every paving assertion, all five seeds | **green** |
| `pnpm run check` | **red — `every probe arrives`, and only that** |

### Still blocking, and it is not this work

`check:path-preference` remains red on **every** seed on `every probe arrives`
— 22/20/24/27/11 probes of 100/77/98/78/77. That is **#448**, the two park
defects diagnosed above (`plaza` inside the fountain; junctions unreachable as
goals on a knife-edge margin). The **unweighted router fails identically on all
of them**, so it predates #416 and is not caused by this feature. Nothing in
this section changes it, and per instruction it was not touched.

**`pnpm run check` cannot exit 0, and therefore #421 cannot go green, until
#448 is fixed.** The paving work itself is done and green.

## Rebased onto `origin/main` a7fb6e71, 1 Sep

Two commits had landed (#424 keyring framing, #425 drag-to-look). **The
`package.json` conflict is the one CLAUDE.md names**: `main` had gained
`check:look-around` and `check:keyring-view` while this branch adds
`check:path-preference`, so accepting either side would silently drop steps.
Resolved by rebuilding the chain from **main's** list and inserting
`check:path-preference` after `check:nav-routes`, then verifying by parsing
the `scripts` object rather than grepping: **52 steps**, all three names
present.

**Every paving number is byte-identical after the rebase** — 83.0 / 82.3 /
74.3 / 79.1 / 80.1% mean, 95.8 / 96.2 / 91.8 / 95.3 / 95.7% share. Neither
landed PR moves the park, so the derivation tables in the source are still
accurate. `tsc` 0, `build` 0, `test:procgen` **497**, and main's own two new
steps (`look-around`, `keyring-view`) green on this branch.

## Measured against #452 (`feat/hoppable-walls-cost`), 1 Sep — measurement only

Done in a **throwaway worktree, never pushed, since deleted**. Neither branch
was rebased or merged; sequencing is the Overseer's.

### 1. Admissibility holds — structurally, not by luck

Both changes write `step *= <multiplier>` on the **same** `let step` in the
same neighbour loop (`costOf` → 1 or 1.6; `HOP_COST_MULTIPLIER` → 6.4), and
**neither touches `heuristic()`**, which stays octile in cell units at cost 1.
Every multiplier is >= 1 on the geometric step, so the heuristic remains a
lower bound with **both** applied (worst case 1.6 x 6.4 = 10.24x) exactly as
with either alone. This is a property of the composition, not of the two
particular numbers: any further weighting of the same shape is also safe.

### 2. The thresholds survive unchanged — no re-derivation needed

| seed | n (alone → with #452) | mean (floor 70) | share >=60% (bar 85) |
|---|---|---|---|
| canonical | 71 → 83 | 83.0 → **83.3** | 95.8 → **96.4** |
| 5 | 52 → 60 | 82.3 → **82.5** | 96.2 → **95.0** |
| 11 | 49 → 57 | 74.3 → **74.6** | 91.8 → **93.0** |
| 18 | 43 → 49 | 79.1 → **79.0** | 95.3 → **91.8** |
| 24 | 47 → 52 | 80.1 → **81.3** | 95.7 → **96.2** |

Binding margins are unchanged: mean +4.3 → **+4.6** (seed 11 still), share
+6.8 → **+6.8** (binding seed moves 11 → 18). `the bar is a real bar` still
fails unweighted by **38.8–72.8** points. **85/60 and the 70% mean floor stand
as derived.**

### 3. #452 largely fixes #448's arrival failures

Probes that never arrive: **22 → 10** canonical, 20 → 9, 24 → 12, 27 → 17,
and **11 → 0 on seed 24**, which goes fully green on `every probe arrives`.
Its `Fountain.ts` change reaches the same defect this branch documented.

### 4. But #452 breaks `stepping off the kerb stays a step`

| seed | worst kerb detour | ceiling |
|---|---|---|
| canonical | **183.9%** (a spot 4.1 m off the path) | 73% |
| 24 | **202.4%** (4.1 m off) | 73% |

This is **Jim's own named failure mode** — the comic detour to reach something
a few metres across the grass — and it is what this assertion exists to catch.
Mean cost stays small (+0.21 m), so it is a worst case on one or two spots,
not a park-wide regression.

**Isolated, not guessed**: removing the hop-band rejection I put into
`lineCost` (my reconciliation choice) leaves it failing at **157.1%**, so that
choice accounts for ~27 points and the remaining regression is **the 6.4x
multiplier itself**, not the way the two were reconciled.

## 1 Sep — rebased onto `origin/main` 32f3bd3c, and the faulty probe set fixed

Jim's ruling, relayed: `every probe arrives` is right and **the sample feeding
it is what to fix**. Done. No threshold touched.

### The rebase

20 commits onto 32f3bd3c. Two conflicts, both the ones CLAUDE.md names:

- **`package.json`** — rebuilt from **main's** own chain (53 steps) with
  `check:path-preference` inserted after `check:nav-routes`, then verified by
  **parsing the `scripts` object**, not grepping: **54 steps**, exactly one key
  added, **nothing dropped**, every other script byte-identical to main's.
- **`src/world/NavGrid.ts`, 12 hunks** — the #452 reconciliation this file
  predicted. `hopBand` and `paved` both kept; both multipliers written on the
  same `let step` (the composition is admissible structurally — neither touches
  `heuristic()`, both are >= 1); `pointSpliced` → main's `pointRigid`; and the
  hard one, **`lineIsWalkable`'s hop-band rejection folded into `lineCost`'s
  `-1` shape**, which preserves main's behaviour exactly.

### The fix: probe only from junctions a child can stand at

`PATH_GRAPH`'s junctions are points on a **drawn plan**. The plan does not know
about the bollard the scenery placer later put 0.97 m away — fattened by
`PLAYER_RADIUS` and quantised to `NavGrid`'s 0.5 m lattice, that closes the
junction's **own cell**. A route can pass such a node but never *finish* on it,
so the check was asking for routes that cannot exist and then failing because
they did not.

- **`NavGrid.canStandAt(x, z, y, sample)`** — new, public. `findRoute`'s goal
  test (`standableNodeIn`) is now the one owner of "a route may end here", read
  by the router for its goal and by this check for its endpoints. **No second
  definition of standable, and no exclusion list to go stale.**
- The check filters endpoints through it, **writes the count and every excluded
  junction to stderr on every run** — with how far the nearest standable ground
  is, which separates a knife-edge miss from a node deep inside something — and
  the `probes.length < 8` guard now names the exclusion as a suspect.

| seed | standable / junctions | excluded (nearest standable) | probes |
|---|---|---|---|
| canonical | 20/21 | `station-1` (0.25 m) | 100 → 89 |
| 5 | 19/22 | `building`, `station-0`, `station-1` (0.25 m each) | 57 |
| 11 | 20/22 | `building` (0.50 m), `station-0` (0.25 m) | 74 |
| 18 | 18/21 | `building` (0.50 m), `station-0`, `station-1` (0.25 m) | 50 |
| 24 | 19/20 | `building` (0.25 m) | 69 |

Every exclusion is 0.25–0.50 m — **one lattice cell**, exactly the knife-edge
#448 diagnosed. `plaza` no longer appears: main's fountain-hop work fixed it.

### `every probe arrives` is green on all five seeds

And the thresholds stand as derived — nothing weakened, nothing widened:

| seed | n | mean (floor 70) | share >=60% (bar 85) | anti-vacuity margin |
|---|---|---|---|---|
| canonical | 82 | **83.4%** | **96.3%** | 43.5 |
| 5 | 50 | **81.5%** | **94.0%** | 57.0 |
| **11 (binds mean)** | 50 | **74.4%** (+4.4) | **94.0%** | 63.0 |
| 18 | 38 | **78.9%** | **94.7%** | 71.8 |
| 24 | 45 | **81.2%** | **95.6%** | 38.3 |

Binding margins essentially unchanged (mean +4.3 → **+4.4**, still seed 11):
**the exclusion bought this floor no headroom**, as it should not — the probes
it removed never arrived, so they were already outside this population.

**Mutation re-proved on today's park** (a transcript is a measurement):
smoother mutation takes canonical share 96.3 → **79.3%** (red) and seed 11 red
on **both** (mean 74.4 → 57.3%, share 94.0 → 42.0%). On canonical the mean
survives at +1.5 — the distribution rule is what catches it, which is why a
mean alone is not enough. `OFF_PATH_COST_MULTIPLIER = 1` still exits 1 at the
`< 8` guard ("2 of 89 … 89 arriving").

### Still red, and it is `fix/hop-penalty-detour`'s, not this branch's

`stepping off the kerb stays a step`: **183.9%** canonical and **202.4%** on
seed 24, ceiling 73%. Seeds 5, 11 and 18 pass. This is `HOP_COST_MULTIPLIER =
6.4` on `origin/main`, it was red on this branch **before** the probe fix (the
hop probes come from the path centreline, not from junctions, so the filter
cannot touch them), and it is Jim's own named failure mode.

**Measured against that branch's intended value.** With `HOP_COST_MULTIPLIER`
set to **2.6** locally (its handoff: *"the fountain floor is 2.4 and 2.6 is
green everywhere"*), reverted immediately after:

- **All five seeds go fully green**, kerb included: worst detour 12.5 / 21.3 /
  6.1 / 19.6 / 7.6% against the 73% ceiling.
- **Every paving number moves by at most 0.2 points** (mean 83.4 → 83.5, 81.5 →
  81.4, 74.4 → 74.5, 78.9 → 78.7, 81.2 → 81.3; shares identical). **The
  thresholds survive that branch unchanged.**

So `pnpm run check` cannot exit 0 here until the hop multiplier lands, and
nothing on this branch should be adjusted for it.

### Gates, 1 Sep

| gate | result |
|---|---|
| `pnpm run build` | **exit 0** |
| `pnpm run test:procgen` | **497 passed / 16 files** |
| `pnpm exec tsc --noEmit` | **exit 0** |
| `pnpm run check` | **exit 1 — `check:path-preference` only** |
| every other step of the chain | **green**, all 53 run individually |
| `check:path-preference`, seeds 5 / 11 / 18 | **all green** |
| `check:path-preference`, canonical / 24 | green **except** the kerb assertion |

The chain's 53 other steps were each run on their own and all exit 0 —
including the router-adjacent `check:waypoints`, `check:park`,
`check:nav-routes`, `check:tap-spacing` and `check:look-around`, which is what
covers the `standableNodeIn` refactor of `findRoute`'s goal test.

### The reconciliation is real, and it is ~12 hunks

Two parallel `Uint8Array`s (`paved` / `hopBand`), a `stampCircle` parameter
rename, superseded collider-stamping logic, a `pointSpliced` → `pointRigid`
rename, and — the only genuinely hard one — **this branch turned
`lineIsWalkable` into `lineCost` while #452 kept the boolean and added band
rejection to it**. Whoever merges second must fold band rejection into
`lineCost`'s `-1` shape. My resolution was for measurement only and is one
reading, not a ruling.
