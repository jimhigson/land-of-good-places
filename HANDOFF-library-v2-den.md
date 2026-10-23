# HANDOFF — Library v2, track C: the secret leaf (plan Step 12) and the dragon and the cat (plan Step 13)

Branch `feat/library-v2-den`, cut from the integration head **33bcc361** (`feat/library-v2`);
worktree `.claude/worktrees/library-v2-den`. Epic #714, part #719. The plan is
`docs/library-build/PLAN-parts-4-5.md` (Steps 12 and 13). Step 11 (the den's walls, the lintel,
the walled pocket) came onto the integration branch from the old den track — its record is
`HANDOFF-library-den.md`, still accurate for what it built. Step 12: Claude Fable 5.1, 22–23 Oct.
Step 13: Claude Opus 5.5, 23 Oct (a restart: the first Step 13 agent left only scratch measures,
nothing committed). Step 14 (links, tap spacing, kids out of the den, docs) is this track's next step
and is **not started**.

Scratch logs: `/Users/jim/dev/landOfGoodPlaces/.claude/library-build-scratch/den12/` (Step 12) and
`…/den13/` (Step 13). Scratch instruments (gitignored, in the worktree so they load its own three.js):
`.claude/scratch/creature-play.mts` (the real child's jumps at the creatures, `WIDE=1` its control).
**Run any scratch script that imports `src/` with `LGP_PARK_FILE=$PWD/.parks/5.json`**: without it a
module load starts the seed-5 acceptance loop for the new source hash (20 minutes) — it did once
here, and was killed by PID.

# Step 13 — the baby dragon and the sleeping cat

## Status (Step 13)
- [x] **6ab48113** `secrets.ts`: `secret.babyDragon` 'Dragon friend' 🐉 'You found the baby dragon in the den!' (its own commit).
- [x] **16eb161a** `layout.ts`: `LIBRARY_CAT_PILE` (9.6, 7.2) facing 45; `LIBRARY_CAT_STAND` (9.6, 8.8) facing 180, in `libraryStandSpots()` (a keep-out).
- [x] **d17a4ee4 / 83de8771 / fd4cda15** `LibraryDen.ts`, `LibraryCat.ts` (new), `props.ts` (`posedFootprint`, `sweep`), `Library.ts` (wiring).
- [x] **3c62d674** `docs/design/LABELS.md`: the creatures' bubble row.
- [x] **d57a9f12 / 9dc39dd9** `check-library.mts`: CREATURES, DEN WALLS sets the creatures' two grid spots apart, mutation `wide-creature-tops`.
- [x] **3014933b** `layout.ts`: `LIBRARY_DRAGON_STAND` moved beside the dragon, (−21.3, −5.0) facing 225 → **(−20.6, −6.3) facing 270** — looked at in headless Chrome, the old spot put her body over the dragon (Decision 15).
- [x] Green: `check:library` **166 ✓, 0 ✗, exit 0** at 3014933b (`den13/green-3.log`; Step 12 left it at 139 — CREATURES is the 27); every red below re-proved at **3014933b** (same counts as at 9dc39dd9) and reverted.
- [x] Looked at in headless Chrome (playwright-core, `channel: 'chrome'`, a throwaway profile; my dev server on 5873, killed by PID, the dev park cache seeded with the hydrated seed 5 for the new source hash): `den13/look-cat.png`, `look-cat-petted.png` (the purr bubble), `look-dragon.png` (the OLD stand: the dragon hidden behind her), `look2-stand.png` (the new stand: side by side, "Oh, a visitor for me!"), `look2-doorway.png` (from the doorway: Say hi! offered); 0 page errors.
- [ ] Step 14 (not this step).

The park source hash at 3014933b is **c86ef951b9f8ead2a0afdb99c4b5f1a21d0ca5008fb7650e2ad7c321ca474ed1**
(every src file here is in the closure). No park was re-solved: `.parks/5.json` is the integration
branch's honest seed 5 (digest d6721090fb3f1d3a), hydrated whatever the hash with `LGP_PARK_FILE`. The
creatures change nothing the park plan reads (`parkManifest.ts` takes the library's footprint from
`layout.ts`'s room figures, untouched); the CI solve belongs to the PR.

## What Step 13 built

**The engine's real shapes, not the plan's blocker.** The plan gave the dragon on its nest one
`'wall'` disc and the cat's pile a `'wall'` box ("nobody jumps onto a dragon or a cat"). `'wall'` tops
are gone (PR #722), so there are **four bodies, each its own shape, each measured off the built
model**, and the narrow-top rule (a top under `FOOT_HALF_WIDTH` either side holds nobody) is what keeps
her off the creatures — physics, no flag, no blocker:

| body (`LibrarySolid.what`) | shape, room-local | top | top width | |
|---|---|---|---|---|
| `the dragon's nest of books` | disc r 0.834 (its drawn reach, ink incl.) at (−22.6, −6.3) | 0.190 (measured) | whole disc | a step |
| `the baby dragon` | box 1.224 × 1.141 at (−22.570, −6.327) facing 45 — over every pose | 1.045 (pad 0.145 + its 0.900) | **0.015** | holds nobody |
| `the cat's pile of books` | box 0.909 × 0.678 at (9.613, 7.213) facing 45 (its drawn plan, ink incl.) | 0.900 | 0.221 | jumpable |
| `the library cat` | box 0.638 × 0.532 at (9.630, 7.227) facing 45 — over every pose | 1.250 (pile + her 0.350) | **0.018** | holds nobody |

**`src/world/library/LibraryDen.ts`** (`class LibraryDen`, seed `0x0b00d1`): the nest and the dragon
(`createLibraryDragonNest`, `createLibraryDragon`, Step 3's Blender creatures) in one group under
`denRoot` at `LIBRARY_DRAGON_NEST`, the dragon at the pad's top. The dragon's box is
`props.posedFootprint` over 81 poses (head turn 9 × nod 3 × tail 3, breath at its widest) — 6–16 ms to
build. Life: breath on `body.scale` (`1 + 0.6b, 1 − b, 1 + 0.6b`, b = 0.03·sin(1.7t + phase), the
owl's shape), blink via `createFaceLife` (resting `'surprised'` = the puff face while puffing, `'happy'`
within `DRAGON_LOOK_RADIUS` 3 m in the den, else `'neutral'`), a tail wag every 5–9 s (±0.25 over 0.8 s),
the head damped to her bearing (clamped ±0.6) with a 0.05 rad nod while she is near. Puff (1.2 s; idle
every 9–14 s, and on meeting and Say hi): belly emissive `DRAGON_BELLY_REST_GLOW` + 1.0·sin(πu), four
`PALETTE.fairyWarm` sprites from the measured mouth (followed through the turned head) — no
`PointLight`. Meeting: the first frame of a visit she is in the den, the leaf open, within
`DRAGON_MEET_RADIUS` 2.2 m of the nest → `discoverSecret('secret.babyDragon')`, firstHello (never met)
or hello, a puff. `sayHi()`: the card (idempotent), the next of `dragon.hi`, a puff; it counts as
meeting. `leave()` (the Library calls it on leaving): the next visit says hello again. Exported:
`DRAGON_ZONE_ID 'library-dragon'`, `DRAGON_SOLID`, `DRAGON_NEST_SOLID`, `DRAGON_FRIEND_SECRET` and every
number above.

**`src/world/library/LibraryCat.ts`** (`class LibraryCat`, seed `0x0b00d3`): the pile and the cat in
one group (`library.catAndPile`, what the rainbow rings) under `roomRoot` at `LIBRARY_CAT_PILE`, the
cat at the pile's measured top. Her box is `posedFootprint` over 45 poses (lift 3 × ears 5 × tail 3,
breath at its widest). Asleep: breath (0.025, rate 1.1 rad/s), tail sway 0.08. `pet()`: ignored within
`PET_GUARD_SECONDS` 0.5; else `PET_SECONDS` 2.2 s — ears ±0.3·sin(5πt/0.6) mirrored for 0.6 s, head
`rotation.x` → `CAT_HEAD_LIFT` −0.25 over 0.3 s, held, eased back over the last 0.6 s, face happy then
asleep, three pink hearts (`SpritePuffs(roomRoot, 6)`), `playPurr()`, the next purr line. Exported:
`CAT_ZONE_ID 'library-cat'`, `CAT_SOLID`, `CAT_PILE_SOLID`, `PET_SECONDS`, `PET_GUARD_SECONDS`, …

**`props.ts`**: `posedFootprint(root, poses, at, facing)` — the box over every visible point (outlines
included) in every pose; `sweep(from, to, count)` — a pose range.

**`Library.ts`**: `den`, `cat`, `creatureBubble` (`SpeechBubble` 'library-creature-says',
`actionFeedback`, `PALETTE.markerLemon`, in `roomRoot`), `lastCreatureLine`; `sayCreature(item, text,
at)` (item = the zone it answers, held `lineSeconds`); `screenLabels = [nameLabel, creatureBubble]`;
zones `library-cat` ('the library cat', pick 0.8, stand `LIBRARY_CAT_STAND` r 1.6, verb Pet, 'Pet the
cat!' 🐈) and `library-dragon` ('the baby dragon', pick 1.0, stand `LIBRARY_DRAGON_STAND` r 2.2, verb
Say hi, 'Say hi!' 🐉, **only once the shelf has landed open**), both with the Read and Pull zones (not
while she rides); `update`: leaf + guard → `updateCreatures` (the cat; the dragon while the den is
drawn; the bubble's hold) → the stacks' fades; `leaveCreatures()` from `standOutside` and
`releasePlayer`. `chime.ts`'s `playPurr` was already there (the shared track's): unchanged.

## The check — CREATURES (`check:library`, 166 ✓ 0 ✗ exit 0 at 3014933b, `den13/green-3.log`)
Counts off the screen:
- DEX: `GUARD's walk into the den at (-21, -5), 2.06 m from the nest (the meeting's 2.2), already met the
  baby dragon` → the entry taken back out (check-side); `CONTROL: 60 frames at the arrival with the leaf
  shut, the baby dragon is not met …, says nothing new, and its Say hi zone is not offered`; `stood beside
  the baby dragon (1.84 m from the nest, inside 2.2), one frame later it is met: Dragon friend discovered
  (count 1), it says 'Oh, a visitor for me!' … and puffs (1); the guard opened the leaf the same frame` (at
  the moved stand: `2.00 m from the nest, inside 2.2`);
  the zone `offers 'Say hi!' …, verb 'Say hi', its stand 0.000 m off the layout's, … the rainbow rings the
  dragon`; `Say hi twice: 'I love my books!', then 'I keep books, not gold!' (its answers, in order), and
  still one discovery (count 1)`; a visit later `'Hello again, friend!'`.
- PUFF: `the belly's warm glow reaches 1.200 within 0.7 s … and is back to 0.200 3 s on`; `warm sprites
  … up to 8 showing at once`; `the first idle puff 10.5 s after the last, 1 in 20 s`; the head `turns 0.500
  rad, to the other -0.500 … 3.61 m away … it looks straight ahead (-0.000)`.
- SOLID: four bodies (disc, box, box, box); the tops line above (`its crest 0.015 m … 0.018 either side
  — … neither holds anybody`); `drawn is solid: the dragon's furthest drawn point over 276 sampled frames
  of its life … is -0.0000 m outside its body; the nest reaches 0.834 m (its disc 0.834); the pile 0.0000
  and the cat -0.0006 m outside theirs (at most 0.002)`; `the fill from the arrival reaches none of their
  middles: 4 of 4 unreached`; marches (deepest step of the way): nest 10 (11 skipped) 0.000; dragon from
  up on the nest 10 −0.004; pile 28 (2 skipped) 0.000; cat from up on the pile 28 −0.001 (allowance 0.071).
- NOBODY STANDS ON A DRAGON OR A CAT: `12 real jumps at it from 16 bearings, from beside it and from a
  sprint (20 starts skipped: in a wall or another solid) — 0 stood her on its top, 0 left her wedged, 0
  left her in the air, 0 ended inside it`; the cat: 30 jumps (2 skipped), 0/0/0/0. Note: `the dragon's
  nest held her 2 frame(s) in 2 of 12 jumps before its dragon pushed her off; the cat's pile 0 frame(s) in
  0 of 30; 0 jump(s) carried her out of the room`.
- CAT: `'library-cat' offers 'Pet the cat!' …, verb 'Pet', … the rainbow rings the cat and her pile`;
  `asleep before (asleep); Pet the cat! counts (1) and within 0.5 s an ear twitches 0.300 rad off its rest
  (over 0.1) and she lifts her face 6.1 cm (over 2)`; `happy at 1.0 s (true) and asleep again by 3 s
  (true)`; `she purrs 'Prrrrr…' … and pink hearts rise (up to 3 at once)`; `a second press 0.2 s in, inside
  her 0.5 s guard, changes nothing`; `her furthest drawn point over 64 sampled frames is -0.0002 m outside
  her body`.
- DEN WALLS: `10 of 12 bodies stood in the den (2 spot(s) under the baby dragon and its nest set apart, at
  most 2: (-23.08, -6.78) (-21.76, -6.78)), 60 marches … 0 ended outside the den and the room` — the first
  run on the creatures (`den13/library-1.log`, 3 ✗) failed exactly there, on those two spots.
- The rest unchanged by the creatures: REACHABILITY 79 solids, `every keep-out in the reading room is
  reachable: 76 of 76` (the cat's stand the new one), `the one pocket is the secret den: 268 clear cells`
  (was 326: the nest and the dragon fill its corner); LANDING `52 tops, 7732 landings … 0 fell through`
  (the nest's 0.19 and the pile's 0.90 among them); SECRET SHELF `zero pockets with the leaf open: 0 clear
  cell(s) unreached of 9032`, `a fill seeded beside the baby dragon reaches the arrival and the way out's
  centre`.

## Reds (each proved at 9dc39dd9 and again at 3014933b — the same counts — seed 5 restart 1, digest d6721090fb3f1d3a, hydrated; by hand ones reverted with `git checkout`)
Geometry: the four bodies in the table above; the dragon's stand (−20.6, −6.3), 2.00 m from the nest
(at 9dc39dd9 it was (−21.3, −5.0), 1.84 m); the cat's stand (9.6, 8.8); the den's inner faces x −23.90,
z −7.60 / −2.00; the real child at 60 fps. Logs at 3014933b: `den13/red3-*.log`; at 9dc39dd9 the names
below.
- **`LIBRARY_CHECK_REMOVE='dragon'`** (the dragon and its nest) → exit 1, **9 FAILED** (161 ✓;
  `red-remove-dragon-2.log`): LANDING `✗ the dragon's nest of books at (-22.60, -6.30): landed at 0.000, its
  top is 0.190` ×4 + `37 fell through`; `✗ … reaches none of their middles: the baby dragon IS reached, the
  dragon's nest IS reached`; `✗ 10 marches at the dragon's nest, from the floor … 1.438 m`; `✗ 10 marches at
  the dragon, up on its nest's top (0.19 m) … 1.167 m`; `✗ nobody stands on the baby dragon: … 4 ended inside
  it; first: a jump from beside it from (-21.10, -6.30): … ended at (-23.28, -6.30)`.
- **`LIBRARY_CHECK_REMOVE='the baby dragon'`** (its nest still there) → exit 1, **3 FAILED** (163 ✓;
  `red-remove-the-baby-dragon-2.log`): the middles (both reached — the nest is a step), the march from up on
  the nest 1.167 m, the jumps (4 ended inside it).
- **`LIBRARY_CHECK_REMOVE='cat'`** (the cat and her pile) → exit 1, **8 FAILED** (162 ✓;
  `red-remove-cat-2.log`): LANDING `✗ the cat's pile of books at (9.06, 7.29): landed at 0.000, its top is
  0.900` ×4 + `169 fell through`; `✗ … the cat's pile IS reached, the library cat IS reached`; `✗ 28 marches at
  the cat's pile, from the floor … 0.959 m`; `✗ 28 marches at the cat, up on her pile's top (0.90 m) … 0.885 m`.
- **`LIBRARY_CHECK_REMOVE='the library cat'`** (her pile still there) → exit 1, **1 FAILED** (165 ✓;
  `red-remove-the-library-cat-2.log`): `✗ 28 marches at the cat, up on her pile's top (0.90 m) … deepest a
  body's edge got into its drawn plan 0.885 m, allowance 0.071`. **Found by this red, not planted:** its
  first run (`red-remove-the-library-cat.log`, at d57a9f12) was **exit 0, 166 ✓** — the marches read only
  where a march ended, and a body that walked straight through the missing cat ended a metre past her, on
  the far side (−0.006 m "outside"). 9dc39dd9 reads the deepest step of the way.
- **`LIBRARY_CHECK_MUTATE=wide-creature-tops`** (both narrow tops made whole, just for the jumps) → exit 1,
  **2 FAILED** (164 ✓; `red-wide-creature-tops-2.log`): `✗ nobody stands on the baby dragon: 12 real jumps …
  9 stood her on its top, … 8 ended inside it; first: a jump from beside it from (-21.10, -6.30): 149 frame(s)
  standing on its top`; `✗ nobody stands on the library cat: 30 real jumps … 12 stood her on its top …;
  first: a jump from beside it from (10.84, 7.20): 4 frame(s) standing on its top`. The control that the
  jump sweep can see a child on a creature (the scratch instrument's own control first: `play-2-wide.log`).
- **By hand, `DRAGON_MEET_RADIUS = 0.5`** → exit 1, **2 FAILED** (163 ✓; `red-byhand-meet-radius.log`):
  `✗ stood beside the baby dragon (2.00 m from the nest, inside 0.5), one frame later it is met: Dragon friend
  discovered (count 0), it says 'null' …` (1.84 m at 9dc39dd9); `✗ a visit later, … it says 'Prrrrr…' (wanted 'Hello again,
  friend!')`. (GUARD's cross-check steps aside, as it must: 2.06 m is outside 0.5.)
- **By hand, `PET_SECONDS = 0`** → exit 1, **2 FAILED** (164 ✓; `red-byhand-pet-seconds.log`): `✗ … within
  0.5 s an ear twitches 0.000 rad off its rest (over 0.1) and she lifts her face 0.1 cm (over 2)`; `✗ she is
  happy at 1.0 s (false) and asleep again by 3 s (true)`.
- **By hand, the dragon's body measured at rest only** (`posedFootprint(this.dragon.root, [], …)`) → exit 1,
  **2 FAILED** (164 ✓; `red-byhand-rest-only.log`): `✗ drawn is solid: the dragon's furthest drawn point over
  276 sampled frames of its life … is 0.0797 m outside its body`; `✗ 10 marches at the dragon, up on its
  nest's top … 0.075 m` — the head turned to her is 8 cm outside a rest-pose box.

## Other checks at 9dc39dd9 (exit codes read; logs `den13/gate-*.log`)
| check | exit | off the screen |
|---|---|---|
| `pnpm exec tsc --noEmit` | 0 | |
| `pnpm run typecheck:test` | 0 | |
| scripts typecheck instrument (`den12/tsconfig.scripts.json`) | 2 | **56 messages, as at Step 12**; the message sets diff empty — none new (the one in check-library.mts is the old environmental `process.exit`) |
| `check:brevity` | 0 | `the secrets — 7 names and 7 lines`; `356 pieces of copy are short enough` |
| `check:tap-spacing` | 0 | 10 spaces, **147 zones** (+1, the cat; the dragon's is open-only), 27 bands, 247 zone-band and 20 close zone-zone pairs, 20 same-action overlaps; OK (re-run at 3014933b: the same) |
| `check:exits` | 0 | the library: 802 exits (795 at Step 12: the cat's stand), 156 off the lattice, 0 with nowhere; the guard fired once on the den band's walk, as at Step 12 (re-run at 3014933b: the same) |
| `check:solids` (core) | 0 | `the library: 13 tops reached, 0 region(s) she can drop into, 732 jumps simulated` (664 at Step 12: the nest's and the pile's tops aimed at, neither reached — the census agrees with the jumps above); `no jump or walk-off of 732 leaves her wedged` (re-run at 3014933b: the same) |
| `check:assets` | 0 | 135 assets check out (the five creatures among them since Step 3) |
| `check:labels` | 0 | `55 labels registered` (the creature bubble among them; scene 5 is the join's) |
| `check:cycle-tdz` | 0 | the same 5 sites as the baseline |
| vitest `test/library`, `test/store/library-card.test.ts` | 0 | 4 files, 20 passed |
| `pnpm run build` | 0 | |
| `check:flat-primitives` | 1 | **the same two pre-existing sites as Step 12**, neither this track's (see Step 12's "Found, not mine"); 845 files, none of mine |

## Decisions (Step 13, with reasons) — Jim is away; each belongs in the PR body too
1. **Four bodies in their own shapes, and the narrow-top rule, instead of the plan's two blockers.** The
   plan's `'wall'` disc and box ("nobody jumps onto a dragon or a cat") need a to-the-ceiling top that no
   longer exists (PR #722), and the track's brief: real shapes plus the narrow-top rule, no flag, no blocker.
   The dragon's and the cat's measured crests (0.015, 0.018 m either side) are under `FOOT_HALF_WIDTH`, so
   nothing stands on them — 42 real jumps, 0 on either, with the control showing the same jumps land on them
   once the tops are whole.
2. **Each creature's body covers it in every pose it is drawn in** (`posedFootprint` over sampled ranges,
   every 0.15 rad of the dragon's head turn — a horn beside the pivot is furthest out part-way round), so
   drawn is solid on every frame, not just at rest: measured live, ≤ 0.6 mm, and 8 cm out with a rest-only box.
3. **The nest's top is its whole disc** (no `topHalf`): the ring of books measures 0.12 m either side, wide
   enough for her feet; the engine's alternative for a disc — a top round its *centre* — would be the pad
   under the dragon. In play the dragon's body keeps her off it anyway (2 frames in 12 jumps).
4. **The dragon's and the cat's bodies stand from the floor, not banded on their seats.** Inside the nest's
   disc and the pile's box the two read the same; but every floor-level query — the fill, `isClearCircle`,
   the lattice — asks a point at her feet, to which a banded body reads as absent, and the dragon's middle
   would have been "reachable".
5. **The creature bubble holds its line `lineSeconds`** (`ui/speechTiming.ts`, the one rule the hotel's and
   the owl's lines follow), not the reptile house's private 1.6 + 0.07·characters the plan names: two
   speakers in one room on two timing rules is the two-definitions bug.
6. **The zone ids live with their creatures** (`DRAGON_ZONE_ID` in `LibraryDen`, `CAT_ZONE_ID` in
   `LibraryCat`), so `check:library` reads them without importing `Library.ts`.
7. **The cat's and the dragon's zones are hidden while she rides**, with the Read and Pull zones (the room
   offers a sitting child nothing to walk to); the plan's "always offered inside" is read as against the
   dragon's "only while the leaf is open".
8. **A visit runs from the park in to the park out**: the dragon's hello is once a visit, reset by
   `LibraryDen.leave()` on `standOutside` and `releasePlayer` — so a link typed from inside the room is not a
   new visit (the owl's rule), and nothing had to change in `enterRoom`. Saying hi counts as meeting it.
9. **The cat's breath at 1.1 rad/s**: the plan's "1.1 Hz" read as the dragon's own formula's rate; a 1.1 Hz
   breath is 66 a minute — a pant, not a sleeping cat.
10. **The head lift is measured at her face** (the head's front-most point: 6.1 cm), where the plan says "the
    head's top": at −0.25 the head's top-most point, an ear tip near the pivot, rises under a centimetre.
    The sign is the model's, read by the check (`faceRise > 0.02`).
11. **DEX's control needed a child who has never met it**: GUARD's walk into the den at (−21, −5), 2.06 m
    from the nest, meets it first (asserted when GUARD's spot is inside the radius), so CREATURES takes the
    entry back out of the store's collection, check-side, before its control.
12. **A new mutation, `wide-creature-tops`**, in the one allow-list: the jump sweep's control (a sweep that
    could not see a child on a creature would pass for ever).
13. **The creature marches read the deepest step of the way** (found by the cat's REMOVE red, above).
14. **Merge-friendly placement**: the cat's layout block sits after the den's, its stand appended after the
    dragon's in `libraryStandSpots`, and the LABELS.md row after the wild bunny's — clear of the lines the
    owl track rewrote; the stale doc lists they share are left for the join (below).
15. **The dragon's stand moved beside it** (Step 11's `LIBRARY_DRAGON_STAND`, (−21.3, −5.0) facing 225 →
    (−20.6, −6.3) facing 270). The camera looks into the room along (−1, −1), and the old spot was straight
    in front of the dragon on that line: in Chrome her body covered the dragon the whole time she said hi
    (`den13/look-dragon.png`), and a tap on the dragon walks her to that spot. Due east of the nest, 2.0 m
    off (inside the 2.2 meeting), clear of the north wall by 0.4 m past its keep-out and of the dragon's
    body by 0.23, the two stand side by side (`look2-stand.png`) and the dragon turns its head to her as far
    as it goes (0.6 rad). The nest is in the den's corner, so no spot to the camera's side of it fits her;
    beside it, to the east, is the nearest to that. A visible change: name it to Jim with the PR.

## For the join (Step 13)
- **Track A (owl)**: `screenLabels` → `[nameLabel, owl.bubble, creatureBubble]`; `interactZones()` merges the
  owl's Talk zone into the not-riding list beside `pullZone` and the creatures; `update` keeps the owl
  before the seat and the creatures after the leaf; the owl's `enter()`/`leave()` sit beside
  `leaveCreatures()` in `standOutside`/`releasePlayer`; both LABELS.md rows stay (move the creatures' under
  the owl's if you like). **Add the cat's stand to the stand-spot doc lists** (`layout.ts`
  `libraryStandSpots`, `props.ts` header, REACHABILITY's keep-out note) — the owl track rewrote those lines.
  The owl's shush in the den (Step 12's item) still stands.
- **Track B (kids)**: KIDS sweeps every leg against the real collision world, which now holds the four
  creature bodies (no kid route passes the cat at (9.6, 7.2) today); `SECRETS` gains 'Story listener' at the
  same place as 'Dragon friend' (both after 'Big reader': a one-hunk conflict, keep both).
- **`check-labels` scene 5**: `visit(cat, true, 3)`, then `world.library.openDenInstantly(); run(1);
  visit(dragon, true, 3)` (`library-cat`, `library-dragon`; the creature bubble is registered already).
- **Step 14**: `/library?at=9.6,8.8&facing=180` lands at `LIBRARY_CAT_STAND`; tap-spacing's open-den snapshot
  takes the dragon zone in; the dragon and the cat are in the open area the put-down rule reads.
  **`LIBRARY_DRAGON_STAND` is (−20.6, −6.3) now** (Decision 15): the plan's preview sentence for
  `/library-den` still stands (it lands at the doorway stand, from where the dragon shows and Say hi! is
  offered — `look2-doorway.png`).

## Questions for Jim (Step 13; no blocker was added)
- **Nothing unkind was found**: in 42 real jumps she never stood on the dragon or the cat. But the cat's
  0.9 m pile and the dragon's nest look climbable and are not — the creature on each pushes her off before
  she lands (the nest held her 2 frames in 12 jumps, the pile never). If you would like her to sit up on
  the books beside the sleeping cat, the pile would have to be a body's width wider than the cat; nothing
  invisible would be needed. Your call.

# Step 12 — the secret leaf (Claude Fable 5.1; unchanged by Step 13 except where noted)

## Status
- [x] Worktree from 33bcc361, `pnpm install --frozen-lockfile` (pnpm/12.1.0, node v26.5.0), pushed.
- [x] **Step 12 src — 40ee7baa**: `secretShelf.ts` (new), `Library.ts`, `furnish.ts`, `props.ts`,
      `shell.ts`, `art/models/libraryAssets.ts` (below).
- [x] **Step 12 check — f0d4b8e2**: `check-library.mts` SECRET SHELF, GUARD, FRESH VISIT; `seal-den`
      and `open-leaf-hollow` armed; LANDING asks only the tops in the world.
- [x] Green: `check:library` **139 ✓, 0 ✗, exit 0** on the honest seed-5 park; every red below proved
      and reverted; `tsc --noEmit` 0, `typecheck:test` 0, `build` 0, `check:tap-spacing` 0,
      `check:exits` 0, `check:solids` (core) 0, the library vitests 20/20.
- [x] Step 13 — after this section was written; see the Step 13 part above. Step 14 not started.

The park source hash at Step 12's head (f0d4b8e2) was **49915bd62ca101f37a9fe5cb4dc21ac22b94f7ce1dd24f99377c22c45610688b**
(every src file here is in the closure). No park was re-solved: `.parks/` holds the integration
branch's honest seed 5 (hash 8644cfac…, digest d6721090fb3f1d3a, copied from
`.claude/worktrees/library-v2/.parks`), and every World-building check was run with
`LGP_PARK_FILE=$PWD/.parks/5.json`, which hydrates that file whatever the hash. The leaf changes
nothing the park plan reads (`parkManifest.ts` takes only the library's footprint figures from
`layout.ts`, untouched), so the park cannot have moved; the full gate and the CI solve belong to
the PR (`feat/library-v2-pr`), as the plan's gate cadence says.

## What Step 12 built

**The leaf (`src/world/library/secretShelf.ts`, `class SecretLeaf`).** A `hinge` Group on the west
wall's inner face at the doorway's south edge, (−17.70, −2.00), turned to the case's facing (90°),
holding a `leaf` Group whose `rotation.y` is the swing angle 0 → +π/2. In it: the leaf model, its
row of books (one `InstancedMesh`, a cloned `libraryBookMaterial`, every matrix carried from the
case-centred frame by (L/2, 0, D/2)), the gold pull book `library.secretBook`, and a twinkle
`Sprite` (`glowTexture(PALETTE.fairyWarm)`, opacity `max(0, sin(2πt/4.5))^8` while shut). Shut, it
stands exactly where an ordinary west case stands (x −17.7..−17.1, z −6..−2); open, it lies along
the den's south wall (x −21.7..−17.7, z −2.6..−2.0), books facing into the den. Both collider
states are `props.box` calls at construction — `bookcase west-2` (the shut footprint, the name every
hook knows) and `the secret shelf, open` — so both footprints are keep-out checked; the open one is
`props.detach`ed at once. `pull()` → the creak (`playSecretDoor`), the book slides 0.12 m out over
0.3 s, then `angle = (π/2)(1 − (1 − u)³)` over 1.6 s; **the shut set holds for the whole swing**;
at u ≥ 1: angle = π/2 exactly, `detach(shut)`, `attach(open)`, `playSecretThunk()`, the book eases
home. `openInstantly()` (silent) and `closeInstantly()`; getters `open`, `swinging`, `angle`. Its
`fader` is a `StackFader` built on the **open** footprint, so it cannot fire while shut.

**The leaf's model (`art/models/libraryAssets.ts`, `createLibrarySecretLeaf()`).** The kit's
`secretShelf-carcass`/`-shelves` (the wall case vertex for vertex, which the four cases beside it
are instanced from), shifted by the carcass's measured bounds so its origin is its **back-left**
vertical edge (x 0..4.00, y 0..3.20, z 0..0.60, the books' front on z = 0.60), baked like a stack
into one body and one outline with **materials of its own** (so it fades without fading the forty
cases). Throws unless its measured bounds are `libraryBookcaseSize('wall')`'s within 5 mm.
`createLibrarySecretBookcase` (the front-left hinge the plan rejected) is gone.

**The furnisher (`furnish.ts`).** The secret case is the one case it neither instances nor makes
solid (the leaf registers both states). Its row is drawn by `shelveFace(…, pullBookGap = true)` —
the pull book's gap on `LIBRARY_SECRET_BOOK`'s shelf, exactly as every readable slot gets one —
**from a fork of the stream** (`new Rng(rng.state)`), and the stream itself is then walked past the
case as for an ordinary case, so no other case's books move (see Decision 4). It hands back
`Furnished.secret = { spec, books }`. New exports: `PlacedBook`, `bookInstances(…, offset?)`,
`bookSpot(kind, shelf, along, bookDepth, proud)` — the one placement for a readable book and the
pull book (clipped so the spine never passes the case's drawn front).

**`Library.ts`.** `secretShelf` built after the furniture, before `assertClear()`. The Pull zone
`library-secret-book` ('the special book', on the gold book where it stands shut, `pickRadius` 0.7
= the readable books', stand `LIBRARY_SECRET_STAND` (−16.1, −4) r 2, verb Pull, rainbow on the gold
book; `pressAction('Pull the book!')` only while shut and not swinging, `[]` otherwise so it is
unselectable; hidden while riding like the Read chips). `updateSecretLeaf` every frame inside: the
leaf's clock, then **the guard** — in the den with the leaf shut and not swinging → `openInstantly`
+ `console.warn` — then `denRoot.visible = angle > 0 || inDen`, then the west wall's fade
(`westWallFader`, the spans and the lintel through their one material, `fadeTowards(inDen ? 0.28 :
1)`); the leaf's fader joins the stacks' sightline loop. `enterRoom(at)`: open iff `at` is in the
den, else shut; `adoptRestoredPlayer`: the same test on the restored position; `standOutside` and
`releasePlayer`: shut. `doorBands()` is `[entry, exit, libraryDenDoorway()]`. Public:
`pullSecretBook()`, `openDenInstantly()`, `requestEnterDen()` (= `requestEnter(LIBRARY_DEN_DOORWAY_STAND)`),
`denOpen`, `secretShelfAngle`, `secretShelf`. `standables` now returns the tops **in the world**.

**`shell.ts`.** `LIBRARY_SECRET_BOOK_ZONE` (one owner for the zone id the band names) and
`libraryDenDoorway()`: the third `PortalBand`, x −18.3..−17.7 (the wall's thickness), z −6..−2.6
(the doorway less the open leaf's depth), yaw π/2, `ownZoneId` the pull zone, fires nothing.

**`props.ts`.** `LibraryStandable.handle`; `detach`/`attach` keep an `away` set; `isPresent(handle)`.

## The check (`check:library`) — 139 ✓, 0 ✗ at f0d4b8e2 (`den12/library-2.log`, exit 0)
The untouched check on the new source first: **101 ✓, 0 ✗** (`library-0.log`), REACHABILITY now
"75 solids registered" (the open set among them), LANDING "50 tops" (the open set not among them).
Then, with the clauses (counts off the screen):
- LANDING: `✓ the secret shelf's shut top is in the world and its open one (registered: true) is not`.
- **SECRET SHELF**: shut to begin with; `the case's middle (-17.40, -4.00) is solid and the open
  footprint's middle (-19.70, -2.30) is bare den floor (a 0.05 m probe is clear there)`; the open
  footprint `x -21.70..-17.70, facing 180, the case's own 4.00 x 0.60`, its back on the den's south
  face z −2.00; the twinkle `peaks at 1.00 and rests at 0.00` over 4.5 s; at (−16.10, −4.00) the zone
  offers 'Pull the book!' 0.00 m from its stand, 0.000 m off the book, the rainbow on the gold book;
  the gold book `0.160 m inside the shut case's drawn box at (-17.26, -4.00), its base at 0.756 m on
  shelf 1 (0.756), painted helmetGold`. Pressed: `the largest frame step 0.0486 rad (the ease-out
  cubic's 0.0491 at most)`; `lands at 1.570796 rad 1.917 s after the press (1.8–2.0)`; `during the
  swing (96 turning frames) the shut case's middle was never clear floor`; `the gold book slid 0.120 m
  out of its row and has eased home (0.0000 m)`. Open: the pull zone offers 0 actions; `the fill
  reaches every keep-out, the den's 2 included: 77 of 77`; `zero pockets: 0 clear cell(s) unreached
  of 9151`; the fill reaches the old middle and not the open leaf's; `a fill seeded beside the baby
  dragon reaches the arrival and the way out's centre (9151 cells)`; `12 marches at the open leaf
  from 16 bearings … (10 starts skipped) deepest 0.000 m, allowance 0.071`; `her feet find the open
  leaf's top (3.20 m) at 169 of 169 landings … and the floor at 49 of 49 points 0.1 m outside it (3
  under another top, left to it)`; `the walls hold with the leaf open: 0 of 48 … (2 ended in the den,
  through its doorway)`; `a walker on the floor passes under the lintel into the den (to x -23.28) and
  a flier at 4.00 m still stops at it (x -17.08)`. SWEEP: CONTROL (the sampled leaf at 0 is the shut
  footprint, at π/2 the open one); `43932 leaf points through 181 angles against 73 solids, the
  deepest any gets into one 0.000 m (bookcase west-3, at (-17.70, -2.00), 0.0°)`; `no keep-out
  outside the den: the nearest the leaf comes to one is 0.100 m short of in front of the secret
  shelf (75 room keep-outs)`; `the front-free corner swings 0.045 m north of the doorway's edge at
  8.5° — through the jamb's drawn edge and 0.044 m into bookcase west-1 at 7.5° (51 leaf points) —
  the plan's accepted clip, up to 0.05`. FADE: `in the den … the west wall fades to 0.28 within 60
  frames`; `just north of the open leaf at (-19.70, -3.52), the leaf hides her and fades to 0.28`;
  CONTROL in the central aisle: wall 1.00, leaf 1.00, no stack fades.
- **GUARD**: in at the arrival, shut, den hidden; `stood in the den at (-21, -5) with the leaf shut,
  one frame later it is open (angle 1.5708), the den drawn, the doorway clear and the open leaf
  solid`; `/library?at=-21,-5 (requestEnter into the den) opens it in the same call, before any
  frame`; a link to the pull stand shuts it again.
- **FRESH VISIT**: pulled open again; `/library-door` outside, `the leaf shut behind her (angle 0)`;
  a real sprint through the front door on the stick `enters at the arrival (0.00, 10.60) with the leaf
  shut and the den hidden`; `the den is sealed again: 2 of 2 den spots unreached from the arrival`.
- HOUSEKEEPING unchanged (the den hidden at the end: the run leaves the leaf shut).

| check | exit | off the screen |
|---|---|---|
| `pnpm exec tsc --noEmit` | 0 | |
| `pnpm run typecheck:test` | 0 | |
| scripts typecheck instrument (`den12/tsconfig.scripts.json`, the den track's re-pointed here) | 2 | **56 messages, the integration handoff's own count**; the one in check-library.mts is the pre-existing environmental `process.exit` on its last line — none new |
| `check:library` (`LGP_PARK_FILE`, seed 5) | 0 | **139 ✓, 0 ✗**, "All clauses passed." |
| `check:tap-spacing` | 0 | 10 spaces, **146 zones** (+1, the Pull zone), 27 portal bands (the den doorway is not in the library block yet — Step 14), 246 zone-band and 20 close zone-zone pairs, 20 same-action overlaps; OK |
| `check:exits` | 0 | 102 exits in 12 spaces, 23 moved (worst 2.25 m); the library: 795 exits, 154 off the lattice, 0 nowhere; the den doorway band walked both ways ("nothing placed her" → skipped, as a band that fires nothing should be); **the guard fired once** during its walk from the den side (`Library: she was in the secret den with the shelf shut — the guard opened it`) — the walk's teleport into the sealed den is exactly the case the guard is for |
| `check:solids` (core) | 0 | the library: 13 tops reached, 0 drop regions, 664 jumps; no roof, no enclosure, nothing wedged |
| `pnpm run build` | 0 | |
| vitest `test/library`, `test/store/library-card.test.ts` | 0 | 4 files, 20 passed |
| `check:flat-primitives` | 1 | **red on the integration head 33bcc361 too, with the same two sites, neither this step's** — see "Found, not mine" |

## Reds (each proved at f0d4b8e2 against seed 5 restart 1, digest d6721090fb3f1d3a, hydrated; the check-side ones need no revert, the by-hand one was reverted with `git checkout`)
Geometry they were proved against: the hinge at (−17.70, −2.00); the shut leaf x −17.7..−17.1,
z −6..−2, top 3.20 (`bookcase west-2`); the open leaf x −21.7..−17.7, z −2.6..−2.0, top 3.20
(`the secret shelf, open`); the doorway z −6..−2 in the wall x −18.3..−17.7; the den's inner faces
x −23.90, z −7.60 / −2.00; the pull stand (−16.10, −4.00); the gold book at (−17.26, −4.00), base
0.756; the real child at 60 fps.
- **`LIBRARY_CHECK_REMOVE='bookcase west-2'`** → exit 1, **16 clause(s) FAILED** (131 ✓;
  `red-remove-west2.log`): REACHABILITY's `✗ inside the secret den's doorway at (-19.60, -4.30) IS
  reachable with the secret shelf shut`, `✗ beside the baby dragon …`, `✗ no keep-out in the secret
  den is reachable …: 0 of 2 sealed off`, `✗ bookcase west-2's middle IS reachable — it is not
  solid`, `✗ the one pocket is the secret den: 0 clear cells are unreached …`; MARCHED `✗ bookcase
  west-2: a body's edge got 0.666 m into it`, `✗ the walls hold: 2 of 48 marches left the room`;
  LINTEL `✗ 202 marches … the furthest west any got is x -23.28 (at 0.00 m)`; LANDING `✗ bookcase
  west-2 at (-17.69, -2.04): landed at 0.000, its top is 3.200` ×4 + `169 fell through`; and the new
  `✗ shut, the case's middle (-17.40, -4.00) is solid …` and `✗ during the swing (96 turning frames)
  the shut case's middle was never clear floor`.
- **`LIBRARY_CHECK_MUTATE=seal-den`** (a wall half 0.3 across x −18, z −6..−2 once the leaf landed)
  → exit 1, **9 clause(s) FAILED** (132 ✓; `red-seal-den.log`): `✗ open: the case's old middle is
  clear floor …`, `✗ inside the secret den's doorway … is not reachable from the arrival with the
  leaf open`, `✗ beside the baby dragon …`, `✗ … every keep-out …: 75 of 77`, `✗ zero pockets with
  the leaf open: 279 clear cell(s) unreached of 9093, e.g. (-23.25, -6.75)`, `✗ the fill reaches the
  case's old middle …`, `✗ a fill seeded beside the baby dragon reaches the arrival … (279 cells)`,
  `✗ the walls hold with the leaf open: … (0 ended in the den …)`, `✗ … a walker on the floor passes
  under the lintel into the den (to x -17.08) …`.
- **`LIBRARY_CHECK_MUTATE=open-leaf-hollow`** (the open collider taken out once it landed) → exit
  1, **3 clause(s) FAILED** (136 ✓; `red-open-leaf-hollow.log`): `✗ open: … the open leaf's middle
  is solid to a 0.05 m probe`, `✗ 12 marches at the open leaf …: deepest a body's edge got into its
  drawn footprint 0.600 m, allowance 0.071`, `✗ her feet find the open leaf's top (3.20 m) at 0 of
  169 landings …`.
- **By hand — the guard deleted** (`Library.updateSecretLeaf`'s `if (inDen && !leaf.open &&
  !leaf.swinging) { leaf.openInstantly(); console.warn(…) }`, 4 lines; reverted) → exit 1,
  **1 clause(s) FAILED** (138 ✓; `red-byhand-no-guard.log`): `✗ stood in the den at (-21, -5) with
  the leaf shut, one frame later it is open (angle 0.0000), the den drawn (true), the doorway clear
  (false) and the open leaf solid (false)`.
- **Found, not planted — the first run of the clauses** (`library-1.log`, exit 1, 136 ✓ 3 ✗) went
  red on three instruments, not on the game: (1) "the open footprint's middle is clear den floor"
  asked with a body-sized probe — the open footprint's middle is 0.3 m off the den's south wall, so
  her body is in that wall whether or not the leaf is there; now a 0.05 m point probe (`POINT_PROBE`);
  (2) the open-leaf landing's control ring found "a top in the air" at 3 of 52 points — the ring's
  hinge-end corner lies in `bookcase west-3`'s top (the case south of the doorway); now left to the
  higher top as LANDING's own control does; (3) SWEEP found 0.044 m into `bookcase west-1` at 7.5°
  — the plan's accepted clip, which lands in west-1's drawn end panel as well as the jamb (Decision
  6); now set apart and bounded by its own clause.

## Found, not mine: `check:flat-primitives` is red on the integration head
`pnpm run check:flat-primitives` exits 1 on this branch **and on 33bcc361 untouched** (run in the
`library-v2` worktree as the control: `den12/flat-integration-head.log`), with the same two
findings, neither in a file this step touches: `src/entities/Player.ts:1828  p.y - this.hoverAt.y`
(the engine's hover rescue, round four) and `src/world/library/reader/pagePictures.ts:286  high -
low` (track D's books2 WIP). My files scan clean (843 files, 0 new findings of mine; `secretShelf.ts`'s
two `rotation.y` lines carry `// flat-ok:`). **The engine branch has already fixed the first**
(`origin/feat/engine-solids` @ 8a48066b compares `altitudeAt(…)` there), so it leaves when the
integration branch merges the engine's head at the next milestone, as `HANDOFF-library-v2.md` plans;
**the second is still on `origin/feat/library-714-books2`** and is track D's line to annotate
(`// flat-ok:` — an object-local y inside a rendered picture's own frame) or move. Not edited here:
both files are other tracks' live work. Shard 1 of CI will be red for the PR until both are in.

## Decisions (with reasons) — Jim is away; each belongs in the PR body too
1. **Both leaf states are one filled box each** (`props.box` → `[BoxCollider]`), the engine's shape;
   `detach`/`attach` take them. The plan's "three capsules" per set predates PR #722.
2. **The leaf is baked from the kit's `secretShelf-*` nodes with materials of its own** (two draw
   calls, like a stack), not drawn with the kit's shared paint: the fader must fade the leaf alone.
   Drawn from the same source as its four neighbours, re-originated on the back-left edge by the
   carcass's measured depth (plan Decision 21), asserted against the wall case within 5 mm.
3. **The pull book is `createShelfBook(ART.helmetGold)`** — the readable books' factory (the kit's
   tallest, thickest block, a paint of its own, a smooth outline) in gold. One book factory; a
   primitive would have been a second. It stands `READABLE_PROUD` (3 cm) proud through `bookSpot`,
   which clips to the case's drawn front; it does not lean (the twinkle and the gold already say
   "this one"). Its base abuts the board (opposite normals) — not a coplanar seam.
4. **The secret row is drawn from a fork of the furnisher's stream, and the stream is walked past
   the case as before.** The plan asked that "no other case's books change", but the gap mechanism
   draws from the stream on every iteration it skips, so a gap added in place would have reshuffled
   every case built after west-2. `new Rng(rng.state)` reads the same numbers; the extra draws stay
   in the fork. Measured: `check:solids` and `check:library`'s book counts are the integration head's.
5. **"Bare floor" is asked with a 0.05 m probe** where the plan says "middle is clear": the open
   footprint's middle is 0.3 m from the den's south wall's inner face, so a body of her size there is
   in the wall whether or not the leaf is, and a body-sized probe cannot say which (it failed the
   first run). The body-sized question is still asked where it can be answered (the case's old
   middle, open) and the fill still works at her radius.
6. **The accepted clip is set apart in SWEEP and bounded by its own clause.** The plan accepts the
   front-free corner clipping "the north jamb's drawn edge by at most 4.5 cm at about 8.5°". Measured:
   0.045 m north of the doorway's edge at 8.5°, and because `bookcase west-1` stands against the wall
   with its end on the doorway's north edge, 0.044 m into west-1's drawn end panel at 7.5° — the same
   corner, for about 0.1 s. The "sweeps no other solid" clause excludes the points north of the
   doorway's edge (51 of 43983) and the clip clause holds that excursion to 0.05, so a longer leaf
   goes red there. Not widened (the plan's reason: a slit beside the shut case would give it away).
   **QA should confirm the clip is invisible** (the plan's own risk line); if Jim wants it gone, the
   leaf would have to be 4.5 cm shorter than its neighbours or hinged 4.5 cm further south.
7. **`Library.standables` returns the tops in the world now** (`props.isPresent`), not every top
   ever registered: the open set is registered at construction (so it is keep-out checked) and
   detached, and LANDING would otherwise have asked the air over the den floor to hold her. The
   shut-state run proves the open top is away; the open-state landing proves it comes back.
8. **The den doorway is a `PortalBand` that fires nothing, third in `doorBands()`** (plan Decision
   36). `check:exits` walks every published band both ways and tolerates one that places nobody; it
   walked this one and, from the den side, its teleport into the sealed den set the guard off — the
   first time the guard fired on real wiring. `check:tap-spacing`'s library block still takes the exit
   band alone; wiring `doorBands().slice(1)` and the open-den snapshot is Step 14's.
9. **`releasePlayer` shuts the leaf too** ("Next day" from the den). The plan names `standOutside`;
   a release ends the visit the same way, and a restore into the den reopens it (`adoptRestoredPlayer`).
10. **The zone id has one owner, `shell.ts`'s `LIBRARY_SECRET_BOOK_ZONE`**: the band names it as its
    own zone and `Library.ts` offers the zone under it, so the two cannot drift.
11. **The hinge stands at `spec.at.x` and `libraryDenGap()`'s south edge**, read from the layout and
    the measured case, never typed; the open footprint's facing is the shut one's + 90°.
12. **The pull zone is hidden while she rides**, like the Read chips (the room offers a sitting child
    nothing to walk to); it is always offered otherwise, and its actions decide (`[]` open or
    swinging) so it is unselectable then (plan Decision 35).
13. **`bookSpot` and `bookInstances(…, offset)` are exported from `furnish.ts`** rather than
    `SPINE_INSET`: one placement function for the readable books and the pull book, one instancer
    for every row; the leaf's frame is the case-centred one shifted by (L/2, 0, D/2).
14. **No new blocker, no new guard of any height.** The one guard is the plan's instant-open rule,
    which removes a blocker (a sealed room) rather than adding one. The jet-pack question in
    `HANDOFF-library-v2.md` is closed: a flier over the west wall lands in the den and the leaf is
    open before her next frame, silently.

## For the join (and for Steps 13–14 on this track)
- **Track A (the owl, Step 6): suppress the shush while `libraryDenContains(player)`** — the plan's
  "the owl cannot see into the hidden room". `Library.ts` has `playerInDen(player)` (private) and
  `layout.ts` exports `libraryDenContains`; the owl's `noticeShush` conditions take it. Not touched
  here: `LibraryOwl.ts` is track A's file.
- **Step 14**: `check-tap-spacing.mts`'s library block → `library.doorBands().slice(1)` plus the
  `'the library, secret shelf open'` snapshot (`openDenInstantly()`, zones + bands, then close);
  `/library-den` in `RIDE_DEEP_LINKS` → `Game.ts` `boardRide` → `world.library.requestEnterDen()`
  (ready); `makeSessionUnsavable()` for den links; KIDS den avoidance; `ASSET_MANIFEST.md` and the
  `library_build.py` docstring (the game hinges the leaf on its back-left edge by the measured depth
  and swings it +π/2 into the den).
- **Step 13** — done at 9dc39dd9 (above): DEN WALLS sets apart the two grid spots under the dragon and
  its nest; the dragon zone is offered only while the shelf is open; `check-labels` scene 5's visits are
  the join's (Step 13's "For the join").
- **The Artist's den kit** (`origin/art/library-v2-den` @ b76a149c: `src/art/assets/libraryDen.glb`,
  `libraryDenGlb.ts`, `art/blend/library_den_build.py`, `pack-library-den-asset.mts`, +84 lines in
  `layout.ts`; its handoff `HANDOFF-art-library-v2-den.md` is filled only to its Step 1) has the
  den's room pieces, a lantern **and a special pull book**. The plan's "a later step on this track
  swaps the primitive den pieces for the Blender den pieces" is where the gold kit book may become the
  Artist's: swap `createShelfBook(ART.helmetGold)` in `SecretLeaf`'s constructor for the kit's node
  and re-measure `bookSpot`'s depth from it. Nothing else here assumes the book's shape.
- **`check:flat-primitives`** (above): one site arrives fixed with the engine merge, one is track D's.
- **`check-exits`' `everyBand()`** spreads `library.doorBands()`, so the den doorway band is walked
  there too — fine today (skipped as "nothing placed her"); if Step 14 ever makes it fire, check-exits
  will judge the put-down like any door's.
- The first clause of SIT's "no Read chip while she sits" counts drawn `library.book.*` meshes; the
  gold book is `library.secretBook`, so it is not counted — as intended.

## Questions for Jim (none new; decide when you are back)
- The accepted 4.5 cm, 0.1 s clip of the swinging leaf's far corner through the north jamb's edge
  and west-1's end panel (Decision 6) — QA judges it invisible or you ask for a shorter leaf.
- The den is still reachable by a jet pack over the west wall (real tops, 5.2 m; the pack flies
  12 m): now she lands in the den with the leaf **open**, by the guard, and walks out through the
  doorway. No blocker was added. If you would rather the den stayed a secret from fliers too, that is
  a banded ceiling over it — an invisible blocker, your call.

## Taking over at zero notice
`cd .claude/worktrees/library-v2-den` (branch `feat/library-v2-den`), `pnpm install --frozen-lockfile`,
`pnpm exec node -e "console.log(process.env.npm_config_user_agent)"` → pnpm/12.1.0. `.parks/5.json`
is the integration branch's honest seed 5; every World-building check here is
`LGP_PARK_FILE=$PWD/.parks/5.json pnpm run check:library` (and `check:tap-spacing`, `check:exits`,
`check:solids`). Every red above is reproducible from its mutation name; the by-hand one is the four
guard lines in `Library.updateSecretLeaf`. The worktree was clean and pushed at every commit.
