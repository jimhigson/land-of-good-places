# Handoff — stalls' `accommodate`

**Model: Opus 5 (1M context)**, chosen by the Overseer (Engineer default).
A replacement runs the same model.
Branch `feat/stall-accommodate`, based on `origin/feat/procgen-on-sphere`
(NOT main). Worktree `.claude/worktrees/stall-accommodate`.
Read `HANDOFF-backtracking.md` on this branch first — it is the record of the
backtracking procgen this sits on top of.

## The task

Jim: *"also make all features able to accomodate small movements if required,
for example, maybe a stall would move, but this would be on the class that
does the stall placement to decide to move it to a position to acoomodate a
feature that needs the space more."* Every feature on the base branch has an
`accommodate` except stalls. Build it.

## What I found before writing any code (read this first — it reframes the job)

1. **Stalls are not a `FeatureBuilder` at all, and they make no claims.**
   - Their spots come from the **layout** decision: `minigames/stallPlacement.ts`
     `placedStall(id)` → `parkLayout.ts` `placedEntry(id)`. The layout is plan
     builder #0 and it commits **zero** claims (`coarse()` with no `claims`
     spec → `{ claims: [] }`).
   - The booths are *built* in the `World` constructor (`MiniGameStalls`
     at World.ts:171, `FacePaintStall` ~:262, `KeychainShop` ~:268) and
     register **four walls each** with `CollisionWorld`
     (`stalls.ts` `addBoothCollision`: halfWidth 2.1, front 1.35, back −1.3,
     wall half-thickness 0.3 — a 4.2 × 2.65 box, hollow middle).
   - So **nothing in the registry can ever name `stalls` as a blocker.** A
     tree/bush refused by a stall just tries the next candidate
     (`collision.isClearCircle`); a lamp slot refused only by a stall collider
     falls through `lampFits` and is **silently forgone** ("Nothing fixed lets
     a lamp stand here"). That silence is the gap.

2. **Who could ask a stall to move.** `GroundClaims.blockers` is queried only
   by the world-phase builders (fountain, walls, trees, bushes, fairyLights,
   lamps) and the rail race's trestles. Every **plan**-phase builder
   (cruiser, train, slide, crossings, pathGraph, road) refuses with
   `consumed:` (a named decision), never `blockers:` — they never consult the
   registry. And they do not need to: stalls are plots in the layout, and
   `validate()` already keeps `CORRIDOR_GAP` = 5 m of walkable ground between
   plots, so a plan feature never collides with a stall.
   **=> the only real askers are world-phase features.**

3. **The driver's precedence** (`parkSolve.mayAccommodate`): a blocker
   accommodates iff `blocker.movable` **or** the blocker is *later* in the
   build order than the asker. The world phase is a **separate `ParkSolve`**
   with its own builder list, so a plan-phase builder is invisible to it
   (`this.index.get(name) ?? -1` → `undefined` → skipped). A stalls builder
   therefore has to live in the **world phase** to be askable at all.

4. **Why the shift must be small, and bounded by that.** The path spur to a
   stall's doormat is drawn at plan time (`pathGraph` → `Garden`'s paving),
   long before the world phase. A stall that jumps leaves its spur pointing at
   where it used to be. A stall that shifts ~1 m keeps its stand point on the
   paving the spur already laid. That is exactly Jim's "**small** movements".

## Design of record

A `stalls` `FeatureBuilder` in `worldPhase.ts`, **first** in the order
(`deps: []`), one increment per stall:

- **claims**: the booth footprint, plus the stand spot as a `walkable` claim
  (`keepOutsFor`'s job: nothing solid may sit where a child is invited to
  stand).
- `advance` at attempt 0 places the stall exactly where the layout put it, so
  **every park is bit-identical until an accommodation actually fires**
  (provable by the park digest).
- `movable: true` — Jim puts the judgement in the stall class, not in the
  driver, so the stall is *askable* and its own `accommodate` is the thing
  that refuses. (Every world-phase asker is a structure or a light; there are
  no frivolous askers in that phase.)
- `accommodate(claimIndex, attempt, keepClearOf)` searches a bounded ladder of
  small shifts, accepts only one that keeps the booth clear of every claim and
  of `keepClearOf`, keeps the stand spot standable, clear and reachable, and
  keeps the doormat on the spur's paving — otherwise it **refuses**, and the
  asker (a lamp slot) is forgone as it is today.
- The booth is then **relocated** — mesh, four wall colliders, interact zone —
  in the same commit, so the thing a child sees and the thing she bumps into
  move together.

## Measured

**Adding stall claims changed no park.** (The **park** hash, precisely — not
the whole digest *file*. `world-trace` gains 9 lines on every seed: the eight
stall increments plus `done stalls`. The park those decisions build is
byte-identical; the record of how it was decided is one feature longer, which
is the honest description.) `scripts/park-digest-sweep.sh` on the
base (`origin/feat/procgen-on-sphere`, ae20b9fc) and on this branch, one
process per seed, all ten pool seeds:

| seed | base | branch |
|---|---|---|
| 20260728 | a1b5c16077708bc0 | a1b5c16077708bc0 |
| 11 | cff174dae3575aff | cff174dae3575aff |
| 24 | d0bc7e0fcba4d73a | d0bc7e0fcba4d73a |
| 128 | 528eebcd274a31a6 | 528eebcd274a31a6 |
| 131 | 84627b8d3eb9d3a7 | 84627b8d3eb9d3a7 |
| 208 | 9248414212c4d8de | 9248414212c4d8de |
| 274 | a7918b629da40cc1 | a7918b629da40cc1 |
| 326 | 24190286f59c7f99 | 24190286f59c7f99 |
| 428 | 4026fa879ce5bbe3 | 4026fa879ce5bbe3 |
| 451 | 9c5c9504db51c63c | 9c5c9504db51c63c |

Re-taken at final HEAD after every source change: **identical
again, all ten**. Identical, every one — mesh counts too. That is the property the design was
built for: attempt 0 of every stall is the spot the layout drew, and the
claims are the colliders' own geometry, so nothing that was allowed before is
refused now.

Canonical seed's world phase: 634 increments (626 before, plus the eight
stalls), 7 refusals, 7 accommodations, 0 refused, 0 forgone — the same seven
accommodations (two wall runs, five bush clumps) the base made.

**No pool seed asks a stall to move.** `grep stalls` over every seed's
`world-solve` trace finds only `placed stalls#0..7`: no refusal anywhere names
`stalls` as a blocker.

## Status

- [x] Worktree + install (pnpm 12.1.0 via the pin).
- [x] Baseline measurement — see **Measured** above. No pool seed needs it.
- [x] The builder (`src/world/stallsFeature.ts`), its `accommodate`, and the
      relocation (`MiniGameStalls.boothPlacement`). The face-paint and keychain
      booths answer `null` — they do not move — which `stallsFeature.ts` turns
      into an ordinary refusal; six of the eight move.
- [x] Reachability instrument **with its control run first**
      (`scripts/check-stall-accommodate.mts`).
- [x] Invariant in `test/procgen/invariants.ts`, proved red twice — see
      **Proved red** below.
- [x] `check:stall-accommodate` in the `check` chain (67 → 68 steps, nothing
      lost; step sets compared by parsing the scripts object).
- [x] `test:procgen` name-diff vs `origin/feat/procgen-on-sphere` (ae20b9fc):
      **55 failures on the base, 55 on this branch, identical names and
      identical counts** — none added, none fixed. Passes 636 → 641 (the new
      invariant on five seeds). Strip the `NNNms` suffix before diffing or the
      timings make the diff unreadable; BSD `sed` needs `-E`.
- [x] Determinism: two separate processes run `check:stall-accommodate` and
      produce byte-identical output — same booth, same 0.90 m shift, same
      destination. Canonical park digest `a1b5c16077708bc0` in two processes.
- [ ] Seeds 0..15: does any of them ask a stall to move? (digest sweep running)
- [x] **16 seeds of `check:park`: 16/16 green** — see the table below.

## The constructed scenario (`pnpm run check:stall-accommodate`)

No seed refuses anything against a stall, so the mechanism would otherwise
ship unexercised. The check drives the **real** builder the world phase just
used (`worldSolveStallBuilder()`), against the real registry and the real
collision world, with the synthetic refused claim the driver would hand it.
Canonical seed, run 2026-09-18:

```
check:stall-accommodate — seed canonical
ok    control: the reachability instrument says yes to the entrance and no to 400 m outside the park
ok    'railRacer' stepped aside 0.90 m: (-30.14, -51.69) → (-29.31, -51.35)
ok    'railRacer' is clear of the asker's claim it was refused against
ok    'railRacer': all 4 new wall claims have a matching collider in the built world
ok    'railRacer': the world still has 1032 walls — the old four were taken back
ok    'railRacer': the registry describes the booth at its new spot
ok    'railRacer': its counter at (-27.11, -49.16) still has room to stand and is still walkable to from the entrance
ok    'facePaint' refuses and stays put: stalls: facePaint is built from world coordinates and does not move
ok    'keychain' refuses and stays put: stalls: keychain is built from world coordinates and does not move
check:stall-accommodate seed canonical: PASS
```

## Proved red

Geometry each was proved against: the **canonical seed (20260728)** park at
commit `boothFootprint.ts` unmodified — `railRacer` booth drawn at
(−30.14, −51.69), `skyCruiser` at (30.11, −1.59); eight booths, 32 walls.

1. **The invariant, clause "solid exactly where claimed".** Edit:
   `addBoothCollision` registers its four walls from `boothCorners(x + 0.5, …)`
   — the mesh where it is, the collider half a metre off.
   `vitest run test/procgen/seed-canonical.test.ts -t "every stall is drawn"`
   → `1 failed`, **32 complaints**, e.g.
   `the 'railRacer' booth claims a wall (-30.67, -49.25)-(-27.70, -52.22) that
   no collider in the built world matches`.
   Worth knowing: the `isClearCircle` midpoint probe did **not** fire at
   0.5 m — the wall still covers its own midpoint at that offset. The
   claim-to-collider match is the clause that sees this one.
2. **The same invariant, clause "open air".** Edit: the front wall registered
   as a zero-length segment. → `the 'railRacer' booth's wall at (-29.18,
   -50.74) is open air — a child walks straight through the booth she can
   see`, on every booth.
3. **`check:stall-accommodate`, clause 3.** Edit: `MiniGameStalls`'
   `placeAt` moves the prop and does not re-register the walls. →
   `FAIL 'railRacer' moved and 4 of its four new walls have no collider`
   and `FAIL … the world went from 1032 walls to 1028 — old walls left
   behind`, exit 1.

All three edits reverted; `git diff --stat` clean afterwards.

## Environment notes

- `fnm use --install-if-missing` in every fresh shell (this branch's CLAUDE.md
  adds `.node-version`; pnpm does not switch node for you).
- Never `git stash` (shared across worktrees). Never `git add -A`.


## The diff, file by file (`git diff --stat origin/feat/procgen-on-sphere...HEAD`)

Three dots, not two. 14 files, 1614 insertions, 87 deletions, **no deletion
that is not mine**:

| file | what |
|---|---|
| `src/minigames/boothFootprint.ts` | **new.** One owner of every booth's box, its four corners, its collider and its claim. |
| `src/world/stallsFeature.ts` | **new.** The stalls `FeatureBuilder` and its `accommodate`. |
| `scripts/check-stall-accommodate.mts` | **new.** The constructed scenario, control first. |
| `src/minigames/stalls.ts` | booth collision through `boothFootprint`; `boothPlacement(id)` relocates prop + walls + stand point; `StallInstance`'s four coordinates are no longer `readonly`. |
| `src/minigames/stallPlacement.ts` | owns the shift (`stallShift`/`setStallShift`/`clearStallShifts`), `STALL_LAYOUT_IDS`. |
| `src/world/FacePaintStall.ts`, `KeychainShop.ts` | their `buildCollision` is now one call; their `STALL_WIDTH`/`DEPTH` come from `boothFootprint` instead of being local literals. |
| `src/world/worldPhase.ts` | the stalls builder is first; `solveWorldPhase` takes a `BoothRelocator`; `worldSolveStallBuilder()`. |
| `src/world/World.ts` | passes the relocator. |
| `src/world/Scenery.ts` | `walls` gains `deps: ['stalls']` (one line). |
| `test/procgen/parkFacts.ts` | `StallFact`, `stalls`, `stallsMissing`. |
| `test/procgen/invariants.ts` | the new invariant. |
| `package.json` | `check:stall-accommodate`, defined and in the chain. |
| `HANDOFF-stall-accommodate.md` | this file. |

## Known limits, stated rather than hidden

- **The face-paint and keychain booths do not move.** Both are single groups
  and could be relocated the same way, but both also derive geometry from
  world coordinates in several places (the face-paint stall's NPC decals, the
  keychain rack's per-keyring transforms and view basis), so moving them is
  more than a group translate. They answer `null`, which becomes an ordinary
  refusal, and `check:stall-accommodate` proves they refuse *and stay exactly
  where they were*. Six of eight move. Jim's "only add various levels of
  accommodations as required to get the parks building" is the reason to stop
  here: no seed needs even one.
- **`STALL_SHIFT_REACH` (1.5 m) is a cap on the search, not the safety
  argument.** What makes a shift safe is measured per candidate: the stand
  point must be standable, clear, off every other booth's stand point, and
  walkable to in a straight line from where the path spur ends. The cap exists
  because the spur is paved at plan time and cannot follow a booth that jumps.
- **No natural seed exercises the mechanism** — see the header of
  `stallsFeature.ts` for exactly why, which is a property of how each asker
  climbs rather than an accident.


## Three reds on the base, found on the way (NONE mine — they need an owner)

**`feat/procgen-on-sphere`'s `check` chain stops at step 24 of 68**, so
nobody had seen steps 25..68 on that branch at all. Running them here found
two more reds, each reproduced **identically on the base**:

| step | what | on the base? |
|---|---|---|
| 24 `check:slide-rider` | body 0.13% of frame vs 0.40% required | identical, same numbers |
| ~30 `check:waypoints` | **245** waypoints "inside the facade (x NaN..NaN, z NaN..NaN)" | identical, same 245 complaints |
| ~50 `check:cart-shape` | `ReferenceError: Cannot access 'RIDE_SCALE' before initialization` at `railRace/hazards.ts:171` | identical |
| ~66 `check:ground-claims` | the **same** TDZ, same line | identical |

**Root cause of the TDZ, so it is actionable:** `hazards.ts:171` computes
`DUCK_CLEARANCE = DUCK_CLEARANCE_AT_PARK_SCALE * RIDE_SCALE` at **module
scope**, importing `RIDE_SCALE` from `./route`; `route.ts` imports
`../parkLayout`, which the procgen rework's graph brings back round to
`hazards.ts`. So `hazards.ts` evaluates while `route.ts` is still in its
temporal dead zone. It is precisely rule 1 of `HANDOFF-backtracking.md`'s
"two import-order rules" — *nothing may read a value from the solver graph at
module scope* — applied to a constant rather than to a plan view. The fix is
to make `DUCK_CLEARANCE` lazy (a function, as `parkPlan.ts` does for every
constant in that cycle) rather than to move the import. **Not done here**: it
is a rail-race change, and folding it into a stalls PR would make the diff
un-reviewable as either.

`check:ground-claims` is the check most directly relevant to *this* PR, and it
cannot run on either branch. Its cover is not lost, though: `test:procgen`'s
`railRaceSupportsAreClaimedAsDrawn` clause 3 sweeps **every pair of claims
across every committed feature** against `CLAIM_COMPATIBILITY`, stalls
included, and that suite does run — 641 passes.

The `NaN..NaN` one is worth the Overseer's attention on its own: a facade
whose bounds are `NaN` means the check is comparing against `NaN`, which is
CLAUDE.md's "green can mean incapable of failing" wearing its other face —
here it is red for a reason that may have nothing to do with the waypoints it
is naming.

Nothing in this PR touches slides, ride cameras, the child model, waypoint
seeding or the rail race's hazards, and the base reproduces all three exactly.
They are reported rather than worked around or quietly skipped.

### The original note



`pnpm run check` stops at **step 24 of 68, `check:slide-rider`**, on this
branch **and identically on `origin/feat/procgen-on-sphere` (ae20b9fc)** —
same clause, same numbers, to the digit:

```
check:slide-rider FAILED
  - the child's body is 0.13% of the frame on beat 1's trackside camera
    (ridden frame 240), against 0.40% required — 1 of 6 trackside samples are
    under it. The trackside camera is the one that has to show her whole self;
    if it cannot, nothing in this ride does
```

Nothing in this PR touches the slide, the ride cameras or the child model, and
the base reproduces it exactly, so it is a **pre-existing red on the procgen
branch**, not a regression here. It is reported rather than worked around:
CLAUDE.md's zero-tolerance rule makes it somebody's next job, and the Overseer
should give it one. It also **masks the other 44 chain steps**, which is the
more urgent half — a chain that stops at step 24 has not run `check:park`,
`check:hotel`, `check:ground-claims` or anything else after it on that branch.

Steps 1..23 are green on this branch, `check:stall-shape` and
`check:shop-spacing` among them. The 44 steps after `check:slide-rider` were
run separately here so this PR's own work is not left unproven behind
somebody else's failure.


## `check:park`, seeds 0..15 — 16/16 green

One process per seed, one seed at a time, at HEAD `875453e1`. Counts quoted
off the screen:

| seed | waypoints connected | attractions | ms |
|---|---|---|---|
| 0 | 254/254 | 19/19 | 10989 |
| 1 | 228/228 | 19/19 | 10218 |
| 2 | 233/233 | 19/19 | 29194 |
| 3 | 237/237 | 19/19 | 132964 |
| 4 | 237/237 | 19/19 | 277116 |
| 5 | 242/242 | 19/19 | 14446 |
| 6 | 230/230 | 19/19 | 38313 |
| 7 | 253/253 | 19/19 | 1405756 |
| 8 | 278/278 | 19/19 | 10949 |
| 9 | 235/235 | 19/19 | 7746 |
| 10 | 216/216 | 19/19 | 14210 |
| 11 | 308/308 | 19/19 | 8145 |
| 12 | 275/275 | 19/19 | 11092 |
| 13 | 246/246 | 19/19 | 4674 |
| 14 | 214/214 | 19/19 | 42517 |
| 15 | 263/263 | 19/19 | 44945 |

Every one: `19/19 attractions route from the entrance`, `0 rail crossing(s)`,
`All six invariants hold`, exit 0. Seed 7 is the expensive one on this branch
already (the base's own handoff records 1003 s for it).

**And across all sixteen seeds' `world-solve` traces, the number of refusals
naming `stalls` as a blocker is 0.** The world phase made 0–15 accommodations
per seed (trees, bushes, wall runs, as before); not one of them was a booth.

## Chain coverage, honestly

`pnpm run check` cannot run to the end on either branch. Run in four
segments here, skipping only the four pre-existing reds above, **every other
step of all 68 passed**, including `check:stall-shape`, `check:shop-spacing`,
`tsc --noEmit`, `typecheck:test`, `check:park`, `check:park-boot` (worst slice
inside budget), `check:hotel`, `check:tap-spacing`, `check:nav-routes` and
`check:rail-race`. `check:stall-accommodate` passes.


## Round 2 — the reviewer's finding, fixed

**The silent skip.** `spaceFerrisWheel` has no `STALL_LAYOUT_IDS` entry, so
`accepts` guarded its walk-to-the-counter march with `if (layoutId)`: the one
*movable* booth placed by relation rather than on a plot quietly got a weaker
acceptance gate than the other seven — the very test this class calls "the one
that decides" — and nothing announced it. No seed can reach it today, which is
exactly how a silent skip survives.

**Fixed by making the question total, not by adding a second branch.**
`spurEndFor(id)` returns the plot's own doormat for the seven that have one,
and for the kiosk the **wheel's entrance** — which is a plot doormat too
(`anchors.ts` builds `entrance` from a `placedEntry`'s `entranceX/entranceZ`,
and `paths.ts` paves a spur to it) and is the same point `ferrisKiosk()`
positions the booth from. One owner, same question, same kind of answer.
It **throws** for a stall with neither, so the next one added cannot inherit a
weaker gate in silence.

**`check:stall-accommodate` now asks all six movable booths** instead of
stopping at the first that says yes — which is what left the kiosk unexercised
in the first place. Canonical seed: 6 of 6 step aside 0.90 m each, all four
new wall claims matched to colliders each time, 1032 walls throughout, and all
**eight** counters still walkable to from the entrance afterwards, on one
lattice rebuilt over the finished world. 17.8 s.

### Proved both ways (geometry: canonical seed, kiosk drawn at (−47.29, −15.45), spur end (−45.1, −18.4))

- Point the kiosk's spur end at `(200, 200)` — a place no straight line
  reaches — and it **refuses**: `stalls: spaceFerrisWheel at (-47.3, -15.5)
  found no spot within 1.5 m that keeps its counter reachable`, and the check
  confirms `refused and is exactly where it was: 1032 walls, all four still
  solid`. So the gate is armed for that booth specifically, not passing
  vacuously.
- Delete the relation branch and it **throws** by name rather than skipping:
  `stalls: 'spaceFerrisWheel' has no plot in STALL_LAYOUT_IDS and no stated
  relation…`.

Both mutations reverted. Park hashes re-confirmed unchanged after the fix on
seeds 20260728 (`a1b5c16077708bc0`), 128 (`528eebcd274a31a6`) and 274
(`a7918b629da40cc1`) — the fix lives in `accommodate`, which no build reaches.

## Filed, deliberately not fixed in this PR

1. **The exhausted-search restore path has no standing test.** On the happy
   path all six booths move, so the branch where a booth tries every ring,
   finds nothing and puts itself back never fires. `check:stall-accommodate`
   now **says so on stderr on every run**: *"0 exhausted every ring and
   restored itself — so the EXHAUSTED-SEARCH RESTORE PATH WAS NOT EXERCISED by
   this run, and nothing above covers it. It needs a test of its own."*
   **Whoever takes the ticket: the cover already exists in miniature** — the
   `(200, 200)` mutation above drives exactly that path and the check's
   existing refusal clause verifies it (`1032 walls, all four still solid`).
   Making it permanent is a test-only hook that forces one booth's search to
   fail, not new production code.
2. **A shifted counter can land off its own paving.** `accepts` proves the
   stand point collision-clear and walkable-to; it does not prove it still
   *paved*. Cosmetic, and unreachable while no seed moves a booth.


## Round 3 — three review fixes

1. **A summary line that could claim cover it had not got.** `4b`'s
   `every one of the 8 counters is still walkable` printed unconditionally
   after its loop, so a stranded counter produced the `FAIL` *and* that `ok`
   together. Counted now; prints only when all pass, and otherwise
   `7 of 8 counters are still walkable`. **Proved** by stranding `dodgems`
   deliberately: the `ok` disappears, the honest count appears,
   `1 FAILURE(S)`.
2. **`standsToRecheck` deleted** — written, never read. Note for whoever is
   near this next: **`tsc` cannot see dead code in `scripts/`**, because that
   directory is in no tsconfig project (filed as **#672**). Do not assume a
   green `tsc` says anything about a `scripts/*.mts` file beyond what the
   check's own run proves.
3. **The withdraw-then-throw coupling is written down** in
   `stallsFeature.ts`. Between `booth.withdrawCollision()` and the `placeAt`
   on either exit the booth is **drawn but not solid**. `accepts` can throw —
   `spurEndFor` does, by design — and that is safe *only* because
   `parkSolve.ts` has no `try`/`catch` at all, so the throw kills the build
   outright. **Verified by reading `parkSolve.ts`, not by grepping**: a naive
   `grep 'try'` matches `retry` and `entry`, and its only `catch` is a word
   inside a message string, so the grep answer and the real answer differ.
   The comment says what to do: anyone wrapping the driver's `accommodate`
   call in a `catch` must wrap this search in `try`/`finally` in the same
   change, or a swallowed exception ships a stall a child walks through.

Deliberately **not** in this PR, at the Overseer's direction: a shifted
booth's counter can land off its own paving (`accepts` proves collision-clear
and walkable, not still *paved*) — filed as its own issue.


## Round 4 — rebased onto `881cb158`

`Every seed builds` was **cancelled at its cap** on the old head, which in this
repo means a timeout and therefore a failure. Not the diff: the branch's merge
base predated **#670**, which stopped the railway's boundary test walking all
512 polygon vertices per candidate sample (80.7% of the solve). Rebased.

Base gained three commits over `ae20b9fc`:

- `881cb158` #670 — the park-solve boundary-scan fix (the one that matters here)
- `86f9a513` #674 — **`check:waypoints` solves the park before reading the
  facade's edges**, i.e. the `NaN..NaN` red I reported in round 1 is fixed
- `78d25b40` #669 — `check:entrance-road` queue/reporting

### Verified after the rebase, not assumed

- **Chain step sets compared by parsing `package.json`, never grepped.** New
  base 67 steps / 126 scripts → mine **68 / 127**. Lost: **none**. Gained:
  exactly `pnpm run check:stall-accommodate` and `check:stall-accommodate`.
  And the **order** is preserved: strip my one step and the list is the base's,
  element for element. (`package.json` is untouched by all three base commits,
  so there was no chain conflict to mis-resolve.)
- **`rerere` could not have replayed anything: it is `false`.**
  `git config --local --get rerere.enabled` → `false`. **CLAUDE.md's statement
  that it is `true` in this repo is stale** — worth correcting there. The
  `.git/rr-cache` still holds **90 resolutions** behind the disabled flag, so
  anyone re-enabling it inherits all of them at once.
- **Three-dot diff unchanged**: same 14 files, +1971/−87, no whole-file
  deletion, and **zero overlap** between the files the base changed and the
  files I touch — so no silent revert.
- `tsc --noEmit` and `typecheck:test` clean.
- `check:stall-accommodate` PASSes on the rebased head, with the **same
  coordinates** as before the rebase (railRacer (−30.14, −51.69) → (−29.31,
  −51.35), 0.90 m; 6 of 6 booths).

### Park digests — checked in both directions

| comparison | result |
|---|---|
| new base `881cb158` vs old base `ae20b9fc` | **all ten pool seeds identical** — #670's "same parks" claim independently confirmed |
| my rebased head vs new base `881cb158` | **all ten identical**, mesh counts too |

And they are the same literal hashes as before the rebase
(`a1b5c16077708bc0`, `528eebcd274a31a6`, …), so nothing moved on either axis.

### `test:procgen` name-diff, re-taken against the new base

The baseline had to be re-taken: the base moved, and a name-diff against a
stale baseline is exactly the "measurements go stale" fault. New base
`881cb158`: **55 failed | 638 passed (693)**. My rebased head: **55 failed |
643 passed (698)**. Failure **set identical** — none added, none fixed; the
five extra passes are my invariant on the five seed files.

Also worth recording: the base's own failure set is **unchanged** by #669,
#674 and #670 — same 55 names as at `ae20b9fc`. So those three commits fixed
a check script (`check:waypoints`) and a solver's cost without moving a single
invariant.


## Round 5 — rebased onto `76224f91` (#682), and a check that finally ran

#682 moved the rail race's dimensional literals into a leaf module
(`railRace/dimensions.ts`), deleted `DUCK_CLEARANCE` as a true no-op, and added
a ratcheted chain step `check:cycle-tdz` at position 5. That is the fix for the
`railRace/hazards.ts` module-scope TDZ I root-caused in round 1.

### The package.json conflict, resolved deterministically

`#682` touches `package.json`, so the rebase conflicted on the chain — the one
place CLAUDE.md says never to accept what git hands back. **Rebuilt from the
base's own file**: took `origin/feat/procgen-on-sphere:package.json` whole and
re-inserted my script definition and my chain step after `check:layout-rung`,
the same two edits as the original commit. Then verified by parsing:

- base **68 steps / 127 scripts** → mine **69 / 128**
- **lost: none**; gained: exactly `pnpm run check:stall-accommodate` and
  `check:stall-accommodate`
- **relative order preserved**: strip my one step and the list is the base's,
  element for element
- `check:cycle-tdz` still present, still at **position 5**

Note the trap this avoided: before the rebase my head and the base were **both
68 steps** — but different 68s, mine with `check:stall-accommodate` and the
base's with `check:cycle-tdz`. A count would have said "no change".

### `check:ground-claims` ran for the first time — and caught the stalls feature

In round 1 I reported this check as having no cover on either branch, blocked
by the TDZ. #682 unblocked it, and on its first run it refused my work:

```
the registry on the built park holds feature(s) [stalls] that are not declared
placers — the declared list, in commit order, is [layout, cruiser, train,
slide, crossings, pathGraph, road, fountain, walls, trees, bushes, fairyLights,
lamps, railRace]. If a later step has added a placer, widen this probe
deliberately rather than deleting it
```

Widened by hand as its roster comment asks, `'stalls'` first among the world
phase's builders. **Proved red both ways**, canonical seed:

- drop `'stalls'` → *"holds feature(s) [stalls] that are not declared placers"*
- move it after `'fountain'` → *"these placers committed out of the declared
  build order: [fountain] … the registry holds [… road, stalls, fountain …]
  against a declared order of [… road, fountain, stalls …]"*

`check:ground-claims passed` afterwards. **The gap I reported in round 1 is
closed**, and by the check itself rather than by my say-so.

### Also verified on the rebased head

- `tsc --noEmit` + `typecheck:test` clean.
- **`check:cycle-tdz` passes: 8 sites, same as the baseline, none added** — so
  `stallsFeature.ts` (which imports `parkLayout`, `boundary`, `anchors`) added
  no module-scope cycle of its own. Worth knowing, because that is exactly the
  trap #682 existed to fix.
- `check:stall-accommodate` PASSes, 40 `ok` lines, 6 of 6 booths.
- Three-dot diff: 14 files, +2030/−87; the **only** file overlapping #682's is
  `package.json`, resolved as above.
- `rerere.enabled` still `false`, so nothing was replayed.

Per the Overseer: the sixteen-seed sweep was **not** re-run — nothing since the
last verification touches what this diff can reach.
