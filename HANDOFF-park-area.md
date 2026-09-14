# HANDOFF — restore the park's area (fix/park-area-maintained)

**Model: Opus 5 (1M context).** Chosen by the Overseer's default for Engineers.
A replacement must run the same model (CLAUDE.md, "A replacement runs the same
model as the agent it replaces").

**Branch:** `fix/park-area-maintained`, off `feat/sphere-combined` at `faece133`.
**Worktree:** `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/park-area`.

## The ask

Jim, 14 September 2026: *"the park now feels too big/sparse - I don't think the
area has been maintained from before, it has gotten bigger."*

## The root cause, which was a one-line drift

`faece133` added a doc comment saying `PARK_REFERENCE_SPHERE_RADIUS` was **"held
equal to `GROUND_SPHERE_RADIUS`, which makes the scale exactly 1"** — and left
the line beneath it reading `= 1200` against a 220 m sphere. So
`PARK_SURFACE_SCALE` was `sqrt(1200/220)` = **2.335x the radius, 5.45x the
ground**, not 1. The comment was the intent; the number is what shipped.

This is CLAUDE.md's "two definitions of one thing, kept in step by hand", and it
drifted *within a single commit*.

## The numbers (measured, not assumed)

`scripts/measure-park-area.mts`, control-run first. Across the 10 pool seeds:

| | scale | play radius | mean planar | mean surface | worst max radius |
|---|---|---|---|---|---|
| authored, flat (the baseline) | 1.0000 | 58.00 m | **21,136 m²** | 22,007 m² | 109.5 m |
| as shipped at 220 m | 2.3355 | 135.46 m | **115,286 m²** | 170,413 m² | **252.8 m — past the horizon** |
| this branch | 0.9913 | 57.49 m | **20,769 m²** | 21,609 m² | 108.6 m |

The 21,136 m² baseline is independently corroborated: `NpcSystem.ts` has
recorded the park's area as "21,136 m²" in a comment since 7 August 2026, and
the instrument reproduces it exactly at scale 1.

**252.8 m of park on a 220 m sphere is past the cap's own horizon** — no ground
exists out there and the drop is `Infinity`. So the old setting was not merely a
size preference; it was geometrically broken.

## Reading of "the area has been maintained"

**Area, not radius**, and on a sphere they differ. A cap out to horizontal `a`
carries more ground than its `pi a²` footprint (the metric stretches by
`R/sqrt(R²-d²)`), so holding the *radius* fixed as `R` shrinks quietly grows the
walked area. What was changed the day before was the radius; what Jim asked back
for is the park feeling like the same park, which is area.

## The fix — a relationship, not a constant

`PARK_SURFACE_SCALE = sqrt(1 - a0²/(4R²))`, the exact solution of
`2 pi R (R - sqrt(R² - a²)) = pi a0²` — "this cap's walked area equals the park's
authored flat area". `a0 = AUTHORED_PLAY_RADIUS = 58`.

Behaviour at other radii, which is the point of it being a relationship:
**0.9913 at R=220, 0.9953 at 300, 0.9997 at 1200, → exactly 1 as the sphere
flattens** (a flat park is the park as authored). Real and well behaved down to
R=29 m. A future radius change needs no conversation and no second constant.

Honest residual, recorded in the constant's doc: it holds the *nominal* circle's
walked area exactly; the generated 2x outline reaches ~108 m where the ground has
tilted further, so it lands **2.2% over** the flat original (21,609 vs 21,136)
rather than the 4.1% a plain scale of 1 would give. Calibrating on the generated
outline instead would make park size seed-dependent — worse.

## New invariant

`theParkFitsOnItsOwnSphere` in `test/procgen/invariants.ts`. Nothing asked
whether the boundary was anywhere at all — every other clause measures things
*relative to* the boundary, so all stayed green while the park stood off the edge
of the world. Hard foul past `GROUND_SPHERE_RADIUS`; foul past `R/sqrt(2)`, where
the ground under the boundary wall passes 45°. Prints reach and edge gradient to
stderr every run, green or not.

**Proved red** against `GROUND_SPHERE_RADIUS = 220` with
`PARK_SURFACE_SCALE = Math.sqrt(1200 / GROUND_SPHERE_RADIUS)` (the shipped
2.335x), everything else as at commit `bf00b0f`:

```
FAIL seed-11  > the park fits on its own sphere
  the park boundary reaches 247.0 m but GROUND_SPHERE_RADIUS is 220 m
FAIL seed-326 > the park fits on its own sphere
  the park boundary reaches 247.5 m but GROUND_SPHERE_RADIUS is 220 m
Tests  2 failed | 600 skipped
```

(Only two seeds could be asserted on at all there — at 2.335x the rest throw
during park build, so their files never reach an invariant.)

## Seeds: 8 of 10 build, up from 3

Measured by building each pool seed headlessly, one process per seed:

| | builds |
|---|---|
| branch base `faece133` (2.335x) | **3 of 10** — 11, 326, 428 (per `HANDOFF-seeds-at-220.md`) |
| this branch | **8 of 10** — 20260728, 11, 128, 131, 208, 274, 326, 451 |

The two that still throw, both on the known blocker the Overseer said not to
chase:

- **seed 24** — `rail crossings: the drawn paths cross the railway at railD 44.1
  (24.9, -21.3), which snaps to no proven bridge site.`
- **seed 428** — `RailRouteUnsolvable`.

**I did not retire them, deliberately.** Replacing a pool seed means picking one
that passes *all* invariants, and on `feat/sphere-combined` **no seed does** —
every building seed carries ~20 failures from the in-flight sphere work (rail
race trestles, sky cruiser, slide, castle, coping stones). Choosing replacements
now would be choosing them against a half-finished sphere, and they would have to
be chosen again when it lands. This is a decision for the Overseer once the
sphere work is green.

## The suite, before and after (whole run)

| | test files | tests |
|---|---|---|
| base `faece133` | 6 failed / 13 passed | 49 failed, 269 passed, **279 skipped** |
| this branch | 6 failed / 13 passed | 83 failed, 429 passed, **94 skipped** |

The failure count rose only because **twice as many seeds now build and are
therefore actually asserted on** — the tell is the pass count and the skip count
(CLAUDE.md: "a skipped test is not a passing test"). Per-seed, on the two seeds
that build in both, failures fell **24 → 20** (seed 11) and **25 → 20** (326).

Fixed by the area restore on both of those seeds, among others:
**`the attractions use the whole park`** — which is the sparseness complaint
measured by an invariant that already existed — plus `every Rail Race post is
solid all the way up a child`, `the bus stop and the walk in from it are clear of
trees and bushes`, `the ginormous slide leaves the castle over the top of the
battlements`.

**The remaining ~20 failures per seed are the branch's own, not this change's.**
They are present at `faece133` too. They belong to the sphere work in flight.

## Sparseness is a second, separate thing — and it is real

Restoring the area fixes it *today*, because the contents were tuned at this
area. But almost nothing scales with extent, so the same bug returns the moment
the park is resized again. Audited:

**Fake-derived → constant despite looking derived:**
- **NPCs** — `NpcSystem.ts:144-145`. `density = 12 / CIRCULAR_PARK_AREA`, then
  `count = density * PARK_BOUNDARY.area`. Since `PARK_BOUNDARY.area ≡
  CIRCULAR_PARK_AREA * PARK_AREA_MULTIPLIER`, this reduces algebraically to
  `12 * 2 = 24` — **constant at every scale and seed**. The comment beside it
  explains at length how the count "follows the boundary". It does not.
- **Boundary pillars** — `Garden.ts:244,344`. Spacing defined as
  `perimeter / 28`, so the **count is pinned at 28** and the gaps stretch.

**Literal constants, rejection-sampled into the boundary (so they thin out):**
trees `Scenery.ts:582` (72, attempt-capped to ~26), bushes `Scenery.ts:960`
(4200-candidate budget), treeline `Scenery.ts:1169` (540), maze walls
`Scenery.ts:1746` (2600), benches `Scenery.ts:1747` (4200), flowers
`Flowers.ts:85` (400), plaza beds `Scenery.ts:2079` (4), fairy lights
`FairyLights.ts:100` (10).

**Hard-coded in absolute metres, which is worse than fixed:** fireflies live in a
13–42 m ring (`Fireflies.ts:60-61`). At the 135 m park they were absent from the
outer two thirds entirely.

**Genuinely derived (these are the pattern to copy):** lamp posts
(`LampPosts.ts:428,509` — 10 m spacing along routes), climbable-cover trees
(`Scenery.ts:791-834` — 8 m cells along paths), wall masonry and collision
segments (`Garden.ts:184-188,294` — from perimeter).

**Attractions:** `parkManifest.ts` is a literal list of **13**; only `band` is
scaled by `PARK_SURFACE_SCALE`. So a bigger park spreads the same 13 attractions
further apart — exactly "sparse".

Worth its own ticket: make counts follow `PARK_BOUNDARY.area` for real, with the
`NpcSystem` algebra as the worked example of how to get it wrong.

## State

- `tsc --noEmit` — exit 0. `typecheck:test` — exit 0. `pnpm run build` — exit 0.
- `pnpm run check` (the ~16 min chain) — **not yet run.**
- `test:procgen` — as tabulated above; branch is red for pre-existing reasons.
- No camera or altitude code touched (another agent owns that). No collision
  work. No browser page or dev server left open.

## Files

- `src/core/constants.ts` — `AUTHORED_PLAY_RADIUS`, `PARK_SURFACE_SCALE`,
  `GARDEN_PLAY_RADIUS`. `PARK_REFERENCE_SPHERE_RADIUS` deleted.
- `test/procgen/invariants.ts` — `theParkFitsOnItsOwnSphere` + its list entry.
- `scripts/measure-park-area.mts` — new, with `--control`.
