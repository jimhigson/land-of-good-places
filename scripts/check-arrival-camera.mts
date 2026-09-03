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
 * **And one mutation that stays green, recorded because it is the honest edge
 * of what this can do.** Turning `ARRIVAL_DOOR_THREE_QUARTER_DEGREES` from 60
 * down to 3 — which puts the gate arch squarely across the doorway, the
 * composition fault this shot was rebuilt to fix — still passes every clause
 * here, at a bearing swing of 132°. Nothing in this file can see composition or
 * occlusion. See the note it prints to stderr on every run.
 *
 * Run: `pnpm run check:arrival-camera`
 */
import { Vector3 } from 'three';
import { IsoCamera } from '../src/core/IsoCamera.ts';
import { cameraOffset } from '../src/core/cameraRig.ts';
import {
  CAMERA_DISTANCE,
  CAMERA_PITCH_DEGREES,
  CAMERA_YAW_DEGREES,
} from '../src/core/constants.ts';
import { angleDelta, DEG } from '../src/core/mathUtils.ts';
import {
  ARRIVAL_CONTROL_AT,
  ARRIVAL_RISE_TAIL,
  AT_SHOT_HOME,
  arrivalShot,
  type ArchPass,
} from '../src/world/entrance/ArrivalSequence.ts';
import { GATE_ARCH_CLEAR_HEIGHT, GATE_ARCH_CLEAR_WIDTH } from '../src/art/models/gateArch.ts';
import { TALLEST_CHILD_HEIGHT } from '../src/art/models/kid.ts';

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
const PASSES: readonly ArchPass[] = [0.2, 0.3, 0.44, 0.6, 0.8].map((fraction) => {
  const walkStart = ARRIVAL_CONTROL_AT - 4.5;
  const under = walkStart + fraction * 4.5;
  return { under, clear: Math.min(under + 1.0, ARRIVAL_CONTROL_AT) };
});
/** The one nearest the game's own geometry, for the single-value clauses. */
const PASS: ArchPass = PASSES[2]!;

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

const STEP = 1 / 60;

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
  const CHEST = 1.1;
  let worstHeadroom = Infinity;
  let worstSideroom = Infinity;
  let worstAt = 0;
  for (const pass of PASSES) {
    // Only while the eye is actually in the gateway. Outside that window the
    // camera is nowhere near the arch and its clearance means nothing — the
    // first version of this clause swept past it and reported a "headroom" of
    // -9.62 m measured on a camera 45 m away and climbing.
    for (let t = pass.under; t <= pass.clear; t += STEP) {
      const shot = arrivalShot(t, pass);
      if (!shot) continue;
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
  // And it must genuinely be close: a "pass through the arch" that happens at
  // the rig's 90 m stand-back is a camera watching from the far side of the
  // park, which is the note this whole round came from.
  let closest = Infinity;
  for (const pass of PASSES) {
    const shot = arrivalShot(pass.under, pass);
    if (shot) closest = Math.min(closest, shot.distance);
  }
  console.log(`  closest stand-back at the pass: ${show(closest)} m`);
  check(
    closest < 8,
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
  // Frame half-height at that zoom, on the default 16:10 framing.
  const halfHeight = Math.max(15 / 2, 11 / 2 / 1.6) / tightest;
  const sheFills = TALLEST_CHILD_HEIGHT / (halfHeight * 2);
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
// What this check cannot see — said out loud on every run, per CLAUDE.md
// ---------------------------------------------------------------------------
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
