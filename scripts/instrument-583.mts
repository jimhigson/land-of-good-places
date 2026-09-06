/**
 * SCRATCH INSTRUMENT for #583 — not a check, not for committing to the chain.
 *
 * Prints, for a grid of taps across the suite's floor, exactly what the tap
 * pipeline resolved to:
 *   - did the pick find a walkable point (cause 1)
 *   - is that point standable in the lattice (cause 2)
 *   - did the router reach it, and in how many waypoints (cause 3)
 *
 * CONTROL FIRST: the hall spot she is standing on, and a spot a stride in
 * front of her, must both report a reached route. If the control is not green
 * the instrument is measuring the wrong thing and nothing below it is
 * evidence.
 */
import './headless-canvas.mjs';
import { Ray, Vector3 } from 'three';
import { pickWalkablePoint } from '../src/world/pickWalkable.ts';
import { CAMERA_PITCH_DEGREES } from '../src/core/constants.ts';
import { buildHeadlessPark } from './park-harness.mts';
import { NavGrid, MAX_ROUTE_WAYPOINTS } from '../src/world/NavGrid.ts';
import { circleBoundary } from '../src/world/boundary.ts';
import { HOTEL_PLAY_RADIUS, PLAYER_RADIUS } from '../src/core/constants.ts';
import { JUMP_APEX_HEIGHT } from '../src/entities/Player.ts';
import { SUITE } from '../src/world/hotel/layout.ts';

const park = buildHeadlessPark();
park.world.collision.setPlayBounds(
  circleBoundary(HOTEL_PLAY_RADIUS, SUITE.originX, SUITE.originZ),
);

const navGrid = new NavGrid(
  park.world.collision,
  PLAYER_RADIUS,
  JUMP_APEX_HEIGHT,
  () => park.world.building.surfaces.connectors,
);

const sampler = park.sample;

const world = (x: number, z: number) => ({ x: SUITE.originX + x, z: SUITE.originZ + z });

// Where `Hotel.enterSuite` actually drops her: `-SUITE.halfX + 1.6, 0`.
const startLocal = { x: -SUITE.halfX + 1.6, z: 0 };
const start = world(startLocal.x, startLocal.z);
const startY = sampler(start.x, start.z, 3);

const out = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);

interface Probe {
  readonly count: number;
  readonly reached: boolean;
  readonly endLocalX: number;
  readonly endLocalZ: number;
  readonly standable: boolean;
  readonly groundY: number;
}

function probe(localX: number, localZ: number): Probe {
  const w = world(localX, localZ);
  const groundY = sampler(w.x, w.z, 3);
  const standable = navGrid.canStandAt(w.x, w.z, groundY, sampler);
  const count = navGrid.findRoute(start.x, start.z, startY, w.x, w.z, groundY, sampler, out);
  const endX = count > 0 ? (out[(count - 1) * 2] ?? w.x) : start.x;
  const endZ = count > 0 ? (out[(count - 1) * 2 + 1] ?? w.z) : start.z;
  return {
    count,
    reached: navGrid.lastRouteReachedGoal,
    endLocalX: endX - SUITE.originX,
    endLocalZ: endZ - SUITE.originZ,
    standable,
    groundY,
  };
}

const fmt = (p: Probe): string =>
  `count=${String(p.count).padStart(3)} reached=${p.reached ? 'YES' : 'no '} ` +
  `standable=${p.standable ? 'YES' : 'no '} ` +
  `end=(${p.endLocalX.toFixed(2)}, ${p.endLocalZ.toFixed(2)}) y=${p.groundY.toFixed(2)}`;

console.log(`SUITE halfX=${SUITE.halfX} halfZ=${SUITE.halfZ}`);
console.log(`she enters at local (${startLocal.x.toFixed(2)}, ${startLocal.z.toFixed(2)}), y=${startY.toFixed(2)}`);

console.log('\n=== CONTROL — must be reached=YES, or nothing below is evidence ===');
console.log(`  her own spot          ${fmt(probe(startLocal.x, startLocal.z))}`);
console.log(`  one stride east       ${fmt(probe(startLocal.x + 1.5, 0))}`);
console.log(`  hall, middle          ${fmt(probe(0, 0))}`);
console.log(`  hall, east end        ${fmt(probe(12, 0))}`);

// The three bedrooms, from SUITE's own partitions rather than typed in.
const along = SUITE.partitions.filter((p) => p.along === 'x');
const hallWall = along.find((p) => p.at < 0);
const dividers = SUITE.partitions.filter((p) => p.along === 'z' && p.to <= (hallWall?.at ?? 0));
const dividerX = dividers.map((d) => d.at).sort((a, b) => a - b);
const edges = [-SUITE.halfX, ...dividerX, SUITE.halfX];
const doors = hallWall?.doors ?? [];
console.log(`\nhall partition at z=${hallWall?.at}, doors at x=${doors.join(', ')}`);
console.log(`bedroom x-edges: ${edges.map((e) => e.toFixed(1)).join(' | ')}`);

console.log('\n=== BEDROOMS — north strip, z from north wall to the hall wall ===');
for (let b = 0; b < edges.length - 1; b += 1) {
  const lo = edges[b]!;
  const hi = edges[b + 1]!;
  const centreX = (lo + hi) / 2;
  console.log(`\n-- bedroom ${b}: x ${lo.toFixed(1)}..${hi.toFixed(1)} (width ${(hi - lo).toFixed(2)}), door at ${doors[b]}`);
  // just inside its doorway, then deeper into the room
  const doorX = doors[b] ?? centreX;
  console.log(`   in the doorway        ${fmt(probe(doorX, (hallWall?.at ?? -1.7) - 0.6))}`);
  console.log(`   one step inside       ${fmt(probe(doorX, (hallWall?.at ?? -1.7) - 1.5))}`);
  console.log(`   room centre           ${fmt(probe(centreX, -4.8))}`);
  console.log(`   far (north) side      ${fmt(probe(centreX, -7.0))}`);
  console.log(`   west corner           ${fmt(probe(lo + 1.0, -6.5))}`);
  console.log(`   east corner           ${fmt(probe(hi - 1.0, -6.5))}`);
}

// ---------------------------------------------------------------- the pick
// A tap ray exactly as the game casts one (copied from check-nav-routes'
// `isoRayAt`, which is the shape `IsoCamera` actually backs out along).
function isoRayAt(target: Vector3): Ray {
  const pitch = (CAMERA_PITCH_DEGREES * Math.PI) / 180;
  const back = new Vector3(1, Math.tan(pitch) * Math.SQRT2, 1).normalize().multiplyScalar(60);
  const origin = target.clone().add(back);
  return new Ray(origin, target.clone().sub(origin).normalize());
}

const ceiling = park.world.building.visibleSurfaceCeiling;
console.log(`\nvisibleSurfaceCeiling = ${ceiling}`);

function pickAt(localX: number, localZ: number): string {
  const w = world(localX, localZ);
  const y = sampler(w.x, w.z, 3);
  const hit = new Vector3();
  const found = pickWalkablePoint(isoRayAt(new Vector3(w.x, y, w.z)), sampler, ceiling, hit);
  if (!found) return `MISS — the ray found no walkable ground at all`;
  const dx = hit.x - w.x;
  const dz = hit.z - w.z;
  const err = Math.hypot(dx, dz);
  return `hit local (${(hit.x - SUITE.originX).toFixed(2)}, ${(hit.z - SUITE.originZ).toFixed(2)}) y=${hit.y.toFixed(2)} — off by ${err.toFixed(2)} m${err > 0.5 ? '   <<< WRONG PLACE' : ''}`;
}

console.log('\n=== THE PICK — where does a tap aimed at each spot actually land? ===');
console.log('  CONTROL, hall middle   ' + pickAt(0, 0));
console.log('  CONTROL, hall west     ' + pickAt(-13.2, 0));
for (let b = 0; b < edges.length - 1; b += 1) {
  const lo = edges[b]!;
  const hi = edges[b + 1]!;
  const centreX = (lo + hi) / 2;
  const doorX = doors[b] ?? centreX;
  console.log(`\n-- bedroom ${b} (x ${lo.toFixed(1)}..${hi.toFixed(1)})`);
  console.log('   doorway               ' + pickAt(doorX, -2.3));
  console.log('   one step inside       ' + pickAt(doorX, -3.2));
  console.log('   room centre           ' + pickAt(centreX, -4.8));
  console.log('   north side            ' + pickAt(centreX, -7.0));
  console.log('   south-west floor      ' + pickAt(lo + 1.5, -2.6));
  console.log('   south-east floor      ' + pickAt(hi - 1.5, -2.6));
}
