import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { CollisionWorld } from '../src/world/Collision.ts';
import { CASTLE_FLOORS, CASTLE_HALL, floorX, floorZ } from '../src/world/building/floors.ts';
import { INTERIOR_HALF_X, INTERIOR_HALF_Z, PLAYER_RADIUS } from '../src/core/constants.ts';

/**
 * MEASUREMENT, not reasoning.
 *
 * The old prohibition ("castle props get no colliders, indoor collision is
 * height-blind") is one sentence hiding two separate facts:
 *
 *   A. the collision world is 2-D — a collider blocks at every height;
 *   B. two floors share an (x, z), so A reaches across storeys.
 *
 * The prohibition only follows if BOTH hold. Measure each on its own.
 */

const HALL_X = floorX(CASTLE_HALL, 0);
const HALL_Z = floorZ(CASTLE_HALL, 0);

/** Walk a mover straight at (tx, tz) from 3 m away and report how close it got. */
function walkInto(
  collision: CollisionWorld,
  tx: number,
  tz: number,
  y: number,
  clearance: number,
): number {
  const p = new Vector3(tx - 3, y, tz);
  for (let i = 0; i < 60; i += 1) {
    collision.resolveMovement(p, 0.1, 0, PLAYER_RADIUS, clearance, 1 / 60);
  }
  // Signed: negative means it never got past the collider's centre.
  return p.x - tx;
}

// ===========================================================================
// A. Is a collider still height-blind?
// ===========================================================================
console.log('A. one circular collider, radius 1.0, at the great hall\'s centre.');
console.log('   Walk a player into it from 3 m away, at a range of heights.\n');

for (const [label, top, absolute] of [
  ['topHeight = Infinity (the default every castle prop would get)', Infinity, false],
  ['topIsAbsolute, top = 0.675 m (a feast table, hotel/place.ts style)', 0.675, true],
] as const) {
  const world = new CollisionWorld();
  world.addCircle(HALL_X, HALL_Z, 1.0, top, false, absolute);
  console.log(`   ${label}`);
  for (const y of [0, 0.5, 1.0, 1.3, 4, 8, 20, 100]) {
    // clearance = height above the sampler's ground; on a flat floor it is y.
    const past = walkInto(world, HALL_X, HALL_Z, y, y);
    console.log(
      `     y = ${String(y).padStart(5)}  ended ${past >= 0 ? '+' : ''}${past.toFixed(2)} m ` +
        `past its centre  ${past < 1.0 ? 'BLOCKED' : 'walked through'}`,
    );
  }
  console.log('');
}

// ===========================================================================
// B. Can any other floor's plan reach that collider at all?
// ===========================================================================
const world = new CollisionWorld();
world.addCircle(HALL_X, HALL_Z, 1.0);

console.log('B. that same hall collider, swept against every floor\'s whole plate');
const STEP = 0.25;
for (const floor of CASTLE_FLOORS) {
  let blocked = 0;
  let total = 0;
  let nearest = Infinity;
  for (let lx = -floor.halfX; lx <= floor.halfX + 1e-9; lx += STEP) {
    for (let lz = -floor.halfZ; lz <= floor.halfZ + 1e-9; lz += STEP) {
      const wx = floorX(floor, lx);
      const wz = floorZ(floor, lz);
      total += 1;
      nearest = Math.min(nearest, Math.hypot(wx - HALL_X, wz - HALL_Z));
      if (!world.isClearCircle(wx, wz, PLAYER_RADIUS)) blocked += 1;
    }
  }
  console.log(
    `   ${floor.space.padEnd(13)} origin x=${floor.originX}  ` +
      `${String(blocked).padStart(5)}/${total} plate points blocked  ` +
      `nearest approach ${nearest.toFixed(1)} m`,
  );
}

let parkBlocked = 0;
for (let x = -80; x <= 80; x += 0.5) {
  for (let z = -80; z <= 80; z += 0.5) {
    if (!world.isClearCircle(x, z, PLAYER_RADIUS)) parkBlocked += 1;
  }
}
console.log(`   garden/park   160x160 m sweep: ${parkBlocked} points blocked`);

const gap = 300 - 2 * INTERIOR_HALF_X;
console.log(
  `\n   plate half-extents ${INTERIOR_HALF_X} x ${INTERIOR_HALF_Z} m, floors 300 m apart:` +
    ` nearest edge-to-edge gap ${gap.toFixed(1)} m.`,
);
