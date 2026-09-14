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
- **+13** in the **checks and invariants themselves** (§2) — the half of the
  repo nobody had swept. 193 files in `scripts/` and `test/`; **three** of them
  mention a sphere helper, against 129 sites in `src/`.
- **≈ 80 open sites** in total, across ~60 files.

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

**And the worst one she cannot see:** `check-hotel.mts`'s fall detector fires
on every outdoor NPC beyond 28.7 m, so it can no longer find a real fall (§2.1)
— on a branch where the park does not build at all (§0).

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
| **measured** | `terrainHeight` first drops below `−2` at **d = 28.7 m** from the park origin. The park reaches 157 m, where the grass is at **−65.7 m**. |
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

### 2.4 The rest of `scripts/`

**193 files sweep; 3 are sphere-aware.** The triage of the remaining check and
measurement scripts is in **§2.5** below (contributed by the scripts sweep).
The pattern to expect, and the one to grep for when re-running:

- a fixed `y` threshold (`FLOOR_OF_THE_WORLD`, a headroom floor, a "ground is
  about here" constant);
- a downward or upward ray along `(0, ±1, 0)`;
- `Box3` `min.y` / `max.y` on outdoor geometry;
- `a.y − b.y` where `a` and `b` are at different `x,z`;
- a camera eye rebuilt in the flat frame (the fault
  `check-arrival-camera.mts` has already been fixed for, and the only script
  that has been).

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

**Re-frame — route an existing call through an existing helper** (~60 sites).
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
