# Radial collision / navigation / gravity — engineer handoff

Branch `eng/radial-collide` off `feat/sphere-combined`. Area: `CollisionWorld`,
`NavGrid`, gravity/jumping/falling (Player, NPCs, pets).

## Chosen approach: keep the chart, fix the metric and the frame

**(x, z) is already an exact, invertible, global chart of the ground.** The
ground is a spherical cap over the xz-plane; for `d < GROUND_SPHERE_RADIUS`
(220 m) the map `(x,z) -> surface point` is a bijection — it is an orthographic
azimuthal projection. Tangential distances are preserved exactly; radial
distances are compressed by `cos θ`. So the 2D model is not *topologically*
wrong. It is wrong in two specific, separable ways:

1. **Every height in it is a world `y`**, and world `y` out in the park is
   mostly *where you are*, not *how high you are* (radial gradient 1.02 m/m at
   157 m). → replace with **altitude**: `altitudeAt` / `yAtAltitude` /
   `planetRadiusAt`, which `terrain.ts` already owns.
2. **Every length in it is a chart length** compared against a real-world
   threshold. → one metric helper, `cos θ = sqrt(R²−d²)/R`, applied where a
   chart length is measured against metres of actual ground.

Rejected: **per-mover local tangent frames.** Two movers at different places
would disagree about the geometry *between* them, so a wall's position would
depend on who asked. The chart is shared and global; a tangent frame is not.

Rejected: **a genuinely 3D model on the sphere.** It is the most correct answer
and it is not one engineer's ticket — every collider, every nav cell and every
generator that lays the park out in (x, z) would have to be re-expressed.

**Mover state becomes (chart column x,z) + altitude.** `position.x/z` stays the
foot column — collision and nav keep working in the chart, which is exact —
and `position.y = yAtAltitude(x, z, altitude)`, so `altitudeAt(position)` gives
the altitude back exactly. Gravity integrates *altitude*, not `y`. The visual
lift along the local up (`liftFromGround`) is applied at draw time only, so the
hop *looks* radial without dragging the collision column sideways.

**Can a child walk right round the ball? No, and this approach does not change
that.** The chart is singular at `d = 220 m` (θ = 90°, the metric factor goes
to infinity). The park reaches 157 m. Walking round would need a genuinely
spherical chart (lat/long or cube map) and a rebuild of the generator. Flagged
for Jim — a design consequence, not an implementation detail.

## Measured, with controls run first — `scratch/nav-control.mts`

`node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scratch/nav-control.mts`

Two gates compared: today's `|Δy| > MAX_STEP` (0.62) against the radial
`|Δradius| > MAX_STEP`.

- **Control A (flat grass must pass).** Radial gate: worst 0.016 m anywhere —
  passes. Today's gate: **0.729 m at the rim diagonal (111, 111) → BLOCKED.**
  Tap-to-move refuses to path outward on level ground. This is the reported bug.
- **Control B (a real 0.70 m ledge must be blocked).** Radial gate blocks it in
  every direction at every radius (0.690–0.710). **Today's gate LEAKS it
  outward from d≈80 m** — reads 0.555 m at 80 m and 0.482 m at 157 m. So the
  router today also plans a child straight **up** a real 0.7 m wall on the
  outward side. Second bug, same cause, not in `RADIAL-INVENTORY.md`.
- **Control C (a legal 0.40 m stair must pass).** Both gates pass it.

**`MAX_STEP` itself needs no change, and raising it is the wrong fix.** To let
flat grass through it would have to exceed 0.729 at 157 m and **1.007 at
180 m** — a different value at every radius — and at that setting it admits
real ledges of 0.51–0.58 m of altitude unchecked. It trades the refusal for a
worse leak. Told the lead engineer.

My first control was itself wrong: it injected the test ledge as 0.7 m of world
`y`, which out at 157 m is only 0.49 m of real altitude, and both gates
"leaked" it. The ledge has to be built with `yAtAltitude`. Recorded because it
is exactly the instrument fault CLAUDE.md warns about.

## Measuring, given `check:park` is blocked

`feat/sphere-combined` cannot build the canonical park headlessly — a `railD
0.0` crossing throw in `new World`, pre-dating all sphere work
(`RADIAL-INVENTORY.md` §0). So `check:park`'s six stranded waypoints cannot be
read yet. Interim instrument is `scratch/nav-control.mts` above, which needs no
park. A reachability sweep over a built park follows once the crossing throw is
fixed — with a control on the flood fill first.

## Status

- [x] Approach chosen and reported to the Overseer
- [] NavGrid: level/step tests onto `planetRadiusAt`
- [ ] CollisionWorld: `topHeight` / `baseHeight` / `clearance` onto altitude
- [ ] Gravity: integrate altitude, on Player, NpcCharacter, pets
- [ ] Fall detection onto `altitudeAt`
- [ ] Invariant in `test/procgen/invariants.ts`
