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

## Result on `test:procgen`

Name-diffed against the branch point, never counted:

```
base ae20b9fc   55 failed | 636 passed (691)
now             25 failed | 666 passed (691)
FIXED 30    NEW 0
```

All 30 are the rail-race cluster, every seed: trestles carry all four tracks,
sleepers bridge both rails, rings stand outside the park, racers meet the same
number of bars, bars stand over a real leg, bars slow you where they stand.

### Still red, and why each is not this ticket's geometry

- `the Rail Race finish rainbow stands on the ground`, **seed 326 only** — a
  real defect, and it is in the **path router**, not in the ring. `paths.ts`
  already treats every arch foot as a blocker of radius
  `foot.radius + ARCH_FOOT_MARGIN` = 0.275 + 4.29 = **4.57 m**, and the drawn
  legs agree with `archFeet`'s claimed positions to the centimetre (measured;
  `scripts/_probe-rainbow.mts`). Yet path **run 22** — the last-but-one route
  drawn — puts its centreline **2.08 m** from a foot, half-width 1.30, so
  0.78 m of clear ground where `WALKABLE_GAP` wants 1.24. Six inner legs, all
  against the same run. So either that route does not consult `blockersNow()`,
  or the driver re-decided the rings after the paving went down and the arch
  moved under it. Both live in `paths.ts`/`parkSolve.ts`.
  `scripts/_probe-arch-path.mts` names the run.
- `every support meets the track it carries` / `the Sky Cruiser stands on its
  own supports` (all 5 seeds), `the park gate arch stands over its gateway`
  (all 5), coping stones, slide vs towers/roof, paved detour, bushes count,
  bridge mid-air path — all present at the branch point, none touched here.
  **The two Sky Cruiser ones look like this ticket's disease in another ride**
  (a pylon "2.49–3.77 m from the middle of the track" is the right order for a
  lean read as an error out at that radius); worth pointing whoever owns the
  cruiser at `RailRaceRoute.lean`/`unlean` before they start.

## Status


- [x] baseline `test:procgen` captured, failures named
- [x] root cause measured, both defects
- [x] rigid station frame in `route.ts` (`lean`/`unlean`/`stationOf`/`chartOf`)
- [x] `leanTrestleTree` follows; feet still land on the terrain (0.0000 m)
- [x] every rail-race instrument asks in a frame that exists
- [x] `test:procgen` re-run and name-diffed: 30 fixed, 0 new
- [x] `check:coplanar` 23 -> **11** (its own headline line, counted three ways)
- [x] `check:park` green on 20260728, 11, 24, 451
- [x] `pnpm run build` exit 0
- [x] controls recorded for every changed clause
- [x] all 67 `check` steps run individually and each failure classified
      against the branch point in `.claude/worktrees/railrace-base`
- [ ] `RIDE_SCALE` TDZ crash (below) — fixing



## `check:coplanar`

Counted three ways, because the `NEW:` lines are **indented two spaces** and
`grep -c "^NEW:"` returns 0 on a log full of them:

```
grep -cE "^  (NEW|WORSE|MORE|TIGHTER):"   11
grep -cE   "(NEW|WORSE|MORE|TIGHTER):"    11
the script's own headline                 11      (was 20 before the rainbow fix)
```

Fixed here: the two `race-ring/rail-N | walk-past-ring/rail-N` seams (the two
rings were geometrically on top of each other), and **nine**
`finish-rainbow-leg-*` pairs. All five stale baseline entries deleted; the
check confirms none is still LOOSE.

**Still red, and only two of them are rail-race:**

| finding | mine? |
|---|---|
| `TIGHTER race-ring/trestle-branches-lower\|upper` | **yes** |
| `MORE walk-past-ring/<Mesh:BoxGeometry>\|duck-bars` | **yes** |
| `WORSE stall:dodgems`, `WORSE stall:railRacer` | no — stall geometry |
| `NEW path-kerb\|path-surface`, `NEW fountain\|path-surface` | no — paving |
| `NEW stone-walls\|stone-walls` | no — scenery |
| `NEW entrance-gateway-path\|entrance-road-kerb` | no — entrance |
| `NEW entrance-door-left/right\|terrain` ×2 | no — hotel |
| `MORE keychain.rumi sphere\|sphere` | no — keychain |

The two that are mine, with what I would do and why I stopped short:

- **`trestle-branches-lower|upper`**, baseline `area 0.0010, seams 9,
  fighting: false`, now fighting at **7.6e-5 m**. The lower branch's top cap
  and the upper's bottom cap meet exactly at the fork node; with the shear
  gone they now close flush instead of missing. Both caps are buried inside
  the joint, so the fix is to delete them — draw the branches open-ended and
  close the fork with a ball joint, which ART_DIRECTION would prefer anyway.
  That adds a visible piece of geometry to every trestle, so it is Jim's call,
  and I could not QA it in a browser.
- **`walk-past-ring/<Mesh:BoxGeometry>|duck-bars`**, baseline
  `area 0.4400, seams 1`, now **4 seams**. The box is the duck bar's alert
  **sleeve** — a second mesh wrapped round the bar so `setAlerts` can recolour
  it every frame. Its faces tie with the bar's. The count went 1 -> 4 because
  the ring now builds a different set of bars, not because a new kind of fault
  appeared. The real fix is CLAUDE.md's own rule for an appliqué — put the
  stripe in the bar's own UV space instead of a second mesh — which changes
  how the duck-bar warning is drawn, and that warning is gameplay-critical.

## `pnpm run check` — every step run, every failure classified

`check` stops at its first failure, so all 67 steps were run individually and
each red was re-run at the branch point (`ae20b9fc`) in a detached worktree.

| step | branch | base | verdict |
|---|---|---|---|
| `check:slide-rider` | FAIL | FAIL | **identical text**, same 0.13% on beat 1 frame 240 |
| `check:waypoints` | FAIL | FAIL | output diff is one timing line; the message itself reads `x NaN..NaN` |
| `check:cart-shape` | FAIL | FAIL | same crash, differs only by worktree path |
| `check:ground-claims` | FAIL | FAIL | same crash |
| `check:layout-rung` | FAIL | FAIL | identical |
| `check:arrival-camera` | FAIL | FAIL | same crash |
| the other 61 | PASS | — | |

**Three of those are one bug, and it is in this slice**: `railRace/hazards.ts`
reads `RIDE_SCALE` from `route.ts` at module scope inside an import cycle, so
`DUCK_CLEARANCE` throws `Cannot access 'RIDE_SCALE' before initialization`
and takes `check:cart-shape`, `check:ground-claims` and `check:arrival-camera`
down outright. Exactly the module-scope trap `HANDOFF-backtracking.md`
documents. Fixing it here.

`check:waypoints`'s message printing `x NaN..NaN` is worth somebody's
attention on its own terms — a check describing a facade whose bounds do not
exist — but it is the castle's, not the rail race's.
