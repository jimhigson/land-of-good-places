/** TEMP diagnostic: the grid's own components, with the ring, the bridge feet
 * and the gate handover located in them. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugGridReach } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
const r = debugGridReach() as { components: unknown; ringComp: unknown; feet: unknown; map: string[] };
console.log('components (id,size):', JSON.stringify(r.components));
console.log('ringComp:', JSON.stringify(r.ringComp));
console.log('feet:', JSON.stringify(r.feet));
for (const row of r.map) console.log(row);
