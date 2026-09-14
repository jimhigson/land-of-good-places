# For the round-robin engineer: `clear()` is three hand-picked obstacle lists

**From:** the sphere ground-claims lane (`eng/sphere-ground-claims`).
**To:** whoever holds `design/round-robin-generation`.
**Status:** a survey and a finding. **Nothing here has been implemented, on
purpose** — wiring `clear()` to the claims registry is the round-robin rewrite's
job, and Jim's standing ruling gives that workstream to Fable. This arrives as a
finding so it does not arrive as a fourth implementation.

## The one-line version

`rail/generate.ts` declares one predicate:

```ts
readonly clear: (x: number, z: number, radius: number, distanceAlong: number) => boolean;
```

**Three** closures satisfy it — not four — and **none of them has ever heard of
`GroundClaims`**. Every one asks a hand-built keep-out list instead, which is
exactly the pattern CLAUDE.md names as the shape of issues #317 and #319: *"a
generator that only checks itself against a hand-picked obstacle list will
silently miss whatever a sibling system placed there."*

## The count is three, and the naming misleads

- **`src/world/railRace/` does not use the rail solver at all.** It builds a
  fixed `RingPath` (`ringPath.ts`, `route.ts`); there is no `RouteBrief`
  anywhere in it. Anyone counting "rides that solve a route" will over-count.
- **The "sky cruiser" *is* the coaster** — `src/world/coaster/route.ts`,
  `COASTER_PLANS.cruiser`. One closure, not two.
- The coaster's single closure is reused across **four briefs** (first,
  escalated, rescueFirst, rescue-escalated), and the slide's brief is solved by
  both a sync and a sliced driver — which is where "four solvers" comes from.

The only call site inside the generator is `rail/generate.ts:745`:

```ts
if (!brief.clear(point.x, point.z, brief.corridorRadius, s)) {
```

`radius` is always `brief.corridorRadius`; `s` is arc length from the start.

## The three closures, and what each actually consults

### 1. Slide — `chuteMayPass`, `src/world/slide/solve.ts:703-746`
Bound at `solve.ts:1234`. Consults: the castle facade **rectangle**
(`insideCastle`), the four castle **tower cones**, `AVOIDED_PLOTS` (a prebuilt
SoA of every `PARK_LAYOUT.entries` **bounding circle** bar the two plots it
joins), and the **built Sky Cruiser centre line** flattened into a uniform grid.
**Uses `distanceAlong`** — `heightAtArc(distanceAlong, nominalLength)`, which is
the whole reason the 4-argument signature exists. Height is a pure analytic ease,
no terrain query.

### 2. Train — `src/world/train/route.ts:263-275`
Passed through unchanged at `route.ts:457`. Its body is **one flat hypot against
one disc array** built by `trainObstacles()` (`route.ts:207-232`) and flattened
into `Float64Array`s. Sources: `PARK_LAYOUT.entries` bounding circles +
`TRACK_PLOT_CLEARANCE`, the cruiser's exit point, and a disc every 2 m along the
cruiser's route where its rail is too low to duck under. **Declared 3-arg** — it
satisfies the 4-arg type structurally and silently drops `distanceAlong`.

### 3. Coaster / Sky Cruiser — `src/world/coaster/route.ts:927-969`
Consults `tallObstacles()` (three discs: ferris wheel, the RiPika statue with a
**hand-measured `STATUE_TALL_RADIUS = 3.5`**, the hotel), the castle masonry via
`castleClear`, optionally another `CoasterRoute`, and `clearOfFootprints(...,
'building')` near the station only. Uses `distanceAlong` **only as an arc-length
window test**, never as a height.

## The two findings that matter to the rewrite

**1. `coSolve.ts`'s `PlacementField` is dead.** `src/boot/coSolve.ts` exports
`Obstacle`, `PlacementField`, `CoSolveFeature`, `CoSolveEngine`,
`CoSolveUnsolvable`. Its only importer in the whole repo is
`test/coSolve.test.ts`. **Zero `src/` importers.** `groundClaims.ts`'s docblock
describes itself as widening `PlacementField`; it widened something nothing uses.

**2. The registry is populated by the entrance road and nothing else.**
`GroundClaims` is reachable only from `boot/parkGeneration.ts:196`,
`world/World.ts:85`/`:309`, and `entrance/roadCorridor.ts` (type-only). It is
committed **after** the rail solves. So today every ride negotiates against
`PARK_LAYOUT` bounding circles and hard-coded castle geometry while the registry
holds one road.

## What changed underneath you, and why it matters here

The registry's distance kernel is now **geodesic**, not plane geometry over world
`(x, z)` — see `src/boot/claimSurface.ts`. World `(x, z)` is an *orthographic
projection* of the planet, so `Math.hypot` over it under-reads radial separation
by `cos θ`: 1 m reads as **1.43 m** of real walking at the park's reach.

**The trap worth inheriting**, because it will bite the same way when `clear()`
moves: a flat broad-phase box is **not** conservative. `flat ≤ arc` holds
point-to-point and is **false point-to-run** — a great circle projects to an
ellipse, not to the chord — and swept over the park the flat kernel over-reads by
up to **15.4 m**. A box prefilter built from the chord silently dismisses pairs
that genuinely share ground, and every narrow-phase test stays green because the
narrow phase is never reached. The fix is to box the *projected geodesic*
(`boundsOfRun`), not to add a margin.

Every one of the three closures above does its own flat broad-phase rejection
(`if (dx >= reach || -dx >= reach) continue;` and friends). **Those are the same
bug waiting**, and they are why this should be one migration through the registry
rather than three.

## Suggested shape, not a prescription

`clear()` becomes a thin adapter over `GroundClaims.allows(feature, claim)` with
a `corridor` claim of `corridorRadius`, so a ride cannot name an obstacle type
and therefore cannot miss one. The two things that do **not** fall out for free:

- **Height.** The slide genuinely needs `distanceAlong → height` (it crosses over
  the cruiser 14 m up; height-blind, it is unsolvable — the gap is ~2 m against a
  wider chute). A `Claim` is 2D. Either claims gain a height band or the slide
  keeps a height filter layered on top.
- **Ordering.** Rides currently solve before the registry is populated. Making
  `clear()` ask the registry only helps if the registry is filled by then, which
  is a scheduling question and squarely yours.

Anything I can measure for this, ask — the instruments
(`scripts/claim-chart-error.mts`, `scripts/park-past-the-horizon.mts`) are
re-runnable and cheap.
