# Handoff: locomotion and gravity on the sphere

**Model: Opus 5 (1M context)**, chosen by the Overseer for the Engineer role on
the spherical-world rebuild. **A replacement runs the same model.**

**Branch** `eng/sphere-locomotion`, off `feat/sphere-combined` (base `714e7d4e`).
**Worktree** `.claude/worktrees/eng-sphere-locomotion`.

**Lane:** locomotion and gravity for movers — Player, NPCs, pets — on top of
`src/world/geo/`. The collision/nav engineer (`a581ec9314b321968`) owns
`Collision.ts` and `NavGrid.ts`; I call into them and do not edit them.

## What is done

**`src/entities/movement/gravity.ts` is the one owner** of how a mover leaves
the ground and comes back to it. Three callers: `Player.update`,
`NpcCharacter.move`, `scripts/playerSim.mts`. Before, those were three copies of
the arithmetic — and `playerSim.mts`'s own docblock called itself a copy, which
is this repo's commonest bug wearing a label.

Measured by `check:radial-hop` on the canonical park, origin as control:

| | base `714e7d4e` | now |
|---|---|---|
| apex at the origin | 1.2267 m | 1.2267 m |
| apex at the rim (157 m, 45.5°) | **0.8616 m** | **1.2267 m** |
| sideways excursion at the rim | **0.0000 m** (wanted 0.8754) | **0.8748 m** |
| settled landing drift | 0.0000 m | 0.0002 m |

Thirty per cent of a child's hop was being spent on how far she stood from the
middle of the park, and the hop itself leaned 0.875 m *towards* the middle in
her own frame because it ran along world `+Y` rather than the ground's own up.

## The three things I got wrong first, each caught by measuring

1. **The lift must be taken *after* the frame's gravity, not before.** Explicit
   instead of semi-implicit Euler over-reads the apex by one frame of
   `JUMP_SPEED`: **1.2267 → 1.3367 m**, a 9 % higher jump everywhere *including
   at the park's origin*, where nothing about the sphere was supposed to have
   changed anything. A control that moves has stopped controlling.

2. **The landing clamps `y` and so keeps the last part-frame's sideways lift.**
   **0.0319 m of outward drift per hop at the rim**, growing linearly with
   radius, on a hop that used to land exactly where it left. Thirty hops on the
   spot and a child has slid a metre towards the boundary.

3. **`landingCorrection`'s first form divided by `cos θ` where it multiplies** —
   2.04× too large at the rim. The *same inversion* I had caught in the
   collision engineer's docblock an hour earlier. Swept over the exponent
   instead of re-deriving it, settled drift at 0/40/80/120/157 m:

   ```
   up.xz · dy / up.y     0.0000  0.0003  0.0025  0.0100  0.0335   <- shipped first
   up.xz · dy            0.0000  0.0002  0.0012  0.0044  0.0139
   up.xz · dy · up.y     0.0000  0.0000  0.0000 -0.0003  0.0002   <- kept
   up.xz · dy · up.y²    0.0000 -0.0001 -0.0011 -0.0042 -0.0094
   ```

   The middle column bracketing zero from **both sides** is what makes that a
   measurement rather than a lucky guess. `up.y · dy` is `-altitude`, already
   computed, so the kept form takes the altitude in rather than holding a second
   definition of it.

## The units, settled with the collision engineer (both of us wrong once)

**`resolveMovement` takes CHART metres, deliberately** — it is a chart-space
solver end to end, and its anti-tunnelling guarantee is a statement about chart
perpendicular distance against chart-registered bands. So:

- **Walking: chart delta = real arc × cos θ. A MULTIPLY.** On a bare cap the
  chart coordinate is `R sin θ` and the arc is `R θ`, so `d(chart)/d(arc) =
  cos θ`. Measured at 157 m: one real metre of arc outward moves the chart
  0.698892 m against `cos θ = 0.700516`.
- **A hop's sideways half needs NO conversion.** The chart *is* the orthographic
  projection, so a point's chart coordinates are its world `x` and `z`, and any
  displacement's chart delta is just its own `x`/`z`. The `cos θ` belongs to
  motion *constrained to the surface*, where the real distance is an arc and the
  chart flattens it. Free flight has no arc.

We each had this inverted once, in opposite directions, and both corrections
came from arithmetic rather than argument. **If you find a docblock saying
"divide by cos θ" anywhere near a delta, check it.**

## The walk metric — also done

`PLAYER_MAX_SPEED` is metres per second of **real ground**; `resolveMovement`
takes **chart** metres. Nothing converted, so a child sped up as she walked away
from the middle of the park. Ground covered against ground asked, over a 7.4 m
run, before → after:

| | outward | inward | tangential |
|---|---|---|---|
| d = 0 m (0.0°) | 1.0000 → 0.9988 | — | — |
| d = 40 m (10.5°) | 1.0333 → 1.0058 | 1.0107 → 1.0016 | 1.0018 → 1.0006 |
| d = 80 m (21.3°) | 1.0960 → 0.9990 | 1.0578 → 1.0031 | 1.0015 → 1.0001 |
| d = 120 m (33.1°) | 1.2274 → 0.9888 | 1.1485 → 0.9942 | 1.0009 → 0.9993 |
| **d = 157 m (45.5°)** | **1.5473 → 1.0072** | **1.3461 → 1.0047** | 1.0024 → 1.0000 |

Worst radial error **0.5473 → 0.0112**; the residue is the wave field's own
undulation, which is ground she really covers.

`chartStep` compresses **only the radial component**, by `cos θ`. `realStep` is
its inverse and **is not optional**: both movers read velocity back off the
resolved position, and that read-back lands in `velocity`, which is a real speed
`chartStep` compresses again next frame. Proved by mutation — drop the inverse
and the covered/asked ratio at the rim goes to **0.3366**, a child crawling, and
it presents as the walk sticking rather than as a units bug.

## Still open, in priority order

1. **`NpcCharacter.move` has no direct measurement.** Its vertical and walk
   halves are line-for-line twins of `Player.update`'s and both call the same
   owner, and the owner is unit-tested — but *nothing runs an NPC and measures
   where she goes*. `scripts/trace-npc-driver.mts` looks like it would and does
   not: it drives `WanderDriver`s with **no `CollisionWorld` and no
   `NpcCharacter` at all** (its own header says collision is not what a driver
   decides), which is why its hash is byte-identical across all of this work —
   `trace=2cdba2c3`, 362 hops, on base and on this branch. That identical hash
   is **correct and not evidence the change is inert**; I checked rather than
   assumed. The gap is real: constructing an `NpcCharacter` headlessly needs an
   `NpcAvatar` rig, which is why I stopped rather than half-did it.
2. **`advance` is still unused by this lane.** `chartStep` gets the metric right
   by scaling a chart delta, which is the conversion the collision boundary
   wants today. `geodesic.ts`'s `advance` is the primitive that would get the
   metric *and* the heading's parallel transport right together, and it is the
   better answer the day `resolveMovement` can take a `Geo`. Not a defect now;
   the direction of travel.
3. **Pets.** There is no pet gravity integrator to convert — `WildPets` poses
   its animals in a group-local frame, and `GRAVITY * dt` appears nowhere else
   in `src/entities`. Confirmed on `eng/radial-collide` and still true. Nothing
   to do unless pets gain their own movement.
4. **A deck hop is not covered** by `check:radial-hop` — `SimPlayer` is fed
   `terrainHeight`, so every hop it measures is off the grass. Same code path,
   nothing would notice if it broke. The check announces this on every run.
5. **`check:deck-fallthrough` only runs at 10–40 m from the origin**, and my
   attempt to close that from outside is unfinished — `scratch/rim-deck.mts`,
   whose head explains exactly how far it got and what is wrong with its
   geometry. **Its numbers are not quotable yet.** The detector in it is sound
   and controlled; the deck it builds is not a shape the park contains. Finish
   it by building the deck at constant height above the *local ground* along a
   geodesic, which is what a bridge is, rather than at a constant world-`y`
   gradient over chart x. Original note follows: (its ramp
   is `RAMP_X0 = -40`, length 30, `z = 0`), so the worst lean it ever sees is
   **10.5°** against the park's 45.5°. It is the check that caught the earlier
   re-derive-from-altitude runaway at 401 of 1280 runs, and it is green here —
   but a radial fault would be roughly four times more visible at the rim than
   anywhere that harness looks. Worth a second ramp further out.

## Rules inherited, and why (do not relearn these)

- **Never re-derive a position from an altitude.** `position = foot + up *
  altitude` makes lateral position a function of altitude, so a surface dropping
  away teleports the mover sideways, which raises the altitude further.
  `check:deck-fallthrough` went green → **401 of 1280 runs losing the surface at
  gradient 0.1**, gaps to 50 m. The lateral half must be an **integrated
  impulse**, which is what `liftAlongUp` is: altitude is only ever *read*, never
  written back as a position, so the runaway is structurally impossible rather
  than merely absent.
- **Nothing moves a mover in `x` or `z` except `resolveMovement`.** The hop's
  lateral half and the landing correction both ride the step; the landing
  correction is deferred one frame to do it.
- **A per-frame tilt is never a pre-multiply.** `faceOnGround`, not
  `standOnGround`, inside a tick.
- **`walkHeight(x, -Infinity, z)` is `+Infinity`, not `NaN`**, and `baseHeight`
  defaults to `-Infinity` on nearly every collider — the naive radial conversion
  of the base gate makes the whole park non-solid, and it typechecks. The
  collision engineer is handling this at the type (`geo/step.ts`'s
  `riseBetween` takes two positions and has no height overload).

## The parity measurement I took wrongly, and the tell that caught it

**Do not run two `test:procgen` suites at the same time on this machine.** I ran
the base's and mine concurrently to save wall clock. Both came back

```
160 passed, 0 failed, 465 skipped   —   5:15 and 5:16, 22% CPU
```

and the non-passing sets were **identical by name**, so it read as clean parity.
It was two starved runs agreeing with each other. Run alone, the same branch
gives

```
315 passed, 49 failed, 279 skipped  —   1:59, 224% CPU
```

Faster *and* more thorough, because vitest could actually use its workers. Under
contention it was bailing and booking the remainder as skips.

**The tell was the duration and the CPU percentage, not the counts.** CLAUDE.md
already says to watch the duration — a silent-skip bug once took this suite from
89 s to 2.6 s — and the shape here is the same lesson pointing the other way:
the *slow* run was the broken one, and 22% CPU on a machine with cores to spare
is the number that gives it away. A pass count cannot see this, and two wrong
runs agreeing is not a control; it is the same mistake made twice.

Two of my own commit messages (`check:radial-hop joins the chain` and the
`test:procgen` line in it) quote the 160/0/465 figures as parity. **Those
numbers are an artefact of how I ran it, not a property of either branch**, and
this section is the correction rather than a rewrite of history.

## What the gates say

- **`tsc --noEmit`**, **`typecheck:test`**, **`vite build`** — all exit 0.
- **`check:deck-fallthrough`, `check:hop-clearance`, `check:wall-tunnelling`** —
  green. The first is the one that caught the earlier
  re-derive-position-from-altitude runaway at **401 of 1280 runs**; it stays
  green, which is the signal that an integrated impulse does not have that
  shape.
- **`test:procgen`**, each run **alone** (see the section above for why that
  matters):

  | | passed | failed | skipped |
  |---|---|---|---|
  | base `714e7d4e` | 297 | **49** | 279 |
  | this branch | 315 | **49** | 279 |

  **Non-passing sets identical by name.** The 18 extra passes are exactly
  `test/entities/gravity.test.ts`. The collision engineer measured the same 49
  on both sides independently, and `eng/radial-collide` recorded 49 before
  either of us.

  The 49 failures and 279 skips are the base's own: `new World` throws in
  `crossings.ts` (`railD 0.0 (0.0, 125.8)`, no proven bridge site), so every
  park-harness test dies at construction. `eng/radial-collide` bisected it to
  the merge `502ec802` — the gate arch's colliders moving the path router's
  answer. Not radial, not mine.
- **`pnpm run check`** — dies at `check:npc-presence` with exit 1 **on the base
  too, at the identical step**, for the same reason. My two new steps run and
  pass before it.

## Running things

```
node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/check-radial-hop.mts
node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scratch/drift.mts
pnpm run check:deck-fallthrough   # + check:hop-clearance, check:wall-tunnelling
```

`check:radial-hop`'s three clauses are each proved red by their own mutation,
with the origin control passing every time, **against the geometry as it stands
at `714e7d4e` with `GROUND_SPHERE_RADIUS = 220`**:

| mutation | result |
|---|---|
| `altitudeAbove` → `y - groundY` | drift 0.0139 m at the rim (tol 0.01), 5 rows FAILED |
| `liftAlongUp` → `(0, metres, 0)` | apex 0.8616 m, sideways error 0.5929 m, 20 of 21 FAILED |
| `landingCorrection` → zero | drift 0.0319 m at the rim, 15 rows FAILED |

The second reproduces the base's numbers exactly, which is the cross-check that
the mutation really is "the code as it was".

`check:walk-metric` and `test/entities/gravity.test.ts` likewise:

| mutation | result |
|---|---|
| drop `realStep` from the read-back | covered/asked **0.3366** at the rim — she crawls |
| `chartStep` divides instead of multiplying | 1 of 18 unit tests red |
| `chartStep` scales the whole step, not its radial part | 2 of 18 red |
| `landingCorrection` sign flipped | 1 of 18 red |
| `altitudeAbove` drops its indoor branch | 1 of 18 red |

**One process note, learned expensively here:** I ran `git checkout -- <file>`
to undo a mutation while that file still held **uncommitted** work, and threw
the work away. Commit *before* you mutate, every time; the mutation is a
throwaway and your branch is not.
