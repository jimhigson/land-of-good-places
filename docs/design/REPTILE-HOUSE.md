# Reptile House — judge's scores and the final build spec

Jim's request (verbatim): *"produce now a new building which is a reptile
house. This should have many animals, in a zoo-like format both behind glass
and in enclosures without glass but with walls. There should be snakes,
including baby snakes of various sizes and a stall where you can buy
snake-themed things inside. The outside of the building should be
snake-themed too. Inside just one floor but make it expansive with forking
and meandering paths, and lots of cultivated tropical and otherwise
snake-appropriate vegetation. Use Blender to model as required."*

This is a game a father is building with his six-year-old daughter Eleri:
when a trade-off is close, pick what a six-year-old will enjoy more. Cute,
friendly snakes, never scary.

**The one owner of every shared number in this document is
`src/world/reptileHouse/layout.ts`.** Where this spec and that file
disagree, the file wins and the spec is corrected. Blender scripts read it
through `art/blend/reptile_constants.py` (which itself reads the TypeScript
with `blendkit.ts_const`); nothing is typed twice.

## Scores (1–10)

| Criterion | Design 1 (delight-first) | Design 2 (spatial v1) | Design 3 (risk-first) |
|---|---|---|---|
| Child delight | **9** — Noodle head↔tail cause-and-effect, hidden babies secret, Noodle-o-meter, walk-through log, "Say hi!" everywhere | 8 — 17 named animals each with a reaction, "follow the snake" floor, adopt-a-snake at the nursery | 7 — strong showpiece python and banyan of tree snakes, but fewer surprises and no adoption in v1 |
| Brief coverage | 9 — everything in Jim's request; pet snake at the stall | **10** — everything plus the GAME_DESIGN snake-adoption ask, two shop stands | 8 — everything in the request; adoption deferred |
| Spatial quality (meandering/forking single floor) | 8 — tree ring + outer circuit + log, but 44×32 is dense and the 7–9 m Great Tree in the centre hides the NW ring path from the fixed camera | **9** — ring + three arcs + tunnel, 5 cycles, no dead ends, raked-theatre sightline rule, foyer-to-glowing-north-wall first frame | 8 — figure-of-eight + rewarded spurs, clearances checked by hand, 48×36 |
| Buildability (headless Blender + this engine) | 7 — three large kits (280/260/160 KB), jumpable/enterable enclosures that must be proved leavable, scalloped disc colliders behind flat glass | 8 — four modest kits, hotel pattern, but `addRectangle` wall cases and a 2048×1452 floor canvas | **9** — walls are filled capsules (verified: `Collision.ts` resolves a wall as distance-to-segment ≤ halfThickness + radius, so a stadium has no hollow), 1.4 m open walls above `JUMP_APEX_HEIGHT`, boots with `plot: null`, hotel copied line for line |
| Phone performance | 7 — ~95 k tris claimed, draw-call estimate optimistic; ≤ 4 canvases | 7 — ~145 k tris, 220 calls, 9 canvases incl. a 12 MB floor paint | **8** — ~120 k tris, 170 calls, 6 canvases, crowds instanced |
| Collider simplicity | 7 — discs only, but two enterable enclosures + hoppable python body need leavability proofs | 8 — chord rings and disc chains; one rect class against walls | **10** — one `addWall` stadium or one disc per solid, nothing enterable, nothing hollow |
| **Total** | 47 | 50 | 50 |

**Spine: Design 3** (its engineering decisions are what will ship without a stuck child or a stale number). **Grafted from Design 2:** the Coil path graph with five cycles and no dead ends, the raked-theatre sightline rule, the glowing wall cases, the nursery with its own "Adopt a snake!" stand, the `World.shopStands()` fix, the `/reptile-house-door` link. **Grafted from Design 1:** Noodle's head-at-the-centre / tail-in-the-nursery thread, the walk-through Hollow Log (as the short-cut), the hidden-baby secret, the Noodle-o-meter, the snake-shaped stall awning. Dropped on purpose: enterable/hoppable enclosures, the pier, the tortoise ride, the castle-floor snake room, the floor-paint canvas (the "follow the snake" floor is done with geometry instead).

---

# FINAL BUILD SPEC — The Reptile House

Design stance: **cute, smiley, never scary.** Every animal has the house face (ink eyes taller than wide, two catchlights, blush, w-mouth), nothing has teeth, the crocodile's bite is a yawn, the snakes "hiss hello". When a trade-off is close, pick what a six-year-old enjoys more.

Coordinates below are **hall-local metres**: origin at the floor-plate centre, **+X east, +Z south (toward the camera)**, so the north and west walls are the visible backdrop and the south and east walls are `nearWallsHidden`. World = local + (`REPTILE_HOUSE_ORIGIN_X`, `REPTILE_HOUSE_ORIGIN_Z`). `facing` is `Player.facing` in degrees: 0 looks along +Z (south), 180 along −Z (north), 90 along +X. The fixed camera sits at +X+Z looking NW, pitched 38°, so **a thing of height H hides 1.28·H m of floor to its north-west.** Every number has one owner, named where it matters; nothing is copied between files.

> **Built, 2 October 2026 — three corrections to the text below, from measurement.**
> (1) The open enclosure walls are **1.45 m**, not 1.4: `Collision.ts`'s `clearsTop` grants a jumping body 0.15 m of grace over its feet, so a 1.4 m wall was cleared from 25 of 60 bearings at the apex (`check:reptile-house`'s hop probe). (2) Noodle's stand spot is (4.4, 2.4) facing 267, beside her bearing rather than on it, so a child there does not hide the head from the camera (the noodle kit's `game-view-with-child.png`). (3) The pet snakes are catalogue entries (`pet.snakeMint/Coral/Rainbow` → `createPetSnake`) rather than new `PetKind`s — the store keys on the catalogue id, and a `PetKind` would have put wild snakes on the castle roof. Until the park has a plot, the exterior stands on a **forecourt** space at (600, −900) reached by `/reptile-house-door`.

## 0. The five decisions that remove the risk (Design 3's, kept verbatim in spirit)

1. **It is a hotel room, not a castle floor.** One disjoint space, one flat plate, open-topped, `nearWallsHidden`, entered and left through `SpaceManager.changeTo` with a swept `PortalBand`. `Hotel.ts`'s `requestEnterLobby / checkDoorways / enterLobby / leaveToPark / boundTo / adoptRestoredPlayer` are copied with new constants; `buildRoomShell` is copied into `reptileHouse/shell.ts` on the already-shared `wallRuns.ts`.
2. **Every solid inside is a disc or a single thick wall. No `addRectangle` anywhere.** `CollisionWorld` resolves a wall as a capsule (`Collision.ts`: distance to the segment ≤ `halfThickness + radius`), so one `addWall(a, b, halfThickness)` is a *filled* stadium. A mover inside is pushed to the nearest face, never trapped. Terrarium plinths are drawn as stadiums so mesh and collider are one shape; round enclosures are solid discs.
3. **Open (glass-less) enclosure walls are 1.4 m:** above `JUMP_APEX_HEIGHT` (≈ 1.28 m, `Player.ts`) and below `KID_EYE_HEIGHT` (1.5164, `kid.ts`). She looks over, cannot get in, nothing inside has to be leavable. Glass terrariums are 2.9 m to the frame rim. The nursery is a 0.6 m kerb with glass to 1.5 m.
4. **Creatures are TypeScript primitives animated procedurally** (segment chains + travelling sine). Blender is used only for what primitives fight: the coiled building, enclosure masonry, big leaves, the banyan and logs, sculpted creature parts with hinge origins, Noodle's coil, the stall awning. The GLB reader ignores skins, so nothing is rigged in Blender.
5. **The building boots without a plot.** `new ReptileHouse(collision, anchorPlots, interiorControls, surfaces, { plot: PlacedEntry | null, … })`: with `null` it builds the interior, the deep links and the checks, skips the facade, and `leaveToPark` falls back to the plaza spawn. The exterior lights up the day the placement agents add the manifest entry.

## 1. Names, ids, constants (one owner each)

**All numeric constants in this table live in `src/world/reptileHouse/layout.ts`** (a leaf module that imports nothing, like `hotel/towerDimensions.ts`). The spec's original split into `shellDimensions.ts` / `constants.ts` was folded into that one file so that there is exactly one owner for Blender scripts, the game and the checks to read.

| Constant / id | Value | Owner |
|---|---|---|
| `SPACE_REPTILE_HOUSE` | `'reptileHouse'` | `src/world/spaces.ts` (own radius test in `spaceAt`, radius `REPTILE_HOUSE_SPACE_RADIUS = 70` from `layout.ts`, same as `HOTEL_ROOM_RADIUS`) |
| `REPTILE_HOUSE_ORIGIN_X` / `_Z` | `600` / `-600` | `layout.ts` — plain literals. 1200 m to castle floor 0 (600,600; r 120), 1706 m to the hotel lobby (−600,613; r 70), 849 m to the garden; all past `FOG_FAR` 258 |
| `REPTILE_HOUSE_FLOOR_Y` | `0` | `layout.ts` |
| `REPTILE_HOUSE_PLAY_RADIUS` | `32` | `layout.ts` (plate corner is √(24²+18²) = 30.0 m out) |
| `REPTILE_HALF_X` / `REPTILE_HALF_Z` | `24` / `18` (48 × 36 m plate) | `layout.ts` |
| `REPTILE_WALL_HEIGHT` | `4.2` | `layout.ts` |
| `REPTILE_DOOR_X` | `6` (south wall gap `[4.7, 7.3]`, using the hotel's `DOOR_HALF` 1.3 by import at the point of use in `shell.ts`) | `layout.ts` |
| `REPTILE_SHELL_RADIUS` | `9.4` | `layout.ts` (Blender reads it with `ts_const`, the loader asserts the plinth against it) |
| `REPTILE_DOOR_BAND_OUTER` | `REPTILE_SHELL_RADIUS + 0.2` | `layout.ts` |
| `REPTILE_DRAWN_DOOR_ALONG` | `REPTILE_SHELL_RADIUS - 1.2` | `layout.ts` |
| `REPTILE_TAIL_REACH` | `11.2` | `layout.ts` |
| `REPTILE_BABY_SNAKE_UNIT` | `0.5` (Noodle-o-meter rung) | `layout.ts` |
| Anchor / stall id / deep link | `reptileHouse` / `reptileHouse` / `/reptile-house` | `anchors.ts` (placement agents), `main.ts`, `Game.ts` |
| Sign title / subtitle / glyph | `Reptile House` / `Say hi to the snakes!` / 🐍 | anchor copy (placement agents) |
| Stall / chip | `Scales & Tails` / `Snake toys` | `shops/catalogue.ts`, `stallShape.ts` |
| Exterior snake / interior python | `Sunny` / `Noodle` | `EXHIBITS` table |
| Secret | `secret.snakeSpotter`, name `Snake spotter`, icon 🐍, done `You found all five hiding baby snakes!` (40) | `state/secrets.ts` |
| HUD floor pill | `Reptile House` | — |

`spaceOrigins.ts` gets one row `{ x: REPTILE_HOUSE_ORIGIN_X, y: REPTILE_HOUSE_FLOOR_Y, z: REPTILE_HOUSE_ORIGIN_Z }`. `up.ts` and `stepReach` need nothing: they ask `spaceAt`. GAME_DESIGN.md's "snake room inside the castle" entry is updated in the same PR to point here (the floor it was planned for no longer exists).

## 2. Exterior — "Sunny, the snake who is the building"

A squat round hothouse **18.8 m across, 10.5 m tall**: a friendly mint snake coiled three times round a cream greenhouse, head resting on top looking at the camera (sunbathing — that is why she is on the roof), tail curling down beside the door as the signpost. GAME_DESIGN's novelty-architecture rule applied literally. Numbers building-local; the plot is `cameraFacing: true` so the door and the head both face +X+Z.

| Part | Numbers | Colour (palette only) |
|---|---|---|
| Plinth | 16-gon disc r 9.4 × 0.3 m — publishes `REPTILE_SHELL_RADIUS` (16-gon flats at cos(π/16)·R; circumradius is the collider) | `stonePink` |
| Coils | three `sweep_path` turns, ring radii 8.1 / 6.9 / 5.7 at heights 1.3 / 3.6 / 5.7, tube radii 1.3 / 1.15 / 1.0, 16 sides; thinner interpenetrating belly sweep; 20 flat-ellipsoid spots | body `ART.snakeMint`, belly `ART.snakeBelly`, spots `PALETTE.markerLilac` |
| Greenhouse walls between coils | cream `revolve`, 12 round portholes, emissive at night like the hotel's windows | `buildingWall`, panes `buildingWindowWarm` |
| Head | ellipsoid 4.2 × 3.4 × 3.0 on the top coil, y 7.2–10.2, facing the door bearing; **face baked into the head node's own UVs** (`glbCanvasTexture`, v = (hi − z)/h to beat the exporter's 1−v flip): huge low eyes, two catchlights, w-smile, blush; separate `rh-tongue` node | `snakeMint`, face canvas 512² (1 of the 6 new canvases) |
| Entrance | round "snake hole" arch 3.4 wide × 3.6 tall in the bottom coil (rounded-profile revolve), giant leaf awning 4 × 2.5 over it, forked-tongue doormat decal 1.6 × 1.0 on the paving the plot's `door: { reach, pavedTo }` lays | arch `stonePink`, awning `leafLight`, mat `markerPink` |
| Tail signpost | S-curve rising 4 m beside the door, base at bearing facade+28°, r 10.4 from the centre; bell-rattle; the anchor sign hangs from it | `snakeMint`, bell `flowerYellow` |
| Night | portholes glow; 8 fairy bulbs along the bottom coil (`fairyWarm`); after 21:00 the face swaps to its "asleep" frame — magical, not frightening | — |

**Exterior interaction:** one `pressZone` at the tail base, pickRadius 2.2, chip **Tickle tail!** → the head on the roof sways 6°, winks (face frame swap), tongue flicks. Band-to-zone distance √(10.4² + 9² − 2·10.4·9·cos 28°) ≈ 4.9 m, so `check:tap-spacing` is clear. `highlight: highlightObject(tailRoot)`.

**Exterior collider** (closed geometry, never trimmed angles — `registerTowerCollision` precedent): 16 `addWall` chords at r 9.4, halfThickness 0.3; one aperture 3.2 m wide at the facade bearing; two jambs 1.6 m out past the arch; a back wall 2.0 m inside the aperture, 5 m long (a sprinter covers `PLAYER_LONGEST_STEP` 0.925 m per clamped frame and stops on it while the iris closes); tail base `addCircle` r 0.6. Head, coils, awning: no collider (inside the ring or overhead).

**Door band:** centre at `REPTILE_SHELL_RADIUS − 0.4` along the facade bearing, halfAlong 1.3, halfAcross 0.6, `ownZoneId: 'reptile-entrance'`. Exterior `InteractZone` with **no actions**, `standX/Z` = band centre, `pickRadius = max(REPTILE_SHELL_RADIUS, distance to entrance) + 1` (the hotel's derivation, not a second literal).

**For the placement agents (numbers only, not this effort):** manifest `{ id: 'reptileHouse', footprint: { kind: 'circle', radius: REPTILE_FOOTPRINT_RADIUS }, boundingRadius: REPTILE_BOUNDING_RADIUS, band: { min: 10, max: 90 }, door: { reach: REPTILE_DOOR_BAND_OUTER, pavedTo: REPTILE_DRAWN_DOOR_ALONG }, cameraFacing: true }` (10.5 and 11.5, both in `layout.ts`); `AnchorId` gains `'reptileHouse'`; sign copy as §1. The park needs roughly one more plot of ≈ π·11.5² m² plus `BOUNDARY_CLEARANCE`; `GARDEN_PLAY_RADIUS` is `58 * PARK_SURFACE_SCALE`, so change the owner of the park's area, never a copy, and judge the change by many-seed solve-rate with `check:park` and `test:procgen` (`everyDoormatIsReachableFromTheGate` picks up the tongue mat once `door` is declared). Nothing in this spec depends on placement: the building is reachable through `/reptile-house` before it has a plot.

## 3. Interior plan — "the Coil"

**Plate 48 × 36 m** (`halfX 24, halfZ 18`), walls 4.2 m centred on the plate edge with the hotel's `WALL_HALF_DEPTH` 0.25 (inner faces x = ±23.75, z = ±17.75), south and east `nearWallsHidden` (built, solid, `mesh.visible = false`). Open-topped; three greenhouse rib arches at 6–7 m overhead, no colliders; `roofed: true` so the jet pack is off. Floor: one `Plate` via `WalkSurfaces.addPlatform`, `buildingFloor` toon; beds `barkDark` soil with `stonePink` 0.12 m painted kerb rims (no collider — ankle-high, below `BUILDING_STEP_UP` 0.62; the bed's own collider is the plant mass, §8); paths a `pathSand` decal at `DECAL_STEP` 0.02 built from the `PATHS` polylines. **The path network is painted as one long smiling snake** — darker `pathSandDark` scale scallops (instanced flat ellipses) along every path, a 2 m flat smiling head decal at the arrival spot, the tail tip at the grotto — geometry only, no canvas.

**Door:** south wall gap x ∈ [4.7, 7.3]. Exit `PortalBand` centre (6, 18.0), halfAlong 1.3, halfAcross 0.6, `kind: 'exit'`. **Arrival: `teleportTo(ox + 6, 0, oz + 15.8, π)`** — 2.2 m inside, facing north (180), the lobby's recipe.

**Concept:** a 4 m ring path round Noodle's Rock in the centre; four openings (south to the foyer, west into the Hollow Log short-cut, north to the Wall of Windows, east onto the Lagoon Walk); an outer circuit (West Strip → NW link → North Strip → NE Clearing → East Strip → SE Channel → foyer); and a south-west loop past the Frog Jar, Iguana Rocks and the Grotto. **Five independent cycles, no dead ends.** First frame on arrival: Noodle's face on her rock 17 m ahead, looking straight at her; behind, the north wall glowing with five lit cases.

### 3.1 Plan (approximate; 2 m cells; north at the top; the tables below are authoritative)

```
     x: -24 -22 -20 -18 -16 -14 -12 -10  -8  -6  -4  -2   0   2   4   6   8  10  12  14  16  18  20  22
z-18   G   G   G   p   N   N   N   N   N   N   N   N   N   N   N   N   N   N   N   N   T   T   T   T
z-16   G   G   G   :   :   :   :   :   :   :   :   :   :   :   :   :   :   :   :   :   T   T   T   T
z-14   G   G   G   :   :   :   :   :   :   :   :   :   :   :   :   :   :   :   :   :   T   T   T   T
z-12   w   :   :   :   :   .   .   .   .   .   .   :   :   .   .   .   .   :   :   :   :   :   :   :
z-10   w   :   :   .   .   .   .   .   .   .   .   :   :   .   .   .   .   :   :   :   :   :   :   :
z -8   w   :   :   .   .   .   .   .   .   .   .   :   :   .   .   .   .   :   :   :   :   :   :   :
z -6   w   :   :   .   .   .   .   .   .   o   o   o   o   o   o   .   .   L   L   L   L   L   :   :
z -4   w   :   :   .   .   .   .   .   o   o   o   I   I   o   o   o   .   L   L   L   L   L   :   :
z -2   w   :   :   :   =   =   =   :   o   o   o   I   I   o   o   o   .   L   L   L   L   L   :   :
z  0   w   :   :   :   =   =   =   :   o   o   o   I   I   o   o   o   :   :   :   :   :   :   :   :
z  2   w   :   :   .   .   .   .   .   o   o   o   I   I   o   o   o   :   :   :   :   :   :   :   :
z  4   w   :   :   .   .   .   .   .   .   o   o   o   o   o   o   .   .   .   .   U   U   :   :   :
z  6   .   :   :   .   .   .   .   F   F   .   .   o   o   o   .   .   .   .   .   U   U   :   :   :
z  8   .   :   :   :   :   :   :   :   :   :   :   :   :   :   :   .   .   .   .   U   U   :   :   :
z 10   .   :   :   :   :   :   :   :   :   :   :   :   :   :   :   :   :   :   :   :   :   :   :   :
z 12   R   R   R   R   R   Q   Q   .   .   .   :   :   :   S   :   :   :   M   :   :   .   .   .   .
z 14   R   R   R   R   R   Q   Q   .   .   .   :   b   :   :   :   :   :   :   .   .   .   .   .   .
z 16   R   R   R   R   R   Q   Q   .   .   .   :   :   :   :   D   D   :   :   .   .   .   .   .   .
```
`:` path / open floor · `o` ring path · `=` Hollow Log · `.` planted bed · `I` Noodle's Rock · `N` north cases · `w` west cases · `G` Snake Grove · `T` Tortoise Garden · `L` Snappy's Lagoon · `U` Nursery · `F` Frog Jar · `Q` Iguana Rocks · `R` Grotto · `S` stall · `M` Noodle-o-meter · `b` hidden-baby pot · `D` door · `p` corner palm.

### 3.2 Path graph (the `PATHS` table in `layout.ts` owns these; floor paint, the width probe and NPC routes all read it)

| Path | Clear region / centreline | Width |
|---|---|---|
| Foyer | open floor x ∈ [−3, 16] south of the ring arc (x ≤ 6) and of the SE island bed (z ≥ 9.1 for x ∈ [6, 16]); arrival (6, 15.8) | 9 m deep |
| Ring | annulus r ∈ [3.6, 7.6] around (0, 0) | **4.0** |
| South opening | ring → foyer for x ∈ [1, 6] | 5.0 |
| Log Walk (west opening, short-cut) | z ∈ [−1.65, 1.65] from x = −7.6 to −17.5; the Hollow Log spans x ∈ [−16, −10] | **3.3** (log inside 3.3 wide × 3.3 high) |
| North channel | x ∈ [−1.8, 1.8] from z = −7.6 to −11.0 | 3.6 |
| Lagoon Walk (east opening) | z ∈ [0, 3.6] from x = 7.6 to 20.0 | 3.6 |
| West Strip | x ∈ [−21.15, −17.5], z from −11.5 to 12.5; centreline x = −19.3 | 3.65 |
| NW link | polyline (−19.3, −11.0) → (−16.0, −13.0) → joins the North Strip | 3.0 (grove edge 1.87 m off the centreline; bed corner 1.79 m) |
| North Strip "Wall of Windows" | z ∈ [−15.15, −11.0], x from −16 to 15; centreline z = −13.0 | 4.05 |
| NE Clearing | x ∈ [10, 20], z ∈ [−11.7, −6.0] (between the Tortoise Garden and the Lagoon) | 5.7 |
| East Strip | x ∈ [20, 23.75], z from −11.7 to 3.6 | 3.75 |
| SE Channel | x ∈ [18.1, 23.75], z ∈ [3.6, 9.1] (east of the Nursery), then west along z ∈ [9.1, 12.5] for x ∈ [16, 23.75] into the foyer | 5.65 / 3.4 |
| SW Walk | z ∈ [8.95, 12.5], x from −19.3 (West Strip's south end) to −3 (foyer); centreline z = 10.7 | 3.25–3.55 |

Width rule: ≥ 3.0 m between opposing colliders everywhere (2 × `PLAYER_RADIUS` = 1.24, so two children pass anywhere), proved by the width probe (§10), not by the drawing. Path length ≈ 180 m.

**Sightlines (raked-theatre rule):** tall things only where their 1.28·H shadow-cone lands on a wall or inside an enclosure: palms (5.5 m) only in the W-S bed, the Grotto corner and beside the Snake Grove; the banyan (6 m) is in the NW corner; the hollow log (4 m) hides only the NW island bed; in the north 2 m of the NW/NE island beds planting ≤ 1.0 m, 1.6–2.2 m plants ≥ 3 m south of a bed's north edge; near-side beds (SE corner, SW-E) ≤ 1.2 m; nothing taller than 1.6 m on Noodle's Rock except Noodle; no wall cases on the east or south walls (their fronts would face away from the camera).

## 4. Exhibits (15 — 8 glass wall cases, 1 glass jar, 1 glass-topped nursery pit, 4 open walled enclosures, 1 island)

**Glass wall case (G):** stadium plinth, segment 3.0 m, halfDepth 1.2 → 5.4 × 2.4 m, 1.1 m tall (`stonePinkLight`, outline 0.02); glass panes (`glassMaterial(0.24)` from `building/parts.ts`, one shared material, `castShadow = false`) from 1.1 to 2.9 m on the front and both ends, recessed 0.06 inside the frame; painted-jungle back board with an emissive `buildingWindowWarm` toon backdrop (the case reads as a glowing window from across the room); 0.2 m frame rim at 2.9 m; **open-topped** so the camera sees in. North-wall plinths: centreline z = −16.35 (back face −17.55, 0.2 m off the wall face, slit unreachable), front face z = −15.15, stand spots z = −13.4. West-wall plinths: centreline x = −22.35, front face x = −21.15, stand spots x = −19.5. Gaps between plinths (0.85 m north, 0.4 m west) are sealed by vine-wrapped pier posts (disc r 0.45) at the gap centres: north x = −9.375, −3.125, 3.125, 9.375 (z −16.35); west z = −4.6, 1.2 (x −22.35).

**Open enclosure (O):** 1.4 m rounded ring/stadium wall (`stonePink`, lathe profile), planted inside; animals idle in the far 60 % because the near wall hides 1.28 × 1.4 = 1.8 m of its own floor.

Every exhibit: a nameplate on the plinth/wall front (no post, no collider; copy from the `EXHIBITS` table that `scripts/check-copy-brevity.mts` is extended to walk — title ≤ 24, blurb ≤ 50, never inline at a call site), one `pressZone({ id, label, x, y: 1, z, pickRadius: 2.4, standX, standZ, highlight: highlightObject(animalRoot) }, action, glyph, chip)` whose chip is a short call-to-action, and a Cute-o-dex deed when all fifteen have been greeted (`secret.metTheReptiles`, name `Reptile friend`, icon 🦎, done `You said hi to every animal in the house!`).

| # | Title | Blurb | Type / where (local) | Stand spot | Animals · size · colours | Idle · chip → reaction |
|---|---|---|---|---|---|---|
| X0 | Noodle | The biggest, kindest python in the whole park. | island disc r 3.6 at (0, 0): kerb r 3.4 × 0.5, mossy rock mound to 1.6 m, big-leaf ring 1.4–1.8 m; Noodle coils 3 turns up the mound, body r 0.42, coil top 2.6; head 1.3 L × 0.9 W × 0.8 H chin-down on the kerb at (2.3, 2.3), 0.5 m up, rotation.y 45° (faces the arrival); burrow rim at (3.0, −0.8) where her body goes underground | (3.5, 3.5), facing 225 | 1 giant python, `snakeMint` + `snakeBelly`, `markerLilac` spots | breathes (body scale ±1.5 % at 0.25 Hz), head turns ≤ 20° to track her within 6 m, tongue flicks · **Say hi!** → head lifts 0.4 m, eyes "happy", tongue blep, heart puff, bubble "Hisss-ello!" |
| N1 | Ribbon the Rainbow Boa | She shimmers every colour when she moves. | G, centre (−12.5, −16.35), front +Z | (−12.5, −13.4) | 1 boa 3.2 m, r 0.2, per-segment `instanceColor` bands `markerPink/Sky/Lemon/Lilac/Mint`, over a branch | slow slither · **Shimmer!** → bands ripple head-to-tail, she crawls one loop |
| N2 | The Hatchery | Something wriggly is about to hatch. | G, (−6.25, −16.35) | (−6.25, −13.4) | 6 eggs 0.35 m `cream` in straw, 3 cracked, 3 hatchlings 0.3 m | eggs wobble (rotation.z sin 6°), hatchlings wriggle out and back · **Shh!** → an egg wobbles hard and a 4th head pops out, "peep" |
| N3 | The Stripeys | Three corn snakes who love climbing. | G, (0, −16.35) | (0, −13.4) | 3 corn snakes 1.6 m, `cornOrange` with `cornSaddle` saddles, `snakeBelly`, climbing branches | climb/slither between 3 branch anchors · **Wiggle!** → all three slither to the glass and look at her |
| N4 | Cammy the Chameleon | Say peekaboo and watch her change colour. | G, (6.25, −16.35) | (6.25, −13.4) | 1 chameleon 0.9 m on a diagonal branch, spiral tail, two independent eye spheres | colour lerps `leafMid → markerMint → blossomPink` over 20 s; eyes re-aim every 1.5 s · **Peekaboo!** → rainbow through 5 palette colours in 2 s, eyes cross, tongue zap (cylinder scaled 0→1.2 m in 0.12 s) at a fly sprite |
| N5 | Gecko Wall | Five geckos who can walk upside down. | G, (12.5, −16.35) | (12.5, −13.4) | 5 geckos 0.35 m `leafLight` with `flowerYellow` spots, on the back board, one upside down on the rim | each scuttles 0.4 s to its next anchor every 3–6 s · **Hello geckos!** → all scurry, one drops and lands on its feet |
| W1 | Emmy the Tree Snake | She loves to dangle. Say hi and she drops by. | G, (−22.35, −7.5), front +X | (−19.5, −7.5) | 1 emerald tree snake 2.4 m, r 0.14, `leafMid`/`leafLight`, 3 loops on a branch | loops sway · **Say hi!** → head drops to the glass, tongue flick |
| W2 | Minty the Milk Snake | Minty hides in her log. Can you spot her? | G, (−22.35, −1.7) | (−19.5, −1.7) | 1 milk snake 2.0 m, r 0.12, bands `markerMint / cream / blossomPink`, hollow log | inside the log, tip of tail showing · **Peekaboo!** → head pops out of the log end, blinks |
| W3 | Smudge the Skink | Smudge has a big blue tongue. Say hi! | G, (−22.35, 4.1) | (−19.5, 4.1) | 1 blue-tongue skink 0.9 m, `biscuitFur` | ambles 1 m left/right · **Say hi!** → huge `markerSky` tongue for 0.6 s |
| O1 | Snake Grove | Six green snakes who sway in the banyan. | O, disc r 2.4 at (−20.6, −15.2), wall ring r 2.3; 6 m banyan inside (Kit plants `rp-banyan`) | (−17.8, −12.4), facing 315 | 6 tree snakes 1.4 m, `leafDeep` with `flowerYellow` collars, hanging in S-curves | sway (phase-offset sine) · **Hiss hello!** → one slides down the trunk and back up, all six heads turn |
| O2 | Tortoise Garden | Grandpa Tock is 102 and in no hurry. | O, stadium (18, −14.6)→(21, −14.6), half 2.9 → x ∈ [15.1, 23.9], z ∈ [−17.5, −11.7] (east end sunk into the wall) | (17.5, −9.6), facing 180 | Grandpa Tock 1.2 m (`shellOlive` shell, `biscuitMuzzle` skin) + 2 small 0.5 m; **hidden baby #4 rides on Tock's shell** | Tock walks a 6 m Catmull-Rom loop at `applyWalk` speed 0.15; the two small ones sleep · **Say hi!** → Tock stretches his neck and blinks very slowly; second chip **Found you!** (until found) |
| O3 | Snappy's Lagoon | A crocodile with the friendliest yawn. | O, stadium (13, −3)→(17, −3), half 3.0 → x ∈ [10, 20], z ∈ [−6, 0]; water inside, rock island at (15.5, −3.8), 8 lily pads | (15, 1.8), facing 180 | Snappy 3.6 m, `leafDeep` back, `cream` belly, four rounded cream "bumps" (no teeth), stubby legs; baby croc 1.2 m on the island | floats, y ± 0.05 at 0.3 Hz, 3-point drift loop, tail sways, yawns (jaw hinge −0.5 rad over 1.2 s) every 18–30 s; surfaces at (14, −2.4) when she is within 3 m of the stand · **Wave!** → yawns now, waves a front claw, 6 bubbles from a fixed pool of 12 |
| O4 | Iguana Rocks | Two iguanas doing push-ups in the sun. | O, disc r 2.4 at (−12, 15.3), rock pile | (−12.5, 10.9), facing 0 | 2 iguanas 1.3 m, `leafDeep` with `leafLight` crest | one does 3 push-ups (head bob) every 5 s · **Say hi!** → both push-up together, crests flare |
| U | The Nursery | Twelve baby snakes, snoozing on mum's tail. | glass-topped pit: disc r 2.6 at (15.5, 6.5), 0.6 m `stonePink` kerb + glass panes to 1.5 m; **Noodle's tail** (2.4 m, 6-segment TS chain) emerges from a mound at (14.5, 6.0) and curls to (16.5, 7.5); pink heat lamp | (20.4, 6.5), facing 270 | **12 babies in 3 sizes: 4 × 0.3 m (5 seg, r 0.05), 4 × 0.5 m (7 seg, r 0.07), 4 × 0.8 m (9 seg, r 0.09)**, four colourways (`snakeMint`, `snakeCoral`, `cornOrange`, rainbow bands), heaped on the tail | all wriggle (travelling sine, random phase, group scale.y ±3 % at 0.8 Hz) · **Tickle tail!** → tail wiggles 2 s, babies tumble at ×3 amplitude, and **Noodle's head 14 m away pops up "surprised" then "Hee hee!"** · second chip **Adopt a snake!** → opens the nursery shop stand (§6) |
| F | Frog Jar | Five leaf frogs who sing when you ask. | round glass drum r 1.6 at (−8, 7.2), base 0.6, glass to 2.9, open top; twig, 6 lily pads, mini waterfall; **hidden baby #5 wears a lily pad as a hat** | (−7.5, 10.8), facing 180 | 5 leaf frogs 0.3 m, `leafLight` with `flowerRed` toes, one pressed to the glass | hop pad-to-pad every 3–7 s (parabola 0.4 high, 0.6 long, 20 % squash), one croaks (throat-sac scale pulse) · **Ribbit!** → staggered hop chorus, bubble "ribbit" · second chip **Found you!** |

**The delight threads**

- **Noodle's tail reveal** (cause and effect across 14 m): the head on the rock and the tail in the nursery are two nodes of one creature; `Tickle tail!` drives both, and at default zoom both are on screen at once. A six-year-old will run back and forth to check it is really the same snake.
- **Five hidden babies → `secret.snakeSpotter`.** Each is a small head that peeks (0.06 m bob) when she is within 5 m and pops fully out on `Found you!` with hearts and a bubble "3 of 5 babies found!". #1 in the Hollow Log's knothole, zone (−13, 0); #2 in the Grotto pool, zone (−19.3, 11.0); #3 in a tall-banana planter pot in the foyer at (−1, 14.5); #4 on Tock's shell and #5 in the Frog Jar (second actions on those zones). All five → `discoverSecret('secret.snakeSpotter')`.
- **The Hollow Log:** a walk-through ¾ tube (inner r 1.65 → 3.3 m clear, above `TALLEST_CHILD_HEIGHT` 2.97; outer r 2.0; length 6 m), the upper-south quarter cut away so the camera sees her inside; 20 instanced emissive glow-worm dots (`markerMint`) that brighten as she enters (proximity ≤ 4 m, hysteresis 1 m). "Crawl through, like a snake would."
- **Noodle-o-meter** at (10.5, 13.5) in the foyer: a post with a snake coiled up it, rungs every `REPTILE_BABY_SNAKE_UNIT` 0.5 m. Chip **How tall?** → bubble "You are 4 baby snakes tall!" = `Math.round((KID_HEIGHT + wornHatHeight) / REPTILE_BABY_SNAKE_UNIT)` (2.12 → 4; the tallest hat 2.97 → 6). Hats change the answer, so she tries them all.
- **Surprises round corners** (proximity ≤ 4 m): the log lights up; Snappy surfaces at the stand; Tock is already plodding toward her; the north cases are hidden behind Noodle's Rock until the north channel, then appear as a row of lanterns; the Grotto's waterfall mist light brightens.

**Zone spacing (closest different-action pairs):** iguana ↔ frog 5.0 m; grove ↔ W1 5.2; grove ↔ N1 5.4; stall stand ↔ door band 4.2 (band 3.2 m from the stand, pickRadius 2.4 does not reach it); tortoise ↔ N5 6.3; lagoon ↔ nursery 7.1; north cases 6.25 apart; west cases 5.8 apart. No zone's pickRadius covers the door band but the door zone that owns it.

## 5. Vegetation — all instanced

Module-level singleton geometry per node from the `plants` kit, one `InstancedMesh` per part plus one outline instance per species (the `treeModel.ts makeInstanced` pattern), seeded `Rng`, `castShadow = false` for everything indoors.

| Kind | Count | Instances | Collider | Where |
|---|---|---|---|---|
| Palm (`rp-palm-trunk` + 7 × `rp-palm-frond`) | 8 | 8 + 56 | disc r 0.45 at the trunk | W-S bed (−22.5, 8), (−22.5, 11); Grotto corner (−22, 15), (−18.5, 16.5); corner palm (−16.5, −16.5) r 0.6 (seals the N1–grove nook); beside the grove (−22.5, −11.5); SE corner none |
| Banana (`rp-banana-leaf` × 3) | 8 | 24 | inside beds | NW/NE island beds ≥ 3 m from their north edge, SW bed, foyer pot |
| Monstera (`rp-monstera-leaf` × 4) | 14 | 56 | inside beds | bed edges facing paths, Noodle's Rock ring |
| Fern (`rp-fern-frond` × 6) | 70 | 420 | none (knee-high, soft) | every bed; the north 2 m of the island beds |
| Heliconia (`rp-heliconia`) | 14 | 14 | inside beds | NE island, SW bed (red hanging flowers = colour pops for the camera) |
| Vine strand (`rp-vine-strand`) | 30 | 30 | none (≥ 3.2 m clearance over paths; `TALLEST_CHILD_HEIGHT` + 0.2) | from the rib arches, the pier posts, the west wall |
| Lily pad (`rp-lily-pad`) | 20 | 20 | none | lagoon 8, frog jar 6, grotto pool 6 |
| Moss rock (`rp-rock-a/b/c`) | 30 | 30 | disc = circumradius, top measured ≤ 0.7 → standing Plate (she can hop onto a rock; none within 2.5 m of any 1.4 m wall or 1.5 m rail, so no rock is a step over an enclosure) | bed edges, grotto, inside enclosures (no collider needed there) |
| Log small (`rp-log-small`) | 8 | 8 | one thick wall half 0.3, top 0.6 absolute **with a standing plate** | beds beside paths (SW bed, NW island), inside W2, N3, meadow |
| Hollow log (`rp-log-hollow`) | 1 | 1 | two thick walls half 0.3 at z = ±1.95, x ∈ [−16, −10] | Log Walk |
| Banyan (`rp-banyan`) | 1 | 1 | inside the grove disc | Snake Grove |
| Ground-cover tufts (TS blobs) | 300 | 300 | none | beds |
| Flower tuft (existing `hotel/dressing.ts flowerTuft`) | 24 | — | none | foyer, bed fronts |

Beds are the colliders (§8); plants inside beds have none except palm trunks. ≈ 16 draw calls, ≈ 40 k triangles for the whole jungle.

## 6. The stall and the nursery stand — "Scales & Tails"

**Stall** at (2, 13), `rotation.y = 45°` so the counter faces +X+Z (the camera): counter from `shops/kiosk.ts buildKiosk` with a `stallShape.ts` entry (snake-scale scalloped awning from the `stall` kit, its edge a coiled snake with a smiling head at the near corner, a coiled-snake finial on the back panel), stock on `fitouts.ts` shelves (plush pile, hat stand, balloon bunch, jelly jars), keeper via `createKeeper({ colour: PALETTE.leafMid })`, green apron. Stand spot (3.6, 14.6) = `COUNTER_Z` + reach along the facing. Chip is what it sells: `pressZone({ id: 'reptileStall', label: 'Scales & Tails', pickRadius: 2.4, standX, standZ }, () => controls.openShop('reptileStall'), '🛍️', 'Snake toys')`. Colliders: counter = one thick wall (half 0.5, full height), back panel = one thick wall (half 0.3), overlapping so the keeper's pocket (keeper disc r 0.5 at (1.3, 12.3)) is sealed — proven unreachable in §10.

**Nursery stand:** the **Adopt a snake!** chip on the Nursery zone is a second `ShopStand` `{ id: 'reptileNursery', title: 'The Nursery', glyph: '🐍', greeting: 'Who wants to come home with you?', accent: ART.snakeMint, deck: 0, x, z, y: 0 }` at the nursery stand spot, carrying only the three pets, so `itemsForShop` splits the two panels for free.

**Buying = the existing panel, three small edits** (`Shopping.openShopById` only searches `world.building.shops.stands`):
1. `catalogue.ts`: `ShopItem['shopId']` gains `'reptileStall' | 'reptileNursery'` beside `'keychainStall' | 'roofGarden'`; `itemsForShop(shopId: ShopItem['shopId'])`.
2. `Shops.ts`: `ShopStand.id: ShopItem['shopId']`.
3. `World.shopStands()` = `[...building.shops.stands, ...reptileHouse.stands]`; `Shopping.openShopById` reads that. The panel, `gameStore.buy(specFor(item))`, the chime, hands, parade and "Collect" wording (`state/wording.ts`) all come for free.

| id | displayName | kind / category | price | icon | blurb | model |
|---|---|---|---|---|---|---|
| `toy.noodlePlush` | Noodle Plush | toy / toy, carryable, heldScale 0.4 | 30 | 🧸 | Soft, stripy and very huggable. | `createNoodlePlush()` — 1.2 m coiled soft snake, `snakeMint` + `snakeBelly`; parade hopper |
| `hat.snake` | Snake Hat | hat / hat | 35 | 🐍 | A snake that sits on your head and smiles. | `HatKind` gains `'snake'`: a coiled baby snake, head peeking over the brow; one `HAT_KINDS` entry → `check:hat-fit` covers it; PREVIEW rule satisfied by character creation |
| `balloon.snake` | Snake Balloon | balloon / balloon | 10 | 🎈 | A long wobbly snake on a string. | 1.8 m wavy balloon |
| `candy.jellySnakes` | Jelly Snakes | treat / candy | 10 | 🍬 | A bag of three, best eaten slowly. | bag with three jelly snakes (eaten outcome exists) |
| `pet.snakeMint` / `pet.snakeCoral` / `pet.snakeRainbow` (rare, like rainbow floss) | Minty Snake / Coral Snake / Rainbow Snake | pet / pet, `shopId: 'reptileNursery'` | 30 | 🐍 | A wiggly friend who follows you everywhere. | `createSnake` in pet trim: `PetKind` gains `'snake'`; the colourway is chosen by each catalogue entry's `model` closure (as `ICE_SCOOPS` picks flavours) — if `gameStore.buy`'s pet spec keys on `PetKind` alone, make it three kinds `snakeMint | snakeCoral | snakeRainbow` rather than threading a second field |

**Pet snake:** a 7-segment slitherer that rests in an S with its head reared to ~1.0 m of the 1.46 m `PET_RENDER_HEIGHT` standard — `sizeToStandard` measures *height*, so a flat snake would be scaled ×5; the reared pose is what makes the measurement honest (measured with `visibleBounds`, sizer group between root and body). Walks in the parade as a "hopper" (slither bob) via `setWalkPhase`. Appears in the Cute-o-dex like any pet. The pet she adopts is the same `createSnake` the nursery shows.

## 7. Lighting — warm hothouse at golden hour, constant day and night

Inside `reptileRoot` (costs nothing outdoors), copying `hotel/lighting.ts`, not the castle's plate-framed `InteriorLighting`:
- `DirectionalLight(PALETTE.buildingWindowWarm, 1.4)` from direction (+0.5, 1, +0.7) (over the camera's shoulder so the faces the camera sees are the lit ones), no shadows.
- `HemisphereLight(PALETTE.markerMint, PALETTE.barkDark, 0.6)` — green bounce from the canopy.
- 6 `PointLight(PALETTE.fairyWarm, 3.2, 30, 1)` at height 5.0 at (−14, −8), (0, −10), (14, −8), (−10, 9), (8, 12), (18, 0); the nursery's lamp is `fairyPink`; the grotto's waterfall light `fairyBlue`.
- Per case a "heat lamp": a `glowTexture` sprite (`decal()`) on the frame rim — emissive look, no light. Case backdrops emissive `buildingWindowWarm` 0.5 so the north wall reads as lanterns.
- Water: toon `waterTop` with emissive 0.15; glass frames `liftFrame` gold.
- `World.playerInAnyInterior` becomes `building.playerInRoofedInterior || hotel.playerIsInside || reptileHouse.playerIsInside` so the sun goes off indoors. No day/night, no fog, no shadow maps indoors.

## 8. Collider plan (every drawn thing is solid; one owner for stand spots)

All registered in the same commit as the mesh through one `placeProp()` copied from `hotel/place.ts` (one footprint → collider + keep-out + optional standing plate; `top` required).

| Thing | Collider | Top |
|---|---|---|
| Room shell | 4 walls via `segmentsMinusGaps`, halfThickness 0.3, door gap [4.7, 7.3] on the south | ∞ |
| Noodle's Rock | `addCircle` r 3.6 at (0, 0) — solid disc (head and burrow inside it) | 2.4 absolute (the big-leaf ring is the visible solid) |
| Glass wall case (×8) | one `addWall(end, end, 1.2)` per plinth (segment 3.0) | 2.9 absolute, no plate |
| Pier posts (×6) | disc r 0.45 | ∞ |
| Frog Jar | `addCircle` r 1.75 (1.6 + frame) | 2.9 |
| Snake Grove, Iguana Rocks | `addCircle` r 2.4 — **solid discs** | 1.4 absolute |
| Lagoon | one `addWall((13,−3),(17,−3), 3.0)` — solid stadium | 1.4 |
| Tortoise Garden | one `addWall((18,−14.6),(21,−14.6), 2.9)` — solid stadium, east end inside the wall collider | 1.4 |
| Nursery | `addCircle` r 2.6 | 1.5 absolute (kerb 0.6 + glass; above `JUMP_APEX_HEIGHT`) |
| Planted beds (B1 NW island, B2 NE island, B3 SW bed, B4 SE island, B5 SW-E, B6 Grotto, B7 W-S, B8 SE corner) | boundary chains of `addCircle` r 1.2, centres ≤ 1.6 m apart (overlap ≥ 0.8), interior sealed by overlap; bed outlines exactly as §3.1/3.2 so every path keeps its width | 2.4 absolute (`topIsAbsolute`; beds hold planting ≥ 1.4 m, a jump never clears 1.28), no plate |
| Hollow log | two thick walls half 0.3 at z = ±1.95 | ∞ |
| Small logs | thick wall half 0.3 | 0.6 absolute **with plate** |
| Rocks | discs, circumradius | measured ≤ 0.7, with plate (never within 2.5 m of an enclosure wall) |
| Palm trunks, keeper, meter post, foyer pot | discs r 0.45 / 0.5 / 0.3 / 0.6 | ∞ (pot 2.4) |
| Stall counter / back panel | thick walls half 0.5 / 0.3, overlapping | ∞ |
| Ferns, tufts, lily pads, vines (≥ 3.2 m up), kerb rims, nameplates, path decals, small snakes, frogs, geckos, eggs, babies | **none** — stated reasons in code comments and in the check's walk-through list (knee-high soft plant; overhead; below `BUILDING_STEP_UP` 0.62; inside a sealed enclosure) | — |

`thinnestHalfWidth` stays 0.3 (the hotel's floor), so `maxSafeStep` is unchanged. `reptileKeepOuts()` is the single owner of where she must be able to stand: the arrival disc r 1.5, the doorway clearance zone (`doorwayClearanceZones` shape), all 15 exhibit stand spots (r 1.0), the stall and nursery stand spots, the three hidden-baby spots, every `PATHS` node. Every placement call asserts clearance of them and the constructor throws once at the end (`assertDoorwaysClear` pattern). Nothing in the constructor may touch `InteriorControls` (`park-harness` throws). Declared **sealed regions** (expected unreachable): every case plinth, the 4 enclosure interiors, the nursery, the jar, Noodle's Rock, every bed interior, the keeper's pocket, the three wall slits (behind the north/west plinths, behind the grove, the N5–tortoise wedge).

## 9. Animation — cheap by construction (no rigs; `update(dt, elapsed)` only while `playerIsInside`)

- **Snake rig** (`src/art/models/snake.ts`, `createSnake({ length, radius, colourway, pose }) → CreatureHandle`): N squashed-sphere segments (N = round(length / (radius·1.6)); 5–9 for babies, 12–16 for adults, 20 for Noodle's tail-and-coil chain), head = the `creatures` kit's `rr-snake-head` node under a sizer group (PAINTED: one shared snake-face canvas, neutral + blink = 2 textures, ink features on an opaque white fill so the material colour tints every colourway; `glbCanvasTexture`), forked tongue scaled 0→1 for 0.1 s every 4–9 s (seeded `Rng`, 0.04 m head nod). `update(dt)`: segment *i* lateral offset `A·sin(k·s_i − ω·t)` (A = 0.5·radius, k = 2π/0.8 m, ω 2.5 rad/s moving / 0.6 resting), head follows a precomputed 64-sample Catmull-Rom path at 0.15–0.3 m/s; `setWalkPhase(phase, speed)` drives the same wave so a pet snake walks in the parade.
- **Crowd instancing:** all adult body segments in the house = ONE `InstancedMesh` (≈ 250 instances, `instanceColor` per segment gives bands and the rainbow ripple for free) + one outline instance; all 12 babies + 6 grove snakes' segments = ONE (≈ 130); baby heads instanced; ≈ 400 matrix writes a frame, trivial. ≈ 24 draw calls for every snake in the building.
- **Faces:** snake face (1 canvas set); `sharedFacePatch('reptile', …)` 256² smile set shared by croc, tortoises, frogs, lizards, chameleon (1 set); Sunny's exterior face (1); one 1024 × 512 **sign atlas** for all 15 nameplates, the Noodle-o-meter board, the stall board and the anchor sign (1). **Six new canvases total**, cached by key; the game-wide budget is already over ~40, so this is the ceiling. All small snakes blink together on the shared material (cute). Blinks via `faceLife.ts`, textures swapped only on transitions. *Corrected 2 October 2026 (`layout.ts`/the code wins): there are **no nameplates** and **no painted words** — GAME_DESIGN's TEXT RULE and the 28 July ruling put names in DOM text, and a 0.2 m plate cannot carry a readable word; the atlas is three motif cells (768 × 768), one per authored plank at the plank's own aspect, and an exhibit's blurb is said in a bubble on its first hello. The reptiles' faces are geometry (ink eyes with two catchlights each), no `sharedFacePatch`.*
- **Noodle:** authored coil static; `body` breathes; head `Group` bobs, lifts and swaps expression by face frame; the tail in the nursery is a 6-segment TS chain. `Tickle tail!` fires both the tail burst and the head's "surprised → happy" sequence through one `NoodleState`.
- Eggs wobble; chameleon colour lerp + eye re-aim + tongue cylinder; croc jaw and tail are kit nodes whose origins are their hinges (the castle chest-lid precedent for a pure-translation node), yawn = rotation.x over 1.2 s, bubbles from a fixed pool of 12; tortoise `applyWalk` at speed 0.15 with leg stubs, head bob, slow blink; frogs parabolic hop with 20 % squash; geckos ease between anchors in 0.4 s; iguana push-ups (head bob); grove snakes phase-offset sway; vine curtain none. Every tap reaction is a ≤ 2 s state on the creature, no new UI. Heart puffs from the existing effect pool.

## 10. Checks — `scripts/check-reptile-house.mts`, added to **`check:shard-4`** beside `check:hotel` (verified by parsing `package.json` scripts; `check:chain-coverage` enforces it)

Node, `import './headless-canvas.mjs'`, `buildHeadlessPark()` (its inert iris runs the midpoint immediately, so doors really work headless). **Every probe is broken deliberately and watched go red before it is trusted; red-run transcripts carry the geometry they were proved against.**

1. **Control first:** a flood fill (0.25 m cells, `isClearCircle(x, z, PLAYER_RADIUS)`) from the arrival point on a copy with every exhibit collider removed must reach a sentinel inside the lagoon's footprint; if it does not, the instrument is measuring the wrong thing and the run fails before any real assertion.
2. **Real fill:** arrival, all 15 stand spots, the stall and nursery stand spots, the three hidden-baby spots, every `PATHS` node, the inside of the Hollow Log and the exit band centre are one component; a sentinel inside every declared sealed region (§8) is unreachable; **any clear cell that is reachable but outside every declared path region, or unreachable but not inside a declared sealed region, is red** (an undeclared pocket either way).
3. **Width probe:** sweep a 1.24 m disc along every `PATHS` polyline at 0.25 m stations; `isClearCircle` holds at every station; then grow the radius at each node until it fails and assert ≥ 1.5 (3.0 m clear). Control: narrow the Log Walk's walls to 1.0 m apart and watch it fail.
4. **Facade march** (copy `check:hotel` probe 22): 32 bearings × 2 strides (0.05 m and `PLAYER_LONGEST_STEP`) from 14 m out, with controls; only the ±10° doorway cone gets inside r 8.9; every march ends outside drawn stone. Skipped with a `process.stderr` note when `plot` is null.
5. **Doors both ways:** enter → `spaceAt` is `reptileHouse`, position within 0.5 m of (6, 15.8) local **recomputed from the imported constants**; a 0.925 m segment across the band fires `bandCrossed` from both sides; a sprinter past the exterior band stops within 2.0 m (back wall); cross the exit band → back on the park at `placedEntry('reptileHouse').entrance` (or the plaza spawn with no plot), on walkable ground.
6. **Hop test:** at each 1.4 m wall and the 1.5 m nursery rail, 12 bearings, move inward with jump held for 2 s; distance from the enclosure centre never < collider radius − 0.01. Break it by setting a wall to 1.2 m and watch it go red.
7. **Drawn ⇒ solid:** every `castShadow` mesh under the interior root taller than 0.6 m has `deepestSolidOverlap(centre, 0.1) > 0`, except names on the walk-through prefix list (§8's "none" row).
8. **Camera ray:** from the fixed camera to each exhibit centre and each stand spot, the first hit is nothing taller than 1.5 m (the sightline rule), excluding the exhibit's own near wall.
9. Lighting present under the root; root invisible outdoors; `spaceAt(origin) === SPACE_REPTILE_HOUSE`; `localToWorld` round-trips; `Shopping.openShopById('reptileStall')` and `('reptileNursery')` find a stand.
10. Coverage notes to `process.stderr` ("15 exhibits probed, 12 sealed regions checked, N path stations, facade march skipped: no plot").

Also: publish `reptileDoorBands()` and `interactZones()` and add the building to `scripts/check-tap-spacing.mts`'s list (every zone vs every band, `ownZoneId` on both door bands); extend `scripts/check-copy-brevity.mts` to walk `EXHIBITS` and the new catalogue rows; add every new factory (`createSnake` sizes, `createNoodlePlush`, `hat.snake`, each reptile, each kit loader) to `scripts/check-asset-contract.mts collect()` and to `art/samples/main.ts`; `check:hat-fit` covers the hat; `check:deep-links` gets the rows below; whichever coplanar check is live on `main` at merge time must stay green **without baseline additions** (glass 0.06 behind the frame face, nameplates and path decals at `DECAL_STEP`, plinth backs 0.2 off the walls, enclosure walls sunk 0.05 into the floor, instanced fronds interpenetrating trunks, case back faces deleted).

## 11. Entry, exit, deep links, saves

- `requestEnter(at?: { x: number; z: number; facing?: number })`: guard `!player || player.riding || spaces.isChanging || inside` → `spaces.changeTo(() => enter(at))`; `enter` sets `inside`, shows the root, `collision.setPlayBounds(circleBoundary(REPTILE_HOUSE_PLAY_RADIUS, ox, oz))`, teleports to (ox+6, 0, oz+15.8, π) or to `at`. Returns true.
- `checkDoorways` every frame unless `spaces.settling`: outside, `bandCrossed(doorBand, player.previousPosition, player.position)` → enter; inside, the south `exit` band → `leaveToPark` (bounds back to `GARDEN_PLAY_BOUNDARY`, teleport to `plot.entranceX/Z` at `surfaces.sample`, facing `facadeYaw`; with no plot, the plaza spawn).
- `adoptRestoredPlayer()` after `attachPlayer` (`Game.ts` pattern): if `spaceAt(save) === SPACE_REPTILE_HOUSE` → inside, visible, bounds.

| URL | Wiring | Lands |
|---|---|---|
| `/reptile-house` | `RIDE_DEEP_LINKS['/reptile-house'] = 'reptileHouse'` → `Game.boardRide`: `if (stallId === 'reptileHouse') return this.world.reptileHouse.requestEnter();` | (6, 15.8) local, facing 180 |
| `/reptile-house?at=x,z&facing=deg` | own `DeepLink` kind `'reptileHouse'`, `parseReptileLink` copied from `parseCastleLink` (build the optional `facing` conditionally — `exactOptionalPropertyTypes`) → `Game.enterReptileSpawn` → `requestEnter(at)` | anywhere: `?at=3.5,3.5&facing=225` Noodle, `?at=20.4,6.5&facing=270` nursery, `?at=15,1.8&facing=180` lagoon, `?at=-13,0` inside the log |
| `/reptile-house-door` | `'reptileHouseDoor'` → `enterDebugSpawn(placedEntry('reptileHouse').entranceX/Z, facing the door)`; `console.error` while no plot exists | outside on the tongue doormat, seed-independent |
| `/spawn?pos=<entranceX>,<entranceZ>&facing=<deg>` | — | same spot; the check prints the per-seed URL so the handover link is never hand-assembled |

`/spawn` does not bind play bounds, hence the interior links. Each gets a `check-deep-links` CHECKS row asserting `game.world.reptileHouse.inside === true` and position within 0.5 m of the expected local point recomputed from the imported constants. NPC visitors (`npc/portals.ts`) are phase 2 — recorded, not done.

## 12. Palette additions (`artPalette.ts`, named; everything else reused; no black; Artist may tune)

`snakeMint 0x9fe0b0`, `snakeCoral 0xff9f80`, `snakeBelly 0xfff1d0`, `cornOrange 0xffa75c`, `cornSaddle 0xd96b4a`, `shellOlive 0xb5b86a`, `hothouseClay 0xe9a883`. Existing: `leafMid/Light/Deep/Blue`, `markerPink/Sky/Lemon/Lilac/Mint`, `blossomPink`, `biscuitFur/biscuitMuzzle`, `flowerRed/Yellow`, `cream/creamDark`, `buildingWindowWarm`, `glassTint`, `pathSand/pathSandDark`, `stonePink/stonePinkLight`, `fairyWarm/Pink/Blue`. Outlines `inkTint`, 0.010–0.014 on creatures, 0.016–0.022 on props, none on near-ink parts.

## 13. Budgets, wiring checklist, ticket split

**Indoors:** ≈ 180 draw calls, ≈ 130 k triangles, 6 new canvases, 6 point lights, no shadow casters — under the ≈ 270 indoor baseline and far under the 500-call flag. **Outdoors:** one GLB building ≈ 11 k tris, 1 canvas.

**Files touched:** `spaces.ts` · `spaceOrigins.ts` · `src/world/reptileHouse/{layout,shell,ReptileHouse,exhibits,planting,stall,lighting,noodle}.ts` · `src/art/models/{snake,reptiles,reptileHouseAssets,reptileCasesAssets,reptilePlantsAssets,reptileCreaturesAssets,reptileNoodleAssets,reptileStallAssets,hats,pets}.ts` · `artPalette.ts` · `World.ts` (construct after Hotel; `tapZones`; `scene.add(root)`; `update`; `interactZones`; `attachPlayer`; `playerInAnyInterior`; `shopStands`; `dispose`) · `Game.ts` (`boardRide` ids, `adoptRestoredPlayer`, `enterReptileSpawn`) · `main.ts` (`RIDE_DEEP_LINKS`, `DeepLink` kind, parser) · `Shopping.ts` / `Shops.ts` / `catalogue.ts` / `stallShape.ts` / `fitouts.ts` · `state/secrets.ts` · `scripts/check-reptile-house.mts` + `check:shard-4` · `check-tap-spacing.mts` · `check-deep-links.mts` · `check-asset-contract.mts` · `check-copy-brevity.mts` · `art/samples/main.ts` · `package.json` (`blend:*`, `pack:*`, `check:reptile-house`) · `ASSET_MANIFEST.md` · `GAME_DESIGN.md` (snake room pointer) · `HANDOFF-reptile-house.md`.

**Ticket split (parallel from day one):** Artists A–F — one headless kit each (§ASSET GROUPS), renders in `art/renders/reptile-<id>/`, rows in `ASSET_MANIFEST.md` · Engineer 1 — the "empty greenhouse": space, shell, lighting, door/entry/leave, deep links, `layout.ts` tables, check skeleton with its controls (reviewable at `/reptile-house`) · Engineer 2 — snake rig, reptiles, gallery, asset contract · Engineer 3 — exhibits, paths, planting, Noodle thread, hidden babies, full instrument (after 1, 2 and the kits) · Engineer 4 — catalogue, stall, nursery stand, `createPet('snake')`, hat, `World.shopStands()` · Placement agents — manifest, anchor, park enlargement, procgen invariants (after `layout.ts` is on the branch — it is).

---

## ASSET GROUPS

All six: `art/blend/reptile_<id>_build.py` (imports `blendkit.py` — never a copy; reads every game number through `art/blend/reptile_constants.py`, which reads `src/world/reptileHouse/layout.ts` with `ts_const`; asserts a CONTRACT against emitted vertices; prints a size table) → `art/blend/reptile_<id>.blend` (generated, never hand-edited, not byte-stable) → `art/blend/reptile_<id>_export.py` (EXPECTED node set, PAINTED set, identity transforms except hinge-origin nodes, `export_format="GLB"`, `export_materials="NONE"`, `export_normals=True`, `export_texcoords` only if PAINTED is non-empty, `export_apply=False`, `export_yup=True`, no cameras/lights/extras/animations/skins) → `src/art/assets/reptile<Id>.glb` (byte-identical on re-run) → `scripts/pack-reptile-<id>-asset.mts` via `scripts/lib/pack-glb-asset.mts` → `src/art/assets/reptile<Id>Glb.ts` (`REPTILE_<ID>_GLB_BASE64`) → loader `src/art/models/reptile<Id>Assets.ts` (STYLES table keyed by node name, colours/outlines only from PALETTE/ART, missing node throws, `markShared` every geometry, heights measured with `visibleBounds`). `package.json`: `"blend:reptile-<id>": "blender --background --factory-startup --python-exit-code 1 --python art/blend/reptile_<id>_build.py && blender --background --factory-startup --python-exit-code 1 --python art/blend/reptile_<id>_export.py && pnpm run pack:reptile-<id>"`. Blender −Y = game +Z; origin at base centred X/Z; metres; scale 1; hyphenated node names; one node per colour; ~30 bytes/triangle. Pack budgets over the 150 KB default are justified in the pack script as `pack-castle-asset.mts` does.

### 1. `house` — the exterior shell
- **Contents:** `rh-plinth` (16-gon r 9.4 × 0.3) · `rh-coil` (3-turn `sweep_path`, 16 sides × 90 steps) · `rh-coil-belly` · `rh-coil-spots` (20 flat ellipsoids) · `rh-house-wall` (cream revolve between coils, 12 portholes) · `rh-windows` (12 panes) · `rh-head` (ellipsoid 4.2 × 3.4 × 3.0, **PAINTED**, planar face UVs with the 1−v flip handled) · `rh-tongue` · `rh-tail` (S-curve sweep to 4 m) · `rh-tail-bell` · `rh-arch` (rounded-profile 3.4 × 3.6) · `rh-awning` (leaf `extrude_outline` 4 × 2.5) · `rh-sign` (quad UVs for the atlas).
- **Output:** `art/blend/reptile_house_build.py`, `reptile_house_export.py`, `reptile_house_render.py` (Workbench; parses colours out of `reptileHouseAssets.ts` and the palette files) → `src/art/assets/reptileHouse.glb` → `scripts/pack-reptile-house-asset.mts` → `src/art/assets/reptileHouseGlb.ts`.
- **Shared constants (via `reptile_constants.py`):** `REPTILE_SHELL_RADIUS` for the plinth, `REPTILE_TAIL_REACH` for the tail base, `REPTILE_ARCH_WIDTH` / `REPTILE_ARCH_HEIGHT` for the arch (≥ 2·`DOOR_HALF` and ≥ `TALLEST_CHILD_HEIGHT` + 0.4 — the module asserts both at import), the bottom coil's underside over the door ≥ `TALLEST_CHILD_HEIGHT`. The loader re-asserts plinth circumradius, arch width and head clearance at load.
- **Budget:** ≤ 11 000 triangles, 360 KB.

### 2. `cases` — enclosure masonry and frames
- **Contents:** `rc-case-plinth` (stadium 5.4 × 2.4 × 1.1, coursed-stone moulding, no back face) · `rc-case-rim` (0.2 m frame rim at 2.9) · `rc-case-backboard` (jungle relief) · `rc-pier-post` (vine-wrapped, r 0.45 × 3.2) · `rc-jar-base` + `rc-jar-rim` (r 1.6) · `rc-round-wall` (ring r 2.3 outer, 1.4 h, scalloped top) · `rc-lagoon-wall` (stadium segment 4.0, half 3.0, 1.4 h) · `rc-tortoise-wall` (segment 3.0, half 2.9, 1.4 h) · `rc-nursery-kerb` (ring r 2.6, 0.6 h) · `rc-nursery-rail` (glass frame posts to 1.5) · `rc-island-kerb` (ring r 3.4, 0.5 h) · `rc-grotto-rock` (3.5 m rock face with pool basin and waterfall lip). Glass panes are TS planes with `glassMaterial(0.24)`, not in the kit.
- **Output:** `art/blend/reptile_cases_build.py`, `reptile_cases_export.py` → `src/art/assets/reptileCases.glb` → `scripts/pack-reptile-cases-asset.mts` → `src/art/assets/reptileCasesGlb.ts`.
- **Shared constants (all in `layout.ts`, all read by the collider code too):** `REPTILE_CASE_SEGMENT 3.0`, `REPTILE_CASE_HALF_DEPTH 1.2`, `REPTILE_CASE_PLINTH_HEIGHT 1.1`, `REPTILE_GLASS_TOP 2.9`, `REPTILE_ENCLOSURE_WALL_HEIGHT 1.4`, `REPTILE_ROUND_WALL_RADIUS 2.4`, `REPTILE_LAGOON_SEGMENT 4.0`, `REPTILE_LAGOON_HALF 3.0`, `REPTILE_TORTOISE_SEGMENT 3.0`, `REPTILE_TORTOISE_HALF 2.9`, `REPTILE_NURSERY_RADIUS 2.6`, `REPTILE_NURSERY_KERB_HEIGHT 0.6`, `REPTILE_NURSERY_RAIL_TOP 1.5`, `REPTILE_ISLAND_RADIUS 3.4`, `REPTILE_ISLAND_KERB_HEIGHT 0.5`, `REPTILE_JAR_RADIUS 1.6`, `REPTILE_JAR_BASE_HEIGHT 0.6`, `REPTILE_PIER_POST_RADIUS 0.45`. The loader asserts every wall height and footprint against them so mesh and collider cannot drift.
- **Budget:** ≤ 6 000 triangles, 180 KB.

### 3. `plants` — tropical vegetation, instanced in TS
- **Contents:** `rp-palm-trunk` (curved, 5.5 m) · `rp-palm-frond` · `rp-banana-leaf` · `rp-monstera-leaf` · `rp-fern-frond` · `rp-heliconia` · `rp-vine-strand` · `rp-lily-pad` · `rp-rock-a` / `rp-rock-b` / `rp-rock-c` · `rp-log-small` (4 m, bark ridges) · `rp-log-hollow` (6 m ¾ tube, inner r 1.65, outer 2.0, knothole) · `rp-banyan` (6 m, buttress roots, 3 hanging-branch anchors) · `rp-branch` (case branch).
- **Output:** `art/blend/reptile_plants_build.py`, `reptile_plants_export.py` → `src/art/assets/reptilePlants.glb` → `scripts/pack-reptile-plants-asset.mts` → `src/art/assets/reptilePlantsGlb.ts`.
- **Shared constants:** `TALLEST_CHILD_HEIGHT` for the hollow log's clear height ≥ 2.97 + 0.3; `REPTILE_LOG_INNER_RADIUS 1.65`, `REPTILE_LOG_OUTER_RADIUS 2.0` and `REPTILE_LOG_LENGTH 6.0` (also read by the Log Walk's colliders); `REPTILE_PALM_HEIGHT 5.5`, `REPTILE_BANYAN_HEIGHT 6.0`; everything else mesh-owned, measured and printed. Rock circumradii are measured off the vertices in both Python and TS.
- **Budget:** ≤ 6 000 unique triangles (banyan ≤ 2 500), 180 KB.

### 4. `creatures` — the organic parts primitives fight
- **Contents:** `rr-snake-head` (0.42 m at scale 1, **PAINTED**: planar face UVs, the one head every TS snake and the pet scale under a sizer group) · `rr-snake-tongue` · `rr-croc-head` · `rr-croc-jaw` (hinge-origin node, pure translation allowed) · `rr-croc-body` · `rr-croc-tail` (hinge) · `rr-tortoise-shell` (scute ridges) · `rr-tortoise-head` · `rr-chameleon-body` (spiral tail, crest) · `rr-frog-body` · `rr-gecko-body` (toe pads) · `rr-skink-body` · `rr-iguana-body` (crest).
- **Output:** `art/blend/reptile_creatures_build.py`, `reptile_creatures_export.py` → `src/art/assets/reptileCreatures.glb` → `scripts/pack-reptile-creatures-asset.mts` → `src/art/assets/reptileCreaturesGlb.ts`.
- **Shared constants:** `REPTILE_SNAKE_HEAD_LENGTH 0.42` (`layout.ts`; the sizer scales from it). Everything else mesh-owned, measured and printed every run; TS measures with `visibleBounds` and the asset contract pins height/origin/scale. The snake-face UV layout is shared by contract with `rh-head` and `rn-head` so one canvas fits all three.
- **Budget:** ≤ 4 500 triangles, 140 KB.

### 5. `noodle` — the centrepiece python and her rock
- **Contents:** `rn-mound` (rock mound r 3.0, 1.6 h, moss ledges) · `rn-coil` (3 turns up the mound, body r 0.42, `sweep_path` 16 sides) · `rn-coil-belly` · `rn-coil-spots` · `rn-head` (1.3 L × 0.9 W × 0.8 H, **PAINTED**, same UV layout as `rr-snake-head`) · `rn-tongue` · `rn-burrow` (dark rim) · `rn-tail-mound` (the nursery's mound the TS tail chain emerges from).
- **Output:** `art/blend/reptile_noodle_build.py`, `reptile_noodle_export.py` → `src/art/assets/reptileNoodle.glb` → `scripts/pack-reptile-noodle-asset.mts` → `src/art/assets/reptileNoodleGlb.ts`.
- **Shared constants:** `REPTILE_ISLAND_RADIUS` so the coil and mound stay inside the kerb (asserted off the emitted vertices); `REPTILE_NURSERY_RADIUS` for the tail mound; `REPTILE_NOODLE_BODY_RADIUS 0.42`, `REPTILE_NOODLE_MOUND_HEIGHT 1.6`, `REPTILE_NOODLE_HEAD_X/Z 2.3` and `REPTILE_NOODLE_HEAD_Y 0.5` — the head's rest position is baked into the node's vertices (identity transform), measured, printed, and re-asserted by the loader against the `EXHIBITS` stand spot.
- **Budget:** ≤ 5 000 triangles, 160 KB.

### 6. `stall` — Scales & Tails and the Noodle-o-meter
- **Contents:** `rs-awning` (scalloped, its edge a coiled snake with a smiling head at the near corner) · `rs-finial` (coiled snake on the back panel) · `rs-sign` (quad UVs for the atlas) · `rs-meter-post` (3.2 m post with a snake coiled up it, rungs every 0.5 m) · `rs-meter-board` (quad UVs).
- **Output:** `art/blend/reptile_stall_build.py`, `reptile_stall_export.py` → `src/art/assets/reptileStall.glb` → `scripts/pack-reptile-stall-asset.mts` → `src/art/assets/reptileStallGlb.ts`.
- **Shared constants:** `COUNTER_HALF_WIDTH` (`shops/stallShape.ts`) so the awning spans the kiosk counter; `REPTILE_BABY_SNAKE_UNIT` for the rung spacing, which the TS bubble arithmetic reads from the same owner; `REPTILE_METER_POST_HEIGHT 3.2` ≥ `TALLEST_CHILD_HEIGHT` so the post is taller than the tallest hat (asserted in `reptile_constants.py`).
- **Budget:** ≤ 2 500 triangles, 80 KB.
