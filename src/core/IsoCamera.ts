import { OrthographicCamera, Vector2, Vector3 } from 'three';
import {
  CAMERA_DISTANCE,
  CAMERA_FOLLOW_HALF_LIFE,
  CAMERA_LOOK_AHEAD,
  CAMERA_MIN_VIEW_WIDTH,
  CAMERA_PITCH_DEGREES,
  CAMERA_VIEW_HEIGHT,
  CAMERA_YAW_DEGREES,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
  CAMERA_ZOOM_STEP,
} from './constants';
import { clamp, damp, DEG } from './mathUtils';
import { cameraOffset } from './cameraRig';
import { screenBasis } from './screenBasis';
import type { FrameContext } from './types';

/**
 * The Theme Park camera.
 *
 * An orthographic camera pinned at one fixed downward pitch and one fixed
 * compass angle, for the life of the app — see ARCHITECTURE.md, "One camera
 * angle, forever". Theme Park itself let you spin the view in 90° steps; this
 * park does not, so everything built into it is instead authored to read
 * correctly from this one angle. Orthographic (rather than perspective) is
 * what sells the classic look: parallel lines stay parallel, so the park
 * reads like a toy model rather than a first-person world.
 *
 * Movement input is interpreted through {@link forward} / {@link right} so
 * that "up" on the stick always means "up the screen" — a fixed rig still
 * needs a name for its own ground-plane axes, it just never has to recompute
 * them.
 */
export class IsoCamera {
  readonly camera: OrthographicCamera;

  /** Point the camera orbits. Damped towards the follow target every frame. */
  private readonly focus = new Vector3();
  private readonly desiredFocus = new Vector3();

  /**
   * Ground-plane basis vectors and the camera's fixed offset from its focus.
   * All three are solved once, here, from the one-and-only pitch and yaw —
   * the camera angle never changes again, so neither do these.
   */
  private readonly forwardVector: Vector3;
  private readonly rightVector: Vector3;
  private readonly offset: Vector3;

  private zoomValue = 1;
  private zoomTarget = 1;

  /**
   * Where the **world origin** sits on screen, in world units along the
   * screen's own two axes. See {@link skyAnchor}.
   */
  private readonly anchor = new Vector2();
  /** Scratch for the two screen-space axes read out of the camera's matrix. */
  private readonly screenRight = new Vector3();
  private readonly screenUp = new Vector3();

  private aspect = 1;
  /** CSS pixels — kept for {@link worldUnitsPerPixel}, screen-constant UI sizing. */
  private viewportHeight = 1;

  constructor() {
    const yaw = CAMERA_YAW_DEGREES * DEG;
    const pitch = CAMERA_PITCH_DEGREES * DEG;

    const offset = cameraOffset(yaw, pitch, CAMERA_DISTANCE);
    this.offset = new Vector3(offset.x, offset.y, offset.z);

    // The camera sits at +offset and looks back at the focus, so "into the
    // screen" is the negated horizontal part of that offset. Solved by the
    // shared `screenBasis` rather than inline, so the park, the dodgems rink
    // and the water-fight garden cannot drift into three different ideas of
    // which way "up on the stick" points — see `core/screenBasis.ts`, which
    // is also where the CONTROL RULE is written down.
    const basis = screenBasis(yaw);
    this.forwardVector = new Vector3(basis.upX, 0, basis.upZ);
    this.rightVector = new Vector3(basis.rightX, 0, basis.rightZ);

    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DISTANCE * 3);
    this.camera.position.copy(this.offset);
    this.applyFrustum();
  }

  /** Unit vector pointing "up the screen" along the ground. */
  get forward(): Readonly<Vector3> {
    return this.forwardVector;
  }

  /** Unit vector pointing "right on the screen" along the ground. */
  get right(): Readonly<Vector3> {
    return this.rightVector;
  }

  /** Current zoom, 1 = default framing. Larger = closer. */
  get zoom(): number {
    return this.zoomValue;
  }

  /**
   * The ground point the camera is orbiting — usually right on top of the
   * player. **Not** the camera's own position: this is an orthographic rig,
   * so the camera sits a fixed `CAMERA_DISTANCE` back at every zoom level,
   * and a straight-line distance to *that* would be roughly constant no
   * matter what is actually on screen. Anything checking "is this far from
   * what the camera is looking at" — a name label deciding whether to hide,
   * say — wants distance to this point instead.
   */
  get focusPoint(): Readonly<Vector3> {
    return this.focus;
  }

  /**
   * Half the height of the orthographic box, in world metres. Multiply a
   * screen-space offset measured in half-heights by this to get world metres,
   * or divide the other way — which is what the sky does with
   * {@link skyAnchor}.
   */
  get viewHalfHeight(): number {
    return this.camera.top;
  }

  /**
   * Where the world origin currently sits on screen, in **world metres along
   * the screen's own right and up axes**.
   *
   * In other words: how far the whole park has slid across the frame. It is
   * `(0,0)` when the camera is looking at the origin and grows as the player
   * walks away from it, and it is the only handle the sky has on where the
   * player is standing — see `world/Sky.setParallax`.
   *
   * Read straight off the camera's world matrix rather than by projecting a
   * point, because the orthographic projection would divide the answer back
   * out by the frustum size and the sky wants the metres, not the fraction.
   */
  get skyAnchor(): Readonly<Vector2> {
    return this.anchor;
  }

  /**
   * World units spanned by one CSS pixel of the canvas, at the current zoom.
   * Multiply a desired on-screen size (in CSS px) by this to get the world
   * scale that reads as that size regardless of zoom — see `ui/NameLabel.ts`.
   */
  get worldUnitsPerPixel(): number {
    return (this.camera.top - this.camera.bottom) / this.viewportHeight;
  }

  /** Snaps the camera straight to a position, skipping the follow smoothing. */
  snapTo(position: Vector3): void {
    this.focus.copy(position);
    this.desiredFocus.copy(position);
    this.applyTransform();
  }

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    this.viewportHeight = Math.max(1, height);
    this.applyFrustum();
  }

  /**
   * Asks for a zoom outright, rather than nudging from wherever it is.
   *
   * For a cutscene that has to frame something the ordinary follow-cam was
   * never sized for — the cat bus's arrival, whose subject is eighteen metres
   * long against a default framing built around a two-metre child. Damped by
   * {@link update} exactly like a pinch, so it eases rather than snapping.
   *
   * Safe to call every frame — but a caller that actually *owns* this value
   * for a while, the way the cat-bus arrival does, should call it only when
   * its own target changes, not on every tick: this is a plain assignment,
   * so calling it every frame for as long as some condition holds fights
   * `nudgeZoom` for that entire span, silently discarding every wheel notch,
   * pinch or +/- press a player makes in the meantime (#329) — the same trap
   * CLAUDE.md's `/view` note describes for `DayNight`'s own paused flag,
   * just one call removed. Re-asserting unconditionally is only safe once
   * nobody else may legitimately be nudging this same target.
   */
  setZoomTarget(zoom: number): void {
    this.zoomTarget = clamp(zoom, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
  }

  nudgeZoom(delta: number): void {
    this.zoomTarget = clamp(this.zoomTarget + delta, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
  }

  /**
   * Follows `target`, leaning slightly in the direction of travel so the player
   * can see a touch further ahead when they run.
   */
  update(context: FrameContext, target: Vector3, velocity: Vector3): void {
    const { dt, input } = context;

    if (input.justPressed('zoomIn')) this.nudgeZoom(CAMERA_ZOOM_STEP);
    if (input.justPressed('zoomOut')) this.nudgeZoom(-CAMERA_ZOOM_STEP);

    const previousZoom = this.zoomValue;
    this.zoomValue = damp(this.zoomValue, this.zoomTarget, 0.12, dt);
    if (Math.abs(this.zoomValue - previousZoom) > 1e-4) this.applyFrustum();

    this.desiredFocus
      .copy(target)
      .addScaledVector(velocity, CAMERA_LOOK_AHEAD)
      // Aim a little above the player's feet so they sit slightly low on screen,
      // leaving room to see what you are walking towards.
      .add(TEMP_LIFT);

    this.focus.x = damp(this.focus.x, this.desiredFocus.x, CAMERA_FOLLOW_HALF_LIFE, dt);
    this.focus.y = damp(this.focus.y, this.desiredFocus.y, CAMERA_FOLLOW_HALF_LIFE * 2, dt);
    this.focus.z = damp(this.focus.z, this.desiredFocus.z, CAMERA_FOLLOW_HALF_LIFE, dt);

    this.applyTransform();
  }

  private applyTransform(): void {
    this.camera.position.copy(this.focus).add(this.offset);
    this.camera.lookAt(this.focus);
    this.camera.updateMatrixWorld();

    // The world origin in view space is `-cameraPosition` resolved against the
    // camera's own right and up axes (columns 0 and 1 of its world matrix).
    // Two dot products, no matrix inverse, nothing allocated.
    this.screenRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.screenUp.setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.anchor.set(
      -this.camera.position.dot(this.screenRight),
      -this.camera.position.dot(this.screenUp),
    );
  }

  /**
   * Sizes the orthographic box.
   *
   * Framing is height-led — the same vertical slice of park on every machine —
   * but with a **minimum width**, because a portrait phone's aspect is under
   * 0.5 and height-led framing alone hands it a letterbox barely wider than the
   * fountain. When the floor bites, the view grows *taller* to keep the aspect
   * honest; nothing is ever stretched. The floor is applied before the zoom
   * divide, so pinching to zoom in still zooms in on a phone.
   */
  private applyFrustum(): void {
    const base = Math.max(CAMERA_VIEW_HEIGHT / 2, CAMERA_MIN_VIEW_WIDTH / 2 / this.aspect);
    const halfHeight = base / this.zoomValue;
    const halfWidth = halfHeight * this.aspect;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Clamps `point` so that a screen-constant sprite of the given half-extents
   * (world metres) centred on it stays fully inside the visible frustum, with
   * an optional world-unit `margin` on top.
   *
   * Written for {@link SpeechBubble} (QA on #280, PR #280 round 2: the
   * receptionist's greeting ran off the right edge of a 390×844 portrait
   * screen, clipped and unreadable — a world-space sprite pinned near its
   * speaker with no screen-space awareness at all). Kept here rather than on
   * the sprite's own class because the frustum and the screen axes are the
   * camera's own numbers — {@link screenRight}/{@link screenUp} are already
   * solved once a frame in {@link applyTransform} for {@link skyAnchor}, and a
   * second place computing its own idea of "which way is right on screen"
   * is exactly the class of bug CLAUDE.md's "two definitions of one thing"
   * warns about. General on purpose — any screen-constant sprite can call
   * this, not only a speech bubble: the fix is a camera capability, not a
   * patch on one caller.
   *
   * Degrades gracefully — clamping to the frustum's own centre — for a
   * sprite too large to fit even centred, rather than an inverted range.
   */
  clampToFrustum(point: Readonly<Vector3>, halfWidth: number, halfHeight: number, margin = 0): Vector3 {
    const relative = SCRATCH_CLAMP_RELATIVE.copy(point).sub(this.camera.position);
    const right = relative.dot(this.screenRight);
    const up = relative.dot(this.screenUp);

    const maxRight = Math.max(0, this.camera.right - halfWidth - margin);
    const maxUp = Math.max(0, this.camera.top - halfHeight - margin);
    const clampedRight = clamp(right, -maxRight, maxRight);
    const clampedUp = clamp(up, -maxUp, maxUp);

    // A fresh Vector3, not a shared scratch: this is the caller's return
    // value, and a second clampToFrustum call later the same frame (a second
    // bubble) must not silently overwrite a reference the first caller is
    // still holding.
    return point
      .clone()
      .addScaledVector(this.screenRight, clampedRight - right)
      .addScaledVector(this.screenUp, clampedUp - up);
  }
}

// Raised with the closer framing: the aim point wants to sit around chest height
// on the character, and the character's chest went up when her head did.
const TEMP_LIFT = new Vector3(0, 1.25, 0);

// Scratch vector for clampToFrustum's own intermediate maths — discarded
// before the method returns, so safe to share across calls.
const SCRATCH_CLAMP_RELATIVE = new Vector3();
