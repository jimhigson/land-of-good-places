/** TEMP diagnostic: which crossing site's reservation cuts a leg. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugWhichSiteCuts } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
const a = process.argv.slice(2).map(Number);
console.dir(debugWhichSiteCuts(a[0]!, a[1]!, a[2]!, a[3]!), { depth: null });
