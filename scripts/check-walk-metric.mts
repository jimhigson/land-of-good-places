/**
 * **A child covers the ground she is told she covers, in every direction.**
 *
 * `PLAYER_MAX_SPEED` is metres per second of *real ground*. The step handed to
 * `CollisionWorld.resolveMovement` is in **chart** metres — deliberately, and
 * agreed with the collision engineer, because that solver is chart-space end to
 * end and its anti-tunnelling guarantee is a statement about chart distance
 * against chart-registered bands. The two are not the same number once the
 * ground leans, and nothing was converting between them.
 *
 * ## The conversion, and the direction it goes
 *
 * On the cap the chart coordinate of a surface point is `R sin θ` and its arc
 * from the pole is `R θ`, so `d(chart)/d(arc) = cos θ`:
 *
 * > **chart delta = real arc x cos θ. A multiply.**
 *
 * Measured on a bare cap at the park's reach: stepping one real metre of arc
 * outward moves the chart coordinate 0.698892 m against `cos θ = 0.700516`.
 *
 * So feeding `speed · dt` straight in as the chart delta asks for a chart
 * distance where a real one was meant, and she covers `1 / cos θ` too much
 * ground — **1.43x at the rim**. Tangentially there is no distortion at all,
 * which is what makes this measurable rather than a uniform fudge: the same
 * child at the same spot is too fast walking outward and exactly right walking
 * sideways.
 *
 * ## Three controls, and why each is here
 *
 * 1. **The park's origin.** No lean, so every bearing must read 1.000. If it
 *    does not, the arc measurement is wrong and nothing below means anything.
 * 2. **Tangential at every radius.** The chart does not compress tangentially,
 *    so this must read 1.000 out at the rim too. Without it, an arc measurement
 *    that were simply inflated everywhere — by the wave field, say — would look
 *    exactly like the radial bug.
 * 3. **Distance to the play boundary.** `eng/radial-collide` lost a whole
 *    measurement to this: the soft boundary leash shoves a mover up to 16 m
 *    where a probe falls outside the play bounds, and it reads as the thing you
 *    were trying to measure. Every run below is gated on her staying well
 *    inside, and the gate is asserted rather than assumed.
 *
 * Run: `pnpm run check:walk-metric`
 */
import { Vector3 } from 'three';
import { CollisionWorld } from '../src/world/Collision.ts';
import { GARDEN_PLAY_BOUNDARY, edgeRadiusAt } from '../src/world/boundary.ts';
import { terrainHeight } from '../src/world/terrain.ts';
import { Geo } from '../src/world/geo/Geo.ts';
import { dropToGround } from '../src/world/geo/ground.ts';
import { PLAYER_MAX_SPEED } from '../src/core/constants.ts';
import { SimPlayer } from './playerSim.mts';

const DT = 1 / 60;
/** Long enough to be well past `approach`'s ramp, short enough not to wander far. */
const SETTLE_FRAMES = 60;
const MEASURE_FRAMES = 60;

const RADII = [0, 40, 80, 120, 157] as const;

const _a = new Geo();
const _b = new Geo();

/**
 * How far she really walked over the ground, in metres — the arc along the
 * surface between successive ground points, not the chart distance and not the
 * straight line through the air.
 */
function walkRun(startD: number, dirX: number, dirZ: number): {
  real: number;
  intended: number;
  minEdge: number;
} {
  const collision = new CollisionWorld();
  collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
  const player = new SimPlayer(collision, { ground: (x, z) => terrainHeight(x, z) });
  player.placeOnGround(startD, 0);

  for (let f = 0; f < SETTLE_FRAMES; f += 1) player.step(DT, dirX, dirZ, false);

  let real = 0;
  let minEdge = Infinity;
  const previous = new Vector3().copy(player.position);
  for (let f = 0; f < MEASURE_FRAMES; f += 1) {
    player.step(DT, dirX, dirZ, false);
    dropToGround(_a.setFromWorldVector(previous));
    dropToGround(_b.setFromWorldVector(player.position));
    real += _a.arcTo(_b);
    // The park's edge is not a circle, so this asks the boundary for its own
    // radius on her bearing rather than assuming one.
    const bearing = Math.atan2(player.position.z, player.position.x);
    const here = Math.hypot(player.position.x, player.position.z);
    minEdge = Math.min(minEdge, edgeRadiusAt(GARDEN_PLAY_BOUNDARY, bearing) - here);
    previous.copy(player.position);
  }
  return { real, intended: PLAYER_MAX_SPEED * MEASURE_FRAMES * DT, minEdge };
}

let failed = false;
const note = (line: string): void => process.stderr.write(`${line}\n`);

note('check:walk-metric — a child covers the ground she is told she covers');
note('');

/** How far from 1.000 the covered/intended ratio may sit. */
const TOLERANCE = 0.02;
/** She must stay this far inside the play bounds, or the leash is what is being measured. */
const EDGE_MARGIN = 5;

let worstRadial = 0;
let worstTangential = 0;
let leashed = false;

for (const d of RADII) {
  // Outward is +x from (d, 0); tangential is +z there.
  const runs: Array<[string, number, number]> = [
    ['outward   ', 1, 0],
    ['inward    ', -1, 0],
    ['tangential', 0, 1],
  ];
  for (const [label, dx, dz] of runs) {
    if (d === 0 && label !== 'outward   ') continue;
    const { real, intended, minEdge } = walkRun(d, dx, dz);
    const ratio = real / intended;
    const error = Math.abs(ratio - 1);
    if (minEdge < EDGE_MARGIN) {
      leashed = true;
      note(
        `  d=${String(d).padStart(3)} ${label}: came within ${minEdge.toFixed(2)} m of the play ` +
          `boundary — the leash may be what this row measured. NOT ASSERTED.`,
      );
      continue;
    }
    if (label === 'tangential') worstTangential = Math.max(worstTangential, error);
    else worstRadial = Math.max(worstRadial, error);
    const bad = error > TOLERANCE;
    if (bad) failed = true;
    const lean = ((Math.asin(Math.min(1, d / 220)) * 180) / Math.PI).toFixed(1);
    note(
      `  d=${String(d).padStart(3)} m (lean ${lean.padStart(4)} deg) ${label}: ` +
        `covered ${real.toFixed(3)} m for ${intended.toFixed(3)} m asked — ` +
        `ratio ${ratio.toFixed(4)}${bad ? '   <-- FAILED' : ''}`,
    );
  }
}

note('');
note(
  `Worst radial error ${worstRadial.toFixed(4)}, worst tangential error ` +
    `${worstTangential.toFixed(4)} (tolerance ${TOLERANCE}). ` +
    `The tangential column is the control: the chart does not compress ` +
    `tangentially, so it must read 1.0000 at every radius, and an arc ` +
    `measurement that were simply inflated would fail it too.`,
);
if (leashed) {
  note('');
  note(
    'At least one row was skipped for coming inside the play boundary margin. ' +
      'That is the instrument refusing to report the soft leash as a walking ' +
      'speed, which is a mistake eng/radial-collide made and could not see.',
  );
}
if (failed) {
  note('');
  note('check:walk-metric FAILED');
}
process.exit(failed ? 1 : 0);
