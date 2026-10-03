/**
 * **How much ground a bush could legally stand on, and what the scatter did
 * with its candidates** — the evidence behind the bush floor in
 * `theParkIsFurnished` (`test/procgen/invariants.ts`).
 *
 * ```
 * LGP_SEED=11 LGP_PARK_RESTART=4 pnpm run -s measure:bush-space
 * ```
 *
 * Builds one park headlessly and prints one `bush-space: {json}` line:
 *
 * - `tried` / `planted` and `refusals` by kind — every candidate the scatter
 *   drew, and the reason its own gate gave (`bushScatterLedger.verdicts`);
 * - `legalM2` — a 1 m grid over the park asked the **same gate** at the
 *   moment the scatter finished (`bushScatterLedger.ground`; see its comment
 *   for which world that is). `parkM2` is the grid points inside the
 *   boundary, and `gridRefusals` the same breakdown over area rather than
 *   over candidates;
 * - `decided` — clumps the world phase committed, and `standing` — clumps
 *   left after the build (a ride's pylons fell what they land on).
 *
 * Nothing here decides where a bush goes; it only asks the builder's own gate.
 */
import './headless-canvas.mjs';

const seed = Number(process.env['LGP_SEED'] ?? NaN);
const restart = Number(process.env['LGP_PARK_RESTART'] ?? 0);
if (!Number.isInteger(seed) || seed < 0 || !Number.isInteger(restart) || restart < 0) {
  console.error('measure-bush-space: LGP_SEED and LGP_PARK_RESTART must be non-negative integers');
  process.exit(2);
}

const { bushScatterLedger } = await import('../procgen/world/sceneryBuilders.ts');
bushScatterLedger.measureGround = true;

const { buildHeadlessPark } = await import('./park-harness.mts');
const { world } = buildHeadlessPark();

const refusals: Record<string, number> = {};
let planted = 0;
for (const verdict of bushScatterLedger.verdicts.values()) {
  if (verdict === 'planted') planted += 1;
  else refusals[verdict] = (refusals[verdict] ?? 0) + 1;
}
const standing = world.scenery.bushes.length;
const ground = bushScatterLedger.ground;
console.log(
  `bush-space: ${JSON.stringify({
    seed,
    restart,
    tried: bushScatterLedger.verdicts.size,
    planted,
    standing,
    refusals: Object.fromEntries(Object.entries(refusals).sort((a, b) => b[1] - a[1])),
    parkM2: ground?.parkM2 ?? null,
    legalM2: ground?.legalM2 ?? null,
    gridRefusals: ground?.refusals ?? null,
  })}`,
);
process.exit(0);
