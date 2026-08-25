# HANDOFF — the network genuinely reads as a grid (PR #286 rework)

Branch: `grid-aligned-park` · Worktree: `.claude/worktrees/grid-visual-fix`

## Why this round exists

Jim, on a real top-down screenshot of the previous "grid-aligned" park:
**"that top-down view looks nothing like how we discussed."** He was right,
and the reason is a textbook instance of CLAUDE.md's "a check can pass
without checking anything": `pathsRunOnGridAxes` only ever bounded how long
one *continuous diagonal* could run (16 m). A network can satisfy that on
every segment and still read as organic wandering, because "reads as a grid"
is a property of the *set of lines* the segments share. Measured on the old
build: north-south runs sat on **19 different x-positions**, nothing lining
up with anything — every elbow landed wherever its own folded diagonal
happened to be. On top of that, the drawn Catmull-Rom (tension 0.4 over
sparse control points) rounded every corner in proportion to segment length,
so even genuinely axis-aligned polylines drew as huge organic sweeps.

## What the generator does now (`src/world/paths.ts`)

- **A 12 m street lattice, anchored at the plaza** (Decision 1), so the
  statue circle's four compass streets are lattice lines by construction on
  any seed. Nodes/edges are screened against **real plot footprints** (not
  bounding circles — those starved the whole interior at this pitch), the
  boundary, the ring's own ground, the rail corridor, and the slide-leg /
  Sky Cruiser pylon corridors (crossing under a ride is fine; running along
  its support corridor starves it — measured: 0 slide legs, a 104 m
  unsupported cruiser span).
- **Routes are Dijkstra over that lattice** with a turn penalty (streets
  prefer straight) and terminate-at-network goals, so later routes extend
  earlier streets and junctions land on shared crossroads (exact float
  coordinates — `buildRouteDistanceGraph` sees real junctions).
- **Planned rail crossings are lattice edges** (`crossingFeet` chains linked
  node-to-node via the deck), so one search serves any chain of islands.
  The first architecture ("near leg to the network, far leg to the target")
  could not bootstrap a crossing whose near foot stood on a not-yet-paved
  island — exactly seed 18's shape. A crossing whose ramp lands beside the
  statue circle registers as a **crossing tap** into the nearest compass
  gateway (Decision 5 holds: four connections, bridges feed into them).
- **Pinch links**: where both L-shaped street routes around a block are
  blocked, one chamfered diagonal (12.6 m drawn, inside the 16 m bound) is
  allowed — Decision 6's minority diagonal, added only where the grid fails.
- **Door stubs**: each destination keeps its doormat/lead/past geometry; a
  stub of at most ~7.8 m off-street tail (elbowed via the node's own street
  line, long leg always on the lattice) joins it to the network.
- **Fallbacks backtrack on quality** (`fallbackSpurRoute`): candidate branch
  points are scored by length + 50 for an off-lattice street run + rail-
  hugging metres doubled + heavy penalty for a give-up diagonal. Everything
  the old machinery commits while *exploring* is rolled back
  (`latticeStateSnapshot`) — a losing candidate must not leave phantom
  paving for later routes to terminate on (that exact bug stranded a
  station spur start 11 m from any real paving on seed 18).
- **`snapRunsToLattice`**: a fallback route's street-length runs are pulled
  onto the nearest lattice line where the built park allows it — splitting
  a run at the rail band and ring guard (the clamped stretch keeps the
  railway's shape), and elbowing the joins when a diagonal join would clip
  an arch foot.
- **`routeCurve()` is the one owner of the drawn centreline** (fillets
  included): dead-straight runs, 1.75 m corner fillets (Decision 3), dense
  points so the Catmull-Rom cannot bow. `LampPosts`, `ParkMap`, `poiGraph`
  and `test/procgen/parkFacts.ts` all ask it now — previously five copies
  of the same `new CatmullRomCurve3(..., 0.4)` incantation.

## The invariant that would have caught the original complaint

`streetsShareLatticeLines` (`test/procgen/invariants.ts`): every drawn
axis-aligned run ≥ 8 m must sit within 0.9 m of the plaza-anchored 12 m
lattice. **Proven red against the old generator** (4 rogue street lines on
the canonical seed, up to 5.7 m off any shared line) and green on all five
seeds now. Exemptions are measured shapes: railway geometry (shared
`railwayGeometryTest`), the authored gate corridor, the plaza spoke, a
route's own door approach (bounded 15 m), and a run threading ground where
no *usable* lattice line exists in the built park — both neighbouring lines
obstructed or unjoinable, measured against plots (footprints now in
`PlotFact`), boundary, rail, the ring, and both rail-race rings' arch feet
(`ParkFacts.railRaceArchFeet`, including the never-drawn walk-past ring's).

## Two real Scenery decouplings found along the way

The scatter-decoupling test (spur-bow hook) caught them once the hook was
fixed to bow a middle segment (its old head-to-tail-chord midpoint splice
became a +50 m zigzag on a many-point route):

- climb-cover trees rolled from the concatenated centreline's sample index,
  which slides when any earlier route's length changes → now rolled per
  fixed 8 m ground cell, iterated in key order.
- `pickBorderAnchor` picked wall anchors by `rng.pick(segments)` — split
  one straight run anywhere and every wall's anchor renumbers (measured:
  walls "moved" centimetres park-wide from a 2 m bow) → now a random lawn
  point snapped to the nearest border segment.

## The boot pays for the lattice solve in slices, not one block

The lattice rework made `buildGraph()` ~215 ms of one un-sliceable
module-evaluation block on a CI-speed box — `check:park-boot` FAILED (250 ms
single-block ceiling; measured 267–339 ms merged with the bridge work, and
the 1 s unbudgeted-work ceiling went flaky at ~865–1063 ms). Fixed in two
layers:

- **Cheaper solve**: `boundaryDistanceCached` (half-metre memo over
  `PARK_BOUNDARY.distanceToEdge`, now also used by `segmentClearOfBoundary`),
  `TrainRoute.flatPointAt` (railInfoAt only reads x/z — `pointAt` paid a
  `terrainHeight` boundary walk for a y nobody looked at), a `streetStubs`
  memo, and `slideEdgeAllowed` computing the slide-corridor overlap once.
- **Sliced solve** (the crossingPrewarm pattern): `paths.ts` is now the
  *machinery* (no module-scope solve) exporting `pathGraphSearch()` — a
  generator yielding between destinations — and `buildGraph()` as its
  straight-through drain; the solved consts (`PATH_GRAPH`, `ROUTES`,
  `routeCurve`, `buildPaths`, `pathCentreline`, `distanceToPath`,
  `pathBorderSegments`…) moved to **`src/world/pathGraph.ts`**, whose module
  scope takes `pathsPrewarm.ts`'s letterbox or drains the same generator.
  `boot/parkGeneration.ts` drives the search through `SolveScheduler`
  ('pathGraph' task) after the crossing sites and imports `pathGraph.ts`
  last. Import sites for the solved consts changed (~16 files) — machinery
  symbols (`PLAZA`, types) still come from `./paths`.

After: worst block 107–117 ms, unbudgeted 610–868 ms — both better than the
bridge tip's own baseline (109/698) and passing consistently.

## Verified

- `npm run test:procgen`: **423/423, all five seeds, one sitting** —
  including the new invariant and scatterDecoupling.
- `npm run check:park`: 19/19 attractions routed, 0 rail crossings,
  234/234 waypoints connected, all six invariants (canonical).
- `npm run check:solve-cost`: paths stage ~485 ms, within budget.
- Full `npm run build` — see the PR comment for the exit status quoted off
  the screen.
- **Real-browser QA (headless Chromium)**: top-down screenshots before and
  after, plus a close-up of a junction (square with small fillets), on the
  PR and `qa-screenshots`.

## What is deliberately NOT here

- **Decision 4 (joint building/street solve)** is still pending: plots are
  placed with no knowledge of the lattice, which is why threading runs and
  fallback pockets exist at all. The invariant's "no usable line existed"
  exemption is the honest measurement of that gap; implementing the joint
  solve removes the exemption's reason to fire.
- **Decision 8 (0 m door gap)** unchanged from the previous rounds: the
  ribbon still stops `PAST_CLEARANCE` short of a plot's edge; publishing
  real door planes per building is follow-up work.
- The two big diagonal slabs on the top-down view are the **planned rail
  bridges** (deck + ramps, square to the track — exempt railway geometry);
  the concurrent bridge-rework session owns how they render.
