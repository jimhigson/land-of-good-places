# Collision and navigation on the sphere — engineer handoff

**Branch** `eng/sphere-collide`, off `feat/sphere-combined`.
**Worktree** `.claude/worktrees/eng-sphere-collide`.
**Model: Opus 5 (1M context)**, chosen by the Overseer's Engineer default. A
replacement runs the same model.

Reports to the Overseer (`landofgoodplaces-fc`). The sphere core's lead is
`ae21f389892fc9e65`; the locomotion engineer is `ae666c49576b371b5`
(`eng/sphere-locomotion`).

Read `src/world/geo/index.ts`, `HANDOFF-sphere-core.md`, and
`HANDOFF-radial-collide.md` on the stood-down branch `eng/radial-collide` —
that last one is the most valuable document for this lane and most of what is
below builds on it.

## Done, committed, pushed

### `geo/step.ts` — `riseBetween`, `riseBetweenWorld`, `columnYForRise`

**There is no per-place height on a ball that two neighbours can be differenced
against.** That is the load-bearing sentence of this lane. Both obvious
candidates were tried on `eng/radial-collide` and both are wrong:

- a **radius** from the planet's centre does not cancel between two off-ground
  points at different `(x, z)` — 0.54 m for a 1.3 m radial move at 90 m out;
- an **altitude above the ground** reads a level bridge deck over falling ground
  as a continuous climb, and would refuse the deck end to end.

So a step is irreducibly a question about a **pair** of places: project the
vector between them onto the local up. `riseBetween` is the one owner.

It takes the **midpoint's** up, not `from`'s, so it is exactly antisymmetric —
an edge cannot be admitted in one direction and refused in the other, which A*
is entitled to assume. `from`'s own up is out by 4.57e-3 m on a pair at the
park's reach: small enough to hide, and it surfaces as one unreachable cell on
one seed.

**Sentinels cannot reach it.** Both arguments are positions; there is no height
overload; no caller scalar goes near `Math.hypot`. That is the structural answer
to `eng/radial-collide`'s catastrophe — `walkHeight(x, -Infinity, z)` is
`+Infinity`, **not** `NaN`, because `hypot` is unsigned, and `baseHeight`
defaults to `-Infinity` on nearly every collider, so `if (moverUp < baseUp)
continue` skipped **every collider in the game** and typechecked cleanly. Keep
the sentinel out of the geometry; do not guard it inside.

`columnYForRise` is the inverse down one column, for callers that go *looking*
for the next surface rather than compare two they hold. Three fixed-point
passes; residual 5e-3 m after one, 3e-6 after two, 9.95e-9 after three.

`test/geo/step.test.ts`, 6 tests, every assertion paired with a control that
fires with a real number. **Proved red** by putting the datum back on world `y`:
`3 failed | 2 passed` (the two survivors are antisymmetry, which world `y` also
has, and the same-column case, which is meant to agree).

### `NavGrid` — the brief's headline defect, deleted

One wrong datum, two opposite symptoms, both live in the game until this
change. Measured by `scratch/nav-step-frame.mts`, which runs the same expression
on a flat world as its control (the two frames agree there to 1.11e-16 m):

| case | world-`y` difference | `riseBetweenWorld` |
|---|---|---|
| level ground, radial diagonal at d = 157 m | −0.724 m (**refused**) | −0.000 m (ok) |
| level ground, radial diagonal at d = 184.3 m | −1.092 m (**refused**) | 0.000 m (ok) |
| a real 0.70 m ledge at d = 40 m | 0.595 m (**admitted**) | 0.700 m (refused) |
| a real 0.70 m ledge at d = 157 m | −0.022 m (**admitted**) | 0.700 m (refused) |

against `MAX_STEP` = `BUILDING_STEP_UP` = 0.62 m. So tap-to-move silently
refused to path outward over walkable grass, and further in it planned a child
straight up a ledge she cannot climb.

Four gates converted, all to the one owner so they cannot drift: the A*
neighbour edge, the string-pull in `smooth()`, `nodeAt`'s level match, and the
level search (which handed its sampler `MAX_STEP` verbatim as a world `y` and so
started too high and walked past levels — 0.62 m of height is **0.884 m** of
world `y` at d = 157 and **1.132 m** at d = 184.3).

**Raising `MAX_STEP` was the wrong fix and is measured to be**: to admit flat
grass it must exceed 0.729 at 157 m and 1.007 at 180 m — a different value at
every radius — and at that setting it admits real ledges of 0.51–0.58 m
unchecked. There is no single number in the wrong frame. The docblock says so.

### `Collision.ts` — the absolute top, read at the contact point

**The frame is not the disease, and this is the single most important
correction in this lane.** `eng/radial-collide` converted this gate wholesale to
an altitude and it put two procgen invariants at *"0.00 m of standable width"*.
That was not bad luck. Comparing world `y` against world `y` is **exactly
right** for a top that genuinely is a constant-`y` plane — a hotel sofa's plate,
a built deck — and converting those to an altitude or a radius makes them wrong.

The disease is **a single scalar on an extended collider**: one number is right
where it was sampled and wrong everywhere else along the same collider. Give the
collider enough numbers to describe what is drawn and the frame question
dissolves.

So a wall now carries two tops, one per end, read at the `t` that `resolve`
already computes. Measured, marching a 0.62 m body into the middle of a 10 m
fence run whose own ground falls 3.92 m along it:

| | reach |
|---|---|
| one top | z = 19.18 **and** z = 23.00 — depending only on which end the builder wrote first |
| two tops | z = 19.18 and z = 19.18 |

One order solid, one a ghost, for the same physical fence. `topHeightFar`
defaults to `topHeight`, so every existing call site is unchanged bit for bit
and `test:procgen` parity is **structural rather than hoped for**.

`checkAbsoluteTopSag` is the new boot check, and **correcting my own control on
it produced the most transferable finding here**: two tops describe a *chord*
where the ground is a *cap*, the sag is `L²/8R`, and **the dominant term is the
segment's own length, not the lean**. The same 20 m run sags 0.227 m through the
middle of the park against 0.248 m at d = 80 m. The lean multiplies it (2.9× at
the reach, radially); it does not cause it. I had assumed the origin was exempt,
because every other defect in this lane *is* about the lean, and the control is
the only reason I found out otherwise.

At a 5 cm tolerance the ceiling is about **9.4 m of segment** anywhere in the
park, and under 4 m to be safe radially at the rim. `fence.ts` registers
`STEP` = 2.4 m pieces (3–9 mm out), so two tops is comfortably right for it.

## The boundary with locomotion, settled — and I had it backwards

`resolveMovement` takes **chart metres**, deliberately, and this is now
documented rather than true by accident. `CollisionWorld` is a chart-space
solver end to end: colliders are registered as chart `(x, z)` with chart
widths, and `maxSafeStep` — the anti-tunnelling budget — is derived from
`thinnestHalfWidth`, so the guarantee is a statement about chart perpendicular
distance against a chart-registered band. Real metres in the delta with the
bands still chart-registered would silently break exactly that.

**I gave the locomotion engineer the conversion inverted, in both halves, and he
caught it. Verified myself afterwards; he is right:**

- **Walking**: chart delta = real arc **× cos θ**, a multiply. Measured on the
  bare cap at d = 157: one real metre of arc outward moves the chart coordinate
  0.698892 m against cos θ = 0.700516.
- **The hop's lateral half needs no conversion at all.** The chart coordinate of
  a point *is* its world `x` and `z` — the chart is an orthographic projection,
  not an unrolling — so any displacement's chart delta is that displacement's
  own `x, z` components. A hop of h along the local up is h sin θ laterally:
  0.8754 m at the rim, in both frames. My suggested `1/cos θ` gives 1.7511 m,
  a 43% over-throw, and she would not land where she took off.

**The rule that stops this being re-derived wrongly a third time:** the cos θ
belongs to motion *constrained to the surface*, where the real distance is an
arc and the chart flattens it. Free flight has no arc.

### The chart anisotropy — and I called it safe too quickly

Since the walk step itself is now converted, **this is the only remaining place
where the two metrics disagree in the walk path**, and it is no longer masked by
the step being wrong in the same direction.

Every collider is registered with a chart `halfThickness`/`radius`, and the
mover's own `radius` is compared in chart space too. So in real ground metres a
mover's body is not a circle but an **ellipse**, stretched radially by `1/cos θ`:
1.24 m across tangentially and 1.77 m radially at the park's reach. The
clearance the solver demands of a radial gap, for a 0.2 m fence and
`PLAYER_RADIUS`:

| d | lean | real clearance demanded | overshoot |
|---|---|---|---|
| 0 m | 0.0° | 0.820 m | 0.000 m |
| 80 m | 21.3° | 0.880 m | 0.060 m |
| 157 m | 45.5° | 1.171 m | 0.351 m |
| 184.3 m | 56.9° | 1.502 m | 0.682 m |

**I first wrote that this "errs towards more solid, the safe direction". That
was too glib and I am correcting it**, because eating clearance is precisely
what CLAUDE.md says solidity must never cost — `keepOutsFor` is the single owner
of where a child has to be able to stand.

The honest position, after measuring, is that **it depends on what the geometry
was authored in, and I could not settle which**:

- Geometry **placed procedurally by chart `(x, z)`** — most of the park — is
  self-consistent. Two walls 1.64 m apart in chart are 2.34 m apart on the real
  ground at the rim, and her radially-fat body scales with them. She fits.
- Geometry **authored in real metres** — a Blender asset's doorway, attached at
  an anchor — does not scale with the chart. A real 1.64 m doorway at the rim is
  1.15 chart metres wide against a body the solver treats as 1.24 chart, and it
  is **refused**. The gate arch sits near the boundary and is the obvious
  candidate.

**The check that could settle this is the one that is broken.** It needs a built
park (`check:park`'s reachability probes, or `keepOutsFor` marched at real
doorways), and nothing through `park-harness` runs while `crossings.ts` throws.
So this is measured in principle and unmeasured in the game, and it should not
be called safe until somebody has stood a body in those doorways.

## Open, in priority order

1. **Nothing in the park has been converted to declare two tops yet.** The
   mechanism is in and proven; no builder uses it, so the live ghost is still
   live. The next step is `train/fence.ts` and `train/bridges.ts`, and the
   reading that matters before touching them:

   `fence.ts` registers an ordinary fence segment with the **default infinite
   top** (`addWall(a.x, a.z, b.x, b.z, FENCE_HALF_THICKNESS)`, lines 267 and
   347), and those are always solid. It registers a `topIsAbsolute` wall only
   where a segment falls under a bridge deck, with top = `deckY -
   FENCE_SEAM_MARGIN`. **So the reported ghost is the seam wall, not the
   ordinary fence** — which also means it is the same wall the parapet
   regression is about, and the two must be fixed together or neither.

   `deckY` comes from `deckSpanForSegment`, which samples three points and takes
   the **lowest world `y`** as a deliberate conservatism (leave the seam as open
   as possible). On the sphere that picks the wrong sample: the ground falls at
   up to 1.02 m per metre, so of two samples the one further out has the lower
   `y` **and** the greater height above the ground — minimising `y` selects the
   sample that makes the seam *least* open, the opposite of the intent. Seam
   reads 5.91 m at crossing (138.9, −82.1) against a walker on the deck at
   5.05 m. Two tops gives `deckSpanForSegment` somewhere to put both ends
   instead of choosing between them, which is why the mechanism had to come
   first.

   `geo/Field.ts`'s `constantOver(chart, value)` is the end state — it will not
   let a run claim one height without naming a chart it is constant over, and
   there is no chart on this planet 60 m across for which that is true. Two
   tops is the cheap form of the same idea, at no per-frame allocation.
2. **The bridge-parapet regression is still undiagnosed and must be assumed
   live.** `eng/radial-collide` converted this gate and two procgen invariants
   went to *"0.00 m of standable width"* on seeds 11 and 326 — the seam fence
   goes solid across the bridge deck. `fence.ts`'s `deckSpanForSegment`
   minimises the seam in world `y` where it should minimise in altitude (of two
   samples the one further out has the lower `y` **and** the greater height
   above ground, so minimising `y` picks the sample that makes the seam *least*
   open — the opposite of the conservatism intended; seam reads 5.91 m against a
   walker at 5.05 m). **Fixing that alone did not clear the invariants**, so
   there is at least one more cause. `scratch/seam.mts` on `eng/radial-collide`
   is the instrument; extend it to march the invariant's own `standableReach`
   across the deck rather than sampling the crossing centre, because the failure
   is about the deck's *width* and every probe so far has been at its middle.
   **Do not repeat the struck claim** that `fence.ts` pins a flat `deckY` per
   run — `deckSpanForSegment` is already per-segment and already samples three
   points.
3. **`TapNavigator`'s two `MAX_LEVEL_GAP` comparisons** (lines ~323, ~442) are
   still bare world-`y` gaps in the same column, so the gate is up to 1.43×
   tighter than it claims at the rim. Conservative (it reports not-arrived when
   she has arrived), so not urgent, but it is the same defect.
4. **`check:park`'s six stranded waypoints are not mine and not a nav fault** —
   two boundary walls with `top = Infinity` and no base, meeting across a 2.94 m
   edge. No frame conversion touches them. Measured on `eng/radial-collide` and
   reproduced without that branch. A layout defect with another owner.

## How this is gated

**`test:procgen` base parity, diffed by name and count**, against
`714e7d4e` built in
`scratchpad/collide-base`. It is what caught the last engineer's regression and
it is why they reverted rather than shipped. Run it before every push that
touches a gate.

### The tripwire has its own failure mode, and the pass count cannot see it

**Quote the skip count, every time, and treat 465 as a VOID run rather than a
green one.** On a machine running several lanes at once, vitest under CPU
contention bails and books the remainder as *skips*, so the suite comes back
with **no failures at all** and reads as triumphant. The two signatures, off my
own screen:

| run | duration | Tests line, verbatim |
|---|---|---|
| mine | 99.29 s | `49 failed \| 303 passed \| 279 skipped (631)` |
| base | 98.98 s | `49 failed \| 297 passed \| 279 skipped (625)` |
| mine, post-Collision | 254.61 s | `49 failed \| 308 passed \| 279 skipped (636)` |
| **mine, "run alone"** | **366.47 s** | **`171 passed \| 465 skipped (636)`** |

**279 skipped is healthy. 465 skipped is starved, and a starved run asserts
nothing.** The locomotion engineer hit this first and committed two messages
quoting starved figures as parity; his prescription was *run them one at a
time*, and **that is not achievable here** — my slowest, most degraded run is
the one I deliberately ran on its own, because four other lanes were busy. You
cannot control the machine, so control the *instrument*: read the skip count.

Two things worth keeping from it:

- **Two wrong runs agreeing is not a control**, it is the same mistake made
  twice. A base-vs-branch diff of two starved runs matches perfectly and means
  nothing.
- **It is the opposite shape to the one CLAUDE.md records.** That file's example
  is a silent-skip bug that made the suite suspiciously *fast* (89 s → 2.6 s),
  so "fast" is the documented tell. Here the broken run is the **slow** one.
  Neither direction is the signal; the **skip count** is, and a pass count
  cannot see either case.

My three healthy runs are what the parity claim rests on, including a
base-vs-branch pair taken **under the same contention at the same time**, which
is the fairest comparison available on a shared machine.

### And chasing that skip count found the thing that actually matters

**The tripwire covers two of the five seeds. The other three skip all 93
invariants on every run — on `main`'s base as well as on this branch, on the
fast runs as well as the slow ones.** Per file, off the base run:

```
seed-canonical.test.ts  (93 tests | 93 skipped)    2583ms
seed-131.test.ts        (93 tests | 93 skipped)    5960ms
seed-24.test.ts         (93 tests | 93 skipped)    6576ms
seed-326.test.ts        (93 tests | 25 failed)    88743ms
seed-11.test.ts         (93 tests | 24 failed)    98256ms
```

So the two numbers decompose exactly: **279 skipped is 3 seed files × 93, and
465 is 5 × 93.** The "healthy" baseline was never healthy — it is three seeds
permanently dark, and contention merely takes the remaining two as well.

The cause is the **same `railD 0.0` throw** that blocks the check chain: the
park build dies during those files' setup, at `(0.0, 125.8)`, `(0.0, 124.8)`,
`(0.0, 120.8)` — a different crossing per seed — and the file responds by
skipping its 93 tests rather than failing them. The tell is the runtime: the
three dark files bail in 2–7 s where the two live ones take 88–98 s.

**This makes `railD` far more serious than "it blocks ~30 check steps".** It
silently deletes 60% of the coverage of the one suite that is a *required*
merge gate, and it does so while the suite still prints a confident red/green.
It is CLAUDE.md's own "a skipped test is not a passing test", live, at seed
granularity — and that file even records the previous instance of it (one
failure and 76 silent skips, where the tell was the pass count).

**What this costs my own conclusions, stated plainly:** every parity claim on
this branch is a parity claim about **seeds 326 and 11 only**. It is a real
comparison and the failing sets really are identical by name, but it is not
cover over the canonical seed, 131 or 24, and it must not be read as such.
Nothing in this lane has been proven against those three.

## Instruments, and the ones that lied

`scratch/nav-step-frame.mts` — the nav step gate in both frames, no park build
needed, with a flat-world control as its first output.

`HANDOFF-radial-collide.md` lists **four wrong-but-clean measurements** that all
read decisively and were all wrong. Re-read them before building any instrument
in this lane; the shapes recur. Briefly: a test ledge built as `terrainHeight +
0.70` measures 0.49 m of real height at the rim (build it along the local up —
`test/geo/step.test.ts`'s `onCap` does); `keepOutsFor` returns **deck-local**
coordinates and feeding them to `spaceAt` asks about the grass; a ring probe at
157 m falls outside the play bounds where the leash shoves a mover 16 m and it
reads as "the collider was solid"; and re-deriving position from altitude makes
lateral position a function of altitude and teleports her off any surface that
drops away.
