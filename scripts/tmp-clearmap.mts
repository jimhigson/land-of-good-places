/** TEMP diagnostic: a map of streetSegmentClear point-clearance over a window,
 * so the shape of what boxes a lattice node in can be seen. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugNodeScreens } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
const [x0, x1, z0, z1, step] = process.argv.slice(2).map(Number) as [number, number, number, number, number];
for (let z = z1; z >= z0; z -= step) {
  let row = `z=${z.toFixed(0).padStart(4)} `;
  for (let x = x0; x <= x1; x += step) {
    const d = debugNodeScreens(x, z) as { streetClear: boolean; onMasonry: boolean; inRing: boolean; railDist: number };
    row += d.inRing ? 'O' : d.onMasonry ? 'M' : d.railDist < 4.2 ? 'R' : d.streetClear ? '.' : '#';
  }
  console.log(row);
}
