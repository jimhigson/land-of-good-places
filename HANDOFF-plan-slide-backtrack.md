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

## Done (pushed)
- `solve.ts`: `DOOR_OFFER_CENTRES` [9.5, 6, 3, 0, -3, -6, -9.5]; `doorStubIsClear`
  prunes offers before search; `SLIDE_ATTEMPTS` (door x length); `solveSlide()`
  returns `SlideRefusal`; `planSlide()` throws its message (SLIDE_PLAN has 27 readers).
- `parkGeneration.ts` walks `SLIDE_ATTEMPTS`.
- Invariant clause 4 in `theGinormousSlideLeavesOverTheBattlements`: crossing within wall span.

## Proof
- Chute SHA identical base vs branch on all 10 pool seeds (base, vertical towers).
- Repro (base+bend-exteriors, scale 1): 326 builds 74.56 m from door 6 in 9.3 s
  (was: throw after 71 s); 451 builds 59.15 m in 35.7 s (was: throw after 147 s).
- Mutation A (one door, no prune) on repro 326: REFUSED, no throw, same stub blocker.
- Mutation B (no prune): same 74.56 m route, 45.8 s — prune is speed only.
- seed-326 procgen: base 17F/76P/0S; branch identical fail names; repro+fix
  17F/77P (94): "slide does not clip the castle towers" now passes.
- New clause red at halfX-10: "crosses at world x -40.92, 8.61 m past the end...".
- check:park-boot green on branch (canonical) and on repro LGP_SEED=326 (74.5629 m both cadences).
- test:procgen full: base and branch both 85F/575P/0S, identical failing names, 51 s.
- pnpm run check: stops at check:rail-race (step 49), red with the same 17 FAILs on base.
  Every step before it passed, including slide-rider, pet-slide, park, castle-towers, solve-cost.
- Scratch worktrees removed; repro is `git merge origin/eng/bend-exteriors` onto base (only package.json conflicts, take ours).
