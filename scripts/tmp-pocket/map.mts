import '../headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark } from '../park-harness.mts';
import { NavGrid } from '../../src/world/NavGrid.ts';
import { PLAYER_RADIUS } from '../../src/core/constants.ts';
import { JUMP_APEX_HEIGHT } from '../../src/entities/Player.ts';
import { ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z } from '../../src/world/entrance/layout.ts';

const park = buildHeadlessPark();
const { world, sample } = park;
const nav = new NavGrid(world.collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT, undefined,
  (x, z) => world.train.bridges.some((b) => b.covers(x, z)));
const flood = nav.floodFrom(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z, sample(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z, 0), sample)!;
const cells = new Set<string>();
flood.forEachCell((x, z) => cells.add(`${Math.round(x * 2)},${Math.round(z * 2)}`));
const route = world.train.route;
const p = new Vector3();
const railD = (x: number, z: number) => { route.pointAt(route.distanceNear(x, z), p); return Math.hypot(p.x - x, p.z - z); };
const probe = new Vector3();
const standable = (x: number, z: number) => { probe.set(x, sample(x, z, 0), z); world.collision.resolve(probe, PLAYER_RADIUS); return Math.hypot(probe.x - x, probe.z - z) < 1e-3; };
const [x0, x1, z0, z1, step] = (process.env['BOX'] ?? '0,95,10,75,1').split(',').map(Number) as [number, number, number, number, number];
console.log(`seed map x ${x0}..${x1} z ${z0}..${z1} step ${step}; R reached, . standable unreached, # blocked, = rail<1.5, B bridge covers`);
for (let z = z0; z <= z1; z += step) {
  let row = `${z.toFixed(0).padStart(4)} `;
  for (let x = x0; x <= x1; x += step) {
    const reached = cells.has(`${Math.round(x * 2)},${Math.round(z * 2)}`);
    const bridge = world.train.bridges.some((b) => b.covers(x, z));
    let c = reached ? 'R' : standable(x, z) ? '.' : '#';
    if (bridge) c = reached ? 'b' : 'B';
    else if (railD(x, z) < 1.5) c = reached ? 'r' : '=';
    row += c;
  }
  console.log(row);
}
for (const c of world.train.crossings) console.log('crossing', c.x.toFixed(1), c.z.toFixed(1));
