import { Matrix4, OrthographicCamera, Quaternion, Vector3 } from 'three';
import {
  CAMERA_DISTANCE,
  CAMERA_FOLLOW_HALF_LIFE,
  CAMERA_LOOK_AHEAD,
  CAMERA_MIN_VIEW_WIDTH,
  CAMERA_PITCH_DEGREES,
  CAMERA_ROTATE_DURATION,
  CAMERA_VIEW_HEIGHT,
  CAMERA_YAW_DEGREES,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
  CAMERA_ZOOM_STEP,
} from './constants';
import { clamp, damp, DEG, lerp, smoothstep } from './mathUtils';
import type { FrameContext } from './types';

/** How long the camera takes to swoop into, or back out of, an inspected sign. */
const INSPECT_ENTER_SECONDS = 0.55;
const INSPECT_EXIT_SECONDS = 0.45;

/** How far in front of a sign the inspect camera stands, along its facing normal. */
const INSPECT_DISTANCE = 4.4;

/**
 * The sign's own width/height is doubled and a bit, so the board reads with a
 * little breathing room rather than pressed against the edges of the screen.
 */
const INSPECT_FILL = 0.8;

const UP = new Vector3(0, 1, 0);

/**
 * The Theme Park camera.
 *
 * An orthographic camera pinned at a fixed downward pitch, looking at the player
 * from a fixed compass angle. Orthographic (rather than perspective) is what
 * sells the classic look: parallel lines stay parallel, so the park reads like a
 * toy model rather than a first-person world. The player can spin the view in
 * 90° steps — exactly what Theme Park allowed — but never tumble it freely,
 * which keeps the world legible for a six-year-old.
 *
 * Movement input is interpreted through {@link forward} / {@link right} so that
 * "up" on the stick always means "up the screen", whichever way the view faces.
 */
export class IsoCamera {
  readonly camera: OrthographicCamera;

  /** Point the camera orbits. Damped towards the follow target every frame. */
  private readonly focus = new Vector3();
  private readonly desiredFocus = new Vector3();
  private readonly offset = new Vector3();

  /** Ground-plane basis vectors, recomputed whenever the yaw changes. */
  private readonly forwardVector = new Vector3(0, 0, -1);
  private readonly rightVector = new Vector3(1, 0, 0);

  private yaw = CAMERA_YAW_DEGREES * DEG;
  private yawFrom = this.yaw;
  private yawTo = this.yaw;
  private yawTimer = 1;

  private zoomValue = 1;
  private zoomTarget = 1;

  private aspect = 1;
  /** CSS pixels — kept for {@link worldUnitsPerPixel}, screen-constant UI sizing. */
  private viewportHeight = 1;

  // --- "inspect a sign" mode -----------------------------------------------
  // A temporary, tweened override of the whole transform: the follow rig above
  // is left completely alone (its `focus`/`yaw`/`zoomValue` keep whatever they
  // had when the inspection began) so that ending an inspection can tween
  // straight back to exactly where normal play would have left the camera.
  private inspecting = false;
  private inspectExiting = false;
  private inspectT = 1;
  private readonly inspectFromPos = new Vector3();
  private readonly inspectFromQuat = new Quaternion();
  private inspectFromHalfHeight = 1;
  private inspectFromHalfWidth = 1;
  private readonly inspectToPos = new Vector3();
  private readonly inspectToQuat = new Quaternion();
  private inspectToHalfHeight = 1;
  private inspectToHalfWidth = 1;
  private inspectSign: { yaw: number; width: number; height: number } | null = null;
  private readonly tmpMatrix = new Matrix4();
  private readonly tmpQuat = new Quaternion();
  private readonly tmpVec = new Vector3();
  /**
   * `context.dt` is zeroed while the park is paused (see `Game.tick`), which
   * inspecting deliberately leans on to freeze the player — but the swoop
   * itself still has to move. `context.elapsed` is never zeroed, so the
   * inspect tween drives itself off a delta measured from that instead.
   */
  private lastElapsed = 0;

  constructor() {
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DISTANCE * 3);
    this.camera.position.set(0, CAMERA_DISTANCE, CAMERA_DISTANCE);
    this.updateBasis();
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
   * World units spanned by one CSS pixel of the canvas, at the current zoom.
   * Multiply a desired on-screen size (in CSS px) by this to get the world
   * scale that reads as that size regardless of zoom — see `ui/NameLabel.ts`.
   */
  get worldUnitsPerPixel(): number {
    return (this.camera.top - this.camera.bottom) / this.viewportHeight;
  }

  /** True while the camera is swooping into, holding on, or swooping back from an inspected sign. */
  get isInspecting(): boolean {
    return this.inspecting;
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
    if (this.inspecting && this.inspectSign) {
      // A phone rotation mid-inspect changes the aspect the board has to fill;
      // recompute the *target* framing so the very next frame's tween (or
      // held pose, if it had already settled) picks up the new aspect.
      const framing = this.inspectFrustum(this.inspectSign.width, this.inspectSign.height);
      this.inspectToHalfHeight = framing.halfHeight;
      this.inspectToHalfWidth = framing.halfWidth;
      return;
    }
    this.applyFrustum();
  }

  /**
   * Swoops the camera to face a sign head-on and zoom so it fills the frame,
   * suspending the normal follow camera. Safe to call again while already
   * inspecting — a tap on a different sign just retargets the tween from
   * wherever the camera currently is, which is what makes "switch to it"
   * work without a special case.
   *
   * `x, y, z` is the sign's own world position (its geometric centre is a fine
   * aim point), `yaw` its facing (0 looks down +Z, the same convention every
   * prop in the park uses), `width`/`height` its board size in metres.
   */
  beginInspect(x: number, y: number, z: number, yaw: number, width: number, height: number): void {
    this.captureCurrentPose(this.inspectFromPos, this.inspectFromQuat);
    this.inspectFromHalfHeight = this.camera.top;
    this.inspectFromHalfWidth = this.camera.right;

    this.tmpVec.set(Math.sin(yaw), 0, Math.cos(yaw));
    this.inspectToPos.set(x, y, z).addScaledVector(this.tmpVec, INSPECT_DISTANCE);
    // `tmpVec` held the facing normal; reuse it as the look-at target now that
    // `inspectToPos` has already been computed from it.
    this.tmpMatrix.lookAt(this.inspectToPos, this.tmpVec.set(x, y, z), UP);
    this.inspectToQuat.setFromRotationMatrix(this.tmpMatrix);

    const framing = this.inspectFrustum(width, height);
    this.inspectToHalfHeight = framing.halfHeight;
    this.inspectToHalfWidth = framing.halfWidth;

    this.inspectSign = { yaw, width, height };
    this.inspecting = true;
    this.inspectExiting = false;
    this.inspectT = 0;
  }

  /** Swoops back to normal play. Harmless if not currently inspecting. */
  endInspect(): void {
    if (!this.inspecting || this.inspectExiting) return;
    this.captureCurrentPose(this.inspectFromPos, this.inspectFromQuat);
    this.inspectFromHalfHeight = this.camera.top;
    this.inspectFromHalfWidth = this.camera.right;

    this.computeRestPose(this.inspectToPos, this.inspectToQuat);
    const base = Math.max(CAMERA_VIEW_HEIGHT / 2, CAMERA_MIN_VIEW_WIDTH / 2 / this.aspect);
    this.inspectToHalfHeight = base / this.zoomValue;
    this.inspectToHalfWidth = this.inspectToHalfHeight * this.aspect;

    this.inspectExiting = true;
    this.inspectT = 0;
  }

  /** Begins a 90° rotation. Ignored while a previous rotation is in flight. */
  rotate(steps: number): void {
    if (this.yawTimer < 1) return;
    this.yawFrom = this.yaw;
    this.yawTo = this.yaw + (Math.PI / 2) * steps;
    this.yawTimer = 0;
  }

  nudgeZoom(delta: number): void {
    this.zoomTarget = clamp(this.zoomTarget + delta, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
  }

  /**
   * Follows `target`, leaning slightly in the direction of travel so the player
   * can see a touch further ahead when they run.
   */
  update(context: FrameContext, target: Vector3, velocity: Vector3): void {
    const { dt, elapsed, input } = context;
    const realDt = Math.max(0, elapsed - this.lastElapsed);
    this.lastElapsed = elapsed;

    if (this.inspecting) {
      const duration = this.inspectExiting ? INSPECT_EXIT_SECONDS : INSPECT_ENTER_SECONDS;
      this.inspectT = Math.min(1, this.inspectT + realDt / duration);
      const t = smoothstep(0, 1, this.inspectT);

      this.camera.position.lerpVectors(this.inspectFromPos, this.inspectToPos, t);
      this.tmpQuat.copy(this.inspectFromQuat).slerp(this.inspectToQuat, t);
      this.camera.quaternion.copy(this.tmpQuat);
      this.camera.updateMatrixWorld();

      this.camera.top = lerp(this.inspectFromHalfHeight, this.inspectToHalfHeight, t);
      this.camera.bottom = -this.camera.top;
      this.camera.right = lerp(this.inspectFromHalfWidth, this.inspectToHalfWidth, t);
      this.camera.left = -this.camera.right;
      this.camera.updateProjectionMatrix();

      if (this.inspectT >= 1 && this.inspectExiting) {
        this.inspecting = false;
        this.inspectExiting = false;
        this.inspectSign = null;
      }
      return;
    }

    if (input.justPressed('cameraLeft')) this.rotate(1);
    if (input.justPressed('cameraRight')) this.rotate(-1);
    if (input.justPressed('zoomIn')) this.nudgeZoom(CAMERA_ZOOM_STEP);
    if (input.justPressed('zoomOut')) this.nudgeZoom(-CAMERA_ZOOM_STEP);

    if (this.yawTimer < 1) {
      this.yawTimer = Math.min(1, this.yawTimer + dt / CAMERA_ROTATE_DURATION);
      // Smoothstep gives the turn a gentle start and stop; a linear snap felt
      // mechanical next to everything else in the park.
      const t = smoothstep(0, 1, this.yawTimer);
      this.yaw = this.yawFrom + (this.yawTo - this.yawFrom) * t;
      this.updateBasis();
    }

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

  /** The pose (position + orientation) the follow rig would rest at right now. */
  private computeRestPose(pos: Vector3, quat: Quaternion): void {
    const pitch = CAMERA_PITCH_DEGREES * DEG;
    const horizontal = Math.cos(pitch) * CAMERA_DISTANCE;
    pos.set(
      this.focus.x + Math.sin(this.yaw) * horizontal,
      this.focus.y + Math.sin(pitch) * CAMERA_DISTANCE,
      this.focus.z + Math.cos(this.yaw) * horizontal,
    );
    this.tmpMatrix.lookAt(pos, this.focus, UP);
    quat.setFromRotationMatrix(this.tmpMatrix);
  }

  /** Snapshots wherever the camera is *right now*, mid-tween or not — the starting pose for a new tween. */
  private captureCurrentPose(pos: Vector3, quat: Quaternion): void {
    pos.copy(this.camera.position);
    quat.copy(this.camera.quaternion);
  }

  /**
   * The orthographic half-extents that make a `width` x `height` board fill
   * most of the frame, with a little breathing room — see {@link INSPECT_FILL}.
   */
  private inspectFrustum(width: number, height: number): { halfHeight: number; halfWidth: number } {
    const halfHeight = Math.max(height, 0.4) / (2 * INSPECT_FILL);
    const halfWidth = Math.max(halfHeight * this.aspect, Math.max(width, 0.4) / (2 * INSPECT_FILL));
    return { halfHeight, halfWidth };
  }

  private applyTransform(): void {
    const pitch = CAMERA_PITCH_DEGREES * DEG;
    const horizontal = Math.cos(pitch) * CAMERA_DISTANCE;
    this.offset.set(
      Math.sin(this.yaw) * horizontal,
      Math.sin(pitch) * CAMERA_DISTANCE,
      Math.cos(this.yaw) * horizontal,
    );
    this.camera.position.copy(this.focus).add(this.offset);
    this.camera.lookAt(this.focus);
    this.camera.updateMatrixWorld();
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

  private updateBasis(): void {
    // The camera sits at +offset and looks back at the focus, so "into the
    // screen" is the negated horizontal part of that offset.
    this.forwardVector.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    this.rightVector.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
  }
}

// Raised with the closer framing: the aim point wants to sit around chest height
// on the character, and the character's chest went up when her head did.
const TEMP_LIFT = new Vector3(0, 1.25, 0);
