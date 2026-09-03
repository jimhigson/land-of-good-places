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

## State — what remains

- [x] Stage 1 grid solve (pushed).
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

### `poi.stranded` — what is measured, and what is ruled out

The parent-branch probe was run (ordered, and it answers the "did this branch
cause it" question): **parent seed 225 gives 19/19 attractions, 284/284
waypoints connected, all six invariants.** This branch gives 254 seeds placed,
183 in the main component, 70 stranded. So yes, this branch causes it.

**Both branches build the same three bridges**, at the same three proven sites
(railD 0 / 102 / 194) with the same halfGaps — measured with the park harness on
each branch. The rail is **not** the split: waypoint seeds by rail side are
90 inside / 164 outside on this branch (97 / 187 on the parent), and 94 of the
164 outside seeds ARE in the main component. The bridge-ramp-span hypothesis is
therefore dead — write it off, do not re-run it.

**What the 70 actually are.** Every one of them belongs to a route of the *east
district*, and that district's routes are the whole list:

```
spur-building 14  spur-stall.waterFight 12  spur-waterFight 11  spur-hotel 9
spur-exit-ginormousSlide 6  spur-ballPit 6  connector-building-exit-ginormousSlide 4
spur-stall.skyCruiser 4  spur-exit-skyCruiser 4
```

One contiguous district, every route in it, nothing else. So the district's own
path network is internally connected and joins the rest of the poiGraph
nowhere.

**Ruled out by measurement, each mutation reverted** (do not re-litigate any of
these):

| suspect | seed 225 before → after |
|---|---|
| `collapseCollinear` dropping a bridge's pinned deck points | 105 → 105 |
| rescue router's 2.2 m plot clearance + 2.0 m arrival boundary | 70 → 70 (seed 115 16 → 16) |
| a second drawn route over every bridge | 70 → 70 |
| connectors/relay hugging the rail (margin 0 vs `RAIL_CLAMP_DISTANCE - 0.1`) | 70 → 71 |
| trimming route backtracks | 70 → 70 |
| refusing a gate-corridor mouth that stands on a bridge ramp | 70 → **74** (reverted) |

(The first three fixes were kept anyway — each is a correctness fix in its own
right, and `walkEveryBridge` took seed 451 from 3 stranded to a full pass.)

**A real defect found on the way, which is NOT the cause.** The gate corridor's
mouth on seed 225 came to rest at `(0, 39.8)` — exactly the 5.8 m
`GATE_CORRIDOR_RAIL_STANDOFF` from the track and **four metres up the front-door
bridge's ramp**, because that standoff is measured from the rail centre line and
a ramp reaches three times further. The mouth is the node every later route
branches from, and `spur-building` — the east district's only join to the rest —
branched exactly there. This is #414's "another path shouldn't join into a
mid-ramp bridge" and Jim's own complaint 1, so it wants fixing on its own
merits. It is **not** the stranding cause: screening it took seed 225 from 70 to
74, so the change was reverted rather than kept on a story. Whoever fixes it
should do so where the junction is chosen, and measure.

**The articulation-point hypothesis is REFUTED, and the cause is found.**
Instrumented with `scripts/tmp-poigraph.mts` / `tmp-poilinks.mts` /
`tmp-poibreaks.mts` (committed; control: `tmp-poigraph` reproduces check:park's
independently-computed 254 seeds / 184-vs-183 main component on seed 225).

- The district is **not** joined at one point: 29 poiGraph edges run between the
  east routes and the rest. The parent has 81.
- Seed 225 has **three** components (184 / 47 / 23), and the closest
  cross-component pair is **3.12 m apart** — far inside `MAX_EDGE`, so the
  failure is geometric, not topological.
- `tmp-poibreaks` walks each route's own samples in order and reports
  consecutive samples that are not neighbours. Seed 225 has exactly four such
  breaks, and **all four have their midpoint standing on a bridge ramp**:

```
spur-building       (1.3, 40.9)-(5.3, 40.9)   gap 4.02 m   ramp: true
spur-waterFight     (1.4,-51.8)-(5.4,-50.7)   gap 4.11 m   ramp: true
spur-waterFight     (5.4,-50.7)-(9.3,-50.7)   gap 3.95 m   ramp: true
spur-stall.keychain (-1.1, 19.8)-(-5.4, 20.0) gap 4.33 m   ramp: true
```

**A drawn ribbon that crosses a bridge ramp transversely breaks the waypoint
chain**, because the parapet is solid, and the two halves of that route — and
everything hanging off them — fall into separate pockets. That is the whole of
`poi.stranded` on this branch, and it is the same family as Jim's own
"another path shouldn't join into a mid-ramp bridge".

**Where the leak is, and what to do next.** The control polylines *are*
screened: `edgeOk`, the pinch and jog links, `computeGridConnectors` and
`relayPolyline` all refuse `segmentCutsABridgeRamp`. Two things are not:

1. `nodeOk` refuses only `pointStandsOnBridgeMasonry` (the parapet band), not
   the ramp *surface* — deliberately, so a crossing's own approach is not
   refused (#414, seed 24 lost its only bridge to the stricter version). So a
   grid node may stand on a ramp, a route may branch there, and the next leg
   steps sideways through the parapet.
2. Nothing screens the **drawn** curve. `routeCurve`'s fillet pass rounds every
   corner, so a polyline that turns just clear of a ramp can be drawn across it.

Next experiment, in order: sample each finished route with `routeCurve` and
count how many cross masonry (that is `tmp-poibreaks`' answer already, from the
other end); then decide between (a) refusing a *branch point* that stands on a
ramp surface while still allowing a route to *pass* along one, and (b) screening
the drawn curve and re-routing. (a) is the smaller change and matches the
existing "refusing to branch in mid-air is a different question from refusing to
pass" note in `pointStandsOnBridgeMasonry`'s doc.

Fixed on the way, on its own merits and **not** as a stranding fix: the gate
corridor's mouth stood at `(0, 39.8)` on seed 225 — its 5.8 m
`GATE_CORRIDOR_RAIL_STANDOFF` from the rail centre line, and four metres up the
front-door bridge's ramp, because a ramp reaches ~3x further than that standoff
measures. It now clears the bridge footprint itself, taken from
`pointStandsOnABridgeRamp` (the single owner of that rectangle) plus
`RIBBON_HALF_WIDTH_CEILING`. Seed 225 goes 70 -> 73 stranded; 131/326/115
unchanged. Kept because a junction four metres up a ramp is Jim's complaint 1.

## Open elsewhere

- #474 blocks on Jim's canonical ruling (widen vs leave pool) — separate.
- Visual QA owed on both PRs; Overseer dispatches.
