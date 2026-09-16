# HANDOFF — slide altitude (#645)

Branch `fix/slide-altitude` off `origin/feat/sphere-combined`; PR targets that.

- Step 1: added `theGinormousSlideNeverClimbs` (test/procgen/invariants.ts) — rise = step · Geo.up at midpoint; removed world-y clause 1 from `theGinormousSlideIsRideable`. Prints local steepest to stderr.
- Next: prove red per seed, then convert `heightAt` in src/world/slide/solve.ts to a profile in radius / altitude.
