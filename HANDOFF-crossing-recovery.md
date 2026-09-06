# HANDOFF — crossing recovery (the converge loop)

Branch `feat/crossing-recovery`, worktree `.claude/worktrees/crossing-recovery`,
based on `origin/feat/crossing-refusal-288` (the sphere branch stack, which
already contains the **detection** half — do not rebuild it).

Contract: `docs/DESIGN-round-robin-generation.md` § "Seed 288, root-caused",
the eight numbered points under "The recovery contract"; and
`docs/BRIEF-stage4-pre-crossing-refusal.md`. Both on
`origin/design/round-robin-generation`.

---

## Status

- [x] Worktree, `pnpm install --frozen-lockfile`
- [x] Merged `origin/main` (5 commits) — the branch lacked `check:park-pool`
      and `check:swept-bus`, both of which acceptance requires
- [x] Baseline screen measured pool-wide (below)
- [ ] The converge loop
- [ ] Two deliberate red proofs
- [ ] Gates

## Merging `origin/main`: the check-chain conflict, resolved by parsing

`package.json`'s `check` chain conflicted. Resolved **deterministically from
the merge base**, not by taking a side (CLAUDE.md, and `rerere` is on):

| | steps |
|---|---|
| merge base `731f7cbe` | 60 |
| `origin/main` | 62 — adds `check:chain-coverage`, `check:seed-coverage` |
| ours (sphere branch) | 61 — adds `check:arrival-camera` |
| **resolved** | **63** |

**Neither side removed a step.** Verified by parsing the `scripts` object (never
grep — `check:park` is a prefix of `check:park-pool`): every step of base, of
main, and of ours is present in the resolution.

## Baseline — the pool-wide screen before any change

`scripts/probe-crossing-screen.mts`, one process per seed, all sixteen. This
reproduces the design doc's numbers exactly, which is what makes it a baseline
rather than a claim:

```
[1337] 23 routes, 1431 samples, 0 fouls      [225] 24 routes, 1555 samples, 0
[5]    24 routes, 1287 samples, 0            [267] 21 routes, 1252 samples, 1  <-- FOUL
[11]   24 routes, 1455 samples, 0            [274] 22 routes, 1282 samples, 0
[24]   23 routes, 1224 samples, 0            [288] 25 routes, 1342 samples, 1  <-- FOUL
[115]  22 routes, 1179 samples, 0            [326] 26 routes, 1238 samples, 0
[128]  28 routes, 1304 samples, 0            [346] 26 routes, 1434 samples, 0
[131]  25 routes, 1381 samples, 0            [428] 22 routes, 1172 samples, 0
[208]  26 routes, 1323 samples, 0            [451] 24 routes, 1574 samples, 0
```

```
seed 267: FOUL railD 213.4 at (36.9, 6.5) — no proven bridge site within SITE_SNAP_TOLERANCE
          drawn by route "spur-station-0" (#15, width 2.6, 4 control points, (32.8, 4.5) -> (37.0, 9.5))
seed 288: FOUL railD 35.1 at (-36.2, 2.8) — no proven bridge site within SITE_SNAP_TOLERANCE
          drawn by route "spur-station-1" (#17, width 2.6, 5 control points, (-22.6, 2.8) -> (-37.5, 0.1))
```

**267's producer is now attributed** (the design doc left it open):
`spur-station-0` — the *same* station-approach class as 288's `spur-station-1`.
Both fouls are the appendage producer; no second producer class is involved.

Sample counts are the instrument, not decoration: a change that leaves them
identical has moved no geometry (this is how the first one-producer fix was
caught as a no-op — 1342 before, 1342 after).

---

## Findings that shape the build

### 1. `buildGraph()` is NOT idempotent — but the rollback already exists

`paths.ts` keeps four **process-lifetime accumulators** that `pathGraphSearch()`
does not clear on entry:

| line | binding |
|---|---|
| 1680 | `pavedLatticeNodes` |
| 1681 | `pavedLatticeEdges` |
| 1682 | `usedTaps` |
| 2819 | `tapRimsDrawn` |

They are *read* as routing inputs (a paving discount in `latticeSearch` at 2640;
cost-0 nodes in `planStreetToNetwork` at 2789/2806; `ensureCompassTaps` skipping
already-used taps at 3355-3357), so **a second `buildGraph()` in one process
returns a different graph from the first**. Invisible until now because
`pathGraph.ts:49` builds exactly once.

The converge loop re-solves paths, so it must handle this. It does **not** need
a new mechanism: `latticeStateSnapshot()` (1701) / `restoreLatticeState()` (1710)
already exist for candidate rollback and cover exactly those four sets.

**Also site-dependent and must be cleared between iterations**, because
`streetLatticeSearch` registers `CROSSING_SITES` as lattice edges/taps
(`paths.ts:2330`): `latticeCache` (2061) and `streetStubsCache` (2482). Clearing
*all* the module caches is the chosen approach rather than a hand-maintained
list of which ones depend on sites — that list would be a second definition
kept in step by hand.

### 2. Where the loop lives, and the import cycle that decides it

There is an existing cycle: `crossingPlanSolve → bridgeFootprint → crossings →
pathGraph → paths → crossingPlan → crossingPlanSolve`. It is why
`crossingPredicate.ts` was split out in the first place (its own header says so).

So the loop **must not** add `paths.ts → crossingPlanSolve`. Chosen wiring, which
adds no new import edge of consequence:

- **`sampleCurve` + `drawnSamplesFor` move from `pathGraph.ts` into `paths.ts`**,
  beside `routeCurve` / `pathDivisions` / `curvePoints`, which is where CLAUDE.md
  says sampling's one owner lives. `pathGraph.ts` imports them back.
- **A new `pathGraphConverge.ts` owns the loop.** It imports `paths.ts`
  (`pathGraphSearch`, `drawnSamplesFor`, the cache reset), `crossingPlan.ts` (the
  re-solve + publish), `crossingPredicate.ts` (the screen). It must be its own
  module, not `pathGraph.ts`, because **`boot/parkGeneration.ts` deliberately
  never imports `pathGraph.ts` early** — it drives `paths.pathGraphSearch()` and
  posts to `pathsPrewarm`, and importing `pathGraph.ts` would evaluate
  `PATH_GRAPH` in the frame the slicing exists to avoid.
- `crossingPlan.ts` exposes the re-solve, so the loop never imports
  `crossingPlanSolve` directly.

### 3. Both fouling producers are the same one

267 `spur-station-0` and 288 `spur-station-1` are both the station-approach
appendage (`paths.ts:4046-4141`). The contract's rung ladder does not depend on
this, but it means the **second rung** (re-route) has exactly one producer to
expose a decision on, and `planStreetToNetwork(approach)` is already that
decision — it is what the existing detection commit reaches for.

---

## What must not change

`cruiserLowPoints()`'s 5.9 m; `SITE_SNAP_TOLERANCE` (8); `TOUCH_DISTANCE` (3.2);
`SITE_SPACING` (24). Seed 288 stays in the pool. No new warp field.
**Empty demands must reproduce today's site list exactly** — that is the
byte-identity proof, and fourteen seeds owe it.

## Deviation from the brief, to report

`scripts/park-digest-sweep.sh` (named in the brief as the byte-identity
instrument) **does not exist** on this branch, on `origin/main`, or anywhere in
the repo. The nearest existing instruments are `scripts/scatter-digest.mts` and
`check:park-pool`. Byte-identity will be proved by a per-seed digest built on
what exists; the missing script is reported rather than worked around silently.

## Gates (all read unpiped, exit codes captured)

`check`, `test:procgen`, `check:coplanar`, `check:swept-bus`, `check:park-pool`,
`build`. The last three are **standalone, not in the `check` chain** — a
three-gate green without `check:park-pool` is meaningless here (#579).

---

# THE FINDING (6 Sep): the two seeds are not the same case, and one of them
# is not the router's to fix

Rung one — a site on demand at the drawn `d` — **fails on both seeds**. Neither
foul distance can carry a bridge:

```
seed 288, railD 35.1 (-36.2, 2.8): DECK BLOCKED at every width (5.0, 4.0)
                                   and every angle (0, +/-30, +/-45)
seed 267, railD 213.4 (36.9, 6.5): DECK BLOCKED, ditto
```

## Why: the loop doubles back on itself and a station stand lands in the pinch

`scripts/probe-station-pockets.mts`. Each station's stand, the region it stands
in, and which proven crossing-site feet open into that region (`CLEAR=0.9`, a
body width — see the script's header for why the routing clearance is the wrong
question and how the controls caught it):

```
seed 1337  station #1 (-67.3,  5.3): SEALED POCKET 13023 cells; feet: site railD 0 foot+
seed  288  station #0 (-22.0,-21.6): connected to centre;       feet: site railD 92 foot-
seed  288  station #1 (-37.5,  0.1): SEALED POCKET  9177 cells; feet: NONE
seed  267  station #0 ( 37.0,  9.5): SEALED POCKET  4982 cells; feet: site railD 6 foot+,
                                                                      site railD 200 foot+
seed  267  station #1 ( 23.9, 27.5): connected to centre;       feet: site railD 6 foot-
```

**A sealed pocket is not itself a fault** — seed 1337 builds fine and has one.
It is what a bridge is for. The fault is a pocket with **no site foot in it**.

The stands sit in a pinch where the loop runs alongside itself:

```
seed 288 station #1 stand (-37.5, 0.1): 1.9 m from rail at railD 37.6
                                        2.2 m from rail at railD 207.2 (its own platform)
seed 267 station #0 stand ( 37.0, 9.5): 1.0 m from rail at railD 216.3
                                        2.2 m from rail at railD 128.4 (its own platform)
```

Two passes of one loop, ~4 m apart, with the stand between them. A deck needs
`2 * halfWidth` = 8–10 m. Nothing fits.

## And the two seeds diverge here

`scripts/probe-provable-crossings.mts` — every metre of the loop where a bridge
*could* stand, not merely where the solver picked one:

```
seed 288 (loop 282.0 m): 0-4  86-94  96  98-99  101-102  105  243-248  250-251  254  276  279  281-282
seed 267 (loop 275.6 m): 0-12  157  192-194  196-201  270-275
```

- **Seed 267 is recoverable.** Its pocket has two site feet in it already
  (railD 6 and railD 200). No new site is needed — the router simply never used
  one: it hung the approach/stand tail off a lead on the wrong side instead of
  routing through the bridge that was there. **That is rung two, exactly as the
  contract specifies it**, and it is the work to do.
- **Seed 288 is not recoverable by any rung.** Its pocket is bounded by the loop
  at railD 24–51 and 194–220. Cross-reference the provable runs above: **neither
  range contains a single metre where a bridge fits.** No demand can be served,
  no re-route has anywhere to route to, and no amount of router effort changes
  it. The stand is in a place the park cannot legally reach.

## What this means for the contract

The contract's rung ladder is sound and I am building it. But **its premise —
that a foul is a router decision the router can take differently — does not hold
on 288.** The recovery loop is being asked to fix a decision made three
generators upstream: `train/plan.ts` put a station platform on a stretch of loop
running 4 m from another stretch, and the resulting stand is in a pocket the
park cannot serve.

Contract point 2 ("ask at the drawn `d`") is also subtly wrong in this case, and
worth stating: the drawn `d` is the *worst* place to ask, because the path
crossed there precisely for want of a legal option, not because anything about
that spot was good. Marching outward finds the nearest provable crossing at
**−31 m** (288) and **−12 m** (267) — and both are the sites already published.

**Candidate cures for 288, for the Architect to rule on — I have not taken any
of them:**

1. **Station placement backtracks** (CLAUDE.md's standing procgen rule applied
   at the level the decision is actually made): a stand that lands in a pocket
   no proven site serves is a bad placement, and `train/plan.ts` picks another.
   *Ordering problem*: station placement runs **before** the sites are solved
   (`crossingPlanSolve` reads `TRAIN_PLAN`), so it cannot ask this question
   without a cycle — it would need the same demand/converge treatment one level
   up.
2. **The loop must not pinch.** A park railway running 4 m from itself is the
   root oddity, and it is a consequence of #511's sphere shrinking
   `cruiserLowPoints()`'s qualifying corridor. That is #511's own to fix.
3. **A warp vector** (`parkWarp.ts`) for 288 — the sanctioned cure the design
   doc already names for an unbuildable loop. Not a new warp *field* adding a
   site, which is forbidden; the existing layout-warp mechanism.

Dropping 288 is forbidden and I am not proposing it. Note the loop already
**fails by name at the point of decision** on this seed, with coordinates and
the producer, instead of throwing out of scenery planting — which is the
improvement point 1 of the design was after, and it stands whichever cure wins.
