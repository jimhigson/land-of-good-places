/** TEMP diagnostic: is a lattice column clear over a span, in paths.ts's own
 * screens? Walks it in 3 m pieces and names the first refusal. Control: the
 * private line the router actually used must read clear. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugLegScreens } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
const [x, z0, z1] = process.argv.slice(2, 5).map(Number) as [number, number, number];
for (let z = Math.min(z0, z1); z < Math.max(z0, z1); z += 3) {
  const b = Math.min(z + 3, Math.max(z0, z1));
  const v = debugLegScreens(x, z, x, b) as Record<string, unknown>;
  const bad = ['streetClear', 'ring', 'railSide', 'ramp'].filter((k) => v[k] === false);
  if (bad.length) console.log(`x=${x} z ${z.toFixed(1)}..${b.toFixed(1)} BLOCKED ${bad.join(',')}`);
}
console.log(`x=${x} done`);
