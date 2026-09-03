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
shapes — it is in what those two short final stubs land on. Chase the two
stranded waypoints on 267 with `tmp-pocket.mts` / `tmp-blocker.mts` at the
ends of `(-3.7,-73.5) -> (-3.7,-77.0)` and `(-11.8,-73.5) -> (-11.8,-76.6)`.
**Do not treat this as an argument against the rule**; on the evidence it is
an argument for it.

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
