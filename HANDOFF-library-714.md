# HANDOFF — The Library, integration branch (epic #714: #715-#719)

Branch `feat/library-714` (from `origin/main` d2cdb1f2), worktree
`.claude/worktrees/library-714`. Engineer, Claude Opus 5.5. This file is the integration
branch's own; every source branch's handoff is kept unchanged beside it
(`HANDOFF-library-art.md`, `-building.md`, `-shared.md`, `-books.md`). The one exception is
the foundation's second half: its `HANDOFF-library-assets.md` is folded into this file
("Foundation, second half" and the lists after it) and was deleted in the merge commit that
brought `feat/library-714-assets` in (14 Oct), so the foundation has one record.

**The one Library PR** (Jim's 13 Oct ruling: one PR for the whole Library) is a draft whose head
is a SEPARATE branch, `feat/library`. It moves only at a milestone, by a fast-forward push of
this branch: `git push origin feat/library-714:feat/library`. Every push to a PR head starts a CI
run that re-solves all 16 parks (30-45 min) and cancels the run before it, so work in progress
goes to `feat/library-714` (or a track branch) only. A push to `feat/library-714` runs no CI
(`ci.yml` runs on `pull_request`, on `push` to `main`, and by dispatch).

**PR #720** (draft), head `feat/library`, base `main`; GitHub links it to all six issues
(`closingIssuesReferences`: 714, 715, 716, 717, 718, 719). Opened at **8f0cb8c3** (the
foundation head, this file's first commit). Read again at the Steps 3-4 merge (14 Oct): head
**9e49816b** (the first half's head; the orchestrator moved it there), still a draft, and its
newest "Deploy PR preview" comment still names the build of 8f0cb8c. The merge does not move
`feat/library`; only the orchestrator does, at a milestone.
The preview link comes from the PR's newest "Deploy PR preview" comment, never built by hand.

## Status
- [x] Foundation merge (this file's first section). Heads merged, confirmed by `git fetch` at
      the start; none had moved from the task's list:
      art/library-715 **f54f21c0**, feat/library-building-716 **f981a57e**,
      feat/library-714-shared **d02843aa**, feat/library-books-717 **5a0cb5fd**.
- [x] Quick local checks, exit codes read from files (below). World-building checks are left
      to the PR's CI, as the task says.
- [x] Draft **PR #720** opened from `feat/library` at 8f0cb8c3 (`gh pr create --draft`); body in
      the orchestrator scratchpad `merge714/pr-body.md`. Not waited for: its CI.
- [x] **Foundation, first half** (plan Step 0, Step 1 change 5, Step 2's remainder; Engineer,
      14 Oct; section "Foundation, first half" below) — done at this branch's head; both CI
      reds fixed here but unproven on CI until feat/library next moves (the orchestrator's call).
      Final local checks at ad6c10bc: tsc 0, typecheck:test 0, check:brevity 0 (350 pieces),
      check:library 0 (55 ✓, 0 ✗), vitest library-card 0 (4 passed of 4). In parallel, Steps 3-4
      on `feat/library-714-assets` (another engineer; its files are not touched here; the merge
      with this branch is clean and typechecks).
  - [x] Step 0 facts (below).
  - [x] Step 1 change 5 (props.ts, layout.ts types) — d2a7f00e; **plus a Collision.ts fix the
        plan did not know it needed** (the zero-length capsule was a ghost to the mover) —
        773efb7c, guarded by check:wall-tunnelling — 4d747841.
  - [x] Step 2's remainder: libraryLines.ts + libraryCopyForBrevity + check:brevity's library
        and SECRETS loops — 9f650da1. Both reds proved (below). Groundwork state slice verified.
  - [x] Step 0 baselines (foundation code) and the same ten after these edits: all 0, identical
        but for brevity's intended +65 (table below).
  - [x] The PR's CI (run 38580957653 on 8f0cb8c3) read, every job: **one red, fixed at
        cause on this branch** — procgen shard 4's `railRaceRoadBounded` (a stale seed pin; see
        "The PR's CI" below), 04e98676 — **and a second, Checks shard 8 killed by its
        watchdog in check:served-book-reader**, fixed at cause in 588c413b + c136443b.
- [x] **Foundation, second half** (plan Steps 3 and 4, and the WITH A REAL CHILD harness from
      Step 6's "Checks"; another engineer, 14 Oct, on `feat/library-714-assets` from 009dea3e,
      head 88ac6218). Section "Foundation, second half" below, folded from its handoff.
- [x] **The Steps 3-4 merge** (14 Oct; section "The Steps 3-4 merge" below):
      `git merge --no-ff origin/feat/library-714-assets` onto 9e49816b, rerere off, no conflict
      (the halves touch disjoint files; every merged file is byte-identical to the side that
      changed it; re-audited blob by blob on 16 Oct). Seed 5's park built for the merged source
      (d283ffaa…, restart 1, digest 9acd3a626f55d35c).
  - [x] **Its checks** (cut off by the 14 Oct pause; run on 16 Oct on the head 5d524193, whose
        code is the merge's: the handover commit added docs only, and the park source hash is
        the same d283ffaa…). **Every one exit 0**: tsc 0, typecheck:test 0, vitest
        library-card 0 (4 passed of 4), check:brevity 0 (350 pieces), check:library 0 (60 ✓,
        0 ✗), check:assets 0 (135 assets, 48 creatures), check:served-deep-links 0 (20 OK of
        20), check:served-book-reader 0 (372 ok, 0 FAIL); and the scripts instrument names no
        library type (its 56 errors: 52 environmental, 4 already on origin/main's
        check-castle.mts). Table in "Checks at the merged source" below. Nothing was red, so no
        code changed.
- [x] **The foundation is complete**: parts 1-3, the groundwork, plan Steps 0-4 and the WITH A
      REAL CHILD harness, all on this branch and green locally, at the commit that adds this
      line (on 5d524193). It is the head every track cuts from. PR #720's CI on 9e49816b (run
      **38600489442**, read 16 Oct): **success, 88 jobs success and 1 skipped** (Deploy: main
      only). Checks shards 1-9, Checks build, Procgen invariants shards 1-6, Coplanar faces,
      Swept bus, Walk reach, Entrance road, Every seed builds and Deploy PR preview: all
      success. So both reds of run 38580957653 are proved fixed on CI. That run predates the
      Steps 3-4 merge, which no CI run has seen yet: the next milestone push of `feat/library`
      gives it its first CI run. The newest preview comment names 9e49816
      (`https://pr-720-9e49816-land-of-good-places.blockstack.workers.dev`); curl on 16 Oct:
      `/`, `/library` and `/version.txt` all HTTP 200, and `version.txt` names ea9be3a8, GitHub's
      test merge of 9e49816b into d2cdb1f2 (origin/main, unmoved since the branch was cut).
- [ ] Next: tracks A (owl, Steps 5-6, `feat/library-714-owl`), B (kids, Steps 7-8,
      `feat/library-714-kids`), C (den, Steps 11-13, `feat/library-714-den`), each cut from the
      head after this merge (the whole foundation). Track D (six chapter books,
      `feat/library-714-books2`) was already at 9e49816b when this merge was made, so it starts
      without Steps 3-4 (see "For the join"). Then Step 9, Step 10's labels/tap spacing, Step 14
      and the cross-part pieces here after the merges.

## The foundation merge (14 Oct)
All four with `--no-ff`, in the order the groundwork's merge-tree forecast measured as cleanest,
and every one with `git -c rerere.enabled=false merge ...`. (`.git/config` has
`rerere.enabled false` today, although CLAUDE.md says true; passing it on the command line makes
that certain either way.) **So no hunk was resolved by rerere**: each conflict below was
resolved by hand, and every hunk git's ordinary three-way merge resolved was read.

| merge commit | source | result |
|---|---|---|
| 0c21cdf3 | art/library-715 f54f21c0 | clean; tree == art's tree |
| ffdc8d9a | feat/library-building-716 f981a57e | clean (art is its ancestor); tree == building's tree |
| 8ad2336d | feat/library-714-shared d02843aa | clean; every file it changed == its blob, except check-deep-links.mts == building's (its only change, 4a39b06c, is the same patch as 69dfa5df, merged once) |
| 36b32b64 | feat/library-books-717 5a0cb5fd | 3 conflicts, below; 4 files auto-merged and read |

`pnpm exec tsc --noEmit` exit 0 after each of the four merges.

### Conflicts (books' merge) and how each was resolved
- **`src/state/types.ts`**, the tail of `CUTE_CATEGORIES`: both appended after `'keychain'`.
  Kept both, `'book'` then `'card'`, each with its own doc comment (the shared `/**` above the
  markers opens the book block; the card block got its own opener). `INVENTORY_KINDS`' `'card'`
  auto-merged. `dexEntries()` (books) counts catalogue, flowers, books and SECRETS only, so the
  card stays out of the dex total, as its doc says.
- **`src/main.ts`**, the `DeepLink` union and `parseDeepLink`: an add/add of two new kinds.
  Kept both: `library` (building's `/library?at=&facing=`) then `book` (books' `/book?id=`),
  and both parsers. Behaviour is independent of the order (disjoint paths).
- **`scripts/check-deep-links.mts`**, `/reptile-house?at=` (continueGame): main's race, fixed
  twice. Art 69dfa5df (carried by building and, as 4a39b06c, by the groundwork) waits for
  inside **and on the spot**; books 9083ecd4 waits for inside **and the change of space
  finished**, reads `isChanging` back and insists it is a real boolean. **Kept the
  combination**: the wait is for inside AND `spaces.isChanging === false` AND within
  `CASTLE_TOLERANCE` of the asked-for spot; the read after it asserts each (the `changing`
  vacuity guard and its own failure message from books, the position from both). No retry.
  Why both halves: on the spot proves the link moved her whenever its change began (books'
  half alone would pass vacuously if a poll landed before the change began); not changing
  proves the change is over. Building's `libraryCheck` entries wait the 69dfa5df way and were
  left as they are: `SpaceManager.changeTo` clears `changing` in the same synchronous iris
  callback that teleports her, so for a link that moves her, "on the spot" already implies "not
  changing". check-deep-links.mts is outside the park source closure.

### Auto-merged, read hunk by hunk
- `package.json`: books' `check:book-reader`, `check:served-book-reader` and shard 8's new
  step, beside art's and building's scripts. Proof below.
- `src/Game.ts`: books' reader (import, field, construction, `blocked`, interact claim, the two
  overlay guards, `dispose`, menu availability, the open-book input branch, `update`, `render`)
  on top of building's library spawn, door link and restore adoption, all present.
- `test/procgenShards.ts`: groundwork's `test/store/library-card.test.ts` (shard 6, before
  live-look) and books' `test/library/pageCurl.test.ts` (shard 6, at the end). Both present.
- `ASSET_MANIFEST.md`: books' paragraph on the reader's page textures beside art's kit row and
  section 41.

### Every file, audited against the branch that changed it
116 files are changed by one or more of the four branches (relative to main). **109 are
byte-identical to the blob of a branch that changed them.** The 7 that equal no single branch
are exactly the multi-branch files above: ASSET_MANIFEST.md, package.json,
check-deep-links.mts, Game.ts, main.ts, types.ts, procgenShards.ts. (The only files where art's
blob differs from building's, package.json and check-deep-links.mts, are among those 7: each is
building's plus books', read above.) Spot checks asked for by the task, by blob id:
- `HANDOFF-library-art.md` == art's == building's; `HANDOFF-library-building.md` == building's;
  `HANDOFF-library-shared.md` == groundwork's; `HANDOFF-library-books.md` == books'.
- `src/world/library/reader/*`: all 5 files identical to books' (`git ls-tree` diff empty).
- `src/art/models/libraryAssets.ts`, `src/art/models/libraryKit.ts`: identical to building's.

### The check chain: step sets parsed and compared (never grepped)
Instrument: `merge714/chains.mjs` in the orchestrator scratchpad. It parses `scripts` at
origin/main, at each of the four branch heads and in the merged tree; for every script holding
`&&` (25 chains, in any version) it builds the expected SET as main's steps plus each branch's
additions minus each branch's removals, and compares it with the merged chain, also checking
for duplicates and that main's steps keep their relative order; script names and every
non-chain value are compared too. Output on the merged tree (36b32b64), exit 0:
```
script names: base 165, merged 173, expected 173; missing [] extra []
OK  blend:library: base 0 steps, merged 3, expected set 3   (art and building: the same 3)
OK  check:shard-1: base 24 steps, merged 26, expected set 26
      origin/art/library-715 +[pnpm run check:library-glb | pnpm run check:png-integrity]
      origin/feat/library-building-716 +[pnpm run check:library-glb | pnpm run check:png-integrity]
OK  check:shard-4: base 14 steps, merged 15, expected set 15
      origin/feat/library-building-716 +[pnpm run check:library]
OK  check:shard-8: base 1 steps, merged 2, expected set 2
      origin/feat/library-books-717 +[pnpm run check:served-book-reader]
chains compared: 25; all equal as sets, base order kept
```
No branch removes a step or a script. Controls, run first on copies of the merged
package.json, both exit 1:
- a one-for-one swap in shard 4 (`check:library` -> `check:hall-solid-again`, same count):
  `BAD check:shard-4: base 14 steps, merged 15, expected set 15; MISSING [pnpm run check:library]; EXTRA [pnpm run check:hall-solid-again]`
- a drop in shard 1 (`check:png-integrity` removed):
  `BAD check:shard-1: base 24 steps, merged 25, expected set 26; MISSING [pnpm run check:png-integrity]`

The merged chains, parsed (`check` = shards 1-8 in order):
```
check:shard-1 (26): check:chain-coverage, check:pow-operator, check:node, check:text, check:flat-primitives, check:cycle-tdz, check:shop-spacing, check:stall-shape, check:gondola-sightline, check:hop-clearance, check:deck-fallthrough, tsc --noEmit, typecheck:test, check:brevity, check:assets, check:hat-fit, check:glasses-fit, check:hood-face, check:baked-face, check:character-parity, check:library-glb, check:png-integrity, check:hair, check:crowd, check:speech-bubbles, check:procgen-boundary
check:shard-2 (4): check:speech-bubbles:wide, check:ride-camera, check:slide-rider, check:pet-slide
check:shard-3 (14): check:orientation, check:sky-view, check:space-night, check:waypoints, check:seed-pool, check:seed-coverage, check:park, check:park-map, check:hud-during-rides, check:jitter, check:castle, check:castle-towers, check:benches, check:castle-floors
check:shard-4 (15): check:hall-solid, check:hotel, check:reptile-house, check:library, check:labels, check:exhibit-camera, check:tap-spacing, check:look-around, check:nav-routes, check:path-preference, check:rail-race, check:cart-shape, check:tie-frame, check:cruiser-solves, check:cruiser-turn-radius
check:shard-5 (8): check:cruiser-clearance, check:castle-window, check:backpack-peek, check:statue-occlusion, check:keyring-hang, check:keyring-view, check:wall-tunnelling, check:served-deep-links
check:shard-6 (4): check:climb-wave, check:cat-bus, check:prebuilt-park, check:client-no-solver
check:shard-7 (6): check:cat-bus-suspension, check:bus-journey, check:ground-claims, check:layout-rung, check:stall-accommodate, check:arrival-camera
check:shard-8 (2): check:served-walking, check:served-book-reader
```

### Quick local checks at 36b32b64 (logs: `merge714/q-*.log` in the orchestrator scratchpad)
| check | exit | off the screen |
|---|---|---|
| `pnpm exec tsc --noEmit` | 0 | control first: a deliberate `const broken: number = 'not a number'` in a scratch src file gave exit 2, TS2322; removed, exit 0 |
| `pnpm run typecheck:test` | 0 | |
| `pnpm run check:library-glb` | 0 | 449528 bytes; 65 nodes; 3 faced heads; LIBRARY_FACES == the file's extras; both readers agree on 65 nodes |
| `pnpm run check:png-integrity` | 0 | 249 committed PNGs, 229.1 MB read, every one complete |
| `pnpm run check:chain-coverage` | 0 | 101 check:* scripts (93 leaves, 8 aggregate); "check" is 8 shards holding 79 distinct steps |
| `pnpm run check:seed-coverage` | 0 | every one of the 16 parks is built by a merge-blocking check |
| `pnpm exec vitest run test/store/library-card.test.ts` | 0 | Test Files 1 passed (1); Tests 4 passed (4); none skipped |
| `LGP_PARK_RESTART=3 pnpm run check:brevity` | 0 | 285 pieces of copy are short enough; 6 still carry a recorded exception (books alone said 283; building's sign title and subtitle are the other 2) |
| `pnpm run build` | 0 | 478 modules; "prebuilt parks: shipping none — no .parks/manifest.json" (expected locally; CI builds them) |

**Why `LGP_PARK_RESTART=3` on check:brevity.** It imports `world/anchors.ts` ->
`parkLayout.ts` -> `parkManifest.ts`, whose `PARK_RESTART` is read at module load; in Node the
resolver (`scripts/ts-extension-resolver-register.mjs` -> `acceptedRestartSync`) runs the
acceptance loop on a hash miss (seed 5 is about 20 minutes), and this tree's hash is new. The
override skips the resolver; brevity reads authored strings, so the restart cannot change what
it measures (it solved seed 5 restart 3's layout, 76 s). Same trick as the groundwork's
`LGP_PARK_RESTART=3` scratch runs.

### Not run locally (left to the PR's CI, by the task)
`pnpm run check` (the World-building shards, incl. check:library, check:served-deep-links and
check:served-book-reader), `pnpm run test:procgen`, coplanar, swept bus. No `.parks` exists for
this tree: its park source hash is new (below), so any World-building check would first run
acceptance loops. No CI was dispatched by hand: the PR's own run is the gate.

**Park source hash at 36b32b64: `6b86bf43c3a69cecf3deee1b43453c4e0a17af20c9098db54159bf47fe4034b0`**
(`parkSourceHash`, 494 closure files). CI's parks artifact for this tree will be named
`parks-6b86bf43...`; download it into `.parks` (verify with `scripts/verify-parks.mts`) to run
World-building checks locally at this source without solving. Any closure edit makes a new
hash. Outside the closure (measured): check-deep-links.mts, main.ts, Game.ts,
reader/BookReader.ts. Inside: state/types.ts, library/Library.ts, art/models/libraryAssets.ts.

## Foundation, first half (14 Oct): plan Step 0, Step 1 change 5, Step 2's remainder
This file replaces the plan's `HANDOFF-library-owl-den.md`. Worktree `.claude/worktrees/library-714`;
a detached **baseline worktree** `.claude/worktrees/library-714-baseline` at 009dea3e (the
foundation's code) held the Step 0 baselines and was removed once they were read. Scratch
instruments and logs: the orchestrator scratchpad's `f714/` (`scratch/*.mts`, `*.log`;
`ciparks/` is the PR's CI parks for the foundation, 6b86bf43…).

**The PR's preview is live for the foundation (parts 1-3)**: the newest "Deploy PR preview"
comment on #720 names `https://pr-720-8f0cb8c-land-of-good-places.blockstack.workers.dev`
(built from 8f0cb8c; its `version.txt` is ab3603a9, the PR's merge commit). Checked with curl
only, not rendered: `/library-door`, `/library` and `/book?id=ripikaBalloon` answer 200 with
the app shell, and `/parks/5.json` serves seed 5 restart 1.

### Step 0 facts (read off 009dea3e, whose code is 36b32b64's)
- `src/art/assets/libraryGlb.ts` exports `LIBRARY_GLB_BASE64` (449528 bytes) and `LIBRARY_FACES`
  with all three heads (cat, dragon, owl), equal to the plan's figures (owl eyes
  [0.6827, 0.5494, 0.3173, 0.5494], window 1.2272 x 0.9873, rim [0.1073, 0.1296]; dragon eyes
  v 0.5, window 0.7579 x 0.5125; cat eyes v 0.4423, window 0.3835 x 0.3055).
- **The glb** (`f714/scratch/glb-facts.mts`, `readGlbParts`): 65 mesh nodes, none rotated or
  scaled. Every pivot and bound in the plan's "What changed" list holds:
  - owl: head, beak, glasses at t(0, 0.735, 0.020); wingL t(0.340, 0.698, 0); wingR and
    heldBook t(-0.340, 0.698, 0); the rest at the origin. Plan reach 0.645 (head +-0.614,
    glasses front z 0.616); body, bib, buttons and feet alone 0.413 (body x +-0.400); top 1.600.
  - dragon: head and horns t(-0.044, 0.434, 0.060); tail t(-0.070, 0.128, -0.339); body, belly,
    spines, wings at the origin; top 0.900 (horns); plan reach 0.682.
  - nest: pad top 0.145, covers top 0.190, x and z +-0.800, plan reach 0.823.
  - cat: head t(-0.051, 0.124, 0.040); earL t(-0.018, 0.271, 0.100), earR t(-0.198, 0.271,
    0.100), siblings of the head; tail t(0.125, 0.058, -0.143); top 0.350.
  - bookPile: top 0.900, x -0.444..0.444, z -0.309..0.346.
  - secretShelf-carcass x 0..4, y 0..3.2, z -0.6..0 (origin on its front-left vertical edge);
    shelf-carcass the same case centred (x +-2, z +-0.3). armchair-seat top 0.36; cushion-body
    top 0.36, x and z +-0.45.
- `BOOKS.length` 12 === `LIBRARY_READABLE_SLOTS.length` 12. Two titles carry their own
  punctuation ("Duck, Duck, Duck!", "Goodnight, Park"), which is why templates quote titles.
- **What libraryAssets.ts draws from** (`f714/scratch/asset-facts.mts`): wall cases from the glb
  (`kitShelf()` = `shelf-carcass` + `shelf-shelves`); stacks are two glb shelves back to back;
  low bins are libraryAssets' own primitives (length and depth from the glb shelf, height 1);
  cushions are the glb's `cushion-body`; armchairs and the story chair are the glb's
  `armchair-*` (the story chair is the same chair in tapestry cloth).
  - `libraryCushionSize()` = { top 0.36000001430511475, radius 0.44999998807907104 }:
    `KID_HIP_HEIGHT` is 0.36, so Decision 14's cut is not needed.
  - `libraryArmchairSize()` **takes no argument** (the plan's `libraryArmchairSize(true)` does
    not exist) = { seat 0.36000001430511475, width 1.4000000953674316, depth 1.0464898943901062,
    height 1.159999966621399, centreX 0, centreZ -0.033244937658309937 }; no `seatCentre` yet.
  - `libraryBookcaseSize('wall')` = { length 4, depth 0.6000000238418579, height
    3.200000047683716, shelfTops [0.18, 0.756, 1.332, 1.908, 2.484], shelfClear 0.516 x5,
    innerHalf 1.84, boardFront 0.25 }; 'stack' the same with depth 1.2, boardFront 0.55; 'low'
    { length 4, depth 0.6, height 1.0, shelfTops [0.1, 0.52], shelfClear [0.36, 0.38], innerHalf
    1.88, boardFront 0.28 }.
- **The glb is decoded once, in `src/art/models/libraryKit.ts`** (`readGlbParts` at module
  load; `libraryPart`, `kitBounds`, `kitTreads`). `libraryAssets.ts` does **not** import
  `LIBRARY_GLB_BASE64`. Its private `STYLES` already dresses all 65 nodes, the creatures
  included, and throws on an undressed node or a stale row: Step 3's `LIBRARY_GLB_STYLES` is
  that table, exported. Where it differs from the plan's Step 3 list (Step 3's call):
  `dragon-wings` is `PALETTE.markerPink` (plan `ART.miniLilac`); outlines `owl-head` 0.02
  (plan 0.016), `owl-glasses` 0.01 (plan 0.012), `cat-*` 0.012 and 0.01 (plan 0.016).
  **Step 3 then decided** (second half): `dragon-wings` is now `ART.miniLilac`, and the
  building's outlines are kept; see "Decisions from the second half".
- `/library?at=x,z&facing=deg` **is already a parsed `DeepLink`** (building's
  `parseLibraryLink`, `Game.enterLibrarySpawn`); `/library` is not in `RIDE_DEEP_LINKS`,
  `/library-door` is.
- **The check chain** (parsed, 173 scripts; `f714/step0-shards.json`) is the foundation merge's
  table above, step for step: shard-1 26 (brevity, assets, library-glb, png-integrity in it),
  shard-2 4, shard-3 14 (jitter), shard-4 15 (hotel, reptile-house, library, labels,
  tap-spacing), shard-5 8 (wall-tunnelling, served-deep-links), shard-6 4 (climb-wave),
  shard-7 6, shard-8 2 (served-book-reader). `check:npc-presence` is in no shard. Nothing in
  this half touches package.json.
- **The groundwork is present after the merge** (read, not assumed): `lineSeconds` in
  `ui/speechTiming.ts`, imported by Hotel.ts; `Player.isRunning` (`DUST_SPEED` private;
  `spawnRunningDust` starts `if (!this.isRunning) return;`); `'listening'` and
  `applyListeningPose` (LISTEN_ARM_X -0.95, LISTEN_CHIN -0.08); `CollisionWorld.restoreWall`
  and the exported `JUMP_CLEARANCE_GRACE` 0.15, the library's toggles named in both docs;
  `SpritePuffs` (ReptileHouse builds `new SpritePuffs(this.hallRoot, 12)`); `visibleReachXZ`.
  State: `'card'` in `INVENTORY_KINDS` and in `CUTE_CATEGORIES` after `'book'`, not in
  `PARADE_KINDS`; `gameStore.grantKeepsakeOnce`; `world/library/libraryCard.ts`;
  `test/store/library-card.test.ts` in procgen shard 6.

### Step 0 baselines, and the same ten after this half (Step 1's "identical counts" proof)
Both trees on **their own seed-5 park**, each built at its own source with `LGP_SEEDS=5
LGP_RESTART_LANES=4 pnpm run build:parks` (the PR's CI parks were still searching seeds 10 and
14): the foundation (baseline worktree, 009dea3e, source 6b86bf43…) and this branch (dee13412…)
both accepted **restart 1, digest 9acd3a626f55d35c**. Runner `f714/run-ten.sh`; logs
`f714/before/*.log` and `f714/after/*.log`; exit codes read from the files. Counts off the screen:

| check | exit before / after | the counts (foundation; after is identical unless shown) |
|---|---|---|
| check:library | 0 / 0 | 55 ✓, 0 ✗, "All clauses passed."; 137 solids; keep-outs 64 of 64 reached; 8785 clear cells, no pocket |
| check:labels | 0 / 0 | 12570 frames (plaza 4224, castle shops 1278, hotel lobby 708, reptile house 6360); 54 labels registered, up to 8 at once; no overlap |
| check:tap-spacing | 0 / 0 | 10 spaces, 131 zones, 27 portal bands; 231 zone-band and 20 close zone-zone pairs; 20 same-action overlaps (warnings); OK |
| check:brevity | 0 / 0 | **285** pieces, 6 recorded exceptions -> after **350** (+45 library lines, +10 library titles, +10 SECRETS rows) |
| check:assets | 0 / 0 | 130 assets, 47 creatures (32 posed), 28 recorded drift (worst balloon.corgi +0.077 m) |
| check:hotel | 0 / 0 | 31 children (7 residents), lowest foot y -15.55 after 8 s; 13 props solid, 3 beds soft; 41/41 panes; 3685 lobby spots; 230 doorway marches 0 short; 3893 furniture-wall pairs 0 embedded 9 grazed; 128 portal walk-throughs 0 never arrived; OK |
| check:reptile-house | 0 / 0 | 129 ✓, 0 ✗, "All clauses passed."; 286 solids; 879 stations on 14 paths, 0 blocked |
| check:npc-presence | 0 / 0 | 31 NPCs, 18000 frames; crossings 15 in / 12 out; 0 movement elsewhere; 0 disagreements; OK |
| check:jitter | 0 / 0 | 31 children, 9000 frames; worst own step 0.166 m (Luca); worst speed 4.983 m/s (Luca) |
| check:climb-wave | 0 / 0 | 38 climbable trees, all 100.0%; hand 18 px vs head 468; rock 6.5 px; aim 0.00° worst / 7.52° max; body 20 px; OK |

**And the movers' own checks, after only** (this branch, its seed-5 park; logs
`f714/extra/`), because the Collision fix reaches every mover: check:castle 0 (banquet 117
seated, worst hip 0.0 mm, floor 4.7 mm), check:castle-towers 0, check:benches 0 (18 benches
from 16 bearings, 10 planters, the pavilion), check:npc-separation 0 (closest 1.800 m, 865 of
900 frames corrected, worst 0.042 m), check:rail-race 0 (lap 611.9 m; plays well 24/24, sloppy
24/24, child pace 15/24), check:slide-rider 0 (611 frames, worst 0.21 m off the chute),
check:hall-solid 0, check:wall-tunnelling 0 (above).

**Before and after compared line by line** (timings masked, solver chatter dropped): library,
labels, tap-spacing, assets, hotel, reptile-house, npc-presence, jitter and climb-wave are
**identical**; brevity differs in exactly its summary line (285 -> 350) and the two new stderr
notes. Nothing moved but what this half added. (The shared slice's own baselines were on
main's park — 49 trees, lowest foot -14.91 — and are not comparable: the library plot moved the
park.)

### Step 1 change 5 (d2a7f00e)
- `LibraryProps.box` returns `BoxWalls` = `[body, leftEnd, rightEnd]`, registered in the same
  order as before (so no collider moves).
- `detach(walls)` / `attach(walls)`: `removeWall` / `restoreWall` on each, the same objects.
  Colliders only: a plate a box laid stays (nothing toggled has one).
- `KeepOut.den?: true` and `StandSpot.den?: true` (layout.ts, types only); `libraryKeepOuts`
  copies the tag and omits it when absent.
- `wall(what, a, a, half, top)` documented as the zero-length capsule (a filled disc that can be
  detached and attached, which an `addCircle` disc cannot).

### The zero-length capsule was a ghost to the mover: fixed in Collision.ts (773efb7c)
**A deviation from the plan, which says "the collision world already handles length 0".
Read, it did not.** `resolve()`, `deepestSolidOverlap()` and `wouldAutoHopClear()` each had
`if (lengthSquared < 1e-8) continue;`, while `isClearCircle()`, `solidDepthAt()` and
`NavGrid` treat a zero-length wall as a disc. So the owl's capsule would have been walked
straight through by a real child **while the flood fill called her solid**: the check would
have passed and the game been wrong. Measured (`f714/scratch/zero-capsule.mts`; mover radius
`PLAYER_RADIUS` 0.62 walking +z at 0.05 m a frame from z -3; capsule half 0.65 at the origin):

| collider | before: march ends | after | isClearCircle(centre) | deepestSolidOverlap at (0.3, 0) before / after | resolve from the exact centre, before / after |
|---|---|---|---|---|---|
| CONTROL 1 m capsule | -1.270 | -1.270 | false | 1.270 / 1.270 | (0, 1.270) / same |
| CONTROL addCircle disc | -1.270 | -1.270 | false | 0.970 / 0.970 | (1.270, 0) / same |
| zero-length capsule | **+3.000 (walked through)** | -1.270 | false | **0.000** / 0.970 | **(0, 0)** / (1.270, 0) |
| zero-length, top 0.9 abs | **+3.000** | -1.270 | false | **0.000** / 0.970 | **(0, 0)** / (1.270, 0) |

Auto-hop (top 0.3, apex 1.0, hoppable): disc true; zero-length capsule **false** before, true
after. The fix: those three paths take t = 0 for a zero-length wall (NavGrid's own idiom), and
`resolve`'s exactly-on-the-centre shove uses the circles' stable (+x) direction instead of
dividing by a zero length. Documented on `WallCollider`.
- **Guarded** (4d747841): `check:wall-tunnelling` (shard 5) walks a zero-length capsule at
  head-on at every half-thickness up to 0.65 in both suites, and fails unless every such run is
  held or flown (never tunnelled, never walked round), with the counts on stderr. Green
  (`LGP_PARK_RESTART=3`, the check builds no park, only the boundary module): exit 0, SOLID
  195 shapes / 299520 runs, 0 tunnelled with sub-stepping, "zero-length capsules (the owl's kind
  of solid): 36864 runs — held 36864, flew over 0, tunnelled 0, walked round 0"; HOPPABLE 65
  shapes / 99840 runs, "12288 runs — held 0, flew over 12288". Red below.
- **Does it move anything that exists?** Only if a park already registers a zero-length wall.
  Instrument `f714/scratch/degenerate-walls.mts` (builds the World, counts its walls by length;
  CONTROL: one zero-length wall added afterwards must be counted, and is). Seed 5 at this
  branch (dee13412, park hydrated from its own `.parks`): **walls 1289, circles 1793;
  zero-length 0; under 1 cm 0; under 10 cm 0; shortest 0.11963 m; CONTROL counted 1.** The
  count covers the interiors (walls by owner: (none) 382, boundary wall 284, hotel 199,
  library 157, castle 129, reptile house 106, booth 32). **All sixteen parks**, at the foundation, each hydrated
  from the PR's CI parks artifact `parks-6b86bf43…` (run 38580957653; restarts 0:3 1:1 2:3 3:7
  4:1 5:1 6:1 7:5 8:1 9:5 10:9 11:4 12:0 13:6 14:8 15:4, the same as building's CI): **zero
  zero-length walls on every seed**, none under 10 cm either (shortest 0.11963-0.11999 m;
  walls 1203-1359, circles 1793-1929 per seed), and the CONTROL wall counted on every seed
  (`f714/degenerate-16.txt`). So the fix changes no collision in any park that ships; the first
  zero-length wall will be the owl's. (CI's seed-5 file has the same digest, 9acd3a626f55d35c, as
  both local builds; only its `acceptance` log of timings differs.)
- **Seed 5's park at this branch's source** (`LGP_SEEDS=5 LGP_RESTART_LANES=4 pnpm run
  build:parks`, dee134126611…): restart 0 rejected by check:coplanar (236 s), **restart 1
  accepted (134 measures), digest 9acd3a626f55d35c**, proven by hydration, exit 0 in 523 s —
  the restart building's CI accepted for seed 5. `.parks/` in this worktree now holds it, so
  World-building checks here hydrate instead of solving (until the next closure edit).
  **The same build at the foundation's source** (6b86bf43…, in the baseline worktree): restart 0
  rejected by check:coplanar (238 s), **restart 1 accepted (134 measures), digest
  9acd3a626f55d35c**, exit 0 in 507 s. Same restart, same digest: these edits moved neither
  seed 5's park nor its acceptance verdict. And the foundation's seed 5 registers the same
  colliders as this branch's (walls 1289, circles 1793, the same owners), zero-length 0.

### Step 2's remainder (9f650da1)
- `src/world/library/libraryLines.ts`: `LIBRARY_LINES` and `LIBRARY_CHIPS` exactly as the plan
  gives them, and `libraryCopyForBrevity()`, which **walks** the two tables (no list kept in
  step; anything that is not words, a template, a list or a table throws; the number
  `cardCheerAt` is skipped). Keys: `libraryLine:owl.welcome`, `libraryLine:owl.card#3` (lists,
  1-based like `bookPage:`), `libraryLine:owl.recommend:<bookId>` (each template x every BOOKS
  title), `libraryChip:<name>`, `libraryCard:displayName` (whose `where` is libraryCard.ts).
- `check-copy-brevity.mts` measures them and every `SECRETS` row (`secretName:<id>` title,
  `secretDone:<id>` line), with a vacuity guard (throws if the library walk is empty or any
  BOOKS title was never rendered into a template, or SECRETS is empty) and stderr notes.
  Green (`LGP_PARK_RESTART=3 pnpm run check:brevity -- --verbose`): **exit 0, "BREVITY RULE:
  350 pieces of copy are short enough; 6 still carry a recorded exception"** (285 before):
  45 `libraryLine:` rows (21 fixed lines and list entries, 24 template renders), 9
  `libraryChip:`, 1 `libraryCard:`, 5 `secretName:`, 5 `secretDone:`; stderr "the Library —
  45 lines (24 of them templates rendered with each of the 12 titles), 10 titles (the chips and
  the card)" and "the secrets — 5 names and 5 lines". Longest library line
  `owl.storyBegin:catBusDay` 42; `owl.recommend:duckBars` 29 and one sentence (the title's "!"
  sits before the closing quote). Longest SECRETS line `secretDone:secret.metTheReptiles` 41.
- The groundwork's vitest: `pnpm exec vitest run test/store/library-card.test.ts
  --reporter=verbose` exit 0, **Test Files 1 passed (1), Tests 4 passed (4)**, all four named
  cases ticked, none skipped. `check:seed-coverage` exit 0 ("procgen shards: 46 suite files
  over 6 shards (5/5/5/8/8/15 files), each exactly once"). `tsc --noEmit` 0, `typecheck:test` 0.

### The PR's CI on the foundation (run 38580957653, head 8f0cb8c3; not dispatched here)
Parks: all 16 found (restarts 0:3 1:1 2:3 3:7 4:1 5:1 6:1 7:5 8:1 9:5 10:9 11:4 12:0 13:6 14:8
15:4; seeds 10 and 14 needed blocks past the first two). Then: Every seed builds, Checks build,
Entrance road, Deploy PR preview, Swept bus, Coplanar faces, Walk reach, Checks shards 1-7,
Procgen invariants shards 1, 2, 3, 5, 6 — **success**; Deploy skipped (not main);
**Procgen invariants shard 4 — failure**, and so the `Procgen invariants` gate;
**Checks shard 8 — failure** (exit 124), and so the `Checks` gate. Run conclusion: failure.
- **The red:** `test/railRaceRoadBounded.test.ts` — "Test timed out in 240000ms"; the solve
  itself ran 398319 ms and every assertion in it held (`exhausted=decision-zero-per-feature:
  road still refuses after its 2 unwinds ... turns=179 unwinds=20 decision-zero=11
  road-unwinds=2 road-refusals=3`).
- **Root cause:** its pin, seed 10 restart 0, went stale with the Library's plot (#716). Building's
  own CI (38569170320) ran the same 179-turn solve in 228132 ms and passed by 12 s — luck, which
  is flaky, which is failing. Building re-pinned the sibling `railRaceRefusals` (d10fd02d) and
  missed this one.
- **Fix (04e98676):** re-pinned to seed 3 restart 7, picked by measuring the mutated solve of the
  seven fastest shipped plans of this run side by side (table in the test's header): 61 turns,
  0 decision-zero; the real file at the default timeout **20.9 s, 1 passed**. Control red at the
  new pin: the mutation off, the solve completes (44 turns) and the test fails "expected null to
  be an instance of Error". Outside the park source closure (hash unchanged).

- **The second red: Checks shard 8**, `watchdog[check:shard-8] — RAN OUT OF CLOCK ... killed
  during check-book-reader (after 19m04s in it)` at the 27m00s budget; check:served-walking had
  passed first (~8 min). Its report, flushed on the kill, had reached "reading catBusDay to
  the end" (section 6 of 8). check:served-book-reader had never run on CI before this PR (the
  books branch ran its gates locally); locally on a GPU the whole check takes 36 s.
- **Root cause, measured** (a timed copy of the check in the scratchpad, against my own dev
  server on 5791, Chromium forced onto SwiftShader — the runner's renderer — at 1280x800, seed 5):
  the paused park drawn under the open book is most of every frame. Park drawn: **380 s**;
  park hidden after the first screenshot: **70 s**, every assertion the same. Device pixel ratio
  0.5 changed nothing (384 s): it is draw-bound, not fill-bound. CI ran ~4.1x slower than this
  machine's SwiftShader (section 6 reached at 1144 s vs 279 s), so the check was ~26 min on CI.
- **And a race the measurement exposed:** with the park drawn under SwiftShader the old check
  went red on 7 assertions, each a page read before its turn began (`A (the hop) presses the
  page ...: spread 2 → 2`, `a tap of ← ...: 2 → 2`, `Space ...: 2 → 2`) or after a late one
  landed (`a swipe leftwards turns exactly one page: spread 2 → 0`, `... rightwards: 0 → 0`,
  `phone-portrait a tap pans ...: face 1 → 2, spread 0 → 1`, `... the next tap turns the leaf
  ...: face 2 → 3, spread 1 → 1`). Every read after an input waited 100-400 ms, a guess at the
  frame rate. Flaky is failing.
- **Fix (588c413b, check-book-reader.mts):** `nextFrames`/`settleTurn` wait for the game's own
  frames after every input (and look again a frame later, so a late second turn still counts),
  and frame waits follow the other timed reads that precede an assertion; the park scene is
  hidden after the first screenshot (`<id>-open.png` keeps the composition for QA;
  `CHECK_BOOK_READER_PARK=shown` keeps it drawn; stderr says which on every run). **Same
  conditions as the 7 reds (SwiftShader, park drawn): exit 0, 421 s.** Default (park hidden)
  under SwiftShader: exit 0, 71 s (~5 min on CI by the 4.1x). GPU: exit 0, 36 s. **Red still
  reachable:** the reader's swipe click guard removed (BookReader.ts, outside the park closure)
  -> `a swipe leftwards turns exactly one page: spread 1 → 3`, exit 1; reverted.
- **Fix (c136443b, package.json + checks.yml):** `check:shard-9` = check:served-book-reader on
  its own; shard 8 = check:served-walking. Step sets parsed and compared (never grepped): 79
  before, 79 after, none missing/added/duplicated; scripts 173 -> 174 (+check:shard-9); values
  changed: `check`, `check:shard-8`; control (shard 8 loses the step) -> exit 1 naming it.
  check:chain-coverage exit 0 (93 leaves reachable, "check" is 9 shards holding 79 steps); its
  control (matrix without 9) -> exit 1, `check:shard-9 is run directly by 0 workflow
  invocation(s)`. `pnpm run check:shard-9` locally: exit 0, 36 s, its own server stopped.
- **Unproven until the next CI run** (not dispatched here, by the task): shard 9's real time on
  the runner (estimate ~5 min plus setup) and shard 4's re-pinned test there.

### Red transcripts (each with what it was proved against)
- **check:wall-tunnelling, the zero-length clause.** Mutation: Collision.ts's three
  `if (lengthSquared < 1e-8) continue;` put back (resolve, deepestSolidOverlap,
  wouldAutoHopClear), restored with `git checkout` after. Geometry: a zero-length capsule at the
  origin, halves 0.15/0.18/0.22/0.28/0.34/0.45/0.6/0.65, tops 0.7/2.0/Infinity (and 0.7
  hoppable), walked +z from (0, -6), 8 frame rates x 2 gaits x 96 phases. Exit 1:
  ```
  zero-length capsules (the owl's kind of solid): 36864 runs — held 0, flew over 0, tunnelled 36864, walked round 0
  zero-length capsules (the owl's kind of solid): 12288 runs — held 0, flew over 0, tunnelled 12288, walked round 0
  check:wall-tunnelling FAILED — 4 problem(s)
  - SOLID walls (...): 36864 of 299520 runs TUNNELLED through a wall with sub-stepping on — e.g. zero-length capsule half=0.15 top=0.70 at 12 fps, walk, phase 0.000; ...
  - HOPPABLE 0.7 m walls (...): 12288 of 99840 runs TUNNELLED through a wall with sub-stepping on — e.g. zero-length capsule half=0.15 top=0.70 at 12 fps, walk, phase 0.000; ...
  ```
  (plus the two "not all held or flown" guard lines; that run printed the guard's earlier
  wording, "were not all scored (held 0, flew 0, walked round 0)", since sharpened to name the
  tunnelled count.)
- **check:brevity, Step 2 red 1.** Mutation: `owl.welcome = 'Welcome! Come to my desk.'`
  (25 characters, two sentences); reverted. `LGP_PARK_RESTART=3 pnpm run check:brevity`: exit 1,
  ```
  libraryLine:owl.welcome                 line    25   2  SENTENCES
  BREVITY RULE (GAME_DESIGN.md): 1 problem across 350 pieces of copy.
    libraryLine:owl.welcome  (src/world/library/libraryLines.ts)
      2 sentences; a line is one
  ```
- **check:brevity's library vacuity guard** (ec0533c4). Mutation: the template branch of
  `libraryCopyForBrevity` fed no titles (`BOOKS.slice(0, 0)`); reverted. Exit 1:
  ```
  Error: check:brevity: libraryCopyForBrevity() measured 31 pieces and rendered no template with ripikaBalloon, biscuitBreakfast, trillaHigh, catBusDay, duckBars, bookDragon, foreverSlide, fireflies, fountainWish, keychainStall, bigParade, goodnightPark — the walk over libraryLines.ts is broken (or the Library has no templates any more, and this guard should go with them)
  ```
  (31 = the 21 fixed lines and list entries, 9 chips and the card: everything but the 24 renders.)
- **vitest library-card, Step 2 red 2.** Mutation: the `'card',` line deleted from
  `INVENTORY_KINDS` (src/state/types.ts); reverted with `git checkout`. Input: the test's own
  fixtures (a fresh store; LIBRARY_CARD granted twice). Exit 1, `Tests  2 failed | 2 passed (4)`:
  ```
  × the library card > is granted once, however often the owl is asked, and keeps the day she first got it
  × the library card > survives writeSave and loadSave, item and Cute-o-dex entry both
  ✓ the library card > is absent from a save written before the library existed
  ✓ the library card > drops an item of an unknown kind ('cardz') and keeps the rest of the inventory
  AssertionError: 'card' is not an inventory kind the save knows: expected [ 'toy', 'balloon', 'treat', …(7) ] to include 'card'
  AssertionError: the card was dropped on load: expected [] to have a length of 1 but got +0
  ```

## Foundation, second half (14 Oct): plan Steps 3, 4 and the WITH A REAL CHILD harness
Folded from `HANDOFF-library-assets.md`, which the merge commit deleted. Built by another
engineer (Claude Opus 5.5) on `feat/library-714-assets`, cut from 009dea3e (the foundation
head), in the worktree `.claude/worktrees/library-714-assets` (removed after this merge). Plan
Steps 3 and 4, plus Step 6's "Checks" harness. It stayed off the first half's files (props.ts,
layout.ts, libraryLines.ts, check-copy-brevity.mts, this file). Scratch instruments and logs:
the orchestrator scratchpad's `assets714/`.

### What was done (commits on `feat/library-714-assets`)
- Step 3: `LIBRARY_GLB_STYLES` exported + `libraryKitMesh` (c6ec7f5c); `libraryFaces.ts`,
  `libraryCreatures.ts`, the storybook dragon's colours (77c1044c); check:assets x5 (4a6eca48);
  PAINTED FACES + the `LIBRARY_CHECK_MUTATE` allow-list (d6486af8).
- Step 4: the `/library?at=6,8.7&facing=180` case with a facing read (6ec484d7).
- The WITH A REAL CHILD harness, its own clause and its red (d6486af8).
- `art/blend/library_render.py`'s docstring names the colour table by its name,
  `LIBRARY_GLB_STYLES` (88ac6218; stale-comment rule, no code change).

### What each file now gives the tracks
- `src/art/models/libraryAssets.ts`: `LIBRARY_GLB_STYLES` (the one table, exported; the building's
  STYLES renamed), `PartStyle` (type), `libraryKitMesh(name, material?)` (the one dresser; an own
  material for a part that must own one).
- `src/art/models/libraryFaces.ts`: `owlFaceTextures()` (neutral, blink, happy, shush),
  `dragonFaceTextures()` (neutral, blink, happy, puff), `catFaceTextures()` (asleep, happy),
  `LIBRARY_FACE_ROWS`, `LIBRARY_FACED_HEADS`, `libraryFaceCanvasSize(head)`. 10 canvases.
- `src/art/models/libraryCreatures.ts`: `createLibraryOwl()` → `OwlHandle` {root, height, body,
  head, wingL, wingR, headMaterial, face, setFace, setExpression}; `createLibraryDragon()` →
  `DragonHandle` (a CreatureHandle: limbs null, setWalkPhase no-op) + {tail, belly, mouth,
  mouthInHead, headMaterial, face, setFace}; `createLibraryDragonNest()` → {root, height, padTop,
  radius}; `createLibraryCat()` → {root, height, body, head, earL, earR, tail, headMaterial, face,
  setFace, setExpression}; `createLibraryBookPile()` → {root, height, plan}; `DRAGON_BELLY_REST_GLOW`.
- `scripts/check-library.mts`: `MUTATIONS` / `mutating(name)`, `slope()`, PAINTED FACES, and the
  harness `child: RealChild` with one marker per track below its own clause.
- `scripts/check-deep-links.mts`: `libraryCheck(path, spot, what, facing?)` reads her facing back.

### Measured (seed 5 park at source 94225e98, and the bare handles)
| creature | height (outline incl.) | bottom | plan reach | notes |
|---|---|---|---|---|
| owl | 1.619 | -0.012 | 0.6548 at rest; **0.6674** with breathing (1+0.6·0.02) and head yaw ±1 rad | head pivot (0, 0.7352, 0.0200); wings ±0.34 at y 0.6975 |
| dragon | 0.910 | -0.016 | 0.6927 | head pivot (-0.044, 0.4336, 0.060), horns on it; tail pivot (-0.070, 0.1281, -0.3389); mouth (root) (-0.044, 0.4336, 0.5461), in head (0, 0, 0.4861) |
| nest | 0.200 | -0.012 | 0.8340 | padTop 0.145 |
| cat | 0.359 | -0.010 | 0.3483 | head pivot (-0.0508, 0.1242, 0.040); ears under it at (0.0324, 0.1472, 0.06) / (-0.1474, 0.1472, 0.06) |
| pile | 0.911 | -0.011 | 0.5357 | plan (outline incl.) x -0.454..0.455, z -0.320..0.357 |
Every glb creature node has identity rotation and scale (read off the file), so hanging by
translation subtraction is exact. Face canvases 512 x 412 / 346 / 408; parked back faces at glTF
(0.020, 0.980): owl 184, dragon 146, cat 155; front-mapped 164 / 130 / 139.

### Red proofs (each reverted; geometry: seed 5, restart 1, source 94225e98, digest 9acd3a626f55d35c)
- **check:assets**, the owl's height typed `1.5` in createLibraryOwl → exit 1:
  `library.owl: declares height 1.500 m but measures 1.619 m (+0.119 m)`.
- **PAINTED FACES**, `LIBRARY_CHECK_MUTATE=faces-upside-down` → exit 1, `3 clause(s) FAILED`:
  ```
  note: FLIPPED all 10 painted faces the other way up on purpose ...
  ✗ owl-head: 164 front vertices (184 parked), the canvas row RISES 1.01/m as the head rises (flipY false); the eye row lands at y 1.169, over the beak's top at 0.948
  ✗ dragon-head: 130 front vertices (146 parked), the canvas row RISES 1.95/m as the head rises (flipY false); the eye row lands at y 0.552 and the mouth row at y 0.667
  ✗ cat-head: 139 front vertices (155 parked), the canvas row RISES 3.27/m as the head rises (flipY false); the eye row lands at y 0.136 and the mouth row at y 0.199
  ```
  Green: owl eye y 1.058 over beak top 0.948, slope -1.013; dragon eye 0.552 / mouth 0.437, slope
  -1.951; cat eye 0.157 / mouth 0.115, slope -3.273. **Note:** on the owl the eye-above-beak half
  alone cannot see a flip (her eye row is mid-head: flipped it lands at 1.169, still over the
  beak); the falling-row half is what goes red there.
- **WITH A REAL CHILD**, `LIBRARY_CHECK_MUTATE=block-walk` (a wall x -3..3 at room z 9.6,
  half-thickness 0.2, a metre ahead of the arrival (0, 10.6)) → exit 1:
  `✗ steered up the central aisle for 2 s (the stick pushed on 120 of 120 frames), she travelled 0.18 m (at least 1.5) to (0.00, 10.42), ...`
  Green: 14.26 m to (0.00, -3.66), feet 0.000 m off the floor.
- **The allow-list**: `LIBRARY_CHECK_MUTATE=shift-books` (no clause arms it yet) → exit 1,
  `✗ LIBRARY_CHECK_MUTATE=shift-books was asked for, but no clause in this build arms it — this run ASSERTS NOTHING about it`;
  `=bogus` → throws `... is not one of this check's mutations: ...`.
- **check:deep-links**, `Game.enterLibrarySpawn` calling `requestEnter()` without `at` → exit 1:
  `/library?at=6,8.7&facing=180 (startFresh): asked for the desk's front, room (6, 8.7) = world (-594, -591.3); she is in 'library' at (-600.0, -589.4), 6.3 m off`
  (and continueGame the same; the secret-shelf case 21.7 m off).
- **check:deep-links**, `parseLibraryLink` dropping `facing` → exit 1:
  `/library?at=-16.1,-4&facing=270 (startFresh): on in front of the secret shelf, 0.00 m off, but facing 3.142 rad where the link asked 4.712 (270°): 1.571 rad round`.
  The desk case stays green there, as its own read says: 180° is the arrival's facing too.

### Parks, on that branch
Only libraryAssets.ts is a park-closure edit here (measured with `parkSourceClosure`: libraryAssets.ts
IN; readerAssets.ts, the three check scripts, main.ts, Game.ts OUT; the new libraryFaces.ts and
libraryCreatures.ts are imported by no closure file). Source hash at the head:
`94225e989746ab584747672e0385ff5671dadf3ac0386c5865f61872a54882bf`.
`LGP_SEEDS=5 LGP_RESTART_LANES=4 pnpm run build:parks` → seed 5 restart 0 rejected by
check:coplanar, **restart 1 accepted** (134 measures), digest 9acd3a626f55d35c, 506 s; `.parks/` in
this worktree. A merge with the first half's closure edits makes a new hash.

### Checks at that branch's head (88ac6218), read off its logs in `assets714/`
- `check:library` (`final-library.log`): **60 ✓, 0 ✗**, "All clauses passed." — the
  foundation's 55, plus PAINTED FACES' 3 and the harness's 2; seed 5 restart 1 hydrated.
- `check:assets` (`final-assets.log`): "135 assets check out, 48 of them creatures that stand
  still as built (32 also posed through update()); 28 still carry recorded drift (worst:
  balloon.corgi +0.077 m)" — the foundation's 130 / 47, plus the five handles.
- `check:served-deep-links` (`served-deeplinks-1.log`): exit 0, "check:deep-links passed",
  10 links x 2 starts = 20 OK lines.
- Its `final-tsc.log` and `final-tsct.log` record no exit code; the merged tree's own runs
  (below) are the ones that count.

## The Steps 3-4 merge (14 Oct)
`git pull` first (already up to date at 9e49816b), then
`git -c rerere.enabled=false merge --no-ff --no-commit origin/feat/library-714-assets`
(88ac6218), merge base 009dea3e: "Automatic merge went well". No conflict to resolve: since
the base, this branch changed 11 files and the assets branch 9, and no file is in both lists.
- **Every merged file audited by blob id** (not by eye): each of this branch's 11 equals this
  branch's blob and each of the assets branch's 9 equals its blob (0 differ). The index
  differs from HEAD in exactly those 9 files and from the assets head in exactly those 11.
  CONTROL: the assets branch's 9 files compared with the merge base's blobs instead, 9 of 9
  differ, so the audit can say no.
- `package.json` is this branch's blob (the assets branch never touched it), so the check chain
  is the first half's, step for step (shard 9 included). Nothing to re-derive.
- **In the same commit:** this file takes the second half's facts, and
  `HANDOFF-library-assets.md` is deleted.
- **Park source hash after the merge:
  `d283ffaa1e89b40eba9249c08678a4da3f18167607ea3ca185dc3174f1f2e55e`** (494 closure files). It
  is new because both halves edited the closure: Collision.ts, props.ts and layout.ts in the
  first, libraryAssets.ts in the second. Outside it (measured): libraryLines.ts,
  libraryCreatures.ts, libraryFaces.ts, readerAssets.ts, and every changed script and test.
- **tsc does not see `scripts/`.** `tsconfig.json` includes src, procgen and the vite config;
  `tsconfig.test.json` includes test and vitest.config.ts, and says "`scripts/` is
  deliberately NOT listed". So `tsc` exit 0 cannot catch a merged-in check script calling an
  API the other half changed (check-library against `props.box`'s new return, say).
  Instrument: a scratch tsconfig (`m714b/tsconfig.scripts.json`, extending tsconfig.test.json,
  `types` pointed at this worktree's `vite/client`) over the six changed scripts:
  check-library, check-asset-contract, check-deep-links, check-copy-brevity, check-book-reader
  and measure-wall-tunnelling. Result: 15 errors, **all environmental**: 10 `process.argv` /
  `process.exit` on the test project's minimal `process`, 2 `node:fs` members its node-env
  does not declare, and 3 browser-side `/src/...` imports inside `page.evaluate`. None names a
  library type. (The assets engineer's run of its three scripts showed the same kinds.)
  CONTROL (`m714b/control-api.mts`, two deliberate mismatches against the merged source): both
  reported — `Type 'OwlHandle' is not assignable to type 'number'` and `Type 'BoxWalls' is not
  assignable to type 'undefined'` — so the instrument reads both halves' types.

### Checks at the merged source (run 16 Oct on 5d524193; logs: `.claude/library-build-scratch/foundation-checks/`)
The pause (14 Oct) stopped this merge's engineer after seed 5's park was built for d283ffaa…
(`m714b/build-parks-5.log`: restart 0 rejected by check:coplanar, restart 1 accepted with 134
measures, digest 9acd3a626f55d35c, the same digest as at 94225e98) and after tsc 0,
typecheck:test 0 and the vitest 0 at 17:50, but before the World-building checks started
(`m714b/` holds no log of them). All nine were run again on 16 Oct on the head, which carries
the merge's code unchanged: 5d524193 added `HANDOFF-library-resume.md` and
`docs/library-build/` only, and `node scripts/lib/park-source-hash.mjs` prints d283ffaa… at the
head, equal to `.parks/manifest.json`, so every World-building check hydrated seed 5 restart 1
and none solved a park. Each exit code is the command's own status, written into its log (no
pipes); the counts are copied off the logs.

| check | exit | off the screen |
|---|---|---|
| `pnpm exec tsc --noEmit` | 0 | no diagnostics; the program is 1141 files (`--listFilesOnly`) |
| `pnpm run typecheck:test` | 0 | no diagnostics |
| `pnpm exec vitest run test/store/library-card.test.ts` | 0 | `Test Files 1 passed (1)`, `Tests 4 passed (4)` |
| `pnpm run check:brevity -- --verbose` | 0 | "350 pieces of copy are short enough; 6 still carry a recorded exception"; "the Library — 45 lines (24 of them templates rendered with each of the 12 titles), 10 titles (the chips and the card)"; "the secrets — 5 names and 5 lines"; rows: 45 `libraryLine:`, 9 `libraryChip:`, 1 `libraryCard:` |
| `pnpm run check:library` | 0 | **60 ✓, 0 ✗**, "All clauses passed."; seed 5 (restart 1) hydrated. The foundation's 55, PAINTED FACES' 3 and the harness's 2, as at 88ac6218. REACHABILITY 64 of 64 keep-outs and 8785 of 8785 cells; the real child travelled 14.26 m with her feet 0.000 m off the floor |
| `pnpm run check:assets` | 0 | "135 assets check out, 48 of them creatures that stand still as built (32 also posed through update()); 28 still carry recorded drift (worst: balloon.corgi +0.077 m)" |
| `pnpm run check:served-deep-links` (`SERVED_CHECKS_PORT=6253`) | 0 | 10 links x 2 starts: **20 OK, 0 FAILED**, "check:deep-links passed", seed 5 pinned on every URL; the four library links 0.00 m off, and both `at=` cases' facing 0.000 rad round; 138 s |
| `pnpm run check:served-book-reader` (`SERVED_CHECKS_PORT=6259`) | 0 | **372 `ok`, 0 `FAIL`**, "check:book-reader passed"; all twelve books; the smallest page text 33.3 / 26.2 / 32.3 CSS px (laptop / phone landscape / phone portrait); 36 s |
| scripts instrument (`foundation-checks/tsconfig.scripts.json`) | 2, as expected | 56 errors over the **14** scripts changed since origin/main (the merge's six and the other eight): **52 environmental** (this project has no `@types/node`, by design: `node:*` modules and their members, `process.argv/exit/execPath/kill/on/stdout`, `Buffer`, one implicit-any `code` on the untyped `ChildProcess`, and 3 browser-side `/src/...` imports inside `page.evaluate`) and **4 already on origin/main** in check-castle.mts (see "Findings outside this task"; main's own file text, mirrored beside this src, gives the same four). **None names a library type.** CONTROL (`foundation-checks/control-api.mts`): `Type 'OwlHandle' is not assignable to type 'number'` and `Type 'BoxWalls' is not assignable to type 'undefined'` both reported, and the other 56 lines are identical with and without it |

- **The merge re-audited, blob by blob** (16 Oct; the 14 Oct line was not trusted): of the
  files changed since 009dea3e, this branch's 11 and the assets branch's 9 (none in both), each
  equals the changing side's blob in 6ab4b8a2, except the two the fold meant to change:
  `HANDOFF-library-714.md` (takes the second half's facts) and `HANDOFF-library-assets.md`
  (deleted). Nothing else in 6ab4b8a2 differs from the merge base.
- **The deep-links probe solved a park again** (the finding at the end of this file): its
  bare-root page asked the dev middleware for seed 10, which started `build:parks` into
  `.parks/dev/d283ffaa1e89b40e/10/`; it died with the server's process group when the check
  finished, wrote no manifest, and the empty attempt directory was removed by hand. Every
  measured page was seed 5. It cost one core for 138 s and changed no result.

## Decisions (made here, with reasons)
- **The zero-length capsule is fixed in `Collision.ts`, not worked round in props.ts**
  (first half, 773efb7c). Alternatives weighed: register the owl as an `addCircle` disc (but
  `CollisionWorld` cannot restore a circle, and the plan's detach/attach of "the same object"
  needs one), or give her capsule a 1 mm length (a ghost-shaped hole hidden behind a number,
  and the next zero-length wall would be a ghost again). The defect was the collision world
  disagreeing with itself — its planner and NavGrid counted the disc, its mover skipped it — so
  it is fixed where it lives, guarded by check:wall-tunnelling, and measured to move no existing
  collider (the park-wide count of zero-length walls, below the transcript).
- **Brevity keys** follow the existing `<field>:<id>` convention: `libraryLine:` for every line
  (the plan's own `libraryLine:owl.recommend:<bookId>`), `#n` for a list entry (as
  `bookPage:<id>#n`), `libraryChip:` for chips, `libraryCard:displayName` for the card.
  `libraryCopyForBrevity` keeps the plan's exact signature (no `where`), so the check maps
  `libraryCard:` to libraryCard.ts and the rest to libraryLines.ts.
- **Baselines on a separate detached worktree** at the foundation's code, hydrated from the
  PR's CI parks, so no edit here can leak into them and no edit there can start an acceptance
  loop under a running check (the building handoff's hash trap).
- **The deep-links race: the combination of both fixes** (above). The task asked for the
  version that removes the root cause, waiting for the change of space to finish and for her to
  be on the spot; each fix alone covers one half.
- **rerere off on every merge.** CLAUDE.md records rerere replaying a stale resolution
  silently; resolving by hand and reading every auto-merged hunk is cheaper than auditing a
  replay.
- **The PR body names each issue with its own keyword** (`Closes #714, closes #715, ...`):
  GitHub links only the first issue in the bare comma form ("Closes #714, #715"), so the
  literal line would have closed #714 alone on merge.

### Decisions from the second half (Steps 3-4; folded from its handoff)
- **One table, one decode, one dresser.** `libraryKit.ts` already decodes the glb once and
  libraryAssets.ts already dressed all 65 nodes from a private STYLES. So the plan's
  `libraryKit()`/`loadReptileKit` is NOT added (a second decode); STYLES is renamed and exported as
  `LIBRARY_GLB_STYLES`, and the dresser exported as `libraryKitMesh`. Existing callers build the
  same meshes (kitMesh unchanged in behaviour).
- **Outlines: the building's table is kept**, not the plan's parenthesised figures. The plan's
  `cat-* (0.016)` breaks ART_DIRECTION §2 (small creatures 0.010–0.014; she is 0.35 m), and the
  owl's 0.02 vs the plan's 0.016 are both inside the kid/prop range. The only colour change is the
  plan's: `dragon-wings` → `ART.miniLilac` (the storybook dragon's wings).
- **The render script's regex** reads every `name: { ... colour: PALETTE|ART.key` in
  libraryAssets.ts's TEXT, so no example row may appear in a comment there (one written that way
  would make `library_render.py` assert on `PALETTE.key`). Verified 77 rows before and after, only
  dragon-wings changed.
- **Head and wings hang under `body`** (the CreatureHandle convention "everything above the ground
  lives in body"), so breathing on `body.scale` moves them too; the head turns on `head.rotation.y`.
- **Faced heads and the dragon's belly own their materials** (`libraryKitMesh(name, material)`):
  the cat's parts share one ginger paint, so a face map on the shared paint would have painted her
  face on her tail.
- **Expression maps**: owl surprised→shush, sad/frown→neutral; dragon surprised→puff, sad/frown→
  neutral; cat happy/surprised→happy, everything else→asleep (a blink on a sleeping cat stays asleep).
- **The cat's asleep mouth** is her 'cat' mouth at 0.7 of its width (the plan's "small mouth").
- **`DRAGON_BELLY_REST_GLOW = 0.2`** lives in libraryCreatures.ts (the factory sets it), so the
  plan's LibraryDen rest value has one owner: import it.
- **The harness world is built with no cat bus pending** (`saveFlags.markArrived()` before
  `buildHeadlessPark`). A fresh store makes `World.attachPlayer` seat her in the bus (riding), and
  `Library.requestEnter` rightly refuses a riding child. A `/library` deep link boots with
  `arriveByBus: false`, so this is the world the link builds. Every check-library line before the
  harness is byte-identical with and without (89 lines, `diff` empty).
- **`block-walk` added to the allow-list** for the harness's own red (the plan's list predates the
  harness clause); an allowed mutation that no clause arms fails the run ("ASSERTS NOTHING") rather
  than passing, so the plan's later mutations cannot pass by accident before their clauses land.
- **Step 4 was already built** by the building branch (parsed `library` DeepLink with at/facing,
  `parseLibraryLink`, loud finishLaunch case, `Game.enterLibrarySpawn`, no `/library` stall id,
  `/library-door` kept). Added only the plan's check case and a facing read (`FACING_TOLERANCE`
  0.05 rad), proved red twice. `story=now` is Step 9's.

## For the join (and the tracks)
- **check-book-reader.mts (Step 5's served item 6 goes here):** read the reader after an input
  with `settleTurn(page)` / `nextFrames(page)`, never a bare `waitForTimeout` — the runner's
  frames are slow. The park under the book is hidden after section 1's first screenshot; a new
  `page.goto` (item 6's `/library?at=...`) builds a fresh page with the park drawn, which costs
  most of each frame on CI — hide it again once the item's park-dependent part is done, as
  section 1 does, or measure shard 9 on CI before trusting it. Shard 9 holds only this check.
- **Steps 3-4 are merged.** The forecast held: `git merge-tree` at e7ad82e3 + 88ac6218 had no
  conflicted file, and the real merge at 9e49816b + 88ac6218 had none either. See "The Steps
  3-4 merge".
- **Track A (the owl): march at her with a real mover, not only the flood fill.** The flood
  fill asks `isClearCircle`, which always counted a zero-length wall as solid; the mover did
  not until 773efb7c. OWL's "her middle is not flood-reached" alone would have passed with a
  ghost owl. Add her capsule to MARCHED (a player-sized body walked at her through
  `resolveMovement`), as the plan already says.
- **`libraryArmchairSize()` takes no argument** at the integration (no "big" chair; the story
  chair is the same glb chair). Steps 7 and 9 read `libraryArmchairSize(true).seatCentre`: add
  `seatCentre` to the one-argument-less function (Step 3/7's owner), do not invent a `big`.
- **Cushions are already 0.36 = `KID_HIP_HEIGHT`** (the glb's): Decision 14's cut is a no-op;
  Step 7's constructor assertion still applies.
- **`libraryLines.ts` imports `BOOKS` and `LIBRARY_CARD`.** Both files are outside the park
  source closure today; the first closure file to import `libraryLines.ts` (Library.ts, Step 6)
  brings them in. Step 5's `shelfBooks.ts` brings `BOOKS` in anyway.
- **Words go in `LIBRARY_LINES`/`LIBRARY_CHIPS` only**: check:brevity walks the tables, so a new
  entry is measured with no list to update; a new kind of entry (not a string, list, template or
  table) throws in `libraryCopyForBrevity` until the walk is taught it.
- **`props.box` returns `[body, leftEnd, rightEnd]`; `detach`/`attach` take any list of walls.**
  The leaf (Step 12): `const open = props.box(...); props.detach(open);`. The owl (Step 6):
  `props.wall('the owl', spot, spot, OWL_RADIUS, 'wall')` then `detach([capsule])` /
  `attach([capsule])`. Detached walls stay in `library.solids`: a check that walks `solids`
  must skip the detached set (the plan's open-state swap).
- The plan's SIT red must rotate BOTH legs (`HANDOFF-library-shared.md`, Decisions:
  seatedErrors' one-foot blind spot).
- `/library` is already a parsed `DeepLink` kind (building), so the plan's Step 4 extends
  `parseLibraryLink` (`story=now`) rather than creating it; `/library-door` is a
  `RIDE_DEEP_LINKS` entry. The plan's `/library-den` goes in that table too.
- New deep-link cases go through building's `libraryCheck` in check-deep-links.mts (it waits
  for inside and on the spot).
- A Node script that imports the park (anything reaching `parkManifest.ts`) runs the acceptance
  loop on a hash miss: hydrate `.parks` from CI's artifact for the exact hash, or pin
  `LGP_PARK_RESTART` for scripts whose result cannot depend on the park.
- **Track A (Step 6), the owl's capsule:** `visibleReachXZ(owl.root)` at rest is 0.6548, but her
  live pose reaches 0.6674 (breathing + a ±1 rad head turn). Size OWL_RADIUS over that envelope,
  or accept 1.3 cm of face past her capsule knowingly (the plan's aisle clearance is 3-5 cm).
- **Track C (Step 13):** import `DRAGON_BELLY_REST_GLOW` for the belly's rest glow (do not retype
  0.2); puffs that follow a turned head use `head.localToWorld(mouthInHead.clone())`.
- **Every track:** add clauses after your marker in check-library's WITH A REAL CHILD; arm your
  mutation with `mutating('<name>')` inside the clause it breaks (an unarmed one fails the run);
  leave her standing in the room, not riding. The harness world has no cat bus.
- **Step 9:** `story=now` goes into the building's `parseLibraryLink` (main.ts); new `/library`
  deep-link cases go through `libraryCheck(path, spot, what, facing?)`.
- **Step 14 (ASSET_MANIFEST):** the measured table in "Foundation, second half", the face sets (owl 4, dragon 4, cat 2;
  512 x 412 / 346 / 408), and `dragon-wings` = ART.miniLilac (one dragon with the storybook).
- **Track D (six chapter books) was at 9e49816b when this merge was made**, so its branch has
  none of Steps 3-4: no creatures, no `LIBRARY_GLB_STYLES` export, no harness and no
  `LIBRARY_CHECK_MUTATE` allow-list. When it merges back: the READABLE clause in
  check-library.mts (the building's, around line 948) asserts
  `LIBRARY_READABLE_SLOTS.length === 12`, a typed twelve; D's new slots must make it derive
  from `BOOKS.length` (the brief: every count of books derives from `BOOKS.length`). This merge
  added no typed twelve (every added line grepped: none). `readerAssets.ts`'s
  `createStoryDragon` now takes its colours from `LIBRARY_GLB_STYLES` (one dragon look), so a
  D edit there merges against that.
- **Type-check a check script yourself.** Neither tsc project includes `scripts/` (see "The
  Steps 3-4 merge"), so `tsc` exit 0 says nothing about a clause you add to check-library.mts.
  The instrument over the 14 scripts this branch changed is
  `/Users/jim/dev/landOfGoodPlaces/.claude/library-build-scratch/foundation-checks/tsconfig.scripts.json`
  (absolute paths into this worktree: copy it, replace `worktrees/library-714/` with your
  worktree, and add any script you create). At the foundation head it gives exactly the 56
  errors in `foundation-checks/tsc-scripts.log` (52 environmental, 4 on main's
  check-castle.mts). Diff your run's error lines against that file (line numbers move when you
  edit a file, so compare the messages): any new message is yours.

## Findings outside this task (reported, not changed; from the second half, and 16 Oct)
- **check-reptile-house's PAINTED FACES skips the wrong corner.** It skips parked UVs with
  `u < 0.05 && v < 0.05`, but the kits park at Blender (0.02, 0.02) = glTF (0.020, 0.980) once
  exported: measured on `rr-snake-head`, 0 vertices match its skip and 155 sit at (0.020, 0.980). So
  its slope and nearest-row search include 155 back-face vertices. It still passes; the instrument
  is weaker than it reads. check-library's PAINTED FACES skips `u < 0.05 && v > 0.95`.
- **check:deep-links' reachability probe loads the bare root** (no `?seed=`), so on a source with no
  built parks the dev middleware starts solving a pooled seed in the background (seed 6 and 10
  here). Under `with-dev-server` the process group dies with the server; on a hand-started server,
  killing vite's PID leaves those builds orphaned — I killed mine by PID (5 processes).
- **check-castle.mts carries four type errors on origin/main that no gate sees** (neither tsc
  project includes `scripts/`, and Node strips types without checking them):
  `BUILDING_FLOOR_HEIGHT` and `regionContains` are imported and never read (TS6133, lines 31
  and 43), and `FOOTPRINT_SAMPLES === 1` is compared twice against a `FOOTPRINT_SAMPLES` of
  literal 5 (TS2367, main's lines 233-234; the `=== 1` arm is dead). Measured with the scripts
  instrument on main's own file text (16 Oct). The foundation's hunks in that file (the
  `seatedPose.mts` import) touch none of them. Not changed here.
