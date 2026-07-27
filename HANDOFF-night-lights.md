# Handoff — night lights (branch `night-lights`)

Worktree: `.claude/worktrees/night-lights`. Branched from `origin/main` @ f013e08.
**Status: complete, PR raised, not merged.** Build passes (`npm run build`, exit 0).

## The task
Family, in their words: night is still too dark; more lights; strings of lights
between trees, **procedurally generated from where the trees actually are**;
fireflies at night. Plus a late addition asked to be tried **first**: "pale and
dim moon light at night as the moon moves over the sky".

## What landed

| commit | what |
| --- | --- |
| `7d992c7` | Moonlight. `DayNight` split into sun-only `keyLight` + new `moonLight`. |
| `652052e` | `src/world/TreeLights.ts` — procedural garlands between trees. |
| `1950e30` | `src/world/Fireflies.ts` — 12 knots of 7, drifting, night-only. |
| `4322d4c` | Mirrored the sun/moon crossfade so dawn and dusk do not dip. |
| `99df044` | `LampPosts` per-frame array allocation removed (GC list). |

## Findings worth keeping

- **The park already had a moon light and nobody knew.** `DayNight.applyLook`
  used to `negate()` the sun direction below the horizon, so the key light
  *was* the moon. Two problems: the flip was instantaneous at
  `sunDirection.y === 0` at intensity ~1.1, so every shadow swung across the
  park in one frame; and sun and moon shared `SkyKey.sunIntensity`, so the moon
  could not be brightened without brightening sunset.
- **Toggling `light.castShadow` or `light.visible` recompiles every material**
  — three.js's program cache key includes `numDirLights` /
  `numDirLightShadows`. `shadow.autoUpdate = false` skips the shadow *pass*
  without touching either count, which is how the sun's shadow map is now
  frozen all night for free. Guard it with `|| light.shadow.map === null` or
  the first frame samples a render target that was never created.
- **Cross-fading two lights needs mirrored windows.** Two narrow offset
  smoothsteps left a hole at sunrise/sunset where neither light contributed.
  `moonUp = 1 - sunUp`.
- `Scenery.foliageOccluders` is the canonical "where the trees actually are".
- `TrainRoute` is solvable-then-queryable, so "keep off the railway" can be a
  real geometric test rather than a radius constant — which is why `TreeLights`
  is constructed **after** `ParkTrain` in `World`.

## Measured (headless, not seen running)

- Lights around the clock: total directional is monotone — 0.62 all night,
  0.85 at sunrise, 1.75 at noon. vs `main`, night is +82% key, +216% fill,
  +19% hemisphere.
- Garlands: 51 eligible trees → **26 strings, 170 bulbs, 196 wire segments**,
  lowest point of any wire exactly 3.1 m over the ground (headroom fit
  binding, as intended). Two draw calls. Zero new real lights.
- Fireflies: 84, in 12 knots. One draw call. Zero allocation per frame.

## How the headless measuring was done (deleted; recreate if needed)

`vite build --ssr` a throwaway entry under `.probe/` that imports the real
classes, then run the bundle in node with a Proxy-based 2D-canvas stub
(`textures.ts` needs `document.createElement('canvas')`). Nothing else is
required — none of this code touches WebGL at construction.

## Still to do — not code

**Visual QA. Nothing here has been seen running** (this agent did not own the
shared Chrome profile). See the PR body for the exact list.
