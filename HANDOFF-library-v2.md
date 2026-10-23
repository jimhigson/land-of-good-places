# HANDOFF — Library v2 on the engine: the integration branch (`feat/library-v2`)

Engineer, Claude Fable 5.1, 22 Oct 2026. Epic #714; this branch finishes #718 (the owl
librarian, story time) and #719 (the secret den, the dragon, the cat) and adds the six chapter
books, all on top of the engine rework (PR #722, `feat/engine-solids`). Worktree
`.claude/worktrees/library-v2`; scratch logs `.claude/library-build-scratch/wf/`. The plan is
`docs/library-build/PLAN-parts-4-5.md`; the old track handoffs (`HANDOFF-library-owl.md`,
`-kids.md`, `-den.md`, `-books2.md`) are on this branch too and still describe what each track
built.

## Branches and the PR

| branch | what |
|---|---|
| `feat/engine-solids` @ 003d6489 | the engine (PR #722's work branch), **merged in whole at 679c3b31** (round four; it was 2aa9da02 before — see "Engine round four merged" at the end) |
| `feat/engine-solids-pr` @ fccadf8b | PR #722's head (base of the Library v2 PR); an ancestor of this branch since 679c3b31 |
| **`feat/library-v2`** | **this integration branch**: engine + the four tracks + the API adaptation. Tracks A–D cut their branches from its head. |
| `feat/library-v2-pr` | the draft Library v2 PR's head; moved only at milestones by a fast-forward push (`git push origin feat/library-v2:feat/library-v2-pr`), never force |

**The PR: #733** (draft), head `feat/library-v2-pr` @ b438b695, base `feat/engine-solids-pr`
(#722's head, 8e8d318a). Body: stacked on #722, what is in, what is still being built, the six
decisions, the question for Jim, "What to look at", the checks; `Closes #718` / `Closes #719`.
Raise no other. ~~`origin/feat/engine-solids` has moved on~~ — **done: round four (003d6489)
is merged at 679c3b31** (no conflicts; see "Engine round four merged" at the end). **#733's CI
at b438b695 (run 39864355905) is red** on shard 1 (check:flat-primitives) and shard 3
(check:jitter); both are fixed on this branch at f19cd1fc and green locally — the next
fast-forward of the PR head takes them.

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
