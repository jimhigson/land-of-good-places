import './headless-canvas.mjs';
import { Raycaster, Vector3, type Mesh, type Object3D } from 'three';
import { createRipikaStatue } from '../src/art/models/ripikaStatue.ts';
import {
  CAMERA_DISTANCE,
  CAMERA_PITCH_DEGREES,
  CAMERA_YAW_DEGREES,
  PLAYER_RADIUS,
} from '../src/core/constants.ts';
import { cameraOffset } from '../src/core/cameraRig.ts';

/**
 * **Can the fountain statue still hide the child?**
 *
 * The RiPika statue (#121) is 8.24 m tall and stands dead centre in the plaza.
 * At that size it hides a standing child over roughly 29 m² of walkable ground
 * — which is design feedback #16 ("no more rotating round a tree that's in the
 * way") arriving by a new route. `world/FoliageFade.ts` fades it out of the way;
 * this proves the fade actually covers every spot where it is needed.
 *
 * Two independent tests per sample point, deliberately *not* sharing code with
 * the thing under test:
 *
 *  - **HIDDEN** — a real raycast from the player's head, chest and waist along
 *    the camera's view axis into the statue's actual meshes. The camera is
 *    orthographic, so that axis is a constant and this is exact.
 *  - **FADED** — a replica of `FoliageFade`'s capsule sightline test, written
 *    from its constants.
 *
 * The number that matters is **HIDDEN AND NOT FADED**, and it must be zero.
 * Anything above zero is ground where a six-year-old walks behind the statue
 * and disappears, which is the whole bug.
 *
 * "Faded but not hidden" is reported but never fails: fading a little early is
 * exactly what `SIGHTLINE_MARGIN` already does for every tree in the park, and
 * much of that area is the statue *partially* overlapping the child, which the
 * strict raycast does not count but which the fade still helps.
 *
 * `SWEEP_R=<metres>` overrides the occluder radius, which is how
 * `OCCLUDER_RADIUS` was chosen — see its doc in `models/ripikaStatue.ts`.
 */

/**
 * Where the statue stands, and why it is not read from `PARK_LAYOUT`.
 *
 * This test is translation-invariant: it samples ground *relative to the
 * statue*, so the only thing the world position would change is the terrain
 * slope under the samples, which across the plaza is a few centimetres over
 * tens of metres. Building the whole park to learn that would cost seconds per
 * build for no change in the answer. The statue sits on the fountain's bowl
 * water, which is level by construction whatever the seed does with the
 * fountain, so a flat sample plane is the honest model here.
 *
 * 2.17 is the statue's height **above the ground it stands over**, which is
 * what matters when the sample plane is y = 0. An earlier draft used 2.445 —
 * the world Y including the plaza's 0.275 m of terrain — which floated the
 * statue 27.5 cm too high above its own samples. It did not change the verdict,
 * but a check should model the world it claims to be measuring.
 */
const STATUE_BASE_Y = 2.17;

/**
 * The direction from anywhere in the world towards the camera.
 *
 * **Derived from the rig, not transcribed from it.** A hardcoded vector was
 * right to five decimal places on the day it was written and would have gone
 * quietly stale the first time anyone touched `CAMERA_PITCH_DEGREES` — and a
 * check measuring the wrong camera is worse than no check, because it reports
 * success. Orthographic, so the direction is the same everywhere and this is a
 * constant rather than a per-sample computation.
 */
const eye = cameraOffset(
  (CAMERA_YAW_DEGREES * Math.PI) / 180,
  (CAMERA_PITCH_DEGREES * Math.PI) / 180,
  CAMERA_DISTANCE,
);
const TO_CAMERA = new Vector3(eye.x, eye.y, eye.z).normalize();

/** The player kid, ART_DIRECTION §4. */
const PLAYER_HEIGHT = 2.12;

// Mirrored from `world/FoliageFade.ts`.
const SIGHTLINE_MARGIN = PLAYER_RADIUS + 0.35;
const MAX_LINE_T = 0.985;
const NEAR_PLAYER_RADIUS = 9;
const CAPSULE_SAMPLES = 9;

/** Fountain rim — you cannot stand inside it, so those samples are not ground. */
const RIM_RADIUS = 4.2;

const STEP = 0.25;
const SPAN = 16;

const statue = createRipikaStatue();
statue.root.position.set(0, STATUE_BASE_Y, 0);
statue.root.updateMatrixWorld(true);

const meshes: Object3D[] = [];
statue.root.traverse((node) => {
  if ((node as Partial<Mesh>).isMesh) meshes.push(node);
});

const radius = Number(process.env['SWEEP_R'] ?? statue.occluderRadius);
const occluder = {
  x: 0,
  z: 0,
  centreY: STATUE_BASE_Y + statue.halfHeight,
  halfHeight: statue.halfHeight,
  radius,
};

function pointOnSightline(
  cam: Vector3,
  player: Vector3,
  x: number,
  y: number,
  z: number,
  r: number,
): boolean {
  const abx = player.x - cam.x;
  const aby = player.y - cam.y;
  const abz = player.z - cam.z;
  const lengthSquared = abx * abx + aby * aby + abz * abz;
  if (lengthSquared < 1e-6) return false;
  const t = ((x - cam.x) * abx + (y - cam.y) * aby + (z - cam.z) * abz) / lengthSquared;
  if (t <= 0 || t >= MAX_LINE_T) return false;
  const dx = x - (cam.x + abx * t);
  const dy = y - (cam.y + aby * t);
  const dz = z - (cam.z + abz * t);
  const limit = r + SIGHTLINE_MARGIN;
  return dx * dx + dy * dy + dz * dz < limit * limit;
}

function wouldFade(feet: Vector3): boolean {
  const dx = occluder.x - feet.x;
  const dz = occluder.z - feet.z;
  const reach = NEAR_PLAYER_RADIUS + occluder.radius + 2 * occluder.halfHeight;
  if (dx * dx + dz * dz >= reach * reach) return false;
  const cam = feet.clone().addScaledVector(TO_CAMERA, CAMERA_DISTANCE);
  for (let i = 0; i < CAPSULE_SAMPLES; i += 1) {
    const f = (i / (CAPSULE_SAMPLES - 1)) * 2 - 1;
    const y = occluder.centreY + f * occluder.halfHeight;
    if (pointOnSightline(cam, feet, occluder.x, y, occluder.z, occluder.radius)) return true;
  }
  return false;
}

const ray = new Raycaster();
ray.far = 200;

function isHidden(feet: Vector3): boolean {
  for (const fraction of [1, 0.75, 0.5]) {
    ray.set(new Vector3(feet.x, feet.y + PLAYER_HEIGHT * fraction, feet.z), TO_CAMERA);
    if (ray.intersectObjects(meshes, false).length > 0) return true;
  }
  return false;
}

let samples = 0;
let hidden = 0;
let hiddenNotFaded = 0;
let fadedNotHidden = 0;
let worstDistance = 0;
const offenders: string[] = [];

for (let x = -SPAN; x <= SPAN; x += STEP) {
  for (let z = -SPAN; z <= SPAN; z += STEP) {
    const distance = Math.hypot(x, z);
    if (distance < RIM_RADIUS) continue;
    samples += 1;
    const feet = new Vector3(x, 0, z);
    const h = isHidden(feet);
    const f = wouldFade(feet);
    if (h) {
      hidden += 1;
      worstDistance = Math.max(worstDistance, distance);
    }
    if (h && !f) {
      hiddenNotFaded += 1;
      if (offenders.length < 6) offenders.push(`(${x.toFixed(2)}, ${z.toFixed(2)}) ${distance.toFixed(2)} m out`);
    }
    if (f && !h) fadedNotHidden += 1;
  }
}

const cell = STEP * STEP;
const area = (cells: number): string => `${(cells * cell).toFixed(1)} m²`;

if (hiddenNotFaded > 0) {
  console.error(
    `statue occlusion: ${area(hiddenNotFaded)} of standable ground where the child is ` +
      `hidden behind the statue and it does NOT fade.\n`,
  );
  for (const spot of offenders) console.error(`  ${spot}`);
  console.error(
    `\nThe statue is registered with FoliageFade as a ${occluder.radius} m-radius capsule ` +
      `(models/ripikaStatue.ts, OCCLUDER_RADIUS).\nWiden it until this reaches zero — and re-read ` +
      `its doc first, the number there was measured with SWEEP_R.`,
  );
  process.exit(1);
}

console.log(
  `statue occlusion: hides ${area(hidden)} out to ${worstDistance.toFixed(1)} m, ` +
    `all of it fades (${area(fadedNotHidden)} fades a little early, which is fine).`,
);
