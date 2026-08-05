# HANDOFF — bridges over the railway (#116)

Engineer `E2-interact`. Branch `feat/railway-bridges`, worktree
`.claude/worktrees/railway-bridges`, dev server port **5321** (not yet started).
`npm ci` run **inside this worktree** — see the trap note in
`HANDOFF-interact-chip.md`; without it you silently build against the shared
checkout's `node_modules`.

Spec: `REQUIREMENTS-2026-07-28.md` §7. Family ruling, 28 July: paths cross the
railway on hump-back or wooden bridges, never level crossings.

## Base — now plain `origin/main` (rebased 5 Aug, after #196)

PR #196 merged, putting `fix/paths-to-nowhere` **and** the returned-complaints
`Invariant` contract on `main` together. Both legs of the old stack are gone,
so this branch was rebased onto `origin/main` and is now **six commits, four
files**: `ARCHITECTURE-DECISIONS.md`, `HANDOFF-railway-bridges.md`,
`scripts/check-park.mts`, `src/world/train/trainModel.ts`.

**Rebasing was not optional, and the reason is worth knowing.** #196 squash-merged
`04d50f6` ("Review fixes: correct the facePaint attribution, close the
stand-point hole…"), which this branch's base (`0608fbf`) predates. Left alone,
merging this branch would have **reverted** those fixes — `stalls.ts` back to
recomputing its own stand point from `STALL_STAND_DISTANCE` instead of reading
`STALL_STANDS_BY_ID` (the exact split issue #114 exists to close), plus the
corrected face-paint attribution in `paths.ts`. A stale base is a silent revert,
and a squash merge is what hides it: `git merge-base --is-ancestor 0608fbf
origin/main` says **NO**, so nothing warns you.

After the rebase those three files no longer appear in the diff at all, which is
the check that it worked.

Contrary to a mid-flight warning: **`main` is already fully consistent with the
new contract.** `type Invariant = (facts) => readonly string[]`, the runner
asserts on the return value, and both #114 invariants `return` their complaints —
the only `expect(` calls left are the runner and the sanity block. There is no
outstanding migration and `invariants.ts` is byte-identical to main here.

## Historical: the base this branch started on

Neither is on `origin/main`; both are local-only, each 2 commits ahead, and
**neither contains the other**:

- `fix/paths-to-nowhere` (0608fbf) — the path graph a bridge must join
  (`paths.ts`, `parkFacts.ts`'s new `pathNodes`/`pathEdges`).
- `chore/invariant-return-complaints` (e3de651) — `Invariant` is now
  `(facts) => readonly string[]`.

Branched from the **commit** 0608fbf, not the branch name, so it cannot move
under me; then merged the other in. **This PR cannot merge until both land.**

Note issue #114 is still OPEN with no PR. Part of its work (`STALL_STANDS` in
`poiGraph`/`stallPlacement`/`LampPosts`/`parkFacts`) *is* on main already, which
is probably what read as "landed"; the `paths.ts` half is not.

### The merge is textually clean and semantically broken — already fixed here

`paths-to-nowhere`'s two new invariants asserted internally with `expect` and
returned nothing; the runner now does
`expect(check(facts), describeComplaints(...))`. Merged, they hand `undefined`
to `describeComplaints`, which throws. **`test/` is not in `tsconfig`'s
`include`** (fix in flight as #192), so nothing typechecks it — only a red test
tells you. Proved red (2 failed / 17 passed, canonical seed), converted both to
`return complaints`, now 95 passed across five seeds.

**Write the new invariant as `return complaints;` with no `expect` of its own.**

## Four findings that change the shape of this work

Found before writing any code. In rough order of how much they cost.

### 1. `NavGrid` cannot represent a bridge at all — the real work

`NavGrid` is strictly 2D: `private height = new Float32Array(0)`, one height per
cell, indexed `cz * cells + cx`. There is no second layer, so "under the bridge"
and "on the bridge" cannot both exist.

Worse, the lattice is built with **one fixed `referenceY`** (`0` in both
`check-park.mts` and `parkFacts.ts`), and `WalkSurfaces.sample` clamps to
`ceiling = y + BUILDING_STEP_UP` = **0.62 m**. A deck 2+ m up is therefore
invisible to `sample()` — `NavGrid` reports terrain and routes straight into the
fence, and `check-park.mts:470`'s `park.sample(hit.x, hit.z, 0)` returns terrain
so `overBridge` is **structurally always false**. A gentle ramp does not escape
this; the ceiling is fixed for the whole lattice.

The precedent to copy is `RampDefinition` with `space: 'garden'` — its own doc
says the entrance steps are "the only thing in the game that is walkable and
lives out in the park". But its footprint is an **axis-aligned `RectRegion`**,
which will not fit an obliquely-crossing deck, and garden ramps are measured
relative to `BUILDING_CENTRE_X/Z` — the wrong origin for a bridge at r≈40-55.
`WalkSurfaces.addPlatform`/`MovingPlatform` is the more flexible hook: arbitrary
`covers(x, z)` predicate, already used for the train's own platforms.

### 2. `BRIDGE_RISE = 2` is too small — a compliant deck decapitates the train

`check-park.mts:354` sets `BRIDGE_RISE = 2`, honestly documented as derived
"because there are no bridges yet". The locomotive's `funnelTip` is
`CAR_FLOOR_Y + 1.84 = **2.42 m**` above the sleeper top (`trainModel.ts:153`).
And `crossesTrack` returns `rail` = **terrain** Y, not the rail head
(`RAIL_HEIGHT = 0.17` is never added), so the test is `deck − ground ≥ 2` while
the physical requirement is `soffit − (ground + 0.17) ≥ 2.42`.

Both the constant and the datum need restating, derived from `trainModel.ts` in
the spirit of the existing `RAIL_OVER_RAIL = 5.5` rather than declared.

### 3. `LEVEL_CROSSING_REACH` is an undefined identifier — fix before starting

`check-park.mts:485` references `LEVEL_CROSSING_REACH`; `grep -rn` across the
whole repo returns **that one line**. `scripts/` is not in `tsconfig`'s
`include` and the script runs under `node --experimental-transform-types`, so
this is a live `ReferenceError` that fires **the instant invariant 2 finds a
violation**. It has never been hit because the measured count is 0. Left alone,
the first bridge that fails reports as a crash with a stack trace instead of the
finding. **Fix this first**, or debugging is needlessly awful.

### 4. The fence blocks routing over the deck

"Fence continuous beneath the bridge" (§7) collides with `NavGrid`: fence
collision walls are `addWall(..., 0.18)` with default `topHeight = Infinity` and
`autoHoppable = false` — deliberately ("the fence is a rule, not a hurdle"), so
`NavGrid` stamps them blocked at every height. The deck's own cells sit directly
above fence walls and get blocked with them.

Same problem for NPCs: `poiGraph`'s `lineIsClear` is purely 2D
(`collision.resolve(probe, 0.7)`, Y ignored), so two nodes either side of a
bridge get **no edge** — and an edge may form spuriously between a deck node and
the ground beneath it.

**Do NOT widen the collider-top test to fix this** — I nearly did, and it is a
trap. `Collision.forEachWall` does pass `topHeight` through, and `NavGrid` does
already skip colliders on a height test, so it looks like the seam. But using it
requires the fence to declare a finite `topHeight`, and
`Collision.resolve`'s `clearance` is *feet height above local ground, positive
mid-jump*. The fence is 0.95 m of post; `JUMP_APEX_HEIGHT` ≈ 1.28 m. Give the
fence a real top and **a child can jump the railway fence** — Decision 4 §6's
"keeping feet off the track" gone. The `Infinity` is load-bearing.

The mechanism is the reverse: **a cell the deck `covers(x, z)` is exempt from
stamping.** What makes that safe under a single-layer lattice is that the thing
under a bridge is the fenced rail corridor, which is *already* not walkable — so
the grid only chooses between two surfaces where one was never available.

Same treatment for `poiGraph.lineIsClear`, for the same reason. Recorded as a
correction in ARCHITECTURE-DECISIONS Decision 6, with the carry-forward
constraint: **nothing may give the rail fence a finite `topHeight`.**

## Where the crossings are today

`src/world/train/crossings.ts` — `computeCrossings(route, stationDistances)`
returns `LevelCrossing { x, z, railDistance, pathDirX, pathDirZ, halfGap }`,
called once in `ParkTrain`'s constructor and exposed as `train.crossings`
"so `check:park` knows where feet may cross".

**Keep the detection, change what it emits.** It is the only thing that knows
where paths and rails meet. Today it produces a fence gap
(`fence.ts:61-66`) plus seven decorative timber planks with no collision and no
`WalkSurfaces` entry (`fence.ts:219-235`). A bridge means: no gap, and a real
raised deck plus ramps.

`check:park` currently prints `0 rail crossing(s)` — green via the
`atLevelCrossing` escape at `check-park.mts:471`, not because bridges exist.
Making invariant 2 "used as written" means removing that escape. Watch
`RATCHET`'s `rail.exclusion` (21) and `rail.walkable` (30): both are *explained*
by the crossing gaps, so closing them should push both down and trip
`RATCHET LOOSE`. Re-record or delete those entries; do not leave them loose.

Note `route.crossesRail` has **no** `RATCHET` entry and is in `HARD_KEYS` in
every mode — so one illegal crossing already fails the build on every seed.

## Ordering constraint

`paths.ts` runs at module load, before `World` builds anything;
`computeCrossings` runs inside `ParkTrain`'s constructor; `buildRailFence` after
that. Anything `NavGrid`, `poiGraph` or `paths.ts` must know about the deck has
to be a **plan** computed at module load — the way `TRAIN_PLAN` and
`RAIL_RACE_PLAN` are — not a scene object.

## Sequencing: rebase AFTER the park reshape, not before

`feat/park-spline-boundary` will land an **indivisible** `GARDEN_PLAY_BOUNDARY`
commit — terrain rim, terrain mesh, boundary wall and clamp together — taking
the walkable extent from 58 m to ~82 m mean, 110 m at its widest. The railway,
the fence and every bridge live inside that.

**Decided: land after it.** This diff splits cleanly:

- *Shape-independent* — the deck exemption, deck geometry and ramps, the
  `poiGraph` seam, `BRIDGE_RISE`, `LEVEL_CROSSING_REACH`, Decision 6.
- *Shape-dependent* — removing the `atLevelCrossing` escape, re-recording
  `rail.exclusion` (21) / `rail.walkable` (30), and the new invariant's
  five-seed red proof.

Bridge placement is 100% derived: crossings come from where paths meet rails,
both from the boundary. When the extent grows, the railway moves, the crossings
move, and **every bridge moves**. Nothing here survives the reshape as a
constant — only the mechanism does. So proving invariant 2 against the old
circle proves nothing that will still be true, which is precisely the
"decorative on the night it is most needed" failure `check-park.mts`'s own
header warns about.

Build the mechanism now; measure the numbers after the rebase.

### Where #115's NavGrid change actually is

**Not** on `fix/paths-to-nowhere` — on **`feat/park-spline-boundary`**, commit
c6254be. The two stacks are **disjoint** (neither contains the other; they share
only `origin/main`). `fix/paths-to-nowhere` and this branch still have the old
`setPlayBounds(centreX, centreZ, radius)`.

`src/world/boundary.ts` is a **new** file, not a move — `src/world/rail/boundary.ts`
still exists beside it, and they are different boundaries (the rail one is the
smaller circle a rail ride is entitled to).

**It does not conflict with the deck exemption.** c6254be changed NavGrid's
*sizing* (`boundary.extent`) and the *soft-boundary* loop
(`boundary.distanceToEdge(x, z) < walkerRadius`). The deck exemption belongs in
the *collider stamping* loop (`forEachCircle`/`forEachWall`), which c6254be left
byte-identical. Adjacent loops, same function, no overlap — so the rebase is a
clean apply and there is no reason to fuse the stacks early.

## Status

Base merged and green: `npx vitest run` → **95 passed, 5 files**;
`npm run build` exit 0; `check:park` green.

Done: findings 1 and 2 (`LEVEL_CROSSING_REACH`, `BRIDGE_RISE` derived from
`LOCO_TOP_Y`), Decision 6 recorded and then corrected. #124 verified as already
fixed and closed by the Overseer.

Next, in order: the deck plan + geometry (module-load, like `TRAIN_PLAN`), the
`covers(x, z)` exemption in `NavGrid`'s stamping loop and in
`poiGraph.lineIsClear`, then — after the reshape — finding 4 and the invariant.
