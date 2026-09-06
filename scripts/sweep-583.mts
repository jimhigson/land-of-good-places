/** SCRATCH sweep for #583 — dense map of what a tap on each floor cell does. */
import './headless-canvas.mjs';
import { Ray, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { NavGrid, MAX_ROUTE_WAYPOINTS } from '../src/world/NavGrid.ts';
import { pickWalkablePoint } from '../src/world/pickWalkable.ts';
import { circleBoundary } from '../src/world/boundary.ts';
import { CAMERA_PITCH_DEGREES, HOTEL_PLAY_RADIUS, PLAYER_RADIUS } from '../src/core/constants.ts';
import { JUMP_APEX_HEIGHT } from '../src/entities/Player.ts';
import { SUITE } from '../src/world/hotel/layout.ts';

const park = buildHeadlessPark();
park.world.collision.setPlayBounds(circleBoundary(HOTEL_PLAY_RADIUS, SUITE.originX, SUITE.originZ));
const navGrid = new NavGrid(park.world.collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT,
  () => park.world.building.surfaces.connectors);
const sampler = park.sample;
const ceiling = park.world.building.visibleSurfaceCeiling;
const out = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);
const wx = (x: number) => SUITE.originX + x;
const wz = (z: number) => SUITE.originZ + z;
const start = { x: wx(-SUITE.halfX + 1.6), z: wz(0) };
const startY = sampler(start.x, start.z, 3);

function isoRayAt(t: Vector3): Ray {
  const pitch = (CAMERA_PITCH_DEGREES * Math.PI) / 180;
  const back = new Vector3(1, Math.tan(pitch) * Math.SQRT2, 1).normalize().multiplyScalar(60);
  const o = t.clone().add(back);
  return new Ray(o, t.clone().sub(o).normalize());
}

// Legend:
//  .  tap works: picks this spot and the route reaches it
//  P  the PICK landed somewhere else (>0.75 m away)
//  R  picked fine, but the route could not reach it (target snaps elsewhere)
//  X  the pick found no ground at all
//  #  not standable (inside a wall or a prop) — correctly refused
const hit = new Vector3();
const rows: string[] = [];
const STEP = 0.5;
let counts: Record<string, number> = {};
for (let z = -SUITE.halfZ + 0.25; z <= SUITE.halfZ; z += STEP) {
  let row = '';
  for (let x = -SUITE.halfX + 0.25; x <= SUITE.halfX; x += STEP) {
    const X = wx(x), Z = wz(z);
    const y = sampler(X, Z, 3);
    const standable = navGrid.canStandAt(X, Z, y, sampler);
    let ch: string;
    const found = pickWalkablePoint(isoRayAt(new Vector3(X, y, Z)), sampler, ceiling, hit);
    if (!standable) ch = '#';
    else if (!found) ch = 'X';
    else if (Math.hypot(hit.x - X, hit.z - Z) > 0.75) ch = 'P';
    else {
      const n = navGrid.findRoute(start.x, start.z, startY, X, Z, y, sampler, out);
      ch = n > 0 && navGrid.lastRouteReachedGoal ? '.' : 'R';
    }
    counts[ch] = (counts[ch] ?? 0) + 1;
    row += ch;
  }
  rows.push(`z=${z.toFixed(2).padStart(6)} ${row}`);
}
console.log(`x from ${(-SUITE.halfX + 0.25).toFixed(2)} to ${SUITE.halfX.toFixed(2)}, step ${STEP}`);
console.log('legend: . works   P pick lands elsewhere   R no route   X no ground   # not standable');
for (const r of rows) console.log(r);
console.log('\ncounts: ' + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  '));
