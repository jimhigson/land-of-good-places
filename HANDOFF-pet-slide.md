# HANDOFF — three red checks on #474 (`feat/park-warp-solver`)

Worktree: `.claude/worktrees/pet-slide-red`, branch `fix/pet-slide-check`,
based on PR #474's head. **Do not merge; PR only.**

Dispatched for `check:pet-slide`. Fixing it uncovered two more, because
`check` stops at its first failure: `check:park-boot` (step 57) and
`check:arrival-completes` (step 58) were behind it and had never been reached.

The `check` chain is **58 steps, byte-identical to `origin/main`** — nothing
added, nothing dropped, `package.json` untouched by this branch. Verified by
parsing the `scripts` object and diffing the step *sets*, not their size.

---

## 1. `check:pet-slide` — the check was right, the geometry regressed

Failure as it arrived:

```
check:pet-slide FAILED
  - in shot: the nearest companion filled at least 1% of the chase frame on only
    88% of 8 rasters, against 95% required (its smallest was 0.0%) — it is
    behind her, but not in the shot
```

Real numbers, no `NaN`/`Infinity`. The control run failed everything (0% of
rasters), so the instrument was armed.

**Placement.** #474 touches no slide, pet, camera or check code. It bakes a
warp for the canonical seed (`20260728: {layout:{hotel:2}}`), which re-solves
the whole park, so the canonical slide is a different curve. Isolated:

```
LGP_WARP='{}' pnpm run check:pet-slide   → exit 0, 100% of rasters, smallest 4.4%
pnpm run check:pet-slide                 → exit 1,  88% of rasters, smallest 0.0%
```

**Root cause — not in the slide at all.** `buildRoute`'s arc-length table
(`src/world/rail/generate.ts`) gave only the **first** piece a `t = 0` stop, so
at every join the stop before a new piece's first sample belonged to the
previous piece. `locate` saw `hit` and `before` on different pieces, refused to
interpolate `t` across them, and returned `hit.t` verbatim — every distance in
that piece's whole first step (up to the 0.35 m sample spacing) answered with
the same point. **The route had a dead spot at every join.**

Measured on the chute, which samples the route at a fixed 0.9 m. XZ gaps
between control points:

```
before: 0.899 ×39, then 1.155 0.643, then 0.899 ×10, then 1.163 0.635, …
after:  0.896 end to end, no anomaly
```

Each bad pair sums to exactly 2 × 0.899 — only the point *between* them was
displaced. A uniform Catmull-Rom through spacing like that kinks:

```
before … 0.73:22.5  0.74:17.0  0.75:16.4  0.76:30.4  0.77:21.5 …   (degrees of slope)
after  … 0.73:20.7  0.74:20.4  0.75:20.0  0.76:19.6  0.77:19.2 …
```

The failing raster sat at `herAlong=0.7600`, astride that +14° spike; the chase
camera pitches with the chute, so it swung the trailing pet 0.6 m down in
camera space (`petCamLocal.y` −0.86 → −1.47) and out of the bottom of frame.

**Fix:** give every piece its own `t = 0` stop. One line plus comment.

**Red proof.** Input: HEAD `acd243da`, the `t = 0` stop restricted to `index 0`
again (i.e. the fix reverted), everything else as committed:

```
check:pet-slide FAILED
  - in shot: the nearest companion filled at least 1% of the chase frame on only
    88% of 8 rasters, against 95% required (its smallest was 0.0%)
EXIT=1
```

**No threshold moved.** `IN_SHOT_FLOOR` (0.95) and `PET_FRAME_FLOOR` (0.01) are
untouched.

**Consequence — seed 5's warp re-baked.** The sampler fix moves every route, so
seed 5's `{ferrisWheel:2}`, baked against the buggy geometry, stopped holding
(`stall.railRacer` / `exit-railRace` 4.1 m apart in a straight line, 125.1 m by
paving, 30.8×). Re-searched with `scripts/warp-search.mts`, **`--control` run
first and passed** ("unwarped canonical scores 0 twice, summaries identical").
Seed 5 solves after 5 candidates at `{waterFight:1}`: `check:park` stranded=0,
seed-5 oracle 81/81. Note the *empty* vector is not enough despite seed 5
passing all 81 invariants unwarped — `check:park` still strands 10 waypoints.
Both gates, or it is not a vector.

---

## 2. `check:park-boot` — the check had drifted

Failure:

```
check:park-boot FAILED
  - the cruiserFinish phase was divided into only 11 pieces, against 12 the
    algorithm admits — it is being done in lumps the driver cannot stop in the
    middle of, which is a stutter on any device slow enough to notice
```

**The message was wrong about its own subject.** `coasterProfileSearch`
suspends in two different kinds of place: **eight structural seams**, a fixed
property of the algorithm that always run, and a **vertical repair loop** whose
count is *data* — it breaks the moment a pass finds nothing to lift. `units`
counts both together, plus the `done` result.

Measured, by logging every yielded value (repair temporarily tagged 900+):

```
CFYIELD value=0 ×6   ← seams
CFYIELD value=900
CFYIELD value=901    ← two repair passes
CFYIELD value=0 ×2   ← seams
CFYIELD done=true    ← the result
```

**8 of 8 seams ran.** 11 = 8 seams + 2 repair passes + 1 result. Main's 19 is
8 + 10 + 1 — the canonical seed takes all ten passes. So the branch's park
needed *less* vertical repair, and the check prosecuted it for that while
claiming a phase was being done in an unstoppable lump.

The floor's own comment had already worked this out and then contradicted
itself: *"a seed whose loop needs no repair legitimately produces ten"* — and
then set the floor to 12.

**Fix — the seams are now counted apart and asserted exactly.** Seams yield 0,
the repair yields `pass + 1`, the boot counts them separately, and the check
asserts the seam count is **exactly 8**.

**On the threshold — stated plainly, because it matters.**
`MIN_UNITS.cruiserFinish` **was changed, 12 → 10.** That is a threshold moving
down, and on its own it would be exactly the thing I was told not to do. It is
not the fix, and it is not what carries the guarantee any more:

- 10 is the algorithm's true minimum (8 seams + at least one repair pass + the
  result), derived from the code, not from what this machine printed.
- The guarantee moved to an **exact** seam assertion, which the old floor could
  not express.

Why the pair is stronger than the single floor it replaces, case by case:

| park | units | old floor 12 | new (floor 10 + seams == 8) |
|---|---|---|---|
| 8 seams, 10 repairs (main, canonical) | 19 | green | green |
| 8 seams, 2 repairs (this branch) | 11 | **red — false positive** | green |
| 8 seams, 1 repair (least the algorithm admits) | 10 | **red — false positive** | green |
| **7 seams**, 4 repairs (a seam lost) | 12 | **green — missed** | **red** |
| **7 seams**, 2 repairs (a seam lost) | 10 | red | **red** |

The old floor caught seam loss only when the repair count happened to be low,
and went red on legitimate parks when it happened to be high. The seam
assertion catches seam loss at *every* repair count and never fires on a park
for needing less repair. That is the file's own stated intent — "a floor here
has to enumerate **every** seam the algorithm admits, not the loop that happens
to be easiest to count."

**On the Overseer's specific concern** — that this branch's cruiser loop is
44 m longer while yielding 8× less. Measured rather than assumed: all **8 of 8**
seams ran (per-yield transcript above). The entire difference is the vertical
repair loop, 10 passes → 2, and that loop's exit condition *is* convergence —
it breaks when a pass finds nothing to lift, i.e. when the track already clears
the terrain. Yielding less here is the profile needing less repair, not a phase
being skipped. Loop length does not enter the seam count.

**Red proof.** Input: HEAD `e09eb754` plus the working-tree fixes, with the
pre-repair `yield 0` seam deleted from `coasterProfileSearch`:

```
  work units: brief 152, cruiser search 22973, cruiser finish 10, slide search 174085
  cruiser finish seams: 7 of 8, plus 2 vertical repair pass(es) and the result
check:park-boot FAILED
  - the cruiser finish took 7 of its 8 structural seams — a phase of it is being
    done in one lump the driver cannot stop in the middle of
EXIT=1
```

---

## 3. `check:arrival-completes` — the check had drifted

Failure:

```
check:arrival-completes FAILED
  - the looping frames drain 5.3 steps each against 7.7 while rolling — the
    overrun is draining no faster than the ride, so `overrunAwareBudgetMs`/
    `overrunning` is not applying the overrun budget once the ride is over
```

**It was applying it.** The clause's own comment called `parkedRate >=
rollingRate` *"the same statement measured on the run"* as "the budget switch
fires". It is not. The harness turns the budget into a **step** budget
(`budgetMs * STEPS_PER_MS`), then `break`s out of the frame whenever an
`advance` does no **counted** step — an import settling, a phase being set up,
or the path solve, which has no step counter behind it at all. Those frames
still count as frames, so they drag the rate down, and on this park they land
almost entirely on the looping side. The clause was measuring which phases fell
in which window.

**Fix:** ask the switch. `overrunAwareBudgetMs`'s return value is now recorded
every frame on each side of the ride's end and asserted directly — exact,
device-independent, unmovable by phase placement. It reports:

```
the budget switch handed out 8 ms while the bus was rolling and 12 ms while it
looped — this is the assertion; the steps-per-frame above is narration
```

The step rates stay as narration and now say on every run that they are
narration and what they cannot see.

**No threshold moved.** `GENERATION_BUDGET_MS` (8), `OVERRUN_GENERATION_BUDGET_MS`
(12) and `SMOOTH_OVERRUN_CEILING_MS` (16) are untouched, as are the two band
assertions.

**Red proof.** Input: HEAD `556290a5` plus the working-tree fixes, with
`JourneyDirector.overrunAwareBudgetMs` returning `whileTravelling`
unconditionally:

```
  the budget switch handed out 8 ms while the bus was rolling and 8 ms while it looped
check:arrival-completes FAILED
  - once the ride was over the budget switch handed out 8 ms, not the 12 ms
    overrun budget — `overrunAwareBudgetMs`/`overrunning` is not applying the
    overrun budget once the ride is over
EXIT=1
```

---

## Gates

- `pnpm run test:procgen` — **exit 0**, 17 files, 583/583.
- `pnpm run check` — full 58-step run in progress; results to be recorded here.
- `pnpm run build` — to run.

Exit codes read directly, never piped through `head`/`tail`.

---

# Review round 2 (#476) — the four asks

**Blocker was: pool seed 115 regressed.** Resolved, plus a fourth seed the
reviewer's sweep could not have seen.

## 1. Stale vectors, re-searched — three, not one

A warp vector is only meaningful against the geometry it was searched on. This
fix changes where a given distance lands on every route, so every vector baked
before it is suspect. `warp-search.mts` was run per seed, `--control` first and
passing each time:

| seed | old vector | `check:park` | invariants | new vector | candidates |
|---|---|---|---|---|---|
| 5 | `ferrisWheel:2` | stranded 10 | 81/81 | `waterFight:1` | 5 |
| 115 | `dodgems:1` | pass | **78/81** | `hotel:1` | 8 |
| 326 | `waterFight:1` | stranded 8 | 81/81 | `building:1` | 3 |

115 and 326 fail in **opposite** directions, so neither gate implies the other.

## 2. 115: stale vector, NOT a pre-existing breach uncovered

The reviewer's hypothesis was that the bridge-tunnel invariant's 0.1 m
finite-difference tangent (`invariants.ts:4788`) sat inside the old 0.35 m dead
spot, collapsing its across-track probe fan onto the centreline, so the fix
makes it strictly stricter and might be surfacing an older fault. Confirmed the
mechanism is real — pre-fix, both `pointAt` calls returned the identical point,
`norm` was 0 and the `|| 1` guard fired.

Tested rather than assumed, three runs:

| tree | instrument | 115 |
|---|---|---|
| pre-fix base (control) | as shipped | **pass 81/81** |
| pre-fix base | finite difference → `route.tangentAt` (honest fan) | **pass 81/81** |
| this branch, old vector | as shipped | fail 78/81 |

The honest fan on the old geometry finds nothing. So the breach is **not older
than the fix**; the vector is stale.

## 3. `WARPS_BY_SEED` header — fixed

Now states the two vintages explicitly, which entries belong to each, and that
`vet:seeds` over the whole pool (not `check:park`) is the tell when geometry
changes again.

## 4. The Sky Cruiser moved too — measured here, not asserted

The rail centre-line is **unchanged** (same segments, canonical loop 342.1 m
before and after). What changed is where a distance lands on it, so everything
sampling the route by distance moves:

- chute, sampled at 0.9 m: spline 63.6 m → 67.7 m, 69 → 74 control points.
- Sky Cruiser profile, `CONTROL_SPACING = 2 m`, canonical loop: control gaps
  off nominal by >2% were **2 of 170, worst 14.3%**; now **0 of 170, worst
  0.1%**.

## A mistake worth recording

The `WARPS_BY_SEED` header rewrite swallowed the closing `*/` and the
`const WARPS_BY_SEED … = {` line, and I **pushed it without running `tsc`**.
`vet:seeds` caught it as 0/16 with `ReferenceError: envWarp is not defined` —
the signature of a broken module, not sixteen broken parks. Fixed in
`a40b2f64`. Run `tsc` before pushing, even for a comment.

## Control worktree

`.claude/worktrees/pet-slide-ctl` (detached at `origin/feat/park-warp-solver`)
was used for the pre-fix controls. **Remove it when done.**
