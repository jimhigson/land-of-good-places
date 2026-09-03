/** TEMP: the grid's component census and the ring's own component, plus the
 * ASCII map. Control: run it on a green seed too — a seed whose grid is one
 * component must print one dominant id, or the census says nothing. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugGridReach } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
const r = debugGridReach() as Record<string, unknown>;
console.log(`seed ${process.env.LGP_SEED ?? 'canonical'}`);
console.log('  ringComp     ', r.ringComp);
console.log('  components   ', r.components);
console.log('  unreachable  ', r.unreachable);
console.log('  noSearch     ', r.noSearch);
console.log('  doorComp     ', (r.doorComp as string[]).join(' '));
if (process.argv[2] === 'map') for (const row of r.map as string[]) console.log('  ' + row);
