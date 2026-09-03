/** TEMP: which router draws seed 225's 16.2 m diagonal at the building's door?
 * Prints the door's own connectors (with via points) plus every node the
 * arrival search considers. CONTROL: the node the drawn route actually uses
 * must appear among the connectors. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugNodeEdges, debugDoorReach } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
console.log('BUILDING DOOR:', JSON.stringify(debugNodeEdges(40.3, 13.6), null, 1));
const r = debugDoorReach([40.3, 13.6]) as { out: Record<string, unknown>[] };
console.log('\nnodes the arrival search sees (ok/clear/elbow verdicts):');
for (const row of r.out) {
  if (Number(row.direct) > 26) continue;
  console.log(
    `  n=${String(row.n).padEnd(13)} ok=${row.ok ? 'Y' : '.'} tail=${String(row.tail).padStart(5)} ` +
      `direct=${String(row.direct).padStart(5)} clear=${row.clear ? 'Y' : '.'} ` +
      `ring=${row.ring ? 'Y' : '.'} rail=${row.railSide ? 'Y' : '.'} ramp=${row.ramp ? 'Y' : '.'} ` +
      `elbowA=${row.elbowA} elbowB=${row.elbowB}`,
  );
}
