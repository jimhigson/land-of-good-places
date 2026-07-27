# Handoff — bigger night-light pools (branch `bigger-light-pools`)

Worktree: `.claude/worktrees/bigger-pools`. Branched from `origin/main` @ dd68361.
**Status: complete, PR raised, not merged.** `npm run build` passes, exit 0.

Follow-up to the merged night-lighting work. Request: *"the area of impact of
the nighttime lights needs to be about three times greater in radius."*

## The formula everything here turns on

three.js `PointLight`, confirmed in
`node_modules/three/src/renderers/shaders/ShaderChunk/lights_pars_begin.glsl.js`:

    E = intensity / max(d^decay, 0.01)  x  (1 - (d/distance)^4)^2

`distance` is **only a hard outer edge**. At a decay of 1.6-2.0 the `1/d^decay`
term reaches nothing well inside it, so tripling `distance` alone changes
nothing visible. Raising `intensity` at fixed decay does treble the radius —
`R ∝ (intensity/threshold)^(1/decay)`, so `3^1.8 ≈ 7.2x` — but the same 7.2x
lands directly under the lamp and blows it out.

**Lower the decay; solve the intensity to hold the near field.** That spreads
the light the lamp already has over a bigger area, which is what a wider pool
physically is.

## Numbers that landed

| | intensity | decay | distance | pool radius | real lights |
| --- | --- | --- | --- | --- | --- |
| LampPosts | 9 → 3.48 | 1.8 → 1.0 | 10 → 30 | 6.9 → 20.5 m | 3 → **5** |
| FairyLights | 11 → 5.69 | 1.6 → 1.0 | 21 → 63 | 13.8 → 39.8 m | 5 → **3** |
| Fountain | 6 → 5.23 | 2.0 → 1.25 | 9 → 27 | 6.0 → 17.4 m | 1 |

Park total point lights: **9 before, 9 after.** Ratio holds 2.9–3.1x at every
threshold tested (0.20 / 0.10 / 0.05 / 0.02 of night ambient).
`groundGlow` plane 4.2 → 12.6 m, lifted 0.03 → 0.25 m.

## Two knobs, for whoever retunes this next

1. **Scaling `intensity` and `distance` by the same factor `k` scales the pool
   by `k`.** At decay exactly 1.0 this is algebraically exact:
   `E(kd; kI, kD) = E(d; I, D)`. Verified: k = 0.5 / 0.67 / 1.0 / 1.33 gives
   9.9 / 13.5 / 20.5 / 27.5 m. So if 3x turns out to be too much, multiply both
   numbers on each light by the fraction you want and nothing else changes.
   **Do not scale intensity alone** — the cutoff window compresses the tail, so
   halving it gives 0.72x radius, not 0.5x.
2. Rule of thumb once intensity is solved for the near field:
   **pool radius ≈ 0.65 × `distance`.** (0.68 / 0.63 / 0.64 for the three.)

`MOON_INTENSITY` in `DayNight.ts` deliberately **not touched** — instructed.

## Findings worth keeping

- **A light must not depend on its slot in a reassignable pool.** Point lights
  are summed in the shader, so a pure permutation of which slot holds which
  lamp is invisible — but `LampPosts` keyed its flicker to the slot index, so a
  lamp changing slots changed brightness in one frame. Measured jump 0.83.
  Pre-existing on main; keyed to the lamp now.
- **Exact hand-over continuity, for free.** Fade each light on how far *its own
  lamp* is from the player, reaching zero at the boundary (the distance to the
  furthest lamp currently holding a light). The two lamps swapping places are
  by definition equidistant at the moment they swap, so the outgoing light is
  always at exactly zero. Works at any lamp spacing, costs no lights.
- **A flat glow plane on a heightfield has a size limit.** Within 2.1 m the
  ground rose at most 0.04 m above a lamp's base; within 6.3 m it rises 0.13 m
  at 10 of the 13 lamps, which buries the disc and clips it to a hard line.
  Draping would look better but ends the single instanced draw call.
- Measured worst single-frame illumination change over a full lap of the ring
  road, 48 probe points: **0.0114** (~1% of night ambient).

## How the measuring was done (probe deleted; recreate if needed)

`vite build --ssr` a throwaway entry under `.probe/` importing the real
classes, run under node with a Proxy-based 2D-canvas stub (`textures.ts` needs
`document.createElement('canvas')`). Re-implement three.js's falloff in the
probe to measure what the shader will actually do. Analysis scripts were plain
Python against the same formula.

## ⚠️ Not seen running

Another agent owns the browser. See the PR for the QA list — the headline item
is whether midnight is now too bright (see the PR's washout table).
