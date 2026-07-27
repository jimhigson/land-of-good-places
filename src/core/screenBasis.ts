/**
 * Which way is "up the screen", on the ground.
 *
 * ---------------------------------------------------------------------------
 * THE CONTROL RULE (GAME_DESIGN.md, absolute, applies everywhere)
 * ---------------------------------------------------------------------------
 * **Never tank controls.** Pressing a direction means "go that way", not
 * "rotate towards that way". A six-year-old presses left because she wants to
 * go left, and should go left immediately.
 *
 * **Rotation controls are permitted ONLY in first person** — the ferris
 * wheel's look-around, and the first-person train and coaster that are coming.
 * Nowhere else, in any ride or mode, now or in future.
 *
 * In practice that means every scene where you drive or walk something obeys
 * the same three steps:
 *
 * 1. Read the stick/keys/thumb as a **screen-space** direction: `x` right,
 *    `y` **up the screen**. Never entity-relative — nothing the player is
 *    steering may be part of the sum that decides which way "left" is.
 * 2. Turn that into a world direction through this module, using the yaw of
 *    *that scene's* camera.
 * 3. Push the thing along that direction, and let the model turn to face
 *    however it ends up travelling. The facing is decoration; it must never
 *    be an input to where the next push goes.
 *
 * ---------------------------------------------------------------------------
 * Why this module exists
 * ---------------------------------------------------------------------------
 * The basis is four numbers of trigonometry that three separate cameras (the
 * park, the dodgems rink, the water-fight garden) each used to derive for
 * themselves. Deriving it correctly is fiddly — get one sign wrong and the
 * controls are mirrored — so it is derived **once**, here, and every scene
 * asks. A new scene that wants to steer something has one obvious thing to
 * call, and cannot invent a fifth convention.
 *
 * ---------------------------------------------------------------------------
 * A basis belongs to a yaw, not to a scene — do not cache one blindly
 * ---------------------------------------------------------------------------
 * Solve the basis wherever the yaw is *decided*, and solve it again whenever
 * that yaw changes. Some cameras here really are fixed: the park's `IsoCamera`
 * yaw is a module constant, and so is the dodgems rink's, so both solve once
 * and read the result for ever.
 *
 * **But not every camera is fixed.** The water-fight garden reframes between
 * landscape and portrait, swinging from 45° to 88° (`WaterFight.ts`,
 * `LANDSCAPE_YAW`/`PORTRAIT_YAW`), so it re-solves inside `resize()` — a child
 * turning a phone sideways mid-fight rotates the camera, and a basis cached at
 * construction would then be pointing the wrong way while she is still
 * pressing the same direction.
 *
 * So: a basis is only valid for the yaw it was solved from. Cache it only
 * where the yaw is provably constant, and re-derive on every camera or
 * viewport change anywhere it is not.
 *
 * ---------------------------------------------------------------------------
 * The maths, so nobody has to re-derive it
 * ---------------------------------------------------------------------------
 * Every camera in this game sits at `focus + (sin(yaw)·h, height, cos(yaw)·h)`
 * and looks back at its focus. So:
 *
 * - **Up the screen** is the way the camera is looking, flattened onto the
 *   ground: `(-sin yaw, -cos yaw)`.
 * - **Right on the screen** is three.js's own `lookAt` basis, `cross(worldUp,
 *   eye - target)`, flattened: `(cos yaw, -sin yaw)`.
 *
 * Note the trap that has caught agents before: a three.js object turns **left**
 * as its `rotation.y` increases. That is why yaw-as-a-heading (this file, and
 * anything that faces a direction of travel) uses `atan2(x, z)` — which
 * increases anticlockwise about +Y, exactly matching `rotation.y` — while a
 * first-person *camera* look control has to negate its drag to turn the way a
 * head expects. Movement never needs that negation, because movement is
 * expressed as a vector, not an angle.
 */

/**
 * A camera's ground-plane axes, as solved by {@link screenBasis} for one yaw.
 * Only valid for that yaw — re-solve if the camera can turn (see above).
 */
export interface ScreenBasis {
  /** Unit vector pointing right on the screen, along the ground. */
  readonly rightX: number;
  readonly rightZ: number;
  /** Unit vector pointing up the screen, along the ground. */
  readonly upX: number;
  readonly upZ: number;
}

/** Solves the ground-plane axes for a camera at compass angle `yaw` (radians). */
export function screenBasis(yaw: number): ScreenBasis {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return { rightX: cos, rightZ: -sin, upX: -sin, upZ: -cos };
}

/**
 * World X of a screen-space direction — `x` right, `y` up the screen.
 *
 * Paired with {@link screenToWorldZ}. Two scalars rather than a vector because
 * this is called every frame, for every steerable thing, and neither caller
 * wants an allocation for it.
 */
export function screenToWorldX(basis: ScreenBasis, x: number, y: number): number {
  return basis.rightX * x + basis.upX * y;
}

/** World Z of a screen-space direction — see {@link screenToWorldX}. */
export function screenToWorldZ(basis: ScreenBasis, x: number, y: number): number {
  return basis.rightZ * x + basis.upZ * y;
}
