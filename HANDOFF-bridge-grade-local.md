# HANDOFF — issue #636, the bridge sprint-grade clause measures the planet

- **Branch** `eng/bridge-grade-local`, based on `origin/eng/bridge-bend`
  (chosen because `scripts/diag-bridge-grade.mts` and the corrected
  `Bridge.soffitYAt` clearance work live there; `feat/sphere-combined` has
  neither).
- **Model**: Opus 5 (1M context), chosen by the Overseer. A replacement runs
  the same model.
- **Worktree** `.claude/worktrees/bridge-grade-local`.

## What changed

1. `src/core/constants.ts` — new `SPRINT_LOCAL_GRADE_CEILING =
   BUILDING_STEP_UP / PLAYER_LONGEST_STEP` = **0.6702**, with the derivation
   written beside it. `SPRINT_PEAK_GRADE_BUDGET` (0.512) is **untouched**, so
   no bridge on any seed is re-planned; its doc now says plainly that it is a
   planner target and that the check's ceiling is the new constant.
2. `test/procgen/invariants.ts`, `everyRailwayCrossingHasABridge...`:
   - the stride-window grade is now `rise = (b-a)·up(a)`,
     `run = |(b-a) - rise·up(a)|`, `grade = rise/run` — `Geo.up`, no `y`
     subtracted;
   - the sheer-step probe uses the same local rise;
   - four controls run first (the ones from `diag-bridge-grade.mts`); a
     control failure pushes a complaint that **voids** every grade on the seed;
   - the failure message describes the arithmetic it now performs, and quotes
     the world-y figure beside the local one;
   - a stderr note on every run: crossings judged, worst local grade, and the
     worst **un-asserted** world-y grade, with the statement that
     `WalkSurfaces.sample`'s own ceiling is still world-y and the planet is
     spending part of its headroom.

## Proofs already taken (paste geometry with any re-quote)

- **Red proof, canonical seed**, geometry = `eng/bridge-grade-local` @ the
  clause commit with one line of `src/world/train/bridges.ts` mutated:
  `const length = (along >= 0 ? lengthPos : lengthNeg) / 3;` in
  `surfaceProfile` — i.e. every ramp built three times shorter, so three
  times steeper. Result: 3 complaints, worst local grade **1.058**
  (rise 0.913 m over run 0.863 m), exit 1. Reverted.
- **Control proof**: `const rise = 0 * step.dot(up)` (the `altitude()` trap).
  Controls 2, 3 and 4 went FAIL, control 1 still passed as documented, and
  the run was declared VOID with no bridge judged. Reverted.

## State — PR 641 open against `eng/bridge-bend`

- procgen before: **128 failed / 501 passed** (629), 196.18 s.
- procgen after: **124 failed / 505 passed** (629), 106.55 s.
- Failing-set diff: exactly the four `every railway crossing has a bridge...`
  tests (seeds 11, 24, 326, canonical) fixed; **zero new**, zero swaps.
- All ten pool seeds clear, worst local grade 0.489 against the 0.670 ceiling
  — and under the old 0.512 too, so the threshold change made nothing pass.
- `pnpm run build` exit 0. `pnpm run check` red only at `check:crowd` and
  `check:speech-bubbles`, both on #630's inherited ledger.

## Left for someone else (reported to the Overseer, not fixed here)

`WalkSurfaces.sample`'s own ceiling is still literally world-`y`
(`const ceiling = y + BUILDING_STEP_UP`), so the planet's fall over a sub-step
spends part of the 1.670 headroom `check:deck-fallthrough` measured. Seed 326
already shows a world-`y` stride grade of **1.650** at r = 176.8 against that
1.670 — 1.2 % of margin, on a figure that is park-dependent. Nothing asserts on
it. The clause prints it on every run so it cannot be silently inherited.

## The inherited red, measured rather than assumed

All 64 `check` steps run individually on this branch: **12 red**, and every one
of them also red on the untouched base (`origin/eng/bridge-bend` @ `37e5d483`,
detached, no edits):

```
check:crowd  check:speech-bubbles  check:park  check:fountain-hop
check:hotel  check:rail-race  check:tie-frame  check:cruiser-clearance
check:castle-window  check:keyring-view  check:climb-wave  check:park-boot
```

`check:park` and `check:park-boot` were **not** on #630's table; both are now
measured on the base and posted there. `Coplanar faces` is red on stale
BASELINE LOOSE entries (the re-derive work owned on
`eng/sphere-crossing-and-coping`).

CI on PR 641 agrees with local to the test: per-file failed counts
1 / 26 / 24 / 25 / 24 / 24 = 124, identical to the local after-run, and all
five bridge run-notes printed with controls green.

## Re-measured at park scale 1 (replacement agent, 16 Sep)

Every figure above was taken at `PARK_SURFACE_SCALE = 2.3355` (this branch's
`PARK_REFERENCE_SPHERE_RADIUS = 1200`). PR #620 (open, not in this base)
restores scale 1. Measured by editing that one line to
`= GROUND_SPHERE_RADIUS`, **uncommitted, reverted after**:

`diag-bridge-grade.mts`, controls green on every seed run:

| seed | r | world-y | LOCAL |
|---|---|---|---|
| canonical | 30.4 / 40.2 / 41.9 | 0.545 / 0.641 / 0.640 | 0.354 / 0.452 / 0.477 |
| 11 | 46.7 / 49.2 | 0.639 / 0.626 | 0.317 / 0.395 |
| 24 | 41.1 | 0.444 | 0.363 |
| 131 | 35.4 | 0.514 | 0.341 |
| 326 | 49.4 | 0.630 | 0.344 |
| 128 | 34.5 | 0.600 | 0.359 |
| 208 | 49.8 | 0.456 | 0.335 |
| 274 | 39.0 / 49.5 | 0.613 / 0.621 | 0.353 / 0.346 |
| 428 | 42.0 | 0.635 | 0.333 |
| 451 | — | killed after 9 min generating (scale-1 park on this base; not the clause) | |

So **the finding survives scale 1**: the world-y reading is still over the old
0.512 on 8 of 9 seeds (the dome at r≈40 is only ~0.18, but a 0.35–0.48 ramp
plus that crosses), local worst 0.477, 0 of 13 crossings over 0.670.

The clause itself at scale 1, canonical seed (`vitest -t "every railway
crossing has a bridge"`, confirmed `1 passed | 92 skipped`): worst local 0.360
(the clause skips strides with no fall exposure near the feet; the diag does
not, hence 0.477 there), world-y 0.641.

**Red proof at scale 1**, same geometry mutation as above
(`bridges.ts` `surfaceProfile`: `const length = (along >= 0 ? lengthPos :
lengthNeg) / 3;`) plus scale 1: `1 failed`, 3 complaints — local grades
**0.817** at (-1.3, -30.3) (rise 0.867 m / run 1.062 m, world-y 1.110),
0.986 at (-38.6, 11.2), 0.973 at (-22.4, 35.4). Both edits reverted.

`diag-bridge-grade.mts`'s header gave a run command that fails with
`ERR_MODULE_NOT_FOUND`; corrected to include the resolver `--import`.
