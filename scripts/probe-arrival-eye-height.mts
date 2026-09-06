/**
 * **Does the arrival camera's eye go into the floor, and by how much?**
 *
 * Jim, 6 September 2026: *"the camera should be at eye-height, not overlapping
 * into the floor"*. That is two claims — too low, and actually inside the
 * ground — and they are different measurements, so this takes both.
 *
 * For each instant of the shot it places the eye exactly as `IsoCamera` does
 * (`focus + cameraOffset(yaw, pitch, distance)`) and compares its height with
 * `terrainHeight` **under the eye**, not under the focus. Those differ: the eye
 * stands several metres from what it looks at, and on a sphere the ground under
 * one is not the ground under the other.
 *
 * **The control comes first.** A probe that reports "never below ground" is
 * indistinguishable from one measuring the wrong point, so it also prints the
 * ground under the eye and the eye's own height every sample: a run where the
 * clearance never varies is a run that is not tracking the shot.
 *
 * Run: LGP_SEED=<n> node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/probe-arrival-eye-height.mts
 */
import {
  arrivalShot,
  ARRIVAL_DOOR_FOCUS_LIFT,
  type ArchPass,
} from '../src/world/entrance/ArrivalSequence.ts';
import { CAMERA_FOCUS_LIFT } from '../src/core/IsoCamera.ts';
import { cameraOffset } from '../src/core/cameraRig.ts';
import { terrainHeight } from '../src/world/terrain.ts';
import { DEG } from '../src/core/mathUtils.ts';
import { ENTRANCE_GATE_X, ENTRANCE_GATE_Z } from '../src/world/entrance/layout.ts';

const seed = process.env.LGP_SEED ?? '(default)';

// A representative pass; the shot's own solver needs a built park, and the two
// instants only move the arch beats, not the door beat this is about.
const PASS: ArchPass = { sheThrough: 8.4, eyeThrough: 9.3 };

let worstBelow = 0;
let worstAt = 0;
let clearances: number[] = [];
const rows: string[] = [];

for (let t = 0; t <= 12; t += 0.25) {
  const shot = arrivalShot(t, PASS);
  if (!shot) continue;
  // The focus the door beat orbits is the drop, lifted; approximate its ground
  // by the gate's, which is what the shot is composed around.
  const focusX = ENTRANCE_GATE_X;
  const focusZ = ENTRANCE_GATE_Z;
  const lift = shot.watchesTheDoor ? ARRIVAL_DOOR_FOCUS_LIFT : CAMERA_FOCUS_LIFT;
  const focusY = terrainHeight(focusX, focusZ) + lift;
  const eye = cameraOffset(shot.yawDegrees * DEG, shot.pitchDegrees * DEG, shot.distance);
  const ex = focusX + eye.x;
  const ez = focusZ + eye.z;
  const ey = focusY + eye.y;
  const ground = terrainHeight(ex, ez);
  const clearance = ey - ground;
  clearances.push(clearance);
  if (clearance < worstBelow) {
    worstBelow = clearance;
    worstAt = t;
  }
  if (t % 1 < 0.26) {
    rows.push(
      `  t=${t.toFixed(2)}  eye y ${ey.toFixed(2)}  ground ${ground.toFixed(2)}  ` +
        `clearance ${clearance.toFixed(2)} m  (pitch ${shot.pitchDegrees.toFixed(1)}, ` +
        `dist ${shot.distance.toFixed(1)})`,
    );
  }
}

const spread = Math.max(...clearances) - Math.min(...clearances);
process.stderr.write(`seed ${seed}: ${clearances.length} samples of the arrival shot\n`);
for (const row of rows) process.stderr.write(row + '\n');
process.stderr.write(
  `  worst clearance ${worstBelow.toFixed(2)} m at t=${worstAt.toFixed(2)}` +
    (worstBelow < 0 ? '  <-- EYE IS INSIDE THE GROUND\n' : '  (never below ground)\n'),
);
if (spread < 0.01) {
  process.stderr.write(
    '  VOID: clearance never varied across the shot, so this is not tracking the\n' +
      '        camera and "never below ground" describes nothing.\n',
  );
  process.exit(2);
}
