# HANDOFF — The Library, shared slice of parts 4+5 (epic #714; #718, #719)

Branch `feat/library-714-shared` (from `origin/main` d2cdb1f2), worktree
`.claude/worktrees/library-shared`. Engineer, Claude Opus 5.5. **Raise no PR** — Jim's 13 Oct
ruling is one PR for the whole Library, raised by the orchestrator at the end.

Plan: `library-plan-parts-4-5.md` in the orchestrator's scratchpad (Ground rules, Seams, Numbers,
Decisions, Steps 1, 2, 7, 8, 13). This branch builds only the slice that touches code OUTSIDE
`src/world/library/`, plus the one new file `src/world/library/libraryCard.ts`, so it merges into
the integration branch later without conflicts.

## Scope (from the task)
1. Step 1 changes 1, 2, 3, 4, 6, 7 — speechTiming.ts, Player.isRunning, ridePose 'listening',
   Collision.restoreWall + JUMP_CLEARANCE_GRACE export, spritePuffs.ts, measure.visibleReachXZ.
   NOT change 5 (props.ts / layout.ts are on the building branch).
2. Step 2 state slice — types.ts 'card', store.grantKeepsakeOnce, libraryCard.ts, vitest.
   NOT libraryLines.ts, NOT the brevity loop (need BOOKS from the books branch).
3. Step 7 — scripts/lib/seatedPose.mts (tolerances lifted out of check-castle + seatedErrors).
4. Step 8 NPC seams — residentLooks.ts, NpcSystem (PLAYER_SEPARATION export, driver, riding/seated
   separation), NpcCharacter (seated state, posture animate, separateFrom).
5. Step 13 — chime.ts playSecretDoor, playSecretThunk, playPurr.

## Status
- [x] baselines on untouched d2cdb1f2 — all 12 exit 0 (summary below; full logs in the
      orchestrator scratchpad `library-shared/baseline/*.log`)
- [x] item 1 (Step 1: 1 speechTiming, 2 isRunning, 3 listening pose, 4 restoreWall/grace, 6 SpritePuffs,
      7 visibleReachXZ) — commits adaf22a7, 51b0f209, 2d7648c0, 79e146a0, 9add470b, 03864ff6
- [x] item 2 (Step 2 state slice) — 6913a4b0 (types+store), a90b50af (libraryCard + vitest + shard)
- [x] item 3 seatedPose.mts — 3422aed0
- [x] item 4 NPC seams — c6aa1c3d (residentLooks + HotelGuests), aa6d3a1f (NpcSystem + NpcCharacter)
- [x] item 5 chime — fad0e9f6
- [x] tsc --noEmit 0, typecheck:test 0, vitest library-card 4/4, check:seed-coverage 0
      ("45 suite files over 6 shards (5/5/5/8/8/14 files), each exactly once"), build 0 (no parks
      shipped locally: .parks was being rebuilt)
- [x] CI run **38550516901** on fad0e9f6 (`gh workflow run ci.yml --ref feat/library-714-shared`):
      **conclusion success — 72 jobs success, 2 skipped (Deploy, PR preview: not main, no PR)**.
      Every job: Parks key / from another run / still to find / Parks, all 32+ "Park N block M",
      Checks shards 1-8 + Checks build + `Checks`, Procgen invariants shards 1-6 + `Procgen
      invariants`, Coplanar faces, Swept bus, Walk reach, Entrance road, Every seed builds — all
      success. Its `parks-a51ca115…` artifact: **all 16 seeds have the same accepted restarts and
      the same park digests as main's manifest** (e272e0c0…) — no park moved.
- [x] local `LGP_SEEDS=5 LGP_RESTART_LANES=4 pnpm run build:parks` at source `a51ca115291f…` →
      exit 0 in 852 s: restarts 0, 1 rejected by build, 2 by the paved-detour measure, **3 accepted
      as shipped (133 measures)**, digest **ea17dc22afe69179 — byte-for-byte main's seed 5 digest**
      (main's manifest at e272e0c0…: `'5': 'ea17dc22afe69179'`). Same restart history as main's
      acceptance. The refactors did not move the park.
- [x] the 12 baselines again (same .parks-hydrated seed 5 restart 3): **all exit 0, and all twelve
      logs are byte-identical to the baseline logs** (`cmp` on the whole files, noise lines
      included: castle 72 → 72, slide-rider 144 → 144). Identical counts, identical numbers.
- [x] the riding/seated separation rules exercised on the real park (scratch
      `exercise-separation.mts`, private `separateFromPlayer` called directly, the pair isolated):
      gap 0.5 m (overlap 1.020, cap 0.0500): CONTROL both move 0.0500; riding → child 0.0500,
      player never nudged; seated → child 0, player 0.0500; both → neither. Gap
      PLAYER_SEPARATION−0.04 (whole 0.04 < cap): CONTROL each side 0.0200; riding → child 0.0400;
      seated → player 0.0400. `ResidentSpec.driver` (scratch `exercise-driver.mts`, a second
      NpcSystem on the real park): factory called once, its driver drives the body, handed the
      resident's own fresh stream (first draw 0.088039 = `new Rng(0x0b00c5).unit()`); a resident
      without one still gets a WaypointDriver.
- [x] first local `pnpm run check` (fad0e9f6-equivalent, seed 5 parks): shards 1-4 green, then
      **exit 1 at shard 5's check:served-deep-links**: `/reptile-house?at=-13,0&facing=90
      (continueGame)` "asked to stand at hall (-13, 0) = world (587, -600), but the player is at
      (606.0, -584.2) — 24.7 m off". Reproduced on a rerun, **and on an untouched origin/main
      control worktree** (`.claude/worktrees/library-shared-control`, d2cdb1f2, main's own parks
      from library-art): same line, exit 1. So not this branch. Root cause (diagnosed on the
      control with a scratch read before and 3 s after): the check read her while the link's change
      of space was still running (`changing: true`, on the restored save's arrival spot); 3 s later
      `changing: false` and she stood on (587, −600). **Already fixed on art/library-715 as
      69dfa5df** (feat/library-building-716 carries it through its merge of art, 30472958);
      brought in here byte-for-byte as **4a39b06c** (same patch-id, 0c7b450e), so art and
      building see the same hunk on both sides (trial merges: clean). **Books fixed the same race
      differently afterwards (9083ecd4, 13:35), which conflicts — see "Merge forecast".**
      check-deep-links.mts is outside the park source closure, so the park hash and CI's parks
      are unchanged. Rerun after the fix: check:served-deep-links exit 0, all 12 lines OK.
- [x] second local `pnpm run check` (with 4a39b06c): **exit 0 after 1734 s**, all 8 shards.
- [x] `pnpm run build` with CI's 16 parks in `.parks`: exit 0, 16 files in dist/parks.
- [x] `pnpm run test:procgen` locally with CI's 16 parks: **exit 0 after 343 s — Test Files 45
      passed (45), Tests 2131 passed (2131)**, no skips; every seed's restart read from the
      manifest (0:0 1:1 2:7 3:8 4:0 5:3 6:5 7:1 8:1 9:0 10:0 11:0 12:2 13:0 14:0 15:0).
- [x] CI again on the final code head **0476c9fd** (includes 4a39b06c): run **38560794408**,
      **conclusion success — 23 success, 7 skipped**. Skipped = the five park-search jobs (this
      source's parks were already cached by 38550516901, "Parks key" found them) plus Deploy and
      PR preview. Checks shards 1-8 + Checks build + `Checks`, Procgen invariants shards 1-6 +
      `Procgen invariants`, Coplanar faces, Swept bus, Walk reach, Entrance road, Every seed
      builds: all success. Commits after 0476c9fd touch this handoff only.

## DONE — handed back
All five items built, verified and pushed; no PR raised (the orchestrator raises the single
Library PR). The worktree is removed at handback; recreate it with
`git worktree add .claude/worktrees/library-shared feat/library-714-shared`.

## For whoever integrates this (and builds Steps 3-14 on it)
- **What this branch gives the library:** `lineSeconds` (ui/speechTiming), `Player.isRunning`,
  `'listening'` + `applyListeningPose`, `CollisionWorld.restoreWall` + `JUMP_CLEARANCE_GRACE`,
  `SpritePuffs`, `visibleReachXZ`, `'card'` kind/category + `gameStore.grantKeepsakeOnce` +
  `world/library/libraryCard.ts` (+ its vitest in procgen shard 6), `scripts/lib/seatedPose.mts`
  (`FLOOR_TOLERANCE`, `SEAT_TOLERANCE`, `seatedErrors`), `entities/npc/residentLooks.ts`,
  `PLAYER_SEPARATION` export, `ResidentSpec.driver`, the furniture separation rules,
  `NpcCharacter.beginSeated/endSeated/seated`, `playSecretDoor/playSecretThunk/playPurr`.
- **Not done here, by the task's scope:** Step 1 change 5 (props.ts `box` returning walls,
  `attach`/`detach`, `den?` on KeepOut/StandSpot — the building branch owns those files), Step 2's
  `libraryLines.ts` and the brevity loop (they need `BOOKS` from the books branch), and everything
  in Steps 3-14 that lives in `src/world/library/` or the checks.
- **Merge conflicts to expect:** `src/state/types.ts` always; `scripts/check-deep-links.mts` too
  if this branch is merged after books with books' fix kept. Merge this branch **before** books
  and its own merge is clean. Measured table and both resolutions under "Merge forecast".
- **The SIT red must rotate both legs** (see Decisions: seatedErrors' one-foot blind spot).
- Scratch instruments (not committed), in the orchestrator scratchpad `library-shared/`:
  `measure-listen.mts`, `exercise-seated.mts`, `exercise-seams.mts`, `exercise-separation.mts`,
  `exercise-driver.mts`, `compare.sh`, `run-checks.sh`; logs under `baseline/` and `after/`.

## Taking over at zero notice
`cd .claude/worktrees/library-shared` (or `git worktree add <path> feat/library-714-shared`),
`fnm use --install-if-missing`, `pnpm install --frozen-lockfile`. Parks for this source
(a51ca115…): `gh run download 38550516901 --name parks-a51ca115291f87d7505e1563f745a7410e4551c4fcfeb3867325ec1aba0febfc --dir .parks`
— any closure edit changes the hash and needs `LGP_SEEDS=5 pnpm run build:parks` (≈15 min) or CI.

## Merge forecast (re-measured 14 Oct, review round 1; `merge-tree` + `commit-tree`, no refs touched)
Measured at art f54f21c0, building 6ae408d3, books 9083ecd4, this branch b4d1c06b (its later
commits touch this file only). The tips are still moving, so re-run before merging:
`git merge-tree --write-tree --name-only <integration> origin/feat/library-714-shared`, or the
whole table with `library-shared-fixer/forecast.sh <worktree>` in the orchestrator scratchpad.

**What changed.** Books fixed the deep-links race itself (9083ecd4: wait until
`spaces.isChanging === false`). That hunk covers the same lines as 69dfa5df (wait for inside
*and* on the spot), which art, building and this branch all carry. So **building + books now
conflict on their own**, in `scripts/check-deep-links.mts` and `src/main.ts`, with or without this
branch. The old "building + books: clean" line was stale.

| merge order (art is inside building, so art then building is a fast-forward) | conflicts |
|---|---|
| this branch alone, against art / against building | none / none |
| this branch alone, against books | check-deep-links.mts, types.ts |
| **B (recommended):** building, **this branch**, then books | this branch: none; books: check-deep-links.mts, main.ts, types.ts |
| A: building, books keeping building's 69dfa5df hunk, then this branch | this branch: types.ts |
| A: building, books keeping books' 9083ecd4 hunk (or any blend), then this branch | this branch: check-deep-links.mts, types.ts |

- **`src/state/types.ts`**, tail of `CUTE_CATEGORIES` (both append after `'keychain'`). The shared
  `/**` line sits *above* the conflict markers, so the second block needs its own opener. Keep
  both blocks, books' first:
  `'keychain', /** …#717 book doc… */ 'book', /** …#718 card doc… */ 'card', ] as const;`.
- **`scripts/check-deep-links.mts`**, when it conflicts on this branch's merge: **take the
  integration's copy** (`git checkout --ours scripts/check-deep-links.mts`). This branch's only
  change to the file is the 69dfa5df hunk, so nothing of its own is lost. Measured: merged blob
  131a5172 = the integration's blob 131a5172. Which fix the integration keeps is the integrator's
  call. Building's `libraryCheck` entries in the same file already wait the 69dfa5df way.
- `test/procgenShards.ts` auto-merges (this branch inserts before live-look; books appends at the
  end). `src/main.ts` conflicts between building and books only; this branch does not touch it.

## Decisions (made here, with reasons)
- **4a39b06c stays (review round 1).** Dropping it would put main's race back on this branch:
  without it check:served-deep-links went red on every local run at seed 5 (twice here, once on
  an untouched origin/main control) and passed on CI only by frame timing. That is flaky, and
  flaky counts as failing. Dropping it also means rewriting pushed history. Swapping it for books' 9083ecd4 would only move the conflict onto art and
  building, which carry 69dfa5df. Keeping it costs at most one hunk at merge time, settled by
  taking the integration's copy, which loses nothing of this branch's.
- **isRunning guard placement.** The plan says spawnRunningDust "starts with
  `if (!this.isRunning) return;`". It replaces the old guard line *in place*, after the
  `previousWalkPhase` bookkeeping — moving it above would stop the phase following her on
  walking frames and drop a spurious puff on the first sprint frame (a behaviour change in a
  refactor). The method's `planarSpeed` parameter goes (the getter re-measures it identically).
- **restoreWall also folds the wall back into `thinnestHalfWidth`** (as addWall does). After a
  `clear()` the running minimum restarts; a restored wall must still sub-step the mover.
- **'card' in CUTE_CATEGORIES is appended after 'keychain'** — 'book' does not exist on main
  (it comes with feat/library-books-717, which also appends after 'keychain'). **Merging the
  books branch will conflict in that one array**: resolve as `'keychain', 'book', 'card'` (both
  doc blocks kept) — the plan's order. Everything else here is conflict-free by construction.
- **Shard registration:** `test/store/save-flags-round-trip.test.ts` already exists on main, in
  shard **6** (with live-look, overlay-pause, save-migration-ripika). The new test is in shard 6,
  inserted alphabetically before live-look — not at the shard's end, where the books branch
  appends `test/library/pageCurl.test.ts`, so that merge is clean.
- **Case 1 asserts the card's kind/category are members of INVENTORY_KINDS/CUTE_CATEGORIES.**
  Without that, deleting 'card' from INVENTORY_KINDS could not turn case 1 red (the grant never
  consults the list at runtime). With it, exactly cases 1 and 2 go red and 3, 4 stay green.
- **LISTEN_ARM_X stays −0.95** — measured in the window (below).
- **"The whole capped push" = the whole correction.** `circleSeparation` returns half the
  overlap per side; when one side is furniture (riding player, seated child) the other moves by
  both halves (`2 × push`), capped at the same `MAX_DEPENETRATION_SPEED·dt`. Same idea as
  `NpcCharacter.pushAway` for scripted children ("the free one takes the *whole* correction").
- **`animate` passes `elapsed + seatedPhase` for every posture** (as the plan says). For a
  carried child ('seated') it changes nothing: the seated pose reads `elapsed` only under
  `climbWave > 0`, which NPCs never pass.
- **seatedErrors' blind spot, measured and documented in its doc comment:** it takes the lowest
  vertex of the whole child, so ONE leg lifted reads the same. On a CharacterModel posed
  'listening' at y 3.0, seat 3.36: as built floor 3.5 mm / seat 0.0 mm; left leg −0.7 → floor
  3.5 mm (PASSES); both legs −0.7 → floor 44.5 mm (fails); fairground 'seated' → floor 0.9 mm,
  seat 16.1 mm (fails on the hip, its 0.3 rad lean lowers the pivot). **For the integration
  engineer: the plan's SIT red ("set a leg to −0.7") must rotate BOTH legs**, or it will come
  out green and look like a dead check.

## Measurements
- LISTEN_ARM_X −0.95 on a real CharacterModel (scratch `measure-listen.mts`, not committed),
  25 phases of the sway: hands' lowest non-outline vertices y 0.398–0.418 m (window 0.36–0.61),
  0.239–0.265 m forward of the hip pivot (hip at y 0.360, z 0.000; needs > 0.05). Whole child's
  lowest drawn vertex 0.0035 m (shoe sole). CONTROL (arms hanging, rotation.x 0): hand lowest
  y 0.2797 at z 0.0000 → outside the window, so the instrument can tell them apart.

- **Behaviour of the new seams, exercised directly** (scratch `exercise-seams.mts`, not committed;
  run with `LGP_PARK_RESTART=3` so importing CollisionWorld never starts an acceptance loop):
  SpritePuffs vs main's HeartPuffs (copied verbatim from origin/main) over 40 frames with the
  same seeded Rng → worst difference 0, both streams left at the same point; restoreWall →
  probe z 0.800 blocked / 0.100 free after removeWall / 0.800 again, colliders 1→1, revision
  1→2→3 and unchanged on a second restore, owner 'library' kept; a seated NpcCharacter whose
  driver says "walk" stays exactly at (5, 0, 5) for 120 frames, legs 0/0, arm −0.964, facing
  1.2; separateFrom: sitter moved 0, walker stepped 1.200 m; two sitters 0.3 m apart both left
  alone; after endSeated she walks off (x 7.39) with the walk cycle back. CONTROLS: the same
  driver walks an unseated child to x 9.94; two unseated children each move 0.600 m.

## Red proofs
- **vitest library-card, `'card'` deleted from INVENTORY_KINDS** (src/state/types.ts, the
  `'card',` line under its doc block), `pnpm exec vitest run test/store/library-card.test.ts`
  → exit 1, `Tests  2 failed | 2 passed (4)`:
  ```
  × is granted once, however often the owl is asked, and keeps the day she first got it
  × survives writeSave and loadSave, item and Cute-o-dex entry both
  AssertionError: 'card' is not an inventory kind the save knows: expected [ 'toy', 'balloon', 'treat', …(7) ] to include 'card'
  AssertionError: the card was dropped on load: expected [] to have a length of 1 but got +0
  ```
  Input: the test's own fixtures (a fresh store; LIBRARY_CARD granted at day 0 / 0.3, then at
  day 2 / 0.75). Reverted with `git checkout src/state/types.ts`; green again: 4 passed.
- tsc control: a deliberate `const broken: number = 'not a number'` → TS2322, exit 2; reverted.

## Environment notes
- Node: `fnm use --install-if-missing` -> v26.5.0; pnpm reports `pnpm/12.1.0`.
- Baseline parks: `.parks/` copied (read-only) from the library-art worktree; its manifest
  sourceHash `e272e0c0…` equals this base's `parkSourceHash`, so every baseline check hydrated the
  shipped park instead of solving. Any closure edit changes the hash, so post-edit runs need a
  fresh `LGP_SEEDS=5 pnpm run build:parks` (or CI).

## Baselines (untouched d2cdb1f2, `.parks` hydrated, seed 5 restart 3) — exit codes and counts
| check | exit | key counts off the screen |
|---|---|---|
| check:assets | 0 | 130 assets, 47 creatures (32 posed), 28 recorded drift (worst balloon.corgi +0.077 m) |
| check:hotel | 0 | 31 children (7 residents), lowest foot −14.91 m after 8 s; 13 props solid, 3 beds soft; 41/41 panes; 3685 lobby spots; 230 doorway marches 0 short; 3893 furniture-wall pairs 0 embedded 9 grazed; 128 portal walk-throughs 0 never arrived; "check:hotel OK" |
| check:reptile-house | 0 | "All clauses passed."; 286 solids; 75/75 keep-outs; 10242 cells; 879 stations 0 blocked; 808 marches 0 inside; 21 zones inside; 68 tall drawn solids 0 uncollided; 34 animals 0 outside |
| check:climb-wave | 0 | 49 trees all 100.0%; legibility 18 px hand / 468 head; rock 6.6 px; aim 0.00° worst / 7.52° max; body 20 px; "check:climb-wave OK" |
| check:castle | 0 | 1662 plate props / 3 floors; 1671 props measured; 130 contract figures; 13 flames; banquet 117 children seated, worst hip 0.0 mm, worst floor 4.7 mm |
| check:rail-race | 0 | loop 628.1 m, 4 lanes; plays well 24/24, sloppy 24/24, child pace 12/24, badly 0/24; "rail race: OK" |
| check:slide-rider | 0 | 711 frames ridden, 6 beats, 355 chase / 356 trackside, nearest 0.017 m, 0 of 711 inside |
| check:npc-separation | 0 | Wren/Quinn closest 1.800 m; correction on 853 of 900 frames, worst 0.042 m |
| check:npc-perch | 0 | 24 children, 49 trees × 4; heads −0.059..0.016; drawn 1.07 m at worst of 196 climbs |
| check:npc-presence | 0 | 31 NPCs, 18000 frames; crossings 13 in / 10 out; 0 movement elsewhere; 0 disagreements |
| check:cat-bus | 0 | 11 under the arch, 6313 child-frames untouched; 12 seated; 21455 instances; closest two 1.71 m; speed 2.51–2.71; 31 children 30 s later |
| check:jitter | 0 | 31 children, 9000 frames; worst own step 0.171 m (Cleo); worst speed 4.983 m/s (Luca) |
