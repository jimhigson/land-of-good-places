# HANDOFF — make `check:coplanar` green on `feat/sphere-combined` (PR #600)

**Model: Opus** (chosen by the Overseer; a replacement must also be Opus).
**Role:** Engineer. Reports to the Overseer (`landofgoodplaces-fc`). Does not merge.

- **Branch:** `fix/coplanar-sphere`, rebased onto `origin/feat/sphere-combined`
  at `903982ba`. **The PR goes against `feat/sphere-combined`, not `main`.**
- **Worktree:** `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/coplanar-sphere`
- **Control worktree** (base, for instrument controls):
  `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/coplanar-base`, detached at
  `origin/feat/sphere-combined`. **Remove it when done.**
- **Scratchpad:**
  `/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/coplanar-sphere/`
- **No dev server started, no browser page opened.** Nothing to clean up but the
  control worktree.

## Where this stands

Three of the four findings the previous session left were already fixed and
re-measured (nine `BASELINE LOOSE` entries deleted by hand, `deck|shell`, and
`shell|wallTop` — see the git log, those commits are unchanged). **The fourth,
`boundary-blocks|rail-fence`, is now fixed at the root** — and doing so has
surfaced one large, separate piece of work. Read "The open question" below
before doing anything else.

## What was wrong with the inherited proposal, measured

The inherited commit made the **drawn boundary wall give way to the railway**
(`Scenery.ts`'s `clearOfRailway` filtering the wall's block and pillar
stations). It closed the seam — `check:coplanar` exit 0 — **by deleting most of
the wall.**

`scripts/probe-wall-gap.mts` takes the `boundary-blocks` instance matrices out
of the finished scene, projects each onto the boundary outline by arc length,
and reports every run of edge carrying no stone.

**Control first**, and it is what makes the rest believable: on
`feat/sphere-combined` the instrument finds **exactly one gap per seed, on all
ten**, at (0, 60) and 12.7–14.4 m wide — the gate, the only hole the wall is
known to have, at about the width `DRAWN_BLOCK_GATE_MARGIN` plus the arch
predicts.

With the proposal applied, same instrument, same ten seeds:

| seed | extra wall missing | largest single hole |
|---|---|---|
| 11 | 2.6 m | 2.6 m |
| 24 | 17.0 m | 17.0 m |
| 128 | 53.6 m | 27.2 m |
| 131 | 68.9 m | 32.3 m |
| 208 | 53.5 m | 27.2 m |
| 274 | 11.9 m | 11.9 m |
| **326** | **89.2 m** | **89.2 m** (16% of a 564 m perimeter) |
| 428 | 35.7 m | 26.4 m |
| **451** | **96.8 m** | **78.1 m** (17% of the wall) |
| **20260728** (canonical) | **60.4 m** | 26.4 m, in three holes |

The collision ring was deliberately left whole, which makes it worse rather than
better: an invisible wall across a 78 m hole is the same mesh/collider
disagreement as the hotel shell, pointed the other way.

Why so large: `clearOfRailway` is true within 2.6 m of the route *anywhere*, and
the train's loop does not **cross** the boundary — it runs **alongside** it, for
tens of metres.

**Reverted**, commit `5c1b42b6`.

## The actual defect, and the fix

`scripts/probe-rail-boundary.mts` asks the question the proposal skipped. The
fence reaches 2.18 m from the centre line and the drawn masonry 0.86 m about the
outline, so 3.04 m is wanted:

| seed | closest approach to the edge | route outside the park |
|---|---|---|
| 11 | 4.83 m | 0.0 m |
| 24 | **1.83 m** | 0.0 m |
| 128 | 1.99 m | 0.0 m |
| 131 | 2.36 m | 0.0 m |
| 208 | 2.67 m | 0.0 m |
| 274 | 3.59 m | 0.0 m |
| 326 | 1.91 m | 0.0 m |
| 428 | 2.17 m | 0.0 m |
| 451 | 2.14 m | 0.0 m |
| 20260728 | 1.92 m | 0.0 m |

**The track centre is never outside the park, on any seed.** The worst shortfall
in the pool is **1.03 m**. The proposal blew an 89 m hole in the wall to cure a
metre.

**Root cause.** `rail/generate.ts`'s `boundaryMargin` field carries the note
*"the train sets it much wider (see `train/route.ts`'s
`TRACK_BOUNDARY_CLEARANCE`)"*. **No such constant existed**, and
`briefForLength` passed no `boundaryMargin` at all — so the train fell through
to the field's own `?? corridorRadius` and was allowed to 1.8 m of the outline.
A documented mechanism with nothing behind it, for as long as that field has
existed. CLAUDE.md's "two definitions of one thing", in the form where one of
the two was never written at all.

**Fix** (commit `1b7e5869`):

- `TRACK_BOUNDARY_CLEARANCE = FENCE_OFFSET + FENCE_HALF_THICKNESS +
  BOUNDARY_MASONRY_HALF_WIDTH` = 3.04 m, derived the way
  `GATE_WALK_RAIL_CLEARANCE` beside it is, every term read from its owner.
  Passed to the brief. The loop **backtracks** onto it — a closer piece is not a
  piece the search can place.
- `TRAIN_LENGTH_FRACTIONS` gains `0.26` and `0.21`. Costs the other nine seeds
  nothing: the ladder returns the first rung that closes and tries the longest
  first.
- `BOUNDARY_MASONRY_HALF_WIDTH` moves `Garden.ts` → `boundary.ts`, re-exported
  from `Garden.ts` so every importer is unchanged and there is still exactly one
  declaration. **Not taste** — importing it from `Garden.ts` cycles
  (`route.ts` → `Garden.ts` → `pathGraph` → `paths.ts` → `route.ts`) and dies at
  module load with `Cannot access 'TRAIN_PLAN' before initialization`, measured.

Result, `scripts/probe-train-solves.mts`: closest approach to the edge
**1.83 m → 3.14 m** across the pool. Seed 326 goes 1.91 m → 6.81 m and its loop
comes out **222 m, longer than the 220 m it had**.

A procgen invariant went with it (commit after that):
`noFenceStandsInTheBoundaryMasonry`, box-against-box on built geometry, which
refuses to pass silently if either mesh name is ever renamed out from under it.
**It has not yet been proved red.** Do that before trusting it.

## The open question — THE THING TO DECIDE

**Moving every train route invalidates the baked warp vectors**, exactly as
`parkWarp.ts`'s own doc says it must:

> *"If you change the geometry again, the vectors are stale again. The tell is
> neither gate on its own... The tell is `pnpm run vet:seeds` over the whole
> pool, which runs both."*

Four pool seeds carry vectors: `20260728`, `24`, `326`, `428`. Seeds **24 and
326 fail to build at all** with their baked vectors — and **both build fine
unwarped** (`LGP_WARP='{}'`), which is the signature of a stale vector rather
than of the new margin. A `vet:seeds --pool` run was in flight when this was
written and was failing seeds broadly; **its result, and a control run of the
same command on the base worktree, are the next thing to read** — the control is
essential, because some of what it reports may be stale on `main` already
(seed 131's failure was `every paved path runs on grid axes`, which #484 has
just been touching).

If the re-bake is genuinely needed, the documented remedy is
`scripts/warp-search.mts` per affected seed (it tries the empty vector first, so
24 and 326 will likely resolve immediately) followed by `vet:seeds --pool`.
**That is hours of compute and is bigger than this ticket.** It is on the
critical path for #600, so it is the Overseer's call whether it lands here or is
split out.

**This is not an artefact of the approach taken.** Any fix to a fence built
through a wall has to move the railway on six of ten seeds, because the wall is
a ring on a fixed outline and cannot move. The re-bake is inherent to fixing the
defect at all.

## Instruments written for this — all throwaway, **delete before the PR**

- `scripts/probe-wall-gap.mts` — gaps in the drawn wall, by arc length, off the
  built scene. **Has a control: the gate, and only the gate, on the base.**
- `scripts/probe-rail-boundary.mts` — how far inside the edge the route runs.
- `scripts/probe-train-solves.mts` — does every pool seed still build? **Import
  `crossingPlan.ts`, not just `plan.ts`** — a route that closes but proves no
  bridgeable crossing throws there instead, and a probe that skipped it called
  two failing seeds solved.
- Plus the previous session's `probe-sphere-seams.mts`, `probe-walltop.mts`,
  `probe-reveals.mts`.

**Traps that cost time here:**

- A child process ending with `process.exit(0)` has stdout **truncated at 65536
  bytes**. Write a file per seed.
- Importing `BOUNDARY_MASONRY_HALF_WIDTH` from `Garden.ts` into anything the
  path graph reaches is a module-load cycle, not a type error. `tsc` is happy.
- `POSES_OFFERED = 160` in `crossingPoses.ts` was tried for seed 326 and
  **rejected on measurement**: it makes more rungs close but none satisfy, and
  takes seed 326 from 16 s to 2 minutes. Reverted; do not revisit without a
  reason the numbers do not already cover.
- A denser `TRAIN_LENGTH_FRACTIONS` ladder was tried too — it fixes seed 24 but
  not 326, and churns three other seeds' routes for nothing. Reverted.

## Rules this task is bound by, and they are what stops the cheap route

1. **Never add a baseline entry to make a live finding pass.**
2. **Fix the residue by deleting the hidden face** (ART_DIRECTION.md §7), never
   by nudging a surface apart.
3. **A `BASELINE LOOSE` entry is a finding too** — re-take it and say what
   improved. `scripts/coplanar-baseline.mts:160` still carries the
   `boundary-blocks|rail-fence` entry at 0.0507 m²; it must go once a green
   `check:coplanar` confirms the seam is gone.

## Before the PR

`pnpm run check:coplanar` (read the exit code), then `pnpm run check`,
`pnpm run test:procgen`, `pnpm run build`, plus `check:swept-bus` and
`check:park-pool`. Never pipe through `head` or `tail`. `check` is ~16 minutes —
launch it with Bash `run_in_background: true`; do **not** use a Monitor and end
the turn. Then `git diff --stat origin/feat/sphere-combined...HEAD`, **three
dots**, and account for every file. Delete the probe scripts and this file's
throwaway sections before opening the PR — against `feat/sphere-combined`, not
`main`.

Two other engineers are live on `feat/sphere-combined` (arrival camera, road
checks): stay out of the arrival files, `catBus.ts` and the entrance-road checks.
