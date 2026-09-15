# HANDOFF — bend building exteriors to the sphere

- **Branch** `eng/bend-exteriors`, off `feat/sphere-combined`.
- **Model: Opus 5 (1M context)**, chosen by the Overseer. A replacement runs the
  same model.
- Worktree `.claude/worktrees/eng-bend-exteriors`. A second worktree,
  `.claude/worktrees/bend-baseline`, is a detached checkout of the base commit
  kept **only** for baseline measurements — remove it when done.

## What is done

`src/world/geo/bend.ts` — the primitive. `bentFrame` places a part by the
chart's exponential map and orients it by the one Rodrigues rotation that
parallel-transports the anchor's whole basis along the geodesic to it, so each
part stands on its own local vertical. `bendOntoPlanet` reaches **per-instance
matrices and per-vertex positions**, because the castle's four towers are four
*instances* and its curtain walls are one merged `ExtrudeGeometry` covering all
four sides — there is no per-tower or per-wall object to lean.

Applied to: **castle facade** (`Building.ts`), **hotel tower**
(`Hotel.ts`).

`layout.ts` owns the castle's frame (`CASTLE_FACADE_FRAME` / `_CHART` /
`_BASE_ALTITUDE`), built by calling `placeOnSphere` — the existing owner of the
rigid placement — with the same arguments `standInPlot` uses. Both the drawn
mesh and `CASTLE_TOWERS` bend against that one chart. Verified bit-identical to
the scene's own world transform (position gap 0.0000 m, quaternion equal to 5 dp).

`check:castle-bend` is new and **in the chain** (parsed: 65 steps before, 66
after, zero lost).

## Measured, on the built park

- turrets splay **7.977°**, each on the radial under its own foot to **0.0084°**
- wall base course holds one radius to **0.1 cm** against **65.3 cm** for a rigid chord
- what the rigid tilt cost: **0.51 m** at a tower foot, **1.14 m** 14.8 m up

Red-run proof (delete the `bendOntoPlanet` call in `Building.ts`), against the
rigid castle on the canonical seed, footprint ±12.225 × ±9.225 m:
splay **0.0000°**; turret up **3.8796°** off its own radial; wall base course
**35.4 cm** against its own prediction of **35.5 cm** — agreement to 1 mm, which
is the strongest evidence the instrument measures what it claims. Exit 1/0.

## THE BIG FINDING — pre-existing, not caused here

`CASTLE_TOWERS` has been describing **vertical** cylinders while the drawn
towers were **already tilted 36°** by the plot's `standOnSphere`. Measured on
the *untouched base commit*: drawn bodies stand along up `(0.439, 0.802,
-0.404)`, centres spanning 18 m of world `y`; the solids claim all four vertical
over y −43.0…−32.4, so `tower-body-2`'s drawn centre (−29.7) is already above
the top of its own collider, and axes are up to 4.6 m out in x/z.

This branch's leaning `TowerSolid` fixes it. **Consequence:** the ginormous
slide can no longer solve on **seed 326** — it is now held to the towers that
are really there. All ten ladder rungs fail at the same point, so length was
never the free variable. Needs the slide's owner: fix the generator or replace
the seed, and write down why.

## CI STATE — the base branch is already red

Measured on the base commit, not on this branch:
- `check:park` — **4 regressions** (`poi.stranded` 6, `rail.walkable` 7,
  `anchor.reach:hotel` 2.2, `anchor.reach:ferrisWheel` 1.9)
- `test:procgen` — **128 failed / 501 passed**

This branch: `check:park` has the same four and no others (`rail.walkable`
improved 7 → 3, deterministic over two runs). `test:procgen` 108 failed, with
the seed-326 suite throwing as above.

## The nine failures this branch adds (all rides vs the castle)

Diffed by **test name**, not by count, against the base commit's own run:

- seed 326 — the whole suite **throws**: `planSlide` finds no rideable chute
  after all ten ladder rungs, always at the same point. Worst kind of failure:
  a throw takes 93 tests down as *skipped*, and a skipped test is not a passing
  one.
- seed 11 — slide clips the castle towers; slide clears the roof garden; Sky
  Cruiser turn radius; no tree on the railway; paved detour ratio
- seed 24 — Sky Cruiser fits through its castle window; Sky Cruiser flies clear
- canonical — slide clears the garden on the castle roof

Every one is a ride being held to the real castle for the first time. None is a
defect in the bend itself: the bend is proven by `check:castle-bend`, and
`check:castle`, `check:castle-towers` and `check:castle-floors` all pass.

**This needs the slide's and the Sky Cruiser's owners**, not this branch. The
honest framing for them: the obstacle did not grow, it was always there and is
now being measured.

## The rest of the lane, audited by measurement (15 Sep)

`scripts/rigid-audit.mts` measures each structure's own footprint radius off the
built park and compares it against the 4.69 m a flat patch is honest to. Run it
before bending anything else — the answers were not what the brief assumed.

| structure | radius | departs | verdict |
|---|---|---|---|
| building-facade | 24.20 m | 133.5 cm | **bent** |
| the-land-hotel-outside | 20.69 m | 97.5 cm | **bent** |
| entrance-arch | 13.22 m | 39.8 cm | child of the facade, bends with it |
| park-gate-arch | 7.42 m | 12.5 cm | **bent** — but see the gap below |
| fountain | 6.38 m | 9.2 cm | **not done** — see below |
| facePaintStall | 3.40 m | 2.6 cm | inside tolerance, left rigid |
| welcome-sign | 3.06 m | 2.1 cm | inside tolerance, left rigid |
| bus-shelter | 2.74 m | 1.7 cm | inside tolerance, left rigid |
| keychainShop | 1.98 m | 0.9 cm | inside tolerance, left rigid |

`railRace:arch` measures 219 m and is the rail race's own ring — another lane.

### The wall does NOT need bending, and the premise that it did was mine

- All **165** real wall runs are at most **8.4 m**, under the 9.38 m a rigid box
  may honestly be. Worst sphere sag at a run's middle: **4.0 cm**, inside the
  5 cm tolerance. The terrain's own waves wander up to **9.3 cm** off the
  chord — more than the sphere contributes.
- The flat `base` datum leaves at most **0.6 cm** of daylight under any run,
  measured along the drawn underside of all 165; **zero** runs exceed 5 cm. It
  errs entirely toward burial, which is invisible and solid.
- The 37.3 m "wall run" that started this was a **bridge parapet**
  (`wallTop`/`coping` in `train/bridges.ts`, the other engineer's lane), and
  "the ground falls 12.44 m along it" is what a bridge is *for*. My first probe
  matched on a loose name regex and measured bridges.

I built the segmented-and-bent wall first, then reverted it. Shipping it would
have added vertices and risk to 165 runs already inside tolerance.

### The fountain: measured, and deliberately left alone

6.38 m radius, 9.2 cm departure — over the limit, so by the rule it should bend.
It is not bent, for reasons that are all measured:

- **Its water surface is vertex-animated.** `update()` rewrites every water
  vertex each frame — `array[i + 1] = ripple`, from a stored flat `waterBase` —
  so a bend written into it is overwritten on the first tick while `waterBase`
  stays unbent. It would not be subtly wrong; it would simply not take.
- **The water disc is 5.84 m and departs 7.7 cm**, so it is *not* small enough
  to skip honestly. I wrote a comment claiming it was "about 2 m, ~2 cm" and
  that claim was wrong — exactly the unverified justification this lane keeps
  finding. Measured, then deleted.
- **So a partial bend is worse than none**: bending the stonework while the
  water stays flat makes the water plane disagree with its own basin by up to
  7.7 cm, which reads as water floating above or sunk below the rim.
- It also costs **11.48 ms** of park-build budget (65 meshes, 6 geometry
  clones), against a `check:park-boot` ceiling already at its limit.

**The correct fix** is to make the ripple bend-aware: store `waterBase` as bent
positions and displace along the local up at each vertex, so the water curves
with its basin. That touches wading, splashes and the coin toss
(`waterSurfaceY`, `waterLevel`, `intoFountain`), which is why it is its own
piece of work rather than a rider on this one.

### Gate arch — bent, but NOT visually confirmed

Measured and build-verified: 7.42 m radius, one tilt was misplacing its outer
piers by **12.5 cm**. Its colliders stay honest — bending moves a pier foot
horizontally by `d − R·sin(d/R)` = **1.4 mm** at that radius, and the drop is
vertical while the collider is a footprint.

**I could not get it on screen.** Four attempts via `/view` and `/spawn` at its
measured position (0, −52.65, 142.80) on the canonical seed showed the rail
race, paths and walls but never the arch. `Entrance.ts:317` does pass
`onParkSphere: true`, so the bend does run; the likely explanation is that the
entrance group is hidden outside the arrival sequence, which both `/view` and
`/spawn` skip. **This needs a QA pass that watches the arrival.** Reported
rather than claimed.

## check:park-boot — root-caused, and it is NOT the wall-clock bug

**PR #624.** Ruled out the #606/#615 shape by measurement rather than by reading:
`process.threadCpuUsage()` appears **nowhere** in this base, so that fix is not
here — but instrumenting each slice with both clocks shows the failing slice is
**`wall 21.21 ms, cpu 21.11 ms, descheduled 0.10 ms`**. It is real CPU. The clock
is honest; widening or re-basing the measurement would fix nothing.

It is the other shape: **the work at boot genuinely exceeds the ceiling**, and
specifically it is work the budget *cannot* police. The failing slice does
**0 generator work units in 21 ms**, during "joining up the paths" — and the
tasks running at that stage (`parkGeneration.ts` ~285-330) are **dynamic
`import()`s**, whose module evaluation is indivisible. You cannot yield inside an
ES module evaluation, so whatever it costs lands whole inside whichever budgeted
slice the microtask resolves in, attributable to no step.

Ranked by evaluation cost under the TS resolver (inflated vs the bundled build,
but the ranking holds): `slide/solve` 547 ms, `paths` 256 ms, `pathGraph` 93 ms,
everything else under 7 ms.

**It is flaky at the ceiling**: five consecutive runs on this branch gave 18.7,
18.8, 17.5, 19.0 and **21.2 ms** — four passes and a fail. On the untouched base:
21.9 and 22.1 ms. So the branch is *faster* and still fails, and flaky is failing.

**Two honest fixes, neither in a geometry lane**: make `pathGraph`'s top-level
evaluation cheap by moving its work into a unit-counted task, or have the
scheduler resolve module imports outside a budgeted slice, since a step budget
cannot meaningfully police a module evaluation. Do **not** simply raise the
ceiling — a 21 ms hitch is a real stutter on a phone, which is what the check
exists to catch. The related trap a reviewer caught on #615 still applies to
whoever does this: a **single-slice task** can blow its budget and pass, so any
corroboration must accept "every slice the task ran".

## check:fountain-hop seed 131 — the check's datum was broken, not the hop

Fixed on this branch. The route is entirely correct: it reaches the goal, its
last waypoint is the fountain's centre to **0.000 m**, and `sample()` there
returns **0.0201** — exactly the `goalY` handed to `findRoute`.

`NavGrid.lastRouteEndY` returns `nodeHeight[endNode]`, the **lattice node's**
stored level snapped to the goal cell's nearest level within `MAX_LEVEL_GAP`,
while the check compared it to an exact point sample with a **10 mm** tolerance.
The lattice's level fidelity is coarser than that, so the tolerance was tighter
than the thing it measured could ever be and passed elsewhere by coincidence.
**`NavGrid`'s own docblock says `lastRouteEndY` is "the goal's own level when it
was reached", which is not what it returns** — worth fixing at source by whoever
owns nav.

The clause now asserts what its message always claimed — wading surface rather
than paving, 0.70 m apart — and was proved red by forcing the end onto the
paving: 0.706 m from the water against 0.000 m from the paving.

## Not done

Boundary wall + pillars (`Scenery.ts` ~2294, long runs, one `standOnSphere`
each and a flat `base = min(terrainHeight)` datum), gate arch
(`gateArch.ts:180`), bus shelter (`Entrance.ts:416/529`), fountain, shops.
`segmentsFor`/`segmentsAlong` in `bend.ts` exist for the long-run case and are
unused so far. Stay out of `train/` — another engineer.

## Visual QA — done, 14 Sep

Two `vite preview` builds of the *same commit*, differing only in whether the
`bendOntoPlanet` call in `Building.ts` runs, served on 5418 (rigid) and 5419
(bent), both pinned with `?seed=20260728` so the browser matches the harness.
Jim's preview on 5412 was left alone. Both servers killed by PID afterwards;
ports confirmed free, 5412 confirmed alive.

The frames:

    /view?seed=20260728&camPos=138.4,-22.9,-65.9&camDir=-38.4,-14.5,-25.9&timeOfDay=12:00
    /view?seed=20260728&camPos=171.6,-6.8,-47.4&camDir=-74.7,-36.2,-41.6&timeOfDay=12:00   (wider)
    /view?seed=20260728&camPos=174.4,-77.1,-91.3&camDir=-38.4,-4.8,-32.7&timeOfDay=12:00   (hotel)

**Verdict: the splay is visible and reads correctly.** Rigid, the four turret
cones are parallel — every one points the same way on screen. Bent, they fan:
the left one leans left, the right ones lean right. The castle still sits on
the ground, no floating and no sinking, and the curved horizon behind it makes
the lean read as *standing on a round world* rather than as falling over.

The hotel's change is much smaller, and that is the correct result rather than a
disappointment: its crystals cluster close to the tower's centre, so there is
little footprint for down to vary across. The bend is proportionate to size,
which is the whole claim.

**One instrument discarded rather than shipped.** An A/B pixel-difference of the
two builds looked compelling and read **32.8% of frame changed** — but it also
lights up NPCs, ride vehicles and anything else that is not identical between
two runs, so it overstates the castle's own movement by a wide margin. Same
disease as the three wall clauses: a number that is not describing what it
claims to. The side-by-side is the honest frame.
