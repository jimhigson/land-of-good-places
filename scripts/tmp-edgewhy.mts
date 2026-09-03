/** TEMP: which of `edgeOk`'s clauses refuses a lattice edge.
 * Usage: tmp-edgewhy.mts ax az bx bz side
 * Control: a second segment that IS an edge in the built lattice must come
 * back all-true, or the columns say nothing. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugEdgeWhy } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
const args = process.argv.slice(2);
for (let k = 0; k + 4 < args.length; k += 5) {
  const [ax, az, bx, bz, side] = args.slice(k, k + 5).map(Number) as number[];
  console.log(
    `(${ax},${az})->(${bx},${bz}) side=${side}`,
    debugEdgeWhy(ax as number, az as number, bx as number, bz as number, (side as number) as 1 | -1),
  );
}
