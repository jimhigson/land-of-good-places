# Handoff — Reptile House, `noodle` kit (3D Artist)

**Model: Fable (claude-fable-5-1), chosen by the Overseer's workflow; a
replacement must run the same.** Branch `feat/reptile-house-art-noodle`, off
`origin/feat/reptile-house`. Worktree
`.claude/worktrees/reptile-art-noodle`.

## State

Done and pushed: `art/blend/reptile_noodle_{build,export,render}.py`,
`art/blend/reptile_noodle.blend` (generated), `src/art/assets/reptileNoodle.glb`
+ `reptileNoodleGlb.ts`, `scripts/pack-reptile-noodle-asset.mts`,
`package.json` scripts `blend:reptile-noodle` / `pack:reptile-noodle` /
`render:reptile-noodle`, renders in `art/renders/reptile-noodle/`.

`pnpm run blend:reptile-noodle` is the whole chain; `pnpm run
render:reptile-noodle` the previews (`NOODLE_RENDER_DIR=…` to render elsewhere).

Not done, by instruction: `ASSET_MANIFEST.md` row (returned to the integrator
as text), the loader `src/art/models/reptileNoodleAssets.ts` (Engineer 2).

## Decisions a replacement needs

- Every shared number is read through `art/blend/reptile_constants.py` →
  `layout.ts`. `REPTILE_ISLAND_COLLIDER_RADIUS` is read straight with
  `ts_const` in the build script (print-only; the accessor module is shared
  and was left untouched).
- The mound profile is **derived from the coil** (`mound_z_at_r`), so the
  coils always rest on stone and the peak lands on
  `REPTILE_NOODLE_MOUND_HEIGHT` — asserted off the vertices.
- `rn-head` and `rn-tongue` carry their pivot as a **node translation** (chin
  rest point / mouth); every other node is identity. The export script
  enforces exactly that set.
- The burrow was pulled 0.35 m inward from the spec's (3.0, −0.8) to
  (2.66, −0.71): at r 3.1 a 0.42 m body stood proud of the kerb.
- Body tube is 14 sides (spec said 16) and the belly 8, to stay under the
  5 000-triangle ceiling asserted in the build script.
