/** TEMP: which clause refuses the gate handover's rescue walk.
 * Control: the `none` row must find a walk, or the router itself is the
 * refusal and no clause below it means anything. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugGateRelay } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
const a = process.argv.slice(2).map(Number) as number[];
console.dir(debugGateRelay([a[0] as number, a[1] as number], [a[2] as number, a[3] as number]), { depth: null });
