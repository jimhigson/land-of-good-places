import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from '../scripts/park-harness.mts';
import { bridgeHeightAt } from '../src/world/train/bridges.ts';
import { terrainHeight } from '../src/world/terrain.ts';

const park = quietly(() => buildHeadlessPark());
const collision = park.world.collision;
const bridges = park.world.train.bridges;

const A = { x: -46.0, z: -158.1 };   // stranded
const B = { x: -43.8, z: -156.2 };   // reachable
const CLEARANCE = 0.7;
const SAMPLE_STEP = 0.55;

const length = Math.hypot(B.x - A.x, B.z - A.z);
const steps = Math.max(1, Math.ceil(length / SAMPLE_STEP));
const probe = new Vector3();
console.log(`the refused edge: (${A.x}, ${A.z}) -> (${B.x}, ${B.z}), ${length.toFixed(2)} m, ${steps + 1} samples`);
console.log(`ground y along it is about ${terrainHeight(A.x, A.z).toFixed(1)} m; isClear probes at y = 0`);
console.log('');

for (let i = 0; i <= steps; i += 1) {
  const t = i / steps;
  const x = A.x + (B.x - A.x) * t;
  const z = A.z + (B.z - A.z) * t;
  const y = bridgeHeightAt(bridges, x, z) ?? 0;
  probe.set(x, y, z);
  collision.resolve(probe, CLEARANCE);
  const pushed = Math.hypot(probe.x - x, probe.z - z);
  if (pushed < 1e-3) continue;

  // Name what did it: every collider whose footprint this sample is inside.
  const culprits: string[] = [];
  collision.forEachCircle((cx, cz, radius, topHeight, _hop, baseHeight) => {
    const gap = Math.hypot(x - cx, z - cz) - (radius + CLEARANCE);
    if (gap < 0) {
      culprits.push(
        `circle r=${radius.toFixed(2)} at (${cx.toFixed(1)}, ${cz.toFixed(1)}) ` +
          `overlap ${(-gap).toFixed(2)} m top=${topHeight === Infinity ? 'inf' : topHeight.toFixed(2)} base=${baseHeight === -Infinity ? '-inf' : baseHeight.toFixed(2)}`,
      );
    }
  });
  collision.forEachWall((x1, z1, x2, z2, half, topHeight, _hop, baseHeight) => {
    const ax = x2 - x1, az = z2 - z1;
    const len2 = ax * ax + az * az || 1;
    let s = ((x - x1) * ax + (z - z1) * az) / len2;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    const gap = Math.hypot(x - (x1 + ax * s), z - (z1 + az * s)) - (half + CLEARANCE);
    if (gap < 0) {
      culprits.push(
        `wall half=${half.toFixed(2)} (${x1.toFixed(1)},${z1.toFixed(1)})-(${x2.toFixed(1)},${z2.toFixed(1)}) ` +
          `overlap ${(-gap).toFixed(2)} m top=${topHeight === Infinity ? 'inf' : topHeight.toFixed(2)} base=${baseHeight === -Infinity ? '-inf' : baseHeight.toFixed(2)}`,
      );
    }
  });
  const edge = collision.playBounds.distanceToEdge(x, z);
  console.log(
    `  sample ${i} at (${x.toFixed(2)}, ${z.toFixed(2)}): pushed ${pushed.toFixed(3)} m, ` +
      `distanceToEdge ${edge.toFixed(2)} m`,
  );
  for (const c of culprits) console.log(`      ${c}`);
  if (culprits.length === 0) console.log('      no collider overlaps — the push came from the boundary leash');
}
