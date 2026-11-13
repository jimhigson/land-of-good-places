# HANDOFF — fix check:cull-audit on CI (branch fix/cull-audit-ci)

Cleanup job: `check:cull-audit` (from d81f00d3 "Integrate: cull") failed on
CI run 43439027681, shard 11 (PR #773): hotel motes stale bound; sky cruiser
386120 > 256463; slide 316104 > 290910. Stay out of `check:dom-churn`.

## Findings so far

- The check freezes with `game.timeScale = 0` after SETTLE_FRAMES (20) frames
  in the space, found by 200 ms polling. Game time at the freeze is therefore
  20+ frames x (wall-clock dt, clamped to MAX_FRAME_DELTA = 1/12 s): ~0.3 s on
  a GPU, seconds on SwiftShader. Rides advance with world dt
  (`Coaster.update` integrates `distance += speed*dt`), so the audited frame
  differs per machine. The previous author saw it (sky cruiser draws 17/19/22
  over three runs) and added SLACK instead of removing the cause.
- Hotel motes (`world/hotel/dressing.ts` createDiscoSparkle): InstancedMesh
  whose matrices are rewritten every frame; three caches `boundingSphere` on
  the first cull and never recomputes it -> stale. Same for snake pools
  (`art/models/snake.ts` SnakeSegmentPool), private and shared.
- Wall-clock dependencies in the sim: ball pit warmup (`BallPit.update` ->
  `sim.settle` with a ms budget), NavGrid warm budgets, train puffs use
  Math.random, sunShadowCache uses performance.now (shadows only).

## Plan

1. Game: a held, steppable world clock for checks (fixed dt), so every scene
   is audited at the same game time on any machine.
2. Motes + glints: fixed bound covering the whole travel volume (0 per frame).
3. Snakes: same, if the travel volume is computable; else say why.
4. Re-derive budgets from deterministic runs; drop SLACK; lower knownStale.
5. Proofs: GPU x2 + SwiftShader x2 same numbers; red proofs; hotel screenshot pair.

## Status

- [ ] 1 [ ] 2 [ ] 3 [ ] 4 [ ] 5
