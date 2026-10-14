# HANDOFF — library art (#715, part 1 of epic #714)

Branch `art/library-715`, worktree `.claude/worktrees/library-art`. 3D Artist /
Engineer finishing the art part. Jim's 13 Oct ruling: ONE PR for the whole
Library feature — this branch feeds that PR; do not raise a part-PR from here.
The building engineer (#716) consumes the glb: anything that changes the
contract goes on #716 first.

## Deliverables
- `art/blend/library_build.py` (authoring source; `library.blend` is generated)
- `art/blend/library_export.py` → `src/art/assets/library.glb`
- `art/blend/library_render.py` → `art/renders/library/*.png`
- `scripts/pack-library-asset.mts` → `src/art/assets/libraryGlb.ts`
- package.json: `blend:library`, `render:library`, `pack:library`
- ASSET_MANIFEST row + section

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
- **Pediment book is OPEN (📖), not closed.** The brief (#714) says only "a
  pediment with a book carved in it". The first cut (commit 9bc9fe76) was a
  closed book seen cover-on and read as a gold plaque from the street; closed
  fore-edge-on reads as a grille and spine-on as a log. Recognisability first
  (Jim's scale rule), so it is the open-book library sign. Visible choice —
  name it in the Library PR's "what to look at".
- Secret shelf hinge = vertical line through the FRONT-left corner; swings out
  into the room (`rotation.y` 0 → −π/2 in game).
- Pivot nodes (pure translation to the joint): owl head/wings/heldBook, dragon
  head/tail, cat head/ears/tail. `owl-heldBook` rides `owl-wingR`'s pivot.
- Blender icosphere `subdivisions=3` is 320 faces (1 = icosahedron).
- Bytes: box-built parts ~30–50 B/tri in the glb (every sharp edge splits a
  vertex). The glb's size is printed by `pnpm run pack:library` and written in
  the header of `src/art/assets/libraryGlb.ts` — quote it from there, never by
  hand. The 450 KB budget in `scripts/pack-library-asset.mts` is a hard gate
  (`pack-glb-asset.mts` exits 1 over it). At 1eb482d6 it was 452 896 B of
  460 800 (7.7 KB headroom).

## History worth knowing
- 1eb482d6 (Opus artist, stopped mid-round, taken over): reshaped the owl's
  glasses (eye_z 1.17 → 1.20), the cat head and ears (`ear_base()`), moved the
  dragon and cat tail roots to the sweep origin, and started storing the eye
  anchors on the .blend heads (`face_eyes_uv`). Its render round died at
  `exterior.png` (committed truncated, 81 920 B, no IEND) and four compositions
  (`exterior-front`, `lineup`, `reading-room`, `secret-den`) were RGBA leftovers
  from an earlier script. The #716 contract comment (6155362071) predates it,
  so its owl and cat eye anchors are stale.

## Review round (14 Oct) — work list
- [ ] renders: one complete run, every PNG ends in IEND; render script writes
      atomically and verifies its own output; repo-wide PNG integrity check
- [ ] eye anchors travel in the glb (node extras), #716 told
- [ ] face window = head node bounds; every front-mapped UV asserted in [0,1]
- [ ] owl rim figure measured off landmarks, not a typed `0.15 - 0.03`
- [ ] dragon: head wider than body, eyes lower, one horn asymmetric, wings
      smooth
- [ ] owl: HEAD constant, skull ratio, glasses round/fat; cat: bigger head,
      soft ears
- [ ] lamps fatter; dentils; nest books
- [ ] pack docLine count; ASSET_MANIFEST; checks (`check`, `build`,
      `test:procgen`)
