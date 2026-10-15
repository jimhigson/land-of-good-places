# HANDOFF — The Library, track C: the den's walls, the secret shelf, the dragon and the cat (plan Steps 11-13)

Branch `feat/library-714-den`, cut from the foundation head **bb4eb46f**
(`feat/library-714`); worktree `.claude/worktrees/library-714-den`. Engineer, Claude Opus 5.5.
The plan is `docs/library-build/PLAN-parts-4-5.md` (on this branch). This track is plan
Steps 11, 12, 13. **Step 11 is done** (the den's walls: a gap in the west wall, a lintel, a
walled pocket, west-2 still seals it), the LIGHT sweep over den cells included. Steps 12-13 are
not started.

Scratch logs: `/Users/jim/dev/landOfGoodPlaces/.claude/library-build-scratch/den/`. Scratch
instruments (not committed): the session scratchpad's `den/digest-world.mts` and
`den/coplanar-library.mts` (copies of their output are the `digest-*.json` and
`coplanar-library.log` logs).

## Status
- [x] Worktree from bb4eb46f, `pnpm install --frozen-lockfile` (pnpm/12.1.0, node v26.5.0), pushed.
- [x] Baseline on the untouched foundation code, seed 5 restart 1 hydrated from a copy of
      `library-714/.parks` (source d283ffaa…, the same hash): `check:library` **exit 0, 60 ✓,
      0 ✗**, 12 s (`baseline-library.log`).
- [x] **Step 11 src — 9eddc691**: `layout.ts`, `shell.ts`, `Library.ts` (below).
- [x] **Step 11 check — 594ca537**: `check-library.mts` (below).
- [x] Parks at this branch's hash **a04bfcb4…** (`LGP_SEEDS=5 LGP_RESTART_LANES=4 pnpm run
      build:parks`, exit 0, 512 s): restart 0 rejected by check:coplanar (243 s) — as at the
      foundation — and **restart 1 accepted as shipped (134 measures), digest 06641bf963e37aa6**,
      proven. `.parks/` in this worktree holds it.
- [x] Final runs on that park (hydrated, no solve): every number below.

## What Step 11 built
- **`layout.ts`** — `LIBRARY_DEN_DEPTH` 5.6; `LIBRARY_DEN_DOOR_HALF` 2 (asserted against the
  measured case in `shell.ts`); `LIBRARY_DEN_INNER` {west −23.9, north −7.6, south −2.0} (north is
  the doorway's north edge less a named `DEN_NORTH_PAST_DOOR` 1.6); **`libraryDenContains(x, z)`**,
  the one owner of "she is in the den" (x < −17.7, x ≥ −24.2, −7.9 ≤ z ≤ −1.7);
  `LIBRARY_DEN_DOORWAY_STAND` (−19.6, −4.3, 270) and `LIBRARY_DRAGON_STAND` (−21.3, −5.0, 225),
  both `den: true`, both in `libraryStandSpots()` (so both are keep-outs); `LIBRARY_DRAGON_NEST`
  (−22.6, −6.3, 45); `LIBRARY_SECRET_BOOK` {shelf 1, along 0}; `sconce-west-1` z −6 → −8 (it hung
  on the new north jamb; no pool, so the rig is unchanged). The two stands and the nest are held
  to `libraryDenContains` at module load (a throw).
- **`shell.ts`** — `libraryDenGap()` = the secret case's z ± its measured length/2 = [−6, −2],
  throwing unless it is `LIBRARY_DEN_DOOR_HALF` within 0.02. `buildReadingRoomShell` now returns
  `{ walls, westWall, westMaterial, lintel, fabric }`: the west wall is two spans (drawn z
  −12.7..−6 and −2..12.7) plus **the lintel** (drawn x −18.3..−17.7, y 3.2..5.2 — the case's
  measured height to the wall's — z −6..−2), all in the group `library.westWall` with one cloned
  material. The lintel's collider: `addWall(OX−18, OZ−6, OX−18, OZ−2, 0.3, Infinity, false,
  false, base)` with **base = floor + case height − `JUMP_CLEARANCE_GRACE` − `LINTEL_OVERLAP`
  (0.05) = 3.00 m**, registered raw. **`buildLibraryDenShell(denRoot, props, surfaces,
  fabric)`**: the floor slab x −24.5..−18.6 (abutting the room floor's apron edge), z −8.2..−1.4,
  in the room floor's own material, and a plate x −24.5..−17.7; walls through `props.wall`:
  `den wall (west)` (−24.2, −7.9)→(−24.2, −1.7), `den wall (north)` (−24.2, −7.9)→(−18.0, −7.9),
  `den wall (south)` (−24.2, −1.7)→(−18.0, −1.7), half 0.3, `'wall'`; drawn boxes west x
  −24.5..−23.9 z −8.2..−1.4, north and south x −23.9..−18.3 (abutting the room wall), the south
  one hidden. All `LIBRARY_WALL_HEIGHT`.
- **`Library.ts`** — `denRoot` (`the-library-den`) a child of `roomRoot`, `visible = false`,
  built after the props and before the furniture; `denWalls`, `lintel`, `westWall`,
  `westMaterial` exposed. `furnish.ts` is unchanged: west-2 is still a case with its collider, so
  the den is sealed.

## The check (check:library) — 70 ✓, 0 ✗ at a04bfcb4 (`final-green.log`, exit 0)
Line-for-line against the baseline (`diff`, timings and the trace dropped): only the den's lines
changed. CONTROL 1 12602 → 12975 cells reached; REACHABILITY 137 → 140 solids; MARCHED, AISLES,
LANDING, FACADE, STEPS, DOORS, FADE, the room's LIGHT, READABLE, PAINTED FACES and WITH A REAL
CHILD are byte-identical. Counts off the screen:
- **Fill domain**: `onFloor = onPlate ∪ libraryDenContains`, scanned from
  `floor((LIBRARY_DEN_INNER.west − 1)/CELL)`.
- **CONTROL 1** (both shells, no furniture, so nothing in the doorway): `the fill floods the
  empty room: 12975 cells reached`; the hollow rectangle `169 clear cells … unreachable`; and
  **new**: `with nothing in the den's doorway the fill walks into the den: 2 of 2 den spots and
  353 den cells reached`.
- **REACHABILITY (closed)**: `the fill leaves the arrival: 8785 cells reached of 9111 clear`;
  `every keep-out in the reading room is reachable: 64 of 64`; `no keep-out in the secret den is
  reachable while the secret shelf is shut: 2 of 2 sealed off`; `the one pocket is the secret
  den: 326 clear cells are unreached, 326 of them inside libraryDenContains (more than 50 wanted)
  and 0 anywhere else; the other 8785 clear cells are all reached`.
- **DEN WALLS** (12 bodies on a 4 x 3 grid from the den's inner faces, x −23.08..−19.12, z
  −6.78..−2.82, each marched west, north and south at 0.05 and `PLAYER_LONGEST_STEP` 0.93):
  `12 of 12 bodies stood in the den, 72 marches …: 0 ended outside the den and the room`; `each
  wall stopped them at its drawn face — deepest a body's edge got past it: west (−X) 0.000 m, north
  (−Z) 0.000 m, south (+Z) -0.000 m (at most 0.03, and some body within 0.05 of every face)`.
- **LINTEL**: the plan's flier at the case top + 0.8 = 4.00 m from x −16 along z −4 at both
  strides `stops at x -17.08: at the lintel (at least -17.11), and past where the shut shelf stops
  a walker (-16.51)` (the second bound is its vacuity guard: it cleared the shelf); **every
  height** 0..6.2 m at 5 cm, both strides: `250 marches … the furthest west any got is x -17.08
  (at 3.10 m), at least -17.11 — the shut shelf holds her below 3.05 m, the lintel from 3.00 m`;
  **CONTROL**, the shut shelf's 3 colliders out (and put back): `a walker on the floor passes under
  the lintel into the den (to x -23.28), and the flier at 4.00 m still stops at x -17.08`.
- **LIGHT**: `the darkest patch of the secret den's floor, (-23.0, -7.0), renders at 0.0580
  linear, brighter than PALETTE.ink's 0.0509 (25 den cells measured)` — cells x −23..−19, z −7..−3,
  derived from the den's faces; stderr: `0.0421 from the room's lights + 0.0160 lift … lit by the
  fill and the key, 8 pools in the room and none added for the den`. The room's darkest is
  unchanged (−17.7, −5.7) 0.0580. `8 lamp pools (budget 8)`.
- **HOUSEKEEPING**: `the secret den is built in the reading room ('the-library-inside') … and is
  hidden while the shelf is shut`; stderr `the secret den: 3 walls; the lintel's band from 3.00 m
  over its doorway z -6.00..-2.00`.

## Reds (each proved at a04bfcb4, seed 5 restart 1, digest 06641bf963e37aa6, hydrated; reverted)
Geometry they were proved against: the den's inner faces x −23.90, z −7.60 / −2.00; the doorway
z −6..−2 in the wall at x −18.3..−17.7; west-2's collider (the shut shelf) x −17.7..−17.1, z
−6..−2, absolute top 3.20; the lintel band from 3.00 m; the flier at 4.00 m; bodies as above.
- **Plan red 1 — `LIBRARY_CHECK_REMOVE='den wall (west)'`** → exit 1, `7 clause(s) FAILED`
  (`red-denwall.log`):
  ```
  ✗ a body marched west (−X) from (-23.08, -6.78) at 0.05 m a step ended at (-35.08, -6.78), outside the den and the room
  ✗ 12 of 12 bodies stood in the den, 72 marches (3 headings, 5 cm and the sprint stride): 24 ended outside the den and the room
  ✗ each wall stopped them at its drawn face — deepest a body's edge got past it: west (−X) 11.825 m, north (−Z) 0.000 m, south (+Z) -0.000 m (at most 0.03, and some body within 0.05 of every face)
  ✗ CONTROL, the shut shelf's 3 colliders out: a walker on the floor passes under the lintel into the den (to x -28.00), and the flier at 4.00 m still stops at x -17.08 — the lintel alone holds her
  ```
  (plus three more per-body lines like the first). REACHABILITY stays green: the den is still
  sealed, its pocket now reaches to x −24.2, all inside `libraryDenContains`.
- **Plan red 2 — `LIBRARY_CHECK_MUTATE=no-lintel`** → exit 1, `4 clause(s) FAILED`
  (`red-nolintel.log`):
  ```
  ✗ a flier at 4.00 m (the shut shelf's top + 0.8), marched west at 0.05 m a step from x −16, stops at x -23.28: at the lintel (at least -17.11), …
  ✗ a flier at 4.00 m (the shut shelf's top + 0.8), marched west at 0.93 m a step from x −16, stops at x -23.28: …
  ✗ 250 marches at every height from the floor to 6.2 m, 5 cm apart, both strides: the furthest west any got is x -23.28 (at 3.10 m), at least -17.11 — …
  ✗ CONTROL, the shut shelf's 3 colliders out: a walker on the floor passes under the lintel into the den (to x -23.28), and the flier at 4.00 m still stops at x -23.28 — the lintel alone holds her
  ```
- **Plan red 3 — `LIBRARY_CHECK_REMOVE='bookcase west-2'`** → exit 1, `9 clause(s) FAILED`
  (`red-west2.log`):
  ```
  ✗ inside the secret den's doorway at (-19.60, -4.30) IS reachable with the secret shelf shut — the den's doorway is open
  ✗ beside the baby dragon at (-21.30, -5.00) IS reachable with the secret shelf shut — the den's doorway is open
  ✗ no keep-out in the secret den is reachable while the secret shelf is shut: 0 of 2 sealed off
  ✗ bookcase west-2's middle IS reachable — it is not solid
  ✗ the one pocket is the secret den: 0 clear cells are unreached, 0 of them inside libraryDenContains (more than 50 wanted) and 0 anywhere else; the other 9197 clear cells are all reached
  ✗ bookcase west-2: a body's edge got 0.631 m into it (allowance 0.071)
  ✗ 43 drawn boxes, 610 marches; deepest a body's edge got into one: 0.631 m (bookcase west-2), allowance 0.071
  ✗ the walls hold: 2 of 48 marches left the room other than through the door
  ✗ 250 marches at every height … the furthest west any got is x -23.28 (at 0.00 m), at least -17.11 — …
  ```
- **LIGHT's den clause — `LIBRARY_CHECK_DARK=1`** (fill and key to 1e-4) → exit 1, `2 clause(s)
  FAILED` (`red-dark.log`): `✗ the darkest patch of the secret den's floor, (-23.0, -7.0), renders
  at 0.0160 linear, brighter than PALETTE.ink's 0.0509 (25 den cells measured)` and the room's.
- **By hand — the fill's domain without the den** (`onFloor` returning `onPlate` alone) → exit 1,
  `2 clause(s) FAILED` (`red-byhand-domain.log`): `✗ with nothing in the den's doorway the fill
  walks into the den: 0 of 2 den spots and 0 den cells reached …` and `✗ the one pocket is the
  secret den: 0 clear cells are unreached, 0 of them inside libraryDenContains …` — while `✓ no
  keep-out in the secret den is reachable …: 2 of 2 sealed off` **stayed green vacuously**: that is
  why the domain has a control. (The unchanged check against the new src showed the same blind
  spot: `oldcheck-newsrc.log` reported no pocket at all.)
- **By hand — a sealed pocket in the reading room** (a hollow `addRectangle(OX − 9, OZ + 8, 1.6,
  1.6, 0.2)` dropped before REACHABILITY's fill) → exit 1 (`red-byhand-stray.log`): `✗ 49 clear
  cell(s) outside the secret den are unreachable — a pocket a child could be stuck in: (-9.75,
  7.25) (-9.75, 7.50) …` and `✗ the one pocket is the secret den: 375 clear cells are unreached, 326
  of them inside libraryDenContains (more than 50 wanted) and 49 anywhere else`.

## Other measurements
- **The park did not move; only the library did.** The World this code builds from the
  foundation's seed-5 file (d283ffaa…) and from this branch's own file (a04bfcb4…) digest the same,
  **06641bf963e37aa6** (6740 meshes) — so the two files are the same park. Against the
  foundation's code on the foundation's file (9acd3a626f55d35c, 6734 meshes; a temporary detached
  worktree at bb4eb46f, removed after), **9 of 795 mesh names differ**, all this step's:
  `library.den.floor`, `library.den.wall.{north,south,west}`, `library.lintel` (new),
  `library.sconce-west-1.{body,glow,outline}` (moved), `library.wall.west` (split).
- **No coplanar faces** (`coplanar-library.log`): `sweepCoplanar` over the reading room's root
  (the hidden den included — the sweep ignores `visible`): 0 pairs. CONTROL: a twin of the den's
  floor slab added in the hidden den is reported, 3 pairs (40.12 m² top, 3.40 m² +X, 2.95 m² +Z).
  Needed because park acceptance's coplanar measure is garden-only (`gardenCoplanarRegressions`);
  CI's `check:coplanar` sweeps interiors on seed 0 only.
- `pnpm exec tsc --noEmit` exit 0; `pnpm run typecheck:test` exit 0. The scripts instrument
  (`foundation-checks/tsconfig.scripts.json` re-pointed here: `den/tsconfig.scripts.json`):
  exit 2 with **the same 56 errors, file by file, as the foundation** (52 environmental, 4 on
  main's check-castle.mts); CONTROL: a deliberate `const brokenOnPurpose: number =
  library.lintel` in check-library.mts → 57, naming it; reverted.
- `check:tap-spacing` exit 0: 10 spaces, 131 zones, 27 portal bands; 231 zone-band and 20 close
  zone-zone pairs; 20 same-action overlaps — the foundation's numbers (`tap-spacing.log`).
- `check:labels` exit 0: 12570 frames (plaza 4224, castle shops 1278, hotel lobby 708, reptile
  house 6360); 54 labels registered, up to 8 at once; no overlap — the foundation's numbers
  (`labels.log`).

## Parks, on this branch
Every src file here is in the park source closure, so each src commit has a new hash. The den
changes nothing the park plan reads (`parkManifest.ts` takes only `LIBRARY_FOOTPRINT_RADIUS`,
`LIBRARY_BOUNDING_RADIUS`, `LIBRARY_STEPS_FRONT_Z` from `layout.ts`), and the digest proof above
shows seed 5 did not move. **For iterating on `check-library.mts` (outside the closure)
after a src edit:** `LGP_PARK_FILE=<park file> pnpm run check:library` hydrates from that file
whatever the source hash (`scripts/ts-extension-resolver-register.mjs`); the foundation's seed-5
file is kept at `library-build-scratch/den/park-d283ffaa/5.json`, and this branch's at
`.parks/5.json` (a04bfcb4…). Then build the park at the new hash once for the final runs (8.5
min with `LGP_RESTART_LANES=4`).

## Decisions (with reasons)
- **The den shell takes the room's paint as a fourth argument**
  (`buildLibraryDenShell(denRoot, props, surfaces, fabric)`; the plan's signature has three).
  The plan wants the den floor "in the room floor's material": `buildReadingRoomShell` returns
  its floor and wall materials as `fabric`, and the den borrows them, so one material is the
  floor in both — and LIGHT reads that one material's albedo and lift for the den cells too. A
  second, equal material would be two owners of one paint.
- **The den's walls are the room's wall green** (`fabric.wall`, shared with the north, south and
  east walls — never the west wall's cloned material, which fades in Step 12). The plan does not
  say; one room, one paint.
- **The floor slab's apron and thickness are named** (`FLOOR_APRON` = 2 × `LIBRARY_WALL_HALF`,
  `FLOOR_THICKNESS` 0.5) in `shell.ts`, because the den floor must abut the room floor's edge
  exactly; the room floor keeps the same values (1.2 = 2 × 0.6, ±0.6, −0.25), proved by its
  unchanged mesh digest.
- **`LINTEL_OVERLAP` (0.05)** names the plan's "− 0.05" in the lintel's base.
- **Den spots are held to `libraryDenContains` at module load** (a den stand or the nest moved
  outside the den throws).
- **Beyond the plan's clauses, inside its step** (each a superset of what the plan asks):
  CONTROL 1's den line (the fill's domain holds the den — without it the closed-state "den spots
  not reached" passes vacuously, proved above); DEN WALLS at both strides and against each wall's
  drawn face, with a reached-the-wall guard per heading; LINTEL's vacuity guard (past where the
  shelf stops a walker), its every-height sweep (the case/lintel band overlap), and its CONTROL
  with the shut shelf's colliders out; LIGHT's den cells derived from `LIBRARY_DEN_INNER` (they
  come out as the plan's x −23..−19, z −7..−3); HOUSEKEEPING's denRoot line. The REACHABILITY note
  now counts readable slots from `LIBRARY_READABLE_SLOTS.length` (it typed 12).
- **The header list keeps its numbering**: DEN WALLS and LINTEL are described under item 5
  (MARCHED), whose kind they are, rather than renumbering items the other tracks also append to.

## For the join (and for Steps 12-13 on this track)
- **Between Step 11 and Step 12 the den is a sealed, hidden pocket.** Nothing reaches it, but a
  hand-typed `/library?at=<a den spot>` would stand her in it with no way out until Step 12's guard
  (open the leaf instantly whenever she is in the den with it shut). Step 11 must not ship without
  Step 12; the track merges whole.
- **`layout.ts` `libraryStandSpots()`**: this step adds `LIBRARY_DEN_DOORWAY_STAND,
  LIBRARY_DRAGON_STAND` after `LIBRARY_SECRET_STAND` in the opening array; track A removes
  `LIBRARY_LIBRARIAN_SPOT` from the same array and track B appends the cushion seats, so expect a
  textual conflict there: keep all three changes.
- **`check-library.mts`**: this step rewrote the fill (`onFloor`, the scan), CONTROL 1,
  REACHABILITY (room and den keep-outs, the den-only pocket clause, the note — which now derives
  the readable-slot count), added `marchAt`, DEN WALLS and LINTEL after MARCHED, LIGHT's den cells,
  and a HOUSEKEEPING line; `removedOnPurpose` records `LIBRARY_CHECK_REMOVE`'s victims. Track A's
  OWL (the owl added to AISLES/MARCHED) and track D's READABLE (the typed twelve) touch
  neighbouring lines. **Track A: the librarian's spot leaves the keep-outs, so REACHABILITY's
  room count drops by one; the den count stays 2.**
- **Step 12** (this track): the leaf's closed set must keep the name `bookcase west-2` — LINTEL's
  CONTROL finds the shut shelf's colliders by `bookcase west-2 (`, and REMOVE reds use it. In the
  open state, the plan's swaps apply (the box-middles loop and MARCHED take the open footprint;
  the walls-hold marches at z −5.20 and −3.12 go through the doorway into the den and must be
  judged room ∪ den); `the one pocket is the secret den` becomes "zero pockets" there.
- **Step 13** (this track): DEN WALLS' bodies are a fixed 4 x 3 grid over the den and must all
  stand clear; the nest's disc at (−22.6, −6.3), radius ≈ 0.83, will cover the grid's north-west
  bodies — place the bodies clear of the den's own solids by name (never silently skip one).
- **check:coplanar on CI** sweeps interiors on seed 0 only; the reading room measured 0 pairs
  here (interiors are seed-independent).
- Story time (Step 9) counts while she is "in the library (the room or the den)" and the owl's
  shush is suppressed in the den: both ask `libraryDenContains` (exported from `layout.ts`).
