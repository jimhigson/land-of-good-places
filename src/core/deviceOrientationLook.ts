import { Euler, Quaternion, Vector3 } from 'three';
import { DEG, angleDelta, damp } from './mathUtils';

/**
 * **Looking around a ride by tilting the phone.** The park through a window you
 * hold.
 *
 * On a phone or a tablet, dragging a thumb across the screen to turn your head
 * is a thing you have to be told about. Turning to look at something is not —
 * it is what a two-year-old does with a cardboard tube. So on a device that has
 * the sensors, the first-person rides stop asking for the drag and use the
 * phone's own orientation instead: point it at the floor and you are looking
 * through the glass floor, lift it over your head and you are looking at the
 * wheel.
 *
 * This is a **sibling** of `core/rideLook.ts`, not a replacement for it, and
 * {@link RideCamera} picks between the two at runtime. Three reasons it is a
 * separate module and a separate code path rather than another branch inside
 * the drag control:
 *
 * 1. **The two readings are different kinds of thing.** A drag is a *rate* —
 *    hold further from where your thumb went down and the view spins faster.
 *    The sensor is an *absolute angle*: there is no "how fast", there is only
 *    "where the phone is pointing". Averaging those two into one number would
 *    give a control that is neither.
 * 2. **`check:ride-camera` has to keep meaning something.** The parity trace
 *    drives the drag and key path, and it is the proof that the family-approved
 *    look-around still behaves exactly as approved. If the sensor could reach
 *    into that arithmetic, a passing trace would stop being evidence. Nothing
 *    in here runs unless a real `deviceorientation` event has actually arrived,
 *    which in Node — and on a desktop — it never does.
 * 3. **It has to be able to fail.** iOS will not hand over the sensors without
 *    a permission prompt, the prompt can be refused, and plenty of devices have
 *    no gyroscope at all. Every one of those paths has to end with the child
 *    still able to drag, which is much easier to guarantee when "the sensor is
 *    driving" is one flag in one place.
 *
 * ---------------------------------------------------------------------------
 * Forward is wherever you were facing when you got on
 * ---------------------------------------------------------------------------
 * The compass heading a phone reports is *absolute* — it points at true north,
 * which is no use at all here. A child boards a ride facing whichever way she
 * happens to be sitting on the sofa, and "straight ahead" has to mean **that**,
 * not north.
 *
 * So the first usable reading is kept as a **reference yaw** and every later
 * yaw is reported relative to it. `recentre()` re-takes it, which is what
 * boarding calls. Pitch is *not* rebased: level is level, and a horizon that
 * depended on how you were holding the phone when you sat down would be worse
 * than no horizon at all.
 *
 * ---------------------------------------------------------------------------
 * Drift, and why there is none to accumulate
 * ---------------------------------------------------------------------------
 * Every frame's angle is computed from that frame's raw sensor reading and the
 * fixed reference — nothing is integrated, and no previous frame's answer feeds
 * into the next one's. A sensor that is 3° off reads 3° off forever rather than
 * wandering further out every second. The only state carried between frames is
 * the smoothing, and that is a damp *towards* the freshly computed angle, so it
 * cannot drift either: stop moving the phone and it converges on the true
 * reading and stops.
 */

/**
 * Half-life of the smoothing, in seconds. Small: this has to feel like a window,
 * and a window does not lag behind your hands. It exists only to take the
 * high-frequency jitter off a cheap sensor — enough that a still phone gives a
 * still picture, not enough to be felt as delay.
 */
const SMOOTHING = 0.05;

/**
 * A reading is only believed once this many events have arrived. The first one
 * or two out of a just-woken sensor are routinely nonsense, and snapping the
 * view to nonsense at the exact moment a ride starts is the worst possible
 * frame to do it on.
 */
const WARMUP_EVENTS = 3;

/**
 * How long the sensor may go quiet before the drag control takes over again, in
 * seconds. A phone that stops reporting — the sensor is disabled mid-ride, the
 * page is backgrounded and restored — must not leave a child holding a view
 * that no longer answers to anything.
 */
const STALE_AFTER = 0.6;

export interface OrientationReading {
  /** Radians, relative to where the phone was pointing at {@link recentre}. */
  readonly yaw: number;
  /** Radians. Absolute: 0 is level, positive is looking up. */
  readonly pitch: number;
}

export interface OrientationLook {
  /**
   * This frame's angles, or `null` if the sensor is not driving — no
   * permission, no hardware, not warmed up yet, or gone quiet. `null` is the
   * signal to fall back to the thumb, and it is checked every frame rather than
   * once at boot precisely so that "gone quiet" is recoverable.
   */
  read(dt: number): OrientationReading | null;
  /** Take "straight ahead" from wherever the phone is pointing now. */
  recentre(): void;
  dispose(): void;
}

/**
 * Could this device *possibly* drive a ride by orientation?
 *
 * Deliberately cheap and deliberately optimistic: it answers "is there an API
 * here at all", not "will events actually arrive", because the only honest way
 * to answer the second is to listen and see. Desktop Chrome says yes to this
 * and then never fires an event, which is exactly why {@link OrientationLook.read}
 * returns `null` until a real reading has landed rather than trusting this.
 */
export function isOrientationLookSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.DeviceOrientationEvent !== 'undefined';
}

/** The iOS 13+ permission gate, when there is one. */
interface PermissionCapableEventConstructor {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
}

/** Does this device demand a permission prompt before it will report? */
export function needsOrientationPermission(): boolean {
  if (!isOrientationLookSupported()) return false;
  const constructor = window.DeviceOrientationEvent as unknown as PermissionCapableEventConstructor;
  return typeof constructor.requestPermission === 'function';
}

/**
 * Cached answer, so the prompt is asked for **once per page load** rather than
 * once per ride. iOS only shows the dialog the first time anyway; asking again
 * from outside a gesture just produces a rejected promise and a console error
 * for something we already know the answer to.
 */
let permission: 'unasked' | 'granted' | 'denied' = 'unasked';
let permissionInFlight: Promise<boolean> | null = null;

/**
 * Ask iOS for the motion sensors. **Must be called from inside a user gesture**
 * — a tap handler, not a timer, not a promise continuation a few ticks later,
 * or iOS refuses it out of hand and the child silently gets no gyro.
 *
 * Safe to call anywhere and as often as you like: devices that need no
 * permission resolve `true` immediately, and the answer is cached after the
 * first real ask. Boarding a ride is the natural place, which is why it is
 * exported separately from {@link createOrientationLook} — the tap that starts
 * the ride is a gesture, and the frame where the camera is built is not.
 */
export async function requestOrientationPermission(): Promise<boolean> {
  if (!isOrientationLookSupported()) return false;
  if (permission === 'granted') return true;
  if (permission === 'denied') return false;
  if (permissionInFlight) return permissionInFlight;

  if (!needsOrientationPermission()) {
    permission = 'granted';
    return true;
  }

  const constructor = window.DeviceOrientationEvent as unknown as PermissionCapableEventConstructor;
  permissionInFlight = (async () => {
    try {
      const answer = await constructor.requestPermission?.();
      permission = answer === 'granted' ? 'granted' : 'denied';
    } catch {
      // Refused, or called outside a gesture. Either way the child drags, and
      // that is a working ride rather than a broken one — so this is not worth
      // a word to anybody.
      permission = 'denied';
    }
    permissionInFlight = null;
    return permission === 'granted';
  })();

  return permissionInFlight;
}

/** True once permission is settled and positive. Nothing listens without it. */
function permitted(): boolean {
  return permission === 'granted' || (isOrientationLookSupported() && !needsOrientationPermission());
}

// --------------------------------------------------------------- the maths
//
// Scratch objects, reused: this runs every frame and per-frame `Quaternion`s
// are exactly the sort of litter that shows up as a stutter on the cheap phone
// this feature is for.

const zee = new Vector3(0, 0, 1);
const screenTransform = new Quaternion();
const deviceEuler = new Euler();
const deviceQuaternion = new Quaternion();
const forward = new Vector3();
const up = new Vector3();

/**
 * Below this much horizontal aim, "which way am I facing" stops having an
 * answer: a view pointing exactly at the floor faces every direction at once.
 * About a third of a degree off vertical.
 */
const DEGENERATE = 6e-3;

/**
 * `-90°` about X. A phone reports its orientation with the **screen** as the
 * face that matters; a camera looks out of the phone's **back**. This is the
 * quarter turn between those two, and leaving it out gives a view that is
 * ninety degrees off in pitch — which reads as "the gyro is broken" rather than
 * as an off-by-one, so it is worth naming.
 */
const screenToCamera = new Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);

/**
 * **The one piece of this file worth testing, and the only pure function in
 * it.** No DOM, no state, no listeners: four numbers in, two angles out. Unit
 * tested headlessly by `scripts/check-orientation-math.mts`.
 *
 * @param alpha  Rotation about the screen's Z, degrees, 0..360, as reported.
 * @param beta   Front-to-back tilt, degrees, -180..180.
 * @param gamma  Left-to-right tilt, degrees, -90..90.
 * @param screenAngle How far the *page* is rotated inside the device, degrees
 *   (`screen.orientation.angle`) — 0 portrait, 90 or 270 landscape. Without
 *   this the view tips onto its side the moment a child turns the phone, which
 *   is the single most likely way for a child to hold it.
 *
 * Returns yaw and pitch in radians in the same frame `RideCamera` works in:
 * yaw about world Y with the three.js sign (increasing turns left), pitch about
 * X with positive looking up.
 *
 * ---------------------------------------------------------------------------
 * Why this reads a **direction** rather than decomposing the angles
 * ---------------------------------------------------------------------------
 * The obvious implementation — build the device quaternion, pull an `YXZ` Euler
 * back out of it, keep `y` and `x` — is wrong, and wrong in a way that only
 * shows up when a child does something completely normal. `YXZ` mixes roll into
 * the other two: **roll the phone 90° about the axis you are looking along, and
 * the extracted yaw moves by 90°** even though the phone is still pointing at
 * exactly the same thing. Tested, measured, and the reason this function does
 * not do that.
 *
 * The compensating `Rz(-screenAngle)` that `DeviceOrientationControls` applies
 * only cancels that error when the roll is *exactly* one the OS has noticed and
 * re-laid the page out for. A phone with rotation lock on, or held at 40°, or
 * mid-way through the OS deciding, gets no compensation and a view that swings
 * for no reason a six-year-old could ever guess at.
 *
 * So instead: rotate the camera's forward axis by the device's orientation and
 * read the **aim** off the resulting vector. Where the phone's back points is a
 * physical fact; it does not care how the phone is rolled or how the OS has
 * chosen to lay out the page, and neither, now, does this. Roll simply never
 * enters the arithmetic — which suits `RideCamera`, whose whole `YXZ`-no-roll
 * design says a ride that banks banks its mount instead.
 *
 * `screenAngle` still earns its keep, in the one case where the aim genuinely
 * runs out of information: pointed dead at the floor or the ceiling, every
 * heading is the same heading, and the only thing left that says which way the
 * child means is which way the top of the phone is pointing — which *is* a
 * function of the roll, and so of the screen.
 */
export function orientationToYawPitch(
  alpha: number,
  beta: number,
  gamma: number,
  screenAngle: number,
): OrientationReading {
  // The device's own frame, in the order the spec defines it. `YXZ` here with
  // gamma negated is the standard rearrangement of the spec's `ZXY`.
  deviceEuler.set(beta * DEG, alpha * DEG, -gamma * DEG, 'YXZ');
  deviceQuaternion.setFromEuler(deviceEuler);
  // Out of the back of the phone rather than out of the screen.
  deviceQuaternion.multiply(screenToCamera);
  // And then undo however the page is rotated inside the device, so that
  // "turned on its side" is a fact about the phone and not about the view.
  deviceQuaternion.multiply(screenTransform.setFromAxisAngle(zee, -screenAngle * DEG));

  // Where the back of the phone is pointing, in the ride's world.
  forward.set(0, 0, -1).applyQuaternion(deviceQuaternion);

  const horizontal = Math.hypot(forward.x, forward.z);
  // `atan2` rather than `asin`: no clamping, and correct right up to vertical.
  const pitch = Math.atan2(forward.y, horizontal);

  if (horizontal > DEGENERATE) {
    return { yaw: Math.atan2(-forward.x, -forward.z), pitch };
  }

  // Straight down or straight up, where the aim says nothing about heading.
  // Fall back to where the top of the screen points, which is what a child
  // holding the phone would themselves call "forwards" — and flip it looking
  // up, because the top of the phone then points back over her shoulder.
  up.set(0, 1, 0).applyQuaternion(deviceQuaternion);
  const yaw = forward.y < 0 ? Math.atan2(-up.x, -up.z) : Math.atan2(up.x, up.z);
  return { yaw, pitch };
}

/** Which way up the page is, in degrees, however this browser likes to say it. */
function screenAngle(): number {
  if (typeof window === 'undefined') return 0;
  const orientation = window.screen?.orientation;
  if (orientation && typeof orientation.angle === 'number') return orientation.angle;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

/**
 * Start listening. Returns a control that reports `null` until the sensor is
 * genuinely delivering, so a caller can hold one of these unconditionally and
 * let the reading decide whether the thumb or the phone is driving.
 *
 * Constructing this does **not** ask for permission — see
 * {@link requestOrientationPermission}, which needs a gesture this is not
 * called from.
 */
export function createOrientationLook(): OrientationLook {
  let events = 0;
  let sinceEvent = 0;
  let referenceYaw: number | null = null;
  let recentreRequested = true;

  /** The freshest raw reading, straight off the sensor. */
  let alpha = 0;
  let beta = 0;
  let gamma = 0;

  /** The smoothed output, and whether it has been seeded yet. */
  let smoothedYaw = 0;
  let smoothedPitch = 0;
  let seeded = false;

  const reading = { yaw: 0, pitch: 0 };

  const onOrientation = (event: DeviceOrientationEvent): void => {
    // A device with no gyroscope fires the event anyway, with nulls in it.
    if (event.alpha === null || event.beta === null || event.gamma === null) return;
    alpha = event.alpha;
    beta = event.beta;
    gamma = event.gamma;
    events += 1;
    sinceEvent = 0;
  };

  const listening = isOrientationLookSupported();
  if (listening) window.addEventListener('deviceorientation', onOrientation);

  return {
    read(dt: number): OrientationReading | null {
      if (!listening || !permitted()) return null;

      sinceEvent += dt;
      // Warmed up, and still talking to us.
      if (events < WARMUP_EVENTS || sinceEvent > STALE_AFTER) {
        // Gone quiet: forget the smoothing, so that if it comes back it comes
        // back cleanly rather than sliding in from wherever it stopped.
        seeded = false;
        return null;
      }

      const absolute = orientationToYawPitch(alpha, beta, gamma, screenAngle());

      // "Forward is where I got on." Taken here rather than in the event
      // handler so it lands on a warmed-up reading, not on the first one.
      if (recentreRequested || referenceYaw === null) {
        referenceYaw = absolute.yaw;
        recentreRequested = false;
        seeded = false;
      }

      // `angleDelta` rather than a subtraction: the two angles are on a circle,
      // and a child who turns through the ±π seam would otherwise get a full
      // spin of the view for one degree of phone.
      const yaw = angleDelta(referenceYaw, absolute.yaw);
      const pitch = absolute.pitch;

      if (!seeded) {
        // First good frame after boarding or after a gap: start *at* the
        // reading. Damping towards it from zero would swing the view across the
        // park on the frame the ride begins.
        smoothedYaw = yaw;
        smoothedPitch = pitch;
        seeded = true;
      } else {
        // Damp along the short way round, for the same seam reason.
        smoothedYaw += angleDelta(smoothedYaw, yaw) * (1 - Math.pow(2, -dt / SMOOTHING));
        smoothedPitch = damp(smoothedPitch, pitch, SMOOTHING, dt);
      }

      reading.yaw = smoothedYaw;
      reading.pitch = smoothedPitch;
      return reading;
    },

    recentre(): void {
      recentreRequested = true;
    },

    dispose(): void {
      if (listening) window.removeEventListener('deviceorientation', onOrientation);
    },
  };
}
