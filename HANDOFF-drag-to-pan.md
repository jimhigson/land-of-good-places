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
