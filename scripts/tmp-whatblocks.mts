/** TEMP diagnostic: name what refuses a point for streetSegmentClear. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugWhatBlocks } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
for (let i = 2; i + 1 < process.argv.length; i += 2) {
  const x = Number(process.argv[i]);
  const z = Number(process.argv[i + 1]);
  console.log(`(${x},${z})`, JSON.stringify(debugWhatBlocks(x, z)));
}
