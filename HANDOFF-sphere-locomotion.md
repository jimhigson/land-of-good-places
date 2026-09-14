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

## Still open, in priority order

1. **The metric factor — walking speeds up as she walks outward, by up to
   1.43× at the rim.** Not started, and it is the biggest remaining thing a
   child would feel. The fix is mine and agreed: scale the radial component of
   the walk step by `cos θ` before handing it to `resolveMovement`. This is
   where `geodesic.ts`'s `advance` belongs — it is the primitive that gets both
   the metric and the heading's parallel transport right at once.
2. **`check:radial-hop` is not yet in the `check` chain.** It is green now, so
   it should go in. It was deliberately left out while it was honestly red.
3. **Pets.** There is no pet gravity integrator to convert — `WildPets` poses
   its animals in a group-local frame, and `GRAVITY * dt` appears nowhere else
   in `src/entities`. Confirmed on `eng/radial-collide` and still true. Nothing
   to do unless pets gain their own movement.
4. **A deck hop is not covered** by `check:radial-hop` — `SimPlayer` is fed
   `terrainHeight`, so every hop it measures is off the grass. Same code path,
   nothing would notice if it broke. The check announces this on every run.
5. **`check:deck-fallthrough` only runs at 10–40 m from the origin** (its ramp
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
