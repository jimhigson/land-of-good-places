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

## Status (6 Sep, evening) — built, rebased, gates running

Rulings (both in the design doc, c4fff476): `PoiGraph.reachable` is the
JourneyPlanner's NavGrid flood from the entrance; node placement is
`NavGrid.nearestStandable`; rung 1 armed for genuine unreachability, prints
"never fired". Implemented:

- `NavGrid.floodFrom`/`reachableFrom`/`nearestStandable`; `forEachStep` is the
  one owner of a step for `search` and the flood (0 disagreements vs
  per-node routes on 224/225/245 waypoints; 7 ms vs 1.4 s).
- `PoiGraph` rewritten: chords/lanes/neighbours deleted (nobody read them);
  `PoiReach { grid, sample }`; `noSpot` by coordinate; `NUDGE_REACH` re-exports
  `STAND_SEARCH_REACH` (NavGrid owns it so parkLayout can import it).
- `parkLayout.ts`: `buildOnce(restart, attempts)` ranks candidates (attempt k =
  k-th best; budget = supply); `solve()` is the ladder; `doormatRefusals`
  floods a plots+boundary+turret NavGrid from the entrance (~195 ms/solve);
  blockers from the door's pocket (`pocketBlockers`) or covering plots
  (`coveringBlockers`); `LGP_LAYOUT_REFUSE=<id>[:<n>|always]` Node-only hook;
  `probeDoormats` exported for the check; `LAYOUT_TRACE` on stderr.
- `check:layout-rung` (in the chain), `check:every-seed-builds` (standalone
  workflow, bidirectional ratchet), `park-digest` `trace` line.
- `readSeed` accepts 0: **"seed 0" was the canonical park until now.**

Numbers on the rebased base: **7 of 16 build** (3, 4, 5, 11, 13, 14, 15).
Red: rail.unsolvable 0, 8, 9, 10; crossing.nosite 1, 2, 7; anchor.reach 12
(+ poi.nospot on 6: gate-approach samples on the railway at (0,42.5),
(0,38.7), no deck — a crossing foul, stage 4). POI class discharged on 1, 4,
13, 15 with no placement moved.

Remaining: gates (check ~26 min, test:procgen, coplanar, swept-bus,
park-pool, build), watch `check:arrival-completes` for the 724 ms lattice
build now paid at NpcSystem construction, PR with `/spawn` link.

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

## Late 6 Sep — the chain caught the rung's cost; fixed at the source

`check:solve-cost`: layout 307.6 ms vs 250 budget. 189 of the 195 ms lattice
build was `PARK_BOUNDARY.distanceToEdge` per cell (134k × 512-vertex scan).
`NavGrid.rebuild` now blocks `!contains()` cells and `stampSegment`s each
`outline()` segment at the walker radius — 0 of 133,956 cells differ from the
old rule; 195 → 8 ms; layout stage 26.9 ms. Gates rerunning (`check2.out`,
`gates2.txt` in the scratchpad). Issue #595 filed for `LGP_SEED=0`.
PR body draft: scratchpad `pr-body.md` (two placeholders: lattice-after,
arrival verdict). Probes `scripts/_probe-*.mts` are untracked; delete before
the PR. `/spawn` link: `/spawn?pos=-46.7,29.6&seed=13` (dodgems door, seed 13).

## PR #596 open (against design/round-robin-generation), all gates green

Head 03080f31 + this. Awaiting reviewer/QA via the Overseer and the deploy
preview comment; link to hand over: `<preview>/spawn?pos=-46.7,29.6&seed=13`.
Do not merge own work. Probes deleted; scratchpad `pr-body.md` is the body.
