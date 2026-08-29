// Throwaway: dumps PoiGraph connected-component sizes per space, to settle
// whether #348's railway/bridge work split the park. Delete once #350 lands.
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import type { PoiGraph, PoiNode } from '../src/entities/npc/poiGraph.ts';

const park = buildHeadlessPark();
const graph = (park.world.npcs as unknown as { graph: PoiGraph }).graph;
const nodes = graph.nodes;

const componentOf = new Map<number, number>();
const comps: PoiNode[][] = [];
for (const start of nodes) {
  if (componentOf.has(start.index)) continue;
  const c = comps.length;
  const members: PoiNode[] = [];
  const stack = [start.index];
  componentOf.set(start.index, c);
  while (stack.length) {
    const i = stack.pop()!;
    const n = nodes[i];
    if (!n) continue;
    members.push(n);
    for (const nb of n.neighbours) {
      if (componentOf.has(nb)) continue;
      componentOf.set(nb, c);
      stack.push(nb);
    }
  }
  comps.push(members);
}

const bySpace = new Map<string, PoiNode[][]>();
for (const m of comps) {
  const space = m[0]!.space;
  if (!bySpace.has(space)) bySpace.set(space, []);
  bySpace.get(space)!.push(m);
}

console.log(`total nodes=${nodes.length}, components=${comps.length}`);
for (const [space, list] of bySpace) {
  list.sort((a, b) => b.length - a.length);
  console.log(
    `  space=${space.padEnd(10)} components=[${list.map((m) => m.length).join(',')}]` +
      `  reachable=${nodes.filter((n) => n.space === space && n.reachable).length}` +
      `/${nodes.filter((n) => n.space === space).length}`,
  );
  for (const m of list.slice(1)) {
    console.log(
      `      stranded(${m.length}): ` +
        m.map((n) => `(${n.x.toFixed(1)},${n.z.toFixed(1)})`).join(' '),
    );
  }
}

const park2 = nodes.filter((n) => n.space === 'garden' && n.reachable);
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (const n of park2) {
  minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
  minZ = Math.min(minZ, n.z); maxZ = Math.max(maxZ, n.z);
}
console.log(
  `garden reachable extent x=[${minX.toFixed(1)},${maxX.toFixed(1)}] ` +
    `z=[${minZ.toFixed(1)},${maxZ.toFixed(1)}]`,
);
console.log(`garden interesting reachable=${park2.filter((n) => n.interesting).length}`);
