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

## Review round (14 Oct) — done
- [x] renders: one complete run (32 PNGs, all IEND, all RGB — incl.
      `secretShelf-open.png`, the shelf at −90° seen from behind). The render
      script now clears the folder first, writes each frame to a hidden
      `.part` file, verifies it (signature, IHDR size + colour type, IEND)
      and renames it into place. `check:png-integrity` (gate, shard-1) walks
      every PNG git tracks — proved red on the old truncated `exterior.png`
      and on a flipped byte / appended bytes in a hotel render.
- [x] face figures travel in the glb as node extras (`face_eyes_uv`,
      `face_window_m`, owl `face_rim_uv`); `export_extras` on, the export
      asserts nothing else carries a custom property; `pack:library` copies
      them verbatim into the typed `LIBRARY_FACES` in `libraryGlb.ts`. #716
      told (comment 6164272315, edited), correcting the stale anchors in
      6155362071.
- [x] **`src/art/style/glb.ts` is NOT touched** (it was, briefly): it is inside
      the prebuilt parks' source closure (`scripts/lib/park-source-hash.mjs`),
      so any byte of it changed re-solves all sixteen parks on CI (30–45 min)
      and runs acceptance loops locally. Branch park hash == main's
      (e272e0c0…), measured. Its doc's "character-parity reads every authored
      asset twice" is stale (kid only) — fix it in a PR that is already paying
      for a park re-solve.
- [x] face window = the head node's own bounds; `face_window_uvs` asserts
      every front-mapped uv is on the canvas (proved red with the skull-only
      window: owl tuft vertex → v −0.051).
- [x] owl rim room measured between landmarks (`Asset.face_rim_uv`), no
      typed `0.15 - 0.03`.
- [x] `check:library-glb` (gate, shard-1): module == file, no material or
      texture, names without full stops, translation-only, texcoords iff
      face figures, `LIBRARY_FACES` == the file's extras, dv/dy > 0 on every
      face, `readGlbParts` and `GLTFLoader` agree on every node (and
      GLTFLoader's userData == the extras). Each clause proved red.
- [x] dragon: head 0.76 m on a 0.67 m body, `headOverBody >= 1.10` in the
      CONTRACT (1.134); features placed from head_c/head_r; eyes on the
      equator, snout low; left horn leans 15° (asymmetric feature); wings
      8 cm thick (0 sharp edges), fingers dropped. Head horns ride the head
      pivot; back spines → new node `dragon-spines`.
- [x] owl: `OWL_HEAD` 1.18, skull 0.556 of her height — now a CONTRACT
      line, `skullOverHeight >= 0.55` (red at OWL_HEAD 1.0: 0.520); eyes on
      the equator, beak under; glasses torus(20, 8), 8-sided 3.5 cm
      arms/bridge; beak + glasses ride the head pivot. CONTRACT owl depth
      1.00 → 1.10 (1.056).
- [x] cat: `CAT_HEAD` 1.25, loaf shorter, `soft_ear` rounded triangles.
      Eyes left at +0.115 r_z (inside the house band; the cat is asleep).
- [x] floor lamp tapered 12 → 9 cm pole, bead, rolled rim (no lean: it
      breaks width/centring); reading lamp 6 → 4.5 cm gooseneck.
- [x] dentils removed; book boards one-segment bevel (pile + nest).
- [x] pack docLine count dropped; pediment comment corrected; ASSET_MANIFEST
      row + §41.
- [x] gate: local `tsc`, `typecheck:test`, `build`, `check:assets`,
      `check:character-parity`, `check:library-glb`, `check:png-integrity`,
      `check:chain-coverage` all exit 0. The full `check` / `test:procgen`
      need accepted parks, which a fresh worktree does not have (seed 5 alone
      is ~20 min of acceptance loops), so the whole of CI was dispatched on the
      branch (no PR needed): `gh workflow run ci.yml --ref art/library-715` →
      run 38537415092 on `6fbc7560`: **success** — all 8 Checks shards and the
      build, all 6 Procgen invariants shards, Coplanar, Walk reach, Every seed
      builds, Swept bus, Entrance road; both required aggregators green; the
      Parks rebuild paths skipped on a cache hit (same park hash as main).
      Shard 1's log shows `check:library-glb` and `check:png-integrity` ran
      and passed. Commits after `6fbc7560` touch only this file.

## Not done, on purpose
- **No part-PR from this branch.** Jim's 13 Oct ruling: one PR for the whole
  Library; the workflow raises it from the integration branch.
- **check:character-parity is not the glb's reader check** and gets no hook:
  it is the kid's parity check by design. `check:library-glb` is the
  library's; #716's `check:library` re-measures the CONTRACT.
- `library_render.py` colours from its PROPOSED palette-key table until
  `src/art/models/libraryAssets.ts` exists (#716); it switches by itself.
- The cat's head stays a little narrower than its loaf: "head wider than
  the body" literally would need a longer cat than the 0.6 m contract.

## Figures (quote from the build, never by hand)
`pnpm run blend:library` prints every CONTRACT figure, pivot and face anchor.
At `6fbc7560`: 65 nodes, 18 568 triangles; glb 449 528 B of the 460 800 B
budget (the pack line and `libraryGlb.ts`'s header are the owners).

## Merge gates, round 1 (14 Oct)
- Run locally on the commit carrying this section: `pnpm run check`, then
  `pnpm run test:procgen`, then `pnpm run build`, each logged to a file with
  its exit code read directly. Shell `node` is 25.6.1, so every command goes
  through `fnm exec --using=26 --` (`.node-version` says 26).
- **Parks for a fresh worktree, without hours of acceptance loops**: this
  branch's park source hash is main's (`e272e0c0…`), and CI's
  `parks-e272e0c0…` artifact (run 37480483453, 30-day retention) is that
  hash's `.parks/`. Downloaded to scratch, verified with
  `scripts/verify-parks.mts <dir>` (16 of 16 re-hydrated to their recorded
  digest and restart, exit 0), then copied into `.parks/` — the same thing
  CI's `Parks from another run` job does. With it, no check searches a park.
- Step set (parsed from `scripts`, not grepped): every one of main's 79
  `check` leaf steps is present, plus this branch's `check:library-glb` and
  `check:png-integrity` (81). No other script changed but `pack:library`,
  `blend:library`, `render:library` (new).
