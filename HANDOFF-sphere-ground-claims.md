# Handoff: ground claims and generators on the sphere

**Model: Opus 5 (1M context)**, chosen by the Overseer for this Engineer lane.
A replacement runs the same model (CLAUDE.md's hard rule).

**Branch:** `eng/sphere-ground-claims`, off `feat/sphere-combined`.
**Worktree:** `.claude/worktrees/eng-ground-claims`. No PR yet.

## State

`tsc` clean. `check:ground-claims` passes. 67 unit tests green
(`test/groundClaims.test.ts`, `test/geo/claimSurface.test.ts`, `test/geo/core.test.ts`).

## The two findings that matter most

### 1. The park was running off its own planet — this was the CI red

`PARK_SURFACE_SCALE`'s docblock says the reference is *"held equal to
`GROUND_SPHERE_RADIUS`, which makes the scale exactly 1"*, and calls a park
*"grown 2.33x"* the state that is **blocked**. `PARK_REFERENCE_SPHERE_RADIUS`
was **1200** against a radius of **220**, so the scale was 2.3355 and the
blocked state was the one shipping.

`boundary.maxRadius` was **245.0 m on a 220 m planet** — past the equator, where
`terrainHeight`'s `Math.max(0, R² − d²)` clamps the ground to a flat plane at
`y = −220`. On seed 326 a tree stood at 216 m on a **1045% slope**, 179.6 m below
the park's centre; a duck bar at 246 m stood on no ground at all.

Fixed by setting the reference to `GROUND_SPHERE_RADIUS`. `test:procgen`, diffed
by name:

| | base | with the fix |
|---|---|---|
| passed | 297 | 529 |
| failed | 49 | 100 |
| **pending** | **279** | **0** |

**The pending column is the finding.** Seeds 131, 24 and canonical never ran on
base — their parks did not build, so 279 assertions reported nothing while the
suite called itself green. Duration was 87.8 s both runs, so the usual duration
tripwire could not see it; the tell was the pass count.

`scripts/park-past-the-horizon.mts` is the measurement, re-runnable.

### 2. RESOLVED — the gradient budget is retired

Overseer's ruling, 14 September 2026: **retire the 10% figure as a constraint on
the planet, and do not grow the planet for it.** The budget guaranteed the bus
could drive all 117 m of its road; Jim has ruled it need not — *"showing the bus
coming in a couple meters is fine and good."* The dead derivation in
`GROUND_SPHERE_RADIUS`'s docblock is deleted.

`BUS_MAX_GRADE` is kept as a fact about the bus but **nothing asserts it**, and
the invariant says so on every run, to stderr. What it still refuses is the park
reaching past its own equator — no ground at all, not a steep slope.

**The durable fix:** the gradient is now `tan θ` via `gradientAtParkRadius`, not
`d / R`, which is `sin θ`. `sin θ` under-reports everywhere and **cannot exceed
100%**, which is why 245 m of park off the edge of the planet once read as a
plausible `111.36%`. A measure that cannot exceed 100% cannot report the thing
it exists for.

The invariant was renamed from *"...and gentle enough for the bus"* to
*"...and the park fits on it"*, because it no longer asserts gentleness and a
test name is a claim like any other.

### (historical) the question that ruling answered

One failure needs a ruling, not an engineer:

> the ground reaches a gradient of 47.73% at 105.0 m, past the 10%
> BUS_MAX_GRADE budget that GROUND_SPHERE_RADIUS (220 m) was chosen against

On a 220 m planet a true 10% gradient permits a park of **21.89 m radius**. No
park worth walking satisfies it. `GROUND_SPHERE_RADIUS`'s docblock still derives
itself as `117.08 / 0.10 = 1171 m, rounded up to:` and then declares **220** —
the derivation belongs to the 1200 m planet; 220 was chosen by eye afterwards.

Either the planet grows (≈2460 m for the park's reach at 10%) or `BUS_MAX_GRADE`
is no longer 10%. **Both are visible calls. Do not make either one.**

Related instrument fault, fixed in `constants.ts` but **not yet in the
invariant**: `theGroundIsTheSphereItClaimsToBe` computes `grade = d / R`, which
is `sin θ`. A cap's gradient is `tan θ`. It under-reports everywhere and
saturates at a friendly 100% exactly where the ground turns vertical — which is
why 245 m of park off the edge of the planet was reported as "111.36%".
`parkRadiusForGradient` / `gradientAtParkRadius` in `constants.ts` are the real
forms; wiring the invariant to them is unfinished work.

Its clause 1 ("the drawn ground IS that sphere") also cannot fire past the
equator: it compares `terrainHeight` against an `expectedFall` carrying the same
`Math.max(0, …)` guard, so out there it compares the terrain to itself. The
clause that exists to stop clause 2 passing vacuously is itself vacuous exactly
where it is needed. **Also unfixed.**

## The live disagreement with #619 — read before touching PARK_SURFACE_SCALE

**#619 merged into the base and changed this same docblock in the OPPOSITE
direction.** Both of us found "the docblock says scale 1, the constant says
1200". #619 corrected the *paragraph* and kept 2.335x; this branch corrected the
*constant* and kept scale 1.

The rebase applied with **no conflicts** and produced exactly the bug CLAUDE.md
warns a clean rebase produces: git took my constant and their paragraph, so the
file said *"This is 1200 ... the scale is 2.335"* directly above
`= GROUND_SPHERE_RADIUS`. Resolved by hand; the docblock now carries both sides.

**#619's engineering is untouched and correct.** Its `paths.ts` fix — a
hard-coded `z = 54` copied from `ENTRANCE_GATE_Z - 6` while the arch stood at
60, leaving the gate corridor 88.8 m inside the doorway — took the pool from 3
of 10 seeds building to 10 of 10. It is not mine and I have not touched it.

What it did not measure: **at 2.335x the park does not fit on its planet.**
On the rebased tree, *with #619's fix in place*, seed 11:

    the park reaches 247.0 m on a 220 m planet — 27.0 m PAST ITS OWN EQUATOR
    worst gradient INFINITE (tan theta) at 220.0 m

"The park builds" and "the park is on the planet" are different questions. #619
answered the first; `theGroundIsTheSphereItClaimsToBe` now asserts the second.

    scale 2.335 (#619's base)   501 passed  128 failed  0 pending
    scale 1     (this branch)   552 passed   96 failed  0 pending

**Do not settle this alone.** If 2.335x is wanted back, the planet must grow
with it — they are one decision, which is why they live in one expression.

## The claims migration (the lane proper)

World `(x, z)` is an **orthographic projection** of the planet — `terrain.ts`
puts the ground for `(x, z)` at `√(R² − x² − z²) − R`. Tangentially exact;
radially compressed by `cos θ`. At the park's reach a 1 m radial gap is **1.43 m**
of walking. `scripts/claim-chart-error.mts` is the measurement.

`src/boot/claimSurface.ts` is the new kernel (`arcBetween`, `arcToRun`,
`runsCross`, `eachRunSample`, `boundsOfRun`); `groundClaims.ts` asks it.
`geodesic.ts` gained `arcToSegment` as the `Geo`-domain form.

### The trap that nearly shipped, and the control that caught it

The first draft argued the cheap axis-box prefilter could stay as it was, since
a projection can only shorten. **True point-to-point, false point-to-run** — a
great circle projects to an ellipse, not to the chord, so a point can sit nearer
the chart's straight line than the real run. Swept over the park the flat kernel
**over-reads by up to 15.4 m**. That would have dismissed pairs that genuinely
share ground: a refusal that never happens, two solid things in one place, and
every narrow-phase test still green because the narrow phase is never reached.

The fix is not a fudge factor: box the **projected geodesic**, not the chord, and
the bound is exact again. Residual is pure discretisation, converging as `1/n²`
(0.269 m at 8 samples, 0.000004 m at 128). `boundsOfRun` uses 64;
`CLAIM_BROAD_PHASE_SLACK` is 0.05 m.

### The chart/arc split in `distanceOutside` — read before touching it

`distanceOutside` deliberately **stayed in the chart**. It compares a claim
against a **drawn mesh**, and the mesh is still chart-authored. Measured: the
road is drawn 3.89 m wide in chart metres, which at the kerb's reach of 108.7 m
is **4.50 m of real ground**, so a vertex exactly on the drawn kerb reads 0.611 m
outside an arc-metre claim and `check:ground-claims` failed at 0.5155 m on a road
that had not moved.

**The mesh is what is wrong**: `Entrance.ts` uses a constant chart half-width, so
the drawn road silently widens ~16% as it runs outward. That is the road's lane.
When ribbons are drawn on the sphere, `distanceOutside` moves back to
`distToCore` and the two metrics become one. Do **not** close this by loosening a
tolerance.

## What the kernel change costs, measured

**Behaviourally: nothing, yet.** `test:procgen` diffed by name against the
scale-1 run with the old flat kernel: **0 newly failing, 0 newly passing, 0
tests missing**. The registry is only wired to the entrance road today, so the
demand-serving bug this fixes has no consumer in the suite — the correction is
ahead of the consumers. `check:ground-claims` is the thing that actually
exercises it.

| run | total | passed | failed | pending |
|---|---|---|---|---|
| base | 625 | 297 | 49 | **279** |
| scale 1, flat kernel | 629 | 529 | 100 | 0 |
| scale 1, geodesic kernel (this branch) | 648 | 548 | 100 | 0 |

**Performance: neutral, and I nearly reported a regression that was not there.**
Wall times across whole-suite runs suggested 2.7x more CPU (246 s user against
672 s). That comparison was **confounded by machine load** — the two runs show
561% and 388% CPU, i.e. different parallelism from other agents on the box.

Controlled, one seed, same machine, back to back:

    geodesic kernel   34.61 s user
    flat kernel       37.18 s user

The geodesic is marginally *faster*, within noise. A micro-benchmark says the
kernel is 4.32x slower per call (80 ms against 19 ms for 2M calls) — which is
**40 nanoseconds a call**, far too small to matter; `boundsOfRun`'s 64 samples
cost 0.6 us each, and the road has 143 claims. **Do not compare whole-suite wall
times on this machine**; several agents share it.

## Not done

- **`clear(x, z, radius, distanceAlong)`** — untouched. Surveyed: there are
  **three** closures, not four (`railRace/` does not use the rail solver; the
  "sky cruiser" *is* the coaster). They are `slide/solve.ts:1234`
  (`chuteMayPass`), `train/route.ts:263` and `coaster/route.ts:927`. **None of
  them consults `GroundClaims`** — they use hand-picked keep-out disc lists,
  which is the pattern CLAUDE.md forbids. `coSolve.ts`'s `PlacementField` has
  **zero `src/` importers** and is dead. Wiring `clear` to the registry overlaps
  Fable's round-robin lane; coordinate before building a fourth thing.
- The invariant's `sin θ`/`tan θ` fault and its vacuous clause 1 (above).
- 100 `test:procgen` failures remain, mostly other lanes now visible for the
  first time: Sky Cruiser through the castle wall, a pylon 3.1 m off its own
  track, a cat bus 8.21 m tall, coping stones unseated.

## Rules I had to learn here

- **`git stash` is forbidden** (shared across worktrees). There are live stash
  entries from other agents; I did not touch them.
- The base branch's `check:ground-claims` **crashes** — it is not merely red.
  Measure the base before attributing a failure to your own diff.
