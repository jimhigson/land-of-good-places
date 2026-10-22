# HANDOFF — Library v2 art: the secret den's Blender pieces

Branch `art/library-v2-den`, worktree `.claude/worktrees/art-library-v2-den`,
cut from `origin/feat/engine-solids` (2aa9da02). 3D Artist, Claude Fable 5.1.
Scratch logs: `/Users/jim/dev/landOfGoodPlaces/.claude/library-build-scratch/art-den/`.

The task: every visible thing the den track (plan Steps 11–14,
`docs/library-build/PLAN-parts-4-5.md`; `origin/feat/library-714-den`, now
merged into `origin/feat/library-v2` at fb19ccc1) draws or would draw from
three.js primitives, modelled in Blender instead, so no engineer builds a new
visible thing from primitives (Jim, 22 Oct).

## Status
- [x] Worktree, `pnpm install --frozen-lockfile` (pnpm/12.1.0, node v26.5.0), branch pushed.
- [x] Read: the plan's Steps 6–14, the den track's `shell.ts`/`layout.ts`/handoff, the
      library kit (`library_build.py`, `_export`, `_render`, the packer, `libraryGlb.ts`,
      `check-library-glb.mts`, `libraryKit.ts`, `libraryAssets.ts`, `libraryCreatures.ts`),
      ART_DIRECTION §1/§4/§5/§7/§8, `src/art/models/CLAUDE.md`, ASSET_MANIFEST §41.
- [ ] The den kit built, exported, packed, checked, rendered, recorded (below).

## Step 1 — what the den track draws from primitives (the census)

Read off `git diff bb4eb46f..origin/feat/library-714-den -- src/world/library/shell.ts`
(the den track's only drawing code) and the plan's Steps 12–13:

| drawn thing | where | primitive | new? |
|---|---|---|---|
| the den's floor slab `library.den.floor` | `buildLibraryDenShell` | `BoxGeometry` x −24.5..−18.6, z −8.2..−1.4, 0.5 thick, top at the floor | new |
| the den's three walls `library.den.wall.{west,north,south}` | same | `BoxGeometry` 0.6 thick × 5.2 high; west x −24.5..−23.9 z −8.2..−1.4 (takes the corners); north x −23.9..−18.3 z −8.2..−7.6; south (hidden, camera side) x −23.9..−18.3 z −2.0..−1.4 | new |
| the lintel over the den's doorway `library.lintel` | `buildReadingRoomShell` | `BoxGeometry` x −18.3..−17.7, y 3.2..5.2 (the case's measured height to the wall's top), z −6..−2, in the west wall's cloned material (fades with it) | new |
| the west wall's two spans `library.wall.west` | same | the room's own wall boxes, now split either side of the gap | existing (the room shell, #716) |
| trim round the gap | — | none drawn; nothing planned | would be new |
| the pull book on the secret shelf | plan Step 12 (`secretShelf.ts`, not yet written) | "the tallest, thickest shape" — `book-tall-thick` from the kit, `toonMaterial(ART.helmetGold)` + outline, 3 cm proud, plus a twinkle `Sprite` | would be new (a special book drawn as an ordinary block) |
| den contents | plan Step 13 | the nest, dragon, cat, pile — all **already** `library.glb` nodes | existing |

**What `library.glb` already has** (65 nodes, 18 568 triangles, 449 528 B of a 460 800 B
budget): the owl (10 nodes), the dragon (7) and its nest (5), the cat (5), the book pile (6),
`secretShelf-carcass/-shelves`, `shelf-*`, six `book-*` blocks, the cushion, two armchair
nodes + feet, the desk, two lamps, the reader cover, the exterior shell (10).
**What it lacks** for the den: any room geometry (floor, walls, lintel, a doorway reveal), any
den dressing (shelving, lanterns, carvings), and a *special* book shape for the pull book.

## Decisions (with reasons)

1. **A new small kit, `libraryDen.glb`, not an addition to `library.glb`.** The library kit
   has 11 272 bytes of headroom under its 450 KB budget; the den (two pocketed walls, thirty
   shelf boards, a lintel, stars, lanterns, a special book) is tens of KB. Raising the main
   kit's budget would spend the gate that protects it; a second kit costs one more decode of
   a file a tenth the size, which is the reptile house's shape (six kits for one building).
   Same pipeline, same scripts, same checks — `check:library-glb` walks both kits.
2. **The den's inner plan is read from `layout.ts`** (`LIBRARY_DEN_DEPTH`,
   `LIBRARY_DEN_DOOR_HALF`) and the wall figures (`LIBRARY_WALL_HALF`, `LIBRARY_WALL_HEIGHT`)
   with `ts_const`; the doorway's width and the lintel's base are the drawn secret shelf's
   (`library_build.SHELF_LENGTH`, `SHELF_HEIGHT`, imported — one owner, the kit that draws the
   shelf); the niche rows are the kit's own shelf rows (`SHELF_KICK`, `SHELF_BOARD`,
   `SHELF_ROW_CLEAR`, `SHELF_ROWS`), so a den row is a reading-room row. Nothing is typed twice.
   *How the den constants reached this branch is recorded under "The base" below.*
3. **No trim round the gap.** On the room side a frame round a bookcase flush in the wall
   would give the secret away (the plan's own reason for accepting the leaf's 4.5 cm jamb
   clip). On the den side the doorway is on the camera's near wall — the room's west wall,
   which fades while she is in the den — so a frame there is seen only from behind, through
   a faded wall. The lintel stays a plain wall piece (`den-lintel`, dressed in the west
   wall's material by the engineer so it fades with the spans).
4. **The den is book-lined by niches cut into its far walls, not by cases standing against
   them.** Niches recess into the 0.6 m wall thickness, so the den track's three wall
   colliders are unchanged, nothing new needs a keep-out, and the nest (1.3 m off each far
   wall) and both den stands stay clear. Books are the kit's instancing blocks, placed by the
   engineer on the measured rows (`libraryDenPlan().niches`), exactly as `shelveFace` fills a
   case — baking them would cost ~0.3 MB.
5. **The den's own magic is emissive, never a `PointLight`** (the budget is 8 of 8): raised
   gold stars and a moon on the far walls above the shelves, two wall lanterns with glowing
   candle blobs, and the pull book's own raised star for the twinkle to live on.

## The base
(filled in once the tsc probes of `feat/engine-solids` and `feat/library-v2` are read)

## Node list, sizes, origins
(filled in from the build log — never from memory)

## Loader API
(filled in once written)

## Checks, with exit codes
(filled in)

## Reds (each with the geometry it was proved against)
(filled in)

## For the join
(filled in)

## Questions for Jim
- None yet.
