import { PerspectiveCamera, type Object3D } from 'three';
import { clamp, damp } from './mathUtils';
import { createLookControl, type LookControl, type LookReading } from './rideLook';

/**
 * **First-person look-around on a moving mount.** One implementation, three
 * rides.
 *
 * The space ferris wheel got this working first: you sit in the gondola, the
 * gondola swings and climbs, and you turn your head to find the alien. The
 * family confirmed its directions are right, and GAME_DESIGN.md records them as
 * **not to be disturbed**. So when the first-person train and the coaster wanted
 * the same thing, ARCHITECTURE-DECISIONS Decision 4 §8 ruled: *extract, never
 * rewrite* — this file is the ferris wheel's `aimCamera`, moved, with the
 * numbers it used turned into parameters and nothing else changed.
 *
 * **Never write a second look-around.** That is the whole point of this module
 * existing. `check:ride-camera` (`scripts/trace-ride-camera.mts`) hashes the
 * ferris wheel's camera frame by frame precisely so that "nothing else changed"
 * is a claim somebody can check rather than one somebody made.
 *
 * ---------------------------------------------------------------------------
 * What it owns, and what the ride owns
 * ---------------------------------------------------------------------------
 * **This owns:** the `PerspectiveCamera` itself, the look control
 * (`core/rideLook.ts`), the yaw/pitch offsets it drives, the damping that turns
 * a flicked thumb into a spin-up rather than a snap, the clamps, the idle sway,
 * and the portrait-phone field-of-view widening.
 *
 * **The ride owns:** its **mount** — the object the eye is bolted to (the
 * gondola seat, the train bench, the coaster cart) — and its limits. Give the
 * mount to {@link RideCamera.mountOn} once and three.js follows it for free:
 * whatever the mount does, sway, climb, bank through a corner, the view does
 * with it, and the child's yaw and pitch stay *relative to the seat*, which is
 * what "turn your head" means. There is deliberately no per-frame transform
 * callback: a ride that wants the eye somewhere else moves its own mount, and
 * then there is one place where the seat's position is decided.
 *
 * ---------------------------------------------------------------------------
 * The sign that keeps catching people
 * ---------------------------------------------------------------------------
 * `look.x` is screen-space drag-right, but `rotation.y` (yaw) increasing turns
 * a three.js camera **left** — it is why `PointerLockControls` writes
 * `euler.y -= movementX`. So yaw is negated here and pitch is not: `rotation.x`
 * increasing already looks up, so drag-up → look-up falls out with the plain
 * sign. Two agents have got this backwards on the ferris wheel. If you are about
 * to change a sign in this file, run `npm run check:ride-camera` first, write the
 * hash down, and be able to say why it moved.
 *
 * This negation is a *camera yaw* thing, and it is exactly why the CONTROL RULE
 * (`core/screenBasis.ts`) keeps rotation controls to first person and nowhere
 * else. Movement never needs it, because movement is a vector, not an angle.
 *
 * ---------------------------------------------------------------------------
 * Using it
 * ---------------------------------------------------------------------------
 * ```ts
 * const view = new RideCamera({ fov: 62, pitchMin: -0.33, pitchMax: 0.64 });
 * view.mountOn(gondola.seat, GONDOLA_EYE);   // once, at boot
 * // …every frame:
 * const look = view.update(dt, rideClock);   // returns the reading
 * hud.setStick(look.touch);                  // if the ride draws a thumb stick
 * // …and on a resize:
 * view.resize(width, height);
 * ```
 *
 * `update` hands back the {@link LookReading} rather than keeping it private,
 * because two rides need it for something other than turning: the ferris draws
 * the on-screen stick under the thumb, and the train has to tell a look-drag
 * apart from "let me off" — `dragging` exists for exactly that.
 *
 * ---------------------------------------------------------------------------
 * Banking, and why there is no `roll`
 * ---------------------------------------------------------------------------
 * The coaster leans into its corners. That belongs to the **cart**, not to the
 * camera: bank the mount off the rail pair and the view banks with it, and the
 * child's own yaw and pitch keep meaning "relative to my seat" while it happens.
 * A roll term here would fight that, and would put a third Euler angle into the
 * one place in the game where the angles are known to be right.
 */

// ------------------------------------------------------------- the defaults
//
// Every one of these is the ferris wheel's number, because the ferris wheel's
// number is the one that was approved. A ride that wants a different feel says
// so; a ride that says nothing gets the ride that works.

/** Radians per second of yaw at full stick/key deflection. */
const YAW_RATE = 1.7;
/** Radians per second of pitch. Slower than yaw: up and down is the axis a
 *  small thumb overshoots on. */
const PITCH_RATE = 1.1;
/** How far down the view can tip. Gentle — a six-year-old should never be able
 *  to end up staring at the floor. */
const PITCH_MIN = -0.33;
/** How far up. Generous: the things worth finding tend to sit high. */
const PITCH_MAX = 0.64;
/** Half-life of the turn-rate damping, in seconds. The stick sets where the view
 *  *wants* to be turning; this is what keeps a sudden flick from being a snap. */
const TURN_DAMPING = 0.16;
/** Radians of idle drift, and how fast it breathes. Gone the instant a child
 *  actually asks to look somewhere, so it never fights them. */
const IDLE_SWAY = 0.05;
const IDLE_SWAY_RATE = 0.11;
/** Field of view, in degrees. Wide: you are inside a small box looking out. */
const FOV = 62;
const NEAR = 0.05;
const FAR = 3200;

/**
 * On a portrait phone the vertical field of view has to open up, or the window
 * shows a letterbox of sky with the frame either side. Divide by the aspect,
 * with a floor so a very tall window does not go fish-eyed, and a ceiling on the
 * result for the same reason.
 */
const PORTRAIT_ASPECT_FLOOR = 0.62;
const MAX_FOV = 96;

/** A point, without asking the caller to build a `Vector3` for it. */
export interface EyeOffset {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Per-ride knobs. Every one is optional and defaults to the ferris wheel's
 * approved value — omit what you have no opinion about.
 */
export interface RideCameraOptions {
  readonly fov?: number;
  readonly near?: number;
  readonly far?: number;
  /** Radians per second of yaw at full deflection. */
  readonly yawRate?: number;
  /** Radians per second of pitch at full deflection. */
  readonly pitchRate?: number;
  readonly pitchMin?: number;
  readonly pitchMax?: number;
  /**
   * How far the view may turn either way from straight ahead, in radians, or
   * `null` for free 360° — the ferris (glass on every side) and the train.
   * The coaster clamps: there is a front of the cart and it wants you facing
   * roughly along it.
   */
  readonly yawLimit?: number | null;
  /** Half-life of the turn-rate damping, in seconds. */
  readonly turnDamping?: number;
  /** Radians of idle drift, or 0 for a view that sits perfectly still. */
  readonly idleSway?: number;
  /** How fast the idle drift breathes, in radians of phase per ride-second. */
  readonly idleSwayRate?: number;
  /** Where the view starts pitched, in radians. */
  readonly startPitch?: number;
  /** Where the view starts turned, in radians. */
  readonly startYaw?: number;
}

export class RideCamera {
  readonly camera: PerspectiveCamera;

  private readonly look: LookControl = createLookControl();

  private readonly yawRate: number;
  private readonly pitchRate: number;
  private readonly pitchMin: number;
  private readonly pitchMax: number;
  private readonly yawLimit: number | null;
  private readonly turnDamping: number;
  private readonly idleSway: number;
  private readonly idleSwayRate: number;
  private readonly baseFov: number;

  private yaw: number;
  private pitch: number;
  private yawVelocity = 0;
  private pitchVelocity = 0;

  constructor(options: RideCameraOptions = {}) {
    this.baseFov = options.fov ?? FOV;
    this.camera = new PerspectiveCamera(this.baseFov, 1, options.near ?? NEAR, options.far ?? FAR);
    // Yaw then pitch, with no roll: the only order in which "turn your head" and
    // "tip your chin" are two independent things rather than one tumbling one.
    this.camera.rotation.order = 'YXZ';

    this.yawRate = options.yawRate ?? YAW_RATE;
    this.pitchRate = options.pitchRate ?? PITCH_RATE;
    this.pitchMin = options.pitchMin ?? PITCH_MIN;
    this.pitchMax = options.pitchMax ?? PITCH_MAX;
    this.yawLimit = options.yawLimit ?? null;
    this.turnDamping = options.turnDamping ?? TURN_DAMPING;
    this.idleSway = options.idleSway ?? IDLE_SWAY;
    this.idleSwayRate = options.idleSwayRate ?? IDLE_SWAY_RATE;

    this.yaw = options.startYaw ?? 0;
    this.pitch = options.startPitch ?? 0;
  }

  /**
   * Bolt the eye into the ride. `mount` is whatever moves — the gondola seat,
   * the train bench, the coaster cart — and `eye` is where a seated child's eyes
   * are **in that object's own space**.
   *
   * Call it once. From then on the mount's transform is the ride and the
   * yaw/pitch are the child, and three.js composes the two.
   *
   * `eye` is a **position only**: nothing here rotates the mount, so a ride that
   * turns its seat turns the whole view with it, which is what a seat does.
   */
  mountOn(mount: Object3D, eye: EyeOffset): void {
    this.camera.position.set(eye.x, eye.y, eye.z);
    mount.add(this.camera);
  }

  /** Where the view is pointed, relative to the mount. Radians. */
  get heading(): number {
    return this.yaw;
  }

  get elevation(): number {
    return this.pitch;
  }

  /** Point the view somewhere at once, with no damping — for boarding. */
  point(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = clamp(pitch, this.pitchMin, this.pitchMax);
    this.yawVelocity = 0;
    this.pitchVelocity = 0;
  }

  /**
   * One frame of looking around. Returns the reading, which a ride needs for
   * anything *other* than turning — drawing the thumb stick, or telling a
   * look-drag apart from a press that means something else.
   *
   * `clock` is the **ride's own clock**, not a sum of `dt`: the idle sway rides
   * on it, and a ride that freezes its clock (the ferris does, on its end card)
   * means the sway to freeze with it.
   *
   * `pitchBias` is an extra tilt the ride layers on top for as long as it likes
   * — the ferris wheel's opening beat tips you up at the wheel above you while
   * there is nothing to see out of the window. It is clamped along with
   * everything else, and it does not accumulate: it is added to the child's own
   * pitch each frame, never into it.
   */
  update(dt: number, clock: number, pitchBias = 0): LookReading {
    const look = this.look.read();

    const targetYawVelocity = -look.x * this.yawRate;
    const targetPitchVelocity = look.y * this.pitchRate;
    this.yawVelocity = damp(this.yawVelocity, targetYawVelocity, this.turnDamping, dt);
    this.pitchVelocity = damp(this.pitchVelocity, targetPitchVelocity, this.turnDamping, dt);

    this.yaw += this.yawVelocity * dt;
    if (this.yawLimit !== null) this.yaw = clamp(this.yaw, -this.yawLimit, this.yawLimit);
    this.pitch = clamp(this.pitch + this.pitchVelocity * dt, this.pitchMin, this.pitchMax);

    const idle = !look.dragging && look.x === 0 && look.y === 0;
    const idleYaw = idle ? Math.sin(clock * this.idleSwayRate) * this.idleSway : 0;

    const pitch = clamp(this.pitch + pitchBias, this.pitchMin, this.pitchMax);
    this.camera.rotation.set(pitch, this.yaw + idleYaw, 0);

    return look;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.fov =
      this.camera.aspect < 1
        ? this.baseFov / Math.max(PORTRAIT_ASPECT_FLOOR, this.camera.aspect)
        : this.baseFov;
    this.camera.fov = Math.min(this.camera.fov, MAX_FOV);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.look.dispose();
    this.camera.removeFromParent();
  }
}
