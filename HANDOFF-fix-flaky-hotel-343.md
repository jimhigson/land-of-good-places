# HANDOFF — #343, the flaky `check:hotel` that held `main` red

Branch `fix-flaky-hotel-343`, off `origin/main` at `b910cfb`.

## Status

Fix committed (`aa8b78b`). Two files: `scripts/check-hotel.mts`,
`src/art/style/faceLife.ts`.

## Root cause, confirmed

`check:hotel` probe 16's last assertion sampled **one instant** 0.2 s after
`Hotel.wakeNap()` and failed if the face wore the shut-eye texture. It cannot
work: a nap holds the eyes shut by *resting the face on `'blink'`*
(`Player.sleeping`), so **a nap and an ordinary blink are the same texture, by
construction**. And the blink clock ran on unseeded `Math.random()`
(`faceLife.ts`'s `createBlinkClock` default), so whether a blink landed on the
sampled frame was a coin toss.

Measured, not assumed:

- 3.04% of runs, over 200 000 replays of this exact frame timeline.
- **47 passed | 1 failed of 48** real `check:hotel` runs on unmodified
  `origin/main`, with the byte-identical CI message.

## The fix

1. `faceLife.ts` now owns a **seeded** default stream (`createRandom`) instead
   of `Math.random`, so every face in the park is reproducible. Callers that
   already pass their own seeded rng (`wanderDriver`, `waypointDriver`) are
   untouched. `BLINK_DURATION` is exported so a check can take the number from
   the game rather than copying it.
2. The wake assertion asks two questions a blink cannot answer wrongly:
   `Player.sleeping` must be down (and is asserted **up** during the nap first,
   so the wake test describes something that was ever true), and her resting
   face must be back for all but at most one blink's worth of a 2 s window.
   Both failure messages carry real counts.

After: **30 passed | 0 failed of 30**, and all 30 logs **byte-identical**
(`md5sum` — the check is deterministic now, not merely lucky).

Proven red on two deliberate breaks:

- `endRide` no longer clearing `sleeping` → both assertions fire.
- an awake child's face pinned to `'blink'` → the resting-face count fires on
  its own.

## Findings that are NOT fixed here (deliberately)

- **`Hotel.wakeNap()` calls `player.model.setExpression('happy')` directly**,
  bypassing `faceLife`. `faceLife` still believes it is showing `'blink'`, so
  it overwrites 'happy' on the very next frame: "she wakes up happy" lasts one
  frame, i.e. never. Same disease `Player.sleeping` exists to cure (a one-shot
  call racing the frame). A visual change, so it needs browser QA — separate PR.
- **`check:park-boot` is red on its own account**, and it is *not* just
  contention. On a quiet box here: **6 passed | 2 failed of 8**, worst
  `advance()` 54.5–76.0 ms against a self-scaled ~72 ms ceiling. In **7 of 8**
  runs the worst slice did **zero work units** — "no generator step at all, 0
  work units in 54.5–76.0 ms, during *joining up the paths*" — and the same is
  true of the last **passing** CI run on `main` (32900676411): 66.7 ms of a
  74.1 ms ceiling, 0 work units, same stage. That is ~1.1x headroom in CI on a
  green run, and the failure message ("if it got through one or two, that unit
  is too big to be a unit") does not describe a slice that got through none.
  Needs its own issue; do **not** raise the ceiling.
