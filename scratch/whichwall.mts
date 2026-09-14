import { buildHeadlessPark, quietly } from '../scripts/park-harness.mts';

const park = quietly(() => buildHeadlessPark());
const byHalf = new Map<string, number>();
let near = 0;
const samples: string[] = [];
park.world.collision.forEachWall((x1, z1, x2, z2, half, top, hop, base) => {
  const k = `${half.toFixed(2)} top=${top === Infinity ? 'inf' : 'finite'} hop=${hop} base=${base === -Infinity ? '-inf' : 'finite'}`;
  byHalf.set(k, (byHalf.get(k) ?? 0) + 1);
  const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
  if (Math.hypot(mx + 45, mz + 157) < 12) {
    near += 1;
    if (samples.length < 12) {
      samples.push(`  (${x1.toFixed(1)},${z1.toFixed(1)})-(${x2.toFixed(1)},${z2.toFixed(1)}) half=${half.toFixed(2)} len=${Math.hypot(x2-x1,z2-z1).toFixed(2)} ${k}`);
    }
  }
});
console.log('every wall class in the park (halfThickness / top / hoppable / base):');
for (const [k, n] of [...byHalf.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(5)}  ${k}`);
console.log('');
console.log(`walls within 12 m of the refused edge: ${near}`);
for (const s of samples) console.log(s);
