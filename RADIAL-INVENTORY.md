# Everything is radial — the second sweep

Jim, 14 September 2026:

> *"yes everything should be radial — it is now a radial world. Absolutely
> everything from the angle of the camera, which way jumping goes 'up' —
> everything. No exceptions whatsoever of any kind. 'down' simply should not
> exist as a concept unrelated to the spherical geometry — ever."*

**This file extends `ALTITUDE-INVENTORY.md`; it does not replace it.** That file
swept `src/` and is still the right list for the game code. This one:

1. carries the **exemptions being struck** (collision, navigation, gravity are
   no longer "invisible at this scale" — that carve-out is dead);
2. sweeps the ground that file never looked at — **`scripts/` and `test/`**, the
   checks and invariants themselves;
3. adds the `src/` sites the first sweep missed.

Read both. Where a row appears in `ALTITUDE-INVENTORY.md` it is referenced, not
repeated.

## The headline

- **~50** open sites in `ALTITUDE-INVENTORY.md` (`src/` geometry, physics,
  cameras) — unchanged, still open, plus its three carve-outs now struck (§1).
- **+15** in `src/` world UI, effects and lighting the first sweep never looked
  at (§3), including the two most-seen pieces of world UI in the game.
- **+32** in the **checks and invariants themselves** (§2) — the half of the
  repo nobody had swept. 193 files in `scripts/` and `test/`; **three** of them
  mention a sphere helper, against 129 sites in `src/`. Twelve of the 32 are in
  `pnpm run check`; ten are in the merge-blocking `test:procgen` suite.
- **≈ 95 open sites** in total, across ~70 files.

**The worst three by what a child actually sees:**

1. **The tap-to-move marker lies at 45° to the grass** (`tapMarker.ts:57,61`).
   She taps the outer park and the pink ring is half buried in the hillside,
   half floating, sliced by the grass. Every tap beyond ~20 m.
2. **The hop rainbow and the tap-confirmation burst, the same fault**
   (`rainbowRing.ts:140`). Fires on every landing and on every successful tap —
   and its own comment says that burst is *"the only 'yes, that one' a child
   gets"* on a phone.
3. **Tap-to-move stops pathing outward at all** (`NavGrid` `MAX_STEP = 0.62`
   against a 0.72 m outward diagonal). Not a lean she can see — a control that
   silently refuses, in the part of the park where there is nothing to blame.

**And the worst three she cannot see, all in the checks:**
`check-hotel.mts`'s fall detector fires on every outdoor NPC beyond 28.7 m, so
it can no longer find a real fall (§2.1); `check-tap-spacing.mts` silently skips
crowded stall clusters in the outer park as "different storeys" and its coverage
counters fall with nothing going red (§2.4 #2); and `check-swept-bus.mts` sweeps
a bus the game stopped posing that way months ago, so its committed baseline is
fiction (§2.4 #3). All of it on a branch where **the park does not build at
all** (§0).

## The numbers, measured on this branch

Not quoted from a comment — read out of `src/world/terrain.ts` itself
(`scratch-seeker/t.mts`, `GROUND_SPHERE_RADIUS = 220`):

| d from origin | ground `y` | lean | `cos θ` | radial gradient (m/m) |
|---|---|---|---|---|
| 0 m | +0.09 | 0.0° | 1.000 | 0.00 |
| 40 m | −3.31 | 10.5° | 0.983 | 0.18 |
| 57 m | −7.64 | 15.0° | 0.966 | 0.27 |
| 80 m | −15.43 | 21.3° | 0.932 | 0.39 |
| 100 m | −24.42 | 27.0° | 0.891 | 0.51 |
| 120 m | −35.72 | 33.1° | 0.838 | 0.65 |
| 140 m | −50.02 | 39.5° | 0.771 | 0.82 |
| **157 m** | **−65.68** | **45.5°** | **0.701** | **1.02** |
| 180 m | −93.56 | 54.9° | 0.575 | 1.42 |

Two consequences, and the second is the one that keeps biting:

- **The lean.** A distance differenced along `+Y` over-reads the true
  perpendicular distance by `1 / cos θ` — **1.43×** at the rim.
- **The cap.** `y` is dominated by *where you are*, not *how high you are*. The
  radial gradient at 157 m is **1.02 m of `y` per metre travelled outward**. So
  any `y` difference taken between **two different columns** is mostly planet.
  Every "High" row below is that fault.

## Status, ownership, and two corrections — the lead's page

**This file is owned by the lead engineer on the radial conversion, on branch
`eng/radial-visible`.** That copy is the live one; the copy on
`seek/radial-inventory` is the seeker's original and is now frozen history.

**Do not edit it on your own branch.** Five engineers are converting at once,
and a 500-line document edited on five branches conflicts on every merge and
loses rows in the resolution — which is precisely the failure this document
exists to prevent. **Send your closed rows to the lead and they go in here
once.** Adjudications of who owns a file that two areas both touch come the
same way.

### The fan-out, 14 September 2026

| area | scope | branch |
|---|---|---|
| **lead** | §3.1's tap marker and rainbow ring, `NavGrid`'s step, this file, the shared helpers in `world/up.ts` and `world/terrain.ts` | `eng/radial-visible` |
| **A** | §2 — the checks and invariants, including the four check-and-code pairs of §2.5 | own branch |
| **B** | §3 — world UI, effects and lighting, minus the two rows the lead took | own branch |
| **C** | rides — `coaster/route.ts`, `slide/solve.ts`, the four ride-camera mounts | own branch |
| **D** | §1 — `CollisionWorld`, gravity and jumping across Player/NPC/pet | own branch |

**The helpers grow once, by the lead.** If `upAt`, `altitudeAt`,
`liftFromGround`, `eyeForFocus`, `faceOnGround` or `placeOnSphere` need a new
variant, ask rather than adding one. Four engineers each adding their own is
exactly how this codebase acquired two definitions of everything, which is the
fault CLAUDE.md names as its most common by a distance.

**Two standing warnings, both of which have already cost a day here.** A
per-frame tilt must never be a pre-multiply — `rotation.y = yaw` rebuilds the
quaternion from all three Euler components, so a tilt gets re-inherited and
compounds; `world/up.ts`'s `faceOnGround` is the fixed form, and the player was
measurably tumbling while a screenshot showed her upright. And **measure after
you look, never instead**: that screenshot is why.

### Closed

| row | what was done |
|---|---|
| §3.1 `tapMarker.ts:57,61` | `TapMarker.placeAt` owns position-and-lean, through `upFor`, **assigned** rather than pre-multiplied because `moveTo` runs every frame |
| §3.1 `rainbowRing.ts:140` | the lean moved into the pool's own copy of the geometry, freeing each mesh's quaternion for the ground it was fired on; `RISE` and `GROUND_CLEARANCE` run along that up. `rainbowRingGeometry` itself is untouched — `Highlights.ts` shares it |
| §3.1 `rainbowRing.ts:290,317` | the star burst's plane and arc lean with the ground at the burst point |
| §1 `NavGrid` `MAX_STEP` | `nodeAltitude` beside `nodeHeight`; every step, level, gap and tie-break comparison moved onto it. `nodeNearestAltitude` is the primitive; `lineCost` carries an altitude between cells instead of a `y` measured in the previous column. **See correction 2** |

### Correction 1 — §0 is not "not a radial finding", and it does not pre-date the sphere work

The seeker wrote that the `railD 0.0` throw *"pre-dates all the sphere work —
it reproduces at `db1363ce`"*. **`db1363ce` is itself a sphere commit**, on this
branch and on no other; it is not a pre-sphere datum. Bisected properly:

- `origin/main` — **green**, `0 rail crossing(s)`.
- `dd5b3b6b`, the merge base of `main` and `feat/sphere-combined` — **green**.
- first bad commit: **`502ec802`**, *"Merge feat/bus-arrival-camera (3187a75e)
  onto the TRUE road tip"*.

It is a **merge**, and **both its parents are green on their own**
(`22528852` and `3187a75e` were each tested clean). So this is an emergent
interaction, not a bad hunk: relative to the road-tip parent the merge changes
nothing at all under `src/world/train/` or `src/world/paths*`, and everything it
does change is the gate arch and the arrival camera — `Entrance.ts`,
`gateArch.ts`, `ArrivalSequence.ts`. New colliders at the gate move the path
router's answer, and the leg it now draws crosses the railway at `(0.0, 125.8)`
where no bridge site was proven.

That is CLAUDE.md's *"procgen backtracks on collision, always"* rule, unmet: the
router drew a leg it could not bridge instead of making a different decision.
**It is not a radial bug and nobody in this fan-out should treat it as their
row** — but every one of them will hit it, because it kills `new World` and
therefore every check routed through `park-harness.mts`.

`check:fountain-hop` is **also** red on this branch before any of this work
(seeds 20260728, 24, 131, 326; the route ends 24 mm under the water on 326).
Baselined against `origin/feat/sphere-combined` and identical, so it is not
anybody's regression either.

### Correction 2 — the headline "tap-to-move stops pathing outward" was wrong

Ranked third of the three things Eleri meets today. Measured on the built
terrain over 32 bearings, and printed by `scripts/check-outward-routing.mts` on
every run:

| radius | worst neighbour step in world `y` | share of `MAX_STEP` | neighbours over the line |
|---|---|---|---|
| 40 m | 0.147 m | 24% | 0/256 |
| 80 m | 0.289 m | 47% | 0/256 |
| 120 m | 0.472 m | 76% | 0/256 |
| **135.4 m** (garden edge) | **0.562 m** | **91%** | **0/256** |
| 145 m | 0.624 m | 101% | 1/256 |
| 157 m (the Rail Race rings) | 0.733 m | 118% | 40/256 |

The step first breaks `MAX_STEP` at **145 m**, ten metres outside anywhere a
child can stand. And past even that only the **diagonals** fail — a straight
outward cell is 0.5 m in plan and still clears at the rim — so A\* walks a
staircase of straights and finds the route anyway. **16 of 16 outward routes
succeeded on the unfixed router**, with both controls behaving.

The inventory's derivation was arithmetically right and its conclusion was not:
it took the gradient at 157 m, which is the radius of the park's *furniture*,
and applied it to a control a child uses inside a 135.4 m garden.

It is fixed regardless — a test spending 91% of its budget on the planet is one
retune away from giving wrong answers, and the rings genuinely stand at 157 m —
but it was never a control that refused, and it should not have been ranked
against two faults that are wrong on every single tap.

**The general lesson for everybody in this fan-out, and it is the reason this
correction is written out at length rather than struck quietly:** every "High"
row in this document is a derivation from a gradient table, not a measurement of
the game. Several will be real. Some will be this. **Measure your row before you
rank it, and write down the number either way** — including when it says the row
was smaller than advertised, because a fix landing with a claim nobody checked
is how the next sweep inherits a false belief.

## 0. The branch is red before any of this

**`feat/sphere-combined` cannot build the canonical-seed park headlessly.**
Measured here, on `31d0fb2a`, with `pnpm install --frozen-lockfile` done:

```
$ pnpm run check:park    → exit 1
$ pnpm run check:hotel   → exit 1
Error: rail crossings: the drawn paths cross the railway at railD 0.0
  (0.0, 125.8), which snaps to no proven bridge site. Every crossing must be
  a bridge (Jim, 2 Sep 2026); find the router that drew this leg.
  at computeCrossings (src/world/train/crossings.ts:440)
  at footprints (src/world/train/bridgeKeepout.ts:46)
  at buildFoliage (src/world/Scenery.ts:770)
  at new World (src/world/World.ts:124)
  at scripts/park-harness.mts:147
```

Every check that goes through `park-harness.mts` dies in `new World`, so **the
whole park-shaped half of the check chain is currently asserting nothing.**
`check:benches` exits 0 because it never builds a park. This is not a radial
finding; it is a red check on the branch, and CLAUDE.md's zero-tolerance rule
makes it the first thing to fix. It also means **nothing below could be
measured on a built park** — the rows marked *(read, not measured)* are read
from source, and must be re-measured once the park builds again.

---

## 1. The exemptions being struck

`HANDOFF-radial-up.md` deferred collision, navigation and the player's gravity
on the grounds that the change would be **invisible** — *"a 1.28 m hop on a 13°
tilt drifts by centimetres"*. `ALTITUDE-INVENTORY.md` already struck that
justification at 44°. Jim's ruling above strikes the **decision** as well. For
the avoidance of doubt, these are now open work, not accepted limitations:

| subsystem | file | what it assumes | measured cost at the rim |
|---|---|---|---|
| gravity / jumping | `src/entities/Player.ts:1126-1181` | `verticalVelocity` along `+Y`; land when `position.y <= groundY` | a 1.28 m hop delivers `1.28·cos 45.5 = 0.90 m` of real height and slides her **0.91 m** sideways across the slope |
| NPC gravity | `src/entities/npc/NpcCharacter.ts:659-681,778` | the same block | every NPC in the outer park |
| fall detection | `src/entities/Player.ts:1096,1150,1170` | `position.y − groundY > 0.5` | the 0.5 m margin is spent by **0.5 m of lateral travel** at the rim (gradient 1.02) |
| collision | `src/world/Collision.ts` | **no Y in the geometry at all** — circles and rectangles in `x,z` | a collider is a prism along world `+Y` through a ground that leans 45°; its footprint on the real surface is stretched by `1/cos θ` in the radial direction and correct tangentially |
| navigation | `src/world/NavGrid.ts:224,827,1078,1396` | `MAX_STEP = 0.62` against a 0.5 m lattice | straight cell = 0.51 m, **outward diagonal = 0.72 m > 0.62** → outward diagonals are impassable in the outer park; tap-to-move degrades where the child can see nothing wrong |

`NavGrid`'s is the one a child meets first: it is not a subtle lean, it is
**tap-to-move refusing to path outward**, and it is already beaten today.

---

## 2. Checks and invariants that have stopped checking

This is the section `ALTITUDE-INVENTORY.md` does not have. A check asserting
against flat geometry is as wrong as the code, and it is worse, because it is
green.

**The chain, as a datum for the next rebase** (CLAUDE.md asks for the step
*set*, not its size, but the size is the cheap first tripwire): on `31d0fb2a`
`pnpm run check` is **65 steps**, from **81** `check:*` scripts defined.
Read by parsing the `scripts` object, never by grep.

**Coverage of the sweep.** 170 `scripts/*.mts` and 23 `test/**/*.ts`. Of those,
**only three** mention any sphere helper at all (`check-arrival-camera.mts`,
`measure-ground-gradient.mts`, `test/procgen/invariants.ts`) — against **129**
sites in `src/`. That ratio is the finding in one line.

### 2.1 `scripts/check-hotel.mts` — the fall detector fires on grass

| | |
|---|---|
| **line** | `scripts/check-hotel.mts:130`, used at `:155-161` |
| **expression** | `const FLOOR_OF_THE_WORLD = -2;` … `if (character.position.y < FLOOR_OF_THE_WORLD)` |
| **assumes** | the ground is near `y = 0` everywhere, so `y < −2` means a fall |
| **out/in** | the clause sweeps `npcs.all`, which is **outdoor** park NPCs as well as hotel residents |
| **measured** | `terrainHeight` first drops below `−2` at **d = 28.7 m** from the park origin (marched along four bearings, so the terrain waves are in it; the bare spherical cap crosses `−2` at 29.6 m — the two agree, and the difference is the waves). The walkable garden reaches 135.4 m (`−46 m`) and the park's furniture 157 m (`−65.7 m`). |
| **what breaks** | every NPC standing happily on grass more than 28.7 m out is reported as "falling through the world". The clause's own doc comment — *"Deep enough that no floor in the game is near it"* — is now false by 63 m. |
| **severity** | **High.** It cannot detect a real fall any more: a genuine fall is drowned in ~every outdoor NPC. Its own docblock cites family QA finding all seven hotel residents falling — that capability is gone. |

The fix shape is `altitudeAt(x, y, z) < −2`, not a world `y`.

### 2.2 `test/procgen/invariants.ts` — a `y` difference between two columns

These are the invariants that gate merges. Every row differences `y` between
**two different `x,z`**, so the radial gradient (up to 1.02 m/m) is inside the
measurement.

| invariant | line | expression | what the planet contributes | severity |
|---|---|---|---|---|
| `railRaceFliesClear` | `:2618` | `air = rail.y − under.y`, `rail` on the rail-race ring, `under` the nearest point on the **train** route (a different column, gated only to within `2·TRACK_CLEARANCE ≈ 2.6 m` in plan) | at the ring's radius (58-110 m per `ALTITUDE-INVENTORY.md` — the rings follow the boundary, and this was **not** re-measured here because the park does not build) the gradient is 0.27-0.57 m/m, so up to **±1.5 m** of the `RAIL_OVER_RAIL = 5.5 m` budget is planet — and the sign depends on which of the two is further out | **High** |
| `theSlideClearsTheCruiser` | `:5070` | `vertical = Math.abs(near.y − point[1])`, chute point vs the cruiser's `nearestPoint` at a different column, gated to `CHUTE_HALF_WIDTH + CART_HALF_WIDTH` in plan | same shape; and a *vertical* gap is standing in for the true 3D separation, which is the quantity that decides whether a rider hits a cart | **High** |
| the trestle fork clause | `:8569` | `lowestRailY = min(probe.y)` over **720 samples × every lane of the whole ring**, then `beamY = lowestRailY − BEAM_DROP` | the minimum `y` of a 58-110 m ring is simply **wherever the ring is furthest from the origin** — it is the cap, not the rails' undulation. The game solves this per-trestle and cap-relative (`track.ts:1301`, `route.baseAt`), so the check's `plan` is solved against a different, global, flat plane | **High** — and it feeds an *equality* assertion |
| the same clause's `angleOf` | `:8645` | `Math.atan2(Math.hypot(span.x, span.z), span.y)` — the strut angle **from world vertical** | the trestle is stood on the sphere, so its local vertical is 15-30° off world `+Y` there. The assertion pins Jim's settled 30.0° / 41.6° against the wrong datum | **High** |
| `nothingHangsIntoTheTunnel` | `:5400-5445` | `const up = new Vector3(0,1,0)`; ray fired from the track bed straight up world `+Y`; `air = hit.point.y − ground` | the ray is 15-30° off the tunnel's own axis, so over a 4 m bore it walks **1-2 m sideways** — it can exit through the spandrel or miss the arch. The "no bridge masonry at all overhead" complaint can fire on a correct bridge, and `air` over-reads by `1/cos θ` | **High** |
| the train-clearance raycast | `:6357-6451` | `const up = new Vector3(0,1,0)`; `clearance = first.point.y − routePoint.y` | identical fault, and this is the clause that decides whether the train drives through its own bridge | **High** |
| the deck-soffit clauses | `:5323`, `:6612` | `new Box3().setFromObject(deckMesh).min.y` | an **axis-aligned** box round a deck that leans 15-30°: `min.y` is the lowest *corner* of the tilted slab, not the soffit over the track. Inflated by roughly `halfDiagonal · sin θ`. Then `clearance = soffit − groundY` differences two columns again | **Medium-High** |
| `theChuteClearsTheCastle` | `:4351` | `underside = crossing.y − CHUTE_HALF_WIDTH` vs `facts.castleMasonryTopY` | `castleMasonryTopY` is a `max` of world `y` over the castle's exterior stonework — on a leaning building that max is the corner **nearest the origin**, not the tallest point. CLAUDE.md already records this fact jumping 10.29 → 14.83 m once | **Medium-High** |
| `everyPostIsSolidAllTheWayUpAChild` | `:3021,3030` | `rise = |axis.y| · length`; `reachable = (TALLEST_CHILD_HEIGHT / rise) · length` | the child's height is measured along **world** `+Y` while she stands on ground leaning 15-30°, so the sweep runs `1/cos θ` = 1.04-1.15× **past** her head. Over-conservative rather than blind — noise, not a hole — but the reported "`N` m up" is wrong by the same factor | **Medium** (noise) |
| `tapTargetsKeepTheirDistance` | `:9319,9335` | `sameStorey(one.y, two.y)` → `src/world/tapSpacing.ts:217`, `abs(aY − bY) <= ZONE_HEIGHT_TOLERANCE` | **checked and largely benign:** the rule only complains when the pair is within `TAP_FINGER_METRES` in plan, and a pair that close in `x,z` is at the same radius, so `sameStorey` still passes for exactly the pairs that matter. Listed here so a later sweep does not re-file it | **Low** |

**Two structural notes on `invariants.ts`:**

- Its **only** sphere awareness is `theGroundIsTheSphereItSaysItIs` /
  the bus-gradient clause at `:9529-9690`, which checks the *terrain* is the
  sphere it claims. Nothing else in 9 700 lines asks the sphere anything.
- `Box3` is used 10 times in `test/`. Every one of them is an **axis-aligned**
  box round geometry that may be leaning. That is a category, not a row.

### 2.3 `test/procgen/parkFacts.ts` — the facts themselves are flat

The invariants can only be as radial as the facts they read.

| line | expression | what it assumes | severity |
|---|---|---|---|
| `:1720` | `const hump = top − terrainHeight(ox, oz);` and `expected: hump > PARAPET_GONE_HUMP` | a parapet's height is a `y` difference in its own column — over-reads by `1/cos θ` (4-15% at railway radii). It **gates whether a parapet is required to exist at all**, so a ring near the threshold can be excused or demanded wrongly | **Medium** |
| `:1774` | `right.crossVectors(tangent, new Vector3(0, 1, 0))` — building the chute's local frame for the "can this camera see the rider" rays | the comment says *"the chute's own frame, so 'above the trough floor' leans with the chute"*, and it does lean with the chute's **tangent** but is anchored to **world** up. On a chute that is itself stood on the sphere, the derived `up` is wrong by the local lean, so `rider` is placed off the trough floor laterally | **Medium** |
| `:1790` | `groundY: terrainHeight(eye.x, eye.z)` published as a fact, consumed as `eye.y − groundY` | a column difference again — the same fault class that put the arrival camera in the earth | **Medium** |

### 2.4 The rest of `scripts/` — 39 files triaged, 18 hits

**Two reference radii, both wanted below.** `GARDEN_PLAY_RADIUS =
58·√(1200/220) = 135.4 m` — the outdoor park a child can walk, 38° of lean,
ground `y = −46 m`. The park's *furniture* reaches 157 m (the Rail Race rings
circle outside the play boundary), 45.5° and −65.7 m. The entrance/bus spot
(`ENTRANCE_PLAYER_X/Z`) is **51.6 m** out: ground `y = −6.1 m`, lean 13.6°.

Chain membership, because it decides what a hit costs: `check:hotel`,
`check:tap-spacing`, `check:rail-race`, `check:park`, `check:pet-slide`,
`check:tie-frame`, `check:cart-shape`, `check:climb-wave`,
`check:statue-occlusion`, `check:speech-bubbles`, `check:hop-clearance` and
`check:deck-fallthrough` are **in** `pnpm run check`. `check:npc-perch`,
`check:entrance-road`, `check:swept-bus`, `check:wall-tunnelling` and the
probes are not.

| # | file:line | expression | what it now gets wrong | sev |
|---|---|---|---|---|
| 1 | `check-hotel.mts:130,157` | `FLOOR_OF_THE_WORLD = -2`; `if (character.position.y < FLOOR_OF_THE_WORLD)` | §2.1. Fires on every park NPC past ~29 m; at the garden edge the message reads *"is at y=−46.31 m … falling through the world"*. A required chain step turned into a false red over most of the park, with the real signal drowned | **High** |
| 2 | `check-tap-spacing.mts:121,141` | `if (!sameStorey(zone.y, band.y)) continue;` — `sameStorey` = `abs(aY−bY) <= 2.2` | **worse than the same call inside `invariants.ts` (§2.2), and the opposite failure.** Here the loop is over *zones and door bands* that need not be close in plan: at 100 m out a 3 m radial step moves `y` by 1.5 m, and near the garden edge 2.9 m of separation exceeds the tolerance outright. Crowded stall clusters far from the origin are silently `continue`d as "different storeys" and **never measured**. `bandsChecked`/`pairsChecked` fall and nothing goes red | **High** |
| 3 | `check-swept-bus.mts:491,524,536` | `localY = sample.y − busGroundY − lift`, `busGroundY = terrainHeight(station.x, station.z)`, yaw-only frame from `pose.facing` | **the game moved and the check did not.** `ArrivalSequence.placeBus:1915-1934` now calls `faceOnGround`, explicitly because *"the road runs out to 117 m … a chassis held level to world +Y digs its downhill wheel roughly half a metre in"*. `check-swept-bus.mts:451`'s comment still quotes the retired three-line pose as ground truth. The swept body is a bus nobody renders, mis-oriented by the full road lean, and the trestles it is tested against lean the other way — so the post count **and its committed baseline** over- and under-count at once | **High** |
| 4 | `check-rail-race.mts:251,275,291,298,204` | `worstGround = min(point.y − ground)` → `require(> 4)`; `lowestOverGate = min(point.y − terrainHeight(…))` → `require(> 6)`; `above = height − terrainHeight(point.x, point.z)` | the 4 m "a child walks under this" rule actually passes at ~3.4-3.6 m of real clearance. Line 204 is worse than a cosine: `height` is `route.heightAt` (the **flat-frame** y, `railRace/route.ts:510`) while `point` came from `route.pointAt`, which leans it **~3.7 m outwards** (`route.ts:526-529`) — two different columns, ~1.9 m apart. The lane-fairness clauses (`climbSpread < 0.02`) now include the sphere's own fall through `baseAt`'s `capHeight`, not just the ride's hills | **Medium-High** |
| 5 | `check-npc-perch.mts:191-192,224,233,294,341` | `top = max(part.position.y + part.scale.y)`; `clearance = headY − band.top` | a leaning canopy's *vertical* extent is not its height along the trunk. Both errors push `fraction` down, so far-out trees drift towards a false "buried in the foliage" red while a genuinely floating head nearer the boundary reads acceptable | Medium |
| 6 | `check-climb-wave.mts:162-166,309-313` | the climber posed at `tree.canopyTopY − KID_HEAD_HEIGHT + lift + WAVE_RISE·wave`, `rotation.y` only | she is displaced sideways from her own trunk by `lift·sin θ` and stands at an angle to the branch. **The game's `TreeClimbing.climbPose:657` is flat too, so the check mirrors the bug and cannot see it** | Medium |
| 7 | `check-entrance-road.mts:314,567` | `up = footY + axis.y·along − terrainHeight(x, z)`; `if (up < CAT_BUS_BODY_BOTTOM_Y ‖ up > CAT_BUS_BODY_TOP_Y) continue;` and `if (face.y < 0) downFacingTriangles += 1` | a sample genuinely inside the bus body reads outside the band and is `continue`d — the exact under-count `check:swept-bus` exists to expose, one axis further. `face.y < 0` tests road facing against world `+Y`, which a correctly leaning road no longer aligns with | Medium |
| 8 | `check-park.mts:476-477` | `deck = park.sample(hit.x, hit.z, TOP_REFERENCE)`; `overBridge = deck − hit.rail >= BRIDGE_RISE` | both terms are world `y` in one column, so the rise over-reads by `1/cos θ`: at the boundary a deck clearing only `BRIDGE_RISE·cos 38°` in reality **passes**. The clause's own doc still asserts *"measured from the terrain under the track"*, which on the sphere is a radius, not a `y` | Medium |
| 9 | `check-pet-slide.mts:1080-1081` | `aboveGround = cameraWorld.y − terrainHeight(cameraWorld.x, cameraWorld.z)`; `if (aboveGround < 0) undergroundFrames += 1` | the decisive clause for #516. A lens genuinely buried tens of centimetres in leaning grass reports positive clearance, `undergroundFrames` stays 0, and the ray fan that *names* the offending mesh is never gated on — the run prints "ASSERTS NOTHING" | Medium |
| 10 | `check-tie-frame.mts:109` | `expected.y -= 0.12; // the tie's own deliberate drop below rail height` | `railFrameAt` is already sphere-aware (`sweptRail.ts:140`) and hands this file a real `frame.up` **which it then ignores**. It reproduces `Coaster.ts:436`'s `setY(mid.y − 0.12)`, so `actual` and `expected` agree, the run prints *"every tie sits on both rails"*, and the ties are in fact offset laterally by `0.12·sin θ` where the 50 mm epsilon can never see it. **A check that agrees with the code rather than with the world** | Medium |
| 11 | `playerSim.mts:304,311-321,338` | `if (!airborne && position.y − groundY > FALL_THRESHOLD)`; `verticalVelocity -= GRAVITY·dt`; and with no `ground` sampler, `sampleGround` returns **`0`** — a flat plane | the shared double under `check:hop-clearance`, `check:deck-fallthrough` and `check:wall-tunnelling`. Its default world is literally flat, and it mirrors the real `Player`, so it cannot expose the divergence it exists to measure | Medium |
| 12 | `measure-bridge-parapet.mts:208,211-218` | `if (oy − terrainHeight(ox, oz) <= PARAPET_GONE_HUMP) continue;` and a ladder descending by subtracting from `y` | the "is a parapet meant to exist here" gate over-reads the hump, so correctly-tapered stretches still get probed; the ladder walks off the leaning parapet's *face* instead of down it, reporting phantom missing bands far from the origin. (Pairs with §2.3's `parkFacts.ts:1720`, which computes the same hump) | Medium |
| 13 | `check-statue-occlusion.mts:246,285,305` | `feet = new Vector3(x, 0, z)`; `y = occluder.centreY + f·halfHeight`; ray from `feet.y + PLAYER_HEIGHT·fraction` | models a flat apron at `y = 0` out to ±16 m and a statue axis along `+Y`, while the real statue rides the fountain, whose own code already uses a local `this.up` (`Fountain.ts:319`). Near the origin the error is small, which is why it stays green — the FADED-vs-HIDDEN agreement it certifies is for a flat park | Low-Medium |
| 14 | `measure-deck-fallthrough.mts:259,295-296` | `base = terrainHeight(RAMP_X0, RAMP_Z) + 6`; `gap = deck − player.groundY` | builds a flat `+Y` ramp 40 m out and runs `SimPlayer`'s `+Y` gravity against it. The sampler question survives; the thresholds are vertical on a leaning world, and it would not notice a platform whose `surfaceY` stopped agreeing with its own tilt | Low |
| 15 | `check-speech-bubbles.mts:422,441-444` | `playerPosition = new Vector3(ENTRANCE_PLAYER_X, 0, ENTRANCE_PLAYER_Z)`; anchors at a fixed `1.9` | the entrance ground is at **−6.1 m**, so the whole rig — camera included — floats 6 m above the park it claims to be in. The screen-space arithmetic is sound; the frame is one nobody renders | Low |
| 16 | `check-cart-shape.mts:418-419` | `rotation.y = atan2(tangent.x, tangent.z)`; `rotation.x = -asin(clamp(tangent.y))` — no roll to the local up | the wheel-visibility fraction is measured on a cart standing at the ring's full lean off its own rails. **Mirrors `RailRace.placeCarts:940-942`, so it cannot flag it** | Low |
| 17 | `measure-hop-clearance.mts:65` | `new SimPlayer(collision, {…})` with no `ground` → the world is `y = 0` | the apex it certifies (and which `Collision.ts` hard-codes) is a **vertical** apex; a child hopping a park wall rises along `+Y` while the wall top follows the radial. Self-consistent with the engine's flat vertical — documentation-of-frame rather than a live false result | Low |
| 18 | `probe-sightline.mts:55,58` | `top = at.y + bounds.max.y·scale.y`; prints `heightAboveGround` | diagnostic only, but the `top` it feeds to `hidesTheArrivingBus` is the vertical top of a leaning canopy | Low |

**Triaged and NOT a hit — do not re-file.** Indoor or its own space:
`check-nav-routes.mts` (hotel lobby mezzanine throughout), `check-castle.mts`,
`check-benches.mts`, `check-npc-presence.mts` (gated on `space !== SPACE_GARDEN`),
`check-stall-shape.mts`, `check-bus-journey.mts` (`BusJourney` owns a private
lane that never touches the sphere), `check-cat-bus-suspension.mts`,
`check-keyring-hang.mts`, `probe-height-blind.mts`, `check-asset-contract.mts`.
2D or screen/direction space: `check-cat-bus.mts`, `check-castle-towers.mts`,
`check-npc-separation.mts`, `check-npc-jitter.mts`, `measure-wall-tunnelling.mts`,
`check-keyring-view.mts`, `check-sky-view.mts`. Curve-relative:
`check-slide-rider.mts` (its one bare `.y` at `:604` is printed, never asserted,
and `:585-590` explains why). Not geometric: `check-park-boot.mts` (hashes).

`park-harness.mts` asserts nothing, but is worth knowing: the `sample(x, z, y)`
it hands every caller is `world.building.surfaces.sample`, a **downward
vertical** sampler. That is the shared root of hits 8 and 14, and of anything
else that asks "what is under me".

### 2.5 Four of these are check-and-code *pairs*

Fixing the check alone turns it red, because the game still uses the flat
convention the check is reproducing. Change both, in one commit:

| check | the code it mirrors | status |
|---|---|---|
| `check-swept-bus.mts` | `ArrivalSequence.placeBus:1915-1934` | **code already fixed** (`faceOnGround`); only the check is stale |
| `check-tie-frame.mts:109` | `Coaster.ts:436` `setY(mid.y − 0.12)` | both flat |
| `check-cart-shape.mts:418` | `RailRace.placeCarts:940-942` | both flat |
| `check-climb-wave.mts:309` | `TreeClimbing.climbPose:657` | both flat |

**The single most common repair, in both columns**, is mechanical:
`a.y − terrainHeight(a.x, a.z)` → `altitudeAt(a.x, a.y, a.z)`, and
`v.set(x, terrainHeight(x, z) + h, z)` → `liftFromGround(x, z, h, v)`.
`terrain.ts:200-225`'s own header already states the `1/cos θ` over-read and
the wrong-column failure that every one of these call sites is an instance of.

---

## 3. `src/` sites the first sweep missed

`ALTITUDE-INVENTORY.md` swept geometry, physics and cameras. It did not sweep
**world UI, effects and lighting**, and that is where the most-seen faults are.
None of the rows below appear in it.

### 3.1 The flat disc in the XZ plane — the thing a child sees every single tap

A mesh authored flat and `rotation.x = -Math.PI/2`'d is correct **only if
something leans it downstream**. 92 sites match that pattern in `src/`; these
are the ones positioned straight into world space with no leaned ancestor.

| file:line | expression | what a six-year-old sees | severity |
|---|---|---|---|
| `src/art/models/tapMarker.ts:57,61` | `ring.rotation.x = -Math.PI/2`, `disc.rotation.x = -Math.PI/2`, set once in the constructor; callers only ever `root.position.set(...)` (`TapNavigator.ts:252,281`) and the root goes straight to the scene (`:201`) | **she taps the grass and the pink "I'm going here" ring is half buried in the hillside and half floating**, sliced by the grass. The ring's own 0.62 m radius spans ±0.43 m of ground height across itself at the rim, and the `HOVER = 0.06` z-fight margin becomes 0.043 m. Wrong on every tap beyond ~20 m | **High** — the most-seen piece of world UI in the game |
| `src/art/effects/rainbowRing.ts:140` (+ the `RISE = 0.34` lift at `:190`) | `mesh.rotation.x = -Math.PI/2`, pool built once, never re-set | two customers, both on open ground: the **hop rainbow on every landing** (`Player.ts:1253,1321` — `world.add`, scene root) and the **tap-confirmation burst** (`Highlights.ts:161`, `scene.add` at `:143`), whose own comment says *"on a phone that burst is the only 'yes, that one' a child gets."* A 1 m rainbow lying in the world XZ plane on ground that leans 45° | **High** |
| `src/art/effects/rainbowRing.ts:290,317` | `spark.direction.set(cos, 0, sin)` — the star burst plane is world XZ; `setY(origin.y + SPARK_RISE·…)` | half the stars dive into the grass, half shoot at the sky | Medium |
| `src/world/Highlights.ts:281` (+ `:217` `zone.y + RING_CLEARANCE`) | `this.ring.rotation.x = -Math.PI/2`; `showRing` (`:295-299`) only sets position and scale | the guaranteed-highlight ring for every interactable with no shell mesh, lying at 45° to the ground it marks. **Not covered** by the inventory's `Selection.ts:402,455` row | Medium-high |
| `src/art/effects/flowerSparkle.ts:147,149,168` | `flightPoint.y += 1.55 // roughly hair height` | 1.55 m of `+Y` is 1.09 m of real height and **1.11 m sideways** at the rim: the picked flower flies past her ear and parks in mid-air beside her head. It is the payoff animation of picking a flower | Medium-low |
| `src/world/train/puffs.ts:82-84` | `drift.set(…, RISE_SPEED·…, …)`, `RISE_SPEED = 1.15` | the loco leans with the ground but its smoke leaves the chimney at 45° to it and trails sideways. Funny rather than broken, but she notices smoke that does not come out of the top | Low-medium |
| `src/ui/ActionChips.ts:210` | `projected.set(zone.x, zone.y + lift, zone.z).project(camera)` | the projection is correct; the **anchor** drifts up to `MAX_LIFT·sin θ` towards the park's centre, so "Ride it!" sits beside the ride rather than over it | Low |
| `src/art/effects/dustPuff.ts:159,164,168` | `originY + DRIFT_UP·ease`; `scale.set(s, s·0.62, s)` — the "settling on the ground" squash is on world `Y` | heel dust reads as a tilted lozenge rather than something lying on the grass, and drifts inward | Low |
| `src/world/interact.ts:254` | `Math.abs(y − zone.y) > ZONE_HEIGHT_TOLERANCE` in `pickInteractZone` | **a second copy** of the inventory's `Selection.ts:402,455` row, in the path `ui/ParkMap.ts` uses to name an attraction. Two outdoor points 0.6 m apart radially read as different decks | Low — but file it, it is not covered |

### 3.2 Lighting — the sun, the fill and the ambient all use world `+Y`

| file:line | expression | out/in | what breaks | severity |
|---|---|---|---|---|
| `src/world/DayNight.ts:784-787` | `fillLight.position.set(-keyDirection.x, 0.55, -keyDirection.z).normalize()` — used raw, nothing rotates it | OUT (`fillLight.visible = !indoors`, `:562`) | `0.55` is `tan 28.8°`. At the rim the local horizon is tilted 45.5°, so the cool fill sits **17° below the local horizon** — which is precisely what its own comment two lines up exists to prevent: *"straight opposite would light the ground from underneath and every toy would glow along its bottom edge."* Benches, stalls and the character herself get rim-lit from below in cool blue across the whole outer park, while the same objects by the fountain look right | **Medium-high**, and a one-line fix |
| `src/world/DayNight.ts:399` | `new HemisphereLight(...)` with `position` never assigned, so three.js leaves the axis at the default `(0,1,0)` | OUT (`:563`) | a surface whose normal is the **local** up receives `0.5 + 0.5·cos 45.5° = 0.85` sky / `0.15` green ground bounce instead of pure sky. The outer park's ambient goes continuously greener and flatter than the centre's, with no seam to explain it. `followPlayer` already does exactly the right thing for the key light | Medium |
| `src/world/DayNight.ts:715-718, 760` | one global `sunDirection`; `sunUp = smoothstep(-0.12, 0.12, sunDirection.y)` — elevation above **the park origin's** horizon. `daylight`, `clockNight`, `nightFactorValue`, the fairy-light hysteresis, the fog distances and every lamp descend from that number | OUT | **flagged, not filed as a defect.** On a sphere `N·L` on the ground at 157 m goes negative whenever the sun is below 45° on that side, so for hours either side of noon the outer park is in real geometric shadow while `nightFactorValue` says broad daylight — lamps off, fog at day distances, bright blue sky, dark flat grass at the bus stop. A terminator is what a planet does; nothing in the rig knows about it, so the "it is daytime" decisions and the actual illumination disagree. **This is Jim's call, not an engineer's** | Medium — a conversation, not a patch |

**Adjudicated clean in the same file, so nobody re-files it:** `keyLight.shadow.camera` (`:365-375`, `SHADOW_AREA = 26`) is re-centred on the player every frame by `followPlayer` (`:693-698`) with the light 95 m along `sunDirection`, so its ±94 m depth brackets the target whatever the ground does; the ortho box's own `up` being `+Y` only spins a square box about its own axis. Linear `Fog` (`Engine.ts:77`, `DayNight.ts:820-827`) is a true camera-space distance. `IsoCamera`'s `far = 6000` (`:254`) clears the sphere comfortably — the short `far` is `railRace/camera.ts:517`, already inventoried.

### 3.3 Two more clearance checkers built in the flat frame

| file:line | expression | severity |
|---|---|---|
| `src/world/coaster/clearance.ts:336-341` and `src/world/coaster/castleWindows.ts:209-214` — **identical** expression in both | `sideX = -tangent.z/flat; sideZ = tangent.x/flat;` … `new Vector3(point.x + sideX·lateral, point.y + rise, point.z + sideZ·lateral)` — the car envelope swept in the world XZ plane with `rise` straight up `+Y`. Neither file imports any sphere helper | **Medium**, and worse than it sounds |

These two are what stand between a child and the Sky Cruiser's roofline going
through a castle wall, and at 45° they swing an envelope rotated 45° from the
car that exists. `ALTITUDE-INVENTORY.md` already has `Coaster.ts:321-329`
seating the real cart flat while the rails beside it are drawn leaned — so the
cart, the rails and the two checkers are **three** disagreeing models of one
thing. `castleWindows.ts:180-186`'s own header is a long correct essay about an
assert nobody has watched fail being a decoration. Fix all of them from one
frame, in one change.

### 3.4 A stale constant comment, per CLAUDE.md's "correct it where you find it"

`src/core/constants.ts:20` `TERRAIN_RADIUS = 83.5` — *"where the ground stops"*,
last moved 2 August (72 → 83.5), while the park now reaches 157 m and the Rail
Race's rings circle outside the boundary (`:29-30`). The terrain disc ends at
22° of lean; things stand out at 45°. Whether the mesh actually falls short of
the props was **not** chased — flagging, not asserting. The doc comment at
`:12-17` also describes *"an orthographic camera"* the game no longer has, the
same false assertion `ALTITUDE-INVENTORY.md` flags in `Sky.ts:137-145`.

### 3.5 Checked and clean — do not re-file

- **`src/world/LampPosts.ts:303`** `glowGeometry.rotateX(-Math.PI/2)` looks
  exactly like §3.1 and is not: the flat plane is authored pre-lean and every
  instance goes through `instanceAt` (`:691-712`), which calls `placeOnSphere`
  per lamp. The clearest example in the codebase of flat-literal-leaned-
  downstream.
- **`src/art/effects/waterSplash.ts:210`** — same shape as `rainbowRing`, but
  its only customer is the Fountain, whose `splashEffects.root` hangs off the
  `standOnSphere`d group and is fed *local* coordinates.
- **All raycasting.** `Selection.ts:195,487`, `TapNavigator.ts:225`,
  `FerrisWheelRide.ts:730`, `parade/Parade.ts:455` are all `setFromCamera`
  against the live camera matrix, tested in world space against `Box3`/`Sphere`
  — orientation-free. There is **no** `intersectPlane`, no `new Plane`, and
  exactly one `(0,-1,0)` in `src/` (`DayNight.ts:342`, the moon's initial
  direction, overwritten at `:776`). **No downward ground ray exists anywhere.**
- **No spatial audio** (0 hits for `AudioListener|PositionalAudio|panner`), so
  no listener up vector to get wrong. **No LOD** (0 hits). **No `.y` depth
  sorting** (0 hits). 34 `frustumCulled = false` are particle pools opting
  *out*; 24 `computeBoundingSphere` are on local geometry.
- **No outdoor weather.** `minigames/railRacer/confetti.ts` has its own flat
  `Scene`. The outdoor particle systems are exactly §3.1's, plus `Fireflies`
  (leaned) and `ferrisWheel/clouds.ts` (already inventoried).
- **All minigame and interior lighting** — `waterFight`, `dodgems`,
  `spookyHouse`, `characterCreationPreview`, `building/InteriorLighting.ts`,
  `hotel/lighting.ts`, `entrance/BusJourney.ts` — each owns a disjoint space
  with a flat floor. Same for the ~80 non-world `rotation.x = ±Math.PI/2` sites
  under `src/minigames/**` and every object-local one under `src/art/models/**`.

---

## 3.6 Ambiguous — flagged, not decided

Jim's ruling keeps one distinction: indoor versus outdoor. These sit on the
line, and per the brief they are **reported rather than adjudicated.**

- **`SPACE_CASTLE_ROOF` — the roof garden, "open to the sky"**
  (`src/world/building/floors.ts:83-84,157-165`, `roofed: false`). `spaceAt`
  makes it an **interior**, so `upFor` there is plain `+Y` — correct, because
  its origin is `(1200, 600)`, **1341 m** from the park's centre, where the
  radial formula is meaningless. But a child standing in it can see the sky,
  wild pets live there, and **the ginormous slide launches from it**. Whatever
  "everything is radial" means, it cannot mean this space, and somebody has to
  say so out loud rather than leave it as an accident of a radius test.
- **The Sky Cruiser and the ginormous slide cross the boundary.** The family
  asked for the cruiser to fly *through* the castle, so its route spans the
  radial park and the flat castle spaces. Neither `src/world/coaster/**` nor
  `src/world/slide/**` mentions `spaceAt`, `castleFloorAt` or any castle space
  (0 grep hits). A single route in two frames, with no owner of the seam.
- **Building shells versus their rooms.** The hotel's crystal tower and the
  castle's exterior stand in `SPACE_GARDEN` (leaning) while every room inside
  is its own flat space hundreds of metres away. The **doorway** is therefore a
  discontinuity in orientation, not just in position — the same door band
  `tapSpacing.ts`'s `bandCrossed` owns. What a child should see walking through
  it has not been decided anywhere I can find.

---

## 4. How this search was run, and its controls

Shell here is **zsh**, not fish — `ALTITUDE-INVENTORY.md`'s fish `for … end`
loops do not parse. These are the zsh forms.

### The control, run first

```sh
# Everything already converted. If this returns nothing, the grep is broken,
# not the codebase clean. Measured on 31d0fb2a: 129.
grep -rn "placeOnSphere\|standOnSphere\|standOnGround\|faceOnGround\|tiltToSphere\|upAt(\|upFor(\|isOutdoors(\|altitudeAt(\|liftFromGround(\|yAtAltitude(\|eyeForFocus(" \
  --include='*.ts' src/ | grep -v '^src/world/terrain.ts\|^src/world/up.ts' | wc -l
```

### The new half — the checks

```sh
# The same control over scripts/ and test/. Measured: 21 hits, in 3 files,
# against 193 files. That gap IS the finding.
grep -rn "placeOnSphere\|standOnSphere\|tiltToSphere\|upAt(\|upFor(\|altitudeAt(\|GROUND_SPHERE_RADIUS\|capHeight" \
  --include='*.ts' --include='*.mts' scripts/ test/ | wc -l

# Sphere-blind but altitude-touching: the candidate list.
for f in $(grep -rlE "\.y\b|terrainHeight|altitude|clearance|groundY" --include='*.ts' --include='*.mts' scripts/ test/); do
  grep -qE "placeOnSphere|standOnSphere|tiltToSphere|upAt\(|upFor\(|altitudeAt\(|GROUND_SPHERE_RADIUS|capHeight|planetRadius|groundRadius" $f || echo $f
done

# Vertical rays and hard-coded axes in the checks.
grep -rn "Raycaster\|Vector3(0, *-\?1, *0)\|set(0, *-\?1, *0)" --include='*.ts' --include='*.mts' scripts/ test/

# Axis-aligned boxes round possibly-leaning geometry.
grep -rn "new Box3()" --include='*.ts' --include='*.mts' scripts/ test/

# Fixed y thresholds.
grep -rnE "(y|Y) *[<>]=? *-?[0-9]" --include='*.mts' scripts/
```

### The `src/` gap sweep — patterns `ALTITUDE-INVENTORY.md` never ran

With the hit counts measured on `31d0fb2a`. **The most productive line by a
distance is the first**: a flat disc rotated into the XZ plane.

| grep (`-rnE --include='*.ts' src/`) | hits | what it found |
|---|---|---|
| `rotation\.x = -?Math\.PI ?/ ?2\|rotateX\(-?Math\.PI ?/ ?2\)` | 92 | §3.1 — filtered by hand for meshes positioned straight into world space |
| `HemisphereLight` | 18 | §3.2 |
| `DirectionalLight\|shadow\.camera\|Fog\|\.far =\|\.near =` | 62 | §3.2's clean adjudications |
| `setY\(\|\.y \+=` | 42 | §3.1's lifts |
| `Raycaster\|intersectPlane\|\.project\(\|\.unproject\(` | 23 | all clean |
| `0, *-1, *0` | 1 | `DayNight.ts:342` only |
| `new PerspectiveCamera\|new OrthographicCamera` | 13 | only `railRace/camera.ts:517` is short |
| `frustumCulled` / `boundingSphere\|computeBounding*` / `renderOrder` | 34 / 24 / 39 | all clean |
| `new LOD\|addLevel` | **0** | *control:* `distance` returns dozens — no LOD system exists |
| `AudioListener\|PositionalAudio\|panner` | **0** | *control:* `listener` returns ~20 DOM hits — no three.js audio exists |
| `sort\(\(.*=>.*\.y` | **0** | *control:* `\.sort\(` alone returns many — no y-sorted draw order |

The three zero rows are the ones that needed a control, and each got a
deliberately weaker pattern on the same corpus to prove the machinery worked.
That is the difference between "nothing is wrong" and "my grep is wrong", and
it is the only reason those three can be written down as absences.

### How a null result was distinguished from a broken pattern

Every grep above was paired with the control on the same corpus. The
`scripts/`+`test/` control returning **21** rather than **0** is what proves the
patterns reach those files at all; it is also what proves the sweep's headline
(3 sphere-aware files out of 193) is a real ratio and not a mis-spelled
`--include`.

### Where measurement replaced reading

- `scratch-seeker/t.mts` / `t2.mts` import `src/world/terrain.ts` directly and
  print the table in "The numbers" and the **28.7 m** figure in §2.1. Neither
  needs a built park, which is why they are the only measurements in this file.
- Everything else is *(read, not measured)* because **the park does not build
  on this branch** (§0). Re-measure once it does.

---

## 5. Re-frame or rewrite — an honest split

**About three quarters of the *sites* are a re-frame. About three quarters of
the *work* is the rewrite.** They are not the same three quarters, and the
difference is the number worth knowing.

**Re-frame — route an existing call through an existing helper** (~70 sites).
The vocabulary is already built and proven: `upFor`, `altitudeAt`,
`liftFromGround`, `yAtAltitude`, `eyeForFocus`, `placeOnSphere`,
`standOnSphere`, `tiltToSphere`, `capHeight`. Everything in §3.1 (one
`tiltToSphere` where the mesh is shown), §3.2's first two rows (two lines),
§2.1 (`y` → `altitudeAt`), §2.3, and most of `ALTITUDE-INVENTORY.md`'s
sections C, F and G. Each is between one and ten lines, each is independently
testable, and none of them needs a decision from anybody.

**Rewrite — a new model, which no helper can absorb** (~20 sites, most of the
effort):

- **`CollisionWorld`.** It has *no Y in its geometry at all* — circles and
  rectangles in `x,z`, with `topIsAbsolute` bolted on for knee-high props.
  Making a collider mean "a shape on the surface" rather than "a prism along
  world `+Y`" is a change to the representation, and CLAUDE.md's hard-won
  rules about it (`topIsAbsolute`, the hollow-rectangle trap, `keepOutsFor`)
  all have to survive the change.
- **`NavGrid`.** A 2D lattice whose step test is already beaten by its own
  outward diagonal. A radial world wants the step measured along the local up,
  which changes the lattice, not a constant in it.
- **Gravity and jumping** (`Player`, `NpcCharacter`, `ParadeMember`).
  `verticalVelocity` becomes a radial velocity; every hop, fall, landing,
  auto-hop and `topIsAbsolute` interaction is downstream of that one change.
- **`train/bridges.ts` + `bridgeStonework.ts`** — a whole subsystem that
  imports no sphere helper at all.
- **`coaster/route.ts`, `slide/solve.ts`** — a 213 m circuit and a 95 m chute
  solved entirely in world `y`.
- **The ride camera *mounts*** (`Coaster.placeCart`, `ParkTrain.placeCars`,
  `railRace/camera.ts`, `slide/cameras.ts`) — the cart is seated in a flat
  frame while the rails beside it are drawn leaned, so the eye is in a
  different world from the track.
- **The check suite.** §2 is not "fix thirteen lines": several invariants are
  asking a *different question* now (a global flat beam plane, a ray up world
  `+Y` through a leaning tunnel). Re-deriving them is where the caution goes,
  because a check that is wrong in the safe direction is only noise, and one
  that is wrong the other way is how this all shipped.
- **Two things that are decisions, not patches**: the day/night terminator
  (§3.2), and what the indoor/outdoor seam means for a ride that crosses it
  (§3.6).

**The one that gates the rest**: the branch does not build (§0). Nothing in
either column can be measured until it does.

## 6. Superseding

`ALTITUDE-INVENTORY.md` §"A stale claim, corrected" struck the *justification*
for deferring collision / navigation / gravity. **§1 of this file strikes the
decision**, on Jim's ruling of 14 September. Anyone reading
`HANDOFF-radial-up.md` should treat its collision/nav/gravity paragraphs as
dead, not as deferred.
