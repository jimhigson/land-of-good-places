# HANDOFF — totality, POI rung (`feat/poi-totality`)

**Model: Fable.** Jim's instruction — the procgen rework is always worked by
Fable, and a replacement for this agent must run Fable too.

Branch from `origin/design/round-robin-generation` (carries #522; `main`
does not). Brief: `docs/BRIEF-totality-poi-rung.md`. Design:
`docs/DESIGN-round-robin-generation.md`, "Totality, ruled and mechanised".

## Baseline (design branch a2605d90 == main b581462d), seeds 0–15

4 of 16 build: 0, 5, 11, 14.

| class | seeds |
|---|---|
| `poi.stranded` | 1 (12), 4 (63), 6 (3 + `poi.nospot` 2), 13 (83), 15 (13) |
| `RailRouteUnsolvable` | 8, 9, 10 |
| no proven crossing site | 2, 3, 7 |
| `anchor.reach:waterFight` only | 12 (also on 6): built to 19.5 m vs declared 18.5 |

Seed 5 builds only because of the baked warp `{waterFight:1}`; unwarped it
strands 10.

## Finding 1 — every stranded node is reachable by the player's router

Probe: `scripts/_probe-blockers.mts` (untracked). For each stranded node,
walk its chord to the nearest reachable node as `PoiGraph` does, name the
first blocking collider; then ask `NavGrid.findRoute` from the entrance.

NavGrid reaches **100 %** of stranded nodes on every seed (13: 83/83,
4: 63/63, 15: 13/13, 1: 12/12, 6: 3/3, unwarped 5: 10/10).

What cuts each pocket:

- 4, 13, 15, unwarped 5: bridge parapets (2 m walls, half 0.15, absolute
  tops rising 2.8–5.4 m, `ParkTrain.ts:266` from `bridges.ts` guardRails)
  and the lineside fence (half 0.18, top ∞, rail distance 2.5–2.9).
- 6: the face-paint stall's own booth wall (`FacePaintStall.ts:660`)
  between doormat and network. `nospot` ×2: route samples on the railway at
  (0.0, 42.5) and (0.0, 38.7) inside the under-deck `TRACK_CLEARANCE` block,
  where `bridgeHeightAt` answers null.
- 1: (a) walls 10 m inside `waterFight`'s footprint, on paving — the
  router's arrival exemption (`computeStreetStubs`, `exemptNear = arrival ? 7 : 0.5`)
  lets an arriving stub run through a plot within 7 m of its destination;
  (b) two bushes r 0.85 at 0.6 m off a chord.

So the strandings are `PoiGraph`'s edge rule (straight chord or same-lane
walk, 0.7 m off-path clearance, 13 m max edge) failing to express walks the
player makes, chiefly across bridges where the lane id changes at the
crossing. The brief's rung-1 trigger (the router's own reachability at layout
time) would fire on none of them — every path was drawn by the router
believing it connects.

Reported to the coordinator; awaiting the Architect's ruling on making
`PoiGraph` connectivity the same question `NavGrid` answers, keeping the
layout-entry redraw for a POI the player genuinely cannot reach (zero today).

## Status

No generator code written yet. Next: refusal shape + trace + digest hashing
+ `check:every-seed-builds` scaffolding (needed whichever way the ruling
goes), then the rung itself.

## Finding 2 (6 Sep, later) — nobody walks `PoiGraph`'s edges

`wanderDriver.ts` (#350): the random walk over the graph was deleted; `Journey`
routes every child on the player's own `NavGrid` (`JourneyPlanner`, one grid per
space). `neighbours` has no consumer outside `poiGraph.ts`. The edges exist only
to compute `reachable`, which gates `spawnNodes()`/`nearest()`.

So the one owner of "can a child get there" is NavGrid — the children's own
planner — and the Architect's first ruling (edges follow the drawn lane) was
made on the premise that children walk the graph. Reported; awaiting a ruling
on: `PoiGraph.reachable := NavGrid can route here from the entrance`.

Evidence the lane rule cannot work anyway: seed 13's cut is `gate-approach`
crossing a 3.3 m deck transversely (six samples = the deck's width) with
pushes 0.38–0.42 either side; seed 15's spur crosses a ramp sideways (push
0.55/0.52). `bridgePavingHeightAt` clears neither (push@paving = push@deck at
every refused sample). NavGrid's real routes: seed 15 rides the bridge along
x≈34 lengthwise and steps off the ramp toe onto grass; seed 13 reaches the west
pocket with no bridge at all, round the railway's west end along x≈−49.

## Costs measured (seed 13, headless)

- NavGrid construct: lazy, 0.1 ms. 224 `findRoute` calls from the entrance:
  1416 ms (6.3 ms each) — a per-node route at boot is too slow; one flood is
  the shape.
- Plots+boundary only (`CollisionWorld` of plot footprints + `setPlayBounds`):
  14 doormat routes 231 ms; `check:park-boot`'s slice ceiling is ~20 ms, and the
  layout solves at import. A layout-time probe needs a flood or a coarser cell.

## Scaffolding landed (9a4d1227)

`check:every-seed-builds` (standalone workflow `every-seed-builds.yml`,
bidirectional ratchet in `scripts/every-seed-builds-baseline.mts`, keyed on seed
number; proved red three ways), `LAYOUT_TRACE` from `parkLayout.ts` on stderr,
`trace` line in `scripts/park-digest.mts` (two processes identical on seed 6).

Untracked probes in `scripts/_probe-*.mts` — do not commit.
