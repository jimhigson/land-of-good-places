# HANDOFF — The Library, track B: the story cushions and the library's children (#718; plan Steps 7-8)

Branch `feat/library-714-kids`, cut from the foundation head **bb4eb46f** (`feat/library-714`), worktree
`.claude/worktrees/library-714-kids`. Engineer, Claude Opus 5.5. The plan is
`docs/library-build/PLAN-parts-4-5.md` (Steps 7 and 8, plus its Ground rules, Seams, Numbers and
Decisions); where the orchestrator's task text differs from the plan (branches, handoff names, what
the groundwork already built), the task wins. **Raise no PR**: Jim's ruling is one PR for the whole
Library (#720, head `feat/library`, moved only by the orchestrator at a milestone).

Scratch logs: `/Users/jim/dev/landOfGoodPlaces/.claude/library-build-scratch/kids-step7/` (gitignored).

## Status
- [x] **Step 7 — sitting on the story cushions (the player)**: built, checked, every red proved
      (commits 3d11ff8e, ca741597, 14a0d7a5, 8f684052, 64c00495; this file). Final run at the head's
      own park (seed 5 built for source e599dd8f…): every check exit 0 — see "Checks at the head".
- [ ] Step 8 — the library's three children (the next task on this track)

## Step 7 — what was built
- `src/world/library/layout.ts`: `LIBRARY_PLAYER_SEATS = ['cushion-1', 'cushion-3']`,
  `libraryCushion(id)` (looked up in `LIBRARY_FURNITURE`, throws on a non-cushion),
  `LIBRARY_STORY_CHAIR` (the one `storyChair`, asserted unique), `libraryFacingStoryChair(from)`
  (the one listener's bearing, `Player.facing` degrees). `libraryStandSpots()` gains all five
  cushion centres as `"cushion-N's seat"`, each facing the story chair: keep-outs 64 → 69.
- `src/art/models/libraryAssets.ts`: `libraryArmchairSize().seatCentre`, measured off
  `armchair-seat` alone: **(0, 0.06)** in the chair's frame (the whole chair's plan centre is
  z −0.033). For Step 9's perch.
- `src/world/library/Library.ts`: `assertCushionsAreSeats()` in the constructor (throws, naming the
  fix, unless `libraryCushionSize().top` is `KID_HIP_HEIGHT` to 0.02; it is 0.36000001); one Sit
  zone per player seat while inside (`library-sit:<cushion>`, label 'a story cushion', y floor + 1,
  pick 0.8, stand = the cushion's middle, stand radius 1.6, `selectableWhileRiding`, verb Sit,
  rainbow on the furnished cushion piece); actions: seated here → `get-up` / `LIBRARY_CHIPS.getUp`,
  seated on the other cushion → nothing, else `pressAction(LIBRARY_CHIPS.sit, sit, '🧘')`.
  `sit(id)`: `beginRide` → `setRidePose(cushion, LIBRARY_FLOOR_Y, bearing to the story chair)` →
  `ridePosture = 'listening'`. `standUp()`: a safe no-op unless seated, else `endRide`.
  `update`: while seated, a jump stands her up. `get playerIsSeated`.
- `src/Game.ts`: `onTap`, after the nap, tree and tortoise: `if (world.library.playerIsSeated) {
  world.library.standUp(); return; }`.
- `src/entities/ridePose.ts` (a gap in the groundwork's pose, found by SIT): `applyListeningPose`
  pins `body.position.y = 0` and `body.scale = (1,1,1)`; `RidePoseTarget.body` gains `position.y`
  and `scale` (every caller already passes a real `Group`).
- `scripts/lib/seatedPose.mts` (additive): `seatedErrors` also returns `soleY` (the lowest drawn
  vertex under each hip pivot) and `soles` (the worse of the two against the floor). `floor`,
  `seat`, `lowestY`, `hipY` are unchanged; `SeatedBody` gains `rightLeg`.
- `scripts/check-library.mts`: **SIT**, after track B's marker in WITH A REAL CHILD.
- `check-castle.mts`: nothing to do — it already imports both tolerances from `seatedPose.mts`
  (line 92) and keeps no private copy.

### Verified present in the foundation (read, not assumed)
- `scripts/lib/seatedPose.mts` (groundwork 3422aed0): `SEAT_TOLERANCE` 0.003, `FLOOR_TOLERANCE`
  0.015, `seatedErrors(model, floorY, seatTop)` = lowest visible non-outline vertex (instanced meshes
  expanded) and the `leftLeg` world y; its doc records the one-foot blind spot. `check-castle.mts`
  imports both tolerances and keeps no private copy (no `0.003`/`0.015` literal left).
- `ridePose.ts` `'listening'`: in `RidePosture`; `applyListeningPose` dispatched beside `'dining'`
  before the seated fallthrough; root x 0, **both legs x 0**, body x `DINING_LEAN` (0) and z 0, arms
  `LISTEN_ARM_X` (−0.95) + sin(e·1.3 / e·1.1+1)·0.04 and z ±0.3, head x `LISTEN_CHIN` (−0.08) +
  sin(e·1.3)·0.03, head z 0 — every line of the plan's Step 1 change 3. **The gap** (below): it did
  not pin the body, so the player's breath moved her hips off the seat.
- The cushion is the glb's `cushion-body`: top 0.36000001 = `KID_HIP_HEIGHT` 0.36, so Decision 14's
  re-cut is a no-op (the constructor assertion is still added).
- `libraryArmchairSize()` takes no argument (one chair for all): `seatCentre` goes on it, no `big`.

### SIT (check:library), what it measures
The real child (the WITH A REAL CHILD harness) is stood 2.5 m out from cushion-1, away from the story
chair, at room (0.79, −5.87) (asserted clear floor), and walks onto the cushion on the stick, letting
go a stopping distance short (`PLAYER_MAX_SPEED² / 2·PLAYER_DECELERATION`, 0.805 m). Then:
1. Sit chips exist on exactly `LIBRARY_PLAYER_SEATS` (never a child's cushion).
2. She came to rest on the cushion's soft top (0.05 m from its middle, feet 0.360 m up).
3. Standing there, the zone offers 'Sit down', and she is within its stand radius.
4. Pressing it: riding and posture `'listening'` on all 120 frames of 2 s; 0.00 mm off the
   cushion's centre, root 0.000 mm off the floor; facing the story chair (2.592 rad, 0 rad round).
5. Over the 120 frames (worst kept, NaN-safe): lowest drawn point and each sole within
   `FLOOR_TOLERANCE`; hip within `SEAT_TOLERANCE`.
6. No Read chip while she sits — **self-arming**: armed by either sign the shelves are readable
   (track A's `library.book.*` meshes drawn, or any `library-book:` zone offered while she stands);
   armed, it asserts some chip while standing, none while seated, and one per drawn book when books
   are drawn. Unarmed (this branch), a stderr note says it asserts nothing, on every run.
7. Seated: her zone offers 'Get up' alone and stays `selectableWhileRiding`; the other cushion offers
   nothing; `playerIsSeated`.
8. 'Get up': not riding at once, a player-sized body clear where she stands; she walks off ≥ 1 m in
   0.6 s, back on the floor.
9. Walked back on and sat again, `pressVirtual('jump')` + one frame stands her up, with no hop (feet
   never above the cushion top over the next 30 frames).

## Decisions (with reasons)
1. **No cushion re-cut** (Decision 14 is a no-op): the glb cushion's top is 0.36000001; the constructor
   assertion keeps it that way.
2. **`seatCentre` on the argument-less `libraryArmchairSize()`** (the foundation's note: no `big`).
3. **One owner of the listener's bearing**, `libraryFacingStoryChair` in layout.ts, read by the
   cushions' stand spots and by `sit()`: cushion-1 148.5°, -2 180.0°, -3 211.5°, -4 148.0°,
   -5 212.0° (to the story chair's spot (4, −11.1)).
4. **The other cushion offers nothing while she sits** (the plan says "otherwise Sit"): `sit()` refuses
   a riding child (the hotel's and the castle's guard), so a Sit chip there could only refuse, and a
   chip that refuses teaches a six-year-old that chips lie. A tap anywhere gets her up first anyway.
5. **`standUp()` is a safe no-op unless she is seated** (`Hotel.wakeNap`'s shape), so `Game.onTap`
   calls it unasked. `playerIsSeated` needs the player still riding; a ride something else ended
   clears the seat in `update`, or every later tap would try to stand up a standing child.
   `enterRoom` and `standOutside` call `standUp()` first (a belt: every road in refuses a riding
   child today).
6. **The listening pose pins the body to rest** (found by SIT's first run): `Player.animate` writes the
   idle breath (±0.014 m on `body.position.y`) and the stride's squash (`body.scale`) every frame,
   ride or no ride, and the legs hang from the body — hip 14.0 mm off the cushion, soles 17.5 mm off
   the floor. `NpcCharacter.animate` already resets both before any posture; the pose now does it
   itself, so the player and the children are pinned by one owner. After: hip 0.0 mm, soles 3.5 mm.
7. **`seatedErrors` reads each sole too** (additive): the whole child's lowest point cannot see ONE
   lifted leg (the groundwork's note), so the plan's literal red ("set a leg to −0.7") came out green.
   Now one leg is red on `soles` (44.5 mm) while `floor` still reads 3.5 mm; both legs are red on both.
8. **SIT samples 2 s and keeps the worst**: the pose sways, so one frame could pass by luck of phase.
9. **The stick does not stand her up** (the plan's Decision 39, the nap rule; the hotel breakfast chair
   and the castle banquet do the same). The tortoise ride's 2 Oct ruling ("jumping or trying to walk
   anywhere should jump off") is the other precedent, but a cushion is sat on through a whole story,
   and a six-year-old fidgeting with the stick would be popped up and lose the Story listener card
   (Step 9); the chip, a tap and a jump are deliberate. Lever if QA finds her pushing the stick and
   stuck: one line in `updateSeated`, `|| context.input.moveAmount > 0.22` (the tortoise's threshold).
10. **Iteration runs hydrate the foundation's seed-5 file with `LGP_PARK_FILE`** (the resolver hook's
   own switch: build that file's park whatever the source hash). Every closure edit makes a new hash,
   and a hash miss would start an acceptance loop; the reading room is seed-independent. The final
   runs hydrate seed 5 built for the head's own hash (below), which also proves the edits did not move
   the park.

## Baselines at the foundation (bb4eb46f, seed 5 restart 1 hydrated from `.parks` copied from the library-714 worktree, manifest d283ffaa…)
| check | exit | off the screen |
|---|---|---|
| check:library | 0 | 60 ✓, 0 ✗, "All clauses passed."; 137 solids; keep-outs 64 of 64; 8785 clear cells, no pocket |
| check:tap-spacing | 0 | 10 spaces, 131 zones, 27 portal bands; 231 zone-band and 20 close zone-zone pairs; 20 same-action overlaps (warnings); OK |

## Checks during the step (seed 5 restart 1 via `LGP_PARK_FILE`, the foundation's file, digest 9acd3a626f55d35c)
| check | exit | off the screen |
|---|---|---|
| `pnpm exec tsc --noEmit` | 0 | |
| `pnpm run typecheck:test` | 0 | |
| check:library | 0 | **73 ✓, 0 ✗** (60 + SIT's 13); keep-outs **69 of 69**; 8785 clear cells, no pocket; every line before SIT identical to the baseline but the keep-out count |
| check:tap-spacing | 0 | 10 spaces, **133 zones** (+2 Sit), 27 portal bands; **233 zone-band** (+2: the Sit zones vs the room's exit band) and 20 close zone-zone pairs; 20 same-action overlaps; OK |
| check:castle | 0 | 1662 plate props / 3 floors; 1671 props; 130 contract figures; 13 flames; banquet 117 seated, worst hip 0.0 mm, worst floor 4.7 mm (the groundwork's numbers) |
| check:flat-primitives | 0 | no new flat primitives, no stale baseline entries |
| check:cycle-tdz | 0 | the same 5 sites as the baseline |
| scripts instrument (`kids-step7/tsconfig.scripts.json`, the foundation's pointed at this worktree) | 2, as expected | 56 errors, **the same 56 messages** as the foundation's `tsc-scripts.log` (diff empty). CONTROL: a deliberate `const sitControlBroken: number = seatedErrors;` in check-library → 58 errors, TS2322 naming `SeatedBody`/`SeatedErrors`; reverted |

## Checks at the head (64c00495, park source e599dd8f…; seed 5 built for it, hydrated through its own manifest, no `LGP_PARK_FILE`)
`LGP_SEEDS=5 LGP_RESTART_LANES=4 pnpm run build:parks` at e599dd8f…: exit 0 in 578 s — restart 0
rejected by check:coplanar (260 s), **restart 1 accepted as shipped (134 measures), digest
9acd3a626f55d35c**, the foundation's digest: these edits did not move the park (its control: a
perturbed seed 5 digests d0c1c494079015f4, differs). Logs in `kids-step7/final/`, each exit code the
command's own:

| check | exit | off the screen |
|---|---|---|
| `pnpm exec tsc --noEmit` | 0 | no diagnostics |
| `pnpm run typecheck:test` | 0 | no diagnostics |
| check:library | 0 | **73 ✓, 0 ✗**, "All clauses passed."; seed 5 (restart 1) hydrated; keep-outs 69 of 69; 8785 clear cells, no pocket; SIT worst lowest point 3.5 mm, worst sole 3.5 mm, worst hip 0.0 mm over 120 frames; the Read-chip half's "asserts nothing" note on stderr |
| check:tap-spacing | 0 | 10 spaces, 133 zones, 27 portal bands; 233 zone-band and 20 close zone-zone pairs; 20 same-action overlaps; OK |
| check:castle | 0 | props 1671, plate 1662 on 3 floors; banquet 117 seated, worst hip 0.0 mm, worst floor 4.7 mm |
| `pnpm run build` | 0 | 480 modules, built in 442 ms |

## Red transcripts (each with the geometry it was proved against)
Geometry for all: seed 5 restart 1 (digest 9acd3a626f55d35c), hydrated with `LGP_PARK_FILE`; cushion-1
at room (2.1, −8) = world (−597.9, −608), top 0.360, radius 0.45; she walks on from room (0.79, −5.87)
and sits facing 2.592 rad; 120 seated frames at 1/60 s. Each mutation reverted (`git checkout` or a
saved copy), `git status` clean after.
- **Found, not planted — the pose's breath** (the first SIT run, on 3d11ff8e + the clause, before
  the pose fix): exit 1, 71 ✓ 2 ✗:
  ```
  ✗ her feet on the floor: her lowest drawn point at worst 17.5 mm off it over 120 frames (y 0.0175; 15 mm allowed)
  ✗ her hips on the cushion: her hip pivot at worst 14.0 mm off its top over 120 frames (y 0.3740 against 0.3600; 3 mm allowed)
  ```
- **The plan's red, both legs at −0.7** in `applyListeningPose` (lines 634-635): exit 1, 72 ✓ 1 ✗.
  Before the per-sole measure (ca741597):
  `✗ her feet on the floor: her lowest drawn point at worst 44.5 mm off it over 120 frames (y 0.0445; 15 mm allowed)`.
  After (14a0d7a5):
  `✗ her feet on the floor: her lowest drawn point at worst 44.5 mm off it, and the worse sole 44.5 mm (left y 0.0445, right y 0.0445), over 120 frames (y 0.0445; 15 mm allowed, each)`.
- **One leg (left) at −0.7**: before the per-sole measure, **green** (73 ✓, lowest 3.5 mm — the blind
  spot, measured); after, red, exit 1, 72 ✓ 1 ✗:
  `✗ her feet on the floor: her lowest drawn point at worst 3.5 mm off it, and the worse sole 44.5 mm (left y 0.0445, right y 0.0035), over 120 frames (y 0.0035; 15 mm allowed, each)`.
- By hand, each a separate run (13 s each), each exit 1:
  - no jump handler (`justPressed('jump') && false`): 72 ✓ 1 ✗ —
    `✗ sat down again (true), a press of jump and one frame stand her up (false), with no hop: her feet at most 0.000 m up over the next 30 frames (the cushion's top 0.360)`
  - `standUp` not ending the ride: 70 ✓ 3 ✗ —
    `✗ 'Get up' stands her up (riding true, seated false) ...`, `✗ and walks off it: 0.00 m in 0.6 s ...`, `✗ sat down again (false) ...`
  - the other cushion offering Sit while she sits: 72 ✓ 1 ✗ —
    `✗ library-sit:cushion-3 offers 'Sit down' while she sits on cushion-1 (a chip there could only refuse); playerIsSeated true`
  - `selectableWhileRiding` removed: 72 ✓ 1 ✗ —
    `✗ sitting, library-sit:cushion-1 offers 'Get up' (wanted 'Get up' alone), and stays selectable while she rides: false`
  - seated facing +90°: 72 ✓ 1 ✗ —
    `✗ facing the storyteller's chair: 4.163 rad, the chair's bearing 2.592 (1.5708 rad round)`

- **The constructor's cushion assertion**, the cushion's measured top lowered by 0.14 m to the 0.22 m
  the plan names (the building branch's old primitive) in `assertCushionsAreSeats`: the World build
  throws, exit 1 —
  `Error: Library: the story cushion's top is 0.220 m, but a seat must be KID_HIP_HEIGHT (0.36 m) to within 0.02 m, or a listener's hips sit 140 mm above it: cut library.glb's cushion-body (or createLibraryCushion) to KID_HIP_HEIGHT`
- **The Read-chip half, armed by a scratch monkeypatch** of `library.interactZones` placed just
  before SIT (never committed; the real child, cushion-1, as above): a fake `library-book:fake` chip
  offered seated or not → exit 1,
  `✗ no Read chip while she sits: 1 offered (CONTROL: standing, 1 were, for 0 readable books drawn as 'library.book.*')`;
  the same chip offered only while she is not riding (Step 5's rule) → exit 0, 74 ✓,
  `✓ no Read chip while she sits: 0 offered (CONTROL: standing, 1 were, ...)`.

## Visual QA needed (no browser was owned on this track)
- `/library?at=2.1,-8&facing=150` stands her on cushion 1: press **Sit down** (🧘). Her legs hang
  straight down inside the 0.45 m pouf (root on the floor, hips on its top), so she reads as sitting on
  a big cushion with her feet tucked in — judge that it reads as sitting. Rainbow on the cushion while
  its chip is up; **Get up** while seated; a jump, the chip, or a tap anywhere stands her up (the tap is
  `Game.onTap`, not exercised headless).

## For the join
1. **`Library.interactZones()`** inside returns `this.sitZones()` only; track A adds the owl's Talk and
   the Read zones (Step 5: only while not riding), track C adds Pull, Pet and Say hi. One list.
2. **SIT's Read-chip half arms itself** when Step 5's `library.book.*` meshes or `library-book:` zones
   exist. After merging A, confirm SIT prints `✓ no Read chip while she sits: 0 offered (CONTROL:
   standing, N were, for N readable books drawn as 'library.book.*')` with N = `BOOKS.length`, and
   not the stderr "asserts nothing" note.
3. **`Library.update` order** (the Seams table: story → owl → glow → seated jump): `updateSeated` sits
   right after `if (!player) return;`. Order-independent for the shush (a stand-up is airborne at
   vertical speed 0, never a jump, and the shush ignores a riding child), but place it per the table.
4. **Step 9** reads `library.playerIsSeated` ("seated since before reading began"),
   `libraryArmchairSize().seatCentre` (the perch) and `LIBRARY_STORY_CHAIR`.
5. **Imports**: Library.ts now imports `LIBRARY_CHIPS` (`libraryLines.ts`, which brings `BOOKS` and
   `libraryCard.ts` into the park closure — track A's Step 6 does the same); check-library's imports
   gained names on the constants, libraryAssets and layout lines: union them with the other tracks'.
6. SIT leaves the real child standing on cushion-1, not riding.

## Findings outside this task (reported, not changed)
- **The player's `'dining'` posture at the castle banquet has the same exposure** the listening pose
  had: `Player.animate`'s breath (±0.014 m on `body.position.y`) moves her hips off the 0.36 bench and
  her soles off the floor while she sits at the feast (by the same mechanism; not measured here).
  `check:castle` measures the 117 NPC diners, whom `NpcCharacter.animate` already pins, never the
  player. The fix is the same two lines in `applyDiningPose`, plus a measure of the player at a free
  place.

## Taking over at zero notice
`cd .claude/worktrees/library-714-kids` (or `git worktree add <path> feat/library-714-kids`), then
`pnpm install --frozen-lockfile`; check `pnpm exec node -e "console.log(process.env.npm_config_user_agent)"`
says pnpm/12.1.0. `.parks/` holds seed 5 built for source e599dd8f… (Step 7's head); any closure edit
(almost every `src/` file) makes a new hash, so a World-building check would start an acceptance loop.
While iterating, run checks as `LGP_PARK_FILE=$PWD/.parks/5.json pnpm run check:library` (the
reading room is seed-independent and the file is restart 1, digest 9acd3a626f55d35c); for a final
run, `LGP_SEEDS=5 LGP_RESTART_LANES=4 pnpm run build:parks` (≈10 min; edit nothing in `src/` while it
runs) and run without the switch. A copy of the foundation's seed-5 file is in
`.claude/library-build-scratch/kids-step7/foundation-5.json`. Scratch instruments: the mutation
runner and snippets in the session scratchpad are not needed to resume; every red is reproducible
from the description above.
