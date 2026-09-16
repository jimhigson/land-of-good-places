# HANDOFF — issue #625, `castleMasonryTopY` measured with a plumb line

Branch `eng/slide-castle-radial`, off `origin/eng/sphere-ground-claims`.
**Model: Opus 5 (1M context)**, chosen by the Overseer; every agent on this
lane has been the same, and a replacement must match it.

## Status: fixed, reviewed, review addressed. PR #637.

## The lesson

This branch's own audit found and routed out **#638** — planted instance tops
dropping the instance's rotation — and then made the same class of mistake in
its own new code. Audit your own diff by the standard you apply to everyone
else's.

## Third agent, 16 Sep — re-verified from the committed code, not from this file

Replacement engineer (same model). Everything above was re-measured on
`a248a471` rather than trusted. A temporary `process.stderr` probe in the
invariant (reverted) on canonical seed 20260728, with
`pnpm exec vitest run test/procgen/seed-canonical.test.ts -t "over the top of the battlements"`
(note: `-t theGinormousSlideLeavesOverTheBattlements` matches nothing and
prints `93 skipped` — the test name is the prose label):

```
clean:  crossing=(55.48,9.69,21.82) crossingAlt=17.302 underside=16.192 stone=10.750 mesh=crenellations facadeY=9.8500 clearance=5.441   1 passed
D  instance branch forced off: stone=9.770 mesh=castle-wall-lintel facadeY=8.8000 clearance=6.422  -> mesh clause red
B  name pattern broken:        stone=-Infinity mesh='' facadeY=NaN                                 -> anti-vacuity red
C  `- 220` on radius():        stone=-209.250                                                     -> frame guard red ("is 10.750, which is not a radius")
A  every masonry vertex +8 m radially: stone=18.750 facadeY=17.8347 clearance=-2.559              -> value clause red, off by 7.985 m
A2 crossing radius - 6 m:      underside=10.192 stone=10.750 clearance=-0.559                     -> clearance clause red, "0.56 m inside"
```

D reproduces the reviewed bug to the millimetre (9.770 / 8.8 / +6.422), and
shows the facade-value clause would *also* have caught it independently (8.8
vs 9.85). A2 is exact: 5.441 − 6 = −0.559. Tree clean after every control.

One stale figure found and fixed: `invariants.ts` still said "converted
honestly the chute clears by 6.42 m" in the clause-3 comment. Now 5.44.

## The conclusion, which survived review

**There is no collision. The child was never riding through stone.** The
issue's headline — *"the chute is 1.19 m inside the battlements"* — is a frame
mix: it subtracts a world-Y height from a radius-minus-`R`, and those agree only
at the park's origin, ~48 m away. Corrected clearance is **+5.44 m**.

## The numbers, third time of asking — read the history, it is the lesson

| quantity | value |
|---|---|
| masonry AABB `max.y` — the plumb measure that shipped | **8.040 m** |
| **true radial top**, a `crenellations` merlon at world (35.52, 7.08, 20.40) | **10.750 m** |
| **true under-report of the original bug** | **2.710 m** |
| chute crossing the south wall plane, world (55.48, 9.69, 21.82) | 17.302 m |
| chute underside (`− CHUTE_HALF_WIDTH` 1.11) | **16.192 m** |
| **clearance, both sides radial** | **+5.441 m — clear** |
| clearance, both sides plumb-y | +0.539 m — clear |
| the issue's 1.19 (radial stone vs plumb underside) | −1.190 m |

**Corroborated by a second method, once that method was also fixed.** Shortest
distance from the built chute's centre line to any masonry vertex: **6.788 m**
— chute `(55.38, 9.69, 22.46)`, a `crenellations` vertex at
`(54.04, 3.04, 22.34)` — leaving **5.678 m** beyond the 1.11 half-width, against
the **5.441 m** the radial crossing gives. Two methods sharing only the built
scene, agreeing to within a quarter of a metre.

That figure was published as **9.450 m**, and it was wrong for the same reason
as everything else here: the instrument walked masonry vertices without their
per-instance matrices, so it measured the distance to a castle with no
battlements. **Corroboration from a second instrument is worth only the
independence of its method.**

**Two figures widely repeated about this ticket are wrong, and both were wrong
the same way.**

- **The issue says the under-report is 1.730 m. It is 2.710 m.** The 1.730 came
  from a scratch instrument that walked vertices through `node.matrixWorld`
  alone, so `crenellations` — an `InstancedMesh` of 40 merlons — collapsed onto
  the container's origin and the "radial top" it reported, 9.770 m, was really
  the `castle-wall-lintel` band. It was then *independently confirmed* by a
  second measurement made the same way. **Two instruments sharing a method
  share its blind spot**; that is what "independently confirmed" bought here.
  The plumb figure 8.040 was always right, because `Box3.setFromObject` honours
  instance matrices.
- **This branch's own first fix reproduced the identical fault**, because it
  replaced `Box3` with a hand-rolled vertex walk and did not handle
  `InstancedMesh`. `InstancedMesh extends Mesh`, so it passed the type test and
  was then transformed by the container matrix alone: 0.984 m, battlements gone,
  clearance reported as **+6.42 m** — 0.9806 m too generous, in the dangerous
  direction, from a change whose entire purpose was to stop under-reporting this
  number. Caught in review, not by me.

**The "cleanest cross-check" in the first write-up was a coincidence and is
now deleted.** It claimed 9.770 radial corroborated `CASTLE_MASONRY_TOP` 9.85.
But 9.770 is a `castle-wall-lintel` vertex and that band is built to
`CASTLE_WALL_HEIGHT` **8.8**, so it cannot corroborate a constant that includes
the 1.05 m of merlon above it — and `9.85 − 8.8 = 1.05` against a 0.9806 m
under-report: **the missing metre was the merlons**. A number agreeing to a
tenth of a metre is not corroboration until you know which mesh it came off.
That false claim had reached `src/world/building/layout.ts`; it is corrected
there, and the real corroboration is now a **clause** rather than prose.

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
4. **`InstancedMesh` handled per instance** — `getMatrixAt` composed onto
   `matrixWorld`, 40 merlons instead of 1 collapsed container. This is the
   review fix, and without it everything above is decoration.
5. **Two new clauses that assert the *value*, not the frame**, because nothing
   existing could see the instance regression — not the frame guard (still a
   radius), not the clearance clause (still positive), not the prose
   cross-check (coincidentally agreeing):
   - `castleMasonryTopMesh` must be **`crenellations`**. The merlons are the top
     of the castle by construction. Exact, no tolerance.
   - `castleMasonryTopFacadeY` — the winning vertex expressed in the
     `building-facade` group's own frame — must equal `CASTLE_MASONRY_TOP`.
     Measured **9.8500** against 9.85. The constant crosses as a *fact*
     (`castleMasonryDesignTopY`) rather than a static import, because
     `building/layout.ts` reaches `parkLayout` and a static import into `test/`
     would pin every seed to the default park.
6. **A latent runtime landmine removed** (`parkFacts.ts`). The masonry walk
   first used the `Mesh` imported at the top of the file. A
   `const { … Mesh … } = await import('three')` in the rail-race block of the
   *same function* shadows that import for the whole body, so the bare `Mesh`
   sat in its temporal dead zone: **typechecked clean, threw at runtime**, and
   vitest reported it as `Tests 93 skipped (93)` — not as a crash. It now uses
   an alias, with the trap written down beside it. `InstancedMeshClass` and
   `Matrix4` are taken in that same block too; those `tsc` *does* catch, as
   redeclarations, so they are aliased `…ForMasonry`.

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

## Controls — five, all re-proved against the CORRECTED geometry

A red transcript is a measurement and measurements go stale: the first three
were proved against geometry that has since moved (the instance fix changed the
stone from 9.770 to 10.750), so all of them were re-run. Canonical seed
**20260728**, chute crossing world `(55.48, 9.69, 21.82)`, masonry top radius
**230.750** (`r − R` = 10.750), winning mesh `crenellations`, facade-local
`9.8500`.

Each is a temporary patch to `test/procgen/parkFacts.ts`, reverted with
`git checkout` immediately after.

**D — the mesh clause catches the real regression.** `instanceof
InstancedMeshForMasonry` forced false, i.e. the reviewed bug reintroduced
exactly:

```
AssertionError: the highest castle stonework was found on `castle-wall-lintel`,
not on `crenellations` — the battlements are the top of the castle by
construction, so either they have dropped out of the measurement (an
`InstancedMesh` walked without its per-instance matrices collapses all 40
merlons onto the origin, which is issue #625's review exactly) or something has
grown up through them
```

**A — the value clause fires when the stonework moves.** Masonry pushed 8 m
radially outward at the scene-graph level:

```
AssertionError: the highest castle stonework sits at 17.662 m in the facade's
own frame, but the castle is built to `CASTLE_MASONRY_TOP` = 9.850 m — off by
7.812 m…
```

Note this now trips *before* the clearance clause — the value check is strictly
stronger than moving-the-stone, which is why the clearance clause needs its own
control below. That is a change from the first round and worth knowing.

**A2 — the clearance clause itself, with the stone left alone.** Each chute
sample pulled 6 m towards the planet's centre:

```
AssertionError: the ginormous slide crosses the castle's south wall at world
(53.99, 3.88, 21.82) — measured radially, its underside is 10.22 m above the
planet's surface and the stonework tops out at 10.75 m, so the chute is 0.53 m
inside the battlements…
```

10.75 is the true merlon top, and 6 − 5.441 = 0.56 ≈ the 0.53 reported, which is
the consistency check on the control itself.

**B — the anti-vacuity guard.** Name pattern broken to `/^(NOT-castle-wall-|NOT-crenellations$)/`:

```
AssertionError: no castle stonework was found in the built park at all, so the
check that keeps the ginormous slide out of the battlements measured nothing…
```

**C — the frame guard.** `- 220` appended to the fact's `radius()`:

```
AssertionError: `parkFacts.castleMasonryTopRadius` is 10.750, which is not a
radius from the planet's centre — every point in the park is at least
GROUND_SPHERE_RADIUS (220) from it…
```

All five red with real numbers, no `NaN`, no `Infinity`. Reverted, and the
invariant re-run green (`1 passed | 92 skipped`).

**What the controls could not do, said plainly:** none of A, B or C caught the
instance regression, and I ran all three while it was live. A control proves the
clause you aimed it at and nothing else.

## Test counts, before and after — identical, and that is the correct result

Both runs on this machine, `pnpm run test:procgen`:

| | files | tests | duration |
|---|---|---|---|
| base `5220305b` | 5 failed \| 16 passed (21) | **85 failed \| 563 passed (648)** | 74.68 s |
| this branch, after the instance fix | 5 failed \| 16 passed (21) | **85 failed \| 563 passed (648)** | 83.06 s |

The **failing sets are identical, compared line by line, not just the counts**
(85 vs 85, `diff` clean) — the swap-not-caught-by-a-count trap. The battlements
test is in neither set: it was green before (plumb vs plumb, self-consistently,
+0.539 m) and is green now (radial vs radial, +5.441 m). What changed is that it
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

## For QA — where to stand, and against which number

No browser was available to any agent on this lane. The thing to watch is the
ginormous slide leaving the castle roof over the **south** battlements.

**Judge it against 5.44 m of air under the chute, not the 6.42 m the first
write-up claimed.** That difference is the merlons, and the merlons are exactly
what a person would be looking at.

`/slide` boards the ride. For a look from outside, a `/view` camera south-east
of the castle facing back north-west at the parapet. `/spawn?pos=55.5,21.8`
stands her at the crossing's plan position, under the chute.

Nothing a player can see has changed on this branch — it is a corrected
measurement and three new clauses, all test-side, plus comment edits in `src/`.

## Rebased onto a moved base, 16 Sep

The base `eng/sphere-ground-claims` gained two commits mid-review:

- **#631, `check:flat-primitives`** — a new ratcheted check. It immediately and
  correctly failed this branch with `BASELINE LOOSE
  parkFacts.ts::AXIS_ALIGNED_BOX::box.max.y (baseline 5, now 3)`: replacing the
  castle-masonry `Box3` walk with a radial vertex walk **removed two
  axis-aligned box reads**, and the ratchet wants the baseline to follow an
  improvement down. Tightened 5 → 3 in `scripts/flat-primitives-baseline.mts`.
  That is the check working — it is the only reason anyone knows this branch
  made the file measurably less flat.
- **#634, the `check:hotel` fix** — so any inherited-red table written before
  that landed is stale. Re-measured against the new base.

Chain step **sets** compared after the rebase, not counts: base 66, mine 66,
**nothing dropped, nothing added** — this branch does not touch the chain.
Three-dot diff unchanged at 7 files (+ the baseline), no deletions.

## PR

Open as **#637**, base `eng/sphere-ground-claims` (not `main`).

Review verdict on revision 1 was **changes requested**, and it was right: the
vertex walk dropped all 40 merlons. Revision 2 fixes that, adds the two clauses
that catch it, re-derives every figure, and corrects the false corroboration
that had reached `src/world/building/layout.ts`.
