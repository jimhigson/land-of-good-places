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

Not yet ruled out: whether the railway/bridge work in #348 split the park's `PoiGraph` component.
`markReachable` (poiGraph.ts ~line 470–527) keeps **only the largest connected component per space**
and marks the rest unreachable; if the railway corridor now cuts the park in two, every child is
confined to one side. **This is the next thing to check** (dump component sizes; compare against
`311ad89^`).

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
