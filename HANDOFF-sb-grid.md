# HANDOFF: sb-grid (model: Claude Opus 5.5, chosen by the structural-backtrack engineer)

Task: stagger waiting Rail Race riders so neighbours' heads/hair do not
interpenetrate at rest (the seed-9 `hair.shell.crop | torso` coplanar finding is
Otto's hair against Nell's torso in the next cart; see fix/sb-hair handoff).

## Done (commit e2084649)
- simulate.ts: `GRID_SETBACK_AT_PARK_SCALE = sqrt(CHILD_FOOTPRINT^2 - LANE_SPACING^2)`
  = 1.425 m; `gridSetback(lane, scale)` sets back lanes of odd distance from
  PLAYER_LANE (lanes 2 and 0), player on front row; `riderOnGrid(lane, scale)`
  starts `travelled` at -setback. Used by RailRace (build, requestBoard with the
  race ring's scale, arrive with the walk-past scale) and simulateField.
- simulateField got an optional read-only `observe` callback (for the mid-race
  measurement).

## Measured (probes in scratchpad sb-hair/_probe-grid.mts, _probe-level.mts)
- Control, grid off, seed 9: 3179 neighbour vertices inside neighbour meshes.
- Grid on, seeds 0-9 so far: 0 inside; closest approach 181 mm (seed 1).

## Left
- seeds 10-15 of the grid probe, mid-race numbers, check:coplanar,
  check:rail-race seeds 0,5,9,14, tsc both, revert proof.
