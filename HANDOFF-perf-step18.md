# Handoff: perf step 18 (allocation-free hot paths, #763) — branch perf-step18-alloc

One of 12 packages for perf/120fps; no PR from this branch, the integrator merges it.

## Done (pushed, origin/perf/120fps-base merged in)
- `src/world/building/SlideRide.ts`: the see-through chute is two single-sided meshes
  over one geometry (BackSide `-chute-clear-far` created first, FrontSide `-chute-clear`)
  instead of one transparent DoubleSide mesh, which three.js re-validates twice a frame (#763).
  Same two programs, same order (equal depth sorts by object id).
- `src/art/models/snake.ts`: `sampleSpine` (exported) replaces getPointAt + getTangentAt
  with scratch targets; a snake with no `crawl` caches its segments' points/tangents once.
- `scripts/check-hot-path-churn.mts` + `check:hot-path-churn` script entry (NOT in a shard).

## Measured (Node, counts): see the check's stderr lines. Proved red by restoring
`side: DoubleSide` and the old getPointAt/getTangentAt lines, and by TANGENT_STEP 0.0002.

## Not done / unproven
- No browser measurement at all: no dev park could be solved in the time-box (load 34,
  seed 5 takes ~30 min). MB/s before/after, material updates/s on /slide and /rail-race,
  and a before/after screenshot of the chute are all unmeasured.
- check:slide-rider, check:pet-slide, check:reptile-house not run (each needs an accepted park).
- Not touched: banquet update body (no allocation of its own on main), reptile GLASS
  (`exhibits.ts:160`, DoubleSide — check whether it is transparent two-pass), BallPit wall,
  tortoiseRide/exhibits getPointAt (already pass targets), plan item 13 (stride loop: plan
  itself measures it as not the cost; its fix is step 1b, NavGrid's package).
