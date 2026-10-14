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
- [ ] item 3 seatedPose.mts
- [ ] item 4 NPC seams
- [ ] item 5 chime
- [ ] verify: baselines identical after, full check / test:procgen / build (or CI dispatch)

## Decisions (made here, with reasons)
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

## Measurements
- LISTEN_ARM_X −0.95 on a real CharacterModel (scratch `measure-listen.mts`, not committed),
  25 phases of the sway: hands' lowest non-outline vertices y 0.398–0.418 m (window 0.36–0.61),
  0.239–0.265 m forward of the hip pivot (hip at y 0.360, z 0.000; needs > 0.05). Whole child's
  lowest drawn vertex 0.0035 m (shoe sole). CONTROL (arms hanging, rotation.x 0): hand lowest
  y 0.2797 at z 0.0000 → outside the window, so the instrument can tell them apart.

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
