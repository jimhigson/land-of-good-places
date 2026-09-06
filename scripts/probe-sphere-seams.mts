/** Throwaway instrument: dump the seams check:coplanar is red on, with positions. */
import './headless-canvas.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildHeadlessPark } from './park-harness.mts';
import { DEFAULT_TOLERANCES, sweepCoplanar } from './coplanar-sweep.mts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { PARK_SEED_POOL } from '../src/world/parkSeedPool.ts';
import { SPACE_GARDEN } from '../src/world/spaces.ts';

const WANT = [
  ['/deck', '/shell'],
  ['/shell', '/wallTop'],
  ['boundary-blocks', 'rail-fence'],
] as const;

function interesting(a: string, b: string): boolean {
  return WANT.some(([x, y]) => (a.includes(x) && b.includes(y)) || (a.includes(y) && b.includes(x)));
}

if (process.env['LGP_PROBE_CHILD'] === '1') {
  const park = buildHeadlessPark();
  const result = sweepCoplanar(park.scene, DEFAULT_TOLERANCES);
  const out = result.pairs
    .filter((p) => p.space === SPACE_GARDEN && interesting(p.a, p.b))
    .map((p) => ({
      seed: PARK_SEED,
      a: p.a,
      b: p.b,
      area: p.area,
      sep: p.separation,
      at: [p.at.x, p.at.y, p.at.z],
      n: [p.normal.x, p.normal.y, p.normal.z],
    }));
  process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exit(0);
}

const run = promisify(execFile);
const seeds = [...new Set([PARK_SEED, ...PARK_SEED_POOL])].sort((a, b) => a - b);
const all: unknown[] = [];
await Promise.all(
  seeds.map(async (seed) => {
    const { stdout } = await run(
      process.execPath,
      ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', 'scripts/probe-sphere-seams.mts'],
      { env: { ...process.env, LGP_SEED: String(seed), LGP_PROBE_CHILD: '1' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    all.push(...(JSON.parse(stdout.trim().split('\n').at(-1) as string) as unknown[]));
  }),
);
process.stdout.write(`${JSON.stringify(all, null, 1)}\n`);
