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

**The ring's lanes cross over each other on the walk-past ring.** Measured
(`scripts/_probe-lanes.mts`, canonical seed):

```
walk-past min drawn lateral gap -0.284 m at s=518.0  (lane 2 -> 3)
          46 of ~690 sampled (station,pair) readings have gap <= 0
          nominal laneSpacing 1.1
race      min drawn lateral gap  1.412 m   nominal laneSpacing 2.75
closest drawn lane centres between the two rings: 0.302 m
```

Why: `route.pointAt` is `flatPointAt` followed by `placeOnSphere` **at the
lane's own column**. `placeOnSphere` displaces a point outward by
`height × up.x`, and `up.x = r / GROUND_SPHERE_RADIUS` = 0.32–0.46 out at the
ring. The four lanes undulate on their own phases and stand up to 4.38 m apart
in height at one station, so they are displaced outward by up to
`4.38 × 0.46 = 2.0 m` *relative to each other* — against a 1.1 m lane spacing.
The cross-section is **sheared**, not leant.

Everything follows from that one shear:

- trestle branch tops land over the wrong lane (`nearestLane` is a plan-view
  question and the lanes have swapped order) — "carries only 3 of 4 lanes";
- a sleeper's gauge point measures to the wrong lane's rail — 0.53–0.57 m;
- duck bars and their supporting legs disagree;
- the two rings interleave, so `race-ring/rail-1` and `walk-past-ring/rail-1`
  share a plane (`check:coplanar` NEW seams).

**No map that displaces a point outward in proportion to its height can avoid
this** — that is the trap I circled three times. Applying the undulation along
the local up afterwards shears exactly the same amount, because the undulation
*is* the height difference. The only fix is a **rigid station frame**: at each
arc length the whole cross-section is rotated as one piece about the centre
line's own column.

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
