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
