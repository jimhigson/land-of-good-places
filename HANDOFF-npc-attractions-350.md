# HANDOFF — issue #350, NPCs clump; give them real attraction destinations

Branch: `npc-attraction-destinations` (worktree `.claude/worktrees/npc-attractions`, from `origin/main` @ `311ad89`).

## The ask (Jim, 27 Aug 2026)

> "on entering the park, all the NPCs gather in one place quite soon — I guess this is their
> pathfinding getting stuck. Instead, they should randomly choose an attraction in the park to go
> to, and use the same pathfinding as the player to get there. When there's a new attraction chosen
> they should say 'I'm going to the x' with a 20% chance. This can include things inside the castle."

Five requirements: (1) random *attraction* destination, not a wander; (2) the **player's own**
pathfinding (`NavGrid` / `TapNavigator`'s lattice), not a second routing system; (3) 20% chance of
"I'm going to the X" with the real display name, through the existing speech bubble; (4) castle
interior destinations included; (5) on arrival, choose again.

Plus: root-cause the clumping and **delete** the old mechanism if it is replaced; add a dispersal
invariant on the built park with a threshold derived from the park's own dimensions; break it and
watch it go red; five seeds; `tsc`, full `npm run build`, `npm run test:procgen`; real-browser QA on
a production build.

## Findings so far (partial — investigation still in progress)

### The current mechanism

`src/entities/npc/wanderDriver.ts` is the only park-child driver. It is **not** pathfinding at all:
it is a **non-backtracking random walk on `PoiGraph`** (`src/entities/npc/poiGraph.ts`).
`chooseNext()` picks a uniformly random neighbour of the current node that is not the previous one.
There is no destination anywhere in the system — `targetNode` is the *next waypoint*, one edge away.
So "their pathfinding getting stuck" is literally true in the sense that there is no pathfinding to
get stuck: nobody is going anywhere.

Two candidate clumping mechanisms identified so far, both in that file:

1. **`interesting` nodes are a holding trap.** `arrive()` gives an `interesting` node a
   `PAUSE_CHANCE = 0.62` chance of a 1.4–4.2 s pause. The plaza contributes a **ring of 6
   `interesting` nodes packed together** (`PLAZA_RING_NODES = 6` in `poiGraph.ts`), plus every anchor
   entrance and every stall stand. A random walk through a locally dense patch of `interesting`
   nodes pauses over and over, so occupancy piles up wherever those nodes are dense. This is a
   density attractor, not a bug in one line.
2. **The bus arrival dumps 11 of 24 children on one spot.** `World.ts:311` passes
   `ARRIVAL_KID_COUNT` (= `CAT_BUS_SEAT_COUNT - 1`, 11) as `arrivingByBus`, and
   `world/entrance/ArrivalSequence.ts` walks them all off the bus at the gate. A random walk
   disperses that initial clump only very slowly — which matches "on **entering** the park … quite
   soon".

### SETTLED (29 Aug): #348 did NOT split the park. Not the cause.

`scripts/diag-poi-components.mts` (throwaway, delete with the other diag) on the canonical seed,
rebased onto `origin/main` (`e71f80a`, i.e. *after* #348):

```
total nodes=237, components=1
  space=garden     components=[237]  reachable=237/237
garden reachable extent x=[-48.9,81.2] z=[-51.5,56.2]
garden interesting reachable=22
```

**One component. Nothing stranded. No comparison against `311ad89^` needed** — a graph that is
already whole cannot have been severed. Cross that candidate off; do not re-derive it.

Two things that dump *did* establish, both load-bearing for the fix:

- **The `PoiGraph` has no castle-interior nodes at all** — all 237 are `garden`. So requirement (4)
  (castle interiors as destinations) cannot ride on the POI graph. The attraction list and the
  routing have to handle the interior space themselves.
- Only **22** reachable `interesting` nodes in the whole garden, against 237 nodes.

### The actual root cause

There is no destination, so there is no force pulling children apart — and a **non-backtracking
random walk is diffusive**, so its occupancy converges to a stationary distribution proportional to
node degree, *weighted by dwell time*. Both weights point at the same place:

- **Degree**: the plaza ring is 6 nodes packed inside `PLAZA.radius`, mutually visible and also
  visible to every route that lands on the plaza — by far the highest-degree region in the graph.
- **Dwell**: `arrive()` gives an `interesting` node a `PAUSE_CHANCE = 0.62` chance of a 1.4–4.2 s
  pause (mean ~2.8 s). All 6 plaza ring nodes are `interesting`, out of only 22 in the park.

So children random-walk into the plaza, and once there they pause repeatedly and leave slowly. That
is the clump. The bus cohort (11 of 24 dumped at the gate by `ArrivalSequence`) sets the *initial*
clump and a diffusive walk disperses it only very slowly, which is why Jim sees it "quite soon on
entering the park" — but the steady-state clumping is the random walk's own stationary distribution,
not the bus.

**This is a design absence, not a broken line.** Nothing is stuck; the mechanism has no notion of
going anywhere, so it cannot help but pool. The fix is the one Jim asked for — give every child a
real destination and a real route — and it therefore *replaces* the random walk rather than
patching it.

### Measurement (headless, canonical seed)

`scripts/diag-npc-spread.mts` (scratch script on this branch, will be replaced by the real
invariant) builds the real park via `scripts/park-harness.mts`, steps `world.update` at 1/60 and
reports RMS radius about the crowd centroid plus single-linkage cluster sizes at 6 m, over 24
park children (`world.npcs.all` filtered to `WanderDriver`; the other 7 are hotel residents on
`WaypointDriver` at ~(-600, +600), a different space — **filter them out or the metric is
meaningless**).

300 s, player parked at the origin:

```
t=  0s rms=51.53 clusters@6m=[11,2,1,1,1,1,1,1,1,1,1,1,1]
t= 60s rms=47.75 clusters@6m=[8,2,2,2,2,1,1,1,1,1,1,1,1]
t=180s rms=41.75 clusters@6m=[5,4,3,2,2,1,1,1,1,1,1,1,1]
t=260s rms=46.21 clusters@6m=[8,6,2,2,1,1,1,1,1,1]
t=300s rms=45.38 clusters@6m=[5,4,2,2,2,1,1,1,1,1,1,1,1,1]
```

The `[11,...]` at t=0 is the bus cohort. Clumps of 6–8 keep re-forming for the whole run. Also seen:
`Yara` and `Kiko` finish **0.14 m apart** — inside `NPC_RADIUS * 2` (1.0 m), which
`check:npc-separation` says should never happen; likely both mid-climb (climbers are exempt from
separation). Worth a look but probably a separate defect.

Caveat: the headless player never moves, so this run does not include the chat-approach behaviour
(`activities/chatToPlayer.ts`, capped at 2 children by `MAX_CONCURRENT_CHATTERS`) that a real player
standing still would trigger. Chat is capped, so it is unlikely to be the main clumping mechanism,
but the browser QA pass needs to confirm.

### The pieces the fix has to use

- **Player pathfinding**: `src/world/NavGrid.ts` — `findRoute(startX, startZ, startY, goalX, goalZ,
  goalY, sample, out)` writes x,z pairs, returns count; `lastRouteReachedGoal` / `lastRouteEndY`.
  `src/entities/TapNavigator.ts` is the player's consumer (plans once per tap, walks waypoints with
  `WAYPOINT_RADIUS = 0.7`, `REPLAN_ATTEMPTS = 1`, `SHORTFALL_TOLERANCE = 1.6`).
  **Trap already spotted**: `NavGrid` caches ONE lattice, keyed on `collision.playBounds` and
  `collision.revision` (`ensureLattice`). Park and castle interior are different `playBounds`, so a
  single shared `NavGrid` instance would thrash if park children and indoor children plan in the
  same frame. Expect to need a `NavGrid` per space, or to plan on the space the walker is in.
- **Attractions**: `world/anchors.ts` (`ANCHORS`), `minigames/stallPlacement.ts` (`STALL_STANDS`),
  and whatever inside the castle (`world/building/`) has a display name. `poiGraph.ts` already
  derives its seeds from exactly these — reuse that derivation, do not re-list them (CLAUDE.md
  "one owner").
- **Speech bubbles**: `src/ui/SpeechBubble.ts`, one per child in `NpcSystem.bubbles`, driven from
  `WanderDriver.chatBubbleText` in `NpcSystem.updateBubbles` (~line 1095). The new line should go
  through that same getter/path, not a second bubble system.
- **Headless harness for the invariant**: `scripts/park-harness.mts` (`buildHeadlessPark`,
  `quietly`); `scripts/check-npc-separation.mts` is the closest model for a behavioural check that
  drives the real `world.update` and has a `--mutate` mode to prove it can fail.

## What has changed so far

Nothing in `src/`. On the branch:

- `scripts/diag-npc-spread.mts` — throwaway diagnostic, numbers above. To be **deleted** and
  replaced by the real `scripts/check-npc-dispersal.mts` invariant.
- `HANDOFF-npc-attractions-350.md` — this file.

## What is left, in order

1. Finish root cause: dump `PoiGraph` component sizes per space on `main` and on `311ad89^`, to
   settle whether #348 split the park.
2. Build the attraction list from the existing owners (anchors + stalls + castle interior), with
   display names.
3. Give the driver a destination + a route from the **player's** `NavGrid`, replacing
   `chooseNext`/`updateWander`'s random walk. Delete the random walk rather than leaving both.
4. 20% "I'm going to the X" through the existing bubble path.
5. `scripts/check-npc-dispersal.mts` + wire into `npm run build`; threshold from `PARK_BOUNDARY`,
   not a magic number; prove it red (the pre-fix behaviour is the ready-made mutation).
6. Five seeds; `npx tsc --noEmit`; full `npm run build` (unpiped exit code); `npm run test:procgen`.
7. Push, open the PR, take the preview URL **verbatim** from the PR's newest "Deploy PR preview"
   comment, and do real-browser QA on a production build (`npm run build` + `npm run preview` on an
   own `--strictPort` port).

## Reproduce / where to look

- Headless: `node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs
  scripts/diag-npc-spread.mts` (env `SECONDS=300`). Canonical seed, default park.
- In game: no deep link points at the crowd. `/view?camPos=...&camDir=...` over the plaza is the
  cheapest look; otherwise walk in from the gate and watch for 1–3 minutes. Clumps of 6–8 form
  within about a minute.

## Tried and did not work / things not to redo

- Measuring dispersal over `world.npcs.all` unfiltered is useless: the 7 hotel residents sit ~600 m
  away in another space and swamp every statistic (RMS ~420 m, dominated entirely by them).

---

## The attraction list — where each destination comes from (29 Aug)

Settled by reading. **Three existing owners; write no fourth list** (CLAUDE.md "one owner").

### Outdoors (space `garden`)

- **`ANCHORS`** — `src/world/anchors.ts`. `AnchorDefinition` has `entrance: readonly [x, z]`
  (world coords, where the path spur arrives and the sign stands) and **`signTitle: string`**,
  which is the display name to say out loud. This is the right field: it is the words on the
  sign the child is walking towards.
- **`STALL_STANDS`** — `src/minigames/stallPlacement.ts`. `StallStand = { id, x, z }`, world
  coords, derived from the booth's position and facing. **It carries no display name.** The
  names live in `src/minigames/stalls.ts` as `StallDefinition.title` ('Dodgems!', 'Water
  Fight!', 'Sky Cruiser', 'The Rail Race!', 'The Spooky House', 'Space Ferris Wheel'), keyed by
  the same stall id. So a stall destination is `STALL_STANDS` joined to the stall definitions
  by id — join, do not retype.

Note `poiGraph.ts` already seeds nodes from exactly these two plus the plaza ring and the
train stations, so the attraction list and the waypoint graph agree by construction.

### Inside the castle (space = the interior)

**`SHOP_UNITS`** — `src/world/building/layout.ts` (~line 705). `ShopUnitDefinition` =
`{ id, deck, x, z, yaw, title, glyph, accent }`, where **`x`/`z` are LOCAL to the deck** and
`title` is the display name ('Toy Shop', 'Balloon Shop', 'Candy Floss', 'Ice Cream',
'Hat Shop', 'Sticker Pet', …). Seven of them, on decks 0–2, along the north and west walls.

Local → world, all from `layout.ts`:

- `deckY(index) = BUILDING_BASE_Y + index * BUILDING_FLOOR_HEIGHT` (line 91)
- `interiorWorldX(localX) = INTERIOR_ORIGIN_X + localX` (line ~97)
- `interiorWorldZ(localZ) = INTERIOR_ORIGIN_Z + localZ` (line ~101)

**But do not do that conversion by hand either.** `src/world/building/shops/Shops.ts` already
exports the joined, converted result: **`ShopStand = { id, title, glyph, greeting, accent,
deck, x, z, y }`** with the comments "World position of the spot in front of the counter" and
"World height of the deck it is on" — i.e. exactly the destination record this feature needs,
already standing a child at the counter (`SHOP_STAND_Z = 2.4 * SHOP_SCALE_XZ` in front, so the
child is not inside the counter). **Use `ShopStand`.** Next step: confirm how `Shops` exposes
its stands (a getter on the `Shops` instance vs a module-level export) and reach it from
`NpcSystem` the way the rest of the game does.

Interior destinations are therefore multi-deck, which matters for routing: a child walking to
the Hat Shop on deck 2 needs `NavGrid`'s level connectors (`WalkSurfaces.connectors` — the
lobby stair), which `Game.ts:392` already passes into the player's own `NavGrid`.

## The routing plan, and the NavGrid trap (29 Aug)

`NavGrid` is constructed exactly once, in `Game.ts:392`:

```ts
this.navGrid = new NavGrid(
  this.world.collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT,
  () => this.world.building.surfaces.connectors,
  (x, z) => this.world.train.bridges.some((b) => b.covers(x, z)),
);
```

`findRoute(startX, startZ, startY, goalX, goalZ, goalY, sample, out)` writes x,z pairs into
`out` and returns the count; `lastRouteReachedGoal` / `lastRouteEndY` report the ending.
`TapNavigator` is the player's consumer: `WAYPOINT_RADIUS = 0.7`, `REPLAN_ATTEMPTS = 1`,
`SHORTFALL_TOLERANCE = 1.6`, route buffer `new Float32Array(MAX_ROUTE_WAYPOINTS * 2)`.

**The trap, now confirmed in the source.** `ensureLattice` (line 428) reads
`const boundary = this.collision.playBounds` and rebuilds whenever
`builtBoundary !== boundary || builtRevision !== collision.revision`. `playBounds` is a single
mutable on `CollisionWorld` (`Collision.ts:418`, `setPlayBounds` at 445) that is **swapped when
the player changes space**. So a shared `NavGrid`:

1. would rebuild its whole lattice every time the player walks in or out of the castle, and
2. worse, would be *wrong* — park children would plan on the castle's lattice while the player
   is indoors.

`rebuild(boundary, sample)` already takes the boundary as a parameter, so the fix is small and
keeps ONE pathfinder implementation (requirement 2): give `NavGrid` an **optional boundary
override** provider, defaulting to `collision.playBounds` so the player's own instance is
byte-for-byte unchanged, and let `NpcSystem` hold one `NavGrid` per space pinned to that
space's boundary. Do NOT write a second router.

Cost note: A* over the park lattice for 24 children needs a per-frame plan budget (plan a few
per frame, not all at once) — `npm run check:solve-cost` is in the build and will notice.

---

## A SECOND, REAL BUG, found by the dispersal check (29 Aug)

The check paid for itself before it was even wired in.

Watching three bus children at 5 s intervals:

```
t= 15 Ethan(-10,49)bus=0 d=Dodgems | Rumi(-8,47)bus=0 d=Dodgems | Cleo(-7,48)bus=0 d=Ball Pit
t= 30 Ethan(-18,39)      d=Dodgems | Rumi(-21,41)      d=Dodgems | Cleo(-20,39)      d=Ball Pit
t= 50 Ethan(-18,39)      d=Dodgems | Rumi(-21,42)      d=Dodgems | Cleo(-20,39)      d=Ball Pit
t= 70 Ethan(-18,40)      d=Dodgems | Rumi(-21,43)      d=Dodgems | Cleo(-21,41)      d=Ball Pit
t= 75 Ethan(-21,49)      d=Dodgems | Rumi(-23,49)      d=Dodgems | Cleo(-23,48)      d=Ball Pit
t= 85 Ethan(-38,40)      d=Dodgems | Rumi(-39,37)      d=Dodgems | Cleo(-19,24)      d=Ball Pit
```

Eleven children get off the bus at t≈15, walk to about (-20, 40), and **stop dead there from
t=30 to t=75**. The destination never changes in that window, so `steer` is never returning
"arrived" and `chooseDestination` is never being called. At t=75 they all move off at once and
walk straight to their attractions.

**t=75 is `JOURNEY_TIMEOUT`.** They were pushing at a dead route for the whole timeout, and the
replan that the timeout forces works immediately from the very same spot.

Diagnosis: `NavGrid.findRoute` does not promise to reach the goal — it ends at the closest
reachable point and says so via `lastRouteReachedGoal`. A route planned at t≈15, from the gate
with ten other children in the way, **stops short**. The child walks to the end of it and then
neither arrival test fires: the destination is still forty metres away, and the last waypoint is
one they cannot quite settle on because ten siblings are jostling them off it
(`NpcSystem.separate`). So they push, and push, until the timeout.

`TapNavigator` already has exactly this problem and already answers it — `planRoute` reads
`lastRouteReachedGoal` and has `REPLAN_ATTEMPTS = 1`. The child driver had neither. **This is
the "pathfinding getting stuck" Jim's report guessed at** — it was not the cause of the original
clumping (there was no pathfinding at all then), but it is real now, and it would have shipped a
crowd that bunches at the gate for the first minute of every session.

Fix: give `Journey` a bounded replan (the same idea as `REPLAN_ATTEMPTS`) plus a **stuck
detector** derived from `NPC_WALK_SPEED` — a child who has covered far less ground than walking
would have covered has a route that is not working, and wants a new decision now rather than in
seventy-five seconds.

---

## A THIRD clumping mechanism, and nobody had spotted it (29 Aug)

Neither issue #350 nor the sandbox investigation found this. It came out of the dispersal check
demanding that most of the crowd be free to walk.

**`TrainTrip` has no concurrency budget.** In `activities/trainTrip.ts` the `'none'` case rolls
`TRAIN_CHANCE = 0.55` every `TRAIN_INTERVAL_MIN..MAX` (22–70 s), per child, independently, with
nothing capping how many may go at once. Every other activity in the park has such a cap —
`MAX_CONCURRENT_CLIMBERS`, `MAX_CONCURRENT_CHATTERS`, `MAX_CONCURRENT_PAINTED` — and the train is
the one that does not.

Measured on the canonical seed, instrumenting which activity holds each child:

```
t=60s   free (no activity holding them) = 4 of 24
```

**Twenty of the park's twenty-four children were on the train or walking to a station at the same
moment.** That is a station platform with most of the park standing on it, and it is exactly the
report — "all the NPCs gather in one place quite soon" — arrived at by a completely different
route from the random walk.

So #350 had **three** mechanisms, not the two the handoff originally listed:

1. the random walk's diffusive stationary distribution pooling on the plaza (the main one);
2. the bus cohort's shortfall-route jam at the gate (found by this check, fixed by the bounded
   re-plan and stuck detector);
3. the uncapped train, above.

Fixing only the first would have left the crowd pooling at the station having been given
somewhere else to be. The fix mirrors the existing `BudgetSlot`/`ActivityBudget` pattern exactly
rather than inventing a second one — claimed when the child commits to walking to a station
(walking there is part of the trip), released on every exit, `'allow'` when no budget is handed
over, matching the climb.

---

## DONE (29 Aug) — what shipped

All five requirements met; three clumping mechanisms fixed, not one.

**Root causes, in the order they were found**

1. The random walk's diffusive stationary distribution pooling on the plaza. Deleted, replaced by
   real destinations on the player's own `NavGrid`.
2. A route that stopped short in the crowd at the gate, pushed at for the whole 75 s
   `JOURNEY_TIMEOUT`. Fixed by a bounded re-plan + a stuck detector derived from `NPC_WALK_SPEED`.
3. `TrainTrip` had no concurrency budget — 20 of 24 children on the railway at once. Capped at 4,
   mirroring the existing `BudgetSlot` pattern.

**Numbers (canonical seed, `check:npc-dispersal`)**

| | worst RMS spread | worst clump (8.2 m disc) | distinct destinations |
| --- | --- | --- | --- |
| fixed | 37.3 m (64% of uniform) | 6 of 24 | >= 9 |
| `--mutate` (all sent to one attraction) | 15.7 m (27%) | 15 of 18 free | 1 |

Five seeds green (canonical, 2, 5, 11, 18) at 58-69% of uniform against a 50% bar.
`tsc` clean, `npm run test:procgen` 443/443, `npm run build` exit 0 (unpiped).

**Browser QA** — headless Chromium, `/spawn?pos=0,0&facing=45`, player left standing so the chat
path is live. 24 children, 20 free, 11 distinct destinations, worst clump 4, RMS 42-45 m, **0
console errors** on both the production build (5350) and dev (5351). Both servers killed by PID.

**One bug the browser caught that no Node check could**: the bubble read *"I'm going to the The
Castle"* — half the park's signs are already articled. Fixed in `announce()`, checked against all
eighteen real names.

**Left for a separate issue (do not widen this PR)**: `Yara`/`Kiko` finishing 0.14 m apart, inside
`NPC_RADIUS * 2`. Not reproduced or investigated here — it was noted in passing by the sandbox
run and is a `check:npc-separation` question, not a dispersal one.

---

## Review round 1 — three blockers, all fixed (29 Aug)

**Blocker 1: the castle never fired.** Every castle-side piece shipped as unreachable code —
children spawn only on garden waypoints and `reachableFrom` was same-space-only, so no child
could choose a shop. Reviewer's census: `[["garden",14400]]`, 14400 of 14400 samples outdoors.

Fixed with `entities/npc/portals.ts`: a cross-space journey is two legs (walk to the door, step
through, walk to the shop). Both thresholds derived from the building's own
`castleEntranceBand()`/`castleExitBand()` — the same functions the *player's* crossing uses — and
both landing spots from `enterInterior`/`leaveInterior`. `Journey` cannot move a body, so it
raises `portalRequest` and `NpcSystem` carries it out; same split as `TreeClimbing`/`climbPhase`.

New census after the fix:

```
space census: [["garden",1189],["castle",251]]
distinct shop destinations ever chosen: 7 (all of them)
peak children inside at one sample: 4 (cap 4)
children who were ever inside: 10 of 24 over ten minutes
```

**It is now permanently guarded**, not proven by a scratch script: `check:npc-dispersal`
assertion 4 fails if no child goes inside or no shop is ever chosen.

**Blocker 2: `trace-npc-driver` still read the deleted `targetNode`.** `scripts/` is outside both
tsconfigs so `tsc` could not see it, and it failed *silently*: `Math.round(undefined * 4096) & 0xffffffff`
is `0`, so the fingerprint went on hashing while having stopped covering where any child is going.
Now mixed via `mixText`, a separate function so a future non-number cannot fail the same way.
Hash `f16d70d1` → `2cdba2c3`; deliberately not asserted anywhere, so nothing to regenerate.

**Blocker 3: "I'm going to the Ice Cream".** Nineteen names, not eighteen. The `/s$/` heuristic
got "Candy Floss" right and "Ice Cream" wrong — two strings that look alike. Article choice is now
an `articled` field on `Attraction` with an explicit `NO_ARTICLE` set keyed by stable id. The QA
script's filter matched `"I'm going to the"` so it could only ever see the working branch; fixed,
and all three branches are now observed in the browser.

### Also fixed

- `TrainTrip`'s `!service` exit missed `slot.release()`.
- **Assertion 4 re-derived from the caps** (`NPC_COUNT - sum(caps)`) instead of a flat half, which
  had one child of headroom before the castle and would have been unsatisfiable after it.
- **The castle work reintroduced the 600 m dead end**: indoor children pushed the crowd RMS to
  276 m and it still "passed" at 476% of uniform. The check now measures garden children only.
- `MAX_INSIDE` now bounds **presence**, not choice — six were arriving where the cap said four.
- Three near-duplicate attractions merged: a ride's entrance and its own ticket booth are one
  place ("Dodgems" / "Dodgems!"). Matched on normalised name **and** proximity, because "The
  Castle" and "Sky Cruiser" sit 11 m apart and are genuinely different.
- Spread and variety are now asserted **sustained across the run** rather than on the worst single
  sample. Thresholds untouched; a dozen points at one instant is a noisy estimator and children
  crossing to different attractions all pass through the middle of the park.
- `check:jitter` correctly caught the portal as an 810 m own-step. Re-baselined on the *declared*
  door step exactly as a train carry already is — an undeclared 600 m jump still fails.

### Numbers now

Five seeds, mean spread 67–80% of uniform (bar 50%), variety 7.8–8.9 of 10 (bar 4), worst clump
3–6 of 24 (bar 8). `--mutate` fails **all four**: spread 42%, clump 15, variety 1.0, no castle.

`tsc` clean · `test:procgen` 443/443 · `npm run build` **exit 0** · browser 0 console errors.

**Honest limit**: headless Chromium runs this park at well under a frame a second, so the browser
numbers establish *it renders, the bubbles read correctly, children reach the castle, and nothing
errors* — they are **not** independent corroboration of the dispersal statistics. Node is.
