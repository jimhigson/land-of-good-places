# HANDOFF — fix check:cull-audit on CI (branch fix/cull-audit-ci)

Cleanup job: `check:cull-audit` (from d81f00d3 "Integrate: cull") failed on
CI run 43439027681, shard 11 (PR #773): hotel motes stale bound; sky cruiser
386120 > 256463; slide 316104 > 290910. Stay out of `check:dom-churn`.

## Root causes (found)

- Rides: the check froze `timeScale = 0` 20 frames after reaching the space;
  world time per frame is wall time (clamped 1/12 s), so SwiftShader audited
  ~2.5 s into each ride and a GPU ~0.4 s. Reproduced locally with
  SWIFTSHADER=1: same numbers as CI (386120, 316104, motes).
- Motes/glints, snakes, ball pit: InstancedMesh matrices rewritten every frame;
  three caches `boundingSphere` on first cull and never recomputes.

## Done (all pushed)

- `src/core/checkClock.ts` + `Game.ts`: `?clock=<s>` world clock held from frame
  one, fixed 1/60 s steps while nothing waits on the wall clock (iris, LazyPart
  fetch, ball pit warm-up finished via `BallPit.settleNow`), drawn once after
  every wait, held at the moment. `window.__checkClock` (extend, afterStep).
- `LazyPart.ts`: `lazyPartsFetching()` counter.
- Motes/glints: fixed travel-volume bounds (dressing.ts). Snakes: hall pools
  bounded by the hall, private pools by rest pose + max wave (snake.ts,
  ReptileHouse.ts; setWriggle clamps to MAX_WRIGGLE). Ball pit: own bound refit
  only on frames a ball is redrawn.
- Check: per-scene `clock` moment (spaces 1 s, rides 2 s), 10 s stale sweep,
  reload guard, budgets re-derived, no knownStale, red proofs in header.
- Proved: GPU x2 + SwiftShader x2 identical in all 11 scenes (c1 runs, before
  the bound fixes); hotel lobby + disco close-up screenshots byte-identical
  old vs new at 1/3/6 s.

## Left

- Final matrix (GPU x2, SS x2) on the final code; deep compare.
- CI-like cold run: `pnpm run check:served-cull-audit` with SWIFTSHADER=1.
- Merge origin/main, PR, cancel its CI runs. Kill vite on 5981 (pids 75767,
  75773, 75780). Scratch: /private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/63860b08-4a9b-4597-b7cf-7b1677887a9f/scratchpad/cullci
