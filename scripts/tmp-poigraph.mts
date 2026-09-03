import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PoiGraph, SEEDS } from '../src/entities/npc/poiGraph.ts';
import { bridgeHeightAt } from '../src/world/train/bridges.ts';

const park = quietly(() => buildHeadlessPark());
const world = park.world;
const graph = quietly(
  () => new PoiGraph(world.collision, (x, z) => bridgeHeightAt(world.train.bridges, x, z)),
);
const nodes = graph.nodes;
// Components over the built edge set.
const comp = new Int32Array(nodes.length).fill(-1);
let next = 0;
for (let i = 0; i < nodes.length; i += 1) {
  if (comp[i] !== -1) continue;
  const id = next++;
  const queue = [i];
  comp[i] = id;
  while (queue.length) {
    const here = queue.pop() as number;
    for (const n of (nodes[here] as { neighbours: number[] }).neighbours) {
      if (comp[n] !== -1) continue;
      comp[n] = id;
      queue.push(n);
    }
  }
}
const sizes = new Map<number, number>();
for (const c of comp) sizes.set(c, (sizes.get(c) ?? 0) + 1);
const ranked = [...sizes.entries()].sort((a, b) => b[1] - a[1]);
console.log(`seeds ${SEEDS.length} placed ${nodes.length} components ${ranked.length}: ${ranked.slice(0, 8).map(([c, n]) => `${c}:${n}`).join(' ')}`);
const main = ranked[0]?.[0] ?? -1;
// For every node NOT in the main component, the nearest main-component node.
let best: { d: number; a: number; b: number } | null = null;
const laneTally = new Map<string, number>();
for (let i = 0; i < nodes.length; i += 1) {
  if (comp[i] === main) continue;
  const a = nodes[i] as { x: number; z: number; lane?: { name: string } };
  laneTally.set(a.lane?.name ?? 'scatter', (laneTally.get(a.lane?.name ?? 'scatter') ?? 0) + 1);
  for (let j = 0; j < nodes.length; j += 1) {
    if (comp[j] !== main) continue;
    const b = nodes[j] as { x: number; z: number };
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (!best || d < best.d) best = { d, a: i, b: j };
  }
}
console.log('off-main by lane:', [...laneTally.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}:${v}`).join('  '));
if (best) {
  const a = nodes[best.a] as { x: number; z: number; lane?: { name: string } };
  const b = nodes[best.b] as { x: number; z: number; lane?: { name: string } };
  console.log(
    `closest cross-component pair: ${best.d.toFixed(2)} m — (${a.x.toFixed(1)},${a.z.toFixed(1)}) lane ${a.lane?.name ?? '-'}` +
      ` <-> (${b.x.toFixed(1)},${b.z.toFixed(1)}) lane ${b.lane?.name ?? '-'}`,
  );
}
