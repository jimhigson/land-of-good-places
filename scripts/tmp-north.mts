/** TEMP diagnostic: the grid's nodes north of the railway near the gate, with
 * their component id, so a pocket round the arch can be seen and named. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugGridNodes } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
const zMin = Number(process.argv[2] ?? 40);
const rows = debugGridNodes() as { x: number; z: number; comp: number; nbrs: string[]; reachable: boolean }[];
for (const r of rows) {
  if (r.z < zMin) continue;
  console.log(
    `(${r.x.toFixed(1)},${r.z.toFixed(1)}) comp=${r.comp} ${r.reachable ? 'REACHABLE' : '---------'} nbrs=[${r.nbrs.join(' ')}]`,
  );
}
