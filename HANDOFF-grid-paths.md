# HANDOFF — grid-first path network (the path rework Jim actually asked for)

## READ THIS BEFORE MEASURING ANYTHING (3 Sep)

**The grid invariants measure the DRAWN CURVE, not the control polyline.**
`pathsRunOnGridAxes` and `noPathEndsNowhere` walk `PathEdgeFact.points`, which
is the real Catmull-Rom curve `paths.ts` sweeps, **sampled every ~0.5 m** — its
own doc comment says so and gives the reason (control points are axis-aligned;
the curve bows rounding each corner). `scripts/tmp-poly.mts` prints **control**
points, and every hand-computation anybody on this branch has done from that
output — mine included, more than once — used the wrong model. If you are about
to reason about whether a run trips an invariant, sample the drawn curve.

**`pathsRunOnGridAxes` has no exemption of any kind.** `DOOR_APPROACH_REACH`
(15) belongs to `streetsShareLatticeLines`. I read it in the wrong doc comment
and built a suspicion on it; do not repeat that.

**Current failure list, and one of them is not mine to fix:**

| seed | invariant | owner |
|---|---|---|
| 5, 11, 128 | `streetsShareLatticeLines` | this branch |
| 288 | `noPathEndsNowhere` | this branch |
| 267 | `detourRatiosStayReasonable` | this branch |

**Seed 225's `pathsRunOnGridAxes` is NOT in that list** — `drawsAsScreened`
fixed it this leg. It reappeared only under the reverted both-prices
experiment, and the carrier-relative defect behind it (the check's unit is the
route object, not the painted ground; 225 fails by 0.2 m against a 16 m
threshold) is **being fixed by another agent off `main`**. Do not chase it, do
not price or refuse anything for it, and if it evaporates that is their result,
not this branch's.


Branch `feat/grid-paths`, stacked on `feat/park-warp-solver` (#474).
Worktree `.claude/worktrees/park-warp/.claude/worktrees/grid-paths`.
**pnpm**, not npm. Dev port 5611 if needed.

## Jim's brief, verbatim (2 Sep, direct — THE authority; re-read, do not paraphrase)

1. "the player can stand in 'path mess' near the first bridge on the main
   branch" (screenshot: apron knot of overlapping ribbon at the bridge foot).
2. "paths get plotted, then bridges added, but I fundamentally think this
   is the wrong approach ... it souldn't be make paths and then put bridges
   on after the fact, these need to be consdiered together from the start."
3. "they should be on an aproximate grid layout but they end up with twists
   and mini-turns etc that make no sense visually."
4. "the paths don't go up to the door of the hotel or up to the castle
   door, or other attractions reliably."
5. END GOAL: "a park that makes paths that actually go to useful places,
   zero level crossings (the ability to create LC should not even exist)
   and that looks good with things roughly evenly spaced around."
6. "A big-bang rewrite is fine if it fixes the many issues with path
   plotting we currently have."
7. After #474 preview: "I don't understand how this fixes the issues I
   reported ... The path still doesn't go up to the hotel for example."
   → the path rework must include EVERYTHING above; do not stop until
   everything he asked for is ready.

Zero-LC is done (parent branch). THIS branch owes 1, 3, 4 and the rest of 2.

## What is built (Stage 1 — done, pushed)

`src/world/paths.ts` no longer plots anything in continuous space. The
street-lattice/stubs/spurs/`fallbackSpurRoute`/`routeLeg` stack is **deleted**
(with it: `sameSideLeg`, `doubleCrossingLeg`, `fenceFollowRoute`,
`enforceRailSide`, `manhattanRoute`, `clampPoint`, `polylineCrossesRail`,
`longestOffAxisRun`, `bestBranchPoint`, `nearestPointOnRoute`,
`distanceToRouteNetwork`, `planStreet*`, `snapRunsToLattice`,
`carriesAnOffLatticeStreetRun`, `streetRoute`, `debugStreetSegment`). All 11
required exports are intact; `debugStreetLattice` and `pointStandsOnABridgeRamp`
are kept (the latter's "two measured dead ends" comment is updated in place, not
lost — this ticket IS the "own ticket" it names).

**One graph** (`pathGridSearch`, a generator drained by `pathGrid()`):

- the existing 12 m lattice (`STREET_PITCH`, unchanged), nodes at intersections
  inside the boundary, minus plots, rail corridor, ring interior, bridge masonry;
- **jog links**: where a straight run between adjacent nodes is blocked, a
  three-segment step round it through half-pitch offsets;
- **mandatory nodes**: the four ring gateways, EVERY bridge foot (`crossingFeet`
  over `CROSSING_SITES`), EVERY destination's door;
- **mandatory edges**: each bridge's foot→deck→foot polyline — the only edge in
  the graph that crosses the railway;
- **terminal connectors** per door (`gridConnectors`), straight or elbowed via
  the node's own street line, preferring a head-on arrival along the doormat's
  outward ray.

Selection: `routeFromNetwork(goal)` = Dijkstra from everything already paved to
the door node; the ring is paved from the outset. `ensureCompassTaps` and
`addInterconnects` are grid-routed. `gateApproachSearch` keeps the authored
corridor + retrace scoring but its only solver is the grid.

Rescue path for a district the shared grid cannot reach: get onto the door's own
rail side on the shared grid (over a bridge), then `relayPolyline` — an
axis-aligned walk over the grid's lines and the endpoints' own rows/columns, at
**half pitch**, screened with the door's arrival exemption. It carries the rail
side screen, so it cannot cross the railway anywhere but a bridge. Backtracks
over 6 bridgeheads × 2 plot clearances (2.6, 2.2).

`strandedDoorsOfLastSolve()` publishes any door that still fell to the
straight-line last resort.

### Findings worth keeping

- Making the **arrival lead** the grid node loses doors outright (seed 131's
  hotel: clean 7.1 m run to the door, no route at all to the point 3.5 m in
  front of it). The door is the node; head-on is a preference in the connector.
- A plot the door stands **inside** must be exempt outright — the slide's chute
  lands inside the castle's plot; `exit-ginormousSlide` had no grid route on 5
  of 16 seeds because of it.
- **Forbidding** a route to pass through a door node cuts the park up: a door's
  own 2-3 connectors can be the only join between lattice islands (seed 5's ring
  could reach 28 nodes). Priced at `DOOR_THROUGH_PENALTY` instead.
- The goal must be excluded from its own search's sources, or a door another
  route already paved through gets a one-point route and `CatmullRomCurve3`
  throws (seeds 5, 11 crashed the park build).
- An arriving leg keeps 2.0 m from the boundary, not a crossroads' 2.6 —
  seeds 225/267 put the rail-race exit 2.38/2.31 m in from the spline.

## State — 2 Sep, successor leg (gate corridor fixed; the big lead is measured)

`check:park`, all sixteen pool seeds, baseline -> after
`gate corridor: a ramp reaches it on seeds where the railway never does`:

| seed | before | after | |
|---|---|---|---|
| canonical | 4 | 4 | |
| 5 | 10 | 10 | |
| 11 | 22 | 22 | + `poi.nospot: 2` |
| 24 | 3 | 3 | |
| 115 | 1 | **0** | **now green** |
| 128 | 0 | 0 | green |
| 131 | 6 | **0** | **now green** |
| 208 | 0 | 0 | green |
| 225 | 2 | 2 | |
| 267 | — | — | fails on `poi.nospot: 1`, not `poi.stranded` |
| 274 | 0 | 0 | green |
| 288 | 1 | 1 | |
| 326 | 1 | 1 | |
| 346 | 0 | 0 | green |
| 428 | 0 | 0 | green |
| 451 | 30 | 30 | |

**5 green -> 7 green. No seed regressed.** Kept.

Note the counts are all far below the numbers in the older table further
down this file — those pre-date the exact parapet screen.

### THE LEAD: the parapet screen has never overlapped the parapet

Measured (`scripts/tmp-sitedrift.mts`, which carries its own control), on the
ramp at 0.35 and 0.7 of its reach:

| seed | site | `site.halfWidth` | screen forbids | walkable | solid |
|---|---|---|---|---|---|
| 131 | 224 | 5.00 | [5.00, 5.50] | ±1.10 | ±2.70 |
| 451 | 0 | 4.00 | [4.00, 4.50] | ±1.30 | ±2.90 |
| 451 | 38 | 5.00 | [5.00, 5.50] | ±1.30 | ±2.90 |
| 24 | 20 | 5.00 | [5.00, 5.50] | ±1.10 | ±2.70 |

`segmentCutsABridgeRamp` forbids `|across|` in
`[site.halfWidth, +RAMP_SCREEN_MARGIN]` and `pointStandsOnBridgeMasonry`
declares everything inside `site.halfWidth` to be "road, not wall". **On every
site measured the screened band sits 1.1–2.3 m OUTSIDE the outermost solid
ground, and the real masonry — `|across|` 1.1 to 2.7 — is inside what the
screen calls road, so it is not screened at all.**

The arithmetic closes exactly: walkable is the footprint's `walkHalf`;
`roadHalf = walkHalf + PLAYER_RADIUS`; `halfAcross = roadHalf +
BRIDGE_WALL_THICKNESS` (0.3); a 0.7 m clearance probe stops at
`halfAcross + 0.7`. Seed 131: 1.10 + 0.5 + 0.3 + 0.7 = 2.60 against 2.70
measured.

**Cause.** `site.halfWidth` is the *planner's reservation*
(`SITE_HALF_WIDTH = 5`). The bridge is built as wide as the path that crosses
it and no wider (Jim, 2026-08-23), along the *drawn path's own curved spine*
(`bridgeSpine.ts`), with a lateral `shift`. `paths.ts` screens the reservation
and never learns the built width. This is precisely the "two definitions of
one thing" drift that `segmentCutsABridgeRamp`'s own doc comment predicted:
*"If the layout's idea of a bridge's footprint and the builder's ever drift
apart, issue #414 comes straight back wearing different clothes."*

It is also Jim's brief #2 exactly — the bridge's real shape is decided *after*
the paths, from the paths, so no path can be screened against it.

**This is a fifth hypothesis, but it is measured, not proposed**, and it is
none of the four refuted ones.

### The design this points at — BUILT AND KEPT (numbers below)

`paths.ts` cannot ask for the built footprint: it does not exist until the
paths do. The rule that *is* expressible before drawing is the one Stage 2
already owes as an invariant, which is a strong hint it is the right rule:

> **The whole reserved footprint is forbidden to every leg except the bridge's
> own deck edge and its two feet.**

i.e. in `segmentCutsABridgeRamp`, `inner` goes from `site.halfWidth` to `0`.
Then whatever narrow bridge is later built inside the reservation cannot meet
another ribbon, because there are none in there. This is a *strengthening*;
it does not loosen the exact segment-rectangle test, which stays exact.

**BUILT AND MEASURED, 2 Sep — do not re-run as written.** `inner = 0` alone,
nothing else changed, `tsc --noEmit` exit 0. Sixteen seeds, against the
gate-fix baseline in the table above:

| seed | before | after | |
|---|---|---|---|
| canonical | 4 | 4 | |
| 5 | 10 | **13** | **+ `route.unreachable: 5`** — a new, worse failure class |
| 11 | 22 | **2** | the big win |
| 24 | 3 | 3 | kept its bridge — #414's cost did NOT recur here |
| 115 | 0 | 0 | green |
| 128 | 0 | 0 | green |
| 131 | 0 | 0 | green |
| 208 | 0 | 0 | green |
| 225 | 2 | 2 | |
| 267 | (nospot 1) | **5** | regressed into `poi.stranded` |
| 274 | 0 | 0 | green |
| 288 | 1 | **3** | regressed |
| 326 | 1 | 1 | |
| 346 | 0 | 0 | green |
| 428 | 0 | 0 | green |
| 451 | 30 | 30 | untouched — 451's pocket is NOT the masonry |

Green stays **7 -> 7**; total stranded 73 -> 63. **Reverted**, because seed 5
gains `route.unreachable: 5` — five destinations a child cannot walk to at
all, which is worse than any number of stranded waypoints.

**This is not a refutation, it is a half-built fix.** Seed 11's 22 -> 2
confirms the diagnosis exactly: those waypoints were being cut by masonry the
old band never screened. What is missing is the one part named below, the
approach exemption. Add it and re-measure before concluding anything; seed 24
keeping its bridge says #414's cost is not automatic in the grid architecture.

Note also: seed 451's 30 did not move at all, so **451's pocket has a
different cause** and should be chased separately with `tmp-pocket.mts`.

### BUILT AND KEPT: the approach exemption, as the last rung of a ladder

Two commits, `bridge screen: forbid the whole reservation, exempt the
crossing's own approach` and `bridge screen: screen a foot first, exempt its
own site only as backtrack`. `tsc --noEmit` exit 0 on both.

The exemption is **by identity, not by geometry** — the `CrossingSite` is
threaded through `gridConnectors` (and into its memo key) to
`segmentCutsABridgeRamp`, which skips that one site. A radius round the foot
would have been a second definition of "near this bridge" able to drift from
the rectangle itself.

**The ordering is the whole trick, and it was measured twice.** Handing a foot
its exemption up front is wrong: a foot that *can* reach the grid on clear
ground then reaches it back *through* the reservation instead, over the
masonry, because connectors are cost-sorted and the way through is shorter
than the way round. Measured — seed 11 went from 2 back to 22 and seed 208
from 0 to 3. So the exemption is the last rung:

```
joinToGrid(node, foot, false)                    // screened, like anything else
joinToGrid(node, foot, false, 1)                 // wider shells, still screened
joinToGrid(node, foot, false, 0, null, site)     // only now, its own site exempt
```

It can now only fire for a foot with no other way onto the grid at all —
exactly the case #414 recorded when seed 24 lost its bridge.

**Sixteen-seed `check:park`, gate-corridor baseline -> here:**

| seed | before | after | |
|---|---|---|---|
| canonical | 4 | 4 | |
| 5 | 10 | 10 | `route.unreachable: 5` **cured** by the exemption |
| 11 | 22 | 22 | |
| 24 | 3 | 3 | kept its bridge throughout |
| 115 | 0 | 0 | green |
| 128 | 0 | 0 | green |
| 131 | 0 | 0 | green |
| 208 | 0 | 0 | green — the ladder recovered it |
| 225 | 2 | 2 | |
| 267 | (nospot 1) | **0** | **now green** |
| 274 | 0 | 0 | green |
| 288 | 1 | **3** | **the one regression** |
| 326 | 1 | 1 | |
| 346 | 0 | 0 | green |
| 428 | 0 | 0 | green |
| 451 | 30 | **0** | **now green** — the largest single win of the rework |

**7 green -> 9 green; total stranded 73 -> 45.** Kept.

Cumulative for this leg: **5 green -> 9 green**, and Jim's report #1 (the
apron knot at the first bridge) has a named, measured cause and a fix.

**The one debt: seed 288 went 1 -> 3 and must not be left.** It is the only
seed anywhere in this leg that is worse than it started. Chase it with
`tmp-pocket.mts` before the invariants.

### What the remaining 45 stranded waypoints actually are (measured)

`scripts/tmp-pocket.mts` on 288 and 11. **They are three different causes, and
none of them is the one seed 131 had.** Do not treat the remaining count as one
defect.

**(a) A lone door nobody paved to — `nbrs=0`.** Seed 288 `(-26.6, -65.0)`, zero
neighbours, 22.32 m to the nearest reachable node. That is
`stall.railRacer`'s doormat, and `tmp-doors.mts` names `stall.railRacer` as one
of only three doors that fail outright on any seed. Seed 11 has two more of the
same shape: `(-11.1, -47.4)` and `(66.1, -21.6)`, both `nbrs=0`, both 26 m from
anything. **This is the starved-door tail the brief was originally aimed at**,
and it is now small: three doors across sixteen seeds (115 and 225 having gone
green).

**(b) An island district.** Seed 11's other **19** stranded waypoints are one
richly-connected cluster around x −30..−42, z −19..+9 — `spur-hotel`'s far end
(at 217..231), `spur-stall.skyCruiser` (at 79..150) and
`connector-hotel-stall.skyCruiser` (at 15..44). They have 6–11 neighbours each,
all naming each other, and the nearest *reachable* node is **14.3–24.0 m away
in every single case**. So the hotel/skyCruiser quarter is paved, internally
walkable, and joined to the rest of the park by nothing at all. Note
`spur-hotel` is reachable at at=0..94 (it climbs a bridge, `onRamp=true`,
h up to 4.63) and unreachable by at=217 — so the break is somewhere in
at 94..217, which is where to look first.

**(c) Two near-misses.** Seed 288's other two, `(-32.5, -23.6)` and
`(-34.5, -16.5)`, have `nbrs=1` and sit 9.6–10.0 m from a reachable
`spur-station-0` sample — just past `MAX_EDGE` (13 m) with something in the
chord.

**CORRECTION, measured after the above: (a) and (b) are ONE defect, not two.**
`scripts/tmp-lonely.mts` (its own control) on 288 and 11: every `nbrs=0`
waypoint is a **doormat** — 1.69, 2.20 and 1.45 m from an anchor entrance —
whose **nearest drawn paving is 20.43, 25.07 and 24.85 m away**. The control
rows sit 2.00–8.10 m from paving, so the column discriminates.

Then the tell. On seed 11 `debugRelaxedDoors()` is `[]` — *every door got a
connector* — while `debugGridReach()` reports `building`, `hotel`, `ballPit`,
`dodgems`, `waterFight`, `stall.railRacer` as **both `unreachable` and
`noSearch`**, and `strandedDoorsOfLastSolve()` names five doors that fell to
the straight-line last resort: `building`, `ballPit`, `stall.railRacer`,
`exit-railRace`, `exit-ginormousSlide`.

Those are two different questions and only one of them was being asked:

- `relaxedDoors` — *did this door reach the grid?* Yes, all of them.
- `strandedDoorsOfLastSolve` — *did a route get drawn to it from the paved
  network?* No, for five.

**A door can have a perfectly good connector to a grid node that is itself in
a component the ring cannot reach.** So the lone doormats are not a
starved-door tail at all: they are casualties of the island in (b), and the
island is the whole defect. `tmp-doors.mts`'s verdicts — the measurement the
brief was built on — cannot see this, because a door dying this way never
appears in them. That is why five seeds looked door-clean and were not.

**The defect to fix is therefore: `pathGrid`'s lattice has disconnected
components, and `routeFromNetwork` answers a failure by drawing a straight
line instead of backtracking.** A ribbon nobody can walk to is exactly the
"shrink to a floor and accept a result that still doesn't clear" CLAUDE.md's
standing procgen rule forbids. The last resort should backtrack — or the
component should be joined — never draw.

**Seed 288's 1 -> 3 regression is (a) plus (c)**, so it is not a new class:
the reservation is forbidden ground now, and a spur that used to reach through
it no longer does. Fixing (a) is likely to fix the regression too — do that
before reaching for anything else.

### Seed 11's island: located to two dropped samples, and it is NOT the bridge

`spur-hotel`'s whole lane, printed by `tmp-pocket.mts`. It **crosses the
bridge perfectly** — at 51..116 are all `ok`, `onRamp=true`, h climbing
0.06 -> 4.63 and back down — so the bridge is exonerated. Every sample from
at=0 to at=195 is reachable. Then:

```
  ok at=195.0 (-44.4,22.6) nbrs=4
  XX at=217.0 (-42.2, 8.5) nbrs=6
```

**at≈202 and at≈209 do not exist as nodes at all.** The lane steps by ~7
everywhere else; here it jumps 195 -> 217. `poiGraph`'s `findClearSpot`
drops a seed it cannot place clear of geometry, and the two it dropped leave
a hole of `hypot(2.2, 14.1) = 14.27 m` — **wider than `MAX_EDGE` (13)**, so
the `dx*dx + dz*dz > MAX_EDGE*MAX_EDGE` guard rejects the pair before either
the chord test or `laneIsClear` is ever consulted. Everything past the hole is
orphaned: the 19-node island.

**So the defect is that `spur-hotel` is drawn through something solid at
roughly (-43, 15).** The paving is there and a child cannot walk it. That is
the same disease as the parapet crossings this leg already fixed, in a
different organ — a ribbon drawn over ground the router never asked the real
collision world about.

**MEASURED. `scripts/tmp-transect.mts -44.4 22.6 -42.2 8.5`:** from d=1.97 to
d=12.30 the ground is **continuously BLOCKED with `onPath=Y` at every
sample** — 10.3 m of ribbon over solid ground, peak push 0.81 m at
(-42.81, 12.39). Clear either side. So the paving really is drawn through
something a child cannot pass.

**Which router, and the root cause.** `spur-hotel`'s control polyline:

```
(-5.7,6.9) (-14.8,6.9) (-14.8,21.2) (-15.8,21.2) (-20.8,36.6) (-21.7,39.6)
(-22.7,42.7) (-27.6,58.1) (-38.8,54.9) (-38.8,42.9) (-42.2,42.9)
(-42.2,3.2) (-42.5,3.0)
```

`(-42.2, 42.9) -> (-42.2, 3.2)` is **one straight segment 39.7 m long on
x = -42.2**, and it is what runs through the blockage. Beside it,
`spur-stall.skyCruiser` carries `(-43.0, 30.9) -> (-43.0, 6.9)`, a 24 m run on
x = -43.0 — **two long parallel private lines 0.8 m apart**, neither on the
12 m lattice. The hotel's door is at (-42.2, 3.2), so x = -42.2 is *the door's
own column*: this is `relayPolyline`, which walks "the grid's lines **and the
endpoints' own rows/columns**".

**The root cause is the screen it walks behind.** `relayPolyline`'s `legClear`
is `streetSegmentClear` + `segmentClearOfRing` + `segmentHoldsRailSide` +
`!segmentCutsABridgeRamp` — plots, ring, rail, boundary, bridge masonry. **A
hand-picked obstacle list. It never asks the real `CollisionWorld`**, so
whatever a sibling system placed there — scenery, fence, hedge, bench — is
invisible to it, and 39.7 m of rescue leg was paved through 10.3 m of it.

That is verbatim the failure CLAUDE.md's standing procgen rule names: *"a
generator that only checks itself against a hand-picked obstacle list will
silently miss whatever a sibling system placed there — the exact shape of
issues #317 and #319."* And the fix it prescribes is the one to build:
**check the real collision world as it stands at that moment, and backtrack** —
a different column, a different bridgehead, a different margin — rather than
accept a leg that does not clear.

It also explains the 1.87 m private-line run that the `streetsShareLatticeLines`
successor must still catch: these two runs are the same defect seen from the
invariant's side.

**THE ORDERING TRAP RESOLVED, AND IT MOVES THE FIX.** `scripts/tmp-blocker.mts`
names the colliders (control: both points the transect measured clear report
"no collider within clearance", so the query discriminates):

```
BLOCKAGE peak (-42.81,12.39) — BLOCKED
  wall (-41.28, 9.79)-(-42.74,12.23) halfThick=0.18 overlap=0.71
  wall (-42.74,12.23)-(-43.61,14.95) halfThick=0.18 overlap=0.86
BLOCKAGE mid  (-43.72,18.22) — BLOCKED
  wall (-43.61,14.95)-(-43.83,17.79) halfThick=0.18 overlap=0.43
  wall (-43.83,17.79)-(-43.47,20.48) halfThick=0.18 overlap=0.83
  wall (-41.65,15.33)-(-41.83,17.71) halfThick=1.30 overlap=0.05
```

A continuous chain of 0.36 m-thick walls — **a fence** — running
(-41.28,9.79) -> (-42.74,12.23) -> (-43.61,14.95) -> (-43.83,17.79) ->
(-43.47,20.48), plus a 2.6 m-thick run beside it.

**That fence is a border fence placed FROM the paths** (`Scenery.ts` owns wall
runs vs paths, off `pathCentreline`). Its line sits within 0.83 m of x = -43.0
for its whole length — i.e. it is bordering **`spur-stall.skyCruiser`'s own
private run** `(-43.0, 30.9) -> (-43.0, 6.9)`. And `spur-hotel`'s private run
is on x = -42.2, **0.8 m away**. A fence offset to border one ribbon
necessarily lands on the other.

**So `relayPolyline` consulting the collision world would NOT have fixed
this** — the fence does not exist when it runs, and cannot. The ordering
means the answer is not knowable there, which by the Overseer's own rule
moves the fix to where the answer does exist: **upstream, to the decision that
put two long parallel runs 0.8 m apart on two private lines.** That spacing is
below anything the scenery placer can border safely.

**This unifies the whole branch.** The two parallel private runs are
simultaneously: Jim's complaint #3 (paths that do not read as a grid), the
`poi.stranded` on seed 11, and precisely what the `streetsShareLatticeLines`
successor must catch. Fix the grid discipline in `relayPolyline` — a long run
belongs on the shared lattice or a half-pitch line, never on a route's own
private column beside another's — and the invariant and the defect are the
same piece of work, which is where to build stage-2 (b) and the successor
together.

**Do not "fix" this by widening a screen or moving the fence.** The fence is
correct; the paths it was given were not.

**BUILT AND MEASURED.** `relayPolyline` now refuses a cell on a private line
once it is more than one `STREET_PITCH` from the endpoint that owns it.
`tsc --noEmit` exit 0. Sixteen seeds, against the approach-exemption baseline:

| seed | before | after | |
|---|---|---|---|
| canonical | 4 | **7** | worse |
| 5 | 10 | 10 | |
| 11 | 22 | **4** | **the target: -18** |
| 24 | 3 | 3 | |
| 115 | 0 | 0 | green |
| 128 | 0 | 0 | green |
| 131 | 0 | 0 | green |
| 208 | 0 | 0 | green |
| 225 | 2 | 2 | |
| 267 | 0 | **2** | worse, **lost green** |
| 274 | 0 | 0 | green |
| 288 | 3 | 3 | |
| 326 | 1 | 1 | |
| 346 | 0 | 0 | green |
| 428 | 0 | **2** | worse, **lost green** |
| 451 | 0 | 0 | green |

**Total stranded 45 -> 34, but green 9 -> 7.** The rule is right — seed 11's
district joined up and its two parallel arterials are gone — but applying it
unconditionally starves the doors that genuinely need a longer step out, and
they fall all the way to the straight-line last resort.

**LADDER BUILT AND MEASURED — KEPT.** Discipline tried first over every
bridgehead and margin; the private line gets its full length only if all of
that finds nothing. `tsc --noEmit` exit 0. Sixteen seeds, against the
approach-exemption baseline:

| seed | baseline | discipline only | **ladder** | |
|---|---|---|---|---|
| canonical | 4 | 7 | **4** | recovered |
| 5 | 10 | 10 | 10 | |
| 11 | 22 | 4 | **3** | **-19, the target** |
| 24 | 3 | 3 | 3 | |
| 115 | 0 | 0 | 0 | green |
| 128 | 0 | 0 | 0 | green |
| 131 | 0 | 0 | 0 | green |
| 208 | 0 | 0 | 0 | green |
| 225 | 2 | 2 | 2 | |
| 267 | 0 | 2 | **2** | **the one regression; did NOT recover** |
| 274 | 0 | 0 | 0 | green |
| 288 | 3 | 3 | 3 | |
| 326 | 1 | 1 | 1 | |
| 346 | 0 | 0 | 0 | green |
| 428 | 0 | 2 | **0** | recovered, green |
| 451 | 0 | 0 | 0 | green |

**Stranded 45 -> 28. Green 9 -> 8.** Better than discipline-alone on both
counts (that was 34 / 7).

**Seed 11 is what this was aimed at and it moved: 22 -> 3.** The island is
gone, the district joined, and `spur-hotel`'s 39.7 m private arterial with
`spur-stall.skyCruiser`'s 24 m run 0.8 m beside it are no longer drawn.

**SEED 267 DIFFED (`scripts/tmp-routes.mts`, same seed, ladder vs
`withDiscipline` forced to `[false]`). Exactly two routes differ, and the
disciplined ones are BETTER, not worse:**

```
undisciplined  spur-exit-skyCruiser  (-3.6,-42.4) (-15.2,-31.5) (-15.2,-19.5)
                                     (-9.2,-19.5) (-9.2,-13.5) (14.8,-13.5)
                                     (14.8,-77.0) (-3.7,-77.0)
disciplined    spur-exit-skyCruiser  (8.8,-31.5) (14.8,-31.5) (14.8,-73.5)
                                     (-3.7,-73.5) (-3.7,-77.0)

undisciplined  spur-stall.skyCruiser (8.8,-31.5) (14.8,-31.5) (14.8,-76.6)
                                     (-11.8,-76.6)
disciplined    spur-stall.skyCruiser (8.8,-31.5) (14.8,-31.5) (14.8,-73.5)
                                     (-11.8,-73.5) (-11.8,-76.6)
```

Undisciplined, `spur-exit-skyCruiser` opens with a **diagonal**
(-3.6,-42.4) -> (-15.2,-31.5), wanders through eight points, and finishes
along **z = -77.0** — while `spur-stall.skyCruiser` finishes along
**z = -76.6**. **Two parallel arterials 0.4 m apart**: the seed-11 defect
again, on a different seed, and the rule caught it.

Disciplined, both share one arterial down x = 14.8 to z = -73.5, separate
along it, and each takes a short private stub to its own door (3.5 m and
3.1 m). That is precisely the shape the rule is for, and it is what Jim's
report #3 asks for.

**So the finding is: the rule is right and the routes are better, yet
`poi.stranded` went 0 -> 2.** The regression is therefore *not* in the route
shapes. **Do not treat this as an argument against the rule**; on the evidence
it is an argument for it.

**AND THE OBVIOUS NEXT GUESS WAS WRONG — measured, so recorded.** I predicted
the two stranded waypoints would be at the ends of the two short skyCruiser
stubs the diff had just changed. They are not. `tmp-lonely.mts` on 267:

```
X (0.0,51.8) nbrs=1 nearestPaving=0.20m (gate-approach) nearestDoormat=21.62m
X (0.0,50.9) nbrs=1 nearestPaving=1.10m (gate-approach) nearestDoormat=21.79m
```

Both are on **`gate-approach`, at x = 0, z ~ 51**, sitting 0.20 m and 1.10 m
from their own paving with one neighbour each. Nowhere near the skyCruiser.

**That is the same signature as the defect leg 1 fixed** — the gate corridor's
outer end at x = 0, z 44..52 — and, decisively, **it is also where the
canonical seed's remaining stranded waypoints are**: canonical's very first
baseline listed `(0.0, 51.8) (0.0, 48.2) (0.0, 44.6)` and canonical is still
at 4 today, unmoved by every change since.

**LOCATED, and it is a hole in leg 1's own fix.** `tmp-pocket.mts` on 267
prints the whole `gate-approach` lane, and the whole lane is:

```
lane gate-approach:
  XX at=0.0 (0.0,51.8) nbrs=1 onRamp=true h=NaN
  XX at=4.0 (0.0,50.9) nbrs=1 onRamp=true h=NaN
```

**Two nodes. That is the entire gate approach.** (Seed 131's, for comparison,
has twelve, at=0..81.) Both are `onRamp=true` — inside a crossing site's
footprint — and each is 0.20 m and 1.10 m from its own paving, so the paving
is there and it is 4 m long.

**Why: `gateCorridorDeepestMouth` degenerates instead of backtracking.**
`deepest` is initialised to `[0, GATE_CORRIDOR_START_Z]` and the scan walks
inward, breaking at the first `z` that stands on a ramp. Leg 1 correctly made
that scan always run — but if the ramp reaches the corridor at or near the
**start**, the scan breaks on its first sample and `deepest` is never assigned
anything better. The corridor collapses to a ~4 m stub at the gate, sitting on
the ramp, and the park's main approach effectively does not exist.

So leg 1 traded "walks onto a ramp" for "gives up entirely" in the case where
the ramp is at the outer end. Both are wrong; the standing procgen rule says
backtrack — try another corridor line, another mouth, or a route round the
ramp — rather than accept a degenerate result.

**THE MECHANISM, TRACED EXACTLY — this is what the fix must address.** Not
built; I ran out of room and would rather leave it right than half-done.

`gateCorridorDeepestMouth` initialises `deepest = [0, GATE_CORRIDOR_START_Z]`
and its loop's first iteration is `z = GATE_CORRIDOR_START_Z`. **If that very
first sample stands on a ramp, it breaks before assigning anything**, so
`deepest` is returned as `[0, GATE_CORRIDOR_START_Z]` — *and that point is
itself on the ramp*, because being on a ramp is precisely why it broke.

Then `gateCorridorMouthCandidates` cannot recover, and the arithmetic shows
why it silently offers nothing:

```
deepest = [0, START_Z]
deepest[1] <= INNER_Z ?            no  -> build the candidate list
candidates = [deepest]
midpoint = (START_Z + START_Z) / 2 = START_Z
midpoint - deepest[1] = 0          not > 2  -> no midpoint candidate
START_Z - deepest[1] = 0           not > 2  -> no start candidate
=> candidates = [[0, START_Z]]     one degenerate mouth, on the ramp
```

Every fallback it has is expressed as a *fraction of the corridor's length*,
and the corridor's length is zero, so all three collapse to the same point.
**A backtrack ladder whose rungs are proportional to the thing that failed has
no rungs when that thing is zero** — worth remembering beyond this function.

**The fix is a mouth that is off the ramp.** The handover must not be placed on
bridge masonry; when `GATE_CORRIDOR_START_Z` itself is on a ramp the mouth has
to move *outward* (increasing z, back toward the gate) until
`pointStandsOnABridgeRamp` is false, and that point becomes the handover the
grid routes from. Note the bound question before writing it: `START_Z` is the
authored start, so walking outward needs a stated limit and a stated answer
for "no clear z exists" — and that answer must not be the stub.

**Prove it red first.** The degenerate-lane clause below would fail on seed 267
today; write that, watch it go red on 267's two-node `gate-approach`, then fix
this and watch it go green.

**CANONICAL READ, AND THEY ARE NOT THE SAME BUG.** Asked before assuming, and
the answer was no:

```
canonical  lane gate-approach:
  XX at=0.0  (0.0,51.8) nbrs=3 onRamp=false
  XX at=7.0  (0.0,48.2) nbrs=3 onRamp=false
  XX at=14.0 (0.0,44.6) nbrs=3 onRamp=false
```

Three nodes, **`onRamp=false` on all three**, spanning 7.2 m and joined to each
other but to nothing else. 267's two are `onRamp=true` and 4 m long. Both lanes
are degenerately short against seed 131's twelve — so they share a *shape* —
but only 267's is the ramp-at-the-start collapse described above.

Decisively: **canonical's four stranded waypoints were `(-8.3,48.8) (0,51.8)
(0,48.2) (0,44.6)` in the very first baseline of this branch, before leg 1
existed.** So canonical is a pre-existing truncated gate approach, not
something leg 1 caused, and it needs its own diagnosis — start by asking why
the drawn `gate-approach` route is only ~7 m long there when nothing is on a
ramp. Two fixes, not one; the circumstantial evidence was misleading.

**The generalisable point, and it is the one for the PR body:** both seeds show
a lane far shorter than its peers, and *nothing asserts on that*. A degenerate
lane is a result nobody checks for. **The `streetsShareLatticeLines` successor
should catch a lane degenerately short against its peers by name** — that is
worth more than the seed count it recovers, because it turns a silent
degeneracy into a red run whoever causes it next.

**(superseded) Check canonical the same way before fixing** (`tmp-pocket.mts`, read the
`gate-approach` lane). Canonical's stranded set has been `(0.0, 51.8)
(0.0, 48.2) (0.0, 44.6)` and friends since the first baseline and has not
moved through four separate fixes, which is consistent with the same
degeneracy. If its lane is also two or three nodes long, canonical's 4 and
267's 2 are one bug and one fix.

**So canonical's 4 and 267's 2 are probably ONE cause, and it is the gate
approach's outer end, not the grid discipline.** 267 only started showing it
because the discipline change altered which routes exist near the gate; the
defect was latent. Chase them together — they are 6 of the 28 remaining — and
start at the gate end of `gate-approach`, not at the skyCruiser.

**The one regression, seed 267 (0 -> 2), is NOT starvation** — and that is
diagnostic. Canonical and 428 both recovered when the fallback rung was
added, which is what starvation looks like. 267 did not, so on that seed the
*disciplined* walk **succeeds** and simply yields a worse route than the
undisciplined one did. Chase it by diffing 267's route set between the two
(`disciplined = true` vs `false`), not by touching the cap.

**Earlier reasoning, kept because it was right:** this is the same shape as
the approach exemption two commits earlier, and it takes the same answer: a
backtrack ladder, not a threshold. Try the walk
under grid discipline; only if that finds nothing, allow the private line its
full length — which is still far better than the straight-line last resort.
Discipline is then kept everywhere it is achievable, which is everywhere the
regressions are not. **Do not answer this by raising the one-pitch cap**: the
cap is derived (a step out to a shared line is at most half a pitch away in
each axis), and loosening it would trade seed 11 back.

### The last resort still draws, and per the standing rule it must not

`paths.ts` ~3786-3814: when nothing legal reaches a door it sets
`routed = [near, destination.gridPoint]` — a straight ribbon from the nearest
paving to the door — and only falls back to `paved = false` if even that would
hop the railway. Jim, 22 Aug: the procgen backtracks and makes different
decisions until it works. Drawing a ribbon nobody can walk to is the "shrink
to a floor and accept a result that still doesn't clear" that rule forbids.

**Either join the component or backtrack; never draw.** Note that flipping it
to `paved = false` alone will *not* move `poi.stranded`: the stranded waypoint
is seeded from the anchor's own entrance, not from the ribbon. The count only
falls when paving genuinely reaches within `MAX_EDGE` of the doormat.

### Still to get right

- `pointStandsOnBridgeMasonry` (used by `nodeOk` at ~1649 and `usable` at
  ~2323) still carries the "inside halfWidth is road" carve-out that
  `segmentCutsABridgeRamp` has now dropped. **These two now disagree about
  the same piece of ground** — precisely the two-definitions shape this repo
  keeps paying for. Moving it is the next screen change; do it alone and
  measure it alone.

### Per-relax-level door verdicts (the prescribed measurement, run)

`scripts/tmp-doors.mts`, all sixteen seeds. Only **three** doors fail outright
(`!`): seed 115 `stall.spaceFerrisWheel`, seed 225 `stall.keychain`, seed 288
`stall.railRacer`. Everything else that appears is `:oblique`, `:wide` or
`:relay` — a door that found a route on a relaxed pass, not a starved one.

Decoding `debugDoorReach`'s eight flags per elbow (`streetClear, ring,
railSide, ramp` for each of the two legs):

- **115 `stall.spaceFerrisWheel`**: `ramp` is `true` on every candidate. It is
  refused by `streetSegmentClear` on the tail leg, not by the ramp screen. Not
  ramp starvation.
- **225 `stall.keychain`**: node (1.4, 19.1) is clear on everything but
  `ramp`; node (-22.6, 19.1) is refused by `streetSegmentClear`. Mixed.
- **288 `stall.railRacer`**: mixture, plus `boundaryEdge 11.48`.

**So the briefed premise needs correcting for the successor:** the starved
doors are *not* mostly ramp-starved, and only three exist. They are a small
tail. The 30 stranded waypoints on seed 451 and the 22 on seed 11 are long
collinear runs — whole lanes cut, like seed 131's was — not doors. Chase the
lanes with `scripts/tmp-pocket.mts` before chasing connectors.

## State — what remains

- [x] Stage 1 grid solve (pushed).
- [x] Gate corridor ramp guard (7/16 green, nothing regressed).
- [x] The footprint screen + approach exemption ladder (9/16 green).
- [ ] Run `scripts/tmp-pocket.mts` on 451, 11, 5, canonical — it names the
      lane and both ends of every pocket in one go, and it was decisive on 131.
- [ ] **Stage 2: invariants. NOT STARTED.** `streetsShareLatticeLines` must be
      rewritten for the new grid (it must admit half-pitch runs from jogs and
      the rescue router, and must be at least as strong); add "every doormat is
      a paving terminal", "inside a bridge footprint only the deck edge and its
      two feet", plus the turn-sharpness clause if not implied by
      `pathsRunOnGridAxes`. Each proved red by mutation, red output in the
      commit message, mutation reverted. CLAUDE.md requires this in the same PR.
- [ ] **Stage 3: park-wide measurement.** GREEN: `pnpm exec tsc --noEmit`
      (exit 0), `pnpm exec tsc --noEmit -p tsconfig.test.json` (exit 0),
      `pnpm run build` (exit 0). RED: `pnpm run test:procgen` and the per-seed
      `check:park` sweep — results below. `pnpm run check` (the 47-step chain)
      has NOT been run.
- [ ] Warp re-search (`scripts/warp-search.mts`) for any seed that goes red
      under the new plotter; prefer emptying a vector where the seed passes
      unwarped.
- [ ] Delete the temporary debug exports and scripts before the PR:
      `debugRelaxedDoors`, `debugDoorReach`, `debugGridReach` at the end of
      `paths.ts`, and `scripts/tmp-*.mts`. `strandedDoorsOfLastSolve` is meant
      to stay (the invariants should read it).
- [ ] No PR yet, by instruction.

### check:park, all 15 measured pool seeds (2 Sep, at `the last resort may not hop the railway`)

`LGP_SEED=<s> node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/check-park.mts`

| seed | exit | note | doors stranded |
|---|---|---|---|
| 5 | 0 | 19/19, 0 crossings, 293/293 waypoints, 1 recorded deviation | — |
| 11 | 1 | 2 invariant regressions | building, ballPit, exit-ginormousSlide |
| 24 | 1 | poi.stranded | station-0 |
| 115 | 1 | poi.stranded 16 | stall.spaceFerrisWheel |
| 128 | 0 | 19/19, 220/220 | — |
| 131 | 1 | poi.stranded 6 | — |
| 208 | 0 | 19/19, 216/216 | — |
| 225 | 1 | poi.stranded 105 (114/219 seeds in the main component) | — |
| 267 | 0 | 19/19, 256/256 | — |
| 274 | 0 | 19/19, 222/222 | — |
| 288 | 0 | 19/19, 215/215 | — |
| 326 | 1 | poi.stranded 1 | — |
| 346 | 0 | 19/19, 240/240 | — |
| 428 | 0 | 19/19, 191/191 | — |
| 451 | 0 | passes since `walkEveryBridge` (263/263 waypoints) | — |

Plus the canonical seed (no `LGP_SEED`): exit 1, `poi.stranded: 41`, no doors
stranded. It was a hard build failure until `the gate approach's own fallback
may not hop the railway either`.

**8 pass, 8 fail (incl. canonical). Every failure is `poi.stranded`** — no seed
fails on reachability, on an illegal rail crossing, or on any other check:park
invariant. That is one defect class, not eight.

### test:procgen (at `the last resort may not hop the railway`)

`Test Files 3 failed | 14 passed (17)`, `Tests 1 failed | 497 passed | 81
skipped (579)`, exit 1. The three failed *files* are two whole-file failures
(`scatterDecoupling.test.ts`, `seed-canonical.test.ts` — both from the
canonical build throwing at the time, since fixed) plus the one failed *test*:

```
FAIL test/procgen/seed-11.test.ts > seed 11 > every street sits on the shared 12 m lattice
  spur-waterFight runs north-south for 10.0 m on x = 39.23, 6.00 m off the nearest 12 m lattice line
  spur-stall.skyCruiser runs north-south for 15.4 m on x = -32.77, 6.00 m off
  spur-exit-skyCruiser runs north-south for 30.0 m on x = -60.90, 1.87 m off
```

This is exactly the invariant Stage 2 must rewrite, and the numbers say how:
the two **6.00 m** offenders are half-pitch runs from the jog/relay routers —
the same grid one level finer, which the successor invariant should admit by
name. The **1.87 m** one is a genuine violation (a run on a door's own private
line) and the successor must still catch it. Rewriting it to allow half-pitch
and nothing else is therefore *stronger* than the current test on that third
run and honest about the first two — do not simply widen the tolerance.

### `poi.stranded` — cause found and fixed; the tail it exposed

**The cause was `segmentCutsABridgeRamp`.** It walked a segment in 1.5 m steps
under a comment claiming "1.5 m is coarser than the 3 m parapet band is thick".
The band is `halfWidth` to `halfWidth + RAMP_SCREEN_MARGIN` — **half a metre**
thick — so a ribbon crossing a ramp square-on stepped clean over it between two
samples. Each such crossing breaks the waypoint chain of the route it is on
(the parapet is solid) and drops the two halves into separate `poiGraph`
pockets. It is now an exact segment-rectangle test in the site's own
(along, across) frame: no step size to be wrong about, and cheaper than
sampling finely enough to be safe.

Parapet crossings on seed 225: **control 5 / drawn 5 -> 0 / 0.**
`poi.stranded` on seed 225: **70 -> 2**; seed 115 **16 -> 1**.

**Three hypotheses were refuted by measurement before that one was found** — do
not re-run any of them:

| hypothesis | measurement that killed it |
|---|---|
| the district hangs off one articulation point | 29 poiGraph edges join it to the rest (parent 81); 3 components, closest cross-component pair 3.12 m |
| the waypoint graph cannot span a bridge ramp | both branches build the same 3 bridges at the same sites; 94 of 164 outside-the-loop seeds are in the main component |
| `routeCurve`'s fillet strays onto ground the polyline cleared | parapet crossings on seed 225: control 5, drawn 5 — identical |

Because the fillet hypothesis died, the **stricter `nodeOk`** (refusing the ramp
surface, not just the parapet band) was never needed, and #414's measured cost
for it — seed 24 losing its only bridge — stands untouched.

### Where it stands now (after the exact screen)

`check:park`: **5 of 16 green** (128, 208, 274, 346, 428), down from 9 — the
screen is correct and it *starved doors*. A door whose every route would have
crossed a ramp now falls to the straight-line last resort, and a last-resort
door makes a pocket of its own. Doors with no grid route are back up: seeds 0,
11, 24, 115, 225, 267, 288 each name one to five in
`strandedDoorsOfLastSolve()`. Seed 5 went from a **build crash** (a
single-point route the corridor collapsed to — fixed) to `poi.stranded 10`;
seed 451 went 0 -> 30.

**Measured and reverted (do not re-run):** adding, to `relayPolyline`'s line
set, the four lines that graze each crossing site's own footprint — taken from
the site's proven reach numbers plus `RIBBON_HALF_WIDTH_CEILING +
RAMP_SCREEN_MARGIN`, so a leg on one of them can pass a bridge — so the rescue
router could walk *round* a ramp. **Neutral on every seed measured**: 451 stayed
at 30, 5 at 10, 288 at 1, 225 still red. Reverted, because a change that
measures nothing is not kept. The inference: the starved doors are failing
earlier than the rescue router — in `gridConnectors` at relax 0/1 — so the
detour has to be offered *there*, on the terminal connector's own legs, not only
in `relayPolyline`. Check which relax level each stranded door dies at before
building anything (`scripts/tmp-doors.mts` prints the per-node connector
verdicts).

**This is the next leg's whole job, and it is a routing problem, not a screen
problem: do not relax the ramp screen to get the count back.** The doors that
lost their routes need routes that go round the ramps — the backtracking ladder
in `gridConnectors`/`relayPolyline` is what has to find them. Start by running
`scripts/tmp-reach.mts` on seeds 0, 11, 24, 115, 225, 267, 288 to see which
doors and why, then `scripts/tmp-poibreaks.mts` to confirm no chain break has
its midpoint on a ramp any more (it should be zero everywhere now).

## Open elsewhere

- #474 blocks on Jim's canonical ruling (widen vs leave pool) — separate.
- Visual QA owed on both PRs; Overseer dispatches.

---

## State — 2 Sep, second successor leg

**9 of 16 green, 26 stranded** (from 8 / 28 at handover).

| seed | at handover | now | |
|---|---|---|---|
| canonical | 4 | 4 | root cause found, upstream — see below |
| 5 | 10 | 10 | gate pocket unreachable, same family |
| 11 | 3 | 3 | |
| 24 | 3 | **2** | span links |
| 115 | 0 | 0 | green |
| 128 | 0 | 0 | green |
| 131 | 0 | 0 | green |
| 208 | 0 | 0 | green |
| 225 | 2 | 2 | |
| 267 | 2 | **0** | **now green** — the gate ladder |
| 274 | 0 | 0 | green |
| 288 | 3 | 3 | |
| 326 | 1 | 1 | |
| 346 | 0 | 0 | green |
| 428 | 0 | 0 | green |
| 451 | 0 | 0 | green |

### The instrument that made all of this visible

`scripts/tmp-ribboncomp.mts` — flood the **drawn paving** from the backbone,
two ribbons joined where their centre lines come within the sum of their half
widths. Sixteen seeds: **canonical, 5 and 267 each have two components, and the
second is `gate-approach` alone.** All thirteen others are one component. That
is the control — the column discriminates, and it named the defect as one
defect on three seeds rather than three unrelated counts.

`scripts/tmp-gate.mts` (`debugGateNodes`) prints every mouth candidate with its
link count, whether the ring can reach it, and whether `routeFromNetwork`
finds anything. `scripts/tmp-north.mts` (`debugGridNodes`) prints every grid
node with its component and neighbours. `scripts/tmp-clearmap.mts` prints a
point-clearance map. `scripts/tmp-whatblocks.mts` / `tmp-nodewhy.mts` name what
refuses a given point.

### `noPathEndsNowhere` was ALREADY the degenerate-lane assertion, and already red

The briefed "write the degenerate-lane clause, watch it go red" turned out to
need no new clause. `pnpm exec vitest run test/procgen/seed-canonical.test.ts`,
before any change on this leg:

```
FAIL  canonical seed 20260728 > no paved path stops anywhere but a destination
  gate-approach's end at 0.0, 46.8 is 13.92 m from the nearest other paving
    — it branches off nothing
```

It catches exactly the island, by name, and it has been red on canonical all
along. Note the invariant suite runs on **six** seeds (canonical, 5, 11, 24,
288, 326) — 267 has no test file, which is why nobody saw it there.

### Fix 1 (kept): the gate ladder climbs until the ring can REACH the gate

`bridgeSiteReserving` is now the one owner of the reservation rectangle;
`pointStandsOnABridgeRamp` is its boolean face. The gate's join is a ladder of
relax 0/1/2 screened, then relax 0/1/2 with the reservation the handover itself
stands in exempted **by identity**, and the rung that stops it is *the ring
reaching the node*, not the node having a link.

That distinction is the whole fix. `scripts/tmp-gate.mts` on 267:
`links: 1, reachableFromRing: false, routes: false` — a count-of-links ladder
stopped at the first rung, satisfied, on a connector into a pocket. Every other
ladder in the file counts connectors and is right to; a door's neighbourhood is
ordinary lattice and the gate's is not, because on 5 and 267
`pointStandsOnABridgeRamp(0, 54)` is **true** (on 5 for the corridor's whole
24 m): the arch itself stands inside a bridge's reservation, and every edge
touching a reservation is refused.

267: 2 -> 0, green. Nothing else moved.

### Fix 2 (kept): span links — a street steps round a crossroads that does not exist

The jog pass heals a blocked *run* between adjacent nodes; nothing healed a
blocked *node*. Jogs require `nodeOk[b]`, and straight/pinch links only ever
join adjacent cells, so a refused crossroads ended the line whatever clear
ground lay beyond. Span links join the two nodes two pitches apart either side
of a dead crossroads with the same three-segment half-pitch shape, at
`SPAN_COST_FACTOR` 1.35. Seed 24: 3 -> 2. Nothing regressed.

### CANONICAL'S ROOT CAUSE — measured, and it is NOT in `paths.ts`

Do not spend another leg inside the router on this. The gate pocket is walled
in on all four sides and the wall is built by three different systems:

```
(-33.1,55.4) comp=0 REACHABLE nbrs=[-33.1,43.4 -28.5,53.8]
(-21.1,55.4) does not exist — nodeOk 0
( -9.1,55.4) comp=8 --------- nbrs=[2.9,55.4 ... the gate nodes]
```

- **West** — `(-21.07, 55.38)` is refused by **the Rail Race arch feet**, not by
  a plot: `debugWhatBlocks` gives `archFoot r=4.40 dist=3.09` and five more
  behind it, a continuous chain. The arch marches straight across the gate's
  only westward lattice line.
- **North** — `(-21.07, 61.38)` (the half-pitch line) has `boundary=1.12`. The
  park edge is right there.
- **East and south** — `(14.93,55.38)` `railDist 3.03`, `(14.93,43.38)` 3.85,
  `(2.93,43.38)` 2.10, all under `RAIL_CLAMP_DISTANCE` 4.2. The railway loop.
- **No crossing site serves the pocket.** Canonical has three sites (six feet);
  the nearest foot to the pocket is `(-28.5,53.8)` — on the far side of the
  arch.

`scripts/tmp-spanoff.mts` (control: offset 0, the known-blocked straight run,
correctly reports blocked) tried every offset for a span between
`(-9.07,55.38)` and `(-33.07,55.38)`:

```
offset     0  blocked  leg2:streetClear      <- the control
offset     6  blocked  leg1:streetClear leg2:streetClear
offset    -6  blocked  leg1:streetClear leg2:streetClear,ramp leg3:ramp
offset     3  blocked  leg1:streetClear leg2:streetClear
offset  -1.5  blocked  leg2:streetClear,ramp
offset   1.5  CLEAR
```

**Only an eighth of a pitch clears.** A 24 m run on a private line 1.5 m off
the lattice is precisely the defect the `streetsShareLatticeLines` successor
must catch and precisely Jim's complaint #3. So there is no honest grid answer
here: the fix is upstream — a crossing site that serves the gate's own side of
the loop, or an arch that does not sit across the gate's line (Jim's brief #2,
"considered together from the start"; Decision 4's joint solve). Seed 5 is the
same family (its gate handover is still `reachableFromRing: false` at the
widest rung, `nearestReachable: 35.0m`).

**Do not "fix" this by threading the 1.5 m line.** It trades a measured
`poi.stranded` for a measured grid violation and Jim's own complaint.

### Fix 3 (kept): the `streetsShareLatticeLines` successor

Admits the **6 m half lattice by name**, because that is the grid the
generator actually builds on (`JOG_OFFSET = STREET_PITCH / 2`, used by the jog,
span and rescue routers). A run is on the grid if it is within
`STREET_LINE_TOLERANCE` of a full line **or** a half line; everything reported
is off both, and the message says so.

Proved, `--reporter=verbose`:

```
[streets] 29 street-length run(s) asserted on, 5 admitted on a 6 m half line, 0 excused
 OK canonical seed 20260728 > every street sits on the shared 12 m lattice
[streets] 25 street-length run(s) asserted on, 8 admitted on a 6 m half line, 0 excused
 XX seed 11 > every street sits on the shared 12 m lattice
    spur-waterFight runs north-south for 29.8 m on x = 49.32, 1.91 m off the
    nearest line of the 12 m lattice through the plaza (9.24, 6.93) OR of its
    6 m half lattice
```

Canonical goes green; seed 11's private-line run is still caught — the
requirement. A coverage line goes to **`process.stderr`** on every run (vitest's
default reporter hides console output from passing tests) counting runs
asserted on, runs admitted on a half line, and runs *excused* by the
threading-unserved-ground exemption, with "THIS SEED ASSERTS NOTHING" when the
count is zero.

**THE BRIEFED CAP IS REFUTED BY MEASUREMENT — do not re-add it.**
`scripts/tmp-runs.mts` over the six suite seeds:

```
seed 11  spur-hotel            NS len= 51.0 line= -80.76 off12=6.00 off6=0.00
seed 11  spur-stall.skyCruiser NS len= 51.3 line= -80.76 off12=6.00 off6=0.00
seed 11  spur-exit-skyCruiser  NS len= 51.3 line= -80.76 off12=6.00 off6=0.00
```

Three routes, 51 m each, on the **same** half line — the best example in the
pool of the property the invariant exists to measure. A cap below street length
fires on it. What reads as wandering is a line nobody else uses; length does not
tell the two apart.

## Where the branch stands, and what is next

`pnpm exec tsc --noEmit` **0**, `pnpm exec tsc --noEmit -p tsconfig.test.json`
**0**, `pnpm run build` **0**. `pnpm run check` (47 steps) **not run**.
`pnpm run test:procgen` **exit 1**, and this is the honest full list:

| test | seed | what |
|---|---|---|
| `scatterDecoupling` | — | "perturbed the park for real" — the two hashes are equal, so everything below it is vacuous. **Not diagnosed.** |
| `noPathEndsNowhere` | canonical | `gate-approach`'s end 13.92 m from any paving — the gate pocket, root-caused above, fix is upstream |
| `noPathEndsNowhere` | 5 | same, 32.02 m |
| `noPathEndsNowhere` | 288 | `bridge-walk-0`'s end at (-15.7,-47.7) 27.10 m from any paving. **Not diagnosed** — 288 has ONE paving component, so this is a dangling end, not an island |
| `pathsRunOnGridAxes` | 5 | `spur-stall.keychain` diagonal 17.3 m from **(7.8,-23.3)**, which is a bridge foot, to (-7.2,-14.9). **Not diagnosed** |
| `streetsShareLatticeLines` | 11 | `spur-waterFight`, below |

### Seed 11's `spur-waterFight` — measured, not fixed

Control polyline: `(45.2,54.9) (49.3,54.9) (49.3,23.5) (49.7,23.7)`. A 31.4 m
run on the door's own column, from a ring tap on the lattice at x = 45.24.

`scripts/tmp-col.mts` walks a column in 3 m pieces against `paths.ts`'s own
screens (control: the private column the router DID use reads blocked, so the
instrument discriminates):

```
x=45.24  z 41.5..47.5 BLOCKED ramp          <- the lattice column, 6 m of bridge reservation
x=49.3   z 29.5..44.5 BLOCKED streetClear   <- the column used, 15 m along a plot's face
x=51.24  z 29.5..44.5 BLOCKED streetClear
```

So the lattice column beside it is clear **except for 6 m of one bridge's
reservation**, and the router preferred 31 m on a private line. The connector
cannot be the elbow builder — its tail is bounded by `STUB_TAIL_LIMIT` (7.8,
15.6 relaxed) — so this is `relayConnectors`/`relayPolyline`'s last rung, the
one that allows a private line its full length when the disciplined walk finds
nothing. **The disciplined walk finds nothing because 6 m of reservation ends
the lattice column**, which is the same disease span links fixed for a dead
*node*: nothing heals a run blocked by a reservation. A span-like step round a
reservation on the lattice column is the obvious next thing to try, and it
would also be the honest fix for Jim's complaint #3 on this seed.

### Deliberately NOT done, and why

- **The `tmp-*` probes and the debug exports are still in the tree.** Every
  open defect above is still being chased with them, and `debugGateNodes`,
  `debugGridNodes`, `debugLegScreens`, `debugNodeScreens`, `debugWhatBlocks`
  are what made this leg's diagnoses possible. Delete them in the leg that
  closes the last defect, not before.
- **No rebase onto `origin/main`.** This branch is stacked on
  `feat/park-warp-solver` (#474), which is still open; `origin/main...HEAD` is
  92 files because it carries the parent's work. Rebasing onto main while the
  parent is unmerged flattens the stack. Rebase when #474 lands. `main` is 2
  commits ahead of the merge base and carries `check:coplanar`, which this
  branch's `package.json` does not have (`103` scripts, `check:coplanar` absent
  — parsed, not grepped).
- **No PR**, by instruction.

---

## State — 2 Sep, third leg (Overseer-directed)

**10 of 16 green, 21 stranded.** canonical 0 (was 4), 5 10, 11 3, 24 2, 225 2,
288 3, 326 1.

### Fix 4 (kept): a second tier for the gate in the crossing planner

`fitBridgeAcross` takes a `rampFloor`, defaulting to `SITE_RAMP_FLOOR` so no
caller can drift off it by omission. Exactly one caller passes anything else:
`serveTheGateOnTheSecondTier`, which re-marches the gate's own window
(`SITE_SPACING` either way of the gate's nearest rail distance) at
`MIN_RAMP_RUN` — the bar `bridgeFootprint.ts` itself accepts — and keeps the
least oblique fit. **`SITE_RAMP_FLOOR` is untouched for every other candidate
on every seed**; that is what makes this a ladder and not a lower floor.

The trigger is structural, and **the ungated version was measured first**
(`scripts/tmp-gateside.mts`):

```
canonical  gateSide=-1 centreSide= 1  gained railD=1  @(0.8,41.0)  15.2/11.2   4 -> 0 GREEN
208        gateSide=-1 centreSide=-1  gained railD=49 @(-1.9,37.3) 11.7/15.2   0 -> 9 LOST GREEN
```

208's gate is on the **same** side of the loop as the fountain, so its walk in
never crosses and the site was pure cost — since the grid rework a crossing
reserves a rectangle forbidden to every foreign leg, and an unneeded one lays a
no-go across the park entrance. Gated on gate and fountain being on opposite
sides, 208 keeps its green and canonical still goes green.

`railSideOf` **moved** into `crossingPlanSolve.ts` (re-exported from
`crossingPlan.ts`, so every consumer imports it from where it always did): the
solver needs the answer itself and a copy would have been a second definition
of "which side". The park's middle is `PARK_LAYOUT.fountain`, the same owner
`paths.ts` reads `PLAZA` from — never the world origin.

### `scatterDecoupling`'s vacuous suite: ROOT-CAUSED, and it was the gate

Not a separate defect. `LGP_SPUR_STRETCH` bows exactly `spur-stall.railRacer`,
and on the canonical seed **that door stands in the gate pocket**. While the
pocket was orphaned the door fell to the straight-line last resort, so the knob
had an *unpaved* 0.9 m stub to bow and `paths.digest` did not move — leaving
every "unchanged" assertion beneath it passing for the worst possible reason.

Proved with a control, by disabling `serveTheGateOnTheSecondTier` and putting
it back (restore verified by grep: `CONTROL-DISABLED matches: 0`):

```
second tier ON   spur-stall.railRacer paved=true
                   (0.0,54.0) (-9.1,55.4) (-6.7,52.0) (-9.1,49.6)
                 vitest scatterDecoupling: 4 passed, exit 0
second tier OFF  spur-stall.railRacer paved=false
                   (-9.1,49.6) (-8.4,50.3)          <- the 1 m stranded-door stub
                 vitest scatterDecoupling: 1 failed | 3 passed, exit 1
                 AssertionError: expected 'c0b4bd32db83bd9b' not to be 'c0b4bd32db83bd9b'
```

**The geometry that transcript was proved against is the canonical seed with
the second tier disabled** — the polyline above is the whole of it. The
assertion did its job exactly as written; there is nothing to fix in the test.

### Seed 11's `spur-waterFight`: measured, and NOT a router bug

The span pass **did** fire — `(45.24, 42.93)` has `onMasonry=true`, so the
middle crossroads is genuinely absent — and every offset it may legally use is
blocked (`scripts/tmp-spanoff.mts`, control offset 0 correctly reports blocked
and names `ramp`):

```
offset     0  blocked  leg2:ramp                          <- the control
offset     6  blocked  leg2:streetClear leg3:streetClear
offset    -6  blocked  leg2:ramp
offset     3  blocked  leg2:streetClear leg3:streetClear
offset     2  CLEAR                                        <- x = 47.24, a private line
offset  -1.5  blocked  leg2:ramp
```

The reservation is 10 m across, so a half-pitch step west stays inside it and a
half-pitch step east is inside the plot. **Same class as canonical's gate**: a
bridge reservation and a plot together seal every lattice and half-lattice line
to a door, and the owner is the joint solve (Decision 4). The 31 m private line
is the rescue ladder's last rung firing correctly on geometry offering nothing
better. Do not thread the +2 line — it trades a stranded waypoint for Jim's
complaint #3.

### For the PR body

- The `tmp-ribboncomp.mts` control: three unrelated counts (canonical 4, 5 10,
  267 2) collapsing into **one** named defect — `gate-approach` as a second
  paving component on exactly those three seeds, one component on the other
  thirteen.
- **`noPathEndsNowhere` was honestly red on canonical all along and structurally
  unheard on 267**, because the invariant suite runs six seeds (canonical, 5,
  11, 24, 288, 326) and the pool is sixteen. **It should run the whole pool.**
  267's identical defect was invisible to CI for the life of this branch, and
  the ten seeds with no test file are covered by `check:park` alone, which
  measures whether the park *works*, not whether its furniture is placed sanely.
  The cost is ten more park builds; the suite already spends 70 s on six.

### Fix 5 (kept): relaxing may widen a distance, never license a diagonal

`computeGridConnectors`' straight connector is the one shape that draws a
diagonal. Its off-axis reach is now bounded by the tight `STUB_TAIL_LIMIT` at
every relax level. Seed 5's `spur-stall.keychain` opened
`(7.8,-23.3) -> (-6.9,-14.7)` — 17.3 m, dx 14.7 dz 8.6, 30 degrees off axis —
because relax 1 doubles `tailLimit` to 15.6. It is now the elbow
`(7.8,-23.3) (-6.9,-23.3) (-6.9,-14.7)`.

`seed 5 > every paved path runs on grid axes`: **RED -> GREEN**.

**Honest accounting: a trade, not a clean win.** Refusing the diagonal pushes
`spur-waterFight` onto the elbow too and its long leg lands on the foot's own z
line, so `seed 5 > every street sits on the shared 12 m lattice` goes
**GREEN -> RED** (`11.0 m on z = -23.31, 2.57 m off`). `test:procgen` is 4
failed either way. Kept because the rule is right independently of the count.

### Measured and reverted this leg — do not rebuild these

| change | measurement that killed it |
|---|---|
| `footprintsOverlap` widened to the reservation rectangle | seed 288 refused the pair, lost a bridge it needs, `route.unreachable: 2` — destinations a child cannot reach at all |
| the foot ladder's exempt rungs widened to relax 1 and 2 | neutral on all sixteen seeds: 288's foot is cut by a **different** site's reservation, which no own-site exemption can reach |
| shorter-tailed elbow corner tried first | neutral on all sixteen seeds and the whole invariant suite (the reasoning is sound; the case that bites it is not in the pool) |
| `selectSpaced(bridgeCandidates, true)` — the existing `serveTheGate` ranking flag | canonical's sites moved 2 m; seed 11 3 -> 7, seed 451 0 -> 1 losing green |

### `test:procgen` — 4 failing, all four diagnosed

| test | seed | status |
|---|---|---|
| `streetsShareLatticeLines` | 11 | `spur-waterFight` 29.8 m on a private line — **joint-solve class**, a reservation and a plot seal every lattice and half-lattice line to the door (only a +2 m private offset clears) |
| `streetsShareLatticeLines` | 5 | `spur-waterFight` 11.0 m on the bridge foot's own z line — the elbow's long leg; introduced by Fix 5, which traded a worse diagonal for it |
| `noPathEndsNowhere` | 288 | `bridge-walk-0` ends 27.10 m from paving because its foot stands in **bridge 1's** reservation — `footprintsOverlap` measures a shorter rectangle than `paths.ts` forbids |
| `noPathEndsNowhere` | 5 | `gate-approach` 32.02 m — the gate pocket, seed 5 flavour; its handover is still `reachableFromRing: false` at the widest rung |

**Three of the four now share one owner: the reservation rectangle is far
larger than the masonry a bridge actually builds** (measured on 24/131/451:
real masonry at `|across|` 1.1–2.7 against a `halfWidth` of 4–5). Shrinking the
reservation to what gets built is the single change that would unlock 288, 11
and probably 5 — and it is Jim's brief #2 in one line: the bridge's real shape
is decided after the paths, from the paths, so no path can be screened against
it. **That is the next leg**, and it is bigger than a ladder.

---

## State — 2 Sep, fourth leg

**check:park: 10 of 16 green, 21 stranded** (canonical 0, 5 10, 11 3, 24 2,
225 2, 288 3, 326 1). `tsc` 0, `tsc -p tsconfig.test.json` 0, `build` 0.

### The suite now runs the whole sixteen-seed pool

Ten new files: 115 128 131 208 225 267 274 346 428 451. **84.8 s wall for 27
files / 1393 tests**, against 70 s for six. It found **seven more failures on
its first run** — the gap was never theoretical.

### Fix 6 (kept): a cut corner gets the doorway reach, never the relaxed one

Bounding the straight connector's off-axis *component* was not enough — a leg
with dx 3.6 over dz 15.1 has a small off-axis component and is still a 15.5 m
diagonal. The limit now depends on the shape: axis-aligned it is an ordinary
street stub and may run the relaxed distance; off axis at all it is a cut corner
and gets `STUB_TAIL_LIMIT`.

Whole-pool `test:procgen` **11 failed -> 9**: seed 346's grid axes and seed
451's detour ratio both go green. `check:park` unchanged on all sixteen.

### Measured and reverted this leg — recorded in the code

**Bounding the head-on arrival shape's diagonal leg the same way.** It fixed
*all five* remaining `pathsRunOnGridAxes` failures (131, 208, 225, 451) and seed
128's climbable-tree failure — `test:procgen` 9 -> 7 — and cost:

```
check:park    10 green -> 8      seed 267 0 -> 1,  seed 451 0 -> 1
test:procgen  three NEW detourRatiosStayReasonable failures (225, 326, 346)
```

The elbowed head-on shapes are axis-aligned but longer, so a door pushed off the
straight shape walks a long way round or not at all. **The honest fix gives the
door a short axis-aligned arrival rather than refusing the diagonal and leaving
it to walk** — that is the open work, not a re-run of this.

### `test:procgen` — 9 failing on the whole pool, all diagnosed

| test | seed | owner |
|---|---|---|
| `pathsRunOnGridAxes` | 131, 208, 225, 451 | the head-on shape's diagonal leg — see the reverted experiment above |
| `everyPathIsNearAClimbableTree` | 128 | moves with the same routes; not separately diagnosed |
| `noPathEndsNowhere` | 288 | bridge 0's foot inside **bridge 1's** reservation |
| `noPathEndsNowhere` | 5 | the gate pocket, seed 5 flavour |
| `streetsShareLatticeLines` | 11 | reservation + plot seal every lattice and half-lattice line |
| `streetsShareLatticeLines` | 5 | the elbow's long leg on a bridge foot's own line |

### THE NEXT LEG, unchanged and now better evidenced: shrink the reservation

Three of these have one owner. `footprintsOverlap` measures
`MIN_BRIDGE_HALF_LENGTH`; `paths.ts` forbids
`DECK_HALF_LENGTH + proven reach + RAMP_SCREEN_MARGIN`. Two definitions of one
rectangle. And the rectangle itself is far larger than the masonry a bridge
builds — measured on seeds 24/131/451, **real masonry at `|across|` 1.1–2.7
against a `halfWidth` of 4–5**. Widening `footprintsOverlap` to the reservation
was tried and cost seed 288 a bridge (`route.unreachable: 2`), so the direction
is the other one: **shrink the reservation to what gets built.** Expect it to
move 288, 11 and possibly 5 together. It needs its own control.

Still deferred, with reasons: the `tmp-*` probes and debug exports (they are the
diagnostic kit for every open defect above), and the rebase (this branch is
stacked on the still-open #474; `origin/main...HEAD` is 92 files because it
carries the parent's work).

---

## State — 2 Sep, fifth leg: the reservation shrink, MEASURED AND REFUTED AS BRIEFED

Baseline re-measured from scratch on this leg, not inherited: `check:park`
**10/16 green, 21 stranded** (canonical 0, 5 10, 11 3, 24 2, 225 2, 288 3,
326 1) — identical to the handover. `test:procgen`: **9 failed | 1384 passed**
(quote off the screen; the brief said 7).

### The three numbers, and none of them is the same as another

Measured, not reasoned (`scripts/tmp-resfit.mts`, 30 built decks over all
sixteen pool seeds; reads the walkable deck from `bridgeHeightAt`, which is
non-null only over a bridge, so unlike a collision sweep it cannot be
contaminated by the railway fence at the crossing point; control — the same
sweep 15 m past the ramp's end reports no deck on every site):

| quantity | value | where it comes from |
|---|---|---|
| masonry actually **built** | ≤ **2.52** m symmetric, ≤ **3.72** with one curved spine | measured, 30 decks |
| masonry the constants **permit** | **2.95** = `RIBBON_HALF_WIDTH_CEILING` (2.65) + `BRIDGE_WALL_THICKNESS` (0.3) | `paths.ts`, `bridgeFootprint.ts` |
| what `paths.ts` **screens** | **4.50 / 5.50** = `site.halfWidth` + `RAMP_SCREEN_MARGIN` | `segmentCutsABridgeRamp` |
| what the builder is **licensed** to occupy | **~9.95** = 2.95 + `DEVIATION_CAP` (3.0) + `maxLateralShiftFor` (≥ 4.0) | `bridgeSpine.ts`, `bridgeFootprint.ts` |

**The screen is a third number, agreeing with neither the masonry nor the
licence — and it is NARROWER than the licence, not wider.** So the briefed
framing ("the reservation is far larger than the masonry") is true of the
*outcome* and false of the *contract*: a bridge is permitted to put masonry
almost 10 m off its site axis, on ground the screen leaves open. Correcting
the screen to cover the licence would *widen* it to 5.95, not shrink it.

`site.halfWidth` is documented as "the corridor half-width this site was
**proven at**" — a proof of clear room, never a promise about where the
masonry goes. It has been read as the second thing.

### The shrink, built and measured — DO NOT RE-RUN AS WRITTEN

`segmentCutsABridgeRamp` and `bridgeSiteReserving` screened
`RIBBON_HALF_WIDTH_CEILING + BRIDGE_WALL_THICKNESS + RAMP_SCREEN_MARGIN`
(**3.45**) instead of `site.halfWidth + RAMP_SCREEN_MARGIN` (4.50/5.50).
Nothing else changed. `tsc --noEmit` exit 0. Reverted; restore verified by
grep (`DIAGNOSTIC-SHRINK` matches: 0, both original lines back).

| seed | baseline | shrunk to 3.45 | |
|---|---|---|---|
| canonical | 0 | 0 | green |
| 5 | 10 | **0** | **now green — the big win** |
| 11 | 3 | **22** | **+ `poi.nospot: 2`** |
| 24 | 2 | 2 | |
| 115 | 0 | 0 | green |
| 128 | 0 | 0 | green |
| 131 | 0 | 0 | green |
| 208 | 0 | 0 | green |
| 225 | 2 | 2 | |
| 267 | 0 | 0 | green |
| 274 | 0 | 0 | green |
| 288 | 3 | **3** | **did not move at all** |
| 326 | 1 | 1 | |
| 346 | 0 | 0 | green |
| 428 | 0 | 0 | green |
| 451 | 0 | **5** | **lost green** |

**Green 10 -> 10. Stranded 21 -> 35.**

**The briefed prediction was that this would move 288, 11 and possibly 5
together. Recorded as wrong: it cures 5 outright, does nothing whatever for
288, and costs 11 nineteen waypoints and 451 its green.** 288 is therefore
*not* a reservation-width defect and must be chased as its own thing.

### Why 11 and 451 regress, and it is NOT a masonry breach

`scripts/tmp-poibreaks.mts` on seed 11 under the shrink:

```
spur-hotel:            chain breaks between (-44.4,23.1) and (-42.2,8.7) gap 14.53 m, midpoint on a bridge ramp: false
spur-stall.skyCruiser: chain breaks between (-40.0,30.5) and (-37.7,5.8) gap 24.84 m, midpoint on a bridge ramp: false
total consecutive-sample breaks: 2
```

**Both breaks are off every ramp**, and `tmp-ribboncomp.mts` reports **one**
paving component — the drawn network is whole. So the narrow band screened the
masonry perfectly well; nothing walked into a parapet.

Those two breaks are seed 11's *original* island, at the *original* coordinates:
`spur-hotel` breaking at ~(-43, 15), which this branch already root-caused as
**a border fence built from two long parallel private path runs 0.8 m apart**
(`spur-hotel` on x = -42.2 beside `spur-stall.skyCruiser` on x = -43.0). The
grid-discipline ladder's last rung — a private line at full length when the
disciplined walk finds nothing — fired again the moment the reservation stopped
forbidding the ground that had been pushing it onto a shared line.

**So the wide reservation has been doing shaping work it was never meant to
do, and seed 11's cure was accidental.** The width is not screening masonry
there; it is acting as an obstacle that happens to force grid discipline. That
is why shrinking it to the honest masonry band un-does a fix that was never
really about masonry.

### What this means for the next leg

Three separate things were being answered by one rectangle, and they want
three different sizes:

1. **Which ground foreign masonry will stand on** — narrow (3.45 measured
   sufficient: no ramp-midpoint breaks anywhere under the shrink) but only
   correct if the builder is bounded to it, which it is not (licence ~9.95).
2. **Which ground a route may not branch in or run along** — the #414
   question, unrelated to width.
3. **An accidental obstacle that forces the discipline ladder onto shared
   lines** — seed 11 and 451 depend on this and nothing says so.

**The honest programme, in order:** fix (3) properly — the discipline
ladder must not fall back to a 24-40 m private line beside another route's
private line, whatever the reservation does — and only then shrink the band,
which at that point buys seed 5's ten waypoints for nothing. Shrinking first
trades one seed's ten for another's nineteen.

**Seed 5's 10 -> 0 is the single largest per-seed win still available and it
is now located**: seed 5's gate handover stands inside a reservation for the
corridor's whole 24 m, and narrowing the band frees it. If the private-line
defect is fixed first, this is a clean gain.

### Built this leg and kept

- `scripts/tmp-resfit.mts` — the reservation-occupancy probe above.
- `scripts/tmp-sweep.sh` — `check:park` across the whole pool, one line a seed.
- `ParkFacts.plannedBridgeSites` — the proven sites' full geometry (position,
  crossing direction, ramp reach either way, proven corridor half-width), with
  `plannedBridgeSiteDistances` now **derived from it** so the two cannot come
  to disagree about which sites exist. `tsc -p tsconfig.test.json` exit 0.
  It is there for the stage-2 invariant "no bridge's masonry stands outside
  the band `paths.ts` screened", which is the mechanism that would have caught
  this whole class — nothing checks it today, in either direction.

### THE REAL DEFECT, LOCATED AND PROVED: reservations for bridges that are never built

The width was the wrong axis. **A proven crossing site that no path ever
crosses at still costs a full reservation** — roughly 38 m by 11 m of ground
forbidden to every foreign leg, protecting a bridge that does not exist and
never will.

`scripts/tmp-resfit.mts` reports it directly, and the new invariant's own
coverage line does too (`[reservation cover] N of M ... carry a built deck`):

```
5  site railD=0    NO DECK BUILT  forbids |across|<=5.50 along [-18.9,18.9]
5  site railD=74   NO DECK BUILT  forbids |across|<=4.50 along [-18.9,18.9]
5  site railD=156  walk=[-1.10,1.10]  masonry=[-2.02,2.02]  used=2.02  forbidden=5.50
5  site railD=246  NO DECK BUILT  forbids |across|<=4.50 along [-18.9,18.9]
```

**Three of seed 5's four reservations are empty.** Seed 5 is the worst seed in
the pool (10 stranded) and the one the width shrink cured outright — because
narrowing the band was an indirect, partial way of doing what releasing the
empty reservations does completely.

**PROVED, with a control on the instrument first.** A temporary
`LGP_DIAG_UNUSED_SITES` exempted named sites from `segmentCutsABridgeRamp` and
`bridgeSiteReserving` by rail distance. Reverted; restore verified by grep
(`DIAGNOSTIC-UNUSED` matches: 0).

```
LGP_SEED=5 LGP_DIAG_UNUSED_SITES=''          poi.stranded: 10   <- CONTROL, reproduces baseline exactly
LGP_SEED=5 LGP_DIAG_UNUSED_SITES='0,74,246'  (no failures)      <- GREEN
```

The geometry that was proved against is the four sites listed above, on seed 5
at this branch's head: one built bridge at railDistance 156, three empty
reservations at 0, 74 and 246.

**Seed 5's ten stranded waypoints are caused entirely by three no-go rectangles
protecting nothing.** That is the same disease as the width — the reservation
is bigger than the bridge — in its most extreme form, where the bridge's size
is zero.

### Why this is the honest fix and the width shrink was not

The width shrink narrowed every reservation, including the ones doing real
work, which is why seeds 11 and 451 paid for seed 5's cure. Releasing an
**empty** reservation costs nothing at all: there is no masonry to keep a
ribbon off.

### What is NOT yet answered, and it matters

**"No deck was built in this rectangle" is not the same question as "no path
crosses at this site", and seed 288 is the case that separates them.** 288's
site at railDistance 152 has no bridge of its own, but a *neighbouring*
bridge's deck stands inside its rectangle (across -14.00 to -5.20 — this is
exactly what the new invariant fires on). Releasing 152 by the "no deck built"
rule would un-screen ground where real masonry stands. **The rule must be
"no crossing leg uses this site", not "this rectangle is empty."**

### The implementation this points at

`paths.ts` chooses which sites carry a crossing leg, so it can know. Solve the
network, record the sites a crossing leg actually used, re-solve with only
those screened, and iterate to a fixed point (bounded — keep the union if it
does not settle within a small number of passes). That is a genuine backtrack
in CLAUDE.md's standing sense rather than a threshold, and it is Jim's brief #2
again: the bridges and the paths decided together instead of one reserving
ground the other never wants.

Expected prize on the measurement above: seed 5 **10 -> 0**, taking the pool to
**11 of 16 green** and 21 -> 11 stranded, with nothing else touched. Seed 115
also carries one empty reservation (railD 76) and is already green.

### RED CHECK, NOT THIS LEG'S AND NOT PREVIOUSLY REPORTED: `check:pet-slide`

`pnpm run check` (the full chain) **exits 1** on this branch, and it is not the
path work:

```
check:pet-slide FAILED
  - in shot: the nearest companion filled at least 1% of the chase frame on
    only 88% of 8 rasters, against 95% required (its smallest was 0.0%)
    — it is behind her, but not in the shot
```

Bisected rather than assumed, and it is **deterministic, not flaky** — the same
figures three runs running:

| commit | `check:pet-slide` |
|---|---|
| `origin/main` (bd818210) | **exit 0 — passes** |
| `8df8685a`, this leg's branch point | exit 1, identical message |
| `d3967f05`, this leg's head | exit 1, identical message |

So **this branch or its still-open parent `feat/park-warp-solver` (#474) broke
it**, and nothing on either branch had run the full chain to find out — the
previous legs record `pnpm run check` as "NOT RUN". 88% of 8 rasters is 7 of 8,
so it needs every raster; the pet is behind her but out of frame on one.

It is not caused by this leg's commits (the `bridgeScreenHalfAcross` refactor
and the `BRIDGE_WALL_THICKNESS` move are behaviour-neutral — see below), but by
CLAUDE.md's zero-tolerance rule it is the work now for whoever takes this on,
and it should probably be chased on #474 first since that is the parent.

### This leg's own state

- `pnpm exec tsc --noEmit` **0**; `pnpm exec tsc --noEmit -p tsconfig.test.json`
  **0**; `pnpm run build` **0**.
- `pnpm run check` **1**, and only on `check:pet-slide`, above.
- `pnpm run test:procgen`: **10 failed | 1399 passed (1409)** — the 9 inherited,
  plus the new `builtMasonryStaysInsideItsReservation` firing honestly on seed
  288.
- `check:park`: **10 of 16 green, 21 stranded — unchanged from the handover**,
  re-measured after this leg's commits. That is the proof the refactor is
  behaviour-neutral: identical seed-for-seed.
- `main` is **2 commits ahead** of the merge base and now carries `check:coplanar`
  and its own workflow, which this branch does not have. Still stacked on the
  unmerged #474, so still **not rebased**, for the reason the previous leg gave.

### Next leg, in priority order

1. **Release reservations for crossings no leg uses** — proved above to take
   seed 5 from 10 to green on its own. Two-pass in `paths.ts`: solve, record the
   sites a crossing leg used, re-solve with only those screened, iterate to a
   fixed point and keep the union if it does not settle. **Not started, and
   deliberately not started badly**: `pathGrid()` is a module-level memo with
   module-level mutable `pavedGridNodes`/`pavedGridEdges` read by a dozen
   entry points, so a second pass means invalidating both and is a real piece
   of surgery rather than an edit.
2. `check:pet-slide`, above.
3. Seed 288's `noPathEndsNowhere`, now also caught by the new invariant with
   exact geometry: a neighbour's deck at across -14.00 to -5.20 inside site
   152's reservation. **It is not a reservation-width defect** — the width
   shrink did not move it at all.
4. The remaining `pathsRunOnGridAxes` diagonals (131, 208, 225, 451): give the
   door a short axis-aligned arrival rather than refusing the diagonal.
5. `pointStandsOnBridgeMasonry` still calls everything inside `site.halfWidth`
   "road" while `segmentCutsABridgeRamp` no longer does. Untouched this leg, on
   purpose — move it alone, measure it alone. Note the new invariant now gives
   the real numbers to move it to: the road is `|across|` <= ~1.4, the wall
   ~1.4-2.5, and everything out to 5.5 is plain grass.
6. Delete the `tmp-*` probes and the debug exports; rebase when #474 lands.

---

## State — 2 Sep, sixth leg: the two-pass reservation release, BUILT AND KEPT

**`check:park`: 10 of 16 green, stranded 21 -> 20** (seed 288 3 -> 2). Nothing
regressed. `test:procgen` unchanged at **10 failed | 1399 passed** — the same
ten, so the two-pass neither fixed nor broke an invariant.

### What was built

`pathGraphSearch` is now a loop around the old body (`pathGraphSolveOnce`):
solve, ask which sites a leg really crossed at, release the reservations of the
rest, solve again. `dropScreenDependentMemos()` drops the three memos
downstream of the screen between passes — `latticeCache` (its `nodeOk` carries
`onRamp`), `pathGridCache`, `gateCorridorDeepestCache`. Each was checked, not
assumed; the other module caches are inputs to the screen rather than outputs
and are deliberately kept, being the expensive ones.

`sitesTheNetworkCrossesAt` reads **the solver's own bookkeeping**: a site's
deck is the one mandatory edge that crosses the railway, so a route crosses
there exactly when that edge is in `pavedGridEdges`. It **also** tests the
drawn polylines, and that is not padding — `crossings.ts` decides where a
bridge really goes from where *drawn* paths touch the rail, so a ribbon laid by
the rescue router can put a crossing at a site whose deck edge was never paved.

**The screened set only ever grows.** It starts as the sites the fully-screened
solve crossed at; every later pass adds whatever that pass crossed at. That is
what makes the loop terminate (finitely many sites) and what makes it sound (at
the fixed point every crossed site is screened, so no bridge stands on ground
the solve left open).

### Two things measured here that the next reader must not re-run

**1. Also dropping a released site's deck edge.** "Released" then means the
whole decision — no ground reserved, no crossing offered — which is
self-consistent and settles on the second pass every time. It measured
**worse**: seed 5 `poi.stranded` **10 -> 12**, seed 288 3 -> 2, green 10 -> 10,
total **21 -> 22**. It forecloses a crossing the freed ground would have made
attractive. Recorded in the code where the next reader meets it.

**2. The oscillation, which is why the loop is shaped this way.**
`scripts/tmp-passes.mts` on seed 5, with the deck edges left in and the release
judged afresh each pass:

```
[pass 1] used=[156]              release=[0,74,246]
[pass 2] used=[0,74,156,246]     release=[]
[pass 3] used=[156]              release=[0,74,246]
```

Releasing the ground in front of a site makes its crossing attractive, so the
site becomes used, so it must be screened, so it stops being used. There is no
fixed point for "release exactly the unused sites"; there is one for "screen
everything ever used".

### THE HEADLINE IS HONEST AND IT IS NOT THE ONE THE BRIEF EXPECTED

**Seed 5 is unchanged at 10, not green.** The earlier hard-coded release
(`LGP_DIAG_UNUSED_SITES=0,74,246`) that took seed 5 to green did so by leaving
those three crossings *available* while their ground was *unscreened* — the
router then crossed at all four sites, and the extra bridges connected the
park. That is masonry on ground no ribbon was kept off: issue #414, not a win.
The measurement was right; **the conclusion drawn from it was wrong, and this
is the correction.**

So the prize claimed in the fifth leg ("expected: seed 5 10 -> 0, taking the
pool to 11 of 16") **is withdrawn**. The two-pass buys one waypoint on seed 288
and closes a real conceptual defect; it does not buy seed 5.

**What is actually in seed 5's way, and it is the next thing to chase:** site
0's reservation swallows the gate corridor for its whole 24 m
(`pointStandsOnABridgeRamp(0, 54)` is true on seed 5), so the gate cannot reach
the ring. The gate's own exemption ladder — Fix 1 of the third leg, which
exempts by identity the reservation the handover stands in — is not reaching
far enough on this seed. **Chase the gate ladder, not the reservation.**

### A SECOND branch-introduced red check, and the reason both stayed hidden

**`check:park-boot` fails on this branch and passes on `origin/main`** — the
same shape as `check:pet-slide`, found the same way, and it is **not** this
leg's two-pass (measured below).

| commit | `check:park-boot` | worst single `advance()` |
|---|---|---|
| `origin/main` (bd818210) | **exit 0 — passes** | 11.0 ms |
| `ca5db30f`, before this leg's two-pass | exit 1 | 14.6 ms |
| `b61c8554`, this leg's head | exit 1 | **13.9 ms** |

Against an 8 ms budget. So the branch's path rework made the boot's worst slice
heavier and nobody had seen it.

**The two-pass did not cause it and did not worsen it** — 14.6 ms before,
13.9 ms after, i.e. marginally *better* and inside the noise, despite the solve
now running two to three times. The reason is in the check's own words: *"that
worst slice was no generator step at all, 0 work units in 13.9 ms, during
'joining up the paths'"*. The worst slice is not the solve's own work, so
adding passes to a **sliced** generator does not land on it. That is worth
knowing before anyone optimises the wrong thing.

**Why both reds were invisible: `pnpm run check` is a single `&&` chain, and
`check:pet-slide` is step 21 of 58.** Everything after it — including
`check:park`, `check:park-boot`, `check:solve-cost`, `check:waypoints`, and
about thirty-five others — never runs at all once it fails. The chain reports
one failure and stops, so "check is red on pet-slide" was concealing a second
red and could have been concealing more.

**Run the tail of the chain individually on this branch until pet-slide is
fixed.** Done this leg, directly: `check:solve-cost` **exit 0**,
`check:waypoints` **exit 0**, `check:park-boot` **exit 1** (above). The rest of
the tail is still unmeasured.

### This leg's gates, exit codes read and unpiped

- `pnpm exec tsc --noEmit` **0**; `pnpm run build` **0**.
- `pnpm run test:procgen` **exit 1**, `10 failed | 1399 passed (1409)` — the
  identical ten to before the two-pass, so it neither fixed nor broke an
  invariant.
- `pnpm run check` **exit 1**, on `check:pet-slide` (not this leg's, and the
  Overseer has a separate agent on it against #474 — stay off it).
- `check:park` sweep: **10 of 16 green, 21 -> 20 stranded**.

---

## State — 2 Sep, seventh leg: the gate located, and it is the two-definitions bug

### Seed 5's gate: measured to a single site, and to a single line of code

`scripts/tmp-gate.mts` on seed 5 — the whole authored corridor, every metre of
it, stands inside a bridge reservation:

```
deepest: '0.00,54.00'   START_Z: 54   INNER_Z: 30   onRampAtStart: true
  z=54 side=-1 railDist=18.0 ramp=Y
  ... every z from 54 down to 30 ...
  z=30 side=1  railDist=6.0  ramp=Y
gates: [{ mouth: '0.00,54.00', links: 9,
          reachableFromRing: false, routes: false,
          nearestReachable: '35.0m at 21.6,26.5' }]
```

`scripts/tmp-whichsite.mts` on five points down that corridor (z = 54, 48, 42,
36, 30) names the culprit, and it is **one site, the same one every time**:

```
site 0 railD=0   at (0.0,36.0):   cutWithThisSiteExempt=false   <- exempting it clears the leg
site 1 railD=74  at (63.0,9.0):   cutWithThisSiteExempt=true
site 2 railD=156 at (12.4,-42.1): cutWithThisSiteExempt=true
site 3 railD=246 at (-27.5,25.0): cutWithThisSiteExempt=true
```

Site 0 sits at (0, 36) — **on the gate's own axis**, 18 m in front of it, so the
gate corridor runs straight down the middle of that site's reservation. A
single-site identity exemption is provably sufficient for every corridor *leg*.

### So why is the gate still unreachable? The nodes and the edges disagree

`nodeOk` (paths.ts ~1791):

```ts
const onRamp = pointStandsOnBridgeMasonry(x, z);
nodeOk[index] = clear && !inRing && !onRamp && rail.dist >= RAIL_CLAMP_DISTANCE ? 1 : 0;
```

`pointStandsOnBridgeMasonry` refuses only the **parapet ring**,
`(halfWidth, halfWidth + margin]` — everything inside `halfWidth` it calls
road. `segmentCutsABridgeRamp` forbids the **whole** reservation, `inner = 0`,
since this branch's own change.

**So lattice nodes are created on ground no edge is allowed to reach.** The
gate's handover has nine links it may use and nothing on the far end of them
that joins anywhere: an island of nodes standing in the middle of a rectangle
every edge must go round. `nearestReachable: 35.0 m` is that island's distance
to the rest of the park.

**This is exactly the `pointStandsOnBridgeMasonry` item the brief has carried
for three legs — "two definitions of one piece of ground; move it alone,
measure it alone" — and it turns out to be seed 5's gate defect.** The two
converge; they are not separate work.

**Do NOT fix it by aligning the edges down to the nodes.** That is the
reservation shrink, built and measured on the fifth leg: seed 11 3 -> 22, seed
451 losing green. The alignment has to go the other way — nodes refused
wherever edges are refused — which is a *strengthening*, consistent with the
`inner = 0` decision, and it removes only nodes that were unreachable anyway.
**Not yet built or measured. It is one line, and it must be measured alone.**

### THE TAIL WALK: 37 masked steps run, and there are THREE branch-introduced reds

`pnpm run check` is one `&&` chain of **58** steps and `check:pet-slide` is step
**21**, so the 37 after it had never run on this branch. All 37 run
individually, exit codes recorded: **35 pass, 2 fail.** With pet-slide that is
**three** red checks, not one.

| check | `origin/main` | this branch | who |
|---|---|---|---|
| `check:pet-slide` | passes | **fails** | Overseer has an agent on it, against #474 |
| `check:park-boot` | passes (11.0 ms) | **fails** (14.6 ms before this leg's two-pass, 13.9 ms after) | not this leg's |
| `check:arrival-completes` | passes | **fails** | not this leg's — identical numbers before the two-pass |

The other 35: `orientation sky-view space-night waypoints seed-pool park
fountain-hop park-map hud-during-rides solve-cost jitter castle benches
castle-floors hall-solid hotel tap-spacing look-around nav-routes
path-preference rail-race cart-shape tie-frame cruiser-solves
cruiser-turn-radius cruiser-clearance castle-window backpack-peek
statue-occlusion keyring-hang keyring-view climb-wave cat-bus
cat-bus-suspension bus-journey` — **all exit 0**.

#### `check:arrival-completes`, the one nobody knew about

```
check:arrival-completes FAILED
  - the looping frames drain 4.0 steps each against 7.7 while rolling — the
    overrun is draining no faster than the ride, so `overrunAwareBudgetMs`/
    `overrunning` is not applying the overrun budget once the ride is over
```

Bisected. **Not this leg's** — byte-identical figures at `ca5db30f`, before the
two-pass (125939 steps, 31242 frames, 4.0 against 7.7). On `origin/main` it
**passes**, draining 9.2 against 7.7.

#### The two non-pet-slide reds probably share one root, and it is this branch

Put the two side by side:

```
origin/main    992462 generator steps, 107718 frames, loop drains 9.2/frame (1.2x rolling)  PASSES
this branch    125939 generator steps,  31242 frames, loop drains 4.0/frame (0.5x rolling)  FAILS
```

The branch generates the park in **an eighth of the generator steps**. The
grid rework replaced the old street solver with far fewer, far **fatter**
steps. If steps were uniform, a 12 ms looping budget against an 8 ms rolling
one should drain *more* per frame, not half as many — 4.0 per frame under 12 ms
against 7.7 under 8 ms means the steps running during the looping phase cost
roughly three times what the early ones do.

That is the same disease `check:park-boot` reports from the other end — *"worst
single `advance()` 13.9 ms against an 8 ms budget"*, and *"that worst slice was
no generator step at all, 0 work units in 13.9 ms, during 'joining up the
paths'"*. **One root: this branch's path solve does too much between yields.**
Neither check is wrong; both are describing a solve whose steps are too coarse
to slice.

**That makes it this branch's debt, not #474's, for these two** — the grid
rework is where the step granularity changed. Fixing it means yielding more
finely inside `pathGridSearch`/`pathGraphSolveOnce`, not adjusting either
check's thresholds. Note this leg's two-pass does **not** contribute: on the
canonical seed all four sites are used, so the loop settles on the first pass
and adds no work at all — the byte-identical step counts above are the proof.

#### Recommendation on the `&&` chain (the Overseer's question)

**Yes — `check` should run every step and report the full set of failures.**
The evidence is this walk: the chain reported *one* failure when there were
*three*, and fixing pet-slide would have revealed park-boot, and fixing that
would have revealed arrival-completes — three sequential 16-minute discoveries
where one walk found all three. That is "a check that never runs is worse than
a check that fails" applied to the chain itself.

It is also mechanically safe to convert: parsed, not grepped, the chain is
**58 steps, all of the form `pnpm run <name>` (plus `tsc --noEmit`), with no
duplicates**. A runner over an explicit list is easier to diff than a 58-term
`&&` expression, which directly reduces the rebase hazard CLAUDE.md's own
"a check that never runs" section is about. Exit non-zero if any step failed,
so zero-tolerance is unchanged. **Not built — it is a `check`-chain change and
belongs on its own PR, not buried in this one.**

### `pointStandsOnBridgeMasonry`: moved alone, measured alone — NEUTRAL, and my gate diagnosis was WRONG

The one-line alignment, built exactly as the previous section prescribed:
`nodeOk`'s `onRamp` from `pointStandsOnBridgeMasonry(x, z)` (the parapet ring
only) to `pointStandsOnABridgeRamp(x, z)` (the whole reservation, the same
rectangle every edge is screened against). `tsc --noEmit` exit 0.

**It changes nothing at all.**

| measurement | before | after |
|---|---|---|
| `check:park`, all sixteen seeds | 10 green, 20 stranded | **identical, seed for seed** |
| `test:procgen` | 10 failed / 1399 passed | **10 failed / 1399 passed** |
| seed 5's gate (`tmp-gate.mts`) | `links: 9`, `nearestReachable: 35.0m at 21.6,26.5` | **byte-identical** |

**So the previous commit's claim — that this disagreement is seed 5's gate
defect — is refuted, and I am recording it as wrong rather than quietly moving
on.** The two definitions really do describe different ground, and the
reasoning about islands is sound in the abstract; it is simply **not
load-bearing on this pool**. The lattice is on a 12 m pitch and a reservation
is about 11 m across, so hardly any lattice node lands in the disputed band in
the first place. The gate's nine links are gate-corridor handover nodes, not
lattice nodes, so `nodeOk` never had anything to say about them.

**Reverted** (restore verified by grep: the `pointStandsOnBridgeMasonry` line is
back, the `pointStandsOnABridgeRamp` one is gone), on this branch's own standing
rule that a change measuring nothing is not kept — the same rule that retired
the `relayPolyline` line-set addition and the shorter-tailed elbow corner. My
justification for it was the gate diagnosis, and once that fell there was
nothing left but an unmeasured refactor on a branch already carrying three red
checks.

**What this leaves for whoever takes the gate.** The disagreement is real,
latent, and now measured to cost nothing today — so it is a tidy-up, not a fix,
and it must not be sold as one again. Seed 5's gate is still unexplained past
this point: site 0's reservation demonstrably swallows the whole corridor
(`tmp-whichsite.mts`, one site named at every metre of z 54..30, and
`cutWithThisSiteExempt=false` for it), a single-site identity exemption is
provably enough for every corridor *leg*, and yet the handover still cannot
reach the ring. **The next question is what the nine links actually connect
to** — they are at (5.1, 57.3), (-6.9, 57.3) and (-6.9, 45.3), all of them
short of the railway — and why that cluster is 35 m from the nearest reachable
node. Start there, not at `nodeOk`.

### CORRECTION: the two reds are NOT "fat path-solve steps". I read the wrong line.

**Withdrawn in full.** The previous section claimed `check:park-boot` and
`check:arrival-completes` share one root — this branch's path solve doing too
much between yields — on the strength of the line *"that worst slice was no
generator step at all, 0 work units in 13.9 ms, during 'joining up the
paths'"*. That is a **narration** line, not the failure. The actual failure,
the only `-` line the check emits, is:

```
  - the cruiserFinish phase was divided into only 11 pieces, against 12 the
    algorithm admits — it is being done in lumps the driver cannot stop in the
    middle of, which is a stutter on any device slow enough to notice
```

`MIN_UNITS.cruiserFinish` is a hard-coded floor of **12** in
`scripts/check-park-boot.mts`; this branch produces **11**. Nothing to do with
the paths.

And the "0 work units" line I built the theory on **cannot mean what I took it
to mean**: the check's `Phase` union is
`brief | cruiserSearch | cruiserFinish | trainSearch | slideSearch` — **there
is no counter for the paths solve at all**. So any slice spent in the paths
phase necessarily reports "no generator step at all, 0 work units". It was
never evidence about the paths; it is evidence that the check is blind to them.

The work units, side by side, which is what I should have quoted first:

| phase | `origin/main` | this branch |
|---|---|---|
| brief | 152 | 152 |
| cruiser search | 523721 | **22973** |
| **cruiser finish** | **19** | **11** ← the failure |
| slide search | 468570 | **102803** |

So the branch's park makes the **cruiser and slide searches** far shorter — the
8x difference in total generator steps is those two, not the path solve — and
the cruiser's finish phase comes out one piece under a hard floor.
`check:arrival-completes`'s drain-rate comparison is downstream of the same
changed unit mix.

**They do share a cause — the branch's park re-rolls these two searches much
smaller — but it is not the one I named, and "fix the yielding inside
`pathGridSearch`" is the wrong instruction.** Do not act on it.

**What the next reader should actually settle**, and it is one question:
is `cruiserFinish` at 11 *the same seams yielding on a legitimately shorter
loop*, or *a seam that stopped yielding*? There is a direct precedent for the
first in the same file — `trainSearch`'s floor was lowered 100 -> 60 on
2026-08-23 when the statue-ring layout re-rolled the canonical park and its rail
loop legitimately solved smaller (224.6 m, was 359). If this is that, the floor
is prosecuting a quicker solve; if it is not, it is a real granularity
regression. **Measure before touching the floor** — CLAUDE.md's "never weaken an
assertion" stands, and the trainSearch precedent was paid for with a
measurement, not an argument.

**Also worth fixing while someone is in there:** the paths solve has no unit
counter, so the largest phase on this branch is invisible to the boot check and
reports as "no generator step at all". That is an instrument gap of exactly the
kind CLAUDE.md's "a check can pass without checking anything" section is about —
and it is what let me build a whole theory on a line that could only ever have
said zero.

### `cruiserFinish` at 11: the benign explanation is RULED OUT, measured

The one question the previous section left — *same seams on a legitimately
shorter loop, or a seam that stopped yielding?* — is answered, and it is not
the benign one:

```
origin/main    cruiser solved in slices: 301.2630 m, loop 1d17280bfe89   cruiserFinish 19 pieces
this branch    cruiser solved in slices: 345.4336 m, loop 43d37a7cad49   cruiserFinish 11 pieces
```

**The branch's cruiser loop is 44 m LONGER and yields 8 fewer times.** The
`trainSearch` precedent in the same file — a floor lowered because a layout
change re-rolled the park and the loop legitimately solved *smaller* — is
therefore the opposite case and does not apply here. **Do not lower
`MIN_UNITS.cruiserFinish`.**

Where to look: `finishCruiserPlanSearch` (`src/world/coaster/solve.ts:247`)
yields entirely through `coasterProfileSearch`
(`src/world/coaster/route.ts:1298`), whose seams are a handful of fixed
`yield 0`s — a fixed count, independent of loop length. A fixed-count generator
producing 19 on one park and 11 on another means **some of those seams are
being skipped**, so the next step is to find which of them are inside a
conditional and which condition this branch's park changes. That is a Sky
Cruiser question, not a paths one, and it wants whoever owns that code.

**Still unattributed:** whether this originates on this branch or on the still
open #474 beneath it. Both were measured only against `origin/main` and against
this branch; nobody has run `check:park-boot` on `feat/park-warp-solver` alone.
That single run splits the ownership and is the cheapest next measurement on
this whole item.

### OWNERSHIP SETTLED: all three red checks belong to #474, not to this branch

The measurement named above, taken. `feat/park-warp-solver` at `1c5a4c5e`, run
on its own:

| check | `origin/main` | **#474 alone** | `feat/grid-paths` |
|---|---|---|---|
| `check:pet-slide` | passes | **fails** | fails |
| `check:park-boot` | passes | **fails** | fails |
| `check:arrival-completes` | passes | **fails** | fails |

Every figure on #474 is **byte-identical** to this branch's: work units
`brief 152, cruiser search 22973, cruiser finish 11, slide search 102803`;
cruiser `345.4336 m, loop 43d37a7cad49`; arrival `125939 generator steps`,
`4.0 while looping against 7.7 while rolling`; pet-slide `88% of 8 rasters`.

**So `feat/grid-paths` introduces none of them and inherits all three.** The
grid rework is not the cause of the changed unit mix — #474's park warp is,
since the cruiser and slide searches re-roll with the park.

That also confirms the Overseer routed `check:pet-slide` correctly, and puts
`check:park-boot` and `check:arrival-completes` with the same owner rather than
with this branch. **This branch cannot go green on `pnpm run check` until #474
does**, which is worth knowing before anyone treats these as blockers on the
path work.

The open technical question is unchanged and stays with #474: a fixed-seam
generator (`coasterProfileSearch`) yields 19 pieces on `main`'s park and 11 on
#474's, on a loop that is 44 m **longer** — so seams are being skipped, and
`MIN_UNITS.cruiserFinish` must not be lowered to accommodate it.

---

## Seed 5 IS NOT A GATE DEFECT: half the park's grid has no ring gateway in it

`scripts/tmp-north.mts` (`debugGridNodes`) on seed 5, whole park. The numbers
settle it in one line:

```
total nodes: 106      REACHABLE: 28
components:  comp0 71 nodes   comp4 26   comp5 2   comp2 2   comp1/3/6/7/8 1 each
```

**`comp0` holds 71 of the park's 106 grid nodes — the entire north and west —
and not one of them is reachable.** The 28 reachable nodes are `comp4` (26) and
`comp5` (2), all of them east and south. The northernmost reachable node in the
whole park is `(21.6, 26.5)`.

### The gate is a symptom; the bridge does not help

The gate's nine links go to `(5.1,57.3)`, `(-6.9,57.3)` and `(-6.9,45.3)`.
Those are ordinary lattice nodes and they are all `comp0`. So is site 0's north
foot `(0.0, 55.4)`, and — this is the part that matters —

```
(0.0,55.4)  comp=0  nbrs=[0.0,16.6  5.1,57.3  -6.9,57.3  -6.9,45.3]
(0.0,16.6)  comp=0  nbrs=[0.0,55.4  -6.9,21.3  -6.9,9.3]
```

**the bridge deck edge is present and works.** It carries you from `(0,55.4)`
across the railway to `(0,16.6)` — and lands you in the *same* orphaned
component. Crossing the railway on seed 5 gains nothing, because both banks of
that crossing are in `comp0`.

That retires the whole gate-ladder framing, including my own last two
diagnoses. The gate corridor being swallowed by site 0's reservation is true and
irrelevant: even with a perfect corridor and a working bridge, there is nowhere
to arrive.

### Where the cut actually is: the ring's own guard zone

The two big components meet along the plaza, and the nodes that would join them
are simply absent:

```
comp0   (-6.9, 9.3)   (-6.9, 21.3)   (0.0, 16.6)
comp4   (17.1, 9.3)   (29.1, 9.3)    (-6.9, -14.7)
absent  (5.1, 9.3)    (5.1, -2.7)    (-6.9, -2.7)
```

The lattice residues put `PLAZA` at about `(5.1, -2.7)` — dead centre of that
hole. `nodeOk` refuses `inRing`, so **the statue circle's guard zone cuts the
lattice clean in half**, and the only sanctioned way across it is the four
compass gateways (`grid.ringNodes`), which are the search's only paved sources.
`paths.ts`'s own note states the rule: *"the bridge feeds one of the four
compass gateways, not a fifth connection of its own."*

**On seed 5 all four gateways landed in the east/south component.** `comp0` —
71 nodes, the gate, the hotel quarter, and a working railway bridge — contains
no gateway at all, so nothing in it can ever be routed to. That is precisely
seed 5's `poi.stranded: 10` and its eleven stranded destinations (`building`,
`hotel`, `ballPit`, `ferrisWheel`, `dodgems`, `stall.skyCruiser`,
`stall.spaceFerrisWheel`, `stall.dodgems`, `exit-skyCruiser`,
`exit-ginormousSlide`, `exit-ferrisWheel`).

### What to build, and what not to

**Not** a wider gate exemption, **not** a narrower reservation, **not** a
`nodeOk` change — all three measured neutral or worse on this branch already.
The defect is that **the ring's gateway placement is not required to serve every
component the guard zone creates.** Four gateways at fixed compass bearings is a
rule that cannot notice it has orphaned half the park.

The honest fix is the standing procgen rule applied to the gateways: after the
lattice is built, check which components the ring's guard zone has severed, and
**place or move a gateway into any component that has none** — backtracking on a
real, measured collision rather than trusting four fixed bearings. That is one
generator making a different decision when its first one demonstrably failed,
which is exactly what CLAUDE.md asks for, and it is a rule the generator can
honour alone: it needs only the lattice and the ring, both of which exist before
any route is solved.

`debugGridNodes` already reports component ids, so the measurement is in place
and a `check:park`/invariant clause could assert it directly: **no lattice
component of more than N nodes may be without a ring gateway.**

---

## State — 2 Sep, eighth leg: ring gateways backtrack. 11/16 green, 10 stranded.

### Built and kept: a gateway that finds nothing on its own line is rescued

`streetLattice`'s four compass taps walked three cells out along their own
lattice line and, finding nothing valid, were **dropped**. The rescue rung
tries an axis-aligned **elbow** from the same rim to a nearby node, preferring a
lattice component no other tap serves.

**Decision 5 is untouched.** `rim` is still one of `RING_COMPASS_POINTS` on
every tap, so the ring keeps exactly four gateways at four compass points; only
*which node* a gateway may reach is widened. The elbow (rather than a straight
rim-to-node line) is deliberate — a straight line to an off-line node is a
diagonal, which is what `pathsRunOnGridAxes` and Jim's complaint #3 are about.

Two constants, both taken from something that already means something:
`TAP_RESCUE_REACH = 3 * STREET_PITCH` (the same reach the straight rung already
walks, expressed as a radius), and `UNSERVED_COMPONENT_REPORT = 12` (a `poiGraph`
lane samples about every 7 m, so a dozen nodes is a district a child would walk
for a minute).

### Measured, all sixteen seeds

`check:park`: **10 green -> 11, stranded 20 -> 10. Nothing regressed.** Seed 5
goes green (28 reachable of 106 -> 101 of 108).

Every seed now gets **4/4 taps**; before, several ran with three or two. Nine of
sixteen gain a rescued gateway — **canonical, 5 (two), 11, 115, 225, 267, 288,
346 (two), 451**.

### The visible change, for Jim's eye when the branch is showable

A rescued gateway is **a street leaving the plaza that was not there before**,
and it leaves on the same compass point but bends once to reach its node. Nine
of the sixteen seeds look different at the plaza; the two-tap seeds (**5** and
**346**) change most. Seed 5 changes beyond the plaza as well — the entire north
and west of that park is now reachable, so the hotel quarter, the gate approach
and the whole north side gain paving they never had. **That one is worth the
screenshot when the branch is showable**: it is the clearest picture on the
branch of what "paths that actually go to useful places" means.

### The honest trade

`test:procgen` **10 failed -> 12**. Seed 5's `noPathEndsNowhere` is **fixed**;
three appear:

| test | seed | why |
|---|---|---|
| `pathsRunOnGridAxes` | 267, 346 | both gained rescued taps, so new streets leave the plaza and route shapes move |
| `builtMasonryStaysInsideItsReservation` | 5 | **this branch's own new invariant**, firing on ground that was unroutable until now — a defect newly *exposed*, not introduced |

Kept, because half a park being unreachable is a worse fault than two grid-axis
complaints, and because the third is an invariant doing its job. **The next leg
owes all three.**

### THE PROPOSED INVARIANT WOULD BE RED ON GREEN PARKS — not shipped, and why

The brief was to assert "no sizeable lattice component without a ring gateway".
**Measured, it cannot be shipped as written.** `latticeComponentsWithoutAGateway()`
after the fix:

```
canonical  orphanedComponents=[43]     check:park GREEN
5          orphanedComponents=[39]     check:park GREEN
11         orphanedComponents=[12]
225        orphanedComponents=[26]
267        orphanedComponents=[13]     check:park GREEN
every other seed  []
```

**Canonical carries a 43-node orphaned component and passes everything**; so does
seed 5 now, with 39. An orphaned *lattice* component is not the same thing as
unreachable *park* — those nodes may host no destination, or their destinations
may be reached by a connector or the rescue router instead. Asserting emptiness
would prosecute three parks that demonstrably work.

It also breaks `invariants.ts`'s own **rule 1**: *measure the built park, never
the rules that built it*. A lattice component is the generator's scaffolding,
not the park. The question that matters — can a child reach everything — is
already owned by `poi.stranded` and `route.unreachable` in `check:park`, which
is exactly what caught seed 5 in the first place.

So: **no assertion added.** `latticeComponentsWithoutAGateway()` is exported and
`scripts/tmp-taps.mts` reports it, because the number is a good diagnostic and it
is how this defect was found. Tuning a threshold until canonical passed would
have been fitting the assertion to the pool, which this branch has refused three
times already.

### CORRECTION TO THE 11/16 HEADLINE — it is 10/16, and here is the whole trade

**The 11/16 reported at the end of the gateway-rescue commit was measured
before a bug in that same commit was found.** `link()` was handed `[]` instead
of `tap.via`, so a rescued gateway's **elbow was drawn as a single straight
rim-to-node line**. That line is a diagonal, and — the part that matters — it
is a line **neither of whose legs had been screened**: the elbow's two legs are
validated with `streetSegmentClear`, the straight line between their endpoints
never was, so the ribbon could be drawn through a plot. Fixing it is not
optional.

Fixed, and it costs seed 267 its green. **The honest running total for this
leg:**

| | at leg start | gateway rescue | **+ `via` fix (final)** |
|---|---|---|---|
| `check:park` green | 10 | 11 | **10** |
| `check:park` stranded | 20 | 10 | **13** |
| `test:procgen` failed | 10 | 12 | **11** |

So the leg's real result is **stranded 20 -> 13, green unchanged at 10,
`test:procgen` 10 -> 11**. Seed 5 goes from `poi.stranded: 10` to green; seed
267 goes from green to 3.

**Do not report 11/16.** It was true of a build with an unscreened ribbon in it.

### What the three owed items came to

- **`pathsRunOnGridAxes` on 267** — **fixed**, and it was my own bug (the
  dropped `via`), not a routing problem.
- **`pathsRunOnGridAxes` on 346** — **not fixed, and it is not a new class.**
  It is now `gate-approach runs diagonally for 21.5 m, from (-0.1, 31.0) to
  (-15.2, 15.7)`, which is the **head-on arrival shape's diagonal leg** — the
  known open item the fourth leg measured and reverted, and which the brief
  names as "give the door a short axis-aligned arrival rather than refusing the
  diagonal". My gateway change altered which node the gate reaches on 346 and
  so triggered it there. It joins 131, 208, 225 and 451 in that one class.
- **`builtMasonryStaysInsideItsReservation` on seed 5** — **not fixed**, and
  the geometry is now recorded: site at **(0.0, 36.0)**, railDistance 0.0,
  masonry reaching **14.92 m** against a **5.50 m** screen, walkable deck
  spanning across **-1.40 to 14.00**. That span is two decks in one rectangle —
  the site's own (centred, out to -1.40) plus a neighbour's at +14 — which is
  the **same shape as seed 288's** (across -14.00 to -5.20 at site 152). Two
  seeds, one defect: `footprintsOverlap` lets a bridge be planned inside
  another site's reservation. Chase them together.

### Seed 267's regression is the one loose end of this leg

Green -> `poi.stranded: 3`, caused by drawing the elbow correctly rather than
as a shortcut. **Measured and ruled out:** restricting the rescue to taps that
serve an unserved component changes nothing on any of the sixteen seeds — 267's
rescued tap *is* serving an unserved component, so that is not the explanation.
The remaining hypothesis, untested: the elbow at
`(-3.2,-10.4) -> (-15.2,16.5)` is a long two-legged gateway that the router
then prefers over better routes. Worth trying **the other corner** (the elbow
has two, and the code takes the cheaper) and, if that fails, pricing a rescued
tap above a straight one so it is used only when nothing else serves.

---

## State — 3 Sep, ninth leg: the two-decks failure is TWO false positives, not one defect

**Baseline confirmed at `df7ecac4`, all sixteen seeds** (`scripts/tmp-sweep.sh`):
10 green, 13 stranded — canonical, 5, 115, 128, 131, 208, 274, 346, 428, 451
green; 11 (3), 24 (2), 225 (2), 267 (3), 288 (2), 326 (1).

### The brief's premise is refuted: seeds 5 and 288 are not one defect, and neither is a defect

`scripts/tmp-twodecks.mts` attributes every deck found in a site's sweep to the
bridge that built it and to *that* bridge's own site.

```
seed 5   site railD=0 at (0.0, 36.0)  screen=5.50  worstFace[±14]=14.87  FAILS TODAY
           foreignDeckInsideReservation=FALSE
  bridge#0 across[±14] [-1.30, 1.30]  INSIDE RESERVATION: [-1.30, 1.30]  OWN
  bridge#3 across[±14] [13.60, 13.95] INSIDE RESERVATION: none           FOREIGN
           (its site railD=246 at -27.5,25.0;
            planner-rects overlap=false, reservation-rects overlap=FALSE)
  control 1 (frame): own bridge centred at across 0.00 — frame ok
```

**Seed 5 carries no defect at all.** The foreign deck is bridge #3, standing on
its own site 29 m away; it is at `across` 13.60–13.95, entirely **outside** site
0's 5.50 m reservation, and the two reservation rectangles provably do not
overlap. All four of seed 5's bridges are centred on their own sites at
`across` 0.00 and reach outer faces of 2.22 / 2.22 / 2.02 / 2.12 against
screens of 5.50 / 4.50 / 5.50 / 4.50.

**The cause is the invariant's own sweep.** `builtMasonryStaysInsideItsReservation`
runs `across` from **−14 to +14 whatever the reservation's half-width is**, so it
sees any bridge within 14 m of a site's strip and then prosecutes that bridge
against *this* site's band. Two bridges 29 m apart with disjoint reservations
therefore convict each other. It is a verdict about ground it is not describing.

```
seed 288 site railD=152 at (-18.9, -56.4)  screen=5.50  worstFace[±14]=14.92  FAILS TODAY
           foreignDeckInsideReservation=true
  bridge#0 across[±14] [-14.00, -5.20]  INSIDE RESERVATION: [-5.50, -5.20]  FOREIGN
           (its site railD=0 at -2.0,-34.0;
            planner-rects overlap=false, reservation-rects overlap=TRUE)
```

Seed 288 *is* the documented `footprintsOverlap` gap — reservation rectangles
overlap, planner rectangles do not — but the trespass is **0.30 m** of deck
(`across` −5.50 to −5.20), not the 14.92 m the failure message quotes, and the
next measurement shows it harms nothing.

### The property the invariant is FOR holds on every seed measured

`scripts/tmp-stoneground.mts` asks the question directly, of the one owner:
every deck sample of every built bridge, against `pointStandsOnABridgeRamp`
(the boolean face of `bridgeSiteReserving`, which honours
`releasedCrossingSites`). Both controls discriminate — a bridge's own centre
reports screened, a point 400 m outside the park reports open.

```
seed 5         4 bridges, 1265 / 1537 / 1298 / 1101 deck samples, 0 on OPEN ground
seed 288       1 bridge,  1555 deck samples, 0 on OPEN ground
seed canonical 4 bridges, 1285 / 1534 / 1011 / 1191 deck samples, 0 on OPEN ground
```

**Not one square metre of built masonry stands on ground a ribbon was allowed
onto.** That is the whole point of the invariant, and it is satisfied.

### Why seed 288's 0.30 m trespass is not a defect either

The same run prints the release state, and it settles it:

```
seed 288  site railD=0   at (-2.0, -34.0)  -- its own centre is SCREENED
          site railD=152 at (-18.9, -56.4) -- its own centre is RELEASED (open ground)
```

Site 152 **has no bridge of its own and the two-pass released its rectangle**,
so it is not reserved ground: there is nothing for a neighbour to trespass in.
And the neighbour's stone is itself screened — every sample of bridge #0 lies
inside site 0's own (screened) reservation. Nothing can be drawn there, and
nothing walks into it.

Note this contradicts, on today's park, the note at `paths.ts` ~4786: *"seed 288
... has no bridge of its own, but a neighbouring bridge's deck stands inside its
rectangle. Releasing by deck presence would un-screen that neighbour's real
stone."* The neighbour's stone is un-screened by nothing, because site 0 screens
all of it. The reasoning holds in general; it is not load-bearing here.

### What is therefore owed

The invariant must be rewritten to ask the reservation's real questions, and
this is a **strengthening plus a correction**, not a relaxation:

1. **own masonry stays in** — sweep each site's *own* bridge, `across`
   unbounded, and require its outer face within that site's `screenHalfAcross`.
   (Unchanged in intent; it stops being confounded by neighbours.)
2. **no masonry on open ground** — every deck sample of every built bridge must
   satisfy `pointStandsOnABridgeRamp`. This is strictly stronger than the old
   direction 2: the old form could only fire when a neighbour pushed the
   per-site maximum past the band, and was blind to stone on genuinely
   unreserved ground anywhere else.

Both must be proved red by mutation, with the geometry they were proved against
recorded beside the transcript.

**Do not "fix" seeds 5 and 288 by touching `footprintsOverlap`.** Widening it to
the reservation is already on the refuted list (288 loses a bridge,
`route.unreachable: 2`), and on this measurement there is nothing in either
park for it to fix.

### The sixteen-seed sweep found a REAL defect nothing has ever been able to see

`scripts/tmp-stoneground.mts`, all sixteen seeds, both controls passing on
every one (a bridge's own centre reports screened; a point 400 m outside the
park reports open, so the query is not `true` everywhere).

**Fourteen seeds clean. Two are not**, and the trespass is in the *`along`*
axis every time — the built ramp running off the end of the reserved
rectangle, with `across` comfortably inside the band:

```
seed 274  bridge#1 (site railD=312)  1295 deck samples,  50 on OPEN ground
  trespass along [-18.36, -16.93]  across [-1.64, 0.44]
  reservation   along [-16.90,  18.86]  across ±5.50        -> overruns by 1.46 m

seed 326  bridge#0 (site railD=44)   1231 deck samples,  15 on OPEN ground
  trespass along [ 15.93,  16.61]  across [-0.78, 1.00]
  reservation   along [-18.86,  15.92]  across ±5.50        -> overruns by 0.69 m

seed 326  bridge#1 (site railD=204)  1300 deck samples,  34 on OPEN ground
  trespass along [ 17.39,  18.35]  across [-0.96, 1.18]
  reservation   along [-18.86,  17.39]  across ±5.50        -> overruns by 0.96 m
```

**This is #414 exactly** — stone standing where a ribbon was never kept off —
and it is the *third* face of the same two-definitions drift: the reservation's
`along` extent is `DECK_HALF_LENGTH + the reach the site was PROVEN at +
RAMP_SCREEN_MARGIN`, and `bridgeFootprint.ts` builds a ramp longer than the
proof. Both seeds are `check:park` **green** and both **pass** the invariant
that exists to catch this.

**Why nothing could see it.** `builtMasonryStaysInsideItsReservation` sweeps
`along` from `-(DECK_HALF_LENGTH + rampReachNeg)` to
`DECK_HALF_LENGTH + rampReachPos` — it is bounded by the very rectangle it is
supposed to be testing against, so an overrun leaves the sweep rather than
failing it. It can only ever measure `across`. A check that is structurally
incapable of failing in one of its two axes.

**So the honest rewrite is a strengthening on both counts**, and it is not a
relaxation of anything: it drops a clause that convicts disjoint neighbours of
each other (seeds 5, 288 — measured, no defect in either park) and adds one
that catches three real trespasses on two seeds nobody had ever looked at.

### Built and kept: `bridgeScreenHalfAlong`, the reservation's length

One owner for the reservation's `along` half-length, replacing three copies in
`paths.ts` (`segmentCutsABridgeRamp`, `bridgeSiteReserving`,
`pointStandsOnBridgeMasonry`) and a fourth in the invariant. Built from
`SITE_RAMP_IDEAL` — `BRIDGE_RISE / BRIDGE_RAMP_GRADIENT`, the same expression
`idealRampRunFor` takes a `Math.min` of, so a true upper bound on every ramp
the builder is licensed to build, and known before a path is drawn.

**Not** from `site.rampReachPos` / `rampReachNeg`. Those are what
`crossingPlanSolve.ts` *proved* with its own margins and obstacle set;
`bridgeFootprint.ts` probes with `searchClear` (the real collision world plus
sibling guard rails) and routinely builds past the proof. That gap is the
0.69–1.46 m of unscreened stone on seeds 274 and 326.

This is the `along` axis getting exactly the treatment the `across` axis got
when `segmentCutsABridgeRamp`'s `inner` went to `0`: reserve the whole
rectangle the builder could occupy, not the one the proof happened to reach.

**Cured, same instrument, same controls, all four seeds re-measured:**

```
seed 274  bridge#0 1651 samples, 0 on OPEN ground   bridge#1 1295, 0
seed 326  bridge#0 1231 samples, 0 on OPEN ground   bridge#1 1300, 0
seed 5    all four bridges, 0 on OPEN ground
seed 288  bridge#0 1555 samples, 0 on OPEN ground
```

### Both clauses proved red, with the geometry they were proved against

**Clause (b)** was proved red by the real park, not by a mutation — the
transcript is the failure section above, and the geometry it was proved
against is: seed 274 site railDistance 312, built ramp reaching `along`
−18.36 against a reservation ending at −16.90; seed 326 sites railDistance 44
(`along` 16.61 against 15.92) and 204 (`along` 18.35 against 17.39). To arm it
again, restore `bridgeScreenHalfAlong` to
`DECK_HALF_LENGTH + site.rampReach{Pos,Neg} + margin` and run seeds 274 and
326; if the parks have since moved, the numbers above are what to look for.

**Clause (a)** has nothing in the pool that exercises it, so it was proved red
by mutation — threshold `site.screenHalfAcross` → `× 0.3` in `invariants.ts`
alone (which cannot move the park), seed 5:

```
FAIL seed 5 > a bridge's masonry stands inside the ground paths.ts reserved for it
  the bridge built on the crossing site at (0.0, 36.0), railDistance 0.0,
    reaches 2.22 m from that site's axis ... deck spans across -1.30 to 1.30
  the bridge built on ... (63.0, 9.0), railDistance 74.0, reaches 2.22 m ...
  the bridge built on ... (12.4, -42.1), railDistance 156.0, reaches 2.02 m ...
  the bridge built on ... (-27.5, 25.0), railDistance 246.0, reaches 2.12 m ...
  expected [ …(4) ] to have a length of +0 but got 4
```

Four real numbers against four real thresholds (5.50 / 4.50 / 5.50 / 4.50), no
`NaN`, no `Infinity`. The geometry: seed 5's four bridges, each centred on its
own site with a walkable half-width of 1.10–1.30 m. **Mutation reverted, revert
grep-verified** (0 occurrences of `MUTATION`, 1 of the clean comparison).

### Sixteen seeds, before and after — nothing moved

`check:park`, `scripts/tmp-sweep.sh`, at `df7ecac4` and at the fix:

| seed | before | after | | seed | before | after |
|---|---|---|---|---|---|---|
| canonical | 0 | 0 | | 267 | 3 | 3 |
| 5 | 0 | 0 | | 274 | 0 | 0 |
| 11 | 3 | 3 | | 288 | 2 | 2 |
| 24 | 2 | 2 | | 326 | 1 | 1 |
| 115 | 0 | 0 | | 346 | 0 | 0 |
| 128 | 0 | 0 | | 428 | 0 | 0 |
| 131 | 0 | 0 | | 451 | 0 | 0 |
| 208 | 0 | 0 | | 225 | 2 | 2 |

**10 green, 13 stranded, seed for seed identical.** Widening the reservation's
length cost no routing anywhere in the pool — which is worth knowing, because
the `across` widening on the fifth leg cost plenty.

### `test:procgen`, before and after — 11 failed -> 9, 1398 passed -> 1400

```
before (df7ecac4)   Test Files 11 failed | 16 passed (27)   Tests 11 failed | 1398 passed (1409)
after               Test Files  9 failed | 18 passed (27)   Tests  9 failed | 1400 passed (1409)
```

`builtMasonryStaysInsideItsReservation` is **green on all sixteen seeds** — the
two false positives (5, 288) are gone and the two real defects it newly found
(274, 326) are fixed. **No new failure of any kind.** The nine that remain are
the nine that were already there:

| test | seeds |
|---|---|
| `pathsRunOnGridAxes` | 131, 208, 225, 346, 451 |
| `streetsShareLatticeLines` | 5, 11 |
| `every path passes near a tree a child can climb` | 128 |
| `noPathEndsNowhere` | 288 |

`check:park` is unchanged seed for seed: **10 of 16 green, 13 stranded**
(`diff` of the two sweeps is empty).

### Where the next leg picks up

The main task is **done and closed, with its premise corrected**: seeds 5 and
288 were not one defect and were not defects at all, and chasing
`footprintsOverlap` would have been chasing nothing. Do not reopen it —
`footprintsOverlap` is untouched, and the refuted list it carries stands.

Still owed, in the brief's own order:

1. **`pathsRunOnGridAxes`, five seeds, one class** (131, 208, 225, 346, 451):
   the head-on arrival shape's diagonal leg. Bounding the leg is already
   measured and reverted. The open work is unchanged — **give the door a short
   axis-aligned arrival rather than refusing the diagonal and leaving the door
   to walk.**
2. **Seed 267, green -> 3.** Untested hypothesis stands: try the *other* elbow
   corner (the code takes the cheaper of two), then price a rescued tap above
   a straight one.
3. The remaining stranded to zero.
4. **Stage-2 invariant (b)** — "every destination's doormat is a paving
   terminal". Not started.
5. **`scripts/tmp-*.mts` and the debug exports are still in place** and should
   stay until the above is done — `tmp-stoneground.mts` in particular is the
   instrument that found the ramp overrun and the one to re-run after any
   change to a reservation or to `bridgeFootprint.ts`. Delete them in the
   commit that opens the PR, not before.
6. **Rebase onto `origin/main`** (this leg did not: `main` moved under the
   branch and the parent #474 is still open). `main` carries `check:coplanar`
   and its workflow, which this branch lacks.
7. The three inherited reds (`check:pet-slide`, `check:park-boot`,
   `check:arrival-completes`) are **#474's**, measured byte-identical on #474
   alone. This branch cannot go green on `pnpm run check` until #474 does.

### PLAINLY: which side changed, and where

The Overseer's question, answered without dressing it up. **Both sides
changed, and they are different changes with different worth:**

- **The assertion changed what it measures** — deliberately, and this is the
  part that must be scrutinised. `builtMasonryStaysInsideItsReservation` no
  longer sweeps `across` −14..+14 and prosecutes whatever it finds against the
  nearest site's band. That clause is *gone*, and with it seeds 5's and 288's
  failures.
- **`footprintsOverlap` was NOT touched.** The planner does not put two decks
  in one reservation any differently than it did at `df7ecac4`. Nothing in
  `crossingPlanSolve.ts` is in this diff.
- **A real source fix was made, and it is not the one the brief expected.**
  `bridgeScreenHalfAlong` in `paths.ts` — the reservation's length now comes
  from the builder's licence (`SITE_RAMP_IDEAL`) instead of the planner's
  proof. That fixed genuine unscreened stone on seeds 274 and 326.

**Why dropping the clause is not fitting the assertion to the pool**, and the
evidence rather than the argument:

1. Seed 5's two "overlapping" decks are **29 m apart** on sites whose
   reservation rectangles are provably **disjoint** (SAT, both rectangles, in
   `tmp-twodecks.mts`). Each bridge is centred on its own site at `across`
   0.00 with an outer face of 2.02–2.22 m against bands of 4.50–5.50 m. There
   is no defect in that park for a planner change to fix.
2. Seed 288's is **0.30 m** (`across` −5.50 to −5.20) into a rectangle the
   two-pass had **released** — not reserved ground at all — by a bridge every
   sample of which lies inside its own *screened* reservation. The failure
   message quoted **14.92 m** for it.
3. The clause **could not fail in one of its two axes at all**: it swept
   `along` between the bounds of the very rectangle it was testing against, so
   a ramp running off the end of its reservation left the sweep instead of
   failing it.
4. The replacement is a **net strengthening, and it proved it immediately** —
   asked the question the old clause could not, it caught three real
   trespasses (274 by 1.46 m, 326 by 0.69 m and 0.96 m) on two seeds that were
   `check:park` green and that *passed* the old invariant. Those were fixed in
   `paths.ts`, not in the assertion.

If a reader wants one sentence: **the old clause failed two parks that are
sound and passed two parks that were not, and the replacement reverses both.**
The seed count moving was a consequence, never the goal — and it moved because
two real defects were found and fixed, not only because two false ones were
dropped.

### This leg's gates, exit codes read and unpiped

- `pnpm exec tsc --noEmit` **0**; `pnpm exec tsc --noEmit -p tsconfig.test.json`
  **0**; `pnpm run build` **0**.
- `pnpm run test:procgen` **exit 1**, `9 failed | 1400 passed (1409)` — down
  from `11 failed | 1398 passed`. No new failure.
- `pnpm run check` **exit 1**, on **`check:pet-slide`**, step 21 of 58:
  `the nearest companion filled at least 1% of the chase frame on only 88% of
  8 rasters, against 95% required`. Byte-identical to the figure the seventh
  leg recorded on **#474 alone**, so it is the inherited red, not this leg's.
  The twenty steps before it (including `tsc --noEmit` and `typecheck:test`)
  all passed.
- **The 37 steps after it are masked by the `&&` chain.** Because this leg
  changes `paths.ts`, the path-relevant ones were run individually:
  `check:park` **0**, `check:solve-cost` **0**, `check:waypoints` **0**,
  `check:nav-routes` **0**, `check:path-preference` **0**, `check:park-map`
  **0**, `check:fountain-hop` **0**, `check:jitter` **0**. Eight of eight.
- `check:park` sweep, all sixteen seeds: **10 green, 13 stranded** — `diff`
  against the `df7ecac4` sweep is **empty**.

---

## `pathsRunOnGridAxes`, the five-seed class — one hypothesis built, measured, WRONG, reverted

All five are the same shape, and the offending run is always the connector's
**`node -> lead` leg**, the only one of the three head-on shapes that can be a
diagonal (both elbows are axis-aligned by construction):

```
131  spur-building                          18.1 m  (32.5,-6.7) -> (41.1,9.3)
208  spur-stall.waterFight                  17.4 m  (-21.6,-47.2) -> (-38.2,-42.0)
225  connector-building-exit-ginormousSlide 16.2 m  (40.3,13.6) -> (25.7,6.6)
346  gate-approach                          21.5 m  (-0.1,31.0) -> (-15.2,15.7)
451  spur-stall.keychain                    16.8 m  (27.7,33.0) -> (14.6,22.5)
```

against `MAX_DIAGONAL_APPROACH = 16`. The straight shape is tried **first**
and unconditionally, so it wins whenever it is clear.

### HYPOTHESIS (mine): reorder, don't refuse — MEASURED, WORSE, REVERTED

The brief's own instruction is a short axis-aligned arrival rather than
refusing the diagonal, and refusing it is already on the refuted list. So I
built the ladder this branch uses everywhere: keep all three shapes, but when
the straight leg is neither exactly axis-aligned nor within `STUB_TAIL_LIMIT`
(7.8 m, this file's own doorway reach), try the two elbows **first** and leave
the diagonal as the **last rung** — never removed, so no door can be starved
by it. `tsc --noEmit` exit 0.

**It costs exactly what refusing it cost.** `check:park`, all sixteen seeds,
against the `df7ecac4` baseline:

| seed | before | after | |
|---|---|---|---|
| 5 | **0** | **1** | **lost green** |
| 267 | 3 | **4** | worse |
| 451 | **0** | **2** | **lost green** |
| every other seed | — | — | identical |

**10 green -> 8.** Reverted; revert grep-verified (0 occurrences of
`straightIsADoorwayApproach`, 1 of the original shape list).

### WHY IT FAILED, and it rules out a whole family of fixes

**A last-rung fallback only fires when the preferred shape *fails*, never when
it is merely *worse*.** The elbow is axis-aligned but its Manhattan length
exceeds the diagonal's, and `cost: length * STUB_COST_FACTOR` is what the
Dijkstra over the grid actually spends. So preferring the elbow does not
"give the door a short axis-aligned arrival" — it makes every route through
that node dearer, a different node wins, and the door ends up further away
than it began. That is the same mechanism that made the outright refusal cost
two greens, which is why the two experiments cost the same two greens.

**So ordering is not the lever, and neither is refusal.** Both decide *which
single shape a node offers*, and the damage is done by that node then losing
to another node entirely.

### What the next attempt should be, and why it is different

`computeGridConnectors` offers **one** head-on connector per node —
`if (headOn) continue;` after the first shape that clears. The untried
mechanism is to offer **both** the axis-aligned elbow and the diagonal as
separate connectors at the same node, priced apart, and let the search choose:
the elbow wins wherever the two are comparable, and the diagonal still wins
over a genuinely much worse alternative, so nothing is starved and no route is
made dearer than it was.

That is the "price it, do not refuse it" pattern the handoff already proposes
for seed 267's rescued tap, and it is the only one of the three that does not
change what a node offers to the rest of the search.

**Honest caveat before anyone builds it:** pricing alone **cannot guarantee**
`pathsRunOnGridAxes` goes green, because the invariant is a hard bound and a
price is not. If a long diagonal is still the cheapest thing available
anywhere, it will be drawn. Measure whether it clears all five before assuming
it does; if it clears four, that is a partial result to report, not to absorb.

### CORRECTION, measured: the five are NOT one class, and the reorder fixes only three

My first write-up of the reorder reported its cost with **no benefit column**,
which is exactly the one-sided measurement this branch exists not to make. Run
properly — the reorder re-applied, `pathsRunOnGridAxes` alone on each of the
five seeds — the benefit is:

| seed | `pathsRunOnGridAxes` under the reorder |
|---|---|
| 208 | **passes** |
| 346 | **passes** |
| 451 | **passes** |
| 131 | **still fails** — `spur-building` 18.1 m, `(32.5,-6.7) -> (41.1,9.3)` |
| 225 | **still fails** — `connector-building-exit-ginormousSlide` 16.2 m, `(40.3,13.6) -> (25.7,6.6)` |

**Three of five, for two greens.** The trade is clearly bad and the hypothesis
is refuted with both columns on the table. Reverted; revert grep-verified.

**But the important part is not the trade, it is that 131 and 225 did not move
at all** — byte-identical runs, from byte-identical endpoints. Reordering the
head-on shapes is a change to `computeGridConnectors`'s straight
`node -> lead` shape, so **on 131 and 225 the offending diagonal does not come
from there.** It is drawn by something else: the plain straight connector
below the head-on block, an oblique shape, a pinch link, or `relayPolyline`.

So the briefed "one class, five seeds" is **two classes**:

- **208, 346, 451** — the head-on straight shape, reachable from the connector
  ordering, and curable there if a mechanism can be found that does not make
  the node dearer (ordering and refusal both do; pricing at the same node is
  *equivalent to ordering* — a node's offered cost is the minimum over its
  connectors, so pricing the diagonal above the elbow makes the elbow win, and
  pricing it below changes nothing at all. **Do not spend a sweep proving
  that.**

  **CORRECTED 3 Sep, and the correction matters: this retirement holds only
  WITHIN one node.** As written it reads as "pricing connectors is retired",
  and a later leg nearly closed a real fix off on the strength of it. Two
  connectors that land on **different nodes** are not reordered by a price —
  the price decides which node wins, which ordering cannot do. The measured
  case is seed 128's `stall.facePaint`: its shared-line connector was
  **already the cheaper of the two** (27.67 against 33.52) and still lost, on
  *total path* cost, because its node sits further from the paved network.
  Nothing about ordering shapes at one node can reach that. So: retired for
  shape-versus-shape at a node; **live, and load-bearing, for node-versus-node**.);
- **131, 225** — an unidentified second producer. **Find which router draws
  `(32.5,-6.7) -> (41.1,9.3)` on seed 131 before designing anything**; every
  fix aimed at the connector will keep missing it, as this one did.

That second question is the cheapest next measurement on this item and nobody
has taken it.

### 131 LOCATED, and it points at a cap that structurally forbids the axis-aligned shape

Seed 131's `spur-building`, control polyline off the built park:

```
(12.6,-6.7) (33.7,-6.7) (37.3,8.4) (40.7,9.2) (41.1,9.3)
```

So it **is** the head-on `node -> lead` shape after all — node `(33.7,-6.7)`,
lead `(37.3,8.4)`, `dx 3.6 / dz 15.1`, hypot **15.5 m**, 13 degrees off axis,
**18.1 m** once `routeCurve` fillets it. The correction two sections up was
right that the reorder did not move it and wrong to conclude a different
router draws it. **Recording that as wrong.**

**Why the reorder did not move it — the arithmetic, and this is a HYPOTHESIS
not yet confirmed by a run.** The elbow the reorder would have preferred is
`(33.7,-6.7) -> (33.7,8.4) -> (37.3,8.4) -> p`: Manhattan, so
`15.1 + 3.6 = 18.7` plus the lead's own tail to the door (~0.9) — about
**19.6 m**. The shapes' length cap is `(tailLimit + 2) * 2`, which at relax 0
is `(7.8 + 2) * 2 =` **19.6 m**. The elbow is refused by centimetres, the
diagonal (about 16.4 m total) is inside the cap, and the last rung fires.

If that is right, the cap is the defect and it is this repo's own dominant
shape one more time: **one distance applied to two different geometries.** An
elbow is up to `sqrt(2)` longer than the diagonal it replaces, *by
construction*, so a single cap forbids the axis-aligned shape precisely where
the diagonal is near it — the case that matters.

The branch's own principle says what is allowed here: **"relaxing may widen a
distance, never license a shape."** Widening the cap *for the axis-aligned
elbows only* is widening a distance. It does not license the diagonal, and it
composes with the reorder rather than replacing it.

**Confirm before building**: print the chosen `relax`, the cap and both shape
lengths at that node on seed 131. If the elbow is refused by `legClear`
instead, this is wrong and the cap is innocent. Then, if the cap is the cause,
measure reorder + widened elbow cap together — the five seeds for the benefit
column **and** all sixteen for the cost column, both, because a one-sided
measurement is what made me report this item wrongly the first time.

### THE CAP HYPOTHESIS IS CONFIRMED — measured, and my "centimetres" figure was wrong

Instrumented `computeGridConnectors` to evaluate **all three** head-on shapes
at a node and print each one's length and verdict. This had to be done
*before* the real loop and writing only to stderr: the real loop `break`s on
its first acceptance, so it can never report what the shapes it did not reach
would have done — which is the entire question. Its control is that it prints
the accepted shape too, and the shape it called `would-ACCEPT` is the one
actually drawn.

Seed 131, the node `spur-building` is really drawn from:

```
node=(33.7,-6.7) lead=(37.3,8.4) relax=0 cap=19.60
  STRAIGHT len=19.07  clear=true   would-ACCEPT     <- the 15.5 m diagonal
  ELBOW1   len=22.25  clear=true   REFUSED-cap
  ELBOW2   len=22.25  clear=true   REFUSED-cap
```

**Both axis-aligned alternatives are geometrically CLEAR and are refused by
the length cap alone.** Not by a plot, not by the ring, not by the rail side,
not by bridge masonry — by one number.

**My arithmetic in the previous section said "refused by centimetres". It is
2.65 m. Recording that as wrong**; the conclusion survives the correction but
the figure did not, and the difference matters if anyone sizes the fix off it.

The ratio is the point: **22.25 / 19.07 = 1.167**, comfortably under `sqrt(2)`.
An elbow is the Manhattan form of the straight shape's diagonal, so its length
is at most `sqrt(2)` times it, *by construction*. One cap applied to both
therefore forbids the axis-aligned shape exactly where the diagonal is nearest
the cap — the only case that matters — which is this repo's dominant defect
wearing its geometry clothes.

**The fix that follows, and its justification.** Give the elbows a cap of
`cap * Math.SQRT2` and leave the straight shape's cap untouched. That admits
**every elbow whose diagonal counterpart would have fitted, and nothing more**
— a derived bound, not a tuned one, and it is widening a *distance* for the
axis-aligned shape rather than licensing a *shape*, which is this branch's own
stated rule.

It only bites in combination with the reorder: without it the straight shape
is still tried first and still accepted at 19.07, so nothing changes. The two
are one change and must be measured as one.

Instrument removed again (`git checkout src/world/paths.ts`, grep-verified 0
occurrences of `LGP_DEBUG_SHAPES`) — it costs an env lookup per node per shape
inside the connector search, and `check:park-boot` is already red on this
branch's parent for boot-slice cost.

### BOTH COLUMNS MEASURED — five of five fixed, green unchanged, stranded down 2

**Benefit** — `pathsRunOnGridAxes`, the five seeds, reorder + `sqrt(2)` elbow
cap together:

| seed | 131 | 208 | 225 | 346 | 451 |
|---|---|---|---|---|---|
| | **passes** | **passes** | **passes** | **passes** | **passes** |

**Five of five.** The two previous attempts got three of five (reorder alone)
and five of five at a cost of two greens (outright refusal).

**Cost** — `check:park`, all sixteen, against the `df7ecac4` baseline:

| seed | before | after | |
|---|---|---|---|
| 5 | **0** | **1** | **lost green** — the one regression |
| 11 | 3 | **1** | **-2** |
| 326 | 1 | **0** | **now green** |
| every other seed | — | — | identical |

**Green 10 -> 10. Stranded 13 -> 11.** Seed 5's green is genuinely lost and is
reported, not absorbed; it is offset by 326 gaining one, so the pool's green
count does not move while two waypoints and all five grid-axis failures are
recovered.

That is a different trade from the two refuted attempts, which paid **two net
greens** for three and five invariants respectively. This pays **none**.

### BUT `test:procgen` REFUTES IT AS BUILT — the elbow's tail is a private line

`check:park` was the wrong place to look for this change's cost, exactly as it
was for the refusal attempt.

```
baseline (df7ecac4)   11 failed | 1398 passed
after the masonry leg  9 failed | 1400 passed
after reorder + cap    7 failed | 1402 passed
```

The headline improves and **the composition is worse in kind**.
`pathsRunOnGridAxes` is gone on all five and seed 128's climbable-tree failure
with it — but `streetsShareLatticeLines` goes from **2 seeds (5, 11) to 6
(5, 11, 115, 128, 131, 451)**:

```
115  spur-waterFight        runs north-south 29.8 m on x = 49.32,  1.91 m off the lattice
5    spur-stall.keychain    runs east-west   22.5 m on z = 12.16,  2.90 m off
131  spur-building          runs east-west   18.0 m on z = -15.28, 0.93 m off
451  spur-ballPit           runs east-west   16.9 m on z = -41.48, 1.27 m off
128  spur-building          runs east-west   14.5 m on z = 8.44,   2.84 m off
...
```

**The cause is structural and predictable from the shape itself.**
`elbowViaColumn` is `node -> (nx, lead[1]) -> lead`: its first leg is on the
node's own lattice column, and its second runs along **`z = lead[1]` — the
door's own private row**. `elbowViaRow` is the mirror. So relaxing the total
length cap by `sqrt(2)` did not only buy axis-alignment, it bought **longer
private-line runs**, which is the very defect the grid-discipline work
retired from `relayPolyline` and is Jim's complaint #3 in its purest form. A
29.8 m private arterial is a worse offence against "reads as a grid" than a
16 m diagonal doorway approach.

**A net count of failures is not a measure of whether the park reads as a
grid.** 9 -> 7 looked like progress and is not, and it is the same one-sided
reading that made me report the reorder wrongly. Recording it.

### The refinement this points at, and it restores a documented intent

`STUB_TAIL_LIMIT`'s own doc comment already says what the bound should be:

> *"A stub elbowed via the node's own street line keeps one leg exactly on the
> lattice; the other (**the tail, along the destination's own x or z**) must
> stay shorter than the new lattice invariant's own straight-run threshold, or
> the stub itself would read as a rogue street line."*

That is precisely the leg now running 29.8 m. The existing guard is
`tail = Math.min(|p.x - nx|, |p.z - nz|)` at the **node**, which is the minimum
over both axes and so says nothing about which elbow is taken. Bounding **each
elbow's own private leg** to `STUB_TAIL_LIMIT` is the constant doing the job
it is documented to do.

On seed 131 it also picks the right elbow rather than either: node
`(33.7,-6.7)`, lead `(37.3,8.4)`, so `leadDx = 3.6` and `leadDz = 15.1` —
`elbowViaColumn`'s private tail is 3.6 (allowed), `elbowViaRow`'s is 15.1
(refused). The good elbow survives and the rogue one does not.

### THE PRIVATE-TAIL BOUND: composition cured, reachability regressed — REVERTED

Both columns, with the bound in:

**Benefit.** `test:procgen` **4 failed | 1405 passed**, from a baseline of
11 | 1398 — and the composition is clean, which is what the previous variant
failed on:

| invariant | baseline | variant A (cap, no tail bound) | **variant B (with it)** |
|---|---|---|---|
| `builtMasonryStaysInsideItsReservation` | 2 seeds | 0 | **0** |
| `pathsRunOnGridAxes` | 5 seeds | 0 | **1** (225 only) |
| `streetsShareLatticeLines` | 2 seeds | **6** | **2** — back to baseline exactly |
| climbable tree (128) | 1 | 0 | **0** |
| `noPathEndsNowhere` (288) | 1 | 1 | 1 |
| **total failed** | **11** | 7 | **4** |

**Cost.** `check:park`, all sixteen:

| seed | baseline | variant A | **variant B** |
|---|---|---|---|
| 5 | 0 | **1** | 0 |
| 11 | 3 | **1** | 3 |
| 267 | 3 | 3 | **6** |
| 326 | 1 | **0** | 1 |
| 451 | 0 | 0 | **2** |
| **green / stranded** | **10 / 13** | **10 / 11** | **9 / 16** |

**Reverted**, and the revert is grep-verified (0 occurrences of `privateTail`,
`shapeCap`, `straightIsADoorwayApproach`; the original shape list back; the
`src`/`test` diff against the last known-good commit is empty).

**Why, and it is not the green count.** `poi.stranded` going **13 -> 16** is
destinations a child cannot walk to. Jim's complaint #4 (paths that actually
reach the doors) outranks his #3 (paths that read as a grid), and CLAUDE.md's
standing rule is that a ribbon nobody can walk to is the worse fault. Trading
three of those for six invariant lines is not a trade this branch should make
silently, and `4 failed | 1405 passed` is exactly the seductive headline that
made variant A look like progress when its composition was worse.

### The decision tree, fully measured, for whoever takes this next

Three variants exist and all three are now measured on both columns. **None is
shippable as it stands**, and that is the honest state:

| | grid-axes fixed | green | stranded | lattice seeds |
|---|---|---|---|---|
| baseline | 0 of 5 | 10 | 13 | 2 |
| refusal (earlier leg) | 5 of 5 | **8** | — | — |
| reorder alone | 3 of 5 | **8** | — | — |
| **A** reorder + `sqrt(2)` cap | **5 of 5** | **10** | **11** | **6** |
| **B** A + private-tail bound | 4 of 5 | **9** | **16** | **2** |

**A is one bound away from being the answer.** It is the only variant that
costs no greens and *reduces* stranded, and its sole defect is named and
local: the elbow's private-line tail. B bounds that tail with a hard refusal,
and a hard refusal starves — the same mechanism that cost the first two
attempts their greens, arriving one layer down.

**So the next rung is a ladder, not a bound:** try each elbow with its private
tail inside `STUB_TAIL_LIMIT`; if neither qualifies **and** the straight shape
is refused by its own cap, allow the elbow at full tail rather than dropping
the node. That keeps B's clean composition wherever it is achievable and A's
reachability everywhere it is not — which is the shape every kept fix on this
branch has taken.

Measure it the same way: five seeds for the benefit column, sixteen for the
cost column, **and `test:procgen` for the composition**, because `check:park`
could not see variant A's 29.8 m private arterials and the failure *count*
could not see them either.

### THE LADDER, measured on all three columns — best variant yet, but PROVISIONAL

Disciplined elbow -> the diagonal -> the rogue elbow at full tail. No rung
removed, node never dropped.

**Benefit** (`pathsRunOnGridAxes`, the five seeds): **131, 208, 346, 451 pass;
225 still fails.** Four of five.

**Composition** (`test:procgen`): **5 failed | 1404 passed.**

| invariant | baseline | A (cap only) | B (hard bound) | **ladder** |
|---|---|---|---|---|
| `builtMasonryStaysInsideItsReservation` | 2 | 0 | 0 | **0** |
| `pathsRunOnGridAxes` | 5 | 0 | 1 | **1** (225) |
| `streetsShareLatticeLines` | 2 | **6** | 2 | **3** (5, 11, **128**) |
| climbable tree (128) | 1 | 0 | 0 | **0** |
| `noPathEndsNowhere` (288) | 1 | 1 | 1 | **1** |
| **total** | **11** | 7 | 4 | **5** |

**Cost** (`check:park`, sixteen seeds):

| seed | baseline | A | B | **ladder** |
|---|---|---|---|---|
| 11 | 3 | 1 | 3 | **1** |
| 267 | 3 | 3 | 6 | **6** |
| 326 | 1 | 0 | 1 | **0** (green) |
| 451 | 0 | 0 | 2 | **1** (lost green) |
| 5 | 0 | 1 | 0 | **0** |
| **green / stranded** | **10 / 13** | 10 / 11 | 9 / 16 | **10 / 14** |

**The ladder beats B on both columns** (green 10 vs 9, stranded 14 vs 16) **and
beats A on composition** (3 lattice seeds vs 6). It is the only variant that
keeps the green count *and* keeps the private arterials out.

### What it still costs, stated plainly rather than absorbed

- **`poi.stranded` 13 -> 14.** One more destination a child cannot walk to.
  By this branch's own ranking that is the senior metric, so this is a
  regression, not a rounding error.
- **Seed 267 goes 3 -> 6**, the single worst movement, partly offset by seed
  11 going 3 -> 1.
- **Seed 451 loses green** (0 -> 1) while **326 gains it** (1 -> 0), so the
  count is unchanged but the set is not.
- **Seed 128 joins `streetsShareLatticeLines`** — one new lattice seed, where
  variant A added four.

**So this is KEPT PROVISIONALLY, and the condition is written down here:**
seed 267's `3 -> 6` must come back, or the ladder is reverted. That is not an
arbitrary condition — **267 is precisely the seed whose green -> 3 regression
an earlier leg already attributed to a rescued gateway's *elbow*, with the
other-corner hypothesis still untested.** This change also reorders elbows, so
the most likely reading is one latent defect being amplified by a second
elbow decision rather than two independent faults. That hypothesis is the next
item on the queue anyway, so the two should be settled together.

If it turns out they are independent and 267 cannot be recovered, revert the
ladder: **+1 stranded for four invariant lines is not a trade this branch
should make**, on the ranking it has just been endorsed for.

---

## Seed 267: root-caused to a ribbon through the statue circle. 11/16 GREEN, stranded 8.

### The instrument named it in one run, and the control discriminated completely

`scripts/tmp-lonely.mts` on 267 (six stranded, two groups of three):

```
X (20.7,53.5) nbrs=1 nearestPaving=1.02m (spur-stall.facePaint)
X (20.2,50.3) nbrs=1 nearestPaving=2.21m (spur-stall.facePaint)
X (22.4,52.8) nbrs=2 nearestPaving=0.41m (spur-stall.facePaint)
X (-2.1, 1.5) nbrs=2 nearestPaving=1.10m (street-tap-north)
X (-3.2, 3.3) nbrs=2 nearestPaving=0.30m (street-tap-north)
X (-3.2, 7.3) nbrs=2 nearestPaving=0.07m (street-tap-north)

control (reachable, same columns):
. (-3.2,-1.9) nbrs=15   . (-3.2,10.9) nbrs=12   ... both on street-tap-north
```

The control is the whole finding: **the same ribbon is reachable at
`z = -1.9` and `z = 10.9` and stranded in between.** A hole in the middle of a
lane, not a starved end.

Distances from `PLAZA`, which is `(-3.23, 4.46)` on this seed:

| stranded | 1.16 | 2.84 | 3.17 |
|---|---|---|---|
| **reachable** | **6.36** | **6.44** | **6.74 / 6.83** |

**Every stranded sample inside 3.2 m, every reachable one outside 6.3 m.** The
hole *is* the statue ring's interior: `street-tap-north` is drawn **straight
through the statue circle, within 1.16 m of the statue**.

### The cause: the gateway rescue's obstacle list omits the ring it stands on

The tap rescue screened with `streetSegmentClear` and `segmentHoldsRailSide`
and nothing else — **a hand-picked obstacle list missing the one obstacle the
tap is standing on**, which is verbatim CLAUDE.md's standing procgen rule.

`segmentClearOfRing` takes a `margin` now (one owner, parameterised, the same
shape as `bridgeScreenHalfAcross`) and the gateway legs pass **0**: the leg
legitimately *starts* on the rim at exactly `RING_RADIUS`, so the ordinary 0.5
clearance would refuse every gateway there has ever been. **Touching the rim
is what a gateway is for; entering the interior is the defect.**

### This also RETIRES the standing "try the other corner" hypothesis

Do not spend a run on it. Two reasons, both structural:

1. **The two corners always tie.** Both are the same Manhattan length, so
   `cost` is identical and the "cheaper of two" was never a choice — only an
   iteration order.
2. **A node roughly collinear with the plaza and the rim drives *both*
   corners through the middle**, which is exactly seed 267's geometry. No
   corner choice could have fixed it.

### Measured, all three columns

| | baseline (`df7ecac4`) | **now** |
|---|---|---|
| `check:park` green | 10 | **11** |
| `check:park` stranded | 13 | **8** |
| `test:procgen` | 11 failed / 1398 passed | **6 failed / 1403 passed** |
| `tsc` / `typecheck:test` / `build` | — | **0 / 0 / 0** |

Per seed: **267 3 -> 0 (green)**, **326 1 -> 0 (green)**, **11 3 -> 1**,
**451 0 -> 1 (lost green)**, everything else identical.

**This is the first honest 11 of 16 on this branch.** The earlier 11/16 was
withdrawn because it was measured on a build with an unscreened ribbon in it;
this one is not.

### The two new invariant failures, reported not absorbed

`test:procgen` is 11 -> 6, but two of the six are **new**:

- **`streetsShareLatticeLines` on seed 128** — one new lattice seed (5 and 11
  were already failing). From the arrival ladder's elbows, not the ring fix.
- **`detourRatiosStayReasonable` on seed 267** — new, and caused by the ring
  fix itself: the tap now goes round the statue instead of through it, so some
  pair of close destinations has a longer paved detour than before. Note the
  path it replaced was through solid ground, so the *old* ratio was measured
  against a route nobody could walk.

Both are named, neither is absorbed, and both belong to the next leg.

### Still owed

- Seed 451's lost green (0 -> 1) — the one seed worse than baseline.
- `pathsRunOnGridAxes` on 225 — the last of the five.
- `streetsShareLatticeLines` on 5, 11, 128.
- `noPathEndsNowhere` on 288.
- `detourRatiosStayReasonable` on 267 (new, above).
- Stage-2 invariant (b); probe deletion (`tmp-stoneground.mts` last, re-run
  after any reservation or `bridgeFootprint.ts` change); the rebase.

---

## Seed 451's lost green: a fence run crosses the spur, and it is the seed-11 class

**Attributed first**: 451 went 0 -> 1 under **the ladder**, and was still 1
after the ring fix — so it is the arrival ladder's doing, not the gateway's.

`scripts/tmp-pocket.mts` on 451. The lane is three samples long and the
**middle** one is the stranded one, which is the 267 signature again — a hole
in the middle, not a starved end — except the gap here is trivial:

```
lane spur-stall.spookyHouse:
  ok at= 7.0 (32.9,-34.2) nbrs=3
  XX at=14.0 (32.7,-31.9) nbrs=0   <- nearestReachable 2.37 m, at at=7.0
  ok at=21.0 (34.1,-26.7) nbrs=4
```

**2.37 m, against a `MAX_EDGE` of 13** — so distance is not the refusal;
something solid stands on the chord. `scripts/tmp-transect.mts 32.7 -31.9
32.9 -34.2`:

```
d=0.00 clear   d=0.23 clear
d=0.46 .. d=2.08  BLOCKED, onPath=Y at every sample, peak push 0.82 at (32.82,-33.28)
d=2.31 clear
```

**1.85 m of a 2.31 m chord is blocked, and `onPath=Y` throughout** — the
ribbon really is drawn through it.

`scripts/tmp-blocker.mts` names it, and it is **two wall runs meeting at a
corner**:

```
wall (29.54,-30.53)-(32.51,-33.50) halfThick=0.30 overlap=0.62
wall (34.39,-31.63)-(32.51,-33.50) halfThick=0.30 overlap=0.94
```

A **V of border fence with its apex at (32.51,-33.50)**, right beside the
lane, whose second arm crosses the ribbon at about `z = -33.2`. That is
**a fence across a path** — Jim-visible, not merely an invariant's business.

**This is verbatim the seed-11 `spur-hotel` class** already in this file:
border fence is placed **from** the paths (`Scenery.ts`, off `pathCentreline`),
so it does not exist when the router runs and the router cannot consult it.
The recorded conclusion there stands and applies unchanged: **"the fence is
correct; the paths it was given were not"** — the fix is upstream, in the
path shape that scenery cannot border safely, never in the fence or in a
widened screen.

What is new is the trigger: **the arrival ladder changed
`spur-stall.spookyHouse`'s shape into one the fence placer cannot border.**
Whoever takes this should ask what about the new shape does that — a corner
too tight for two runs to border, most likely, given the blocker is itself a
corner — rather than reaching for the ladder's ordering, which is measured
good on eleven other seeds.

### INSTRUMENT CAVEAT — one control row failed, and it must not be glossed

`tmp-blocker.mts`'s second control, the lane end at `(32.9,-34.2)`, reports
**BLOCKED** (overlap 0.20) where `tmp-transect.mts` reports that same point
**clear**. The two ask at different clearances, so it is not a contradiction —
but **that control row does not discriminate**, and only the first one
(`(32.7,-31.9)`, "no collider within clearance") does. The named colliders
above are believable because the first control holds and because the transect
independently found the same 1.85 m band; they should not be believed on the
strength of the second row.

## For the before/after screenshot the Overseer asked about

**Which seeds show the statue crossing.** The gateway-rescue fix can only
change a seed that *has* a rescued tap, and this file already records those:
**canonical, 5 (two), 11, 115, 225, 267, 288, 346 (two), 451** — nine of
sixteen. 267 is confirmed by measurement (ribbon within 1.16 m of the statue);
the other eight are candidates, not confirmations.

**The cheap way to get the real list** (nobody has run it): measure, per seed,
the minimum distance from `PLAZA` to any drawn non-backbone ribbon, on a build
with the ring check reverted and again with it in. Any seed whose figure rises
from below `RING_RADIUS` to at or above it showed the defect. That is one
number per seed and it makes the before/after honest rather than assumed.

### CORRECTION to the seed-267 write-up: the 3.2/6.3 split is NOT the ring boundary

Building the before/after instrument surfaced an error in my own earlier
diagnosis, and the control is what surfaced it. **`RING_RADIUS` is 14.90 m.**

So when I wrote *"every stranded sample inside 3.2 m, every reachable one
outside 6.3 m — the hole IS the ring's interior"*, the second half was wrong:
**6.36 m is also inside a 14.90 m ring.** Every one of those samples,
stranded and reachable alike, was inside the ring. The 3.2/6.3 split is real
and it discriminates, but the boundary it marks is **not** `RING_RADIUS` —
something else sits between 3.2 and 6.4 m of the plaza centre (the statue's
own collider or the fountain, most likely; unmeasured, and it should be
measured before anyone leans on it).

**What survives, and it is the load-bearing part:**

- `street-tap-north` really did run through the ring's interior, passing
  within **1.16 m of the statue** against a `RING_RADIUS` of 14.90;
- the gateway rescue really did omit the ring from its clearance list;
- the fix really did take seed 267 from **6 stranded to 0, green** — measured,
  not inferred.

**What does not survive is the phrase "the hole is the ring's interior".** It
read as an explanation of the split and it is not one. Recording it rather
than quietly rewording, because the next reader would otherwise inherit a
tidy causal story that the numbers do not support.

### The before/after instrument, and the flaw its own control caught first

`scripts/tmp-ringcross.mts`. **Its first cut took the minimum over all routes
and reported seed 267 as "INSIDE THE RING by 6.50 m" — after the fix.** The
culprit was `fountain-approach`, which legitimately runs to the fountain at
the plaza centre. A route that is *supposed* to enter cannot be evidence that
something entered wrongly, so the measure is now over the **gateway tap**
ribbons alone — the routes this fix governs.

Both controls discriminate, which is what makes a clean row mean anything:

```
267  taps=1  nearest tap approach to PLAZA: 14.90 m via street-tap-north
     RING_RADIUS=14.90   every tap clear of the ring
     control1(main-loop)=14.83        <- the ring's own ribbon reads as the ring
     control2(fountain-approach)=8.40 <- an entering ribbon IS detected as entering
```

The tap now reads **exactly `RING_RADIUS`** — touching the rim, which is what
a gateway is for, and not a centimetre further in.

## THE STATUE CROSSING IS A ONE-SEED DEFECT: seed 267 only, measured

The Overseer asked for a real before/after list rather than an assumed one.
Run, and **the assumption was wrong.**

`scripts/tmp-ringcross.mts`, the gateway-tap ribbons' closest approach to
`PLAZA`, with the `segmentClearOfRing` calls out and then in. Only the eight
seeds that actually draw a `street-tap-*` ribbon can be affected, so those are
the eight run:

| seed | taps | BEFORE | AFTER |
|---|---|---|---|
| canonical | 1 | 14.90 clear | 14.90 clear |
| 115 | 1 | 14.90 clear | 14.90 clear |
| 128 | 1 | 14.90 clear | 14.90 clear |
| **267** | 1 | **0.00 m — INSIDE BY 14.90 m** | **14.90 clear** |
| 274 | 2 | 14.90 clear | 14.90 clear |
| 326 | 2 | 14.90 clear | 14.90 clear |
| 428 | 1 | 14.90 clear | 14.90 clear |
| 451 | 1 | 14.90 clear | 14.90 clear |

Controls on every row: `main-loop` (the ring's own ribbon) reads **14.83**
against a `RING_RADIUS` of 14.90, so the distance measure is right; and
`fountain-approach` reads **8.40**, so the instrument demonstrably *can* see a
ribbon inside the ring — a clean row means something.

**So: one seed, not nine.** The nine-seed "gained a rescued gateway" list was
never a list of seeds showing this defect, and treating it as one would have
put a false claim in front of Jim. Eight seeds draw a tap ribbon; seven of
them were always clear of the ring.

**And 267's real number is 0.00 m, not the 1.16 m recorded earlier.** That
1.16 m was the nearest *stranded `poiGraph` sample*; the ribbon's own closest
approach is **the plaza centre itself** — `street-tap-north` ran straight
over the statue. Use 0.00.

### For the screenshot, then

The before/after is **seed 267** and nothing else. Before: a path running
straight across the statue circle and over the statue. After: the same
gateway leaving the rim and going round. Any other seed would show no
difference at all, which is exactly the "link with nothing to look at" Jim
has already rejected twice.

### One instrument flaw caught, and one caveat

**Flaw, caught by the control:** the first cut measured the minimum over *all*
routes and reported 267 as inside the ring **after** the fix — because
`fountain-approach` legitimately runs to the fountain at the plaza centre. A
route that is supposed to enter cannot be evidence that something entered
wrongly. Now measured over the tap ribbons alone.

**Second flaw, caught by reading the number:** seeds 274, 326 and 428 first
reported `TAP INSIDE THE RING by 0.00 m`. A violation whose magnitude rounds
to zero is not a violation — a tap that touches the rim sits at exactly
`RING_RADIUS` and floating point lands it a hair under. `RIM_EPSILON` is the
instrument admitting that touching the rim is what a gateway is for, not a
threshold tuned to make seeds pass: anything genuinely inside is inside by
metres, as 267's 14.90 shows.

**Caveat, unexplained and not to be assumed away:** the eight seeds that draw
a `street-tap-*` ribbon are **not** the nine this file records as having
gained a rescued gateway (5, 11, 225, 288 and 346 draw no tap ribbon; 274,
326 and 428 do and are not on that list). A rescued tap and a drawn
`street-tap-*` route are evidently not the same population. **Nobody has
established why**, and no conclusion here rests on their being the same — the
before/after above is measured per seed, not inferred from either list.

---

## Seed 451 ROOT-CAUSED — and the predecessor's attribution was wrong

**It is not a fence, and the seed-11 ordering excuse does not apply.**

`scripts/tmp-451corner.mts` (control rebuilt first — see below) completes the
"V" the predecessor printed. The two runs it named are two edges of a **closed
rectangle of four**:

```
(31.42,-28.66)-(34.39,-31.63) len=4.20 yaw=-45.0 half=0.30
(29.54,-30.53)-(32.51,-33.50) len=4.20 yaw=-45.0 half=0.30
(31.42,-28.66)-(29.54,-30.53) len=2.65 yaw=-135.0 half=0.30
(34.39,-31.63)-(32.51,-33.50) len=2.65 yaw=-135.0 half=0.30
```

4.20 x 2.65, rotated 45 degrees, `halfThickness` 0.30 — the signature of
`src/minigames/stalls.ts:310-313`, a booth's own four counter walls, at
`signYaw` = `CAMERA_FACING_YAW` = 45 degrees. And the layout agrees:

```
stall.spookyHouse at (31.95,-31.10) r=3.40 signYaw=45.0deg
                  entrance=(34.78,-28.27) fp={"kind":"circle","radius":2.6}
```

`halfThickness` was the tell that should have been read: `train/fence.ts` adds
0.18 (seed 11's blocker) and `Scenery.ts` 0.22/0.34. Nothing that borders a
path is 0.30.

**So `spur-stall.spookyHouse` is drawn straight through the spooky house's own
booth** — 0.76 m inside a 2.6 m footprint at the deepest — and the booth is
placed by the layout solver *before* the router runs. The router could have
consulted it, and does: `streetSegmentClear` screens it.

### The instrument control, rebuilt

The predecessor flagged that `tmp-blocker.mts`'s second control row did not
discriminate. **The cause is a constant, not the geometry**: `tmp-blocker.mts`
asks at a flat 0.7 m clearance while `tmp-transect.mts` asks at
`NPC_RADIUS - 0.02` on paving. `tmp-451corner.mts` uses the transect's own
rule, and all three rows then agree with the transect exactly:

```
transect said CLEAR  lane at=14 (32.7,-31.9)   clearance=0.48 clear
transect said CLEAR  lane at=7  (32.9,-34.2)   clearance=0.48 clear
transect said BLOCKED peak      (32.82,-33.28) clearance=0.48 BLOCKED push=0.82
```

### The screen refused this leg. Something downstream drew it anyway.

`debugArrivalLegScreens` asks the exact question `computeGridConnectors` asks —
the door's own 7 m plot exemption, the 2.0 m arrival boundary margin:

```
THE LEG (32.279,-40.209) -> (34.140,-28.908), door (34.140,-28.908)
  streetClearArriving: false
  streetClearPublic:   false
  plot(31.95,-31.10) atDoor=0.50 deepestOnLeg=-0.76 list=relaxed
CONTROL, a leg well clear of the booth, same exemption
  streetClearArriving: true       <- the column discriminates
  plot(31.95,-31.10) atDoor=0.50 deepestOnLeg=2.52 list=relaxed
```

Note `atDoor=0.50` is `>= 0`, so the plot lands in `relaxed`, **not** exempt
outright — the ginormous-slide carve-out is not involved. And
`STUB_TAIL_LIMIT` is 7.8 against a `direct` of 11.45, so the straight
connector could not have offered this leg either.

### `trimBacktracks` deleted the corner, and nothing re-screened the result

`debugNodeEdges` on the door node prints the connector the search actually
accepted, with its `via`:

```
DOOR node 857 at 34.140,-28.908  isLattice=false
  -> 32.279,-40.209  cost 22.43  via (36.615,-26.433)
```

Three points, not two: **(32.279,-40.209) -> (36.615,-26.433) ->
(34.140,-28.908)**. That is the head-on arrival shape `straightToLead`, and
(36.615,-26.433) is the door's own 3.5 m outward lead. Both legs pass every
screen; the drawn route has only two points because `trimBacktracks` removed
the middle one:

```
in  = (4.336, 13.776)  len 14.442
out = (-2.475, -2.475) len  3.500
cosine = -0.8866   ABOUT_TURN_COSINE_DRAWN = cos(150 deg) = -0.8660
```

**A 152.4 degree vertex, cut by 0.02 of cosine.** What is left is a single
11.45 m leg that no screen has ever seen, and it runs through the booth.

**`trimBacktracks`'s own doc comment states the assumption that fails:**
*"Deleting the middle vertex of an about-turn leaves exactly the net movement
the walk actually makes."* That is true at 180 degrees, where the two legs are
collinear and the survivor lies on ground both legs already covered. At 152
degrees it is false — the survivor is a **new line over ground nobody
screened**. The pass was written for a pure overshoot seam
(`(0,43.1) -> (36.5,43.1) -> (25.4,43.1)`, genuinely collinear) and its
tolerance was then widened to 150 degrees without the assumption being
re-examined.

**For the PR body:** *a trim that is exactly right at 180 degrees is a
shortcut across new ground at 152 — deleting a vertex is only lossless when
the two legs are collinear.* And the general form, which is this branch's own
recurring shape one layer further out: **a post-process that improves a
polyline's shape must re-answer the screens the polyline was accepted
under, or it must not run.**

### THE FIX — BUILT, MEASURED ON BOTH COLUMNS, KEPT

`drawsAsScreened(shape)` = `trimBacktracks(shape).length === shape.length`, and
a connector whose shape it refuses is not offered. The rule is asked of
`trimBacktracks` itself, never of a second copy of the angle test, so the two
cannot drift.

**Applied at every connector-production site, not only the one that failed** —
the head-on shapes, the straight connector, the corner elbow and
`relayConnectors`. The last three refuse nothing on any pool seed today; they
are guarded because a rule honoured in one place and not its siblings is how
this branch's defects have kept reappearing in new organs.

`pnpm exec tsc --noEmit` exit 0.

**Column 1 — `check:park`, all sixteen pool seeds:**

| seed | before | after | |
|---|---|---|---|
| canonical | 0 | 0 | green |
| 5 | 0 | 0 | green |
| 11 | 1 | 1 | |
| 24 | 2 | 2 | |
| 115 | 0 | 0 | green |
| 128 | 0 | 0 | green |
| 131 | 0 | 0 | green |
| 208 | 0 | 0 | green |
| 225 | 2 | 2 | |
| 267 | 0 | 0 | green |
| 274 | 0 | 0 | green |
| 288 | 2 | 2 | |
| 326 | 0 | 0 | green |
| 346 | 0 | 0 | green |
| 428 | 0 | 0 | green |
| 451 | 1 | **0** | **now green** |

**11 green / 8 stranded -> 12 green / 7 stranded. No seed regressed.**

**Column 2 — `test:procgen`. Baseline RE-RUN rather than reused**, because the
first capture was piped through `tail -60` and had silently kept only the last
two failures — a truncated baseline would have made any set-diff a guess.

**6 failed / 1403 passed -> 5 failed / 1404 passed**, and the *violation set*
(not the count) diffs to exactly one removal and no additions:

```
- seed 225  every paved path runs on grid axes
  connector-building-exit-ginormousSlide runs diagonally for 16.2 m,
  from 40.3, 13.6 to 25.7, 6.6
```

Every other violation line is byte-identical before and after, including both
of seed 11's and both of seed 5's `streetsShareLatticeLines` runs. **That is
the column that matters here**: `streetsShareLatticeLines` is precisely the
instrument that catches long private arterials, which is what sank variant A
while its net failure count looked like progress. No arterial was traded in
for this green.

**So seed 451's lost green and item 1 (seed 225's `pathsRunOnGridAxes`) are
one defect and one fix.** The brief listed them as two.

451's spur, before and after:

```
before  (32.3,-40.2) (34.1,-28.9)                                 one 11.45 m diagonal, 0.76 m inside the booth
after   (44.3,-40.2) (44.3,-26.4) (36.6,-26.4) (34.1,-28.9)       two lattice lines, then the 3.5 m head-on lead
```

`deepestOnLeg` against `stall.spookyHouse`'s footprint: **-0.76 -> +0.50.**

### Still owed (unchanged except the two struck above)

- ~~Seed 451's lost green~~ — done.
- ~~`pathsRunOnGridAxes` on 225~~ — done, same fix.
- `streetsShareLatticeLines` on 5, 11, 128.
- `noPathEndsNowhere` on 288.
- `detourRatiosStayReasonable` on 267 — establish the honest baseline first:
  the route it replaced ran through solid ground.
- Stage-2 invariant (b); probe deletion (`tmp-stoneground.mts` last, re-run
  after any reservation or `bridgeFootprint.ts` change); the rebase.
- **New probes this leg added, to delete with the rest:** `tmp-451corner.mts`,
  `tmp-451leg.mts`, `tmp-451edges.mts`, `tmp-451who.mts`, `tmp-sweep.sh`, and
  the `debugArrivalLegScreens` / `debugNodeEdges` exports at the end of
  `paths.ts`. `drawsAsScreened` is **not** a probe and stays.

## Item 2 located on seed 128 — it is the ladder's rung 3, and the cheap fixes are already ruled out

`streetsShareLatticeLines` on 128:
`connector-stall.facePaint-station-1 runs east-west for 12.4 m on z = 41.65,
2.34 m off the nearest line`.

The control polyline (`tmp-poly.mts`, seed 128):

```
spur-stall.facePaint            (2.6,45.3) (26.6,45.3) (29.6,41.6) (27.1,39.2)
spur-station-1                  (14.6,21.3) (22.5,21.3) (22.5,22.0) (28.9,24.6) (28.4,21.2)
connector-stall.facePaint-station-1
  (27.1,39.2) (29.6,41.6) (14.6,41.6) (14.6,21.3) (22.5,21.3) (22.5,22.0) (28.4,21.2)
```

Read it backwards and it is exactly `elbowViaColumn` at the facePaint door:

```
node (14.6,21.3)  ->  (14.6,41.6)  ->  lead (29.6,41.6)  ->  door (27.1,39.2)
     leg 1: x = 14.6, a real lattice column (plaza x 2.58 + 12)
     leg 2: z = 41.6, the LEAD's own row — private, 2.34 m off the half lattice
```

`x = 14.58` is on the lattice; `z = 41.65` is not (the 12 m lines are 33.31 and
45.31, the 6 m half lines 39.31 and 45.31). So the offending 15 m run is
`elbowViaColumn`'s second leg, whose length is `leadDx`.

**`leadDx` = 15.0 and `leadDz` = 20.3, both past `STUB_TAIL_LIMIT` (7.8), so
BOTH elbows are `rogue` — this is the ladder's rung 3.** And the two cheap
moves are already taken or already refuted:

- **The shorter private leg is already being chosen.** `rogue` is pushed in
  `leadDx`-then-`leadDz` order, so `elbowViaColumn` (private leg 15.0) is tried
  before `elbowViaRow` (private leg 20.3). There is no reorder left to make
  here — and reordering the head-on shapes was measured and reverted earlier on
  this branch anyway.
- **Bounding the tail by refusal is the recorded variant B**: it cured
  composition and cost `check:park` 10 green / 13 stranded -> 9 / 16. Rung 3
  exists precisely because of that measurement, and a destination a child
  cannot walk to outranks an invariant line — a settled ranking.

**So item 2 is not a tuning question and must not be answered by touching the
ladder.** The fix is the one `computeGridConnectors`'s own comment already
names: *"the honest fix gives the door a short axis-aligned arrival rather than
refusing the diagonal and leaving it to walk."* Concretely, on this seed the
door at (27.1,39.2) is handed a lead at (29.6,41.6) whose row is 2.34 m off any
shared line; a lead **snapped to the nearest lattice or half-lattice line**
would put leg 2 on a shared row and cost the arrival nothing, because the lead
is a 3.5 m stand-off point the layout invented, not a place anything has to be.
That is the next thing to build and measure, and it is a change to where the
lead is placed, not to which shapes are allowed.

**Unmeasured. Recorded as the next step, not as a result.**

### THE LEAD-SNAP HYPOTHESIS IS REFUTED — measured before it was built

I recorded, one section above, that snapping the arrival lead to the lattice
"would cost the arrival nothing". **It was tested first and it is wrong. It
does not fix the seed that motivated it, and it cannot be a general rule.**

`scripts/tmp-leadsnap.mts` asks, per door: the lead is a fixed 3.5 m out along
`entrance - plotCentre` (`arrivalLead`); the ray carries the meaning, the 3.5 is
arbitrary ("a few metres out"). So at what distance `t` along that **same ray**
does the lead land on a 12 m or 6 m shared line? Seed 128:

```
stall.facePaint  door(28.4,40.5) ray(0.71,0.71) lead@3.5 offLine=1.68
                 snap t in [2.0,5.5]: NONE      all t in (0.5,14): 5.88,6.78
```

**NONE.** The nearest snap distances are 5.88 and 6.78 m — and the lead-to-door
leg runs along the ray, so a 5.9 m lead makes that leg a 5.9 m **diagonal**,
which is buying a `pathsRunOnGridAxes` risk to pay a `streetsShareLatticeLines`
one. (Recomputed from the stall's stand point, which is what `arrivalLead` is
actually called with, rather than the doormat the probe starts from: t = 0.16 or
8.86 on z, 7.6 on x. Same verdict.)

**And it fails as a general rule, not just here: only 6 of 13 doors on seed 128
have any snap in [2.0, 5.5] at all.** The reason is structural and worth
keeping: a booth's outward ray is the camera's fixed 45 degree diagonal
(`CAMERA_FACING_YAW`), and the lattice is cardinal — a 45 degree ray crosses a
6 m line about every 8.5 m on each axis, so a 3.5 m band catches one only by
luck. **A rule that fires on half the doors by coincidence is not a rule.**

**Prediction recorded as wrong.** The lead's position is not the free parameter.

### What the refutation leaves, and why the reorder is now doubly closed

With the lead fixed, `elbowViaColumn`'s leg 2 runs on the lead's row **by
construction**, and the lead's row can never be reliably a shared line. So the
private run cannot be removed by moving the lead; it can only be moved onto a
different line or shortened.

Both elbows were compared on the actual seed-128 geometry — node (14.6,21.3),
lead (29.6,41.6), `leadDx` 15.0, `leadDz` 20.3:

| shape | leg 1 | leg 2 |
|---|---|---|
| `elbowViaColumn` | x = 14.6 (**shared**), 20.3 m | z = 41.6 (private), **15.0 m** |
| `elbowViaRow` | z = 21.3 (**shared**), 15.0 m | x = 29.6 (private), **20.3 m** |

**`elbowViaColumn` already minimises the private run**, and it is already tried
first by push order. So the reorder is closed for a second, independent reason
beyond the one recorded earlier — it is not merely neutral, it is provably the
better of the two on this geometry.

**Where a successor should look instead.** Any shape must spend 15 m in x and
20.3 m in z somewhere, and only two lines are on offer: the node's (shared) and
the lead's (private). Driving the private run to zero therefore needs a **nearer
or better-placed node**, not a better shape — so the question to ask next is
*why is the cheapest connector for this door at a node 15 m and 20.3 m away?*,
i.e. which screen refuses the nearer lattice nodes around (27.1, 39.2). That is
`debugDoorReach` territory and it has not been run on this door. **Do not reach
for the ladder, the lead, or the tail bound** — all three are now measured
dead ends.

### The missing cost term — LOCATED, BUILT, MEASURED, REVERTED (a swap, not a gain)

`scripts/tmp-128face.mts`'s **control row** is what found this, not the door
reach it was written for. `debugNodeEdges` on `stall.facePaint`'s stand point,
seed 128 — the door has **three** connectors:

```
-> 26.583,45.310  cost 10.27  via (29.559,41.649)
-> 14.583,45.310  cost 27.67  via (29.559,41.649) (29.559,45.310)
-> 14.583,33.310  cost 33.52  via (29.559,41.649) (14.583,41.649)
```

The third is the one drawn, and its second leg is the **15.0 m run on
z = 41.649** the invariant fails. The second connector is **already cheaper
(27.67)**, and its long leg is 15.0 m on **z = 45.310, a real lattice line**,
with only 3.66 m of private run before it. It lost on *total path* cost,
because the node it lands on is further from the paved network.

**So a connector's cost was its length and nothing else: the search could not
see that one of them runs along a line the rest of the park shares.**

**This is NOT the retired "pricing is ordering" idea.** That retirement was
about pricing two shapes **at the same node**, where a node's offered cost is
the minimum over its connectors, so a price only reorders. These two
connectors land on **different nodes**, so a price genuinely decides which node
wins. Recording the distinction because the retirement is written down without
it and would otherwise close this off wrongly.

**Built:** `privateLineRun(shape)` — metres of axis-aligned run of
`MIN_STREET_RUN` (8 m) or longer sitting further than 0.9 m from a 12 m or 6 m
line through the plaza, i.e. the invariant's own two families and tolerance —
priced at 1.25 per metre on top of length, at all three connector push sites.
Diagonal legs deliberately not counted (a different invariant's business).
A **price, not a refusal**: refusal is variant B, measured at 10 green / 13
stranded -> 9 / 16. `tsc --noEmit` exit 0.

**It does exactly what it was built to do on 128:**

```
before  (27.1,39.2) (29.6,41.6) (14.6,41.6) (14.6,21.3) ...   15.0 m private on z=41.649
after   (27.1,39.2) (29.6,41.6) (29.6,45.3) (14.6,45.3) ...   3.66 m private, then 15.0 m on z=45.310 (lattice)
```

**Column 1 — `check:park`: 12 green / 7 stranded, UNCHANGED. No seed moved.**

**Column 2 — `test:procgen`: 5 failed / 1404 passed, the same COUNT as before —
and the count is a lie. The violation SET swapped one for one:**

```
- seed 128  every street sits on the shared 12 m lattice
            connector-stall.facePaint-station-1, 12.4 m on z = 41.65
+ seed 225  every paved path runs on grid axes
            connector-building-exit-ginormousSlide runs diagonally for 16.2 m
```

That second line is **the exact violation this leg's `drawsAsScreened` fix had
removed**. The pricing gave it straight back.

**Mechanism, diagnosed rather than guessed:** `privateLineRun` scores a
diagonal leg as **zero**, because diagonals are `pathsRunOnGridAxes`'s
business. So pricing the elbows' private legs makes the *diagonal*
`straightToLead` shape relatively cheaper, and on seed 225 the winning node
moved to one whose head-on ladder accepts rung 2 — the diagonal. The term is
not wrong; it is **incomplete**, and an incomplete cost function moves work
from the invariant it prices to the one it does not.

**REVERTED. Revert grep-verified** (`privateLineRun|PRIVATE_LINE_COST_FACTOR|
offSharedLine|PRIVATE_MIN_RUN` -> 0 matches). A one-for-one swap of invariant
lines is not progress, and giving back a measured 16.2 m diagonal — the more
Jim-visible of the two, against complaint #3 — to gain a run 2.34 m off a
lattice line is churn.

**For the PR body:** *an incomplete cost function does not remove work, it
moves it to the invariant it cannot see* — and *two runs with the same failure
count can be a swap; only the set says which.*

**The next step, fully specified.** Price the diagonal too, so a node offering
a long diagonal is not made attractive merely by comparison with a priced
elbow. Pricing rather than refusing is the right instrument (refusal is variant
B), and the two prices must be introduced **together** — this measurement shows
that introducing either alone relocates the defect. Both columns, sixteen
seeds, and diff the violation **set**, never the count.

### BOTH PRICES TOGETHER — BUILT, MEASURED ON BOTH COLUMNS, REVERTED. The hypothesis is refuted.

My own handoff specified this: "price the diagonal too... the two prices must
be introduced **together** — introducing either alone relocates the defect."
**Built exactly that way, and it is worse than either.**

`offGridRun(shape)` = metres of a connector that are not a street on a shared
cardinal line, in one function with both halves:

- an axis-aligned run of 8 m or more further than 0.9 m from a 12 m or 6 m line
  through the plaza (`streetsShareLatticeLines`'s own families, anchor and
  tolerance);
- a diagonal leg, beyond a free allowance of exactly `ARRIVAL_LEAD_REACH` —
  **derived, not tuned**: a door's lead-to-door leg is a diagonal of precisely
  that length by construction and is the only diagonal the network needs.

Priced at 1.25/metre at all four connector push sites. `tsc --noEmit` exit 0.

**Column 1 — `check:park`: 12 green / 7 stranded -> 10 green / 13 stranded.**

| seed | kept | both prices | |
|---|---|---|---|
| 208 | 0 | **3** | **lost green** |
| 451 | 0 | **3** | **lost green** — the green this leg won |
| 11 | 1 | 1 | |
| 24 | 2 | 2 | |
| 225 | 2 | 2 | |
| 288 | 2 | 2 | |
| every other seed | 0 | 0 | green |

**Column 2 — `test:procgen`: 5 failed / 1404 -> 6 failed / 1403.** Set diff
against the kept state:

```
- seed 128  connector-stall.facePaint-station-1, 12.4 m on z = 41.65   (fixed, as before)
+ seed 225  connector-building-exit-ginormousSlide runs diagonally for 16.2 m
+ seed 267  'stall.facePaint' and 'stall.keychain' are 16.8 m apart in a
            straight line but 292.3 m apart by paving (17.43x, wasting 275.5 m)
```

**Refuted on both columns, and it violates the settled ranking** — two greens
and a 292 m walk to a destination 16.8 m away, for one invariant line.
**Reverted; revert grep-verified to 0 matches**, and 208 and 451 confirmed back
to exit 0 afterwards.

### The refutation's real content: the diagonal price did not stop the diagonal

**Seed 225's 16.2 m diagonal came back even though the diagonal was priced**,
at (16.2 - 3.5) x 1.25 = 15.9 on top of its length. A price that large not
changing the outcome is strong evidence the leg **is not produced by
`computeGridConnectors` at all** — nothing there was offered a cheaper
alternative to switch to.

That lands exactly on this file's own oldest unanswered question, recorded long
before this leg and still open:

> **131, 225 — an unidentified second producer. Find which router draws it
> before designing anything**; every fix aimed at the connector will keep
> missing it.

**That warning is now answered and half of it was wrong — corrected here so
nobody inherits the wrong reason.** There is no second producer. 225 is
`computeGridConnectors`'s `straightToLead`, rung 2, exactly as 131 turned out
to be; the connector's `direct` is 16.2 m and the invariant reports 16.2 m.
Fixes kept missing 225 not because they aimed at the wrong router but because
the verdict is carrier-relative and marginal (0.2 m over a 16 m threshold) —
see 'THE EXEMPTION SUSPICION IS REFUTED' at the end of this file.

131 was later located to the head-on straight shape. **225 never was**, and
this measurement is the strongest evidence yet that it is genuinely something
else. **So the next agent must answer that question before pricing, ordering or
refusing anything for 225** — three separate legs have now aimed a connector
fix at it and missed, which is precisely what that warning predicted.

**Kept from the attempt:** `ARRIVAL_LEAD_REACH`, the lead's 3.5 m given a name
in `arrivalLead`, carrying the `tmp-leadsnap.mts` finding as its doc comment so
the next agent does not re-derive the snap idea. No behaviour change.

**For the PR body:** *a price large enough to dominate that changes nothing
tells you the leg is drawn somewhere you are not looking.*

## 225's PRODUCER IDENTIFIED — and it refutes my own inference from the leg before

The Overseer made this a prerequisite on the strength of my inference that a
price of 15.9 changing nothing meant the leg "is not produced by
`computeGridConnectors`". **That inference is wrong. Measured, and recorded as
wrong rather than quietly dropped.**

`scripts/tmp-225prod.mts`, seed 225, the building's door at (40.3, 13.6).
`debugNodeEdges` prints its connectors — **all three of them, every one via the
same point**:

```
-> 37.428,19.119  cost 12.71  via (37.021,12.466)
-> 25.428, 7.119  cost 20.33  via (37.021,12.466)
-> 25.428,19.119  cost 27.18  via (37.021,12.466) (37.021,19.119)
```

`(37.021, 12.466)` is the door's arrival lead, at exactly
{@link ARRIVAL_LEAD_REACH} along its outward ray. The middle connector is
therefore `straightToLead` — `[node (25.428,7.119), lead, door]` — and
`debugDoorReach` gives that node `direct = 16.2`, **the invariant's reported
16.2 m to the decimal**.

**So the producer is `computeGridConnectors`, rung 2 of the arrival ladder,
exactly like seed 131's.** There is no unidentified second producer here. The
file's long-standing warning was right that fixes kept missing 225, and wrong
about why — and my "drawn somewhere you are not looking" line does **not**
apply to this leg. Strike it from the PR body.

**The price did not fail for want of an alternative, either.** The door has a
clean near connector at `37.4,19.1` — `ok=Y clear=Y`, every elbow flag true,
cost 12.71 against the diagonal's 20.33. A cheaper, fully axis-aligned option
was on offer the whole time and the search still took the far node, so the
deciding term is **total path cost to the node**, not the connector. That is
the same node-versus-node effect seed 128 showed, pushing the other way.

### The real anomaly, and it is NOT the one anybody has been chasing

**The identical geometry is drawn in the kept state and is legal there.** In
the kept state the same three points are carried by `connector-building-ballPit`:

```
kept        connector-building-ballPit
            (40.3,13.6) (37.0,12.5) (25.4,7.1) (23.7,2.2) (27.2,2.5)
both-prices connector-building-exit-ginormousSlide  -> pathsRunOnGridAxes FAILS
            "runs diagonally for 16.2 m, from 40.3, 13.6 to 25.7, 6.6"
```

Same door, same lead, same node, same diagonal — and `pathsRunOnGridAxes` does
not fire on it in the kept state. What changed under the prices is **which
interconnect consumes the connector**, not the shape of the connector.

**So the question to answer next is not "who draws it" — that is settled — but
"why is one carrier of this run judged and the other not".** Look at
`pathsRunOnGridAxes`'s run-merging and its `DOOR_APPROACH_REACH` (15 m)
exemption: a run that ends at a door is treated as a doorway approach, and
whether this run's end IS the door depends on which edge carries it and in
which direction. If that is what is happening, then the invariant is
**carrier-dependent** — it would pass and fail the same drawn metres depending
on which route object owns them, which is a defect in the invariant of exactly
the kind CLAUDE.md warns about ("a check that passes without checking
anything"), and it would mean seed 225 has been misdescribed for three legs.

**UNMEASURED. Recorded as the next step and as a suspicion, not a result** —
the exemption's exact condition has not been read, and I am not asserting it.

**For the PR body, replacing the struck line:** *the same drawn metres passing
under one route name and failing under another is a property of the check, not
of the park.*

## THE EXEMPTION SUSPICION IS REFUTED — and the carrier-dependence is real for a different reason

Read, as required, before asserting anything.

**`pathsRunOnGridAxes` has no `DOOR_APPROACH_REACH` exemption. It has no
exemption at all.** That constant belongs to `streetsShareLatticeLines`, whose
doc comment is where I read it; `pathsRunOnGridAxes` is fifty lines of
merge-consecutive-off-axis-hops with one threshold and one railway carve-out.
**So my recorded suspicion is wrong as to mechanism, and is struck.**

Two facts from the read that change the picture:

- **`MAX_DIAGONAL_APPROACH = 16`, and the reported run was 16.2 m.** Seed 225
  fails this by **0.2 m**. It is a marginal verdict, not a structural one, and
  nobody has said so in three legs of chasing it.
- **It measures the DRAWN CURVE**, `PathEdgeFact.points`, sampled every ~0.5 m
  off the Catmull-Rom, deliberately and for a stated reason. So every
  hand-computation anybody (me included) has done from *control* polylines is
  not the model this check uses.

### What the carrier-dependence actually is

The check walks **one edge at a time** and merges consecutive off-axis hops
into a run, flushing when a hop comes back on axis. A run therefore ends where
that edge's own curve happens to straighten — **which depends on the control
points the carrier supplies either side of the shared diagonal.**

The door-to-node diagonal at seed 225's building is one piece of painted
ground. `spur-building` ends at that door; `connector-building-ballPit` starts
at it; under the priced build `connector-building-exit-ginormousSlide` started
at it. **The same metres are therefore judged more than once, with different
neighbouring context each time**, and whether they merge into a >16 m run or
get broken by a fillet turning briefly on-axis is decided by the *route object*
rather than by the ground.

**So the anomaly is real and the invariant is carrier-relative — but the cause
is its unit of measurement, not an exemption.** Its unit is the route object;
the thing Jim looks at is the painted ground.

**HYPOTHESIS, NOT MEASURED:** that the ballPit carrier's curve straightens at
the node and splits the run below 16 while the ginormousSlide carrier's does
not. It is consistent with a 0.2 m margin and with both observations, and I
have not instrumented it. Whoever takes this should sample both carriers' drawn
curves and print the per-hop off-axis fraction across the shared node — that is
the measurement that settles it, and it is cheap.

### The Overseer's second question, answered honestly

*Does the check go red against geometry a child cannot walk, and green against
geometry she can?* **That is not this check's question, and saying so matters.**
`pathsRunOnGridAxes` is a **legibility** check — Jim's complaint #3, paths that
read as a grid — not a walkability one. A child walks the same diagonal
whichever route object owns it. `check:park`'s reachability figures are
unmoved by any of this, and were unmoved through every experiment this leg ran.

So the defect is not "reports success about ground a child cannot walk". It is
one layer over: **it reports a verdict about painted ground while actually
describing a route object**, so the same drawn metres can pass and fail at
once. That is still this repo's dominant fault — an assertion reporting about
something it is not describing — and it is exactly what CLAUDE.md's "a check
can pass without checking anything" section is about.

### Which change is it?

**Its own change, not part of the path work.** Nothing a player can see
changes: the ribbons are identical, the reachability is identical, and the fix
is to what the check measures over — deduplicating shared metres, or measuring
runs over the painted network rather than per route object. That is invisible
by CLAUDE.md's own definition, so it merges on review plus a QA agent having
actually measured it, without going to Jim. Doing it inside this branch would
also mix a check fix into a path fix, and then neither column means what it
says.

**And it must be proved on both sides**: red on a genuine long diagonal, green
on the same metres judged from any carrier. A check that changes its answer
with the observer has not been fixed until it stops doing that.

**For the PR body, unchanged and now measured:** *the same drawn metres passing
under one route name and failing under another is a property of the check, not
of the park.* With the correction that the mechanism is the unit of
measurement, not an exemption — **and that seed 225 fails it by 0.2 m against a
16 m threshold**, which is worth saying plainly after three legs of treating it
as a structural defect.

## 288's `noPathEndsNowhere` — a promise the generator makes and does not keep

```
bridge-walk-0 paved=true ring->ring
  (16.3,-21.2) (11.7,-20.3) (0.3,-31.7) (-2.0,-34.0) (-4.3,-36.3) (-15.7,-47.7)
```

Read against `walkEveryBridge`, the shape is unambiguous: `(16.3,-21.2)` is the
branch off existing paving, `(11.7,-20.3)` the near foot, the three middle
points the deck's own pinned control points, and `(-15.7,-47.7)` the **far
foot**, where the route simply stops. `onward` was `null` — the search for
paving on the far side found none — so nothing was appended.

**The generator says so itself, and the sentence is the defect:**

> *"Where the far side has nothing paved yet, the foot is the end: a bridge
> foot is a real place to arrive, and **the next destination on that side will
> branch from it**."*

On seed 288 no destination ever did. So the ribbon stops 17.61 m from anything,
in the grass, and `noPathEndsNowhere` is right to fail it. **That is a path to
nowhere — issue #114's own class, and Jim-visible**, not merely an invariant
line: a child walks over a bridge and off the end of the paving.

**This is a forward promise with nothing checking it was kept.** `walkEveryBridge`
runs while the network is still being grown, so at that moment "will a later
destination branch from this foot?" is genuinely unanswerable there — the same
ordering shape as the border fence, and it takes the same answer: **the fix
belongs where the answer exists, which is after all destinations are routed.**

**The fix, per the standing procgen rule (backtrack, never accept a result that
does not clear):** a post-pass over the drawn bridge walks. For each whose far
end has no other paving within `ARRIVAL`, either

- extend it to the nearest paving on that rail side — `gridSearch` from the far
  foot to `pavedGridNodes` on that side, exactly the `onward` query already
  written, just re-asked once the network is complete; or
- if there is still nothing on that side at all, drop the walk — **but weigh
  that against the call site's own reason for existing**, that an unwalked site
  is a *sealed pocket* rather than an unused shortcut. Dropping may trade this
  invariant for a reachability failure, which the settled ranking forbids.

So the first branch is the one to build, and the second is the fallback that
must be measured, not assumed. **Both columns, sixteen seeds, and diff the set.**

**NOT BUILT. Measured and specified only** — I would rather hand this over
correctly than half-build it. Note `walkEveryBridge` also calls
`trimBacktracks` on its assembled points, so anything added here must respect
`drawsAsScreened`'s lesson: the shape that gets drawn is not always the shape
that was assembled.

### The 288 post-pass — BUILT, and its own announcement refutes the premise

`joinStrandedBridgeWalks` re-asks `walkEveryBridge`'s `onward` query after
`addInterconnects`, when the network is complete, and extends any walk that
ended on a bare foot to the nearest paving on its own rail side. It refuses an
extension `trimBacktracks` would alter (`drawsAsScreened`), and it does **not**
drop a walk it cannot join — the sealed-pocket cost is measured at 105 stranded
waypoints on seed 225 and the ranking is settled. `tsc --noEmit` exit 0.

**Its coverage line is what produced the finding, and it is the finding:**

```
bridge walks ending on a bare foot: 1 — 0 joined to the far side's paving,
  1 with no paving on that side at all,
  0 refused because the seam would be trimmed into an unscreened leg
```

**`noPaving = 1`.** With every destination routed, seed 288's bridge-walk-0 has
**no paved node on the far side at all**. The promise was not merely unkept —
on this seed it was **never keepable**. The bridge crosses into an empty
quarter, and no post-pass can join a ribbon to paving that does not exist.

**Both columns, sixteen seeds:**

- `check:park`: **12 green / 7 stranded — unchanged, no seed moved.**
- `test:procgen`: **5 failed / 1404 passed**, violation set **byte-identical**.

**So the joining branch is UNPROVEN: it never fires anywhere in the pool.** By
this branch's own rule a change that measures nothing is not kept, and I am not
claiming this one as a win. What it *did* buy is the announcement — a silent
degeneracy is now a reported one, and it is how `noPaving = 1` was learned at
all. I have left it on the branch rather than reverting it, and flag the
decision as the Overseer's: **the mechanism is correct by construction and
unexercised by the pool**, which is exactly the state CLAUDE.md warns about
("break every check deliberately and watch it go red before you trust it
green"). Nothing here has been watched go red.

**What 288 actually needs, restated now the premise is gone.** The defect is
not a missing join. It is that **a proven crossing site whose far side holds
nothing gets a walk anyway**, because `walkEveryBridge` paves every proven site
to avoid sealed pockets. Two honest options, neither measured:

- pave the walk but give it a real terminus on the far side — the far foot is
  where a child arrives, so something should be *there*, which is a layout
  question, not a routing one;
- or accept the walk as a stub and make `noPathEndsNowhere` say so by name,
  distinguishing "ends nowhere because nobody joined it" from "ends at a bridge
  foot on a side with nothing on it". Those are different facts and the check
  currently reports them identically.

The second is cheap and honest; the first is the one a six-year-old would
notice, because a bridge to an empty field is a disappointment either way.
**Neither is built. Do not treat 288 as diagnosed-and-pending-a-join any more —
that diagnosis was mine and the announcement refuted it.**

## State — 3 Sep, tenth leg: the 288 premise is refuted TWICE, and `noPaving` is a mis-worded counter

**Overseer ruling picked up this leg:** prove `joinStrandedBridgeWalks`'s joining
branch fires, or revert it. What follows is the measurement, and it changed the
question.

### The instrument, and its control

`scripts/tmp-joinsweep.mts` captures `console.warn` **for the whole process**
and prints the pass's own counter line. Two things it had to get right, both
found by running the control first:

- `park-harness`'s `quietly`/`said` collector sees **nothing** here — the park
  is built more than once per process and the collector wraps only one of those
  builds. A probe reading `park.said` reported `NO-ANNOUNCEMENT` on seed 288
  while the line was plainly on the terminal. Capture `console.warn` at process
  scope instead.
- The announcement is conditional (`noPaving > 0 || refusedByTrim > 0`), so a
  sweep looking for `joined > 0` cannot see it. For the sweep only, the guard
  was temporarily forced: `if (true || noPaving > 0 || refusedByTrim > 0)`.
  **That instrumentation is not committed.**

CONTROL rows: seed 288 reproduces `stranded=1 joined=0 noPaving=1
refusedByTrim=0`, and the canonical seed produces a full zero row rather than no
row — so "the pass did nothing" and "the instrument saw nothing" are
distinguishable.

### Sweep: seeds 1–120 outside the pool, 62 of which built

| seed | counter |
|---|---|
| 16, 23, 38, 39, 40, 50, 65 | `stranded=1 joined=0 noPaving=1 refusedByTrim=0` |
| 116 | `stranded=1 joined=0 noPaving=0 **refusedByTrim=1**` |
| the other 54 | `stranded=0` — the pass has nothing to do |

**Seed 116 is the first evidence the pass is not inert.** `noPaving=0` there
means the `onward` re-ask **did** find paving on the far side and **did**
assemble an extension; only `drawsAsScreened` refused the seam. So the search
half and the refusal half of the joining branch are both exercised on a real
park. The commit half still is not, anywhere in 78 seeds.

### Seed 288's "empty quarter" is REFUTED — measured, and the previous leg's headline was mine to correct

`scripts/tmp-288end.mts`, seed 288:

```
side=+1: 19 path nodes — gate, plaza, building, hotel, ballPit, dodgems,
         waterFight, stall.*, station-0, station-1, exit-*
side=-1:  3 path nodes — ferrisWheel, stall.spaceFerrisWheel, exit-ferrisWheel

bridge-walk-0 start (16.26,-21.22) side=+1  nearestOtherPavingSameSide=0.00
bridge-walk-0 end   (-15.69,-47.69) side=-1 nearestOtherPavingSameSide=21.19
                                            nearestOtherPavingAnySide=18.58
```

**The far side is not empty.** It carries three destinations and their paving,
the nearest of it **21.19 m** from the foot the walk stops at. The previous
leg's "the bridge crosses into an empty quarter, so the promise was never
keepable" is wrong, and so is the brief built on it. My own first prediction —
that the far side would hold *no destination* — was wrong too, and is recorded
here as wrong.

### What `noPaving` actually means: the foot is graph-isolated, not the side empty

Instrumented inside the pass (seed 288):

```
far=845 at (-15.7,-47.7) farSide=-1 pavedGridNodes=45..49 pavedOnFarSide=1
  anyPavedReachable=2
far-side nodes: 300 301 302 328 329 330 331 332 357 358 359 360 387 388
  416 417 847 851 858 867  — every one UNREACHABLE from 845
  845@(-15.7,-47.7) *paved  ← the only paved node on that side is the foot itself
```

Twenty of the twenty-one grid nodes on the far side are **unreachable from the
far foot**; its only edge is the deck. `anyPavedReachable=2` is the near foot,
back across the deck, which the side filter correctly refuses.

So **`noPaving` does not mean "no paving on that side"**. It means "no paved
grid node reachable across the lattice from this foot", and the counter's
wording asserts the stronger fact. That is this branch's own recurring disease —
a report describing something other than what it measured — and the wording is
corrected rather than the measurement.

### Why the foot is isolated — already in the code, now measured

`paths.ts:3455`'s own comment records it: seed 288's foot at (-15.7,-47.7) is
cut by a **different** site's reservation, site 1 rather than its own site 0, so
no widening of an own-site exemption can reach it. Measured this leg
(`tmp-288end.mts`):

```
foot (-15.69,-47.69) vs site d=0.0   : along=-19.36 across= 0.00 reach=15.2 halfW=4.0
                     vs site d=152.0 : along= -7.87 across= 4.94 reach=15.2 halfW=5.0
```

`across=4.94` against site 1's `halfWidth=5.0`, `|along|=7.87` well inside its
15.2 m reach: **the foot of site 0 stands squarely inside site 1's forbidden
band.** Two proven crossing sites 28 m apart on the loop have reservations that
overlap onto each other's feet.

**That is the defect on 288, and it is in the crossing planner
(`footprintsOverlap` in `crossingPlanSolve.ts`), not in the join pass and not in
`noPathEndsNowhere`.** No post-pass can join a foot the lattice cannot leave.

### THE RULING IS DISCHARGED: the joining branch is proved, watched, and kept

The Overseer's ruling was *prove it or revert it*, and a deliberately mutated
park was explicitly allowed. The mutation used, in `walkEveryBridge`:

```ts
// TEMP MUTATION: force every bridge walk to end on a bare foot
if (process.env.LGP_FORCE_STRANDED_WALKS) return null;   // before `return settled && ...`
```

with the counter's guard forced to `if (true || ...)` so a zero row is
distinguishable from no row. **Watched:**

```
canonical  stranded=2 joined=1 noPaving=0 refusedByTrim=1
  bridge-walk-1  far foot (2.91,-11.45) -> new end (17.62,-15.40)
                 6 points -> 10; onward path 3 grid nodes
                 tail (2.91,-4.62) (14.93,-4.62) (14.93,-15.40) (17.62,-15.40)
seed 5     stranded=2 joined=1 noPaving=0 refusedByTrim=1
  bridge-walk-0  far foot (0.00,55.36) -> new end (5.12,57.26)
                 7 points -> 8; onward path 2 grid nodes
seed 11    stranded=0  (every deck already walked by another route)
seed 451   stranded=1 joined=0 noPaving=0 refusedByTrim=1
seed 288   stranded=1 joined=0 noPaving=1 refusedByTrim=0  — unchanged, and
           correctly so: its foot is graph-isolated, mutation or not
```

The tails are axis-aligned lattice walks, which is the shape the pass claims to
draw. **Both mutations reverted, grep-verified** (`grep -n "TEMP \|
LGP_FORCE_STRANDED_WALKS\|if (true ||" src/world/paths.ts` returns only the
pre-existing debug exports at the end of the file, which item 4 deletes).

**And the mutation explains the narrowness rather than excusing it.** Unmutated,
`walkEveryBridge` asks this same question at the moment it draws the walk, so
anything the post-pass could find there has already been found. Its window is
only paving laid *after* the walk is drawn — `ensureCompassTaps`,
`addInterconnects`, a later bridge walk. That is small on purpose, and it is not
inert: seed 116 exercises the refusal branch on an unmutated park, with
`noPaving=0`, i.e. the far side's paving really was found.

**Kept.** Both halves of the doc comment's claim are now measurements.

### Also fixed: the counter said something it had not measured

`${noPaving} with no paving on that side at all` -> `${noPaving} whose far side
holds no paved node the lattice can reach from that foot`. The old wording is
what produced the previous leg's wrong headline, and a whole brief was written
on it.

### `noPathEndsNowhere` now distinguishes the two faults — proved red, and its control caught a bug in it

The clause added to the `'ring'`-end branch: when a stray end's nearest paving
turns out to be **across the railway**, say so and give the nearest on its own
side.

**PROOF — seed 288, unmutated, the clause fires** (`vitest run
test/procgen/seed-288.test.ts`, exit 1):

```
bridge-walk-0's end at -15.7, -47.7 is 17.61 m from the nearest other paving —
it branches off nothing; that paving is across the railway, and the nearest on
this end's own side is nowhere at all — so nothing on this side was ever built
for it to join
```

Geometry it was proved against (`scripts/tmp-288end.mts`, seed 288):

```
bridge-walk-0 (16.26,-21.22) ... (-15.69,-47.69)
  end side=-1, nearest other paving any side 18.58 m, all of it side +1
  side -1 path nodes: ferrisWheel, stall.spaceFerrisWheel, exit-ferrisWheel
  spur-ferrisWheel            paved=FALSE
  spur-stall.spaceFerrisWheel paved=FALSE
  spur-exit-ferrisWheel       paved=FALSE
```

**CONTROL — a stray end whose own side does have paving must NOT get the
clause.** No such end exists in the pool, so one was made: in `paths.ts`,
`if (process.env.LGP_TRIM_SPUR_START === destination.id && points.length > 2)
points.splice(0, points.length - 2);` right after the `SPUR_STRETCH` hook,
which pulls a spur's start off the network on the canonical seed (both sides of
which carry 11 destinations). Canonical seed, exit 1 both times, **no clause**:

```
LGP_TRIM_SPUR_START=hotel
  spur-hotel's start at 41.2, 58.2 is 25.52 m from the nearest other paving
    — it branches off nothing
LGP_TRIM_SPUR_START=stall.keychain
  spur-stall.keychain's start at -6.7, -12.6 is 3.48 m from the nearest other
    paving — it branches off nothing
```

**The control earned its keep on the first run.** The first cut fired the clause
on *both* of those, claiming "the nearest paving on its own side is 3.48 m away,
so there was nothing on this side to join it to" — against an overall figure of
3.48 m, i.e. the paving it was calling unreachable was the paving it had just
measured. Cause: the same-side figure was measured to a ribbon's **vertices**
and the overall figure to its **segments**, so the same-side number was larger
by a hair essentially always. Two definitions of one distance, hand-written into
the check meant to catch that class. Rebuilt as one measurement asking the
direct question — *which side is the nearest paving on?* — with the side read at
the closest point on the ribbon, and **no threshold anywhere**.

**Third finding on 288, and it supersedes both earlier accounts.** `pathEdges`
is paved-only, which is the right unit, and on seed 288 **all three far-side
destinations are `paved=false`** — `paths.ts` drew them no ribbon at all. So the
far quarter has one bridge landing in it, three attractions, and zero paving,
and the isolated far foot is one symptom of that rather than the whole of it.

**`test:procgen` after: 5 failed / 1404 passed — violation SET byte-identical**
to the inherited baseline (5/11/128 `streetsShareLatticeLines`, 267
`detourRatiosStayReasonable`, 288 `noPathEndsNowhere`). Only 288's message text
moved. Control mutation reverted, grep-verified (`grep -n
"LGP_TRIM_SPUR_START\|TEMP MUTATION" src/world/paths.ts` — nothing).

### Sweep caveat, stated rather than glossed

A second sweep (seeds 121–340, 88 clean counter rows) adds eleven more
`noPaving=1` walks and a **second `refusedByTrim=1`** (seed 202, joining seed
116). But part of that sweep ran **after** the forced guard was reverted, and
under the shipped conditional guard a pure `joined=1 noPaving=0
refusedByTrim=0` row prints nothing at all — so that sweep **cannot** rule out a
join in its own range. Only the 1–120 sweep, which ran entirely under the forced
guard, is conclusive, and the mutation proof above is what actually settles it.

### Still owed after this leg (unchanged list, two struck)

- ~~The `joinStrandedBridgeWalks` ruling~~ — discharged: proved firing, kept.
- ~~`noPathEndsNowhere` on 288 distinguishing the two faults~~ — done, with
  control.
- **288's real defect is now named and is NOT in `paths.ts`'s router**: three
  far-side destinations, all `paved=false`, plus a far foot cut off by a
  *neighbouring* crossing site's reservation. Whoever takes it should start at
  `footprintsOverlap` in `crossingPlanSolve.ts` and at why those three doors got
  no ribbon at all — **and it is a layout question as much as a routing one, so
  the Overseer/Jim call flagged in the brief still stands.**
- `streetsShareLatticeLines` on 5, 11, 128 — as a **node-choice** question.
- `detourRatiosStayReasonable` on 267 — honest baseline first.
- Stage-2 invariant (b); probe deletion (`tmp-stoneground.mts` last, re-run
  after any reservation or `bridgeFootprint.ts` change); the rebase.
- **Probes added this leg, to delete with the rest:** `tmp-joinsweep.mts`,
  `tmp-288end.mts`.
- **Reproductions for the two mutations used this leg** are written out above in
  full; neither is on the branch.

### The Overseer's question answered: seed 288's far quarter is NOT cut off

`test/procgen/tmp-288reach.test.ts` (TEMP, delete with the probes) asks
`reachableFromEntrance` — the game's own `NavGrid`, player radius and jump apex,
bridge decks included — of every destination on seed 288.

**CONTROL first, on the same run**, because a flood fill that answers everything
the same way has answered nothing: a point 400 m outside the boundary comes back
`reachable=false`. It discriminates.

```
  (400, 400)                   reachable=false                    <- control
  gate/plaza/hotel/...         reachable=true   grassToNearestPaving= 0.00 m
  FAR ferrisWheel              reachable=true   grassToNearestPaving= 9.07 m
  FAR stall.spaceFerrisWheel   reachable=true   grassToNearestPaving= 7.71 m
  FAR exit-ferrisWheel         reachable=true   grassToNearestPaving=10.99 m
```

**Plainly: a child can walk to the Space Ferris Wheel on seed 288.** She crosses
the bridge and then walks **7.7 to 11.0 m over grass**, because those three
destinations drew no ribbon. Every one of the park's other nineteen
destinations has paving reaching it — `0.00 m` — so the three are the only ones
in the park a child reaches off the paths.

So this is **not** an unreachable attraction and not a lockout. It is a quarter
of the park with a bridge into it and no paths in it, which is a
looks-unfinished defect of exactly Jim's complaint #4 ("the paths don't go up to
the door ... reliably"), not of #5's "useful places". Recorded so nobody
escalates it as a lockout, and nobody files it as cosmetic either.

---

## State — 3 Sep, eleventh leg (successor). Baseline recaptured unpiped.

Worktree `.claude/worktrees/grid-paths-eng2`, branch `grid-paths-eng2`, pushed
to `origin/feat/grid-paths`. Started at `40878be0`.

### Baseline, captured unpiped to a file, exit code read

`pnpm run test:procgen` — **exit 1, `Test Files 5 failed | 23 passed (28)`,
`Tests 5 failed | 1405 passed (1410)`.** Note the pass count read off the
screen is **1405**, not the 1404 in the brief; the violation SET is what
matters and it is the inherited one:

```
seed   5  streetsShareLatticeLines  spur-waterFight  E-W 11.0 m on z = -23.31, 2.57 m off
seed  11  streetsShareLatticeLines  spur-building    E-W  8.5 m on z =  58.06, 2.87 m off
seed 128  streetsShareLatticeLines  connector-stall.facePaint-station-1
                                                     E-W 12.4 m on z =  41.65, 2.34 m off
seed 267  detourRatiosStayReasonable  stall.railRacer / exit-railRace
                                     5.0 m apart, 76.8 m by paving (15.24x, wasting 71.7 m)
seed 288  noPathEndsNowhere         bridge-walk-0's end at -15.7,-47.7
```

**One thing the brief groups that the set separates:** 128's offender is a
`connector-`, 5's and 11's are `spur-`s. They are not guaranteed to be one
producer and should not be assumed to be.

### THE MECHANISM ON 128, MEASURED — and it CONTRADICTS the node-choice framing

`scripts/tmp-elbowpick.mts` (control built in: the winning shape is
reconstructed from push order alone and compared against what
`debugNodeEdges` reports as drawn — `viaMatches=Y` on both elbow rows, so the
reconstruction discriminates). Seed 128, `stall.facePaint`, door node
(27.084, 39.175):

```
  -> 26.583,45.310  cost  10.27  lead(29.559,41.649)
       leadDx= 2.98 (discip)  leadDz= 3.66 (discip)   drawn=straightToLead
  -> 14.583,45.310  cost  27.67  lead(29.559,41.649)
       leadDx=14.98 (rogue)   leadDz= 3.66 (discip)   drawn=elbowViaRow      viaMatches=Y
  -> 14.583,33.310  cost  33.52  lead(29.559,41.649)
       leadDx=14.98 (rogue)   leadDz= 8.34 (rogue)    drawn=elbowViaColumn   viaMatches=Y
       *** SWAPPABLE: same length, private run 14.98 -> 8.34 m ***
```

The third row is the connector the invariant fails on. At **that same node, at
exactly the same cost**, `elbowViaRow` was available:

| shape at node (14.583,33.310) | leg on node's line | leg on lead's line |
|---|---|---|
| `elbowViaColumn` (drawn) | x = 14.583 **shared**, 8.34 m | z = 41.649 **private, 14.98 m** |
| `elbowViaRow` (not tried) | z = 33.310 **shared**, 14.98 m | x = 29.559 **private, 8.34 m** |

Both elbows are Manhattan over the same rectangle, so **their lengths are
identical and `cost = length * STUB_COST_FACTOR` cannot tell them apart.** Both
are `rogue` (both `leadDx` and `leadDz` exceed `STUB_TAIL_LIMIT` 7.8), so they
land in the same bucket, and the bucket is filled `elbowViaColumn` first
**unconditionally** (`paths.ts` ~2559). The shape loop `break`s at the first
acceptance, so `elbowViaRow` is never evaluated.

**So the private run is 14.98 m rather than 8.34 m because of a push order, not
because of a price, a node choice, or a screen.** Nothing in the search ever
compared the two.

### Why the framing said otherwise, and where the earlier read went wrong

The inherited framing — "node-choice, not connector-shape; the shared-line
connector was already cheaper at 27.67 vs 33.52 and still lost on total path
cost" — is **true and remains true about which node wins**. It is not the whole
defect. There is a second, independent loss *inside* the winning node.

The earlier "the reorder is doubly closed" finding computed `leadDx = 15.0`,
`leadDz = 20.3` from node **(14.6, 21.3)** — a vertex further along the drawn
`connector-stall.facePaint-station-1` polyline, which concatenates the
connector with the onward route to `station-1`. The connector's own node is
**(14.583, 33.310)**. At the wrong node `elbowViaColumn` really is the better
of the two, which is exactly why the reorder was closed; at the real node the
numbers are 14.98 and 8.34 and **the conclusion inverts**. Recorded as a wrong
prediction inherited and corrected, not quietly dropped.

### Why this is not any of the seven measured-dead approaches

It is a **tie-break, not a price and not a refusal**. The two shapes have equal
length, so:

- the node's offered cost is **unchanged**, therefore **node choice cannot
  move** — which is precisely the mechanism by which `privateLineRun` relocated
  work onto seed 225's `pathsRunOnGridAxes` and both-prices onto 267's
  `detourRatiosStayReasonable`;
- `straightToLead`'s position in the ladder is untouched, so the diagonal is
  neither made cheaper nor more expensive;
- no door loses a shape and no rung is removed, so it cannot starve the way
  variant B's hard tail bound did (12 green/7 stranded -> 9/16).

**Prediction recorded before measuring:** `check:park` unchanged at 12 green /
7 stranded, and seed 128 drops out of the `streetsShareLatticeLines` set. To be
measured on both columns, set-diffed, and reported either way.

### THE TIE-BREAK — BUILT, MEASURED ON BOTH COLUMNS, KEPT

`computeGridConnectors` now sorts each of the two buckets by the length of the
shape's own private leg (`leadDx` for `elbowViaColumn`, `leadDz` for
`elbowViaRow`) before the ladder runs. Four lines. `sort` is stable, so equal
private legs keep the previous column-first order. `pnpm exec tsc --noEmit`
exit 0; `pnpm run build` exit 0.

**Column 2 — `test:procgen`: exit 1, `Test Files 4 failed | 24 passed (28)`,
`Tests 4 failed | 1406 passed (1410)` (from 5 failed / 1405 passed).
Set-diffed against the baseline file, not counted — it is a PURE REMOVAL, one
line out and nothing in:**

```
- seed 128  every street sits on the shared 12 m lattice
            connector-stall.facePaint-station-1  E-W 12.4 m on z = 41.65, 2.34 m off
```

Seeds 5, 11 (`streetsShareLatticeLines`), 267 (`detourRatiosStayReasonable`)
and 288 (`noPathEndsNowhere`) are byte-identical to the baseline. **No swap** —
which is the failure mode both pricing experiments had, and the reason the set
was diffed rather than the count read.

**Column 1 — `check:park`, all sixteen pool seeds: 12 green / 7 stranded.
UNCHANGED. No seed moved in either direction.**

```
canonical 0   5 0    11 1   24 2   115 0  128 0  131 0  208 0
225 2     267 0  274 0  288 2  326 0  346 0  428 0  451 0
```

**The prediction recorded before measuring — column 1 unchanged, 128 out of the
column-2 set — held on both counts.** It held for the stated structural reason:
equal-length shapes leave the node's offered cost untouched, so no node choice
moved, so no work could be relocated onto `pathsRunOnGridAxes` or
`detourRatiosStayReasonable`. That is the property the two pricing experiments
lacked.

**The drawn change on 128, at the same node and the same cost 33.52:**

```
before  door (29.559,41.649) (14.583,41.649) (14.583,33.310)   14.98 m private on z=41.649
after   door (29.559,41.649) (29.559,33.310) (14.583,33.310)    8.34 m private on x=29.559,
                                                                then 14.98 m on z=33.310 (lattice)
```

**For the PR body:** *when two shapes are the same length, cost cannot choose
between them and push order silently does — so a search that breaks at its
first acceptance must be ordered by what the cost function cannot see.* And:
*a tie-break is not a price; it is the one way to prefer a shape without
moving which node wins.*

**Item struck: `streetsShareLatticeLines` on 128.** Still open on 5 and 11,
whose offenders are `spur-`s, not connectors — a different producer, to be
instrumented rather than assumed to be this one.

### Seeds 5 and 11 are NOT the same defect as 128 — the corner sort reproduces as neutral, now WITH a reason

The `connector-` / `spur-` prefix split flagged at the top of this leg was
real. 128's offender came from the **head-on elbow ladder**; 5's and 11's come
from the **second connector block** (`corners`, `paths.ts` ~2741), whose own
comment records that sorting corners by tail was measured neutral and reverted,
and invites a successor: *"whoever finds a case where it bites should reach for
it first."*

**Built it, measured it, reverted it — it is still neutral, and this time the
cause is named rather than the verdict merely repeated.**

`test:procgen` with the corner sort: `4 failed | 1406 passed`, **violation set
byte-identical** to the tie-break state. Seed 5's `spur-waterFight` control
polyline is byte-identical too:

```
(20.0,-2.7) (29.1,-2.7) (29.1,-14.7) (17.1,-14.7) (17.1,-20.7) (-6.9,-20.7)
(-6.9,-23.3) (7.8,-23.3) (11.7,-39.0) ...
```

**Why it cannot bite, measured.** Seed 5's leg is the connector
node (-6.880,-26.736) -> corner -> foot (7.830,-23.308):

| corner | nodeLeg | tail (private) | total | `streetClear` | `ring` | `railSide` | `ramp` |
|---|---|---|---|---|---|---|---|
| A (drawn) (-6.880,-23.308) | 3.43 | **14.71** | 18.14 | true | true | true | **true** |
| B (alt) (7.830,-26.736) | 14.71 | **3.43** | 18.14 | true | true | true | **false, both legs** |

**Corner B is refused by `segmentCutsABridgeRamp` on both of its legs.** The
terminal is a *bridge foot*, so the alternative corner is the one that turns
along the bridge's own axis and lies inside the reservation. Corner A is
therefore correct, the tie is not a tie, and no ordering can change it.

**MY PROBE WAS WRONG AND ITS OWN CONTROL DID NOT CATCH IT — recorded, because
the next agent will otherwise trust it.** `scripts/tmp-corner.mts` reported
both corners "clear" using `debugArrivalLegScreens`, which asks only
`streetSegmentClear` — **one of the four screens in `legClear`** (the others
are ring, rail side and bridge ramp). Its control (a corner 200 m outside the
park) came back BLOCKED and looked like it discriminated, but it is blocked by
the *street* screen, so it could never have detected a probe blind to the other
three. **A control only discriminates on the axis it varies.** The honest
instrument is `debugLegScreens`, which prints all four; that is what produced
the table above. `tmp-corner.mts` must be deleted with the other probes or
fixed to call `debugLegScreens`.

**So the remaining `streetsShareLatticeLines` failures on 5 and 11 are a
node-choice question after all** — the inherited framing holds for *these two*,
and 128 was the exception to it. Seed 5's private run is structurally forced at
that node: its only alternative corner is inside a bridge reservation. Removing
it needs a different node, not a different shape, and that is the
`debugDoorReach`/`tmp-128face.mts` question — *which screen refuses the nearer
lattice nodes* — asked at the foot rather than at a door. Not started.

**Revert grep-verified:** `grep -c 'corners.sort' src/world/paths.ts` -> 0;
head-on tie-break confirmed still present (`privateLegOf` -> 3 matches);
`tsc --noEmit` exit 0.

### Where this leg leaves the queue

- [x] `streetsShareLatticeLines` on **128** — fixed, both columns measured.
- [ ] `streetsShareLatticeLines` on **5 and 11** — reframed as node-choice with
      the alternative shape proved structurally unavailable on 5. Next question
      is which screen refuses the nearer nodes at the foot.
- [ ] 267 `detourRatiosStayReasonable` — honest baseline first (the route it
      replaced ran through solid ground). NOT STARTED.
- [ ] Stage-2 invariant (b). NOT STARTED.
- [ ] Probe deletion — now also `tmp-elbowpick.mts` and `tmp-corner.mts`
      (the latter is *wrong*, see above). `tmp-stoneground.mts` last.
- [ ] The rebase onto `origin/main` (`check:coplanar` is on `main`, absent here).
- [ ] `pnpm run check` has still NOT been run on this branch.
