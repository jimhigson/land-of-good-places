# HANDOFF — Library v2, track D: the chapter books (the engineering base, item 7, and the six books' join)

Branch `feat/library-v2-books`, worktree `.claude/worktrees/library-v2-books`, cut from the
integration head `feat/library-v2` @ 33bcc361 (engine + the four tracks + the API adaptation).
Engineer, Claude Fable 5.1, 22–23 Oct 2026; **restarted 23 Oct 04:3x by Claude Opus 5.5** (the
first agent stopped with the handoff's red transcripts and the index's doc uncommitted — both
verified against the tree and committed as found); **restarted again 23 Oct 05:0x by Claude Opus 5.5**
(found the branch pushed and clean at 3162492f; re-ran every final check and every red at that head —
see "Final runs" and the red transcripts' first paragraph). Scratch logs: `.claude/library-build-scratch/books/`
(this round's are the `*-4.log` files and `book-reader-shots-4/`).
Plan: `docs/library-build/PLAN-parts-4-5.md`; the old base's record is `HANDOFF-library-books2.md`
(items 1–6, merged into the integration at a30e7b96); the kit's record is `HANDOFF-art-story-props.md`.

## THE BOOKS' JOIN (23 Oct, Claude Opus 5.5) — DONE; read this first

All six chapter books are on this branch, on the big readers' shelf (west-4, readable slots 13–18),
in `final.json`'s shelf order. Scratch (logs, instruments, every screenshot):
`.claude/library-build-scratch/books-v2/join/`. The two book worktrees are removed (both were clean,
and pushed: `feat/library-v2-books-a` @ 68b593f2, `-b` @ 54dfbd11 stay on origin). No dev server
or browser of mine is left running.

**What the join did, commit by commit**

| commit | what |
|---|---|
| 7d30cb3c | `git -c rerere.enabled=false merge --no-ff origin/feat/library-v2-books-a` (books 1–3: *Duck, Sir Hopsalot!*, *Detective Biscuit*, *The Loudest Shush*): clean |
| 15e0760a | the same for `origin/feat/library-v2-books-b` (books 4–6: *The Giant Footprints*, *Biscuit and the Storm*, *Catch That Chicken!*): clean. `chapterBooks/index.ts` auto-merged — each branch had inserted under its own block's comment line — and lists the six in shelf order, imports and list alike. Both branches carried the identical `check-book-reader.mts` section-8 hunk (b cherry-picked a's d0f3f282), so it is in once: `LAST` = the last **picture** book |
| 10bab3ff | **The Loudest Shush's cover is `flowerRed` (coral)**, not `trampolinePad` — both book engineers had picked `trampolinePad`, so the merge put two evening-violet books on one shelf and two alike bookmarks in the Cute-o-dex. A new vitest case (`chapter-books.test.ts` case 4) holds every book to a cover colour of its own, **compared by colour, not by palette key** (`markerSky` and `ballPitD` are both #87c9ff). Case 3 now says what it measures with six books on the real shelf |
| a80be87c | `check:library` READABLE: `CHAPTER_BOOKS.length <= chapter slots` is `===`, the "slot(s) WAIT" note and the null "waiting" pairing are gone (every slot expects its book, as before the shelf was laid out ahead of its books). The index's and `shelfBooks.ts`'s docs no longer promise a WAIT note |
| 149000dd | handoff checkpoint |

**Final runs** (src tree = a80be87c's; park hash `3f854c9d…`, seed 5 restart 1 hydrated by restamping
`.parks/manifest.json` with `join/restamp.sh`; every exit code read, counts off the screen):

| check | exit | what it said |
|---|---|---|
| `pnpm exec tsc --noEmit` | 0 | 0 lines |
| `pnpm run typecheck:test` | 0 | 0 errors |
| `pnpm run check:brevity` | 0 | `the library's books — 12 picture books, 6 chapter books (60 chapter pages)`; `432 pieces of copy are short enough; 6 still carry a recorded exception`; 10 `CONTROL ok` |
| `pnpm exec vitest run test/library test/store` | 0 | `Test Files 9 passed (9)`, `Tests 63 passed (63)` (62 + case 4) |
| `pnpm run check:library` | 0 | `101 ✓`, 0 ✗, `All clauses passed.`; `✓ 6 big readers' slots for the 6 chapter books`; `READABLE: 18 books (BOOKS.length), 18 slots, 18 zones pressed through a stub opener`; 77 keep-outs |
| `SERVED_CHECKS_PORT=6551 pnpm run check:served-book-reader` | 0 | `check:book-reader passed`, **2806 ok, 0 FAIL**; `6 real chapter book(s) measured, 164 worded chapter face(s) held to their boxes`; each of the 18 books `0 program link(s)`; chapter books' thinnest picture 53.5 / 52.2 / 51.6 / 54.0 / 51.0 / 18.0 % (shelf order); phone upright smallest picture 63 / 73 / 63 / 73 / 73 / 73 %; phone on its side: the turn-upright card (allowed, announced); `every picture model is drawn … all 63`; section 8: `goodnightPark completes the dex`, `showing []`, then each prize alone; server pid 63490 stopped by the harness, port free after |
| scratch `join/verbatim.mts` (the index as the game imports it vs `final.json`) | 0 | `the index is in final.json's shelf order, and every id, title and page matches (60 pages, 6 titles)`; CONTROL=order exit 1 (`the index is not in final.json's shelf order`); CONTROL=text exit 1 (`catchThatChicken p10: differs at char 0`) — the first text control I wrote was vacuous (it replaced a full stop p10 does not end with, and went green), caught by running it, and repaired |
| reading pass, scratch `join/read.mjs` (port 6552, my own vite, stopped by its process group 63807) | 0 | `READ: every book opened, turned to its end, no page error` |

**The reading pass.** All six books read cover to end in Jim's installed Chrome (headless, throwaway
profile, `channel: 'chrome'`) through the reader's own `/book?id=<id>&seed=5`, turning with real clicks
on the page buttons: every spread at 1280×800 (6 a book, 36) and every page on a phone held upright at
390×844 (12 a book, 72). **All 108 screenshots opened**, and what each showed is written down in
`join/read/NOTES.txt` (written while each was open). Every page's words sit inside the page at both
sizes, no picture is cropped or black, nothing floats, every book reaches The End with no page
error. The coral *Shush* reads well (boards, page frames, end hearts) and sits apart from the pink book
in Mrs Crumpet's pile. Mrs Crumpet's pile on *Storm* p4 is the same mint/lilac/pink pile as *Shush*'s
(book engineer b's join item 3: checked). Two defects, both in park models, neither introduced here:

1. **Grandpa Tock has no eyes** (*The Giant Footprints* p6–p8, and the Reptile House's tortoise
   itself). **Measured** (scratch `join/tock-face.mts`, on `createTortoise(0x70c4)`, the factory the
   pictures and the park both use): a ray from in front at each face part meets the head mesh first
   for 8 of 10 parts — the eyes sit **0.077 m inside the head's front surface** (eye centre z 0.892,
   head surface in front of it at z 0.969; head box x −0.147..0.147, y 0.298..0.648, z
   0.455..1.016), the catchlights 0.043–0.069 inside, the blush 0.019–0.020 inside; only the w-mouth's
   two arcs are in front. **CONTROL**: the same face moved 0.12 m forward → 10 of 10 seen, so the
   instrument can tell a face on the head from one inside it. Root cause: `reptiles.ts` puts the
   tortoise's `geometryFace` at head-local z 0.4 on a head whose front is ≈ 0.477. In the pictures
   only a cream disc with two blush slivers shows (zooms `join/zoom-p7-tock.png`,
   `join/zoom-p8-tock.png`), so his "asleep / drowsy / awake" moods read the same. Not fixed here
   (Decision J5): it is the Reptile House's tortoise too.
2. **Trilla's face is hidden** on 8 of *The Loudest Shush*'s 11 pictures (the editor's moods), and
   *Catch That Chicken!* draws her `surprised` throughout to show her eyes — the known `pets.ts`
   tummy-patch defect both book engineers measured (their handoffs, "For the join" item 1). Not fixed
   here, for the same reason.

**Decisions (with reasons) — for the PR body**

- **J1. The merge needed no hand resolution, and was verified rather than trusted**: both merges were
  clean with rerere off; the index came out in shelf order because each branch wrote under its own
  block line (the base's layout). The order and the words were then measured against `final.json` by
  an instrument whose two controls go red.
- **J2. The Loudest Shush is coral (`flowerRed`), Catch That Chicken! keeps the evening violet**: the
  duplicate came from the merge, not from either branch. Book engineer b chose the violet for the
  bedtime book (a reason); book engineer a chose it only as "none is a picture book's". Coral is the
  shelf's only red and differs by colour from all 17 other covers. One small visible change (a
  cover, its page frames and its bookmark); the new test makes a repeat impossible to miss.
- **J3. READABLE is `===` now, and the game code still tolerates a waiting slot**: the check is where
  "a chapter book went missing" should go red (CI, loudly), as the base, both book engineers and the
  integration's handoff all asked; `shelfBooks.ts`'s `WAITING_SLOTS` (the integration's Decision 3:
  wait loudly rather than refuse to build the World) is left as it is — empty now — so a player's
  game never throws over a missing book.
- **J4. Case 3 of `chapter-books.test.ts` measures the real six-book shelf**: its old name ("never
  hands over Big reader … while it holds no chapter book") described the branch that no longer runs —
  a green line implying cover it did not give. It now checks picture books alone → no card, every
  chapter book but the last → no card, the last → the card.
- **J5. The two hidden faces are reported, not fixed, in this step**: both are park models
  (`reptiles.ts`, `pets.ts`) whose fix changes what a child sees in the Reptile House and on every
  puff pet in the park, not only in the books; this step is the books' join. Both are handed to the
  join with root cause, instrument and the fix (below). The book data already asks for the right
  moods, so the pictures gain the faces with no edit to them (after Trilla's fix, restore the
  editor's moods in `catchThatChicken.ts`, book engineer b's join item 1).

**Red transcripts (each with the input it was proved against)**

- **Cover case, found red on the merge itself** (15e0760a, before 10bab3ff):
  `pnpm exec vitest run test/library/chapter-books.test.ts` → exit 1, `Tests 1 failed | 4 passed (5)`:
  `AssertionError: books sharing a cover colour, of the 18 on the shelf: expected [ Array(1) ] to deeply
  equal []` with `"#8f7fe8: loudestShush (trampolinePad) and catchThatChicken (trampolinePad)"`. After
  the cover change → exit 0, `5 passed (5)`. Log `join/red-vitest-covers.log`.
- **Case 3** (`readBooks.ts` `bigReaderEarned`: `chapterBooks.every(` → `chapterBooks.some(`, real
  shelf of 6) → exit 1, `Tests 2 failed | 3 passed (5)`: `Big reader with 'catchThatChicken' still
  unread: expected true to be false` (the other failure was case 4, not yet fixed at that moment).
  Reverted with `git checkout`. Log `join/red-vitest-case3-some.log`.
- **READABLE, the control on the OLD clause first**: `catchThatChicken` taken out of
  `CHAPTER_BOOKS` (`chapterBooks/index.ts`), manifest restamped to the mutated tree `81c7abf3…` →
  **exit 0**, 101 ✓: `✓ 6 big readers' slots for the 5 chapter books`, `1 slot(s) WAIT for their
  books … slot 18 (west-4, shelf 0, 1.5 m along)` — the old `<=` could not see a book go missing. Log
  `join/control-library-old-check-missing-book.log`.
- **READABLE, the NEW clause** (a80be87c's check, the same mutation and restamp) → **exit 1**, 100 ✓
  3 ✗: `✗ 6 big readers' slots for the 5 chapter books`; `✗ slot 18 (west-4, shelf 0, 1.5 m along)
  should hold 'ripikaBalloon': its mesh stands 16.216 m OUTSIDE west-4's drawn box`; `✗
  'library-book:ripikaBalloon' should be stood at slot 18's stand (big reader 6's stand (west-4),
  (-16.10, 2.50)): it is 15.161 m off it`; `3 clause(s) FAILED.` Reverted and restamped back
  (`0c868e80…`) → exit 0, 101 ✓. Log `join/red-library-missing-book.log`.
- **The words instrument** and **the tortoise instrument**: their controls, above.

**For the join (`feat/library-v2`)** — `git merge-tree --write-tree HEAD origin/feat/library-v2`
(@ f19cd1fc) at 149000dd: **one conflict, `src/entities/Player.ts`**, exactly the hunk named below
("A known conflict waits for the join"): take the engine's side, drop this branch's flat-ok line,
run `check:flat-primitives`. `pagePictures.ts` auto-merges: f19cd1fc made the same `// flat-ok`
annotation on `strapJetpack`, character for character.

1. Grandpa Tock's eyes (`src/art/models/reptiles.ts` `createTortoise`): put the face on the head's
   measured front surface — measure the head mesh's front at the eyes' (x, y), never type a new z —
   then re-run `join/tock-face.mts` (it must say 10 of 10 seen) and look at *The Giant Footprints*
   p6–p8 and the Reptile House. Visible, so name it in the PR body.
2. Trilla's face (`src/art/models/pets.ts` `createPuffCreature`): book engineers a's and b's item 1
   (measured, with an in-page proof of the fix). Then restore the editor's moods in
   `catchThatChicken.ts` (`happy` p4, p5, p8, p9, p10; `sad` p7) and look again at *Shush*, *Trilla
   Goes Up High* and *RiPika's Balloon* p4–p5.
3. Book engineer a's item 2 (a `cart` actor option seating a pet at `SEAT_HEIGHT`, replacing
   `sirHopsalot.ts`'s `ON_SEAT` stage direction): still open, optional.
4. Done here, nothing to do: READABLE `===` (a's 4, b's 2, the base's "when all six are in"); the
   section-8 `LAST` fix in once (a's 3, b's 4); Mrs Crumpet's pile (b's 3); Nimbus `blossomWhite` on
   *Storm* p9–p10 (the Artist's item 3, done by b).

**Questions for Jim (none blocks anything)**

1. Grandpa Tock and Trilla should show their faces (the two park-model fixes above) — they change
   the Reptile House's tortoise and every puff pet, so: yes to both?
2. By eye: *The Loudest Shush* in coral; Nimbus's white is the palette's `blossomWhite`; the lit
   wheel's star fills 0.9 of its bracket.

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
- [x] runs at 3162492f: tsc, typecheck:test, check:brevity, check:library (hydrated park),
      check:served-book-reader, vitests, check:story-props-glb, check:library-glb, check:assets,
      check:flat-primitives, build — every one exit 0, counts in "Final runs" below
- [x] items 1–6 re-verified on the engine with their reds re-proved — twice: at 8796bff0, and again at
      3162492f with identical figures (red transcripts below)
- [x] handoff final, pushed (the base, at 3188e56d)
- [x] **the books' join**: both book branches merged, the cover duplicate fixed, READABLE `===`, every
      check re-run, all six books read in headless Chrome, the two book worktrees removed — see
      "THE BOOKS' JOIN" at the top, which supersedes the base's runs and join list below

## Final runs of the base (at 3162492f, park hash fb2690b5…, seed 5 restart 1 hydrated; exit codes read, counts off the screen) — superseded by the join's, at the top

| check | exit | what it said |
|---|---|---|
| `pnpm exec tsc --noEmit` | 0 | — |
| `pnpm run typecheck:test` | 0 | — |
| `pnpm run check:brevity` | 0 | `354 pieces of copy are short enough; 6 still carry a recorded exception`; 10 CONTROLs ok; `12 picture books, 0 chapter books` (the chapter shape is held to its CONTROL fixtures until a book lands) |
| `pnpm exec vitest run test/library test/store` | 0 | `Test Files 9 passed (9)`, `Tests 62 passed (62)` (`test/library` alone: `16 passed (16)`) |
| `pnpm run check:library` | 0 | `101 ✓ 0 ✗`, `All clauses passed.`; stderr: `6 slot(s) WAIT for their books` (slots 13–18, west-4) |
| `SERVED_CHECKS_PORT=6443 pnpm run check:served-book-reader` | 0 | `check:book-reader passed`, 1054 ok, 0 FAIL: `every picture model is drawn on a page this check opens — all 63`; `0 program link(s)` while the sheet opened; `11 pictures, the thinnest covering 21.3% of its pixels`; server pid stopped, port free after |
| `pnpm run check:story-props-glb` | 0 | 61 nodes, both readers agree; `ships as built` |
| `pnpm run check:library-glb` | 0 | 65 nodes, both readers agree |
| `pnpm run check:assets` | 0 | `167 assets check out`, `28 still carry recorded drift` |
| `pnpm run check:flat-primitives` | 0 | `107 site(s) carry an explicit // flat-ok`, `no new flat primitives, and no stale baseline entries` |
| `pnpm run build` | 0 | `built in 359ms` |

The model sheet's six spreads (`book-reader-shots-4/model-sheet-spread-*.png`) were opened and looked
at: every kit model draws in the reader's toon look, nothing black, Nimbus grey-and-frowning and
white-and-happy, the nibbled flower a bare stalk, the queue posts' rope swagged, the lit wheel's star
in its bracket with the rim's lights on, confetti and rain painted over. The full gate (`check`,
`test:procgen`) is left to the PR's CI, per the task.

## Parks, locally

The merge moved the park source hash (Player.ts and NpcSystem.ts are in the closure):
`8644cfac…` → `45bccc92…`, and this branch's own src edits moved it on to **`fb2690b5768c825027962e72909caef7ce13612b8dd429c3ddc23e65c4c95546`**
at 51aec20c / 3162492f (any later src edit moves it again: `node scripts/lib/park-source-hash.mjs`;
`.claude/library-build-scratch/books/restamp.sh` restamps the manifest to the tree). `.parks/` here is the
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
  picture book on a chapter slot. While fewer than six were in, the last slots WAITED (check:library
  said so on stderr); with all six in, READABLE's `CHAPTER_BOOKS.length <= chapterSlots` is `===`
  and the WAIT note is gone (done at the join, a80be87c).
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

**Re-proved at the final head 3162492f** (23 Oct, 05:2x, the second restart; same mutations, each
reverted with `git checkout`, `git status --short` empty after each, the manifest restamped to the
mutated tree `33d51787…` for the brevity red and back to `fb2690b5…` after): `every` → `some` exit 1,
`Tests 2 failed | 10 passed (12)`; `storyTimeMayRead` → `true` exit 1, `Tests 1 failed | 3 passed
(4)`; the two-sentence ripikaBalloon page exit 1, `1 problem across 354 pieces of copy`
(`bookPage:ripikaBalloon#1 … 2 SENTENCES`); `LIBRARY_CHECK_REMOVE='bookcase west-4'` exit 1, `99 ✓ 7 ✗`
with the same seven lines as below; `CHECK_BOOK_READER_CHAPTER=overlong` (port 6443) exit 1, 1067 ok,
`check:book-reader FAILED — 6 problem(s)`, the same six figures; the bench removed from the model
sheet (port 6443) exit 1, 1053 ok, `FAIL every picture model is drawn on a page this check opens —
never drawn: parkBench`. The `assertDrawsSomething` red and its control were not re-run: they ran at
51aec20c, and `git diff --stat 51aec20c 3162492f` is the handoff alone. Logs: `red-*-4.log`.

**Items 1–6 on the engine (books2's reds, first re-proved at 8796bff0):**

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

## For the join (feat/library-v2) — the base's list; the join's own list is at the top

- `PICTURE_MODELS` is 63; item 9b's model sheet draws them all. Track A/B/C engineers touching
  `check-book-reader.mts` item 10 or `furnish.ts`: the only furnish change is `export` on
  `PlacedBook`, `shelveFace`, `bookInstances`.
- ~~The two book engineers add `chapterBooks/<id>.ts` + an index entry each~~ — done: both branches
  merged clean here (7d30cb3c, 15e0760a), the list in shelf order, as the scratch-repo proof said.
- `blendkit.ts_const` follows re-exports (the Artist's fix) travels with the merge.
- **A known conflict waits for the join in `src/entities/Player.ts`.** This branch carries
  `feat/engine-solids` only up to 7ce1deae (through the art merge) plus one line of its own (8796bff0:
  a `// flat-ok:` comment over the hover rescue's `Math.abs(p.y - this.hoverAt.y)`, because
  check:flat-primitives was red on it). The engine has since moved to bf7b1c8b, and its 0807890d
  rewrote that very line as `altitudeAt(p…) - altitudeAt(this.hoverAt…)` — its own fix for the
  same finding. `git merge-tree --write-tree HEAD origin/feat/engine-solids` shows exactly one
  conflict, that hunk. **Resolve it by taking the engine's side** (its comment and its `altitudeAt`
  line; drop this branch's `flat-ok` line, which no longer describes anything), then run
  check:flat-primitives and read its exit code.
- The story-props Artist's join list (`HANDOFF-art-story-props.md`): items 1, 2, 4 and 5 are done
  here (`PICTURE_MODELS`/`buildActor`/warm-up for all 31; `createStoryBook` delegates; the lit wheel's
  star is fitted to the measured bracket rather than a typed size 2.2; the flower takes `colour` and
  `nibbled`). Item 3 (Nimbus's colour and mood per page) is the book engineers' — `colour:
  'blossomWhite'` on *Storm* p9–p10 (Decision 5), moods from `final.json`. Items 6–8 need nothing.

## Questions for Jim

See "Questions for Jim" in the join's section at the top (it carries the base's two by-eye questions —
Nimbus's `blossomWhite`, the star at 0.9 of its bracket — and adds the two hidden faces and the coral
*Shush*). None blocks anything.
