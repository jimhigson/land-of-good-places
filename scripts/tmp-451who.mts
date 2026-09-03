/** TEMP: which producer drew seed 451's `spur-stall.spookyHouse`?
 * Two points and nothing between them is the straight-line last resort's own
 * signature; `strandedDoorsOfLastSolve()` names the doors that fell to it. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { strandedDoorsOfLastSolve } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
console.log('strandedDoorsOfLastSolve:', JSON.stringify(strandedDoorsOfLastSolve()));
