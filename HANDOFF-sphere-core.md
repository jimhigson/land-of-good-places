# Handoff: the sphere core (lead Engineer)

**Model: Opus 5 (1M context)**, chosen by the Overseer for the lead Engineer
role. A replacement runs the same model.

**Branch:** `feat/sphere-combined`. Worktree
`.claude/worktrees/sphere-combined`.

**Design:** `SPHERE-DOMAIN.md` on `arch/sphere-domain`. Jim rejected its 9–11
week estimate and ruled *"just fan out agents and do it now"*, plus one scope
cut: **a child never needs to walk right round the planet.**

## Done, committed, pushed

`src/world/geo/` — the core vocabulary. `test/geo/core.test.ts`, 28 passing,
every assertion paired with a control that fires with a real number.
`pnpm exec tsc --noEmit` clean.

- `Geo.ts` — a position is a 3-vector from the planet's centre. Components
  `cx`/`cy`/`cz`, deliberately not `x`/`y`/`z`.
- `Frame.ts` — place plus orientation. No global yaw.
- `Chart.ts` — curved (exp/log map, exact anywhere) and flat (declared
  `validFor`, computed `departure`, throws outside). `PARK_CHART` is the
  domain.
- `Field.ts` — `constantOver(chart, value)` is the only way to turn a sample
  into a field.
- `Anchor.ts` — the one translation to Cartesian, at scene-graph attachment.
- `geodesic.ts` — `advance` (walk + parallel transport), `geodesicLerp`,
  `tangentTowards`, `rotateGeoAbout`.
- `ground.ts` — `groundRadiusToward`, `altitude`, `setAltitude`, `dropToGround`.

## The fact everything rests on

**World space is a pure translation of planet-centred space: `(0, +220, 0)`.
No rotation, no scale.** The ground cap is tangent at the park's origin, so
the planet's centre is exactly `(0, -220, 0)` in today's coordinates —
`terrain.ts`'s `planetRadiusAt` has been asserting this since the arrival-camera
fix, and `test/geo/core.test.ts` now asserts it too.

Consequences: `fromWorld`/`toWorld` are exact and free; every *direction* and
every quaternion already in the codebase is valid unchanged; distances are
identical. **A subsystem converts at its own boundary and reasons in `Geo`
inside while its callers still speak world coordinates.** That is the migration,
and it is why several engineers can work at once.

## The bug the controls caught, worth not re-making

`groundRadiusToward` was first written as the obvious fixed point
`r = (terrainHeight + R) / dy`. Its contraction factor is **`tan²θ`** — the cap
moves between steps as well as the waves, and the cap's own gradient is `tanθ`.
That is exactly 1 at 45° of lean, and **the park reaches 45.5°**. It was out by
0.16 m at the park's reach and converged fine everywhere a careless test would
have sampled.

The fix solves for *the radius of the ground point in the column the direction
reaches*, which is exact at convergence (|d| = 1 forces `h + R = r·dy` once the
radii agree) and contracts at 0.07 a step, because only the waves move — the cap
contributes exactly `R` on every bearing, which is what being a sphere means.
Worst residual across the sample sweep: **0.000 mm**.

## Numbers the controls print on every run

```
200 m walked the naive flat way leaves the surface by  77.32 m
a straight lerp over 150 m sits under the geodesic by  15.27 m
at (157, 0) a 10 m lift reads 10.00 m honestly, 14.73 m as a y-difference
five pre-multiplied per-frame tilts drift               160.0°
a flat chart big enough to hold the park is out by      55.23 m at its edge
```

## Latent defect noticed, not yet fixed

`terrain.ts`'s `groundWaves` docblock claims the waves are displaced **along
the local surface normal**. They are not: `terrainHeight` adds `base · cos θ` at
a fixed `(x, z)`, which is the vertical component only and keeps the column. So
the wave's contribution to *radius* is `base · cos²θ` — half amplitude at the
park's reach, not full. Under 0.6 m, so nothing is visibly wrong, but it is a
docblock promising something the code does not do. Worth a small ticket; the
`geo/` layer is consistent with the drawn ground either way, because it solves
against `terrainHeight` itself rather than re-deriving the field.

## What comes next for whoever holds this

The three rules that cover most of what goes wrong when migrating a subsystem
are at the top of `src/world/geo/index.ts`. Read that file first; it is written
for exactly this handover.

## #619 merged into this branch (14 Sep)

Verified by control before merging: same instrument, same tree, only
`constants.ts` + `paths.ts` reverted between runs. Base builds **3 of 10** pool
seeds (11, 326, 428) and the canonical seed throws at (0.0, 125.8) with the
error three engineers reported; with the fix, **10 of 10**, every crossing on a
proven site with a drawn path through it, nearest paving to the arch 3.5–4.4 m
against 23.7–64.8 m before.

**The park builds again on all ten seeds.** Measurements that lanes wrote off as
impossible are available now.

One correction posted to the PR thread: its "identical parks on the three seeds
that already built" claim is wrong. Those three change, and for the better — on
the base, seed 326 had 6 crossings but only 5 with a drawn path, and seed 428
had 2 with only 1. That also makes the seed-326 `path-kerb`/`path-surface`
coplanar finding more likely newly *created* than newly visible; re-measure now
the base can run.

Merged as a merge commit, not a squash, because several lanes are branched off
`feat/sphere-combined` and a rewritten history would cost each of them a
reconciliation.

Merged head `6562ec2b`: `tsc --noEmit` clean, `test/geo/core.test.ts` 28/28.
