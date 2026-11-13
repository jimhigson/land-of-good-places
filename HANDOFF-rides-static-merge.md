# Handoff: rides-static-merge (120 fps plan item 12 / step 14)

Branch `perf/rides-static-merge`, worktree `.claude/worktrees/rides-static-merge`,
dev server port 6051. Engineer, 13 Nov 2026. Do NOT open a PR (a later stage does).

## Brief

Merge static geometry that never moves into per-area batched meshes, tiled so
frustum culling still works. Rail Race target: CPU p50 <= 5 ms, < 1200 draws.
Pixel-identical within noise. Highlighted / animated / interactable things stay
separate. Collision untouched. Lower `check:render-budget` ceilings; keep
`check:static-freeze` and `check:cull-audit` meaningful. Don't touch the shadow
cache. Merge `fix/cull-audit-ci` if it lands first.

## Constraints found

- Scenery.ts, FairyLights.ts, AnchorPlots.ts, World.ts, stalls are all in the
  park-source closure (`node scripts/lib/park-source-hash.mjs --files`). The
  precedent (`world/parkStatics.ts`, step 13) is a render-only pass called from
  `Game.ts` after `new World(...)`; batching should follow it.

## Status

- [ ] baseline measured (draws by group, CPU p50/p99, frame p99)
