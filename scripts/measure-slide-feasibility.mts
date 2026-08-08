/**
 * **Is a rideable chute geometrically possible on this seed at all?**
 *
 * `measure-slide-route.mts` reports what the slide solved to, which is no use
 * on the seeds that matter: when `planSlide` throws, importing it throws too.
 * This measures the *geometry the search is handed* — the castle door face and
 * the ball pit rim — and needs no solve, so it works on a seed that fails.
 *
 * It answers the one question that decides what to fix. A chute can never be
 * shorter than the straight line from its door to its mouth, so if that line is
 * already near `MAX_RIDEABLE_LENGTH` the ceiling is infeasible on this seed and
 * the fault is in the LAYOUT (the pit is too far from the castle); if the line
 * is comfortably short, the ceiling is fine and the fault is in the SEARCH
 * (it is detouring).
 *
 * `LGP_SEED=n npm run measure:slide-feasibility`.
 */
import { PARK_SEED } from '../src/world/parkManifest';
import {
  BALL_PIT_RADIUS,
  BALL_PIT_X,
  BALL_PIT_Z,
  BUILDING_CENTRE_X,
  BUILDING_CENTRE_Z,
} from '../src/world/building/layout';
import { BUILDING_HALF_Z } from '../src/core/constants';

/** Kept in step with `slide/plan.ts` by name; see its constants. */
const MAX_RIDEABLE_LENGTH = 75;
const DESIRED_LENGTH = 60;
const DOOR_OFFER_CENTRE = 9.5;
const DOOR_HALF_GAP = 2.05; // CORRIDOR_RADIUS 1.45 + DOOR_SHOULDER 0.6
const WALL_STANDOFF = 2.05; // CORRIDOR_RADIUS + 0.6

const f = (n: number): string => n.toFixed(2);

console.log(`seed ${PARK_SEED}`);
console.log(`castle centre  (${f(BUILDING_CENTRE_X)}, ${f(BUILDING_CENTRE_Z)})`);
console.log(`ball pit       (${f(BALL_PIT_X)}, ${f(BALL_PIT_Z)})  radius ${BALL_PIT_RADIUS}`);

const southWallZ = BUILDING_CENTRE_Z + BUILDING_HALF_Z;
const doorZ = southWallZ + WALL_STANDOFF;

// Every door the offers can use, and every mouth on the pit rim: the shortest
// straight line between any pair is a hard floor on the route's length.
let shortest = Infinity;
let shortestAt = '';
for (const acrossFraction of [0, -0.5, 0.5, -0.85, 0.85]) {
  const doorX = BUILDING_CENTRE_X + DOOR_OFFER_CENTRE + DOOR_HALF_GAP * acrossFraction;
  for (let i = 0; i < 64; i += 1) {
    const bearing = (i / 64) * Math.PI * 2;
    for (const radius of [BALL_PIT_RADIUS - 1, BALL_PIT_RADIUS - 2.5, BALL_PIT_RADIUS - 4]) {
      const mouthX = BALL_PIT_X + Math.cos(bearing) * radius;
      const mouthZ = BALL_PIT_Z + Math.sin(bearing) * radius;
      const gap = Math.hypot(mouthX - doorX, mouthZ - doorZ);
      if (gap < shortest) {
        shortest = gap;
        shortestAt = `door (${f(doorX)}, ${f(doorZ)}) -> mouth (${f(mouthX)}, ${f(mouthZ)})`;
      }
    }
  }
}

console.log(`\nshortest possible chute (straight line, ignoring every obstacle):`);
console.log(`  ${f(shortest)} m — ${shortestAt}`);
console.log(`\nceiling ${MAX_RIDEABLE_LENGTH} m, target ${DESIRED_LENGTH} m`);
console.log(`  headroom over the straight line: ${f(MAX_RIDEABLE_LENGTH - shortest)} m ` +
  `(${f((MAX_RIDEABLE_LENGTH / shortest - 1) * 100)}% of detour allowed)`);

// A chute leaving the south face has to get round the tower before it can head
// anywhere behind the castle, so the honest comparison is with a route that
// goes door -> clear of the castle corner -> pit.
const cornerX = BUILDING_CENTRE_X + DOOR_OFFER_CENTRE + 6;
const viaCorner =
  Math.hypot(cornerX - (BUILDING_CENTRE_X + DOOR_OFFER_CENTRE), doorZ - doorZ) +
  Math.hypot(BALL_PIT_X - cornerX, BALL_PIT_Z - doorZ);
console.log(`  rough door -> corner -> pit: ${f(viaCorner)} m`);

if (shortest > MAX_RIDEABLE_LENGTH) {
  console.log(`\nVERDICT: INFEASIBLE. No chute can be short enough — this is a LAYOUT fault.`);
} else if (shortest > MAX_RIDEABLE_LENGTH * 0.75) {
  console.log(`\nVERDICT: TIGHT. Only ${f((MAX_RIDEABLE_LENGTH / shortest - 1) * 100)}% detour allowed; ` +
    `the search needs near-straight routes and the layout is the real constraint.`);
} else {
  console.log(`\nVERDICT: ROOMY. A ${f(shortest)} m straight line under a ${MAX_RIDEABLE_LENGTH} m ` +
    `ceiling is plenty — if the solve fails, the SEARCH is detouring, not the layout.`);
}
