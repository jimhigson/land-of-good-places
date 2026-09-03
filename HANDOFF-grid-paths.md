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
