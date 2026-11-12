# HANDOFF: 120 fps plan step 5 — stop per-frame needsUpdate

Spec: docs/perf/FRAME-DROPS-2026-11.md on PR #746 (step 5, item 16).

## State
- `showMap(material, texture)` in `src/art/style/materials.ts`: swaps `map`,
  sets `needsUpdate` only when the program would change (null<->texture,
  channel, colorSpace, video). three r185 re-reads `material.map` into the
  uniform at each material's first draw per render (`_currentMaterialId` is
  reset at the end of every render), so a non-null swap needs no version bump.
- Used by faces.ts (2x setExpression, face paint overlay), sharedFace.ts,
  reptileHouseAssets.ts (head `apply`, called every frame via setNight),
  reptileNoodleAssets.ts, snake.ts, pets.ts, hats.ts.
- waterSplash.ts: idle splash no longer uploads its instance buffer every frame;
  instanceColor only when colours moved.

## Measuring
- Harness copy + `measure.mjs` in the agent scratchpad (`harness/`), runs
  /spawn?seed=0 on a `vite build --minify false` bundle via `vite preview`.
  Needs prebuilt parks (`LGP_SEEDS=0 pnpm run build:parks`), else the client
  never finishes solving.
