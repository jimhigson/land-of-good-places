# HANDOFF — library art (#715, part 1 of epic #714)

Branch `art/library-715`, worktree `.claude/worktrees/library-art`. 3D Artist.
The building engineer (#716) is waiting on the glb: comment on #716 the moment
the first full glb is pushed.

## Deliverables
- `art/blend/library_build.py` (authoring source; `library.blend` is generated)
- `art/blend/library_export.py` → `src/art/assets/library.glb`
- `art/blend/library_render.py` → `art/renders/library/*.png`
- `scripts/pack-library-asset.mts` → `src/art/assets/libraryGlb.ts`
- package.json: `blend:library`, `render:library`, `pack:library`
- glb read by both readers in `check:character-parity`; ASSET_MANIFEST row

## Decisions so far
- **Node names are hyphenated, not dotted**: GLTFLoader strips full stops
  (ART-AGENT-NOTES §6a). Game key `library.shell` ↔ glb collection `shell` ↔
  nodes `shell-walls`, `shell-columns`, … Same scheme as castle.glb.
- Kiosk counter height read with `ts_const` from
  `src/world/building/shops/stallShape.ts` `COUNTER_TOP_Y` (1.02).
- Face UVs follow the reptile-kit convention (`snake_face_uvs`): v pre-inverted,
  so the Engineer paints through `planarUvCanvasTexture` (flipY = true), NOT
  `glbCanvasTexture`.

- **Seat heights changed from the brief**: armchair seat 0.55 → 0.36 and floor
  cushion 0.30 → 0.36, both = `KID_HIP_HEIGHT` via ts_const. The rig has no
  knee, so the hip is the one seat height where her feet reach the floor
  (kid.ts doc; castle bench/throne precedent). Stated on #716.
- Secret shelf hinge = vertical line through the FRONT-left corner; swings out
  into the room (`rotation.y` 0 → −π/2 in game).
- Pivot nodes (pure translation to the joint): owl head/wings/heldBook, dragon
  head/tail, cat head/ears/tail. `owl-heldBook` rides `owl-wingR`'s pivot.
- Blender icosphere `subdivisions=3` is 320 faces (1 = icosahedron).
- Bytes: box-built parts ~30–50 B/tri in the glb; the nest of lying books and
  the turned columns were the big costs. Budget set to 450 KB (405.8 KB now).

## Status
- [x] build script (all CONTRACT figures asserted)  - [x] export  - [x] pack
- [x] first glb pushed; contract posted on #716 (comment 6155362071)
- [ ] renders  - [ ] reader check registration  - [ ] ASSET_MANIFEST  - [ ] checks  - [ ] PR
