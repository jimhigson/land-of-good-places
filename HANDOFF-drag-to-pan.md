# HANDOFF — drag to look around the park (#419)

Branch `feat/drag-to-look-around`, worktree `.claude/worktrees/drag-to-pan`, dev port **5422**.

Jim, 31 Aug: *"while in normal gameplay (walking around) dragging the screen with
the mouse or a finger should pan the camera to look around the park. Then, after
about 3s of not swiping/dragging it should return to your character"*

## Findings from the read-through (done)

- `src/core/input/tapGesture.ts` — the one definition: `TAP_MAX_DRIFT_PX = 18`,
  `TAP_MAX_MILLISECONDS = 600`, `tapDriftedTooFar()`, `completesTap()`. **A drag
  is exactly "a pointer `tapDriftedTooFar` has said yes to".** No fourth number.
- `PointerControls` already computes this: `ActivePointer.disqualified` is set in
  `onPointerMove` by `tapDriftedTooFar`. So the drag signal is *already there* —
  it just is not reported to anyone. Adding `onLookDrag` reads that same flag; it
  cannot drift out of step with tap-to-walk because it *is* tap-to-walk's flag.
- `PointerControls` already times by `event.timeStamp` (`onPointerDown` line 285,
  `onPointerUp` line 335). Nothing new to time: the return delay is counted in
  `dt` inside the frame loop, not off any clock.
- `ParkMap.onCanvasPointerMove` recognises its pan with the very same
  `tapDriftedTooFar` — so "same gesture vocabulary as the map" is free.
- `IsoCamera` is orthographic, fixed pitch `CAMERA_PITCH_DEGREES = 38`, fixed yaw.
  `worldUnitsPerPixel`, `forward`, `right` are all already there.
  `focus` is the damped follow point; `applyTransform()` places the camera.
- `Collision.playBounds` (`setPlayBounds`, swapped on **every change of space** —
  garden, castle interior, each hotel room) is a `ParkBoundary` with a signed
  `distanceToEdge`. **This is the handle for the indoor-void problem.**
- `Game.cameraOverride` is the ride camera; `player.riding`;
  `treeClimbing.playerClimbing`; `miniGames.hidesPark`; `parkMap.isOpen`.

## The three decisions

1. **Rides — panning off, and the offset is *cancelled*, not eased.**
   While `cameraOverride` (or `player.riding`, or tree-climbing, or a mini-game
   that hides the park, or the map is open) the drag is not fed to the camera and
   `IsoCamera.cancelLook()` zeroes the offset outright. Easing it out would be a
   second camera motion running underneath a ride camera that owns the frame —
   invisible while the ride draws, and still mid-flight when the ride hands back.
   Zeroed instantly *behind* the ride's own camera, the park rig is already
   pointing at her the frame it is drawn again, so nothing fights.

2. **Indoors — she may look anywhere she could walk, and no further.**
   The panned focus is clamped inside `Collision.playBounds`, the same leash the
   *player* is on, re-asserted every frame. That boundary is already swapped per
   space, so indoors it is the castle floor's own circle and the camera cannot
   reach a neighbouring floor's void 300 m away — and no new idea of "where the
   inside is" is invented. Panning is *not* switched off indoors: a gesture that
   silently does nothing in one room is worse than one that stops at the wall.

3. **The return — exponential ease, no overshoot, `damp()`.**
   3 s of no drag (counted in frame `dt`), then the offset damps to zero on the
   same `damp()` the follow-cam already uses, half-life 0.45 s. Exponential ease
   is the camera's existing motion vocabulary, it is frame-rate independent, it
   cannot overshoot (a spring would rock her past centre), and it starts fast and
   lands soft — which is what "gentle rather than snapped" means.

## The mutation transcript (done — both proved red)

Green baseline, on the code as committed:

```
PASS: 58 checks. Dragging looks around the park, tapping still walks her, and the camera comes home.
EXIT=0
```

**Mutation 1 — a drag walks the player.** In `src/core/input/tapGesture.ts`,
`tapDriftedTooFar` made to return `false`, so nothing is ever a drag:

```
FAIL: a drag one pixel outside the slop must not walk her
FAIL: a drag one pixel outside the slop must pan the camera
FAIL: a held mouse drag must not walk her
FAIL: dragging by (140, 0) must never walk her
FAIL: dragging by (140, 0) must pan the camera
FAIL: the pan must track the finger for (140, 0), got (0.0, 0.0)
... (six directions)
FAIL: a slow creep must pan the camera

22 FAILURE(S) out of 58 checks
EXIT=1
```

**Mutation 2 — the camera never comes back.** `if (true) return;` inserted
above the delay test in `IsoCamera.updateLook`:

```
FAIL: one half-life in, about half the offset should remain: expected ~9.00, got 18.00
FAIL: the return must have started
FAIL: the camera must actually arrive back on her: expected 0.0000, got 18.0000
FAIL: once home the view point is the follow point, right on her: expected 0.0000, got 18.0000

4 FAILURE(S) out of 58 checks
EXIT=1
```

**A first mutation attempt that did *not* go red, and why it matters.**
Deleting `pointer.disqualified = true` from `PointerControls.onPointerMove`
left the check green at 58/58. That is not a hole — it is a second,
independent guard: `completesTap` in `tapGesture.ts` re-tests
`tapDriftedTooFar` itself at lift time, so a drifted pointer cannot become a
tap even with the flag cleared. Worth knowing before anyone "simplifies" that
apparent duplication away. The mutation that does reach it is the shared
definition itself, above.

## Browser QA — the traced return, and a trap for whoever repeats it

Real CDP touch input, phone portrait 390x844, `/spawn?pos=0,-18&facing=0`,
dev server on 5422. `look` is `IsoCamera.lookDistance` in metres, `idle` is
`lookIdle` in seconds. Wall-clock on the left:

```
t=+0s  {"look":4.135,"idle":0.25}
t=+10s {"look":4.135,"idle":1.5}
t=+20s {"look":4.135,"idle":2.75}
t=+22s {"look":3.637,"idle":3}      <- the delay lands, the return starts
t=+24s {"look":2.475,"idle":3.25}
t=+26s {"look":1.684,"idle":3.5}
t=+28s {"look":1.146,"idle":3.75}
t=+32s {"look":0.603,"idle":4.17}
t=+40s {"look":0.129,"idle":5.17}
t=+48s {"look":0.028,"idle":6.17}
```

Dead flat for the whole delay, then a clean monotonic exponential home. No
overshoot, no wobble, no step.

**The trap:** with seven agents on this box the park runs at roughly **an
eighth of real time** in headless Chromium — `idle` gains 0.25 s per 2 s of
wall-clock above. The three seconds are *game* seconds, counted in frame `dt`,
which is deliberate and matches everything else in the game (the day/night
clock, every animation). The first QA pass waited 4 real seconds for the return
and screenshotted a camera that had not moved, which looked exactly like the
feature being broken. **If you re-run this, wait tens of wall-seconds, or read
`game.camera.lookIdle` rather than a stopwatch.**

## Tap-to-walk: demonstrated, not asserted

Two independent measurements, both in a real browser.

**1. The drag itself moves her not at all.** `qa-look-around.mjs`, real CDP
touch on the phone and a real held mouse on the desktop, reading
`game.player.position` either side of the gesture:

| viewport | input | drag | look after drag | **player moved by drag** | look at idle 6.5 s | player walked on the next tap |
|---|---|---|---|---|---|---|
| 390x844 | touch (CDP) | -117,-152 px | 7.06 m | **0.0000 m** | 0.000 m | 0.37 m |
| 1440x900 | mouse | -432,-162 px | 8.43 m | **0.0000 m** | 0.107 m | 0.10 m |

**2. Taps walk her exactly as far as they did before.** `qa-ab-tap.mjs` fires
the same grid of taps at the same `/spawn?pos=0,-18&facing=0` on a second
worktree checked out at `origin/main` (port 5423) and on this branch
(port 5422), and compares:

```
┌─────────┬────────────────────┬─────────────────┬─────────────────┬───────┐
│ (index) │ gesture            │ origin/main (m) │ this branch (m) │ same  │
├─────────┼────────────────────┼─────────────────┼─────────────────┼───────┤
│ 0       │ 'near, up-left'    │ '0.00'          │ '0.00'          │ 'yes' │
│ 1       │ 'near, up-right'   │ '0.00'          │ '0.00'          │ 'yes' │
│ 2       │ 'near, down-left'  │ '1.41'          │ '1.41'          │ 'yes' │
│ 3       │ 'near, down-right' │ '1.08'          │ '1.08'          │ 'yes' │
│ 4       │ 'DRAG (control)'   │ '1.06'          │ '1.06'          │ 'yes' │
└─────────┴────────────────────┴─────────────────┴─────────────────┴───────┘
```

Identical to the centimetre, at 390x844 with CDP touch **and** at 1440x900 with
a real mouse, including the targets that correctly walk her nowhere on both
builds.

**Two honest limits on that table, and both took a wrong turn to find.**

- *The absolute distances are small.* With seven agents on this box the park
  runs at roughly an eighth of real time, so a settle window that is 45
  wall-seconds is about 5 game-seconds. A sweep of twelve click targets
  (`qa-sweep.mjs`) confirms she genuinely walks — 1.04 m and 0.91 m for the two
  that landed on reachable ground — just not far, in the time available. The
  *equality* between the two columns is the finding; the magnitudes are a
  property of the machine.
- *Most single taps correctly walk her nowhere.* GAME_DESIGN.md's SELECTION
  RULE: a tap that lands on a thing selects it and goes no further, and this
  park is dense. The first three versions of this harness tapped once, got
  0.00 m everywhere on both builds, and looked like a clean pass while
  measuring nothing — the "a check can pass without checking anything" failure,
  in a QA harness. It now taps twice, 1.5 s apart (well outside the 350 ms
  double-tap window), which is select-then-walk and is how a child uses it.

**Do not read the DRAG row as "the drag walked her 1.06 m".** That same 1.06 m
appears on `origin/main`, where drag-to-pan does not exist. The clean
measurement of the drag itself is the **0.0000 m** in table 1.

## Progress

- [x] Read `CLAUDE.md`, `GAME_DESIGN.md` CONTROL rule, issue #419, `tapGesture.ts`,
      `PointerControls.ts`, `IsoCamera.ts`, `Game.ts` wiring, `ParkMap.ts` pan,
      `Collision.playBounds`, `boundary.ts`.
- [x] `IsoCamera` look offset + return  (`lookByPixels`, `cancelLook`,
      `setLookBounds`, `updateLook`, `viewFocus`)
- [x] `PointerControls.onLookDrag` — fires off the tap path's own drift flag
- [x] `Game` wiring + `lookAroundBlocked()` + per-frame `setLookBounds`
- [x] `scripts/check-look-around.mts`, 58 checks, in `pnpm run check`
      (`check:look-around`, after `check:tap-spacing`)
- [x] mutation transcript, above
- [ ] browser QA at 390x844 and desktop
- [ ] full `pnpm run check` + `build` + `test:procgen`
- [ ] PR
