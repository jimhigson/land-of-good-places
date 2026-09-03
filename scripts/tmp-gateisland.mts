/** TEMP: seed 5's gate island. Which grid component does the gate corridor's
 * handover land in, which one is the nearest ring-reachable node in, and how
 * far apart are the two? Prints every node of both, so the gap can be read
 * rather than guessed.
 *
 * The ASCII map in `debugGridReach` cannot answer this: component ids of two
 * digits take two characters, so every row containing one is silently shifted
 * and the picture misreads. Coordinates, not pictures.
 *
 * Control: the ring's own component must come out large and must NOT be the
 * handover's, or the column is not discriminating between islands. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugGridIslands } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
console.log(`seed ${process.env.LGP_SEED ?? 'canonical'}`);
for (const line of debugGridIslands() as string[]) console.log('  ' + line);
