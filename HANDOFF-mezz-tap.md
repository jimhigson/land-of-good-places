# HANDOFF: mezzanine tap routing (fix/mezzanine-tap-routing)

Bug (Jim, deployed game): stand on the lobby mezzanine deck (y=3.2), tap the
lobby floor below — she does not route down the stair. Keys DO descend fine.

Scope elevated by Jim mid-task (via coordinator, verbatim): "Route planning in
general needs to work between levels. It can't be a purely 2D algo." So: the
routing REPRESENTATION becomes level-aware — nodes are (x, z, surface), level
connectors (stairs/ramps) are first-class graph edges with walk geometry
attached, declared from plan data. Park must be covered too. NPC routing: audit;
if migration is too big, player router first + ARCHITECTURE-DECISIONS.md entry
recording the seam. Probes red first; live phone-viewport verify both
directions; full build; PR; no self-merge.

## Static diagnosis (code read, not yet live-verified)

How taps navigate: `Game.ts:386` Selection gets first refusal, then
`TapNavigator.handleTap` → `pickWalkablePoint` (ray-march against
`WalkSurfaces.sample(x,z,referenceY=player feet)`) → `NavGrid.findRoute` →
steer via `input.setNavigationMove` (same path as a thumbstick).

`NavGrid` (src/world/NavGrid.ts) is a single-layer 2D lattice:
- one height per cell, sampled with the WALKER's y as reference
  (`sample(x,z,referenceY)`), rebuilt when her y moves > half a storey;
- blocked is 2D: every collider stamped regardless of height, fattened by
  PLAYER_RADIUS 0.62;
- A* edge rule: |neighbour height difference| <= BUILDING_STEP_UP (0.62).

Why deck→floor taps fail (hypothesis to verify live):
1. The stair channel is SEALED in the lattice. Flank walls at innerRadius 2.4
   and outerRadius 4.2 (half-thickness 0.22, Hotel.ts buildMezzanine) fattened
   by 0.62 leave a free band of player-centre positions only r=3.24..3.36 —
   0.12 m wide. At 0.5 m cell pitch essentially no cell centre falls in it, so
   A* finds no deck→floor path.
2. A* then returns the reachable cell closest to the goal = a deck cell at the
   balustrade. reachedGoal=false. If tapped point is within SHORTFALL_TOLERANCE
   1.6 m planar (tap just over the rail) she grinds the balustrade until the
   1.8 s stuck timer + 1 replan give up; if further, the marker MOVES to the
   deck edge and she stops there. Either way: no descent.

Floor→deck taps are ALSO broken, worse (hypothesis): from y=0 the sampler never
offers the 3.2 deck (only surfaces <= y+0.62), so `pickWalkablePoint`'s ray
passes THROUGH the visible deck and lands at y=0 inside the gallery's hollow
mass; route ends at the mass's front face. So the pick is level-limited too,
not just the route.

Keys work because Player+WalkSurfaces handle the stair physically: 4 ramped
ArcTread slices per tread (wedges, Hotel.ts ~2469).

## Key machinery map

- src/entities/TapNavigator.ts — tap → route → steer. ScriptedWalk = unrouted
  waypoint feed (castle stair ride uses it via Game.ts:976 walkTo handlers).
- src/world/NavGrid.ts — the 2D lattice (to be replaced/extended).
- src/world/pickWalkable.ts — tap ray-march, reference = player feet.
- src/world/building/surfaces.ts — WalkSurfaces.sample: highest surface
  <= y+BUILDING_STEP_UP; ground unconditional; ramps (castle), decks (castle),
  platforms (Plates + ArcTreads + lifts).
- src/world/hotel/layout.ts — LOBBY.mezzanine plan data (stair arc: centre
  6.8,-8.5 local, r 2.4..4.2, fromAngle 0, toAngle PI/2, treads 10, deck
  y=3.2). LOBBY_MEZZANINE_Y. Hotel.stairMouth derives the wall gap from
  the arc — connector endpoints must derive the same way.
- src/world/hotel/Hotel.ts buildMezzanine ~2343: deck Plate, mass walls
  (addWall, infinite topHeight), ArcTread walk slices, flank collider chains.
- CollisionWorld: walls/circles carry topHeight (usually Infinity), 2D
  clearance test vs the SAMPLER's ground — so blocked-ness is genuinely 2D;
  a lattice per-layer blocked map would NOT match the resolver. Keep blocked
  2D; make HEIGHTS multi-layer.

## Design direction (per elevated brief)

- Layered lattice: per cell enumerate walkable surfaces top-down via repeated
  sample() with descending reference (levels separated > STEP_UP are distinct
  by construction). Node = (cell, layer). A* over those nodes; the step rule
  becomes "some layer pair within MAX_STEP", i.e. today's rule picks the right
  layer instead of the single reference-height one.
- Connectors: declared from plan data (Hotel.buildMezzanine registers the arc
  walk path derived from Mezzanine.stair; imperial rebuild = declare more
  connectors). Planner consumes them as ordinary edges (cost = path length);
  route reconstruction splices the connector polyline into the waypoint output.
  This is REQUIRED because the stair channel is physically 0.12 m of free
  centre-line — no lattice pitch can represent it; the edge carries geometry.
- Pick: must become level-aware for "tap the deck from the floor" (respect
  castle cutaway visibility — do not let taps land on hidden decks).

## Status

- [x] Worktree + npm ci
- [x] Static code diagnosis (above)
- [ ] Live repro with telemetry (headless Playwright, lobby world origin
      (-600, 600); scratchpad live-stair.mjs pattern; ~6 fps software GL)
- [ ] NPC routing audit (poiGraph), castle deck audit, park platform audit
- [ ] Probes RED (check:hotel or new script; + park-side multi-level case)
- [ ] Implementation
- [ ] Live verify 390x844 phone viewport, screenshots
- [ ] Build + test:procgen + PR

No commits yet beyond this file.
