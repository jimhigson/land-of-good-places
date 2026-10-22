# HANDOFF — Library v2 art: the secret den's Blender pieces

Branch `art/library-v2-den`, worktree `.claude/worktrees/art-library-v2-den`,
cut from `origin/feat/engine-solids` (2aa9da02). 3D Artist, Claude Fable 5.1.
Scratch logs: `/Users/jim/dev/landOfGoodPlaces/.claude/library-build-scratch/art-den/`
(`build-3.log` is the kit's build log; `reds-summary.log` and `red*.log` the reds;
`*-final*.log` the green runs at the head).

The task: every visible thing the den track (plan Steps 11–14,
`docs/library-build/PLAN-parts-4-5.md`; `origin/feat/library-714-den`, merged into
`origin/feat/library-v2` at fb19ccc1) draws or would draw from three.js primitives,
modelled in Blender instead, so no engineer builds a new visible thing from primitives
(Jim, 22 Oct).

## Status — done
- [x] Worktree, `pnpm install --frozen-lockfile` (pnpm/12.1.0, node v26.5.0), branch pushed.
- [x] Census of the den track's primitives (Step 1 below) and of what `library.glb` has and lacks.
- [x] **The den kit** — `art/blend/library_den_build.py` → `libraryDen.blend` →
      `library_den_export.py` → `src/art/assets/libraryDen.glb` (82 108 B) →
      `scripts/pack-library-den-asset.mts` → `libraryDenGlb.ts`; `pnpm run blend:library-den`.
      14 nodes, 2 748 triangles, every CONTRACT figure asserted on the mesh (`build-3.log`).
- [x] **The loader** — `src/art/models/libraryDenKit.ts` (decode once; `LIBRARY_DEN_PLAN`
      measured) and `libraryDenAssets.ts` (`LIBRARY_DEN_GLB_STYLES`, `libraryDenMesh`, the three
      factories, the two size readers); `src/art/style/glbMeasure.ts` lifted out of
      `libraryKit.ts` so both kits measure with one reader; `libraryAssets.ts` exports its
      dresser as `dressGlbPart`.
- [x] **Checks** — `check:library-glb` walks both kits; `check:assets` measures the three
      new assets (138, was 135); `check:png-integrity` covers the eight renders. Reds below.
- [x] **Renders** — `pnpm run render:library-den` → `art/renders/library-den/*.png` (8), each
      opened and judged (below).
- [x] ASSET_MANIFEST.md: a row in the kits table, section 42.
- [x] A red found on the base and fixed at its cause: the engine moved `KID_HEIGHT` into
      `src/art/models/kidHeight.ts` (d075b6f9), so all eight Blender scripts that read it off
      `kid.ts` with `ts_const` failed at import; they now read the new owner (5dbb7704).

## Step 1 — what the den track draws from primitives (the census)

Read off `git diff bb4eb46f..origin/feat/library-714-den -- src/world/library/shell.ts`
(the den track's only drawing code) and the plan's Steps 12–13:

| drawn thing | where | primitive | new? | now |
|---|---|---|---|---|
| the den's floor slab `library.den.floor` | `buildLibraryDenShell` | `BoxGeometry` x −24.5..−18.6, z −8.2..−1.4, 0.5 thick, top at the floor | new | `den-floor` |
| the den's three walls `library.den.wall.{west,north,south}` | same | `BoxGeometry` 0.6 thick × 5.2 high; west x −24.5..−23.9 z −8.2..−1.4 (takes the corners); north x −23.9..−18.3 z −8.2..−7.6; south (hidden, camera side) x −23.9..−18.3 z −2.0..−1.4 | new | `den-wallWest` / `den-wallNorth` (niched) / `den-wallSouth` |
| the lintel over the den's doorway `library.lintel` | `buildReadingRoomShell` | `BoxGeometry` x −18.3..−17.7, y 3.2..5.2, z −6..−2, in the west wall's cloned material | new | `den-lintel` |
| the west wall's two spans `library.wall.west` | same | the room's own wall boxes, split either side of the gap | existing (#716) | unchanged |
| trim round the gap | — | none drawn, none planned | would be new | none (Decision 3) |
| the pull book on the secret shelf | plan Step 12 (`secretShelf.ts`, not yet written) | `book-tall-thick` in `ART.helmetGold` + outline, 3 cm proud, plus a twinkle `Sprite` | would be new (a special book drawn as an ordinary block) | `secretBook-*` |
| den contents | plan Step 13 | the nest, dragon, cat, pile — all **already** `library.glb` nodes | existing | unchanged |
| den dressing | — | nothing planned: bare green walls | would be bare | niches, boards, backs, stars, moon, lanterns |

**What `library.glb` already has** (65 nodes, 18 568 triangles, 449 528 B of a 460 800 B
budget): the owl (10 nodes), the dragon (7) and its nest (5), the cat (5), the book pile (6),
`secretShelf-carcass/-shelves`, `shelf-*`, six `book-*` blocks, the cushion, the armchair (3),
the desk (2), two lamps (5), the reader cover, the exterior shell (10). **What it lacked** for
the den: any room geometry (floor, walls, lintel), any den dressing, a *special* book shape.

## Decisions (with reasons)

1. **A new small kit, `libraryDen.glb`, not an addition to `library.glb`.** The library kit
   has 11 272 bytes of headroom under its 450 KB budget; the den is 80 KB. Raising the main
   kit's budget would spend the gate that protects it; a second kit costs one more decode of
   a file a fifth the size, which is the reptile house's shape (six kits for one building).
   Same pipeline, same scripts; `check:library-glb` walks both. Budget 100 KB (25% headroom).
2. **Every size read from its owner, none typed twice.** `LIBRARY_WALL_HALF`,
   `LIBRARY_WALL_HEIGHT`, `LIBRARY_DEN_DEPTH`, `LIBRARY_DEN_DOOR_HALF` and
   `DEN_NORTH_PAST_DOOR` from `layout.ts` with `ts_const`; the doorway's width and the
   lintel's base from `library_build.SHELF_LENGTH`/`SHELF_HEIGHT` (the shut case fills the
   gap — the build asserts `SHELF_LENGTH == 2·LIBRARY_DEN_DOOR_HALF` and the loader asserts
   the drawn doorway against `LIBRARY_SHELF_FOOTPRINT`); the niche rows from
   `library_build.SHELF_KICK/SHELF_BOARD/SHELF_ROW_CLEAR/SHELF_ROWS`, so a den row **is** a
   reading-room row (0.180, 0.756, 1.332, 1.908, 2.484 m; 0.516 clear). The kit's own figures
   (niche depth 0.34, back 0.03, board setback 0.02, bays 3 × 1.5 between 0.275 piers, relief
   25 mm, floor slab 0.5, lantern 0.62, book 0.46 × 0.11) are its CONTRACT, measured back.
3. **No trim round the gap.** On the room side a frame round a bookcase flush in the wall
   would give the secret away (the plan's own reason for accepting the leaf's 4.5 cm jamb
   clip). On the den side the doorway is on the camera's near wall — the room's west wall,
   which fades while she is in the den — so a frame there is seen only from behind, through
   a faded wall. The lintel is a plain wall piece (`den-lintel`, dressed in the west wall's
   material by the engineer so it fades with the spans and reads as wall from the room).
4. **The den is book-lined by niches cut into its far walls, not by cases against them.**
   Niches recess into the 0.6 m wall thickness, so the den track's three wall colliders are
   unchanged, nothing new needs a keep-out, and the nest (1.3 m off each far wall) and both
   den stands stay clear. The books are the kit's instancing blocks, placed by the engineer on
   `LIBRARY_DEN_PLAN.niches` exactly as `shelveFace` fills a case (baked books would cost ~0.3
   MB). The niche backs are a thin panel 5 mm inside the pocket on every side and the boards
   abut the reveals, so no two faces of different nodes share a plane in the same direction.
5. **The den's magic is emissive, never a `PointLight`** (8 of 8): raised gold stars and a
   cream moon on the far walls above the niches (`lift`), two paper lanterns whose balls glow,
   and the pull book's raised star (its own node and material) for the twinkle.
6. **The den asset's origin is the doorway's middle on the wall's centre line, at the bottom
   of its floor slab.** The slab is the den's plinth, the way the exterior's plinth stands
   under its door: `check:assets`' "base at zero" holds, and the engineer places the root
   `LIBRARY_DEN_PLAN.floorTop` (0.5) below the room's floor. A new origin family, `DOORWAY`,
   asserted in the build (the lintel centred on x and y, the lowest vertex at z 0).
7. **The pull book is 0.46 m tall, 0.11 thick, `BOOK_DEPTH` deep**: taller than any kit book
   (`TALL_BOOK` 0.42) so it stands proud of its row's skyline, under a row's 0.516 m clear
   with `BOOK_PULL_MARGIN` to spare (asserted); the spine 1 cm proud of the boards with a
   12 mm star on it. Shelved like a kit block (base-centred, thickness along X, spine +Z).
8. **The lantern hangs with its back on the wall and its bottom at zero** (family `WALL`,
   asserted) — the sconce's convention, so `check:assets` measures it as any base asset.
9. **Eight Blender scripts read `KID_HEIGHT` from `kidHeight.ts` now** (not `kid.ts`): the
   number is unchanged (2.12), only its owner moved; no other kit was rebuilt by this.

## The base, and how the den constants reached this branch
`origin/feat/engine-solids` typechecks (`tsc-engine-solids.log`, exit 0);
`origin/feat/library-v2` at a30e7b96 did not (exit 2: four errors in the join's own in-progress
`Library.ts`/`shell.ts` adaptation), so this branch stays on engine-solids. That base lacks the
den track's layout constants, which the kit reads with `ts_const`, so **`layout.ts` here gains
the den track's secret-den block verbatim** (lines 384–467, taken from `feat/library-v2`'s copy
of it, which equals the den track's byte for byte) at the same anchor — so the join of this
branch into `feat/library-v2` merges that hunk cleanly — **with one word added:**
`export const DEN_NORTH_PAST_DOOR = 1.6;` (the den track has `const`; `ts_const` reads only
`export const`). If `feat/library-v2` has since edited that block, the conflict is that one
block: take the join's and keep the `export`.

## Node list, sizes, origins (from `build-3.log`, never from memory)

Asset frame = game axes (+Y up, +Z toward the reading room through the doorway; Blender's
−Y). Sizes in metres; "base z" is Blender's up.

| node | tris | extent (asset x × game z × height) | notes |
|---|---|---|---|
| `den-floor` | 12 | x −2.6..4.2, z −6.5..−0.6, y 0..0.5 | the slab; top = floor she walks on (`floorTop` 0.5); abuts the room floor's apron edge at z −0.6 |
| `den-wallWest` | 148 | x −2.6..4.2, z −6.5..−5.9, y 0.5..5.7 | the far wall, takes both corners; 3 niches on its +Z face |
| `den-wallNorth` | 148 | x 3.6..4.2, z −5.9..−0.3, y 0.5..5.7 | 3 niches on its −X face; abuts the room wall's outer face (z −0.3) and the far wall |
| `den-wallSouth` | 12 | x −2.6..−2.0, z −5.9..−0.3, y 0.5..5.7 | plain; the game hides it (camera side) |
| `den-lintel` | 12 | x −2..2, z −0.3..0.3, y 3.7..5.7 | the doorway, 4.0 wide = `SHELF_LENGTH`; base 3.2 above the floor = `SHELF_HEIGHT`; part of the room's west wall |
| `den-shelves` | 1320 | 30 boards 1.5 × 0.29 × 0.06 | fronts 0.02 behind the wall face; tops 0.18/0.756/1.332/1.908/2.484 above the floor |
| `den-nicheBacks` | 72 | 6 panels 1.49 × 0.03 × 2.87 | the niche backs, 0.31 behind the wall face |
| `den-stars` | 360 | nine 5-point stars, r 0.13–0.24 | 25 mm reliefs on the far walls, lowest 3.41 m above the floor |
| `den-moon` | 148 | a crescent r 0.42 | 25 mm relief, far wall near the nest's corner |
| `denLantern-bracket` | 252 | 0.18 × 0.36 × 0.62 | plate (back on z 0), curly arm, cap, knob; bottom at 0 |
| `denLantern-glow` | 80 | ball r 0.138, centre (0, 0.245, 0.27) | the part the Engineer lights |
| `secretBook-cover` | 132 | 0.11 × 0.27 × 0.46 | two boards + a rounded spine 1 cm proud (+Z) |
| `secretBook-pages` | 12 | 0.086 × 0.225 × 0.44 | cream block inside the boards |
| `secretBook-star` | 40 | r 0.03, 12 mm proud, 0.288 up the spine | the twinkle's node |

CONTRACT, measured (all `=` within 5 mm): den innerDepth 5.600, northPastDoor 1.600,
southPastDoor 0.000, doorWidth 4.000, lintelBase 3.200, wallHeight 5.200, wallThickness 0.600,
floorTop 0.500, niches 6, rowsPerNiche 5, rowClear 0.516 (≥ 0.460), nicheUsableDepth 0.310
(≥ 0.280), reliefStandOff 0.025 (≤ 0.030), lowestRelief 3.406 (≥ 3.2); denLantern height 0.620,
width 0.276 (≤ 0.40), depth 0.415 (≤ 0.45), backOnWall 0.000; secretBook height 0.460, width
0.110, shelfDepth 0.260, depth 0.282 (≤ 0.30), triangles 184 (≤ 400). Origins: den `DOORWAY`
x −2.600..+4.200 y −0.300..+6.500 z 0..5.700 (Blender); denLantern `WALL` back on y 0, bottom
on z 0; secretBook `FLOOR`. The far corner, walls included, is 7.739 m from the doorway's
middle (room: (−24.5, −8.2) from (−18, −4)).

## Loader API

`src/art/models/libraryDenKit.ts` (bare geometry, no colour — in the park source closure):
- `libraryDenPart(name)`, `libraryDenPartNames()`, `denKitBounds(names, keep?)`.
- `LIBRARY_DEN_ROOM_NODES`, `LIBRARY_DEN_LANTERN_NODES`, `LIBRARY_SECRET_BOOK_NODES`.
- **`LIBRARY_DEN_PLAN: LibraryDenPlan`**, measured at load (values on this kit):
  `floorTop` 0.5; `floor` {minX −2.6, maxX 4.2, minZ −6.5, maxZ −0.6}; `wallHalf` 0.3;
  `wallHeight` 5.2; `doorHalf` 2; `lintelBase` 3.2; `lintelTop` 5.2; `depth` 5.6;
  `farInnerZ` −5.9; `northInnerX` 3.6; `southInnerX` −2; `northPastDoor` 1.6;
  `southPastDoor` 0; `reach` 7.739; `height` 5.7; `niches` (6): west at x −0.975/0.8/2.575
  (z −5.9, facing 0) and north at z −1.325/−3.1/−4.875 (x 3.6, facing 270), each
  {length 1.5, depth 0.31, height 2.88, innerHalf 0.75, boardFront −0.02, shelfTops
  [0.18, 0.756, 1.332, 1.908, 2.484], shelfClear [0.516 ×5]} — **in the niche's own frame**:
  origin on the wall's inner face at the niche's middle at floor level, X along the wall, +Z
  out of the wall, the same terms `libraryBookcaseSize` describes a case in, so `shelveFace`'s
  arithmetic fills it. It throws at load unless the doorway equals the drawn shelf's length
  and the lintel's base its height (`LIBRARY_SHELF_FOOTPRINT`).

`src/art/models/libraryDenAssets.ts` (dressing):
- `LIBRARY_DEN_GLB_STYLES` (every node; parity-checked against the file at load; the render
  script reads its colour keys), `libraryDenMesh(name, material?)`.
- `createLibraryDen(paint?: { floor?, wall?, lintel? }): LibraryDenHandle` —
  `{ root, height, floor, walls: { west, north, south }, lintel, shelves, nicheBacks, stars,
  moon }`, every node a direct child of `root` at the kit's transform. Pass the room's
  `fabric.floor`, `fabric.wall` and the `westMaterial` clone so the den is one paint with the
  room and the lintel fades with the west wall.
- `createLibraryDenLantern(): LampHandle` (`bulb` = the glow's measured centre);
  `libraryDenLanternSize()` → {out 0.415, halfWidth 0.138, height 0.62}.
- `createLibrarySecretBook(): SecretBookHandle` — `{ root, height, star, starMaterial }`
  (`starMaterial.emissiveIntensity` is the twinkle's, resting at the table's `lift` 0.6);
  `librarySecretBookSize()` → {height 0.46, thickness 0.11, depth 0.26, proud 0.022}.
- `libraryAssets.ts` now exports `dressGlbPart(part, style, material?)` — its one dresser.
- `src/art/style/glbMeasure.ts`: `eachGlbVertex`, `eachGlbTriangle`, `glbBounds`, `glbTreads`,
  `glbFirstHit`, `KitBounds` — `libraryKit.ts` delegates to these; its API is unchanged.

## Checks, with exit codes (at the head, `*-final*.log`)
- `pnpm exec tsc --noEmit` — exit 0 (`tsc-2.log`, on the loader; files since restored to that state).
- `pnpm run typecheck:test` — exit 0 (`typecheck-test-1.log`).
- `pnpm run check:library-glb` — exit 0: library.glb 65 nodes, 3 faced heads, two readers agree;
  libraryDen.glb 14 nodes, *paints nothing: all 14 nodes checked for texcoords and extras, none
  found*, two readers agree (`library-glb-final2.log`).
- `pnpm run check:assets` — exit 0: *138 assets check out* (135 before); `--verbose` rows
  `library.den 5.700/5.700 +0.000 0.000`, `library.denLantern 0.629/0.629 +0.000 −0.010`,
  `library.secretBook 0.471/0.471 +0.000 −0.011` (`assets-verbose.log`).
- `pnpm run check:png-integrity` — exit 0, the eight new renders included (`png-integrity-1.log`).
- Static: `check:chain-coverage` 0, `check:cycle-tdz` 0, `check:pow-operator` 0, `check:text` 0,
  `check:node` 0; **`check:flat-primitives` exit 1 — a pre-existing red on the base**, not this
  branch's: `src/entities/Player.ts:1828 [Y_DIFFERENCE] p.y - this.hoverAt.y` from the engine's
  own commit 97444d7f, present unfixed on `feat/engine-solids` and `feat/library-v2`. It is the
  engine agent's live file, so it is reported here, not edited; my files raise no finding.
- `package.json`: three scripts added (`pack:library-den`, `blend:library-den`,
  `render:library-den`); the `check` and nine `check:shard-N` chains compared as parsed strings
  before and after — unchanged (no new `check:*` script, so `check:chain-coverage` is untouched).

## Reds (each proved, then restored with `git checkout`; `reds-summary.log`, `red*.log`)
Geometry they were proved against: the den kit at b76a149c — doorway x ±2.0 at y 3.7..5.7
(Blender), niches 1.5 wide, 0.34 deep with a 0.03 back and boards 0.02 back (usable 0.31);
the pull book 0.46 × 0.11 × 0.26; the glb 82 108 bytes, 14 nodes.
1. **`check:library-glb`, the module is not the file** — one base64 character of
   `libraryDenGlb.ts` changed, 2 000 in (the JSON chunk): exit 1,
   `✗ libraryDen.glb: libraryDenGlb.ts (82108 B) is not libraryDen.glb (82108 B) — they differ
   from byte 1500. Run \`pnpm run pack:library-den\` on the committed export.` and
   `✗ libraryDen.glb: the shipped bytes are not a readable glb: Expected ',' or '}' after
   property value in JSON at position 1480`; 60 000 in (the binary chunk): exit 1,
   `… they differ from byte 45000.` (`red1-at-2000.log`, `red1-at-60000.log`).
2. **`check:library-glb`, a node carrying extras on a kit that ships none** — `den-floor`
   given `extras: {face_eyes_uv: [0.6,0.5,0.4,0.5]}` in the glb's JSON and re-packed (so the
   bytes match): exit 1, `✗ libraryDen.glb: den-floor: extras {"face_eyes_uv":[0.6,0.5,0.4,0.5]}
   on a kit that ships none` (`red2-extras.log`).
3. **`check:assets`, a declared height that is not the built one** — `createLibrarySecretBook`
   returning `visibleBounds(root).top + 0.1`: exit 1, `library.secretBook: declares height
   0.571 m but measures 0.471 m (-0.100 m)` (`red3-assets-height.log`).
4. **The loader's doorway-equals-shelf assertion** — the comparison in `libraryDenKit.ts` made
   against `LIBRARY_SHELF_FOOTPRINT.length + 1`: `check:assets` exit 1, `Error: libraryDenKit:
   the den's doorway is 4.000 m wide and the drawn bookcase that fills it is 4.000 m long`
   (the message prints the true figures; the mutation was in the comparison) (`red4-loader-doorway.log`).
5. **The build's CONTRACT** — `NICHE_DEPTH` 0.34 → 0.29: the build exits 1 before saving,
   `AssertionError: den.nicheUsableDepth: the contract says >= 0.2800 and the geometry measures
   0.2600.` (`red5-build-contract.log`; `libraryDen.blend` untouched, 23:22 timestamp).

## The renders (`art/renders/library-den/`), judged
- `den-interior.png` (1300×900, the game's angle, south wall and lintel hidden as the game
  fades/hides them): the far walls read as built-in bookcases full of spines, the dragon on its
  nest in the far corner, stars and the moon above, a lantern on each far wall, the open shelf's
  back in the foreground where the game fades it. **Cosy, book-lined, a little magical — yes.**
  The niche books are the render's own placing (405 blocks); the engineer's will be the same.
- `den-interior-plan.png`: the same from 72°, for the layout.
- `den-doorway.png`: from the reading room — the lintel and the stand-in spans are one green,
  the shut shelf sits between its neighbours like any case, the gold book on its second row.
  **The secret is kept.** The pull book is small from here; the twinkle sprite will carry it.
- `secretBook-row.png`: the pull book among ordinary books, gold, taller, proud, a star on its
  spine — **reads at once.**
- `den.png`, `denLantern.png`, `secretBook.png`: each beside a 2.12 m post. The lantern is
  chunky (5 cm arm) and legible; the book's cream page block shows at its top.
- `lineup.png`: the lantern (0.62) and the book (0.46) beside the kit's tall thick book against
  the hip (0.36) and reach (1.04) lines and the 2.12/2.97 posts.
- Honest gaps: Workbench shows the glow parts (lantern ball, star) as flat ochre/grey — in the
  game they are emissive. The far walls' band above the niches (3.0–5.2 m) is plain but for
  the reliefs; a cornice at the cases' height would tie it to the room if Jim wants more.

## For the join (the den engineer swapping primitives for the kit)
- **Place the den**: `const den = createLibraryDen({ floor: fabric.floor, wall: fabric.wall,
  lintel: westMaterial }); den.root.position.set(-LIBRARY_HALF_X, -LIBRARY_DEN_PLAN.floorTop,
  LIBRARY_SECRET_BOOKCASE.at.z); den.root.rotation.y = Math.PI / 2; denRoot.add(den.root);`
  (room-local: asset +Z → room +X, asset +X → room −Z). Then `den.walls.south.visible = false`
  (the camera's near side) and **`westWall.attach(den.lintel)`** — `attach` keeps its world
  placement — because `denRoot` is hidden while the leaf is shut and the lintel is the wall.
  Drop `library.den.floor`, the three `library.den.wall.*` boxes and `library.lintel` from
  `shell.ts`; keep every `props.wall`, the `Plate` and the lintel's `addWall` exactly as they are.
- **Hold the layout to the drawn den at load** (the `libraryDenGap` pattern), in `shell.ts`:
  throw unless `|LIBRARY_DEN_PLAN.depth − LIBRARY_DEN_DEPTH| ≤ 0.005`, `northPastDoor` =
  `DEN_NORTH_PAST_DOOR`, `wallHalf` = `LIBRARY_WALL_HALF`, `wallHeight` =
  `LIBRARY_WALL_HEIGHT`, `doorHalf` = `LIBRARY_DEN_DOOR_HALF`. (Or derive `LIBRARY_DEN_INNER`
  from the plan; either way one owner is asserted, never two trusted.)
- **Line the niches**: for each `niche` of `LIBRARY_DEN_PLAN.niches`, a `Group` under
  `den.root` at `(niche.centre.x, LIBRARY_DEN_PLAN.floorTop, niche.centre.z)` with
  `rotation.y = niche.facing · π/180`, then `shelveFace`'s loop with `size = niche` (same field
  names; `boardFront` is −0.02, so spines land 0.03 behind the wall's face and a 0.26 book's back
  0.02 short of the panel). One `InstancedMesh` per shape, as a case. The den's books fade
  with nothing (the walls are solid); `parkFacts`' drawn-reach exclusion already covers
  `roomRoot`'s children.
- **Lanterns**: `createLibraryDenLantern()` twice under `den.root`, at a pier of each far wall
  above the niches — e.g. between `niches[0]` and `niches[1]`
  (`x = (n0.centre.x + n0.innerHalf + n1.centre.x − n1.innerHalf) / 2`, `z = farInnerZ`,
  `y = floorTop + lintelBase`, facing 0) and between `niches[4]` and `niches[5]`
  (`x = northInnerX`, facing 270). No collider (3.7 m up); no `PointLight` (the budget is full).
- **The pull book**: `createLibrarySecretBook()` in the leaf's frame at `LIBRARY_SECRET_BOOK`
  (shelf 1, along 0): `y = shelfTops[1]`, `z = boardFront − SPINE_INSET − size.depth/2 +
  READABLE_PROUD`-style 0.03 — the same arithmetic as `shelfBookMesh`, with
  `librarySecretBookSize()`. Drive `starMaterial.emissiveIntensity` for the twinkle (rest 0.6);
  the plan's sprite twinkle can stay beside it. `LIBRARY_DEN_GLB_STYLES['secretBook-cover']` is
  `ART.helmetGold` + outline, as the plan asked.
- **`layout.ts`**: this branch's den block equals `feat/library-v2`'s plus `export` on
  `DEN_NORTH_PAST_DOOR` (needed by `ts_const`); keep the export.
- **`libraryAssets.ts`**: the kids track's `seatCentre` change is at line ~728; mine is at
  line ~259 (`placedGlbMesh`/`dressGlbPart`) — no overlap.
- **`check:library`** LIGHT reads the floor material's albedo: the den floor mesh uses
  `fabric.floor` itself (passed in), so nothing changes there; COPLANAR: the den's nodes meet
  the room's floor and wall only edge to edge or back to back (asserted in the build's
  `check_abutting`), as the primitives did.
- **The pre-existing red** `check:flat-primitives` on `Player.ts:1828` (engine commit
  97444d7f) will fail shard 1 until the engine marks or rewrites that hover test.
- `ASSET_MANIFEST.md` section 42 and the kits-table row are this branch's; the plan's Step 14
  docstring note for `build_secret_shelf` is not done here (not this task).

## Questions for Jim (decided for now, recorded)
1. **No trim round the den's doorway** (Decision 3) — the lintel reads as plain wall from the
   room so the bookcase keeps its secret; the den side is only ever seen through the faded
   wall. Say if the room side should hint at the door.
2. **The stars and the moon are 25 mm reliefs on the walls**, above every reach, with no
   collider — inside an ink outline's own thickness. Say if they should be flush paint instead.
3. **The lanterns glow but cast no light** (the room's eight pools are spent). Say if the den
   deserves a pool more than one of the room's.
