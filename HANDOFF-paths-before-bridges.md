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
