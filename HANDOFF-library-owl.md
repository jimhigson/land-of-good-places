# HANDOFF — The Library, track A (#718: the readable shelves, then the owl)

Branch `feat/library-714-owl`, cut from the foundation head **bb4eb46f** (the head of
`feat/library-714` after Steps 0-4). Worktree `.claude/worktrees/library-714-owl`. Engineer,
Claude Opus 5.5. The plan is `docs/library-build/PLAN-parts-4-5.md`; this track builds its
Step 5 (the readable books on their shelves) and then Step 6 (the owl). Logs and scratch
output: `/Users/jim/dev/landOfGoodPlaces/.claude/library-build-scratch/owl/`; scratch scripts
in this worktree's gitignored `.claude/scratch/`.

## Status
- [x] Worktree created at bb4eb46f, `pnpm install --frozen-lockfile`, pnpm 12.1.0 running
      (`pnpm/12.1.0 npm/? node/? darwin arm64`), node v26.5.0.
- [x] Baselines at the foundation (seed 5 restart 1 hydrated, source d283ffaa…):
      check:library exit 0, **60 ✓ 0 ✗**; check:tap-spacing exit 0, **10 spaces, 131 zones,
      27 portal bands; 231 zone-band and 20 close zone-zone pairs; 20 same-action overlaps**.
- [x] **Step 5 — the readable books on their shelves.** Done, green, pushed (commits below).
- [x] **Milestone (Jim's promised "read a book off the shelf"):** the PR head was fast-forwarded to
      Step 5 — `git push origin feat/library-714-owl:feat/library`, `9e49816b..eb5200e2`, accepted
      (checked first: `merge-base --is-ancestor origin/feat/library HEAD`). It started PR #720's
      CI run **38828139475** and Update adoption **38828139496** on eb5200e2; not waited for (the
      task). Its preview is the one to send, with a deep link that stands her beside a book (QA
      notes below). This handoff line itself is one commit past the PR head.
- [ ] Step 6 — the owl (next task on this track).

## Step 5: what was built
| commit | what |
|---|---|
| 22fe57a9 | `shelfBooks.ts` (the pairing), `libraryAssets.ts` (`libraryShelfBookShape`, `createShelfBook`), `furnish.ts` (each readable book drawn in its slot; `Furnished.shelfBooks`) |
| ce63a95b | `Library.ts` (`attachBookReader`, `LibraryBookOpener`, a Read zone per book, `shelfBooks`), `Game.ts` (one opener object for the Cute-o-dex and the Library) |
| 112148dd | `check-library.mts` (READABLE, REACHABILITY's book line), `check-book-reader.mts` (section 9) |
| 86086f35 | check-library's READABLE note wording ("flush with it") |

- **`src/world/library/shelfBooks.ts`** (new): `SHELF_BOOKS = BOOKS.map((book, i) => ({ book,
  slot: LIBRARY_READABLE_SLOTS[i]! }))`, guarded at load by a throw naming both counts if
  `BOOKS.length !== LIBRARY_READABLE_SLOTS.length`. Pairing by index, decided only here. Also
  the one owner of the zone id: `SHELF_BOOK_ZONE_PREFIX` (`library-book:`) and
  `shelfBookZoneId(id)`, light enough for a Node check to import without a park.
- **`libraryAssets.ts`**: `libraryShelfBookShape()` — the kit book with the largest height, then
  the largest thickness, chosen by measurement (today `book-tall-thick`: h 0.42, t 0.09,
  d 0.26, origin at the middle of its base). `createShelfBook(colour)` — that shape in its own
  `toonMaterial(colour, { emissive: colour, emissiveIntensity: 0 })`, `solid`, and a 0.012 ink
  outline from **`addSmoothOutline`** (deviation, below).
- **`furnish.ts`**: `READABLE_PROUD = 0.03` (a cap), `READABLE_LEAN = 0.1`, both exported. For
  every `SHELF_BOOKS` entry on the case being built, `shelfBookMesh` places
  `library.book.<id>` (its outline `library.book.<id>.outline`) in the case's own frame at x
  `slot.along`, y `shelfTops[slot.shelf]`, z `boardFront − SPINE_INSET − depth/2 +
  readableProud(kind)`, `rotation.x = READABLE_LEAN`. A stack's books ride the stack's group
  and their body **and** outline materials join that stack's `StackFader` list; a wall case's
  get the case transform composed and go under `root`. It throws if a book would not fit: a
  shelf the case lacks, its leaning top through the board above, `|along| + t/2` past the
  side panel, thicker than the row's gap (`SLOT_HALF`), a case whose front leaves no room
  (`readableProud`), or a readable book on the secret shelf (it swings, #719).
  `Furnished.shelfBooks: { book, slot, mesh, material, local }[]` in `SHELF_BOOKS` order
  (`local` = the mesh origin's room-local XZ).
- **`Library.ts`**: `readonly shelfBooks`, `attachBookReader(opener: LibraryBookOpener | null)`
  (null tolerated: headless), and inside **and not riding** one zone per book — id
  `library-book:<id>`, label the title, x/z the mesh's world position, y floor + 1, pickRadius
  0.7, stand = `slot.stand` (world), verb `Read`, `highlight: highlightObject(mesh)`, actions
  `pressAction(LIBRARY_CHIPS.read, () => opener?.open(book.id), '📖')`. Built once in the
  constructor (the books never move). Outside: the entrance zone, as before.
- **`Game.ts`**: one `bookOpener` object right after `new BookReader(…)`, passed to
  `cuteODex.setBookReader` and `world.library.attachBookReader`.

### Geometry (built room, 16 Oct; seed-independent)
Wall case depth 0.6 (front z +0.3), boardFront 0.25; stack depth 1.2 (front +0.6), boardFront
0.55. The row's spines stand at boardFront − 0.01. The leaning book reaches 0.1713 m forward of
its base's middle and 0.4309 m up, and its front-bottom edge sinks 0.0130 m into the board.
So `readableProud` = min(0.03, 0.3 − 0.11 − 0.1713) = **0.0187 m** on both kinds (its top edge
is flush with the case's front face). Every book, room-local (x, shelf y, z), and its stand:

| slot | book | case | shelf | along | book at | stand (facing) |
|---|---|---|---|---|---|---|
| 0 | ripikaBalloon | north-2 | 1 | 0.6 | (-9.400, 0.756, -12.271) | (-9.40, -11.10) 180 |
| 1 | biscuitBreakfast | north-3 | 0 | -0.8 | (-6.800, 0.180, -12.271) | (-6.80, -11.10) 180 |
| 2 | trillaHigh | north-6 | 1 | 0.6 | (6.600, 0.756, -12.271) | (6.60, -11.10) 180 |
| 3 | catBusDay | north-8 | 0 | -0.6 | (13.400, 0.180, -12.271) | (13.40, -11.10) 180 |
| 4 | duckBars | west-1 | 1 | 0.5 | (-17.271, 0.756, -8.500) | (-16.10, -8.50) 270 |
| 5 | bookDragon | west-3 | 0 | -0.5 | (-17.271, 0.180, 0.500) | (-16.10, 0.50) 270 |
| 6 | foreverSlide | west-5 | 1 | 0.6 | (-17.271, 0.756, 7.400) | (-16.10, 7.40) 270 |
| 7 | fireflies | stack-3-1 | 0 | 0.6 | (-12.400, 0.180, 1.629) | (-12.40, 2.80) 180 |
| 8 | fountainWish | stack-3-3 | 1 | -0.6 | (-5.600, 0.756, 1.629) | (-5.60, 2.80) 180 |
| 9 | keychainStall | stack-3-4 | 0 | 0.4 | (6.400, 0.180, 1.629) | (6.40, 2.80) 180 |
| 10 | bigParade | stack-2-2 | 1 | 0.5 | (-8.500, 0.756, -1.771) | (-8.50, -0.60) 180 |
| 11 | goodnightPark | stack-1-5 | 0 | -0.5 | (9.500, 0.180, -5.171) | (9.50, -4.00) 180 |

## Parks
- After Step 5 the park source hash is **`c6596b45d7f1b6d1a796943a23769973124a62e9abe3392f8eca850748fdec77`**
  (498 closure files; 494 at the foundation). New in the closure: `library/books.ts`,
  `shelfBooks.ts`, `libraryLines.ts`, `libraryCard.ts` (through furnish.ts and Library.ts — as the
  plan decided). The check scripts are outside it (hash unchanged by their edits, measured).
- Seed 5 built honestly for it: `LGP_SEEDS=5 LGP_RESTART_LANES=4 LGP_PARKS_OUT=.claude/parks-build
  pnpm run build:parks`, exit 0 in 576 s — **restart 0 rejected by check:coplanar** (the same
  garden path-kerb/stone-walls finding as the foundation's), **restart 1 accepted as shipped (134
  measures), digest 2ee2b3fc87c6b269**, proven by hydration, control digest differs. The park
  file's `features`, `measures` and `planOrder` are byte-identical to the foundation's seed-5
  file; only `acceptance` and the scene `digest` moved (twelve new meshes). Installed into
  `.parks/` (the foundation's copy kept at `…/owl/parks-d283ffaa/`). The acceptance's coplanar
  measure is garden-only (`gardenCoplanarRegressions`); the books' interior coplanarity is
  argued, not swept: every face but the two sides is turned 0.1 rad, and the sides stand ≥ 5.5 cm
  from any neighbour's (the row's gap). `check:coplanar` (every space, first shipped seed) runs on
  the PR's CI.

## Checks (all exit codes read from the logs; counts copied off them)
| check | exit | off the screen |
|---|---|---|
| `pnpm exec tsc --noEmit` | 0 | (tsc-4.log) |
| `pnpm run typecheck:test` | 0 | (tsct-1.log) |
| scripts instrument (`…/owl/tsconfig.scripts.json`) | 2, as at the foundation | the same 56 messages as `foundation-checks/tsc-scripts.log`, none new (diffed without line numbers) |
| `pnpm run check:library` (hydrated) | 0 | **72 ✓, 0 ✗**, "All clauses passed." (60 before; +12: READABLE 11, REACHABILITY 1) |
| `pnpm run check:tap-spacing` (hydrated) | 0 | **10 spaces, 143 zones, 27 portal bands; finger 1.13 m; 243 zone-band and 20 close zone-zone pairs; 20 same-action overlaps (warnings)**, OK — +12 zones and +12 zone-band pairs (each book against the exit band), no new close pair |
| `pnpm run check:served-book-reader` (port 6311) | 0 | **377 ok, 0 FAIL** (372 before + section 9's 5), "check:book-reader passed", 41 s, server pid stopped by the harness |
| `pnpm run check:served-deep-links` (port 6319) | 0 | 20 OK of 20 (10 links × 2 starts), "check:deep-links passed" |
| `pnpm run check:brevity` | 0 | 350 pieces, 6 recorded exceptions (unchanged: no new words) |
| `pnpm run check:assets` | 0 | 135 assets, 48 creatures, 28 recorded drift (unchanged) |
| `pnpm run check:cycle-tdz` | 0 | 525 modules, 4 value-import cycles, the same 5 sites as the baseline |
| `pnpm run check:labels` | 0 | 12570 frames, 54 labels, no overlap (the library is not in its scenes yet) |

READABLE's green lines (hydrated, seed 5 restart 1, source c6596b45):
```
  ✓ 12 slots for 12 books, the highest shelf 0.756 m, her reach 1.04 m
  ✓ 12 library.book.* meshes for 12 books — missing: none; not a book: none; drawn twice: none
  ✓ 12 of 12 readable books stand in their own slots: inside their case's drawn box, every drawn point of them (…), at their slot's place along the shelf, the base within 0.02 m of the board, under the board above, in their cover's paint
  note: … the nearest any drawn point of one comes to leaving its case's drawn box: flush with it ('bookDragon')
  ✓ inside, standing in the room: 12 Read zones for 12 books, 0 book(s) without one
  ✓ while she is riding (sat down), the room offers 0 Read zones
  ✓ outside on the doormat: 0 Read zones (inside: false)
  ✓ 12 of 12 Read zones stand her at their slot's stand, sit on their own book, ring it in the rainbow and carry its title
  ✓ a stub opener, pressed through all 12 zones' primary actions, recorded 12 opens — each the zone's own book (none wrong)
  ✓ every zone's chip says "Read it!" ("Read it!")
  ✓ with no reader attached (headless), pressing every chip is harmless
  ✓ standing behind stack-3-1 at (-13.00, -0.52), the stack fades to 0.28 and its readable book 'fireflies' with it (book and outline: 0.28, 0.28)
  ✓ CONTROL: 'ripikaBalloon', on north-2 (a wall case, which never fades), stays solid (1.00, 1.00)
REACHABILITY:
  ✓ every readable book stands inside solid shelving, out of her walk: 12 of 12 (12 books)
```
Section 9 (served): `/library?at=-9.4,-11.1&facing=180&seed=5` — the selection holds
`library-book:ripikaBalloon`; its primary action opens `ripikaBalloon`; `frameContext.dt = 0`;
`.hud-menu` display `none`.

## Reds (each reverted; geometry: the room above, seed 5 restart 1, source c6596b45)
1. **`LIBRARY_CHECK_MUTATE=shift-books`** (`LGP_PARK_RESTART=1`, an in-process solve of restart 1,
   the restart the build then accepted) → **exit 1, `26 clause(s) FAILED`**, every line naming a
   book (12 slot lines, the 0-of-12 summary, 12 zone lines, the 0-of-12 summary):
   ```
   ✗ slot 1 (north-2, shelf 1, 0.6 m along) should hold 'biscuitBreakfast': its mesh stands 1.200 m OUTSIDE north-2's drawn box, 3.200 m along it (the slot: 0.6); its base at 0.167 m (the shelf: 0.756), its top at 0.611 m (the board above: 1.272); its furthest drawn point 1.245 m PAST the case's drawn box; painted its cover
   ✗ slot 12 (stack-1-5, shelf 0, -0.5 m along) should hold 'ripikaBalloon': its mesh stands 18.429 m OUTSIDE stack-1-5's drawn box, -19.400 m along it (the slot: -0.5); …
   ✗ 0 of 12 readable books stand in their own slots: …
   ✗ 'library-book:biscuitBreakfast' should be stood at slot 1's stand (readable book 1's stand (north-2), (-9.40, -11.10)): it is 2.600 m off it; it is 0.000 m off its book; the rainbow rings its book; labelled 'Biscuit's Breakfast'
   ✗ 0 of 12 Read zones stand her at their slot's stand, …
   ```
2. **`LIBRARY_CHECK_REMOVE='bookcase north-2'`** (same park) → **exit 1, `4 clause(s) FAILED`**:
   ```
   ✗ readable book 'ripikaBalloon' on north-2, at (-9.40, -12.27), IS reachable — drawn, and not solid
   ✗ every readable book stands inside solid shelving, out of her walk: 11 of 12 (12 books)
   ✗ bookcase north-2: a body's edge got 0.600 m into it (allowance 0.071)
   ✗ 43 drawn boxes, 604 marches; deepest a body's edge got into one: 0.600 m (bookcase north-2), allowance 0.071
   ```
   **Finding:** REACHABILITY's existing "`<case>`'s middle IS reachable" line does **not** go
   red for a removed *wall* case: a player-radius disc never fits at a wall case's middle,
   with or without the case, because the room's wall stands 0.3 m behind it. The new per-book
   line is what turns REACHABILITY red there (the book stands 0.13 m in front of the case's
   middle, so a disc fits beside it once the case is gone).
3. **Section 9, the chip pointed at the wrong book (by hand)**: `Library.ts`'s action changed to
   open the next shelf book. Library.ts is in the park closure, so for this run only
   `.parks/manifest.json`'s `sourceHash` was pointed at the mutated tree's hash (f7276d69…; the
   park layout cannot depend on which book a chip opens), then Library.ts restored with
   `git checkout` and the manifest copied back; hash and manifest re-read equal (c6596b45), no
   `.parks/dev` written. `SERVED_CHECKS_PORT=6317 pnpm run check:served-book-reader` → **exit 1,
   `check:book-reader FAILED — 1 problem(s)`**:
   ```
   FAIL off the shelf: the book's chip opens that book — open=true, book=biscuitBreakfast (the shelf's book: ripikaBalloon)
   ```
   (the selection, the chip's presence, the pause and the menu stayed `ok`: the red is the one
   thing mutated).

## Decisions (with reasons)
- **The readable book stands on its row's own spine line, `boardFront − SPINE_INSET`, not the
  plan's `depth/2 − SPINE_INSET`.** The plan's formula predates `boardFront` (the boards stop
  5 cm behind the carcass front): it would draw the book's base 2 cm and its leaning top 6 cm
  outside the case's drawn box — drawn, and not solid.
- **`READABLE_PROUD` (0.03, the plan's figure) is a cap; the book stands as proud as the case's
  front allows: 0.0187 m.** The 0.1 rad lean (kept: the plainest cue a child gets) carries the
  top 4.13 cm forward, and the carcass front is 6 cm ahead of the spines, so 3 cm proud would
  have put the top 1.13 cm past the case's front face, outside its collider. With the cap no
  drawn point of a book stands outside its case's drawn box, which READABLE now asserts vertex
  by vertex (stronger than the plan's mesh-origin test). Measured off the kit, never typed; a
  case that leaves no room throws.
- **`addSmoothOutline`, not `addOutline`.** The kit's book has split normals at 14 of its 16
  corners (measured); materials.ts's own rule is that a plain hull pushed along split normals
  comes apart into flaps there.
- **`LibraryBookOpener` is declared in Library.ts**, the same shape as CuteODex's
  `DexBookReader`, rather than imported from `ui/CuteODex.ts`: the park-source closure follows
  type-only imports too, and would have pulled a DOM module into it.
- **The zone-id shape lives in `shelfBooks.ts`** (`shelfBookZoneId`), one owner for Library.ts and
  both checks; the served check can import it without building a park.
- **Read zones are built once** in the constructor (the books never move); `interactZones()`
  returns a copy. While she rides (sits, Step 7) the room offers none.
- **check-book-reader's new item is section 9**, appended (the plan's "new item 6" predates the
  check's sections 7 and 8). It runs in a **fresh browser context** after closing section 1-8's
  page, so nothing those saved rides in. Beyond the plan it also asserts that, standing at the
  stand, the game's own selection holds the book's zone (what puts the chip over it).
- **check-library's expected pairing is restated from `books.ts` and `layout.ts` by index**, never
  read from `SHELF_BOOKS`, so a wrong pairing in shelfBooks.ts would go red.
- **layout.ts is not edited** (track D edits the same READABLE block; its stale doc sentence is
  for the join, below).

## QA notes (for whoever looks)
- Shots: `…/owl/looks/` (headless Chromium against my own dev server on 6313, stopped by PID by
  the harness): `north-2-from-west-{wide,close}.png`, `stack-3-1-from-west-{wide,close}.png`, and
  section 9's `…/owl/shots/shelf-ripikaBalloon-{chip,open}.png`. Close up, a readable book reads
  as different — taller, thicker, its cover colour, an ink outline, leaning out of a gap — and
  the rainbow rings it when selected. **At the room's zoom the chip over her is what reads
  first; the book itself is small.** And standing exactly on a north-wall book's stand, her own
  body hides the book from the camera: a preview link should stand her beside it, e.g.
  `/library?at=-10.6,-11.1&facing=135` (RiPika's Balloon on north-2: the chip shows, the book is
  in view, press **Read it!**).

## For the join
- **`shelfBooks.ts` throws at load when `BOOKS.length !== LIBRARY_READABLE_SLOTS.length`.** Track D's
  branch (5a06ab85) has 18 slots (`BIG_READERS_SHELF`, six on west-4) and 12 books
  (`CHAPTER_BOOKS` empty), so a merge of the two **builds nothing** until the six chapter books land
  with their slots (or the shelf's slot list derives from `CHAPTER_BOOKS.length`). Loud by design.
- **check-library READABLE's first clause now reads `LIBRARY_READABLE_SLOTS.length ===
  BOOKS.length`** — the typed twelve track D was told to fix; expect a conflict on that line; keep
  the `BOOKS.length` form. Every other count/message in READABLE derives from `BOOKS.length`.
- **Stale docs left for the join because track D edits the same lines:** layout.ts's READABLE doc
  ("Books #718 fills them; this PR only keeps their stand spots clear and leaves the gap on the
  shelf") and Library.ts's class doc "## What later PRs add" ("…(#718: a gap is already left on
  each shelf)… Their stand spots are kept clear today."). Both are now built; reword at the merge.
- **books.ts and chapterBooks/* are inside the park source closure** after Step 5 (shelfBooks.ts →
  furnish.ts; libraryLines.ts → Library.ts), as the plan decided. Track D's `bookKinds.ts` doc
  says "editing a story never re-solves a park" — false after the merge; any story edit then
  changes the hash (a dev server solves seed 5 again, ~10 min).
- **Track D's west-4 slots** stand 0.6 m apart: their Read zones (both verb `Read`) will add
  same-action warnings in check:tap-spacing, not failures. `shelfBookMesh` throws for a slot a
  readable book cannot fill (low bins cannot: 0.36/0.38 m clear under a 0.43 m leaning book, and
  a case front 2 cm from the board front), so chapter-book slots must stay on wall cases or stacks.
- **check-book-reader.mts**: section 9 is appended at the end of the try block; track D also
  edits this file (chapter page legibility) — merge both.
- **Track C**: a readable book on the secret shelf throws in furnish (the shelf swings); the
  den's west wall gap (Step 11) must keep `west-1`/`west-3`/`west-5`'s books in their drawn
  boxes (READABLE asserts it).
- **Track B (Step 7)**: Read zones vanish while `player.riding`, which is what sitting sets
  (Decision 39: "Read chips are hidden while seated") — Step 7's SIT clause can assert it.
- **Step 6 (this track, next)**: `library.shelfBooks[i].material` is the recommendation's glow
  target (emissive = its cover, intensity 0); the stack fader already carries it.
- **Step 10**: tap-spacing is at 143 zones; the labels scene does not visit the library yet.
