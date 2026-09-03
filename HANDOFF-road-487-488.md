# Handoff — the road outside the gate (#487 road ends + grey, #488 bus clips the rail race supports)

Branch `fix/road-487-488`, worktree `.claude/worktrees/road-487-488`.

## 1. Grey — DONE, on this branch

`roadMaterial()` has exactly **two** call sites: `Entrance.ts:648` (the park, i.e.
gameplay) and `BusJourney.ts:1256` (the intro ride's own `Scene`). So one material
serves both, but the seam already exists at the call site — a `tone` argument on
`roadMaterial` recolours gameplay and leaves the intro alone. That is the whole
fix, and the cancelled branch `origin/fix/grey-arrival-paving` had already made
it; its two commits are cherry-picked here (`647ea7c5`, `9347f62d`). `tsc` clean.

Still needs eyes: the colour under the park's own light, not in a still.

## 2. The measurements (all seeds, `scripts/measure-entrance-road.mts`)

```
LGP_SEED=<n> node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
  scripts/measure-entrance-road.mts
```

**Every one of the sixteen pool seeds has rail-race trestle legs standing inside
the bus's swept body.** 2–8 legs per seed; worst lateral intrusion 0.54–2.51 m.
It is structural, not luck:

| seed | legs in bus sweep | legs in road footprint | worst intrusion (m) |
|---|---|---|---|
| 20260728 | 6 | 8 | 2.51 |
| 5 | 6 | 6 | 1.59 |
| 11 | 6 | 6 | 2.47 |
| 24 | 2 | 5 | 0.54 |
| 115 | 6 | 8 | 1.38 |
| 128 | 2 | 6 | 2.32 |
| 131 | 8 | 8 | 2.14 |
| 208 | 8 | 8 | 2.26 |
| 225 | 8 | 8 | 2.50 |
| 267 | 5 | 8 | 1.10 |
| 274 | 4 | 5 | 1.70 |
| 288 | 6 | 8 | 2.37 |
| 326 | 2 | 2 | 2.43 |
| 346 | 3 | 6 | 2.36 |
| 428 | 8 | 8 | 2.46 |
| 451 | 2 | 2 | 2.15 |

### Why, exactly — and why the road alone cannot fix it

Everything outside the wall is measured as **outset**: metres beyond
`PARK_BOUNDARY`'s own edge, which is how `route.ts`, `terrain.ts` and
`ringPath.ts` all already talk about that ground.

- **Trestle feet stand at outset 6.5, on every seed, all the way round.**
  Measured (`nearGateLegsBeyondEdge` is `6.5` for every leg near the gate on all
  sixteen seeds) and stated: `route.ts`'s `NOMINAL_OUTSET = 6.5`, whose own doc
  boxes it into `[6.15, 6.92]` — inner limit so the innermost rail clears the
  masonry, outer limit so the outermost rail stays inside `RIM_OUTSET_START`.
  **It cannot move.**
- The ring's structure spans outset **1.42 … 11.58** (6.5 ± 5.08 m of true
  perpendicular reach). `RIM_OUTSET_START` is 12, where the ground begins its
  17 m fall.
- The road is `2 * ROAD_HALF_WIDTH` = **7.78 m** wide, derived from the bus.
- For the road to stay out of the park its centre needs outset ≥ 3.89; to stay
  off the hillside, outset ≤ 12 − 3.89 = **8.11**. So the road's centre line
  lives in **[3.89, 8.11]**.
- To clear a leg at outset 6.5 the road's centre must be **≥ 4.4 m** from it
  (3.89 half-width + ~0.5 m foot radius) — i.e. outset ≤ 2.1 **or** ≥ 10.9.

**Those two bands do not intersect.** There is no outset, straight or curved, at
which a full-width road parallel to the wall clears a support. The apron outside
this park is entirely occupied by the ride; the bus road was laid straight
through it.

The road *crossing* the trestle line radially is fine — `TRESTLE_SPACING` is
12 m and the road is 7.78 m wide, so a radial road threads a gap with ~2 m
either side. It is only a road running **along** the line that cannot fit, and
the kerb the bus stands on is exactly that.

### The current road, for reference (canonical seed)

- `entrance-road-kerb`: x −29.9…14.9, z 65.1…72.9 (centre z = 69 = wall + 9)
- `entrance-road-gateway`: x −3.9…3.9, z 57.5…65.1
- Six legs inside it: (7.26, 68.87), (5.37, 68.20), (−16.16, 67.92),
  (−18.09, 68.46), (−6.36, 66.05), (−4.36, 66.04).

## 3. Where the fully-zoomed-out view reaches

Owner: `IsoCamera.frustumBase()` =
`max(CAMERA_VIEW_HEIGHT/2, CAMERA_MIN_VIEW_WIDTH/2 / aspect)`; half-height at
full zoom-out is `frustumBase / CAMERA_ZOOM_MIN` (0.42). Aspect-dependent, so
anything reading it must call that function, never copy a number.

Worked through: 16:9 desktop → half-height 17.86 m, half-width 31.75 m, and
`halfHeight / sin(CAMERA_PITCH)` = **29.0 m** of ground up-screen; furthest
ground corner ≈ **43.0 m** from the focus. A 390×844 portrait phone (where
`CAMERA_MIN_VIEW_WIDTH`'s floor bites and grows the view) is worse: **47.8 m**.

Against that, the drawn ground simply runs out first. Along the kerb line the
terrain disc (`TERRAIN_RADIUS` 83.5) cuts at |x| ≈ 47, and going **east** the
boundary spline bulges out to meet the kerb at x ≈ +27 — so a straight kerb
cannot be extended both ways at all. Radially outward the ground is flat to
outset 12 and then falls 17 m, bottoming past outset 22.

So "as far as the game renders" is not a length to pick: it is *the road runs
until the drawn, out-of-park ground runs out*, which is a query against
`PARK_BOUNDARY` + `TERRAIN_RADIUS` + the rim, checked against the view reach
above so we can say it is never short.

## 4. The design fork — needs a ruling

Every remaining option requires the **ride's trestle placement to learn about
the road corridor**, because the road has nowhere else to be. `groundIsClear`
in `railRace/track.ts` already refuses ground within 2.8 m of a path, 2.4 m of
the rail corridor, and near `PARK_LAYOUT.entries` — the entrance road is simply
missing from that list, which is exactly CLAUDE.md's "a generator that only
checks itself against a hand-picked obstacle list will silently miss whatever a
sibling system placed there". `World.ts` builds `RailRace` (line 214) **before**
`Entrance` (line 268), so the ordering works.

`RADIAL_NUDGES` already allows ±5 m, and a leg moving from outset 6.5 to ~8.4
clears a road centred at outset 4.0. Nothing is deleted and nothing is
hand-placed; the existing search does it. But Jim's wording on #488 is "do not …
nudge a support", so this wants confirming before it is built.

The road at outset 4.0 has to be a **boundary-offset curve**, not the straight
chord it is today (a straight kerb at z = 64 is inside the park by x ≈ +12) —
which means `ArrivalSequence`/`busDriver` must drive the bus along a curve.
That is the expensive half of the work.

## Status

Grey done and typechecking. Road route and length not yet implemented — blocked
on the fork above. Nothing has been merged; no PR raised yet.
