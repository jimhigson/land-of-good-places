/**
 * **Does the ride camera still point exactly where it did?**
 *
 * ```
 * npm run check:ride-camera
 * ```
 *
 * The ferris wheel's look-around is the reference implementation for every
 * first-person ride in the park. GAME_DESIGN.md records its directions as
 * **confirmed correct by the family — do not disturb**, and
 * ARCHITECTURE-DECISIONS Decision 4 §8 then asks for exactly the change most
 * likely to disturb them: lift that look-around out of `minigames/ferrisWheel/`
 * into a shared `core/RideCamera` that the train and the coaster will adopt.
 *
 * A sign flip in a yaw is invisible in a diff and obvious to a six-year-old, and
 * it has caught two agents on this ride already. So the extraction is gated the
 * way `check:crowd` gates the crowd: run this before, run it after, compare the
 * hashes. **Identical hash, identical ride.**
 *
 * ## What it drives
 *
 * The **real** `FerrisWheelRide` — not a model of one. The whole ride is
 * built in Node behind `scripts/headless-dom.mjs`: the real gondola with its
 * real wheel rotation and sway, the real `look.ts` listening on a real (if
 * stubbed) `window`, the real ninety-second clock.
 *
 * **The hash moved to `adcc0319` when the ferris wheel became a world ride**
 * (3 August 2026), and that is the only reason it moved. It had to: the camera
 * is hashed in *world* space, and the car it is bolted into no longer sits in a
 * private scene at the origin — it stands where the wheel stands in the park,
 * and rises three hundred and forty metres over it. The look-around itself is
 * untouched, and the coverage counters below (which are what actually fail this
 * check) are unchanged. Previous values: `26a241cc`, then `d1a4bbf0` when the
 * pitch clamps were opened up for the glass floor. Every frame the camera's
 * **world** position and orientation are hashed, which is the number that
 * actually decides what a child sees — it catches a change to the look maths, to
 * the eye offset, to the seat's transform, or to how the camera hangs off it.
 *
 * The hash is over the **exact IEEE bits**, not rounded values. That is
 * deliberate and it is stricter than it looks: "extract, never rewrite" means
 * the arithmetic should come out bit-for-bit, and anything that does not is
 * either a real change or a reordering somebody should have to justify.
 *
 * ## The sweep
 *
 * A scripted child: keys held each way, both pitch clamps pushed into, a
 * diagonal (which the control normalises), thumb drags under the deadzone, past
 * the deadzone and beyond full deflection, a release, a tap, a window blur with
 * a key still down, and **the whole thing again after the screen is turned
 * portrait**. The last one is not padding: the water fight shipped a camera that
 * re-derived itself wrongly on a viewport change, so the field of view and
 * aspect are hashed too, on both orientations.
 *
 * Like `check:crowd` this asserts **coverage**, not a golden hash: a look
 * control is meant to be tunable, and a trace that matches because nothing
 * happened is worse than no trace at all. The build fails if any part of the
 * sweep did nothing; the hash is for a human comparing two revisions.
 */

import './headless-dom.mjs';
import { dispatch, setViewport } from './headless-dom.mjs';
import type { PerspectiveCamera } from 'three';
import { Quaternion, Vector3 } from 'three';
import { FerrisWheelRide } from '../src/world/ferrisWheel/FerrisWheelRide.ts';
import { CollisionWorld } from '../src/world/Collision.ts';
import type { Player } from '../src/entities/Player.ts';
import type { FrameContext } from '../src/core/types.ts';

const DT = 1 / 60;
/** Long enough for the whole ride plus the card at the end. */
const SECONDS = 94;
const FRAMES = Math.round(SECONDS / DT);

/** Where the thumb goes down, in the landscape viewport. */
const LANDSCAPE = { width: 1280, height: 720 };
const PORTRAIT = { width: 720, height: 1280 };

// --- the scripted child ------------------------------------------------------
//
// One entry per moment the input changes. Times are ride seconds; the ride's own
// clock and this one agree because `rate` is 1 until the end card.

interface Beat {
  readonly at: number;
  readonly what: string;
  readonly act: (harness: Harness) => void;
}

const SWEEP: readonly Beat[] = [
  // Nothing at all, while the establishing tilt decays and the idle sway runs.
  { at: 0, what: 'hands off', act: () => {} },

  // --- keys, one axis at a time ---------------------------------------------
  { at: 3, what: 'hold left', act: (h) => h.keyDown('ArrowLeft') },
  { at: 5, what: 'release left', act: (h) => h.keyUp('ArrowLeft') },
  { at: 5.5, what: 'hold right', act: (h) => h.keyDown('ArrowRight') },
  { at: 7.5, what: 'release right', act: (h) => h.keyUp('ArrowRight') },
  // Long enough to bury the view in the upper clamp, then the lower one.
  { at: 8, what: 'look up', act: (h) => h.keyDown('ArrowUp') },
  { at: 11, what: 'look down', act: (h) => (h.keyUp('ArrowUp'), h.keyDown('ArrowDown')) },
  { at: 14, what: 'stop looking down', act: (h) => h.keyUp('ArrowDown') },
  // A diagonal: the control normalises the sum, so this is not just both axes.
  { at: 15, what: 'diagonal A+W', act: (h) => (h.keyDown('KeyA'), h.keyDown('KeyW')) },
  // Blur with a key still down — the ride loses focus and everything must stop.
  { at: 17, what: 'window blur, key still down', act: (h) => h.blur() },

  // --- the thumb -------------------------------------------------------------
  { at: 19, what: 'finger down', act: (h) => h.pointerDown(640, 360) },
  { at: 19.5, what: 'twitch inside the deadzone', act: (h) => h.pointerMove(646, 362) },
  { at: 21, what: 'drag right, past full deflection', act: (h) => h.pointerMove(900, 360) },
  { at: 24, what: 'drag up and left', act: (h) => h.pointerMove(520, 210) },
  { at: 27, what: 'drag down a little', act: (h) => h.pointerMove(660, 430) },
  { at: 29, what: 'let go', act: (h) => h.pointerUp() },
  { at: 30, what: 'a tap (down and straight up)', act: (h) => (h.pointerDown(700, 300), h.pointerUp()) },

  // --- turn the screen -------------------------------------------------------
  //
  // The water fight's camera re-derived itself wrongly here, so the whole thumb
  // sweep runs again in the other orientation with the FOV hashed alongside.
  { at: 34, what: 'turn the phone portrait', act: (h) => h.resize(PORTRAIT.width, PORTRAIT.height) },
  { at: 36, what: 'finger down (portrait)', act: (h) => h.pointerDown(360, 640) },
  { at: 38, what: 'drag right (portrait)', act: (h) => h.pointerMove(600, 645) },
  { at: 41, what: 'drag up and left (portrait)', act: (h) => h.pointerMove(240, 400) },
  { at: 44, what: 'let go (portrait)', act: (h) => h.pointerUp() },
  { at: 46, what: 'hold right (portrait)', act: (h) => h.keyDown('KeyD') },
  { at: 49, what: 'release (portrait)', act: (h) => h.keyUp('KeyD') },
  { at: 51, what: 'look up (portrait)', act: (h) => h.keyDown('ArrowUp') },
  { at: 54, what: 'stop (portrait)', act: (h) => h.keyUp('ArrowUp') },

  // --- a squarer screen, then back to landscape ------------------------------
  { at: 57, what: 'a square-ish window', act: (h) => h.resize(900, 900) },
  { at: 59, what: 'spin all the way round', act: (h) => h.keyDown('ArrowLeft') },
  { at: 63, what: 'stop spinning', act: (h) => h.keyUp('ArrowLeft') },
  { at: 65, what: 'back to landscape', act: (h) => h.resize(LANDSCAPE.width, LANDSCAPE.height) },

  // --- the rest of the ride, mostly watched rather than driven ---------------
  { at: 70, what: 'look for the turtles', act: (h) => h.keyDown('KeyD') },
  { at: 74, what: 'found them', act: (h) => h.keyUp('KeyD') },
  { at: 80, what: 'drag down for the park coming back', act: (h) => (h.pointerDown(640, 300), h.pointerMove(640, 470)) },
  { at: 84, what: 'let go for the landing', act: (h) => h.pointerUp() },
  { at: 93, what: 'press to dismiss the card', act: (h) => h.press() },
];

// --- the harness -------------------------------------------------------------

class Harness {
  private nextPointerId = 1;
  private downId: number | null = null;
  /** Set for exactly one frame, then cleared: the ride reads `holdPressed`. */
  pressed = false;
  width = LANDSCAPE.width;
  height = LANDSCAPE.height;
  keysHeld = 0;
  /** Frames the thumb was down *and* past `look.ts`'s deadzone. */
  dragFrames = 0;
  private origin: { x: number; y: number } | null = null;
  private at = { x: 0, y: 0 };

  private readonly game: FerrisWheelRide;

  constructor(game: FerrisWheelRide) {
    this.game = game;
  }

  /** Called once a frame: is the finger actually dragging this frame? */
  tick(): void {
    if (!this.origin) return;
    if (Math.hypot(this.at.x - this.origin.x, this.at.y - this.origin.y) > STICK_DEADZONE) {
      this.dragFrames += 1;
    }
  }

  keyDown(code: string): void {
    this.keysHeld += 1;
    dispatch('keydown', { code });
  }

  keyUp(code: string): void {
    this.keysHeld = Math.max(0, this.keysHeld - 1);
    dispatch('keyup', { code });
  }

  blur(): void {
    this.keysHeld = 0;
    this.downId = null;
    this.origin = null;
    dispatch('blur', {});
  }

  pointerDown(x: number, y: number): void {
    if (this.downId !== null) return;
    this.downId = this.nextPointerId;
    this.nextPointerId += 1;
    this.origin = { x, y };
    this.at = { x, y };
    // `target` is what the ride's tap handler checks for the framework's ✕.
    dispatch('pointerdown', {
      pointerId: this.downId,
      clientX: x,
      clientY: y,
      target: { classList: { contains: () => false } },
    });
  }

  pointerMove(x: number, y: number): void {
    if (this.downId === null) return;
    this.at = { x, y };
    dispatch('pointermove', { pointerId: this.downId, clientX: x, clientY: y });
  }

  pointerUp(): void {
    if (this.downId === null) return;
    dispatch('pointerup', { pointerId: this.downId });
    this.downId = null;
    this.origin = null;
  }

  press(): void {
    this.pressed = true;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    setViewport(width, height);
    this.game.rideView?.resize(width, height);
  }
}

// --- what the run has to have actually done ----------------------------------

interface Coverage {
  /** Frames the view was turning left, and right. */
  yawLeft: number;
  yawRight: number;
  /** Frames parked against each pitch clamp. */
  pitchTop: number;
  pitchBottom: number;
  /** Frames driven by keys, and by a thumb past the deadzone. */
  keyFrames: number;
  dragFrames: number;
  /** Distinct fields of view seen — one per orientation, at least. */
  fovs: number;
  /** Whether the view ever came all the way round. */
  fullTurn: number;
}

/** Straight from `SpaceFerrisWheel`. Duplicated on purpose: if somebody widens
 *  the clamp there, this run stops reporting that it reached it, and the
 *  coverage floor says so out loud instead of the hash quietly moving.
 *
 *  It did exactly that on 28 July 2026, which is the only reason these two
 *  numbers have ever changed: the car's floor and roof became glass, so the
 *  clamps opened from −0.33/0.64 to −1.396/1.222 (80° down, 70° up), this run
 *  reported `pitch-top=0 pitch-bottom=0`, and the build stopped. Working
 *  exactly as intended — re-copied here, and the sweep re-checked.
 *
 *  The sweep's key holds did **not** need lengthening, which is worth writing
 *  down because it looks as though they should have: there is now 2.6 rad
 *  between the clamps where there was 0.97. They still reach because pitch is
 *  *persistent* — three seconds of `ArrowUp` at 1.1 rad/s covers the distance,
 *  and once parked the view stays parked until something drives it back. If a
 *  future change shortens those holds, check the two counters, not the clock. */
const PITCH_MIN = -1.396;
const PITCH_MAX = 1.222;

/** Straight from `look.ts`'s `STICK_DEADZONE`, for the same reason. */
const STICK_DEADZONE = 10;

function run(coverage: Coverage): string {
  setViewport(LANDSCAPE.width, LANDSCAPE.height);

  // The **real** ride, now that it is a world ride rather than a mini-game:
  // still the whole thing, still not a model of one. What it needs from the
  // park is narrow enough to stub — a collision world, and four hooks it only
  // calls to raise the sky and hide things, none of which the look-around can
  // see.
  const game = new FerrisWheelRide(new CollisionWorld(), {
    setSpaceFactor: () => {},
    setParkWheelVisible: () => {},
    setParkVisible: () => {},
    setElsewhereVisible: () => {},
  });
  game.touch = true;
  // Only three methods of `Player` are ever reached from a ride, and none of
  // them move the camera. Building a real one would drag the whole character
  // model, the store and the save into a camera trace.
  game.attachPlayer({
    beginRide: () => {},
    endRide: () => {},
    teleportTo: () => {},
  } as unknown as Player);
  game.requestBoard();

  const harness = new Harness(game);
  harness.resize(LANDSCAPE.width, LANDSCAPE.height);

  const camera = game.rideView!.camera as PerspectiveCamera;
  const worldPosition = new Vector3();
  const worldQuaternion = new Quaternion();
  const fovsSeen = new Set<number>();

  let hash = 2166136261 >>> 0;
  const bits = new DataView(new ArrayBuffer(8));
  /** Hashes the exact double — no rounding, so "identical" means identical. */
  const mix = (value: number): void => {
    bits.setFloat64(0, value);
    hash = Math.imul(hash ^ bits.getUint32(0), 16777619) >>> 0;
    hash = Math.imul(hash ^ bits.getUint32(4), 16777619) >>> 0;
  };

  let beat = 0;
  let previousYaw = camera.rotation.y;
  let yawTravel = 0;

  for (let frame = 0; frame < FRAMES; frame += 1) {
    const elapsed = frame * DT;

    while (beat < SWEEP.length && SWEEP[beat]!.at <= elapsed) {
      SWEEP[beat]!.act(harness);
      beat += 1;
    }
    harness.tick();

    game.update({
      dt: DT,
      elapsed,
      // The ride reads exactly three edges off this, none of which the sweep
      // presses: `cancel` to get out, and `interact`/`jump` to dismiss the end
      // card. Leaving them all false is what keeps the full ninety seconds in
      // the trace rather than ending it early.
      input: { justPressed: () => false },
    } as unknown as FrameContext);
    harness.pressed = false;

    // What a child actually sees is the camera's place in the world, which is
    // the seat's transform and the eye offset and the look-around, together.
    game.group.updateMatrixWorld(true);
    camera.getWorldPosition(worldPosition);
    camera.getWorldQuaternion(worldQuaternion);

    mix(worldPosition.x);
    mix(worldPosition.y);
    mix(worldPosition.z);
    mix(worldQuaternion.x);
    mix(worldQuaternion.y);
    mix(worldQuaternion.z);
    mix(worldQuaternion.w);
    mix(camera.fov);
    mix(camera.aspect);

    // --- coverage ------------------------------------------------------------
    const yaw = camera.rotation.y;
    const pitch = camera.rotation.x;
    const dYaw = yaw - previousYaw;
    if (dYaw > 1e-4) coverage.yawLeft += 1;
    if (dYaw < -1e-4) coverage.yawRight += 1;
    yawTravel += Math.abs(dYaw);
    previousYaw = yaw;

    if (Math.abs(pitch - PITCH_MAX) < 1e-9) coverage.pitchTop += 1;
    if (Math.abs(pitch - PITCH_MIN) < 1e-9) coverage.pitchBottom += 1;
    if (harness.keysHeld > 0) coverage.keyFrames += 1;
    fovsSeen.add(Math.round(camera.fov * 1000));
  }

  coverage.dragFrames = harness.dragFrames;
  coverage.fovs = fovsSeen.size;
  coverage.fullTurn = yawTravel > Math.PI * 2 ? 1 : 0;

  game.dispose();
  return hash.toString(16).padStart(8, '0');
}

const coverage: Coverage = {
  yawLeft: 0,
  yawRight: 0,
  pitchTop: 0,
  pitchBottom: 0,
  keyFrames: 0,
  dragFrames: 0,
  fovs: 0,
  fullTurn: 0,
};

const started = Date.now();
const trace = run(coverage);
const seconds = ((Date.now() - started) / 1000).toFixed(1);

console.log(`frames=${FRAMES} beats=${SWEEP.length} in ${seconds}s`);
console.log(
  `covered yaw-left=${coverage.yawLeft} yaw-right=${coverage.yawRight} ` +
    `pitch-top=${coverage.pitchTop} pitch-bottom=${coverage.pitchBottom} ` +
    `keys=${coverage.keyFrames} drag=${coverage.dragFrames} ` +
    `fovs=${coverage.fovs} full-turn=${coverage.fullTurn}`,
);
console.log(`trace=${trace}`);

const missing = Object.entries(coverage).filter(([, count]) => count === 0);
if (missing.length > 0) {
  console.error(
    `NOT EXERCISED: ${missing.map(([name]) => name).join(', ')} — the sweep in ` +
      'scripts/trace-ride-camera.mts no longer reaches part of the look-around, ' +
      'so a matching hash would prove nothing.',
  );
  process.exitCode = 1;
}
