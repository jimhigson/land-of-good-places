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

## Status
- [ ] build script  - [ ] export  - [ ] pack  - [ ] renders  - [ ] checks  - [ ] PR
