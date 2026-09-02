# The contract the grid rewrite must keep — paths.ts surface survey (2 Sep)

Surveyed on feat/park-warp-solver head. THE reference for replacing the
plotting machinery. Line numbers drift; identities do not.

## The whole required contract (11 exports; internals are module-private)

`{ RouteDefinition, PathNode, PathEdge, PathGraph, buildGraph,
pathGraphSearch, routeCurve, PLAZA }` plus, for two scripts only,
`pointStandsOnABridgeRamp` and `debugStreetLattice`
(`measure-phantom-paved-nodes.mts`, `probe-ribbons-on-ramps.mts` — may be
updated instead). `debugStreetSegment` is dead: delete.

- `RouteDefinition` = `{ name, points: readonly [x,z][], width, closed }` —
  a 2-D CONTROL POLYLINE + width. **This is the entire output format**:
  drawing, sampling, maps, lamps, NPC seeds all flow from routes +
  `routeCurve`.
- `PathNode` = `{ id, kind: 'gate'|'plaza'|'anchor'|'stall'|'station'|'exit', x, z }`.
- `PathEdge` = `{ from, to, route, paved }`; the literal id **'ring'** on
  one end for every non-interconnect edge; `paved:false` = connectivity
  only, no ribbon.
- `PathGraph` = `{ nodes, edges, ring }`.

## Load-bearing names (grep before renaming anything)

- `'ring'` sentinel id; route names `'main-loop'` (the closed ring) and
  `'gate-approach'` (looked up by name in invariants.ts ~6087).
- Mesh names `path-kerb` / `path-surface` (invariants match by string).
- `PathNode.kind` values used by parkFacts/check-path-preference.

## Drawing chain (KEEP, do not reimplement)

points → `routeCurve` (fillet pass for open routes, raw for closed) →
CatmullRomCurve3(0.4) → `pathGraph.buildPaths()` addRibbon sweep (two
meshes) + `addDisc` for the plaza + `recordSamples` → `publishPaving` →
NavGrid `paved` bitmap (circles only, OFF_PATH_COST_MULTIPLIER 1.6 in
paving.ts). `drapePathsOverBridges` lifts vertices onto decks (World.ts).

## Consumers in one line each

pathGraph.ts (facade, runs the solve: PATH_GRAPH = takePrewarmed ??
buildGraph); Garden.ts calls buildPaths (the ONLY caller — populates
pathCentreline); LampPosts walks ROUTES via routeCurve; Scenery uses
isOnPath/pathCentreline/pathBorderSegments (wall runs vs paths live HERE,
not wallRuns.ts); train/crossings.ts walks pathCentreline in order using
`run` seams; poiGraph seeds waypoints from PLAZA ring + anchors' entrances
+ sampled ROUTES; ParkMap strokes ROUTES; NavGrid consumes only paving.ts
discs (deliberately never imports pathGraph).

## Doormats & check:park

Doormats are parkLayout's (`entranceX/Z`, surfaced as `anchor.entrance`);
paths CONSUME them. check:park walks the **NavGrid**, not PATH_GRAPH:
destinations = interact zones + every anchor.entrance, routes from the
gate, legs checked against the rail (bridge decks only), poiGraph must be
one component. paths.ts affects it only through paving + waypoint seeds.

## Prewarm contract (exact)

`pathGraphSearch(): Generator<number, PathGraph, void>` must yield often
(a single 15.7 ms unit has failed check:park-boot); `buildGraph()` MUST be
a straight drain of the same generator (sliced and unsliced cadences must
be one implementation); module importable without solving (pathGraph.ts
triggers the solve); crossing sites are prewarmed BEFORE paths.

## Ring/plaza split

PLAZA = re-export of PARK_LAYOUT.fountain. Statue-ring radius + plot
clearance = parkLayout's (joint-solve constraint). The ring ROUTE
('main-loop', closed, width 3.6) is paths.ts's `solveRing` — KEEP it.
Edges attach to the ring via `nearestPointOnRoute` on drawn samples
(refusing BLOCKERS circles + bridge ramps).

## Invariants coupled to the machinery being replaced

- `streetsShareLatticeLines` ("every street sits on the shared 12 m
  lattice") — rewrite alongside the new grid (its successor should assert
  the new grid's own alignment; never delete without replacement).
- `pathsRunOnGridAxes` skips `backbone`; `ringIsATrueCircleRoundTheStatue`
  requires the circular backbone; `noPathEndsNowhere`;
  `everyDestinationIsANode`; `noDrawnPathEndsStrandedOnABridge`;
  `detourRatiosStayReasonable` uses unpaved connectivity edges too.
