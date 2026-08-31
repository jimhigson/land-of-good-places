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
