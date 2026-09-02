import { PATH_GRAPH } from '../src/world/pathGraph.ts';
import { debugGridReach, debugRelaxedDoors } from '../src/world/paths.ts';
void PATH_GRAPH;
console.log('doors:', debugRelaxedDoors());
console.dir(debugGridReach(), { depth: null });
import { strandedDoorsOfLastSolve } from '../src/world/paths.ts';
console.log('stranded:', strandedDoorsOfLastSolve());
