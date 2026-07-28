# Handoff — indoor navigation

Branch `feat/indoor-nav`, from `origin/main` @ d210639.

## What was asked

Work out which mechanism the castle interior wants (`poiGraph` vs `NavGrid`),
fix the three dead `indoors` waypoint seeds, and say whether NPCs get inside.

## Findings (measured, not assumed)

**1. Tap-to-walk already routes indoors. The premise in ORDER-OF-WORK is wrong.**
`Building.enterInterior` calls `collision.setPlayBounds(600, 600, 46)`, and
`NavGrid.ensureLattice` reads exactly those three numbers. So walking through
the front door rebuilds the lattice around the interior plate; the interior has
been routed since `NavGrid` landed. Measured with a replica of the interior's
collision registration (`scripts/probe-indoor.mts`, throwaway, not committed):

- deck 1 → the toilet stand point: **1010 / 1021** standable probes routed to
  goal (99%).
- deck 0 → the front door: **1090 / 1127** (97%).
- interior lattice rebuild + first route: **1.3 ms** (192² cells vs the park's
  240²).

The residual few percent are *sealed by design*, not by a bug: the strip behind
each north-wall shop counter (the alcove `ShopUnits.registerCounter` documents
as deliberately open-topped but wall-fronted), and the `HELTER_SHAFT` guard box,
which `ShaftGuards.ts` deliberately makes solid on all four sides.

**2. Two of the three `indoors` seeds are dead; the third is not.**
Measured with `scripts/probe-seeds.mts` (throwaway) against the real facade
collision and the real `PoiGraph`:

- `(-29, -27)` and `(-34, -26)` nudge to themselves, form a **2-node island**
  with no edge to the other 43 nodes, and sit inside the facade's solid block
  (x −40.5..−16.5, z −39.5..−21.5, lobby carved to z −23.3..−21.5).
- `(-29, -23)` nudges to `(-28.2, -22.2)`, which is **inside the 1.8 m lobby**
  and is **connected** (neighbours 15, 30, 31, 32). Children do walk into it.

**3. The isolated pair is harmless only by accident.** `spawnNodes()` filters on
the authored `indoors` flag, not on reachability. Drop that flag — which S2
plausibly would, since it is a lie about a garden-space node — and children spawn
inside a solid tower. `poiGraph`'s own comment claims unreachable nodes are
handled; only *degree-zero* ones are. A connected pocket is invisible to it.

## THE DECISION — which mechanism the interior gets, and why

**The lattice (`world/NavGrid.ts`) is the interior's navigation. The waypoint
graph (`entities/npc/poiGraph.ts`) gets nothing indoors at all, today.** Not a
split, not "graph for NPCs and lattice for the player" — the graph gets *zero*
indoor nodes and that is the deliberate answer, not an omission.

Five reasons, in the order they actually decided it:

1. **The lattice already does the job, measured.** This was the question the
   brief told me to check rather than assume, and the assumption was wrong.
   `NavGrid` keys on `collision.playBoundsX/Z/Radius`; `Building.enterInterior`
   moves those to `(600, 600, 46)`. Nothing needed adding. 99% of standable
   deck 1 routes to the toilets, 97% of deck 0 to the front door, and the
   rebuild is 1.3 ms. A mechanism that already works is not replaced by one that
   would have to be authored.

2. **A waypoint is a destination; a lattice cell is a patch of floor.** The
   pathfinding agent's note is right and it is the whole distinction. A child
   taps a spot on the floor of a 60 × 44 m plate. Snapping that to the nearest
   of a handful of hand-placed junctions is the coarseness bug wearing the
   stuck-on-scenery bug's coat. Indoors this is *worse* than outdoors, not
   better: the interior is one big open room, so almost every tap lands
   somewhere with no junction anywhere near it.

3. **Derived beats authored, and the interior is about to be redrawn.**
   Decision 3 S2 replaces the five-deck plate with five separate spaces at
   separate origins, each with its own footprint of any shape. Every hand-placed
   indoor waypoint written tonight is authored against a plan that is scheduled
   for deletion. The lattice is baked from the finished collision world at run
   time, so it simply describes whatever S2 builds, with nothing to re-author.
   This is the same argument `NavGrid`'s own file comment makes about Decision 4
   replanning the park, applied one storey down.

4. **The graph's job indoors is empty until there is somewhere to go.** The
   graph exists to answer "which interesting place should this child head for
   next?". Indoors that list is genuinely empty right now: the shops do not
   serve NPCs, the rides are player-only, and the toilets are a player
   interaction. S2 is what creates real indoor destinations (the snake room, the
   novelty shopfronts, the Great Hall). Seeding waypoints before there is
   anything to visit is how you get three dead nodes inside a facade — which is
   literally what happened, and is the ticket I was handed.

5. **Nothing else needed the graph to grow.** The one thing the interior does
   need from the graph — that it stop lying about spaces, and that it refuse to
   keep a waypoint nobody can reach — is a correctness fix to the graph itself,
   not indoor coverage.

**What would change this call:** if NPCs ever want to *choose* an indoor
destination (browse a shop, queue for the helter), they need graph nodes on the
floor that holds it. Those go in per floor space, after S2, at the floor's own
origin — `spaceAt` will label them without anyone having to say so, and the
cross-space edge guard added here is what stops them being joined to the park by
a six-hundred-metre straight line that validates clean.

**NPCs do not get inside in this PR, and should not yet.** Crossing the
threshold is a 600 m teleport — a *portal* — and portals are S1's one new
concept. Decision 3 §4 scopes NPC-through-portals out on purpose, and the note
that gated it on the `Activity` work is only half the gate: the other half is
that there is no portal to use. Doing it now means writing a second, private
teleport path inside `NpcSystem` that S1 then deletes. See "What it would take"
in the PR body.

## What this branch does

1. Deletes the three `indoors` seeds and the `indoors` flag.
2. Replaces it with `PoiNode.space`, **derived** from `world/spaces.ts`'s
   `spaceAt(x, z)` — a node cannot declare a space it is not in.
3. Refuses edges between nodes in different spaces (a 600 m straight line
   through empty world validates clean today).
4. Adds the validation the file was missing: keeps only the **largest connected
   component per space**; everything else is `reachable: false`, never spawned
   on, never returned by `nearest()`, and named at boot.
5. `scripts/check-waypoints.mts` in `npm run build` — fails if any seed sits
   inside the facade's walls.

## Not done, deliberately

- Per-space `NavGrid` lattice cache (Review 4 F3). Belongs to 5.1/S2, which
  ORDER-OF-WORK already assigns it to. Measured cost today: leaving the interior
  re-pays the park's 6.8–10.1 ms stamp, once, behind the iris.
- Anything under `src/world/building/**` — S1/S2 are single-owner there.
