/**
 * **Does the sky sit still in the world while the camera turns?**
 *
 * ```
 * npm run check:sky-view
 * ```
 *
 * `world/Sky.ts` draws the sky as a full-screen quad, because the park's camera
 * is orthographic and a dome would render as one flat colour (its header
 * explains why at length). That works right up until something *else* draws the
 * world — a ride's first-person `RideCamera`, `/view`'s debug camera, a
 * first-person walking mode later — and turns.
 *
 * ## What went wrong the first time, and what this now checks
 *
 * The first version slid the flat star grid sideways by the camera's bearing.
 * Two bugs came out of that one idea:
 *
 * 1. `atan2` wraps at ±pi, so turning past due south flicked the whole field
 *    thirteen screen widths in a single frame. Caught here, fixed by
 *    accumulating the pan.
 * 2. **The stars still scrolled about 30% too fast**, which Jim found by
 *    riding it. A lens projects `tan(angle)`, not the angle, and no amount of
 *    care with a *rate* fixes a mapping that is the wrong shape. The old
 *    version of this file did not catch it because it asserted the rate the
 *    code intended rather than the rate the world demands — a test written
 *    from the implementation, which is worth remembering.
 *
 * So the stars are no longer slid at all: the shader is handed the camera's own
 * axes and its field of view, every pixel reconstructs its own view ray, and a
 * star is a fixed direction in the world that the projection moves for free.
 *
 * Both assertions below compare against **three.js's own camera projection**,
 * not against anything in `Sky.ts`. That is the point: an independent reference
 * is the only kind that could have caught bug 2.
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

function horizonY(): number {
  return (sky.uniforms.uHorizonY as { value: number }).value;
}

/** A world direction from a compass bearing and an altitude — `Sky`'s convention. */
function direction(azimuth: number, altitude: number): Vector3 {
  const cos = Math.cos(altitude);
  return new Vector3(Math.sin(azimuth) * cos, Math.sin(altitude), Math.cos(azimuth) * cos);
}

/** Points a fresh camera at a bearing and altitude and hands it to the sky. */
function aim(yaw: number, pitch: number, fov = 62): PerspectiveCamera {
  const camera = new PerspectiveCamera(fov, ASPECT, 0.1, 2000);
  camera.position.set(0, 0, 0);
  const at = direction(yaw, pitch);
  camera.lookAt(at.x, at.y, at.z);
  camera.updateMatrixWorld(true);
  sky.setView(skyViewFor(camera, new Vector3(0, 0, 1)));
  return camera;
}

function aimPark(groundYaw: number): void {
  sky.setView(
    skyViewFor(null, new Vector3(Math.sin(groundYaw), 0, Math.cos(groundYaw))),
  );
}

// --- 1. ordinary play is untouched -----------------------------------------
//
// The previous mapping, written out again from the pre-change source. Not
// imported: the whole point is that it is an independent copy of what shipped.
const LEGACY_HALF_FOV_X = Math.PI / 3;

console.log('the park camera: the orthographic mapping is unchanged');
for (let groundYaw = -Math.PI; groundYaw <= Math.PI; groundYaw += 0.37) {
  aimPark(groundYaw);
  check(!sky.viewIsPerspective, 'the park rig must not report a perspective view');
  near(horizonY(), 0.5, 0, 'park rig horizon');
  for (let azimuth = -Math.PI; azimuth <= Math.PI; azimuth += 0.41) {
    for (let altitude = -1.4; altitude <= 1.4; altitude += 0.35) {
      sky.directionToScreen(azimuth, altitude, scratch);
      near(
        scratch.x,
        angleDelta(groundYaw, azimuth) / LEGACY_HALF_FOV_X,
        1e-12,
        `ortho disc x at yaw ${groundYaw.toFixed(2)}`,
      );
      near(
        scratch.y,
        -0.4 + (altitude / (Math.PI / 2)) * 1.55,
        1e-12,
        `ortho disc y at alt ${altitude.toFixed(2)}`,
      );
    }
  }
}

// --- 2. the discs are a real projection, judged by three.js -----------------
//
// `Vector3.project` runs the camera's own view and projection matrices. If
// `directionToScreen` agrees with it, the sun and the moon are where a lens
// would actually put them — including as `RideCamera` widens `fov` with speed.
console.log('a ride camera: the sun and moon land where three.js projects them');
let projected = 0;
for (const fov of [50, 62, 75, 85]) {
  for (let yaw = -3; yaw <= 3; yaw += 0.31) {
    for (let pitch = -1.2; pitch <= 1.2; pitch += 0.3) {
      const camera = aim(yaw, pitch, fov);
      for (let azimuth = -Math.PI; azimuth <= Math.PI; azimuth += 0.53) {
        for (let altitude = -1.3; altitude <= 1.3; altitude += 0.43) {
          const world = direction(azimuth, altitude);
          // Only where a projection means anything: a point behind the camera
          // has no place on the frame, and `Sky` parks those far outside.
          const ahead = world.clone().normalize().dot(
            camera.getWorldDirection(new Vector3()),
          );
          if (ahead <= 0.05) continue;

          const truth = world.clone().multiplyScalar(100).project(camera);
          sky.directionToScreen(azimuth, altitude, scratch);
          near(scratch.x / ASPECT, truth.x, 1e-6, `sun x at fov ${fov}`);
          near(scratch.y, truth.y, 1e-6, `sun y at fov ${fov}`);
          projected += 1;
        }
      }
    }
  }
}
check(projected > 2000, `expected a broad sweep, only projected ${projected} directions`);
console.log(`  agreed on ${projected} directions, across four fields of view`);

// --- 3. the star field's rays are the camera's rays -------------------------
//
// The shader rebuilds a view ray per pixel as
// `normalize(forward + right*ndc.x*tanX + up*ndc.y*tanY)` and hashes the
// *direction*. Same formula here, checked against three.js unprojecting the
// same screen point — so "a star holds its place in the world" is measured
// rather than asserted, and the 30%-too-fast bug is unrepresentable.
console.log('a ride camera: every pixel reconstructs the ray three.js would');
let rays = 0;
for (const fov of [50, 62, 85]) {
  for (let yaw = -3; yaw <= 3; yaw += 0.47) {
    for (let pitch = -1.2; pitch <= 1.2; pitch += 0.37) {
      const camera = aim(yaw, pitch, fov);
      const view = skyViewFor(camera, new Vector3(0, 0, 1));
      const tanY = view.tanHalfFovY;
      const tanX = tanY * ASPECT;
      const right = view.right.clone();
      const up = view.up.clone();
      const forward = view.forward.clone();

      for (let nx = -1; nx <= 1; nx += 0.25) {
        for (let ny = -1; ny <= 1; ny += 0.25) {
          const shaderRay = forward
            .clone()
            .addScaledVector(right, nx * tanX)
            .addScaledVector(up, ny * tanY)
            .normalize();
          const truth = new Vector3(nx, ny, 0.5)
            .unproject(camera)
            .sub(camera.position)
            .normalize();
          near(shaderRay.dot(truth), 1, 1e-9, `ray at ndc ${nx.toFixed(2)},${ny.toFixed(2)}`);
          rays += 1;
        }
      }
    }
  }
}
check(rays > 2000, `expected a broad sweep, only checked ${rays} rays`);
console.log(`  agreed on ${rays} view rays`);

// --- 4. discs and stars cannot come apart -----------------------------------
//
// Project a direction to the screen the way a disc is placed, then rebuild the
// ray at that exact screen point the way a star is found. Getting the original
// direction back is what makes "the sun sits among the stars" true by
// construction rather than by two mappings happening to agree.
console.log('a ride camera: a disc and the stars around it share one geometry');
{
  const camera = aim(0.4, 0.2);
  const view = skyViewFor(camera, new Vector3(0, 0, 1));
  const tanY = view.tanHalfFovY;
  const tanX = tanY * ASPECT;
  const right = view.right.clone();
  const up = view.up.clone();
  const forward = view.forward.clone();
  let round = 0;
  for (let azimuth = -0.6; azimuth <= 1.4; azimuth += 0.1) {
    for (let altitude = -0.3; altitude <= 0.7; altitude += 0.1) {
      sky.directionToScreen(azimuth, altitude, scratch);
      const back = forward
        .clone()
        .addScaledVector(right, (scratch.x / ASPECT) * tanX)
        .addScaledVector(up, scratch.y * tanY)
        .normalize();
      near(back.dot(direction(azimuth, altitude)), 1, 1e-9, 'disc/star round trip');
      round += 1;
    }
  }
  check(round > 100, 'round trip sweep too small');
}

// --- 5. the horizon follows the pitch ---------------------------------------
console.log('the horizon slides with the pitch, not with the stars alone');
{
  aim(0, 0);
  near(horizonY(), 0.5, 1e-9, 'a level view keeps the horizon mid-screen');
  aim(0, 0.3);
  check(horizonY() < 0.5, 'looking up must move the horizon down the frame');
  aim(0, -0.4);
  check(horizonY() > 0.5, 'looking down must move the horizon up the frame');
  aim(0, 1.5);
  check(horizonY() >= 0.02 && horizonY() <= 0.98, 'the horizon must stay on the frame');
  aimPark(0);
  near(horizonY(), 0.5, 0, 'the park keeps its horizon exactly mid-screen');
}

// ---------------------------------------------------------------------------

console.log(
  failures === 0
    ? `\nPASS: ${checks} checks. The sky holds its place in the world while the camera turns.`
    : `\n${failures} FAILURE(S) out of ${checks} checks`,
);
process.exit(failures === 0 ? 0 : 1);
