import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugNodeScreens } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
for (let i = 2; i + 1 < process.argv.length; i += 2) {
  console.dir(debugNodeScreens(Number(process.argv[i]), Number(process.argv[i + 1])), { depth: null });
}
