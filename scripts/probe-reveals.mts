/** Throwaway: the distribution of reveal-under-a-collapsed-course depths. */
import './headless-canvas.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { PARK_SEED_POOL } from '../src/world/parkSeedPool.ts';

if (process.env['LGP_REVEAL_CHILD'] === '1') {
  (globalThis as never as { LGP_REVEALS: number[][] }).LGP_REVEALS = [];
  const { buildHeadlessPark } = await import('./park-harness.mts');
  buildHeadlessPark();
  const rows = (globalThis as never as { LGP_REVEALS: number[][] }).LGP_REVEALS;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/coplanar-sphere/reveals/${PARK_SEED}.json`, JSON.stringify(rows.map((r) => [PARK_SEED, ...r])));
  process.exit(0);
}

const run = promisify(execFile);
const seeds = [...new Set([PARK_SEED, ...PARK_SEED_POOL])].sort((a, b) => a - b);
const all: number[][] = [];
const lanes = 4;
const queue = [...seeds];
await Promise.all(
  Array.from({ length: lanes }, async () => {
    for (let seed = queue.pop(); seed !== undefined; seed = queue.pop()) {
      await run(
        process.execPath,
        ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', 'scripts/probe-reveals.mts'],
        { env: { ...process.env, LGP_SEED: String(seed), LGP_REVEAL_CHILD: '1' }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
      );
    }
  }),
);
console.log(`done, ${all.length}`);
