# HANDOFF — cat bus "stops forever" (`e-bus-stuck-forever`)

Branch `e-bus-stuck-forever-work`, off `origin/main` @ `916a430`. Worktree
`.claude/worktrees/e-bus-stuck-forever`. `npm ci` exit 0.

**A second throwaway worktree** `.claude/worktrees/e-bus-stuck-main` @ `916a430`
(unfixed main), node_modules symlinked from this one, exists only to serve a
dev server for the red-on-main proof. Remove it when done.

Dev servers I started (kill by PID/port when done): **5623** dev-fix, **5624**
dev-main (the e-bus-stuck-main worktree), **5625** preview-fix (production build).
5200 / 5210 / 5412 never touched.

## Root cause — NOT the cones

The cat bus reaches the gate and idles for minutes on a slow device; the player
never gets control. Hand-over waits for `JourneyDirector.readyToHandOver` = ride
over AND park generated AND shaders warmed. Generation is budgeted in **wall-clock
ms/frame** (`GENERATION_BUDGET_MS = 8`), so a slow device does fewer generator
steps per frame and needs proportionally **more frames**; the ride is a **fixed
~240 frames** (20 s of `dt` clamped to `MAX_FRAME_DELTA = 1/12`). Below ~12 fps
generation outlasts the ride, and the bus idles at the gate for the difference —
minutes on a low-end tablet = "gets to the same point and stops forever."

NOT production-only: it's fast-device vs slow-device. Both dev and the production
build hand over fine on an M4 Pro; the bug only shows under CPU throttle.

**The existing completion test was hollow.** `check:park-boot` and
`check:bus-journey` both drive generation to completion on a fast box (finishes in
~440 frames) and then check the hand-over gate by **hand-feeding a `JourneyDirector`
`noteParkReady()`/`noteWarmupReady()`** — never a real generation against the
ride's own frame budget. So neither could see frames-outlast-the-ride.

## The fix (commit `eef8b7f`)

The 8 ms cap exists only to protect the camera orbit *during the ride*. Once the
ride is over and the bus has parked, there's no orbit to protect and the child is
waiting — so `JourneyDirector.overrunAwareBudgetMs(rolling, waiting)` hands
generation **and** shader warm-up a large budget (`OVERRUN_GENERATION_BUDGET_MS`
/ `OVERRUN_WARMUP_BUDGET_MS` = 200) once `overrunning`. **Zero change on fast
devices** (overrunning never fires). `src/ui/JourneyWait.ts` + `.journey-wait`
CSS show a compositor-animated "Getting your park ready!" caption while parked so
the wait reads as loading, not a crash.

## The measured wait — flagged loudly, per the Overseer

The uncap makes the wait **finite** (main is effectively endless) but on a slow
device it is still **long**, because the residual is the device's raw generation
cost and no scheduling beats it. Real cold boot, real ANGLE Metal GPU, canonical
seed, cold-boot → playable:

| CPU throttle | fix | main |
|---|---|---|
| 4x | 39.2 s (19.3 s parked) | 50.2 s |
| 6x | 58.3 s | 90.5 s |
| 10x | ~146 s (81 s parked) | (unmeasured, » ) |

The fix's benefit **grows with slowness** (main's 8 ms budget gets a dreadful
frame duty cycle when render is slow). **The caption is NOT the fix** — it makes a
short wait legible; the real cure for very slow devices is **cheaper generation**
(the slide search is ~3.46 s / most of ~3.9 M steps) and/or keeping the bus
*moving* until ready (Overseer's option 1, declined here as too risky for a
boot-path P0). This is a follow-up for Jim to decide.

## Tests (both proven red on today's `main`)

- **`check:arrival-completes`** (commit `84ee815`, **in the build chain**,
  CI-blocking, no browser): drives the real `ParkGeneration` + real
  `JourneyDirector` + real `overrunAwareBudgetMs`, models a slow device as one
  generator step per `advance(0)`, asserts the **parked frames drain ≥10× faster
  than the rolling ones** (device- and seed-independent). Fix ~26×; revert the
  parked budget to the rolling one (= main) → ~1× → RED. Proven both ways by
  mutation (fix ~81 rides parked; main ~2024 rides).
- **`check:arrival-starts`** (commit `9b79f5c`, run-to-verify, needs chromium):
  the real cold boot under CPU throttle → asserts control is handed over within a
  wall-clock ceiling AND the player can walk (world position changes on ArrowUp).
  6x, ceiling 75 s: **fix passes (playable 58.3 s, walked 4.34 m); main FAILS
  (never playable in 75 s, bus still parked, no caption)**. `playwright-core` added
  as a devDep (driver only; `channel:'chromium'`).

## Status

- [x] Root cause reproduced + mechanism reported to Overseer (fast-vs-slow, hollow test)
- [x] Fix: overrun-uncap + loading caption; zero change on fast devices
- [x] Measured wait reported; residual flagged (real cure = cheaper generation)
- [x] Two tests, both red-on-main / green-on-fix
- [x] `npm run build` exit 0; `npm run test:procgen` 11 files / 321 tests / 0 skipped, exit 0
- [x] Production-build screenshots — `scratchpad/shots-prod/`: 10 loading caption, 20 playable+HUD, 30 walked
- [ ] Push, PR against `main`, **do not merge** (Overseer merges on green)
