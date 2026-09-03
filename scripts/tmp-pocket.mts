/** TEMP diagnostic: name the pocket. For every unreachable poiGraph waypoint,
 * print its lane identity, its neighbours, and the nearest REACHABLE node it
 * fails to join — plus a control run over an equal number of reachable nodes
 * so the same columns can be read on a node that is known good. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PoiGraph } from '../src/entities/npc/poiGraph.ts';
import { bridgeHeightAt } from '../src/world/train/bridges.ts';
import { pointStandsOnABridgeRamp } from '../src/world/paths.ts';

const park = quietly(() => buildHeadlessPark());
const world = park.world;
const graph = quietly(
  () => new PoiGraph(world.collision, (x, z) => bridgeHeightAt(world.train.bridges, x, z)),
);
type N = {
  index: number;
  x: number;
  z: number;
  reachable: boolean;
  neighbours: number[];
  lane?: { name: string; at: number };
};
const nodes = graph.nodes as readonly N[];

const describe = (n: N): string => {
  const lane = n.lane ? `${n.lane.name}@${n.lane.at.toFixed(1)}` : '(no lane)';
  const nbrLanes = n.neighbours
    .map((i) => nodes[i] as N)
    .map((q) => (q.lane ? q.lane.name : '-'))
    .join(',');
  let nearestReachable = Infinity;
  let nearestId = '';
  for (const q of nodes) {
    if (!q.reachable || q.index === n.index) continue;
    const d = Math.hypot(q.x - n.x, q.z - n.z);
    if (d < nearestReachable) {
      nearestReachable = d;
      nearestId = `${q.x.toFixed(1)},${q.z.toFixed(1)}${q.lane ? ` ${q.lane.name}@${q.lane.at.toFixed(1)}` : ''}`;
    }
  }
  return (
    `(${n.x.toFixed(1)},${n.z.toFixed(1)}) ${lane} nbrs=${n.neighbours.length} [${nbrLanes}] ` +
    `onRamp=${pointStandsOnABridgeRamp(n.x, n.z)} h=${(bridgeHeightAt(world.train.bridges, n.x, n.z) ?? NaN).toFixed(2)} ` +
    `nearestReachable=${nearestReachable.toFixed(2)}m at ${nearestId}`
  );
};

const stranded = nodes.filter((n) => !n.reachable);
console.log(`stranded: ${stranded.length}`);
for (const n of stranded) console.log('  X', describe(n));

// The lanes those stranded nodes belong to, printed whole, so the two ends of
// the pocket are visible.
const laneNames = new Set(stranded.map((n) => n.lane?.name).filter((s): s is string => !!s));
for (const name of laneNames) {
  console.log(`\nlane ${name}:`);
  const list = nodes
    .filter((n) => n.lane?.name === name)
    .sort((a, b) => (a.lane?.at ?? 0) - (b.lane?.at ?? 0));
  for (const n of list) {
    console.log(
      `  ${n.reachable ? 'ok' : 'XX'} at=${(n.lane?.at ?? 0).toFixed(1)} (${n.x.toFixed(1)},${n.z.toFixed(1)}) ` +
        `nbrs=${n.neighbours.length} onRamp=${pointStandsOnABridgeRamp(n.x, n.z)} ` +
        `h=${(bridgeHeightAt(world.train.bridges, n.x, n.z) ?? NaN).toFixed(2)}`,
    );
  }
}

// CONTROL: the same columns on reachable nodes, to prove the instrument can
// tell them apart rather than printing the same thing about everything.
console.log('\ncontrol (reachable nodes, same columns):');
for (const n of nodes.filter((q) => q.reachable).slice(0, 5)) console.log('  .', describe(n));
