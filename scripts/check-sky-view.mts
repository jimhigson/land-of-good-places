/**
 * **Does the sky stay put when the camera turns?**
 *
 * ```
 * npm run check:sky-view
 * ```
 *
 * `world/Sky.ts` draws the sky as a full-screen quad, because the park's camera
 * is orthographic and a dome would render as one flat colour (its header
 * explains why at length). That works right up until something *else* draws the
 * world — a ride's first-person `RideCamera`, `/view`'s debug camera, a
 * first-person walking mode later — and turns. A screen-space sky turns with
 * the screen, so stars, sun and moon all stay nailed where they are: the
 * wallpaper bug the parallax was written to kill, back again in the one place a
 * child is deliberately looking around.
 *
 * `Sky.setView` fixes it, and the fix is pure arithmetic with no GL in it, so it
 * is checked here rather than by looking at a screenshot of a sunset and
 * believing it.
 *
 * ## The invariant that matters most
 *
 * The star field is panned by a uniform (`uSkyRotation`); the sun and moon are
 * *placed* by `directionToScreen`. Those are two different pieces of code, and
 * if they ever disagree about scale the sun slides through the stars — which
 * looks far worse, and far more like a broken game, than the pinning it
 * replaced. `RideCamera` widening its own `fov` with speed is exactly the sort
 * of thing that would cause it.
 *
 * So the property is stated once and swept hard: **subtract the star pan from
 * the disc's screen position and you get a number that does not depend on where
 * the camera is looking at all.** That is the sun's fixed address among the
 * stars. If the two mappings ever drift apart, this moves, and this fails.
 *
 * ## The other half: ordinary play must not change
 *
 * `IsoCamera` cannot turn (`CAMERA_YAW_DEGREES`, solved once in its
 * constructor), so none of this should be visible in the park itself. That is
 * asserted directly, against the previous formula written out again from the
 * old source rather than called — otherwise it would only prove the code agrees
 * with itself.
 */

import { PerspectiveCamera, Vector2, Vector3 } from 'three';
import { Sky, skyViewFor } from '../src/world/Sky.ts';
import { angleDelta } from '../src/core/mathUtils.ts';

let failures = 0;
let checks = 0;

function fail(message: string): void {
  console.error(`FAIL: ${message}`);
  failures += 1;
}

function check(condition: boolean, message: string): void {
  checks += 1;
  if (!condition) fail(message);
}

function near(actual: number, expected: number, tolerance: number, message: string): void {
  checks += 1;
  if (!(Math.abs(actual - expected) <= tolerance)) {
    fail(`${message}: expected ${expected.toFixed(6)}, got ${actual.toFixed(6)}`);
  }
}

const ASPECT = 16 / 9;
const sky = new Sky();
sky.setAspect(ASPECT);

const scratch = new Vector2();

/** The star pan the shader is being handed this frame. */
function rotation(): Vector2 {
  return (sky.uniforms.uSkyRotation as { value: Vector2 }).value;
}

function horizonY(): number {
  return (sky.uniforms.uHorizonY as { value: number }).value;
}

/**
 * Points a fresh perspective camera at a bearing and altitude and hands it to
 * the sky, exactly as `Game` hands over `cameraOverride` each frame.
 *
 * The direction is built explicitly and fed to `lookAt` rather than set as an
 * Euler: a three.js camera looks down its own **−z**, so `rotation.y = θ` aims
 * it at bearing `θ + π`. The first version of this helper did that, and every
 * "the sun has drifted" failure it produced was the test facing the opposite
 * way, not the code being wrong. Same convention as `skyViewFor` reads back —
 * `atan2(x, z)` — so `view.yaw` comes back as the bearing asked for.
 */
function aim(yaw: number, pitch: number, fov = 62): ReturnType<typeof skyViewFor> {
  const camera = new PerspectiveCamera(fov, ASPECT, 0.1, 1000);
  camera.position.set(0, 0, 0);
  camera.lookAt(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  );
  camera.updateMatrixWorld(true);
  const view = skyViewFor(camera, new Vector3(0, 0, 1));
  sky.setView(view);
  return view;
}

/** The park's own rig: no override, ground-plane forward at the iso yaw. */
function aimPark(groundYaw: number): ReturnType<typeof skyViewFor> {
  const forward = new Vector3(Math.sin(groundYaw), 0, Math.cos(groundYaw));
  const view = skyViewFor(null, forward);
  sky.setView(view);
  return view;
}

// --- 1. ordinary play is untouched -----------------------------------------
//
// The previous mapping, written out again from the pre-change source. Not
// imported, not refactored into shared code: the whole point is that it is an
// independent copy of what shipped.
const LEGACY_HALF_FOV_X = Math.PI / 3;
function legacyDisc(cameraYaw: number, azimuth: number, altitude: number): [number, number] {
  return [
    angleDelta(cameraYaw, azimuth) / LEGACY_HALF_FOV_X,
    -0.4 + (altitude / (Math.PI / 2)) * 1.55,
  ];
}

console.log('the park camera: the orthographic mapping is unchanged');
for (let groundYaw = -Math.PI; groundYaw <= Math.PI; groundYaw += 0.37) {
  const view = aimPark(groundYaw);
  check(!view.perspective, 'the park rig must not report a perspective view');
  near(rotation().x, 0, 0, 'park rig star pan x');
  near(rotation().y, 0, 0, 'park rig star pan y');
  near(horizonY(), 0.5, 0, 'park rig horizon');

  for (let azimuth = -Math.PI; azimuth <= Math.PI; azimuth += 0.41) {
    for (let altitude = -1.4; altitude <= 1.4; altitude += 0.35) {
      sky.directionToScreen(azimuth, altitude, scratch);
      const [x, y] = legacyDisc(groundYaw, azimuth, altitude);
      near(scratch.x, x, 1e-12, `ortho disc x at yaw ${groundYaw.toFixed(2)}`);
      near(scratch.y, y, 1e-12, `ortho disc y at alt ${altitude.toFixed(2)}`);
    }
  }
}

// --- 2. stars and discs cannot come apart ----------------------------------
//
// Sweeping yaw and pitch under one fixed sun: its address among the stars is
// `screen position - star pan`, and that must not move.
//
// The sweep is **continuous and in small steps**, because that is how a camera
// actually moves and because the pan is accumulated frame to frame (see
// `Sky.panYaw`). It also stays within a couple of radians of the sun's own
// bearing: swing far enough that the sun passes behind you and `angleDelta`
// flips it round the other side, which shifts the address by a whole turn.
// That seam sits directly behind the camera where nothing is drawn, and
// removing it would mean putting a discontinuity somewhere that *is* on screen.
console.log('a ride camera: the sun keeps its address among the stars');
const SUN_AZIMUTH = 0.8;
const SUN_ALTITUDE = 0.5;
let addressX = Number.NaN;
let addressY = Number.NaN;
let sampled = 0;
for (let pitch = -0.9; pitch <= 0.9; pitch += 0.15) {
  // Back to the park between rows, then into the ride again — both because the
  // next row starts from a different bearing and would otherwise register as
  // one impossible frame-to-frame swing, and because stepping off a ride and
  // onto another is a path worth exercising: the reset is what makes the
  // second ride start from its own first frame.
  aimPark(0);
  for (let offset = -2; offset <= 2; offset += 0.05) {
    const view = aim(SUN_AZIMUTH + offset, pitch);
    sky.directionToScreen(SUN_AZIMUTH, SUN_ALTITUDE, scratch);
    const x = scratch.x - rotation().x;
    const y = scratch.y - rotation().y;
    if (Number.isNaN(addressX)) {
      addressX = x;
      addressY = y;
    }
    near(x, addressX, 1e-9, `sun address x drifted at yaw ${view.yaw.toFixed(2)}`);
    near(y, addressY, 1e-9, `sun address y drifted at pitch ${view.pitch.toFixed(2)}`);
    sampled += 1;
  }
}
check(sampled > 200, `expected a broad sweep, only sampled ${sampled} views`);
console.log(`  held across ${sampled} camera orientations`);

// A widening field of view is the specific thing that would have detached them,
// since RideCamera moves `fov` with speed. Same invariant, swept over fov.
console.log('a ride camera: a widening field of view keeps them together');
for (let fov = 50; fov <= 85; fov += 2.5) {
  aimPark(0);
  const view = aim(0.2, 0.1, fov);
  sky.directionToScreen(SUN_AZIMUTH, SUN_ALTITUDE, scratch);
  const halfFovY = (fov * Math.PI) / 360;
  const halfFovX = Math.atan(Math.tan(halfFovY) * ASPECT);
  // The address in *angle* is fov-independent even though the address in screen
  // units is not — a wider lens puts the same sky in fewer screen units.
  near(
    (scratch.x - rotation().x) * (halfFovX / ASPECT),
    SUN_AZIMUTH,
    1e-9,
    `sun bearing at fov ${fov}`,
  );
  near((scratch.y - rotation().y) * halfFovY, SUN_ALTITUDE, 1e-9, `sun altitude at fov ${fov}`);
  check(view.halfFovY > 0, 'a perspective view must report a real field of view');
}

// --- 3. the scale is honest ------------------------------------------------
//
// Turning by exactly half the horizontal field of view must move the sky by
// exactly one screen half-width, or "the stars keep up with the world" is a
// claim nobody has checked.
console.log('the angular scale is one half-width per half-field-of-view');
{
  aimPark(0);
  const view = aim(0, 0);
  const halfFovX = Math.atan(Math.tan(view.halfFovY) * ASPECT);
  const before = rotation().x;
  aim(halfFovX, 0);
  near(rotation().x - before, -ASPECT, 1e-9, 'a half-FOV turn should pan one half-width');

  aim(0, 0);
  const beforeY = rotation().y;
  aim(0, view.halfFovY);
  near(rotation().y - beforeY, -1, 1e-9, 'a half-FOV pitch should pan one half-height');
}

// --- 4. the horizon follows the pitch --------------------------------------
//
// Without this the stars would pan while the gradient and the horizon band
// stayed nailed across the middle of the frame: the same wallpaper tell one
// level down, and most obvious in a gondola looking up into space.
console.log('the horizon slides with the pitch, not with the stars alone');
{
  const view = aim(0, 0);
  check(view.perspective, 'sanity: these are perspective views');
  near(horizonY(), 0.5, 1e-9, 'a level view keeps the horizon mid-screen');
  aim(0, view.halfFovY / 2);
  check(horizonY() < 0.5, 'looking up must move the horizon down the frame');
  aim(0, -0.4);
  check(horizonY() > 0.5, 'looking down must move the horizon up the frame');
  // Straight up must not fold the gradient inside out, however hard it is asked.
  aim(0, 1.5);
  check(horizonY() >= 0.02 && horizonY() <= 0.98, 'the horizon must stay on the frame');
}

// --- 5. nothing diverges through a full turn -------------------------------
//
// The mapping is linear in the angle rather than a tangent for exactly this
// reason: `tan` blows up at 90 degrees, and this field has to survive being
// turned all the way round.
console.log('a full turn stays smooth — no tangent blow-up, no seam');
{
  aimPark(0);
  let worstStep = 0;
  let previous = Number.NaN;
  const STEP = 0.01;
  for (let yaw = -Math.PI; yaw <= Math.PI; yaw += STEP) {
    aim(yaw, 0);
    const x = rotation().x;
    check(Number.isFinite(x), `star pan went non-finite at yaw ${yaw.toFixed(2)}`);
    if (!Number.isNaN(previous)) worstStep = Math.max(worstStep, Math.abs(x - previous));
    previous = x;
  }
  const view = aim(0, 0);
  const halfFovX = Math.atan(Math.tan(view.halfFovY) * ASPECT);
  const expected = (STEP * ASPECT) / halfFovX;
  console.log(`  worst single-step pan: ${worstStep.toFixed(6)} (even pace is ${expected.toFixed(6)})`);
  check(
    worstStep < expected * 1.5,
    `a ${STEP} rad turn moved the sky ${worstStep.toFixed(4)} — the pace is not even`,
  );
}

// ---------------------------------------------------------------------------

console.log(
  failures === 0
    ? `\nPASS: ${checks} checks. The sky holds still while the camera turns.`
    : `\n${failures} FAILURE(S) out of ${checks} checks`,
);
process.exit(failures === 0 ? 0 : 1);
