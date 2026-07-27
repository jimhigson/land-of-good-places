/**
 * Where a camera sits relative to what it is looking at.
 *
 * Every fixed-angle camera in this game — the park, the dodgems rink, the
 * water-fight garden, the rail racer — is the same rig: an orthographic camera
 * pushed `distance` back from its focus along a compass angle `yaw`, pitched
 * `pitch` down at it. The offset is three lines of trigonometry, and it was
 * written out by hand in all four, which is three chances to get a sign wrong
 * and no way to tell that any of them had.
 *
 * ```
 * horizontal = cos(pitch) · distance
 * offset     = (sin(yaw) · horizontal,  sin(pitch) · distance,  cos(yaw) · horizontal)
 * ```
 *
 * `core/screenBasis.ts` derives the ground-plane axes the controls are read
 * through **from this exact placement** — its doc comment opens by stating it.
 * The two must agree, so change neither without the other.
 *
 * The pitch and yaw are not shared, only the arithmetic: the park's are
 * `CAMERA_PITCH_DEGREES` / `CAMERA_YAW_DEGREES` in `core/constants.ts`, but the
 * rink looks down harder, the rail racer is nearly side-on, and the water fight
 * swings its yaw between a landscape and a portrait framing.
 */

/** A camera's position relative to its focus point. */
export interface CameraOffset {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The eye offset for a camera `distance` back at compass angle `yaw`, pitched
 * `pitch` down. Both angles in radians; the result is in metres, relative to
 * the focus — add the focus point to get a world position.
 *
 * Returns a plain object rather than a `Vector3` so this module stays free of
 * three.js and can be reasoned about (and tested) as pure arithmetic. It is
 * called when a camera is built or reframed, never per frame, so the object
 * costs nothing worth avoiding.
 */
export function cameraOffset(yaw: number, pitch: number, distance: number): CameraOffset {
  const horizontal = Math.cos(pitch) * distance;
  return {
    x: Math.sin(yaw) * horizontal,
    y: Math.sin(pitch) * distance,
    z: Math.cos(yaw) * horizontal,
  };
}
