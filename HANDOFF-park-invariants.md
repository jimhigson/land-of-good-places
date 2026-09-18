# Handoff — park-wide procgen invariant failures (#667)

Branch `fix/park-invariants` off `feat/procgen-on-sphere`, worktree
`.claude/worktrees/park-invariants`. PR against `feat/procgen-on-sphere`.
Do not merge. One heavy suite at a time; kill node by PID.

**Another engineer owns the rail-race trestle / duck-bar / ring-geometry
failures.** Do not touch `duckBars*`, `railRaceTrestles*`,
`railRaceSleepers*`, `railRaceRings*`, `finishRainbow*`.

## Baseline, quoted off the screen

`pnpm run test:procgen` at `ae20b9fc` (branch head as created):
`Test Files 5 failed | 17 passed (22)`, `Tests 55 failed | 636 passed (691)`.
Full name list: `scratchpad/names-head.txt`.

My slice, 19 of those 55:

| invariant | seeds | note |
|---|---|---|
| the park gate arch stands over its gateway | all 5 | headroom ray vacuous |
| every support meets the track it carries | all 5 | Sky Cruiser pylon |
| the Sky Cruiser stands on its own supports | all 5 | same pylon |
| no two close destinations … disproportionate paved detour | 11, 131 | |
| every modelled coping stone sits on the wall it caps | 11, 131 | ~0.03 m |
| the ginormous slide does not clip the castle towers | 24, 326 | |
| the ginormous slide clears the garden on the castle roof | 131 | 0.22 m |
| no drawn path ends in mid-air on a bridge | canonical | spur-exit-railRace |
| built the park it was asked for (bushes 159 < 180) | 11 | |

## Root cause found so far

**The unifying disease is the sphere.** The base
(`feat/sphere-combined`) moved the park onto a planet of radius 220 m
(`src/world/geo/`), so **world +Y is not up** anywhere but the exact park
centre. Every one of these instruments still measures along world +Y.

### 1. The gate arch — the vacuous headroom, proved

`scripts/gate-arch-measure.mts` cast its headroom rays along
`new Vector3(0, 1, 0)`. Measured on the canonical seed
(`scripts/_probe-arch.mts`, untracked):

```
arch world pos 0.000, -8.540, 60.000
local up at arch 0.0000, 0.9620, 0.2730   (15.84 deg off world +Y)
world +Y: 0/13 rays hit, nearest overhead Infinity m along the ray
local up: 13/13 rays hit, nearest overhead 3.552 m along the ray
```

So the arch **is** there and **is** 3.55 m over a child's toes. Every ray
missed it by leaning; `lowestOverheadY` was `Infinity`; the
`headroom < TALLEST_CHILD_HEIGHT` clause under it could never fire.

**What the vacuous clause was excusing: nothing, on these five seeds.** The
real headroom is 3.55 m against a `TALLEST_CHILD_HEIGHT` of ~1.5 m, so the
gate was in fact fine — but the clause had stopped being able to say so, and
would equally have passed an arch lowered to a child's knees. It has been
vacuous since the sphere landed (`667e743e` / `cb76ac1c` on
`feat/sphere-combined`), i.e. for the whole life of that branch.

## Status

Model: **Opus 5 (1M context)**, chosen by the Overseer's dispatch (the default
for an Engineer). A replacement runs the same model.

Baseline at branch base `ae20b9fc`: `Tests 55 failed | 636 passed (691)`.
Now: `Tests 35 failed | 656 passed (691)`. **None new** at any step — every run
name-diffed, not counted (`n1.txt` baseline vs `n7.txt` now, in the scratchpad).

Fixed (6 of my 8 kinds, 15 of my 19 test instances):

- [x] **gate arch** (5 seeds) — headroom rays along the planet's up, not world
      `+Y`; headroom computed once in `gate-arch-measure.mts` instead of twice
- [x] **Sky Cruiser pylons**, both invariants (5 seeds each) — drawn tops
      unleant to the flat frame the route is planned in
- [x] **slide vs castle towers** (2 seeds) — `CASTLE_TOWERS` moved onto
      `CASTLE_FRAME`; invariant measures each turret's own axis; the solver now
      judges the built Catmull-Rom instead of its control points
- [x] **a path ends on a bridge** (canonical) — a bridge-deck lattice node is
      no longer offered as a spur junction
- [x] **slide vs roof garden** (seed 131) — measured in the castle's own frame
- [x] **detour ratios, seed 11** — an unreachable pair now gets a connector

Not fixed, both written up below:

- [ ] **bridge coping** (seeds 11, 131) — real, 3 cm, first block of each run
- [ ] **detour ratios, seed 131** — a pocket cut off by the cruiser corridor
- [ ] **bushes, seed 11** — 175 against a floor of 180; a budget question that
      changes the park's look, so it is Jim's call (see below)

## The one trap in the tower fix, for whoever touches it next

`TowerSolid` now carries **two** descriptions on purpose, and they are not a
duplication:

- `localX/localZ/localBottomY/localTopY` — the solid, in the castle's own axes,
  which is where it is drawn. `distanceOutsideTower` takes a world point through
  `worldToCastle` and measures here. This is the half that fixes the slide.
- `x`/`z` — the **plan** position, `BUILDING_CENTRE + local`, exactly as before.
  Every ground-plane consumer reads this: the collider
  `Building.registerCastleTowerCollision` registers, `check:castle-towers`'
  march, `parkFacts`' turret list.

Moving `x`/`z` to the drawn foot was tried and **reverted**, because it reaches
the colliders. `pnpm run check` caught it:

    check:castle-towers FAILED — 1 problem(s):
      - tower-body-0 stops a child at 2.66 m from its axis but its collider
        should hold her at 2.83 m — she is 0.17 m inside the drawn stone

Both of those numbers come from the same field, so the 0.17 m is the memo
moving under one of its two readers: `castleToWorld` pulls in `CASTLE_FRAME`,
which depends on `BUILDING_BASE_Y` and the terrain, and the plan position never
did. A collider registered from it can therefore go stale where it could not
before. If you do want the colliders under the drawn feet, that is its own
piece of work with its own ordering guarantee — not a side effect of a
measurement change.

## The rule that found most of them

**Every one of these was the sphere, in one of two shapes**: a measurement
taken along world `+Y` where the park's up is radial, or a plan-frame
description compared against a drawn one. `unplaceFromSphere` and
`worldToCastle` are the two inverses that exist for it, and
`ParkFacts.cruiserPylonTops` / `castleRoofGardenInCastleFrame` /
`slideChuteInCastleFrame` / `castleTowers`' axes are where this branch now does
it. Before assuming a red invariant means broken geometry, ask which frame each
side of the comparison is in — but **measure the answer**, because on the
towers the frames were genuinely inconsistent *and* the geometry was genuinely
wrong, and on the coping neither was.

## Bushes on seed 11 — a decision, not a bug

`expect(facts.bushes.length).toBeGreaterThan(180)` and seed 11 plants **175**
(159 before my connector fix changed that park slightly).

`BUSH_BUDGET` is an **attempt cap**, not a target: the scatter tries 4200
candidates and keeps whatever fits. Seed 11 is simply a crowded park — the
other seeds get 429-628 from the same 4200. Measured on seed 11:

| BUSH_BUDGET | bushes |
| --- | --- |
| 4200 (today) | 175 |
| 6000 | 243 |
| 9000 | 343 |

Raising the cap is monotone — the candidate order is fixed, so it only ever
adds bushes at the tail and never moves an existing one — and it would fix this
outright. **But it makes every park visibly denser**, which CLAUDE.md puts in
Jim's hands, not an engineer's. Do not lower the floor: its own docblock
records that 180 is "no park thinner than the day before #500" and that a floor
which only fires after a two-thirds collapse is not a floor.

## Detour ratios on seed 131 — the ride-corridor screen has no escape

`ferrisWheel`/`stall.dodgems` 19.8 m apart, **362.3 m by paving (18.26x)**.

Traced with `LGP_DEBUG_STREETS=1`: six candidate pairs round the ferris wheel
and the dodgems, all inside the 35.9 m cap, **every one refused for crossing
the Sky Cruiser's corridor**:

```
[connect] stall.spaceFerrisWheel-stall.dodgems: rejected, crosses a ride corridor
[connect] ferrisWheel-stall.dodgems:            rejected, crosses a ride corridor
[connect] stall.dodgems-exit-ferrisWheel:       rejected, crosses a ride corridor
[connect] dodgems-stall.spaceFerrisWheel:       rejected, crosses a ride corridor
[connect] ferrisWheel-dodgems:                  rejected, crosses a ride corridor
```

That screen runs **before** `detourIsDisproportionate` is computed and returns
unconditionally, so it is the only screen with no escape — while the escape's
own comment claims "every pair that invariant would flag is a pair this escape
reaches first", which is false for exactly these.

**Tried and reverted** (do not just redo it): hoisting the escape above that
screen and giving it the slide screen's doorstep-shaped exemption
(disproportionate AND one end already in the corridor). It does not fire on
seed 131 — the corridor runs *between* the two rides, neither end is in it —
and on seed 24 it drew `connector-building-hotel` 5.67 m off the lattice,
failing `streetsShareLatticeLines`. The answer needs to be either a connector
that routes *around* the corridor, or letting the pylon planner backtrack round
a lamp (CLAUDE.md's standing rule) rather than the path yielding to the ride.
`skyCruiserStandsOnItsOwnSupports` and its open-span clause are the guard that
would tell you whether the ride actually lost anything.

## Bridge coping — diagnosed, not yet fixed

`scripts/_probe-coping.mts` (untracked), seed 11:

```
bridge-14.0: identity matrix true; COPING_SINK 0.08
  block  0/81 lowEdge n=8 (16.18, -7.06, 55.40): world-y gap 0.0307
              | along-normal 0.0484 | along-up 0.0411
              block y span -7.064..-6.265; wallTop there -7.015
  block 40/81 lowEdge n=8 (11.82, -6.76, 55.40): world-y gap 0.0307  (same numbers)
bridge-330.0: block 0/82 and 41/82, 0.0316 / 0.0318
```

**It is not a frame artefact.** Measured three ways — along world `y`, along the
wall-top triangle's own normal, and along the planet's local up — the seat error
stays 0.03–0.05 m. None of them is zero, so unleaning does not explain it.

**It is always the first block of each of the two parapet runs** (block 0 and
block 40/41 of ~81, which is one per side), on every failing bridge. The blocks'
bottom faces are flat (8 vertices at one height to within 1e-3), so the stone is
level there and its base should be exactly `COPING_SINK` below the cap.

**Tested, and the instrument is exonerated.** At all four failing plan points
the cap has **exactly one** containing triangle, at exactly the height
`wallTopAt` returns:

```
block  0/81 ... wallTop first -7.015; containing triangles 1: [-7.015]
block 40/81 ... wallTop first -6.713; containing triangles 1: [-6.713]
block  0/82 ... wallTop first -6.332; containing triangles 1: [-6.332]
block 41/82 ... wallTop first -6.515; containing triangles 1: [-6.515]
```

So the seam is real and lives in `buildCopingRun`. The arithmetic that should
make it exact: the block's centre goes to `(topA + topB) / 2 - COPING_SINK`
with its base plane perpendicular to `trueY` and therefore parallel to the
chord, so the base is the chord translated down `COPING_SINK` in `y` and its
low end should be `topA - COPING_SINK`. It measures `topA - 0.049` instead, on
the **first laid block of a run and no other**. The taper filter
(`Math.min(parapetA, parapetB) < COPING_HEIGHT`) is what decides which segment
is first, so start there.

Where to look next. `bridges.ts` pushes `parapetLine[i].top = [parapetTopPlus,
parapetTopMinus]` and builds the `wallTop` cap quads from the *same* two
numbers, so per ring they agree by construction — which means the disagreement
is in the **lookup**, not the data. `wallTopAt` in the invariant returns the
**first** triangle whose plan projection contains the point; at a ramp foot the
cap strip's plan projection can double back on itself as the parapet tapers, so
an earlier triangle can win at a different height. Test that before touching
`bridgeStonework.ts`: collect every containing triangle rather than the first
and print how many there are at those four plan points. If there is more than
one, the instrument is picking wrong; if there is exactly one, the seam is real
and lives in `buildCopingRun`'s first segment.

Do **not** widen the 0.02 m tolerance.

## `check:solve-cost` is flaky on a shared Mac — measured, not asserted

`pnpm run check` went red once on this branch at:

    layout stage cost 275.1 ms against a 250 ms budget (8 x its measured 9 ms)

**It is not this branch's doing, and here is the evidence rather than the
claim.** `parkLayout.ts` — the stage being timed — imports nothing this branch
touches (`grep` for `distanceOutsideTower|CASTLE_TOWERS|worldToCastle|
pointStandsOnABridge|chuteCentreLine` in it returns nothing), and the commit
immediately before the red run made `castleTowersNow` **cheaper**, not dearer.

Five measurements of the same stage on the same code:

| run | machine | layout |
|---|---|---|
| full `check` #1 | contending with a stray second `check` | 99.8 ms — ok |
| full `check` #2 | load avg **14.82**, four other agents' worktrees busy | **275.1 ms — FAIL** |
| alone | load ~14 | 216.5 ms — ok |
| alone | load 13.33 | 102.2 ms — ok |
| alone | load 13.33 | 97.4 ms — ok |
| alone | load 12.74 | 96.1 ms — ok |

The budget is `8 x 9 ms measured, floor 250`, so the **floor** is carrying the
whole check: the stage's own median is 9 ms and every real reading is 10-30x
that. What the number actually measures on this machine is contention, not the
solver.

Per CLAUDE.md flaky *is* failing, so this wants root-causing — but the root
cause is a wall-clock budget on a box running five agents at once, and the fix
is to measure CPU time rather than wall time (or to serialise the check), not
to widen 250 until it stops going red. **Do not widen it.** Left for whoever
owns `scripts/check-solve-cost.mts`; raised here with the numbers so the next
person does not have to rediscover them.

Everything else in the 66-step chain passed, including `check:park`
(19/19 attractions, 256/256 waypoints, all six invariants) and
`check:castle-towers`.
