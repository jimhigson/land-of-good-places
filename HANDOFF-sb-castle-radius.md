# sb-castle-radius — anchor.reach measures drawn extent; castle radius derived

**Model: Claude Opus 5.5**, chosen by the structural-backtrack engineer. A replacement runs the same model.

Branch `fix/sb-castle-radius` off `origin/wip/sb-merge`. Worktree `.claude/worktrees/sb-castle-radius`.
Do NOT run `accept:parks` (the coordinator does, once, after merging).

## Task
1. `anchor.reach` (scripts/lib/parkFindings.mts) measured lump CENTRES; make it measure drawn extent
   (every vertex) in the plan frame; prove red on the castle.
2. Castle `boundingRadius` 19.3 typed in parkManifest.ts; derive from the castle's geometry owner.
3. Audit every anchor over seeds 0..15; RATCHET anchor.reach entries end at 0.

## Findings so far
- Seed 4 restart 3, vertex reach: castle plot-local 21.55 m (tower-roofs, the cone ring at y 10.6),
  world-XZ 20.53. Declared 19.3. = nudge 3.54 + turret corner hypot(12.225, 9.225)=15.315 + roof radius 2.45
  = 21.305, plus lean. Castle is axis-aligned (Frame.fromBearing(..., 0)), nudge direction varies with
  placement bearing, so the worst case over placements is the plain sum.
- Plan frame chosen: radial projection onto the sphere (vertex xz * R/|v - C|, C = (0,-R,0)) — the
  inverse of placeOnSphere: a thing's plan (x,z) is the foot of the up-line through it, which is what a
  tree's foot is compared against.
- Probe: scratchpad `probe-reach.mts`; sweep of 16 seeds in `sweep.txt` there.
