# HANDOFF — plan-slide-backtrack

Model: Claude Opus 5 (1M), chosen by the Overseer. Branch `eng/plan-slide-backtrack`
off `origin/eng/sphere-ground-claims`. Worktree `.claude/worktrees/plan-slide-backtrack`.
Scratch repro worktree `.claude/worktrees/plan-slide-repro` (branch
`scratch/plan-slide-repro`, never pushed) = base + uncommitted merge of
`origin/eng/bend-exteriors` (the leaning TowerSolid), scale 1 kept.

## Findings (measured)

- On the base as given, **seed 326 builds** (74.00 m, 17 s). The leaning
  `TowerSolid` lives on `eng/bend-exteriors` (PR #624), which is at scale 2.3355.
- Base + bend-exteriors merged at scale 1: 326 **throws** (tower at
  (-42.0, 8.2, -4.5), all 10 rungs, 71 s); 451 throws (cruiser 0.39 m at
  (-68.1, -2.0, -22.3), 147 s).
- Root: the complaint point is the **door stub**, fixed by the start pose alone,
  so no length can move it. The door is placed by flat translation
  (`BUILDING_CENTRE_X + DOOR_OFFER_CENTRE`, `START_Y` a world y) while the castle
  leans 13.71 deg on 326: real wall top at local (9.5, 9.85, 9) is world
  (-43.57, 6.07, -4.66), the flat formula says (-40.92, 3.65, -3.98). The flat
  door lands in `tower-roof-3`'s cone (-0.18 m outside distance, needs 1.45).
- Experiment (repro): DOOR_OFFER_CENTRE 6 / 3 / 0 / -4 / -9.5 all solve 326 at
  rungs 60-62: 74.56 / 65.58 / 61.06 / 54.32 / 54.74 m, ~10 s each.

## Plan
1. Door position along the wall becomes a backtracked decision (9.5 first, so
   seeds that solve today are unchanged).
2. Prune door offers whose stub fouls a tower/cruiser before any search.
3. `solveSlide()` returns a refusal instead of throwing.
