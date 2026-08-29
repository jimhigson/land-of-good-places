import { buildHeadlessPark } from './scripts/park-harness.mts';
const t = buildHeadlessPark().world.train;
console.log(
  `seed=${process.env['LGP_SEED'] ?? 'canonical'} crossings=${t.crossings.length} ` +
    `bridges=${t.bridges.length} fallbacks=${t.fallbackCrossings.length}`,
);
