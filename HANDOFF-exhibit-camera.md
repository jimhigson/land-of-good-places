# HANDOFF — exhibit camera (Reptile House over-shoulder shot)

Branch `feat/exhibit-camera`, worktree `.claude/worktrees/exhibit-camera`.
Model: Opus 5.5 (claude-opus-5-5[1m]), Engineer, dispatched by the Overseer.

## Ask
Jim: exhibit reactions are hard to see zoomed out — camera comes down to an
over-shoulder view while the animal reacts; back when done or she moves.

## Done (all pushed)
- `src/world/reptileHouse/exhibitCamera.ts`: solver (fan of eyes behind her,
  star/crowd sightline tubes vs hall + her body, glass see-through, approach
  path sampled clear) + `ExhibitCamera` director (smoothstep ease in 1.0 s,
  hold ≥2.6 s and until the blurb bubble ends, ease out 0.9 s / 0.45 s on
  cancel). Places the camera exactly on its curve each frame (snap* calls) —
  damping on top made the real path stray 0.15 m from ribs/vines.
- Exhibits expose `subjects()` (stars/crowds via `asCrowd`, body markers for
  pooled snakes) and `cast()` (animals never occluders of each other).
- Game.ts: `exhibitCamera.apply(camera)` claims focus before keychain.
- `check:exhibit-camera` in shard 4; green; red proofs in its docstring.
- Local runs: `LGP_PARK_RESTART=0 pnpm run check:exhibit-camera` (~90 s);
  without it, importing the game triggers a multi-minute park acceptance.

## Left
- PR, preview, headless screenshots at /reptile-house.
