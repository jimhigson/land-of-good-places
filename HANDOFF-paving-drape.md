# HANDOFF: paving-drape (fix/paving-drape, base feat/procgen-on-sphere)

Task: paving draped onto a bridge a path only crosses (seed 131, bridge at (-2.2,40.3)) → 4.4 m sheets.

## Findings
- `drapePathsOverBridges` lifts every vertex inside ANY bridge's drawn stone, whatever route it belongs to.
- Seed 131: `gate-approach` authored corridor (0,54)->(0,30) runs through site (-2.2,40.3)'s footprint
  (bridge axis along x); `gateCorridorDeepestMouth` only checks rail side/standoff, never bridge sites.
- Seed 131 also: gate-approach joins bridge (24.3,-20.5) from its side at (29.3,-19)->(28.1,-22.3), walks to far foot, about-turns.
- Invariant `noDrawnPavingStandsUpAsASheet` (edges rising > BUILDING_STEP_UP at grade > SPRINT_LOCAL_GRADE_CEILING,
  altitudeAt-based). Red on 131 at base e982430b: 8 places incl. (1.6,42.8) 4.48 m, (27.6,-18.7) 4.31 m.
- Scratch dir: /private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/paving-drape/

## Next
- classify each red place; fix router; sweep 0..199.
