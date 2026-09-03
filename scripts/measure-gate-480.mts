/**
 * Where a child can actually stand around the park's front gate (#480).
 *
 * A grid of `PLAYER_RADIUS`-sized probes through the collision world the park
 * really built, printed as a map: `.` standable, `#` blocked. The gate is at
 * `ENTRANCE_GATE_X/Z`, the posts `ENTRANCE_GATE_HALF_WIDTH` either side.
 *
 * Control is built in: a map that came out all `#` or all `.` would be
 * measuring nothing, and the posts have to show up as two blobs in the right
 * places before anything else on it can be believed.
 */
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PLAYER_RADIUS } from '../src/core/constants.ts';
import { ENTRANCE_GATE_X, ENTRANCE_GATE_Z, ENTRANCE_GATE_HALF_WIDTH } from '../src/world/entrance/layout.ts';

const park = quietly(() => buildHeadlessPark());
const collision = park.world.collision;

// The same question `ParkFacts.isStandable` asks, at the player's own radius.
const probe = new Vector3();
function standable(x: number, z: number): boolean {
  probe.set(x, 0, z);
  collision.resolve(probe, PLAYER_RADIUS);
  return Math.hypot(probe.x - x, probe.z - z) < 1e-3;
}

const half = 8;
let standCount = 0;
let blockCount = 0;
const lines: string[] = [];
for (let dz = -half; dz <= half; dz += 0.5) {
  let line = `z ${(ENTRANCE_GATE_Z + dz).toFixed(1).padStart(6)} `;
  for (let dx = -half; dx <= half; dx += 0.5) {
    const ok = standable(ENTRANCE_GATE_X + dx, ENTRANCE_GATE_Z + dz);
    if (ok) standCount += 1;
    else blockCount += 1;
    line += ok ? '.' : '#';
  }
  lines.push(line);
}

console.log(`gate at (${ENTRANCE_GATE_X.toFixed(1)}, ${ENTRANCE_GATE_Z.toFixed(1)}), posts +/- ${ENTRANCE_GATE_HALF_WIDTH} m`);
console.log(`x runs ${(ENTRANCE_GATE_X - half).toFixed(1)} to ${(ENTRANCE_GATE_X + half).toFixed(1)}, 0.5 m a column`);
for (const line of lines) console.log(line);
console.log(`${standCount} standable, ${blockCount} blocked — a map that is all one or the other is measuring nothing`);

// --- what is standing there --------------------------------------------------
// Every wall segment passing within `reach` of the gate centre. A blocked gate
// names its blocker rather than leaving the next agent guessing.
const reach = 6;
const walls = (collision as unknown as Record<string, unknown>).walls;
if (Array.isArray(walls)) {
  console.log(`\nwall segments within ${reach} m of the gate centre, of ${walls.length} in the park:`);
  let near = 0;
  for (const wall of walls as Record<string, number>[]) {
    const ax = wall.ax ?? wall.x1 ?? NaN;
    const az = wall.az ?? wall.z1 ?? NaN;
    const bx = wall.bx ?? wall.x2 ?? NaN;
    const bz = wall.bz ?? wall.z2 ?? NaN;
    if (!Number.isFinite(ax)) continue;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    if (Math.hypot(mx - ENTRANCE_GATE_X, mz - ENTRANCE_GATE_Z) > reach) continue;
    near += 1;
    console.log(
      `  (${ax.toFixed(2)}, ${az.toFixed(2)}) -> (${bx.toFixed(2)}, ${bz.toFixed(2)}) ` +
        `halfThickness ${String(wall.halfThickness ?? wall.half ?? '?')} top ${String(wall.topHeight)}`,
    );
  }
  console.log(`${near} near the gate`);
}
