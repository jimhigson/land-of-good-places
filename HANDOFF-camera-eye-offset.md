# Handoff — camera constant duplication (branch `refactor/camera-eye-offset`)

ARCHITECTURE-REVIEW.md Review 3, F1 and F2.

**F1.** `WaterFight.ts` had `const CAMERA_PITCH = 38 * DEG;` under a comment
saying it matched the park's `CAMERA_PITCH_DEGREES`, while importing nothing
from `core/constants.ts`. True on the day, and it would have gone on saying so
after anybody retuned the park camera. Now imported.

**F2.** The eye-offset formula — `(sin(yaw)·h, sin(pitch)·d, cos(yaw)·h)` with
`h = cos(pitch)·d` — was written out by hand in **four** places, not two: the
review named `IsoCamera`'s constructor and `WaterFight.applyCamera`, and the
dodgems rink and the rail racer had their own copies. All four now call
`cameraOffset(yaw, pitch, distance)` from the new `src/core/cameraRig.ts`.

Pitches and yaws are deliberately **not** shared — the rink looks down harder,
the racer is nearly side-on, and the water fight swings its yaw between
landscape and portrait framings. Only the arithmetic is shared.

`src/core/screenBasis.ts` is **untouched**: it is the CONTROL RULE's
implementation, its comment was corrected on 27 July, and `cameraRig.ts` points
at it rather than the other way round. The basis is derived from exactly this
placement, so the two must stay in agreement.

## Status

Pure refactor, no behaviour change — same expressions in the same order, so the
values are identical. `npm run build` passes (exit 0). No browser QA done; this
agent does not own it.
