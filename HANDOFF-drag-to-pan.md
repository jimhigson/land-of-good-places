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

## Progress

- [x] Read `CLAUDE.md`, `GAME_DESIGN.md` CONTROL rule, issue #419, `tapGesture.ts`,
      `PointerControls.ts`, `IsoCamera.ts`, `Game.ts` wiring, `ParkMap.ts` pan,
      `Collision.playBounds`, `boundary.ts`.
- [ ] `IsoCamera` look offset + return
- [ ] `PointerControls.onLookDrag`
- [ ] `Game` wiring + guards
- [ ] `scripts/check-look-around.mts` into `pnpm run check`
- [ ] mutation transcript
- [ ] browser QA at 390x844 and desktop
- [ ] PR
