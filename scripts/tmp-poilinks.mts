import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PoiGraph } from '../src/entities/npc/poiGraph.ts';
import { bridgeHeightAt } from '../src/world/train/bridges.ts';

const park = quietly(() => buildHeadlessPark());
const world = park.world;
const graph = quietly(
  () => new PoiGraph(world.collision, (x, z) => bridgeHeightAt(world.train.bridges, x, z)),
);
const nodes = graph.nodes as readonly { x: number; z: number; lane?: { name: string }; neighbours: number[] }[];
const EAST = new Set([
  'spur-building', 'spur-hotel', 'spur-ballPit', 'spur-waterFight', 'spur-stall.waterFight',
  'spur-stall.skyCruiser', 'spur-exit-skyCruiser', 'spur-exit-ginormousSlide',
  'connector-building-exit-ginormousSlide',
]);
const isEast = (i: number): boolean => EAST.has(nodes[i]?.lane?.name ?? '');
const seen = new Map<string, { n: number; best: number; at: string }>();
for (let a = 0; a < nodes.length; a += 1) {
  for (const b of (nodes[a] as { neighbours: number[] }).neighbours) {
    if (b < a) continue;
    if (isEast(a) === isEast(b)) continue;
    const na = nodes[a] as { x: number; z: number; lane?: { name: string } };
    const nb = nodes[b] as { x: number; z: number; lane?: { name: string } };
    const key = `${na.lane?.name ?? 'scatter'} | ${nb.lane?.name ?? 'scatter'}`;
    const d = Math.hypot(na.x - nb.x, na.z - nb.z);
    const hit = seen.get(key);
    if (!hit || d < hit.best) {
      seen.set(key, {
        n: (hit?.n ?? 0) + 1,
        best: d,
        at: `(${na.x.toFixed(1)},${na.z.toFixed(1)})-(${nb.x.toFixed(1)},${nb.z.toFixed(1)})`,
      });
    } else hit.n += 1;
  }
}
console.log(`east<->rest poiGraph edges: ${[...seen.values()].reduce((s, v) => s + v.n, 0)}`);
for (const [k, v] of [...seen.entries()].sort((x, y) => x[1].best - y[1].best)) {
  console.log(`  ${k}  x${v.n}  closest ${v.best.toFixed(2)} m at ${v.at}`);
}
