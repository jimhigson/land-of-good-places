# HANDOFF — the path router and the railway (#427's `poi.stranded: 20`, #414)

Branch `feat/rail-crossing-router`, stacked on
`origin/feat/railway-grown-from-a-crossing` (#427). Worktree
`.claude/worktrees/rail-crossing-router`. Dev server port 5431 if needed.

## THE BRIEF WAS BASED ON A DIAGNOSIS THAT DOES NOT HOLD — measured

I was sent to build "a leg that crosses the railway must route through a
planned crossing", on the #427 engineer's closing finding that
`spur-dodgems`, `spur-stall.dodgems` and `spur-stall.waterFight` *"cross the
railway where no crossing was planned"* and are sealed by `fence.ts`.

**They do not. Every drawn ribbon already crosses at a planned site.**

`scripts/probe-unplanned-crossings.mts` (new) walks every drawn ribbon's
**swept curve** — not the control polyline — records each rail-side flip and
tests it against `CROSSING_SITES`/`LEVEL_CROSSING_SITES` at `crossings.ts`'s
own `SITE_SNAP_TOLERANCE`:

```
4 planned crossings, 0 UNPLANNED, over 22 drawn routes
```

That is the seventh explanation to expire on this ticket, and it expired the
same way the other six did — to an instrument, not to an argument.

Why the router is already right: `streetLattice()` links nodes only when
`side[a] === side[b]`, and registers each `CROSSING_SITES`/
`LEVEL_CROSSING_SITES` entry as an explicit lattice edge via its feet.
`routeLeg` routes a straddling pair through a site. Crossing the rail off-plan
is already impossible by construction. **Nothing in `paths.ts` needed
changing, and nothing in `paths.ts` was changed.**

## THE REAL CAUSE — named by collider geometry

`scripts/probe-blocked-ribbons.mts` (new) walks the same ribbons with
`poiGraph`'s own clearance test (`PAVED_CLEARANCE` on paving, probe standing
at `bridgeHeightAt`) and names what stops each one. **Ten blocked stretches,
and not one is a fence panel** (fence panels are 2.6 m, `halfThickness` 0.18,
`top=Infinity`):

```
spur-dodgems, spur-stall.dodgems   railD 302-308
spur-stall.waterFight              railD 200-204
  blocked by walls len=2.0 halfT=0.15 top=2.8 3.5 3.7 4.4 5.2 5.3
```

2 m panels with *climbing* tops is a bridge ramp parapet. And:

```
crossings at railD  202, 234, 306, 336 — a bridge on every one
proven bridge sites    0, 234, 336
```

**Bridges stand at 202 and 306 — two `LEVEL_CROSSING_SITES` entries, ground
`crossingPlanSolve.ts` measured and rejected.** `bridgeFootprint.ts`'s late
`planReal` pass searches every crossing for a deck regardless of what the
planner proved, and where it finds one on unproven ground it builds ramps
nothing reserved room for. Their parapets then stand across the path that
crosses there. That is what severs the three spurs and strands the twenty
waypoints.

This is #414's step 2 exactly, arrived at independently from the other end.

## THE FIX

`LevelCrossing.provenBridgeSite` travels with the crossing, set in
`crossings.ts` at the point it already snaps to a site (`site.bridge`). False
for the level tier and for an unsnapped crossing measured off the drawn
paths. `planReal`'s sweep searches for a deck only where it is true.

**One constant, one owner, read where the answer is known.** The builder
cannot re-derive it: by the time `planReal` runs, the two site lists have been
collapsed into one `crossings` array.

`LGP_ALLOW_UNPROVEN_BRIDGES=1` restores the old behaviour exactly.

## MEASUREMENTS

Canonical seed, same geometry, gate on vs the reversal flag:

| | gate on | reversal flag |
|---|---|---|
| `check:park` | **exit 0, 229/229 waypoints** | `poi.stranded: 20`, exit 1 |
| blocked drawn ribbons | **1 of 22** | 10 of 22 |

The remaining one is `spur-building`'s last metre against an 18 m park wall at
railGap 30.7 — not the railway, and it strands nothing.

### `check:park` across all five CI seeds

Gate on vs the reversal flag (which is this branch's behaviour before the fix,
same geometry, same run):

| seed | gate on | reversal flag |
|---|---|---|
| canonical | **exit 0**, 229/229 | `poi.stranded: 20` |
| 2 | **exit 0**, 230/230 | `poi.stranded: 26` |
| 5 | `poi.stranded: 15`, 245/260 | `poi.stranded: 25` |
| 11 | **exit 0**, 226/226 | `poi.stranded: 15` |
| 18 | `route.crossesRail: 4`, **poi.stranded gone**, 225/225 | `poi.stranded: 38` + `route.crossesRail: 6` |

**Three of five seeds now pass `check:park` outright; none was passing before.**
`pnpm run check` only gates the canonical seed, and that is exit 0.

### Measurements 1, 3, 5 — the railway is untouched, and measured to be

The gate lives in `planReal`, which runs after the loop is solved, so it
cannot move the railway. Verified rather than asserted —
`measure-train-solve-budget.mts` is byte-identical to the #427 handoff's own
final table:

```
canonical  won #3   restarts 3   362 m   satisfied=true
2          won #17  restarts 95  259 m   satisfied=false  satisfyRejects=1
5          won #1   restarts 1   330 m   satisfied=true
11         won #0   restarts 0   334 m   satisfied=true
18         won #9   restarts 9   318 m   satisfied=true
5/5 seeds solved a train loop.
```

Measurement 2 (bridgeable pose counts) and measurement 4 (loops admitting a
bridge) both ask `crossingPlanSolve`, upstream of the gate, so they are
unchanged for the same structural reason.

### The router really is right on every seed, not just canonical

`probe-unplanned-crossings.mts`:

```
canonical  4 planned, 0 UNPLANNED, 22 routes
2          6 planned, 0 UNPLANNED, 23 routes
5          5 planned, 0 UNPLANNED, 26 routes
11, 18     0 UNPLANNED
```

### #396 — level-crossing walkability, with the gate on

The gate turns unproven-site bridges into level crossings, so this becomes
load-bearing. `measure-level-crossing-walkability.mts` (ported from #414)
asks the real `NavGrid`, built with `PLAYER_RADIUS` and `JUMP_APEX_HEIGHT`
exactly as `check-park.mts` builds it, of every crossing WITHOUT a bridge:

| seed | bridgeless crossings | walkable *through* |
|---|---|---|
| canonical | 2 | **2** — 16 m walk for a 16 m gap, 0.0 m from centre |
| 2 | 3 | **3** |
| 5 | 1 | **1** |
| 11 | 3 | **3** |
| 18 | 4 | **2** |

**11 of 13, and both failures are on seed 18**, which is #427's own known bad
seed:

```
d=62.8  at (-36.3, 3.9)  reachable only the long way round (149 m for a 16 m gap)
d=299.9 at (-0.2, 57.4)  A SIDE IS NOT STANDABLE
```

`d=299.9` is the gate-corridor crossing that #427 already has red in
`test:procgen`; this is the same defect seen from the other side, not a new one.

## `test:procgen` — 6 failed, and the split matters

Three are **#427's**, unchanged by this branch: seed 11 Sky Cruiser through
flower heads, seed 18 gate corridor crossing off-plan, seed 5 `gate-approach`
1.94 m off the 12 m lattice.

Three are **new, all on seed 2, and all one thing**: seed 2 proves **zero**
bridge sites, so with the gate on it builds zero bridges.

```
seed 2 > nothing a bridge builds hangs into its own tunnel
         -- no bridge was tested ... this invariant proved nothing
seed 2 > every modelled coping stone sits on the wall it caps
         -- no bridge coping was tested ... proved nothing
seed 2 > railway crossings are planned -- station-clear, and mostly real bridges
         -- the park has 3 railway crossing(s) and not one real bridge
```

Two are anti-vacuity guards firing correctly. The third is a **design**
assertion, and it is the honest one: the family's ruling is that a path
crosses the railway on a bridge.

**The two bridges seed 2 used to have were standing on ground the planner had
measured and rejected.** They were not a park that worked; they were the
failure being hidden. #427's own last measurement already names seed 2 as the
single seed whose loop admits no bridge at all (12/13, 92%) and says so:
*"there is nothing for the backstop to reject to. This is a property of seed
2's park."* This change makes that visible instead of papering it.

CLAUDE.md's rule is *"never weaken an assertion to make a seed pass — swap the
seed and write down why"*, and #414 reached the same fork. **Either swapping
seed 2 or closing #427's seed-2 hole is a decision above an engineer**, and
this branch does neither.

## #392 — not touched

#392 is two crossings too close for both to carry a bridge. The gate strictly
*reduces* the number of bridges built, so it can only reduce the chance of two
adjacent bridges fighting over the same ground. Nothing here leans on
`CROSSING_SITES` harder than before — `paths.ts` is unchanged.

## Why I built on #414's idea rather than beside it

#414's branch has the same mechanism (`d07beb97` + `a56db1b5`) but is 15
commits off `main` on a different base, carries `ONLY_PROVEN_BRIDGES` plus a
routeCurve ownership move plus two open reds of its own, and its
`test:procgen` is red on seed 2 (a park with zero bridges). Cherry-picking
that whole branch onto #427's — which has itself re-solved every seed's
railway — would have imported its open questions along with its fix. So the
mechanism is rebuilt minimally here, on #427's geometry, with its own
measurement. Sequencing the two is the Overseer's call; they do not conflict
in file terms beyond `crossings.ts`'s one new field.

## The invariant

`noBridgeStandsWhereNoneWasProven` — the converse of
`everyProvenBridgeSiteKeepsItsBridge`, and the direction that was missing.
Announces its own cover on stderr every run, so a seed with no bridges cannot
read as "every bridge checked".

Proved red by mutation, against this branch's head geometry (canonical loop
361.8 m, proven sites 0/234/336, level sites 70/116/166/202/306):

```
LGP_ALLOW_UNPROVEN_BRIDGES=1 pnpm exec vitest run \
  test/procgen/seed-canonical.test.ts -t 'no bridge stands'

FAIL: a bridge deck stands over the crossing at (29.0, -32.6), railDistance
202.0, which is not one of the 3 site(s) the crossing planner proved a bridge
fits on (0.0, 234.0, 336.0)
```

Green without the flag.

## Still open, for whoever is next

- **Seed 2 has no bridges.** The decision above. Nothing else on this branch
  is blocked by it.
- **Seed 5 keeps 15 stranded waypoints** (down from 25). Different cause, and
  measured: `probe-blocked-ribbons` on seed 5 finds ramp parapets on
  **proven** sites (railD 13.7, 53.5, 139.6, 144.2 against proven sites 12,
  56, 142) cutting *foreign* legs — `spur-dodgems`, `spur-waterFight`,
  `connector-dodgems-stall.dodgems`. That is #414's **step 1** territory
  ("paths must keep off the ground a bridge will stand on"), which exists on
  this branch as `segmentCutsABridgeRamp` but screens lattice edges only, not
  a spur's own ribbon. Also on seed 5:
  `connector-stall.facePaint-station-0` is cut by a real **fence panel**
  (2.6 m, halfT 0.18, top=Infinity) at railD 68.7, railGap 2.1 — a ribbon
  drawn along the fence rather than across it, a third and separate defect.
- **#396.** The measurement is here and it is 11/13; the *invariant* is not.
  Recommendation: it is a follow-up, not this PR. Its two failures are both
  seed 18's, both already red in `test:procgen` for #427's own reasons, and
  writing the assertion now would land a fourth red on a branch that already
  has a decision pending. The instrument to write it with is on this branch.
