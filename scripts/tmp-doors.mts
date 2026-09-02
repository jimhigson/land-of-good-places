import { PATH_GRAPH } from '../src/world/pathGraph.ts';
import { debugRelaxedDoors, debugDoorReach } from '../src/world/paths.ts';
console.log('relaxed/failed doors:', debugRelaxedDoors());
const failed = debugRelaxedDoors().filter((d) => d.endsWith('!')).map((d) => d.slice(0, -1));
for (const id of failed) {
  const node = PATH_GRAPH.nodes.find((n) => n.id === id);
  if (!node) { console.log('no node for', id); continue; }
  const r = debugDoorReach([node.x, node.z]) as { p: unknown; pSide: unknown; ringDist: unknown; out: unknown[] };
  console.log(id, r.p, 'side', r.pSide, 'ringDist', r.ringDist);
  for (const n of r.out.slice(0, 10)) console.log('   ', JSON.stringify(n));
}
import { PARK_BOUNDARY } from '../src/world/boundary.ts';
for (const id of debugRelaxedDoors().filter((d) => d.endsWith('!')).map((d) => d.slice(0, -1))) {
  const n = PATH_GRAPH.nodes.find((q) => q.id === id);
  if (n) console.log(`  ${id} at (${n.x.toFixed(1)},${n.z.toFixed(1)}) boundaryEdge ${PARK_BOUNDARY.distanceToEdge(n.x, n.z).toFixed(2)}`);
}
