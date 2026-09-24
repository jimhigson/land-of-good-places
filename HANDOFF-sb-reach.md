# HANDOFF sb-reach (model: Claude Opus 5.5, chosen by the structural-backtrack engineer)

Task: anchor.reach:waterFight forces restarts (built extent > declared 19 m).

## Finding (09:30)
- Furthest lump is the water-gun rack in `src/minigames/waterFight/plot.ts`,
  placed at `door + (-2.6, -1.4)` (fixed world-axis offset). The door
  (`anchor.entrance`) is per-park: `parkLayout` puts it on the rect edge facing
  the park middle + 1.4 m stand-off, so its local distance ranges 12.4..17.7 m
  with bearing; the rack then lands up to ~20.6 m out, OUTSIDE the plot.
- Seed 14 r0 on this tree: rack at local 19.17 m (world 18.0 after the 20 deg lean).
- Plan: stand the rack inside the plot footprint by construction (inward from
  the door along its bearing, clamped into the rect), keep 19 m.
- Probe: scripts/probe-reach.mts (scratch, do not commit).
