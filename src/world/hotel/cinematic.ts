import { PerspectiveCamera, Vector3 } from 'three';
import { DEG } from '../../core/mathUtils';
import type { IsoCamera } from '../../core/IsoCamera';

/**
 * **The hotel's one camera mechanism.**
 *
 * Three of Jim's asks want the same thing and it would have been three
 * different things if each had been built where it was asked for: a gentle
 * push-in on a child eating her breakfast, a look at a picture on the wall,
 * and a look out of the window at the park fifty floors below. All three are
 * *move the camera somewhere, hold it there, put it back*, and the only
 * differences are how long, whether it fades, and whether it drifts.
 *
 * So there is one {@link Shot} type and one state machine, and the three
 * features are three call sites that describe what they want. That is the
 * difference between adding a feature and adding a system.
 *
 * ## How it plugs in
 *
 * `Game.ts` already owns exactly the seam for this: `cameraOverride`, which
 * every ride drives, and which `onRideCameraCut` sets **without** an iris
 * wipe for the slide's mid-ride edits. A push-in must not blink — the whole
 * point is that it is gentle — so this uses the no-wipe path and hides the cut
 * a different way: **the first frame of every shot matches what the iso camera
 * is showing**, so the moment control changes hands nothing much changes on
 * screen. The move starts from there.
 *
 * The soft fade the window views want is not this file's business either: the
 * hotel already holds `InteriorControls.iris`, which is what every space
 * change in the building uses, and a shot that wants one simply says so and
 * lets the caller wrap it.
 *
 * ## Why a `PerspectiveCamera` when the game is orthographic
 *
 * Because all three shots are *about* depth — a bowl close to the lens, a
 * picture flat on a wall, a park falling away below a window — and an
 * orthographic camera cannot express any of them: moving one closer to
 * something does not make it bigger. The park's own ride cameras
 * (`RideCamera`) are perspective for the same reason.
 *
 * ## The matched start — why `'here'` is not the iso camera's position
 *
 * The iso rig parks its orthographic camera `CAMERA_DISTANCE` (90 m) up its
 * fixed diagonal, at *every* zoom — an ortho camera's distance means nothing,
 * so it never moves closer. Put a 38° perspective camera at that same point
 * and the first frame shows a ~60 m tall slice of world where the ortho was
 * showing ~15: the shot opens with a violent zoom-OUT and then flies 90 m in.
 * Jim, live play, 7 Aug 2026: *"the camera zooming in on breakfast for some
 * reason first zooms way out instead of starting at its current position."*
 *
 * The pose that actually matches the screen is found by matching **apparent
 * size**: a perspective camera with vertical field `fov` shows a plane
 * `2·d·tan(fov/2)` tall from `d` metres away, and the ortho frustum is
 * `2·viewHalfHeight` tall (zoom included). Setting the two equal gives
 * {@link matchDistance} — stand *that* far up the same iso diagonal, looking
 * the same way, and the frame contains what the frame already contained. The
 * hand-back at the end of a shot returns to the same matched pose against the
 * iso camera's *current* focus, for the same reason in reverse.
 */

/** Where a shot starts from. */
export type ShotStart =
  /** A pose matching what the iso camera shows this instant — an invisible cut. */
  | 'here'
  /** Somewhere else entirely, for a shot that arrives behind a fade. */
  | Vector3;

export interface Shot {
  readonly from: ShotStart;
  /** Where the camera ends up. Clamped — see {@link MIN_SHOT_DISTANCE}. */
  readonly to: Vector3;
  /** What it is pointed at, throughout. */
  readonly lookAt: Vector3;
  /** Seconds easing from `from` to `to`. */
  readonly easeSeconds: number;
  /**
   * Seconds held at `to` before it returns on its own, or `null` to hold until
   * {@link HotelCinematic.dismiss} is called.
   */
  readonly holdSeconds: number | null;
  /**
   * Radians per second the camera orbits `lookAt` while holding. A slow drift
   * is what stops a held shot reading as a screenshot; zero is a locked
   * camera, which is right for something small and close.
   */
  readonly drift?: number;
  /** Vertical field of view. Narrower is a longer lens, and flatter. */
  readonly fov?: number;
}

type Phase = 'easing' | 'holding' | 'returning';

/** Seconds a shot takes to hand the view back at the end. */
const RETURN_SECONDS = 0.85;

/**
 * The closest a shot's end pose may stand to the thing it is looking at, in
 * metres — the machine's own guarantee, enforced in {@link HotelCinematic.play}
 * for every caller at once rather than hoped for at three call sites.
 *
 * Jim, live play, 7 Aug 2026: the breakfast push-in *"often zooms in to
 * inside the characters head"* — the old end pose was offset in **world**
 * axes, so for chairs facing the wrong way it landed nearly on top of the
 * diner. The number is the camera's own near plane (0.3 m) plus a head's
 * radius (~0.3 m) with a doubled margin, so an end pose at the limit still
 * cannot clip skull geometry into the frustum. `check:hotel` measures every
 * shot the hotel can produce against this same constant.
 */
export const MIN_SHOT_DISTANCE = 1.1;

/** Default vertical field of view when a shot does not choose a lens. */
const DEFAULT_FOV = 38;

export class HotelCinematic {
  readonly camera = new PerspectiveCamera(DEFAULT_FOV, 1, 0.3, 2000);

  private shot: Shot | null = null;
  private phase: Phase = 'easing';
  private phaseT = 0;
  private readonly start = new Vector3();
  /** The shot's end pose, after the {@link MIN_SHOT_DISTANCE} clamp. */
  private readonly end = new Vector3();
  private readonly aim = new Vector3();
  /** Where the camera actually was last frame, so the return starts from it. */
  private readonly held = new Vector3();
  /** The aim it held, so the return can pan smoothly back to the iso focus. */
  private readonly heldAim = new Vector3();
  /** Scratch for per-frame pose targets. */
  private readonly scratch = new Vector3();
  private onEnd: (() => void) | null = null;

  private readonly iso: IsoCamera;

  constructor(iso: IsoCamera) {
    this.iso = iso;
  }

  get running(): boolean {
    return this.shot !== null;
  }

  /** True once the shot has arrived — the only time a press should end it. */
  get dismissible(): boolean {
    return this.shot !== null && this.phase === 'holding' && this.shot.holdSeconds === null;
  }

  /**
   * The distance at which a perspective camera at `fov` frames exactly the
   * world height the iso camera is currently showing — the whole trick behind
   * the invisible cut. See the header.
   */
  private matchDistance(fov: number): number {
    return this.iso.viewHalfHeight / Math.tan((fov / 2) * DEG);
  }

  /** The matched stand-in pose for the iso camera, anchored on `anchor`. */
  private matchedPose(out: Vector3, anchor: Vector3, fov: number): Vector3 {
    out
      .copy(this.iso.camera.position)
      .sub(this.iso.focusPoint)
      .normalize()
      .multiplyScalar(this.matchDistance(fov))
      .add(anchor);
    return out;
  }

  /**
   * Runs a shot. `onEnd` fires once the view has been handed back, which is
   * where a caller puts everything it has to undo.
   */
  play(shot: Shot, onEnd?: () => void): void {
    this.shot = shot;
    this.phase = 'easing';
    this.phaseT = 0;
    this.onEnd = onEnd ?? null;
    const fov = shot.fov ?? DEFAULT_FOV;

    this.aim.copy(shot.lookAt);

    // **The end pose keeps its distance.** However a call site arrived at its
    // numbers, the machine refuses to stand closer to the subject than
    // MIN_SHOT_DISTANCE: too close is pushed straight back out along the same
    // sight line, so the framing a caller asked for survives in direction
    // even when its arithmetic put the lens inside somebody's head.
    this.end.copy(shot.to);
    const gap = this.end.distanceTo(this.aim);
    if (gap < MIN_SHOT_DISTANCE) {
      if (gap < 1e-6) {
        // Degenerate: aimed at its own position. Back off along the iso
        // diagonal, which is always a sane direction to see something from.
        this.matchedPose(this.end, this.aim, fov).sub(this.aim).setLength(MIN_SHOT_DISTANCE).add(this.aim);
      } else {
        this.end.sub(this.aim).multiplyScalar(MIN_SHOT_DISTANCE / gap).add(this.aim);
      }
    }

    if (shot.from === 'here') {
      // Not the iso camera's own position — see the header. The matched pose
      // is anchored on the shot's aim, so frame one is the same picture at
      // the same scale, give or take the metre between the aim and the focus.
      this.matchedPose(this.start, this.aim, fov);
    } else {
      this.start.copy(shot.from);
    }
    this.held.copy(this.start);
    this.heldAim.copy(this.aim);
    this.camera.fov = fov;
    this.camera.position.copy(this.start);
    this.camera.lookAt(this.aim);
    this.camera.updateProjectionMatrix();
  }

  /** Ends a hold-until-pressed shot. Ignored while it is still arriving. */
  dismiss(): void {
    if (!this.dismissible) return;
    this.phase = 'returning';
    this.phaseT = 0;
    this.held.copy(this.camera.position);
    this.heldAim.copy(this.aim);
  }

  /** Stops immediately, running the caller's undo. For a space change or a reload. */
  cancel(): void {
    if (!this.shot) return;
    this.shot = null;
    const done = this.onEnd;
    this.onEnd = null;
    done?.();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** One frame. Returns the camera to render with, or `null` when it is over. */
  update(dt: number): PerspectiveCamera | null {
    const shot = this.shot;
    if (!shot) return null;
    this.phaseT += dt;

    switch (this.phase) {
      case 'easing': {
        const t = shot.easeSeconds <= 0 ? 1 : Math.min(1, this.phaseT / shot.easeSeconds);
        const eased = smooth(t);
        this.camera.position.lerpVectors(this.start, this.end, eased);
        this.camera.lookAt(this.aim);
        if (t >= 1) {
          this.phase = 'holding';
          this.phaseT = 0;
          this.held.copy(this.camera.position);
        }
        return this.camera;
      }
      case 'holding': {
        if (shot.drift) {
          // Orbit the point it is aimed at, so the drift never loses the
          // subject — a drift that translates the camera slides the thing you
          // are looking at out of frame, which is the one thing a held shot
          // must not do.
          const offset = this.camera.position.clone().sub(this.aim);
          const angle = shot.drift * dt;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const x = offset.x * cos - offset.z * sin;
          const z = offset.x * sin + offset.z * cos;
          this.camera.position.set(this.aim.x + x, this.camera.position.y, this.aim.z + z);
        }
        this.camera.lookAt(this.aim);
        this.held.copy(this.camera.position);
        this.heldAim.copy(this.aim);
        if (shot.holdSeconds !== null && this.phaseT >= shot.holdSeconds) {
          this.phase = 'returning';
          this.phaseT = 0;
        }
        return this.camera;
      }
      case 'returning': {
        // **Back to the matched pose against where the iso camera is *now*,
        // not where it was.** It follows the player and she may have been
        // carried somewhere in the meantime; and the matched pose — not the
        // iso camera's own position 90 m out — is what makes the final frame
        // agree with the orthographic frame it hands back to, so the cut is
        // as invisible on the way out as on the way in. The aim pans across
        // to the iso focus over the same ease, rather than snapping to it on
        // the first returning frame.
        const t = Math.min(1, this.phaseT / RETURN_SECONDS);
        const eased = smooth(t);
        const fov = shot.fov ?? DEFAULT_FOV;
        this.matchedPose(this.scratch, this.iso.focusPoint, fov);
        this.camera.position.lerpVectors(this.held, this.scratch, eased);
        this.aim.lerpVectors(this.heldAim, this.iso.focusPoint, eased);
        this.camera.lookAt(this.aim);
        if (t >= 1) {
          this.shot = null;
          const done = this.onEnd;
          this.onEnd = null;
          done?.();
          return null;
        }
        return this.camera;
      }
    }
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
