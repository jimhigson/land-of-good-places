# HANDOFF — Library v2 on the engine: the integration branch (`feat/library-v2`)

Engineer, Claude Fable 5.1, 22 Oct 2026. Epic #714; this branch finishes #718 (the owl
librarian, story time) and #719 (the secret den, the dragon, the cat) and adds the six chapter
books, all on top of the engine rework (PR #722, `feat/engine-solids`). Worktree
`.claude/worktrees/library-v2`; scratch logs `.claude/library-build-scratch/wf/`. The plan is
`docs/library-build/PLAN-parts-4-5.md`; the old track handoffs (`HANDOFF-library-owl.md`,
`-kids.md`, `-den.md`, `-books2.md`) are on this branch too and still describe what each track
built.

## Branches and the PR

**Current state (23 Oct, part-4 restart — see "Restart: the part-4 milestone" at the end):** PR #722 is merged
(main 6d70f695). **PR #733 is part 4** (#718), base `main`, head `feat/library-v2-pr`, moved only by a fast-forward
push from this branch. **Part 5** (#719 and the chapter books) is built by other engineers on `feat/library-v2b`,
stacked on #733.

| branch | what |
|---|---|
| **`feat/library-v2`** | this integration branch: part 4 (the owl, the card, the recommendation, the shush, the children, the cushions, story time) on main, plus the den's hidden walls (Step 11) and the chapter books' engineering base |
| `feat/library-v2-pr` | PR #733's head; `git push origin feat/library-v2:feat/library-v2-pr` (a fast-forward, never force) |
| `feat/library-v2b` | part 5 (other engineers), stacked on #733 |
| `feat/engine-solids` / `-pr` | the engine, merged (#722) |

The history below (rounds, merges, tracks) is kept as it was written.

## What was merged, in order (each `git -c rerere.enabled=false merge --no-ff`)

| merge | commit | conflicts, and how each was resolved |
|---|---|---|
| A, `feat/library-714-owl` @ 272751d6 | 0dd55bcd | none (its only commit past main is its handoff) |
| B, `feat/library-714-kids` @ a418e0ba | c73fa1c8 | `Library.ts`: imports unioned; both constant blocks kept; `interactZones()` returns ONE list — the Read zones (hidden while she rides, Step 5's rule) and the Sit zones (always on); `standUp()` kept. The auto-merge had doubled the `LIBRARY_CHIPS` import — one kept. `check-library.mts`: the two `constants.ts` import lines unioned (`standingAt`/`walkableAt` from the engine, `PLAYER_DECELERATION`/`PLAYER_MAX_SPEED` from kids). |
| C, `feat/library-714-den` @ 56ed58d8 | fb19ccc1 | `shell.ts`: imports unioned (`type LibraryProps` and the engine's `libraryTopOver`); the engine's `collision.kinded('library room wall', …, LIBRARY_WALL_HEIGHT, false, true)` and den's west-wall group/material both survived the auto-merge. `Library.ts`: `MeshToonMaterial` + `Object3D` type imports; the constructor takes den's shell shape (`shell.walls/westWall/westMaterial/lintel/fabric`, the den built before furnishing) with the engine's `new LibraryProps(collision, OX, OZ)` (no `surfaces`). `layout.ts`: the `libraryStandSpots` doc names cushion seats AND den spots. `check-library.mts` (10 regions): doc items 1, 5/6, 11/12 merged; imports unioned (and the kids merge's duplicated `LIBRARY_CHIPS`/`PRIMARY_ACTION` lines dropped); `fill` uses den's `onFloor` domain with the engine's `walkableAt`; CONTROL 1 builds both shells (den) and the engine's pen of four walls; REACHABILITY keeps the engine's step-aware box test + the readable-books clause + den's pocket clause and split keep-out note; den's `marchAt`/DEN WALLS/LINTEL block goes in before the engine's LANDING heading. |
| D, `feat/library-714-books2` @ d32a205a | a30e7b96 | `check-book-reader.mts`: both tracks' item 9 kept — books2's "words in their box" stays 9 (+9b, the model sheet), the owl's "a book straight off the shelf" becomes **10** (header and the code's `// 10.`). `check-library.mts`: doc item 12 merges the owl's READABLE description with books2's kind-wise pairing; the pocket clause and the split note stay (den's); READABLE's heading and first clause combined (`slots >= books`, see below) with books2's kind clauses. `layout.ts` and `props.ts`: doc comments name cushion seats, den spots and the big readers' shelf. |

**The books2 WIP commit (d32a205a, "uncommitted edits saved as found, unverified")** is a
coherent feature, not half-typed edits: the chapter books' picture vocabulary (twelve new
`PICTURE_MODELS` — mini, pink wall, tortoise, owl, candy floss, jet pack, disco ball, lollipop
tree, surprise egg, alien saucer, storm cloud, `prop` with primitive parts — in `books.ts`,
`pagePictures.ts`, a new `pictureProps.ts`, `createStoryCloud` in `readerAssets.ts`) and
`check-book-reader` item 9b (the model sheet). **Verified, not reverted:** `tsc --noEmit` exit 0
on the merged tree; `check:served-book-reader` (below) exercises 9b against a real browser.

**package.json:** no track changes a script against its own base (parsed, not grepped: the
`scripts` object of each branch vs its base — "none" for all four). The merged `scripts` object
equals `origin/feat/engine-solids`' exactly, 179 names, every chain's step set equal (`check`
9, `check:shard-1` 26, `-2` 4, `-3` 17, `-4` 15, `-5` 8, `-6` 4, `-7` 6, `-8` 1, `-9` 2,
`check:all` 6; the proof script is in the task log).

## The API adaptation (commit 81ef26e5, then d9e41ac7)

The tracks were built against main's library props (plates, `'wall'` tops, `box()` as three
capsules, `soft()` cushions). On the engine every solid has a real top and no flag. What changed:

- **`shell.ts`** — the den's three walls stand to `LIBRARY_WALL_HEIGHT` (the drawn wall's height,
  the top every room wall has); the lintel is `kinded('library lintel')`, absolute like the
  room walls, **from** `shelfTop − JUMP_CLEARANCE_GRACE − LINTEL_OVERLAP` (3.00 m) **to**
  `LIBRARY_WALL_HEIGHT` (5.20 m), no longer `Infinity`. Decision: over the wall's top the room
  holds no flier anywhere (the engine's real tops), so a lintel to infinity would be a hole's
  opposite — an invisible blocker taller than the wall it sits in — and Jim has asked for no new
  blocker without him. `check:library`'s LINTEL asserts the lintel's top is the west wall's own
  (one owner, read off both colliders).
- **`Library.ts`** — `sit()` hands her to a `RideHolder` (`'a story cushion'`, `letGo` =
  `standUp`, **`companion: 'not a ride'`**: a seat, so her line stays out at her heels, Jim 19
  Oct). `standUp()` gives `endRide` the cushion's spot on the floor (`RideExit.y` is the floor,
  never the seat) and the put-down rule (`world/dismount.ts`) stands her on the nearest clear
  floor that reaches the room, **1.25 m beside the cushion** (`check:exits` measured it on both
  Sit chips) — the hotel breakfast chair's behaviour, every seat's now. The kids' "pops onto the
  soft plate and walks off" is gone with the plates. Docs rewritten (class doc, `lintel`,
  `standUp`).
- **`shelfBooks.ts`** — `SHELF_BOOKS` pairs `BOOKS[i]` with slot `i` as before, but the throw is
  now: a book with no slot (`BOOKS.length > slots`), a book on a slot of another kind, or a
  **picture** slot with no book. **The big readers' shelf's six slots may wait for their chapter
  books** (`WAITING_SLOTS`, exported): `CHAPTER_BOOKS` is empty until track D's engineers land
  them, and the previous equality throw would have stopped the World building at this head.
  A waiting slot is a gap in the row with its stand kept clear, exactly as every slot stood in
  #720 before the twelve landed; `check:library` names the waiting slots on stderr every run
  ("6 slot(s) WAIT for their books …") and READABLE's first clause is `slots >= books` with
  books2's kind clauses (`picture slots === PICTURE_BOOKS.length`, `CHAPTER_BOOKS.length <=
  chapter slots`). **For the join: once all six are in, make `<=` `===` and drop the waiting
  note** (recorded under "For the join").
- **`check-library.mts`** — `LIBRARY_CHECK_REMOVE` and LINTEL's control take a solid out **by its
  handle's type** (`takeOut`/`putBack`: disc id, wall, or box — `removeWall` on a box's handle
  took nothing out, and the engine tree's own scripts typecheck flags exactly that line); the
  shut shelf is one filled box named `bookcase west-2` (not `bookcase west-2 (body)` etc.);
  LINTEL sweeps every height **the wall itself holds a flier at** (to `topHeight −
  JUMP_CLEARANCE_GRACE − 0.05` = 5.00 m) and a new CONTROL flies at 5.10 m over the lintel and
  over the plain west wall alike; READABLE skips waiting slots. SIT's walk holds the stick
  until she is over the cushion (a solid within a step is climbed only while walking INTO it:
  `Player.update` asks `walkingOntoStep` of the stick's direction; coasting into it she met its
  side as a wall at 1.07 m — the first run's red), at a light touch (0.35, derived from
  `PLAYER_DECELERATION`/`PLAYER_MAX_SPEED` so she coasts ≤ 0.1 m) for the last stretch; the
  Read-chip control counts READABLE's own name pattern (the outlines `library.book.<id>.outline`
  doubled it to 24 — the first run's other red).

## Checks at d9e41ac7 (exit codes read; counts off the screen)

Local parks: the engine worktree's CI parks (16 seeds, hash 8d1da000…) restamped under this
tree's source hash **8644cfac6fec…** for iteration (the engine handoff's own shortcut, reading
room is seed-independent); the honest seed-5 solve at this head runs in the detached snapshot
worktree `.claude/worktrees/library-v2-snap` (see "Parks" below).

| check | exit | off the screen |
|---|---|---|
| `pnpm exec tsc --noEmit` | 0 | |
| `pnpm run typecheck:test` | 0 | |
| scripts typecheck instrument (`wf/tsconfig.scripts.library-v2.json`, the foundation's recipe) | 2, as the engine tree | **56 messages vs the engine tree's 57**: the one only in the engine tree is check-library's `removeWall(victim.handle)` on a `WallCollider \| BoxCollider` (fixed here); none new |
| `check:library` | 0 | **101 ✓, 0 ✗**, "All clauses passed."; keep-outs 75 (69 room + 6 big-reader stands… see log) ; SIT worst lowest point 3.5 mm, sole 3.5 mm, hip 0.0 mm; 'Get up' stands her at (2.96, −7.09) |
| `check:solids` (core) | 0 | "a library cushion (top 0.36 m): a sprint and a hop stands her on it at y 0.36"; the library: 13 tops reached, 0 drop regions, 664 jumps, no roof/enclosure/off-floor, nothing wedged; clause 11: 532 pushes, 189 stood on top, 343 held/walked across, 0 shuttled |
| `check:exits` | 0 | 102 exits in 12 spaces, 23 moved (worst 2.25 m); the library: 795 exits, 154 put off the lattice, 0 nowhere; `library-sit:cushion-1/-3` "Sit down" → "Get up", moved 1.25 m each; 64 placement call sites, 54 driven (Library.ts's endRide/beginRide/teleportTo among them) |
| `check:tap-spacing` | 0 | 10 spaces, **145 zones** (+2 Sit over Step 5's 143), 27 portal bands; 245 zone-band and 20 close zone-zone pairs; 20 same-action overlaps (warnings); OK |
| `check:labels` | 0 | 12570 frames, 54 labels, no overlap (the library is not in its scenes yet — Step 10) |
| `check:brevity` | 0 | 354 pieces, 6 recorded exceptions (unchanged) |
| vitest `test/library/big-reader`, `chapter-books`, `test/store/library-card` | 0 | 3 files, **16 passed** |
| `pnpm run build` | 0 | |
| `check:solids-park` | 0 | the park: 726 tops reached, 159 drop regions, 37053 jumps (149 s); the line: 89 points, each with a way off; clause 8 drove the train 241 s through Game's wiring; "put down beside it: 9 exits … none leaves her inside it or wedged" |
| `check:served-book-reader` (port 6411, its own dev server, stopped by pid) | 0 | **1054 ok, 0 FAIL**, "check:book-reader passed"; item 9b: the model sheet "opens without linking a shader program — 0 program link(s)", "11 pictures, the thinnest covering 19.0% of its pixels"; item 10: `/library?at=-9.4,-11.1&facing=180&seed=5` selects `library-book:ripikaBalloon`, its chip opens that book, `frameContext.dt = 0`, `.hud-menu` display none |
| `check:served-deep-links` (port 6419) | 0 | **20 OK of 20** (10 links × 2 starts); `/library`, `/library?at=-16.1,-4&facing=270`, `/library?at=6,8.7&facing=180`, `/library-door` all 0.00 m off their spots |
| the honest seed-5 solve (snapshot at 81ef26e5 = this tree's closure) | 0 | `build:parks` 484 s: restart 0 rejected by check:coplanar (213 s), **restart 1 accepted as shipped (134 measures, 477 s), digest d6721090fb3f1d3a**, proven; control (cruiser +0.5 m) 7a4f8585bc0a4707 differs. Against the engine's seed-5 file: `features`, `measures`, `planOrder`, `restart` byte-identical; only `acceptance` and `digest` moved — **the Library moves nothing in the park** |
| **final `check:library` on the honest park** (`.parks/` from the snapshot, at b438b695) | 0 | **101 ✓, 0 ✗**, "All clauses passed."; 77 keep-outs: 75 in the reading room (arrival, doorway, desk, librarian, rug, seats, secret shelf, 18 readable slots, every aisle node) and 2 in the secret den; stderr: "6 slot(s) WAIT for their books … slot 13 (west-4, shelf 1, -1.5 m along) … slot 18"; LINTEL: the lintel's top 5.20 m against the wall's 2 spans at 5.20; 202 marches to 5.00 m, furthest west x −17.08 (at 3.10 m); the 5.10 m flier passes lintel and wall alike to x −28.00 |

## Reds (each with the geometry it was proved against; seed 5 restart 1 hydrated, the reading room at (−600, −600))

Geometry: the den's inner faces x −23.90, z −7.60 / −2.00; the doorway z −6..−2 in the wall at x
−18.3..−17.7; the shut shelf `bookcase west-2` one box x −17.7..−17.1, z −6..−2, top 3.20; the
lintel band 3.00..5.20 m; the flier at 4.00 m; cushion-1 at room (2.1, −8), radius 0.45, top 0.360.

- **`LIBRARY_CHECK_REMOVE='bookcase west-2'`** → exit 1, **14 clause(s) FAILED** (`wf/red-remove-west2.log`):
  `✗ inside the secret den's doorway at (-19.60, -4.30) IS reachable with the secret shelf shut`, `✗ beside the baby dragon …`,
  `✗ no keep-out in the secret den is reachable while the secret shelf is shut: 0 of 2 sealed off`,
  `✗ bookcase west-2's middle IS reachable — it is not solid`, `✗ the one pocket is the secret den: 0 clear cells are unreached …`,
  `✗ bookcase west-2: a body's edge got 0.666 m into it (allowance 0.071)`, `✗ the walls hold: 2 of 48 marches left the room other than through the door`,
  `✗ 202 marches at every height … the furthest west any got is x -23.28 (at 0.00 m)`, and LANDING's `✗ bookcase west-2 at (-17.69, -2.04): landed at 0.000, its top is 3.200` ×3+.
  **On the engine head this REMOVE would have taken nothing out** (a box handed to `removeWall`); `takeOut` is why it bites.
- **`LIBRARY_CHECK_REMOVE='den wall (west)'`** → exit 1, **7 clause(s) FAILED** (`red-remove-denwall.log`): `✗ a body marched west (−X) from (-23.08, -6.78) at 0.05 m a step ended at (-35.08, -6.78), outside the den and the room` ×4, `✗ 12 of 12 bodies stood in the den, 72 marches …: 24 ended outside`, `✗ … deepest a body's edge got past it: west (−X) 11.825 m …`, `✗ CONTROL, the shut shelf's 1 collider(s) out: a walker … passes under the lintel into the den (to x -28.00) …`.
- **`LIBRARY_CHECK_MUTATE=no-lintel`** → exit 1, **4 clause(s) FAILED** (`red-no-lintel.log`): both fliers at 4.00 m `stops at x -23.28`, `✗ 202 marches at every height from the floor to 5.00 m … the furthest west any got is x -23.28 (at 3.10 m)`, and the shelf-out CONTROL `the flier at 4.00 m still stops at x -23.28`.
- **`LIBRARY_CHECK_MUTATE=shift-books`** → exit 1, **26 clause(s) FAILED** (`red-shift-books.log`): every slot line, e.g. `✗ slot 1 (north-2, shelf 1, 0.6 m along) should hold 'biscuitBreakfast': its mesh stands 1.200 m OUTSIDE north-2's drawn box …`, the two 0-of-12 summaries and the zone lines.
- **Found, not planted — SIT's walk on the engine** (`wf/library-1.log`, exit 1, 99 ✓ 2 ✗): `✗ from (0.79, -5.87) (clear floor: true) she walks onto cushion-1 and comes to rest 1.07 m from its middle (0.3 allowed), her feet 0.000 m up on its soft top (0.360)` — the cushion's 0.45 plus her 0.62: she was held at its face. And `✗ no Read chip while she sits: 0 offered (CONTROL: standing, 12 were, for 24 readable books drawn as 'library.book.*')`. After d9e41ac7: `✓ … comes to rest 0.00 m from its middle …, her feet 0.360 m up on its top (0.360; the stick at 0.35 for the last stretch)` and `✓ … for 12 readable books drawn`.
- **By hand — the lintel's top to `Infinity`** (`shell.ts`'s `addWall(…, LIBRARY_FLOOR_Y + LIBRARY_WALL_HEIGHT, …)` → `Infinity`; run with `LGP_PARK_FILE=$PWD/.parks/5.json`, the honest seed 5; reverted with `git checkout`) → exit 1, **99 ✓ 2 ✗** (`wf/red-byhand-lintel-infinity.log`):
  `✗ the lintel's top is the west wall's own: Infinity m, against the wall's 2 spans at 5.20, 5.20 m (two spans wanted, either side of the doorway, each with a real top)` and
  `✗ CONTROL, a flier at 5.10 m (over the wall's top by the jump grace): she passes over the lintel (to x -17.08) and over the plain west wall at z 5.50 (to x -28.00) alike — the lintel ends where the wall does`
  — the lintel held her at x −17.08 where the wall let her through. (The sweep's ceiling is taken from the **wall's** top, so a lintel built wrong cannot move the ruler it is measured with — the first version read the lintel's own top and would have looped forever at `Infinity`.)
- **By hand — a picture book on a chapter slot** (`layout.ts`: the first `PICTURE_SHELF` slot's kind made `'chapter'`; `shelfBooks.ts` imported through the resolver hook with `headless-canvas`; reverted) → the module **throws at load**: `Library: 'ripikaBalloon' is a picture book, but readable slot 1 (north-2, shelf 1, 0.6 m along) is for a chapter book — the slots are paired with BOOKS by index, the picture books' first and then the big readers' shelf`. CONTROL, unmutated: `loaded: 12 shelf books, 6 waiting slot(s): 13, 14, 15, 16, 17, 18`.

## Decisions (with reasons) — Jim is away; each is also in the PR body

1. **The lintel's top is the wall's top (5.20 m), not infinity.** The engine gave every room wall
   a real top; a lintel to the sky would be the one invisible blocker taller than the wall it
   sits in, and Jim asked for no new blocker without him. Over the wall's top nothing in the
   room holds a flier — a jet pack over the west wall lands in the den whether or not the lintel
   reaches the sky (question for Jim below).
2. **Getting up off a cushion puts her beside it, on the floor** (1.25 m away), through the
   put-down rule — not on the cushion's top. `RideExit.y` is "the floor, never the seat", and
   the hotel chair does the same; the alternative (exit at the cushion's top) would stand her on
   a 0.9 m disc she then steps down from, which the rule's own doc rules out.
3. **The big readers' shelf waits for its books, loudly, instead of the World refusing to
   build.** The six slots are the shelf's furniture (stands are keep-outs, gaps in the row); the
   chapter books land on track D. Only the last slots may wait, only chapter slots, and the
   check names them on every run.
4. **The books2 WIP commit stays** (verified by tsc and the served reader check), see above.
5. **Both tracks' `check-book-reader` item 9 kept; the owl's renumbered 10** (it runs last).
6. **The merged `interactZones()` is one list** (Read zones while not riding + Sit zones) — the
   kids handoff's own join note.

## Questions for Jim (no new blockers were added; decide when you are back)

- **The den is reachable by a jet pack over the room's west wall** at this head: the room's
  walls have real tops (5.2 m, PR #722) and the jet pack flies 12 m indoors, so a flier over the
  west wall lands in the sealed den (Step 11's state: the secret shelf does not swing yet).
  Step 12's guard ("the leaf opens instantly whenever she is found in the den with it shut")
  closes this once track C lands it; until then it is a pocket only a jet pack reaches. Options
  if you want it shut now: a banded ceiling over the den (an invisible blocker — your call), or
  the guard brought forward. **`check:solids` core did not flag it** (the library census: no
  enclosure reached, 13 tops, 0 drop regions) — the census does not fly the jet pack indoors.

## For the join (and for each track)

- **Track A (owl, Step 6)** starts from this head. Its `props.wall(spot, spot, OWL_RADIUS, …)`
  now takes a numeric top (her measured height), not `'wall'`; `detach`/`attach` take
  `WallCollider`s as before. `library.shelfBooks[i].material` is the glow target. The Read
  zones are built once in the constructor; the owl's zone joins `interactZones()`'s one list.
- **Track B (kids, Step 8)** starts from this head. SIT is green on the engine; children on
  cushions: `NpcCharacter.beginSeated` roots at the floor (the dining rule) — cushions are
  solids now, so a child's `move()` after `endSeated` resolves her off the disc (watch KIDS).
- **Track C (den, Steps 12–13)**: `props.box` returns `[BoxCollider]` (one), so the leaf's
  `closed`/`open` sets are one box each; `props.detach(open)` / `attach(closed)` work on boxes.
  LINTEL's CONTROL finds the shut shelf as `solid.what === 'bookcase west-2'`. The nest's and
  the pile's solids take numeric tops (nobody jumps onto a dragon: give them their measured
  heights; a top she cannot fit under the ceiling is a side by the engine's headroom rule).
  **Step 12 closes the jet-pack question above.**
- **Track D (chapter books)**: add each book to `chapterBooks/index.ts`; `WAITING_SLOTS`
  shrinks as they land; when all six are in, READABLE's `CHAPTER_BOOKS.length <= chapterSlots`
  becomes `===` and the "WAIT" note goes (never weaken it the other way). `check-book-reader`
  10 opens `SHELF_BOOKS[0]`; 9b's model sheet must still draw every `PICTURE_MODELS` entry.
- **Step 10 (labels scene, tap spacing)**: `check:labels` has no library scene yet; tap-spacing
  is at 145 zones.
- Stale docs reworded here: `Library.ts` class doc ("What later PRs add").

## Parks

**Superseded at the round-four merge** — the hash is now 4e30969a… and the live `.parks/` holds
that tree's honest seed 5 (see "Engine round four merged" below). What follows is 33bcc361's.
The park source hash at that head was **8644cfac6fecd6b08b556edd48ebf031c1cc53f56488e1dc66263e240afcdc6d**
(src edits since 81ef26e5 are none; scripts are outside the closure). The honest solve:
`LGP_SEEDS=5 LGP_RESTART_LANES=4 pnpm run build:parks` in the detached snapshot worktree
`.claude/worktrees/library-v2-snap` at 81ef26e5 — restart 0 rejected by check:coplanar (213 s),
as on every library branch before; **restart 1 accepted (134 measures), digest d6721090fb3f1d3a**;
`features`/`measures`/`planOrder` identical to the engine's seed 5 (its CI parks, hash 8d1da000…).
The live tree's `.parks/` now holds that honest seed 5 (manifest: seed 5 only, hash 8644cfac…);
the restamped 16-seed set is kept at `wf/parks-restamped-engine/` for checks that want another
seed (copy it back and restamp). The snapshot worktree has been removed (`git worktree remove`).

## Taking over at zero notice

`cd .claude/worktrees/library-v2` (branch `feat/library-v2`), `pnpm install --frozen-lockfile`,
`pnpm exec node -e "console.log(process.env.npm_config_user_agent)"` → pnpm/12.1.0. `.parks/`
holds the honest seed 5 for this tree (hash 4e30969a…, since the round-four merge); any src
edit inside the park closure changes the hash — re-restamp (`node scripts/lib/park-source-hash.mjs`, write it into
`.parks/manifest.json`'s `sourceHash`) or use `LGP_PARK_FILE=$PWD/.parks/5.json`. Every red
above is reproducible from its mutation name.

## Engine round four merged (23 Oct 2026, Opus 5.5) — tracks, read this before your next merge

**Merge 679c3b31** = `git -c rerere.enabled=false merge --no-ff origin/feat/engine-solids` at
**003d6489** (round four's last code commit is b78789c6; fccadf8b and 003d6489 are handoff
commits; PR #722's head is fccadf8b, CI 39911387184 green). Then **f19cd1fc**, one red found and
fixed (below). PR #733's head `feat/library-v2-pr` was **not** moved (still b438b695; a
fast-forward to this head is possible). Scratch for all of this: `.claude/library-build-scratch/r4merge/`.

**Conflicts: none.** Since the merge base 2aa9da02 the engine changed 16 files and this branch 38,
and the two sets are disjoint; ort merged without a conflict. Proved: the merge's diff against
its first parent is exactly the engine's 16 files, against its second exactly this branch's 38;
`git diff origin/feat/engine-solids...HEAD` names only those 38. **package.json:** neither side
touched it since the base; parsed (`r4merge/compare-scripts.mjs`, never grepped) the merged
`scripts` equals both parents': 179 names, every step set equal (`check` 9, `check:shard-1` 26,
`-2` 4, `-3` 17, `-4` 15, `-5` 8, `-6` 4, `-7` 6, `-8` 1, `-9` 2, `check:crowd` 5, `check:all` 6).

**What came in** (the engine's 14 commits 5edb5b81..003d6489; the earlier round four — pets into
her backpack on every ride with one beside her, the solid train, the hover rescue, `offTheLine`,
check:exits 4c/4d, check:pet-slide — was already here from 2aa9da02):
1. **`Player.isStandingStill`** (one owner): a player standing still is furniture to the crowd —
   `NpcSystem.separateFromPlayer` moves the child the whole correction. Walking, she still takes
   her half; a seated child is still furniture to her (she is nudged); a riding player still
   moves the child.
2. **`GroundHolder`** (structural, `entities/npc/driver.ts`): a driver whose `holdsGround` is true
   is furniture in `NpcCharacter.separateFrom` and to a walking player. `NpcCharacter.holdsGround`,
   and `NpcCharacter.setDown(x, y, z)` — a declared jump, which check:jitter knows.
3. **Trains:** `TrainStop.waits` (two places to wait per platform, `Station.WAIT_ALONGS` 2.7 and
   0.9), `TrainService.claimWait/releaseWait`, `ParkTrain.upOn` (a child of the crowd never sits
   down in the carriage she is standing on). Any stub `TrainService`/`TrainStop` must grow them
   (tsc found none in this tree).
4. **`LabelManager`:** `LABEL_ENTRY_CUSHION_PX` = 24 — a label that is down comes up only with 24 px
   of room beyond the 4 px margin; check:labels' audit asks the same of a label that was down.
5. **Player's hover rescue** compares `altitudeAt`, not `p.y − hoverAt.y` (check:flat-primitives).
6. **check:solids:** the census, clauses 1, 5, 9, 10 and the jet-pack report leave the train's 15
   moving bodies out (stderr says so every run); every clause before 8 asks the park without the
   train; clause 8 asks every station; clause 13 asks the put-down as chosen. check:crowd's stub
   stops have their waits; check:jitter hooks `setDown`.

**Park:** the honest seed-5 solve of this tree, in the detached snapshot
`.claude/worktrees/library-v2-snap` at 679c3b31 (`LGP_SEEDS=5 LGP_RESTART_LANES=4 pnpm run
build:parks`, `r4merge/snap-build-parks-5.log`): exit 0 in 463 s; restart 0 rejected by
check:coplanar (207 s); **restart 1 accepted as shipped (134 measures, 457 s), proven, digest
d6721090fb3f1d3a** (control, cruiser +0.5 m, 7a4f8585bc0a4707 — differs). The digest is the
pre-merge honest park's own, and `features`/`measures`/`planOrder`/`restart` are byte-identical to
the pre-merge park **and** to the engine's seed 5 (source 7acd3093): round four moves nothing in
the Library's park, and the Library still moves nothing in the engine's. Source hash
**4e30969ae1eee6d88ab0d01268da44fe07692be659c6f1572e561542872dcbda** at 679c3b31 and f19cd1fc
(f19cd1fc's file is outside the closure — measured with `parkSourceClosure`, 507 files). The live
`.parks/` holds it; copies at `r4merge/parks-honest-4e30969a/` (and the old one at
`r4merge/parks-pre-merge-8644cfac/`). The snapshot worktree has been removed.

**Checks at f19cd1fc** (seed 5, that honest park; logs `r4merge/runs/<tag>/`, exit codes read, counts off the screen):

| check | exit | off the screen |
|---|---|---|
| `pnpm exec tsc --noEmit` | 0 | |
| `pnpm run typecheck:test` | 0 | |
| scripts typecheck instrument (`r4merge/tsconfig.scripts.*.json`: 22 scripts, now with check-solids, -exits, -labels, -npc-jitter, -pet-slide, trace-npc-driver, lib/solidReach) | 2, as the engine tree | **91 messages vs the engine tree's 92**: the one only there is check-library's `removeWall` on a box (fixed here at 81ef26e5); **none new** |
| `check:library` | 0 | **101 ✓, 0 ✗**, "All clauses passed."; 77 keep-outs (75 room + 2 den); LINTEL 5.20 m against the wall's 2 spans at 5.20; 202 marches, furthest west x −17.08 (at 3.10 m); SIT 0.00 m from cushion-1's middle, feet 0.360 m up; 'Get up' at (2.96, −7.09); worst lowest point 3.5 mm, sole 3.5, hip 0.0; "6 slot(s) WAIT" |
| `check:exits` | 0 | "check:exits OK" (191 s); the library: 795 exits, 154 put off the lattice, 0 with nowhere; `library-sit:cushion-1`/`-3` "Sit down" → "Get up", moved 1.25 m each; 64 placement call sites, 54 driven (Library.ts endRide ×2, beginRide ×2, teleportTo ×8 and ×2); companions on 13 holders, all "as declared" |
| `check:solids` (core) | 0 | **80 ✓, 0 ✗**, "check:solids OK"; "a library cushion (top 0.36 m): a sprint and a hop stands her on it at y 0.36"; the library: 13 tops, 0 drop regions, 664 jumps, no roof, no enclosure, nowhere off its floor, nothing wedged; clause 11: 532 pushes, 189 stood, 343 held or walked across, 0 shuttled; "15 moving bodies … are not in the census" |
| `check:solids-park` | 0 | **31 ✓, 0 ✗** (218 s); the park: 722 tops, 156 regions, 36931 jumps; the line: 89 points (25 walking, 62 hop, 2 tunnel, 0 search); clause 8 drove the train 319 s through Game's wiring; clause 13: 9 put-downs beside it, none inside it or wedged |
| shard 1, every one of its 26 steps, each run alone | all 0 | flat-primitives "no new flat primitives, and no stale baseline entries" (103 flat-ok sites); deck-fallthrough 151 s; check:crowd 66 s; speech-bubbles 14 s |
| shard 3, its other 14 steps, each run alone | all 0 | check:jitter: 31 children, 9000 frames, worst own step 0.177 m (Luca), bound 1 m |
| `pnpm run build` | 0 | |

**Red found, not planted — check:flat-primitives** at 679c3b31 (`r4merge/flat-primitives.log`,
exit 1): `NEW FLAT PRIMITIVE src/world/library/reader/pagePictures.ts:286 [Y_DIFFERENCE] high - low
… baseline allows 0 of this expression in this file; found 1. … 1 new flat primitive(s).` At the
pre-merge head 33bcc361 (the snapshot checked out there, `r4merge/flat-primitives-premerge-33bcc361.log`,
exit 1) there were two: `src/entities/Player.ts:1828` (engine 97444d7f's hover rescue) and
`pagePictures.ts:286` (the books2 WIP's `strapJetpack`). **#733's CI at b438b695 (run
39864355905) is red on exactly these:** shard 1 stopped at check:flat-primitives on both lines,
and shard 3 at check:jitter (`worst own step 2.743 m (Theo) bound 1 … frame 2085 … at (-20.94,
12.72) near Sunny Side` — the engine's own round-four red, fixed by 0807890d). Neither shard ran
its later steps on CI; every one of them ran here, above. **Fix (f19cd1fc):** `// flat-ok: a
pet's own local bounds on the picture's flat stage` — `strapJetpack` measures a pet model's own
points on the reader's flat render stage — character for character the annotation
`feat/library-v2-books` carries (8796bff0), so that join takes it without a conflict. Player.ts's
line came in fixed with the engine. After: exit 0.

**For the tracks and the join.** Every track branch was cut from 33bcc361, before this. Trial
merges of each track's current tip into f19cd1fc (in the snapshot, `--no-commit`, then aborted):
owl 9aef6809 **clean**, kids fb1cc3ed **clean**, den d209d0df **clean**, books 9325e0f7 **one
conflict** (below), art/story-props d431a47d clean, art/library-v2-den 0c0fecd0 a conflict in
`layout.ts` that is the library's, not round four's — the den track already carries that art
branch (`merge-base --is-ancestor`: yes), as books carries story-props, books-a and books-b, so
merge the tracks, never the art branches.
- **Every track:** before your next World-building check, merge `origin/feat/library-v2`
  (f19cd1fc or later) into your branch with `-c rerere.enabled=false`. Your park hash moves:
  Player.ts, NpcCharacter.ts, NpcSystem.ts, ParkTrain.ts, station.ts, service.ts and
  trainTrip.ts are in the closure. The honest seed 5 above fits this exact tree only.
- **Track A (owl):** your `scripts/check-labels.mts` line (`['the library',
  world.library.screenLabels]`, at line 214) and the engine's edits to it (the import at 90, the
  audit at 419) are separate hunks. But the owl's bubble and the creature bubble now come up only
  with 24 px of room beyond the margin, and the audit asks that of them: re-run check:labels.
- **Track B (kids):** your `NpcCharacter.animate` edit (facing written again after the pose, near
  line 857) and the engine's (`setDown`/`holdsGround` near 248, `separateFrom` near 580) are
  separate hunks. Behaviour: a library child walking to her cushion past a player standing still
  now goes round her, taking the whole correction (it was half). `LibraryKidDriver` may declare
  `holdsGround` if a child is to stand somewhere on purpose; a driver that says nothing holds no
  ground. Re-run KIDS and check:jitter.
- **Track B, story time (Step 9) — a coverage gap, not a red:** check:exits 4c ("her companions on
  every holder", 13 holders) never asks the story cushion, because its exit loop presses "Get up"
  before the 0.3 s at which it asks. So a cushion's `'not a ride'` (her pets keep following, Jim
  19 Oct) is asserted for the breakfast chair, the bed, the banquet and the tree, and nowhere for
  the cushion. Story time is the natural owner: sit her through a story with three pets out and
  assert all three stay out and none is seated.
- **Track C (den):** no file in common with round four. Its package.json adds
  `pack:/blend:/render:library-den` (three names, no chain change) on top of the 179.
- **Books join:** it carries engine commits only to 7ce1deae (through art/story-props).
  **`src/entities/Player.ts` conflicts** in the hover rescue: 8796bff0 put `// flat-ok: the same
  body a moment later, with its plan drift tested first …` over `Math.abs(p.y - this.hoverAt.y)`;
  the engine replaced that line with the `altitudeAt` difference and its own two-line comment
  (0807890d). **Take the engine's side whole and drop the flat-ok line** — the line it excused is
  gone — then re-run check:flat-primitives. Its package.json adds `check:story-props-glb`
  (shard-1 26 → 27) and `pack:/blend:/render:story-props`: rebuild from parsed step sets.

**No new blocker or guard, no new decision for Jim** in this merge; the open question above (the
den is reachable by a jet pack over the west wall until Step 12's guard) stands as it was.

## Story-time stage (23 Oct 2026, Opus 5.5) — tracks A and B merged, the reviews judged, Step 9, Step 10

Scratch: `.claude/library-build-scratch/st9/` (`runs/<tag>/<check>.log`, each ending `exit=N`;
`run-checks.sh <tag> <check>…` runs checks in parallel in this worktree; `restamp.mjs` as the tracks').

### The merges (each `git -c rerere.enabled=false merge --no-ff`)

| merge | commit | conflicts, and how each was resolved |
|---|---|---|
| A, `feat/library-v2-owl` @ 9aef6809 | b5fb3645 | none |
| B, `feat/library-v2-kids` @ fb1cc3ed | 02a72dca | `Library.ts`: imports unioned (owl's `LibraryOwl`/`hasLibraryCard`/`gameStore`, kids' `LibraryKids`/`libraryKidDriver`); `releasePlayer` and `standOutside` take both sides — kids' `showRoom(false)` (room and children together) then the owl's `owl.leave()`. `check-library.mts`: the header's item 14 keeps the owl's text, its OWL/CARD/RECOMMEND/SHUSH item stays 15 and SIT/KIDS become **16**; imports unioned (owl's faceLife/state/readBooks/recommendation/libraryCard/LibraryOwl lines, kids' kidHeight/NpcSystem/residentLooks/libraryKidDriver/LibraryKids lines, `books.ts` once with `type LibraryBook`); the layout import list takes `LIBRARY_KID_PLANS` and `LIBRARY_LIBRARIAN_SPOT`. |

`origin/feat/engine-solids` has not moved (003d6489, an ancestor since 679c3b31). **package.json:**
neither track touches it; parsed, the merged `scripts` equals the pre-merge head's (179 names, 0
differ). Clause order in check:library: A's block (OWL → CARD → RECOMMEND → SHUSH) runs before B's
(SIT → KIDS), as the markers stand; KIDS leaves her at the desk's front, not riding.

### Checks after the merges (seed 5: the honest park of 679c3b31, restamped 4e30969a → 49c4571d)

| check | exit | off the screen |
|---|---|---|
| `tsc --noEmit` | 0 | |
| `typecheck:test` | 0 | |
| `check:library` | 0 | **158 ✓, 0 ✗** (101 + 34 owl + 23 kids), "All clauses passed." |
| `check:labels` | 0 | 55 labels registered, 12570 frames, no overlap |
| `check:tap-spacing` | 0 | 10 spaces, **146 zones**, 27 portal bands; 246 zone-band, 20 close zone-zone pairs; 20 same-action warnings |
| `check:brevity` | 0 | 354 pieces, 6 recorded exceptions |
| `check:exits` | 0 | "check:exits OK"; the library 795 exits, 155 off the lattice, 0 nowhere; both Sit chips "moved 1.25 m" |
| `check:hotel` | 0 | 34 children (7 hotel residents), "check:hotel OK" |
| `check:npc-presence` | 0 | "npc presence OK" |
| `check:jitter` | 0 | 34 children, 9000 frames, worst own step 0.177 m (Luca), bound 1 m |
| `check:crowd` | 0 | trace `frames=90000 children=12`, `covered climbs=9 trips=61 …` (no NOT EXERCISED) |
| `check:solids` (core) | 0 | the library: 14 tops, 0 drop regions, 679 jumps; "check:solids OK" |

### The integration review's findings, judged

1. **Primitive picture items (blocker) — real; already fixed at its root on track D, lands at the join.**
   `createStoryCloud` (squashed spheres), `pictureProps.ts` and the `prop` vocabulary came in with the
   books2 WIP. Track D's cece064a ("the picture vocabulary is the story-props kit, never a primitive")
   deletes `pictureProps.ts`, drops `PropPart`/`PropShape`/`parts`, and draws `stormCloud` with the kit's
   Nimbus (`reader/storyProps.ts` `createStoryCloud`, from `storyProps.glb`) — read on
   `origin/feat/library-v2-books` @ 9325e0f7. Not duplicated here: a second, different edit of the same
   hunks would conflict with D's at the join. **At this head no page draws them** (`git grep`: only
   check-book-reader's model sheet, items 9/9b, names `prop`/`stormCloud`; `CHAPTER_BOOKS` is `[]`), so a
   player sees none. The PR body no longer advertises "storm cloud, primitive props". **For the join:**
   after merging D, `git grep -n "pictureProps\|buildPictureProp\|PropPart" -- src scripts` must be empty.
2. **'Get up' popped her 1.25 m sideways (major) — real, fixed (68999c55).** `standUp()` gives `endRide`
   the cushion's measured top (`libraryCushionSize().top`, the solid's own top), where her feet were
   before she sat; the put-down rule's clause 2 accepts a solid's top and hands it back unchanged
   (`check:exits`: both Sit chips now "→ its own Get up chip" with no move; it said "moved 1.25 m").
   Decision 2 above is reversed: the doc's "the floor, never the seat" is about a chair's seat (inside the
   chair, by the table); a cushion is a soft solid open on every side, the hotel nap's mattress.
   SIT asserts she stands on the top where she sat, inside no solid there (`deepestSolidOverlap` at her
   height), and walks off onto the floor. **Red** (by hand, `y: LIBRARY_FLOOR_Y + top * 0`;
   `st9/red-getup-floor.log`; cushion-1 at room (2.1, −8), r 0.45, top 0.360) → exit 1, 157 ✓ 1 ✗:
   `✗ 'Get up' stands her up … where she sat: 1.250 m from the cushion's middle (0.05 allowed), her feet 0.000 m up on its top (0.360) … at (2.96, -7.09)`.
3. **The den shell from primitives (minor) — real; fixed on track C, lands at the join.** Track C merged
   `art/library-v2-den` (9356cb61, layout.ts resolved to one definition) and draws the den from the kit
   (9595c447: floor, walls with book niches, the lintel, stars, moon, lanterns; ae44e5ed: the pull book),
   colliders unchanged. The room's own shell (#720, on main) is pre-existing. **For the join:** after C,
   one definition each of `LIBRARY_DEN_DEPTH`/`DOOR_HALF`/`LIBRARY_DEN_INNER` in `layout.ts`.
4. **The jet pack into an invisible den (minor) — real as written; question for Jim amended.** The library
   never writes `player.flyCeiling` (only `Building.ts` does), so the pack flies 12 m indoors; over the
   5.2 m west wall she lands in the den, whose floor and walls are drawn hidden while the shelf is shut
   (`denRoot.visible = false`) though their colliders stand: an invisible floor among invisible walls until
   she flies out. Not a trap (she flies out as she flew in — check:solids' jet-pack rule). Track C's
   Step 12 (the den shown whenever she is in it, the guard opening the leaf instantly) closes it at the
   join, after this milestone; no blocker added. The question below says so.
5. **The PR body's look-at line with nothing to see (minor) — real, fixed in the PR body** at this
   milestone: the lintel bullet is gone; the links are the owl, the card, the glow, the shush, the
   children and story time.

### The review of Step 6 (the owl), judged

1. **OWL measured her solid against itself (major) — real, fixed (8ec1ffd9).** check:library now measures
   the drawn owl on a FRESH model across every pose she holds at her desk (head anywhere in ±1.0 rad,
   21 turns; breath ±0.02) — 0.668 m — asserts the registered solid covers it (2 mm), and marches and
   AISLES against that drawn reach. Measured so, the rest pose's 0.655 was 13 mm short (her glasses sit
   forward of the head's pivot), so `LibraryOwl.radius` is now `standingReach()` over the same poses
   (0.668; AISLES' nearest, entrance-hall, 0.012 m clear). **Found beyond the finding:** a live instrument
   (`measurePastHerSolid`) measures where her drawn body reaches past her solid at her widest and asks
   whether a child could stand there. The **sideways card flap** (`wingR.rotation.z` −0.9) swung the book
   wing 0.889 m from her middle at bearings −90..−75°, where a child can stand against her. **The flap is
   now forward, over the desk** (`wingR.rotation.x`, the shush wing's axis): past her solid only at
   −50..−30° and 40..50° (the shush wing), and a child can stand at none of them. Decision (Jim away):
   change the gesture's axis rather than grow her solid (a 0.9 m disc would be an invisible blocker the
   other 99% of the time, and breaks the aisle).
2. **talk()'s mid-script guard had no clause (minor) — real, fixed (8ec1ffd9):** CARD presses again
   mid-ceremony and asserts the script goes on.

Reds (seed 5; the owl at room (6, 5.3) facing 0, the desk at (6, 6.8), its front stand (6, 8.7); logs `st9/red-*.log`):
- `standingReach(…) * 0.8` (r 0.534) → exit 1, 158 ✓ 3 ✗: `✗ her solid covers her as drawn: r 0.534 against her drawn plan reach 0.668 m …`,
  `✗ 28 marches at her … the deepest a body's edge got into her drawn disc (r 0.668, measured apart) is 0.134 m (allowance 0.03)`,
  `✗ her wings at their widest … past her solid (r 0.534) at bearings -135 … 115°, and a child can stand against her solid at 8 of them (-95, -90, -85, -75, 75, 85, 90, 95°)`.
- the rest pose only (`visibleReachXZ(this.handle.root)`) → exit 1, 160 ✓ 1 ✗: `✗ her solid covers her as drawn: r 0.655 against her drawn plan reach 0.668 m …`.
- the old sideways flap (`wingR.rotation.z = …`) → exit 1, 159 ✓ 2 ✗: `✗ … she flapped the wing that holds her book forward, over her desk: rotation.x down to 0.00`,
  `✗ her wings at their widest … reach 0.889 m from her middle; past her solid (r 0.668) at bearings -90 … -50, 40, 45, 50°, and a child can stand against her solid at 4 of them (-90, -85, -80, -75°): a wing through a child`.
- `talk()` without `if (this.midScript) return;` → exit 1, 156 ✓ 5 ✗: `✗ pressed again mid-ceremony ('Say hello!'), she carries on: still "Hello again, little reader!" (mid-script true), nothing recommended (fountainWish), 1 card`, and the card lines, the flap, the glow and the mid-card shush lines after it.

### The review of Step 8 (the library children), judged

1. **check:jitter / check:crowd red (blocker) — real, inherited, already fixed upstream and merged.** Both
   reds were the engine's (0807890d `offTheLine` set-down, 7ce1deae crowd trips); this branch carries them
   since 679c3b31 (round four). After merging B: `check:jitter` exit 0 (34 children, worst own step 0.177 m,
   Luca), `check:crowd` exit 0 (`trips=61`, no NOT EXERCISED). 8a48066b (a still player is furniture) is in.
2. **A second dismissal reversed the way back (major) — real, fixed (26cb76cf).** `dismiss()` is a no-op in
   `'returning'`. Red: the old early return (`stroll` only) → exit 1, 171 ✓ 2 ✗
   (`st9/red-kids-double-dismiss-2.log`): `✗ dismissed at her cushion, and again 2 s into the way back … the
   longest any stayed up against a solid Juno 101, Lark 76, Fenn 393 frame(s) (60 allowed …); furthest off her
   ways Juno 3.33 m, Lark 1.29 m, Fenn 0.72 m` and the turn-back clause (Fenn 1346 frames, 2.80 m).
3. **The gathering failed with her standing still where she most likely stands (major) — real, fixed
   (4e8be41a, then the wait):** measured on this tree first, with 8a48066b in: at central[5] Lark gave up; at
   central[4] Juno and Lark gave up (36 s). A child held off a point by a player standing still (stood still
   1 s; the point's arrival disc inside her `PLAYER_SEPARATION`) now walks on **along lines asked of the real
   world** — straight to the next point, or round the player by places on a ring 0.3 m outside her distance
   (Dijkstra, 24 places, neighbour steps), each line swept at KIDS' 0.55 m body and kept outside her distance
   (the driver is handed `CollisionWorld.isClearCircle` by `Library`). No way round: she **waits, looking at
   the player** (never pushing into her and the furniture beside her), and on the way to the rug settles to
   listen within `KID_NO_WAY_SECONDS` (5); her own cushion with the player on it: she listens at once.
   KIDS stands her still at the desk (CONTROL: 8.3/10.4/13.9 s), central[5] (8.4/10.1/13.9), central[4]
   (9.4/10.8/15.4), and in the two gaps with no way round — between the west armchair and cushion 4 (1.4, −9.5)
   (Juno settles at 12.8 s) and between the stacks and cushion 2 (3.0, −6.4) (Lark at 14.5 s): everyone at her
   cushion or listening within the control's slowest + 6 s, nobody leans on furniture (≤ 60 frames; Fenn's
   20-frame brush past the east armchair's corner on her declared leg is in the control too), the way back
   past her measured too, she is never shoved (0.000 m). Reds (each `st9/red-*.log`):
   - no way round (held never seen) → 176 ✓ 6 ✗: `Lark NEVER` at central[5]; `Juno NEVER, Lark NEVER` at
     central[4]; the armchair gap `within 34.8 s`; leans of 363 and 356 frames.
   - unchecked lines (`lineClear` always true) → 172 ✓ 10 ✗: leans 295/590 frames, children never back to
     their stroll, the gather over the bound.
   - no waiting (pushes on with no way round) → 181 ✓ 1 ✗: `Juno 369 frame(s)` against the armchair.
4. **A give-up on the way back started an unswept stroll (minor) — real, fixed (26cb76cf):** the same declared
   leg is begun again. KIDS holds Juno's way back up past the timeout with a 0.5 m disc on (0.5, −8.3) for
   35 s: still `'returning'` a second past the timeout, then on along her way. Red (the old `resumeStroll()`)
   → 171 ✓ 2 ✗: `… a second past the timeout she is still 'stroll' …`, `… 2.21 m off her circuit five seconds on`.
   The driver's header no longer claims more than KIDS sweeps; KIDS also rehearses the dismissal mid-walk and
   once at the cushion (CONTROL: 0 frames, ≤ 0.30 m off), and a summons on the way back (`turnBack`: every
   child back at her cushion in 2.1 s). **A summons on the way back now turns her round** along the declared
   way (it was ignored until she strolled — a story called as the last one's children walk off would have
   started without them).
5. **endSeated's comment (minor) — real, fixed:** it describes the solid cushion and points at `setDown`.
6. **Two owners (minor) — real, fixed:** `residentLook(rng)` in `residentLooks.ts` draws the six in the hotel's
   order for both (check:hotel re-run below); `KID_ROUTE_ARRIVE` imports `WaypointDriver`'s exported
   `ARRIVE_RADIUS`.

**The instrument, and one call it makes (decision):** "up against a solid" = a body of `NPC_RADIUS + 0.01`
not clear, away from her own cushion. A child squeezed there **by another child passing** (another within
`SEPARATION`) is the crowd's push-apart, `check:npc-separation`'s ground — reported as `squeezed`, not a lean
(at central[4] on the way back Juno is squeezed 142 frames against the west armchair as Lark passes; moving
her waypoint 15 cm east did not change it, so the plan's (0.5, −8.3) stands).

## Restart: the part-4 milestone (23 Oct 2026, Opus 5.5) — Step 9 verified, Step 10, main merged, PR #733 moved

**What changed in the plan (23 Oct):** PR #722 (the engine) is merged into main (6d70f695, a true merge
of fccadf8b). Library v2 now ships as **two PRs**: **#733 is part 4** (#718: the owl, the card, the
recommendation, the shush, the three children, the cushions, story time; base `main`, head
`feat/library-v2-pr`), and **part 5** (#719's den, dragon and cat, and the six chapter books) follows
on `feat/library-v2b`, stacked on #733, built by other engineers. This section is the part-4 restart.
Scratch: `.claude/library-build-scratch/fin/` (logs end `exit=N`; `byhand.py`/`reds-step9.py` for
by-hand reds, which revert and restamp themselves).

### Step 9 (story time, 1adbe142..65d1c029) — verified

Read: `storyTime.ts` (clock 40 s then 150 s, inside only, waits for the owl's script; gathering →
reading on all seated/gave up + perched, or 40 s; dispersing; `abort()`), `LibraryOwl.flyTo/owlFlightPose/
owlPerch/putSolidBack`, `NpcCharacter` hops (0.4 s, seated throughout), `Library` wiring (stepped first in
`update`, aborted in `standOutside` and `releasePlayer`), `/library?story=now` (`parseLibraryLink` →
`Game.enterLibrarySpawn(at, story)`), the Story listener row. `check:library` at 65d1c029 (seed 5 honest
park, restamped 91b0be94): **exit 0, 203 ✓, "All clauses passed."** in 27 s (`fin/library-baseline.log`).
STORY: 'Fireflies at Night' read, called 0.0 s, reading 15.5 s after, last word 21.9 s later; Juno 9.5 s,
Lark 10.1 s, Fenn 15.9 s on their cushions, 0.000 m off; longest child step 0.065 m; perched 0.000 m off
`owlPerch()` (4.00, 0.36, −11.19); 0 of 3460 owl points touchable; 3 pets out over 2437 frames, 0 seated;
the card; all up 0.4 s after, the owl home 3.2 s. FLIGHT: 448 of 802 samples over a solid, least margin
0.60 m (desk → chair t 0.485 at (5.04, 3.80, −2.57) over a 3.20 m top); live owl 0.00 cm off.
CLOCK 40.02 s. ABORT left at 'gathering'.

Reds the earlier engineer proved (logs `st9/`, geometry: seed 5, room at (−600, −600), cushion-1 room
(2.1, −8), the owl's spot (6, 5.3), the story chair's perch (4.00, 0.36, −11.19), the stacks 3.20 m):
`no-story` → 11 ✗ incl. `✗ STORY ASSERTS NOTHING: story time never reached 'reading' in 150 s (phases seen: idle)`;
`block-cushion` → 1 ✗ `Juno NEVER on cushion-4` (the story still read); cruise − 1 by hand → `✗ … her feet at
least -1.00 m over its top (0.3 wanted …) her cruise 2.20 m against the stacks' 3.20 m`; perch on the seat
centre → `✗ … 99 of her 3460 visible points … e.g. (4.06, 1.15 up, -10.53) from a child at (4.00, -9.90)`;
no card → `✗ … Story listener card: false`; `STORY_SIT_SECONDS = 0` → `✗ … the longest step … 1.019 m (0.1 allowed …)`;
the solid put straight back on landing → `✗ … the child was moved 0.600 m (0.01 allowed)`; the deep link without
`requestStoryTime` → `check:deep-links FAILED … story=now (startFresh): inside, but story time did not start within 5 s (phase idle)`.

**CLOCK and ABORT had no red. Proved now** (`fin/red-*.log`, each reverted and restamped):
- `clock -= dt * 2` (storyTime.ts idle) → exit 1, 202 ✓ 1 ✗: `✗ with the clock let go, a fresh visit's first story is called 20.00 s in (STORY_FIRST_AFTER 40 s; the clock started at 40 s)`.
- `abort()` without the children's `endSeated`/`setDown` → exit 1, 202 ✓ 1 ✗: `✗ left by the door mid-story (it was 'gathering', a child sitting: true): … nobody left sitting (Juno SEATED, Lark returning, Fenn returning) …`.
- `standOutside` without `owl.leave()` → exit 1, 202 ✓ 1 ✗: `✗ left by the door mid-story … the owl home behind her desk (at desk false, flying false, perched true) and solid there (false) …`.
- `standOutside` without `storyTime.abort()` → exit 1, 201 ✓ 2 ✗: CLOCK `called NaN s in (… the clock started at 150 s)` and ABORT `(it was 'idle', a child sitting: false) … the next visit's clock at 64.97 s` — the clock never restarted.

Fixed on the way: `Library.ts`' `playerIsSeated` doc comment had been split from its getter by story time's
getters, and `update()` carried two overlapping order comments (476b3afd, comments only).

### The three reviews' findings — each verified on this head

Integration: (1) the primitive picture vocabulary (`pictureProps.ts`, `createStoryCloud`, `'prop'`/`'stormCloud'`)
is **unreachable in the game at this head** — `git grep` finds it only in `check-book-reader`'s model sheet and
fixtures; `CHAPTER_BOOKS` is `[]` and no picture book names either model. Track D's cece064a replaces it with the
Artist's story-props kit in the **part-5 PR**; not edited here, because a second edit of the same hunks would
conflict with the stacked branch. Recorded as a decision in the PR body. (2) Get up on the cushion's top:
`standUp()` → `endRide({ y: LIBRARY_FLOOR_Y + libraryCushionSize().top })`; red `st9/red-getup-floor.log`
(157 ✓ 1 ✗, 1.250 m). (3) The den shell (Step 11's floor, walls and lintel) is primitive and **hidden** at this
head (`denRoot.visible = false`; the lintel is drawn flush in the west wall's own paint); the den kit replaces
it in the part-5 PR — a decision line in the PR body. (4) The jet-pack pocket: the question for Jim says it is
invisible. (5) The PR body's look-at links are rewritten for part 4.
Owl: (1) `standingReach` over every desk pose, measured apart in the check; reds `st9/red-owl-radius-0.8.log`
(158 ✓ 3 ✗), `-rest-only` (160 ✓ 1 ✗), `-flap-sideways` (159 ✓ 2 ✗). (2) `talk()`'s guard: red
`st9/red-owl-talk-no-guard.log` (156 ✓ 5 ✗).
Children: (2) `dismiss()` returns in `'returning'` (libraryKidDriver.ts:315), red `red-kids-double-dismiss-2.log`;
(3) the still-player gathering, reds `red-kids-no-way-round-2.log` (176 ✓ 6 ✗), `-unchecked-lines-2` (172 ✓ 10 ✗),
`-no-wait` (181 ✓ 1 ✗); (4) the way back resumes its declared leg, red `red-kids-giveup-strolls.log`; (5)
`endSeated`'s comment; (6) `residentLook(rng)` draws skin, hair, outfit, hair style, backpack, its colour in the
hotel's old order (diffed), `KID_ROUTE_ARRIVE = ARRIVE_RADIUS` (exported). (1) jitter/crowd: re-run below.

### Step 10 — labels scene 5 and tap spacing (e61b49f8, 56ba141a)

`check:labels` scene 5, the Library: the owl's card (the visit lasts her four card lines, `lineSeconds` the one
owner), `Say hello!`, the first shelf book's `Read it!`, then **story time with her sat on cushion 1** (30 s: call,
flight, gathering, reading; `Get up` up under the owl's bubble). Coverage asks each visit what it was for — the card
held, a book recommended, her seated, the reading reached — not only that a chip was up.
- **Found, not planted** (the uncommitted scene as I found it, `fin/labels-1.log`, exit 1): the 10 s card visit
  ended before the 11.3 s card script, so the second press landed mid-ceremony and recommended nothing while the
  scene printed "the owl selected 2 of 2 visits": `FAIL E coverage: … the library owl never recommended a book`.
- Green (`fin/labels-2.log`): exit 0, 15983 frames at 390x844, library 3413 frames; "the owl selected 2 of 2 visits
  (her card handed over, a book recommended), a shelf book's chip up, story time on 1800 frames (1138 reading) with
  her sat on her cushion"; 55 labels, no overlap.
- Control, the library scene alone (scenes 1–4 skipped by hand, `fin/labels-libonly-control.log`): no A–D failure
  in 3413 frames. Red, the same with `LABELS_MUTATE=overlap` (`-overlap.log`): `FAIL A overlap: 2327 occasion(s).
  First: library-owl-says [actionFeedback over library-owl] at (175,292)–(348,342) and player [playerName over player]
  at (173,337)–(217,371) overlap by 43x4 px, frame 90 (library)` — the scene has real collisions to resolve.
- Red, the owl's bubble dropped from `Library.screenLabels` (`fin/red-labels-no-owl-bubble.log`): exit 1,
  `check:labels: the library owl's labels are not all registered (1 of 1 missing)`.

`check:tap-spacing` prints each space's own counts on stderr now. **The library: 15 zones (Talk, 12 Read, 2 Sit),
1 portal band, 15 zone-band and 0 close zone-zone pairs**; totals 10 spaces, 146 zones, 27 bands, 246 zone-band,
20 close pairs, 20 same-action warnings (none the library's); OK.

### origin/main merged (d68e60b4) and #733's red CI run 39864355905

`git -c rerere.enabled=false merge --no-ff origin/main` (6d70f695, #722's true merge of fccadf8b): main's tree equals
fccadf8b's, already here — no conflict, the merge's diff against its first parent is empty; package.json's
`scripts` equal on both sides (179 names, 0 differ, parsed).

Run 39864355905 (head b438b695, `gh run view --log-failed`, `fin/ci-39864355905-failed.log`):
- **Shard 1, check:flat-primitives**: `NEW FLAT PRIMITIVE src/entities/Player.ts:1828 [Y_DIFFERENCE] p.y -
  this.hoverAt.y` and `src/world/library/reader/pagePictures.ts:286 high - low`. The first is gone at its root (the
  engine's 0807890d: her altitude in her own column, `altitudeAt`); the second is genuinely flat (a pet model's own
  local bounds on the reader's flat stage) and carries `flat-ok` since f19cd1fc. **Re-running shard 1 here found three
  more** (`fin/runs/ci1/check:flat-primitives.log`, exit 1): `scripts/check-library.mts` `feet <= 0.02`
  [Y_THRESHOLD] (KIDS) and `owl.feet.y - expected.y`, `owl.feet.y - perch.y` [Y_DIFFERENCE] (STORY) — room-local
  heights and points in the reading room's own flat space; `flat-ok` with that reason (3b0bce86). After: exit 0, "no
  new flat primitives", 106 flat-ok sites.
- **Shard 3, check:jitter**: `worst own step : 2.743 m (Theo) bound 1 m … first: frame 2085, Theo … (-20.94, 12.72)
  near Sunny Side`. Root: a child waiting at Sunny Side was shoved off the platform onto the track by children
  walking to the same waiting spot, and `offTheLine` set him down 2.74 m in a frame; fixed by the engine's 0807890d
  (two places to wait per platform, a waiting child holds her ground, the set-down a declared `setDown`), on main.
  Here: exit 0, 34 children, worst own step 0.177 m (Luca), bound 1 m — deterministic (fixed dt, seeded park; the
  same numbers on every run since round four).

### The look (headless Chrome, `channel: 'chrome'`, throwaway profile; my dev server on 6621, killed by PID)

`fin/look/look.mjs`, shots in `fin/look/shots/` at 1280x800 and 390x844: the card hand-over, the recommendation,
a jump's "Shhh!", story time from cushion 1 (call, gathering, reading, dispersal). No page errors.
- **Found: the owl's reading bubble was cut by the bookcases behind the story chair** — "A day in the pa…", "You
  close your ey…" (`desktop-9-reading-later.png`). `SpeechBubble` is depth-tested; her bubble's quad, facing the
  camera from over the chair, reaches back into the wall cases. **Fixed (a9145107):** her bubble's material draws
  over the scenery (`depthTest` off; LABELS.md: a label floats over the world); other bubbles unchanged. STORY now
  measures it — a 9 × 5 grid over the painted pill and tail on the camera's axes, rays from the game's camera against
  the room's and the children's opaque drawn meshes: **6 of 45 points stand behind `library.books.2`** (e.g. room
  (4.65, 2.79 up, −12.27), the books 0.06 m nearer the camera), drawn over the scenery → ✓. **Red** (the line removed
  by hand, `fin/red-owl-bubble-depth-tested.log`): exit 1, 203 ✓ 1 ✗ `… it is drawn DEPTH-TESTED, so it is cut there`.
  After: `desktop-fix-9-reading-later.png` reads "A day in the park with friends!" whole.
- **For visual QA / Jim:** from cushion 1 the child on the cushion straight in front of the chair sits between the
  camera and the owl, so while she reads mostly her glasses show over the child's head (`desktop-fix-8-reading-zoom.png`).
  The seats are the plan's (Step 7/8); moving them moves the children's routes, so they are left for him to judge.
- **Seen once, the engine's, not the library's:** `dismount: no clear, open spot within 4 m of (-594.00, 0.81,
  -591.30)` — the desk front at her jump's height, right after a page navigation mid-jump. Most likely the restore
  of a save written mid-air: `floorOf` refuses a 0.81 m lift with no velocity, so the put-down finds nothing and
  hands back the exit (she drops 0.81 m). Harmless, but loud; for the engine's owner.

### Checks at the part-4 head (seed 5, the honest park restamped; logs `fin/runs/<tag>/`; exit codes read)

| check | exit | off the screen |
|---|---|---|
| tsc --noEmit · typecheck:test | 0 · 0 | |
| check:library | 0 | **204 ✓**, "All clauses passed." (203 + the bubble clause) |
| check:labels | 0 | 15983 frames, 55 labels, no overlap; library 3413 frames as above |
| check:tap-spacing | 0 | library 15 zones, 1 band, 15 zone-band, 0 close pairs |
| check:brevity | 0 | 356 pieces, 6 recorded exceptions; the Library 45 lines, 10 titles; secrets 7 names, 7 lines |
| check:exits | 0 | "check:exits OK"; the library 795 exits, 155 off the lattice, 0 nowhere; both Sit chips "→ its own Get up chip" |
| check:hotel · check:npc-presence | 0 · 0 | 34 children (7 hotel residents) · "npc presence OK" |
| check:jitter | 0 | 34 children, 9000 frames, worst own step 0.177 m (Luca), bound 1 m |
| check:served-deep-links (port 6611) | 0 | 22 OK, 0 FAILED; `/library?at=2.1,-8&facing=148&story=now` → "story time 'gathering' within 5 s" |
| check:served-book-reader (port 6613) | 0 | 1054 ok, 0 FAIL, "check:book-reader passed" |
| **every other step of `check`** (all 83 distinct, parsed off package.json; served ones on 6615/6617) | all 0 | `fin/runs/sweep/summary.txt` |
| seed 5's procgen invariants + test/library + library-card | 0 | 5 files, 137 passed |
| check:coplanar, seed 5 only, every space (by hand: `shippedSeeds()` → [5]) | 0 | 183 seams, none new; 3 BASELINE LOOSE, all garden seams of other seeds |
| build | 0 | |

### Decisions (part 4; also in the PR body)

1. **Get up stands her on the cushion's top where she sat** (reversing decision 2 above) — the put-down rule's clause 2
   accepts a solid's top; beside it she popped a stride sideways into the listening children.
2. **The owl's solid covers her as drawn** (0.668 m over every desk pose), and the card flap goes forward over her desk
   rather than out to her side — growing her solid to the sideways wing (0.89 m) would be an invisible blocker.
3. **The owl's bubble draws over the room's furniture** (above).
4. **Story time reads picture books only** (`storyTimeMayRead`): a chapter page is a paragraph, too long for a bubble.
5. **A child held off her way by a player standing still** goes round her on lines the real world says are clear;
   with no way round she waits looking at her, and on the way to the rug settles to listen within 5 s.
6. **The primitive picture vocabulary of the books2 WIP** (`pictureProps.ts`, `createStoryCloud`, `'prop'`/`'stormCloud'`)
   is unreachable in the game at this head and is replaced by the Artist's story-props kit in the part-5 PR — not
   edited twice. **The den's walls, floor and lintel** (Step 11) are primitives hidden behind the shut shelf here; the
   den kit replaces them in part 5. Both transitional.
7. Kept from before: the lintel's top is the wall's (5.20 m); the big readers' shelf waits for its six books, loudly.

### Questions for Jim (no new blocker or guard was added)

- **The jet pack and the hidden den.** The library never lowers the fly ceiling, so with the jet pack she can fly over
  the 5.2 m west wall into the den pocket; its floor and walls are hidden while the shelf is shut, so she stands on an
  invisible floor among invisible walls until she flies out (not a trap). Part 5's Step 12 (the den shown whenever she
  is in it; the shelf opening the moment she is found inside) closes it. Sooner would need a banded ceiling over the
  den (an invisible blocker) or the guard brought forward.
- **From cushion 1 the owl is half hidden behind a child while she reads** (above) — move the cushions?

### For part 5 (`feat/library-v2b`, stacked on #733)

- Merge `origin/feat/library-v2` at the part-4 head (with `-c rerere.enabled=false`). New since the tracks were cut:
  476b3afd (Library.ts comments round `playerIsSeated`/`storyPhase` and `update()`), a9145107 (`LibraryOwl`'s
  constructor: the bubble's `depthTest`; STORY's bubble clause), e61b49f8 (check-labels scene 5 — the plan's cat and
  dragon visits join it), 56ba141a (tap-spacing's per-space lines: part 5's library line should read 18 zones and 2
  bands), 3b0bce86 (flat-ok lines in check-library). **Run check:flat-primitives** after adding den/creature clauses:
  check-library's own room-local heights need `flat-ok`, and nothing else here catches it.
- Story time, the cushions, the owl and the children are part 4's and on main once #733 merges; Step 12's guard is
  what answers the jet-pack question above.

### The milestone

PR #733 retitled "The Library, part two: the owl librarian, the children and story time", body rewritten for part 4
(`Closes #718` only; the den, dragon, cat and chapter books named as the next, stacked PR; decisions, questions,
visual QA, checks; frames on `qa-screenshots` @ 858434dc, `733-library-part-two/`). **Head moved by fast-forward
b438b695..118468c3** (`git push origin feat/library-v2:feat/library-v2-pr`). CI run **39943305407** (and Update
adoption 39943305406) started on 118468c3 — not waited for. Everything after 118468c3 on this branch is handoff only.

## CI round 1 (23 Oct 2026, Opus 5.5) — the review of the join judged, then #733's CI to green

Scratch: `.claude/library-build-scratch/r1/` (`runs/<tag>/<check>.log` ending `exit=N seconds=S`; `run-checks.sh`;
`byhand.py <tag> <check> <file> <old> <new> …` applies a by-hand mutation, restamps, runs, reverts, restamps;
`compare-scripts.mjs`, the parsed step-set comparison). Geometry for every red below: seed 5's honest park
(restart 1, digest d6721090fb3f1d3a) restamped to each tree's hash; the reading room at (−600, −600); cushion 1 at
room (2.1, −8); the owl's desk spot (6, 5.3); her perch (4.00, 0.36, −11.19); check:library's screen 1280×720,
check:labels' 390×844. Baseline at e994f322: check:library exit 0, 204 ✓; check:labels exit 0, 15983 frames.

### The three findings, judged — all three real, all fixed

1. **No check saw the child miss the owl's story words (major) — real.** Read: `LibraryOwl.update` anchors the bubble
   only while she speaks; STORY's bubble clause measured whatever sprite was there and only *noted* a 0-of-45 result;
   check:labels scene 5's coverage asked only that the reading was reached. **Fixed (4ae3835a):** STORY resolves the
   label manager every frame (`world.labels.resolve(view, CHILD_DT)`, Game.tick's order) and asserts (a) **her bubble
   follows her** — on every frame she speaks, the tail read off the bubble (`worldAnchor`) is within 0.02 m of
   `OWL_BUBBLE_OVER_HEAD` (now exported, one owner) over her live head: control 191 frames on the wing, 1333 on the
   chair, 0.000 m; (b) **the child can read the story** — drawn on 1316 of the 1316 frames she reads aloud; (c) the
   depth clause passes only for her own bubble (tail over her head, drawn). check:labels scene 5 counts, while she
   reads, the frames her bubble / the Get up chip / both were drawn (1138/1138/1138) and her bubble on the wing (152
   of 191); a coverage gap if any is 0. Reds (each reverted):
   - `LibraryOwl.update` without `this.anchorBubble();` → check:library exit 1, **203 ✓ 3 ✗**: `✗ her bubble follows
     her: … its tail was at most 16.615 m from 0.42 m over her head (0.02 allowed), the worst on the chair 3.2 s in,
     the owl's feet at room (4.00, -11.19)`, `✗ … drew the owl's bubble on 0 of the 1316 frames she read aloud`,
     `✗ … hers, its tail 16.615 m off over her head (0.02 allowed), drawn false: 0 of 45 points …`
     (`r1/red-f1-anchor-lib.log`); check:labels exit 1, `FAIL E coverage: 3 occasion(s). First: the library owl's
     bubble was never drawn while she read the story` — bubble 0, chip 1138, both 0, wing 0 of 191
     (`red-f1-anchor-labels.log`).
   - Sit zones `selectableWhileRiding: false` (no Get up chip) → check:labels exit 1, `FAIL E coverage: 2
     occasion(s). First: the story cushion's Get up chip was never drawn while the owl read` — bubble 1138, chip 0,
     both 0 (`red-f1-no-getup-labels.log`).
2. **Only the first half of the story clock was checked (minor) — real.** `grep`-free: read CLOCK/ABORT/STORY;
   nothing reads `nextIn` after a landing or a second story. **Fixed (56a72882):** STORY asserts story time idle
   with one more story told (0 → 1) and its clock at STORY_EVERY (150 s); CLOCK lets the clock go after that landing
   and asserts the next call **150.00 s** on (2 frames allowed) reading **a different book** ('fountainWish' after
   'fireflies'); and **whole rounds**: the real `StoryTime` with a stand-in owl (always free, perched, quiet; no
   children; four frames a story), 14 stories each for three recommendations (STORY's book all along; nothing; the
   order's last book from story 12): the first 12 all different and every story-time book among them, the
   recommended one first, never the same twice running. Reds (each reverted):
   - `this.clock = 5` at the landing → exit 1, **207 ✓ 2 ✗**: `✗ … the next story's clock set to 5 s (STORY_EVERY
     150 s)`, `✗ … the next story is called 5.02 s on (STORY_EVERY 150 s; the clock stood at 5 s)` (`red-f2-every-5s.log`).
   - the plan's old pick rule (`recommended ?? ORDER[storiesTold % n]`) → exit 1, **208 ✓ 2 ✗**: `✗ and it reads a
     different book: 'fireflies' after STORY's 'fireflies'` and the rounds clause `fireflies → fireflies → …` ×14
     (`red-f2-old-pick-rule-rounds.log`).
   - the new round without holding back the last book → exit 1, **209 ✓ 1 ✗**: `recommending 'duckBars' from
     story 12: … ripikaBalloon → duckBars → duckBars → fountainWish (TWICE RUNNING: 12→13 'duckBars')`
     (`red-f2-no-last-guard.log`).
3. **The over-the-scenery choice was made outside SpeechBubble (minor) — real.** `LibraryOwl` wrote
   `bubble.sprite.material.depthTest = false` though `SpeechBubble.material` is private, and cited a LABELS.md rule
   that is not there. **Fixed (d14252b6):** `SpeechBubble`'s third argument `{ overScenery?: boolean }` (default off:
   every other bubble stays depth-tested and looks as before); the owl passes it; LABELS.md gains "Drawn over the
   scenery" (who uses it, why, and that extending it is a visible change for Jim), and its check:labels section
   now says five scenes and the Library's coverage. STORY's depth clause is the guard. Red: the option removed by hand
   → exit 1, **203 ✓ 1 ✗**, `… 6 of 45 points … behind 'library.books.2' … it is drawn DEPTH-TESTED, so it is cut there`
   (`red-f3-no-overscenery.log`).

### Decision (Jim away; also in the PR body)

8. **Story time reads a different story every time.** Measuring the second story found the plan's rule
   (`recommended ?? ORDER[storiesTold % 12]`, Step 9) reading "Fireflies at Night" twice running, and — while a book
   glows — at **every** story time (the red above: fireflies ×14). Now: the recommended book if no story has read it
   this round, else the first of the owl's order not read this round; a round ends when every book has been read
   once, and the next never begins with the one just heard (`storyTime.ts`, `pickBook`). The first story of a visit is
   unchanged (still the glowing book), so every first-story check reads as before. Reason: a six-year-old enjoys a
   new story more than the same one again, and the plan's own words are "the recommended book, else the next in the
   seeded order".

### Checks at 56a72882 (exit codes read, counts off the screen)

| check | exit | off the screen |
|---|---|---|
| `tsc --noEmit` · `typecheck:test` | 0 · 0 | |
| scripts typecheck instrument (`r1/tsconfig.scripts.r1.json`, the reviewer's 18 scripts) | 2, as at e994f322 | 63 messages, the same set (positions ignored) — none new |
| `check:library` | 0 | **210 ✓, 0 ✗** in 32 s (204 + bubble follows her + can read the story + idle at landing + next call + different book + whole rounds) |
| `check:labels` | 0 | 15983 frames; library: bubble 1138, Get up chip 1138, both 1138 of 1138 reading; wing 152 of 191 |
| `check:flat-primitives` | 0 | "no new flat primitives, and no stale baseline entries" |
| `check:chain-coverage` | 0 | "every one of the 98 check:* leaf scripts is reachable from CI" |
| `check:seed-coverage` | 0 | "every one of the 16 parks a child can be given is built by a merge-blocking check" |
| `check:speech-bubbles` · `check:brevity` | 0 · 0 | 1110 crowd-bubble sightings, 3 set-once probes · 356 pieces, 6 exceptions |

**package.json, parsed (`r1/compare-scripts.mjs`, never grepped):** HEAD vs `origin/feat/engine-solids`: 179 names,
added [], removed [], changed [] — every step set EQUAL: `check` 9, `check:shard-1` 26, `-2` 4, `-3` 17, `-4` 15,
`-5` 8, `-6` 4, `-7` 6, `-8` 1, `-9` 2, `check:all` 6, `check:crowd` 5. Part 4 adds no script. `origin/main` and
the PR head 118468c3 are the same 179. `git diff --stat origin/feat/library-v2-pr...HEAD`: 7 files, every one this
round's (LABELS.md, check-labels, check-library, SpeechBubble, LibraryOwl, storyTime, this handoff); vs main 19 A,
38 M, no deletion.

**LABELS.md corrected before the CI run (66549d88):** the dodgems' giggles are also drawn
over the scenery (`giggles.ts` builds their sprites with `depthTest: false`, since 48bf4bcc; a `SpriteLabel`'s
sprite is its maker's), so "Drawn over the scenery" lists two labels and says who decides each — the first text
said the owl's was the only one.

**Not measured, for whoever owns the owl next:** a Talk press at the desk after a story sets her text outside
`LibraryOwl.update`, so for that one frame the label manager measures her bubble where it was last anchored
(the perch, since she flies home silent) at the previous line's scale; the next update re-anchors it. If the perch
is on screen from the desk, that is a one-frame flash there. Anchoring in `say()` would close it.

### For part 5 (`feat/library-v2b`) — new on this branch since 118468c3

d14252b6 (`SpeechBubble`'s `overScenery`; the owl's constructor; LABELS.md), 4ae3835a (STORY's bubble clauses and
`world.labels.resolve` in its loop; `OWL_BUBBLE_OVER_HEAD` exported; check-labels scene 5's bubble/chip/wing
counts), 56a72882 (`storyTime.ts` `pickBook` and its `heard`/`lastHeardId`; STORY's landing clause; CLOCK's next
story and whole rounds, which now **open** the CLOCK block and let the clock go before the fresh visit). Merge
`origin/feat/library-v2` with `-c rerere.enabled=false`; the creature bubble (part 5) is depth-tested unless it
asks for `overScenery` — add it to LABELS.md's table if it does. Re-run check:flat-primitives after merging.

### CI on the final head — green

- **PR #733's head moved by fast-forward 118468c3..9a269a31..66549d88** (`git push origin feat/library-v2:feat/library-v2-pr`).
  The run on 118468c3 (39943305407) had finished green first (88 success, Deploy skipped). The run on 9a269a31
  (39952880544) was cancelled by the push of 66549d88 three minutes in, in its Parks stage, so nothing was lost.
- **CI 39953269843 on 66549d88: completed, success** — 88 jobs success, 1 skipped (`Deploy`, which runs only on
  main). Parks re-solved for the new source hash c7182d44 (stage A blocks 0–1 for all 16 seeds, stage B blocks 2–15
  for seeds 10 and 14, as on 118468c3); `Checks` and `Procgen invariants` (the two required checks) pass; Checks
  shards 1–9 and build, Procgen invariants shards 1–6, Coplanar faces, Entrance road, Every seed builds, Swept bus,
  Walk reach, PR preview all pass. **Update adoption 39953269896: success** ("A reload gets the new build").
  `gh pr checks 733`: 89 pass, 1 skipping (`r1/checks-66549d88-final.txt`).
- Longest shards: 3 at 21m12s, 5 at 19m31s, 8 at 17m09s (`timeout-minutes: 30`).
- Preview (from the newest "Deploy PR preview" comment): `https://pr-733-66549d8-land-of-good-places.blockstack.workers.dev`
  — HTTP 200 for `/library?at=2.1,-8&facing=148&story=now`; its `version.txt` is 996d9e34, the PR's merge ref
  (66549d88 into main), as every pull_request build is.
- Everything after 66549d88 on this branch is handoff only.

## Browser QA round 1 — the fixes (23 Oct 2026, Opus 5.5)

QA's report: head 66549d88, not approved, 2 major + 6 minor; screenshots and scripts in
`.claude/library-build-scratch/l4qa-1/`. Scratch for this round: `.claude/library-build-scratch/qa1/`.

### Each defect judged (screenshots opened, code read)

1. **Major — she stands inside the perched owl: REAL.** `LibraryOwl` had one solid, the desk
   capsule; perched she relied on the chair's own solids, and the seat is a top (0.36 m) she can
   jump onto. Measured: the chair's seat box x 3.57..4.43, z −11.354..−10.610; the perched owl
   (rest pose) x 3.366..4.634, y 0.348..1.979, z −11.650..−10.566; QA landed on the seat at
   (3.8, −10.7), 0.53 m from the perch (4.00, −11.19). Her shush wing at the perch reaches
   0.740 m forward (toward the rug), past the chair's front face.
2. **Major — the owl lands inside her at the desk: REAL.** `putSolidBack` deliberately left her
   drawn but not solid where the child stood. The same class covers take-off and the whole
   flight (her flight had no solid at all): a child at (6, 4.0) — 1.3 m north of her spot — is
   in her climb's way (at t 0.1 her feet are 1.9 m up, 0.46 m north).
3. Minor — the card greyed in the backpack: REAL (the card is the only backpack item with no
   action; `InventoryDrawer` marks such a row `data-available=false`, drawn at opacity 0.5).
4. Minor — Big reader unearnable at this head: REAL (`SECRETS` lists it, `CHAPTER_BOOKS` is []).
5. Minor — the card sparkles under her bubble: REAL (spawned 0.3 m over her head, the bubble's
   tail is 0.42 m over it and the bubble draws over the scenery).
6. Minor — the outbound flight hidden by her call bubble: REAL (the call is said on the wing).
7. Minor — the owl hidden from cushion 1: judged below.
8. Minor — the glow hard to spot from the desk: judged below.

### Design decisions (Jim away; each also goes in the PR body)

- **The owl is solid wherever she is drawn, and never moves into anybody.** At rest she is a
  capsule — her desk's (as before) or **the story chair's** (new, 'the owl on the story chair',
  radius her drawn reach over every pose she holds perched, the shush wing included). **On the
  wing she is one moving body** (`CollisionWorld.addMovingBox`, a disc: rounding = her drawn
  reach at the widest beat of her wings), moved with her every frame, base at her feet and top
  at her head — the train's kind of solid. **Like the train, she waits for anybody in her way**:
  before each step of a flight she asks whether her body there would touch the child, her pets
  or the library's children (cylinders: their radius and height); if it would, she holds where
  she is — on the ground at take-off, hovering in the air on the way, over the child's head on
  the way down — and goes on the moment the way is clear. No new blocker: these are her own
  solids, where she is drawn.

### The majors — fixed (64e02d9c, 8f063e18, 5c02a0d7, 12533eff)

- `LibraryOwl`: **'the owl on the story chair'** — a zero-length capsule at `owlPerch()` (4.00, −11.19),
  r = `perchReach` (her drawn reach perched, breath ±, head straight, wings down: **0.663**), top = seat 0.36 +
  `owlTop` (**2.011**), registered through `props.wall` (so held to every keep-out) and detached until she
  perches. **On the wing one moving body** (`CollisionWorld.addMovingBox`, now with a `rounding`: a disc,
  r = `flightReach` **0.877** — wings at the widest beat, head anywhere in ±1, shush wing up or down, breath ±),
  base her feet, top her feet + `owlTop`, moved every flight frame; out of the world at rest. **The wait**:
  before each flight step, `wouldTouch(next pose)` against every bystander (`Library.owlBystanders`: the child
  r 0.62, the library's three children r 0.5, each pet out of the backpack r 0.22 — all `KID_HEIGHT` tall, with
  `OWL_HEADROOM` = one step 0.62 over a head); touching → she holds this frame (`waited`, `waitingFor`). Take-off
  = the first step taken (her capsule out, the body in); landing hands over to the capsule she lands in (no
  wider than the body). `putSolidBack`/`solidWaiting` are gone. `World.attachParade` gives the library the parade.
- **`owlTop`** (1.651 = her head at the top of a breath; rest pose 1.619): every solid of hers stands to it —
  found by NEVER INSIDE HER: with the rest-pose top a breath in pushed her ear tufts up through the feet of a
  child stood on her head.
- **`OWL_HEADROOM`** (one step): found by NEVER INSIDE HER — hovering 10 cm over the head of a child stood on the
  chair's seat edge, the owl took the headroom of the arm (a step she could climb), the arm became a wall,
  and the wedge rescue put her down on cushion 4, 1.25 m away.
- **A shush on the story chair is her face alone**: the shush wing reaches 0.740 m forward, 0.16 m past the
  chair's front, over the rug; covering it would hold every child 16 cm off the chair all story long.
- **The call is said at her desk, then she flies** (`storyTime` `flyWhenSaid`): every flight silent.

**Instrument (check:library NEVER INSIDE HER):** every visible point of the owl (3460, the room frame) inside the
real child's cylinder (r 0.62, 2.12 m, from her feet) by more than 0.03; CONTROL: a cylinder on the owl's own feet
holds 3015 of her points, one 2.5 m north holds 0. Scenarios (seed 5, room (−600, −600), the desk spot (6, 5.3),
the perch (4.00, 0.36, −11.19), the chair's seat box x 3.57..4.43, z −11.354..−10.610, top 0.36; arms to 0.717;
cushions 4 (3, −9.5) and 5 (5, −9.5), top 0.36): (1) 9 hops at the seat with her on it, from (4.0, −9.95) on
the floor and from the tops of cushions 5 and 4 (QA's stick (−0.55, −0.85) / (0.55, −0.85), jump at 0.06/0.15/0.3 s,
stick let go at 0.45 s); (2) the child on the seat first (QA's recipe from cushion 5's top → (3.81, −10.73)), the
owl comes, waits, perches after she goes; (3) the child in the desk spot, the owl comes home, waits through 3 hops,
lands after she walks out north and east; (4) the child 1.31 m north of the owl at take-off; (5) the child on her
head (feet 1.651). Green at 5c02a0d7: **221 ✓ 0 ✗**, every scenario "inside her on 0 of N frames" (864, 434, 670,
409, 433; 3578 watched); she waited for the child (and a pet) where she should, for nobody in STORY.

**Reds** (each by hand, reverted, restamped; logs `.claude/library-build-scratch/qa1/red-*.log`):
- (a) the chair solid never attached (`if (flight.home) this.props.attach(...)`) → exit 1, **219 ✓ 2 ✗**:
  `✗ solid on the chair: the top over her perch was 0.360 m …` and `✗ the seat with the owl on it (QA's major): …
  the owl drawn INSIDE HER on 312 of 864 frames — the worst hopping at the seat from the top of cushion 5, the jump
  0.3 s in: 1095 of her 3460 points inside the child, e.g. (3.89, 0.64 up, -10.89); the child's feet at room
  (3.68, 0.54 up, -10.41)` — QA's Defect B (`red-qa1-a-no-chair-solid.log`).
- (b) the wait taken out (`if (false && this.wouldTouch(...))`) → exit 1, **217 ✓ 4 ✗**: the desk spot
  `… landed on her: true; the child moved 1.347 m … the owl drawn INSIDE HER on 31 of 667 frames — … 2787 of her
  3460 points inside the child, e.g. (5.80, 0.07 up, 5.35); the child's feet at room (6.14, 0.00 up, 5.68)` — QA's
  Defect A; the seat first (770 points, moved 1.625 m), beside her (`desk solid still under her (false)`), on her
  head (410 points) (`red-qa1-b-no-wait.log`).
- (c) her solids' top at the rest pose (`this.top = this.handle.height`) → exit 1, **8 ✗**: OWL `top 1.619 m against
  her drawn top at her tallest breath 1.651 m`, the chair solid's top 1.979 vs 2.011, and on her head `2 of her 3460
  points inside the child, e.g. (6.43, 1.65 up, 5.30); the child's feet at room (6.00, 1.62 up, 5.30)` (`red-qa1-c-rest-top.log`).
- (d) no headroom (`OWL_HEADROOM = 0 * BUILDING_STEP_UP`) → exit 1, **219 ✓ 2 ✗**: `the child moved 1.250 m meanwhile …
  still up on the chair: false` and `✗ … 1 wedge put-down(s) while the owl waited` (`red-qa1-d-no-headroom.log`).
- (e) the call said on the wing (`this.owl.flyTo(false)` in `begin`) → check:library exit 1, **219 ✓ 2 ✗**: `✗ her
  flights are silent …: she spoke on 191 of her 382 frames on the wing` and `… 0 at her desk, the call … — SHE NEVER
  SPOKE AT HER DESK`; check:labels exit 1, `FAIL E coverage: … the owl's bubble was never drawn while she called story
  time from her desk (0 frames she said it)` (`red-qa1-e-call-on-wing*.log`).

Other checks at 12533eff: check:labels exit 0 (library: her call drawn on 208 of 208 frames at the desk, 0 frames
spoken on the wing; reading bubble 1368, chip 1369, both 1368); check:flat-primitives, check:tap-spacing,
check:solids, check:exits (235 s), check:brevity all exit 0 (`qa1/runs/g1`, `g2`).

### The minors (745cb651, cbe0b608, 9a2fe385, 7965e947, a79c265f)

3. **The card greyed in the backpack — fixed.** `InventoryDrawer`: a row with no action is a keepsake
   (`data-keepsake`), drawn at full strength; still `aria-disabled` (no press promised). check:book-reader item 11
   (served): the owl's own press hands the card over, `I` opens the backpack, the card's row reads opacity **1**,
   aria-disabled; CONTROL: the same row given `data-available='false'` by hand reads **0.5**. Green: 1056 ok.
   **Red** (the old two lines back, `red-qa1-g-card-greyed.log`): `FAIL her library card in her backpack … drawn at
   opacity 0.5, aria-disabled true, keepsake null (3 rows)`.
4. **Big reader unearnable — fixed.** `SECRETS` lists `secret.bigReader` only while `CHAPTER_BOOKS` holds a book
   (the shelf the one owner; `state/secrets.ts` reads the data-only `chapterBooks/index.ts`). At this head the dex
   has 6 secrets, total 76; with part 5's books the card comes back by itself. vitest `chapter-books` case 4.
   **Red** (`|| true`, `red-qa1-f-bigreader-listed.log`): `Tests 1 failed | 12 passed (13)` — `Big reader listed:
   true, with 0 chapter book(s) on the shelf`. **For part 5:** nothing to do; the row appears with the books.
5. **The card sparkles under her bubble — fixed.** Their own pool (`cardSparkles`, 12, sky blue, 0.55 m), in three
   clouds across the desk from a little her side of its middle to past its front edge (`cardHandOver`: the desk's
   spot and measured top); the card waved high (`CARD_FLAP_LIFT` 2.0 rad, `FLAP_SECONDS` 1.4 — at the top of the
   wave the wing is back inside her solid's reach, 0.665 m; mid-wave past it only over the desk, bins −50..−30°).
   CARD measures every live sparkle on the 1280×720 screen against her bubble's painted rectangle (pill + tail,
   projected): **852 sparkle-frames on 71 frames of the hand-over line, 0 behind her bubble**. **Red** (the old puff
   over her head, `red-qa1-h-sparkles-over-head.log`): `708 of them behind her bubble … e.g. a sparkle at (758, 404) px
   inside her bubble's (672, 369)–(830, 417)`. Found on the way: a cloud from the desk's back edge rose into her
   bubble's tail (46, then 1 of 852) — the clouds start nearer the child.
6. **The flight under her call bubble — fixed** (with the majors: she calls at her desk, then flies; reds above).
7. **The owl hidden from cushion 1 — judged real, not fixed here: a layout question for Jim.** Measured (headless
   Chrome, 1280×800, the reading owl's drawn pixels with the children there against with them hidden, one paused
   moment, `qa1/look/occlusion.mjs`): **15.4 % of her hidden from cushion 1, 7.4 % from cushion 3** — her face and
   glasses show, her body is behind Fenn's head on cushion 5 (5, −9.5). The camera looks along (−x, −z) from 38°,
   nearly orthographic, so whoever sits south-east of the chair covers her. Moving cushion 5 off that line runs into
   the plan's seat rules (two children ≥ SEPARATION 1.8 m, a child and her cushion ≥ PLAYER_SEPARATION 1.52 m —
   cushion 3 is 1.75 m from 5); **moving the story chair 1 m east** (to (5, −11.1)) clears every seat (screen
   offsets ≥ 1.19 m) but puts the chair off the rug's middle. Both are visible changes to a merged layout (#716)
   and the plan's Decision 13 — for Jim; the PR's question is updated with these numbers.
8. **The glow hard to spot from the desk — fixed.** A **beacon**: one sky-blue sparkle (0.7 m) every 0.25 s rises
   off the top of the glowing book's own case, right over it (`glowBeaconBase`: its bookcase kind's measured
   height + 0.1) — a little column of light over the stacks. RECOMMEND at the desk's front for 3 s: a sparkle in
   the open over `stack-3-3` (3.20 m), on screen and in clear view of the camera (a ray from it past every opaque
   room mesh), on **171 of 180 frames** (724 sparkle-frames, 0 hidden). **Red** (the beacon's puff removed,
   `red-qa1-i-no-beacon.log`): `on 0 (0 sparkle-frames …)` — the book's own twinkles never rise over its case.
