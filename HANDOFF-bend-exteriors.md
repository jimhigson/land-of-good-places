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

## Not done

Boundary wall + pillars (`Scenery.ts` ~2294, long runs, one `standOnSphere`
each and a flat `base = min(terrainHeight)` datum), gate arch
(`gateArch.ts:180`), bus shelter (`Entrance.ts:416/529`), fountain, shops.
`segmentsFor`/`segmentsAlong` in `bend.ts` exist for the long-run case and are
unused so far. Stay out of `train/` — another engineer.

**No visual QA has been done. I was not given the browser.** That is a stop
sign, not a footnote: nobody has looked at the bent castle on a rendered frame.
