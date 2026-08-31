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

*(Rest of the sweep filled in below as it lands.)*

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

## Open

- `test:procgen` on this branch — running; #427 left three known failures
  (seed 18 gate corridor, seed 5 lattice, seed 11 Sky Cruiser).
- An invariant for the new rule is still to be written — `test:procgen`
  already has `everyProvenBridgeSiteKeepsItsBridge`; the missing direction is
  *no bridge stands where no bridge was proven*, provable red with
  `LGP_ALLOW_UNPROVEN_BRIDGES=1`.
- `pnpm run check` full chain not yet run.
