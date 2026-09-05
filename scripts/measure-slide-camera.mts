/**
 * **Where do the ginormous slide's cameras actually sit, and is anything
 * already there?** (issues #514, #516)
 *
 * ```
 * LGP_SEED=346 pnpm exec node --import ./scripts/ts-extension-resolver-register.mjs scripts/measure-slide-camera.mts
 * ```
 *
 * `slide/cameras.ts` places a **trackside** eye by formula — a standoff and an
 * elevation off the beat it covers — and then steps it closer in 0.25 m
 * increments only until the *framing* fits:
 *
 * ```ts
 * while (standoff > FLOOR && worstFrom(eye) > MAX_RIDER_DISTANCE) { standoff -= 0.25; … }
 * ```
 *
 * **Nothing in that loop asks what is at the point.** So an eye can be placed
 * inside solid scenery, which is #516. This measures that directly, off the
 * shots the game actually plans, rather than by riding: a full descent takes
 * minutes per seed and the eyes are decided at plan time, so riding to find out
 * where a fixed camera stands is paying a great deal for an answer that was
 * already written down.
 *
 * Two distances per trackside eye:
 *
 * - **to the ball pit's rim**, exactly. The rim is a `TorusGeometry`, so a
 *   point is inside its tube when its distance to the ring circle is under the
 *   tube radius. Both radii are read off the built geometry — `BallPit.ts` owns
 *   `BALL_PIT_RADIUS + 0.4` and `0.3`, and a copy here would be the
 *   two-definitions defect this repo files most often.
 * - **to the nearest ball-pit surface of any kind**, by raycasting a fan of
 *   directions a short way and taking the nearest hit. The rim is what QA
 *   photographed, but the pit also has an open-ended `DoubleSide` wall and a
 *   floor, and a camera inside either of those is the same defect wearing
 *   different geometry.
 *
 * It reports every trackside eye on every run, not only the bad ones, so a seed
 * with comfortable clearance says so rather than being silent — a run that
 * prints nothing is indistinguishable from a run that measured nothing.
 */
import './headless-canvas.mjs';
import { Matrix4, Raycaster, Vector3, type Mesh, type Object3D } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PARK_SEED } from '../src/world/parkManifest.ts';

const { world } = quietly(() => buildHeadlessPark());
const building = world.building;
const shots = building.slideShots.shots;

// ---------------------------------------------------------------- the pit rim
building.ballPit.group.updateMatrixWorld(true);
let rimInverse: Matrix4 | null = null;
let rimMajor = 0;
let rimTube = 0;
building.ballPit.group.traverse((object: Object3D) => {
  const mesh = object as Mesh & {
    isMesh?: boolean;
    geometry: { type?: string; parameters?: { radius?: number; tube?: number } };
  };
  if (!mesh.isMesh || mesh.geometry?.type !== 'TorusGeometry') return;
  rimMajor = mesh.geometry.parameters?.radius ?? 0;
  rimTube = mesh.geometry.parameters?.tube ?? 0;
  rimInverse = new Matrix4().copy(mesh.matrixWorld).invert();
});

/** Signed distance to the rim's surface: negative means inside the tube. */
function toRim(point: Vector3): number | null {
  if (!rimInverse) return null;
  const local = point.clone().applyMatrix4(rimInverse);
  // three.js `TorusGeometry` lies in local XY with its axis on Z.
  const ring = Math.hypot(local.x, local.y) - rimMajor;
  return Math.hypot(ring, local.z) - rimTube;
}

/**
 * Nearest ball-pit surface in any direction, by a ray fan.
 *
 * Not a bounding box: the pit is a bowl, and a box round it would call the
 * whole hollow middle "inside", which is where a camera is perfectly welcome.
 */
const FAN: readonly Vector3[] = [
  new Vector3(1, 0, 0), new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0), new Vector3(0, -1, 0),
  new Vector3(0, 0, 1), new Vector3(0, 0, -1),
  new Vector3(1, 1, 1).normalize(), new Vector3(-1, 1, 1).normalize(),
  new Vector3(1, 1, -1).normalize(), new Vector3(-1, 1, -1).normalize(),
  new Vector3(1, -1, 1).normalize(), new Vector3(-1, -1, 1).normalize(),
  new Vector3(1, -1, -1).normalize(), new Vector3(-1, -1, -1).normalize(),
];
const REACH = 2.0;
function toPitSurface(point: Vector3): number {
  const caster = new Raycaster();
  let nearest = Infinity;
  for (const dir of FAN) {
    caster.set(point, dir);
    caster.far = REACH;
    const hit = caster.intersectObject(building.ballPit.group, true)[0];
    if (hit && hit.distance < nearest) nearest = hit.distance;
  }
  return nearest;
}

// ------------------------------------------------------------------- the report
const lines: string[] = [];
let worstRim = Infinity;
let insideCount = 0;
let trackside = 0;
for (const [index, shot] of shots.entries()) {
  if (shot.kind !== 'trackside' || !shot.eye) continue;
  trackside += 1;
  const rim = toRim(shot.eye);
  const surface = toPitSurface(shot.eye);
  if (rim !== null && rim < worstRim) worstRim = rim;
  if (rim !== null && rim < 0) insideCount += 1;
  lines.push(
    `  shot ${index} trackside eye (${shot.eye.x.toFixed(2)}, ${shot.eye.y.toFixed(2)}, ` +
      `${shot.eye.z.toFixed(2)}) — rim ${rim === null ? 'n/a' : `${rim.toFixed(2)} m`}` +
      `${rim !== null && rim < 0 ? ' *** INSIDE THE RIM ***' : ''}, ` +
      `nearest pit surface ${surface === Infinity ? `>${REACH} m` : `${surface.toFixed(2)} m`}`,
  );
}

process.stdout.write(
  `measure-slide-camera: seed ${PARK_SEED}, ${shots.length} shots, ${trackside} trackside\n`,
);
for (const line of lines) process.stdout.write(`${line}\n`);
process.stdout.write(
  `  worst rim clearance ${worstRim === Infinity ? 'n/a — no trackside eye' : `${worstRim.toFixed(2)} m`}` +
    `, ${insideCount} eye(s) inside the rim\n`,
);
// **This measures the fixed trackside eyes only.** The chase camera moves with
// the rider and is not decided at plan time, so it cannot be answered here; it
// is measured per frame by `check:pet-slide`'s own sampler. Said out loud
// because a clean run of this script is not a clean bill for every camera on
// the ride.
process.stdout.write(
  '  (trackside eyes only — the chase camera moves and is sampled by check:pet-slide)\n',
);
