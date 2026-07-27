# Architecture review

A running health record. Each review appends a new dated section and states
what was fixed since the last one. Do not overwrite earlier sections.

Context for anyone reading cold: this codebase was built very fast by a large
fleet of parallel agents, most of which died mid-task and were resumed or
replaced. Many features merged **build-verified only**, with browser checks
deferred. Conflicts were often resolved under time pressure, and naive
"keep both sides" resolution has already been caught producing duplicated
logic and structural damage. Assume more of that remains.

---

## Review 1 — 27 July 2026 — `src/world/building`

Fifteen findings, severity ordered. Every one cites file and line.

### S1 (P0) Shop counter colliders cut invisible walls through three forecourts

`layout.ts:501` states the governing rule: collision is height-blind, so a
counter on deck two is an invisible wall on deck four, and no two counters
may overlap in plan. `SHOP_SCALE_XZ = 1.6` (`layout.ts:646`) widened every
counter and forecourt **without re-spacing `SHOP_UNITS`**, breaking it.

Three overlaps, each landing inside another shop's sunken standing area:
`stickerPet` counter into `candyFloss` forecourt, `candyFloss` counter into
`stickerPet` forecourt, and `balloon`+`candyFloss` counters into
`surpriseEgg` forecourt.

**Why it is worst-case:** the serving spots stay clear, so tap-to-shop works
and walking does not. A child hits a hard invisible wall a third of the way
across a pit whose entire purpose is standing in it.

### S2 (P0) The grown-up hangs in the sky for the whole ginormous slide

`Building.ts:500` reparents him to `gardenRoot` unconditionally, but
`advanceRide` only writes his transform when he was actually invited
(`Building.ts:546`), and `updateCutaway` shows him whenever any ride runs
(`Building.ts:457`). Ride the slide without pressing E and a cuddly adult
floats 14.4 m up beside the tower for the entire descent.

Same block contains a merge tell: `Building.ts:495-497` verbatim duplicates
`leaveInterior`'s first three lines (`Building.ts:429-431`). Two independent
exit paths; anything added to one silently skips the other.

### S3 (P1) Build-order contract broken — `NpcSystem` is not last

ARCHITECTURE.md:409 says `NpcSystem` is constructed last because it needs the
finished collision world. `World.ts:116` builds it; `World.ts:129` then builds
`FacePaintStall`, which registers four walls. `poiGraph.ts:149` validates
every waypoint edge at build time, so edges crossing the stall survive
validation that should have deleted them — and children walk through it.
Fix: move the stall construction above the NPC system.

### S4 (P1) Ball pit bypasses its owner and forks a constant

Four contract breaks, self-documented as merge avoidance:
`BALL_PIT_COUNT` exists twice (`constants.ts:188` = 190, now referenced by
nobody; `BallPit.ts:45` = 900); the player is found by scene-graph **name
search** (`BallPit.ts:231`) when `Building.attachPlayer` already holds the
reference; 900 instanced balls cast shadows inside a hole against
ARCHITECTURE.md:180; and the constructor runs **6 simulated seconds of
physics synchronously before first paint** (`BallPit.ts:172`).

### S5 (P0, safety) Escalator wells are 0.6 m wider than the escalators

`ESCALATOR_WELL` (`layout.ts:158`) vs the ramp footprint (`layout.ts:368`)
leaves two 0.6 × 5.4 m open slots through the slab down each side of every
escalator on decks 1–4, outside the balustrade. Nobody falls today only
because player radius holds them back by 0.22 m — and **NPC radius leaves
0.1 m**. `STAIRWELL` matches its flights exactly; the escalator is the odd
one out.

### S14 (P0, safety) Two shafts have no rails and no colliders

Measured against `DECK_HOLES`: `TRAMPOLINE_SHAFT` (r 2.5, decks 1–2) and
`HELTER_SHAFT` (7 × 7 m, decks 1–2) are permanently open with no guard of
any kind. `BUBBLE_SHAFT` leaves a 0.2 m annulus and is fully open whenever
the bubble is elsewhere. `layout.ts:36` states as an absolute invariant that
every hole is fully spanned — it is not, and the next builder who trusts it
will place a bench across a shaft.

### S6–S13, S15 (P2) Hygiene

Shadow-casting on interior fittings and objects inside holes, against
ARCHITECTURE.md:180 (`Toilets`, `Trampoline`, `Bubble`, `GlassLift`,
`BallPit`, and a floor **mat** casting onto the floor it lies on).
Per-frame allocations — `Escalators.placeSteps` allocates 16 objects per
frame forever, including while the player is 890 m away in the garden.
The interact edge is consumed twice (`Building.ts:340` and `:355`).
Class boundaries in the wrong place (`Escalators.carry` must be *told* where
its own building is; `Building.ts` owns other devices' player state; `Stairs`
is a class that should be a function). Dead exports, including one whose doc
comment names a consumer that went the other way. Seven shop placeholders
built and hidden forever, each baking its own canvas texture against the
~40-texture budget. `FloorArrows.ts` contradicts itself about which axis
rotates an arrow. Triplicated helpers (`receiveOnly` three times, `clamp01`
three times, rail builders twice).

### Action taken

P0 items delegated immediately. P1/P2 recorded here for scheduling.
