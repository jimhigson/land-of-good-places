/**
 * **The arrival camera obeys Jim's rule, and nothing more.**
 *
 * Jim, 6 September 2026, after four rounds of choreography he did not want:
 * *"the rule should be simple - camera fixed on the player, about 2m from them,
 * at head height, until they're in the park - that's it."*
 *
 * This file was 46 clauses testing a shot with four beats — a wide roll-in, a
 * door beat orbiting the bus's own drop point, a walk beat, an arch pass with a
 * dive and a hold. **That shot no longer exists, and 46 clauses testing a shot
 * that does not exist are worse than none**: every one of them would have gone
 * on passing about geometry nobody renders. They are deleted with it.
 *
 * What is left is his sentence, one clause per clause of it, plus two things
 * carried over because they were right and cost nothing:
 *
 * - **it opens at its final framing** rather than approaching it — his first
 *   report, twice half-fixed, and the sweep for a tightening frame is what
 *   caught the second one;
 * - **the eye is never inside the ground**, which on a 1200 m sphere is a real
 *   risk even at 2 m, because the ground rises towards the park's middle.
 *
 * Runs without building a park: `arrivalShot` is a pure function and
 * `terrainHeight` is a formula, so this is a second and not a park build.
 */
import { cameraOffset } from '../src/core/cameraRig.ts';
import {
  CAMERA_DISTANCE,
  CAMERA_PITCH_DEGREES,
  CAMERA_VIEW_HEIGHT,
  CAMERA_YAW_DEGREES,
} from '../src/core/constants.ts';
import { angleDelta, DEG } from '../src/core/mathUtils.ts';
import {
  ARRIVAL_CONTROL_AT,
  ARRIVAL_EYE_FLOOR_MARGIN,
  ARRIVAL_FOLLOW_DISTANCE,
  ARRIVAL_FOLLOW_ZOOM,
  arrivalDoorDropWorld,
  arrivalShot,
  type ArchPass,
} from '../src/world/entrance/ArrivalSequence.ts';
import { KID_EYE_HEIGHT, TALLEST_CHILD_HEIGHT } from '../src/art/models/kid.ts';
import { terrainHeight } from '../src/world/terrain.ts';

const STEP = 1 / 60;
/** The shot no longer reads the arch pass; a value is still needed to call it. */
const PASS: ArchPass = { sheThrough: ARRIVAL_CONTROL_AT - 2, eyeThrough: ARRIVAL_CONTROL_AT - 2 };
/** How finely the terrain is swept under the eye — finer than anything the game samples. */
const GROUND_GRID_STEP = 0.25;

let checks = 0;
let failures = 0;
function check(ok: boolean, what: string): void {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.log(`  FAIL: ${what}`);
  }
}
const show = (n: number): string => (Number.isFinite(n) ? n.toFixed(4) : String(n));

/** Every frame of the shot, so no clause below can test only the beat it expects. */
const frames: { t: number; shot: NonNullable<ReturnType<typeof arrivalShot>> }[] = [];
for (let t = 0; t < ARRIVAL_CONTROL_AT; t += STEP) {
  const shot = arrivalShot(t, PASS);
  if (shot) frames.push({ t, shot });
}
check(frames.length > 100, `only ${frames.length} frames of shot — nothing below proves anything`);

// --- "about 2m from them" --------------------------------------------------
{
  const distances = frames.map((f) => f.shot.distance);
  const low = Math.min(...distances);
  const high = Math.max(...distances);
  console.log(`the camera holds ${show(low)}–${show(high)} m from her across ${frames.length} frames`);
  check(
    low === ARRIVAL_FOLLOW_DISTANCE && high === ARRIVAL_FOLLOW_DISTANCE,
    `the stand-back moves (${show(low)}–${show(high)} m) — Jim's rule is one distance, held: ` +
      '"about 2m from them". A stand-back that changes is the dolly again',
  );
  check(
    Math.abs(ARRIVAL_FOLLOW_DISTANCE - 2) < 0.5,
    `ARRIVAL_FOLLOW_DISTANCE is ${ARRIVAL_FOLLOW_DISTANCE} m, which is not "about 2m"`,
  );
}

// --- there is a floor in the picture ---------------------------------------
//
// **The clause this file was missing, and the one Jim reported three times.**
//
// It used to assert the opposite — `worstTilt === 0`, "at head height means
// looking level" — and it was green for every one of those three reports,
// because a level ortho camera is *precisely* what removes the floor.
//
// An orthographic projection has parallel rays, so pitch is the only thing
// that makes any of them descend. At pitch 0 every ray in the frame is
// horizontal: the ground is not a surface in the picture at all, only the one
// line where the terrain crosses eye height, and every ray below that line
// runs underneath single-sided terrain to the far plane and draws nothing.
// Anything standing in that band is drawn sitting on nothing.
//
// So this asks the only question that distinguishes the two: **march the
// frame's topmost ray the whole length of the far plane and see whether it
// has got down to the ground yet.** Finite at every pitch, including 0, where
// it answers "no, and it never will" with a real number.
{
  const far = CAMERA_DISTANCE * 3;
  const drop = arrivalDoorDropWorld();
  const groundY = terrainHeight(drop.x, drop.z);
  let worstHeight = -Infinity;
  let worstAt = 0;
  let worstPitch = 0;
  for (const { t, shot } of frames) {
    const pitch = shot.pitchDegrees * DEG;
    const halfFrame = CAMERA_VIEW_HEIGHT / (2 * shot.zoom);
    // The frame is centred on her head. The top edge sits `halfFrame` up the
    // screen, whose own vertical component is `cos(pitch)`; every ray then
    // descends `sin(pitch)` per metre it travels.
    const startY = groundY + KID_EYE_HEIGHT + halfFrame * Math.cos(pitch);
    const afterFar = startY - far * Math.sin(pitch);
    if (afterFar - groundY > worstHeight) {
      worstHeight = afterFar - groundY;
      worstAt = t;
      worstPitch = shot.pitchDegrees;
    }
  }
  console.log(
    `after ${show(far)} m the frame's top ray is ${show(worstHeight)} m above the ground at ` +
      `its worst (t=${worstAt.toFixed(2)}s, pitch ${show(worstPitch)}°)`,
  );
  check(
    worstHeight <= 0,
    `the top of the frame is still ${show(worstHeight)} m above the ground after the whole ` +
      `${show(far)} m of the far plane, at t=${worstAt.toFixed(2)}s with a pitch of ` +
      `${show(worstPitch)}° — that band of the picture has no floor in it, and whatever ` +
      'stands in it is drawn sitting on nothing',
  );
  // "At head height" is not abandoned, it is moved to where it is visible: an
  // orthographic eye's position changes nothing on screen, so the phrase buys
  // the frame being centred on her head, which the clause below owns.
  const tilts = new Set(frames.map((f) => f.shot.pitchDegrees));
  console.log(`the shot holds ${tilts.size} distinct pitch(es): ${[...tilts].map(show).join(', ')}`);
  check(
    tilts.size === 1 && tilts.has(CAMERA_PITCH_DEGREES),
    `the shot's pitch is ${[...tilts].map(show).join(', ')}° — it must be the rig's own ` +
      `${show(CAMERA_PITCH_DEGREES)}°, held, so that the hand-over into ordinary play is not a ` +
      'tilt she can see and so there is only one owner of the park camera\'s angle',
  );
}

// --- "fixed on the player" -------------------------------------------------
{
  const watching = frames.filter((f) => f.shot.watchesTheDoor).length;
  console.log(`${watching} of ${frames.length} frames orbit something other than the player`);
  check(
    watching === 0,
    `${watching} frames still orbit the bus's door — "fixed on the player" means the ordinary ` +
      'player-follow is the whole of the tracking',
  );
}

// --- she is in the frame, both edges ---------------------------------------
{
  const halfHeight = CAMERA_VIEW_HEIGHT / (2 * ARRIVAL_FOLLOW_ZOOM);
  // The frame is centred on her head; her feet are KID_EYE_HEIGHT below it and
  // the tallest possible hat TALLEST_CHILD_HEIGHT above them.
  const underFeet = halfHeight - KID_EYE_HEIGHT;
  const overHat = halfHeight + KID_EYE_HEIGHT - TALLEST_CHILD_HEIGHT;
  console.log(
    `the frame is ${show(halfHeight * 2)} m tall: ${show(underFeet)} m under her feet, ` +
      `${show(overHat)} m over the tallest hat`,
  );
  check(underFeet > 0, `the frame crops her feet by ${show(-underFeet)} m`);
  check(overHat > 0, `the frame crops the tallest child's hat by ${show(-overHat)} m`);
}

// --- it opens at its framing, and never tightens ---------------------------
//
// Jim's first report, and the one that has been half-fixed twice: a shot that
// approaches its framing instead of opening on it. Swept over every frame
// rather than the beat somebody expects, because the two instances were at
// different beats.
{
  const first = frames[0];
  let worstTighten = 0;
  let worstAt = 0;
  for (let i = 1; i < frames.length; i += 1) {
    const before = CAMERA_VIEW_HEIGHT / (2 * (frames[i - 1] as (typeof frames)[number]).shot.zoom);
    const now = CAMERA_VIEW_HEIGHT / (2 * (frames[i] as (typeof frames)[number]).shot.zoom);
    if (before - now > worstTighten) {
      worstTighten = before - now;
      worstAt = (frames[i] as (typeof frames)[number]).t;
    }
  }
  console.log(
    `it opens on a ${show(first ? CAMERA_VIEW_HEIGHT / first.shot.zoom : NaN)} m frame and ` +
      `tightens by at most ${show(worstTighten)} m in any frame`,
  );
  check(
    first !== undefined && first.shot.zoom === ARRIVAL_FOLLOW_ZOOM,
    'the shot must OPEN at its framing, not travel to it',
  );
  // **What this clause does NOT cover, announced on every run.**
  //
  // It reads the zoom the shot *declares*. It cannot see the zoom the camera
  // *realises*, and for five days the whole fault lived in that gap: `Game`
  // snapped the pose on the engaging frame but only ever wrote the zoom
  // target, which damps at a 0.12 s half-life, so the realised frame opened at
  // **14.958 m** and reached this declared 3.59 m only at t=0.81 — measured in
  // the page on 11 September 2026, at 1466x806 (aspect 1.8189, Jim's own
  // 2000x1100 shape), sampling `(camera.top - camera.bottom) / camera.zoom`
  // every frame from `elapsed 0`. The clause was green throughout. It is fixed
  // by `IsoCamera.snapZoomTarget`, not by anything this file can see.
  //
  // To stderr, not `console.log`: vitest-style reporters and CI logs show a
  // passing run's stdout to nobody, and an announcement nobody can hear is the
  // same disease one layer out.
  process.stderr.write(
    'NOTE check:arrival-camera — the framing clauses read the DECLARED shot. The zoom the ' +
      'camera actually realises is not measured here and needs a browser; last measured ' +
      '11 September 2026 at 1466x806, opening at 14.958 m before `snapZoomTarget` landed.\n',
  );
  check(
    worstTighten <= 1e-9,
    `the framing tightens by ${show(worstTighten)} m at t=${worstAt.toFixed(2)}s — it is dollying in`,
  );
}

// --- the lens is never in the ground, curvature included -------------------
//
// Measured against the real drop, because clearance is a fact about where in
// the park the shot stands, and swept on a grid finer than anything the game
// samples so this cannot become arithmetic about its own inputs.
{
  const drop = arrivalDoorDropWorld();
  let worst = Infinity;
  let worstNote = 'nothing measured';
  for (const { shot } of frames) {
    const eye = cameraOffset(shot.yawDegrees * DEG, shot.pitchDegrees * DEG, shot.distance);
    const eyeX = drop.x + eye.x;
    const eyeZ = drop.z + eye.z;
    // She stands on the terrain; the frame is centred on her head, so the eye
    // rides KID_EYE_HEIGHT over the ground under HER, plus the pitch's rise.
    const eyeY = terrainHeight(drop.x, drop.z) + KID_EYE_HEIGHT + eye.y;
    const reach = CAMERA_VIEW_HEIGHT / (2 * shot.zoom);
    let highest = -Infinity;
    for (let dx = -reach; dx <= reach + 1e-9; dx += GROUND_GRID_STEP) {
      for (let dz = -reach; dz <= reach + 1e-9; dz += GROUND_GRID_STEP) {
        if (dx * dx + dz * dz > reach * reach) continue;
        highest = Math.max(highest, terrainHeight(eyeX + dx, eyeZ + dz));
      }
    }
    const clearance = eyeY - highest;
    if (clearance < worst) {
      worst = clearance;
      worstNote = `eye (${eyeX.toFixed(1)}, ${eyeZ.toFixed(1)}) at ${eyeY.toFixed(2)} m, highest ground ${highest.toFixed(2)} m`;
    }
  }
  console.log(`the lens clears the ground by at least ${show(worst)} m (${worstNote})`);
  check(
    worst >= ARRIVAL_EYE_FLOOR_MARGIN,
    `the arrival camera goes into the ground: ${show(worst)} m of clearance against a floor of ` +
      `${ARRIVAL_EYE_FLOOR_MARGIN} m — ${worstNote}`,
  );
}

// --- the bearing is home when she gets the controls ------------------------
//
// Not composition: GAME_DESIGN.md's CONTROL rule reads "up on the stick"
// through the camera's yaw.
{
  const last = frames[frames.length - 1];
  const offBy = last ? Math.abs(angleDelta(last.shot.yawDegrees * DEG, CAMERA_YAW_DEGREES * DEG) / DEG) : NaN;
  console.log(`at the hand-over the bearing is ${show(offBy)}° off the rig's own`);
  check(offBy < 1, `the bearing is ${show(offBy)}° from the rig when she takes the controls`);
  check(arrivalShot(ARRIVAL_CONTROL_AT, PASS) === null, 'the shot must let go at ARRIVAL_CONTROL_AT');
  check(arrivalShot(ARRIVAL_CONTROL_AT + 60, PASS) === null, 'and stay let go');
}

console.log('');
if (failures > 0) {
  console.log(`${failures} FAILURE(S) out of ${checks} checks`);
  process.exit(1);
}
console.log(`PASS: ${checks} checks. The camera is on her, 2 m back, at head height, until she is in the park.`);
