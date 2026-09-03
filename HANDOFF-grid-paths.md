# HANDOFF — grid-first path network (the path rework Jim actually asked for)

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
