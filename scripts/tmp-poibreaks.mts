import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PoiGraph } from '../src/entities/npc/poiGraph.ts';
import { bridgeHeightAt } from '../src/world/train/bridges.ts';
import { pointStandsOnABridgeRamp } from '../src/world/paths.ts';

const park = quietly(() => buildHeadlessPark());
const world = park.world;
const graph = quietly(
  () => new PoiGraph(world.collision, (x, z) => bridgeHeightAt(world.train.bridges, x, z)),
);
const nodes = graph.nodes as readonly { x: number; z: number; lane?: { name: string; at: number }; neighbours: number[] }[];
const byLane = new Map<string, number[]>();
for (let i = 0; i < nodes.length; i += 1) {
  const lane = nodes[i]?.lane;
  if (!lane) continue;
  const list = byLane.get(lane.name) ?? [];
  list.push(i);
  byLane.set(lane.name, list);
}
let breaks = 0;
for (const [name, list] of byLane) {
  list.sort((a, b) => (nodes[a]?.lane?.at ?? 0) - (nodes[b]?.lane?.at ?? 0));
  for (let k = 1; k < list.length; k += 1) {
    const a = list[k - 1] as number;
    const b = list[k] as number;
    if ((nodes[a] as { neighbours: number[] }).neighbours.includes(b)) continue;
    const na = nodes[a] as { x: number; z: number };
    const nb = nodes[b] as { x: number; z: number };
    const mx = (na.x + nb.x) / 2;
    const mz = (na.z + nb.z) / 2;
    breaks += 1;
    console.log(
      `${name}: chain breaks between (${na.x.toFixed(1)},${na.z.toFixed(1)}) and (${nb.x.toFixed(1)},${nb.z.toFixed(1)}) ` +
        `gap ${Math.hypot(nb.x - na.x, nb.z - na.z).toFixed(2)} m, midpoint on a bridge ramp: ${pointStandsOnABridgeRamp(mx, mz)}`,
    );
  }
}
console.log('total consecutive-sample breaks:', breaks);
