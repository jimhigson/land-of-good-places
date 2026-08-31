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
   * A fixed world point the camera orbits instead of the ordinary follow
   * target, or `null` when nothing is overriding it — see {@link
   * setFocusOverride}.
   */
  private focusOverrideActive = false;
  private readonly focusOverrideValue = new Vector3();

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

  /** Half the width of the orthographic box, in world metres. */
  get viewHalfWidth(): number {
    return this.camera.right;
  }

  /**
   * "Right on screen" as three.js itself resolved it, straight off the camera's
   * world matrix — the ground truth `core/screenBasis.ts`'s analytic
   * `screenBasis3D` is checked against. Live for the current frame; do not hold
   * a reference across one.
   */
  get screenRightAxis(): Readonly<Vector3> {
    return this.screenRight;
  }

  /** "Up on screen" as three.js resolved it — see {@link screenRightAxis}. */
  get screenUpAxis(): Readonly<Vector3> {
    return this.screenUp;
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

  /** What {@link zoom} is damping towards — read this, not `zoom` itself, to
   *  save a caller's own zoom before overriding it (`Game.tick`'s keychain-shop
   *  wiring does exactly this), since `zoom` may still be mid-transition. */
  get targetZoom(): number {
    return this.zoomTarget;
  }

  /**
   * Overrides what the camera orbits with a fixed world point, in place of
   * the ordinary player-follow target — for a moment like the keychain rack's
   * zoomed-in picker (#331), where the thing to frame is a fixed spot in the
   * world rather than the player. Damped by {@link update} exactly like the
   * ordinary follow, so entering and leaving eases rather than snaps.
   *
   * **Re-assert every frame while it should hold**, exactly as {@link
   * setZoomTarget} already asks its own callers to: `Game.tick()` re-derives
   * the whole world's state every frame and would otherwise silently
   * overwrite this the moment something stopped calling it (CLAUDE.md's
   * `/view` note is this same trap, biting someone else first).
   */
  setFocusOverride(point: Readonly<Vector3>): void {
    this.focusOverrideValue.copy(point);
    this.focusOverrideActive = true;
  }

  /** Hands the follow back to the ordinary player target. */
  clearFocusOverride(): void {
    this.focusOverrideActive = false;
  }

  /**
   * Follows `target`, leaning slightly in the direction of travel so the player
   * can see a touch further ahead when they run.
   */
  update(context: FrameContext, target: Vector3, velocity: Vector3): void {
    const { dt, input } = context;

    // Manual pinch/scroll zoom is ignored while a shot is holding its own
    // framing — it would only be overwritten by the next re-asserted
    // `setZoomTarget` a moment later anyway, but reading it here too would
    // mean the frustum visibly jitters for that one frame first.
    if (!this.focusOverrideActive) {
      if (input.justPressed('zoomIn')) this.nudgeZoom(CAMERA_ZOOM_STEP);
      if (input.justPressed('zoomOut')) this.nudgeZoom(-CAMERA_ZOOM_STEP);
    }

    const previousZoom = this.zoomValue;
    this.zoomValue = damp(this.zoomValue, this.zoomTarget, 0.12, dt);
    if (Math.abs(this.zoomValue - previousZoom) > 1e-4) this.applyFrustum();

    if (this.focusOverrideActive) {
      // No look-ahead, no chest-height lift: those are about a walking
      // player, and the override's own point is already exactly where it
      // wants the camera to orbit.
      this.desiredFocus.copy(this.focusOverrideValue);
    } else {
      this.desiredFocus
        .copy(target)
        .addScaledVector(velocity, CAMERA_LOOK_AHEAD)
        // Aim a little above the player's feet so they sit slightly low on screen,
        // leaving room to see what you are walking towards.
        .add(TEMP_LIFT);
    }

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
   * Half the height of the orthographic box **at zoom 1**, for the viewport
   * this camera is currently sized to.
   *
   * Framing is height-led — the same vertical slice of park on every machine —
   * but with a **minimum width**, because a portrait phone's aspect is under
   * 0.5 and height-led framing alone hands it a letterbox barely wider than the
   * fountain. When the floor bites, the view grows *taller* to keep the aspect
   * honest; nothing is ever stretched.
   *
   * Its own method, rather than a line inside {@link applyFrustum}, because
   * {@link zoomToFit} has to invert it and a second copy of this `max` is
   * exactly the "two definitions of one thing" CLAUDE.md warns about — a
   * hand-kept copy would drift the moment either constant moved, and the
   * symptom would be a shot that frames correctly on the machine it was
   * checked on and clips somewhere else.
   */
  private frustumBase(): number {
    return Math.max(CAMERA_VIEW_HEIGHT / 2, CAMERA_MIN_VIEW_WIDTH / 2 / this.aspect);
  }

  /**
   * **The zoom at which a content box of these half-extents fits the frame** —
   * screen-space metres along {@link screenRightAxis}/{@link screenUpAxis}
   * (`core/screenBasis.ts`'s `screenBasis3D` is the same pair, solved
   * analytically for anything without a live camera to ask), measured about
   * whatever point the shot is focused on — with `margin` as a fraction of the
   * content left clear around it.
   *
   * For a shot that must *contain* something rather than sit at a distance
   * somebody liked once. Issue #418 is what this is for: the keyring rack held
   * a zoom constant tuned by eye against a desktop screenshot, and on a 390×844
   * phone in portrait two of the six keyrings sat outside the frame entirely —
   * a child being asked to choose between things she cannot see.
   *
   * **Why this cannot be a constant, however carefully chosen.** Width and
   * height do not get worse on the same screen. From {@link frustumBase}, at a
   * given zoom `halfWidth = max(H/2 · aspect, MINW/2) / zoom` and
   * `halfHeight = max(H/2, MINW/2 / aspect) / zoom`. So the *width* floor bites
   * on a narrow screen and the *height* floor on a wide one: any single number
   * is slack on one and short on the other. Asking the live camera — which
   * knows its own aspect, because {@link resize} told it — is the only answer
   * that is right on both. It also means a child rotating her phone reframes
   * the shot for free, with nothing to invalidate.
   *
   * Returns an unclamped ideal; {@link setZoomTarget} applies
   * `CAMERA_ZOOM_MIN`/`CAMERA_ZOOM_MAX`. Callers that need to know whether the
   * fit was actually achievable should compare against those themselves.
   */
  zoomToFit(halfWidth: number, halfHeight: number, margin: number): number {
    const base = this.frustumBase();
    const wanted = 1 + margin;
    // `base * aspect` is the frame's own half-width at zoom 1, so each ratio is
    // "how much closer than zoom 1 may I go and still contain this axis".
    const byWidth = (base * this.aspect) / Math.max(halfWidth * wanted, 1e-6);
    const byHeight = base / Math.max(halfHeight * wanted, 1e-6);
    return Math.min(byWidth, byHeight);
  }

  /** Sizes the orthographic box. See {@link frustumBase} for the framing rule. */
  private applyFrustum(): void {
    const base = this.frustumBase();
    const halfHeight = base / this.zoomValue;
    const halfWidth = halfHeight * this.aspect;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  /**
   * How far `to` sits from `from` **along the screen's own right and up axes**,
   * in world metres, written into `out` as `(right, up)`.
   *
   * The camera is tilted, so a sprite nudged straight up the screen also moves
   * in world x and z: a check asking "is this bubble still over that child"
   * cannot answer it with a horizontal distance, and one that tried would be
   * measuring a mixture of both axes — a metre of world x carries −0.44 of
   * screen-up at 390×844. Same reasoning as {@link clampToFrustum}: the screen
   * axes are the camera's, and there is one copy of them.
   */
  screenOffset(from: Readonly<Vector3>, to: Readonly<Vector3>, out: Vector2): Vector2 {
    const relative = SCRATCH_CLAMP_RELATIVE.copy(to).sub(from);
    return out.set(relative.dot(this.screenRight), relative.dot(this.screenUp));
  }

  /**
   * Whether `point` itself falls inside the visible frustum, shrunk by an
   * optional world-unit `margin`.
   *
   * The companion to {@link clampToFrustum}, and the reason it is safe to use
   * — issue #415. The clamp will happily drag a sprite anchored to somebody
   * standing well off the side of the screen all the way back to the frustum's
   * edge, and then draw it there over empty park: a measured 6.8 m between an
   * "I'm going to The Castle" bubble and the child it belonged to, with the
   * child not on screen at all. A caller that clamps must first ask this
   * whether the thing it is anchored to is even in shot; with the anchor
   * inside, the clamp can move a sprite by at most its own half-extents, which
   * is the small nudge #280 asked for and nothing more.
   *
   * Here rather than on the caller for the same reason as the clamp: the
   * screen axes are the camera's own numbers.
   *
   * **Fails open on a camera that has never been aimed.**
   * {@link screenRight}/{@link screenUp} are zero vectors until the first
   * {@link applyTransform}, and the constructor runs only
   * {@link applyFrustum} — so before any `update` or `snapTo` this answers
   * `true` for everything. Long-standing and equally true of
   * {@link clampToFrustum}, which merely declined to move anything; it is
   * called out here because this method decides *visibility*, so the failure
   * mode is a sprite drawn where it should not be rather than one left alone.
   * Both `Game` and `check:speech-bubbles` `snapTo` at boot, so nothing in the
   * game reaches it — a new caller that aims the camera later must not.
   */
  isOnScreen(point: Readonly<Vector3>, margin = 0): boolean {
    const relative = SCRATCH_CLAMP_RELATIVE.copy(point).sub(this.camera.position);
    return (
      Math.abs(relative.dot(this.screenRight)) <= this.camera.right - margin &&
      Math.abs(relative.dot(this.screenUp)) <= this.camera.top - margin
    );
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
   * **Bound it with {@link isOnScreen}.** On its own this will drag a sprite
   * anchored to somebody far off the side of the screen all the way back to
   * the frustum's edge and leave it there, which is issue #415. A caller must
   * first ask whether what it is anchored to is even in shot.
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
