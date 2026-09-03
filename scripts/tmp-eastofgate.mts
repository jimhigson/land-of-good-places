/** TEMP: seed 5 -- why does the gate's 2-node island at z=57.3 not link east
 * toward the bridge foot at (18.4, 59.1), which is in the ring's component?
 * Prints the lattice row around it with validity, side and the east edge.
 * Control: the same row further west, where links do exist. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugLatticeRow } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
for (const line of debugLatticeRow(57.3) as string[]) console.log(line);
