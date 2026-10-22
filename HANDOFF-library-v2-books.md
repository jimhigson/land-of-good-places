# HANDOFF — Library v2, track D: the chapter books' engineering base, item 7 (the picture vocabulary)

Branch `feat/library-v2-books`, worktree `.claude/worktrees/library-v2-books`, cut from the
integration head `feat/library-v2` @ 33bcc361 (engine + the four tracks + the API adaptation).
Engineer, Claude Fable 5.1, 22–23 Oct 2026. Scratch logs: `.claude/library-build-scratch/books/`.
Plan: `docs/library-build/PLAN-parts-4-5.md`; the old base's record is `HANDOFF-library-books2.md`
(items 1–6, merged into the integration at a30e7b96); the kit's record is `HANDOFF-art-story-props.md`.

Jim's rulings that bind this track: the chapter books (14 Oct, *"~30 words per page … jokes,
adventure, adversaries, conflict, but resolve well"*; the twelve picture books unchanged) and Blender
(22 Oct, *"model in Blender as much as is needed, in preference to coding geometric primitives to
create items in the world"* — every NEW thing drawn in a chapter book's picture is the Artist's;
engineers never build a visible item out of three.js primitives; a sprite or particle is not a model).

## Status

- [x] worktree cut, installed (pnpm 12.1.0, node 26.5.0), branch pushed
- [x] `git -c rerere.enabled=false merge --no-ff origin/art/story-props` → d7734c86, clean. The kit:
      31 Blender assets / 61 nodes in `src/art/assets/storyProps.glb` (449 KB), loader
      `src/world/library/reader/storyProps.ts`, `check:story-props-glb`, 32 `check:assets` rows.
      It also carries three `feat/engine-solids` commits (7ce1deae: check:solids, Player.ts,
      NpcSystem.ts) the integration did not have yet. `package.json` compared by PARSING the
      `scripts` object before and after: `check:shard-1` 26 → 27 steps, missing `[]`, added exactly
      `pnpm run check:story-props-glb`; four scripts added (`check:story-props-glb`, `pack:`, `blend:`,
      `render:story-props`); every other script byte-identical (179 → 183 names).
- [x] item 7, the picture vocabulary, on the kit (see "What changed" below) — tsc 0, typecheck:test 0
- [ ] the file layout for the two book engineers, written down (below) and in `chapterBooks/index.ts`
- [ ] runs: check:brevity, check:library (hydrated park), check:served-book-reader, vitests,
      check:story-props-glb, check:assets, build — exit codes read
- [ ] items 1–6 re-verified on the engine with their reds re-proved
- [ ] handoff final, push

## Parks, locally

The merge moved the park source hash (Player.ts and NpcSystem.ts are in the closure):
`8644cfac…` → **`45bccc92bc703c35a86d390deb73579a980dddab6894f5950934eefc05abd2d6`** (and any later
src edit moves it again: `node scripts/lib/park-source-hash.mjs`). `.parks/` here is the
integration's honest seed 5 (`../library-v2/.parks/5.json`, restart 1, digest d6721090fb3f1d3a)
with `manifest.json`'s `sourceHash` restamped to this tree's — the engine handoff's shortcut (the
reading room is seed-independent; `acceptedRestartOf` reads `.parks/manifest.json` first, so no
12-minute acceptance loop runs). Re-restamp after every src edit, or a check script will start a
seed-5 solve.

## What changed (item 7)

The books2 WIP (d32a205a, merged as "verified, not reverted") had built the chapter books' vocabulary
the way the plan assumed before Jim's Blender ruling: a `prop` picture actor made of primitive
`PropPart`s (`reader/pictureProps.ts`) and a primitive `createStoryCloud` in `readerAssets.ts`. Both
are gone. A page now names a model from `PICTURE_MODELS` and nothing else:

- **`books.ts`** — `PICTURE_MODELS` is 63 names: the 19 picture-book models, the 10 park additions
  (mini … alienSaucer), four more park pieces the editor's pages name (`flossStick`, `libraryDesk`,
  `readingLamp`, `bookcase`), and the kit's 31 (`stormCloud` and the closed `book` were already
  names; 29 new: fluffyCloud, rainbowArch, queuePosts, rubberDuck, parkBench, magnifyingGlass,
  pancakeFootprint, giantFootprint, spoon, flatStone, stick, openBook, loosePage, flower, petal,
  picnicBlanket, sandwich, sandwichTower, sandwichHeap, jamTart, cake, puddle, windowFrame,
  umbrellaInsideOut, battlement, storyWheel, feather, twigNest, biscuitTreat). Its doc is the
  mapping from the editor's "prop: …" lines to model names, page by page. `PropShape`, `PropPart`
  and `PictureActor.parts` are deleted; `PictureActor.nibbled` (flower) and `.lit` (storyWheel) are
  added; `colour` now also paints an open book's cover, petals, a petal, a feather and the lit
  wheel's star. `PictureDecor` gains `confetti` and `rain` (the editor's confetti, raindrops and
  drips — particles, so 2D decor; drips are `splash`).
- **`reader/pagePictures.ts`** — a `buildActor` branch per model, each a kit factory or a park
  factory. `buildPictureBookcase` is the kit's wall case stocked by **`furnish.ts`'s own
  `shelveFace`** (now exported with `bookInstances`, so the storybook shelf is filled by the room's
  one rule, under a spec no readable slot names). `buildStoryWheel` puts the park's star toy in the
  bracket when `lit`: scaled to `STAR_IN_BRACKET` (0.9) of the bracket's measured box and stood on
  its front face — both measured off vertices, nothing typed. **`assertDrawsSomething`**: every
  actor's root must have a visible vertex or the render throws naming the model (a picture's
  coverage is of the whole cast, so an empty factory would otherwise pass). Warm-up: `storyWheel:lit`
  added (the glow material and the star are hidden otherwise), the `prop` entry gone.
- **`reader/storyProps.ts`** (the Artist's loader; one small addition) — `StoryWheelHandle.bracketBox`
  (a `Box3` round the bracket node's vertices; `bracketCentre` is now its centre).
- **`reader/readerAssets.ts`** — `createStoryBook(colour)` delegates to the kit's
  `createStoryClosedBook` (one closed book; the glb is 0.42 × 0.32 × 0.10, the old factory's size);
  the primitive `createStoryCloud` is deleted; the file doc no longer says "built from primitives
  until Blender's arrive" of anything but the cover.
- **`reader/pictureProps.ts`** — deleted.
- **`reader/pageFaces.ts`** — `confetti` (28 flat squares in the marker colours, each turned) and
  `rain` (40 pale slanting streaks) in `paintDecor`, seeded like every other decor.
- **`art/models/shopItems.ts`** — `createFlossStick()` (the stick standing on its end, its height
  read off the geometry's parameters), and `createCandyFloss` builds its stick with it.
- **`scripts/check-book-reader.mts`** — the model sheet (item 9b) is rebuilt on the kit: ten pages
  that, with the real books' pages, draw all 63 models, plus the two new decor; the primitive
  `prop` fixtures are gone and `fixtureColourProblems` no longer walks `parts`.

## The file layout the two book engineers follow

One file per chapter book, its words and its pictures and nothing else, plus one index:

```
src/world/library/chapterBooks/
  index.ts            CHAPTER_BOOKS, in shelf order — the ONE place both engineers meet
  sirHopsalot.ts      export const sirHopsalot: LibraryBook   (shelf slot 13, big readers' shelf west-4)
  detectiveBiscuit.ts export const detectiveBiscuit            (14)
  loudestShush.ts     export const loudestShush                (15)
  giantFootprints.ts  export const giantFootprints             (16)
  biscuitStorm.ts     export const biscuitStorm                (17)
  catchThatChicken.ts export const catchThatChicken            (18)
```

- Words: `docs/library-build/chapter-books/final.json` → `text` per page, verbatim; `title` (≤ 24
  characters), `kind: 'chapter'`, `cover` a `PaletteKey`, 8–10 pages of 20–40 words whose every
  sentence is ≤ 120 characters (`check:brevity`'s `chapterPage` shape).
- Pictures: each page's `picture.models` lines in `final.json` name the model (`bunny`, `ripika`,
  …) or say "prop: …" — the `PICTURE_MODELS` doc in `books.ts` says which model each "prop" line
  is. Moods are the house `Expression` set; `colour`/`accent`/`variant`/`size`/`at`/`turn`/`pose`
  as the picture books use them; `grab` (mini), `keyring: false` (kid), `jetpack: 'on' | 'off'`
  (kid or pet), `nibbled: true` (flower), `lit: true` (storyWheel). Decor: the existing eleven plus
  `confetti` and `rain`.
- Every book joins by one `import` and one entry in `index.ts`'s list, in shelf order. The World
  throws at load for a book in the wrong list or a shared id, and `shelfBooks.ts` throws for a
  picture book on a chapter slot. While fewer than six are in, the last slots WAIT (check:library
  says so on stderr); when all six are in, make READABLE's `CHAPTER_BOOKS.length <= chapterSlots`
  `===` and drop the WAIT note (`HANDOFF-library-v2.md`, "For the join").
- Nothing in a picture may be a primitive. A thing no model covers is a request to the Artist.

## Decisions (with reasons) — Jim is away; each is also for the PR body

1. **The vocabulary is one model name per kit asset** (`fluffyCloud`, `rainbowArch`, …), not one
   `storyProp` model with a `variant`: that is how the picture books already name things
   (`petBed`, `bowl`, `star`), it reads as data, and `pictureWarmSteps`/item 9b walk the list for
   free. 63 names is fine — the warm-up builds each once.
2. **The library's desk, lamp and bookcase, and the bare floss stick, are picture models too.**
   The editor's pages name them and the Artist left them to the existing kits ("library.glb";
   "flossStickGeometry()"). The bookcase's spines come from `furnish.ts`'s `shelveFace`
   (exported) rather than a second fill rule — one owner, per CLAUDE.md's "two definitions of one
   thing". `furnish.ts` is in the parks' closure and a seam with track C; the change is two
   `export` keywords and a doc line.
3. **Confetti and rain are 2D decor, not models** (the Artist's ruling: "a particle is not a
   model"); drips are the existing `splash`. Painted like every other decor, seeded, from PALETTE.
4. **The star in the lit wheel is the park's own star toy**, fitted to the bracket's measured box
   (`STAR_IN_BRACKET` 0.9 of its width, stood on its front face). The editor said "star … size 2.2
   … back in its bracket at the hub"; a typed 2.2 would be a copy of a size the bracket owns, so it
   is measured instead. `lit` is one flag for one story fact (the star is home: lights on, star in).
5. **Nimbus's white is `blossomWhite`** (a `PaletteKey`), not the Artist's suggested `ART.wingWhite`:
   a page's `colour` is a `PaletteKey` and stays so (one palette for pages). The difference is a
   tint nobody will see on a 512-px picture.
6. **`assertDrawsSomething` is game code, not a check-side mutation**: a model drawing nothing is
   an impossible state the reader must refuse loudly (the same shape as every other contract throw
   in this codebase), and item 9b's per-picture coverage cannot see one empty model on a crowded
   page. Proved below.
7. **The kit's 460 KB glb joins the main bundle** (`Game.ts` imports `BookReader` statically, which
   imports `pagePictures`, which imports `storyProps`): the same as `LIBRARY_GLB_BASE64` and the
   reptile kits, per `HANDOFF-library-v2.md`'s risk note. Decoded once, on the first kit factory,
   behind the bus ride's warm-up. No bundle budget check exists; noted, not acted on.

## Red transcripts (with the geometry or input each was proved against)

(filled in as each is run — see the structured output and the sections below)

## For the join (feat/library-v2)

- `PICTURE_MODELS` is 63; item 9b's model sheet draws them all. Track A/B/C engineers touching
  `check-book-reader.mts` item 10 or `furnish.ts`: the only furnish change is `export` on
  `PlacedBook`, `shelveFace`, `bookInstances`.
- The two book engineers add `chapterBooks/<id>.ts` + an index entry each; see the layout above.
- `blendkit.ts_const` follows re-exports (the Artist's fix) travels with the merge.

## Questions for Jim

None blocking. Two he may want to overrule by eye once a page draws them: Nimbus's white is the
palette's `blossomWhite` (not the Artist's `ART.wingWhite`); the lit wheel's star fills 0.9 of its
bracket.
