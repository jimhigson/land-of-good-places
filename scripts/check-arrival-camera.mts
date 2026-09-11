/**
 * **The arrival camera does the four things Jim asked it to do, and nothing
 * more.**
 *
 * Jim, 11 September 2026, on the shot he approved: *"the camera should FACE the
 * doors of the bus while the player gets off, then travel with the player under
 * the arch"*, and, from the round before, *"it should START facing the bus, not
 * transition down to there."* Those sentences are the clauses below, one each,
 * plus the two properties that are not composition at all — the bearing is home
 * when she takes the controls (GAME_DESIGN.md's CONTROL rule) and the lens is
 * never inside the ground.
 *
 * ## What was struck, and why striking beats deleting the file
 *
 * This file previously tested **a shot we are not shipping**, and every clause
 * of it was green about geometry nobody renders:
 *
 * - *"about 2m from them"* — it asserted the stand-back never moves and is
 *   within half a metre of 2. The shot now opens at
 *   {@link ARRIVAL_DOOR_STAND_BACK} and draws back to the rig's
 *   {@link CAMERA_DISTANCE} on purpose: that pull-back *is* beat two.
 * - *"there is a floor in the picture"* — a march of the frame's top ray down
 *   the far plane. Its whole argument is that **an orthographic projection has
 *   parallel rays**, so pitch is the only thing that makes any of them descend.
 *   The arrival route is a `PerspectiveCamera` (`perspectiveFlag.ts`'s
 *   `onTheArrivalRoute`), whose rays diverge, so the quantity it computed is
 *   not a fact about this picture. Struck rather than adapted: a check that has
 *   to be re-derived for a different projection is a new check.
 * - *"the shot holds exactly one pitch, the rig's"* — the shot now tilts from
 *   {@link ARRIVAL_DOOR_PITCH_DEGREES} up to the rig's across the walk, which
 *   is the hand-over Jim asked for.
 * - *"fixed on the player"* — it asserted `watchesTheDoor` is false on every
 *   frame. **That assertion was the bug.** She is aboard the bus for the whole
 *   door beat, so a camera fixed on her is a camera aimed into the vehicle, and
 *   no stand-back can frame it. The clause is inverted below.
 * - *"she is in the frame, both edges"* — arithmetic about a frame centred on
 *   her head at a single fixed zoom. The door beat is centred on the drop, not
 *   on her, and the zoom moves.
 *
 * ## Proved red, 11 September 2026
 *
 * Every clause was mutated and watched fail, on the geometry this branch builds
 * — the canonical seed, drop at (0.95, 74.95), bus axis through (-2.56, 78.94),
 * bodywork half-width 3.6227 m, ground under the drop -2.14 m. Quote that
 * geometry with the transcript: a mutation stops reaching a clause the moment
 * the park moves under it, and the same command then exits 0 about nothing.
 *
 * ```
 * watchesTheDoor -> false            289 door-beat frames orbit the PLAYER
 * watchesTheDoor -> true             269 frames after she starts walking still orbit the door
 * door yaw + 20 degrees              bearing 20.0000 deg off square-on to the bus's own flank
 * door flank side negated            bearing 180.0000 deg off; eye 1.7580 m from the axis, inside 3.6227 m
 * yaw homed on poseHomeT             eye draws back first (home 9.15s, 25% open 7.33s)
 * zoom lerp reversed                 opens narrow; tightens 0.0276 m at t=7.35s; zoom 0.6666 off the rig
 * pitch home target -6 degrees       tilt 6.0022 deg from the rig at the hand-over
 * shot never returns null            "the shot must let go at ARRIVAL_CONTROL_AT", and "stay let go"
 * ARRIVAL_EYE_HEIGHT -> -3           -2.0317 m of clearance against a 0.3 m floor
 * door pitch -> -32 degrees          -1.3766 m of clearance against a 0.3 m floor
 * ```
 *
 * Two mutations that did **not** reach a clause, recorded because they are the
 * honest measure of how much slack there is: `ARRIVAL_EYE_HEIGHT -> 0.05` left
 * 1.0 m of clearance (the shot stands 3.08 m clear, so small drops are
 * invisible to the floor clause), and `ARRIVAL_DOOR_STAND_BACK -> 1.0` left the
 * eye outside the bodywork, because the drop is already 4.66 m off the axis
 * against a 3.62 m half-width. Neither is a hole — both are clauses that only
 * fire on a fault big enough to matter — but a replacement should not expect
 * either to catch a nudge.
 *
 * ## What this file still cannot see, and says so on every run
 *
 * It reads the **declared** shot — `arrivalShot` is a pure function, so this is
 * a second and not a park build. It cannot see what `IsoCamera` realises from
 * it, and the whole of one five-day fault lived in exactly that gap. It also
 * covers the **door beat's** ground clearance only: once she is walking the
 * shot orbits her, and where she is needs a built park.
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
  ARRIVAL_DOOR_STAND_BACK,
  ARRIVAL_EYE_FLOOR_MARGIN,
  ARRIVAL_EYE_HEIGHT,
  ARRIVAL_FOLLOW_ZOOM,
  AT_WALKING,
  arrivalBusPointWorld,
  arrivalDoorDropWorld,
  arrivalShot,
  type ArchPass,
} from '../src/world/entrance/ArrivalSequence.ts';
import { CAT_BUS_TRACK_WIDTH } from '../src/world/entrance/catBus.ts';
import { terrainHeight } from '../src/world/terrain.ts';

const STEP = 1 / 60;
/** The shot no longer reads the arch pass; a value is still needed to call it. */
const PASS: ArchPass = { sheThrough: ARRIVAL_CONTROL_AT - 2, eyeThrough: ARRIVAL_CONTROL_AT - 2 };
/** How finely the terrain is swept under the eye — finer than anything the game samples. */
const GROUND_GRID_STEP = 0.25;
/**
 * How far round the eye the ground is swept, in metres.
 *
 * A perspective lens is a point, so unlike the orthographic near *face* this
 * has no geometric length to derive from. It is slack against the terrain being
 * sampled at a point rather than solved: a metre is several times the height
 * the ground sphere changes over a metre anywhere in the park.
 */
const GROUND_DISC = 1;

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

const doorFrames = frames.filter((f) => f.t < AT_WALKING);
const walkFrames = frames.filter((f) => f.t >= AT_WALKING);
check(doorFrames.length > 10, `only ${doorFrames.length} door-beat frames — the clauses below assert nothing`);
check(walkFrames.length > 10, `only ${walkFrames.length} walk-beat frames — the clauses below assert nothing`);

// --- "FACE the doors of the bus while the player gets off" ------------------
//
// Three separate things, and the middle one is the bug this whole round was.
{
  const orbitingTheDoor = doorFrames.filter((f) => f.shot.watchesTheDoor).length;
  console.log(`${orbitingTheDoor} of ${doorFrames.length} door-beat frames orbit the drop`);
  check(
    orbitingTheDoor === doorFrames.length,
    `${doorFrames.length - orbitingTheDoor} door-beat frames orbit the PLAYER. She is aboard ` +
      'the bus for the whole of this beat, so that aims the lens into the vehicle at every ' +
      'stand-back — seat backs and pillars between the camera and its subject. It must orbit ' +
      'the drop on the pavement',
  );

  // **Square-on to the flank, and the flank is measured, not asked for.**
  //
  // Asking `arrivalDoorYawDegrees` whether the shot agrees with it is a
  // tautology — proved by mutation on 11 September 2026: adding 20° inside that
  // function moved the shot and the expectation together and this clause stayed
  // green. So the normal is rebuilt here out of three world points off the
  // standing bus: its own origin, a point one metre ahead of it, and the drop.
  // The foot of the drop on that axis gives the flank's outward direction with
  // nothing copied from the game's own expression for it, which is what makes
  // a bearing 20° off the flank — exactly what the old square-on-to-the-gate
  // solve was — fail here.
  const origin = arrivalBusPointWorld(0, 0);
  const ahead = arrivalBusPointWorld(0, 1);
  const drop = arrivalDoorDropWorld();
  const axisX = ahead.x - origin.x;
  const axisZ = ahead.z - origin.z;
  const axisLength = Math.hypot(axisX, axisZ);
  check(axisLength > 0.99 && axisLength < 1.01, `the bus's axis came out ${show(axisLength)} m long for a 1 m step — the mapping is not a rotation, and every number below is built on it`);
  const alongX = axisX / axisLength;
  const alongZ = axisZ / axisLength;
  const toDropX = drop.x - origin.x;
  const toDropZ = drop.z - origin.z;
  const along = toDropX * alongX + toDropZ * alongZ;
  const outX = toDropX - along * alongX;
  const outZ = toDropZ - along * alongZ;
  const outLength = Math.hypot(outX, outZ);
  check(outLength > 0.1, `the drop is ${show(outLength)} m off the bus's axis — with no side to the flank there is no "square-on" to test`);
  const flankX = outX / outLength;
  const flankZ = outZ / outLength;

  let worstOff = 0;
  let worstOffAt = 0;
  let closest = Infinity;
  let closestAt = 0;
  for (const { t, shot } of doorFrames) {
    const eye = cameraOffset(shot.yawDegrees * DEG, shot.pitchDegrees * DEG, shot.distance);
    const run = Math.hypot(eye.x, eye.z);
    // How far round from the flank's own normal the eye stands, in degrees.
    const off = Math.abs(Math.atan2(eye.x * flankZ - eye.z * flankX, eye.x * flankX + eye.z * flankZ) / DEG);
    if (off > worstOff) {
      worstOff = off;
      worstOffAt = t;
    }
    // And how far out from the bus's own axis it ends up — the fact about the
    // bodywork rather than about the angle. `CAT_BUS_TRACK_WIDTH` rather than
    // `CAT_BUS_WIDTH`: the fenders and wheels stand proud of the body, and they
    // are what an eye would be inside.
    const eyeX = drop.x + eye.x;
    const eyeZ = drop.z + eye.z;
    const dx = eyeX - origin.x;
    const dz = eyeZ - origin.z;
    const across = Math.abs(dx * alongZ - dz * alongX);
    void run;
    if (across < closest) {
      closest = across;
      closestAt = t;
    }
  }
  console.log(`the door beat holds within ${show(worstOff)}° of square-on to the measured flank`);
  check(
    worstOff < 1,
    `the door beat's bearing is ${show(worstOff)}° off square-on to the bus's own flank at ` +
      `t=${worstOffAt.toFixed(2)}s — "straight on to the doors" is the whole of what was asked ` +
      'for here, and the flank above is measured off the standing bus, not taken from the ' +
      'shot\'s own expression for it',
  );

  const half = CAT_BUS_TRACK_WIDTH / 2;
  console.log(
    `the eye stands at least ${show(closest)} m off the bus's axis, against ` +
      `${show(half)} m of bodywork half-width`,
  );
  check(
    closest > half,
    `the eye comes within ${show(closest)} m of the bus's axis at t=${closestAt.toFixed(2)}s, ` +
      `inside the ${show(half)} m half-width of its own bodywork — the camera is in the bus`,
  );
}

// --- "then travel with the player under the arch" --------------------------
{
  const stillWatchingTheDoor = walkFrames.filter((f) => f.shot.watchesTheDoor).length;
  console.log(`${stillWatchingTheDoor} of ${walkFrames.length} walk-beat frames still orbit the drop`);
  check(
    stillWatchingTheDoor === 0,
    `${stillWatchingTheDoor} frames after she starts walking still orbit the bus's door — ` +
      '"travel with the player" is the ordinary player-follow, and it cannot start while a ' +
      'focus override is holding the shot on a door she has left',
  );

  // **The bearing comes home before the stand-back opens, and that ordering is
  // a fix rather than a preference.**
  //
  // Homing both on one curve puts the eye a long way out on a bearing that is
  // neither the door's nor the rig's, and the park's furniture is only ever
  // arranged to be seen from the rig's. Measured at t = 7.3 s on the canonical
  // seed with both on one curve: the whole frame was the flank of a shop unit,
  // with the child not in shot at all. Stand-back is an occlusion control
  // before it is anything else, and an unplanned bearing is where that bites.
  const OPENED = 0.25;
  const homeBy = frames.find(
    (f) => Math.abs(angleDelta(f.shot.yawDegrees * DEG, CAMERA_YAW_DEGREES * DEG) / DEG) < 1,
  );
  const openedBy = frames.find(
    (f) =>
      f.shot.distance - ARRIVAL_DOOR_STAND_BACK >
      (CAMERA_DISTANCE - ARRIVAL_DOOR_STAND_BACK) * OPENED,
  );
  console.log(
    `the bearing is home at t=${homeBy ? homeBy.t.toFixed(2) : 'never'}s; the stand-back is ` +
      `${OPENED * 100}% open at t=${openedBy ? openedBy.t.toFixed(2) : 'never'}s`,
  );
  check(
    homeBy !== undefined && openedBy !== undefined && homeBy.t <= openedBy.t,
    `the eye draws back before the bearing is home (home at ` +
      `${homeBy ? homeBy.t.toFixed(2) : 'never'}s, ${OPENED * 100}% open at ` +
      `${openedBy ? openedBy.t.toFixed(2) : 'never'}s) — that puts it far out on a bearing the ` +
      'park was never laid out for, and the park\'s own furniture lands across the shot',
  );
}

// --- it opens at its framing, and never tightens ---------------------------
//
// Jim's first report, and the one that has been half-fixed twice: a shot that
// approaches its framing instead of opening on it. Swept over every frame
// rather than the beat somebody expects, because the two instances were at
// different beats.
//
// **Still the right quantity under perspective**, which is worth stating
// because the projection changed under this file. `IsoCamera.applyFrustum`
// solves `fov = 2·atan(halfHeight / eyeToFocusDistance)`, so the world height
// framed AT the subject is `2·distance·tan(fov/2)` = `2·halfHeight` =
// `CAMERA_VIEW_HEIGHT / zoom` — the stand-back cancels, and the framing is the
// zoom alone exactly as it was under ortho.
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
  check(
    first !== undefined && first.shot.distance === ARRIVAL_DOOR_STAND_BACK,
    'and open at its stand-back too — under perspective the stand-back is half the framing',
  );
  check(
    worstTighten <= 1e-9,
    `the framing tightens by ${show(worstTighten)} m at t=${worstAt.toFixed(2)}s — it is dollying in`,
  );
}

// --- the hand-over lands ON the ordinary camera, not beside it -------------
//
// *"then once through the arch the camera moves up to its usual
// pseudo-isometric perspective."* Every field, not only the bearing: a shot
// that lands a few metres or a few degrees short leaves the park camera
// permanently wrong in a way nobody can point at.
{
  const last = frames[frames.length - 1];
  const offBy = last
    ? Math.abs(angleDelta(last.shot.yawDegrees * DEG, CAMERA_YAW_DEGREES * DEG) / DEG)
    : NaN;
  const pitchOff = last ? Math.abs(last.shot.pitchDegrees - CAMERA_PITCH_DEGREES) : NaN;
  const distOff = last ? Math.abs(last.shot.distance - CAMERA_DISTANCE) : NaN;
  const zoomOff = last ? Math.abs(last.shot.zoom - 1) : NaN;
  console.log(
    `at the hand-over the shot is ${show(offBy)}° of bearing, ${show(pitchOff)}° of tilt, ` +
      `${show(distOff)} m of stand-back and ${show(zoomOff)} of zoom from the rig`,
  );
  // The bearing is the one that is not composition: GAME_DESIGN.md's CONTROL
  // rule reads "up on the stick" through the camera's yaw, so a bearing still
  // moving under her hand sends her somewhere that is not up the screen.
  check(offBy < 1, `the bearing is ${show(offBy)}° from the rig when she takes the controls`);
  check(pitchOff < 0.5, `the tilt is ${show(pitchOff)}° from the rig at the hand-over`);
  check(distOff < 1, `the stand-back is ${show(distOff)} m from the rig at the hand-over`);
  check(zoomOff < 0.01, `the zoom is ${show(zoomOff)} from the rig at the hand-over`);
  check(arrivalShot(ARRIVAL_CONTROL_AT, PASS) === null, 'the shot must let go at ARRIVAL_CONTROL_AT');
  check(arrivalShot(ARRIVAL_CONTROL_AT + 60, PASS) === null, 'and stay let go');
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
  for (const { shot } of doorFrames) {
    const eye = cameraOffset(shot.yawDegrees * DEG, shot.pitchDegrees * DEG, shot.distance);
    const eyeX = drop.x + eye.x;
    const eyeZ = drop.z + eye.z;
    // The door beat orbits `doorFocus`, which the game puts ARRIVAL_EYE_HEIGHT
    // over the highest ground the eye has to clear. Asked here of the terrain
    // directly rather than of that function, so the two are not one number
    // agreeing with itself.
    let focusGround = terrainHeight(drop.x, drop.z);
    for (let f = 0; f <= 1 + 1e-9; f += 1 / 32) {
      focusGround = Math.max(focusGround, terrainHeight(drop.x + eye.x * f, drop.z + eye.z * f));
    }
    const eyeY = focusGround + ARRIVAL_EYE_HEIGHT + eye.y;
    let highest = -Infinity;
    for (let dx = -GROUND_DISC; dx <= GROUND_DISC + 1e-9; dx += GROUND_GRID_STEP) {
      for (let dz = -GROUND_DISC; dz <= GROUND_DISC + 1e-9; dz += GROUND_GRID_STEP) {
        if (dx * dx + dz * dz > GROUND_DISC * GROUND_DISC) continue;
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

// **What this file does NOT cover, announced on every run.**
//
// To stderr, not `console.log`: reporters and CI logs show a passing run's
// stdout to nobody, and an announcement nobody can hear is the same disease as
// a check that cannot fail, one layer out.
process.stderr.write(
  'NOTE check:arrival-camera — every clause reads the DECLARED shot, never what `IsoCamera` ' +
    'realises from it. That gap hid a five-day fault once: `Game` snapped the pose on the ' +
    'engaging frame but only wrote the zoom TARGET, which damps, so the realised frame opened ' +
    'at 14.958 m against a declared 3.59 m and every clause here stayed green. Measuring it ' +
    'needs a browser.\n' +
    'NOTE check:arrival-camera — the ground clause covers the DOOR BEAT only. Once she is ' +
    'walking the shot orbits her, and where she is at a given instant needs a built park, ' +
    'which this script deliberately does not build.\n',
);

console.log('');
if (failures > 0) {
  console.log(`${failures} FAILURE(S) out of ${checks} checks`);
  process.exit(1);
}
console.log(
  `PASS: ${checks} checks. It opens facing the bus doors from outside, travels with her under ` +
    'the arch, and lands on the ordinary park camera.',
);
