/**
 * **How many trees each park plants, and how many of them can be climbed.**
 *
 * ```
 * LGP_SEED=12 LGP_PARK_RESTART=0 node --no-warnings \
 *   --import ./scripts/ts-extension-resolver-register.mjs scripts/measure-tree-scatter.mts
 * ```
 *
 * Prints one JSON line: the tree count, the climbable count (the same
 * `climbableTrees` the anti-vacuity floor counts), and the scatter's own
 * ledger — candidates drawn, trees the scatter planted and trees the
 * climb-cover pass added. For judging a change to the scatter seed by seed:
 * trees are visible, so the before/after numbers are what a person decides on.
 */
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_SEED_ASKED } from '../src/world/parkManifest.ts';
import { treeScatterLedger } from '../procgen/world/sceneryBuilders.ts';

const { world } = buildHeadlessPark();
process.stdout.write(
  JSON.stringify({
    seed: PARK_SEED_ASKED,
    restart: Number(process.env['LGP_PARK_RESTART'] ?? 0),
    trees: world.scenery.foliageOccluders.length,
    climbable: world.scenery.climbableTrees.length,
    ...treeScatterLedger,
  }) + '\n',
);
