import { PerspectiveCamera, Vector3 } from 'three';
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
 * a different way: **the first frame of every shot is the iso camera's own
 * position, aim and projection**, so the moment control changes hands nothing
 * whatever changes on screen. The move starts from there.
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
 * (`RideCamera`) are perspective for the same reason. The seed-from-iso trick
 * above still works across the two projections, because at the instant of the
 * cut the shot is framed on the same point from the same place; the difference
 * between the two projections at that distance is far smaller than the first
 * frame of the move.
 */

/** Where a shot starts from. */
export type ShotStart =
  /** The iso camera's own position this instant — an invisible cut. */
  | 'here'
  /** Somewhere else entirely, for a shot that arrives behind a fade. */
  | Vector3;

export interface Shot {
  readonly from: ShotStart;
  /** Where the camera ends up. */
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

export class HotelCinematic {
  readonly camera = new PerspectiveCamera(38, 1, 0.3, 2000);

  private shot: Shot | null = null;
  private phase: Phase = 'easing';
  private phaseT = 0;
  private readonly start = new Vector3();
  private readonly aim = new Vector3();
  /** Where the camera actually was last frame, so the return starts from it. */
  private readonly held = new Vector3();
  private onEnd: (() => void) | null = null;

  constructor(private readonly iso: IsoCamera) {}

  get running(): boolean {
    return this.shot !== null;
  }

  /** True once the shot has arrived — the only time a press should end it. */
  get dismissible(): boolean {
    return this.shot !== null && this.phase === 'holding' && this.shot.holdSeconds === null;
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

    if (shot.from === 'here') {
      this.start.copy(this.iso.camera.position);
    } else {
      this.start.copy(shot.from);
    }
    this.held.copy(this.start);
    this.aim.copy(shot.lookAt);
    this.camera.fov = shot.fov ?? 38;
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
        this.camera.position.lerpVectors(this.start, shot.to, eased);
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
        if (shot.holdSeconds !== null && this.phaseT >= shot.holdSeconds) {
          this.phase = 'returning';
          this.phaseT = 0;
        }
        return this.camera;
      }
      case 'returning': {
        // **Back to where the iso camera is *now*, not where it was.** It
        // follows the player and she may have been carried somewhere by a ride
        // in the meantime; returning to the remembered position would hand
        // control back with a jump.
        const t = Math.min(1, this.phaseT / RETURN_SECONDS);
        this.camera.position.lerpVectors(this.held, this.iso.camera.position, smooth(t));
        this.camera.lookAt(this.iso.focusPoint);
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
