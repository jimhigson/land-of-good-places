# Architecture Decisions

A log of the hard structural calls, in the order they were made. Each entry is a
decision memo: what was decided, why, what it costs, and what it unblocks. When
a decision here conflicts with older prose in ARCHITECTURE.md or a PR
description, **this file wins** — update the other document rather than
re-litigating the call. Add new decisions to the top, numbered, dated, with the
sources you actually read.

---

## Decision 7 — A route can be *weighted* towards something, but never has space reserved for it

**Date:** 5 August 2026 · **Status:** decided, first implemented by the Sky
Cruiser's castle crossing · **Sources:** `rail/generate.ts`, `coaster/route.ts`,
Decision 6 (which this is careful not to break), issue #113.

### The problem

The family asked that the Sky Cruiser **always** flies through the castle. It
only usually did. Measured over 24 free solves, 20 crossed and 4 did not — and
the four were not rejected for anything. They were perfectly good routes that
closed before they got there.

The cause is structural, not a bug: **the generator returns the first route that
satisfies the brief, not the best one.** Nothing in the brief mentioned the
castle, so the search took whatever fit first. A feature that depends on a route
going somewhere therefore cannot be obtained by asking afterwards, however
loudly — by the time there is a route to inspect, the choices that would have
taken it there are long gone.

### The decision

**A ride may declare named, weighted `influences` on its route brief, which bias
the search at the decision point. Nothing else changes.** Specifically:

1. **The mechanism is general, not a castle hook.** `RouteInfluence` is `{ name,
   x, z, radius, weight }` and the generator knows nothing about what it is being
   pulled towards. The castle is its first caller, not its reason. Any ride can
   say "I would like to pass near this".
2. **It reserves nothing.** This is Decision 6 restated under pressure, and it is
   the line most worth holding. No corridor is carved, no space is held, nothing
   is moved aside. The influence changes which routes are *likely*, never which
   are *possible* — and the castle's opening is still cut wherever the built
   curve actually crosses, never the route bent to a hole cut first.
3. **A weight makes an outcome likely; a `satisfies` predicate makes it
   required.** The two are separate on purpose. A brief that needs the outcome
   pairs them: the weighting does the work, and the backstop discards a solved
   route that missed. Measured across the five CI seeds, the backstop fires
   **twice** — which is the balance wanted. A backstop that fires constantly
   means the weight is too weak and the search is solving routes only to throw
   them away.
4. **The backstop cannot fail a park.** If every start pose is exhausted without
   a satisfying route, **the first route that solved** is returned anyway, with
   `SolveReport.satisfied` false. The first rather than the best: the search has
   no ordering over whole routes to call one better, and inventing one here
   would be a second, unexamined notion of quality beside the per-piece score. A park with no coaster in it is far worse than
   a park whose coaster missed the castle, and the procgen invariant is the loud
   way to hear about it.
5. **Absent is byte-identical.** A brief that declares no influences scores
   exactly as it did before this existed and draws no extra randomness —
   verified on all five CI seeds, matching length, piece count, candidates
   tried, backtracks and start-pose index. This matters because `generate.ts` is
   shared with the ginormous slide, and an opt-in capability must not reshape a
   ride that never asked for it.

### What it costs

Solve time, on seeds where the pull and the closure fight each other: the
canonical seed is unchanged at 16 ms, but seeds that now try more start poses
run 230-690 ms. Still comfortably inside the module-load budget, and the cost
lands on the seeds that need it.

It also makes the loops *less* free than Decision 6's ideal — a weighted route
is a slightly less surprising route. That is the trade the family asked for: a
castle you always get to fly through beats a castle you sometimes do.

### What it unblocks

Any "the ride should go past X" ask, without another bespoke solver. The obvious
next callers are a ride asked to swing near the plaza for the view, or two rides
asked to run alongside each other for a stretch.

## Decision 6 — Every park is its own park: nothing reserves space, and rides resolve collisions by backtracking

**Date:** 5 August 2026 · **Status:** decided, first implemented by the Sky
Cruiser's castle window (#113)
**Sources read:** Jim's ruling of 5 August, in his words below; GAME_DESIGN.md;
`src/world/rail/generate.ts` (header and search loop), `src/world/coaster/route.ts`,
`src/world/parkManifest.ts`, `test/procgen/invariants.ts`, and issues #112, #113, #118.

### The ruling

> "this should use an old-skool proc gen kind of park — in future I'd like each
> park to be unique, not featuring reserved space for certain things. The algo
> to use for the rides is to backtrack and keep trying different track sections
> on collisions, and only bail if backtracking fails for a very large number of
> tries."

Three things follow, and the third is the one that will bite whoever reads only
the first two.

### 1. Nothing reserves space — not for a ride, not for anything

No system may claim a volume of the park that other systems must then avoid.
Not as a quoted constant in a handoff note, and **not as an exported one
either**: exporting a reserved box is still reserving. The alternative is always
available and is what the generator is already built for — a system publishes
what it *actually solved*, and everything else treats that as an obstacle like a
tree or a wall.

This was decided against a live proposal. The Sky Cruiser's castle pass was
first designed as two openings at chosen positions with the route threaded
through them, and a reserved corridor handed to the ginormous slide so it would
keep out. That is the failure mode of #118 exactly: the slide was twelve
hand-authored world coordinates that stopped agreeing with a castle that had
moved, and eight of the twelve ended up inside the castle footprint. Numbers
that must agree, with nothing checking that they do.

### 2. Rides solve by generate-and-backtrack against real collisions

`rail/generate.ts` already works this way: lay a piece, reject it if it hits
something, try another, back up a joint when a joint runs out, restart from a
different start pose when a whole attempt dies. Keep that. **Budgets should be
generous** — bailing produces a park that will not start, which is worse than a
slow one, so the ceiling wants to be far above what a successful solve costs
(a successful Sky Cruiser solve is ~100 000 candidate pieces; the ceiling is
some millions) and bounded by wall clock rather than by optimism.

### 3. The solver is **plan-view only**, so it cannot backtrack on a vertical collision

This is the part that is not obvious from the instruction, and rediscovering it
costs a day.

`rail/generate.ts` searches in 2D. Its header is explicit about why: every
obstacle a rail ride dodges horizontally is a vertical cylinder, height is a
separate pass the caller applies afterwards, and searching in 2D is what keeps
the state space small enough to solve inside the module-load budget. The
consequence is that **at the moment the search accepts or rejects a piece, that
piece has no height yet.** "Backtrack on collisions" therefore cannot mean
vertical collisions. There is nothing to collide.

Measured, on 24 freely-solved Sky Cruiser loops against a castle described as
real masonry: horizontally the search constrains itself beautifully — 20 of 24
crossed a side wall and **every one of those crossings landed within 1.1 m of
its panel's midpoint against a 4.07 m allowance**, because the solver must fit
its own 3 m corridor through the passable band and the geometry forces the
crossing to the middle. Vertically, over the same 24, **only one** crossed at a
height where a window fits inside the wall; the rest ranged from 1.6 m to 10.2 m
up an 8.8 m wall.

**So a vertical requirement is expressed as a carve that responds to where the
solver went, never as a constraint the solver is asked to honour.** The height
profile is already carved to 1.1 m wherever the loop turned out to pass the
station, because a platform is there; the castle pass is carved level wherever
the loop turned out to run inside the castle, because a hole is there. Neither
reserves anything: a loop that never passes the castle is carved nowhere, cuts
no holes, and that park has an unbroken castle. That is decision 1 and decision
3 agreeing rather than fighting.

If a future ride genuinely needs a 3D search, that is a change to
`rail/generate.ts` and a real piece of work — not something to assume is already
there because the instruction said "backtrack on collisions".

### What it costs

Parks stop being predictable, and features stop being guaranteed. On a seed
whose loop misses the castle there is no fly-through at all. That is the point
of "each park is unique", but it means **every consumer must treat a generated
feature as optional**, and every test must treat its absence as a pass rather
than asserting the feature always exists.

---

## Decision 4 — The park replan: a railway through the park, not a ring around it

*(This is item **2.1** in ORDER-OF-WORK.md. It gates all of Wave 4.)*

**Date:** 27 July 2026 · **Status:** decided, not yet implemented
**Sources read:** GAME_DESIGN.md ("Replan the whole park around a real
railway", "The train ride, first person", "The train needs paths to its
stations", the spooky-house items, the CONTROL RULE), ORDER-OF-WORK.md Wave 4,
decisions 1 and 2 below plus the family answers to decision 1 §6 (two-track
coaster, first person only), and the code on `main` at 4876f69:
`src/world/train/route.ts`, `track.ts`, `station.ts`, `ParkTrain.ts`,
`src/world/terrain.ts`, `src/world/building/surfaces.ts` (`WalkSurfaces`),
`src/world/AnchorPlots.ts`, `src/world/anchors.ts`, `src/world/paths.ts`,
`src/world/Garden.ts`, `src/world/Collision.ts`,
`src/world/entrance/layout.ts`, `src/entities/npc/poiGraph.ts`,
`src/minigames/ferrisWheel/look.ts`, `src/core/constants.ts`.

### 0. The rulings, in one screen

1. **Nothing is ever dug.** The terrain heightfield and `terrainHeight()` are
   untouched; the rails sit at `terrainHeight + RAIL_HEIGHT` for every metre
   of the loop, exactly as `track.ts` builds them today. All verticality is
   **built up**: a tunnel is a hill *shell* placed over grade-level track; a
   path crossing is a *walkable deck* humped over it (§2).
2. **The attractions do not move** — castle, ball pit, ferris wheel, dodgems,
   water fight, fountain plaza all stay where they are. The **railway** is
   what changes shape: it keeps hugging the wall behind the four big plots
   and **dives inward through the four gaps between them** (§3). The one
   placement change: the **spooky house becomes a sixth anchor** at the north
   edge, on a little island the railway cuts off (§3).
3. **`route.ts`'s solver survives; its taste changes.** Authored *intent*
   (a per-bearing target profile with four inward dips), solved *legality*
   (the existing bounds/repair/scenery-nudge machinery, plus three new
   asserts). Not a hand-typed spline — the reasons route.ts gives for
   solving are truer than ever now the track runs where people build (§4).
4. **Four built structures**, one parametric construct: the **entrance
   tunnel** (every visitor walks over the railway to enter the park), the
   **spooky bridge**, the **picnic bridge**, and a **decorative tunnel hill**
   behind the ferris wheel. Crossings are *computed at boot* from the solved
   curve, so they can never drift off the track (§5).
5. **Track exclusion is generated, not decorated**: continuous invisible
   walls offset from the solved curve on both sides, with visible dressing
   only where a child can actually get (§6).
6. **Two rail systems, one toolkit** stands (decision 1 §1), amended: the
   coaster is elevated, two-track, and re-validated against the *new* train
   curve at boot. Its Decision-1 route sketch survives (§7).
7. **One `RideCamera`, built by extraction, adopted three times**: lift the
   ferris wheel's proven look-around out of `minigames/ferrisWheel/`, make
   the ferris its first consumer with pixel-for-pixel parity, then the
   first-person train, then the coaster. Never write a second look-around
   (§8).
8. **NPCs reach the platforms on the graph**: new spurs and platform nodes in
   `poiGraph`, and the train-trip behaviour's improvised off-graph steering
   is retired after the Wave-3 `Activity` extraction (§9).

### 1. What survives of Decision 1, and what does not

The replan supersedes Decision 1's *premise* — "train owns the outer band
r 48–58, coaster owns the middle band" — so, plainly:

**Superseded:**
- *"The train's territory is the outer band."* The train now spans r ≈ 29–58.
  Territory is no longer what tells the two systems apart.
- *"They cross exactly twice, near the ferris wheel."* Crossing count is now
  an output of the boot validator, not a design constant. The clearance rule
  is what survives, generalised: **≥ 5.5 m rail-over-rail wherever the
  coaster's plan position comes within 4 m of the train centreline**.
- *"Passing loops"* were already superseded by the family's two-track answer
  (see "Family answers" below decision 1); that stands.

**Survives, and is now load-bearing:**
- Train = calm transport, coaster = elevated thrill; **legible at a glance by
  height, look and speed** (no longer by territory). Do not merge them.
- The entire §2 camera plan — `RideCamera` + `Game.cameraOverride` +
  curtain-blink + the suspension-guard table — now serving the train too.
- The in-world-ride concept (§4): park keeps running during the ride.
- The coaster route sketch, station anchor at (10, −5), `world/rails/`
  toolkit, ambient NPC carts, and the PR shapes — folded into §10 here.
- Decision 2 (queues) is untouched structurally: queues attach to stations
  wherever the stations are. Its PR-D simply lands against the new platform
  positions.

### 2. The one physical rule: build up, never dig

The question "how do tunnels work when the terrain is a heightfield and
walking is `WalkSurfaces.sample`?" has a sharp answer: **a real dug tunnel is
not representable at all** — a heightfield stores one height per (x, z), and
ground-above-train-below needs two. Something must be *built* either way. So
the cheap and honest version is ruled in:

- **The rails never leave grade.** Every existing piece of train code that
  drapes on `terrainHeight` — `track.ts` ballast/sleepers/rails, carriage
  floors, `station.ts` — survives unchanged.
- **A "tunnel" is a shell**: a mound mesh (grass-textured, flowers on top,
  portal arches at both ends, lamps inside for the first-person rider)
  straddling the track. From outside, the train vanishes into a hill. From
  the inside — and the rider is *first person*, which is why this works at
  all — it is a real tunnel: dark, lamp-lit, then daylight again.
- **A path crossing is a deck**: a gentle hump (ramps ≤ 1:3.5, kerbs,
  lanterns) carrying the path over the track. Underside clearance =
  railhead + the train's measured height + 0.4 m — measure the train model's
  bounding box at boot rather than hard-coding a number that rots. Walk
  surface lands ≈ 3.2 m up; total structure ≈ 24–28 m long, deck 4.2 m wide.
- **Walkers stand on decks via one small extension to `WalkSurfaces`**:

  ```ts
  interface WalkPatch { heightAt(x: number, z: number): number | null }
  WalkSurfaces.addPatch(patch: WalkPatch): void
  ```

  Sampled in `sample()` exactly like platforms, but with a per-point height —
  which `MovingPlatform`'s single `surfaceY` cannot express and ramps
  (axis-aligned, building-local) cannot either. Decision 3 (castle floors)
  has since ruled: it rewrites `surfaces.ts` smaller but keeps `sample()`'s
  signature, keeps the registrable-surface pattern, and keeps
  `MovingPlatform` unchanged — a `WalkPatch` is the same shape and lives in
  the garden space, so it survives that rewrite as-is. The two edits to
  `surfaces.ts` (this decision's T2, decision 3's S2) must simply be
  **sequenced, not parallelised** — T2 is ~15 lines and should land first.
- **Path ribbons learn one trick**: `RouteDefinition` in `paths.ts` gains an
  optional `elevation?: (x, z) => number | null`; `addRibbon` uses it instead
  of `terrainHeight` where it returns non-null. The bridge module supplies
  the hump profile; every other route passes nothing and builds exactly as
  today.
- Deck meshes register with `pickWalkable` so tap-to-move works over a
  bridge; NPC graph edges across decks validate exactly like any other edge
  (clearance from `CollisionWorld`, height for free from ground sampling).

Two consequences worth saying out loud: the player is **never inside a
tunnel** (only the train is — the walker is always on top, in full view of
the fixed camera, which is what the family's bridge answer promised); and the
steam **puffs must be suppressed while the engine is under a deck or shell**,
or they will rise through it (one check against the crossing spans, listed in
§10).

### 3. The new map

The park reads exactly as it does today from the middle — plaza, castle,
ferris wheel, dodgems, water fight, ball pit all in their places — but the
railway now breathes: out to the wall behind each big plot, **in through each
of the four gaps between them**. Two of the inward dips carry stations; the
other two dive under crossings. Beyond the rails, three pockets of lawn
become *places*:

- **The entrance forecourt** (south): the gate at (0, 60) and the cat-bus
  stop at (0, 52) already live here. Arriving now means walking up and over
  **Welcome Hill** — the entrance tunnel — while the train chuffs underneath.
  The first thing every visitor does is cross the railway. That is the
  postcard.
- **The Spooky Island** (north): the ghost head (GAME_DESIGN's giant ghost
  with the spider — new anchor `spookyHouse` at (−4, −46), footprint circle
  r 7) sits beyond the rails, reached only by the **spooky bridge**. "Slightly
  set apart" is now literally true.
- **The Picnic Island** (east): lawn between the east dip and the wall,
  reached by the **picnic bridge** near Sunny Side station. Benches, flowers,
  and the best train-watching in the park.

The west pocket is the one place deliberately *not* reachable: the **Statue
Garden**, where the trackside statues and dancing characters (Wave 4.7) live
— visible from Bluebell Halt and the ring road, up close only from the train.

```
                                N
                       (spooky island)
                  ##### __GHOST HEAD__ #####
              ###       (spider on top)     ###
           ##       ===[spooky bridge]==          ##
         #     ====      |        ====TUNNEL====     #
        # ===castle       |     ==     HILL     ==     #
       # =[squeeze]      .|.       ( FERRIS  )    ==    #
      #   +---------+   . | .      (  WHEEL  )      =    #
     #    | CASTLE  |  .  |  .     (         )       =    #
     #    | (bldg)  | .  ring  .    ~~coaster~~      =     #
     #    +---------+ .  road  . ~~~    overhead      =    #
    # STATUE   (ball .    |    .    ~~~ on pylons ~~   =    #
    # GARDEN    pit) .    |     .        ~            =      #
    # =         . .  .  plaza ...(coaster stn)....[SUNNY      #
    # =[BLUEBELL].. .   ( F )  .            ~     SIDE]= picnic#
    # =[  HALT ]..  .  fountain .          ~          =[bridge]#
    #  =        .    .         .          ~           = PICNIC #
     # =        .     .. ring ..         ~           =  ISLAND#
     #  ==       .      road  .      ....           =        #
      #   ==    +--------+   .      .    +--------+ =       #
       #    ==  | WATER  |  .       .    | DODGEMS| =      #
        #     ==| FIGHT  | .        .    |        |=      #
         #      +--------+ .   .    .    +--------+      #
          ##      ====      .  .   ====WELCOME====     ##
             ###      ====== [ HILL  TUNNEL ] ====  ###
                ####          .(esplanade).      ####
                     ######    .cat-bus .  ######
                            ## [ GATE ] ##
                                  S
   ==  railway (ground level)      ~~ coaster (overhead, two rails)
   ..  paths                       [] built structure / station
```

*Schematic, not survey — the solver owns the exact metres.* The numbers that
are binding (everything else is the solver's business):

| thing | position / target | note |
| --- | --- | --- |
| N dip (spooky bridge) | r ≈ 30 at bearing 270° | crossing computed at boot |
| E dip (Sunny Side) | r ≈ 40 at bearing ~355° | corridor is narrow: ferris + dodgems corners |
| S dip (entrance tunnel) | r ≈ 29 at bearing 90° | widest corridor; gate/bus already at (0,60)/(0,52) |
| W dip (Bluebell Halt) | r ≈ 35 at bearing ~178° | |
| behind dodgems / water / castle / ferris | ≈ 56.2 / 57.4 / 58.1 / 54.5 | wall-hugs as today; castle squeeze (2.95 m) kept — it is the best moment of the ride |
| `spookyHouse` anchor | (−4, −46), circle r 7 | sixth entry in `anchors.ts`; stall row keeps the mini-game, loses the booth prop |
| coaster station anchor | (10, −5) | per decision 1; small footprint, elevated track owns no plot |

Loop length comes out around 350–380 m — roughly 90 s per lap at the train's
4 m/s, two stops, which is a proper little journey without being a commute.
The stations keep their existing placement mechanism **unchanged**:
`ParkTrain` already seats them with `route.distanceNear(±60, 0)` — east and
west — so when the dips pull the track inward, **the stations ride inward
with it automatically**, landing a short spur from the ring road. That single
fact is why "paths to both stations" (Wave 4.5) becomes cheap.

**What the anchor-plot system does in all this: it survives untouched.** The
five plots stay the source of truth for placement, path spurs and scenery
exclusion; `spookyHouse` joins as the sixth; the coaster station as the
seventh. The railway itself is deliberately *not* an anchor — it is linear
infrastructure, like the paths, and like the paths it is its own system.

### 4. The route: authored intent, solved legality

Does `route.ts`'s solve-against-collision approach survive? **Yes — because
its shape happens to be exactly right for the new brief.** The solver
represents the loop as a radius per bearing, and a winding loop with four
inward dips is *still* a radius per bearing — no self-crossings (which the
build-up-never-dig rule forbids anyway, since two grade-level rails cannot
cross). What changes is one idea and three guards, all in
`src/world/train/route.ts` plus one new file:

- **`src/world/train/profile.ts` (new):** the authored intent. A short list
  of (bearing, radius) knots — the table in §3 — interpolated smoothly. The
  solver's pull term changes from "pull toward the constant
  `NOMINAL_RADIUS`" to "pull toward `targetRadius(bearing)`". The knots are
  the *design*, readable and tunable in one place; the solver still owns
  legality. A hand-typed spline is explicitly rejected for the same reason
  route.ts already documents: the park keeps being built by other agents,
  and the track now runs where they build.
- **`RING_KEEP_OUT = 28.5` (new, explicit):** today the solver only stays off
  the ring road by luck (the obstacle-free fallback happens to be ~28.1).
  Make it a named lower bound: the track never comes within clearance of the
  ring road or plaza paving.
- **Obstacles now choose a side.** Today every plot pushes the track
  *outward*. The spooky island, the entrance gate, the bus stop and its
  shelter sit **beyond** the track, so for any obstacle whose radial interval
  lies outside the target profile at that bearing, the constraint flips to an
  *upper* bound (track passes inside it). Mechanical change in
  `solveProfile`'s lower/upper construction; the `repair()` corner logic
  needs the matching signed variant.
- **Three new boot asserts** (fail loudly, like the existing solver docs
  demand):
  1. minimum turn radius ≥ 7 m everywhere (the dips' flanks are the risk —
     if a dip cannot be reached at legal curvature, the solver shallows it
     and the assert tells you by how much);
  2. every declared crossing path intersects the solved curve exactly the
     number of times its definition says (once per bridge/tunnel), at ≥ 55°
     incidence, so crossings stay square-ish and short;
  3. the two stations' `distanceNear` seats land within 3 m of their target
     dips (catches a solver regression that would silently strand a station
     out at the wall).
- **`profile.ts` also exports the railway reserve**: the strip within 4.5 m
  of the target centreline (plus the coaster's pylon corridor, §7).
  `Scenery` refuses to plant in it — which means `nudgeOffScenery` becomes a
  belt-and-braces safety net rather than a load-bearing pass, and the solved
  route lands close to the authored intent deterministically. Without the
  reserve, a seeded bush inside a tunnel shell is a *when*, not an *if*.

`track.ts`, `station.ts` and `ParkTrain.ts` need **no structural change**:
draping, platform side-selection ("park side" = toward centre — still true at
every dip) and station seeding all survive as written.

### 5. Crossings: one parametric construct, computed at boot

**`src/world/train/crossings.ts` (new).** A crossing is declared, not
placed:

```ts
interface CrossingDefinition {
  readonly pathRoute: string;        // name of the route in paths.ts
  readonly style: 'bridge' | 'tunnel';
  readonly name: string;             // "Welcome Hill", "Spooky Bridge"…
}
```

At boot, after the route solves: intersect the named path's centreline with
the solved curve, orient the structure along the *track* tangent, and build
everything from parameters — deck or shell mesh, portal arches, the
`WalkPatch` for `WalkSurfaces`, the `elevation` callback handed to
`paths.ts`, hedge funnels and their collision, `pickWalkable` registration,
and two-or-three `poiGraph` nodes along the deck. **If the solver moves the
track a metre to dodge something, every crossing moves with it.** Nothing is
authored twice.

The four instances:

| name | style | path | notes |
| --- | --- | --- | --- |
| **Welcome Hill** | tunnel | `entrance-esplanade` (new route: gate → bus stop → over the hill → ring road at (0, 22)) | the big one: mound ≈ 22 m long; the esplanade is the only way in and out of the forecourt. The cat-bus scripted arrivals (`entrance/disembarkingKids.ts`) must walk it — audit that walk in the same PR |
| **Spooky Bridge** | bridge | `spur-spooky` (new: ring (0, −21) → winds north → ghost head door) | arched, slightly rickety-cute, lanterns |
| **Picnic Bridge** | bridge | `spur-picnic` (new: short hop east of Sunny Side) | benches on the island side |
| **Fern Hill** | tunnel | *none* | decorative shell on the NE bulge behind the ferris wheel — no path, flowers on top; exists so the ride "dives underground" twice per lap |

(A decorative tunnel takes the same construct with no path/deck parts — the
`pathRoute` is simply absent and it anchors at an authored distance along the
curve instead.)

First-person dressing inside shells — lamps, a whistle on portal entry,
chuff reverb — is polish, listed in §10, not architecture.

### 6. Keeping feet off the rails without fencing the park in

**`src/world/rails/guards.ts` (new, shared — the coaster station reuses
it).** Generated from the solved curve, never hand-placed:

- Two collision polylines offset **±2.0 m** from the track centreline
  (`CollisionWorld.addWall` segments every ~2.5 m), height 2.5 m,
  `autoHoppable: false` — above the jump-fling's reach, so Wave-1.4's
  airborne clearance path cannot skip them.
- **Declared gaps only**: none. Platform faces get their own full-length
  invisible wall at the platform edge instead (boarding is `beginRide`, not
  walking across the rails, so the wall never fights the ride). Tunnel
  portals sit *between* the two offset walls, so they need no gap. The two
  bridges span *over* the walls. Boot assert: each offset polyline is closed.
- **Visible dressing is separate from collision, and only where feet can
  actually arrive**: low picket fence + flowerbeds along the two station
  dips and both sides of each crossing approach; hedges funnelling onto the
  bridges; a raised ballast shoulder (embankment look) along the reachable
  parts of the N and S dips. The wall-hugging stretches behind the plots get
  **nothing visible at all** — the plots themselves screen them, and that is
  what keeps the park from reading as a cage. A child sees pretty borders at
  exactly the places she could have stepped onto the rails, and open lawn
  everywhere else.
- The NPC waypoint graph needs no special handling: edges validate against
  the collision world at boot, so the new walls silently drop any edge that
  used to cross the track's new course. Tap-to-move resolves against the
  same walls.

The three outer pockets (forecourt, two islands) are bounded by
rails-plus-wall and connected only via their crossings — that is the safety
story *and* the charm: the railway genuinely separates land, the way real
railways do, and bridges are how you get over one.

### 7. Two rail systems, one toolkit — the coaster under the replan

Everything in decision 1 §1 about identity stands: the train is calm ground
transport, the coaster is an elevated thrill, and a six-year-old tells them
apart by height, look and speed. The two-track family answer stands: the
coaster is a **pair** of parallel curves at 2.2 m gauge, side by side the
whole circuit. What the replan changes:

- **The coaster's Decision-1 control-point sketch survives** (station at
  (10, −5), the ferris wrap, the castle faces, the west run) — it lives 4–8 m
  up on pylons and consumes no ground the replan reassigns. It must simply be
  **re-validated against the new train curve**: ≥ 5.5 m vertical clearance
  wherever its plan position comes within 4 m of the train centreline (the
  old "crosses exactly twice" count is retired — the validator reports
  however many crossings the new geometry produces, and each is a postcard,
  not a problem), pylon feet ≥ 2.5 m clear of the train centreline and out of
  the crossings' footprints, and ≥ 3.5 m over walkable ground as before.
- **`src/world/rails/` becomes real now** (decision 1 deferred it):
  `rails/path.ts` — arc-length-parameterised curve with a lateral-offset
  twin for the two-track pair; `rails/guards.ts` (§6); the boot-time
  clearance validator. The train does **not** get rebased onto it yet —
  `TrainRoute` exposes its curve through a thin adapter where the validator
  and guards need it, and the old PR-6 "re-base TrainRoute onto rails/"
  stays a quiet-period refactor.
- Build order consequence (unchanged from decision 1, now with more riding
  on it): **coaster constructs after the train** in `World`, because the
  validator and the guards both read the solved train curve.

### 8. `RideCamera`: extract the ferris wheel's look-around, build once

Wave 4.8's instruction is "build the shared `RideCamera` once — ferris,
train, coaster all want it". The ferris wheel already *has* a working,
family-approved look-around (`minigames/ferrisWheel/look.ts` plus the gondola
camera in `SpaceFerrisWheel.ts`), and GAME_DESIGN.md records its directions
as **confirmed correct — do not disturb**. Those two facts pick the plan:

1. **Extract, never rewrite.** Move `look.ts` verbatim to
   `src/core/rideLook.ts` (it is already self-contained and ride-agnostic —
   drag sets a turn rate, keyboard adds, deadzone distinguishes drag from
   hold). Build `src/core/RideCamera.ts` around it: a `PerspectiveCamera`
   (FOV ~60°), a **mount** callback the ride supplies each frame (eye
   position + base orientation — gondola seat, train bench, coaster cart),
   yaw/pitch offsets driven by `rideLook` with per-ride clamps, and the same
   drift-to-rest feel the ferris has. The gondola-camera maths moves *into*
   `RideCamera`; the ferris becomes its **first consumer in the same PR**,
   and the acceptance test is behavioural parity — same directions, same
   feel, or the PR does not merge.
2. **`Game.cameraOverride`** lands exactly as decision 1 §2 specified (~10
   lines, third render state, park keeps updating, curtain-blink entry/exit,
   the suspension-guard table: tap-nav, sign inspector, labels, HUD). One
   integration, three riders.
3. **Train adopts second** (`src/world/train/ride.ts`): boarding runs the
   existing `beginRide` flow, then curtain-blinks to the `RideCamera`
   mounted at the seated eye point (~1.05 m above the bench). Free 360° yaw,
   pitch clamped ±45°. The CONTROL RULE is satisfied by construction:
   rotation input exists only here, in first person. Getting off keeps the
   train's existing grammar — while stopped at a platform, any *movement*
   input alights; `rideLook`'s `dragging` flag already exists precisely so
   look-drags don't count as "let me off". Statues, tunnel lamps and bridge
   undersides are what the camera is *for*; the ride needs no game logic
   beyond what `ParkTrain` has.
4. **Coaster adopts third**, with tighter clamps (yaw ±120°, pitch ±35°) and
   banking fed by the rail pair, per decision 1.

The known risk moves with the camera: **`Sky.ts` and the fog constants are
tuned for the iso rig** (decision 1 flagged it from 7 m up; a ground-level
train camera looking outward at the rim is a harder case than the coaster).
The train-ride PR therefore *includes* a Sky/fog tuning pass for the
perspective camera — a per-ride fog override is acceptable, a milky horizon
is not.

### 9. NPCs: the graph reaches the platforms; off-graph steering retires

New `poiGraph` seeds, all cheap because the stations now sit a short spur
off the ring road (§3): two or three nodes along each station spur ending at
a platform node (`interesting: true`), nodes over each bridge deck, a chain
along the entrance esplanade, and island nodes (picnic lawn, ghost head
door). Edge validation against the finished collision world does the rest —
including automatically dropping every old edge the new track severs.

The train-trip behaviour keeps its *ride* logic (claiming seats, riding,
alighting) but its walk-to-the-platform phase becomes ordinary graph
navigation to the platform node, deleting the improvised steer-and-sidestep
code and its stuck detection — which existed, as GAME_DESIGN.md notes, only
because there was no paving to walk. **Sequencing rule: this lands after the
Wave-3 `Activity` extraction** (the trip block becomes
`activities/trainTrip.ts` first, then shrinks), so nobody edits
`wanderDriver.ts` twice in conflicting directions.

### 10. Order of work

| PR | What | Owns (files) | After |
| --- | --- | --- | --- |
| **T1** | Route: `profile.ts` (knots + reserve export), solver pull-to-profile, `RING_KEEP_OUT`, side-choosing obstacles, three asserts; `Scenery` honours the reserve. Stations land at the dips for free. | `src/world/train/route.ts`, `src/world/train/profile.ts` (new), `src/world/Scenery.ts` | — |
| **T2** | Walk-height plumbing: `WalkSurfaces.addPatch`, `RouteDefinition.elevation`, `pickWalkable` deck registration. Tiny, enabling, no visible change. | `src/world/building/surfaces.ts`, `src/world/paths.ts`, `src/world/pickWalkable.ts` | — (parallel with T1) |
| **T3** | Crossings: `crossings.ts`, the four instances, new path routes (esplanade, spooky spur, picnic spur), disembarking-kids esplanade audit, puff suppression under decks/shells. | `src/world/train/crossings.ts` (new), `src/world/paths.ts` (route rows), `src/world/entrance/disembarkingKids.ts`, `src/world/train/puffs.ts` | T1, T2 |
| **T4** | Guards: `rails/guards.ts`, offset walls, platform-face walls, visible dressing at the reachable stretches, closure assert. | `src/world/rails/guards.ts` (new), small hooks in `src/world/train/ParkTrain.ts` | T1 (parallel with T3) |
| **T5** | Stations & graph: station paving aprons, `poiGraph` seeds (spurs, platforms, decks, islands, esplanade), train-trip walk phase moves onto the graph. | `src/entities/npc/poiGraph.ts`, `src/entities/npc/activities/trainTrip.ts` | T1, T3, **and Wave 3** |
| **C1** | `RideCamera` by extraction: `core/rideLook.ts` (moved), `core/RideCamera.ts`, ferris adopts with parity, `Game.cameraOverride` + suspension guards. | `src/core/RideCamera.ts`, `src/core/rideLook.ts` (new/moved), `src/minigames/ferrisWheel/*`, `src/Game.ts` | — (parallel with T1–T5) |
| **C2** | First-person train ride: `train/ride.ts`, boarding blink, alight grammar, Sky/fog perspective tuning pass, tunnel lamps + portal whistle. | `src/world/train/ride.ts` (new), `src/world/Sky.ts` tuning | C1, T3 |
| **C3** | `rails/path.ts` + elevated two-track mesh + pylons + clearance validator (decision 1 PR-2, amended for the pair). | `src/world/rails/*` (new) | T1 |
| **C4** | Coaster presence: anchors row, station, ambient NPC carts, World wiring, route re-validation. | `src/world/coaster/*` (new), `src/world/anchors.ts`, `src/world/World.ts` | C3 |
| **C5** | Coaster ride: first person, race vs rival on the twin rail, hazards, results (decision 1 PR-4 + two-track answer). Then decision 1's PR-5 (retire the Rail Racer stall). | `src/world/coaster/ride*.ts` | C1, C4 |
| **S1** | Spooky island: `spookyHouse` anchor, ghost-head prop (Wave 4.6), stall row re-pointed, booth prop retired. | `src/world/anchors.ts`, `src/world/spooky/*` (new), `src/minigames/stalls.ts` | T1, T3 |
| **S2** | Trackside statues & dancers (Wave 4.7): placed *parametrically at distances along the solved curve* (Statue Garden + approaches), never at absolute coordinates. | `src/world/train/trackside.ts` (new) | T1 |

**Must NOT be parallelised:**
- **T1 is alone in `route.ts`/`Scenery.ts` and lands first.** Every geometric
  fact in T3–T5, S1, S2 and the coaster re-validation hangs off the solved
  curve; done earlier, it is Wave-4 work built on a map that is about to
  change — the exact trap ORDER-OF-WORK.md's list names.
- **C1 → C2 → C5 is a strict chain.** The camera is built once, by
  extraction, with a parity gate; writing the train's camera fresh "to go
  faster" builds the thing twice, which is trap 6.
- **T5 waits for Wave 3.** One owner in `wanderDriver.ts`/activities at a
  time.
- `Game.ts` is touched by C1 only. `paths.ts` is touched by T2 then T3 —
  same agent or strict sequence.
- **T2 and decision 3's S2 both edit `building/surfaces.ts`** — land T2
  (tiny) before the castle split's rewrite, and S2 carries the patch list
  over.

**Thrown away if done in the wrong order:** any placement work before T1
(statues, ghost head, station aprons, queue paths from decision 2, scenery
near the track); any first-person camera code outside C1; dodgems-style
dressing along track stretches that T1 later moves; decision 2's PR-D if
attempted before T5 lands the platforms' graph nodes.

Decision 2's queue PRs slot in **after** T5 exactly as Wave 6 already says.

Small follow-ups this decision creates (anytime, non-blocking): the park map
UI (`ui/ParkMap.ts`) should draw the railway and its crossings from the
solved curve; the save system note — saving mid-ride records the boarding
station; `whatsnew.json` entries per shipped PR.

### 11. Questions for the family (parent-answerable, none blocking)

1. **Names.** The tunnel hills and the picnic island need names ("Welcome
   Hill" and "Fern Hill" are placeholders). Eleri names things — one at a
   time.
2. **A third stop?** Should the train one day also stop at a tiny "Ghost
   Halt" on the spooky island, or is walking the spooky bridge the whole
   point? *(Memo default: two stations; the bridge is the point.)*
3. **The whistle.** Should the train whistle every time it dives into a
   tunnel? *(Memo default: yes, quietly.)*

### Uncertainties, stated plainly

- **The dip flanks are the geometric risk.** The N and W corridors are wide
  enough on paper, but the castle and water-fight corners pinch the descent;
  the curvature assert will force the solver to shallow a dip rather than
  kink the rail. If N ends nearer r 33 than 29, nothing downstream breaks —
  crossings and stations self-locate — but the map picture above should be
  re-agreed with the family if any dip shallows by more than ~4 m.
- **Sky and fog at ground level in first person** is decision 1's flagged
  risk, harder here. Confidence it tunes out: high; confidence it is free:
  low. It is why C2 owns a named tuning pass and a per-ride fog override.
- **The ferris extraction** is a parity refactor of a thing the family has
  signed off. The parity gate makes it safe; skipping the gate to save a day
  is how "confirmed correct, do not disturb" gets disturbed.
- **The entrance esplanade audit** touches scripted arrivals
  (cat-bus, disembarking kids, the player's own spawn walk). It is a
  checklist item in T3, and the one place this replan touches a first-run
  experience — QA the new-player path explicitly.
- **The hump height** (~3.2 m walk surface) is chosen from the measured
  train height, not taste. If it reads too steep for small hands on a phone,
  flatten by lowering the funnel (the train's tallest point) before touching
  the 1:3.5 ramp rule.

---


## Decision 3 — Castle floors become separate spaces (Wave 2 item 2.2)

**Date:** 27 July 2026 · **Status:** decided, not yet implemented — gates all
of ORDER-OF-WORK Wave 5
**Sources read:** GAME_DESIGN.md items 30c, 31, 31e–31i, "Getting between
floors", "Riding the lift" (the 27 July family addendum on `main` at
`8f66095` — it changes the lift ruling below, see §4); ORDER-OF-WORK.md
Wave 5; ARCHITECTURE.md ("The big building"); ARCHITECTURE-REVIEW.md Review 1
S1/S5/S14 and Review 2 §4; and, in full: `src/world/building/layout.ts`,
`surfaces.ts`, `floorFade.ts`, `Building.ts`, `Shell.ts`, `Stairs.ts`,
`StairRide.ts`, `GlassLift.ts`, `Bubble.ts`, `Trampoline.ts`,
`Escalators.ts`, `ShaftGuards.ts`, `dressing.ts`, `interactZones.ts`, plus
`core/constants.ts` (building block), `entities/npc/poiGraph.ts`,
`NpcSystem.ts`, `ui/StairMenu.ts` consumers, and `ParkMap.ts`'s deck usage.

### The ruling, in one paragraph

**Yes: split. One floor = one space.** Each castle floor becomes its own
place at its own far-off origin, exactly the way the interior as a whole is
already a place 600 m from the park — the same trick, applied one level down,
which is precisely how GAME_DESIGN 31f phrases the request. We keep **one
scene, one renderer, one `CollisionWorld`, one `WalkSurfaces`** — the whole
reason the original interior offset cost almost no code — and we generalise
the one mechanism that already exists in three copies (`Building.checkDoorways`
door-in, door-out, and the ginormous-slide launch) into a small **portal**
system that every traversal device becomes a flavour of. This is not a new
architecture; it is the existing architecture applied consistently, and most
of its cost is paid in **deletions**: the floor fader, the deck-hole
invariant, the stair ride, the stair menu, the shaft guards and the
height-blind cross-floor collision hazards all cease to exist rather than
being migrated.

### 1. Why yes — and what saying no would actually cost

The honest cheaper alternative was examined: keep one continuous interior and
deliver Wave 5 inside it (scattered straight stairs as new deck holes,
dynamic perimeter-wall slicing hooked to the fader, trampoline as a ballistic
arc through a shaft). It fails on four hard points:

1. **5.8 is impossible in a continuous stack.** Novelty shopfronts need more
   ceiling height; `BUILDING_FLOOR_HEIGHT` is global — `deckY()`, the fader
   layers, the shell, the lift, the bubble and every escalator ramp all
   assume one uniform pitch. Variable per-floor heights in one stack is a
   rewrite the same size as the split, *keeping* all the old constraints.
2. **Scattered stairs multiply the two standing hazards.** Every connection
   in a continuous stack is a hole through a slab (the S5/S14 class of
   safety bug — two of the last three P0s), and every stair's side walls cut
   height-blind invisible walls across all five decks (the S1 class).
   Today's design survives these only because everything vertical is
   disciplined into one central band; 5.3's whole point is to break that
   discipline.
3. **31f explicitly asks for floors that need not line up** — any shape, any
   size. A continuous stack cannot ever grant that; the snake room (5.7)
   wants a *room*, not a region on a 60 × 44 plate.
4. **The perimeter castle wall (5.5/31i) is dynamic in a stack, static in a
   split.** "Sliced to the current floor and below" means fader-driven
   slicing machinery on new geometry if the floors are stacked. If each
   floor is its own space, the slice is *baked*: floor k's space simply
   contains the castle wall as it exists at that height, forever, no code.

What the split genuinely costs — stated honestly:

- **A blink between floors.** Every floor change is an iris (0.28 s close +
  0.42 s open). The family has already sanctioned exactly this: 31h asks for
  "walking onto the stairs transitions you", and the door + ginormous slide
  have used the iris since the interior split. Roof to ground by stairs is
  four blinks; the lift (§4) and the helter exist as multi-floor hops.
- **The doll's-house cutaway dies.** You will no longer see the floors below
  you through faded slabs. That look is the *mall* look the family is
  complaining about; 31i replaces it with castle wall below you. Sanctioned.
- **The trampoline's skill-bounce dies.** Replaced by tap-and-go — which is
  31g, verbatim, by family request.
- **Boot builds five spaces instead of one.** Only one is ever visible
  (`interiorRoot.visible` pattern per space); memory is the number to watch
  on a phone, not draw calls.

### 2. The shape: five spaces, one world

**Origins.** Floor k lives at `(600 + 300·k, 600)` — floor 0 keeps the
existing `(600, 600)` so the front-door transition numbers barely change.
Garden stays at the origin. 300 m spacing is comfortably beyond
`FOG_FAR` + the visible frame (fog completes ~168 m from the player) and far
beyond any tap-ray or play-bounds reach; the farthest origin (1800, 600)
keeps float32 positions exact to ~0.1 mm. New constants in
`core/constants.ts`: `FLOOR_SPACE_SPACING = 300`, `floorSpaceOriginX(k)`,
replacing the single `INTERIOR_ORIGIN_X` call sites. The radial
`inInteriorSpace` test becomes `floorSpaceAt(x, z): SpaceId | null` with a
per-space radius of 120 m.

**One collision world, one sampler, purely positional.** This is the
load-bearing choice, and it is the same one the original interior made: every
system that asks "where am I?" keeps working unchanged because coordinates
answer the question. The rejected variant — all floors sharing one origin
with visibility and collision swapped by a "current space" flag — was
examined and refused: it puts a mode flag through `CollisionWorld` and
`WalkSurfaces`, makes the sampler impure, and forecloses NPCs ever being in a
different space than the player. Height-blind collision becomes *harmless*
under the split, because no two floors share a plan — the entire S1 bug
class (counters walling off other decks) is dissolved by construction.

**`WalkSurfaces` after the split** (`surfaces.ts`, rewritten smaller):

- `sample(x, z, y)` keeps its exact signature and semantics — highest
  walkable surface within one step below the feet. Implementation: resolve
  the space from position; return that space's floor height, its local ramps
  (shop forecourt recesses, decorative steps, the porch), and any
  `MovingPlatform` covering the point. The five-deck top-down scan, all of
  `DECK_HOLES`, `deckIsSolid`, and the hole invariant are **deleted**.
- `deckAt(x, z, y)` becomes `spaceAt(x, z)` — no y needed, position alone
  answers. `ParkMap` (floor-by-floor drawing), `DayNight.setIndoors`
  (`playerInRoofedInterior` → current space is 0–3), and `InteriorLighting`
  key off it.
- `MovingPlatform` survives unchanged — the park train's carriages use it.
  Inside the castle it simply has no members any more.

**The floor fader is deleted** (`floorFade.ts`, and the material
claiming/cloning with it — materials can be shared freely again, which the
blown texture budget will thank us for). Per-space visibility replaces both
the cutaway and `Shops.setVisibleDeck`.

### 3. Portals — the one new concept

`src/world/building/spaces.ts` (new): a `SpaceManager` owning the current
space, per-space root groups and visibility, `setPlayBounds` per space, the
iris + teleport + `snapCamera` + cooldown dance (lifted verbatim from
`Building.changeSpace`), and per-frame trigger checks.
`src/world/building/portals.ts` (new): the portal table, as data, in the
house style of `layout.ts`:

```ts
interface PortalEnd {
  space: SpaceId;                  // 'garden' | 0 | 1 | 2 | 3 | 4
  trigger: Region;                 // walk-on region, space-local
  stand: { x: number; z: number }; // where a tap walks you to
  arrive: { x: number; z: number; yaw: number };
}
interface Portal {
  id: string;
  flavor: 'door' | 'stairs' | 'escalator' | 'trampoline' | 'bubble' | 'ride';
  a: PortalEnd;
  b: PortalEnd;
  oneWay?: boolean;                // trampolines, the rides
}
```

**Two gestures, one mechanism.** Keyboard: walking into `trigger` fires the
transition — nothing else. Touch: tapping the device is an ordinary
`InteractZone` whose `standX/Z` is the trigger — the tap walks you in and the
walk-on machinery does the rest. There is no third path, no menu
(`ui/StairMenu.ts` is deleted), no button.

**Anti-ping-pong, by construction plus cooldown.** Triggers sit at the *far
end* of each flight (top edge of the lower flight, bottom edge of the upper
flight); `arrive` points are placed just beyond the far side of the
destination's own trigger, facing away from it; `SPACE_COOLDOWN` (0.9 s)
stays as the backstop. A boot-time validator (route-solver house style, fail
loudly) asserts: the portal graph connects the garden to every floor; every
`arrive` samples to walkable ground; no `arrive` sits inside any trigger; no
two triggers on one floor overlap; and scattered connections honour a
minimum separation, so "scattered" cannot silently regress to "stacked".

**The theatre: pre-roll and post-roll.** Every flavour is the ginormous-slide
launch pattern — real motion in space A, iris, real motion in space B:

- **Stairs** (straight, per 31h): the lower space holds the bottom ~2 m of a
  straight flight rising toward an archway; the upper space holds the top
  ~2 m emerging from one. You walk up real steps, the iris blinks mid-flight,
  you walk off the top. Both halves are local `RampDefinition`s; the treads
  builder in `Stairs.ts` is rewritten for single straight flights (the
  switchback, `stairFlights`, `stairRoute`, `STAIR_STAND_*` all go).
- **Escalator**: identical, with `Escalators.ts`'s belt visuals and carry
  nudge on the half-ramps. Per 31h, any floor pair gets stairs *or* an
  escalator, never both.
- **Trampoline** (31g): tap → walk to pad → squash + `Player.launch` → iris
  at the apex → arrive falling onto a marked landing pad one floor up.
  One-way. No shaft, no combo timing, no hole.
- **Bubble**: the same upward pattern, floatier — see §4 for where it goes.
- **Ride** (helter-skelter, ginormous slide): board → iris → the chute
  carries you in the destination space. The ginormous slide *already works
  exactly like this* and keeps its code path; the helter's helix moves to
  the ground-floor space (§5 gives floor 0 the height for it) with its
  boarding trigger on floor 2.
- **Door**: the existing garden ↔ floor 0 pair, expressed as the first
  portal. `checkDoorways` is subsumed.

### 4. Device by device — including the new lift ruling

| Device | Fate |
| --- | --- |
| Tap stairs + `StairRide` + `StairMenu` | **Deleted.** Replaced by straight stair portals. The 3.5× time-scale walk, the whoosh, the route waypoints and the Climb/Descend menu all go. (`Game.ts` keeps `setTimeScale` — Decision 2's queue skip owns it now.) |
| Escalators | **Kept as a portal flavour.** Belt visuals and carry nudge survive on the half-ramps; the storey-spanning ramp and its well (`ESCALATOR_WELL`, S5's subject) go. |
| **Glass lift** | **Kept — and this ruling changed while the memo was being written.** The 27 July family addendum ("Riding the lift", on `main` at `8f66095`) specifies: call panel styled as a toy elevator panel, lift comes quickly, auto-board, panel lists floors, straight to floor N. Under the split the lift becomes the castle's one **any-floor portal** and the panel is its UI: press floor N → auto-board → doors close (the iris, diegetic) → doors open in floor N's lift alcove. The `GlassLift` car/shaft state machine, `callTo`, dwell timers, `MovingPlatform` duty and shaft collision are all deleted — "comes quickly, never make a child wait" is satisfied trivially because nothing real has to travel. Every floor space has its lift alcove at the same local spot (a lift that wanders would read as broken). The panel must be built against a two-method seam — `floors(): FloorInfo[]`, `go(n: number)` — as the family note itself demands; anyone building the "lift call panel" Anytime item **before** S2 lands must target that seam (backed by today's `GlassLift`) or the work is thrown away. The lift does not undermine 5.3's exploration: it is the sanctioned easy mode, the scattered stairs are the game. |
| Trampoline | **Tap-and-go portal** (31g). Pad + landing pad, no shaft. |
| Bubble | **Kept as the way onto the roof** (floor 3 ↔ roof): step in, it lifts, iris, it settles onto the roof and opens. The most magical hop gets the most magical device. Family question 1 confirms. |
| Helter-skelter | **Ride portal, floor 2 → ground floor**, helix standing in the Great Hall (§5). |
| Ginormous slide | **Unchanged.** Already a cross-space ride; its start simply lives in the roof space. Grown-up logic untouched. |
| Toilets | Move with floor 1, untouched otherwise. The queued privacy-roof item's note "match the cutaway fade" should be read as "fade the lid" — the cutaway itself will be gone. |
| Ball pit | Garden object; untouched. |
| Shaft guards | **Deleted wholesale** — there are no shafts. |

**NPCs:** verified — no NPC can reach the interior today (`poiGraph` has no
seeds near x = 600; its three `indoors` seeds sit inside the *facade's*
footprint in the garden, behind the lobby's back wall, and are dead — flag
for cleanup in S2). So the split migrates zero NPC behaviour, and *improves*
the future: an interior NPC on a split floor needs a flat single-storey
waypoint graph, not multi-deck sampling. Letting NPCs use portals is out of
scope and gated behind the `Activity` work (Wave 3).

> **Done ahead of S2 (28 July, `feat/indoor-nav`).** The three seeds are
> deleted and **S2 has nothing to clean up here**. Two were an isolated pair
> inside the facade's solid block; the third stood in the 1.8 m lobby. The
> `indoors` flag is replaced by a `space` derived from `world/spaces.ts`'s
> `spaceAt`, edges may not join two spaces, and the graph drops any waypoint
> stranded off the main path network. When S2 adds indoor waypoints they go in
> at each floor's own origin and are labelled correctly without anyone saying
> so. Two corrections to the paragraph above: NPC-indoors is no longer gated on
> the `Activity` work (that landed) but on **S1**, since crossing the threshold
> needs a portal; and the interior's *player* navigation was never missing —
> `NavGrid` follows the play bounds and has routed the interior all along.

### 5. Per-floor plans — where the castle finally gets to be a castle

`layout.ts` stops being one 800-line table for one stacked building. It keeps
the shared vocabulary (`Region`, `RampDefinition`, the facade/garden numbers)
and each floor gets a plan module: `src/world/building/floors/floor0.ts` …
`floor4.ts`, each declaring footprint (any shape — 31f), `clearHeight`,
perimeter-wall slice, shop units, rooms, portal ends, dressing seeds.
Starting values, tunable per floor forever after:

- **Floor 0 — the Great Hall**: today's 60 × 44 plate, `clearHeight` ≥ 8 m,
  which is what lets the helter's helix stand inside it as a visible tower
  and gives the ground-floor shops room to loom.
- **Floors 1–3**: 4.5–6 m clear — the headroom 5.8's giant ice-cream and
  giant balloon fronts are gated on. The **snake room** (5.7) is a room on
  floor 3, the top enclosed floor — the reward at the end of the exploration
  chain (family question 4).
- **Floor 4 — the roof**: open sky, parapet, pavilion, slide, grown-up — as
  today, but its space puts the plaza disc far below and castle wall beneath
  the parapet, so "we are very high up" finally reads.
- **Perimeter walls** (5.5/31i): each floor's space statically contains the
  castle-style wall for its own storey *plus the castle skirt falling away
  below it* toward its plaza disc — the "sliced to the current floor and
  below" view, baked, no slicing code. The style kit (stone, crenellation,
  arches, rose windows) is extracted from `Shell.ts`'s `buildCastle` into
  `src/world/building/castleParts.ts` and shared by the facade and every
  floor — same *style*, deliberately not the same *dimensions* (30c: the
  inside never has to agree with the outside's shape).

`ShopUnits`/`Shops` keep their contract; their collision registration maps
through the owning floor's origin instead of the single interior's, and
`scripts/checkShopSpacing.mjs` becomes per-floor (cross-floor overlap is no
longer a concept). `dressing.ts` runs per floor space unchanged in spirit.

### 6. Implementation plan — PR-sized, with hard sequencing

| PR | What | Owns (files) | Depends on |
| --- | --- | --- | --- |
| **S1** | Extract the mechanism, zero behaviour change: `SpaceManager` + `Portal` types; the door-in, door-out and giant-slide transitions become the first three portals. Game plays identically. | `spaces.ts`, `portals.ts` (new), `Building.ts`, `layout.ts` | — |
| **S2** | **The split** (Wave 5.1–5.4): five floor spaces built from today's plans (footprints initially identical, holes gone); scattered straight stair/escalator portals; tap-and-go trampolines; bubble→roof; helter as ride portal; lift portal + panel seam; `WalkSurfaces` rewrite; deletions (`floorFade.ts`, `StairRide.ts`, `ui/StairMenu.ts`, `ShaftGuards.ts`, `GlassLift.ts` internals, `DECK_HOLES`/`deckIsSolid`, switchback stairs); boot validator; `ParkMap`, `interactZones.ts`, `World.ts`, `Game.ts`, `constants.ts` updates. Playable, still mall-themed. | **all of `src/world/building/**`**, `ui/StairMenu.ts` (delete), `ui/ParkMap.ts`, `Game.ts`, `core/constants.ts` | S1 |
| **S3** | Castle style kit + the Great Hall (first slice of 5.5/5.6): `castleParts.ts` extracted from `Shell.ts`; floor 0 gets wall slice, stone re-theme, 8 m ceiling, helter tower. Establishes the pattern the other floors copy. | `castleParts.ts` (new), `floors/floor0.ts`, `parts.ts`, `Shell.ts` | S2 |
| **S4–S7** | Floors 1–4 fan out, one agent per floor, in parallel: re-theme + wall slice + ceiling height (5.5/5.6), novelty shopfronts on their floor (5.8), snake room on floor 3 (5.7), roof polish. | `floors/floor1..4.ts` each; shopfront work confined to the owning floor's file + `shops/fitouts.ts` assigned to exactly one of them | S3 |

**What must NOT be parallelised.** S1 and S2 are single-owner and nothing
else may touch `src/world/building/**` (or the named UI files) while they are
in flight — that includes the lift-panel Anytime item unless it is built
against the §4 seam. S3 blocks S4–S7 (shared kit). ORDER-OF-WORK's note
"5.5, 5.6 and 5.8 are the same building files — one agent, sequentially" is
**superseded from S4 onward**: after the split the unit of parallelism is a
*floor*, not a backlog item, because each floor owns disjoint files. That is
itself one of the split's payoffs.

**Thrown away if done in the wrong order** (each has already tempted
someone): any interior re-theme, perimeter wall or shopfront work before S2
(the rooms change shape and the fader's material-claiming fights new
materials — ORDER-OF-WORK trap 4); any polish on the StairMenu, the
switchback, the ballistic trampoline or the shaft guards (all deleted by S2);
lift-panel work wired into `GlassLift`'s internals rather than the seam;
`checkShopSpacing` extensions that assume cross-deck collision.

### 7. What changes, what stays

**Changes:** `Building.ts` shrinks to a coordinator (rides, shops, grown-up)
over a `SpaceManager`; `surfaces.ts` loses the deck scan; `layout.ts`
becomes shared vocabulary + per-floor plans; six files die outright;
`Player`'s position must carry a space id when Save/Continue lands
(versioned format from day one — note for that Anytime item).
**Stays untouched:** `Player`'s movement/ride API and `groundSampler`
contract; `CollisionWorld` (collider count grows ~5× interior walls — a few
hundred segments, within Review 2's "fine at current counts" but on its
watch list; the one-line mitigation is culling by play-bounds distance);
`SlideRide`; the iris (`Transitions`); the tap navigator; `MovingPlatform`
for the train; the facade in the garden; the ball pit; the mini-game host;
and **Decision 2's park replan (2.1) is fully independent** — the castle
interior is hundreds of metres from any park layout, and the facade is
scenery plus one portal end, so Waves 4 and 5 can run concurrently.

### 8. Questions for the family (parent-answerable; defaults are buildable)

1. "Should the **floating bubble** be the special way up to the roof — you
   float up out of the castle into the sky?" *(default: yes)*
2. "The **helter-skelter** would stand inside a great big hall on the ground
   floor, and you'd whoosh down into it from floor 2. Good?" *(default: yes)*
3. "Should the **lift** look like a castle turret inside, instead of a glass
   tube?" *(default: turret — the glass tube is the mall look; the new panel
   works either way)*
4. "Which floor should the **snake room** hide on?" *(default: floor 3, the
   top one before the roof — the prize for exploring all the way up)*

### Uncertainties, stated plainly

- **Blink cadence** is the one felt risk: 31h sanctions transition-per-floor,
  but four irises from roof to ground is a real sequence. The knobs already
  exist (`IRIS_*` constants; a shorter dip for intra-castle hops is a
  tuning change, not a design change), and the lift and rides are the
  multi-floor expresses. Playtest before tuning.
- **The half-flight theatre** (walk up real steps, blink, walk off the top)
  is theatre, and theatre can read as teleporting. If it does, lengthen the
  post-roll auto-walk a step or two — contained entirely in the stairs
  flavour.
- **Boot memory for five spaces** on the cheapest phone: high confidence
  (only one space visible, geometry is primitive-based), but it is a belief,
  not a measurement. S2 should glance at heap and boot time before merging.
- The scattered-connection positions are authored numbers, and authored
  numbers rot — that is exactly what the S2 boot validator exists for; do
  not ship S2 without it.

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

> **Addendum, 28 July 2026 — §2 has been implemented, and the paragraph
> immediately below is wrong.** Read this addendum before §2 or §6's PR-A.
>
> **What was stale.** The "one correction" below states flatly that there is no
> tree-climbing block. There is, and there was by the time the decision was
> read the second time (ARCHITECTURE-REVIEW review 2 §2 flagged exactly this: a
> confident false claim in a decision file wins arguments it should lose). By
> the time the extraction ran there were **four** blocks, not two: train trip,
> tree climb, face paint, and chat. The migration estimate below (~300 lines,
> two files) was for two blocks; it landed at ~640 lines moved into six.
>
> **What §2's proposed shape got right:** `update(context, intent) → boolean`,
> "true means I owned this frame", array order and nothing more, the wander
> core untouched, the module-level registries moving unchanged, and the
> insistence that the interface be descriptive rather than aspirational. All
> kept.
>
> **What four blocks forced on top of it**, none of which two blocks could have
> shown:
>
> - **`hold: 'steering' | 'intent' | 'child'`.** The blocks did not take the
>   same amount of the child, and the differences are visible in play. Chat
>   wants the core's social tail to keep blending its wave; the train writes
>   its own expression and wants the tail skipped; the climb pre-empts even
>   *noticing the player*, which also means it must not draw from the child's
>   seeded stream. One boolean return could not express that.
> - **`onArrive`** — review 2's refinement, and correct: the climb is decided
>   because you have just walked up to a tree.
> - **`busy`**, so "never poach a child already committed" is asked through the
>   host instead of by reaching into another block's private mode field.
> - **`Errand` with no optional fields** (`arriveRadius`, `timeout`,
>   `abandonRadius`, `unstick`), which is the load-bearing one. §2 called for
>   "an `offGraphErrand` walk that bakes the timeout in so it cannot be
>   forgotten again"; making all four *required* is what actually enforces it.
> - **`Rejoin`'s three named variants.** §2 nominated the train's version as
>   canonical. It is, but the other two are preserved verbatim as `'legacy'`
>   and `'inPlace'`, because unifying them is a behaviour change and PR-A was
>   not allowed one.
>
> **What PR-C should know:** a ride queue is a `'steering'` activity with an
> `Errand` to the gate and a `Backstop` on the ticket (§5's ~45 s guarantee is
> already a class). It should *not* need to touch `wanderDriver.ts` at all —
> only `NpcSystem`'s construction of it.
>
> Verification landed with it: `npm run check:crowd` hashes a seeded 25-minute
> trace of the whole crowd, and the hash is byte-identical before and after.

**One correction to the brief before anything else:** ~~the two additive blocks
in `wanderDriver.ts` are the **park-train trip** and the **face-paint visit**.
There is no tree-climbing block anywhere in the codebase (checked both
checkouts).~~ *(Struck 28 July 2026 — false; see the addendum above. There were
four blocks by the time this was acted on.)* The argument below survives the
correction — the blocks exist, queueing would be the next one — but the memo
should not cite code that isn't there.

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
| **PR-A** | ~~`wanderDriver` → activities~~ **LANDED 28 July 2026** as ORDER-OF-WORK Wave 3: all **four** blocks (train trip, tree climb, face paint, chat), plus `Errand`/`Backstop`/`BudgetSlot`. See the addendum at the top of this decision for the shape as built. | `src/entities/npc/wanderDriver.ts`, `src/entities/npc/activities/*` (new) | — |
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

---

## Decision 5 — The park is generated, not authored (28 July 2026)

**Date:** 28 July 2026, 02:40 · **Status:** decided by the family, in
implementation tonight · **Supersedes:** Decision 4 §2's "the attractions do
not move". The railway rulings of Decision 4 (build up never dig; the solver
keeps solving; crossings computed at boot; exclusion generated; one
`RideCamera` by extraction) all stand — this decision moves the layer *under*
them from authored to generated.

### The family's ruling

1. **As much of the park as possible is procedurally generated, so the layout
   is not fixed in code.** Invariants — such as "paths lead to every
   attraction" — are stated explicitly and *satisfied by construction, then
   verified by machine*.
2. **One canonical park**: a single `PARK_SEED` committed in code. Everyone
   gets the same park; a replan is a deliberate seed bump we choose, not a
   per-save roll. Saves carry a `layoutVersion`; on mismatch a park-space
   position degrades to the plaza spawn by the save system's existing
   unknown-place path. (Interior positions are space-relative and survive.)
3. **Everything moves except the entrance.** The castle and the fountain are
   placed by the solver like everything else. The entrance stays pinned as
   the one fixed thing a returning child can rely on.

### The input is a manifest, not just a seed (family, 02:55)

*"In future we should be able to change the locations of things and add new
attractions at will and this regenerates the rails etc to another working
configuration."* So the generator's input is a **declarative park manifest**:
a list of attractions, each optionally **pinned** to a position, plus
`PARK_SEED` for everything left free. Adding an attraction is adding a line;
moving one is pinning it somewhere else; the solver re-grows rails, paths and
dressing around the change and `check:park` proves the result is a working
park. The manifest is the API the family will eventually edit — design every
layer so nothing but the manifest and the seed feed it.

### The layers, each consuming the previous, all from `PARK_SEED`

- **L1 anchors** — a seeded constraint solver places castle, fountain, rides,
  shops, stalls, spooky house: minimum separations, band preferences,
  keep-outs, entrance esplanade kept clear.
- **L2 rails, both systems** — the family, 02:45: *"The train and rail race
  need to be procedurally placed tracks grown organically in the code. Paths
  need to react to them with bridges over as appropriate."* So the train
  loop AND the coaster/rail-racer track are both **grown** by the solver
  against the generated anchors — the train at grade hugging and diving as
  Decision 4 rules, the coaster elevated in its band — with neither route
  authored. Paths (L3) are generated *after* the rails and react to them:
  a bridge where a path crosses rail, a tunnel hill where rail passes under
  a path. Rails first, paths second — the family's wording makes the
  dependency direction explicit.
- **L3 paths** — generated to connect entrance → every attraction → both
  stations; a bridge is emitted where a path must cross the solved rail, a
  tunnel hill where the rail passes under a path (Decision 4's constructs,
  placed by data).
- **L4 dressing** — scatter, lamps, garlands already derive from their
  surroundings and inherit the new layout free.
- **L5 validation** — `check:park`, in `npm run build`.

### The invariants (machine-checked, not claimed)

1. Every attraction's stand point routes from the entrance on the real nav
   lattice.
2. No generated route crosses the railway except over a bridge deck.
3. `poiGraph` is a single connected component containing every POI.
4. Rail exclusion is continuous; no walkable cell lies on track.
5. The existing hop-ceiling and sub-step boot asserts still pass.
6. Every anchor's own keep-outs are respected (no bench in a stairwell —
   the dressing rules generalised).

*The checker is built first and proved against the current hand-authored
park; every generator step then lands under its protection. Four of
tonight's bugs were claims nobody re-derived — a generated park without a
machine-checked contract would be that disease at park scale.*

### Execution shape (chosen for the observed failure mode)

Subagents die every few minutes tonight; the main session does not. So the
**main agent owns the serial core** (L1 solver, L2 profile derivation, the
consumer rewiring) in its own worktree with a commit at every coherent step,
and subagents take only bankable, independently-restartable pieces (the
checker, dressing adapters). The first-person train and shared `RideCamera`
(Decision 4 C-steps) are *not* in tonight's scope — they build on the
replanned park and want a fresh session.
