# Which seeds build, and the one error that stops the rest

Measured 13 September 2026 on `feat/sphere-combined`, at
`GROUND_SPHERE_RADIUS = 220` with `PARK_SURFACE_SCALE` growing the park to
match (play radius 58 → 135.5 m, boundary max radius ≈ 225 m).

Written down for the round-robin procgen rewrite, whose whole point is that a
generator **refuses with a named blocker instead of throwing**. This is a list
of exactly where the current one throws.

## The sweep

`LGP_SEED=<n>` then importing `world/parkLayout.ts`, `train/bridgeKeepout.ts`,
`slide/plan.ts` and `railRace/plan.ts` — enough to drive the layout solver, the
rail-crossing planner and the two ride solves.

| seed | 220 m, park grown | 300 m, park unscaled |
|---|---|---|
| 20260728 (canonical) | **FAIL** | **FAIL** |
| 11 | OK | FAIL |
| 24 | FAIL | OK |
| 128 | FAIL | OK |
| 131 | FAIL | FAIL |
| 208 | FAIL | OK |
| 274 | FAIL | FAIL |
| 326 | OK | OK |
| 428 | OK | OK |
| 451 | FAIL | OK |

**3 of 10 at 220 m** (11, 326, 428); **6 of 10 at 300 m**.

## The one error, and it is always the same one

```
rail crossings: the drawn paths cross the railway at railD 0.0 (0.0, 125.8),
which snaps to no proven bridge site. Every crossing must be a bridge
(Jim, 2 Sep 2026); find the router that drew this leg.
```

Thrown from `train/crossings.ts`'s `emit`, reached through
`bridgeKeepout.ts`'s `footprints` → `isInBridgeFootprint`, which
`Scenery.ts` asks while planting the first tree — so it surfaces during
"building the garden…" and no park is drawn at all.

Every failing seed gives this error and no other. The crossing is at
`railD 0.0` — rail distance **exactly zero** — on the `+Z` axis, which is
`ENTRANCE_ANGLE`, at a radius of 120–126 m. The repetition of `railD 0.0`
across unrelated seeds is the tell: this is one degenerate case, not seven
different unlucky parks.

## It is NOT caused by the sphere work, and that is measured

I assumed it was mine and checked. It is not:

- It fails at **every radius** — 1200, 600, 400 and 300 all give the same
  throw on the canonical seed.
- It fails at **`db1363ce`**, the commit this session started from, with the
  original `GROUND_SPHERE_RADIUS = 1200` and nothing of this work in the tree.
  Verified in a scratch worktree at that commit with its own
  `pnpm install --frozen-lockfile`.

So `feat/sphere-combined` was already throwing on the canonical seed before any
of the radial-up work began. That is why Jim hit it: he loads the canonical seed
by default, while the dev server had seed 128 remembered — which passes — so it
was invisible from this side for most of a day.

**Growing the park changes *which* seeds fail, not *whether* they fail.** It
moves the crossing outward, so a different set of seeds lands on the bad case.

## What is not covered

The sweep drives the solvers, not a render. A seed marked OK here has built its
layout, crossings and ride routes; it has not been looked at. Seeds 11, 326 and
428 were additionally opened in a browser at 220 m and all three drew a park.

Jim's ruling, 13 September 2026, on hitting this: *"if some seeds don't work
just give me a different seed, the procgen work will fix it very soon."* So
nothing here is being chased — it is being recorded for whoever does the
rewrite.
