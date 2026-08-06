import './headless-canvas.mjs';
import { Raycaster, Vector3, type Mesh, type Object3D } from 'three';
import { STATUE_TURN_SECONDS, createRipikaStatue } from '../src/art/models/ripikaStatue.ts';
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
 * ## Why this sweeps orientations (5 August 2026)
 *
 * The statue now **turns**, once every `STATUE_TURN_SECONDS`. This check used to
 * measure one fixed pose, and that is no longer a safe thing to do: a rotating
 * statue hides *different ground* through its cycle. The raised paw and the tail
 * are 3 m of asymmetric reach swinging round the axis, so both the size and the
 * shape of the hidden patch breathe as it goes — measured here, the hidden area
 * ranges over roughly 27–29 m² depending where in the turn you look. Checking
 * the pose the statue happens to be built in would prove nothing about the other
 * 359°.
 *
 * So the whole grid is measured at `ORIENTATIONS` poses spanning exactly one
 * revolution, and the verdict is the **worst** one. The FADED side does not need
 * sweeping — `FoliageFade` models the statue as a capsule about the vertical
 * axis, which is by construction the same shape at every angle — so it is
 * computed once per sample point and reused, and only the raycasts repeat.
 *
 * The poses come from driving the asset's own `update()`, not from setting a
 * rotation here. That way the check exercises the code that actually ships: if
 * someone changes which node turns, or how fast, this follows automatically
 * instead of quietly measuring a statue the game no longer contains.
 *
 * Because that coupling could also fail *open* — a broken `update()` would leave
 * this sampling one pose N times and still reporting success — the sweep is
 * preceded by a precondition that proves the statue genuinely turns and returns
 * to its start after one period. A check that reports success on the wrong world
 * is worse than no check.
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

/**
 * How many poses across one revolution.
 *
 * 24 — every 15°. The hidden patch changes shape smoothly as the statue turns
 * (it is a solid silhouette rotating, not something that snaps), so this is
 * about sampling a smooth envelope finely enough to catch its peak, not about
 * catching a discontinuity.
 *
 * Chosen by measurement, not taste. The thing 24 has to get right is the
 * pass/fail threshold, and that comes out at `OCCLUDER_RADIUS` 2.10 m at 24, 48,
 * 96 and 180 poses alike — identical down to 2° steps, so finer sampling finds
 * no worse angle. The reported worst-case hidden area barely moves either:
 * 29.0 m² at 24 poses, 29.1 at 48, 29.3 at 180.
 *
 * It costs a full grid of raycasts per pose, and this runs in `npm run build`,
 * so it is not free: 24 poses is ~2.5 s, 180 is ~20 s. That is the other half of
 * why 24.
 *
 * `SWEEP_POSES=<n>` overrides it, which is how 24 was chosen.
 */
const ORIENTATIONS = Number(process.env['SWEEP_POSES'] ?? 24);

const statue = createRipikaStatue();
statue.root.position.set(0, STATUE_BASE_Y, 0);

/** Put the statue in the pose it holds `seconds` into its turn. */
function poseAt(seconds: number): void {
  statue.update(0, seconds);
  statue.root.updateMatrixWorld(true);
}

poseAt(0);

const meshes: Object3D[] = [];
statue.root.traverse((node) => {
  if ((node as Partial<Mesh>).isMesh) meshes.push(node);
});

// --- precondition: the statue really does turn -------------------------------
// Everything below assumes `poseAt` moves the geometry. If it silently stopped
// doing so, the sweep would measure one pose 24 times over and pass. Probe with
// whichever mesh sits furthest off the axis — the raised paw, in practice.
const probe = (() => {
  let best: Object3D | null = null;
  let bestRadius = 0;
  const at = new Vector3();
  for (const mesh of meshes) {
    at.setFromMatrixPosition(mesh.matrixWorld);
    const radius = Math.hypot(at.x, at.z);
    if (radius > bestRadius) {
      bestRadius = radius;
      best = mesh;
    }
  }
  return { mesh: best, radius: bestRadius };
})();

if (!probe.mesh || probe.radius < 0.5) {
  console.error(
    `statue occlusion: no mesh sits more than 0.5 m off the statue's axis ` +
      `(furthest is ${probe.radius.toFixed(2)} m), so this check cannot tell whether ` +
      `the statue is turning.\nThat is either a broken statue or a reshaped one — ` +
      `re-read this file's header before touching the number.`,
  );
  process.exit(1);
}

const startAt = new Vector3().setFromMatrixPosition(probe.mesh.matrixWorld);
poseAt(STATUE_TURN_SECONDS / 2);
const halfTurnAt = new Vector3().setFromMatrixPosition(probe.mesh.matrixWorld);
poseAt(STATUE_TURN_SECONDS);
const fullTurnAt = new Vector3().setFromMatrixPosition(probe.mesh.matrixWorld);

const swing = startAt.distanceTo(halfTurnAt);
const drift = startAt.distanceTo(fullTurnAt);

if (swing < probe.radius) {
  console.error(
    `statue occlusion: the statue does not appear to turn. Half a period of ` +
      `${STATUE_TURN_SECONDS}s moved '${probe.mesh.name || probe.mesh.type}' by ` +
      `${swing.toFixed(3)} m; sitting ${probe.radius.toFixed(2)} m off the axis it should ` +
      `have crossed to the far side.\nEither RipikaStatueHandle.update() no longer rotates ` +
      `anything, or this check is driving the wrong thing — fix one of those rather than ` +
      `relaxing this, because a pass here would otherwise mean nothing.`,
  );
  process.exit(1);
}

if (drift > 0.05) {
  console.error(
    `statue occlusion: one full period of ${STATUE_TURN_SECONDS}s did not bring the statue ` +
      `back to where it started — '${probe.mesh.name || probe.mesh.type}' is ` +
      `${drift.toFixed(3)} m out.\nThe sweep below assumes STATUE_TURN_SECONDS is a true ` +
      `period, so it would no longer be covering a whole revolution.`,
  );
  process.exit(1);
}

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

// The sample grid, with the FADED verdict resolved once. The fade capsule is a
// body of revolution about the statue's axis, so it is identical at every pose —
// only the raycasts have to be repeated per orientation.
interface Sample {
  readonly feet: Vector3;
  readonly distance: number;
  readonly fades: boolean;
}

const samples: Sample[] = [];
for (let x = -SPAN; x <= SPAN; x += STEP) {
  for (let z = -SPAN; z <= SPAN; z += STEP) {
    const distance = Math.hypot(x, z);
    if (distance < RIM_RADIUS) continue;
    const feet = new Vector3(x, 0, z);
    samples.push({ feet, distance, fades: wouldFade(feet) });
  }
}

interface Pose {
  readonly seconds: number;
  readonly degrees: number;
  readonly hidden: number;
  readonly hiddenNotFaded: number;
  readonly fadedNotHidden: number;
  readonly worstDistance: number;
  readonly offenders: readonly string[];
}

const startedAt = Date.now();
const poses: Pose[] = [];

for (let i = 0; i < ORIENTATIONS; i += 1) {
  const seconds = (i / ORIENTATIONS) * STATUE_TURN_SECONDS;
  poseAt(seconds);

  let hidden = 0;
  let hiddenNotFaded = 0;
  let fadedNotHidden = 0;
  let worstDistance = 0;
  const offenders: string[] = [];

  for (const sample of samples) {
    const h = isHidden(sample.feet);
    if (h) {
      hidden += 1;
      worstDistance = Math.max(worstDistance, sample.distance);
    }
    if (h && !sample.fades) {
      hiddenNotFaded += 1;
      if (offenders.length < 6) {
        offenders.push(
          `(${sample.feet.x.toFixed(2)}, ${sample.feet.z.toFixed(2)}) ` +
            `${sample.distance.toFixed(2)} m out`,
        );
      }
    }
    if (sample.fades && !h) fadedNotHidden += 1;
  }

  poses.push({
    seconds,
    degrees: (i / ORIENTATIONS) * 360,
    hidden,
    hiddenNotFaded,
    fadedNotHidden,
    worstDistance,
    offenders,
  });
}

const cell = STEP * STEP;
const area = (cells: number): string => `${(cells * cell).toFixed(1)} m²`;

// The verdict is the worst pose, not the average and not the one it was built
// in: the child only has to disappear at one angle for it to be the bug.
const worst = poses.reduce((a, b) =>
  b.hiddenNotFaded > a.hiddenNotFaded || (b.hiddenNotFaded === a.hiddenNotFaded && b.hidden > a.hidden)
    ? b
    : a,
);
const leastHidden = poses.reduce((a, b) => (b.hidden < a.hidden ? b : a));
const reach = Math.max(...poses.map((p) => p.worstDistance));

if (worst.hiddenNotFaded > 0) {
  console.error(
    `statue occlusion: ${area(worst.hiddenNotFaded)} of standable ground where the child is ` +
      `hidden behind the statue and it does NOT fade.\nWorst at ${worst.degrees.toFixed(0)}° ` +
      `through the turn (${worst.seconds.toFixed(2)}s of a ${STATUE_TURN_SECONDS}s revolution), ` +
      `of ${ORIENTATIONS} poses checked; ` +
      `${poses.filter((p) => p.hiddenNotFaded > 0).length} pose(s) fail.\n`,
  );
  for (const spot of worst.offenders) console.error(`  ${spot}`);
  console.error(
    `\nThe statue is registered with FoliageFade as a ${occluder.radius} m-radius capsule ` +
      `(models/ripikaStatue.ts, OCCLUDER_RADIUS).\nWiden it until this reaches zero — and re-read ` +
      `its doc first, the number there was measured with SWEEP_R.`,
  );
  process.exit(1);
}

console.log(
  `statue occlusion: ${ORIENTATIONS} poses across one ${STATUE_TURN_SECONDS}s revolution. ` +
    `Hides ${area(leastHidden.hidden)}–${area(worst.hidden)} out to ${reach.toFixed(1)} m ` +
    `(worst at ${worst.degrees.toFixed(0)}°), all of it fades at every pose ` +
    `(${area(worst.fadedNotHidden)} fades a little early there, which is fine). ` +
    `${((Date.now() - startedAt) / 1000).toFixed(1)}s.`,
);
