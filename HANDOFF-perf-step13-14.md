# Handoff: perf steps 13 and 14 (static matrices, static batching)

Branch `perf-step13-14-static-batch`, worktree `.claude/worktrees/perf-step13-14`. 13 Nov 2026.

## Done (step 13, partly)

- `src/world/staticFreeze.ts` — `freezeStatic(root)`, `auditFrozen(scene)`. Per-node: a node carrying
  `userData`, or an instanced/skinned mesh, LOD, light, camera or bone, is left live.
- `src/world/parkStatics.ts` — the one list of what is frozen: scenery children holding no live node
  (on seed 5 that is the wooden walls only), and every stall booth (flags stay live via `userData`).
- `src/Game.ts` — one call, after `new World(...)`.
- `scripts/check-static-freeze.mts` + `check:static-freeze` / `check:served-static-freeze`
  (NOT in any shard — the integrator wires it). `scripts/with-dev-server.mts` passes its URL.
- None of this is in the park-source closure; the hash did not move for it.

## Measured (seed 5, headless Chromium, 1440x900 DPR 1, before the base merge)

| where | objects | matrixAutoUpdate on, before -> after | GL draws | triangles |
|---|---|---|---|---|
| `/spawn?seed=5` | 7846 | 7845 -> 7395 | 581 -> 581 | 3655150 -> 3655150 |
| `/rail-race?seed=5` | 7892 | 7891 -> 7441 | 2169 -> 2169 | 4232316 -> 4232316 |

450 nodes frozen: 78 wooden walls + 62 x 6 stall nodes.

## Not done

- **Step 14 (batching) is not started.** Draws are unchanged. From the Rail Race camera the targets
  are: stalls 408 draws, anchor:dodgems 192, wooden walls 77, anchor:waterFight 43, stone walls 40.
- Stone walls (41 objects) stayed live: the group holds a node `holdsLiveNode` rejects. Not looked at.
- Anchor plots are not frozen: their content groups are handed to the rides, which animate them.
- No pixel-diff screenshots were taken.
- After merging `perf/120fps-base` the park hash became `7f2bdc8c28fe81b4`; no worktree had seed 5
  solved for it, so **the browser check has not been run on the merged head** — only typechecks.

## Re-run

`pnpm run check:served-static-freeze`, or against a running server:
`CHECK_STATIC_FREEZE_URL=http://localhost:<port> pnpm run check:static-freeze`.
Red proof: delete the `userData` line in `isLeftLive` -> exit 1, 54 drifted (9 flags x 6 stalls).
