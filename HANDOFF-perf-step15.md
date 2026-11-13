# HANDOFF — perf step 15: Reptile House light budget

Plan: `docs/perf/FRAME-DROPS-2026-11.md` on `origin/perf/frame-drops-2026-11`, item 9.
Branch `perf-step15-reptile-lights`, worktree `.claude/worktrees/perf-step15`. No PR of its own: the
integrator merges it into `perf/120fps`. `origin/perf/120fps-base` is merged in.

## Done
- `src/world/reptileHouse/lighting.ts`: hall point lights 8 -> 4 (two warm fills, pink nursery lamp,
  blue grotto mist) + a warm `AmbientLight`. The constructor counts and throws past
  `REPTILE_POINT_LIGHT_BUDGET` (4).
- `src/world/reptileHouse/lightPools.ts` (new): six additive vertex-coloured gradient discs on the floor
  where the six pools hung — one mesh, one draw call, raycast-opaque to nothing (opts out of raycasts).
- Fit: two fills at (-9, 10, -3) and (11, 10, 3), intensity 6.5, distance 40, ambient 0.19 — least
  squares against the six pools through the toon ramp, 0.17 RMS on a mean of 0.67.

## Counted (seed 5, headless Chromium, 1280x800, `/reptile-house`)
- Visible point lights in the scene: 11 -> 7. Of those, the hall's: 8 -> 4.
- **The other 3 are park lights at intensity 0 that stay `visible` indoors**: `fountain`,
  `prop.ferrisWheel`, `train-locomotive`. three.js still loops over them. Not this package's files.
  Hiding them while she is in a far interior takes the hall to 4.
- Shader programs 54 -> 55 (the pools' basic material). Draw calls +1, triangles +1512.

## Not done
- No GPU timing (shared Mac). No walk A/B for GPU-bound drops.
- `lighting.ts` is in the park source hash's closure, so the hash moved and CI re-solves the parks.
- `check:reptile-house`, `check:coplanar` not completed here — see the result note.
