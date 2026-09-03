/** TEMP: why is stall.facePaint's cheapest connector at a node 15.0 m and
 * 20.3 m away? Prints every lattice node in the first shells with the screen
 * verdicts, so the refusal can be named instead of guessed.
 * CONTROL: the node the connector actually took must appear as fully clear. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugDoorReach, debugNodeEdges } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
const p = [27.1, 39.2] as const;
const r = debugDoorReach(p) as { p: unknown; out: Record<string, unknown>[] };
console.log('door', JSON.stringify(r.p));
for (const row of r.out) {
  console.log(
    `  n=${String(row.n).padEnd(14)} ok=${row.ok ? 'Y' : '.'} side=${row.side}/${row.pSide} ` +
      `tail=${String(row.tail).padStart(5)} direct=${String(row.direct).padStart(5)} ` +
      `clear=${row.clear ? 'Y' : '.'} ring=${row.ring ? 'Y' : '.'} rail=${row.railSide ? 'Y' : '.'} ` +
      `ramp=${row.ramp ? 'Y' : '.'} elbowA=${row.elbowA} elbowB=${row.elbowB}`,
  );
}
console.log('\nCONTROL — the node the connector actually took:');
console.log(JSON.stringify(debugNodeEdges(27.1, 39.2), null, 1));
