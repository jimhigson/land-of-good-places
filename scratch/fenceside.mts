import { buildHeadlessPark, quietly } from '../scripts/park-harness.mts';

const park = quietly(() => buildHeadlessPark());
const train = park.world.train;
const bridges = train.bridges;

const POINTS = [
  ['stranded  ', -46.0, -158.1],
  ['stranded  ', -46.7, -174.5],
  ['reachable ', -43.8, -156.2],
  ['park origin', 0, 0],
] as const;

console.log(`${bridges.length} bridge(s) in the park; ${train.crossings.length} crossing(s).`);
console.log('');
for (const [label, x, z] of POINTS) {
  // Nearest point on the train route, by brute sampling of the route itself.
  let best = Infinity;
  let bestAt = '';
  const N = 4000;
  for (let i = 0; i <= N; i += 1) {
    const p = train.route.pointAt(i / N);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < best) { best = d; bestAt = `(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`; }
  }
  let nearestBridge = Infinity;
  for (const b of bridges) {
    const c = train.crossings.find((cr) => b.deckCovers(cr.x, cr.z));
    if (!c) continue;
    nearestBridge = Math.min(nearestBridge, Math.hypot(c.x - x, c.z - z));
  }
  console.log(
    `${label} (${x.toFixed(1)}, ${z.toFixed(1)}): ` +
      `${best.toFixed(1)} m from the railway (nearest rail point ${bestAt}), ` +
      `${nearestBridge === Infinity ? 'no bridge found' : `${nearestBridge.toFixed(1)} m from the nearest bridge crossing`}`,
  );
}
console.log('');
console.log('crossings:');
for (const c of train.crossings) {
  console.log(`  (${c.x.toFixed(1)}, ${c.z.toFixed(1)})  d_origin=${Math.hypot(c.x, c.z).toFixed(1)} m`);
}
