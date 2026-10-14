# HANDOFF — The Library, integration branch (epic #714: #715-#719)

Branch `feat/library-714` (from `origin/main` d2cdb1f2), worktree
`.claude/worktrees/library-714`. Engineer, Claude Opus 5.5. This file is the integration
branch's own; every source branch's handoff is kept unchanged beside it
(`HANDOFF-library-art.md`, `-building.md`, `-shared.md`, `-books.md`).

**The one Library PR** (Jim's 13 Oct ruling: one PR for the whole Library) is a draft whose head
is a SEPARATE branch, `feat/library`. It moves only at a milestone, by a fast-forward push of
this branch: `git push origin feat/library-714:feat/library`. Every push to a PR head starts a CI
run that re-solves all 16 parks (30-45 min) and cancels the run before it, so work in progress
goes to `feat/library-714` (or a track branch) only. A push to `feat/library-714` runs no CI
(`ci.yml` runs on `pull_request`, on `push` to `main`, and by dispatch).

**PR #720** (draft), head `feat/library` at **8f0cb8c3** (the foundation head, this file's
first commit), base `main`; GitHub links it to all six issues (`closingIssuesReferences`:
714, 715, 716, 717, 718, 719). Its CI run started on opening; nobody waited for it.
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
- [ ] **Foundation, first half** (plan Step 0, Step 1 change 5, Step 2's remainder; Engineer,
      14 Oct; section "Foundation, first half" below). In parallel, Steps 3-4 on
      `feat/library-714-assets` (another engineer; its files are not touched here).
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
- [ ] Next: tracks A (owl, Steps 5-6, `feat/library-714-owl`), B (kids, Steps 7-8,
      `feat/library-714-kids`), C (den, Steps 11-13, `feat/library-714-den`), each cut from the
      foundation head; then Step 9, Step 10's labels/tap spacing, Step 14 and the cross-part
      pieces here after the merges.

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

## For the join (and the tracks)
- **check-book-reader.mts (Step 5's served item 6 goes here):** read the reader after an input
  with `settleTurn(page)` / `nextFrames(page)`, never a bare `waitForTimeout` — the runner's
  frames are slow. The park under the book is hidden after section 1's first screenshot; a new
  `page.goto` (item 6's `/library?at=...`) builds a fresh page with the park drawn, which costs
  most of each frame on CI — hide it again once the item's park-dependent part is done, as
  section 1 does, or measure shard 9 on CI before trusting it. Shard 9 holds only this check.
- **Merging Steps 3-4 (`feat/library-714-assets`) in is clean** (measured 16:23 BST:
  `git merge-tree --write-tree --name-only origin/feat/library-714
  origin/feat/library-714-assets` exit 0 at e7ad82e3 + 88ac6218, no conflicted file). The two
  halves touch disjoint files. The merged tree, checked out in a throwaway worktree (since
  removed), typechecks: `tsc --noEmit` exit 0, `typecheck:test` exit 0.
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
