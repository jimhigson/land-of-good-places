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
 * - `legalM2` — a 1 m grid over the park asked the **same gate**
 *   (`bushScatterLedger.probe`) at the moment the scatter finished, so the
 *   world is the one the scatter saw (no lamps, poles or rail-race ring yet,
 *   and no bush colliders: clumps never refuse each other). `parkM2` is the
 *   grid points inside the boundary, and `gridRefusals` the same breakdown
 *   over area rather than over candidates;
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

const { bushScatterLedger } = await import('../src/world/Scenery.ts');
const { PARK_BOUNDARY, edgeRadiusAt } = await import('../src/world/boundary.ts');

let reach = 0;
for (let i = 0; i < 720; i += 1) reach = Math.max(reach, edgeRadiusAt(PARK_BOUNDARY, (i / 720) * Math.PI * 2));
reach = Math.ceil(reach) + 1;

interface Grid {
  parkM2: number;
  legalM2: number;
  gridRefusals: Record<string, number>;
}
let grid: Grid | null = null;
bushScatterLedger.onDone = () => {
  const probe = bushScatterLedger.probe;
  if (!probe) throw new Error('measure-bush-space: the scatter finished with no probe');
  const g: Grid = { parkM2: 0, legalM2: 0, gridRefusals: {} };
  for (let x = -reach + 0.5; x < reach; x += 1) {
    for (let z = -reach + 0.5; z < reach; z += 1) {
      if (PARK_BOUNDARY.distanceToEdge(x, z) < 0) continue;
      g.parkM2 += 1;
      const why = probe(x, z);
      if (why === null) g.legalM2 += 1;
      else g.gridRefusals[why] = (g.gridRefusals[why] ?? 0) + 1;
    }
  }
  grid = g;
};

const { buildHeadlessPark } = await import('./park-harness.mts');
const { world } = buildHeadlessPark();

const refusals: Record<string, number> = {};
let planted = 0;
for (const verdict of bushScatterLedger.verdicts.values()) {
  if (verdict === 'planted') planted += 1;
  else refusals[verdict] = (refusals[verdict] ?? 0) + 1;
}
const standing = world.scenery.bushes.length;
console.log(
  `bush-space: ${JSON.stringify({
    seed,
    restart,
    tried: bushScatterLedger.verdicts.size,
    planted,
    standing,
    refusals: Object.fromEntries(Object.entries(refusals).sort((a, b) => b[1] - a[1])),
    ...(grid ?? { parkM2: null, legalM2: null }),
  })}`,
);
process.exit(0);
