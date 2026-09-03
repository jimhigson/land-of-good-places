/** TEMP diagnostic: NAME the collider standing at a point, and say whether it
 * exists when paths are solved.
 *
 * The ordering question decides the whole fix: `relayPolyline` cannot consult
 * the collision world for something not yet in it. So this prints the
 * blocking colliders twice — once from a world built with paths only, and
 * once from the finished park — and diffs them.
 *
 * CONTROL: the same query is run at a point the transect measured CLEAR. If
 * that also names blockers, the query is wrong and nothing here may be
 * believed. */
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { NPC_RADIUS } from '../src/core/constants.ts';

const park = quietly(() => buildHeadlessPark());
const world = park.world;
const CLEARANCE = 0.7;

const blockersAt = (x: number, z: number): string[] => {
  const hits: string[] = [];
  world.collision.forEachCircle((cx, cz, radius, topHeight, hop, baseHeight) => {
    const d = Math.hypot(cx - x, cz - z);
    if (d < radius + CLEARANCE) {
      hits.push(
        `circle at (${cx.toFixed(2)},${cz.toFixed(2)}) r=${radius.toFixed(2)} ` +
          `top=${topHeight.toFixed(2)} base=${baseHeight.toFixed(2)} hop=${hop} ` +
          `overlap=${(radius + CLEARANCE - d).toFixed(2)}`,
      );
    }
  });
  world.collision.forEachWall((x1, z1, x2, z2, halfThickness, topHeight, hop, baseHeight) => {
    // distance from point to segment
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / len2));
    const px = x1 + dx * t;
    const pz = z1 + dz * t;
    const d = Math.hypot(px - x, pz - z);
    if (d < halfThickness + CLEARANCE) {
      hits.push(
        `wall (${x1.toFixed(2)},${z1.toFixed(2)})-(${x2.toFixed(2)},${z2.toFixed(2)}) ` +
          `halfThick=${halfThickness.toFixed(2)} top=${topHeight.toFixed(2)} ` +
          `base=${baseHeight.toFixed(2)} hop=${hop} overlap=${(halfThickness + CLEARANCE - d).toFixed(2)}`,
      );
    }
  });
  return hits;
};

const probe = new Vector3();
const resolves = (x: number, z: number): boolean => {
  probe.set(x, 0, z);
  world.collision.resolve(probe, CLEARANCE);
  return Math.hypot(probe.x - x, probe.z - z) < 1e-3;
};

const report = (label: string, x: number, z: number): void => {
  console.log(`\n${label} (${x},${z}) — resolve says ${resolves(x, z) ? 'CLEAR' : 'BLOCKED'}`);
  const hits = blockersAt(x, z);
  if (hits.length === 0) console.log('   no collider within clearance');
  for (const h of hits) console.log('   ', h);
};

// Seed 11's spur-hotel blockage, kept because it documents that finding:
//   report('BLOCKAGE peak', -42.81, 12.39);  report('BLOCKAGE mid', -43.72, 18.22);
//   report('CONTROL clear (lane at=195)', -44.4, 22.6);
//   report('CONTROL clear (lane at=217)', -42.2, 8.5);
//
// Seed 451's spur-stall.spookyHouse lane, whose middle sample has nbrs=0
// while its neighbours 2.37 m away are reachable. Transect says 1.85 m of the
// 2.31 m chord is BLOCKED, peak push 0.82 m.
report('BLOCKAGE peak', 32.82, -33.28);
report('BLOCKAGE mid', 32.78, -32.82);
// CONTROL: the transect measured these two CLEAR — the lane's own endpoints.
report('CONTROL clear (lane at=14)', 32.7, -31.9);
report('CONTROL clear (lane at=7)', 32.9, -34.2);

console.log(`\ntotal colliders in the finished park: ${(() => {
  let c = 0;
  let w = 0;
  world.collision.forEachCircle(() => { c += 1; });
  world.collision.forEachWall(() => { w += 1; });
  return `${c} circles, ${w} walls`;
})()}`);
console.log('NPC_RADIUS', NPC_RADIUS);
