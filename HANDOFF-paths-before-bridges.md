# HANDOFF — #414, paths laid out before the bridges that get built

Branch `fix/paths-planned-before-bridges`. Jim, third report:

> "this seems like a failure of path layout to me. Are we plotting the paths
> and then choosing which to upgrade to bridges? Another path shouldn't join
> into a mid-ramp bridge"
> "there is also a path that runs into the side of the bridge — basically runs
> into a solid wall"
> "path finding needs to include bridges from the start, not as an afterthought
> to add to an existing path layout"

---

## THE DECISIVE FINDING

**`paths.ts` knows *where* the park may cross the railway. It does not know
*how much ground a bridge occupies*. So it routes other path legs straight
through the ramps.**

`paths.ts` imports `CROSSING_SITES` / `LEVEL_CROSSING_SITES` — a point, a
direction, a half-width, a proven ramp *reach*. It uses them only to pick
which site a rail-crossing leg goes through (`grep CROSSING_SITES
src/world/paths.ts`: lines 11-16, 909, 1113, 1810, 2091). **Nothing in
`paths.ts` reserves the ramp corridor**, so any other leg is free to be routed
across it, along it, or to terminate in it.

The one module that does know a bridge's real ground — `train/bridgeKeepout.ts`,
`isInBridgeFootprint()` — is asked **only by the scatter passes** (trees, lamps,
walls, benches). It cannot be asked at path-layout time by construction: it
calls `computeCrossings()`, which reads `pathCentreline()`, which is not filled
in until `Garden`'s `buildPaths()` has already drawn the network. Its own
header says so.

So the ordering is: **sites → paths drawn → crossings measured from the drawn
paths → bridge footprints → bridges built.** A bridge's footprint has never
existed at the moment the paths are laid out. That is Jim's sentence exactly.

### And it is worse than the ordering story in #392

#392's account is "on some seeds the planner proves zero bridge sites and
`planReal` builds bridges anyway". That is **real and reproduced** (table
below) — but **it is not what Jim is seeing**, because the shipping seed is not
one of those seeds:

| seed | proven bridge sites | level sites | crossings | bridges built | built on a **level** site |
|---|---|---|---|---|---|
| **canonical (20260728)** | 4 | 3 | 2 | 2 | **0** |
| 2 | 0 | 7 | 3 | 1 | 1 |
| 5 | 3 | 6 | 3 | 2 | 1 (d=130) |
| 11 | 3 | 3 | 4 | 2 | 1 (d=84) |
| 18 | 1 | 6 | 2 | 1 | 1 (d=104) |

Site counts reproduce #392's table exactly. But **canonical builds both its
bridges on properly proven sites and still shows Jim's fault.** Proving the
site is therefore *not sufficient*: a proven site says "a bridge fits here",
it does not say "keep the rest of the network off the ground it fits in".

Fixing only the opportunistic pass would have left the shipping park unchanged
— that would have been the third adjacent fix.

### Measured on canonical, entrance bridge d=172 at (-22.1, 36.2), 32.5 m from the gate

Foreign drawn runs entering that bridge's own paving extent
(`scripts/measure-bridge-path-conflicts.mts`):

- **run 7** — 14 samples, lifted to **4.40 m** above ground at (-22.2, 36.4),
  i.e. it reaches the crown. Its east end *terminates inside the footprint*.
- **run 0** — 6 samples over the north ramp foot, lift 0.06 m.

**Two faults, one cause — measured, not eyeballed.** Per drawn run at that
bridge (`covers()` or `pavingHeightAt() !== null`):

| run | samples | inside the bridge | ends inside | verdict |
|---|---|---|---|---|
| 1 | 110 | 30 | 0 | the bridge's own crossing leg — passes through, correct |
| 0 | 118 | 6 | 0 | **passes through the footprint** at the north ramp foot |
| 7 | 47 | 14 | **1** | **dead-ends on the crown** at (-22.2, 36.4), lift 4.40 m |

So run 7 is a whole separate path leg attached to the bridge's crown and
running off *sideways* down the flank — Jim's "another path shouldn't join into
a mid-ramp bridge" — and run 0 is a second leg driven straight through the ramp
ground. Neither is the bridge's own path.

`pathGraph.ts`'s `drapePathsOverBridges` lifts **every** drawn path vertex a
bridge's `pavingHeightAt` covers, not just the run the bridge was built for.
So a foreign leg crossing the footprint is *drawn climbing the ramp flank and
stopping dead at the parapet* — Jim's "runs into a solid wall". Where the leg
sits inside `covers()` but outside the paving extent it stays on the terrain
instead — Jim's "path under the ramps". **One cause, both symptoms.**

Foreign lifts on the other seeds: seed 11 bridge d=84 lifts a foreign run
**2.77 m**; seed 18 bridge d=104 lifts one **2.72 m**; seed 5 bridge d=130
lifts one **1.10 m**.

---

## Reproduction (canonical seed, dev server 5417, headless playwright)

`node scripts/qa-bridge-paths-414.mjs 5417 <out> "-15.8,20.7" "-22.1,30" "-22.1,44"`

- **`at_-30_35.png` — the money shot.** Eleri stands on flat ground on run 7;
  the sandy path she is on runs straight into the **outside face** of the
  bridge parapet and stops. No way up, no way on. Jim's "runs into a solid
  wall", from a child's eye.
- `at_-15.8_20.7.png` — the same fault at run 0's end of the bridge.
- `at_-22.1_44.png` — a second sandy surface sits *outside* the parapet at ramp
  height, going nowhere.
- Plan view: `scripts/plot-bridge-neighbourhood.mts -22.1 36.2 35 out.svg` —
  run 7 (blue) drives east into the bridge band and its endpoint dot sits
  inside it.

## Tools added on this branch

- `scripts/measure-bridge-path-conflicts.mts` — per-seed site tiers, which
  crossings got bridges, and every foreign run inside each footprint.
- `scripts/plot-bridge-neighbourhood.mts` — plan-view SVG of one bridge and
  every path around it.
- `scripts/qa-bridge-paths-414.mjs` — spawns the real player and photographs.

## Plan (NOT yet started — Overseer wants to see it first)

1. Give `paths.ts` a bridge-aware cost at layout time: every candidate site
   carries the ground its ramps will need (`SITE_RAMP_IDEAL` × `halfWidth`,
   already proven by `crossingPlanSolve`), and no leg other than the crossing
   leg may be routed into that rectangle.
2. Make the builder honest: a bridge is built only on a site the planner
   proved. Measure why `bridgeCandidateAt` proves nothing where `planReal`
   succeeds before deciding whether to relax the prover or drop the bridges.
3. Invariant in `test/procgen/invariants.ts`: no drawn path sample outside a
   bridge's own crossing run may sit under its deck or terminate in its
   masonry, thresholds from `PLAYER_RADIUS` / `TRACK_CLEARANCE`. Prove it red
   by mutation.

## Status

- [x] worktree; dev server 5417 (kill by PID only)
- [x] baseline measured, all five seeds
- [x] visual repro from a player's eye
- [x] decisive cause identified
- [ ] plan approved by Overseer
- [ ] fix, invariant, mutation transcript, per-seed counts after

---

# STEP 1 LANDED — the layout fix (commit "Paths must keep off the ground a bridge will stand on")

`pointStandsOnABridgeRamp` in `paths.ts` is the one owner of "will a bridge
stand here", built from the site's own proven `rampReachPos/Neg` and
`halfWidth` plus `bridgeFootprint.ts`'s `DECK_HALF_LENGTH` — never numbers
restated locally. Three routers ask it: lattice `nodeOk`, `nearestPointOnRoute`
(branch points), and `segmentCutsABridgeRamp`.

Result, canonical: `spur-dodgems` no longer branches at (-22.2, 36.4) on the
crown. It crosses on the deck like the gate approach. **`at_-30_35.png` before
and after: the path that ran into the parapet now runs up and over the bridge.**

Bridge counts, `origin/main` → this branch:

| seed | before | after | on proven sites | on level sites |
|---|---|---|---|---|
| canonical | 2 | **3** | 3 | 0 |
| 2 | 1 | 1 | 0 | 1 |
| 5 | 2 | **3** | 1 | 2 |
| 11 | 2 | 2 | 1 | 1 |
| 18 | 1 | **2** | 1 | 1 |

Nothing lost; three seeds gained a bridge, all on properly proven sites.
`check:park` 19/19 attractions, 262/262 waypoints, exit 0. `test:procgen` exit 0.

Stranded path ends (an end drawn >0.5 m above the terrain on a bridge):

| seed | stranded ends | under a deck |
|---|---|---|
| canonical | **0** | 0 |
| 2 | **0** | 0 |
| 5 | 3 | 0 |
| 11 | 1 | 0 |
| 18 | 2 | 0 |

**Every remaining stranded end is on a level-site bridge** — the step-2 defect.

# STEP 2 — the numbers the Overseer asked for

`scripts/measure-prover-vs-builder.mts`, via a new `explainBridgeRefusal()`
in `crossingPlanSolve.ts` that reuses the prover's own `probeReach`.

**The prover is not marginally too strict. It is nowhere near.** At every
disagreement it finds either the deck itself blocked at every width and angle,
or a ramp reach of **0.0–5.4 m against a floor of 12.1 m**:

| seed | railD | prover's verdict at the best angle |
|---|---|---|
| 2 | 82.0 | deck blocked at 9 of 10 width/angle combinations; reach 0.0/0.0 |
| 5 | 130.0 | **deck blocked at all ten** |
| 5 | 202.0 | best reach 4.9/4.9 m vs floor 12.1 |
| 11 | 84.0 | best reach 1.5/5.4 m vs floor 12.1 |
| 18 | 104.0 | deck blocked at 9 of 10; reach 0.0/0.0 |

So **relaxing the prover is not available**: the shortfall is 7–12 m of ramp,
not centimetres. Raising the gradient budget is explicitly ruled out (it made
seed 2 worse and brought back a fall-through-deck failure).

That leaves: **the builder must not build where the planner proved nothing.**
Projected counts if it does not:

| seed | now | after step 2 |
|---|---|---|
| canonical | 3 | **3** (unchanged — all proven) |
| 2 | 1 | 0 |
| 5 | 3 | 1 |
| 11 | 2 | 1 |
| 18 | 2 | 1 |

**This is a real loss on the sweep seeds and it needs the Overseer's call**,
because the family ruling is "a path crosses the railway on a bridge, never a
level crossing", and #396 says nothing yet checks a level crossing is walkable.

**The invariant cannot be added without step 2.** An honest, unconditional
"no drawn path may end stranded above the terrain on a bridge" is red on seeds
5, 11 and 18 today. Scoping it to proven-site bridges would be weakening an
assertion to make a seed pass, which CLAUDE.md forbids. So step 2 belongs in
this PR, or the PR ships without the invariant CLAUDE.md requires.

---

# THE STEP-2 MEASUREMENT — it is a fix, not a cost

`LGP_ONLY_PROVEN_BRIDGES=1` (off by default; a lever, not a decision).

## 1. Are the resulting level crossings walkable, both sides, through the crossing?

`scripts/measure-level-crossing-walkability.mts` — asks the real `NavGrid`,
built with `PLAYER_RADIUS` and `JUMP_APEX_HEIGHT` exactly as `check-park.mts`
builds it. Never infers from geometry.

**Every single crossing that loses its bridge is WALKABLE**, and the walk goes
*through* the crossing rather than round the loop — 16 m walked for a 16 m gap,
passing 0.0–1.7 m from the crossing centre, on all eleven of them:

| seed | crossings without a bridge | walkable through | not standable | unreachable |
|---|---|---|---|---|
| canonical | 0 | — | — | — |
| 2 | 3 | **3** | 0 | 0 |
| 5 | 3 | **3** | 0 | 0 |
| 11 | 3 | **3** | 0 | 0 |
| 18 | 2 | **2** | 0 | 0 |

Two measurement traps, both hit and both fixed before believing any of it:
`NavGrid` returns a *simplified* polyline (a clear straight walk comes back as
one point), and it does not include the start. Measuring vertices only reported
`Infinity` for exactly the crossings that work best. Sampling along the
segments, with the start prepended, is what these numbers come from.

## 2. Does anything get stranded? No — the opposite.

`check:park` stranded-waypoint counts. **Baseline measured on `origin/main` in
its own worktree first**: `check:park` is *already* red on all four sweep seeds
on `main`, so none of this is attributable to step 1 without that column.

| seed | `origin/main` | branch, gate off | branch, gate ON |
|---|---|---|---|
| canonical | 0 (exit 0) | 0 (exit 0) | **0 (exit 0)** |
| 2 | 3 | 3 | 3 |
| 5 | 18 | **39** | **0 — exit 0, fully clean** |
| 11 | 49 (+1 nospot) | 42 (+1 nospot) | 37 (+1 nospot) |
| 18 | 6 | 6 | **0 — exit 0, fully clean** |

**Read the seed 5 row carefully. Step 1 on its own makes seed 5 worse** —
18 stranded waypoints on `main`, 39 on this branch — because step 1 lets one
*more* opportunistic bridge get built (seed 5 goes 2→3 bridges, the new one on
a level site at d=202). With the gate on it goes to **zero**.

**So step 1 should not ship without step 2.** That is a change to what I
reported earlier and it is the most important line in this file.

Seeds 5 and 18 become the first sweep seeds to pass `check:park` outright.
Seed 11 improves 49 → 37 but keeps a pre-existing `poi.nospot` unrelated to
bridges. Seed 2 is unchanged at 3.

## Bridge counts, the honest full picture

| seed | `origin/main` | step 1 only | step 1 + step 2 |
|---|---|---|---|
| canonical | 2 | **3** | **3** (all proven — unchanged by the gate) |
| 2 | 1 | 1 | 0 |
| 5 | 2 | 3 | 1 |
| 11 | 2 | 2 | 1 |
| 18 | 1 | 2 | 1 |

Jim's own park gains a bridge and loses nothing. The sweeps trade four
opportunistic bridges for eleven walkable level crossings and two seeds that
start passing `check:park`.

## What this does to the invariant

With the gate ON, the honest unconditional assertion — *no drawn path may end
stranded above the terrain on a bridge* — should be green everywhere, because
the bridges that stranded them are not built. That is still to be confirmed and
is the next step once Jim rules.

---

# STEP 2 LANDED — and two honest reds remain. NOT ready for a PR.

`ONLY_PROVEN_BRIDGES` is on by default; `LGP_ALLOW_UNPROVEN_BRIDGES=1` reverses it.

## The invariant, proved red by mutation

`no drawn path ends in mid-air on a bridge` — unconditional, threshold
`BUILDING_STEP_UP` (0.62 m, the game's own step-up). **Green on all five seeds.**

Mutation = the reversal flag, which restores exactly the behaviour it exists to
catch. `LGP_ALLOW_UNPROVEN_BRIDGES=1 pnpm exec vitest run
test/procgen/seed-5.test.ts test/procgen/seed-18.test.ts`, exit 1:

```
FAIL seed 18 > no drawn path ends in mid-air on a bridge
  the drawn route "spur-building" ends at (3.1, 25.7) on bridge, 1.13 m above
  the ground beneath it — more than a child's own step-up of 0.62 m ...
  the drawn route "spur-ferrisWheel" ends at (3.1, 25.7) ... 1.13 m ...
FAIL seed 5 > no drawn path ends in mid-air on a bridge
  "spur-dodgems" ends at (41.1, 33.3) ... 1.14 m ...
  "spur-stall.spookyHouse" ends at (29.1, 21.3) ... 1.97 m ...
  "spur-stall.dodgems" ends at (41.1, 33.3) ... 1.14 m ...
```

Geometry it was proved against: this branch's head, gate off. Five stranded
ends across two seeds; zero with the gate on.

## `pnpm run test:procgen` — exit 1. 483 passed, 4 failed.

**These are not weakenable and I have not weakened them.**

### (a) Seed 2 builds zero bridges — 3 failures

- `nothing a bridge builds hangs into its own tunnel` — *no bridge was tested*
- `every modelled coping stone sits on the wall it caps` — *no coping was tested*
- `railway crossings are planned — station-clear, and mostly real bridges` —
  *the park has 3 railway crossing(s) and not one real bridge*

Two are anti-vacuity guards firing correctly; the third is a **design**
assertion. Seed 2's planner proves **0 bridge sites anywhere on its loop**, so
with unproven bridges refused it gets none. That is #392's real defect made
visible instead of papered over by bridges that strand waypoints.

CLAUDE.md's rule is *"never weaken an assertion to make a seed pass — swap the
seed and write down why."* **Swapping seed 2 is therefore the sanctioned move,
and it needs a decision**, because:
- the replacement must be picked for *comparable geometry* (seed 2 was chosen
  for its 36.7 m bridges — `scripts/probe-seed-bridges.mts`'s own note), and
- a bridgeless park is a real product question. The family ruling is that a
  path crosses on a bridge. A child who rolls a seed like 2 gets none.

### (b) Seed 5 — `no paved path stops anywhere but a destination`

`spur-stall.facePaint's start at 41.1, 9.3 is 3.10 m from the nearest other
paving — it branches off nothing`. **Green on `origin/main`, so this is mine.**

**Root-caused, not guessed.** `bestBranchPoint` picks the nearest point on a
route's **control polyline**; the ribbon is drawn on the swept Catmull-Rom
(`routeCurve`, tension 0.4). On a bend the two are metres apart. The ramp
screen moved this spur's junction from a straight stretch onto a bowed one, and
there the control point is 3.10 m off the drawn ribbon.

Pre-existing two-definitions fragility — CLAUDE.md's most-cited failure — that
this change lands on rather than creates.

**CORRECTION — that root cause was wrong, and the fix for it did not fix
seed 5.** `routeCurve` and its `drawnPolyline` fillet pass have been moved into
`paths.ts` (with `pathGraph.ts` re-exporting), and `nearestPointOnRoute` now
measures the **drawn curve** instead of the control polyline. That is a real
one-owner improvement and it stays — but the seed 5 failure is byte-identical
with it in: the start is still (41.1, 9.3), still 3.10 m out.

**The measured cause.** (41.12, 9.26) **is a lattice node**, `ok=true`,
**`paved=true`** — and no drawn ribbon passes within 3.10 m of it. So the spur
did not pick a bad point on a route at all: it terminated on a lattice node the
lattice *believes* is paved while nothing is drawn there. `pavedLatticeNodes`
and the drawn network disagree.

**Hypothesis for why, NOT yet proven** — stated as a hypothesis because the
previous confident root cause here was wrong: `commitStreetPlan` marks a plan's
lattice nodes paved, but `spur()` then decides `paved: !already` and may draw
no ribbon for that edge at all. A committed lattice path whose edge is never
paved would leave exactly this: nodes flagged paved with no ribbon under them,
and every later route free to terminate on one.

Whoever takes this next: prove or kill that by logging which plan first marked
node (41.12, 9.26) paved on seed 5, and whether its edge was drawn. Do not
assume it, and do not fix it before measuring it — that mistake has now been
made once on this ticket.

### Things tried and rejected, so nobody repeats them

- **Stub-leg screening instead of `nodeOk`** — did not fix seed 5 and lost
  bridges. Reverted.
- **`RAMP_SCREEN_MARGIN` 0.5 instead of 1.5** — did not fix seed 5, and cost
  the canonical seed its third bridge and seed 18 its second. Reverted to 1.5.
- **Dropping the `nodeOk` screen** — *does* fix seed 5, and costs canonical a
  bridge (3→2) and seed 18 both (2→0, adding 3 more failures). Net worse.
- **Pinning the spur's junction after `snapRunsToLattice`** — built, measured,
  changed nothing (the junction was already the reported point). Reverted
  rather than shipped as an unexercised mechanism.

## Where this leaves the PR

Not raised. `test:procgen` is red and CLAUDE.md is zero-tolerance. Needs an
Overseer decision on the seed swap, and the `routeCurve` ownership move.

---

# SEED 5 — root cause MEASURED (not hypothesised), 31 Aug

Instrumented `commitLatticePath` to log the first plan to mark node
(41.12, 9.26) paved. Result:

```
[414] node (41.12, 9.26) FIRST marked paved; path=482,510,480,479,508,478
  at commitLatticePath -> commitStreetPlan -> streetRoute
  -> gateApproachSearch -> pathGraphSearch -> buildGraph
```

Then measured that node's distance to every **drawn** ribbon on seed 5:

```
spur-building          nearest drawn point 4.50 m
spur-stall.facePaint   nearest drawn point 0.00 m
```

**The gate approach marked the node paved and does not go anywhere near it.**
The only route touching it is the facePaint spur that branched onto it — which
is why it "branches off nothing".

My earlier hypothesis (`spur()`'s `paved: !already`) was **wrong**, and so was
the one before it (control polyline vs swept curve). The actual mechanism:
`gateApproachSearch` snapshots and restores lattice state correctly, but the
winner's `commitStreetPlan` marks every node of the **lattice search path**
paved, while what is finally *drawn* is `assembleGateApproach(...)` — the
authored gate corridor plus only part of that solved route. Nodes on the
portion that is not drawn stay flagged paved with no ribbon under them, and
every later route is free to terminate on one.

**The fix belongs in the commit, not in the branch chooser**: only the nodes
whose ribbon is actually drawn may be marked paved. Not yet built — reported
first, per the standing instruction not to fix this one on a hypothesis.

# RAILWAY-GROWN-FROM-A-CROSSING (Jim's design) — assessment

- **The rail router already grows incrementally.** `rail/generate.ts` "grows a
  track by laying pieces from a vocabulary end to end, rejecting a piece that
  hits something and picking another, backing up a piece when a joint runs out
  of options" — not an all-at-once solve. Closure is analytic once the head is
  near home. So growing outward from a fixed point is its native mode.
- **`startPoses` is the outermost level of the search** (`generate.ts:176`) and
  a closed loop begins *and ends* at one. **Seeding a start pose at the chosen
  crossing point, perpendicular to the chosen path direction, makes the
  right-angle crossing true by construction** — no new constraint machinery.
- **A `satisfies` backstop already exists** (`generate.ts:268`,
  `(route) => boolean`, with `satisfyRejects` in the solve report), plus
  `RouteInfluence`, a weighted nudge that explicitly "changes which routes are
  likely, never which are possible". So there are two existing extension
  points and neither needs inventing.
- **What it costs.** `budgets.restarts = startPoses.length`; today that is 96
  rim bearings (`START_POSES`). Pinning the loop to one interior pose cuts the
  search's outermost freedom from 96 to 1. Mitigation is to offer several
  candidate crossing points, still pseudo-random. **This is the real risk and
  it is a search-budget risk, not a geometry one.**
- **Variety.** Loops currently start on the rim (`RIM_STANDOFF` 3.35) and grow
  park-circling. Starting from an interior crossing point may change loop
  character park-wide, not just locally. Jim has accepted the premise; it still
  needs measuring across ~16 seeds, and I have the harness for it
  (`scripts/measure-bridgeable-loops.mts`).
- **Ordering today**: plots (`PARK_LAYOUT`) -> rail routes -> crossing sites ->
  paths. The chosen crossing point must be picked before the rail, from the
  layout alone. That is feasible — it needs only the plots and the boundary.

## Rejection-rate measurement (done before the ruling changed; still useful)

`scripts/measure-bridgeable-loops.mts` over 16 seeds: **11 of 14 solved loops
admit at least one bridge site (79%)**; two seeds failed to solve a loop at all
under the harness. So a bridgeless loop is not rare-but-catastrophic, it is a
routine ~1-in-5 outcome — which is why constructing the crossing rather than
hoping for one is the right call.

---

# AFTER THE #431 REBASE — re-measured, and BOTH defects have moved

Rebased onto `origin/main` at `298f39c0` (#431, "Grow the railway from a proven
crossing"). Six commits conflicted; **five of the six were absorbed wholesale by
#431** and resolved to main's version — `explainBridgeRefusal`,
`provenBridgeSite` on `LevelCrossing`, and the proven-bridge gate (which main
ships as `allowUnprovenBridges()`, on by default, exactly as this branch
intended). What survives as this branch's own is `paths.ts`'s ramp screen, the
`pathGraph`→`paths` `routeCurve` move, the invariants and the probes.

`tsc --noEmit` exit 0 after the rebase.

## Defect (B) is GONE — do not go looking for it

The fence-panel cut on `connector-stall.facePaint-station-0` at (51.1, 4.4),
railGap 2.1 m, is **not present on seed 5 after the rebase**.
`probe-blocked-ribbons` reports **no fence-panel block anywhere in the seed**.
#431 moved the loop and it went with it.

## Defect (A) — still real, but 8 stranded waypoints, not 15

`LGP_SEED=5 pnpm run check:park`: `poi.stranded: 8`, at
(38.7, 38.7) (17.4, 42.2) (21.3, 41.1) (24.1, 39.9) (28.0, 38.7) (34.1, 35.4)
(35.8, 36.6) and (14.9, -44.3).

`probe-blocked-ribbons`, seed 5 (loop 329.5 m, proven bridge sites 12/56/142/308):

```
spur-dodgems:    BLOCKED at (10.6, 44.5) railD 10.1 :: wall len=2.0 halfT=0.15 top=5.3
spur-dodgems:    BLOCKED at (14.3, 43.4) railD 13.7 :: wall len=2.0 halfT=0.15 top=5.3
spur-waterFight: BLOCKED at (14.4, -42.4) railD 144.2 :: two walls, top=4.4 and 5.1
spur-waterFight: BLOCKED at (17.1, -44.6) railD 146.0 :: two walls, top=2.8 and 3.6
spur-waterFight: BLOCKED at (17.1, -40.6) railD 139.6 :: wall len=2.0 halfT=0.15 top=4.4
```

`len=2.0, halfT=0.15`, tops **climbing** 2.8/3.6/4.4/5.1/5.3 — ramp parapets, at
railD 10.1/13.7 (proven site **12**) and 139.6-146.0 (proven site **142**). The
seven-waypoint cluster lies just beyond `spur-dodgems`' cut; (14.9, -44.3) lies
beyond `spur-waterFight`'s.

The other five blocked stretches in the sweep are **not** bridges and strand
nothing: a `circle r=0.3 top=Infinity` at (5.1, 57.0) on three routes by the
gate, and building walls (`len=18.0`, `len=4.2`) at (-42.8, 3.9) and
(20.3, 21.3). Out of scope here; noted so nobody re-finds them.

## THE NAMED CAUSE IS WRONG IN ITS MECHANISM — measured

The handoff I inherited says a spur's **swept Catmull-Rom bows off** its control
polyline into the parapet. `scripts/probe-ribbons-on-ramps.mts` asks the real
screen (`pointStandsOnABridgeRamp`, imported at margin 0, never restated) about
the drawn curve and the control polyline separately:

```
gate-approach          control too  sites=[12(crosses)]   85 drawn,  4 control, stray 0.11 m
spur-dodgems           DRAWN ONLY   sites=[12(FOREIGN)]   20 drawn,  0 control, stray 0.01 m
spur-waterFight        control too  sites=[142(crosses)]  83 drawn,  5 control, stray 0.43 m
spur-stall.waterFight  control too  sites=[142(crosses)]  71 drawn,  3 control, stray 0.00 m
spur-stall.dodgems     control too  sites=[56(crosses)]   81 drawn,  4 control, stray 0.30 m
spur-stall.facePaint   DRAWN ONLY   sites=[56(FOREIGN)]   11 drawn,  0 control, stray 0.00 m
spur-exit-ferrisWheel  DRAWN ONLY   sites=[142(FOREIGN)]   4 drawn,  0 control, stray 0.00 m
```

**The bow is 0.00-0.01 m on exactly the three routes that are foreign to the
site they sit on.** A bow of a centimetre cannot carry a ribbon nine metres
across a ramp, so the swept curve is not the mechanism — that is the seventh
expired explanation on this chain, and it expired to an instrument like the
other six.

**What the numbers actually say:** the three foreign legs have **zero control
points inside the ramp rectangle** and their drawn ribbon lies on the control
polyline. So their control points *straddle* the rectangle and the straight run
between them goes through it. `segmentCutsABridgeRamp` is precisely that test
and it already exists — it is asked about lattice edges (`nodeOk`, `linkClear`)
and branch points (`nearestPointOnRoute`), and **never about a spur's own
assembled route**. Point-screening the endpoints of a segment cannot see a
segment that spans the thing.

The four routes whose control points *are* inside a ramp are the four
legitimate crossing legs, one per proven site — those must not be screened.

## Next, and not yet done

Screen a spur's assembled polyline with `segmentCutsABridgeRamp`, excluding the
site that leg legitimately crosses. Then re-measure `poi.stranded` on seed 5,
`check`, and `test:procgen` — and re-run `probe-ribbons-on-ramps` expecting the
three FOREIGN rows to go and the four crossing rows to stay.

## THE PRODUCER, NAMED — it is the STUB's long leg, not the lattice

The lattice is innocent, and that is measured, not assumed. Asking
`debugStreetLattice()` about the nodes along the offending runs:

```
node (17.1, 9.3)  ok=true   onRamp(1.5)=false
node (29.1, 9.3)  ok=false  onRamp(1.5)=true    <- correctly refused
node (41.1, 9.3)  ok=false  onRamp(1.5)=true    <- correctly refused
node (17.1, 45.3) ok=false  onRamp(1.5)=true    <- correctly refused
```

`nodeOk` and `edgeOk` do their job. So the ribbon that crosses site 56's ramp
is **not** a lattice path — it is `computeStreetStubs`' elbow leg, and the
control polyline shows it plainly:

```
spur-stall.facePaint: (5.1,21.3) (5.1,17.3) (17.1,13.3) (17.1,9.3) (45.4,9.3) (45.4,4.4) (42.9,1.9)
                                                         `-------- 28.3 m --------'
```

`(17.1, 9.3)` is the lattice node; `(45.4, 4.4)` is the doormat's 3.5 m arrival
lead; `(45.4, 9.3)` is the stub's **corner**. Two things let a 28.3 m leg
through a 7.8 m limit:

1. **`STUB_TAIL_LIMIT` is checked as `min(|dx|, |dz|)`.** For this pair that is
   `min(28.3, 4.9) = 4.9` — the *short* axis. The long leg is never measured.
2. **`legClear` omits the ramp screen.** It asks `streetSegmentClear`,
   `segmentClearOfRing` and `segmentHoldsRailSide` — the same three
   `edgeOk` asks — but **not** `segmentCutsABridgeRamp`, which `edgeOk` and
   `linkClear` both do ask.

`spur-exit-ferrisWheel`'s `(-6.9,-26.7) -> (-6.9,-37.7)` (11.0 m) is the same
stub shape. `spur-dodgems`' `(5.9,45.9) -> (38.4,36.3)` (33.9 m, diagonal) is
the **fallback** router (`LGP_DEBUG_STREETS=1` lists `dodgems` among the eleven
spurs the lattice could not serve), which does not ask the ramp screen either.

**So it is one missing clause in two sibling predicates**, not a curve, not an
ordering, not the lattice. `CROSSING_SITES` is solved at module load in
`crossingPlan.ts` and is fully populated before any of this runs — checked,
because "paths planned before bridges" made it the obvious suspect.

## THE FIX, AND THE HALF OF IT THAT HAD TO BE THROWN AWAY

The mechanism above named two unscreened producers, so the obvious change was
to give both the clause `edgeOk`/`linkClear` already carry. **Built both,
measured each separately, and one of them is badly wrong.** Seed 5
`poi.stranded`:

| variant | poi.stranded |
|---|---|
| baseline (this branch, rebased) | 8 |
| **stub screen only** (`legClear` gets `segmentCutsABridgeRamp`) | **50** |
| **fallback penalty only** (`RAMP_CUT_PENALTY_PER_METRE`) | **7** |
| both | **82** |

**Screening the stub search is not the mirror image of screening a lattice
edge, and the asymmetry is the whole point.** A refused lattice edge leaves the
lattice with other edges. A destination whose every candidate stub leg is
refused gets **no stub at all** — `streetStubs` returns empty, `planStreetToNetwork`
returns null, `streetRoute` returns null, and the entire spur drops through to
`fallbackSpurRoute`. So screening there pushed *more* routes onto the very
router that was drawing ribbons across ramps, and severed the gate approach as
well: at 82 the whole northern rim, gate corridor included, is stranded.

Reverted, and written into `RAMP_CUT_PENALTY_PER_METRE`'s own doc comment so
the next person does not rebuild it from the same sound-looking reasoning.

**What ships is the price, not the refusal**: `fallbackSpurRoute` already
scores its four best candidates and picks the cheapest, so metres-across-a-ramp
is charged at 200/m — enough that any candidate which does not cut a ramp beats
any that does. That is procgen backtracking in the idiom this router already
uses.

**8 -> 7 on seed 5.** Reported before trying anything further, per the standing
instruction.

## THE REMAINING 7 ON SEED 5, AND WHY THE PRICE CANNOT REACH THEM

All seven are one cluster on `spur-dodgems`: (17.4, 42.2) (21.3, 41.1)
(24.1, 39.9) (28.0, 38.7) (34.1, 35.4) (35.8, 36.6) (38.7, 38.7) — the paving
past site 12's parapet, still cut at (10.6, 44.5) railD 10.1 and (14.3, 43.4)
railD 13.7. The eighth, on `spur-waterFight`, is the one the price fixed.

**The dodgems has no ramp-free route on this seed, and that is measured.**
`LGP_DEBUG_STREETS=1` shows its target (38.4, 36.3) cannot reach the lattice at
all — every candidate node is refused:

```
node 29.1,21.3: side 1 != -1        node 41.1,21.3: node invalid
node 29.1,33.3: node invalid        node 41.1,45.3: node invalid
node 29.1,45.3: tail 8.9 > 7.8      node 53.1,21.3: node invalid
```

so the spur drops to `fallbackSpurRoute` — and **all four of its candidates
cross site 12's ramp**:

```
len 77.6  rampMetres 57.3
len 92.0  rampMetres 53.1
len 45.7  rampMetres 13.3   <- the winner
len 91.7  rampMetres 56.3
```

The price can only pick the least-bad, and the least-bad still draws 13.3 m of
ribbon across a parapet. This is the case `RAMP_CUT_PENALTY_PER_METRE`'s own
doc says to report rather than lower.

## `test:procgen` — MY CHANGE COSTS ONE INVARIANT. Attribution measured, not assumed.

Three runs, three commits, same command:

| tree | result |
|---|---|
| `origin/main` @ `298f39c0` (my rebase base) | **exit 0, 487 passed, 0 failed** |
| this branch **before** my paths.ts change (`e93e2b46`) | exit 1, **6 failed**, 486 passed |
| this branch **with** my change | exit 1, **7 failed**, 485 passed |

**Six of the seven are inherited** from the branch's earlier #414 work and are
not mine: seed 11 `no paved path stops anywhere but a destination`, seed 11
`no drawn path ends in mid-air on a bridge`, seed 18 `every street sits on the
shared 12 m lattice`, and seed 24's three (`nothing a bridge builds hangs into
its own tunnel`, `every modelled coping stone sits on the wall it caps`,
`railway crossings are planned — station-clear, and mostly real bridges`).

**The seventh is mine**, and it is the honest cost of the price:

```
seed 5 > no two close destinations are left with a wildly disproportionate paved detour
  'waterFight' and 'stall.waterFight' are 12.1 m apart in a straight line but
  228.8 m apart by paving (18.92x, wasting 216.7 m)
```

At 200 m per ramp-metre the router will buy a 228 m detour to avoid a parapet.
That is the trade stated plainly: **one waypoint recovered (8 -> 7 stranded) in
exchange for one invariant**, and on those numbers it is not a good trade.

**I have not tried a third variation.** Two are measured and reported: the stub
screen (worse — 50) and the flat per-metre price (7 stranded, −1 invariant). A
bounded or capped price is the obvious next thing and is deliberately left for
the Overseer to rule on, per the standing instruction.

## THIS IS A DESIGN QUESTION, AND HERE IS THE MEASUREMENT

Seed 5 puts the **dodgems at (38.4, 36.3)**, on ground whose every approach
crosses proven bridge site 12's ramp, and whose nearest lattice node misses the
stub limit by **1.1 m** (tail 8.9 against `STUB_TAIL_LIMIT` 7.8). The path
router cannot fix this by choosing better, because there is nothing better to
choose. The three places it *can* be fixed all belong to someone else:

1. **Plot placement** — do not put an attraction on ground a bridge's ramp
   seals off.
2. **The crossing planner** — do not prove a bridge at a site whose ramps
   sever an attraction's only approach.
3. **Route over the deck** — let a foreign leg join the crossing leg and cross
   *on the bridge*, which is the one legitimate way across that ground.
   `nearestPointOnRoute` currently refuses every branch point on ramp ground
   (paths.ts:5169), for the good reason that a junction in mid-air is worse.

(3) is the one that matches Jim's own framing — *"path finding needs to include
bridges from the start"* — and it is the only one that gets a child to the
dodgems on this seed. It is also a real piece of work, not a clause.

---

# WHERE THIS BRANCH ACTUALLY STANDS (end of this engineer's stint)

Rebased a second time onto `origin/main` @ `347e9454` (#415/#420 speech
bubbles landed mid-session). Clean — that commit touches no file this branch
touches. `check` chain verified by **parsing the scripts object**, not
grepping: **49 steps, `check:speech-bubbles` present**.

| gate | result |
|---|---|
| `tsc --noEmit` | **exit 0** |
| `pnpm run check` (49 steps) | **exit 0 — GREEN** |
| `pnpm run test:procgen` | **exit 1 — 7 failed, 485 passed** |
| `check:park` canonical / 2 / 11 / 18 | **0 stranded, exit 0** on all four |
| `check:park` seed 5 | **7 stranded** (was 8 before this stint, 15 in the brief) |

**`test:procgen` is the blocker and it is not close to green.** Six of the
seven failures are inherited — they were already there before this stint's
first code change, and `origin/main` at both rebase bases is exit 0 / 487
passed, so they belong to this branch's earlier #414 work and nobody has
triaged them. The seventh is this stint's, and is the honest price of
`RAMP_CUT_PENALTY_PER_METRE`.

**Note that `check` being green does not cover seed 5 at all**: `check:park`
runs the canonical seed only, and canonical is clean. The seed-5 stranding is
reached solely through `LGP_SEED=5`, so nothing in CI currently gates it. That
is worth knowing before anyone reads the green `check` as cover.

## What the next person should NOT redo

- **The swept-curve bow.** Measured at 0.00-0.01 m on the offending routes. Dead.
- **Screening `computeStreetStubs`' `legClear`.** Built, measured: seed 5
  8 -> 50 stranded. Dead, and the reason is structural (a destination with no
  clear stub gets no stub at all and falls through to the fallback router).
- **Ordering — "sites solved after the lattice".** Checked: `crossingPlan.ts`
  solves at module load, fully populated before any router runs.

## The two live questions, both for the Overseer

1. **The six inherited `test:procgen` failures have never been triaged.** They
   gate the merge and they are older than this stint. Somebody has to own them.
2. **Seed 5's dodgems is a design question, not a router bug** — measurement in
   the section above: no lattice node reachable (nearest misses `STUB_TAIL_LIMIT`
   by 1.1 m), and all four fallback candidates cross proven site 12's ramp. The
   only fix that gets a child there is letting a foreign leg cross *on the
   deck*, which is Jim's own "path finding needs to include bridges from the
   start" and is its own piece of work.

## RAMP_CUT_PENALTY_PER_METRE REVERTED — Overseer's ruling, and my own numbers agreed

Removed. It recovered one waypoint (8 -> 7) and cost seed 5's `no two close
destinations are left with a wildly disproportionate paved detour`, because at
200/m the router buys a 228.8 m detour to walk round a parapet. Seed 5 is back
to **8 stranded** and `test:procgen` back to the **6 inherited** failures.

**Both dead ends now live in `pointStandsOnABridgeRamp`'s own doc comment**, on
the function that owns the ramp rectangle and lists its three legitimate
askers — so the next person to think "why isn't this screen asked everywhere?"
reads the answer at the point of temptation rather than in a handoff.

---

# THE SIX INHERITED FAILURES — 6 down to 4

## Root cause of the first two: the screen refused the bridge's own road

The ramp screen tested the **whole footprint**, deck included. A bridge's
footprint is a road with two walls down it: `|across| <= halfWidth` is the
surface a child walks on, and only the ring out to `halfWidth + margin` is
parapet. Screening streets against the whole thing refused the crossing's own
approach.

Measured on seed 24: the footprint is **13.0 m across by 39.7 m along**, and
it invalidated four lattice nodes including the entire row at z = -33.6 —
(-12.7, -33.6), (-0.7, -33.6), (11.3, -33.6) — the east-west street running
straight through proven site 20.

`pointStandsOnBridgeMasonry` now answers the routing question (parapet only)
while `pointStandsOnABridgeRamp` keeps answering the branch-point question
(whole footprint), because *branching* in mid-air and *passing* over a bridge
are different questions. A leg along the axis never leaves the deck band; a leg
across it must exit through the parapet on both sides, so the existing
point-sampling segment test still refuses it — the direction is implied by the
geometry, with no second definition of "along" to drift.

| seed | bridges before | after |
|---|---|---|
| canonical | 2 of 4 crossings | 2 of 4 |
| 2 | 0 of 3 | 0 of 3 |
| **5** | **3 of 4** | **4 of 5** |
| 11 | 2 of 5 | 2 of 5 |
| 18 | 1 of 6 | 1 of 5 |
| 24 | 0 of 2 | 0 of 2 |

**`test:procgen` 6 failed -> 4.** Cleared: seed 11 `no paved path stops
anywhere but a destination`, seed 18 `every street sits on the shared 12 m
lattice`. Nothing lost, and seed 5 gains a bridge.

## Still open (4)

- seed 11 `no drawn path ends in mid-air on a bridge`
- seed 24 trio — **`origin/main` builds seed 24's bridge and this branch does
  not**, measured in its own worktree: on `main` the crossings are railD **20**
  (proven site, bridge built) and 220; here they are 74 and 220. The masonry
  split did not recover it, and the lattice node at the site is refused by
  `RAIL_CLAMP_DISTANCE`, not by the ramp — a lattice node may never sit on the
  rail, which is correct. The crossing leg's own site choice is the next place
  to look, not the lattice.

## THE REMAINING 4 — both root-caused, neither fixed

### Seed 11 `no drawn path ends in mid-air on a bridge` — A REAL DEFECT, and a bad one

The invariant is **this branch's own** (commit `d0a4f208`), which is why
`origin/main` is green: seed 11's geometry is **byte-identical** on both trees —
same 3 proven sites, same 2 bridges, same crown y=4.47 at (2.0, 43.0), 17.1 m
from the gate. Nothing regressed; the branch simply added the check that can
see this.

And it is not a false positive. `probe-blocked-ribbons` names the collider
independently, at the exact point the invariant complains about:

```
gate-approach: BLOCKED 0.0-1.0 m of 49.8 — at (0.0, 54.0) railD 0.0
               railGap 11.0 onPath=true :: wall len=2.0 halfT=0.15 top=1.6
```

**A child walking in through the park's entrance arch hits a bridge ramp's
parapet in her first metre.** That is worse than a stranded waypoint — it is
the front door. `check:park` reports seed 11 as **0 stranded**, because the
ground beyond is reachable by another route, so nothing else in the repo can
see this.

**Why, geometrically:** the bridge site sits at railD 2.0, (2.0, 43.0). Its
ramp runs `DECK_HALF_LENGTH + rampReach` ≈ 18.4 m from the deck centre — out to
about z = 61, while the authored arch stands at z = 54. **The arch is mid-ramp**,
so the parapet crosses the doorway.

**The fix is not to remove the bridge.** A bridge at the gate is deliberate —
`HANDOFF-bridge-at-the-front-door.md` made the entrance cross on one on
purpose, #431 ranks gate-corridor poses first to keep it that way, and the
invariant `the walk in from the gate crosses the railway ... on a bridge`
passes. What is wrong is the arch standing *on* the ramp instead of beyond it.
So the crossing planner should refuse a **bridge** site whose own proven ramp
extent swallows the entrance arch — the `CROSSING_STATION_CLEARANCE` idiom, one
constant read from both directions, and it needs no new tunable because the
extent is the site's own `DECK_HALF_LENGTH + rampReach`. `crossingPlanSolve.ts`
already knows the gate (`ENTRANCE_GATE_X/Z`, used by `serveTheGate`).

Not built: it moves sites on every seed and needs the bridge-count sweep re-run
behind it.

### Seed 24 trio — the screen starves the crossing's approach. PROVEN BY TOGGLE.

One root cause for all three (the other two are anti-vacuity guards firing
correctly). `origin/main` builds seed 24's only bridge; this branch does not.

Disabling `pointStandsOnBridgeMasonry` and changing nothing else:

```
screen ON : crossings at railD 74 (level) and 220 (level) — 0 bridges
screen OFF: crossings at railD 20 (PROVEN, bridge built) and 220 — 1 bridge
```

So it is **this branch's ramp screen**, not the planner, the loop or the sites
— seed 24's site list is identical on both trees (1 proven at railD 20, 4
level). Narrowing the screen to the masonry recovered one lattice node but not
enough: the crossing leg still cannot reach site 20 and takes level site 74.

Note the lattice node nearest the site, (-0.7, -33.6) at d=1.3, is refused by
`RAIL_CLAMP_DISTANCE` and **not** by the ramp — a lattice node may never sit on
the rail, which is correct and not the thing to change.

**This is the branch's central mechanism showing its cost**: keeping foreign
paths off a bridge's ground can also keep the bridge's own approach off it, and
where that happens the seed loses the bridge entirely. The screen and the
approach need to be reconciled — most likely by the crossing leg being exempt
from the screen along its own site's axis, the way the doc comment always said
it was ("the crossing's own chain travels ALONG the axis via its own points").
That claim is now measurably not true for the *approach* to the chain.

Not built, and reported rather than attempted, because it is the same class of
change as the seed 11 one and both want the bridge-count sweep behind them.

---

# BOTH FIXES BUILT — `test:procgen` IS GREEN, 492/492

## 1. The gateway rule, read from both directions

`isInEntranceGateway` lives in `entrance/layout.ts`, the module that owns the
gate. **Planning it alone was measurably not enough.** The planner refused a
ramp into the arch; the builder — which searches with levers the planner has
not (lateral shift, narrower deck, felled tree) — put one straight back
through. It surfaced on the **canonical seed, Jim's own park**, the moment the
paths moved: `gate-approach` ending at (0.0, 54.0), **0.70 m** up on a bridge
against a child's 0.62 m step-up. Same shape as `CROSSING_STATION_CLEARANCE`:
one owner, both directions.

No new threshold. The deck is 10 m wide and the arch 8.6 m, so **a bridge
cannot fit through the gate at any width** — this is not a clearance to tune.

## 2. `RAMP_SCREEN_MARGIN` — the doc said 0.5 and the constant said 1.5

Its own doc comment argued for half a metre and named 1.5 as the value that
broke seed 5, while the line underneath read `1.5`. **The two-definitions bug,
in the file that documents it**, and it had been there all branch.

Restored to 0.5. Not a tuning: the skirt pads a parapet **0.3 m thick**, so
1.5 m of it refuses ground a child can plainly stand on. The two lattice nodes
it cost seed 24 — (11.3, -33.6) and (11.3, -45.6) — sit at |across| 5.98 and
5.06 against a deck half-width of 5.0, i.e. **1.0 m and 0.1 m clear of the
masonry**: inside the 1.5 m skirt, outside a 0.5 m one.

## The numbers

**`test:procgen`: exit 0, 492 passed, 0 failed** — from 6 failed. All six
inherited failures clear.

**Bridge counts against `origin/main`** (measured in its own worktree, real
install), which is the honest baseline — the "seed 5 = 4" I reported earlier
was a transient of the masonry split before the margin was corrected, not
something to protect:

| seed | `origin/main` | branch |
|---|---|---|
| canonical | 2 of 4 crossings | 2 of 4 |
| 2 | 0 of 3 | 0 of 3 |
| 5 | 3 of 4 | **3 of 4** |
| 11 | 2 of 5 | **1 of 5** |
| 18 | 1 of 5 | 1 of 5 |
| 24 | 1 of 2 | **1 of 2** |

**No seed loses a bridge except seed 11, by one — and that one was standing on
the front door.** Seed 24 is restored to main's bridge.

**`check:park`:**

| seed | stranded | exit |
|---|---|---|
| canonical | 0 | **0** |
| 2 | 0 | **0** |
| 5 | **0** (was 8) | **0** |
| 11 | 0 | **0** |
| 18 | 0 | **1 — see below** |
| 24 | 0 | **0** |

**Seed 5 reaches `poi.stranded: 0`.** #436's subject resolved as a side effect
of the margin correction — I did not work on it, and its dodgems finding still
stands as the reason a *screen* could never have fixed it.

## ONE OPEN REGRESSION, and it is the gate fix's own cost

**Seed 18 `check:park`: `route.crossesRail: 4` (new).**

```
[2] the walk to stall:spaceFerrisWheel crosses the railway at (-14.1, 20.1)
    0.56 m above the rail, short of the 4.06 m a bridge deck needs
[2] the walk to train-station-1 crosses the railway at (-14.1, 20.1) ...
```

Isolated: **the gate fix causes it, not the margin** — it is still 4 with the
margin back at 1.5. Seed 18's front-door crossing is at railD 306, (4.6, 53.6),
**7.8 m from the gate**, and the gateway rule correctly refuses a bridge there,
so it falls back to a level crossing. The family ruling is that a path crosses
on a bridge, so this trades one defect for a smaller one.

**The likely right answer, NOT attempted — reported first per the standing
rule:** the planner should prefer a bridge site whose *footprint* clears the
arch rather than falling back to a level crossing at the door. That is a
ranking change in `crossingPlanSolve.ts`, not another screen, and it wants the
whole sweep re-run behind it.

Note `check:park` runs the **canonical** seed in CI, so seed 18's row is a
diagnostic, not a gate — which is itself the point below.

## THE THROUGH-LINE OF THE DAY, worth stating plainly

**`check:park` saw seed 11 as `poi.stranded: 0` while a child could not get
through the front gate.** The ground beyond the arch was reachable by another
route, so the waypoint graph was satisfied and every check in the repo stayed
green. Only an invariant that asked a different question — *does a drawn path
end in mid-air on a bridge?* — could see it, and that invariant is this
branch's own, which is exactly why `origin/main` is green and blind to it.

That is #437's argument in one sentence: **reachability is not walkability, and
a check that only asks "can this be reached at all" cannot see a wall across
the way in.**

---

# CORRECTION — THE SEED 18 "REGRESSION" IS NOT A REGRESSION. IT IS `origin/main`'s.

I reported `route.crossesRail: 4` on seed 18 as a regression caused by the gate
fix, and the Overseer put that in PR #440's body on my word. **It is wrong, and
the retraction is measured.**

`origin/main` @ `347e9454`, its own worktree, its own real install:

```
LGP_SEED=18 pnpm run check:park  ->  route.crossesRail: 4
```

And the four complaint lines are **byte-identical** to this branch's
(`diff` of the sorted complaints: no output). Nothing about it is mine.

## How I got it wrong, because the method matters more than the result

I isolated it by toggling **one** thing — margin back to 1.5, gate fix left in
— saw the 4 persist, and concluded "the gate fix, not the margin". That is a
one-sided test: it rules the margin out and says nothing whatever about the
gate. The honest test is the one I ran afterwards, toggling the gate rule off:

| margin | gateway rule | `route.crossesRail` |
|---|---|---|
| 0.5 | on | 4 |
| 1.5 | on | 4 |
| 0.5 | **off** | 4 |
| 1.5 | **off** | 4 |
| — | `origin/main` | **4** |

**Every cell is 4.** Neither change touches it.

My "seed 18 was exit 0 before the pair" came from a check:park sweep run at the
`RAMP_CUT_PENALTY_PER_METRE` state — a tree that no longer existed by the time
I compared against it. **I compared against a remembered state instead of a
measured baseline**, which is the one thing this ticket's whole history says
not to do, and it produced the tenth expired explanation on this chain — mine.

**The lesson, and it is narrower than "instrument first" because I did
instrument:** a toggle that changes one variable and leaves the other in place
can only exonerate the variable it moved. It cannot convict the one it did not.
And the baseline for "is this a regression" is always the tree, re-measured,
never the number in my notes.

## So the state of the branch is better than I reported

There is **no open regression**. Seed 18's `route.crossesRail: 4` is a
pre-existing `main` defect that this branch neither causes nor fixes, and it is
not gated by CI (`check:park` runs the canonical seed). It deserves its own
issue; it is not #414's and it should come out of #440's body.
