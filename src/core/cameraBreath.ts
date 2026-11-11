/**
 * **The camera breathes** — a deliberate, gentle sway of where a held camera
 * looks. Jim, 26 October 2026, of a drift he saw in story time's shot: *"I like
 * this wobble and would like this small wobble to apply all of the time."*
 *
 * What he saw was an accident of the exhibit camera's aim easing after the
 * middle of the owl and the three listening children as they swayed. Measured
 * on that first preview: the aim swinging ±0.11–0.17° about its middle on a
 * slow, gently irregular rhythm of about 4.3–4.8 s (the children's listening
 * sway on 4.8 s and 5.7 s cycles, the owl's breath on 3.7 s), fixed scenery
 * moving 0.7–2.8 px from its middle and never 0.4 px in one frame, the lens
 * breathing a little with it. Made on purpose, it is the same every time and
 * owes nothing to who is moving: three slow sines at those incommensurate
 * periods, so it never quite repeats, turning the view a fraction of a degree
 * left and right and up and down about the eye, and nudging the aim a
 * centimetre along the view so the lens breathes with it (`IsoCamera`'s lens
 * follows the eye-to-aim distance).
 *
 * A pure function of time. **The park's own camera breathes with it all of the
 * time** — Jim, 11 November 2026: *"yes to camera sway everywhere"* — applied
 * by `IsoCamera` (its `breath`), last, about the eye, sized on the screen so
 * the 90 m follow camera and story time's held shot sway the same few pixels.
 * Story time's shot holds its aim still (`library/storyCamera.ts`, through
 * `ShotRules.breath` = {@link STILL_BREATH}) and breathes with the rest.
 */

/** One moment of the breath: how far the view is turned, tilted and reached, from where it would rest. */
export interface CameraBreath {
  /** Degrees turned about the eye, left (−) and right (+) — added to the camera's own yaw. */
  yawDegrees: number;
  /** Degrees tilted about the eye, added to the camera's own pitch. */
  pitchDegrees: number;
  /** Metres the aim moves along the view, away from the eye (+): the lens's breath. */
  reach: number;
}

/**
 * **The breath's three rhythms**, in seconds — the listeners' sway (4.8 s and
 * 5.7 s) and the owl's breath (3.7 s) the effect was first seen in.
 * Incommensurate, so the sway is a slow, gently irregular one of about 4–5 s.
 */
export const CAMERA_BREATH_PERIODS = [4.8, 5.7, 3.7] as const;
/** Degrees of turn per rhythm: at most 0.16° all together, mostly 0.1–0.15° — the drift Jim saw. */
export const CAMERA_BREATH_YAW = [0.08, 0.05, 0.03] as const;
/** Degrees of tilt per rhythm: a little less than the turn, so the picture sways more than it nods. */
export const CAMERA_BREATH_PITCH = [0.03, 0.05, 0.02] as const;
/** Metres of reach per rhythm — on the owl's breath only, the lens's slight breath (about ±0.1° of a 66° lens at 5 m). */
export const CAMERA_BREATH_REACH = [0, 0, 0.012] as const;
/**
 * **The lens the angles above were measured on**, vertical degrees — story time's
 * laptop lens (62–66°) on 26 Oct 2026. `IsoCamera` scales the turn and the tilt
 * by `tan(fov / 2) / tan(this / 2)`: the same share of the frame on every lens.
 */
export const CAMERA_BREATH_REFERENCE_FOV = 66;
/** **The stand-back the reach above was measured at**, metres: the reach is applied as a share of it, on every lens. */
export const CAMERA_BREATH_REFERENCE_REACH = 5;
/** Each rhythm's own start in each sway, radians: the turn and the tilt out of step, so the view traces a loop, never a line. */
const YAW_PHASE = [0, 1.3, 2.1] as const;
const PITCH_PHASE = [0.7, 2.4, 4] as const;
const REACH_PHASE = [0, 0, 0.5] as const;

/** The breath `seconds` after it began, written into `out`. */
export function cameraBreath(seconds: number, out: CameraBreath = { yawDegrees: 0, pitchDegrees: 0, reach: 0 }): CameraBreath {
  let yaw = 0;
  let pitch = 0;
  let reach = 0;
  for (let i = 0; i < CAMERA_BREATH_PERIODS.length; i += 1) {
    const turn = (2 * Math.PI * seconds) / CAMERA_BREATH_PERIODS[i]!;
    yaw += CAMERA_BREATH_YAW[i]! * Math.sin(turn + YAW_PHASE[i]!);
    pitch += CAMERA_BREATH_PITCH[i]! * Math.sin(turn + PITCH_PHASE[i]!);
    reach += CAMERA_BREATH_REACH[i]! * Math.sin(turn + REACH_PHASE[i]!);
  }
  out.yawDegrees = yaw;
  out.pitchDegrees = pitch;
  out.reach = reach;
  return out;
}

/**
 * **No breath at all** — a camera held dead still. For story time's shot,
 * whose aim holds still while `IsoCamera` breathes it, and as the test hook
 * (`IsoCamera.breath`) for a check that genuinely needs a still camera.
 */
export function STILL_BREATH(_seconds: number, out: CameraBreath = { yawDegrees: 0, pitchDegrees: 0, reach: 0 }): CameraBreath {
  out.yawDegrees = 0;
  out.pitchDegrees = 0;
  out.reach = 0;
  return out;
}
