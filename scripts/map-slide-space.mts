/** Maps where the chute may be, at several points along its length. */
import {
  BALL_PIT_X,
  BALL_PIT_Z,
  BUILDING_CENTRE_X,
  BUILDING_CENTRE_Z,
  FACADE_SLIDE_DOOR_MAX_X,
  FACADE_SLIDE_DOOR_MIN_X,
  TOP_DECK,
  deckY,
} from '../src/world/building/layout';
import { BUILDING_HALF_X, BUILDING_HALF_Z, GARDEN_PLAY_RADIUS } from '../src/core/constants';
import { PARK_LAYOUT } from '../src/world/parkLayout';
import { COASTER_PLANS } from '../src/world/coaster/plan';
import { terrainHeight } from '../src/world/terrain';
import { Vector3 } from 'three';

const RADIUS = 1.7;
const CRUISER_AIR = 5.5;
const START_Y = deckY(TOP_DECK);
const END_Y = terrainHeight(BALL_PIT_X, BALL_PIT_Z) + 0.9;
const DROP = START_Y - END_Y;
const JOINED = new Set(['building', 'ballPit']);
const LIP = Number(process.env.LGP_SLIDE_LIP ?? 0.18);
const NOMINAL = Number(process.env.LGP_SLIDE_NOMINAL ?? 60);

const LINE: { x: number; y: number; z: number }[] = [];
{
  const p = new Vector3();
  const r = COASTER_PLANS.cruiser.route;
  for (let d = 0; d < r.length; d += 1.5) {
    r.pointAt(d, p);
    LINE.push({ x: p.x, y: p.y, z: p.z });
  }
}

function heightAt(u: number): number {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  if (c <= LIP) return START_Y;
  const a = (c - LIP) / (1 - LIP);
  return START_Y - DROP * (a * a * (3 - 2 * a));
}

function cell(x: number, z: number, s: number): string {
  if (
    Math.abs(x - BUILDING_CENTRE_X) < BUILDING_HALF_X + RADIUS &&
    Math.abs(z - BUILDING_CENTRE_Z) < BUILDING_HALF_Z + RADIUS
  ) {
    return 'B';
  }
  for (const [id, e] of PARK_LAYOUT.entries) {
    if (JOINED.has(id)) continue;
    if (Math.hypot(x - e.x, z - e.z) < e.boundingRadius + RADIUS) return '#';
  }
  if (Math.hypot(x, z) > GARDEN_PLAY_RADIUS - RADIUS) return 'o';
  const y = heightAt(s / NOMINAL);
  const reach = RADIUS + 0.75;
  for (const p of LINE) {
    const dx = p.x - x;
    const dz = p.z - z;
    if (dx * dx + dz * dz > reach * reach) continue;
    if (Math.abs(p.y - y) < CRUISER_AIR) return 'C';
  }
  return '.';
}

const doorX = BUILDING_CENTRE_X + (FACADE_SLIDE_DOOR_MIN_X + FACADE_SLIDE_DOOR_MAX_X) / 2;
const doorZ = BUILDING_CENTRE_Z + BUILDING_HALF_Z + RADIUS + 0.6;
console.log(`door (${doorX.toFixed(2)}, ${doorZ.toFixed(2)})  pit (${BALL_PIT_X.toFixed(2)}, ${BALL_PIT_Z.toFixed(2)})`);
console.log(`LIP=${LIP} NOMINAL=${NOMINAL}  START_Y=${START_Y.toFixed(2)} END_Y=${END_Y.toFixed(2)}`);

for (const s of [5, 15, 25, 35, 45, 55]) {
  console.log(`\n=== ${s} m along, chute at y=${heightAt(s / NOMINAL).toFixed(2)} ===`);
  for (let z = 6; z >= -42; z -= 2) {
    let row = `${String(z).padStart(4)} `;
    for (let x = -36; x <= 26; x += 2) {
      const isDoor = Math.abs(x - doorX) < 1 && Math.abs(z - doorZ) < 1;
      const isPit = Math.abs(x - BALL_PIT_X) < 1 && Math.abs(z - BALL_PIT_Z) < 1;
      row += isDoor ? 'D' : isPit ? 'P' : cell(x, z, s);
    }
    console.log(row);
  }
  console.log(`     x -36 ${'-'.repeat(20)} 26`);
}
