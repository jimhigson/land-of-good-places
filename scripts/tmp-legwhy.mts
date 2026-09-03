/** TEMP diagnostic: why the canonical seed's northern strip will not join. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugLegScreens, debugNodeScreens } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
console.dir(debugNodeScreens(-21.07, 55.38), { depth: null });
console.dir(debugNodeScreens(-9.07, 43.38), { depth: null });
for (const off of [6, -6]) {
  console.dir(debugLegScreens(-9.07, 55.38, -9.07, 55.38 + off), { depth: null });
  console.dir(debugLegScreens(-9.07, 55.38 + off, -33.07, 55.38 + off), { depth: null });
  console.dir(debugLegScreens(-33.07, 55.38 + off, -33.07, 55.38), { depth: null });
}
