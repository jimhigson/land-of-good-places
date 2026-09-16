# HANDOFF — slide altitude (#645)

Branch `fix/slide-altitude` off `origin/feat/sphere-combined`; PR targets that.

Done:
- `theGinormousSlideNeverClimbs` (test/procgen/invariants.ts): rise = built-chute step · Geo.up at midpoint, SLIDE_MAY_RISE tolerance. World-y clause 1 removed from `theGinormousSlideIsRideable`. Prints local steepest (2 m window) to stderr. RED on all 5 seeds before the fix (transcripts in the PR body).
- solve.ts `heightAt` now smoothsteps a *radius from planet centre* (`worldYAtRadius`, new in geo/ground.ts) from `startRadiusFor` (max radius of the flat-START_Y stub's two ends — keeps seed 11's battlement air) to `END_RADIUS` (0.9 m altitude at pit centre). Stub level at that radius too.
- `clearsTowers`: a plinth-standing tower reaches down to the ground (seed 131 ran through tower-body-1's foot otherwise).
- Mutant (world-y profile restored) → red on 326.

Base reds that remain (same names as base CI run 35099046838): 326 & 24 tower-roofs clip, 131 roof garden. Castle rigid transform (#650) is their owner.

Later:
- cameras.ts: trackside elevation capped at 90° (canonical beat 3 had tipped to 117° onto the near rail once its route changed).
- Final test:procgen: 79 failed vs base CI 80 (run 35099046838), by name: 0 new, 1 fixed (canonical world-y "goes downhill" clause).
- Local steepest (2 m window): canonical 27.2°, 131 27.7°, 24 23.3°, 11 15.2°, 326 14.3°.
- Ran green: tsc, typecheck:test, check:slide-rider, pet-slide, ride-camera, park-boot, solve-cost, castle-towers, park, flat-primitives. Full `check` left to CI.
- PR open against feat/sphere-combined.
