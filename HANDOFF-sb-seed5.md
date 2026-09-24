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
