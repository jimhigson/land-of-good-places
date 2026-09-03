import { OrthographicCamera, Vector2, Vector3 } from 'three';
import {
  CAMERA_DISTANCE,
  CAMERA_FOLLOW_HALF_LIFE,
  CAMERA_LOOK_AHEAD,
  CAMERA_LOOK_MAX_DISTANCE,
  CAMERA_LOOK_RETURN_DELAY,
  CAMERA_LOOK_RETURN_HALF_LIFE,
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
import type { ParkBoundary } from '../world/boundary';

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
   * {@link focus} plus {@link lookOffset} — the point actually on screen, and
   * what {@link applyTransform} places the camera over.
   *
   * Two points rather than one because the follow and the look-around must not
   * eat each other. `focus` stays the pure damped follow: if the drag were
   * folded into it, the very next frame's damp towards `desiredFocus` would
   * start hauling the pan back immediately, and dragging would feel like
   * fighting a rubber band that only lets go when you stop. Kept apart, the
   * drag is exactly 1:1 with the finger and the follow keeps working
   * underneath it, so a child dragged out to look at the coaster still sees the
   * view slide as she walks.
   */
  private readonly viewFocus = new Vector3();

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

  /**
   * **How far the camera currently sits from its normal pseudo-isometric
   * pose** — a delta in metres, damped to zero, added on top of
   * {@link offset} rather than replacing it.
   *
   * This is what lets a shot sit lower and flatter than the rig and then
   * *rise* back into it, which is the cat bus arrival's third beat: Jim, on
   * the arrival, *"once through the arch the camera moves up to its usual
   * pseudo-isometric perspective."*
   *
   * **A delta, and never a second pose.** `offset` stays the one owner of
   * where the camera lives; nothing here writes a pitch or a distance down a
   * second time, and the rise cannot land somewhere near-but-not-quite home
   * because "home" is this reaching exactly zero. Two definitions of the
   * camera's resting place kept in step by hand is the bug this repo has paid
   * for more than any other.
   */
  private readonly poseOffset = new Vector3();
  private readonly poseTarget = new Vector3();
  private readonly focusOverrideValue = new Vector3();

  /**
   * How far the view has been dragged from her, in world metres on the ground
   * plane — "drag to look around the park" (#419).
   *
   * **A bounded offset from her own camera, never a free camera.** The rig's
   * pitch and yaw are untouched by all of this: panning *translates* the point
   * the camera orbits and nothing else, so ARCHITECTURE.md's "one camera angle,
   * forever" still holds, `screenBasis` is untouched, and "up the screen" means
   * the same thing whether or not the view has been dragged. That is also what
   * makes this safe against GAME_DESIGN.md's CONTROL RULE: there is no rotation
   * anywhere in it, so a drag cannot become a way to steer even in principle —
   * pressing left still goes left, and a tap still walks.
   */
  private readonly lookOffset = new Vector3();
  /**
   * Seconds since the last drag delta arrived, counted in frame `dt`. Once it
   * passes {@link CAMERA_LOOK_RETURN_DELAY} the offset damps home.
   */
  private lookIdleSeconds = 0;
  /**
   * The leash for where the view may be dragged to: the play bounds of the
   * space she is standing in. `null` means "unbounded", for a caller that has
   * none — see {@link setLookBounds}.
   */
  private lookBounds: ParkBoundary | null = null;

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

  /**
   * `sin(pitch)` — how much of a ground-plane metre along {@link forward}
   * survives as vertical screen distance once the camera is tilted down.
   *
   * At the rig's 38° that is 0.62, so a metre walked "up the screen" only
   * climbs 0.62 m worth of frame. A drag has to divide by it to keep the park
   * exactly under the finger: without it, dragging vertically moves the world
   * 38% *less* than the finger and the park visibly slips, which is the one
   * thing that makes a direct-manipulation gesture feel broken. Solved once,
   * with the rest of the rig, because the pitch never changes again.
   */
  private readonly pitchSine: number;

  constructor() {
    const yaw = CAMERA_YAW_DEGREES * DEG;
    const pitch = CAMERA_PITCH_DEGREES * DEG;
    this.pitchSine = Math.sin(pitch);

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
    // `viewFocus`, not `focus`: this answers "what is the camera looking at",
    // and while the view is dragged out to look around the park (#419) that is
    // the follow point *plus* the drag. A name label deciding whether it is
    // near enough to show should hide when it leaves the screen, wherever the
    // screen currently is.
    return this.viewFocus;
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
    // A snap is a change of *place* — through a door, out of a ride, in from
    // the title screen — and every one of them happens behind a closed iris.
    // Carrying a look-around offset across it would open that iris on a view
    // shoved sideways from wherever she has just arrived, which in the castle
    // is precisely the empty sky this feature must never show.
    this.cancelLook();
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
   * Tilts the camera to `pitchDegrees` instead of the rig's own
   * {@link CAMERA_PITCH_DEGREES}, keeping its yaw and its distance.
   *
   * Stored as the **difference** from the normal pose, so
   * {@link clearPoseOverride} needs no memory of what the normal pose was and
   * cannot restore a stale copy of it. Damped by {@link update} on the
   * look-around's own return curve, so both entering and leaving are a move
   * rather than a cut.
   *
   * Cheap enough to call every frame, but there is no reason to: like
   * {@link setZoomTarget} this is a plain assignment, so a caller should write
   * it when its own decision changes. Unlike `setZoomTarget` nothing else in
   * the game competes for this value, so re-asserting it is merely wasteful
   * rather than a way to eat a player's input.
   */
  setPoseOverride(pitchDegrees: number): void {
    const low = cameraOffset(CAMERA_YAW_DEGREES * DEG, pitchDegrees * DEG, CAMERA_DISTANCE);
    this.poseTarget.set(low.x - this.offset.x, low.y - this.offset.y, low.z - this.offset.z);
  }

  /** Rises back to the ordinary pseudo-isometric pose. */
  clearPoseOverride(): void {
    this.poseTarget.set(0, 0, 0);
  }

  /**
   * How far the camera still is from its normal pose, in metres — 0 once the
   * rise has actually landed.
   *
   * Read by `scripts/check-arrival-camera.mts` to prove the hand-over into
   * ordinary play ends on the rig's own pose exactly, rather than near it.
   * Nothing in the game needs it.
   */
  get poseDistance(): number {
    return this.poseOffset.length();
  }

  // -------------------------------------------------- drag to look around

  /**
   * How far the view is currently dragged from her, in metres. Read by the
   * check in `scripts/check-look-around.mts`; nothing in the game needs it.
   */
  get lookDistance(): number {
    return this.lookOffset.length();
  }

  /** Seconds since the last drag — how close the return is. */
  get lookIdle(): number {
    return this.lookIdleSeconds;
  }

  /**
   * The leash for the look-around: she may look anywhere she could *walk*, and
   * no further. Pass `Collision.playBounds`, re-asserted every frame.
   *
   * **This is the whole answer to the castle's void.** The floors are disjoint
   * spaces hundreds of metres apart and per-space visibility means a camera
   * that wanders off the floor she is on renders empty sky — so panning indoors
   * had to be bounded by *something*. Rather than invent a second idea of
   * "where the inside is" (a hand-typed rectangle around the floor plate, which
   * would then be a copied number silently left behind the day the plate
   * changes size — this repo's most common bug), it borrows the boundary the
   * player is *already* leashed to. `Collision.setPlayBounds` is called on
   * every change of space — the garden, the castle interior, each hotel room
   * take it in turn — so this is per-space for free and correct in rooms nobody
   * had this feature in mind for.
   *
   * Panning is deliberately **not** switched off indoors. A gesture that works
   * in the park and silently does nothing in the great hall is a gesture a
   * six-year-old decides is broken; one that pans until it reaches the wall and
   * stops is one she understands immediately.
   */
  setLookBounds(bounds: ParkBoundary | null): void {
    this.lookBounds = bounds;
  }

  /**
   * Drags the view by a finger/mouse movement measured in **CSS pixels**, with
   * `y` growing downward exactly as `PointerEvent.clientY` does.
   *
   * Pixels rather than metres because the px-to-metres mapping needs the zoom
   * and the rig's pitch, both of which live here — the input layer must not
   * grow its own copy of either. Resets the idle timer, so the three-second
   * return only starts counting once the finger stops.
   *
   * The sign is direct manipulation, the same as the park map's `pannedBy`:
   * the park goes where the finger goes, so the *camera* moves the opposite
   * way. Drag downward and the view travels up the screen, revealing what was
   * above.
   */
  lookByPixels(dxPixels: number, dyPixels: number): void {
    this.lookIdleSeconds = 0;
    const metresPerPixel = this.worldUnitsPerPixel;
    this.lookOffset
      .addScaledVector(this.rightVector, -dxPixels * metresPerPixel)
      // Divided by the pitch's sine so the ground keeps up with the finger —
      // see `pitchSine`.
      .addScaledVector(this.forwardVector, (dyPixels * metresPerPixel) / this.pitchSine);
    this.clampLookOffset();
  }

  /**
   * Puts the view back on her **at once**, with no easing at all.
   *
   * For the moment a ride takes the camera. The gentle return is for a child
   * who has stopped dragging and is still standing in the park; a ride is a
   * different thing entirely — its camera owns the frame from that frame on, so
   * an eased return would be a second camera motion running *underneath* a
   * camera nobody can see, and still mid-flight whenever the ride handed back.
   * Zeroed outright behind the ride's own view, the park rig is already
   * pointing squarely at her the first frame it is drawn again: nothing to
   * fight, and nothing to see.
   */
  cancelLook(): void {
    this.lookOffset.set(0, 0, 0);
    this.lookIdleSeconds = 0;
  }

  /**
   * Holds the offset inside both leashes: {@link CAMERA_LOOK_MAX_DISTANCE} from
   * her, and inside {@link setLookBounds}'s boundary.
   *
   * The boundary clamp is a bisection rather than a projection because a
   * `ParkBoundary` answers *how far* to its edge, not *which way* — the park's
   * is a spline, not a circle, and asking it for a normal would mean either
   * differencing the SDF (noisy near the spline's own knots) or teaching every
   * boundary shape a second method for one caller. Shortening the offset along
   * the ray she is already looking down is exact for the only question asked,
   * needs nothing new from `boundary.ts`, and terminates in a fixed twelve
   * steps — about 4 mm of precision on an 18 m leash, well under a pixel.
   *
   * The player herself is always inside her own play bounds, so zero length is
   * always a valid answer and the bisection can never fail to find one.
   */
  private clampLookOffset(): void {
    const requested = this.lookOffset.length();
    if (requested <= 0) return;
    if (requested > CAMERA_LOOK_MAX_DISTANCE) {
      this.lookOffset.multiplyScalar(CAMERA_LOOK_MAX_DISTANCE / requested);
    }
    const bounds = this.lookBounds;
    if (!bounds) return;

    const length = this.lookOffset.length();
    const x = this.desiredFocus.x;
    const z = this.desiredFocus.z;
    const dirX = this.lookOffset.x / length;
    const dirZ = this.lookOffset.z / length;
    if (bounds.contains(x + dirX * length, z + dirZ * length)) return;

    let good = 0;
    let bad = length;
    for (let step = 0; step < 12; step += 1) {
      const middle = (good + bad) / 2;
      if (bounds.contains(x + dirX * middle, z + dirZ * middle)) good = middle;
      else bad = middle;
    }
    this.lookOffset.multiplyScalar(good / length);
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

    this.updateLook(dt);
    this.updatePose(dt);
    this.applyTransform();
  }

  /**
   * Ages the look-around offset by one frame: counts the idle time, and once
   * {@link CAMERA_LOOK_RETURN_DELAY} has passed, eases the view back to her.
   *
   * Also re-clamps every frame, not only on a drag — she can keep walking while
   * the view is out, and the leash has to follow her rather than being decided
   * once when the finger lifted. Walking towards a wall with the view already
   * out over it therefore pulls the view gently back in, instead of leaving it
   * parked in the void.
   *
   * A focus override (the keychain rack's zoomed picker, the cat bus's arrival)
   * is a composed shot with its own subject, so the offset goes to zero with
   * it rather than sliding the shot off its mark.
   */
  private updateLook(dt: number): void {
    if (this.focusOverrideActive) {
      this.lookOffset.set(0, 0, 0);
      this.lookIdleSeconds = 0;
      return;
    }
    this.lookIdleSeconds += dt;
    this.clampLookOffset();
    if (this.lookIdleSeconds < CAMERA_LOOK_RETURN_DELAY) return;
    // Damping towards zero, on the same curve the follow uses — see
    // `CAMERA_LOOK_RETURN_HALF_LIFE`. The last millimetre is snapped off so
    // "is the view home?" has an answer that arrives, rather than an
    // exponential that approaches zero forever.
    const remaining = Math.pow(2, -dt / CAMERA_LOOK_RETURN_HALF_LIFE);
    this.lookOffset.multiplyScalar(remaining);
    if (this.lookOffset.lengthSq() < LOOK_HOME_EPSILON * LOOK_HOME_EPSILON) {
      this.lookOffset.set(0, 0, 0);
    }
  }

  /**
   * Eases the pose delta towards its target by one frame.
   *
   * The last millimetre is snapped off for the same reason `updateLook` snaps
   * its own: an exponential approaches zero forever, so without this the
   * camera would sit a hair off its resting pose for the whole rest of the
   * session and "has the rise finished?" would have no answer that ever
   * arrives. Beat three of the arrival has to land *on* the ordinary camera,
   * not beside it.
   */
  private updatePose(dt: number): void {
    this.poseOffset.x = damp(this.poseOffset.x, this.poseTarget.x, CAMERA_POSE_HALF_LIFE, dt);
    this.poseOffset.y = damp(this.poseOffset.y, this.poseTarget.y, CAMERA_POSE_HALF_LIFE, dt);
    this.poseOffset.z = damp(this.poseOffset.z, this.poseTarget.z, CAMERA_POSE_HALF_LIFE, dt);
    if (this.poseOffset.distanceToSquared(this.poseTarget) < POSE_HOME_EPSILON * POSE_HOME_EPSILON) {
      this.poseOffset.copy(this.poseTarget);
    }
  }

  private applyTransform(): void {
    // The look-around offset is applied *here*, on top of the settled follow,
    // rather than folded into `focus` — see `viewFocus`.
    this.viewFocus.copy(this.focus).add(this.lookOffset);
    this.camera.position.copy(this.viewFocus).add(this.offset).add(this.poseOffset);
    this.camera.lookAt(this.viewFocus);
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

  /**
   * **The zoom at which `worldMetres` covers `pixels` CSS pixels of screen.**
   *
   * The inverse of {@link worldUnitsPerPixel}, and the honest way to state a
   * rule about *fingers*: a fingertip is a fixed number of CSS pixels wherever
   * it lands (`tapSpacing.ts` derives the game's own 40 px from
   * GAME_DESIGN.md's UI floor), so "far enough apart to tap separately" is a
   * question about pixels, not about metres. A world distance that is a
   * comfortable gap at one zoom is a single fat fingertip at another, and a
   * zoomed picker changes zoom by design.
   *
   * Pair it with {@link zoomToFit} when a shot has to both *contain* something
   * and stay *tappable*: those two pull in opposite directions — pulling back
   * to fit more shrinks everything towards the finger — and this returns the
   * floor the pulling-back has to stop at.
   */
  zoomForPixelSize(worldMetres: number, pixels: number): number {
    const base = this.frustumBase();
    return (pixels * 2 * base) / (Math.max(worldMetres, 1e-6) * this.viewportHeight);
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

/**
 * Below this many metres from her, the look-around offset is simply zero.
 *
 * A millimetre — far under one pixel at any zoom the camera allows — so this
 * only ever ends an exponential tail nobody can see, and never truncates a
 * movement anyone could.
 */
const LOOK_HOME_EPSILON = 0.001;

/**
 * How quickly the camera rises back into its ordinary pose, in seconds per
 * halving.
 *
 * Slower than the follow's 0.16 s, because this is a *shot* changing rather
 * than a camera chasing a child — the same reasoning
 * `CAMERA_LOOK_RETURN_HALF_LIFE` is written down for, and the same number, so
 * the two composed-shot returns in this file move alike rather than being two
 * separately dialled feels.
 */
const CAMERA_POSE_HALF_LIFE = CAMERA_LOOK_RETURN_HALF_LIFE;

/** Below this, the rise has landed. Metres. */
const POSE_HOME_EPSILON = 0.001;

// Scratch vector for clampToFrustum's own intermediate maths — discarded
// before the method returns, so safe to share across calls.
const SCRATCH_CLAMP_RELATIVE = new Vector3();
