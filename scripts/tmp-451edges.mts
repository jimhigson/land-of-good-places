import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugNodeEdges } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
console.log('DOOR node:', JSON.stringify(debugNodeEdges(34.139767942507596, -28.908112970672228), null, 1));
console.log('\nARTERIAL node:', JSON.stringify(debugNodeEdges(32.27920840452955, -40.20886693091485), null, 1));
