/** SCRATCH #583 — is the lounge physically reachable by a PLAYER_RADIUS body? */
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { NavGrid, MAX_ROUTE_WAYPOINTS } from '../src/world/NavGrid.ts';
import { circleBoundary } from '../src/world/boundary.ts';
import { HOTEL_PLAY_RADIUS, PLAYER_RADIUS } from '../src/core/constants.ts';
import { JUMP_APEX_HEIGHT } from '../src/entities/Player.ts';
import { SUITE, SUITE_DOOR_WIDTH } from '../src/world/hotel/layout.ts';

const park = buildHeadlessPark();
const collision = park.world.collision;
collision.setPlayBounds(circleBoundary(HOTEL_PLAY_RADIUS, SUITE.originX, SUITE.originZ));
const navGrid = new NavGrid(collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT,
  () => park.world.building.surfaces.connectors);
const sampler = park.sample;
const OX = SUITE.originX, OZ = SUITE.originZ;
const out = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);

// --- the two constraints, both read off the built collision world ---
const anyC = collision as unknown as {
  walls: { x1: number; z1: number; x2: number; z2: number; halfThickness: number; topHeight: number }[];
};
// The lounge partition's west jamb: the run ending nearest the door from the west.
const hallRuns = anyC.walls.filter((w) => Math.abs(w.z1 - (OZ + 1.7)) < 0.01 && Math.abs(w.z2 - (OZ + 1.7)) < 0.01);
const westRun = hallRuns.find((w) => Math.max(w.x1, w.x2) - OX < 5);
const eastRun = hallRuns.find((w) => Math.min(w.x1, w.x2) - OX > 5);
const jambWest = (Math.max(westRun!.x1, westRun!.x2) - OX) + westRun!.halfThickness;
const jambEast = (Math.min(eastRun!.x1, eastRun!.x2) - OX) - eastRun!.halfThickness;
console.log(`lounge doorway opening: local x ${jambWest.toFixed(2)} .. ${jambEast.toFixed(2)} (${(jambEast - jambWest).toFixed(2)} m, SUITE_DOOR_WIDTH=${SUITE_DOOR_WIDTH})`);
console.log(`  a body of radius ${PLAYER_RADIUS} must have its centre in x ${(jambWest + PLAYER_RADIUS).toFixed(2)} .. ${(jambEast - PLAYER_RADIUS).toFixed(2)} to pass the jambs`);

// The sofa: the low run just south of the doorway that spans it.
const sofaRuns = anyC.walls.filter((w) =>
  Math.abs(w.z1 - w.z2) < 0.01 && w.z1 - OZ > 2 && w.z1 - OZ < 4 && w.topHeight < 1);
for (const s of sofaRuns) {
  const minX = Math.min(s.x1, s.x2) - OX - s.halfThickness;
  const maxX = Math.max(s.x1, s.x2) - OX + s.halfThickness;
  console.log(`  sofa north face at local z=${(s.z1 - OZ).toFixed(2)}, spans x ${minX.toFixed(2)} .. ${maxX.toFixed(2)}, top=${s.topHeight}`);
  console.log(`  to walk round its west end a body's centre must be at x <= ${(minX - PLAYER_RADIUS).toFixed(2)}`);
  const need = jambWest + PLAYER_RADIUS;
  const have = minX - PLAYER_RADIUS;
  console.log(`  => needs x >= ${need.toFixed(2)} (doorway) AND x <= ${have.toFixed(2)} (past the sofa): ` +
    (need <= have ? `POSSIBLE, ${(have - need).toFixed(2)} m of channel` : `IMPOSSIBLE — short by ${(need - have).toFixed(2)} m`));
}

// --- what does she actually do when she taps in there? ---
function walkFrom(sx: number, sz: number, tx: number, tz: number, what: string): void {
  const startY = sampler(OX + sx, OZ + sz, 3);
  const ty = sampler(OX + tx, OZ + tz, 3);
  const n = navGrid.findRoute(OX + sx, OZ + sz, startY, OX + tx, OZ + tz, ty, sampler, out);
  const ex = n > 0 ? out[(n - 1) * 2]! - OX : sx;
  const ez = n > 0 ? out[(n - 1) * 2 + 1]! - OZ : sz;
  const moved = Math.hypot(ex - sx, ez - sz);
  console.log(`  ${what}: from (${sx}, ${sz}) tap (${tx}, ${tz}) -> reached=${navGrid.lastRouteReachedGoal} ` +
    `ends (${ex.toFixed(2)}, ${ez.toFixed(2)}), she moves ${moved.toFixed(2)} m` +
    (moved < 0.55 ? '   <<< under ARRIVE_RADIUS: SHE DOES NOTHING' : ''));
}
console.log('\nWhat a tap in the near (camera-side) half actually does:');
walkFrom(4.4, 0, 5.6, 4.8, 'stood in the hall by the lounge door, tap the sofa   ');
walkFrom(4.4, 1.2, 5.6, 4.8, 'stood in the lounge doorway, tap the sofa           ');
walkFrom(4.4, 2.0, 6.0, 5.5, 'stood in the doorway pocket, tap the lounge floor   ');
walkFrom(4.4, 2.0, -10.0, 5.0, 'stood in the doorway pocket, tap the bathroom      ');
walkFrom(4.4, 2.0, 0, 0, 'CONTROL: from the pocket back to the hall           ');
