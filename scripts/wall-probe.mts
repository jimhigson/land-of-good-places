/** How long are the park's own wall runs (wood maze + stone), and what does one
 *  flat `base` datum cost along them? Measurement only — and NOT bridges. */
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import type { ParkFacts } from '../test/procgen/parkFacts.ts';
import { terrainHeight } from '../src/world/terrain.ts';
import { flatDeparture, flatRadiusFor } from '../src/world/geo/Chart.ts';
import { segmentsFor } from '../src/world/geo/bend.ts';

const park = buildHeadlessPark();
const limit = 2 * flatRadiusFor(0.05);
console.log(`one rigid box is honest up to ${limit.toFixed(2)} m long`);

const walls = park.world.scenery.wallRuns as readonly {
  from: readonly [number, number]; to: readonly [number, number]; kind: string; height: number;
}[];
console.log(`${walls.length} wall runs in the built park`);
const rows = walls.map((w) => {
  const len = Math.hypot(w.to[0]-w.from[0], w.to[1]-w.from[1]);
  // How far the ground departs from the straight chord between the two ends —
  // the quantity the single `base` datum is standing in for.
  let worst = 0;
  const n = 24;
  const h0 = terrainHeight(w.from[0], w.from[1]);
  const h1 = terrainHeight(w.to[0], w.to[1]);
  for (let i = 0; i <= n; i++) {
    const t = i/n;
    const x = w.from[0] + (w.to[0]-w.from[0])*t;
    const z = w.from[1] + (w.to[1]-w.from[1])*t;
    worst = Math.max(worst, Math.abs(terrainHeight(x,z) - (h0 + (h1-h0)*t)));
  }
  return { kind: w.kind, len, worst, sag: flatDeparture(len/2) };
}).sort((a,b) => b.len - a.len);

for (const r of rows.slice(0, 10)) {
  console.log(
    `  ${r.kind.padEnd(6)} ${r.len.toFixed(1).padStart(5)} m   sphere sag at its middle ${(r.sag*100).toFixed(1).padStart(5)} cm   ` +
    `terrain wanders ${(r.worst*100).toFixed(1)} cm off the chord   needs ${segmentsFor(r.len)} seg`,
  );
}
const over = rows.filter(r => r.len > limit);
console.log(`${over.length} of ${rows.length} runs are longer than ${limit.toFixed(2)} m`);
console.log(`longest ${rows[0]?.len.toFixed(1)} m, sagging ${((rows[0]?.sag ?? 0)*100).toFixed(1)} cm at its middle`);
