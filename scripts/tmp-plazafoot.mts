/**
 * TEMP: where the plaza ring sits relative to each bridge foot, and whether
 * the ring fallback in the foot-join ladder can fire.
 *
 * Control: canonical, whose four bridges all get built — its feet must not
 * all read the same as 326's, or the column says nothing.
 */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PLAZA } from '../src/world/paths.ts';
import { RING_RADIUS } from '../src/world/parkLayout.ts';
import { CROSSING_SITES } from '../src/world/train/crossingPlan.ts';
import { debugFootJoin } from '../src/world/paths.ts';

quietly(() => buildHeadlessPark());
console.log(
  `seed ${process.env.LGP_SEED ?? 'canonical'}: plaza (${PLAZA.x.toFixed(1)}, ${PLAZA.z.toFixed(1)}) ` +
    `ringRadius ${RING_RADIUS.toFixed(2)}, ${CROSSING_SITES.length} site(s)`,
);
for (const row of debugFootJoin() as readonly Record<string, unknown>[]) {
  const [x, z] = (row.at as string).split(',').map(Number) as [number, number];
  const d = Math.hypot(x - PLAZA.x, z - PLAZA.z);
  console.log(
    `  ${row.site} ${row.foot} at (${row.at}) rungs=[${(row.rungs as number[]).join(', ')}] ` +
      `distToPlaza=${d.toFixed(1)} insideRing=${d < RING_RADIUS} nearRing=${d <= RING_RADIUS + 4}`,
  );
}
