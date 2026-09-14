# HANDOFF — radial conversion, lead engineer

**Model: Opus (claude-opus-5[1m]).** Chosen by the Overseer's default for an
Engineer; not a per-task choice by Jim. A replacement runs the same model.

**Branch:** `eng/radial-visible`, off `feat/sphere-combined` @ `31d0fb2a`.
Pushed, clean, no PR. **Parked, not abandoned** — Jim's instruction is to keep
the work.

**Status: STOPPED.** Jim, 14 September 2026: *"I don't think the mission has
been taken on properly here — it seems more like trying to fit the new world
into the old code."* An architect is building a proper spherical domain
(~8 weeks). This work is not wrong; it is the wrong layer.

## Read these two first, in this order

1. **`RADIAL-LESSONS.md`** (this branch) — the *facts* the redesign needs. New.
   Two thirds of the inventory collapses into three sentences in it.
2. **`RADIAL-INVENTORY.md`** (this branch) — the *sites*, now the architect's
   requirements document, with a closure ledger and eight corrections.

**This branch holds the true copy of the inventory.** It began on
`seek/radial-inventory` and was moved here when the fan-out started, because a
500-line file edited on five branches conflicts on every merge and loses rows in
the resolution — the exact failure it exists to prevent. Rows came to the lead
by message and went in once. The copy on `seek/radial-inventory` is the
seeker's original and is frozen history.

## What is on this branch

| file | what changed |
|---|---|
| `src/art/models/tapMarker.ts` | `placeAt` owns position-and-lean, via `upFor`, **assigned not pre-multiplied** |
| `src/art/effects/rainbowRing.ts` | ring lean moved into the pool's own geometry copy; rise/clearance along local up; star burst plane and arc lean |
| `src/world/NavGrid.ts` | `nodeWalkHeight` beside `nodeHeight`; every step/level/gap/tie-break comparison moved onto it |
| `src/world/up.ts` | **new shared helper `walkHeight`**, with its limits documented at length |
| `scripts/check-outward-routing.mts` | new, in the `check` chain (66 steps, set verified by parsing) |

`tsc`, `typecheck:test`, `build` and `check:outward-routing` all exit 0.
`git diff --stat origin/feat/sphere-combined...HEAD` — 8 files, **0 deletions**.

## The three things from here that must survive

1. **`NavGrid`'s step gate leaks real ledges** — the half neither the seeker nor
   I found; the collision engineer did. A genuine 0.70 m step up reads **0.565 m
   of world `y` at 40 m out and 0.269 m at the rim**, under the 0.62 m
   `MAX_STEP`. The router has been planning routes up things a child cannot
   climb, across most of the park. *Refusing flat ground* was the reported bug
   and is the lesser half — it only bites past 145 m, outside the walkable
   garden, and **16/16 outward routes succeeded on the unfixed router**.
2. **Raising `MAX_STEP` is the wrong fix** and the derivation is worth keeping:
   to pass flat grass it would have to exceed 0.729 m at 157 m and 1.007 m at
   180 m — a different value at every radius — and at that setting it admits
   real 0.51-0.58 m ledges. The fix is the measure, not the threshold.
3. **`walkHeight`'s three traps**, all in its docblock: a radius folds the sign
   (`walkHeight(100, -1e6, 100)` = **+999560**); both infinities came back
   `+Infinity` until guarded, and `+Infinity` is the *dangerous* direction
   (`5 < Infinity` skips every collider — nothing solid — where `NaN` would have
   been harmless); and it is the **wrong** helper for `topIsAbsolute`, which
   wants an altitude, because two points at the same world `y` 1.3 m apart
   radially at 90 m differ by 0.54 m of walk height.

## Not done, and needing a person

- **The tap ring and the hop rainbow have never been looked at in a browser.**
  I was never given it. One minute of QA: tap grass 40 m+ out and confirm the
  pink ring lies on the slope instead of slicing through it; jump out there and
  confirm the rainbow does the same. This is the only outstanding item on my own
  code.
- Everything else here is invisible to a player.

## The fleet, for whoever picks this up

| area | branch | state |
|---|---|---|
| lead | `eng/radial-visible` | this |
| A — checks | `eng/radial-checks` | 11 commits, parked |
| B — effects | `eng/radial-fx` | 12 commits, parked |
| C — rides | `eng/rides-radial` | parked |
| D — collision | `eng/radial-collide` | parked; **Collision.ts and fence.ts deliberately reverted** |
| E — bridges | `eng/crossing-bridge` | **PR #619, MERGEABLE** — merge this regardless |

**#619 is the one thing that should still land.** It fixes the park-build
throw: 10 of 10 pool seeds build, up from 3, and the park was blank-screening in
a **real browser** before it. Unblocking took `test:procgen` from 279 skipped /
269 passed to **0 skipped / 473 passed, exposing 81 previously invisible
failures**. Everything anywhere recorded as "not measured, the park does not
build" is re-measurable now and must be re-tried before it is trusted.

## Open questions that are Jim's, not an engineer's

Both are in `RADIAL-LESSONS.md` §8 with the measurements:

- **the day/night terminator** — the outer park is in real geometric shadow for
  hours either side of noon while the rig says broad daylight;
- **the indoor/outdoor seam** — `SPACE_CASTLE_ROOF` is "open to the sky" but
  `spaceAt` calls it an interior, and both the Sky Cruiser and the slide cross
  the boundary with nothing owning the seam.

## Mistakes I made, so the next lead does not repeat them

- **I promoted a working hypothesis into the inventory as a fact.** The
  `need · cos θ` fit (13 mm) went in as "explained rather than coincidental"; it
  was retracted the next hour. A fit in a working note is a hypothesis; a fit in
  the requirements document is something four engineers build on. It is marked
  **RETRACTED in place** rather than deleted, which is the part that keeps the
  rest of the file trustworthy.
- **I ruled that the bridge tilt should be owned by `SpineFrame`.** It cannot
  be — `SpineFrame` is purely 2D. The workable direction is the inverse. Also
  recorded in place.
- **I wrote an interior clause that could not fail**, twice over: first it
  failed three rooms on correct code (its lattice was centred on the park), then
  it passed with the correctness branch deleted outright (A\* walks a staircase
  of straights and arrives anyway). Reachability detects a wall, not a broken
  step gate.
