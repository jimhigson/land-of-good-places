import { buildHeadlessPark, quietly } from '../scripts/park-harness.mts';
import { PoiGraph, SEEDS } from '../src/entities/npc/poiGraph.ts';
import { bridgeHeightAt } from '../src/world/train/bridges.ts';
import { terrainHeight } from '../src/world/terrain.ts';

const park = quietly(() => buildHeadlessPark());
const collision = park.world.collision;
const graph = quietly(
  () => new PoiGraph(collision, (x, z) => bridgeHeightAt(park.world.train.bridges, x, z)),
);
const nodes = graph.nodes;
const stranded = nodes.filter((n) => !n.reachable);
const others = nodes.filter((n) => n.reachable);

console.log(`poi: ${nodes.length}/${SEEDS.length} seeds placed, ${stranded.length} stranded`);
if (stranded.length === 0) {
  console.log('CONTROL FAILED: nothing stranded — this probe has nothing to explain.');
  process.exit(1);
}

const MAX_EDGE = 13;
console.log('');
console.log('Each stranded node: nearest reachable node, and whether an edge was even a candidate.');
for (const s of stranded) {
  let best = Infinity;
  let at = '';
  for (const o of others) {
    const d = Math.hypot(o.x - s.x, o.z - s.z);
    if (d < best) { best = d; at = `(${o.x.toFixed(1)}, ${o.z.toFixed(1)})`; }
  }
  console.log(
    `  (${s.x.toFixed(1)}, ${s.z.toFixed(1)})  d_origin=${Math.hypot(s.x, s.z).toFixed(1)} m  ` +
      `ground y=${terrainHeight(s.x, s.z).toFixed(1)}  ` +
      `nearest reachable ${best.toFixed(2)} m at ${at}  ` +
      `${best > MAX_EDGE ? '<<< BEYOND MAX_EDGE 13 m: no candidate edge exists' : 'within MAX_EDGE: an edge was tried and REFUSED'}  ` +
      `neighbours=${s.neighbours.length}`,
  );
}

// CONTROL: a reachable node must have neighbours, or "neighbours" means nothing.
const lonely = others.filter((o) => o.neighbours.length === 0).length;
console.log('');
console.log(`CONTROL: ${lonely} of ${others.length} reachable nodes have zero neighbours (expect 0).`);
