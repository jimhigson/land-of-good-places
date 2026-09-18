# Handoff — the rail race's ring geometry (PR #667 reds)

Branch `fix/railrace-geometry`, from `origin/feat/procgen-on-sphere` (ae20b9fc).
Worktree `.claude/worktrees/railrace-geometry`. PR goes **against
`feat/procgen-on-sphere`**, never main. Do not merge.

## Baseline, measured on the branch point (ae20b9fc)

`pnpm run test:procgen` — **55 failed | 636 passed (691)**, quoted off the
screen. Failure *names* saved (41 distinct name+seed lines); the rail-race
cluster in it:

| failing test | seeds |
|---|---|
| every Rail Race trestle forks twice and carries all four tracks | all 5 |
| the Rail Race sleepers bridge both rails, a metre apart | all 5 |
| both Rail Race rings stand outside the park… | 4 |
| every racer meets the same number of duck bars, and no two bars touch | 4 |
| every Rail Race duck bar stands over a real trestle leg | 5 |
| every Rail Race duck bar slows you down where it stands | 4 |
| the Rail Race finish rainbow stands on the ground | 326 |

Not mine (left in the name-diff as pre-existing, measured at the same commit):
Sky Cruiser supports ×2 tests, gate arch, coping stones, slide vs towers/roof,
paved detour, bushes count, bridge mid-air path.

## Root cause — one defect, six symptoms

**The ring's cross-section was sheared by the planet, not leant by it.**

`route.pointAt` was `flatPointAt` followed by `placeOnSphere` **at the lane's
own column**. `placeOnSphere` displaces a point outward by `height x up.x`, and
`up.x = r / GROUND_SPHERE_RADIUS` = 0.32-0.46 out at the ring. The four lanes
undulate on their own phases and stand up to 4.38 m apart in height at one
station, so they were displaced outward by up to `4.38 x 0.46 = 2.0 m`
*relative to each other* -- against a walk-past lane spacing of 1.1 m.

Measured with the ring's own inverse (`scripts/_probe-lanes.mts`, canonical
seed), reading each drawn lane's chart offset back off the built geometry:

```
                       worst lane-offset error   unleant outset span (laneSpan)
before (per column)    walk-past 0.329 m               3.953   (3.300)
                       race      0.877 m               9.885   (8.250)
after  (rigid frame)   walk-past 2.7e-14 m             3.303   (3.300)
                       race      2.6e-14 m             8.256   (8.250)
```

So the walk-past lanes wandered **30% of their own 1.1 m pitch** and the race
lanes 0.88 m. In **plan view** -- which is the question `nearestLane` and a
trestle branch both ask -- that is enough for a high lane to be pushed outward
past a low neighbour and the two to swap order, which is why a trestle's four
branch tops landed over only three distinct lanes. In 3D they stay apart (the
control reads 1.192 m closest approach on the broken geometry), because what
separates them there is the very height difference doing the shearing.

**Correction to this file's first draft**, which claimed a "-0.284 m drawn
lateral gap". That number came from projecting drawn points onto the *flat*
outward normal, which double-counts the lean -- the instrument re-introduced
exactly the term the fix removes. The frame-correct numbers are the table
above. Same defect, and the fix is unchanged; the first measurement of it was
not one to quote.

Everything follows from that one shear:

- trestle branch tops land over the wrong lane in plan -- "carries only 3 of 4
  lanes";
- a sleeper's gauge point measures to the wrong lane's rail -- 0.53-0.57 m;
- duck bars and their supporting legs disagree;
- the two rings interleave (closest drawn lane centres 0.300 m), so
  `race-ring/rail-1` and `walk-past-ring/rail-1` share a plane.

**No map that displaces a point outward in proportion to its height can avoid
this** -- that is the trap I circled three times. Applying the undulation along
the local up afterwards shears exactly the same amount, because the undulation
*is* the height difference. The only fix is a **rigid station frame**: at each
arc length the whole cross-section is rotated as one piece about the centre
line's own column. `RailRaceRoute.lean` / `.unlean` are that map and its exact
inverse.

**Control run** (the instrument proved able to fail): reverting `pointAt` to
`placeOnSphere` at the lane's own column and re-running the same probe gives
the "before" row above -- 0.329 / 0.877 m of offset error against 2.7e-14 after.

## Second, separate defect — an instrument fault

`railOutsetRange` (invariants.ts) asks `boundary.distanceToEdge` of **drawn**
rail vertices. The boundary is a flat-chart object; a drawn point is leant, and
the lean is worth 1.9–6.5 m of apparent outset out here. Measured:

```
                built (raw)          unleant (flat chart)
walk-past   6.70 .. 14.00  span 7.30     4.85 .. 8.15  span 3.303  (= laneSpan 3.3)
race        3.60 .. 17.14  span 13.55    2.37 ..10.63  span 8.253  (= laneSpan 8.25)
```

So the ring is authored exactly right and the check was reading the planet.
`terrain.ts`'s `unplaceFromSphere` exists for precisely this and says so in its
own doc. Unleant, the ratio is 10.18 / 4.07 = **2.500**, the scales' own claim.

## Status

- [x] baseline `test:procgen` captured, failures named
- [x] root cause measured, both defects
- [ ] rigid station frame in `route.ts`
- [ ] `leanTrestleTree` follows
- [ ] `railOutsetRange` unleans
- [ ] coplanar baseline stale entries
- [ ] re-run, name-diff
