/**
 * **Does the arrival camera actually go anywhere — and does it come home
 * exactly?**
 *
 * Jim, on the first attempt at this: *"why doesn't the camera follow into the
 * park like asked for?"* and *"this is nothing like what I asked for."* That
 * version changed the pitch (38° → 26° → 38°) and the look-at point and
 * nothing else, and it was signed off on a table of pitch angles and a
 * "no snap" number of 0.000. **Both of those numbers were true.** They were
 * measurements of a camera that had not moved.
 *
 * The park rig is orthographic, so sliding an eye along its own view axis
 * changes nothing you can see; the shot's **bearing**, its **tilt** and the
 * **point it orbits** are the whole of what "the camera moved" can mean. So
 * clause 1 below is the one that matters: it measures the compass bearing the
 * camera looks from, and it goes red on any shot that keeps the park's one
 * eternal 45°, however much else it changes. It is the assertion the last
 * round did not have.
 *
 * The rest guard the promises that cannot be seen by eye at all:
 *
 * 2. **The bearing and the framing are home by `ARRIVAL_CONTROL_AT`.**
 *    `IsoCamera.forward`/`right` — the axes "up on the stick" is read through —
 *    are solved once from the rig's fixed yaw and never move. A camera still
 *    swinging while she walks would mean pressing up sends her somewhere that
 *    is not up the screen, which GAME_DESIGN.md's CONTROL rule forbids
 *    outright. This is the only thing standing between that rule and a shot
 *    somebody lengthens later.
 * 3. **The tilt is still rising then, and lands afterwards.** Jim's third beat
 *    is *"once through the arch the camera moves up"*, and she is through the
 *    arch and holding the controls at the same instant, so a rise that had
 *    already finished by then is a beat that never played.
 * 4. **It lands on the rig's own pose exactly**, driven through a real
 *    `IsoCamera` at 60 fps — not near it. Kept from the previous round, which
 *    got this part right.
 * 5. **It is `dt`-driven.** A paused frame must not advance the shot, and a
 *    long frame must not overshoot it.
 * 6. **No cut.** No two adjacent frames of the shot may jump.
 *
 * ## Proved red (3 September 2026)
 *
 * The geometry these were proved against — paste it with the transcript, since
 * a red run is a measurement and measurements go stale:
 *
 * ```
 * rig            yaw  45°  pitch 38°  distance 90.0 m
 * door shot      yaw 120°  pitch 24°  distance 20.8 m
 * ARRIVAL_CONTROL_AT 9.30 s   ARRIVAL_RISE_TAIL 1.60 s   AT_SHOT_HOME 10.90 s
 * green run: 22 checks; bearing swings 75.0°, tilt 14.0°, eye travels 83.1 m
 * ```
 *
 * | mutation | result |
 * |---|---|
 * | none (control) | pass, 22 checks |
 * | `yawDegrees: CAMERA_YAW_DEGREES` — the previous attempt, exactly | **red, clause 1**: bearing swings 0.0°, wanted 60° |
 * | yaw eased on the pitch's longer curve (`swing` → `lift`) | **red, clause 2**: 12.77° off the rig at the hand-over |
 * | `ARRIVAL_RISE_TAIL` → 0 | **red, clause 3**: 0.0° left to rise, and the shot has already let go |
 * | `POSE_HOME_EPSILON` snap removed from `IsoCamera` | **red, clause 4**: pose delta stalls at 3.136e-9 m, never exactly zero |
 * | pose damping handed a fixed `1/60` instead of `dt` | **red, clauses 5**: five paused seconds move the eye 3.037 m; at 15 fps it lands 0.0205 m off the rig |
 *
 * ## Proved red again after the arch clause was rescoped (3 September 2026)
 *
 * The clause was narrowed to stop at `clear` (see its own comment), which is a
 * *smaller* scope — so it had to be re-armed rather than assumed still armed.
 * Geometry it was proved against, since a red run is a measurement:
 *
 * ```
 * CAMERA_FOCUS_LIFT 1.25   GATE_ARCH_CLEAR_HEIGHT 3.60   GATE_ARCH_CLEAR_WIDTH 7.00
 * ARRIVAL_ARCH_DISTANCE 4.0   ARRIVAL_CONTROL_AT 9.30   ARRIVAL_RISE_TAIL 1.60
 * green run: 27 checks; swept headroom 0.3737 m, swept sideroom 0.8098 m
 * ```
 *
 * | mutation | result |
 * |---|---|
 * | none (control) | pass, 27 checks, exit 0 |
 * | `CHEST` back to the copied 1.1 | headroom reads 0.5237 m — 0.15 m of margin that is not there |
 * | `ARRIVAL_ARCH_DISTANCE` 4.0 → 5.5 | **red, both clauses**: headroom -0.4060 m at t=9.27 s, sideroom -0.4756 m, exit 1 |
 *
 * ## Proved red again for the leading eye (3 September 2026)
 *
 * The shot went square-on, which put the eye **in front of** her through the
 * gateway instead of behind. Geometry it was proved against:
 *
 * ```
 * ARRIVAL_DOOR_THREE_QUARTER_DEGREES 0   ARRIVAL_GATE_STANDOFF 3
 * ARRIVAL_DOOR_DISTANCE ~6.6 m   ARRIVAL_ARCH_DISTANCE 4.0
 * eye z-offset at the pass -3.65 m (NEGATIVE — the eye leads her)
 * green run: 36 checks; bearing swings 135.0°, headroom 0.4990 m, sideroom 3.5000 m
 * ```
 *
 * | mutation | result |
 * |---|---|
 * | none (control) | pass, 36 checks, exit 0 |
 * | pace as `offset / (later - earlier)` — the fixed-order subtraction the old code did | **red, 9 passes**: -3.2482, -4.3350, -2.5500 m/s and so on, exit 1 |
 *
 * **And one mutation that stays green, recorded because it is the honest edge
 * of what this can do.** Turning `ARRIVAL_DOOR_THREE_QUARTER_DEGREES` from 60
 * down to 3 — which puts the gate arch squarely across the doorway, the
 * composition fault this shot was rebuilt to fix — still passes every clause
 * here, at a bearing swing of 132°. Nothing in this file can see composition or
 * occlusion. See the note it prints to stderr on every run.
 *
 * ## Proved red for the face-height door beat (3 September 2026)
 *
 * Jim: *"For the arrival shot the camera should be face height so the ground
 * should be visible normally."* Clause 9 is what holds that. Geometry it was
 * proved against, pasted with the transcript because a red run is a measurement
 * and measurements go stale:
 *
 * ```
 * ARRIVAL_DOOR_PITCH_DEGREES 0    ARRIVAL_DOOR_DISTANCE ~6.6 m
 * ARRIVAL_DOOR_FOCUS_LIFT = KID_HEAD_HEIGHT 1.36 + kidEyeCentre(1).y 0.056 = 1.4157 m
 * ARRIVAL_DOOR_ZOOM 2.2957 -> a 6.534 m frame on 16:10
 * green run: 39 checks; the eye rides 1.4157-1.4157 m through the door beat at 0.00 deg of tilt
 * ```
 *
 * | mutation | result |
 * |---|---|
 * | none (control) | pass, 39 checks, exit 0 |
 * | `ARRIVAL_DOOR_FOCUS_LIFT` back to the typed 1.1 "about a child's chest" | **red, clause 9**: eye 1.1000 m, off by -0.3157 m, exit 1 |
 * | `ARRIVAL_DOOR_PITCH_DEGREES` back to 24 — the sign-across-her composition | **red, clause 9**: eye rides 4.0871 m, off by +2.6714 m, exit 1 |
 *
 * That second mutation is the live risk rather than a hypothetical one: it is
 * the obvious way to fill the empty bottom of frame, it is what Jim has
 * rejected twice, and at 4.09 m the eye would also be *above* the arch's 3.60 m
 * crossbar. Clause 9 is what stands between the next round and reaching for it.
 *
 * Run: `pnpm run check:arrival-camera`
 */
import { Vector3 } from 'three';
import { CAMERA_FOCUS_LIFT, IsoCamera } from '../src/core/IsoCamera.ts';
import { cameraOffset } from '../src/core/cameraRig.ts';
import {
  CAMERA_DISTANCE,
  CAMERA_MIN_VIEW_WIDTH,
  CAMERA_PITCH_DEGREES,
  CAMERA_VIEW_HEIGHT,
  CAMERA_YAW_DEGREES,
} from '../src/core/constants.ts';
import { angleDelta, DEG } from '../src/core/mathUtils.ts';
import {
  ARRIVAL_CONTROL_AT,
  ARRIVAL_DOOR_FOCUS_LIFT,
  ARRIVAL_DOOR_ZOOM,
  ARRIVAL_RISE_TAIL,
  AT_SHOT_HOME,
  arrivalShot,
  AT_WALKING,
  type ArchPass,
} from '../src/world/entrance/ArrivalSequence.ts';
import { GATE_ARCH_CLEAR_HEIGHT, GATE_ARCH_CLEAR_WIDTH } from '../src/art/models/gateArch.ts';
import { KID_HEAD_HEIGHT, kidEyeCentre, TALLEST_CHILD_HEIGHT } from '../src/art/models/kid.ts';
import { NPC_WALK_SPEED } from '../src/entities/npc/NpcCharacter.ts';

/**
 * The walking paces the pass is swept at, in m/s.
 *
 * **The spacing between the two crossings is derived from these, not typed.**
 * The two are one eye-offset apart along z, so `spacing = offset / pace` — fix
 * the spacing instead and you have implicitly asserted a pace, which is how
 * the previous version came to model a 5.99 m/s child without saying so. She
 * is driven along a fixed-duration bezier through a `smoothstep`, so her pace
 * through the gateway is around `NPC_WALK_SPEED` at the low end and about 1.5x
 * that at the curve's peak; this brackets it either side.
 */
const SWEEP_PACES = [NPC_WALK_SPEED, NPC_WALK_SPEED * 1.25, NPC_WALK_SPEED * 1.7];

/**
 * **The arch pass is swept, not pinned.** The instants she and the eye cross
 * the gate line are solved by `ArrivalSequence` off its own bezier, and that
 * bezier starts wherever the bus put its door — which the curved-road branch
 * is about to move. Pinning one pair here would be a second copy of a number
 * that is about to change; sweeping the range proves the *shape* of the shot
 * is right for any of them, which is the property that has to survive.
 *
 * Measured on the game as it stands: she is under the arch 44% of the way
 * through the walk, `under` = 6.79 s.
 */
/**
 * The eye's own z-offset at the pose it holds through the gateway, measured off
 * the shot rather than imported — `ARRIVAL_ARCH_EYE_OFFSET_Z` is private, and
 * asking the shot is the same question one layer out. **Signed**: negative
 * while the eye leads her, which is what the square-on pass does.
 */
const EYE_OFFSET_AT_THE_PASS = (() => {
  const probe: ArchPass = { sheThrough: ARRIVAL_CONTROL_AT - 2, eyeThrough: ARRIVAL_CONTROL_AT - 2 };
  const shot = arrivalShot(probe.sheThrough, probe)!;
  return (
    shot.distance * Math.cos(shot.pitchDegrees * DEG) * Math.cos(shot.yawDegrees * DEG)
  );
})();

const PASSES: readonly ArchPass[] = [0.25, 0.44, 0.7].flatMap((fraction) =>
  SWEEP_PACES.map((pace) => {
    const walkStart = ARRIVAL_CONTROL_AT - 4.5;
    const sheThrough = walkStart + fraction * 4.5;
    // `spacing = offset / pace`, and the SIGN of the offset decides which of
    // the two crossings comes first. A leading eye (negative offset) is
    // through before her; a trailing one after. Neither is assumed anywhere
    // downstream — see `ArchPass`.
    const spacing = EYE_OFFSET_AT_THE_PASS / pace;
    return { sheThrough, eyeThrough: Math.max(AT_WALKING, sheThrough + spacing) };
  }),
);
/** The one nearest the game's own geometry, for the single-value clauses. */
const PASS: ArchPass = PASSES[3]!;

let checks = 0;
let failures = 0;
function check(ok: boolean, what: string): void {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.log(`  FAIL: ${what}`);
  }
}
/**
 * Formats a measurement so a failure message can never read
 * `measured 0.0000, wanted 0.0000` — which is what a fixed four decimals
 * printed the first time clause 4 was proved red, on a real 4.3 mm miss.
 * CLAUDE.md's rule about failure messages carrying real numbers is exactly
 * this: a message that cannot show the difference it is complaining about is
 * a check nobody can act on.
 */
const show = (value: number): string =>
  value !== 0 && Math.abs(value) < 1e-3 ? value.toExponential(3) : value.toFixed(4);

function near(value: number, want: number, tolerance: number, what: string): void {
  check(
    Math.abs(value - want) <= tolerance,
    `${what} — measured ${show(value)}, wanted ${show(want)} ± ${show(tolerance)} ` +
      `(off by ${show(value - want)})`,
  );
}

/** How far the shot's bearing must swing off the rig's, in degrees. */
const BEARING_SWING_FLOOR = 60;
/** How far the eye must actually travel through the world, in metres. */
const EYE_TRAVEL_FLOOR = 40;
/** The stand-back below which the camera counts as riding with her. */
const NEAR_THE_ARCH = 8;
/**
 * How far above its own closest ride the eye may be and still be counted as
 * "in the gateway", as a multiple.
 *
 * **A band, not a time window, and not a bare threshold** — both were tried and
 * both were wrong. A time window stops meaning anything when the dive is
 * retimed, which it has been twice. A bare `distance < 8` looks right and is
 * not: the stand-back passes *through* that value twice, once diving in and
 * once opening back out on the rise, and the second time the camera is well
 * past the arch with its tilt already climbing — so the clause measured a
 * "headroom" of -1.32 m on a camera that was nowhere near the crossbar, and
 * went red on a shot that was correct. Anchoring to the shot's own minimum
 * makes it self-scoping: the eye is only within 15% of its closest ride while
 * it is threading the gateway.
 */
const RIDING_BAND = 1.15;

const STEP = 1 / 60;

/**
 * **How tall a slice of world the frame shows at a given zoom**, in metres.
 *
 * `IsoCamera.frustumBase` is private, so this restates it — but it restates it
 * from the two constants that own it rather than from their values. Clause 8
 * carried `Math.max(15 / 2, 11 / 2 / 1.6)` written out in digits, which is two
 * hand-copied numbers of exactly the kind this repo keeps being bitten by: a
 * retuned `CAMERA_VIEW_HEIGHT` would have moved the game and left this script
 * measuring the old one, silently and greenly.
 *
 * The default aspect is the 16:10 the game is judged on; a portrait phone hits
 * the width floor instead and gets a *taller* frame, which is noted where it
 * matters rather than swept here.
 */
const DEFAULT_ASPECT = 1.6;
const frameHeightAt = (zoom: number, aspect = DEFAULT_ASPECT): number =>
  (2 * Math.max(CAMERA_VIEW_HEIGHT / 2, CAMERA_MIN_VIEW_WIDTH / 2 / aspect)) / zoom;

/**
 * **Where a child's face is above her own feet**, in metres — read from the one
 * file that owns her head, not copied.
 *
 * The same expression `ARRIVAL_DOOR_FOCUS_LIFT` is built from, deliberately, so
 * that clause 9 is asking *"is the shot still taken at the face?"* rather than
 * *"does this constant still equal the number I wrote down?"*. If `kid.ts`
 * re-scales the head, both move together and the clause keeps meaning what it
 * says.
 */
const CHILD_FACE_HEIGHT = KID_HEAD_HEIGHT + kidEyeCentre(1).y;

// ---------------------------------------------------------------------------
// 1. the camera genuinely changes where it looks from
// ---------------------------------------------------------------------------
console.log('the shot goes somewhere: bearing, tilt and eye position');
{
  let widestBearing = 0;
  let widestTilt = 0;
  const eyes: Vector3[] = [];
  for (let t = 0; t < AT_SHOT_HOME; t += STEP) {
    const shot = arrivalShot(t, PASS);
    if (!shot) break;
    widestBearing = Math.max(
      widestBearing,
      Math.abs(angleDelta(CAMERA_YAW_DEGREES * DEG, shot.yawDegrees * DEG) / DEG),
    );
    widestTilt = Math.max(widestTilt, Math.abs(shot.pitchDegrees - CAMERA_PITCH_DEGREES));
    const eye = cameraOffset(shot.yawDegrees * DEG, shot.pitchDegrees * DEG, shot.distance);
    eyes.push(new Vector3(eye.x, eye.y, eye.z));
  }
  const rig = cameraOffset(CAMERA_YAW_DEGREES * DEG, CAMERA_PITCH_DEGREES * DEG, CAMERA_DISTANCE);
  const rigEye = new Vector3(rig.x, rig.y, rig.z);
  let farthestEye = 0;
  for (const eye of eyes) farthestEye = Math.max(farthestEye, eye.distanceTo(rigEye));

  console.log(
    `  bearing swings ${widestBearing.toFixed(1)}°, tilt ${widestTilt.toFixed(1)}°, ` +
      `eye travels ${farthestEye.toFixed(1)} m from the rig's own`,
  );
  check(
    widestBearing >= BEARING_SWING_FLOOR,
    `the shot must look from a genuinely different bearing — swung ${widestBearing.toFixed(1)}°, ` +
      `wanted at least ${BEARING_SWING_FLOOR}°. A shot that keeps the rig's yaw has not moved: ` +
      `this is an orthographic camera, so bearing, tilt and focus are all "moving" can mean.`,
  );
  check(
    farthestEye >= EYE_TRAVEL_FLOOR,
    `the eye must actually go somewhere — travelled ${farthestEye.toFixed(1)} m, ` +
      `wanted at least ${EYE_TRAVEL_FLOOR} m`,
  );
  check(widestTilt > 5, `the tilt must drop too — moved ${widestTilt.toFixed(1)}°`);
}

// ---------------------------------------------------------------------------
// 2. the bearing and the framing are home before she can touch anything
// ---------------------------------------------------------------------------
console.log('the bearing is home the instant she gets the controls (the CONTROL rule)');
{
  const atHandover = arrivalShot(ARRIVAL_CONTROL_AT, PASS);
  check(atHandover !== null, 'the shot is still running at the hand-over — beat three needs it to be');
  if (atHandover) {
    near(
      angleDelta(CAMERA_YAW_DEGREES * DEG, atHandover.yawDegrees * DEG) / DEG,
      0,
      0.05,
      'the bearing must be the rig\'s own when she is handed the stick, or "up" is not up the screen',
    );
    near(atHandover.zoom, 1, 0.001, 'she must be handed the ordinary framing, not the shot\'s');
    // The stand-back is deliberately NOT home here — it opens out across the
    // hand-over with the tilt, which is the rise. It competes with nothing she
    // can press, so unlike the zoom it costs her no input.
    check(
      atHandover.distance < CAMERA_DISTANCE,
      'the stand-back should still be opening out at the hand-over — that is the rise',
    );
  }
  // Every frame from the hand-over on, not just the one — reported as the one
  // worst offender rather than ninety lines saying the same thing.
  let worstAfter = 0;
  let worstAt = 0;
  for (let t = ARRIVAL_CONTROL_AT; t < AT_SHOT_HOME; t += STEP) {
    const shot = arrivalShot(t, PASS);
    if (!shot) continue;
    const off = Math.abs(angleDelta(CAMERA_YAW_DEGREES * DEG, shot.yawDegrees * DEG) / DEG);
    if (off > worstAfter) {
      worstAfter = off;
      worstAt = t;
    }
  }
  check(
    worstAfter <= 0.05,
    `the bearing must not move once she has the controls — worst was ${show(worstAfter)}° off ` +
      `at t=${worstAt.toFixed(2)}s, ${((worstAt - ARRIVAL_CONTROL_AT) * 1000).toFixed(0)} ms after the hand-over`,
  );
}

// ---------------------------------------------------------------------------
// 3. the tilt is still rising under her hand — Jim's third beat
// ---------------------------------------------------------------------------
console.log('the rise happens under her hand, and finishes');
{
  const atHandover = arrivalShot(ARRIVAL_CONTROL_AT, PASS);
  const stillToRise = atHandover ? CAMERA_PITCH_DEGREES - atHandover.pitchDegrees : 0;
  console.log(`  ${stillToRise.toFixed(1)}° of tilt still to lift when she gets the controls`);
  check(
    stillToRise > 1,
    `beat three must not be over before it starts — only ${stillToRise.toFixed(1)}° left to rise ` +
      `at the hand-over. ARRIVAL_RISE_TAIL is ${ARRIVAL_RISE_TAIL.toFixed(2)}s.`,
  );
  check(arrivalShot(AT_SHOT_HOME, PASS) === null, 'the shot must let go at AT_SHOT_HOME');
  check(
    arrivalShot(AT_SHOT_HOME + 60, PASS) === null,
    'and stay let go — a shot that came back later would seize a camera she is playing with',
  );
}

// ---------------------------------------------------------------------------
// 4. driven through a real IsoCamera, it lands on the rig exactly
// ---------------------------------------------------------------------------
console.log('driven at 60fps through a real IsoCamera, it lands on the rig exactly');
{
  const camera = new IsoCamera();
  camera.resize(1280, 720);
  const her = new Vector3(0, 0, 60);
  camera.snapTo(her);
  const frame = {
    dt: STEP,
    elapsed: 0,
    frame: 0,
    playerPosition: her,
    cameraForward: camera.forward,
    input: { justPressed: () => false },
  } as unknown as Parameters<IsoCamera['update']>[0];
  const still = new Vector3(0, 0, 0);

  let worstStep = 0;
  let previous: Vector3 | null = null;
  // The wiring `Game.tick` does, restated in three lines because there is no
  // way to construct `Game` here (it builds a real `WebGLRenderer`). If those
  // three lines and this one ever disagree, the browser run in the PR is what
  // catches it — which is why the PR carries frames as well as this transcript.
  for (let t = 0; t <= AT_SHOT_HOME + 3; t += STEP) {
    const shot = arrivalShot(t, PASS);
    if (shot) camera.setShotOverride(shot.yawDegrees, shot.pitchDegrees, shot.distance);
    else camera.clearPoseOverride();
    camera.update(frame, her, still);
    const here = camera.camera.position.clone();
    if (previous) worstStep = Math.max(worstStep, here.distanceTo(previous));
    previous = here;
  }

  near(camera.poseDistance, 0, 0, 'the pose delta must reach exactly zero, not approach it');
  const rig = cameraOffset(CAMERA_YAW_DEGREES * DEG, CAMERA_PITCH_DEGREES * DEG, CAMERA_DISTANCE);
  const landed = camera.camera.position.clone().sub(camera.focusPoint as Vector3);
  near(landed.x, rig.x, 1e-3, 'the landed eye must be the rig\'s own offset (x)');
  near(landed.y, rig.y, 1e-3, 'the landed eye must be the rig\'s own offset (y)');
  near(landed.z, rig.z, 1e-3, 'the landed eye must be the rig\'s own offset (z)');

  // ---- 6. no cut ---------------------------------------------------------
  console.log(`  worst single frame moved the eye ${worstStep.toFixed(3)} m`);
  check(
    worstStep < 4,
    `no frame may cut — the worst moved the eye ${worstStep.toFixed(3)} m in 1/60 s`,
  );
}

// ---------------------------------------------------------------------------
// 5. dt-driven: a pause holds it, a long frame does not overshoot
// ---------------------------------------------------------------------------
console.log('the shot is dt-driven: a pause holds it, a slow machine still lands it');
{
  /** Drives the whole shot at `fps`, optionally stalling for `stallSeconds`
   *  of paused frames in the middle, and reports where the camera ended up and
   *  how far a pause moved it. */
  function run(fps: number, stallAt: number, stallSeconds: number) {
    const camera = new IsoCamera();
    camera.resize(1280, 720);
    const her = new Vector3(0, 0, 60);
    camera.snapTo(her);
    const still = new Vector3(0, 0, 0);
    const step = 1 / fps;
    const frame = {
      dt: step,
      elapsed: 0,
      frame: 0,
      playerPosition: her,
      cameraForward: camera.forward,
      input: { justPressed: () => false },
    } as unknown as Parameters<IsoCamera['update']>[0];
    const paused = { ...(frame as object), dt: 0 } as typeof frame;

    let movedWhilePaused = 0;
    for (let t = 0; t <= AT_SHOT_HOME + 3; t += step) {
      const shot = arrivalShot(t, PASS);
      if (shot) camera.setShotOverride(shot.yawDegrees, shot.pitchDegrees, shot.distance);
      else camera.clearPoseOverride();
      camera.update(frame, her, still);
      if (stallSeconds > 0 && t >= stallAt && t < stallAt + step) {
        // The park is paused: `dt` is zero for everything, and
        // `ArrivalSequence.update` returns early, so the shot's own clock does
        // not move either — the same `arrivalShot(t, PASS)` is re-asserted.
        const before = camera.camera.position.clone();
        for (let n = 0; n < stallSeconds * fps; n += 1) camera.update(paused, her, still);
        movedWhilePaused = camera.camera.position.distanceTo(before);
      }
    }
    return { camera, movedWhilePaused };
  }

  const rig = cameraOffset(CAMERA_YAW_DEGREES * DEG, CAMERA_PITCH_DEGREES * DEG, CAMERA_DISTANCE);
  // Mid-swing, where a stranded blend would be most obvious.
  const stalled = run(60, 6.0, 5);
  near(
    stalled.movedWhilePaused,
    0,
    0,
    'five seconds of paused frames mid-blend must move the camera not at all',
  );
  console.log(`  five paused seconds mid-blend moved the eye ${stalled.movedWhilePaused.toFixed(6)} m`);

  for (const fps of [15, 30, 60, 144]) {
    const { camera } = run(fps, 0, 0);
    const landed = camera.camera.position.clone().sub(camera.focusPoint as Vector3);
    near(
      Math.hypot(landed.x - rig.x, landed.y - rig.y, landed.z - rig.z),
      0,
      1e-3,
      `at ${fps} fps the shot must still land on the rig — a blend counting frames would not`,
    );
  }
  // And the stalled run lands too: a pause must not strand it half-risen.
  const stalledLanded = stalled.camera.camera.position
    .clone()
    .sub(stalled.camera.focusPoint as Vector3);
  near(
    Math.hypot(stalledLanded.x - rig.x, stalledLanded.y - rig.y, stalledLanded.z - rig.z),
    0,
    1e-3,
    'a run that was paused mid-blend must still land on the rig once it resumes',
  );
}

// ---------------------------------------------------------------------------
// 7. the camera fits through the arch it is going under
// ---------------------------------------------------------------------------
console.log('the eye passes under the crossbar and between the piers');
{
  // The eye rides at `focus.y + d·sin(pitch)` above the paving, with the focus
  // at a child's chest, and sits off to one side by `d·cos(pitch)·sin(yaw)`.
  // Both are measured against the arch's own published clearances, so an arch
  // resized by its artist moves these rather than quietly invalidating them.
  //
  // **The lift is read from `IsoCamera`, not typed here.** The arch pass runs
  // with `watchesTheDoor === false`, so the shot is orbiting the ordinary
  // player-follow focus — her feet plus {@link CAMERA_FOCUS_LIFT}. An earlier
  // version of this clause hand-copied 1.1 from `ARRIVAL_DOOR_FOCUS_LIFT`,
  // which is the *door beat's* aim height and belongs to a beat that is over
  // by the time the eye reaches the gateway. It measured the eye 0.15 m low,
  // and that 0.15 m was the whole of the margin the clause reported.
  const CHEST = CAMERA_FOCUS_LIFT;
  let worstHeadroom = Infinity;
  let worstSideroom = Infinity;
  let worstAt = 0;
  for (const pass of PASSES) {
    // **Scoped by the stand-back itself, not by a time window.** The eye is
    // only anywhere near the arch while it is riding close, so "close" is the
    // honest definition of "in the gateway" — and it stays honest if the dive
    // is retimed, which it has been twice. An earlier version swept a fixed
    // window and reported a "headroom" of -9.62 m measured on a camera 45 m
    // away and climbing.
    let riding = Infinity;
    for (let t = AT_WALKING; t <= AT_SHOT_HOME; t += STEP) {
      const shot = arrivalShot(t, pass);
      if (shot) riding = Math.min(riding, shot.distance);
    }
    // **And cut at `clear`, which is the last instant this file can say where
    // the eye *is*.** A headroom is a height measured at a place, and the only
    // place `ArrivalSequence` hands over is `clear` — by its own definition the
    // instant the eye is on the gate line, solved off the bezier she walks.
    // Before it, the eye is outside the gateway coming in, and a band-scoped
    // sweep is sound because the height only falls. After it the eye is
    // *leaving*, and how far it has got depends on how fast she is walking,
    // which this file has no model of — so a height asserted there is a height
    // at an unknown horizontal position, which is the "assertion reporting
    // success about something it is not describing" fault in miniature.
    //
    // What that costs is real and is not hidden: the eye's climb back out
    // through the plane of the arch is now **uncovered**, and it is measured
    // and printed to stderr below rather than asserted. Do not read the number
    // above as covering it.
    for (let t = AT_WALKING; t <= Math.max(pass.sheThrough, pass.eyeThrough); t += STEP) {
      const shot = arrivalShot(t, pass);
      if (!shot || shot.distance > riding * RIDING_BAND) continue;
      const eyeUp = CHEST + shot.distance * Math.sin(shot.pitchDegrees * DEG);
      const eyeAside = Math.abs(
        shot.distance * Math.cos(shot.pitchDegrees * DEG) * Math.sin(shot.yawDegrees * DEG),
      );
      const headroom = GATE_ARCH_CLEAR_HEIGHT - eyeUp;
      const sideroom = GATE_ARCH_CLEAR_WIDTH / 2 - eyeAside;
      if (headroom < worstHeadroom) {
        worstHeadroom = headroom;
        worstAt = t;
      }
      worstSideroom = Math.min(worstSideroom, sideroom);
    }
  }
  console.log(
    `  worst headroom ${show(worstHeadroom)} m under the ${GATE_ARCH_CLEAR_HEIGHT.toFixed(2)} m crossbar, ` +
      `worst sideroom ${show(worstSideroom)} m inside the ${GATE_ARCH_CLEAR_WIDTH.toFixed(2)} m opening`,
  );
  check(
    worstHeadroom > 0.3,
    `the eye must pass UNDER the crossbar, not through it — worst headroom ${show(worstHeadroom)} m ` +
      `at t=${worstAt.toFixed(2)}s, against a ${GATE_ARCH_CLEAR_HEIGHT.toFixed(2)} m clear height. ` +
      `A camera that clips the arch reads as a bug, not as a move.`,
  );
  check(
    worstSideroom > 0.3,
    `the eye must pass BETWEEN the piers — worst sideroom ${show(worstSideroom)} m ` +
      `inside a ${GATE_ARCH_CLEAR_WIDTH.toFixed(2)} m opening`,
  );
  // And it must genuinely be close, *while the arch is overhead*: a "pass
  // through the arch" that happens at the rig's 90 m stand-back is a camera
  // watching from the far side of the park, which is the note this whole round
  // came from. Measured as the closest the shot ever rides, plus an assertion
  // that it rides that close somewhere inside the gateway.
  let closest = Infinity;
  let closestAt = 0;
  let inTheGateway = false;
  for (const pass of PASSES) {
    for (let t = AT_WALKING; t <= AT_SHOT_HOME; t += STEP) {
      const shot = arrivalShot(t, pass);
      if (!shot || shot.distance >= closest) continue;
      closest = shot.distance;
      closestAt = t;
      inTheGateway =
        t >= Math.min(pass.sheThrough, pass.eyeThrough) &&
        t <= Math.max(pass.sheThrough, pass.eyeThrough) + ARRIVAL_RISE_TAIL;
    }
  }
  check(
    inTheGateway,
    `the closest the camera rides must be while the arch is overhead — it was at ` +
      `t=${closestAt.toFixed(2)}s, outside the gateway window`,
  );
  console.log(`  closest stand-back at the pass: ${show(closest)} m`);
  check(
    closest < NEAR_THE_ARCH,
    `the camera must actually go under the arch with her — closest stand-back ${show(closest)} m`,
  );
}

// ---------------------------------------------------------------------------
// 8. the close shot frames a child, not a vehicle
// ---------------------------------------------------------------------------
console.log('the door shot is close enough to read a face');
{
  let tightest = 0;
  for (let t = 0; t < AT_SHOT_HOME; t += STEP) {
    const shot = arrivalShot(t, PASS);
    if (shot) tightest = Math.max(tightest, shot.zoom);
  }
  const sheFills = TALLEST_CHILD_HEIGHT / frameHeightAt(tightest);
  console.log(
    `  tightest zoom ${show(tightest)} — a child fills ${(sheFills * 100).toFixed(0)}% of frame height`,
  );
  check(
    sheFills > 0.3,
    `Jim asked for "much closer" — a child fills only ${(sheFills * 100).toFixed(0)}% of the frame ` +
      `at the tightest point (zoom ${show(tightest)})`,
  );
}

// ---------------------------------------------------------------------------
// 9. the door beat is taken at a child's face, horizontally
// ---------------------------------------------------------------------------
console.log("the door shot is taken at a child's own face height, looking level");
{
  // Jim, 3 September 2026: *"For the arrival shot the camera should be face
  // height so the ground should be visible normally."*
  //
  // **This is one assertion, not two, and that is the point.** At zero pitch
  // `cameraOffset`'s offset has no `y` at all, so the eye rides at exactly the
  // focus height — `ARRIVAL_DOOR_FOCUS_LIFT + d·sin(pitch)` with the second
  // term zero. Measuring the eye rather than reading the constant therefore
  // catches *both* ways this shot can stop being what he asked for: somebody
  // moving the aim height off the face, and somebody reintroducing a downward
  // tilt to fill the bottom of the frame. The second is the live risk — it is
  // the sign-across-her composition he has now rejected twice, and at 24° of
  // tilt and a 6.6 m stand-back the eye rides 2.7 m up rather than 1.42 m.
  let lowest = Infinity;
  let highest = -Infinity;
  let sawTheDoorBeat = false;
  let worstTilt = 0;
  for (let t = 0; t < AT_SHOT_HOME; t += STEP) {
    const shot = arrivalShot(t, PASS);
    if (!shot || !shot.watchesTheDoor) continue;
    sawTheDoorBeat = true;
    const eyeUp =
      ARRIVAL_DOOR_FOCUS_LIFT + shot.distance * Math.sin(shot.pitchDegrees * DEG);
    lowest = Math.min(lowest, eyeUp);
    highest = Math.max(highest, eyeUp);
    worstTilt = Math.max(worstTilt, Math.abs(shot.pitchDegrees));
  }
  check(sawTheDoorBeat, 'there must BE a door beat — no frame reported watchesTheDoor');
  console.log(
    `  the eye rides ${show(lowest)}–${show(highest)} m up through the door beat, ` +
      `against a face at ${show(CHILD_FACE_HEIGHT)} m; worst tilt ${worstTilt.toFixed(2)}°`,
  );
  near(
    lowest,
    CHILD_FACE_HEIGHT,
    0.01,
    "the door shot's eye must sit at a child's face — Jim asked for face height, and at " +
      'zero pitch the eye height IS the aim height, so a miss here is either a moved aim ' +
      'or a reintroduced downward tilt',
  );
  near(
    highest,
    CHILD_FACE_HEIGHT,
    0.01,
    'and must stay there for the whole beat, not only at its start',
  );

  // **The empty band below the ground line — measured, and printed rather than
  // asserted.** A horizontal orthographic camera sees the ground exactly
  // edge-on, so the ground plane projects to a line at the eye's own height and
  // nothing renders below it. There is no threshold to assert against: how much
  // empty frame is acceptable is a composition question and Jim's alone. What
  // this file can do is stop the number being invisible, since it is the whole
  // subject of the round that produced it.
  //
  // **Swept over the whole level stretch of the shot, not just its tightest
  // frame** — and that is not a refinement, it is where the number actually
  // lives. The tilt reaches zero at `AT_STOPPED` but the framing does not push
  // in until `AT_WALKING`, so for the 1.8 s between them the shot is level at
  // the *wide* zoom, and a wider frame has a taller half-height and therefore a
  // bigger empty band. Measured at the door beat alone this reads 28.3%; the
  // worst frame in the shot is far worse, and it is the one most likely to be
  // read as broken. Found by watching, not by arithmetic.
  const LEVEL_ENOUGH_DEGREES = 2;
  let worstBand = -Infinity;
  let worstFrame = 0;
  let worstAt = 0;
  let doorBeatFrame = 0;
  for (let t = 0; t < AT_SHOT_HOME; t += STEP) {
    const shot = arrivalShot(t, PASS);
    // Only while the view is level. At any real tilt the ground fills the lower
    // frame in the ordinary way and there is no band to measure.
    if (!shot || Math.abs(shot.pitchDegrees) > LEVEL_ENOUGH_DEGREES) continue;
    const height = frameHeightAt(shot.zoom);
    // The *tightest* level frame, which is where the band is smallest — the
    // other end of the same range, so the pair brackets what is on screen
    // rather than quoting one end twice.
    if (height < doorBeatFrame || doorBeatFrame === 0) doorBeatFrame = height;
    if (height / 2 - ARRIVAL_DOOR_FOCUS_LIFT > worstBand) {
      worstBand = height / 2 - ARRIVAL_DOOR_FOCUS_LIFT;
      worstFrame = height;
      worstAt = t;
    }
  }
  const band = (height: number): string =>
    `${show(height / 2 - ARRIVAL_DOOR_FOCUS_LIFT)} m of a ${show(height)} m frame ` +
    `(${(((height / 2 - ARRIVAL_DOOR_FOCUS_LIFT) / height) * 100).toFixed(1)}%)`;
  process.stderr.write(
    'MEASURED, NOT ASSERTED — the empty band under the ground line. A purely horizontal ' +
      'orthographic camera sees the ground edge-on, so it projects to a LINE at the eye ' +
      'height and the frame below it is empty sky. On 16:10:\n' +
      `    worst frame in the shot, at t=${worstAt.toFixed(2)}s:  ${band(worstFrame)}\n` +
      `    tightest level frame (the door beat's own):  ${band(doorBeatFrame)}\n` +
      `    390x844 portrait, door beat:  ${band(frameHeightAt(ARRIVAL_DOOR_ZOOM, 390 / 844))}\n` +
      `    the band is frameHeight/2 - eyeHeight, so it closes only at an eye of ` +
      `${show(worstFrame / 2)} m at the worst frame — well above a child's head, not at her ` +
      'face. RAISING the eye shrinks it; the worst frame is wide-and-level, between the ' +
      'tilt reaching zero and the framing pushing in.\n' +
      '    Tilting the camera down would close it and is NOT available: that is the ' +
      'sign-across-her composition Jim has ruled out twice, and clause 9 above fails on it. ' +
      'Whether what is left reads as a look or as a bug is his call, from a rendered frame.\n',
  );
}

// ---------------------------------------------------------------------------
// What this check cannot see — said out loud on every run, per CLAUDE.md
// ---------------------------------------------------------------------------
// **The climb back out through the plane of the arch — measured, not asserted.**
//
// Clause 7 stops at `clear`, the last instant `ArrivalSequence` can say where
// the eye is. What happens next is structural rather than tuneable: the
// stand-back opens from 4 m to the rig's 90 m in `ARRIVAL_RISE_TAIL`, tens of
// metres a second, which is far faster than a child walks — so the eye, having
// dipped just past the gate line, is dragged back out through it while its
// tilt is still lifting. It therefore crosses the arch's own plane on the way
// home, and how high it is when it does decides whether it grazes the sign.
//
// That cannot be asserted here, because it needs her position after the
// handover and this file has no park. It can be *measured*, at the one pace
// the pass itself implies — `clear` is by definition the instant she is the
// eye's own lag past the line she crossed at `under`, so that lag over that
// interval is her speed there, derived rather than copied. Printed with the
// modelling stated, so nobody reads clause 7's margin as covering it.
{
  const eyeZOffset = (shot: NonNullable<ReturnType<typeof arrivalShot>>): number =>
    shot.distance * Math.cos(shot.pitchDegrees * DEG) * Math.cos(shot.yawDegrees * DEG);
  const lines: string[] = [];
  for (const pass of PASSES) {
    const gatewayEntered = Math.min(pass.sheThrough, pass.eyeThrough);
    const gatewayLeft = Math.max(pass.sheThrough, pass.eyeThrough);
    const atCrossing = arrivalShot(pass.eyeThrough, pass);
    if (!atCrossing) continue;
    const offsetAtCrossing = eyeZOffset(atCrossing);
    // Her pace where it matters, derived from the pass itself: the two
    // crossings are one eye-offset apart along z, so that distance over that
    // interval is her speed there. `Math.abs` on BOTH, because the offset is
    // signed (a leading eye makes it negative) and a pace is not.
    const pace = Math.abs(offsetAtCrossing) / Math.max(1e-3, gatewayLeft - gatewayEntered);
    // **A pace that is not a positive, plausible walking speed means the model
    // is broken, and that must FAIL rather than print.** This clause used to
    // print whatever fell out; when the shot went square-on and the eye began
    // leading her, it printed -3.65 m/s on four passes out of five and every
    // number beside it was meaningless. A child walks; she does not walk
    // backwards at a constant speed, and she does not sprint at 20 m/s.
    check(
      pace > 0 && pace < NPC_WALK_SPEED * 2.5,
      `the pace derived from the arch pass must be a real walking speed — got ${show(pace)} m/s ` +
        `on the pass crossing at ${gatewayEntered.toFixed(2)}/${gatewayLeft.toFixed(2)}. ` +
        `A negative or absurd pace means the two crossings have been subtracted in a fixed ` +
        `order that the eye's own offset no longer justifies.`,
    );
    let backOutAt: number | null = null;
    let backOutEyeUp = 0;
    for (let t = pass.eyeThrough + STEP; t <= AT_SHOT_HOME; t += STEP) {
      const shot = arrivalShot(t, pass);
      if (!shot) break;
      // Zero at the eye's own crossing by construction; the sign convention
      // follows the offset, so "back out" is a return towards the bus side.
      const eyeZ = eyeZOffset(shot) - offsetAtCrossing - pace * (t - pass.eyeThrough);
      if (Math.sign(eyeZ) !== Math.sign(offsetAtCrossing) || eyeZ === 0) continue;
      backOutAt = t;
      backOutEyeUp = CAMERA_FOCUS_LIFT + shot.distance * Math.sin(shot.pitchDegrees * DEG);
      break;
    }
    lines.push(
      backOutAt === null
        ? `    pass ${gatewayEntered.toFixed(2)}/${gatewayLeft.toFixed(2)}: the eye never returns to the gate line — it leaves through the arch and stays gone`
        : `    pass ${gatewayEntered.toFixed(2)}/${gatewayLeft.toFixed(2)}: back on the gate line at t=${backOutAt.toFixed(2)}s, ` +
          `eye ${backOutEyeUp.toFixed(2)} m up — ${show(GATE_ARCH_CLEAR_HEIGHT - backOutEyeUp)} m ` +
          `${backOutEyeUp > GATE_ARCH_CLEAR_HEIGHT ? 'ABOVE the sign underside (it is through the plank)' : 'under the sign underside'}` +
          `, at a modelled ${pace.toFixed(2)} m/s`,
    );
  }
  process.stderr.write(
    'UNCOVERED by check:arrival-camera: the eye rises back out through the plane of the ' +
      'arch on its way home, and clause 7 asserts NOTHING about that — it stops at `clear`, ' +
      'the last instant this file can place the eye. Measured below at the pace each pass ' +
      'implies, which is a model and not the park:\n' +
      `${lines.join('\n')}\n` +
      '    A negative margin here is a camera that goes through the sign plank on the way ' +
      'out. Only eyes on a rendered frame at /arrive can settle it.\n',
  );
}

process.stderr.write(
  'check:arrival-camera measures where the camera goes and that it lands home. ' +
    'It measures NOTHING about what the shot looks like: whether the arch frames the ' +
    'doorway or lands across a child, whether the seed put a coaster pylon down the ' +
    'middle of the frame, whether the ground plane reads at that tilt. Those are the ' +
    'faults this feature has actually shipped, three times, and only eyes on a rendered ' +
    'frame can find them. A green run here is not a QA pass — the shot must be watched, ' +
    'on more than one seed, at /arrive.\n',
);

console.log(
  failures === 0
    ? `\nPASS: ${checks} checks. The arrival camera goes to the bus, travels in with her, and lands on the rig exactly.`
    : `\n${failures} FAILURE(S) out of ${checks} checks`,
);
process.exit(failures === 0 ? 0 : 1);
