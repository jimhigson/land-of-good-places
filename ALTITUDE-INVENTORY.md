# Altitude on a sphere — the inventory

Jim, 14 September 2026:

> *"the entrance camera clips through the earth - EVERYWHERE that uses altitude
> now needs to use it relative from the centre of the planet, not absolute,
> including cameras - a search engine needs to find everywhere else that does
> this, this is not good."*

This file is the search. **It is meant to be re-run, not read once** — the
commands are at the bottom and every row says how it was adjudicated, so the
next person can repeat the sweep rather than repeat the reasoning.

## The rule, in one paragraph

Outdoors, "up" is **radial**: away from the centre of a sphere of
`GROUND_SPHERE_RADIUS` (220 m today) whose centre sits at `(0, -R, 0)`. World
`+Y` is that direction **only directly above the park's origin**. Everywhere
else it leans by `asin(d / R)`, and the park now reaches 157 m:

| distance from origin | lean | ground `y` (cap alone) |
|---|---|---|
| 0 m | 0° | 0 m |
| 57 m | 15° | −7 m |
| 100 m | 27° | −23 m |
| 134 m | 38° | −46 m |
| 157 m | **44°** | **−56 m** |

Two separate consequences, and most bugs here are the second one:

- **The lean.** A clearance differenced along `+Y` over-reads the real
  perpendicular clearance by `1 / cos θ` — 1.39× at 44°. Annoying, rarely fatal.
- **The cap.** `y` is dominated by *where you are*, not by *how high you are*.
  Step 6 m towards the park's centre at the bus stop and the ground climbs
  nearly 6 m. So any question of the form "what is the highest/lowest `y`
  near here", or any `y` that is damped, lagged, interpolated or averaged
  across a distance, is answering about the cap and not about height at all.
  **This is what put the entrance camera in the earth**, in both of its two
  independent faults.

`src/world/spaces.ts`'s `spaceAt` is the boundary. **Interiors are not a mode;
they are real coordinates hundreds of metres out**, where the radial formula
leans by more than 50°, so they keep plain `+Y` and must not be converted. Every
row below is adjudicated on that test, and indoor code is listed as *not a hit*
rather than omitted, so a later sweep does not re-file it.

## The vocabulary to route things through

Added by this work, in `src/world/terrain.ts` and `src/world/up.ts`:

| use this | instead of | what it is |
|---|---|---|
| `altitudeAt(x, y, z)` | `y - terrainHeight(x, z)` | height above the ground, both terms radii from the planet's centre, so the tilt cancels |
| `planetRadiusAt` / `groundRadiusAt` | — | the two radii, for anything that wants them raw |
| `liftFromGround(x, z, h)` | `set(x, terrainHeight(x,z) + h, z)` | the point `h` above the ground **along the local up**. For *placing* a thing: it slides `x,z` outwards, which is what a leaning prop does |
| `yAtAltitude(x, z, a)` | — | the `y` at which this **column** stands `a` above the ground. For a point that has already chosen its `x,z` — a damped camera focus, a chase point |
| `eyeForFocus(focus, flatOffset, eye, up)` | rotating a rig offset by hand | the one owner of where a camera's eye lands. `IsoCamera` and the arrival both call it |

Already present: `upAt`, `tiltToSphere`, `placeOnSphere`, `standOnSphere`,
`capHeight`, `groundWaves` (`terrain.ts`); `upFor`, `isOutdoors`,
`standOnGround`, `faceOnGround` (`up.ts`).

**`liftFromGround` vs `yAtAltitude` is the distinction that caught this work
twice.** They are both inverses of `altitudeAt` and they are not
interchangeable: one moves along the up and changes the column, the other keeps
the column and changes only `y`.

## Fixed in this work

| file | what it assumed | out/in | fix |
|---|---|---|---|
| `src/world/entrance/ArrivalSequence.ts` `arrivalGroundUnderEye` → `arrivalDoorFocus` | the eye sits at `drop + cameraOffset(...)` — the rig offset in the **flat** frame — and clearance is the highest `y` of terrain near it | OUT | **Fixed.** Asks `eyeForFocus` where the lens really goes (44° away from the flat guess at the bus stop) and measures in `altitudeAt`. Adds a sightline clause: the run from eye to drop must clear the ground, which is what "even taking the curvature into account" means. Focus was 10 m in the air *and* the eye 0.18 m under the grass; now 2.11 m and +2.55 m |
| `src/core/IsoCamera.ts` `applyTransform` | — (already correct) | both | **Refactored**, not fixed: the four lines that rotate the rig offset are now `eyeForFocus`, so the arrival cannot hold a second model of them. That duplication is what kept `check:arrival-camera` green about a camera nobody renders |
| `src/core/IsoCamera.ts` `update` — `focus.y` damped at 2× half-life | height above ground changes slowly, so `y` may damp slowly | OUT | **Fixed.** True of altitude, false of `y`: the cap moves as fast as she does, so the focus trailed **9 m** under the player and the eye 0.28 m under the grass. Altitude is now its own damped state; `focus.y` is derived via `yAtAltitude`. Damping `altitudeAt(focus)` re-read each frame is **not** a fix and made it worse (−4.42 m) — see the field's docblock |
| `src/core/IsoCamera.ts` `TEMP_LIFT` / `CAMERA_FOCUS_LIFT` | the 1.25 m chest lift is a `+Y` offset | OUT | **Fixed.** Added to her altitude. At 44° the vector form gave 0.90 m of real height and put the aim 0.87 m sideways of her chest |
| `src/world/coaster/Coaster.ts` — the energy drop **and** the crest search | `drop = crestHeight − height`, both bare `.y`, and the chain's crest found by the largest bare `.y` | OUT | **Fixed.** Both now read `route.clearanceAt(d)`, which already existed with the right doc comment and **zero readers**. Measured on seed 428: the chain let go **95 m along a 213 m loop** from the real crest (the bare-`y` crest is just wherever the circuit passes nearest the origin, because that is where the cap is highest); the cart was handed **25.30 m of free height**, 15 m/s against 10.84; the ride's real vertical range is 19.67 m where a bare `y` reported 33.47 — **70% of the "drop" was the planet** |
| `scripts/check-arrival-camera.mts` | same flat eye model as the game | — | **Fixed.** Rebuilds the eye (Rodrigues from the sphere's centre) and the altitude from `terrainHeight` itself, importing neither `up.ts` nor `terrain.ts`'s answers, so a disagreement means something. Two new clauses: the sightline must not pass through the ground, and the focus must not drift far above its nominal eye height — a clearance floor alone is blind to the "10 m in the air" half of this bug |

## Still open — worst first

Nothing below is fixed. Severity is "does a child see it at 44° of lean".

### A. Vertical physics along `+Y`

| file:line | expression | out/in | severity |
|---|---|---|---|
| `src/world/ferrisWheel/FerrisWheelRide.ts:260,292,419-425` | `boardY = terrainHeight + FERRIS_CAR_LOW_Y`; `altitude = boardY + height·CLIMB_METRES`; `setY(altitude)` | OUT | **High.** The wheel is placed through `AnchorPlots` and leans; the gondola climbs 96 m straight up `+Y`, so it walks off the rim by `96·sin θ` — tens of metres. `clouds.ts:36,140,204` shares the ladder |
| `src/entities/Player.ts:1126-1181` | `verticalVelocity` along `+Y`; land test `position.y <= groundY` | OUT (indoor is correct) | **High at the rim.** A 1.28 m hop delivers `1.28·cos 44 = 0.92 m` and slides her 0.89 m across the slope. Auto-hop over `autoHoppable` walls under-clears by the same factor |
| `src/entities/npc/NpcCharacter.ts:659-681,778` | identical fall/land/hop block | OUT | **High** — NPCs wander the whole park |
| `src/entities/Player.ts:1096,1150,1170` | `position.y − groundY > FALL_THRESHOLD` (0.5) | OUT | Medium. The margin is now spent on the cap's 1.02 m/m radial gradient at the rim |
| `src/entities/parade/ParadeMember.ts:623,658` | pet hop lift along `+Y` (though `faceOnGround` at 665 is right) | OUT | Medium — the pet leans but hops out of its own frame |
| `src/art/models/ponytail.ts:78,149,273-282`, `src/entities/balloonString.ts:47,68,155` | world-space rope sims with `GRAVITY` along `−Y` | OUT | Medium — at the rim the tail hangs 44° off her spine |
| `src/entities/HeldBalloon.ts:141,150` | `player.position.y + model.height + HEAD_CLEARANCE` | OUT | Medium — the bouquet detaches from her hand by ~1 m laterally |
| `src/world/TreeClimbing.ts:336` | `pose.y + WAVE_RISE·wave` | OUT | Low-medium |

### B. Navigation and walkability on bare `y`

| file:line | expression | out/in | severity |
|---|---|---|---|
| `src/world/NavGrid.ts:224,827,1078,1396` | `MAX_STEP` (0.62) vs `abs(height − previousHeight)` on a 0.5 m lattice | OUT (indoor correct) | **High at the rim.** Radial gradient is 1.02 at 157 m, so a straight cell is 0.51 m and a **diagonal 0.72 m > 0.62** — outward diagonals become impassable and tap-to-move degrades in the outer park |
| `src/entities/TapNavigator.ts:322` | `levelGap = abs(player.y − target.y)` vs 0.62 | both | Medium outdoors — two points 0.6 m apart radially read as different levels |
| `src/world/pickWalkable.ts:113` | `out.y − sample(...)`, vertical bracket | OUT | Medium — the tap hit point is biased downhill on steep ground |
| `src/world/Collision.ts:910-946` | `topHeight`/`baseHeight` as world `y` | mixed — `topIsAbsolute` is registered by `hotel/place.ts` (**indoor, fine**); the relative path is correct by construction but is fed `hopClearance` from `Player.ts`, so it inherits A's `cos θ` | Low-medium outdoors |
| `src/world/Selection.ts:402,455` | `abs(position.y − zone.y) > ZONE_HEIGHT_TOLERANCE` | mixed (mostly indoor decks; every outdoor stall registers one) | Low — worth a measured check |

### C. Ride and route clearance as a `y` difference

All `point.y − terrainHeight(x, z)`, so all over-read by `1/cos θ`.

`src/world/coaster/route.ts:827,1182,1197,1389,1405,1471,1527` (medium-high —
the control points are built flat and **never leaned**, while `Coaster.ts:493`
leans the pylon tops, so the two disagree) · `src/world/train/route.ts:227` ·
`src/world/train/plan.ts:256` · `src/world/slide/supports.ts:166-167` (legs
stand along `+Y` from a leaning foot) · `src/world/slide/solve.ts:254,690,1467`
(a 95 m chute solved entirely in world `y`) · `src/world/slide/chaseEye.ts:340`
(low — 0 rejections in 22 000 calls) · `src/world/TreeLights.ts:739` (low).

### D. Train bridges — a whole subsystem still flat

`src/world/train/bridges.ts` and `bridgeStonework.ts` import **no** sphere
helper at all. `bridges.ts:646,686` (`worstGroundY` by `max`/`min` on `y` across
a span the cap tilts) · `:659` (headroom added along `y`) · `:782` · `:854-855`
(decides whether a parapet collider exists) · `:1181,1219,1222,1273,1527` ·
`:757` (`setFromAxisAngle(new Vector3(0,1,0), yaw)` — yaw about **world** Y) ·
`bridgeStonework.ts:308` (`const up = new Vector3(0,1,0)`). All medium.

### E. Trackside and ride cameras

| file:line | what | severity |
|---|---|---|
| `src/world/coaster/Coaster.ts:321-329` `placeCart` | the cart is seated in the **flat** route frame — yaw and pitch only, no tilt — while the rails beside it are drawn through `drawnOnSphere`. `eyeMount` (191-208) hangs off it, so this is the Sky Cruiser's first-person eye | **Bad** |
| `src/world/train/ParkTrain.ts:573-576` `placeCars` | same, and no pitch term either. Mount for `rideView.mountOn(seatMount, …)` | **Bad** |
| `src/world/railRace/camera.ts:395,674-684` | `const UP = (0,1,0)`; the rig's `rise` is along world Y and `camera.up` is never set. The ring runs 58-110 m out (15-30° of lean), so the horizon tips as the cart goes round. Also `far = 400` (:517) now cuts the horizon of a 220 m sphere | **Bad** |
| `src/world/slide/cameras.ts:228,296-298,320-327,409-416` | trackside eye built in a world-`Y` frame, `camera.up.copy(UP)`, deliberately holding a "level horizon" — but "level" now means level with the park's *centre*, so at the castle's radius it is visibly rolled against the chase shot | **Bad-ish** |
| `src/world/railRace/camera.ts:640-645` | `baseAt(s) + 0.6 + RIDER_RIDE_HEIGHT` — the datum is cap-relative and right, the 2.5 m is up world `Y` | Moderate |
| `src/world/railRace/RailRace.ts:939-942` | flat cart placement; it is the *subject* of the camera above | Moderate |
| `src/world/ferrisWheel/FerrisWheelRide.ts:322` | `rideView.mountOn(gondola.seat, …)` — eye upright in a leaning park | Moderate-low |
| `src/core/IsoCamera.ts:627-632,690-700` | drag-to-look slides the focus along a flat ground plane; panning 18 m outward at the boundary leaves it ~14 m above the ground it is over. Indoors exactly right | Small-moderate |
| `src/world/KeychainShop.ts:508,623,629,799` | the zoomed picker's fit/zoom/tap-spacing solve uses analytically flat screen axes while the live camera is tilted. **Seed-dependent** — harmless near the centre. `check:keyring-view` compares this to `IsoCamera`'s real axes and will now disagree by the lean | Low-moderate |
| `src/world/Sky.ts:137-145,540-549` | `skyViewFor(null, …)` returns `up:(0,1,0)`, `perspective:false`, and the doc asserts the park camera is orthographic and never rotates. It is neither. Visually near-harmless — the camera rolls with the ground so the drawn horizon stays level — but the sun/moon azimuth and the ±83° bearing fade are solved in a frame the camera no longer occupies | Low; **the comment is false and should be corrected where found** |
| `src/Game.ts:1356-1358`, `src/main.ts:402,485-490` | `/view` and `/spawn?pos=x,y,z`: default `up = +Y`, `far = 500`. Harmless by design — a developer types the vectors — but an absolute `y` copied off an old link now means something completely different, since the ground at 157 m is at −58 m | Debug only |

### F. `terrainHeight(x, z) + <height>` used as a world altitude

**24 sites outside `terrain.ts`. 8 already feed `placeOnSphere`/`standOnSphere`
immediately** and are correct by contract: `AnchorPlots.ts:82,262`,
`Fireflies.ts:143`, `Garden.ts:217`, `FacePaintStall.ts:439`,
`train/track.ts:117`, `Scenery.ts:1531`.

The 16 that are not: `pathGraph.ts:437,438,464,491` · `pathSurface.ts:130,131,202`
· `entrance/Entrance.ts:1085` (all low — a paving `+lift` becomes `lift·cos θ`,
which shrinks the z-fight margin without inverting it) · **`train/track.ts:180`**
(medium — the **rails** are flat while the sleepers at :117 are leaned, so the
two disagree by `RAIL_HEIGHT·(1−cos θ)` plus a lateral shift) · `track.ts:207` ·
`Scenery.ts:660,976` (medium-low — a 6 m tree's real top is ~1.9 m laterally off
where `hidesTheArrivingBus` is told it is) · `TreeLights.ts:739` ·
`ferrisWheel/FerrisWheelRide.ts:260` · `slide/solve.ts:254` ·
`coaster/route.ts:1405` · `coaster/Coaster.ts:523`.

### G. Hard-coded `(0,1,0)` outdoors

Real: `train/bridges.ts:757`, `train/bridgeStonework.ts:308`,
`art/models/ponytail.ts:149`, `entities/balloonString.ts:68`,
`railRace/camera.ts:395`, `slide/cameras.ts:228` (all covered above).

**Not hits, checked:** `railRace/track.ts:290,1137` and every other flat-frame
authoring site that is leaned downstream by `placeOnSphere`/`tiltToSphere`;
`slide/petRiders.ts:258` and `railRace/cart.ts:187` (object-local spin axes);
`Fountain.ts:110` (overwritten by `upAt` at :192); `entrance/BusJourney.ts:1405`
(the cutscene lane is its own flat world).

## Checked and already correct — do not re-file

- **`src/world/Fountain.ts`** — the most thoroughly converted file here.
  `standOnSphere` (:191), `upAt` (:192), occluder along `this.up` (:319-321),
  and `waterSurfaceY` (:443) solves the water as a **tilted plane**
  (`up · (P − centre) = WATER_HEIGHT`) rather than one number.
- **`src/world/railRace/route.ts`** — `pointAt` → `placeOnSphere` (:528);
  clearance against `capHeight`, not a world `y` (:435); `slopeAt` (:587) is the
  derivative of the *authored* undulation, i.e. the gradient relative to local
  up, so `simulate.ts:431`'s `HILL_PULL · slope` is right.
- **`src/world/rail/sweptRail.ts`**, **`railRace/track.ts`** — frames built from
  `upFor` / `placeOnSphere` / `tiltToSphere`.
- **`src/world/AnchorPlots.ts`** — the plot frame, the inverse-tilt in
  `standInPlot` (:255), and `groundInPlot`'s note (:96) about *not* differencing
  world heights.
- **`src/world/building/layout.ts:207-220`** — `deckClearanceOverFootprint` asks
  the residual against the **tilted deck plane**.
- Placement through `placeOnSphere`/`standOnSphere`: `Flowers`, `treeModel`,
  `FoliageFade`, `Fireflies`, `LampPosts`, `FairyLights`, `TreeLights`,
  `Garden`, `Scenery` (walls/benches :2210-2303), `minigames/stalls`,
  `KeychainShop`, `FacePaintStall`, `train/fence`, `train/station`,
  `entrance/gateArch`, `entrance/Entrance` (:416, :529).
- **Per-frame orientation** uses `faceOnGround`, never `standOnGround`:
  `Player.ts:711,865,1215`, `NpcCharacter.ts` (6 sites), `NpcSystem.ts:1098`,
  `ParadeMember.ts:527,665`, `exitCrowd.ts:186,233`,
  `ArrivalSequence.ts:1862`. (Getting this wrong makes the thing *tumble* —
  `up.ts`'s `faceOnGround` docblock has the account.)
- **`src/core/cameraRig.ts`** and **`src/core/screenBasis.ts`** — pure flat-frame
  trig, correct by construction, *provided every outdoor caller rotates the
  result*. The unrotated callers in E are the hits, not these.
- **All interiors**: `src/world/hotel/**`, `src/world/building/**` (castle
  floors, ball pit, shops, roof spaces), `src/minigames/**` (each owns its own
  `Scene` and flat ground), `src/ui/characterCreationPreview.ts`,
  `src/world/entrance/BusJourney.ts`, `src/world/hotel/cinematic.ts`,
  `src/core/RideCamera.ts` (mount-relative, no world up anywhere — the bugs are
  in the *mounts*), `src/ui/ParkMap.ts` (2D plan, altitude irrelevant).

## A stale claim, corrected

`HANDOFF-radial-up.md` says collision, navigation and gravity may stay in the
flat frame because the change would be **invisible** — *"a 1.28 m hop on a 13°
tilt drifts by centimetres"*. That was true when it was written and the lean was
13°. **It is 44° now**, and the same hop loses 0.36 m of its 1.28 m and slides
0.89 m across the slope; `NavGrid`'s 0.62 m `MAX_STEP` is beaten by a 0.72 m
diagonal cell. The *decision* to defer may well still be right — it is a physics
rewrite — but the justification is no longer available, and section A/B above is
what it costs at the current radius. Do not read that handoff as saying these
are harmless.

The same handoff's *"the arrival camera is fine — do not go looking for a bug"*
is also now false: there were two real bugs in it, both fixed above. It was
honestly right when written, against a probe taken at the wrong instant.

## Suggested order

`Coaster.ts:276` drop → the ferris altitude ladder → `NavGrid` `MAX_STEP` →
`Player`/`NpcCharacter` hop along `upFor` → the ride-camera *mounts*
(`Coaster.placeCart`, `ParkTrain.placeCars`) → `railRace/camera.ts` and
`slide/cameras.ts` → `coaster/route` + `train/bridges` → the rope sims →
the low-severity paving `+lift` sites.

## Re-running the search

Fish shell; quote the globs. Run from the worktree root.

```fish
# 1. hard-coded vertical axes
grep -rn "0, *1, *0" --include='*.ts' src/
grep -rn "WORLD_UP\|DEFAULT_UP\|\.up\b" --include='*.ts' src/
grep -rn "rotateY(\|applyAxisAngle(\|makeRotationY(" --include='*.ts' src/

# 2. vertical measurement — fall, drop, clearance, gap
grep -rn "\.y - terrainHeight(\|terrainHeight([^)]*) *-" --include='*.ts' src/
grep -rn "FALL_THRESHOLD\|clearance\|hopHeight\|MAX_STEP\|levelGap" --include='*.ts' src/

# 3. a ground sample plus a height, treated as a world altitude (24 sites today)
grep -rn "terrainHeight([^)]*) *+" --include='*.ts' src/ | grep -v '^src/world/terrain.ts'

# 3b. which of those files never touch a sphere helper at all
for f in (grep -rl "terrainHeight([^)]*) *+" --include='*.ts' src/)
  grep -q "placeOnSphere\|standOnSphere\|tiltToSphere\|upAt\|upFor\|altitudeAt" $f; or echo $f
end

# 4. bare .y comparisons and sorting
grep -rn "position\.y\b" --include='*.ts' src/
grep -rn "a\.y - b\.y\|b\.y - a\.y\|Math.abs([^)]*\.y -" --include='*.ts' src/

# 5. physics along +Y
grep -rni "gravity\|\.vy\b\|verticalVelocity\|\.y +=\|\.y -=" --include='*.ts' src/

# 6. cameras specifically
grep -rn "new PerspectiveCamera\|camera.position\|lookAt(\|camera\.up" --include='*.ts' src/

# THE CONTROL — everything already converted. Run this FIRST.
# If it returns nothing, your grep is broken, not the codebase clean.
grep -rn "placeOnSphere\|standOnSphere\|standOnGround\|faceOnGround\|tiltToSphere\|upAt(\|upFor(\|isOutdoors(\|altitudeAt(\|liftFromGround(\|yAtAltitude(\|eyeForFocus(" \
  --include='*.ts' src/ | grep -v '^src/world/terrain.ts\|^src/world/up.ts'

# adjudicating any hit as indoor or outdoor
grep -n "export function spaceAt" -A15 src/world/spaces.ts
```

**Grep alone cannot finish this.** Every row above was adjudicated by reading
the surrounding code, because the same expression is a bug outdoors and correct
indoors, and because a flat-frame literal that is leaned two lines later is not
a finding. Treat the commands as a way to build the candidate list, never as the
answer.
