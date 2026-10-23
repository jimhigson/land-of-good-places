# HANDOFF — Library v2, track D: the chapter books' engineering base, item 7 (the picture vocabulary)

Branch `feat/library-v2-books`, worktree `.claude/worktrees/library-v2-books`, cut from the
integration head `feat/library-v2` @ 33bcc361 (engine + the four tracks + the API adaptation).
Engineer, Claude Fable 5.1, 22–23 Oct 2026; **restarted 23 Oct 04:3x by Claude Opus 5.5** (the
first agent stopped with the handoff's red transcripts and the index's doc uncommitted — both
verified against the tree and committed as found). Scratch logs: `.claude/library-build-scratch/books/`.
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
- [x] the file layout for the two book engineers, written down (below) and in `chapterBooks/index.ts`:
      the six ids/files/titles/slots table, and two shelf blocks (places 1–3, 4–6) in both the
      imports and the list, so the two book branches merge without a conflict — proved in a scratch
      repo (`git -c rerere.enabled=false merge --no-ff` of an a-branch adding three under block 1
      and a b-branch adding three under block 2: both clean, the list in shelf order)
- [x] `bookKinds.ts`'s stale claim (books.ts outside the parks' closure) corrected: measured with
      `parkSourceClosure`, `books.ts`, `chapterBooks/index.ts` and `bookKinds.ts` are all IN
      (`parkFacts.ts` → `World.ts` → `Library.ts` → `libraryLines.ts` → `books.ts` → the index)
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
- Every book joins by one `import` and one entry in `index.ts`'s list, in shelf order, each under
  its own block's comment line: places 1–3 (book engineer a: sirHopsalot, detectiveBiscuit,
  loudestShush) under `// Shelf places 1–3 …`, places 4–6 (book engineer b: giantFootprints,
  biscuitStorm, catchThatChicken) under `// Shelf places 4–6 …` — in the imports AND in the list.
  Two branches that do this merge cleanly (proved, see Status).
- Every chapter-book file is inside the parks' source closure: every edit moves the park hash, so
  restamp `.parks/manifest.json` (see "Parks, locally") before any World-building check. The World
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

Every mutation below was made in this worktree at 8796bff0 and reverted with `git checkout`;
the tree was clean (`git status --short` empty) and `.parks/manifest.json` back on the tree's hash
after each. **A mutation of a closure file (books.ts, readBooks.ts, furnish.ts, …) moves the park
hash, and check:brevity builds the library to walk its words, so it needs the manifest restamped
to the MUTATED tree before the red run and back after** — the first attempt, without the restamp,
started a 12-minute acceptance solve instead of a 60-second check (killed by PID). The same bit
check:library and the dev server when my own commit moved the hash after the first restamp:
restamp after EVERY src edit, mutation or not.

**Items 1–6 on the engine (books2's reds, re-proved here):**

- **check:brevity, the carve-out does not leak** (real data: `books.ts` ripikaBalloon page 1
  `'RiPika has a spotty balloon.'` → `'RiPika has a balloon. It is spotty.'`, manifest restamped to
  the mutated tree 89be7eee…) → exit 1:
  ```
  check:brevity CONTROL ok   a picture-book page with two sentences goes red (the carve-out does not leak) — 2 sentences; a line is one
  check:brevity CONTROL ok   a picture-book page of a chapter page's thirty words goes red — 150 characters, 100 over the line limit of 50; 2 sentences; a line is one
  bookPage:ripikaBalloon#1                line    35   2  SENTENCES
  BREVITY RULE (GAME_DESIGN.md): 1 problem across 354 pieces of copy.
      2 sentences; a line is one
  ```
  Reverted → exit 0, `BREVITY RULE: 354 pieces of copy are short enough; 6 still carry a recorded exception`.
- **vitest, Big reader has one owner** (`readBooks.ts` `bigReaderEarned`: `chapterBooks.every(` →
  `chapterBooks.some(`; `pnpm exec vitest run test/library/big-reader.test.ts
  test/library/chapter-books.test.ts`) → exit 1, **`Tests 2 failed | 10 passed (12)`**:
  `× is not discovered until the last chapter book is read, in any order` — `Big reader with a
  chapter book still unread: expected true to be false`; `× is never earned by picture books,
  however many` — `Big reader for picture books: expected true to be false`. Reverted → 12 passed.
- **vitest, the story-time predicate** (`books.ts` `storyTimeMayRead` → `return true;`;
  `test/library/chapter-books.test.ts`) → exit 1, **`Tests 1 failed | 3 passed (4)`**: `× lets
  story time read picture books, and never a chapter book` — `story time would read a chapter page
  aloud: expected true to be false` (the fixture is PICTURE_BOOKS[0] re-tagged `chapter`).
  Reverted → 4 passed; the three library vitest files together `16 passed (16)`.
- **check:library, the big readers' shelf is measured** (`LIBRARY_CHECK_REMOVE='bookcase west-4'`,
  seed 5 restart 1 hydrated under hash f1ac5997…, the reading room at (−600, −600); west-4 is the
  wall case at x −17.7..−17.1, z 2..6, top 3.20) → exit 1, **99 ✓ 7 ✗**: `✗ bookcase west-4: a
  body's edge got 0.600 m into it (allowance 0.071)`, `✗ 43 drawn boxes, 560 marches; deepest a
  body's edge got into one: 0.600 m (bookcase west-4), allowance 0.071`, `✗ bookcase west-4 at
  (-17.69, 5.96): landed at 0.000, its top is 3.200` (×4 landings), `✗ 50 tops, 7526 landings
  across their drawn footprints: 169 fell through`. Unmutated → exit 0, 101 ✓ 0 ✗.
- **check:book-reader item 9, the over-long page** (`CHECK_BOOK_READER_CHAPTER=overlong`, the
  fixture's 152-word page 9 at the laptop 1280×800 and the phone 375×667, Baloo 2 bold 0.488 em a
  character, seed 5; its own dev server on port 6434) → exit 1, **1067 ok, 6 FAIL**: `FAIL laptop
  checkChapterFixture only a phone held on its side may be asked to turn — here every page must
  fit`, `FAIL laptop checkChapterFixture face 10 (story page 9) the words stay inside their box —
  block [48,263–711,1184] in box [48,263–720,972], 24 line(s) of 38.4 px`, `… no ink in the margins
  — 1757 ink pixel(s), the first at (51, 976) below the words`, and the phone-portrait three (37
  line(s) of 57.6 px, 5249 ink pixel(s)) — the figures books2 recorded, unchanged on the engine.

**Item 7's own (this branch):**

- **check:book-reader 9b, every model is drawn** (`scripts/check-book-reader.mts`: the line
  `{ model: 'parkBench', at: [-1.3, 0, -0.9], turn: 15 }` removed from the model sheet's Detective
  page; its own dev server on port 6435) → exit 1, **1053 ok, 1 FAIL**: `FAIL every picture model
  is drawn on a page this check opens — never drawn: parkBench`. Reverted (`git checkout`).
- **`assertDrawsSomething`, a model that draws nothing** (at 51aec20c, park hash fb2690b5…, seed 5;
  `SERVED_CHECKS_PORT=6437 pnpm run check:served-book-reader`; logs in the scratch folder).
  Mutation, `reader/storyProps.ts` `createSpoon`: the kit's one `spoon` node hidden
  (`handle.root.children[0]!.visible = false` — a visibility flag left off; the model sheet's roof
  page draws one spoon among seven models) → **exit 1**, `check:book-reader FAILED — 14394
  problem(s)`: `threw — page.waitForFunction: Timeout 120000ms exceeded.` (the sheet never finishes
  painting) and `page error — Error: pagePictures: the 'spoon' model drew nothing — no visible
  vertex under its root 'story.spoon'`, thrown from `renderPicture` ← `PageArtist.picture` ←
  `BookReader.ensurePainted` (the reader retries the face each frame, hence the count).
  **CONTROL, the assertion is not redundant**: the same hidden spoon with the
  `assertDrawsSomething(root, actor)` call commented out → **exit 0**, `check:book-reader passed`
  (1054 ok): `ok every picture model is drawn on a page this check opens — all 63`, `ok every
  picture on the model sheet drew its models — 11 pictures, the thinnest covering 21.3% of its
  pixels`. Item 9b's coverage cannot see one empty model on a crowded page; the assertion can.
  Both reverted with `git checkout` → tree clean.

**Found red, not planted — check:shard-1 at cece064a** (`check:flat-primitives`, `scripts/
check-flat-primitives.mts`, baseline 310 expressions, 102 flat-ok sites): exit 1, **5 new flat
primitive(s)** — `src/entities/Player.ts:1845 [Y_DIFFERENCE] p.y - this.hoverAt.y` (the engine's
hover rescue, 97444d7f; `origin/feat/engine-solids` @ 7ce1deae carries the same line against the
same baseline, so the engine head is red on shard-1 too — nobody had run it since), `src/world/
library/reader/pagePictures.ts:320 [Y_DIFFERENCE] high - low` (books2's `strapJetpack`, merged
into the integration unrun), and my `pagePictures.ts:577` `box.max.y - box.min.y` / `box.max.y` /
`box.min.y` (the star fitted to the wheel's bracket). Each is a difference in one body's own local
frame (the hover: the same body a moment later, plan drift tested first) and carries a
`// flat-ok: <reason>` now (8796bff0) → exit 0, `107 site(s) carry an explicit // flat-ok: reason`.

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
