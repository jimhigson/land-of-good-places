/** TEMP diagnostic: the whole drawn route set, one line each, for diffing two
 * builds of the same seed against each other. */
import { ROUTES } from '../src/world/pathGraph.ts';
import { strandedDoorsOfLastSolve } from '../src/world/paths.ts';
const names = [...ROUTES].sort((a, b) => a.name.localeCompare(b.name));
for (const r of names) {
  console.log(
    `${r.name} w=${r.width} ${r.points.map((p) => `(${p[0].toFixed(1)},${p[1].toFixed(1)})`).join(' ')}`,
  );
}
console.log('STRANDED-DOORS', JSON.stringify(strandedDoorsOfLastSolve()));
