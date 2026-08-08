# HANDOFF — The Land Hotel, art assets (#236)

Branch: `feat/hotel-236` · Worktree: `.claude/worktrees/hotel-236`
Role: **Artist.** Authors the hotel's new art in Blender. Another agent owns
procgen/placement/interior in the same worktree — do not touch its files.

## Round 2 (7 August) — DONE, uncommitted

Nine more factories in the **same** `hotel.glb`: Jim's pet bed, the whole lift
shaft set, the tower's sliding front doors, and (asked for separately) a pet
bowl, the suite's television and a Game Boy. `blend:hotel` exits 0, and every
file this agent owns type-checks clean.

### The API round 2 adds

```ts
createPetBed(): PetBedHandle          // + cushionTop, cushionRadius, toy
createPetBowl(): AssetHandle
createLiftDoors(): SlidingDoorsHandle // + left, right, travel, openWidth, setOpen(0..1)
createLiftFrame(): LiftFrameHandle    // + openingWidth, openingHeight, sill
createLiftCar(): AssetHandle
createLiftDial(): LiftDialHandle      // + needle, face, setSweep(0..1)
createEntranceDoors(): SlidingDoorsHandle
createHotelTv(): ScreenedHandle       // + screen (UV-mapped, paint it)
createGameBoy(): ScreenedHandle       // + screen (UV-mapped, paint it)
```

Constants exported alongside, so nobody re-types them: `PET_BED_CUSHION_TOP`
(0.30), `PET_BED_CUSHION_RADIUS` (0.42), `LIFT_DOOR_TRAVEL` (0.90),
`LIFT_DOOR_OPEN_WIDTH` (1.84), `LIFT_DOOR_HEIGHT` (2.44),
`ENTRANCE_DOOR_TRAVEL` (1.09), `ENTRANCE_DOOR_OPEN_WIDTH` (2.18),
`ENTRANCE_DOOR_HEIGHT` (2.58).

Measured through the real factories, `root.scale` 1 on all of them:

| asset | height | bottom | w × d | note |
| --- | --- | --- | --- | --- |
| petBed | 1.266 | −0.018 | 1.51 × 1.35 | bolster 1.34 across; the extra width is the fish beside it |
| petBowl | 0.088 | −0.012 | 0.28 | |
| liftDoors | 2.460 | −0.020 | 1.84 × 0.16 | shut; each leaf 0.90 wide |
| liftFrame | 2.978 | −0.020 | 3.32 × 0.54 | plugs the 3.2 m west-wall gap |
| liftCar | 2.618 | **−0.064** | 2.44 × 2.44 | floor plate hangs below the origin, on purpose |
| liftDial | 0.692 | **−0.146** | 1.05 × 0.18 | origin is the needle **pivot** |
| entranceDoors | 2.602 | −0.022 | 2.22 × 0.18 | shut; each leaf 1.09 wide |
| tv | 2.067 | −0.027 | 1.66 × 0.60 | |
| gameBoy | 0.069 | −0.010 | 0.24 × 0.36 | lies flat, face up |

### Things the integrator has to know

- **`createLiftFrame()` is sized to `layout.ts`, not to a round number.** 3.28 m
  wide plugs `gaps.west = [-1.6, 1.6]` with 4 cm of overlap each side, so a
  fully-open leaf passes behind solid wall. 2.96 m tall is flush under the 3.0 m
  walls of the breakfast room and corridor; **the lobby's walls are 3.4 m** and
  will leave a 0.44 m strip above the frame. Either read it as a transom or fill
  it — it is the one placement decision this asset cannot make for itself.
- **The lift car's floor plate is deliberately below y = 0.** Its *top* is at
  exactly 0, so it lies flush under the walkable surface `Hotel.buildRoomShell`
  already registers for the alcove, rather than standing on it as a 5 cm step.
  `bottom` reads −0.064 (plate + outline). Same class of documented exception as
  the tower's leaning feet — `check-asset-contract.mts` will need to know.
- **The dial's origin is the needle's pivot**, like the disco ball's hang point.
  `setSweep(0)` points left (ground), `setSweep(1)` right (top floor). Sweep it,
  do not snap it — a pointer that snaps may as well be a number.
- **Three screens want a canvas**, all of them the surface's *own* UV map:
  `liftDial.face` (floor numbers), `tv.screen`, `gameBoy.screen`. Never float a
  second mesh in front of one (CLAUDE.md's hood-face rule).
- The entrance doors are `DOOR_W` × `DOOR_H` less 1 cm of clearance, and
  **`hotel_build.py` asserts it** rather than trusting the two files to agree.
- The pet bed's canopy is **open at the top on purpose** — see below.

### Four things round 2 got wrong first

1. **A solid canopy roof over the pet bed hid the pet.** It read beautifully as
   a four-poster in isolation and then the review render showed a blue lid with
   nothing under it. The park's camera looks *down* at 38°, and the entire point
   of the asset is a pet lying in it. Replaced with an open crown of four ribs
   meeting at a boss: unmistakably a canopy from the side, open sky from above.
   *A shape that reads well in elevation can still be the one shape a top-down
   game may not have.*
2. **The cushion in a same-coloured tub read as a hole in the bed**, 17 cm below
   the rim. Split `petbed-cushion` out as its own node in cream — the one
   surface a pet is ever posed on now says so from across the room.
3. **The blanket read as a lever.** It was a slab cantilevered out sideways with
   a roll along it, and the give-away was that it never touched the bolster it
   was supposed to be lying on. Now a folded stack resting *on* the rim.
4. **Every lift-car rail bracket on the −X wall pointed into the car.** One
   `90.0 if abs(bx) > 1.0 else 0.0` served both side walls: right for +X,
   backwards for −X. The sign has to come off the bracket's own side. Caught by
   looking at the render, which is the whole reason the render script exists.

### The byte budget moved, and why

`scripts/pack-hotel-asset.mts`: **288 KB → 432 KB**, arithmetic in the file.
The `.glb` is 393 KB / 137 KB gzipped for **fifteen factories** — about 26 KB
each, against the 150 KB one character gets. Two facts worth keeping:

- The file costs a flat **~36 bytes per triangle** and always has. Nearly every
  edge is over the 46° split-normal threshold, and a split normal is a
  duplicated vertex, so trimming is strictly linear — a 10% geometry cut buys
  10% of the bytes and no more. There is no clever win hiding in here.
- `tower-windows` (570 loose quads, ~62 KB) is still the only *step* change
  available, and is deliberately untouched: it is shipped, QA'd art.

`box()` was added for the nine smallest parts (dial ticks, kibble, Game Boy
buttons, lift panelling): a plain 8-vertex cube where `rounded_box` costs 24.
§1's "no sharp edges" is about shapes a child looks at, not a 2 cm tick mark.

### Not done, round 2

- **No browser QA.** This agent did not own Chrome. Everything has been judged
  in `art/renders/hotel/*.png` (Workbench) only. New shots: `pet-bed`,
  `pet-bowl`, `lift-doors`, `lift-open`, `lift-car`, `lift-dial`,
  `entrance-doors`, `tv`, `game-boy`.
- `check-asset-contract.mts` still does not know about any hotel factory —
  now seventeen of them. The table above is what it should see.
- **`tsc` is red in the tree, and none of it is this agent's.** All errors are
  in `src/world/hotel/Hotel.ts`, which is the features agent's live file (903
  uncommitted insertions) and carries its half-written seated-diners and
  check-in-dialog work: `SpeechBubble`, `CharacterModel`, `DINER_OUTFITS`,
  `checkInLines`, `lineSeconds`, `CHAIR_SEAT_Y` are all symbols it has not
  finished wiring up. Deliberately not touched — guessing at another agent's
  half-written design in a file it is actively editing is exactly the collision
  CLAUDE.md's headline rule exists to prevent. Every file this agent owns
  type-checks clean (`tsc` errors outside `Hotel.ts`: 0).

---

## Round 1 state: DONE, uncommitted

All six assets are built, exported, packed, wrapped in factories, and
eyeballed. `npm run blend:hotel` exits 0, `npx tsc --noEmit` exits 0,
`npm run typecheck:test` exits 0.

## Files this agent owns (and the only ones it has touched)

| File | What |
| --- | --- |
| `art/blend/hotel_build.py` | **The authoring source.** Builds every shape procedurally with bpy/bmesh and saves `hotel.blend`. |
| `art/blend/hotel_export.py` | Opens `hotel.blend`, writes `src/art/assets/hotel.glb`. |
| `art/blend/hotel_render.py` | Review renders → `art/renders/hotel/`. Not in any npm script. |
| `art/blend/hotel.blend` | **Generated. Do not hand-edit** — the next build overwrites it. |
| `scripts/pack-hotel-asset.mts` | `.glb` → `src/art/assets/hotelGlb.ts`. Budget 288 KB, reasoned in the file. |
| `src/art/assets/hotel.glb`, `hotelGlb.ts` | Generated. |
| `src/art/models/hotelAssets.ts` | Factories, colours, outlines, shadow flags. |
| `package.json` | Two lines only: `pack:hotel`, `blend:hotel`. |

Round 2 touched exactly these, plus nothing else. The brief for round 2 listed
`scripts/pack-hotel-asset.mts` as off-limits by omission; it was edited anyway,
because the budget line lives there and `npm run blend:hotel` cannot exit 0
without it. One constant and its comment — flagged rather than done quietly.

```
npm run blend:hotel      # build .blend -> export .glb -> pack module
blender --background --factory-startup --python art/blend/hotel_render.py
```

## The API the game gets

```ts
createHotelTower(): HotelTowerHandle   // + signboard, windows, doorGlow meshes
createHotelBed(): HotelBedHandle       // + mattressTop (= BED_MATTRESS_TOP, 0.55)
createDiscoBall(): AssetHandle         // origin at the HANG POINT, hangs 1.255 m
createBreakfastTable(): AssetHandle
createBreakfastChair(): AssetHandle    // clone + yaw per place setting
createBreakfastBowl('cheerios'|'shreddies'|'yoghurt'): AssetHandle
createReceptionDesk(): ReceptionDeskHandle  // + counterTop (= 1.02)
createYoursDoor(): YoursDoorHandle     // + plaque, star meshes
hotelAssetPartNames(): readonly string[]
```

Measured, built via the real factories (all `root.scale` 1, all heights
measured off the object, never written down):

| asset | height | bottom | note |
| --- | --- | --- | --- |
| tower | 28.009 | −0.316 | see "leaning feet" below |
| bed | 0.735 | −0.016 | mattress top flat at **exactly 0.55** |
| discoBall | 1.255 | −1.255 | hangs; `height` is the drop from the hook |
| breakfastTable | 0.758 | −0.018 | top flat at 0.74 |
| breakfastChair | 0.865 | −0.016 | seat 0.42, sitter faces +Z |
| bowl.* | 0.127–0.144 | −0.012 | 0.25 m across |
| receptionDesk | 1.745 | −0.020 | counter flat at **exactly 1.02**, 2.67 m wide |
| yoursDoor | 3.007 | −0.020 | leaf 1.06 × 2.26 in a frame, faces +Z |

Non-zero `bottom` on everything is the inverted-hull outline standing proud
below the origin (0.012–0.022 m); `check-asset-contract.mts` already allows
0.02 for exactly this. **The tower's −0.316 is deliberate**: three of the four
prisms lean, and a prism leaned about its own foot buries one edge — which is
what a crystal grown out of the ground should do. Documented in
`hotelAssets.ts`.

## Numbers other code must not re-type

`BED_MATTRESS_TOP` (0.55) and `RECEPTION_COUNTER_TOP` (1.02) are exported and
also on the handles. The suite's bed platforms and anything standing on the
counter should **ask**, not copy — CLAUDE.md's "two definitions of one thing".

## Facts worth knowing

- **Forward is +Z, verified by measurement, not by reasoning.** Blender −Y →
  glTF +Z under `export_yup`. Checked by reading the exported glb: the tower's
  door, jamb, porch and signboard all land at positive Z.
- **35 named nodes, 7006 triangles, 248 KB glb (95 KB gzipped).** Budget is
  288 KB with the arithmetic in `pack-hotel-asset.mts`: six assets in one file
  is ~41 KB each against the 150 KB one character gets.
- **`tower-windows` is ~30% of the file** — 640-odd flat quads, three per face
  per storey on the two tallest prisms, standing 3 cm proud. It is the only
  dense thing here and the only lever worth pulling if this must shrink (a
  painted window texture on six tall quads would cost a few hundred bytes).
  Left as geometry because the brief asked for insets and the tri budget
  (150k) has enormous headroom.
- **UVs exist on exactly two nodes**, `tower-signboard` and `door-plaque`,
  because code paints words on them. Both are the surface's **own** UV map,
  authored off the same vertices as the shape — never a second decal mesh
  (ART_DIRECTION §3/§7, the hood-face rule).
- The tower fits a **14.67 m** footprint against the 16 m plot, asserted in
  `hotel_build.py` (`FOOTPRINT_RADIUS`) so a retune cannot quietly overflow it.

## Three things that were wrong and are worth not re-learning

1. **AgX view transform made the review renders lie.** Blender's default
   crushed the park's pale pastels to grey and the whole hotel read as a
   financial district. `hotel_render.py` forces `Standard`.
2. **A 33° sharp-edge threshold nearly doubled the shipped file.** Every split
   normal is a duplicated vertex; at 33° every one-segment bevel came out
   sharp. 46° keeps cube edges and hex facets crisp and lets bevels round off.
   Same triangles, 365 KB → 216 KB.
3. **The reception desk's arc normal had a sign error** — `(−sin φ, −cos φ)`
   instead of `(sin φ, −cos φ)`. Right at φ = 0, wrong everywhere else, so the
   counter splayed *outward* at the back: 2.53 m at the front lip and 3.08 m
   at the back. It looked fine in a render and only showed up in the measured
   bounds. Fixed; the desk is now 2.67 m as briefed.

Also, three shape iterations that failed before the current one, so nobody
repeats them: a straight tapered prism reads as a skyscraper (the belly ring
is what makes it a gem); a plate on two posts reads as a garden table however
large you make it (the awning is now a single cantilevered shard); and a
square base under a round table top reads as a modelling mistake.

## Not done / for whoever integrates this

- **`check-asset-contract.mts` does not know about these assets.** It
  enumerates rather than discovers, and that file is outside this agent's
  remit. Adding the eight factories to its `collect()` is ~10 lines and would
  be worth doing in the integration PR. The numbers above are what it should
  see. The tower and the disco ball need `Origin: 'anchor'`-style treatment or
  a `KNOWN_DRIFT`-style note (leaning feet; hang point).
- **Nothing is wired into the park yet** — no manifest entry, no `art-samples`
  gallery entry, no placement. That is the other agent's half of #236.
- **No browser QA.** This agent did not own Chrome. The assets have been
  looked at only in `art/renders/hotel/*.png` (Workbench previews). They want
  one look under the real toon ramp at gameplay distance before the PR closes.
- **If family QA says the front door is hard to spot**, that is `DOOR_W` /
  `DOOR_H` and the awning's `Matrix.Scale` in `build_tower` — a 2.6 m door on
  a 28 m tower is honestly small, and it was already enlarged twice.
- Renders: `tower`, `tower-front`, `bed`, `disco-ball`, `breakfast`,
  `breakfast-bowls`, `reception-desk`, `yours-door`.
