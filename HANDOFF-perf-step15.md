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

## Review fix, 13 Nov 09:50 — check:reptile-house's light clause

- The HOUSEKEEPING clause was `lights >= 8`; the new rig holds 7, so it would have gone red. It is now two clauses: at least one non-point light and 1..`REPTILE_POINT_LIGHT_BUDGET` point lights under the hall root; and one painted pool per old light (`REPTILE_LIGHT_POOL_COUNT`), counted off the built mesh's vertex colours.
- Fast way to run the check without the 13-minute acceptance loop: `LGP_PARK_FILE=$PWD/.parks/dev/a3cae6cbe1c044a6/5/5.json node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/check-reptile-house.mts` (about 25 s). That park file was solved from an older source, so it is good for hall clauses only.
- Proved red against a fifth `PointLight` added after the constructor guard plus `spots.slice(1)` in `buildLightPools`: "8 lights under the hall root, 5 of them point lights (budget 4…)" and "5 painted light pools … 6 wanted". Restored; both green at 7/4 and 6/6.
- NOT MINE, STILL RED: the same run fails two other clauses — "doorframe.reptile/doorframe-reptile/doorframe-reptile (4.21 m tall) has no collider at (6.00, 18.20)" and its summary "69 tall drawn solids checked, 1 with no collider". The door frame comes from the base (#743, `src/art/models/doorFrames.ts`, `shell.ts`); this branch's diff against the base is lighting.ts, lightPools.ts, this file and the one check hunk. Not confirmed on a pure-base checkout.
