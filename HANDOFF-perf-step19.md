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

- GOLDEN (unmodified code, origin/main 46ef5a64, under vitest's deterministic
  Math): sim(900, 0.28, {radius 5.22, restY -0.22}, 90210); old warm-up
  (step(min(rem,5/60)) to 6 s) → warm=360 substeps, positions fnv1a
  `1f38a64b`; then impulse(0.8,-0.4,6.6,14.4,10.4) and 600 frames of
  mulberry32(7) dt in [1/144,1/45], player line x=-5+10t z=1.5 sin 6t
  (null every 3rd frame) → 537 substeps, final fnv `06cf593d`.

## Plan

1. Sim keeps previous positions; `step()` writes interpolated draw positions
   + a per-ball draw-dirty flag. Snap to current when nothing is awake.
2. BallPit draws from the interpolated arrays.
3. Warm-up: run single substeps under a per-frame time budget (min 1, max 5)
   — same 360 substeps, identical settled pile (test proves bit-identical).
4. vitest `test/building/ballPacing.test.ts` (add to shard map) + headless
   measure script against own dev server.

## Status (second engineer, 13 Nov 09:15)

- [x] 1-2 interpolation (`ballPhysics.ts` drawX/Y/Z + drawDirty, `BallPit.ts` draws from them)
- [x] 3 warm-up: `settle()` under a 2 ms frame budget, min one sub-step a frame
- [x] guard `test/building/ballPacing.test.ts` (6 tests, in procgen shard 4), proved red twice:
  - `interpolate(1)` in `step()` → `2 failed | 4 passed`, "expected 36226 to be +0"
    (drawn held still 36226 of 72452 ball-frames) and "expected 0 to be greater than 0"
  - `this.px[i] = x` inside `interpolate()` → `4 failed | 2 passed`, fingerprints
    `ae4978a3`/`b396c390` against the pinned `1f38a64b`/`06cf593d`
- [x] audit of the rest of `src/` — see below
- [ ] browser measurement: NOT done. A dev park for this source hash is a fresh
  ~30 minute solve of seed 5 on the loaded Mac; headless Chromium is 60 Hz anyway.
- no PR from this branch: the integrator merges it into `perf/120fps`.

## Audit: every other frame-rate assumption found

Fixed here:
- `src/minigames/dodgems/tree.ts` — apple floor friction `*= 0.9` and leaf drag
  `*= 0.98` were per-frame multipliers; now `Math.pow(k, dt * 60)` (exactly k at 1/60).

Found, not fixed (and why):
- `src/art/models/ponytail.ts:81,277` `DRAG = 0.986` per sub-step and
  `src/entities/balloonString.ts:50,150` `DRAG = 0.965` per frame: position
  Verlet, so the implicit velocity and the constraint passes are per-step too.
  Converting the drag alone would not make them rate-independent, and they have
  been looked at on Jim's 120 Hz Mac as they are. Needs a time-corrected Verlet
  and his eye.
- `x += (target - x) * Math.min(1, dt * k)` eases (linearised, first-order
  correct, differ by <0.1 % between 60 and 120 Hz at these k):
  `minigames/ferrisWheel/gondola.ts:703`, `ferrisWheel/sparks.ts:137`,
  `world/Fountain.ts:546`, `world/train/puffs.ts:111`,
  `world/reptileHouse/exhibits.ts:278,1220`, `entities/npc/NpcSystem.ts:1235`.
- `core/Loop.ts:68` fps read-out EMA `* 0.08` per frame, and
  `entities/frameStrides.ts:112` typical-dt EMA `* 0.1` per frame: estimators
  that converge in frames, not animation.

Not 60 Hz assumptions (checked): `core/Loop.ts` (plain rAF, hitch clamp 1/12),
`core/Spring.ts:30`, `Highlights.ts:84` FROZEN_DT (paused only),
`ArrivalSequence.ts:840` BEAT_STEP (replay), `railRace/simulate.ts:468,1207,1278`
(offline), `world/standing.ts:125` (probe), `catBus.ts:2094` (divide guard),
`NpcSystem.ts:958` far children every other frame with doubled dt,
`ui/characterCreationPreview.ts` (own rAF, real dt), `candyShower.ts:436` and
`dodgems/tree.ts` bounce multipliers (per bounce, not per frame). Every
`setInterval`/`setTimeout` in `src/` is a UI timer, autosave or version poll —
none drives animation.
