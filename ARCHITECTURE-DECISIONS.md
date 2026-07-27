# Architecture Decisions

A log of the hard structural calls, in the order they were made. Each entry is a
decision memo: what was decided, why, what it costs, and what it unblocks. When
a decision here conflicts with older prose in ARCHITECTURE.md or a PR
description, **this file wins** — update the other document rather than
re-litigating the call. Add new decisions to the top, numbered, dated, with the
sources you actually read.

---

## Decision 2 — Ride queues

**Date:** 27 July 2026 · **Status:** decided, not yet implemented
**Sources read:** GAME_DESIGN.md ("Ride queues (27 July 2026)"), decision 1
below, `src/minigames/MiniGameHost.ts`, `src/minigames/types.ts`,
`src/minigames/stalls.ts`, `src/world/train/ParkTrain.ts`,
`src/world/train/service.ts`, `src/entities/npc/wanderDriver.ts`,
`src/entities/npc/driver.ts`, `src/entities/npc/NpcSystem.ts`,
`src/world/building/StairRide.ts`, `src/world/World.ts`, `src/Game.ts`,
`src/world/DayNight.ts`, `src/core/constants.ts` — all read on the
integration branch in `.claude/worktrees/agent-aff75b8bf22683c43`, which is
where the train, the stall games and the stair ride actually coexist; `main`
does not have the train yet.

**One correction to the brief before anything else:** the two additive blocks
in `wanderDriver.ts` are the **park-train trip** and the **face-paint visit**.
There is no tree-climbing block anywhere in the codebase (checked both
checkouts). The argument below survives the correction — two blocks exist,
queueing would be the third — but the memo should not cite code that isn't
there.

### 1. Can a stall mini-game have a queue? Yes — because the frozen park is never on screen

The freeze is not the problem it looks like, for one verified reason:
`MiniGameHost.hidesPark` is true for the whole of `play` and `out` — **the
child cannot see the park while the park is frozen**. The queue only exists
to be looked at, and it is only looked at when the park is live. So:

**Ruling: every ride gets an in-world queue, including the stall games, and
the stall games keep freezing the park.** The queue freezes with everything
else, invisibly, behind the curtain. Do **not** make rides stop freezing the
park: the freeze is one of the two load-bearing decisions in
`MiniGameHost.ts` ("frozen, not torn down" is what makes returning free and
puts Eleri back exactly where she stood), and unfreezing would buy a running
park that nobody can see, at the cost of a full hidden park update per frame
on a phone.

The one observable seam: when the curtain opens again, the child who was
behind you is still standing exactly where they were — time visibly did not
pass while you rode. The fix is one line of theatre, not a refactor: **on
curtain-back, the queue advances one dispatch behind the closing curtain**,
so the first thing the returning player sees is the line shuffling forward.
`MiniGameHost` already has the hook — the `onResult` option exists and
`Game.ts` currently doesn't pass it.

What NPCs do at the front of a stall queue (they can't play a separate-world
game): a **pretend ride**. The front child is dispatched through the gate
into the ride's *in-world* body — and every stall ride has one: the dodgems
arena (`buildDodgemsPlot` is built into `World`), the water-fight plot, the
ferris wheel prop (`AnchorPlots` mounts `wheelProp`), the spooky house
booth. They idle inside for 10–15 s, come out the other side happy, and
rejoin the park. No mini-game is simulated; a six-year-old sees a child go
in and come out, which is all a queue ever promises.

### 2. Does wanderDriver need refactoring now? Yes — and only as far as naming what it already does

Honest judgement: the additive-block pattern has **already produced its own
implicit interface twice**. Both existing blocks are exactly "a method
returning `true` when it owns the frame's intent", hooked into `update()` at
one call site each; both end by rejoining the graph with the same duplicated
`graph.nearest` + reset `current`/`previous` + `chooseNext()` dance; the
train block also carries steer-and-sidestep stuck logic the queue walk will
need verbatim. A third copy-paste block would work — but the queue block
cannot be a hand-written singleton like the other two, because it must be
**parameterised per ride** (seven-plus queues), and that is the point at
which "additive block" stops being additive and starts being a template you
re-instantiate by hand.

**Ruling: extract the smallest abstraction that is already true.**

- `src/entities/npc/activities/activity.ts`: an `Activity` is
  `update(context, intent, driver): boolean` — true means "I owned this
  frame". Nothing else. No behaviour stack, no tree, no priorities beyond
  array order; one activity holds the driver until it returns false.
- `activities/trainTrip.ts` and `activities/facePaintVisit.ts`: the two
  existing blocks moved, not rewritten — their state machines, tuning
  constants, module-level registries (`facePaintStallTarget`,
  `wanderDrivers`) and seeded-RNG behaviour move with them unchanged.
- Shared helpers extracted once: `steerTowards` + stuck-sidestep, and
  `rejoinGraph` (the currently-duplicated exit dance).
- `WanderDriver.update()` keeps its exact shape: try activities in order,
  first taker wins, otherwise wander. The wander core itself is untouched.

Migration cost: one PR, ~300 lines *moved*, zero intended behaviour change,
verifiable by watching the park (determinism is seeded, so before/after
NPC traces should match). The risk is low precisely because the interface is
descriptive, not aspirational.

### 3. What a queue is, concretely

**`src/world/rides/queue.ts`** — the first resident of the `world/rides/`
folder decision 1 already reserved for shared in-world ride pieces.

A `RideQueue` owns:

- **An authored path**: a short polyline from a join gate to a boarding
  point, with slot positions spaced ~0.9 m along it (the existing
  `ARRIVE_RADIUS` scale). Physical fencing (the `addBoothCollision` wall
  trick) funnels the last metres so nobody — player included — can walk
  around the line to the counter. Geometry enforces fairness; no logic gate
  needed.
- **An ordered ticket list**: `join()` returns a ticket or `null` when the
  line is full; `leave(ticket)`; `slotFor(ticket)` → x/z/yaw to stand at;
  `atFront(ticket)`. The player and NPCs hold the same kind of ticket, which
  is what "the player queues like everyone else" means structurally.
- **A dispatch rhythm owned by the ride, not the queue**: the ride calls
  `dispatchFront()` at its natural boarding moment. The queue never decides
  when boarding happens; it only knows who is next.
- **A registry**, `rideQueues()`, module-singleton style — the exact
  `trainService()` pattern, and for the same reason: `NpcSystem` builds its
  drivers before rides exist, and a driver asks "are there queues today?"
  rather than being handed one.

What a ride implements to get a queue: construct one with a path + capacity,
call its `update(dt)` (slot shuffling), call `dispatchFront()` on its own
cadence, and define what boarding an NPC means. That is the whole contract:

| Ride | Dispatch moment | NPC boarding means |
| --- | --- | --- |
| Train stations | `stoppedAt(stop)` + free seat | `claimSeat` (unchanged) — the queue replaces the platform scramble in the trip activity's `waiting` state |
| Stall games (dodgems, water fight, spooky, ferris kiosk) | timer, every 8–12 s | pretend ride through the in-world plot (§1) |
| Coaster (decision 1, PR-3/4) | carts at station | seat claim, TrainService pattern |

**Does the train generalise? The pattern, not the class.** `TrainService` is
the *boarding half* only — seats, claiming, dwell — and it generalises
beautifully (structural `TrainPassenger` typing, carry-before-`NpcSystem`
ordering, singleton discovery). But it has **no line**: today's NPCs cluster
on the platform and race `claimSeat` first-come. The queue is the missing
front half, slotted in front of the existing seat interface, which does not
change. The building's traversal rides (slide, lift, trampoline, bubble,
stairs) get **no queue** — they are transport and free play, not gated
attractions, and a queue for a slide inside the play-building would read as
a punishment (flagged as family question 2 anyway).

### 4. The fast-forward: reuse `timeScale`, and compress the cadence too

Verified mechanism: `Game.timeScale` scales the frame delta for *everything
downstream* — player, world, NPCs, train, escalators, day/night — and the
stair ride already drives it at `STAIR_RIDE_TIME_SCALE = 3.5` with the
whoosh vignette. **Ruling: queue-skip is the same mechanism, same constant
family, same vignette.** Press the button → `setTimeScale(~3.5)` + whoosh;
auto-release the moment the ticket reaches the front; any stick input or
tap-away cancels (the train's `wantsOff` precedent: movement always means
"let me out").

Two things the multiplier alone cannot fix, and one it must not touch:

- **Don't crank past ~4×.** Everything integrates with `dt`; far NPCs
  already run at doubled `dt` (`FAR_DISTANCE` throttle), so 4× is an
  effective 8× step for them — beyond that, 0.9 m arrive radii and the
  2.5 s stuck-detection windows start to misbehave. Instead, **compress the
  dispatch cadence while skipping** (the queue's ride dispatches every 1–2 s
  of game time instead of 8–12): the skip should resolve in ≤ ~5 s of real
  time from anywhere in the line, whatever the multiplier.
- **The day/night clock will visibly spin.** A day is 150 s
  (`DAY_LENGTH_SECONDS`), so a few seconds of 3.5× is a noticeable slice of
  sky. This is *already the established meaning* of fast-forward in this
  game — the stair ride does exactly this on purpose — so let it spin. If
  the family dislikes it, exempting `DayNight` is one rate-override line,
  decided then, not now.
- **What must not be touched:** nothing needs a new exemption. Pause already
  forces `dt = 0` over the top of `timeScale`; mini-games run on the loop's
  real `dt` and cannot co-occur with an in-park skip; DOM/UI and the curtain
  run on real time. The player's own physics runs scaled, and that is fine
  by direct precedent — the stair ride walks the whole character at 3.5×
  today.

The player is **never** `beginRide()`-held while queueing. They stand freely
on their slot; drifting a couple of metres off it forfeits the ticket and
the line closes up. A queue that "has hold of you" is the one version of
this feature that could ever trap a child.

### 5. Cadence and legibility for a six-year-old

- **Population first**: `NPC_COUNT` is 12, and 12 children cannot dress
  seven queues and still wander the park. Raise to **18**. Verified cheap:
  the crowd is instanced ("the thirteenth costs nothing but a matrix"),
  distant behaviour is already half-rate, and separation grows 66 → 153
  pairs — trivial.
- **Line length**: capacity 5–6 slots, **2–4 children visible** in a line
  typically; `join()` refuses when full and the passing child just walks
  on. A line of three reads "popular"; a line of eight reads "homework".
- **Unskipped wait**: dispatch every 8–12 s (the train's `DWELL_SECONDS = 8`
  sets the park's rhythm), so joining a typical line costs 20–30 s if the
  button is never touched, during which waving, hopping and looking around
  all still work (queueing is a slot target, not a pose lock). Skipped wait:
  ≤ ~5 s real (§4).
- **Nobody gets stuck behind a stalled line — four guarantees**, each with
  an existing precedent: (1) dispatch is on the *ride's* timer, never
  blocked on an NPC decision, so the front always clears within one cadence
  beat; (2) every NPC ticket carries a `WAIT_TIMEOUT`-style backstop
  (~45 s) — a child who somehow can't board abandons and the line closes
  up, exactly as train trips abandon today; (3) the player leaves instantly
  by walking away — no confirm, no button; (4) queue paths are authored off
  the walking paths (the `stalls.ts` placement rules), so a line never
  blocks a route to anywhere else.

### 6. Implementation plan — PR-sized, parallel-safe

| PR | What | Owns (files) | Depends on |
| --- | --- | --- | --- |
| **PR-A** | `wanderDriver` → activities: extract `Activity`, move the train-trip and face-paint blocks unchanged, extract `steerTowards`/`rejoinGraph`. No behaviour change. | `src/entities/npc/wanderDriver.ts`, `src/entities/npc/activities/*` (new) | — |
| **PR-B** | The queue itself: `RideQueue`, slot math, tickets, dispatch, registry, fence-building helper; dev-console harness queue for testing without a ride. | `src/world/rides/queue.ts`, `src/world/rides/queueRegistry.ts` (new) | — (parallel with A) |
| **PR-C** | NPCs queue: `activities/queueForRide.ts` (roll → walk to gate → hold slot → board on dispatch → pretend-ride or seat → rejoin); `NPC_COUNT` 12 → 18. | `src/entities/npc/activities/queueForRide.ts`, one constant in `NpcSystem.ts` | A, B |
| **PR-D** | Train adopts queues: one per station, front-of-line feeds `claimSeat`, trip activity's `waiting` state consumes it; walk-on boarding kept when the line is empty. | `src/world/train/ParkTrain.ts`, `src/world/train/station.ts` | B, C |
| **PR-E** | Stall queues: authored queue path + fences per stall, pretend-ride dispatch, `onResult` wired so curtain-back advances one dispatch. `MiniGameHost` internals untouched. | `src/minigames/stalls.ts`, `src/world/rides/stallQueue.ts` (new), the `onResult` wiring line in `src/Game.ts` | B, C |
| **PR-F** | Player queueing + fast-forward: ticket on walking into the gate, HUD skip button, `setTimeScale` + whoosh + compressed cadence, walk-away-to-leave. | `src/world/rides/playerQueue.ts` (new), `src/ui/Hud.ts`, small additions in `src/Game.ts` | B (parallel with C–E) |

A+B are fully parallel; C–F fan out after them. `Game.ts` is touched only by
E (one wiring line) and F — keep F the only PR that adds to it. The coaster
(decision 1, PR-3/4) takes a `RideQueue` at its station when it lands; B is
a dependency it inherits, not a change to its plan.

### 7. What changes, what stays

**Changes:** NPC boarding at train stations goes from platform scramble to
an ordered line (same seats, same `claimSeat`); stall stand-points become
queue gates with fences; `wanderDriver.ts` shrinks to core-plus-activities;
`NPC_COUNT` 12 → 18; `Game` passes `onResult` and exposes the skip.
**Stays untouched:** `MiniGameHost`'s freeze/curtain machinery and the
`MiniGame` contract; `TrainService`'s interface; the wander core (waypoints,
waves, hops, pauses); `Player`'s ride API; the building's traversal rides;
every mini-game's internals.

### 8. Questions for the family (parent-answerable)

1. "When you press the hurry-up button in a queue, the whole world goes
   whooshy-fast like the stairs do — clouds and clock too. Is that right, or
   should just the queue hurry?"
2. "Should there be queues for the slides and trampoline inside the big
   building too, or only for the proper rides outside?" *(memo says outside
   only)*
3. "The park will have about eighteen children instead of twelve so the
   queues look busy. Still cosy, or too crowded?"
4. "Should RiPika sometimes stand in a queue too?" *(cheap, very cute)*

### Uncertainties, stated plainly

- **The curtain-back single dispatch** (§1) is theatre, and theatre can read
  wrong — if playtest says the line "teleported", fall back to advancing it
  over the first two seconds of the `back` phase instead of snapping.
  Contained in PR-E.
- **The player standing in a line of NPCs** is the first time the player
  body is parked inside the crowd for tens of seconds; NPC separation runs
  pairwise among NPCs only, so a child may shuffle into overlap with the
  player. If it looks bad, the fix is slot-targets treating the player's
  ticket as an occupied slot (already the design) plus a small standoff —
  cosmetic, not structural.
- **18 NPCs on the cheapest phone**: high confidence (instancing, half-rate
  far updates), but it is a number chosen without profiling. PR-C should
  glance at the frame time before and after.
- The queue paths are authored, and authored numbers rot (decision 1 said
  the same about the coaster): each queue's fence and slots should be
  boot-validated against `CollisionWorld` the way stall placement was
  hand-checked, or a scattered bush will one day stand in slot 3.

---

## Decision 1 — Rail Racer becomes the park coaster (item 30g)

**Date:** 26 July 2026 · **Status:** decided, not yet implemented
**Sources read:** GAME_DESIGN.md (items 13, 16, 25, 30g), ARCHITECTURE.md,
`src/minigames/MiniGameHost.ts`, `src/minigames/types.ts`,
`src/minigames/railRacer/*`, `src/world/anchors.ts`, `src/world/paths.ts`,
`src/core/constants.ts`, and the in-flight train PR at
`.claude/worktrees/park-train/src/world/train/*` (branch `feat/park-train`).

### 1. Train vs rails: TWO systems, one shared toolkit

**Recommendation: keep them separate.** The train (item 25) and the coaster
(item 30g) are different things to a six-year-old, and real parks have both:

- **The train is transport.** It is slow (4 m/s in the PR), flat, at ground
  level, hugs the park edge (its solved route sits 48–58 m from the park
  centre), has platforms with names, and you get on to *go somewhere* or to
  watch the park roll by. Calm.
- **The coaster is a thrill.** It is fast (up to 22 m/s in the current Rail
  Racer tuning), it climbs and dips, it twists around the castle and the ferris
  wheel, and it has the hold/release ducking game the family loves. Whoosh.

A six-year-old never confuses the scenic railway with the rollercoaster,
because parks make them **legible at a glance**, and we do the same with three
cues, any one of which would suffice:

1. **Height.** The train stays on the ground. The coaster is *elevated* — pink
   tubular rails on cream pylons, 4–8 m up. This is also what makes the
   routing possible at all (§3): the ground band is full; the air is empty.
2. **Territory.** The train owns the outer band (r ≈ 48–58). The coaster lives
   in the middle band (r ≈ 15–45), among the attractions. They cross exactly
   twice, near the ferris wheel, where the coaster swoops **over** the railway
   with ≥ 5.5 m of clearance — a classic theme-park postcard image, not a
   tangle.
3. **Look and speed.** Chunky brown-sleepered steam train vs. bright coaster
   carts. Nothing that moves at 4 m/s looks like anything that moves at 20.

**Do not merge them into one gameplay system.** Merging would force the racing
mechanics onto the transport ride (the train must stay boring — it is where a
child parks a parade of toys and watches the park) or strip the racing out of
the coaster (which is the part the family asked to keep). What they *should*
share is engineering, not identity: both are "carts spaced along a closed
arc-length-parameterised curve, with seats, that characters can ride". The
train PR already built most of that (`TrainRoute`'s curve sampling,
`placeCars`, the `TrainService` seat interface, `MovingPlatform` carriage
floors). Decision: **land the train PR untouched**, then extract the shared
pieces into `src/world/rails/` when the coaster needs them (§5, PR-2/PR-6).
Do not hold the train hostage to a refactor.

**What happens to the racing.** The hold-to-accelerate / release-to-duck rule
transfers verbatim — hazards become decorated arches, gates and branches hung
over the real track (near the castle walls, under the ferris wheel swoop). The
part that cannot transfer literally is the four side-by-side lanes: a real
coaster is one rail. Best call: **rival carts run the same rail, and you
overtake at passing loops** — two or three short stretches where the track
doubles into a side-by-side pair for ~15 m, exactly like a real railway
passing place. Rivals get a head start; good ducking closes the gap; if you are
bumper-to-bumper when a passing loop arrives, you sweep past with a whoosh and
confetti puff. Rubber-banding, no-fail bonks, and everybody-gets-confetti all
carry over unchanged from `railRacer/RailRacer.ts`. (Fallback if passing loops
prove fiddly: a "catch RiPika's cart" chase on a single rail — flagged as a
family question, §6.)

**NPCs ride it ambiently.** When the player is not racing, carts circulate
with NPC kids aboard (same seat-claiming pattern as `TrainService`), so the
rails are always alive — that is half of what item 30g is asking for.

### 2. Camera: a separate perspective rig, swapped in by curtain-blink

**Recommendation: do NOT teach `IsoCamera` first person.** Add a small,
self-contained `RideCamera` (a `PerspectiveCamera`, FOV ~60°, positioned at
the cart's eye point, looking at a point a few metres ahead along the curve,
with gently capped banking) and give `Game` one new slot:
`cameraOverride: Camera | null`. When set, `Game.render` renders the *same
park scene* through the override, `Game.tick` skips `camera.update()`, and
`FrameContext.cameraForward` is sourced from the active camera. That is the
whole integration — roughly ten lines in `Game.ts`.

**Crucially, this is a third render state, not a fourth mini-game state.**
`MiniGameHost` freezes the park and swaps scenes; the coaster must do the
opposite — the park keeps updating (NPCs wander, the train chuffs, day/night
runs) because *looking at the living park* is the entire point of the ride.

**Entering and leaving the view:** do not blend orthographic → perspective;
it is famously ugly. Reuse the existing `Transition` curtain for a 0.4 s
blink at boarding and alighting. It is already on-brand (it is how every
stall game opens), already written, and hides every seam. A dolly-zoom blend
(perspective camera far out with a narrow FOV matching the ortho frustum,
then FOV animating up as it moves in) is a lovely stretch goal — do not
attempt it in the first PR.

**Blast-radius audit** of the code that assumes iso, with verdicts:

| System | Verdict |
| --- | --- |
| Tap-to-move (`TapNavigator`, `pickWalkable`) | **Suspended while riding.** The train PR already establishes that a ride "has hold of you" and hides touch movement; the coaster does the same. Zero code risk. |
| Sign reading (`SignInspector`) | Suspended while riding (it drives `IsoCamera.beginInspect`, which is not the active camera). One guard. |
| Name labels (`ui/NameLabel`) | Sprites face any camera; distance-hide uses camera distance and simply hides them sooner in perspective. **Hide all labels during the ride anyway** — cleaner picture, one setter. |
| Floor fader (`building/floorFade`) | Keyed off the *player's* floor, and the rider is outdoors at ground truth. No change. |
| HUD | Hidden during the ride, exactly as mini-games hide it; the ride shows the existing hold-pad overlay (`minigames/overlay.ts` is reusable as-is). |
| Fog | `FOG_NEAR/FAR` are offsets from the ortho rig's 90 m standoff; from a first-person camera they land past the whole park, i.e. fog silently off. Acceptable; optionally push a per-ride fog override. Minor. |
| **`Sky.ts`** | **The one real risk.** The sky is a screen-space cheat tuned for the ortho rig, and the terrain is a disc whose rim-hiding slope was computed against the 38° iso pitch. From 7 m up looking outward you may see the rim treeline doing its job — or failing. Mitigation: the camera is on rails, so every frame of the ride is *authorable*; route the gaze mostly inward and level, and budget one tuning pass on Sky uniforms for the perspective case. If it fights back, a slightly stronger fog during the ride papers over the horizon. |
| Item 16 (everything authored to face one direction) | First person will see the backs of signs and stalls. The park is true 3D (the art approach chose solid models *because* cameras move), so nothing breaks — some backs are just plain. Budget a QA ride-along; decorate only what the route actually shows. |

Cost summary: ~10 lines in `Game.ts`, three suspension guards, one new
`RideCamera` file, one Sky tuning pass. The iso rig, and every system built on
it, is untouched when nobody is riding.

### 3. Routing: elevated figure-of-park loop, authored then validated

Facts on the ground (from `world/anchors.ts`, `world/paths.ts`,
`core/constants.ts`, and the train PR's measured obstacle table):
plaza+fountain at (0,0) r 9.4; castle at (−31,−33), shell ~30×22; ball pit
(−9,−15) r 9; ferris wheel (31,−27) r 13; dodgems (33,21) r 15; water fight
(−31,25) r 15; path network tops out at r ≈ 37; train band r 48–58; boundary
wall inner face at r 59.55. The ground is full — **which is exactly why the
coaster being elevated is a structural decision, not decoration**. Its ground
footprint is one station plus pylons every ~8–10 m, and pylons are small.

Sketch, clockwise, as (x, z, deck-height-above-ground). Read as ~20 authored
control points, not a solved profile:

- **Board:** station replaces the Rail Racer stall at **(10, −5)**, platform
  y 1 — it already has a path spur and is beside the plaza, so the queue is
  where children already walk.
- **Climb NE:** (18, −10) y 3 → (26, −14) y 5.
- **Around the ferris wheel, over the railway:** (42, −16) y 6 → (48, −28)
  y 7 — crosses the train band with ≥ 5.5 m rail-over-rail clearance —
  → (40, −41) y 6 → (26, −36) y 5, re-entering the inner band. A ¾ wrap of
  the wheel, seen from inside its own ride.
- **Along the castle:** (4, −30) y 6 → (−8, −22) y 7, skimming the ball-pit
  rim (carts overhead of the splash-down is a feature; pylons stay outside
  the pit) → (−14, −19) y 7 hugging the castle's east face at ~2 m off the
  wall → (−22, −14) y 6 rounding its entrance corner, always ≥ 5 m above the
  entrance path. (The castle's *far* side is off-limits: the train PR
  measured 2.95 m between the shell corner and the boundary wall, and the
  train already owns it. Wrapping the two park-facing faces still reads as
  "around the castle" from the fixed iso view, which only ever sees those
  faces anyway — item 16 works in our favour here.)
- **Down the west, between water fight and fountain:** (−16, 4) y 5 →
  (−14, 16) y 5 → (−4, 30) y 6 → (10, 32) y 5.
- **Past the dodgems, home:** (17, 24) y 5 → (16, 10) y 4 → descend to the
  station (10, −5) y 1.

Roughly 260–320 m of track; at racing speeds that is a 20–40 s lap, so a
two-lap race matches the current sub-minute ride length. Passing loops go on
the three straightest stretches (NE climb, west run, south run).

**Method decision:** the train's route is *solved* because it must thread a
band other agents keep building into; the coaster's route is *authored*
because twisting past landmarks is the design. But authored numbers rot, so
adopt the hybrid: hand-placed control points, **validated at boot** by the
train PR's own tricks — the obstacle table from `anchors.ts`, a
`CollisionWorld.resolve()` probe for pylon feet, plus two new asserts:
≥ 5.5 m vertical clearance wherever the deck crosses the train's solved
curve, and ≥ 3.5 m over any walkable ground (jumping child + parade). Build
order consequence: the coaster constructs **after** the train in `World`, so
the solved train curve exists to be measured against. Fail loudly at boot,
exactly as the route solver documents.

### 4. Is "in-world ride" a first-class concept? Yes — a small one

The codebase already contains three ride-shaped patterns: `SlideRide`
(scripted curve + `Player.beginRide`), the train (platform + `beginRide` +
"any movement means let me off"), and `MiniGameHost` (separate frozen-park
world). The coaster is a fourth. The wrong move is a grand unification; the
right move is naming the split and sharing four small pieces:

- **Stall/plot mini-game** (existing, unchanged): a self-contained world
  behind the curtain. Item 13 explicitly assigns dodgems, water fight, ferris
  wheel and (implicitly) spooky house here, and that decision stands — the
  ferris wheel in particular *needs* a separate world for the space show.
  `MiniGameHost` stays exactly as it is.
- **In-world ride** (new concept): happens in the park, park keeps running,
  camera may be overridden. Members: train, coaster, slides, lift. Its
  minimal shared shape is: (1) a boarding contract — proximity + the item
  30f action button ("Ride") + `Player.beginRide`; (2) the one-button
  `MiniGameInput` feed and hold-pad overlay, lifted from `minigames/`;
  (3) the `cameraOverride` slot from §2; (4) `MiniGameResult` reused
  verbatim for finish/confetti/store plumbing, so the Cute-o-dex and result
  toasts cannot tell a coaster from a stall.

No new base class, no registry — a `world/rides/` folder for the shared
pieces and a sentence in ARCHITECTURE.md. If a third camera-overriding ride
appears, revisit.

### 5. Implementation plan — PR-sized, parallel-safe

| PR | What | Owns (files) | Depends on |
| --- | --- | --- | --- |
| **PR-0** | Land `feat/park-train` as-is. No refactor demands. | its own files | — |
| **PR-1** | Camera override plumbing: `RideCamera`, `Game.cameraOverride`, suspension guards (tap-nav, sign inspector, labels, HUD), curtain-blink swap. Testable via a dev-console fly-through before any coaster exists. | `src/core/RideCamera.ts` (new), `src/Game.ts`, one guard each in `TapNavigator`/`SignInspector` | — |
| **PR-2** | `src/world/rails/`: arc-length rail path, elevated track mesh + pylons, cart placement, boot-time clearance validator. All new files. | `src/world/rails/*` (new) | PR-0 merged (validator reads the train curve) |
| **PR-3** | Coaster presence: route control points, station at (10,−5), ambient NPC carts + seats (TrainService pattern), World wiring. | `src/world/coaster/*` (new), one add in `src/world/World.ts` | PR-2 |
| **PR-4** | The ride: boarding button, first-person race, hazards/passing-loops ported from `minigames/railRacer/track.ts` tuning, results + confetti. | `src/world/coaster/ride*.ts`, reuses `minigames/overlay.ts` | PR-1, PR-3 |
| **PR-5** | Retire the stall: remove `railRacer` from `minigames/stalls.ts`, delete `src/minigames/railRacer/` (after family sign-off, §6), whatsnew entry. | `src/minigames/stalls.ts`, `src/minigames/railRacer/` | PR-4 shipped |
| **PR-6** (optional, later) | Re-base `TrainRoute` onto `world/rails` path type. Pure refactor. | `src/world/train/route.ts`, `src/world/rails/` | quiet period |

PR-1, PR-2 and PR-3 are parallelisable across agents with disjoint file
ownership; PR-1 is the only one touching the contended `Game.ts`, and it is
deliberately tiny.

### 6. Questions for the family (parent-answerable)

1. **Overtaking:** "On the new rollercoaster, is it OK to overtake the other
   racers at special passing places where the track goes side-by-side for a
   moment — or would you rather chase and catch RiPika's cart instead of a
   proper race?"
2. **Whooshiness:** "Riding in first person can feel a bit whooshy on a
   phone. Should there be a button to hop back to the normal bird's-eye view
   in the middle of the ride, just in case?"
3. **The old stall:** "Once the real rollercoaster is twisting around the
   park, should the little Rail Racer stall disappear completely, or stay as
   its ticket booth?"
4. **Names:** "The park now has the train (Sunny Side ↔ Bluebell Halt) *and*
   the rollercoaster. Is the rollercoaster called 'Rail Racer', or does Eleri
   want to name it something new?"
5. **Watching:** "When you're NOT riding, other children's carts will whizz
   round overhead. Should the player be able to wave at them (like waving at
   RiPika)?" *(cheap, cute, and confirms the ambient carts are wanted)*

### Uncertainties, stated plainly

- **Sky/rim from altitude** is the one place this could look bad rather than
  merely cost time. Confidence it is fixable with tuning: high. Confidence it
  is free: low. It is why PR-1 includes a dev fly-through before the coaster
  exists.
- **Passing loops** might read as "the track split, did I teleport?" to a
  six-year-old. If the first playtest says so, the RiPika-chase fallback
  drops in without touching the track, station, camera, or framework — only
  the race logic in PR-4.
- The castle wrap uses its two park-facing faces, not a full circuit. I
  believe that satisfies "around the castle" from every angle the fixed
  camera can ever show; if the family meant a literal full lap, the answer is
  no — the train got there first, and the back of the castle has 2.95 m of
  room.

---

## Family answers to §6 (27 July 2026)

**Q1 Overtaking — ANSWERED, and it supersedes the passing-loop design.**
The coaster is a **TWO-TRACK ride: two rails running alongside each other
for the whole circuit**. Racing is therefore a genuine side-by-side race
along the entire route — no passing loops, no RiPika-chase fallback, and
none of the "the track split, did I teleport?" risk flagged in the
Uncertainties section. That uncertainty is now closed.

Implications for the plan: `rails/` must carry a **pair** of parallel
arc-length-parameterised curves offset laterally (a constant ~2.2 m gauge
between track centres reads as "next to each other" at the coaster's
scale), not one. Hazards hang over both tracks so ducking matters in each
lane. The rival occupies the other rail for the whole ride, which is
simpler to reason about than shared-rail overtaking: no cart-vs-cart
collision handling is needed at all.

**Q2 Whooshiness — ANSWERED: first person only.** No mid-ride bird's-eye
button. Keep the control surface small; the ride is short and the curtain
blink already bookends it.

Q3 (fate of the stall), Q4 (name) and Q5 (waving at riders) remain open and
are not blocking — build to the memo's defaults until answered.
