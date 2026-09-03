/** TEMP diagnostic: screen verdicts for a list of explicit legs. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugLegScreens } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
const a = process.argv.slice(2).map(Number);
for (let i = 0; i + 3 < a.length; i += 4) {
  console.dir(debugLegScreens(a[i]!, a[i + 1]!, a[i + 2]!, a[i + 3]!), { depth: null });
}
