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
| `railRaceFliesClear` | `:2618` | `air = rail.y − under.y`, `rail` on the rail-race ring, `under` the nearest point on the **train** route (a different column, gated only to within `2·TRACK_CLEARANCE ≈ 2.6 m` in plan) | at the ring's 58-110 m radius the gradient is 0.27-0.57 m/m, so up to **±1.5 m** of the `RAIL_OVER_RAIL = 5.5 m` budget is planet — and the sign depends on which of the two is further out | **High** |
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

See **§3.1** below (contributed by the `src/` gap sweep) for lighting and
shadow cameras, raycasting and picking, culling and bounding volumes, screen
projection for HUD elements, particles, and audio.

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

## 5. Superseding

`ALTITUDE-INVENTORY.md` §"A stale claim, corrected" struck the *justification*
for deferring collision / navigation / gravity. **§1 of this file strikes the
decision**, on Jim's ruling of 14 September. Anyone reading
`HANDOFF-radial-up.md` should treat its collision/nav/gravity paragraphs as
dead, not as deferred.
