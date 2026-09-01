import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { ROUTES } from '../src/world/pathGraph.ts';
buildHeadlessPark();
const want = process.argv.slice(2);
for (const def of ROUTES) {
  if (want.length && !want.includes(def.name)) continue;
  console.log(`\n${def.name} (width ${def.width}, closed ${def.closed}) ${def.points.length} pts`);
  for (const p of def.points) console.log(`   ${p[0].toFixed(2)}, ${p[1].toFixed(2)}`);
}
