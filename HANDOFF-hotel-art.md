# HANDOFF — The Land Hotel, art assets (#236)

Branch: `feat/hotel-236` · Worktree: `.claude/worktrees/hotel-236`
Role: **Artist.** Authors the hotel's new art in Blender. Another agent owns
procgen/placement/interior in the same worktree — do not touch its files.

## State: DONE, uncommitted

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
