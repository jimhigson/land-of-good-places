# HANDOFF — the story-props kit (every model the six chapter books' pictures need)

Branch `art/story-props`, worktree `.claude/worktrees/art-story-props`, cut from
`origin/feat/engine-solids` (2aa9da02). Role: 3D Artist, headless Blender only
(`/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup
--python-exit-code 1 --python <script>`), Blender 5.2.2 LTS on Jim's Mac.

Jim, 22 Oct 2026: *"model in Blender as much as is needed, in preference to coding
geometric primitives to create items in the world"* — every NEW thing drawn in a
chapter book's picture is modelled here, packed to a glb with a TypeScript loader,
rendered, and recorded in ASSET_MANIFEST.md (§42). Engineers use this kit and never
build a new visible item out of three.js primitives. *A sprite, a particle or a label
is not a model.*

Sources read: `final.json` on `origin/feat/library-714-books2`
(`docs/library-build/chapter-books/final.json`, the editor's six books with a picture
spec per page), `DRAFTS.md` and `judging.json` beside it, the books2 handoff's picture
vocabulary, `src/world/library/reader/pagePictures.ts` + `readerAssets.ts` +
`PICTURE_MODELS` (`books.ts`). Precedent followed exactly: the library kit
(`art/blend/library_build.py` / `_export.py` / `_render.py`, `pack-library-asset.mts`,
`libraryGlb.ts`, `check-library-glb.mts`).

## Status — done

- [x] worktree, install, branch pushed
- [x] source material read; model list below
- [x] blend scripts run again on this branch (Decision 1)
- [x] `art/blend/story_props_build.py` → `story_props.blend` (31 assets, 61 nodes,
      17 232 triangles; every CONTRACT line measured; two faced nodes; no pivots)
- [x] `story_props_export.py` → `src/art/assets/storyProps.glb` (449 KB)
- [x] `scripts/pack-story-props-asset.mts` → `storyPropsGlb.ts` (+ `STORY_FACES`), budget 480 KB
- [x] `package.json`: `blend:story-props`, `pack:story-props`, `render:story-props`;
      `check:story-props-glb` in shard-1 right after `check:library-glb` — parsed the
      scripts object before and after: shard-1 26 → 27 steps, missing `[]`, added
      `["pnpm run check:story-props-glb"]`, every other script byte-identical
- [x] loader `src/world/library/reader/storyProps.ts` (one decode on first use,
      `STORY_PROPS_STYLES`, a factory per asset; API below)
- [x] `scripts/check-story-props-glb.mts` + the shared body `scripts/lib/check-glb-kit.mts`
      (`check-library-glb.mts` now calls it too; its output is unchanged), proved red twice
- [x] `check:assets`: 32 story subjects added to `collect` — all measured, zero drift
- [x] `story_props_render.py` → `art/renders/story-props/*.png` (48 pictures), every one
      opened and judged; four shapes reworked on what they showed (Decision 7)
- [x] ASSET_MANIFEST.md row + §42
- [x] tsc 0, typecheck:test 0, check:story-props-glb 0, check:library-glb 0,
      check:assets 0 (167 assets), check:png-integrity — see the final section

## The model list (what the game does not have), with the pages each serves

Page refs: H = Duck, Sir Hopsalot!; D = Detective Biscuit; S = The Loudest Shush;
F = The Giant Footprints; B = Biscuit and the Storm; C = Catch That Chicken!

| asset (collection) | nodes | pages | notes |
|---|---|---|---|
| `storm-cloud` | `-face` (FACED), `-puffs` | B2, B5, B8, B9, B10 (+ title) | Nimbus. Four moods the judge named (frown, sad, surprised, happy) + neutral/blink via the house `Expression` set; grey or white is `createStoryCloud({ colour })`. Face in the round face puff's own UVs, `STORY_FACES` the `LIBRARY_FACES` way. |
| `fluffy-cloud` | `fluffy-cloud` | C5 | Faceless, long and low — a different silhouette so nobody takes it for Nimbus. |
| `rainbow-arch` | `-band1..6` | H7, H8, H9, F10, B8 | The Rail Race finish; band count read off `ART.rainbow`'s length (one colour per node, inner band first). The ride solves its radius per route (`track.ts`), so the prop's radius is the kit's. |
| `queue-posts` | `-posts`, `-rope` | H2, H10 | Two gold posts, a red rope. |
| `rubber-duck` | `-body`, `-head` (FACED), `-beak` | H10 (+ title) | The payoff duck; a painted (static) face, beak for a mouth. |
| `park-bench` | `-seat`, `-legs` | D1, F4 | Open underneath (Biscuit hides there). Seat top = `KID_HIP_HEIGHT` (kid.ts), the library's seat rule. |
| `magnifying-glass` | `-frame`, `-lens` | D2, D3, D7 | Lens its own node. |
| `pancake-footprint` | one node | D3, D4 | The mini's flat wide foot, three toes. Engineers scatter eight. |
| `giant-footprint` | one node | F1, F2, F3, F4, F5, F6 | Dinner-plate disc, four stubby toes. |
| `spoon` | one node | D8, C6 | |
| `flat-stone` | one node | D8 | The keyring's stone. |
| `stick` | one node | D8 | The balloon's stake. |
| `open-book` | `-cover`, `-pages` | S2 (two), S4 | Pages curving up from the gutter. |
| `loose-page` | one node | S4 | Curled thin page, fluttering. |
| `closed-book` | `-cover`, `-pages` | S3, S4, S5, S6, S8, S9, S10, B4, B6 (+ the picture books' `book`) | **The one picture-book primitive the chapter books reuse** (`createStoryBook` in readerAssets.ts): Mrs Crumpet's pile ×3, the mouse's dropped book, the cloud book. 0.42 × 0.32 × 0.10, that factory's size. |
| `flower` | `-stem`, `-petals`, `-centre` | F3 | Whole flower; the nibbled yellow one is the stem node alone (`nibbled: true`). |
| `petal` | one node | F6 | On Grandpa Tock's nose. |
| `picnic-blanket` | `-cloth`, `-checks` | B1, B2, B9, B10 | Gingham: 15 checks a second node for a second colour. |
| `sandwich` | `-bread`, `-filling` | B2, B3, B9, B10 | One wedge, bevelled. |
| `sandwich-tower` | `-bread`, `-filling` | B1, B2 | Sixteen, teetering, taller than Biscuit (1.12 m). |
| `sandwich-heap` | `-bread`, `-filling` | B10 | Nimbus's forty-one — literally 41, five layers, asserted. |
| `jam-tart` | `-pastry`, `-jam` | B1, B3 | Fluted. |
| `cake` | `-sponge`, `-icing`, `-cherry` | B1, B3 | Two tiers, dripping icing. |
| `puddle` | one node | B4 | Under dripping Biscuit. |
| `window-frame` | one node | B5 | Between them and the cloud. |
| `umbrella-inside-out` | `-canopy`, `-handle` | B7 | Scalloped bowl pointing up on a stick. |
| `battlement` | one node | B8 | Castle roof run; merlon height read from `CASTLE_MERLON_HEIGHT` (layout.ts). |
| `story-wheel` | `-rim`, `-spokes`, `-cars`, `-legs`, `-bracket`, `-lights` | C1, C9 | The stand-in Space Ferris Wheel (not `createFerrisWheelProp`, a world ride). Star bracket at the hub plainly empty (C1, asserted open by rays); `star` sits at `bracketCentre` and `-lights` glow on C9 (`lit: true`), hidden on C1. |
| `feather` | one node | C2 | Two, white and red (`createFeather(ART.chickenComb)`). |
| `twig-nest` | `-bowl`, `-twigs` | C6, C7, C8 | Chicken-looter's hoard. |
| `biscuit-treat` | `-body`, `-chips` | C6, C8 | A biscuit to eat, not Biscuit the bear. |

**Not modelled, and why**: confetti (H8, H9), raindrops (B3, B7), drips (B4) are
particles/decor — *"a particle is not a model"*; the reader's 2D `decor` already has
`splash`, `sparkles`, `clouds`. The library's desk, reading lamp, bookshelf (S2, S3, S5,
S10) are `library.glb` (`createLibraryDesk`, `createLibraryReadingLamp`,
`createLibraryBookcase` + shelf books; "jumbled by the purring" is placement). Empty
candy-floss sticks (B8) are `flossStickGeometry()` in `shopItems.ts`. Everything the
judge called "NEW picture model from an existing factory" (mini, pinkWall, tortoise,
owl, candyFloss, jetpack, discoBall, lollipopTree, surpriseEgg, alienSaucer) exists and
is the picture engineers' to wire into `PICTURE_MODELS`.

## The loader API (`src/world/library/reader/storyProps.ts`)

Every factory returns an `AssetHandle` (`root` named `story.<asset>`, origin at the
base, facing +Z, `height = visibleBounds(root).top`, `root.scale` untouched):

- `createStoryCloud({ colour? }): StoryCloudHandle` — a `CreatureHandle`
  (`setExpression` with the house set; `limbs: null`; `headMaterial`). Default colour
  `PALETTE.stoneGreyMid`; Nimbus fed is `ART.wingWhite`. Starts on `frown`.
- `createFluffyCloud()`, `createRainbowArch()`, `createQueuePosts()`, `createRubberDuck()`
- `createParkBench()`, `createMagnifyingGlass()`, `createPancakeFootprint()`,
  `createGiantFootprint()`, `createSpoon()`, `createFlatStone()`, `createStick()`
- `createOpenBook(colour?)`, `createLoosePage()`, `createStoryClosedBook(colour?)`
- `createStoryFlower({ colour?, nibbled? })`, `createPetal(colour?)`
- `createPicnicBlanket()`, `createSandwich()`, `createSandwichTower()`,
  `createSandwichHeap()`, `createJamTart()`, `createCake()`
- `createPuddle()`, `createWindowFrame()`, `createInsideOutUmbrella()`, `createBattlement()`
- `createStoryWheel({ lit? }): StoryWheelHandle` (`lights: Mesh`, `bracketCentre: Vector3`)
- `createFeather(colour?)`, `createTwigNest()`, `createBiscuitTreat()`
- plus `storyPropMesh(name, colour?, material?)`, `storyPropPart(name)`,
  `storyPropPartNames()`, `STORY_PROPS_STYLES` for anything bespoke.

## Decisions (with reasons)

1. **Blend scripts were unrunnable on this branch; fixed in `blendkit.ts_const`.**
   engine-solids (d075b6f9) moved `KID_HEIGHT` to `src/art/models/kidHeight.ts` and left
   `export { KID_HEIGHT } from './kidHeight';` in kid.ts ("every caller that learned it
   there still finds it"). `ts_const`'s regex only knew the literal form, so
   `castle_build`, `library_build`, `castle_render` (imports castle_build), `hotel_render`
   and the five reptile renders all asserted at import. `ts_const` now follows a
   re-export line to the module it names (still one owner, still read); `hotel_render`
   uses hotel_build's grandfathered copy, so its one read points at `kidHeight.ts`.
   Verified: `import library_build, castle_render, hotel_render` → `LB_IMPORT_OK 2.12
   0.36 1.6 … hotel_render 2.12 merlon 1.05`. Not a CI check, but a tool every Artist
   needs; disclosed here rather than left. **Main does not have this move yet**: the fix
   is harmless there and needed the moment engine-solids merges.
2. **The kit imports `library_build`'s machinery** (`Asset`, `register`, face windows,
   the node/pivot/face/winding/scale checks) rather than copying it: one owner of the
   face-UV convention (front polygons over the node's own bounds, `v` pre-inverted,
   back faces parked at (0.02, 0.02)), so a default `CanvasTexture` /
   `planarUvCanvasTexture` is right for these heads exactly as for the owl's
   (`check:story-props-glb`: `dv/dy +1.067` cloud, `+3.952` duck).
3. **Two faced nodes, built round**: `storm-cloud-face` is the central puff on its own
   (window 1.000 × 0.984 m) so `createBakedFace(...).applyTo(mesh, { uvsAuthored:
   true })` paints round eyes round; the other puffs are `storm-cloud-puffs` and take
   the same colour. `rubber-duck-head` likewise (0.250 × 0.253), one static canvas
   through `paintFaceOnFill` (`applyStaticBakedFace` always remaps UVs and refuses a
   shared geometry, so it cannot serve an authored head). Eye anchors travel as node
   extras; the loader's `eyesOf` reads `STORY_FACES` and refuses a pair that is not
   level and centred.
4. **Sizes**: a prop's size is the kit's own (the glb is the owner; the loader measures
   with `visibleBounds`); where the game owns a figure it is read — `KID_HIP_HEIGHT`
   (bench seat), `CASTLE_MERLON_HEIGHT` (battlement), `ART.rainbow`'s length (bands,
   by a `ts_array_len` regex over the array literal). `TALLEST_FLOWER` is an
   expression, not a literal, so the storybook flower is the kit's own 0.8 m, inside
   the park's flower range.
5. **`readerAssets.ts` is not edited here** (four library tracks touch that area):
   `createStoryBook` keeps its body; the join makes it delegate to
   `createStoryClosedBook` so the pile is the kit's book (one owner of the closed book).
6. **No pivots**: picture props; nothing turns in a still picture. The export asserts
   every node leaves at the identity.
7. **Reworked on the renders** (every one opened with Read): the cloud's crown was two
   matched puffs and read as a grey mouse with ears under its face — now three uneven
   puffs, the biggest set back; the heap's four tidy layers read as a tiled roof — now
   five layers (16/12/8/4/1 = 41) each sandwich turned and nudged by a fixed pattern;
   the flower's narrow petals spread like a propeller — now plump and overlapping round
   a bigger centre; the nest's long upward twigs made a sea urchin — now short and
   nearly level. The renders' dull cast is the shared Workbench pipeline (the library's
   `cat.png` has it too), not the kit's colours.
8. **Bytes**: the first export was 538 KB. Crisp (unbevelled) wedges in the tower and
   heap (a bevelled wedge is 28 shipped vertices, a crisp one 18, fifty-seven times
   over; the lone `sandwich` keeps its bevel), 15 bigger gingham checks instead of 32,
   one-segment car corners and 24 arc steps on the rainbow brought it to 449 KB;
   budget 480 KB, beside the library's 450.
9. **Even lobe counts on anything with an exact width** (puddle 6, nest bowl 8, stone 2,
   biscuit 12, tart 10) and segments a multiple of the lobes: an odd count puts a trough
   opposite every peak and the measured width can never meet the contract (see the
   reds). The build caught it; the shapes are no worse for it.
10. **`check-library-glb.mts`'s body moved to `scripts/lib/check-glb-kit.mts`** and both
    checks call it — a second 300-line copy would be two checks that drift. Its printed
    output for the library is unchanged (`check:library-glb` exit 0, 65 nodes).

## Red transcripts (with the geometry or input each was proved against)

**check:story-props-glb, the typed faces.** Mutation (by sed on the generated
`storyPropsGlb.ts`, glb of 9c539e2b): `'storm-cloud-face': { face_eyes_uv: [0.69, 0.5,
0.31, 0.5]` → `[0.59, 0.5, 0.31, 0.5]`. `pnpm run check:story-props-glb` → exit 1:
```
1 problem(s):
  ✗ STORY_FACES is not the .glb's face extras — run `pnpm run pack:story-props`.
```
**check:story-props-glb, the module is the file.** Mutation: one base64 character
changed at base64 offset 608472 (`'C'` → `'B'`, deep in the BIN chunk, the JSON intact).
→ exit 1:
```
1 problem(s):
  ✗ storyPropsGlb.ts (457852 B) is not storyProps.glb (457852 B) — they differ from byte 456354. Run `pnpm run pack:story-props` on the committed export.
```
Both reverted with `git checkout -- src/art/assets/storyPropsGlb.ts` → exit 0, `The
story-props kit ships as built, and both readers read it the same.`

**The build's CONTRACT, red on real misses while authoring** (each the figure the
geometry measured, at the shapes as then written):
```
AssertionError: rubber-duck.depth: the contract says <= 0.6000 and the geometry measures 0.6689.
AssertionError: spoon.depth: the contract says = 0.3300 and the geometry measures 0.3069.
AssertionError: puddle.width: the contract says = 0.7000 and the geometry measures 0.6585.   (5 lobes)
AssertionError: twig-nest.bowlWidth: the contract says = 1.4000 and the geometry measures 1.3744.   (9 lobes)
```
Each fixed in the shape or the stated figure (never by loosening a measurement) → the
build's final table is in `build-7.log`'s `CONTRACT, measured` block; all 31 rows green.

## For the join

1. `PICTURE_MODELS` entries + `buildActor` branches + `pictureWarmSteps` for every
   factory above — the picture engineers' step, not this branch's. `createStoryCloud`
   is a `CreatureHandle`, so `isCreature` already routes `mood` to it; it has no limbs,
   so `pose` is ignored.
2. `createStoryBook(colour)` → delegate to `createStoryClosedBook` (Decision 5) and drop
   its three local sizes.
3. Nimbus's colour per page: B2, B5, B8 default grey; B9, B10 `ART.wingWhite`. Mood per
   page is in `final.json`.
4. `createStoryWheel({ lit: true })` on C9, with the `star` (size 2.2 per the spec) at
   `handle.bracketCentre`; C1 default (dark, empty bracket).
5. Flowers on F3: `createStoryFlower({ colour: PALETTE.blossomPink })`,
   `({ colour: PALETTE.flowerBlue })`, and the yellow ones `({ nibbled: true })`.
6. `check:assets` rows were added here (`scripts/check-asset-contract.mts`); if the join
   renames a factory, rename there too.
7. `blendkit.ts_const` follows re-exports now (Decision 1); if main later moves another
   constant into a leaf the same way, nothing else needs doing.
8. Preview path for the PR body: none of its own (a kit is invisible until a page draws
   it); the chapter books' preview carries it.

## Questions for Jim

None blocking. Two choices he may want to overrule by eye once a page draws them: Nimbus's
cross grey is `PALETTE.stoneGreyMid` (the park's rose-tinted grey; a deeper grey reads
angrier but darker), and the heap is literally forty-one sandwiches because a child may
count them.
