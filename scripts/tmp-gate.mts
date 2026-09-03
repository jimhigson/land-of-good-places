/** TEMP diagnostic: the gate corridor's mouth candidates and the grid's view of them. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugGateNodes } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
console.dir(debugGateNodes(), { depth: null, maxArrayLength: 40 });
