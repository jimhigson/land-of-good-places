import { buildHeadlessPark, quietly } from '../scripts/park-harness.mts';

const park = quietly(() => buildHeadlessPark());
const ring: { x1: number; z1: number; x2: number; z2: number }[] = [];
park.world.collision.forEachWall((x1, z1, x2, z2, half, top) => {
  if (Math.abs(half - 0.32) < 1e-6 && top === Infinity) ring.push({ x1, z1, x2, z2 });
});
console.log(`${ring.length} walls, half=0.32, infinite top`);
const xs = ring.flatMap((w) => [w.x1, w.x2]);
const zs = ring.flatMap((w) => [w.z1, w.z2]);
const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
console.log(
  `extent x [${Math.min(...xs).toFixed(1)}, ${Math.max(...xs).toFixed(1)}] ` +
    `z [${Math.min(...zs).toFixed(1)}, ${Math.max(...zs).toFixed(1)}]  centre (${cx.toFixed(1)}, ${cz.toFixed(1)})  ` +
    `d_origin=${Math.hypot(cx, cz).toFixed(1)} m`,
);
// Is it closed? Walk the chain by endpoint matching.
const used = new Set<number>();
let chainLen = 0;
let cur = ring[0];
used.add(0);
let end = { x: cur!.x2, z: cur!.z2 };
for (let step = 0; step < ring.length + 2; step += 1) {
  let found = -1;
  for (let i = 0; i < ring.length; i += 1) {
    if (used.has(i)) continue;
    const w = ring[i]!;
    if (Math.hypot(w.x1 - end.x, w.z1 - end.z) < 0.25) { found = i; end = { x: w.x2, z: w.z2 }; break; }
    if (Math.hypot(w.x2 - end.x, w.z2 - end.z) < 0.25) { found = i; end = { x: w.x1, z: w.z1 }; break; }
  }
  if (found < 0) break;
  used.add(found);
  chainLen += 1;
}
const backToStart = Math.hypot(end.x - ring[0]!.x1, end.z - ring[0]!.z1);
console.log(`chain follows ${chainLen + 1} of ${ring.length} segments; returns to within ${backToStart.toFixed(2)} m of its start`);
console.log(backToStart < 0.5 ? '=> CLOSED RING: nothing can walk in or out.' : '=> open chain (or more than one chain)');
