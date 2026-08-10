# HANDOFF: bus keeps moving (looping world + jump-cut arrival)

Branch `e-bus-keeps-moving` off `origin/main` (79018c0). Own port for QA: **5314**
(5200/5210/5412 are other agents').

## The task (Overseer's 4th option — supersedes the original runway approach)

On a slow device the park build outlasts the 20 s ride, so today the bus parks at
the gate and idles under a caption. A stopped bus reads as waiting. Fix: the drive
is its **own infinitely repeating world**; when the park is ready (and a minimum
ride time has passed) a **deliberate jump-cut** takes the bus adjacent to the park
and the existing arrival (settle onto the 0.00° park bearing, hand over) plays.
**Bus always moving; never a parked wait.**

Why this dissolves the ~21 m runway problem I found first: the lane no longer has
to *reach* the gate — it loops forever, and the gate arrives via a cut.

## Design (as being built)

- **Periodic world, seamless by construction.** `laneHeight` and the ground
  cross-slope are made periodic with period `LANE_LOOP = 360 m` (harmonics 5/2/1 of
  2π/360; `gcd=1` so the true period is 360). Amplitudes unchanged → `LANE_MAX_GRADIENT`
  ~0.228 (≈12.8°), still inside the guard's [3°,16°]. Scatter (trees/hedges) is
  tiled every `LANE_LOOP`. The countryside is one tile of `3·LANE_LOOP` translated
  by `Math.round(busZ/LANE_LOOP)*LANE_LOOP` each frame to follow the bus — invisible
  because a whole-LOOP shift over periodic content is byte-identical.
- **Park-ahead (gate/wall/woodland) is its own group**, at the fixed gate z (−250),
  NOT translated, `visible=false` during the loop, shown at the jump-cut. Kept in the
  scene graph so `parkFacts` still scans it (traverse ignores `visible`).
- **BusJourney phases:** LOOPING (bus drives forever `busZ=-elapsed*SPEED`, continuous
  orbit `loopCameraPoseAt`, cycling shot beats) → at `canArrive` a one-time JUMP-CUT
  (reset busZ to the approach start, show parkAhead, force outside view) → ARRIVING
  (reuse existing `cameraPoseAt` settle + drive `busZ` −184.8→−220 over `SETTLE_SECONDS`,
  ending at 0.00°). Hand over at −220 exactly like today's fast path.
- **Director owns timing.** `readyToArrive = parkFitToPlay && elapsed >= MIN_LOOP_SECONDS`
  (MIN_LOOP = JOURNEY_SECONDS − SETTLE = 16.8). `readyToHandOver` fires SETTLE after the
  jump-cut. Fast device → jump-cut at 16.8, hand over at 20.0 (unchanged). Slow → loop
  until ready, then +SETTLE. `overrunning`/`overrunAwareBudgetMs` unchanged, so
  generation still drains flat-out past 20 s during the loop.
- **Removed:** pull-in (`busWaitZAt/busWaitSpeedAt/BUS_WAIT_Z/PULL_IN_SECONDS`), idle
  rock/breath — the bus is never stopped now. `RIDE_END_Z` exported for the probe.

## Guards
- `check:bus-journey`: replace the "wait/pull-in/two-halves" block with a **looping
  overrun** block — drive past 20 s, assert `busPositionZ` keeps changing every ~frame
  (prove red by pinning it), then trigger `canArrive`, assert the settle ends within
  0.02° of the park bearing (seamless), and that the jump-cut only fires when ready+min.
  Keep the 20 s shot-list / closing-shot assertions (extend, don't weaken).
- `check:arrival-completes`: still drives real generation+director; extend docs/asserts
  for the loop (generation drains flat-out past 20 s). No BusJourney there.
- `check:arrival-starts` (Playwright): unchanged intent; verify end-to-end.
- `parkFacts.runTheArrival`: `journey.update(dt, director.readyToArrive)` and hand over
  on `director.readyToHandOver` (now delayed by SETTLE).

## Status
- [x] periodic laneHeight/groundHeight + LANE_LOOP (=46 road tiles ≈357.9 m; hill mismatch 4e-14)
- [x] tile (3×LOOP) + whole-loop shift  [x] parkAhead split (own group, hidden in loop)
- [x] update() phases + director (readyToArrive/readyToHandOver) + main  [x] parkFacts
- [x] guards: check:bus-journey rewritten (loop keeps moving +prove-red; cut gating both ways;
      seamless 0.00° hand-over at every ready-time); check:arrival-completes prose
- [x] build pieces green: check:bus-journey, check:cat-bus, check:arrival-completes, test:procgen(321)
- [ ] full `npm run build` (running) then visual QA (throttled chromium, port 5314): loop, cut, arrival;
      fast=20 s. Screenshots for the PR + message.

Verified: fast path hands over at 20.02 s, 0.00°; overrun loops 50 s with bus moving on 1801/1801
frames; hand-over lands at RIDE_END_Z (−220) on the park bearing whenever the cut fires.
LANE_TREES_PER_LOOP=260, HEDGE_PER_LOOP=300 (tune in QA if too sparse/heavy).
