/**
 * TEMP: does each bridge foot reach the biggest grid component on its own
 * side of the railway? That is the predicate the foot-join ladder should be
 * stopping on, and this asks it of the finished grid.
 *
 * Control: run it on canonical too, where all four proven sites become built
 * crossings — every foot there must read `reachesBackbone: true`. If seed 326
 * and canonical both come out all-true, the column cannot discriminate and
 * nothing below it is worth reading.
 */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugFootSideBackbone } from '../src/world/paths.ts';
import { CROSSING_SITES } from '../src/world/train/crossingPlan.ts';
import { computeCrossings } from '../src/world/train/crossings.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';

quietly(() => buildHeadlessPark());
const crossings = computeCrossings(TRAIN_PLAN.route, TRAIN_PLAN.stations.map((s) => s.distance));
console.log(
  `seed ${process.env.LGP_SEED ?? 'canonical'}: ${CROSSING_SITES.length} proven site(s), ` +
    `${crossings.length} built crossing(s)`,
);
for (const row of debugFootSideBackbone() as readonly Record<string, unknown>[]) {
  console.log(
    `  foot ${row.i} at (${row.at}) side=${row.side} links=${row.links} conn=${row.connectors} ` +
      `comp=${row.comp}(${row.compSize}) backbone=${row.backbone}(${row.backboneSize}) ` +
      `${row.reachesBackbone ? 'BACKBONE' : 'POCKET'}`,
  );
}
