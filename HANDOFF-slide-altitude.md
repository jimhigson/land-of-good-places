# HANDOFF — slide altitude (#645)

Branch `fix/slide-altitude` off `origin/feat/sphere-combined`; PR targets that.

Done:
- `theGinormousSlideNeverClimbs` (test/procgen/invariants.ts): rise = built-chute step · Geo.up at midpoint, SLIDE_MAY_RISE tolerance. World-y clause 1 removed from `theGinormousSlideIsRideable`. Prints local steepest (2 m window) to stderr. RED on all 5 seeds before the fix (transcripts in the PR body).
- solve.ts `heightAt` now smoothsteps a *radius from planet centre* (`worldYAtRadius`, new in geo/ground.ts) from `startRadiusFor` (max radius of the flat-START_Y stub's two ends — keeps seed 11's battlement air) to `END_RADIUS` (0.9 m altitude at pit centre). Stub level at that radius too.
- `clearsTowers`: a plinth-standing tower reaches down to the ground (seed 131 ran through tower-body-1's foot otherwise).
- Mutant (world-y profile restored) → red on 326.

Base reds that remain (same names as base CI run 35099046838): 326 & 24 tower-roofs clip, 131 roof garden. Castle rigid transform (#650) is their owner.
