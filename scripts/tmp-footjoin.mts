/**
 * TEMP: why a bridge foot finds no connector. Prints the three rungs of the
 * foot-join ladder exactly as `pathGridSearch` calls them, then the nearest
 * same-side lattice nodes with the screen that refuses each.
 *
 * Control: canonical, where every site becomes a built crossing — a foot with
 * a non-zero first rung there proves the columns are not all-zero by
 * construction.
 */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugFootJoin } from '../src/world/paths.ts';

quietly(() => buildHeadlessPark());
const only = process.argv[2];
for (const row of debugFootJoin() as readonly Record<string, unknown>[]) {
  const rungs = row.rungs as number[];
  console.log(
    `site ${row.site} foot ${row.foot} at (${row.at}) side=${row.side} ` +
      `rungs=[${rungs.join(', ')}]`,
  );
  if (only !== 'all' && rungs.some((n) => n > 0)) continue;
  for (const n of row.nodes as readonly Record<string, unknown>[]) {
    if (!n.ok || n.side !== row.side) {
      console.log(`   shell${n.shell} ${n.n} ok=${n.ok} side=${n.side} -- not a candidate`);
      continue;
    }
    console.log(
      `   shell${n.shell} ${n.n} tail=${n.tail} street=${n.street} ring=${n.ring} ` +
        `railSide=${n.railSide} ramp=${n.ramp} rampExempt=${n.rampExempt}`,
    );
  }
}
