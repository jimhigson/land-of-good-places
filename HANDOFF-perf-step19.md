# HANDOFF — perf step 19: frame pacing (ball pit interpolation)

Branch `perf-step19-frame-pacing`, worktree `.claude/worktrees/perf-step19`.
Plan: `docs/perf/FRAME-DROPS-2026-11.md` on `origin/perf/frame-drops-2026-11`
(PR #746), item 18 + the "ball physics start-up" row of item 19.

## Findings so far

- Only fixed-step accumulator in `src/`: `world/building/ballPhysics.ts`
  (`FIXED_DT = 1/60`, no interpolation). `core/Loop.ts` is plain rAF, no cap.
- Not caps: `Spring.ts` (substeps only when dt > 1/30), `balloonString.ts`
  (clamp), `frameStrides.ts` (1/60 is only the EMA's starting value),
  `Highlights.FROZEN_DT` (paused only), `ArrivalSequence.BEAT_STEP` (replay),
  `railRace/simulate.ts` (offline), `NpcSystem` far children think every other
  frame (a half-rate LOD at any refresh rate, not a 60 Hz cap).
- Old warm-up: 73 frames of `step(5/60)`, exactly 360 substeps, leaves
  accumulator 4.3e-15. Costs up to ~35-40 ms/frame in browser (plan) —
  Node timings on this machine are noisy (other agents), median ~1.4 ms/substep.

## Plan

1. Sim keeps previous positions; `step()` writes interpolated draw positions
   + a per-ball draw-dirty flag. Snap to current when nothing is awake.
2. BallPit draws from the interpolated arrays.
3. Warm-up: run single substeps under a per-frame time budget (min 1, max 5)
   — same 360 substeps, identical settled pile (test proves bit-identical).
4. vitest `test/building/ballPacing.test.ts` (add to shard map) + headless
   measure script against own dev server.

## Status

- [ ] 1-2 interpolation
- [ ] 3 warm-up
- [ ] tests, red proof
- [ ] browser measurement
- [ ] check / test:procgen / PR
