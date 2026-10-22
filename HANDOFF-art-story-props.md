# HANDOFF — the story-props kit (every model the six chapter books' pictures need)

Branch `art/story-props`, worktree `.claude/worktrees/art-story-props`, cut from
`origin/feat/engine-solids` (2aa9da02). Role: 3D Artist, headless Blender only
(`/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup
--python-exit-code 1 --python <script>`), Blender 5.2.2 LTS on Jim's Mac.

Jim, 22 Oct 2026: *"model in Blender as much as is needed, in preference to coding
geometric primitives to create items in the world"* — every NEW thing drawn in a
chapter book's picture is modelled here, packed to a glb with a TypeScript loader,
rendered, and recorded in ASSET_MANIFEST.md. Engineers use this kit and never build a
new visible item out of three.js primitives. *A sprite, a particle or a label is not
a model.*

Sources read: `final.json` on `origin/feat/library-714-books2`
(`docs/library-build/chapter-books/final.json`, the editor's six books with a picture
spec per page), `DRAFTS.md` and `judging.json` beside it, the books2 handoff's picture
vocabulary, `src/world/library/reader/pagePictures.ts` + `readerAssets.ts` +
`PICTURE_MODELS` (`books.ts`). Precedent followed exactly: the library kit
(`art/blend/library_build.py` / `_export.py` / `_render.py`, `pack-library-asset.mts`,
`libraryGlb.ts`, `check-library-glb.mts`).

## Status

- [x] worktree, install, branch pushed
- [x] source material read; model list below
- [x] blend scripts run again on this branch (see Decision 1)
- [ ] `art/blend/story_props_build.py` → `story_props.blend`
- [ ] `story_props_export.py` → `src/art/assets/storyProps.glb`
- [ ] `scripts/pack-story-props-asset.mts` → `storyPropsGlb.ts` (+ `STORY_FACES`)
- [ ] `package.json`: `blend:story-props`, `pack:story-props`, `render:story-props`,
      `check:story-props-glb` in shard-1 beside `check:library-glb` (parsed, sets compared)
- [ ] loader `src/world/library/reader/storyProps.ts` (one decode, factories)
- [ ] `scripts/check-story-props-glb.mts` (shared body with check-library-glb), proved red
- [ ] `story_props_render.py` → `art/renders/story-props/*.png`, every one looked at
- [ ] check:assets rows, ASSET_MANIFEST.md row + section
- [ ] tsc, typecheck:test, check:story-props-glb, check:png-integrity, check:assets — exit codes read

## The model list (what the game does not have), with the pages each serves

Page refs: H = Duck, Sir Hopsalot!; D = Detective Biscuit; S = The Loudest Shush;
F = The Giant Footprints; B = Biscuit and the Storm; C = Catch That Chicken!

| asset (collection) | nodes | pages | notes |
|---|---|---|---|
| `storm-cloud` | `-face` (FACED), `-puffs` | B2, B5, B8, B9, B10 (+ title) | Nimbus. Four moods the judge named (frown, sad, surprised, happy) + neutral/blink via the house `Expression` set; grey→white is the loader's `setColour`. Face in the central puff's own UVs, `STORY_FACES` the `LIBRARY_FACES` way. |
| `fluffy-cloud` | `fluffy-cloud` | C5 | Faceless, long and low — a different silhouette so nobody takes it for Nimbus. |
| `rainbow-arch` | `-band1..6` | H7, H8, H9, F10, B8 | The Rail Race finish; band count read off `ART.rainbow`'s length (one colour per node). The ride's own radius is solved per route (`track.ts`), so the prop's radius is the kit's. |
| `queue-posts` | `-posts`, `-rope` | H2, H10 | Two posts, a swagged rope. |
| `rubber-duck` | `-body`, `-head` (FACED), `-beak` | H10 (+ title) | The payoff duck; painted face, like every face in the park. |
| `park-bench` | `-seat`, `-legs` | D1, F4 | Open underneath (Biscuit hides there). Seat top = `KID_HIP_HEIGHT` (kid.ts), the library's seat rule. |
| `magnifying-glass` | `-frame`, `-lens` | D2, D3, D7 | Lens its own node (pale, maybe translucent — engineer's). |
| `pancake-footprint` | one node | D3, D4 | The mini's flat wide foot. Engineers scatter eight. |
| `giant-footprint` | one node | F1, F2, F3, F4, F5, F6 | Dinner-plate disc, four stubby toes. |
| `spoon` | one node | D8, C6 | |
| `flat-stone` | one node | D8 | The keyring's stone. |
| `stick` | one node | D8 | The balloon's stake. |
| `open-book` | `-cover`, `-pages` | S2 (two), S4 | Pages in a shallow V. |
| `loose-page` | one node | S4 | Curled thin page, fluttering. |
| `closed-book` | `-cover`, `-pages` | S3, S4, S5, S6, S8, S9, S10, B4, B6 (+ picture books' `book`) | **The one picture-book primitive the chapter books reuse** (`createStoryBook` in readerAssets.ts): Mrs Crumpet's pile ×3, the mouse's dropped book, the cloud book. |
| `flower` | `-stem`, `-petals`, `-centre` | F3 | Whole flower; the nibbled yellow one is the stem node alone (`nibbled: true`). |
| `petal` | one node | F6 | On Grandpa Tock's nose. |
| `picnic-blanket` | `-cloth`, `-checks` | B1, B2, B9, B10 | Gingham: checks a second node for a second colour. |
| `sandwich` | `-bread`, `-filling` | B2, B3, B9, B10 | One wedge. |
| `sandwich-tower` | `-bread`, `-filling` | B1, B2 | Teetering stack taller than Biscuit. |
| `sandwich-heap` | `-bread`, `-filling` | B10 | Nimbus's forty-one. |
| `jam-tart` | `-pastry`, `-jam` | B1, B3 | |
| `cake` | `-sponge`, `-icing`, `-cherry` | B1, B3 | Two tiers, dripping icing. |
| `puddle` | one node | B4 | Under dripping Biscuit. |
| `window-frame` | one node | B5 | Between them and the cloud. |
| `umbrella-inside-out` | `-canopy`, `-handle` | B7 | |
| `battlement` | one node | B8 | Castle roof run; merlon height read from `CASTLE_MERLON_HEIGHT` (layout.ts). |
| `story-wheel` | `-rim`, `-spokes`, `-cars`, `-legs`, `-bracket`, `-lights` | C1, C9 | The stand-in Space Ferris Wheel (not `createFerrisWheelProp`, a world ride). Star bracket at the hub plainly empty (C1); `star` sits in it and `-lights` glow on C9 (hidden on C1). |
| `feather` | one node | C2 | Two, red and white (colour is the engineer's). |
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
   needs; disclosed here rather than left.
2. **The kit imports `library_build`'s machinery** (`Asset`, `register`, face windows,
   the node/pivot/face/winding/scale checks) rather than copying it: one owner of the
   face-UV convention (front polygons over the node's own bounds, `v` pre-inverted,
   back faces parked at (0.02, 0.02)), so `planarUvCanvasTexture` / a default
   `CanvasTexture` is right for these heads exactly as for the owl's.
3. **Two faced nodes, not one**: `storm-cloud-face` is the central puff on its own so
   its UV window is near-square and `createBakedFace(...).applyTo(mesh, { uvsAuthored:
   true })` paints round eyes round, with `setFill` for grey→white; the other puffs are
   `storm-cloud-puffs` and take the colour too. `rubber-duck-head` likewise.
4. **Sizes**: a prop's size is the kit's own (the glb is the owner; the loader measures
   with `visibleBounds`); where the game owns a figure it is read — `KID_HIP_HEIGHT`
   (bench seat), `CASTLE_MERLON_HEIGHT` (battlement), `ART.rainbow`'s length (bands).
   `TALLEST_FLOWER` is an expression, not a literal, so the storybook flower is the
   kit's own size, inside the park's flower range.
5. **`readerAssets.ts` is not edited here** (four library tracks touch that area):
   `createStoryBook` keeps its body; the join makes it delegate to
   `createStoryClosedBook` so the pile is the kit's book (one owner of the closed book).
6. **No pivots**: these are picture props; nothing turns in a still picture.

## Red transcripts (with the geometry each was proved against)

(to come)

## For the join

1. `PICTURE_MODELS` entries + `buildActor` branches + `pictureWarmSteps` for every
   factory below — the picture engineers' step, not this branch's.
2. `createStoryBook(colour)` → delegate to the kit's closed book (Decision 5).
3. Preview path for the PR body: none of its own (a kit is invisible until a page
   draws it); the chapter books' preview carries it.

## Questions for Jim

(none yet)
