# HANDOFF — issue #625, `castleMasonryTopY` measured with a plumb line

Branch `eng/slide-castle-radial`, off `origin/eng/sphere-ground-claims`.
**Model: Opus 5 (1M context)**, chosen by the Overseer; the first agent on this
lane was the same, and a replacement must match it.

## Status: the fix is written, committed and pushed. Controls run.

## The finding that changes the ticket (first agent's, re-measured by the second)

**There is no collision.** The issue's headline — *"the chute is 1.19 m inside
the battlements"* — is itself a frame mix, the exact one the issue's own comment
warns against, applied in the other direction.

Re-run independently on the canonical seed (`scripts/measure-castle-masonry.mts`),
at the chute's crossing of the south wall plane `z = 21.823`, crossing world
`(55.48, 9.69, 21.82)`:

| quantity | value |
|---|---|
| masonry AABB `max.y` (what shipped) | **8.040 m** |
| masonry top radius | **229.770** (`r − R` = 9.770 m) |
| crossing radius | **237.302** (`r − R` = 17.302 m) |
| chute underside radius | 237.302 − 1.11 = **236.192** |
| **clearance, both sides radial** | **+6.422 m — clear** |
| clearance, both sides plumb-y | +0.539 m — clear |
| clearance, radial stone vs plumb underside (**the issue's 1.19**) | −1.190 m |

The last row is not a measurement of anything: it subtracts a world-Y height
from a radius-minus-`R`. Those agree only at the park's origin, and the castle
is ~48 m out.

Confirmed by a second instrument sharing none of that arithmetic
(`scripts/measure-slide-vs-stone.mts`): the shortest distance from the built
chute's centre line to any masonry triangle vertex is **9.450 m** (chute
`(55.51, 9.69, 21.67)`, stone `(59.02, 0.92, 22.04)`), against a
`CHUTE_HALF_WIDTH` of 1.11 — **8.34 m of daylight**.

**A third, independent cross-check found by the second agent, and it is the
cleanest one.** `layout.ts`'s `CASTLE_MASONRY_TOP` — the constant the facade is
*built from* — is **9.85 m** up the facade's own axis. The radial measurement
says **9.770 m** above the planet's surface; the difference is the terrain under
the castle. The plumb measurement said **8.040 m**, i.e. 1.73 m *short of a
constant the thing is built from*. That alone identifies which of the two
frames is the honest one, without any reference to the slide. Recorded in the
`CASTLE_MASONRY_TOP` docblock.

## What was actually changed

1. **`ParkFacts.castleMasonryTopY` → `castleMasonryTopRadius`**
   (`test/procgen/parkFacts.ts`). Renamed deliberately so no reader can keep
   the old meaning by accident. It is now the greatest `Geo.radius()` over the
   masonry's **own vertices**, not a `Box3`: no corner of an axis-aligned box
   is a point of the mesh inside it, so a box has no honest radius even though
   its `max.y` is an honest height.
2. **The one real reader converted in the same commit** —
   `theGinormousSlideLeavesOverTheBattlements` in `test/procgen/invariants.ts`.
   Its `crossing` now carries `z` (needed for a radius; without it the number
   would silently be a point on the `z = 0` meridian, ~1 m out here), and the
   underside is `Geo.fromWorld(crossing).radius() − CHUTE_HALF_WIDTH`. Both
   sides are radii. The failure message prints `r − R` for readability and says
   "measured radially".
3. **Four prose cross-references** renamed so they do not dangle:
   `src/world/building/{Shell,layout,castleFabric}.ts`,
   `scripts/check-castle.mts`. `layout.ts` also gained the three-way
   9.85 / 9.770 / 8.040 comparison above.
4. **A latent runtime landmine removed** (`parkFacts.ts`). The new masonry walk
   first used the `Mesh` imported at the top of the file. A
   `const { … Mesh … } = await import('three')` in the rail-race block of the
   *same function* shadows that import for the whole body, so the bare `Mesh`
   sat in its temporal dead zone: **typechecked clean, threw at runtime**, and
   vitest reported it as `Tests 93 skipped (93)` — not as a crash. It now uses
   an alias, with the trap written down beside it.

## Seed 326 / `planSlide` — INDEPENDENT of this work, and the brief is stale

`planSlide` does **not** throw on seed 326 on this base. Measured:
`pnpm exec vitest run test/procgen/seed-326.test.ts` → `17 failed | 76 passed
(93)`. Ninety-three tests **ran**. No skips anywhere in the full suite either
(648 tests, 648 accounted for).

Worth knowing *why* the brief said otherwise: "93 skipped" is what vitest prints
when a suite-level exception kills `beforeAll` before any test runs. The second
agent reproduced that exact line — from its own TDZ bug (item 4 above), not from
`planSlide`. Whatever threw when the report was written is gone from this base.
The 17 failures on seed 326 are part of the inherited-red ledger, issue #630.

## Controls — both run, both red, with the geometry they were proved against

Canonical seed **20260728**, chute crossing at world `(55.48, 9.69, 21.82)`,
masonry top radius `229.770`.

**Control A — the clause can fail.** Every object matching
`/^(castle-wall-|crenellations$)/` pushed **8 m further from the planet's
centre** at the scene-graph level, before anything measures it. Temporary patch
in `parkFacts.ts`, reverted:

```
FAIL canonical seed 20260728 > the ginormous slide leaves the castle over the top of the battlements
AssertionError: the ginormous slide crosses the castle's south wall at world
(55.48, 9.69, 21.82) — measured radially, its underside is 16.19 m above the
planet's surface and the stonework tops out at 17.67 m, so the chute is 1.48 m
inside the battlements. Nothing cuts a hole for it: `slideGap` reaches no
geometry, so there is solid stone here
```

Real numbers, no `NaN`, no `Infinity`. (Stone went 9.770 → 17.67, i.e. +7.90
rather than +8.00, because the push is along each object's own bearing and the
tallest vertex sits on a slightly different one. Expected.)

**Control B — the anti-vacuity guard still fires.** Name pattern broken to
`/^(NOT-A-REAL-castle-wall-|NOT-crenellations$)/`:

```
AssertionError: no castle stonework was found in the built park at all, so the
check that keeps the ginormous slide out of the battlements measured nothing…
```

**Control C — the new frame guard fires.** `- 220` appended to the fact's
`geo.setFromWorldVector(probe).radius()`, i.e. the field put back into the
plumb-height units it used to carry:

```
AssertionError: `parkFacts.castleMasonryTopRadius` is 9.770, which is not a
radius from the planet's centre — every point in the park is at least
GROUND_SPHERE_RADIUS (220) from it. Something has put a world-Y height back in
this field, which is issue #625 exactly…
```

All three were reverted with `git checkout test/procgen/parkFacts.ts` and the
invariant re-run green afterwards (`1 passed | 92 skipped`).

## Test counts, before and after — identical, and that is the correct result

Both runs on this machine, `pnpm run test:procgen`:

| | files | tests | duration |
|---|---|---|---|
| base `5220305b` | 5 failed \| 16 passed (21) | **85 failed \| 563 passed (648)** | 74.68 s |
| this branch | 5 failed \| 16 passed (21) | **85 failed \| 563 passed (648)** | 74.19 s |

The **failing sets are identical, compared line by line, not just the counts**
(85 vs 85, `diff` clean) — the swap-not-caught-by-a-count trap. The battlements
test is in neither set: it was green before (plumb vs plumb, self-consistently,
+0.539 m) and is green now (radial vs radial, +6.422 m). What changed is that it
is now green for an honest reason and has been watched go red.

All 85 are the inherited ledger in issue #630.

## Audit of the other vertical box reads in `test/procgen/parkFacts.ts`

(Note: `src/world/parkFacts.ts` does not exist; the file is
`test/procgen/parkFacts.ts`.)

Re-done from scratch by the second agent (the first agent's table is superseded;
two of its verdicts moved). Every row traced to the code that *builds and
places* the geometry, not inferred from the fact's name.

| line | what | verdict |
|---|---|---|
| 1305 | cat-bus occupant fit, `box.max.y − shell.max.y` | **clean** — `measureCatBusFit()` calls `createCatBus()`/`createKid()` directly, never touches `scene`, `placeOnSphere` or a plot, and disposes the bus. Both boxes come off the same unplaced root, so it is a difference inside one model frame. |
| ~1484 | `castleMasonryTopRadius` | **was the bug**, fixed here |
| 1532 | `castleRoofGarden.topY` | **self-consistent, not honest.** The group *is* tilted (`Building.ts` `standInPlot`; its own comment says "the plot leans now"). AABB `max.y` **9.575**, radial top **12.366** — under-reports by **2.79 m**. But its only reader compares it against `slideChute` world-`y`, and it is the *maximum* world y over the whole roof box, so it is a conservative separating bound: a real intersection still fails it. **Not fixed here** — converting it means converting a plan *box*, not a scalar. Its invariant is already red at baseline (#630), so it belongs with whoever fixes that. **The hazard is the name**: `topY` reads like "how tall the roof is"; the day anyone compares it to a radius it is silently 2.79 m wrong. |
| 1733 | planted instance top, `at.y + bounds.max.y * scale.y` | **SUSPECT — a genuine frame mix, and the one live find of the audit.** See below. |
| 2490 / 2520–2521 | Rail Race arch legs | **clean** — and not for the reason previously recorded. `track.ts`'s `buildArch` builds the legs with **no rotation at all** (`leg.position.set(footX, bottom + height/2, footZ)`, `bottom = terrainHeight(…) − tube`), so they are genuinely plumb world-y cylinders and comparing them to `terrainHeight` is like with like. The *geometry* is arguably the thing that should lean; the *measurement* is honest about what was built. |
| 2588 | `busTop` | **clean on frames** — `BusJourney.ts` contains no `placeOnSphere`, `tiltToSphere`, `terrainHeight` or `GROUND_SPHERE_RADIUS`; it is a genuinely private flat lane. **But a separate bug found underneath it** — see below. |

### Live find 1 — planted instance tops are a frame mix (line 1733)

`Scenery.ts`'s own comment (line 1252) states it: *"`makeInstanced` puts every
instance through `placeOnSphere`, which re-measures a part's authored height
along the local up — so a canopy, being metres above the ground, is drawn
further out than the trunk it grew from"*, with measured displacement of median
1.80 m and worst 3.21 m on the canonical seed.

The fact takes `at` from the instance matrix (world, tilted — fine) and then
adds `bounds.max.y * scale.y`, the geometry's **local** top, straight onto the
world `y`, **discarding the instance's rotation**. The true world-y top is
`at.y + h·cos θ`, displaced `h·sin θ` sideways; at the treeline radius
(~70–80 m, θ ≈ 18–20°) a 9 m tree's reported top is ~0.5 m too high and is
attributed to the *trunk's* `(x, z)` rather than the canopy's.

It matters because the consumer is `hidesTheArrivingBus(at.x, at.z, top)`
(`src/world/entrance/arrivalSightline.ts`), which traces a grazing ray from
`top` and compares against `BUS_GROUND_Y = terrainHeight(…)`, a world y, then
asks `distanceToEntranceCorridor` about a plan position derived from the trunk.
This is exactly the bug `Scenery.ts` documents and fixed **for its own gate**
(`canopyFlat` → `placeOnSphere` → test the *drawn* canopy) and which
`parkFacts.ts` has not adopted. The same `at`/`bounds` mix feeds `reach` and
`treesInTheBusRoad` two lines above.

**Not fixed here** — it is the arrival-sightline subsystem, not the castle, and
fixing it means re-deriving the canopy position the way `Scenery.ts` already
does. Worth its own ticket.

### Live find 2 — `busTop` double-counts the lane height (line 2588)

Independently confirmed by the second agent, not taken on trust:

- `BusJourney`'s constructor calls `this.place(0)` (line 868).
- `place(z)` sets `this.bus.root.position.set(0, laneHeight(z), z)` (line 1585).
- `laneHeight(0)` evaluates to **3.0737** (run directly).

So `busTop = busBox.setFromObject(node).max.y` is an **absolute lane-y**
— 3.0737 m of lane plus the bus's own height — while the comment above it says
it is "the bus's own height", and the ceiling test at line 2601 reads
`if (p.y > laneHeight(p.z) + busTop) return;`. The lane height is therefore
counted twice and the "what a bus would hit" ceiling sits about **3.07 m too
high** (wobbling with the lane wave, since the double-counted term is
`laneHeight(0)` while the first term is `laneHeight(p.z)`).

The direction is the *safe* one — `return` means "not recorded", so a ceiling
that is too high records **more** obstacles than a bus could really hit, not
fewer. So `laneCarriageway` is over-inclusive rather than blind. Still wrong,
and the fix is one term: measure the bus in its own frame, or subtract
`laneHeight(0)` where `busTop` is read. **Not fixed here** — different
subsystem, and it deserves its own before/after count rather than a drive-by.

## Instruments — deleted on purpose, and where the evidence went instead

`scripts/measure-castle-masonry.mts` and `scripts/measure-slide-vs-stone.mts`
were the first agent's scratch; both were re-run by the second agent (the
numbers in the table above are that re-run, not a copy) and then **deleted
before the PR**. Two reasons, and the second is the real one:

- Every figure they produced is now written into the docblocks of
  `ParkFacts.castleMasonryTopRadius`,
  `theGinormousSlideLeavesOverTheBattlements` and `CASTLE_MASONRY_TOP`,
  beside the code that has to stay true to it.
- They each re-stated `CHUTE_HALF_WIDTH = 1.11` by hand. `invariants.ts` owns
  that number and owns a docblock explaining why it is derived from the built
  cross-section rather than imported from the generator; a third hand-written
  copy in a script nobody runs is precisely the "two definitions of one thing"
  fault, and a scratch file is the likeliest of the three to drift unnoticed.

The control they carried is not lost — it is reproduced **inside vitest**, where
it runs against the same facts the invariant reads, as Control A below.

## For QA — where to stand

No browser was available to either agent. The thing to watch is the ginormous
slide leaving the castle roof over the south battlements: there should be
several metres of air between the chute's underside and the merlons, and no
part of the chute inside stone. `/slide` boards the ride; for a look from
outside, a `/view` camera south-east of the castle looking back north-west at
the south wall at the height of the parapet. Nothing a player can see has
changed on this branch — it is a corrected measurement, not moved geometry.

## PR

Open as **#637**, base `eng/sphere-ground-claims` (not `main`). CI will be red on
`Checks` and `Procgen invariants` **because the base is red** — see the
inherited-red table above; every one of the seven failing steps was re-run on
the base worktree and fails there identically. Nothing on this branch is red
that is not already red on `eng/sphere-ground-claims`.

The seven are worth pushing back to #630, whose ledger names only
`check:rail-race`: `check:hotel` (19 problems, PR #634), `check:rail-race`,
`check:tie-frame`, `check:cruiser-clearance`, `check:castle-window`,
`check:keyring-view`, `check:climb-wave`.

`check:coplanar` and `check:swept-bus` were not run locally — they have their own
workflows on the PR and this branch touches no geometry, only measurements and
comments.
