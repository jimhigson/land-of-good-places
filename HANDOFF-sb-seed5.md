# HANDOFF sb-seed5

Model: Claude Opus 5.5 (chosen by the structural-backtrack engineer). Branch
`fix/sb-seed5` off `origin/wip/sb-merge`. Scope: seeds 0..15 only, each at its
recorded restart (`src/world/acceptedRestarts.ts`).

Tasks: seed 5 failures of `check:castle-towers` and `check:tie-frame` /
`check:rail-race` (Sky Cruiser cart 1.11 deg off rails). Decide geometry vs
decision by measurement; fix at cause or make an acceptance measure.

## Findings

- castle-towers, seed 5 r0 on this branch: NOT the reported 0.13 m. Fails the
  doorway clause instead: straight march out from `frontDoor` stops 18.18 m
  short. Investigating what blocks it.
- Merged origin/wip/sb-merge (seeds 0..15 only). Partial castle-towers sweep
  at recorded restarts: 0r2 ok, 1r6 ok, 2r0 FAIL (door march 18.67 m short),
  3r0 ok, 4r2 FAIL (tower-body-2: child 0.11 m inside stone, 2.73 vs 2.83 m).
  Machine load ~20: a seed takes 2-5 min (train solve 145 s on 0r2).
- Door clause cause (diag scripts/_diag-door.mts, untracked): the march starts
  20 m out on the lawn; on 2r0 it stalls at (-42.64, 48.48) on a scatter wall
  (-35.5,47.6)-(-43.7,47.6) top 0.8 + a 0.28 m circle, ~25 m from the building
  anchor, outside its 19.3 m boundingRadius. Instrument bug: it measures lawn
  furniture a child walks round, not the door. Door reachability from the
  entrance is already check:park `route.unreachable` (frontDoor is a
  destination). Plan: start the march at the edge of the castle's own anchor
  boundingRadius (scatter keeps out of it), along the zone->stand line.
- Tower clause cause (seed 4 r2): lamp (14.19,-35.19) r0.22 stands 1.13 m
  from tower-body-2 stone (pinch < 1.24 m child). resolve's 2 sequential
  passes leave her 0.11 m in the stone. Offline repro: dump colliders
  (scripts/_diag-dump.mts) + replay (scripts/_diag-replay.mts, <1 s).
  More passes converge slowly (16 passes: 4 cm). FIX (committed): pinch
  guard in resolveMovement — refuse a sub-step that ends deeper in solid than
  it began (deepestSolidOverlap + contactWith one-owner helper). Replay: 0.000.
  Side finding, NOT fixed: castle drawn reach from building anchor (20.87 m
  on 4r2, turret + 3.54 m nudge) exceeds declared boundingRadius 19.3;
  anchor.reach measures lump centres, not extents. Fixing changes all parks.
- Door clause FIX (committed): march starts at building boundingRadius on
  the zone->stand line.
- NEXT: sweep castle-towers (ct2), prove door clause red by mutation, then
  tie-frame / rail-race on 5r0 and 5r2. resolveMovement change touches
  playerSim-based checks (nav-routes, hotel, benches, hall-solid) and march
  invariants: run them.
- ct2 sweep (pinch guard + bounding-circle door start): 16/17 green; 1r6 red
  0.63 m — blind straight march grazed a slide leg (r0.42 at -35.0,58.1) and
  drifted. FIX (committed): marchTo re-aims each stride. Offline replay 1r6:
  0.000; mutation disc r2.6 in doorway -> 4.58 short (red). Real red run +
  clean 1r6 run in progress (ct-1-6*.log in scratch).
