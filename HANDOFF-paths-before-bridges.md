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
