# HANDOFF: smooth generation behind the looping bus (e-smooth-gen)

Branch `e-bus-keeps-moving`. Own QA port **5316** (5200/5210/5412/5314 are others').
Adds *smoothness* to the looping-bus branch before it can merge.

## The ask (Jim)
> "Is the procgen split over many microtasks of <4ms so the animation can run
> while it runs? It seems quite jumpy while the game is generating the map."
The bus now LOOPS and MOVES throughout the overrun, so a chunky generation
budget visibly judders the moving bus/camera/world. Make it smooth.

## MEASURED FIRST (this laptop, cold; `scripts/measure-advance-steps.mts`, TEMP)
Per-CHUNK (advance(0) = one yield per call), authoritative unit counts from
`check:park-boot`: brief 152, cruiserSearch 242,899, cruiserFinish 19,
slideSearch **3,644,905**.
- **cruiserFinish#4 = 4.03 ms** (the castle-window carve — cold `terrainHeight`
  first-compile; 0.27 ms warm). Every other cruiserFinish unit ≤ 1 ms. ONE-TIME.
- **slideSearch**: median ~0.001 ms; worst *algorithmic* ~2.7 ms (the `satisfies`
  chute-rebuild at each solved route). 12/36 ms outliers are GC pauses at random
  deep indices (2.9M, 586k), not yieldable chunks.
- The slide search already yields per joint; the overrun runs almost entirely
  tiny slide chunks. **So the judder is the BUDGET, not chunk size.**
Per-ADVANCE cold: at 8 ms budget worst advance = 10.1 ms (8 + ~2 overshoot);
at **200 ms budget worst = 200 ms, 20 of 34 frames blow a 60 Hz frame.** <- judder.

## ROOT CAUSE
`OVERRUN_GENERATION_BUDGET_MS = 200` (parkGeneration.ts) + same for warmup.
While the bus loops-and-moves, each frame blocks up to 200 ms => ~5 fps judder.
The 200 ms was correct when the bus PARKED during overrun; the moving bus
overturns that premise.

## THE TENSION (important)
`check:arrival-completes` has `SPEEDUP_FLOOR = 10`: it REQUIRES the overrun to
drain >=10x the rolling budget (i.e. >=80 ms/frame). That premise — "the loop
tolerates a chunkier frame rate" — is exactly what the moving bus overturns.
No budget satisfies both >=80 ms (that floor) AND smoothness (<=~16 ms). So the
floor must be RE-AIMED at the real, changed invariant, not weakened to pass:
  - keep proving generation COMPLETES in bounded frames (anti "stops forever");
  - SMOOTHNESS is owned by a new overrun advance-ceiling in check:park-boot;
  - the "stops-forever" *appearance* is already solved by the moving bus, which
    check:bus-journey proves (bus/camera move every overrun frame).

## PLAN
1. Lower OVERRUN_GENERATION_BUDGET_MS (+ warmup) 200 -> smooth value (measure R
   in browser; bias to smoothness, near the proven-smooth rolling 8 ms).
2. check:park-boot: ADD an overrun-budget advance-ceiling (drive at the overrun
   budget, worst advance <= device-relative frame ceiling). RED vs today's 200.
3. check:arrival-completes: replace SPEEDUP_FLOOR with completion + "overrun
   budget is applied" (drop the "25x faster" premise). Prove red appropriately.
4. Browser: throttled overrun, frame-time trace before(200)/after. Screenshots.
5. Castle carve 4 ms is cold-compile-bound; finer yield can't shrink it. Note it.
BYTE-IDENTITY absolute: check:park-boot fingerprints must be unchanged.

## STATUS
- [x] measured per-chunk + per-advance distributions
- [ ] code changes  [ ] guards  [ ] browser before/after  [ ] full build + procgen
