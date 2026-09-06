/**
 * Measurement instrument for issue #549: can a child walk through the castle's
 * corner towers?
 *
 * Marches a player-sized body at each tower's axis from outside, on many
 * bearings and at two strides, against the **real** `CollisionWorld` of a real
 * built park, and reports how close to the axis it got. Solid means it stops at
 * `radiusBottom + PLAYER_RADIUS`; walking through shows as a closest approach
 * near zero.
 *
 * **Two controls run first, because a flood fill that measures the wrong thing
 * gives a clean, decisive, entirely wrong answer** (CLAUDE.md):
 *
 * - a **positive** control marched at the castle's own facade wall, which is
 *   known solid — if this reports penetration the instrument is not consulting
 *   collision at all, and every tower result is meaningless;
 * - a **negative** control marched across open lawn, which is known clear — if
 *   this reports a stop the instrument is blocked by something it has not named
 *   (the play bounds, a stale probe) and a "solid" verdict would be an artefact.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import {
  PLAYER_RADIUS,
  PLAYER_LONGEST_STEP,
  MAX_FRAME_DELTA,
} from '../src/core/constants.ts';
import { CASTLE_TOWERS } from '../src/world/building/layout.ts';

const park = buildHeadlessPark();
const collision = park.world.collision;
// The park's own leash would stop a march before any geometry did; this probe
// is about the stone, not the boundary.
collision.setPlayBounds({ radius: 1e6, distanceToEdge: () => 1e6 });

/** Marches at (tx, tz) from `from` metres out, returning the closest approach. */
const marchAt = (tx: number, tz: number, bearing: number, step: number, from: number): number => {
  const probe = new Vector3(tx + Math.sin(bearing) * from, 0, tz + Math.cos(bearing) * from);
  let closest = Infinity;
  const travel = from + 4;
  for (let travelled = 0; travelled < travel; travelled += step) {
    collision.resolveMovement(
      probe,
      -Math.sin(bearing) * step,
      -Math.cos(bearing) * step,
      PLAYER_RADIUS,
      0,
      MAX_FRAME_DELTA,
    );
    closest = Math.min(closest, Math.hypot(probe.x - tx, probe.z - tz));
  }
  return closest;
};

const BEARINGS = 48;
const STEPS = [0.05, PLAYER_LONGEST_STEP] as const;

const sweep = (tx: number, tz: number, from: number): { worst: number; best: number } => {
  let worst = Infinity; // closest any bearing got — the penetration
  let best = -Infinity; // furthest any bearing was held off
  for (let i = 0; i < BEARINGS; i += 1) {
    const bearing = (i / BEARINGS) * Math.PI * 2;
    for (const step of STEPS) {
      const closest = marchAt(tx, tz, bearing, step, from);
      worst = Math.min(worst, closest);
      best = Math.max(best, closest);
    }
  }
  return { worst, best };
};

console.log(`seed ${process.env['LGP_SEED'] ?? 'canonical'}`);

// ---------------------------------------------------------------- controls
const bodies = CASTLE_TOWERS.filter((t) => t.name.startsWith('tower-body-'));
const first = bodies[0];
if (!first) throw new Error('no tower bodies in CASTLE_TOWERS — nothing to measure');

// Positive: the middle of the castle facade, known solid.
const cx = bodies.reduce((a, t) => a + t.x, 0) / bodies.length;
const cz = bodies.reduce((a, t) => a + t.z, 0) / bodies.length;
const positive = sweep(cx, cz, 24);
console.log(
  `  CONTROL positive (castle centre, known solid): closest approach ${positive.worst.toFixed(2)} m ` +
    `— must be well above 0, or the instrument is not consulting collision`,
);

// Negative: open lawn, 150 m out on a clear bearing, known walkable.
const negative = sweep(cx + 150, cz + 150, 20);
console.log(
  `  CONTROL negative (open lawn 150 m out): closest approach ${negative.worst.toFixed(2)} m ` +
    `— must be ~0, or the instrument reports "solid" for empty ground`,
);

// ------------------------------------------------------------------ towers
let anyThrough = false;
for (const tower of bodies) {
  const expected = tower.radiusBottom + PLAYER_RADIUS;
  const { worst } = sweep(tower.x, tower.z, 14);
  const through = worst < tower.radiusBottom;
  if (through) anyThrough = true;
  console.log(
    `  ${tower.name} at (${tower.x.toFixed(2)}, ${tower.z.toFixed(2)}) r=${tower.radiusBottom.toFixed(3)}: ` +
      `closest approach ${worst.toFixed(2)} m, expected >= ${expected.toFixed(2)} m ` +
      `${through ? '<-- WALKS THROUGH THE STONE' : 'ok'}`,
  );
}
console.log(anyThrough ? '\nAt least one tower is not solid.' : '\nEvery tower is solid.');
